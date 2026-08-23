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
  exerciseId?: string;
  workoutId?: string;
  date?: string;
  completedAt?: string;
  status?: "COMPLETED" | "PARTIAL" | "IN_PROGRESS";
  equipment?: string[];
  selectionMetadata?: unknown;
  phase?: "ACCUMULATION" | "DELOAD";
  measurement?: {
    measurementProfile: "REPS_EXTERNAL_LOAD" | "REPS_BODYWEIGHT" | "REPS_BODYWEIGHT_PLUS_LOAD" | "REPS_ASSISTED";
    loadConvention: "BARBELL_TOTAL" | "IMPLEMENT_WEIGHT" | "MACHINE_DISPLAYED" | "ADDED_EXTERNAL_LOAD" | "DISPLAYED_ASSISTANCE" | null;
    repBasis: "TOTAL" | "PER_SIDE";
  };
  zeroLoadMeaning?: "BODYWEIGHT_NO_ADDED_LOAD" | "MACHINE_DEFAULT_NO_ADDED_LOAD" | null;
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
  const exerciseId = input?.exerciseId ?? "bench";
  return {
    id: `we-${input?.workoutId ?? "1"}`,
    exerciseId,
    measurementProfile: input?.measurement?.measurementProfile ?? null,
    loadConvention: input?.measurement?.loadConvention ?? null,
    repBasis: input?.measurement?.repBasis ?? null,
    zeroLoadMeaning: input?.zeroLoadMeaning ?? null,
    exercise: {
      id: exerciseId,
      name: exerciseId === "bench" ? "Bench Press" : "Other Exercise",
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
        exerciseId: "assisted-pull-up",
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

  it("shows classified, incompatible, and legacy performed work while keeping records measurement-safe", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({
        workoutId: "current",
        date: "2026-03-03T00:00:00.000Z",
        measurement: {
          measurementProfile: "REPS_EXTERNAL_LOAD",
          loadConvention: "BARBELL_TOTAL",
          repBasis: "TOTAL",
        },
        sets: [{ setIndex: 1, reps: 8, load: 185, rpe: 8 }],
      }),
      makeRow({
        workoutId: "incompatible",
        date: "2026-03-02T00:00:00.000Z",
        measurement: {
          measurementProfile: "REPS_EXTERNAL_LOAD",
          loadConvention: "IMPLEMENT_WEIGHT",
          repBasis: "TOTAL",
        },
        sets: [{ setIndex: 1, reps: 8, load: 100, rpe: 8 }],
      }),
      makeRow({
        workoutId: "legacy",
        date: "2026-03-01T00:00:00.000Z",
        sets: [{ setIndex: 1, reps: 8, load: 225, rpe: 8 }],
      }),
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 10);

    expect(result.recentExposures.map((row) => row.workoutId)).toEqual([
      "current",
      "incompatible",
      "legacy",
    ]);
    expect(result.recentExposures.map((row) => row.measurement)).toEqual([
      {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "BARBELL_TOTAL",
        repBasis: "TOTAL",
      },
      {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "IMPLEMENT_WEIGHT",
        repBasis: "TOTAL",
      },
      null,
    ]);
    expect(result.recentExposures.map((row) => row.isRecordComparable)).toEqual([
      true,
      false,
      false,
    ]);
    expect(result.comparison.loadConvention).toBe("recorded_external_load");
    expect(result.records.heaviestCompletedLoad?.load).toBe(185);
  });

  it("never admits another canonical exercise even if the database adapter violates its filter", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({
        exerciseId: "incline-bench",
        workoutId: "other-exercise",
        date: "2026-03-03T00:00:00.000Z",
        sets: [{ setIndex: 1, reps: 8, load: 300, rpe: 8 }],
      }),
      makeRow({
        workoutId: "exact-exercise",
        date: "2026-03-01T00:00:00.000Z",
        sets: [{ setIndex: 1, reps: 8, load: 185, rpe: 8 }],
      }),
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 10);

    expect(result.recentExposures.map((row) => row.workoutId)).toEqual([
      "exact-exercise",
    ]);
    expect(result.records.heaviestCompletedLoad?.load).toBe(185);
  });

  it("labels classified implement loads without assuming two dumbbells", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({
        exerciseId: "goblet",
        measurement: {
          measurementProfile: "REPS_EXTERNAL_LOAD",
          loadConvention: "IMPLEMENT_WEIGHT",
          repBasis: "TOTAL",
        },
      }),
    ]);

    const result = await loadExerciseHistory("goblet", "user-1", 3);

    expect(result.comparison.loadConvention).toBe("per_implement");
  });

  it("labels displayed machine and assistance values without claiming pounds", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({
        exerciseId: "assisted",
        measurement: {
          measurementProfile: "REPS_ASSISTED",
          loadConvention: "DISPLAYED_ASSISTANCE",
          repBasis: "TOTAL",
        },
      }),
    ]);

    const assisted = await loadExerciseHistory("assisted", "user-1", 3);
    expect(assisted.comparison.loadConvention).toBe("displayed_assistance");
    expect(assisted.records.heaviestCompletedLoad).toBeNull();

    mocks.findMany.mockResolvedValue([
      makeRow({
        exerciseId: "cable-row",
        measurement: {
          measurementProfile: "REPS_EXTERNAL_LOAD",
          loadConvention: "MACHINE_DISPLAYED",
          repBasis: "TOTAL",
        },
      }),
    ]);
    const machine = await loadExerciseHistory("cable-row", "user-1", 3);
    expect(machine.comparison.loadConvention).toBe("machine_displayed");
    expect(machine.records.heaviestCompletedLoad).toBeNull();
  });

  it("shows legacy performed history for a classified active snapshot without using it for records", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({
        workoutId: "legacy-history",
        date: "2026-03-01T00:00:00.000Z",
        sets: [{ setIndex: 1, reps: 8, load: 225, rpe: 8 }],
      }),
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 10, {
      measurement: {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "BARBELL_TOTAL",
        repBasis: "TOTAL",
      },
    });

    expect(result.recentExposures.map((row) => row.workoutId)).toEqual([
      "legacy-history",
    ]);
    expect(result.lastExposure).toMatchObject({
      workoutId: "legacy-history",
      measurement: null,
      isRecordComparable: false,
    });
    expect(result.records).toEqual({
      bestEstimatedStrength: null,
      heaviestCompletedLoad: null,
      highestSessionVolume: null,
    });
  });

  it("excludes an in-progress current workout without hiding older performed history", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({
        workoutId: "current-in-progress",
        status: "IN_PROGRESS",
        date: "2026-03-03T00:00:00.000Z",
        measurement: {
          measurementProfile: "REPS_EXTERNAL_LOAD",
          loadConvention: "BARBELL_TOTAL",
          repBasis: "TOTAL",
        },
        sets: [{ setIndex: 1, reps: 8, load: 185, rpe: 8 }],
      }),
      makeRow({
        workoutId: "older-legacy",
        date: "2026-03-01T00:00:00.000Z",
        sets: [{ setIndex: 1, reps: 8, load: 225, rpe: 8 }],
      }),
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 10, {
      measurement: {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "BARBELL_TOTAL",
        repBasis: "TOTAL",
      },
    });

    expect(result.recentExposures.map((row) => row.workoutId)).toEqual([
      "older-legacy",
    ]);
    expect(result.lastExposure?.workoutId).toBe("older-legacy");
  });

  it("keeps a classified historical exposure visible and eligible for matching records", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({
        workoutId: "classified-history",
        measurement: {
          measurementProfile: "REPS_EXTERNAL_LOAD",
          loadConvention: "BARBELL_TOTAL",
          repBasis: "TOTAL",
        },
        sets: [{ setIndex: 1, reps: 8, load: 205, rpe: 8 }],
      }),
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 10, {
      measurement: {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "BARBELL_TOTAL",
        repBasis: "TOTAL",
      },
    });

    expect(result.lastExposure).toMatchObject({
      workoutId: "classified-history",
      isRecordComparable: true,
    });
    expect(result.records.heaviestCompletedLoad?.load).toBe(205);
  });

  it.each([
    [
      "bulgarian",
      "IMPLEMENT_WEIGHT" as const,
      "PER_SIDE" as const,
      "BODYWEIGHT_NO_ADDED_LOAD" as const,
    ],
    [
      "hack-squat",
      "MACHINE_DISPLAYED" as const,
      "TOTAL" as const,
      "MACHINE_DEFAULT_NO_ADDED_LOAD" as const,
    ],
  ])(
    "does not split positive %s history when the frozen zero capability appears",
    async (exerciseId, loadConvention, repBasis, zeroLoadMeaning) => {
      const measurement = {
        measurementProfile: "REPS_EXTERNAL_LOAD" as const,
        loadConvention,
        repBasis,
      };
      mocks.findMany.mockResolvedValue([
        makeRow({
          exerciseId,
          workoutId: "new-capability",
          date: "2026-03-02T00:00:00.000Z",
          measurement,
          zeroLoadMeaning,
          sets: [{ setIndex: 1, reps: 8, load: 100, rpe: 8 }],
        }),
        makeRow({
          exerciseId,
          workoutId: "old-null",
          date: "2026-03-01T00:00:00.000Z",
          measurement,
          zeroLoadMeaning: null,
          sets: [{ setIndex: 1, reps: 8, load: 120, rpe: 8 }],
        }),
      ]);

      const result = await loadExerciseHistory(exerciseId, "user-1", 10);

      expect(result.recentExposures).toHaveLength(2);
      expect(result.recentExposures.map((row) => row.isRecordComparable)).toEqual([
        loadConvention !== "MACHINE_DISPLAYED",
        loadConvention !== "MACHINE_DISPLAYED",
      ]);
      if (loadConvention === "MACHINE_DISPLAYED") {
        expect(result.records.heaviestCompletedLoad).toBeNull();
      } else {
        expect(result.records.heaviestCompletedLoad?.load).toBe(120);
      }
    },
  );

  it("keeps zero visible as performed work without e1RM, load, or volume records", async () => {
    mocks.findMany.mockResolvedValue([
      makeRow({
        exerciseId: "bulgarian",
        measurement: {
          measurementProfile: "REPS_EXTERNAL_LOAD",
          loadConvention: "IMPLEMENT_WEIGHT",
          repBasis: "PER_SIDE",
        },
        zeroLoadMeaning: "BODYWEIGHT_NO_ADDED_LOAD",
        sets: [{ setIndex: 1, reps: 10, load: 0, rpe: 8 }],
      }),
    ]);

    const result = await loadExerciseHistory("bulgarian", "user-1", 3);

    expect(result.lastExposure?.sets[0]).toMatchObject({ reps: 10, load: 0, rpe: 8 });
    expect(result.records).toEqual({
      bestEstimatedStrength: null,
      heaviestCompletedLoad: null,
      highestSessionVolume: null,
    });
  });
});
