import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutExerciseFindFirst = vi.fn();
  const exerciseFindMany = vi.fn();
  const setLogFindFirst = vi.fn();
  const txWorkoutFindUnique = vi.fn();
  const txWorkoutUpdate = vi.fn();
  const txWorkoutExerciseUpdate = vi.fn();
  const txWorkoutExerciseFindMany = vi.fn();
  const txWorkoutSetUpdate = vi.fn();

  const tx = {
    workout: {
      findUnique: txWorkoutFindUnique,
      update: txWorkoutUpdate,
    },
    workoutExercise: {
      update: txWorkoutExerciseUpdate,
      findMany: txWorkoutExerciseFindMany,
    },
    workoutSet: {
      update: txWorkoutSetUpdate,
    },
  };

  const prisma = {
    workout: {
      findFirst: workoutFindFirst,
    },
    workoutExercise: {
      findFirst: workoutExerciseFindFirst,
    },
    exercise: {
      findMany: exerciseFindMany,
    },
    setLog: {
      findFirst: setLogFindFirst,
    },
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    prisma,
    workoutFindFirst,
    workoutExerciseFindFirst,
    exerciseFindMany,
    setLogFindFirst,
    txWorkoutFindUnique,
    txWorkoutUpdate,
    txWorkoutExerciseUpdate,
    txWorkoutExerciseFindMany,
    txWorkoutSetUpdate,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  applyRuntimeExerciseSwap,
  resolveRuntimeExerciseSwapPreview,
} from "./runtime-exercise-swap-service";

