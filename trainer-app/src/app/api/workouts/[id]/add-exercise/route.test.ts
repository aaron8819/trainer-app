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

import { POST } from "./route";

const canonicalReceipt = {
  version: 1 as const,
  cycleContext: {
    weekInMeso: 2,
    weekInBlock: 2,
    phase: "accumulation" as const,
    blockType: "accumulation" as const,
    isDeload: false,
    mesocycleLength: 5,
    source: "computed" as const,
  },
  lifecycleRirTarget: { min: 3, max: 4 },
  lifecycleVolume: { source: "lifecycle" as const },
  sorenessSuppressedMuscles: [],
  deloadDecision: {
    mode: "none" as const,
    reason: [],
    reductionPercent: 0,
    appliedTo: "none" as const,
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
};

function buildWorkoutSelectionMetadata(overrides?: Record<string, unknown>) {
  return {
    sessionDecisionReceipt: canonicalReceipt,
    sessionAuditSnapshot: {
      version: 1,
      generated: {
        selectionMode: "INTENT",
        sessionIntent: "push",
        exerciseCount: 2,
        hardSetCount: 6,
        exercises: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            orderIndex: 0,
            section: "main",
            isMainLift: true,
            prescribedSetCount: 3,
            prescribedSets: [{ setIndex: 1, targetReps: 8, targetRpe: 6.5, restSeconds: 180 }],
          },
          {
            exerciseId: "pressdown",
            exerciseName: "Rope Pressdown",
            orderIndex: 1,
            section: "accessory",
            isMainLift: false,
            prescribedSetCount: 3,
            prescribedSets: [
              {
                setIndex: 1,
                targetReps: 12,
                targetRepRange: { min: 12, max: 15 },
                targetRpe: 6.5,
                restSeconds: 90,
              },
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
    ...(overrides ?? {}),
  };
}

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
      fatigueCost: 2,
      isCompound: false,
      exerciseEquipment: [{ equipment: { type: "CABLE" } }],
    });
    mocks.profileFindUnique.mockResolvedValue({ trainingAge: "INTERMEDIATE" });
    mocks.goalsFindUnique.mockResolvedValue({ primaryGoal: "HYPERTROPHY" });
    mocks.setLogFindFirst.mockResolvedValue({ actualLoad: 35 });
    mocks.txWorkoutFindUnique.mockResolvedValue({
      selectionMetadata: buildWorkoutSelectionMetadata(),
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      exercises: [
        {
          orderIndex: 0,
          section: "MAIN",
          sets: [{ targetReps: 8, targetRepMin: 6, targetRepMax: 10, targetRpe: 6.5, restSeconds: 180 }],
        },
        {
          orderIndex: 1,
          section: "ACCESSORY",
          sets: [
            {
              targetReps: 12,
              targetRepMin: 12,
              targetRepMax: 15,
              targetRpe: 6.5,
              restSeconds: 90,
            },
            {
              targetReps: 12,
              targetRepMin: 12,
              targetRepMax: 15,
              targetRpe: 6.5,
              restSeconds: 90,
            },
          ],
        },
      ],
    });
    mocks.txWorkoutExerciseFindFirst.mockResolvedValue({ orderIndex: 1 });
    mocks.txWorkoutExerciseCreate.mockResolvedValue({
      id: "we-2",
      sets: [
        {
          id: "set-1",
          setIndex: 1,
          targetReps: 12,
          targetRepMin: 12,
          targetRepMax: 14,
          targetLoad: 35,
          targetRpe: 6.5,
          restSeconds: 90,
        },
        {
          id: "set-2",
          setIndex: 2,
          targetReps: 12,
          targetRepMin: 12,
          targetRepMax: 14,
          targetLoad: 35,
          targetRpe: 6.5,
          restSeconds: 90,
        },
      ],
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
            targetRpe: 6.5,
            targetLoad: 185,
            restSeconds: 180,
          },
        ],
      },
      {
        exerciseId: "pressdown",
        orderIndex: 1,
        section: "ACCESSORY",
        exercise: { name: "Rope Pressdown" },
        sets: [
          {
            setIndex: 1,
            targetReps: 12,
            targetRepMin: 12,
            targetRepMax: 15,
            targetRpe: 6.5,
            targetLoad: 50,
            restSeconds: 90,
          },
        ],
      },
      {
        exerciseId: "fly",
        orderIndex: 2,
        section: "ACCESSORY",
        exercise: { name: "Cable Fly" },
        sets: [
          {
            setIndex: 1,
            targetReps: 12,
            targetRepMin: 12,
            targetRepMax: 14,
            targetRpe: 6.5,
            targetLoad: 35,
            restSeconds: 90,
          },
          {
            setIndex: 2,
            targetReps: 12,
            targetRepMin: 12,
            targetRepMax: 15,
            targetRpe: 6.5,
            targetLoad: 35,
            restSeconds: 90,
          },
        ],
      },
    ]);
  });

  it("inherits current session accessory defaults and persists canonical runtime-added provenance", async () => {
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
    expect(mocks.txWorkoutExerciseCreate).toHaveBeenCalledWith({
      data: {
        workoutId: "workout-1",
        exerciseId: "fly",
        orderIndex: 2,
        section: "ACCESSORY",
        isMainLift: false,
        sets: {
          create: [
            {
              setIndex: 1,
              targetReps: 12,
              targetRepMin: 12,
              targetRepMax: 14,
              targetRpe: 6.5,
              restSeconds: 90,
              targetLoad: 35,
            },
            {
              setIndex: 2,
              targetReps: 12,
              targetRepMin: 12,
              targetRepMax: 14,
              targetRpe: 6.5,
              restSeconds: 90,
              targetLoad: 35,
            },
          ],
        },
      },
      include: {
        sets: { orderBy: { setIndex: "asc" } },
      },
    });
    expect(body.exercise).toMatchObject({
      workoutExerciseId: "we-2",
      name: "Cable Fly",
      isRuntimeAdded: true,
      sessionNote: "Added during workout. Session-only; future planning ignores it.",
    });
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith({
      where: { id: "workout-1" },
      data: {
        revision: { increment: 1 },
        selectionMetadata: expect.objectContaining({
          sessionDecisionReceipt: canonicalReceipt,
          runtimeEditReconciliation: expect.objectContaining({
            ops: [
              expect.objectContaining({
                kind: "add_exercise",
                facts: {
                  workoutExerciseId: "we-2",
                  exerciseId: "fly",
                  orderIndex: 2,
                  section: "ACCESSORY",
                  setCount: 2,
                  prescriptionSource: "session_accessory_defaults",
                },
              }),
            ],
          }),
        }),
      },
    });
  });

  it("falls back to receipt lifecycle context when no current accessory pattern exists", async () => {
    mocks.txWorkoutFindUnique.mockResolvedValueOnce({
      selectionMetadata: buildWorkoutSelectionMetadata({
        sessionAuditSnapshot: undefined,
      }),
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      exercises: [],
    });
    mocks.txWorkoutExerciseFindFirst.mockResolvedValueOnce({ orderIndex: 0 });
    mocks.txWorkoutExerciseCreate.mockResolvedValueOnce({
      id: "we-3",
      sets: [
        {
          id: "set-3",
          setIndex: 1,
          targetReps: 12,
          targetRepMin: 10,
          targetRepMax: 14,
          targetLoad: 35,
          targetRpe: 6.5,
          restSeconds: 90,
        },
        {
          id: "set-4",
          setIndex: 2,
          targetReps: 12,
          targetRepMin: 10,
          targetRepMax: 14,
          targetLoad: 35,
          targetRpe: 6.5,
          restSeconds: 90,
        },
      ],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/add-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: "fly" }),
      }),
      { params: Promise.resolve({ id: "workout-1" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.txWorkoutExerciseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sets: {
            create: [
              expect.objectContaining({
                setIndex: 1,
                targetRpe: 6.5,
                targetRepMin: 10,
                targetRepMax: 14,
                restSeconds: 90,
              }),
              expect.objectContaining({
                setIndex: 2,
                targetRpe: 6.5,
                targetRepMin: 10,
                targetRepMax: 14,
                restSeconds: 90,
              }),
            ],
          },
        }),
      })
    );
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          selectionMetadata: expect.objectContaining({
            runtimeEditReconciliation: expect.objectContaining({
              ops: [
                expect.objectContaining({
                  facts: expect.objectContaining({
                    prescriptionSource: "session_accessory_defaults",
                  }),
                }),
              ],
            }),
          }),
        }),
      })
    );
  });

  it("uses generic accessory fallback only when canonical session context is unavailable", async () => {
    mocks.txWorkoutFindUnique.mockResolvedValueOnce({
      selectionMetadata: {},
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      exercises: [],
    });
    mocks.txWorkoutExerciseFindFirst.mockResolvedValueOnce({ orderIndex: 0 });

    await POST(
      new Request("http://localhost/api/workouts/workout-1/add-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: "fly" }),
      }),
      { params: Promise.resolve({ id: "workout-1" }) }
    );

    expect(mocks.txWorkoutExerciseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sets: {
            create: expect.arrayContaining([
              expect.objectContaining({
                targetRpe: 8,
                targetRepMin: 10,
                targetRepMax: 14,
                restSeconds: 90,
              }),
            ]),
          },
        }),
      })
    );
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          selectionMetadata: expect.objectContaining({
            runtimeEditReconciliation: expect.objectContaining({
              ops: [
                expect.objectContaining({
                  facts: expect.objectContaining({
                    prescriptionSource: "generic_accessory_fallback",
                  }),
                }),
              ],
            }),
          }),
        }),
      })
    );
  });

  it("rejects freeform adds for strict gap-fill sessions", async () => {
    mocks.txWorkoutFindUnique.mockResolvedValueOnce({
      selectionMetadata: {
        sessionDecisionReceipt: {
          ...canonicalReceipt,
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
      exercises: [],
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
