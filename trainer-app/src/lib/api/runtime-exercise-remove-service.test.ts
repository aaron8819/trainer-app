import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const txWorkoutExerciseFindFirst = vi.fn();
  const txWorkoutSetDeleteMany = vi.fn();
  const txWorkoutExerciseDelete = vi.fn();
  const txWorkoutExerciseFindMany = vi.fn();
  const txWorkoutUpdate = vi.fn();

  const tx = {
    workoutExercise: {
      findFirst: txWorkoutExerciseFindFirst,
      delete: txWorkoutExerciseDelete,
      findMany: txWorkoutExerciseFindMany,
    },
    workoutSet: {
      deleteMany: txWorkoutSetDeleteMany,
    },
    workout: {
      update: txWorkoutUpdate,
    },
  };

  const prisma = {
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    prisma,
    txWorkoutExerciseFindFirst,
    txWorkoutSetDeleteMany,
    txWorkoutExerciseDelete,
    txWorkoutExerciseFindMany,
    txWorkoutUpdate,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { removeRuntimeAddedWorkoutExercise } from "./runtime-exercise-remove-service";

const runtimeEditDirectives = {
  continuityAlias: "none" as const,
  progressionAlias: "none" as const,
  futureSessionGeneration: "ignore" as const,
  futureSeedCarryForward: "ignore" as const,
};

const generatedSelectionMetadata = {
  sessionAuditSnapshot: {
    version: 1,
    generated: {
      selectionMode: "INTENT",
      sessionIntent: "push",
      exerciseCount: 1,
      hardSetCount: 3,
      exercises: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          orderIndex: 0,
          section: "main",
          isMainLift: true,
          prescribedSetCount: 3,
          prescribedSets: [{ setIndex: 1, targetReps: 8, targetRpe: 8 }],
        },
      ],
      semantics: {
        kind: "advancing",
        effectiveSelectionMode: "INTENT",
        isDeload: false,
        isStrictGapFill: false,
        isStrictSupplemental: false,
        advancesLifecycle: true,
        consumesWeeklyScheduleIntent: true,
        countsTowardCompliance: true,
        countsTowardRecentStimulus: true,
        countsTowardWeeklyVolume: true,
        countsTowardProgressionHistory: true,
        countsTowardPerformanceHistory: true,
        updatesProgressionAnchor: true,
        eligibleForUniqueIntentSubtraction: true,
        reasons: [],
        trace: {
          advancesSplitInput: true,
        },
      },
      traces: {
        progression: {},
      },
    },
  },
  runtimeEditReconciliation: {
    version: 1 as const,
    lastReconciledAt: "2026-03-23T10:00:00.000Z",
    directives: runtimeEditDirectives,
    ops: [
      {
        kind: "add_exercise" as const,
        source: "api_workouts_add_exercise" as const,
        appliedAt: "2026-03-23T10:00:00.000Z",
        scope: "current_workout_only" as const,
        facts: {
          workoutExerciseId: "we-added",
          exerciseId: "fly",
          orderIndex: 1,
          section: "ACCESSORY" as const,
          setCount: 2,
          prescriptionSource: "session_accessory_defaults" as const,
        },
      },
    ],
  },
};

function buildWorkoutExercise(overrides: Record<string, unknown> = {}) {
  return {
    id: "we-added",
    exerciseId: "fly",
    orderIndex: 1,
    section: "ACCESSORY",
    workout: {
      id: "workout-1",
      status: "IN_PROGRESS",
      selectionMetadata: generatedSelectionMetadata,
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      mesocycleId: "meso-1",
      mesocycle: {
        state: "ACTIVE_ACCUMULATION",
        isActive: true,
      },
    },
    sets: [
      { id: "set-added-1", logs: [] },
      { id: "set-added-2", logs: [] },
    ],
    ...overrides,
  };
}

