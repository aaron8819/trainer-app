import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutExerciseFindFirst = vi.fn();
  const exerciseFindUnique = vi.fn();
  const exerciseFindMany = vi.fn();
  const setLogFindFirst = vi.fn();
  const txWorkoutFindUnique = vi.fn();
  const txWorkoutUpdate = vi.fn();
  const txWorkoutExerciseUpdate = vi.fn();
  const txWorkoutExerciseFindMany = vi.fn();
  const txWorkoutExerciseFindUnique = vi.fn();
  const txWorkoutSetUpdate = vi.fn();

  const tx = {
    workout: {
      findUnique: txWorkoutFindUnique,
      update: txWorkoutUpdate,
    },
    workoutExercise: {
      update: txWorkoutExerciseUpdate,
      findMany: txWorkoutExerciseFindMany,
      findUnique: txWorkoutExerciseFindUnique,
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
      findUnique: exerciseFindUnique,
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
    exerciseFindUnique,
    exerciseFindMany,
    setLogFindFirst,
    txWorkoutFindUnique,
    txWorkoutUpdate,
    txWorkoutExerciseUpdate,
    txWorkoutExerciseFindMany,
    txWorkoutExerciseFindUnique,
    txWorkoutSetUpdate,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: vi.fn(async () => ({ id: "user-1" })),
}));

import { POST } from "./route";

describe("POST /api/workouts/[id]/swap-exercise", () => {
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
            hardSetCount: 3,
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
        { id: "set-1", setIndex: 1, logs: [] },
        { id: "set-2", setIndex: 2, logs: [] },
      ],
    });

    mocks.exerciseFindUnique.mockResolvedValue({
      id: "chest-supported-db-row",
      name: "Chest-Supported Dumbbell Row",
      repRangeMin: 8,
      repRangeMax: 12,
      movementPatterns: ["HORIZONTAL_PULL"],
      exerciseEquipment: [{ equipment: { type: "DUMBBELL" } }],
      exerciseMuscles: [
        { role: "PRIMARY", muscle: { name: "Lats" } },
        { role: "PRIMARY", muscle: { name: "Upper Back" } },
      ],
    });

    mocks.exerciseFindMany.mockResolvedValue([
      {
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
      {
        id: "chest-supported-db-row",
        name: "Chest-Supported Dumbbell Row",
        fatigueCost: 2,
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
    mocks.txWorkoutExerciseUpdate.mockResolvedValue({
      id: "we-1",
      sets: [
        { id: "set-1", setIndex: 1 },
        { id: "set-2", setIndex: 2 },
      ],
    });
    mocks.txWorkoutExerciseFindMany.mockResolvedValue([
      {
        id: "we-1",
        exerciseId: "chest-supported-db-row",
        orderIndex: 0,
        section: "MAIN",
        exercise: { name: "Chest-Supported Dumbbell Row" },
        sets: [
          {
            id: "set-1",
            setIndex: 1,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 27.5,
            restSeconds: 120,
          },
          {
            id: "set-2",
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
    mocks.txWorkoutExerciseFindUnique.mockResolvedValue({
      id: "we-1",
      sets: [
        {
          id: "set-1",
          setIndex: 1,
          targetReps: 10,
          targetRepMin: 8,
          targetRepMax: 12,
          targetRpe: 8,
          targetLoad: 27.5,
        },
        {
          id: "set-2",
          setIndex: 2,
          targetReps: 10,
          targetRepMin: 8,
          targetRepMax: 12,
          targetRpe: 8,
          targetLoad: 27.5,
        },
      ],
    });
  });

  it("replaces a planned pull exercise in place, keeps completion on the same slot row, and records canonical replacement metadata", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/swap-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutExerciseId: "we-1",
          replacementExerciseId: "chest-supported-db-row",
        }),
      }),
      { params: Promise.resolve({ id: "workout-1" }) }
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.exercise).toMatchObject({
      workoutExerciseId: "we-1",
      name: "Chest-Supported Dumbbell Row",
      isSwapped: true,
      isMainLift: false,
      section: "MAIN",
      sessionNote: "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
    });
    expect(mocks.txWorkoutExerciseUpdate).toHaveBeenCalledWith({
      where: { id: "we-1" },
      data: {
        exerciseId: "chest-supported-db-row",
        movementPatterns: ["HORIZONTAL_PULL"],
      },
      include: {
        sets: { orderBy: { setIndex: "asc" } },
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
                changedFields: expect.arrayContaining([
                  "exercise_added",
                  "exercise_removed",
                ]),
              }),
            }),
          }),
        }),
      })
    );
  });
});
