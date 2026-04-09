import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const profileFindUnique = vi.fn();
  const goalsFindUnique = vi.fn();
  const exerciseFindMany = vi.fn();
  const setLogFindMany = vi.fn();

  return {
    prisma: {
      workout: { findFirst: workoutFindFirst },
      profile: { findUnique: profileFindUnique },
      goals: { findUnique: goalsFindUnique },
      exercise: { findMany: exerciseFindMany },
      setLog: { findMany: setLogFindMany },
    },
    workoutFindFirst,
    profileFindUnique,
    goalsFindUnique,
    exerciseFindMany,
    setLogFindMany,
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

describe("POST /api/workouts/[id]/add-exercise-preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.workoutFindFirst.mockResolvedValue({
      selectionMetadata: buildWorkoutSelectionMetadata(),
      exercises: [
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
    mocks.profileFindUnique.mockResolvedValue({ trainingAge: "INTERMEDIATE" });
    mocks.goalsFindUnique.mockResolvedValue({ primaryGoal: "HYPERTROPHY" });
    mocks.exerciseFindMany.mockResolvedValue([
      {
        id: "fly",
        name: "Cable Fly",
        repRangeMin: 10,
        repRangeMax: 14,
        fatigueCost: 2,
        isCompound: false,
        exerciseEquipment: [{ equipment: { type: "CABLE" } }],
      },
    ]);
    mocks.setLogFindMany.mockResolvedValue([
      {
        actualLoad: 35,
        workoutSet: {
          workoutExercise: {
            exerciseId: "fly",
          },
        },
      },
    ]);
  });

  it("returns the canonical preview payload used by runtime-added accessory defaults", async () => {
    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/add-exercise-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseIds: ["fly"] }),
      }),
      { params: Promise.resolve({ id: "workout-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      previews: [
        {
          exerciseId: "fly",
          exerciseName: "Cable Fly",
          equipment: ["CABLE"],
          section: "ACCESSORY",
          isMainLift: false,
          setCount: 2,
          targetReps: 12,
          targetRepRange: { min: 12, max: 14 },
          targetLoad: 35,
          targetRpe: 6.5,
          restSeconds: 90,
          prescriptionSource: "session_accessory_defaults",
        },
      ],
    });
  });

  it("returns 404 when the workout is missing", async () => {
    mocks.workoutFindFirst.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/add-exercise-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseIds: ["fly"] }),
      }),
      { params: Promise.resolve({ id: "workout-1" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Workout not found" });
  });
});
