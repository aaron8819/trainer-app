import { prisma } from "@/lib/db/prisma";
import { resolveRuntimeAddedAccessoryDefaults } from "@/lib/api/runtime-added-exercise-defaults";
import type { PrimaryGoal, TrainingAge } from "@/lib/engine/types";

type ExistingWorkoutSet = {
  targetReps?: number | null;
  targetRepMin?: number | null;
  targetRepMax?: number | null;
  targetRpe?: number | null;
  restSeconds?: number | null;
};

type ExistingWorkoutExercise = {
  section?: string | null;
  orderIndex: number;
  sets: ExistingWorkoutSet[];
};

type PreviewExercise = {
  id: string;
  name: string;
  repRangeMin?: number | null;
  repRangeMax?: number | null;
  fatigueCost?: number | null;
  isCompound?: boolean | null;
  equipment: string[];
};

export type RuntimeAddedExercisePreview = {
  exerciseId: string;
  exerciseName: string;
  equipment: string[];
  section: "ACCESSORY";
  isMainLift: false;
  setCount: number;
  targetReps: number;
  targetRepRange: { min: number; max: number };
  targetLoad: number | null;
  targetRpe: number;
  restSeconds: number;
  prescriptionSource: "session_accessory_defaults" | "generic_accessory_fallback";
};

type BuildRuntimeAddedExercisePreviewInput = {
  exercise: PreviewExercise;
  targetLoad: number | null;
  selectionMetadata: unknown;
  currentExercises: ExistingWorkoutExercise[];
  trainingAge: TrainingAge;
  primaryGoal: PrimaryGoal;
};

export function buildRuntimeAddedExercisePreview(
  input: BuildRuntimeAddedExercisePreviewInput
): RuntimeAddedExercisePreview {
  const defaults = resolveRuntimeAddedAccessoryDefaults({
    exercise: {
      repRangeMin: input.exercise.repRangeMin,
      repRangeMax: input.exercise.repRangeMax,
      fatigueCost: input.exercise.fatigueCost,
      isCompound: input.exercise.isCompound,
    },
    selectionMetadata: input.selectionMetadata,
    currentExercises: input.currentExercises,
    trainingAge: input.trainingAge,
    primaryGoal: input.primaryGoal,
  });

  return {
    exerciseId: input.exercise.id,
    exerciseName: input.exercise.name,
    equipment: input.exercise.equipment,
    section: defaults.section,
    isMainLift: defaults.isMainLift,
    setCount: defaults.setCount,
    targetReps: defaults.targetReps,
    targetRepRange: {
      min: defaults.targetRepMin,
      max: defaults.targetRepMax,
    },
    targetLoad: input.targetLoad,
    targetRpe: defaults.targetRpe,
    restSeconds: defaults.restSeconds,
    prescriptionSource: defaults.prescriptionSource,
  };
}

export async function resolveRuntimeAddedExercisePreviews(input: {
  workoutId: string;
  userId: string;
  exerciseIds: string[];
}): Promise<RuntimeAddedExercisePreview[]> {
  const exerciseIds = [...new Set(input.exerciseIds.filter(Boolean))];
  if (exerciseIds.length === 0) {
    return [];
  }

  const [workout, profile, goals, exercises, recentLoads] = await Promise.all([
    prisma.workout.findFirst({
      where: { id: input.workoutId, userId: input.userId },
      select: {
        selectionMetadata: true,
        exercises: {
          orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
          select: {
            orderIndex: true,
            section: true,
            sets: {
              orderBy: { setIndex: "asc" },
              select: {
                targetReps: true,
                targetRepMin: true,
                targetRepMax: true,
                targetRpe: true,
                restSeconds: true,
              },
            },
          },
        },
      },
    }),
    prisma.profile.findUnique({
      where: { userId: input.userId },
      select: { trainingAge: true },
    }),
    prisma.goals.findUnique({
      where: { userId: input.userId },
      select: { primaryGoal: true },
    }),
    prisma.exercise.findMany({
      where: { id: { in: exerciseIds } },
      include: {
        exerciseEquipment: { include: { equipment: true } },
      },
    }),
    prisma.setLog.findMany({
      where: {
        actualLoad: { not: null },
        workoutSet: {
          workoutExercise: {
            exerciseId: { in: exerciseIds },
            workout: { userId: input.userId, status: "COMPLETED" },
          },
        },
      },
      orderBy: { completedAt: "desc" },
      select: {
        actualLoad: true,
        workoutSet: {
          select: {
            workoutExercise: {
              select: {
                exerciseId: true,
              },
            },
          },
        },
      },
    }),
  ]);

  if (!workout) {
    throw new Error("WORKOUT_NOT_FOUND");
  }

  const exerciseMap = new Map(
    exercises.map((exercise) => [
      exercise.id,
      {
        id: exercise.id,
        name: exercise.name,
        repRangeMin: exercise.repRangeMin,
        repRangeMax: exercise.repRangeMax,
        fatigueCost: exercise.fatigueCost,
        isCompound: exercise.isCompound,
        equipment: exercise.exerciseEquipment.map((item) => item.equipment.type),
      } satisfies PreviewExercise,
    ])
  );

  const latestLoadByExerciseId = new Map<string, number>();
  for (const recentLoad of recentLoads) {
    const exerciseId = recentLoad.workoutSet.workoutExercise.exerciseId;
    if (!latestLoadByExerciseId.has(exerciseId) && recentLoad.actualLoad != null) {
      latestLoadByExerciseId.set(exerciseId, recentLoad.actualLoad);
    }
  }

  const trainingAge = (profile?.trainingAge?.toLowerCase() as TrainingAge) ?? "intermediate";
  const primaryGoal = (goals?.primaryGoal?.toLowerCase() as PrimaryGoal) ?? "hypertrophy";

  return exerciseIds.flatMap((exerciseId) => {
    const exercise = exerciseMap.get(exerciseId);
    if (!exercise) {
      return [];
    }

    return [
      buildRuntimeAddedExercisePreview({
        exercise,
        targetLoad: latestLoadByExerciseId.get(exerciseId) ?? null,
        selectionMetadata: workout.selectionMetadata,
        currentExercises: workout.exercises,
        trainingAge,
        primaryGoal,
      }),
    ];
  });
}
