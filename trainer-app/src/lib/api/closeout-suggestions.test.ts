import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const profileFindUnique = vi.fn();
  const goalsFindUnique = vi.fn();
  const exerciseExposureFindMany = vi.fn();
  const exerciseFindMany = vi.fn();
  const loadProjectedWeekVolumeReport = vi.fn();
  const loadMesocycleWeekMuscleVolume = vi.fn();
  const buildRuntimeAddedExercisePreview = vi.fn();

  return {
    workoutFindFirst,
    profileFindUnique,
    goalsFindUnique,
    exerciseExposureFindMany,
    exerciseFindMany,
    loadProjectedWeekVolumeReport,
    loadMesocycleWeekMuscleVolume,
    buildRuntimeAddedExercisePreview,
    prisma: {
      workout: {
        findFirst: workoutFindFirst,
      },
      profile: {
        findUnique: profileFindUnique,
      },
      goals: {
        findUnique: goalsFindUnique,
      },
      exerciseExposure: {
        findMany: exerciseExposureFindMany,
      },
      exercise: {
        findMany: exerciseFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("./projected-week-volume", () => ({
  loadProjectedWeekVolumeReport: (...args: unknown[]) =>
    mocks.loadProjectedWeekVolumeReport(...args),
}));

vi.mock("./weekly-volume", () => ({
  loadMesocycleWeekMuscleVolume: (...args: unknown[]) =>
    mocks.loadMesocycleWeekMuscleVolume(...args),
}));

vi.mock("./runtime-added-exercise-preview", () => ({
  buildRuntimeAddedExercisePreview: (...args: unknown[]) =>
    mocks.buildRuntimeAddedExercisePreview(...args),
}));

import { getCloseoutSuggestions } from "./closeout-suggestions";

function buildWorkout(overrides?: {
  exercises?: Array<{
    id: string;
    orderIndex: number;
    exerciseId: string;
    name: string;
    primaryMuscles: string[];
    setCount: number;
  }>;
}) {
  return {
    id: "workout-closeout",
    selectionMetadata: {
      sessionDecisionReceipt: {
        exceptions: [{ code: "closeout_session", message: "Marked as closeout session." }],
      },
    },
    mesocycleId: "meso-1",
    mesocycleWeekSnapshot: 1,
    exercises: (overrides?.exercises ?? []).map((exercise) => ({
      id: exercise.id,
      orderIndex: exercise.orderIndex,
      section: "ACCESSORY",
      exerciseId: exercise.exerciseId,
      exercise: {
        id: exercise.exerciseId,
        name: exercise.name,
        exerciseMuscles: exercise.primaryMuscles.map((muscle) => ({
          role: "PRIMARY",
          muscle: { name: muscle },
        })),
      },
      sets: Array.from({ length: exercise.setCount }, () => ({
        targetReps: 12,
        targetRepMin: 10,
        targetRepMax: 14,
        targetRpe: 7,
        restSeconds: 90,
      })),
    })),
    mesocycle: {
      id: "meso-1",
      startWeek: 0,
      durationWeeks: 5,
      sessionsPerWeek: 4,
      macroCycle: {
        startDate: new Date("2026-03-02T00:00:00.000Z"),
      },
    },
  };
}

function buildExercise(input: {
  id: string;
  name: string;
  primaryMuscles: string[];
  isCompound?: boolean;
  isMainLiftEligible?: boolean;
  fatigueCost?: number | null;
  repRangeMin?: number | null;
  repRangeMax?: number | null;
  equipment?: string[];
  sfrScore?: number | null;
}) {
  return {
    id: input.id,
    name: input.name,
    isCompound: input.isCompound ?? false,
    isMainLiftEligible: input.isMainLiftEligible ?? false,
    fatigueCost: input.fatigueCost ?? 2,
    repRangeMin: input.repRangeMin ?? 10,
    repRangeMax: input.repRangeMax ?? 14,
    sfrScore: input.sfrScore ?? 3,
    exerciseEquipment: (input.equipment ?? ["CABLE"]).map((type) => ({
      equipment: { type },
    })),
    exerciseMuscles: input.primaryMuscles.map((muscle) => ({
      role: "PRIMARY",
      muscle: { name: muscle },
    })),
  };
}

describe("getCloseoutSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.workoutFindFirst.mockResolvedValue(buildWorkout());
    mocks.profileFindUnique.mockResolvedValue({ trainingAge: "INTERMEDIATE" });
    mocks.goalsFindUnique.mockResolvedValue({ primaryGoal: "HYPERTROPHY" });
    mocks.exerciseExposureFindMany.mockResolvedValue([]);
    mocks.loadProjectedWeekVolumeReport.mockResolvedValue({
      currentWeek: {
        mesocycleId: "meso-1",
        week: 1,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [],
      fullWeekByMuscle: [
        {
          muscle: "Rear Delts",
          completedEffectiveSets: 1,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 2,
          weeklyTarget: 6,
          mev: 4,
          mav: 12,
          deltaToTarget: -4,
          deltaToMev: -2,
          deltaToMav: -10,
        },
        {
          muscle: "Chest",
          completedEffectiveSets: 4,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 6,
          weeklyTarget: 10,
          mev: 8,
          mav: 16,
          deltaToTarget: -4,
          deltaToMev: -2,
          deltaToMav: -10,
        },
        {
          muscle: "Biceps",
          completedEffectiveSets: 4,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 7.5,
          weeklyTarget: 10,
          mev: 6,
          mav: 14,
          deltaToTarget: -2.5,
          deltaToMev: 1.5,
          deltaToMav: -6.5,
        },
        {
          muscle: "Triceps",
          completedEffectiveSets: 4,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 8.4,
          weeklyTarget: 10,
          mev: 6,
          mav: 12,
          deltaToTarget: -1.6,
          deltaToMev: 2.4,
          deltaToMav: -3.6,
        },
      ],
    });
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      "Rear Delts": { directSets: 1, indirectSets: 0, effectiveSets: 1 },
      Chest: { directSets: 4, indirectSets: 0, effectiveSets: 4 },
      Biceps: { directSets: 4, indirectSets: 0, effectiveSets: 4 },
    });
    mocks.exerciseFindMany.mockResolvedValue([
      buildExercise({
        id: "rear-delt-fly",
        name: "Cable Rear Delt Fly",
        primaryMuscles: ["Rear Delts"],
        fatigueCost: 1,
      }),
      buildExercise({
        id: "cable-fly",
        name: "Cable Fly",
        primaryMuscles: ["Chest"],
        fatigueCost: 2,
      }),
      buildExercise({
        id: "db-curl",
        name: "Dumbbell Curl",
        primaryMuscles: ["Biceps"],
        fatigueCost: 2,
      }),
      buildExercise({
        id: "pressdown",
        name: "Pressdown",
        primaryMuscles: ["Triceps"],
        fatigueCost: 2,
      }),
    ]);
    mocks.buildRuntimeAddedExercisePreview.mockImplementation(
      (input: { exercise: { id: string; name: string; equipment: string[] } }) => ({
        exerciseId: input.exercise.id,
        exerciseName: input.exercise.name,
        equipment: input.exercise.equipment,
        section: "ACCESSORY",
        isMainLift: false,
        setCount: 2,
        targetReps: 12,
        targetRepRange: { min: 10, max: 14 },
        targetLoad: null,
        targetRpe: 7,
        restSeconds: 90,
        prescriptionSource: "session_accessory_defaults",
      })
    );
  });

  it("ranks high deficits first and returns preview-backed closeout suggestions", async () => {
    const suggestions = await getCloseoutSuggestions({
      workoutId: "workout-closeout",
      userId: "user-1",
    });

    expect(suggestions.map((suggestion) => suggestion.muscle)).toEqual([
      "Chest",
      "Rear Delts",
      "Biceps",
    ]);
    expect(suggestions.map((suggestion) => suggestion.exerciseId)).toEqual([
      "cable-fly",
      "rear-delt-fly",
      "db-curl",
    ]);
    expect(suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          sets: 2,
          reps: "10-14",
          suggestedSets: 2,
          rationale: expect.stringContaining("High-priority closeout"),
        }),
      ])
    );
    expect(suggestions.find((suggestion) => suggestion.muscle === "Triceps")).toBeUndefined();
    expect(mocks.buildRuntimeAddedExercisePreview).toHaveBeenCalledTimes(3);
  });

  it("subtracts existing closeout fill and filters recent or high-fatigue candidates", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      buildWorkout({
        exercises: [
          {
            id: "we-1",
            orderIndex: 0,
            exerciseId: "existing-chest",
            name: "Machine Chest Fly",
            primaryMuscles: ["Chest"],
            setCount: 2,
          },
          {
            id: "we-2",
            orderIndex: 1,
            exerciseId: "existing-triceps",
            name: "Rope Pressdown",
            primaryMuscles: ["Triceps"],
            setCount: 2,
          },
          {
            id: "we-3",
            orderIndex: 2,
            exerciseId: "existing-core",
            name: "Cable Crunch",
            primaryMuscles: ["Core"],
            setCount: 2,
          },
        ],
      })
    );
    mocks.loadProjectedWeekVolumeReport.mockResolvedValue({
      currentWeek: {
        mesocycleId: "meso-1",
        week: 1,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [],
      fullWeekByMuscle: [
        {
          muscle: "Chest",
          completedEffectiveSets: 3,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 5,
          weeklyTarget: 9,
          mev: 8,
          mav: 16,
          deltaToTarget: -4,
          deltaToMev: -3,
          deltaToMav: -11,
        },
        {
          muscle: "Biceps",
          completedEffectiveSets: 3,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 5,
          weeklyTarget: 8,
          mev: 6,
          mav: 14,
          deltaToTarget: -3,
          deltaToMev: -1,
          deltaToMav: -9,
        },
        {
          muscle: "Side Delts",
          completedEffectiveSets: 4,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 6,
          weeklyTarget: 9.6,
          mev: 8,
          mav: 19,
          deltaToTarget: -3.6,
          deltaToMev: -2,
          deltaToMav: -13,
        },
      ],
    });
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: { directSets: 3, indirectSets: 0, effectiveSets: 3 },
      Biceps: { directSets: 3, indirectSets: 0, effectiveSets: 3 },
      "Side Delts": { directSets: 4, indirectSets: 0, effectiveSets: 4 },
    });
    mocks.exerciseExposureFindMany.mockResolvedValue([{ exerciseName: "Cable Curl" }]);
    mocks.exerciseFindMany.mockResolvedValue([
      buildExercise({
        id: "curl",
        name: "Cable Curl",
        primaryMuscles: ["Biceps"],
        fatigueCost: 2,
      }),
      buildExercise({
        id: "lateral-raise-heavy",
        name: "Cheat Lateral Raise",
        primaryMuscles: ["Side Delts"],
        fatigueCost: 5,
      }),
      buildExercise({
        id: "lateral-raise",
        name: "Cable Lateral Raise",
        primaryMuscles: ["Side Delts"],
        fatigueCost: 2,
      }),
    ]);

    const suggestions = await getCloseoutSuggestions({
      workoutId: "workout-closeout",
      userId: "user-1",
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      muscle: "Side Delts",
      exerciseId: "lateral-raise",
      sets: 2,
    });
    expect(suggestions.find((suggestion) => suggestion.muscle === "Chest")).toBeUndefined();
    expect(suggestions.find((suggestion) => suggestion.exerciseId === "curl")).toBeUndefined();
  });

  it("returns an empty list when no qualifying deficits remain", async () => {
    mocks.loadProjectedWeekVolumeReport.mockResolvedValue({
      currentWeek: {
        mesocycleId: "meso-1",
        week: 1,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [],
      fullWeekByMuscle: [
        {
          muscle: "Chest",
          completedEffectiveSets: 5,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 8.3,
          weeklyTarget: 10,
          mev: 8,
          mav: 16,
          deltaToTarget: -1.7,
          deltaToMev: 0.3,
          deltaToMav: -7.7,
        },
      ],
    });

    const suggestions = await getCloseoutSuggestions({
      workoutId: "workout-closeout",
      userId: "user-1",
    });

    expect(suggestions).toEqual([]);
    expect(mocks.exerciseFindMany).not.toHaveBeenCalled();
  });

  it("falls back to recent candidates when a deficit muscle has no non-recent pool", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      buildWorkout({
        exercises: [
          {
            id: "we-1",
            orderIndex: 0,
            exerciseId: "existing-chest",
            name: "Machine Chest Fly",
            primaryMuscles: ["Chest"],
            setCount: 2,
          },
          {
            id: "we-2",
            orderIndex: 1,
            exerciseId: "existing-triceps",
            name: "Rope Pressdown",
            primaryMuscles: ["Triceps"],
            setCount: 2,
          },
          {
            id: "we-3",
            orderIndex: 2,
            exerciseId: "curl",
            name: "Cable Curl",
            primaryMuscles: ["Forearms"],
            setCount: 2,
          },
        ],
      })
    );
    mocks.loadProjectedWeekVolumeReport.mockResolvedValue({
      currentWeek: {
        mesocycleId: "meso-1",
        week: 1,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [],
      fullWeekByMuscle: [
        {
          muscle: "Biceps",
          completedEffectiveSets: 2,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 4,
          weeklyTarget: 8,
          mev: 6,
          mav: 14,
          deltaToTarget: -4,
          deltaToMev: -2,
          deltaToMav: -10,
        },
      ],
    });
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Biceps: { directSets: 2, indirectSets: 0, effectiveSets: 2 },
    });
    mocks.exerciseExposureFindMany.mockResolvedValue([
      { exerciseName: "Cable Curl" },
      { exerciseName: "Heavy Hammer Curl" },
      { exerciseName: "Preacher Curl" },
    ]);
    mocks.exerciseFindMany.mockResolvedValue([
      buildExercise({
        id: "curl",
        name: "Cable Curl",
        primaryMuscles: ["Biceps"],
        fatigueCost: 2,
      }),
      buildExercise({
        id: "hammer-curl-heavy",
        name: "Heavy Hammer Curl",
        primaryMuscles: ["Biceps"],
        fatigueCost: 5,
      }),
      buildExercise({
        id: "preacher-curl",
        name: "Preacher Curl",
        primaryMuscles: ["Biceps"],
        fatigueCost: 2,
      }),
    ]);

    const suggestions = await getCloseoutSuggestions({
      workoutId: "workout-closeout",
      userId: "user-1",
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      muscle: "Biceps",
      exerciseId: "preacher-curl",
      sets: 2,
    });
    expect(suggestions.find((suggestion) => suggestion.exerciseId === "curl")).toBeUndefined();
    expect(
      suggestions.find((suggestion) => suggestion.exerciseId === "hammer-curl-heavy")
    ).toBeUndefined();
  });
});
