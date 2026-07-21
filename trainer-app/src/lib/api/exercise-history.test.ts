/**
 * Protects exact-exercise, performed-work authority for user-facing history and records.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";

const mocks = vi.hoisted(() => {
  const findMany = vi.fn();
  return {
    findMany,
    prisma: {
      workoutExercise: {
        findMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { loadExerciseHistory } from "./exercise-history";

function makeRow(input?: {
  workoutId?: string;
  date?: string;
  completedAt?: string;
  status?: "COMPLETED" | "PARTIAL";
  equipment?: string[];
  selectionMetadata?: unknown;
  phase?: "ACCUMULATION" | "DELOAD";
  sets?: Array<{
    id?: string;
    setIndex: number;
    setIntent?: "WORK" | "WARMUP";
    reps?: number | null;
    load?: number | null;
    rpe?: number | null;
    skipped?: boolean;
    logged?: boolean;
  }>;
}) {
  const date = input?.date ?? "2026-02-20T00:00:00.000Z";
  return {
    id: `we-${input?.workoutId ?? "1"}`,
    exercise: {
      id: "bench",
      name: "Bench Press",
      exerciseEquipment: (input?.equipment ?? ["BARBELL"]).map((type) => ({
        equipment: { type },
      })),
    },
    workout: {
      id: input?.workoutId ?? "workout-1",
      scheduledDate: new Date(date),
      completedAt: new Date(input?.completedAt ?? date),
      status: input?.status ?? "COMPLETED",
      selectionMetadata: input?.selectionMetadata ?? {},
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      advancesSplit: true,
      mesocyclePhaseSnapshot: input?.phase ?? "ACCUMULATION",
    },
    sets: (input?.sets ?? [{ setIndex: 1, reps: 8, load: 185, rpe: 8 }]).map(
      (set) => ({
        id: set.id ?? `${input?.workoutId ?? "workout-1"}-set-${set.setIndex}`,
        setIndex: set.setIndex,
        logs:
          set.logged === false
            ? []
            : [
                {
                  setIntent: set.setIntent ?? "WORK",
                  actualReps: set.reps ?? null,
                  actualLoad: set.load ?? null,
                  actualRpe: set.rpe ?? null,
                  wasSkipped: set.skipped ?? false,
                  completedAt: new Date(date),
                },
              ],
      })
    ),
  };
}

describe("loadExerciseHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only qualifying performed work and preserves incomplete exposure context", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({
        status: "PARTIAL",
        completedAt: "2026-02-21T03:00:00.000Z",
        sets: [
          { setIndex: 1, reps: 8, load: 185, rpe: 8 },
          { setIndex: 2, setIntent: "WARMUP", reps: 10, load: 95, rpe: 5 },
          { setIndex: 3, skipped: true },
          { setIndex: 4, logged: false },
        ],
      }),
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 3);

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      exerciseId: "bench",
      workout: { userId: "user-1", status: { in: [...PERFORMED_WORKOUT_STATUSES] } },
    });
    expect(query.take).toBeUndefined();
    expect(result.lastExposure).toMatchObject({
      date: "2026-02-21T03:00:00.000Z",
      workoutStatus: "PARTIAL",
      completedSetCount: 1,
      skippedSetCount: 1,
      unloggedSetCount: 1,
      sets: [{ setIndex: 1, reps: 8, load: 185, rpe: 8 }],
    });
  });

  it("computes lifetime records from all eligible exposures, not the display limit", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({ workoutId: "recent", date: "2026-03-03T00:00:00.000Z", equipment: ["DUMBBELL"], sets: [{ setIndex: 1, reps: 10, load: 50, rpe: 8 }] }),
      makeRow({ workoutId: "middle", date: "2026-03-01T00:00:00.000Z", equipment: ["DUMBBELL"], sets: [{ setIndex: 1, reps: 8, load: 55, rpe: 8 }] }),
      makeRow({ workoutId: "old-pr", date: "2026-02-01T00:00:00.000Z", equipment: ["DUMBBELL"], sets: [{ setIndex: 1, reps: 8, load: 60, rpe: 9 }, { setIndex: 2, reps: 7, load: 60, rpe: 9 }] }),
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 2);

    expect(result.recentExposures).toHaveLength(2);
    expect(result.comparison.loadConvention).toBe("per_dumbbell");
    expect(result.records.bestEstimatedStrength).toMatchObject({ load: 60, reps: 8 });
    expect(result.records.heaviestCompletedLoad).toMatchObject({ load: 60, reps: 8 });
    expect(result.records.highestSessionVolume).toMatchObject({ volume: 900, completedSetCount: 2 });
  });

  it("excludes deloads and rows without performed work", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({ workoutId: "deload", phase: "DELOAD", sets: [{ setIndex: 1, reps: 8, load: 155, rpe: 5 }] }),
      makeRow({ workoutId: "empty", date: "2026-02-19T00:00:00.000Z", sets: [{ setIndex: 1, logged: false }] }),
      makeRow({ workoutId: "work", date: "2026-02-13T00:00:00.000Z", sets: [{ setIndex: 1, reps: 8, load: 200, rpe: 8 }] }),
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 3);

    expect(result.recentExposures).toHaveLength(1);
    expect(result.lastExposure?.workoutId).toBe("work");
    expect(result.records.heaviestCompletedLoad?.load).toBe(200);
  });

  it("suppresses load records when bodyweight or assistance is not comparable", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({
        equipment: ["BODYWEIGHT", "MACHINE"],
        sets: [{ setIndex: 1, reps: 10, load: 40, rpe: 8 }],
      }),
    ]);

    const result = await loadExerciseHistory("assisted-pull-up", "user-1", 3);

    expect(result.comparison.loadConvention).toBe("not_comparable");
    expect(result.records).toEqual({
      bestEstimatedStrength: null,
      heaviestCompletedLoad: null,
      highestSessionVolume: null,
    });
  });
});
