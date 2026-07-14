import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const findMany = vi.fn();
  return {
    findMany,
    prisma: {
      workoutExercise: { findMany },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  buildExerciseRotationContext,
  loadExerciseRotationContext,
  loadRecentPerformedExerciseIds,
  type RotationHistoryRow,
} from "./exercise-rotation-history";

const NOW = new Date("2026-07-14T12:00:00.000Z");

function row(input: {
  id: string;
  exerciseId: string;
  performedAt?: Date;
  selectionMetadata?: unknown;
  setIntent?: "WORK" | "WARMUP";
  actualReps?: number | null;
  actualRpe?: number | null;
  wasSkipped?: boolean;
}): RotationHistoryRow {
  return {
    id: input.id,
    exerciseId: input.exerciseId,
    workout: { selectionMetadata: input.selectionMetadata ?? {} },
    sets: [
      {
        logs: input.performedAt
          ? [
              {
                completedAt: input.performedAt,
                actualLoad: 100,
                actualReps: input.actualReps === undefined ? 8 : input.actualReps,
                actualRpe: input.actualRpe === undefined ? 8 : input.actualRpe,
                setIntent: input.setIntent ?? "WORK",
                wasSkipped: input.wasSkipped ?? false,
              },
            ]
          : [],
      },
    ],
  };
}

describe("exercise rotation history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads completed performed history and keys freshness by stable exercise ID", async () => {
    mocks.findMany.mockResolvedValue([
      row({
        id: "we-bench",
        exerciseId: "exercise-a",
        performedAt: new Date("2026-07-07T12:00:00.000Z"),
      }),
    ]);

    const result = await loadExerciseRotationContext("user-1", NOW);

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workout: { userId: "user-1", status: "COMPLETED" },
          sets: expect.objectContaining({
            some: expect.objectContaining({
              logs: expect.objectContaining({
                some: expect.objectContaining({
                  completedAt: {
                    gte: new Date("2026-04-21T12:00:00.000Z"),
                  },
                }),
              }),
            }),
          }),
        }),
      })
    );
    expect(result.get("exercise-a")).toEqual({
      lastUsed: new Date("2026-07-07T12:00:00.000Z"),
      weeksAgo: 1,
    });
  });

  it("keeps rename history attached to the same ID and variants isolated", () => {
    const result = buildExerciseRotationContext(
      [
        row({
          id: "we-old-name",
          exerciseId: "exercise-a",
          performedAt: new Date("2026-07-01T12:00:00.000Z"),
        }),
        row({
          id: "we-new-name",
          exerciseId: "exercise-a",
          performedAt: new Date("2026-07-10T12:00:00.000Z"),
        }),
        row({
          id: "we-machine-variant",
          exerciseId: "exercise-b",
          performedAt: new Date("2026-07-05T12:00:00.000Z"),
        }),
      ],
      NOW
    );

    expect(result.size).toBe(2);
    expect(result.get("exercise-a")?.lastUsed).toEqual(
      new Date("2026-07-10T12:00:00.000Z")
    );
    expect(result.get("exercise-b")?.lastUsed).toEqual(
      new Date("2026-07-05T12:00:00.000Z")
    );
  });

  it("counts only performed work and excludes warmups, skips, and untouched rows", () => {
    const result = buildExerciseRotationContext(
      [
        row({
          id: "we-work",
          exerciseId: "work",
          performedAt: new Date("2026-07-12T12:00:00.000Z"),
        }),
        row({
          id: "we-warmup",
          exerciseId: "warmup",
          performedAt: new Date("2026-07-12T12:00:00.000Z"),
          setIntent: "WARMUP",
        }),
        row({
          id: "we-skipped",
          exerciseId: "skipped",
          performedAt: new Date("2026-07-12T12:00:00.000Z"),
          wasSkipped: true,
        }),
        row({ id: "we-untouched", exerciseId: "untouched" }),
      ],
      NOW
    );

    expect([...result.keys()]).toEqual(["work"]);
  });

  it("includes performed optional work but preserves closeout and runtime-added exclusions", () => {
    const runtimeAddedMetadata = {
      runtimeEditReconciliation: {
        version: 1,
        lastReconciledAt: "2026-07-13T12:00:00.000Z",
        directives: {
          continuityAlias: "none",
          progressionAlias: "none",
          futureSessionGeneration: "ignore",
          futureSeedCarryForward: "ignore",
        },
        ops: [
          {
            kind: "add_exercise",
            source: "api_workouts_add_exercise",
            appliedAt: "2026-07-13T12:00:00.000Z",
            scope: "current_workout_only",
            facts: {
              workoutExerciseId: "we-runtime",
              exerciseId: "runtime",
              orderIndex: 1,
              section: "ACCESSORY",
              setCount: 2,
              prescriptionSource: "session_accessory_defaults",
            },
          },
        ],
      },
    };
    const closeoutMetadata = {
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 4,
          weekInBlock: 4,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        lifecycleVolume: { source: "unknown" },
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: "none",
          reason: [],
          reductionPercent: 0,
          appliedTo: "none",
        },
        readiness: {
          wasAutoregulated: false,
          signalAgeHours: null,
          fatigueScoreOverall: null,
          intensityScaling: {
            applied: false,
            exerciseIds: [],
            scaledUpCount: 0,
            scaledDownCount: 0,
          },
        },
        exceptions: [{ code: "closeout_session", message: "Optional closeout." }],
      },
    };
    const result = buildExerciseRotationContext(
      [
        row({
          id: "we-optional",
          exerciseId: "optional-planned",
          performedAt: new Date("2026-07-13T12:00:00.000Z"),
        }),
        row({
          id: "we-runtime",
          exerciseId: "runtime",
          performedAt: new Date("2026-07-13T12:00:00.000Z"),
          selectionMetadata: runtimeAddedMetadata,
        }),
        row({
          id: "we-closeout",
          exerciseId: "closeout",
          performedAt: new Date("2026-07-13T12:00:00.000Z"),
          selectionMetadata: closeoutMetadata,
        }),
      ],
      NOW
    );

    expect([...result.keys()]).toEqual(["optional-planned"]);
  });

  it("attributes an unlogged runtime swap to the replacement ID", () => {
    const result = buildExerciseRotationContext(
      [
        row({
          id: "we-swapped",
          exerciseId: "replacement-id",
          performedAt: new Date("2026-07-13T12:00:00.000Z"),
        }),
      ],
      NOW
    );

    expect(result.has("replacement-id")).toBe(true);
    expect(result.has("original-id")).toBe(false);
  });

  it("loads recent IDs with an actual performed-log cutoff", async () => {
    const cutoff = new Date("2026-07-12T12:00:00.000Z");
    mocks.findMany.mockResolvedValue([
      row({
        id: "we-recent",
        exerciseId: "recent",
        performedAt: new Date("2026-07-13T12:00:00.000Z"),
      }),
    ]);

    await expect(loadRecentPerformedExerciseIds("user-1", cutoff, NOW)).resolves.toEqual(
      new Set(["recent"])
    );
    expect(mocks.findMany.mock.calls[0][0].where.sets.some.logs.some.completedAt).toEqual({
      gte: cutoff,
    });
  });
});
