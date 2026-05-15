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
      section: "MAIN",
      isMainLift: true,
      workout: {
        id: "workout-1",
        status: "PLANNED",
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

  it.each([
    ["COMPLETED", "This session is completed and is now read-only."],
    ["SKIPPED", "This session was skipped and is now read-only."],
  ] as const)("rejects %s workouts before appending a set", async (status, error) => {
    mocks.txWorkoutExerciseFindFirst.mockResolvedValueOnce({
      id: "we-1",
      exerciseId: "bench",
      workout: {
        id: "workout-1",
        status,
        selectionMetadata: {},
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
        mesocycleId: null,
        mesocycle: null,
      },
      sets: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/exercises/we-1/add-set", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "workout-1", exerciseId: "we-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mocks.txWorkoutSetCreate).not.toHaveBeenCalled();
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
  });

  it("rejects set appends when an open workout belongs to a closed mesocycle", async () => {
    mocks.txWorkoutExerciseFindFirst.mockResolvedValueOnce({
      id: "we-1",
      exerciseId: "bench",
      workout: {
        id: "workout-1",
        status: "PARTIAL",
        selectionMetadata: {},
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
        mesocycleId: "meso-1",
        mesocycle: { state: "COMPLETED", isActive: false },
      },
      sets: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/exercises/we-1/add-set", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "workout-1", exerciseId: "we-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This workout belongs to a completed mesocycle and can no longer be resumed.",
    });
    expect(mocks.txWorkoutSetCreate).not.toHaveBeenCalled();
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
  });

  it.each(["IN_PROGRESS", "PARTIAL"] as const)(
    "preserves add-set behavior for %s workouts",
    async (status) => {
      mocks.txWorkoutExerciseFindFirst.mockResolvedValueOnce({
        id: "we-1",
        exerciseId: "bench",
        section: "MAIN",
        isMainLift: true,
        workout: {
          id: "workout-1",
          status,
          selectionMetadata: {},
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

      const response = await POST(
        new Request("http://localhost/api/workouts/workout-1/exercises/we-1/add-set", {
          method: "POST",
        }),
        { params: Promise.resolve({ id: "workout-1", exerciseId: "we-1" }) }
      );

      expect(response.status).toBe(200);
      expect(mocks.txWorkoutSetCreate).toHaveBeenCalled();
      expect(mocks.txWorkoutUpdate).toHaveBeenCalled();
    }
  );

  it("defaults runtime-added sets on accessory exercises to 120 seconds instead of cloning stale 90-second rest", async () => {
    mocks.txWorkoutExerciseFindFirst.mockResolvedValueOnce({
      id: "we-accessory",
      exerciseId: "lateral-raise",
      section: "ACCESSORY",
      isMainLift: false,
      workout: {
        id: "workout-1",
        status: "IN_PROGRESS",
        selectionMetadata: {},
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
        mesocycleId: null,
        mesocycle: null,
      },
      sets: [
        {
          setIndex: 2,
          targetReps: 12,
          targetRepMin: 10,
          targetRepMax: 15,
          targetRpe: 8,
          targetLoad: 20,
          restSeconds: 90,
        },
      ],
    });
    mocks.txWorkoutSetCreate.mockResolvedValueOnce({
      id: "set-extra",
      setIndex: 3,
      targetReps: 12,
      targetRepMin: 10,
      targetRepMax: 15,
      targetRpe: 8,
      targetLoad: 20,
      restSeconds: 120,
    });
    mocks.txWorkoutExerciseFindMany.mockResolvedValueOnce([
      {
        exerciseId: "lateral-raise",
        orderIndex: 1,
        section: "ACCESSORY",
        exercise: { name: "Cable Lateral Raise" },
        sets: [
          {
            setIndex: 1,
            targetReps: 12,
            targetRepMin: 10,
            targetRepMax: 15,
            targetRpe: 8,
            targetLoad: 20,
            restSeconds: 90,
          },
          {
            setIndex: 2,
            targetReps: 12,
            targetRepMin: 10,
            targetRepMax: 15,
            targetRpe: 8,
            targetLoad: 20,
            restSeconds: 90,
          },
          {
            setIndex: 3,
            targetReps: 12,
            targetRepMin: 10,
            targetRepMax: 15,
            targetRpe: 8,
            targetLoad: 20,
            restSeconds: 120,
          },
        ],
      },
    ]);

    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/exercises/we-accessory/add-set", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "workout-1", exerciseId: "we-accessory" }) }
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.txWorkoutSetCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workoutExerciseId: "we-accessory",
          restSeconds: 120,
        }),
      })
    );
    expect(body.set).toMatchObject({
      setId: "set-extra",
      restSeconds: 120,
      isRuntimeAdded: true,
    });
  });
});