describe("removeRuntimeAddedWorkoutExercise", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.txWorkoutExerciseFindFirst.mockResolvedValue(buildWorkoutExercise());
    mocks.txWorkoutSetDeleteMany.mockResolvedValue({ count: 2 });
    mocks.txWorkoutExerciseDelete.mockResolvedValue({ id: "we-added" });
    mocks.txWorkoutExerciseFindMany.mockResolvedValue([
      {
        exerciseId: "bench",
        orderIndex: 0,
        section: "MAIN",
        exercise: { name: "Bench Press" },
        sets: [{ setIndex: 1, targetReps: 8, targetRepMin: 6, targetRepMax: 10 }],
      },
    ]);
    mocks.txWorkoutUpdate.mockResolvedValue({});
  });

  it("removes an unlogged runtime-added exercise and appends remove provenance", async () => {
    await expect(
      removeRuntimeAddedWorkoutExercise({
        workoutId: "workout-1",
        workoutExerciseId: "we-added",
        userId: "user-1",
      })
    ).resolves.toEqual({ removedWorkoutExerciseId: "we-added" });

    expect(mocks.txWorkoutExerciseFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "we-added",
          workoutId: "workout-1",
          workout: { userId: "user-1" },
        },
      })
    );
    expect(mocks.txWorkoutSetDeleteMany).toHaveBeenCalledWith({
      where: { workoutExerciseId: "we-added" },
    });
    expect(mocks.txWorkoutExerciseDelete).toHaveBeenCalledWith({
      where: { id: "we-added" },
    });
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith({
      where: { id: "workout-1" },
      data: {
        revision: { increment: 1 },
        selectionMetadata: expect.objectContaining({
          runtimeEditReconciliation: expect.objectContaining({
            ops: [
              expect.objectContaining({ kind: "add_exercise" }),
              expect.objectContaining({
                kind: "remove_exercise",
                source: "api_workouts_remove_exercise",
                facts: {
                  workoutExerciseId: "we-added",
                  exerciseId: "fly",
                  orderIndex: 1,
                  section: "ACCESSORY",
                  setCount: 2,
                },
              }),
            ],
          }),
          workoutStructureState: expect.objectContaining({
            currentExercises: [
              {
                exerciseId: "bench",
                orderIndex: 0,
                section: "MAIN",
                setCount: 1,
              },
            ],
          }),
        }),
      },
    });
  });

  it("allows the same runtime-added removal for closeout workouts", async () => {
    mocks.txWorkoutExerciseFindFirst.mockResolvedValueOnce(
      buildWorkoutExercise({
        workout: {
          id: "workout-1",
          status: "PLANNED",
          selectionMetadata: {
            ...generatedSelectionMetadata,
            weekCloseId: "week-close-1",
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 4,
                phase: "accumulation",
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
              exceptions: [{ code: "closeout_session", message: "Marked as closeout session." }],
            },
          },
          selectionMode: "MANUAL",
          sessionIntent: null,
          mesocycleId: "meso-1",
          mesocycle: {
            state: "ACTIVE_ACCUMULATION",
            isActive: true,
          },
        },
      })
    );

    await expect(
      removeRuntimeAddedWorkoutExercise({
        workoutId: "workout-1",
        workoutExerciseId: "we-added",
        userId: "user-1",
      })
    ).resolves.toEqual({ removedWorkoutExerciseId: "we-added" });
  });

  it("rejects canonical planned exercises", async () => {
    mocks.txWorkoutExerciseFindFirst.mockResolvedValueOnce(
      buildWorkoutExercise({
        id: "we-planned",
        workout: {
          ...buildWorkoutExercise().workout,
          selectionMetadata: {
            sessionAuditSnapshot: generatedSelectionMetadata.sessionAuditSnapshot,
          },
        },
      })
    );

    await expect(
      removeRuntimeAddedWorkoutExercise({
        workoutId: "workout-1",
        workoutExerciseId: "we-planned",
        userId: "user-1",
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "NOT_RUNTIME_ADDED",
    });
    expect(mocks.txWorkoutSetDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects runtime-added exercises once any set has been logged", async () => {
    mocks.txWorkoutExerciseFindFirst.mockResolvedValueOnce(
      buildWorkoutExercise({
        sets: [
          { id: "set-added-1", logs: [{ id: "log-1" }] },
          { id: "set-added-2", logs: [] },
        ],
      })
    );

    await expect(
      removeRuntimeAddedWorkoutExercise({
        workoutId: "workout-1",
        workoutExerciseId: "we-added",
        userId: "user-1",
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "LOGGED_EXERCISE_BLOCKED",
    });
    expect(mocks.txWorkoutSetDeleteMany).not.toHaveBeenCalled();
  });
});