describe("runtime exercise swap service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      status: "IN_PROGRESS",
      selectionMode: "INTENT",
      sessionIntent: "PULL",
      selectionMetadata: {
        sessionAuditSnapshot: {
          version: 1,
          generated: {
            selectionMode: "INTENT",
            sessionIntent: "PULL",
            exerciseCount: 1,
            hardSetCount: 2,
            exercises: [
              {
                exerciseId: "t-bar-row",
                exerciseName: "T-Bar Row",
                orderIndex: 0,
                section: "main",
                isMainLift: false,
                prescribedSetCount: 2,
                prescribedSets: [{ setIndex: 1, targetReps: 10, targetRpe: 8 }],
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
              trace: { advancesSplitInput: true },
            },
            traces: { progression: {} },
          },
        },
      },
    });

    mocks.workoutExerciseFindFirst.mockResolvedValue({
      id: "we-1",
      workoutId: "workout-1",
      exerciseId: "t-bar-row",
      section: "MAIN",
      isMainLift: false,
      exercise: {
        id: "t-bar-row",
        name: "T-Bar Row",
        fatigueCost: 3,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
      sets: [
        {
          id: "set-1",
          setIndex: 1,
          targetRpe: 8,
          restSeconds: 120,
          logs: [],
        },
        {
          id: "set-2",
          setIndex: 2,
          targetRpe: 8,
          restSeconds: 120,
          logs: [],
        },
      ],
    });

    mocks.exerciseFindMany.mockResolvedValue([
      {
        id: "t-bar-row",
        name: "T-Bar Row",
        fatigueCost: 3,
        repRangeMin: 8,
        repRangeMax: 12,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
      {
        id: "chest-supported-db-row",
        name: "Chest-Supported Dumbbell Row",
        fatigueCost: 2,
        repRangeMin: 8,
        repRangeMax: 12,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "DUMBBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
      {
        id: "lat-pulldown",
        name: "Lat Pulldown",
        fatigueCost: 2,
        repRangeMin: 8,
        repRangeMax: 12,
        movementPatterns: ["VERTICAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "CABLE" } }],
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Lats" } }],
      },
    ]);

    mocks.setLogFindFirst.mockResolvedValue({ actualLoad: 27.5 });
    mocks.txWorkoutFindUnique.mockResolvedValue({
      selectionMetadata: {
        sessionAuditSnapshot: {
          version: 1,
          generated: {
            selectionMode: "INTENT",
            sessionIntent: "PULL",
            exerciseCount: 1,
            hardSetCount: 2,
            exercises: [
              {
                exerciseId: "t-bar-row",
                exerciseName: "T-Bar Row",
                orderIndex: 0,
                section: "main",
                isMainLift: false,
                prescribedSetCount: 2,
                prescribedSets: [{ setIndex: 1, targetReps: 10, targetRpe: 8 }],
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
              trace: { advancesSplitInput: true },
            },
            traces: { progression: {} },
          },
        },
      },
      selectionMode: "INTENT",
      sessionIntent: "PULL",
    });
    mocks.txWorkoutExerciseFindMany.mockResolvedValue([
      {
        exerciseId: "chest-supported-db-row",
        orderIndex: 0,
        section: "MAIN",
        exercise: { name: "Chest-Supported Dumbbell Row" },
        sets: [
          {
            setIndex: 1,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 27.5,
            restSeconds: 120,
          },
          {
            setIndex: 2,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 27.5,
            restSeconds: 120,
          },
        ],
      },
    ]);
  });

  it("derives preview and mutation from the same exact server-owned prescription", async () => {
    const input = {
      workoutId: "workout-1",
      workoutExerciseId: "we-1",
      replacementExerciseId: "chest-supported-db-row",
      userId: "user-1",
    };

    const preview = await resolveRuntimeExerciseSwapPreview(input);
    const applied = await applyRuntimeExerciseSwap(input);

    expect(preview).toEqual(applied);
    expect(preview).toMatchObject({
      workoutExerciseId: "we-1",
      exerciseId: "chest-supported-db-row",
      name: "Chest-Supported Dumbbell Row",
      isSwapped: true,
      isMainLift: false,
      section: "MAIN",
      sessionNote: "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
      sets: [
        {
          setId: "set-1",
          setIndex: 1,
          targetReps: 10,
          targetRepRange: { min: 8, max: 12 },
          targetLoad: 27.5,
          targetRpe: 8,
          restSeconds: 120,
        },
        {
          setId: "set-2",
          setIndex: 2,
          targetReps: 10,
          targetRepRange: { min: 8, max: 12 },
          targetLoad: 27.5,
          targetRpe: 8,
          restSeconds: 120,
        },
      ],
    });
    expect(mocks.txWorkoutExerciseUpdate).toHaveBeenCalledWith({
      where: { id: "we-1" },
      data: {
        exerciseId: "chest-supported-db-row",
        movementPatterns: ["HORIZONTAL_PULL"],
      },
    });
    expect(mocks.txWorkoutSetUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.txWorkoutSetUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "set-1" },
      data: {
        targetReps: 10,
        targetRepMin: 8,
        targetRepMax: 12,
        targetLoad: 27.5,
      },
    });
    expect(mocks.txWorkoutSetUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: "set-2" },
      data: {
        targetReps: 10,
        targetRepMin: 8,
        targetRepMax: 12,
        targetLoad: 27.5,
      },
    });
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "workout-1" },
        data: expect.objectContaining({
          revision: { increment: 1 },
          selectionMetadata: expect.objectContaining({
            runtimeEditReconciliation: expect.objectContaining({
              version: 1,
              directives: {
                continuityAlias: "none",
                progressionAlias: "none",
                futureSessionGeneration: "ignore",
                futureSeedCarryForward: "ignore",
              },
              ops: [
                expect.objectContaining({
                  kind: "replace_exercise",
                  source: "api_workouts_swap_exercise",
                  scope: "current_workout_only",
                  facts: {
                    workoutExerciseId: "we-1",
                    fromExerciseId: "t-bar-row",
                    fromExerciseName: "T-Bar Row",
                    toExerciseId: "chest-supported-db-row",
                    toExerciseName: "Chest-Supported Dumbbell Row",
                    reason: "equipment_availability_equivalent_pull_swap",
                    setCount: 2,
                  },
                }),
              ],
            }),
            workoutStructureState: expect.objectContaining({
              reconciliation: expect.objectContaining({
                hasDrift: true,
                changedFields: expect.arrayContaining(["exercise_added", "exercise_removed"]),
              }),
            }),
          }),
        }),
      })
    );
  });
});
