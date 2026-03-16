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
      status: "PLANNED",
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      selectionMetadata: {
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
          targetMuscles: ["rear delts"],
          exceptions: [
            {
              code: "optional_gap_fill",
              message: "Marked as optional gap-fill session.",
            },
          ],
        },
        sessionAuditSnapshot: {
          version: 1,
          generated: {
            selectionMode: "INTENT",
            sessionIntent: "BODY_PART",
            exerciseCount: 1,
            hardSetCount: 3,
            exercises: [
              {
                exerciseId: "rear-delt-fly",
                exerciseName: "Rear Delt Fly",
                orderIndex: 0,
                section: "accessory",
                isMainLift: false,
                prescribedSetCount: 3,
                prescribedSets: [{ setIndex: 1, targetReps: 15, targetRpe: 8 }],
              },
            ],
            semantics: {
              kind: "gap_fill",
              effectiveSelectionMode: "INTENT",
              isDeload: false,
              isStrictGapFill: true,
              isStrictSupplemental: false,
              advancesLifecycle: false,
              consumesWeeklyScheduleIntent: false,
              countsTowardCompliance: true,
              countsTowardRecentStimulus: true,
              countsTowardWeeklyVolume: true,
              countsTowardProgressionHistory: true,
              countsTowardPerformanceHistory: true,
              updatesProgressionAnchor: true,
              eligibleForUniqueIntentSubtraction: false,
              reasons: [],
              trace: { advancesSplitInput: false },
            },
            traces: {
              progression: {},
            },
          },
        },
      },
    });

    mocks.workoutExerciseFindFirst.mockResolvedValue({
      id: "we-1",
      workoutId: "workout-1",
      exerciseId: "rear-delt-fly",
      section: "ACCESSORY",
      isMainLift: false,
      exercise: {
        id: "rear-delt-fly",
        name: "Rear Delt Fly",
        isMainLiftEligible: false,
        fatigueCost: 2,
        movementPatterns: ["ISOLATION"],
        exerciseEquipment: [{ equipment: { type: "CABLE" } }],
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Rear Delts" } }],
      },
      sets: [
        { id: "set-1", setIndex: 1, logs: [] },
        { id: "set-2", setIndex: 2, logs: [] },
      ],
    });

    mocks.exerciseFindUnique.mockResolvedValue({
      id: "machine-rear-delt-fly",
      name: "Machine Rear Delt Fly",
      repRangeMin: 12,
      repRangeMax: 20,
      movementPatterns: ["ISOLATION"],
      exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
      exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Rear Delts" } }],
    });

    mocks.exerciseFindMany.mockResolvedValue([
      {
        id: "rear-delt-fly",
        name: "Rear Delt Fly",
        isMainLiftEligible: false,
        fatigueCost: 2,
        movementPatterns: ["ISOLATION"],
        exerciseEquipment: [{ equipment: { type: "CABLE" } }],
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Rear Delts" } }],
      },
      {
        id: "machine-rear-delt-fly",
        name: "Machine Rear Delt Fly",
        isMainLiftEligible: false,
        fatigueCost: 2,
        movementPatterns: ["ISOLATION"],
        exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Rear Delts" } }],
      },
      {
        id: "upright-row",
        name: "Upright Row",
        isMainLiftEligible: false,
        fatigueCost: 3,
        movementPatterns: ["VERTICAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Traps" } }],
      },
    ]);

    mocks.setLogFindFirst.mockResolvedValue({ actualLoad: 45 });
    mocks.txWorkoutFindUnique.mockResolvedValue({
      selectionMetadata: {
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
          targetMuscles: ["rear delts"],
          exceptions: [
            {
              code: "optional_gap_fill",
              message: "Marked as optional gap-fill session.",
            },
          ],
        },
        sessionAuditSnapshot: {
          version: 1,
          generated: {
            selectionMode: "INTENT",
            sessionIntent: "BODY_PART",
            exerciseCount: 1,
            hardSetCount: 2,
            exercises: [
              {
                exerciseId: "rear-delt-fly",
                exerciseName: "Rear Delt Fly",
                orderIndex: 0,
                section: "accessory",
                isMainLift: false,
                prescribedSetCount: 2,
                prescribedSets: [{ setIndex: 1, targetReps: 15, targetRpe: 8 }],
              },
            ],
            semantics: {
              kind: "gap_fill",
              effectiveSelectionMode: "INTENT",
              isDeload: false,
              isStrictGapFill: true,
              isStrictSupplemental: false,
              advancesLifecycle: false,
              consumesWeeklyScheduleIntent: false,
              countsTowardCompliance: true,
              countsTowardRecentStimulus: true,
              countsTowardWeeklyVolume: true,
              countsTowardProgressionHistory: true,
              countsTowardPerformanceHistory: true,
              updatesProgressionAnchor: true,
              eligibleForUniqueIntentSubtraction: false,
              reasons: [],
              trace: { advancesSplitInput: false },
            },
            traces: { progression: {} },
          },
        },
      },
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
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
        exerciseId: "machine-rear-delt-fly",
        orderIndex: 0,
        section: "ACCESSORY",
        exercise: { name: "Machine Rear Delt Fly" },
        sets: [
          {
            id: "set-1",
            setIndex: 1,
            targetReps: 16,
            targetRepMin: 12,
            targetRepMax: 20,
            targetRpe: 8,
            targetLoad: 45,
            restSeconds: 90,
          },
          {
            id: "set-2",
            setIndex: 2,
            targetReps: 16,
            targetRepMin: 12,
            targetRepMax: 20,
            targetRpe: 8,
            targetLoad: 45,
            restSeconds: 90,
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
          targetReps: 16,
          targetRepMin: 12,
          targetRepMax: 20,
          targetRpe: 8,
          targetLoad: 45,
        },
        {
          id: "set-2",
          setIndex: 2,
          targetReps: 16,
          targetRepMin: 12,
          targetRepMax: 20,
          targetRpe: 8,
          targetLoad: 45,
        },
      ],
    });
  });

  it("swaps a strict gap-fill accessory, reanchors targets to the replacement, and records canonical swap metadata", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/swap-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutExerciseId: "we-1",
          replacementExerciseId: "machine-rear-delt-fly",
        }),
      }),
      { params: Promise.resolve({ id: "workout-1" }) }
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.exercise.name).toBe("Machine Rear Delt Fly");
    expect(body.exercise.sessionNote).toContain("future progression stays exercise-specific");
    expect(mocks.txWorkoutExerciseUpdate).toHaveBeenCalledWith({
      where: { id: "we-1" },
      data: {
        exerciseId: "machine-rear-delt-fly",
        movementPatterns: ["ISOLATION"],
      },
      include: {
        sets: { orderBy: { setIndex: "asc" } },
      },
    });
    expect(mocks.txWorkoutSetUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.txWorkoutSetUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "set-1" },
      data: {
        targetReps: 16,
        targetRepMin: 12,
        targetRepMax: 20,
        targetLoad: 45,
      },
    });
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "workout-1" },
        data: expect.objectContaining({
          revision: { increment: 1 },
          selectionMetadata: expect.objectContaining({
            gapFillExerciseSwapState: expect.objectContaining({
              swaps: [
                expect.objectContaining({
                  workoutExerciseId: "we-1",
                  originalExerciseId: "rear-delt-fly",
                  swappedExerciseId: "machine-rear-delt-fly",
                  targetMuscleOverlap: ["rear delts"],
                  movementPatternOverlap: ["isolation"],
                  fatigueDelta: 0,
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
