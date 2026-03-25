import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutExerciseFindFirst = vi.fn();
  const txWorkoutExerciseFindFirst = vi.fn();
  const txWorkoutSetCreate = vi.fn();
  const txWorkoutUpdate = vi.fn();
  const txWorkoutExerciseFindMany = vi.fn();

  const tx = {
    workoutExercise: {
      findFirst: txWorkoutExerciseFindFirst,
      findMany: txWorkoutExerciseFindMany,
    },
    workoutSet: {
      create: txWorkoutSetCreate,
    },
    workout: {
      update: txWorkoutUpdate,
    },
  };

  const prisma = {
    workoutExercise: {
      findFirst: workoutExerciseFindFirst,
    },
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    prisma,
    workoutExerciseFindFirst,
    txWorkoutExerciseFindFirst,
    txWorkoutSetCreate,
    txWorkoutUpdate,
    txWorkoutExerciseFindMany,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: vi.fn(async () => ({ id: "user-1" })),
}));

import { POST } from "./route";

describe("POST /api/workouts/[id]/exercises/[exerciseId]/add-set", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.workoutExerciseFindFirst.mockResolvedValue({
      id: "we-1",
    });
    mocks.txWorkoutExerciseFindFirst.mockResolvedValue({
      id: "we-1",
      exerciseId: "bench",
      workout: {
        id: "workout-1",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 3,
              weekInBlock: 3,
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
            exceptions: [],
          },
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
                  prescribedSets: [
                    { setIndex: 1, targetReps: 8, targetRpe: 8 },
                    { setIndex: 2, targetReps: 8, targetRpe: 8 },
                    { setIndex: 3, targetReps: 8, targetRpe: 8 },
                  ],
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
        },
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
        mesocycleId: null,
        mesocycle: null,
      },
      sets: [
        {
          setIndex: 3,
          targetReps: 8,
          targetRepMin: 6,
          targetRepMax: 10,
          targetRpe: 8,
          targetLoad: 185,
          restSeconds: 180,
        },
      ],
    });
    mocks.txWorkoutSetCreate.mockResolvedValue({
      id: "set-4",
      setIndex: 4,
      targetReps: 8,
      targetRepMin: 6,
      targetRepMax: 10,
      targetRpe: 8,
      targetLoad: 185,
      restSeconds: 180,
    });
    mocks.txWorkoutExerciseFindMany.mockResolvedValue([
      {
        exerciseId: "bench",
        orderIndex: 0,
        section: "MAIN",
        exercise: { name: "Bench Press" },
        sets: [
          {
            setIndex: 1,
            targetReps: 8,
            targetRepMin: 6,
            targetRepMax: 10,
            targetRpe: 8,
            targetLoad: 185,
            restSeconds: 180,
          },
          {
            setIndex: 2,
            targetReps: 8,
            targetRepMin: 6,
            targetRepMax: 10,
            targetRpe: 8,
            targetLoad: 185,
            restSeconds: 180,
          },
          {
            setIndex: 3,
            targetReps: 8,
            targetRepMin: 6,
            targetRepMax: 10,
            targetRpe: 8,
            targetLoad: 185,
            restSeconds: 180,
          },
          {
            setIndex: 4,
            targetReps: 8,
            targetRepMin: 6,
            targetRepMax: 10,
            targetRpe: 8,
            targetLoad: 185,
            restSeconds: 180,
          },
        ],
      },
    ]);
  });

  it("appends a real workout set, updates revision, and records add_set provenance without rewriting the receipt", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/exercises/we-1/add-set", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "workout-1", exerciseId: "we-1" }) }
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.txWorkoutSetCreate).toHaveBeenCalledWith({
      data: {
        workoutExerciseId: "we-1",
        setIndex: 4,
        targetReps: 8,
        targetRepMin: 6,
        targetRepMax: 10,
        targetRpe: 8,
        targetLoad: 185,
        restSeconds: 180,
      },
      select: {
        id: true,
        setIndex: true,
        targetReps: true,
        targetRepMin: true,
        targetRepMax: true,
        targetRpe: true,
        targetLoad: true,
        restSeconds: true,
      },
    });
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith({
      where: { id: "workout-1" },
      data: {
        revision: { increment: 1 },
        selectionMetadata: expect.objectContaining({
          sessionDecisionReceipt: expect.objectContaining({
            version: 1,
            cycleContext: expect.objectContaining({
              weekInMeso: 3,
            }),
          }),
          runtimeEditReconciliation: expect.objectContaining({
            ops: [
              expect.objectContaining({
                kind: "add_set",
                source: "api_workouts_add_set",
                scope: "current_workout_only",
                facts: {
                  workoutExerciseId: "we-1",
                  exerciseId: "bench",
                  workoutSetId: "set-4",
                  setIndex: 4,
                  clonedFromSetIndex: 3,
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
                setCount: 4,
              },
            ],
            reconciliation: expect.objectContaining({
              hasDrift: true,
              changedFields: expect.arrayContaining([
                "exercise_set_count_changed",
                "exercise_prescription_changed",
              ]),
              exercisesWithSetCountChanges: ["bench"],
            }),
          }),
        }),
      },
    });
    expect(body).toEqual({
      set: {
        setId: "set-4",
        setIndex: 4,
        targetReps: 8,
        targetRepRange: { min: 6, max: 10 },
        targetLoad: 185,
        targetRpe: 8,
        restSeconds: 180,
        isRuntimeAdded: true,
      },
    });
  });
});
