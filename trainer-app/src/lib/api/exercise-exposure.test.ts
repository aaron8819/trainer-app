/**
 * Protects: Exposure history should track performed work only, not template presence.
 * Why it matters: Rotation novelty and SRA context should ignore completed workout rows with zero real stimulus.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindUnique = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const exerciseExposureUpsert = vi.fn();
  const exerciseExposureFindMany = vi.fn();

  return {
    workoutFindUnique,
    workoutExerciseFindMany,
    exerciseExposureUpsert,
    exerciseExposureFindMany,
    prisma: {
      workout: {
        findUnique: workoutFindUnique,
      },
      workoutExercise: {
        findMany: workoutExerciseFindMany,
      },
      exerciseExposure: {
        upsert: exerciseExposureUpsert,
        findMany: exerciseExposureFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { loadExerciseExposure, updateExerciseExposure } from "./exercise-exposure";

describe("exercise exposure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not update exposure for completed exercises with no performed stimulus", async () => {
    mocks.workoutFindUnique.mockResolvedValue({
      id: "workout-1",
      status: "COMPLETED",
      selectionMetadata: {},
      exercises: [
        {
          id: "we-1",
          exercise: { name: "Cable Curl" },
          sets: [
            { logs: [] },
            { logs: [{ actualReps: null, actualRpe: null, wasSkipped: true }] },
          ],
        },
      ],
    });

    await updateExerciseExposure("user-1", "workout-1");

    expect(mocks.workoutExerciseFindMany).not.toHaveBeenCalled();
    expect(mocks.exerciseExposureUpsert).not.toHaveBeenCalled();
  });

  it("updates exposure for exercises with at least one performed set", async () => {
    mocks.workoutFindUnique.mockResolvedValue({
      id: "workout-1",
      status: "COMPLETED",
      selectionMetadata: {},
      exercises: [
        {
          id: "we-bench",
          exercise: { name: "Bench Press" },
          sets: [
            { logs: [{ actualReps: 8, actualRpe: 8, wasSkipped: false }] },
            { logs: [{ actualReps: null, actualRpe: null, wasSkipped: true }] },
          ],
        },
        {
          id: "we-curl",
          exercise: { name: "Cable Curl" },
          sets: [{ logs: [] }],
        },
      ],
    });
    mocks.workoutExerciseFindMany
      .mockResolvedValueOnce([
        { id: "w4", workout: { selectionMetadata: {} } },
        { id: "w5", workout: { selectionMetadata: {} } },
      ])
      .mockResolvedValueOnce([
        { id: "w6", workout: { selectionMetadata: {} } },
        { id: "w7", workout: { selectionMetadata: {} } },
        { id: "w8", workout: { selectionMetadata: {} } },
      ])
      .mockResolvedValueOnce([
        { id: "w9", workout: { selectionMetadata: {} } },
        { id: "w10", workout: { selectionMetadata: {} } },
        { id: "w11", workout: { selectionMetadata: {} } },
        { id: "w12", workout: { selectionMetadata: {} } },
      ]);

    await updateExerciseExposure("user-1", "workout-1");

    expect(mocks.workoutExerciseFindMany).toHaveBeenCalledTimes(3);
    for (const call of mocks.workoutExerciseFindMany.mock.calls) {
      expect(call[0].where.exercise.name).toBe("Bench Press");
      expect(call[0].where.sets).toEqual({
        some: {
          logs: {
            some: {
              wasSkipped: false,
              OR: [{ actualReps: { not: null } }, { actualRpe: { not: null } }],
            },
          },
        },
      });
    }

    expect(mocks.exerciseExposureUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.exerciseExposureUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_exerciseName: {
            userId: "user-1",
            exerciseName: "Bench Press",
          },
        },
        create: expect.objectContaining({
          exerciseName: "Bench Press",
          timesUsedL4W: 2,
          timesUsedL8W: 3,
          timesUsedL12W: 4,
          avgSetsPerWeek: 0.25,
        }),
      })
    );
  });

  it("ignores runtime-added exercises when updating exposure windows", async () => {
    mocks.workoutFindUnique.mockResolvedValue({
      id: "workout-1",
      status: "COMPLETED",
      selectionMetadata: {
        runtimeEditReconciliation: {
          version: 1,
          lastReconciledAt: "2026-03-23T10:00:00.000Z",
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
              appliedAt: "2026-03-23T10:00:00.000Z",
              scope: "current_workout_only",
              facts: {
                workoutExerciseId: "we-runtime-added",
                exerciseId: "pec-deck",
                orderIndex: 1,
                section: "ACCESSORY",
                setCount: 2,
                prescriptionSource: "session_accessory_defaults",
              },
            },
          ],
        },
      },
      exercises: [
        {
          id: "we-runtime-added",
          exercise: { name: "Pec Deck" },
          sets: [{ logs: [{ actualReps: 12, actualRpe: 7, wasSkipped: false }] }],
        },
      ],
    });

    await updateExerciseExposure("user-1", "workout-1");

    expect(mocks.workoutExerciseFindMany).not.toHaveBeenCalled();
    expect(mocks.exerciseExposureUpsert).not.toHaveBeenCalled();
  });

  it("does not treat load-only rows as performed exposure stimulus", async () => {
    mocks.workoutFindUnique.mockResolvedValue({
      id: "workout-1",
      status: "COMPLETED",
      selectionMetadata: {},
      exercises: [
        {
          id: "we-bench",
          exercise: { name: "Bench Press" },
          sets: [
            { logs: [{ actualReps: null, actualRpe: null, actualLoad: 185, wasSkipped: false }] },
          ],
        },
      ],
    });

    await updateExerciseExposure("user-1", "workout-1");

    expect(mocks.workoutExerciseFindMany).not.toHaveBeenCalled();
    expect(mocks.exerciseExposureUpsert).not.toHaveBeenCalled();
  });

  it("preserves selection history for genuinely performed exercises", async () => {
    mocks.exerciseExposureFindMany.mockResolvedValue([
      {
        exerciseName: "Bench Press",
        lastUsedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        timesUsedL12W: 3,
      },
    ]);
    mocks.workoutExerciseFindMany.mockResolvedValue([
      {
        id: "we-1",
        workout: { completedAt: new Date("2026-02-15T00:00:00.000Z"), selectionMetadata: {} },
        sets: [{ logs: [{ actualLoad: 190, actualReps: 8 }] }],
      },
      {
        id: "we-2",
        workout: { completedAt: new Date("2026-02-08T00:00:00.000Z"), selectionMetadata: {} },
        sets: [{ logs: [{ actualLoad: 185, actualReps: 8 }] }],
      },
      {
        id: "we-3",
        workout: { completedAt: new Date("2026-02-01T00:00:00.000Z"), selectionMetadata: {} },
        sets: [{ logs: [{ actualLoad: 180, actualReps: 8 }] }],
      },
    ]);

    const result = await loadExerciseExposure("user-1");

    expect(mocks.workoutExerciseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          exercise: { name: "Bench Press" },
          sets: {
            some: {
              logs: {
                some: {
                  wasSkipped: false,
                  OR: [{ actualReps: { not: null } }, { actualRpe: { not: null } }],
                },
              },
            },
          },
        }),
      })
    );

    expect(result.get("Bench Press")).toEqual(
      expect.objectContaining({
        usageCount: 3,
        trend: "improving",
      })
    );
  });

  it("ignores deload and runtime-added sessions when deriving performance trend", async () => {
    mocks.exerciseExposureFindMany.mockResolvedValue([
      {
        exerciseName: "Bench Press",
        lastUsedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        timesUsedL12W: 4,
      },
    ]);
    mocks.workoutExerciseFindMany.mockResolvedValue([
      {
        id: "we-runtime-added",
        workout: {
          completedAt: new Date("2026-02-24T00:00:00.000Z"),
          selectionMetadata: {
            runtimeEditReconciliation: {
              version: 1,
              lastReconciledAt: "2026-02-24T00:00:00.000Z",
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
                  appliedAt: "2026-02-24T00:00:00.000Z",
                  scope: "current_workout_only",
                  facts: {
                    workoutExerciseId: "we-runtime-added",
                    exerciseId: "bench",
                    orderIndex: 1,
                    section: "ACCESSORY",
                    setCount: 2,
                    prescriptionSource: "session_accessory_defaults",
                  },
                },
              ],
            },
          },
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          advancesSplit: true,
          mesocyclePhaseSnapshot: "ACCUMULATION",
        },
        sets: [{ logs: [{ actualLoad: 200, actualReps: 8 }] }],
      },
      {
        id: "we-deload",
        workout: {
          completedAt: new Date("2026-02-22T00:00:00.000Z"),
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 5,
                weekInBlock: 1,
                phase: "deload",
                blockType: "deload",
                isDeload: true,
                source: "computed",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: "scheduled",
                reason: ["Scheduled deload week."],
                reductionPercent: 50,
                appliedTo: "volume",
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
              exceptions: [],
            },
          },
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          advancesSplit: true,
          mesocyclePhaseSnapshot: "DELOAD",
        },
        sets: [{ logs: [{ actualLoad: 155, actualReps: 8 }] }],
      },
      {
        id: "we-1",
        workout: {
          completedAt: new Date("2026-02-15T00:00:00.000Z"),
          selectionMetadata: {},
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          advancesSplit: true,
          mesocyclePhaseSnapshot: "ACCUMULATION",
        },
        sets: [{ logs: [{ actualLoad: 190, actualReps: 8 }] }],
      },
      {
        id: "we-2",
        workout: {
          completedAt: new Date("2026-02-08T00:00:00.000Z"),
          selectionMetadata: {},
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          advancesSplit: true,
          mesocyclePhaseSnapshot: "ACCUMULATION",
        },
        sets: [{ logs: [{ actualLoad: 185, actualReps: 8 }] }],
      },
      {
        id: "we-3",
        workout: {
          completedAt: new Date("2026-02-01T00:00:00.000Z"),
          selectionMetadata: {},
          selectionMode: "INTENT",
          sessionIntent: "PUSH",
          advancesSplit: true,
          mesocyclePhaseSnapshot: "ACCUMULATION",
        },
        sets: [{ logs: [{ actualLoad: 180, actualReps: 8 }] }],
      },
    ]);

    const result = await loadExerciseExposure("user-1");

    expect(result.get("Bench Press")).toEqual(
      expect.objectContaining({
        usageCount: 4,
        trend: "improving",
      })
    );
  });
});
