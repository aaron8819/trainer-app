import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const exerciseFindUnique = vi.fn();
  const profileFindUnique = vi.fn();
  const goalsFindUnique = vi.fn();
  const setLogFindFirst = vi.fn();
  const txWorkoutFindUnique = vi.fn();
  const txWorkoutUpdate = vi.fn();
  const txWorkoutExerciseFindFirst = vi.fn();
  const txWorkoutExerciseCreate = vi.fn();
  const txWorkoutExerciseFindMany = vi.fn();

  const tx = {
    workout: {
      findUnique: txWorkoutFindUnique,
      update: txWorkoutUpdate,
    },
    workoutExercise: {
      findFirst: txWorkoutExerciseFindFirst,
      create: txWorkoutExerciseCreate,
      findMany: txWorkoutExerciseFindMany,
    },
  };

  const prisma = {
    workout: {
      findFirst: workoutFindFirst,
    },
    exercise: {
      findUnique: exerciseFindUnique,
    },
    profile: {
      findUnique: profileFindUnique,
    },
    goals: {
      findUnique: goalsFindUnique,
    },
    setLog: {
      findFirst: setLogFindFirst,
    },
    $transaction: vi.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    prisma,
    workoutFindFirst,
    exerciseFindUnique,
    profileFindUnique,
    goalsFindUnique,
    setLogFindFirst,
    txWorkoutFindUnique,
    txWorkoutUpdate,
    txWorkoutExerciseFindFirst,
    txWorkoutExerciseCreate,
    txWorkoutExerciseFindMany,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/engine/rules", () => ({
  getBaseTargetRpe: vi.fn(() => 8),
}));

import { POST } from "./route";

describe("POST /api/workouts/[id]/add-exercise", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
    });
    mocks.exerciseFindUnique.mockResolvedValue({
      id: "fly",
      name: "Cable Fly",
      repRangeMin: 10,
      repRangeMax: 14,
      exerciseEquipment: [{ equipment: { type: "CABLE" } }],
    });
    mocks.profileFindUnique.mockResolvedValue({ trainingAge: "INTERMEDIATE" });
    mocks.goalsFindUnique.mockResolvedValue({ primaryGoal: "HYPERTROPHY" });
    mocks.setLogFindFirst.mockResolvedValue({ actualLoad: 35 });
    mocks.txWorkoutFindUnique.mockResolvedValue({
      selectionMetadata: {
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
      },
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
    });
    mocks.txWorkoutExerciseFindFirst.mockResolvedValue({ orderIndex: 0 });
    mocks.txWorkoutExerciseCreate.mockResolvedValue({
      id: "we-2",
      sets: [
        {
          id: "set-1",
          setIndex: 1,
          targetReps: 12,
          targetRepMin: 10,
          targetRepMax: 14,
          targetLoad: 35,
          targetRpe: 8,
        },
      ],
    });
    mocks.txWorkoutExerciseFindMany.mockResolvedValue([
      {
        exerciseId: "bench",
        orderIndex: 0,
        section: "MAIN",
        exercise: { name: "Bench Press" },
        sets: [{ setIndex: 1, targetReps: 8, targetRepMin: 6, targetRepMax: 10, targetRpe: 8, targetLoad: 185 }],
      },
      {
        exerciseId: "fly",
        orderIndex: 1,
        section: "ACCESSORY",
        exercise: { name: "Cable Fly" },
        sets: [{ setIndex: 1, targetReps: 12, targetRepMin: 10, targetRepMax: 14, targetRpe: 8, targetLoad: 35 }],
      },
    ]);
  });

  it("reconciles selection metadata against the saved structure when a bonus exercise is added", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/add-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: "fly" }),
      }),
      { params: Promise.resolve({ id: "workout-1" }) }
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.exercise.name).toBe("Cable Fly");
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith({
      where: { id: "workout-1" },
      data: {
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
                kind: "add_exercise",
                source: "api_workouts_add_exercise",
                scope: "current_workout_only",
                facts: {
                  exerciseId: "fly",
                  orderIndex: 1,
                  section: "ACCESSORY",
                  setCount: 1,
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
              {
                exerciseId: "fly",
                orderIndex: 1,
                section: "ACCESSORY",
                setCount: 1,
              },
            ],
            reconciliation: expect.objectContaining({
              hasDrift: true,
              changedFields: expect.arrayContaining(["exercise_added"]),
              addedExerciseIds: ["fly"],
            }),
          }),
        }),
      },
    });
  });

  it("rejects freeform adds for strict gap-fill sessions", async () => {
    mocks.txWorkoutFindUnique.mockResolvedValueOnce({
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
      },
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/add-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: "fly" }),
      }),
      { params: Promise.resolve({ id: "workout-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Strict gap-fill sessions only allow constrained swaps, not freeform exercise adds.",
    });
    expect(mocks.txWorkoutExerciseCreate).not.toHaveBeenCalled();
  });
});
