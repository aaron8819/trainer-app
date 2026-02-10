import { prisma } from "@/lib/db/prisma";
import { mapExercises } from "./workout-context";
import { suggestSubstitutes } from "@/lib/engine/substitution";
import type { ExerciseDetail, ExerciseListItem } from "@/lib/exercise-library/types";
import type { Constraints } from "@/lib/engine/types";

export async function loadExerciseLibrary(userId?: string): Promise<ExerciseListItem[]> {
  const [exercises, preferences] = await Promise.all([
    prisma.exercise.findMany({
      orderBy: { name: "asc" },
      include: {
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
    }),
    userId ? prisma.userPreference.findUnique({ where: { userId } }) : null,
  ]);

  const favorites = new Set(preferences?.favoriteExercises ?? []);
  const avoids = new Set(preferences?.avoidExercises ?? []);

  return exercises.map((exercise) => ({
    id: exercise.id,
    name: exercise.name,
    isCompound: exercise.isCompound ?? false,
    movementPatterns: (exercise.movementPatterns ?? []).map(
      (p) => p.toLowerCase()
    ) as ExerciseListItem["movementPatterns"],
    splitTags: (exercise.splitTags ?? []).map(
      (t) => t.toLowerCase()
    ) as ExerciseListItem["splitTags"],
    jointStress: exercise.jointStress.toLowerCase() as ExerciseListItem["jointStress"],
    equipment: exercise.exerciseEquipment.map(
      (e) => e.equipment.type.toLowerCase()
    ) as ExerciseListItem["equipment"],
    primaryMuscles: exercise.exerciseMuscles
      .filter((m) => m.role === "PRIMARY")
      .map((m) => m.muscle.name),
    secondaryMuscles: exercise.exerciseMuscles
      .filter((m) => m.role === "SECONDARY")
      .map((m) => m.muscle.name),
    fatigueCost: exercise.fatigueCost ?? 3,
    sfrScore: exercise.sfrScore ?? 3,
    lengthPositionScore: exercise.lengthPositionScore ?? 3,
    difficulty: exercise.difficulty ? exercise.difficulty.toLowerCase() as "beginner" | "intermediate" | "advanced" : undefined,
    isUnilateral: exercise.isUnilateral ?? undefined,
    isFavorite: favorites.has(exercise.name),
    isAvoided: avoids.has(exercise.name),
  }));
}

export async function loadExerciseDetail(
  exerciseId: string,
  userId?: string
): Promise<ExerciseDetail | null> {
  const [exercise, preferences, baseline, allExercises] = await Promise.all([
    prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: {
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
        aliases: true,
        variations: true,
      },
    }),
    userId ? prisma.userPreference.findUnique({ where: { userId } }) : null,
    userId
      ? prisma.baseline.findFirst({
          where: { userId, exerciseId, context: "default" },
        })
      : null,
    prisma.exercise.findMany({
      include: {
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
        aliases: true,
      },
    }),
  ]);

  if (!exercise) return null;

  const favorites = new Set(preferences?.favoriteExercises ?? []);
  const avoids = new Set(preferences?.avoidExercises ?? []);

  // Compute substitutes via engine
  const engineExercises = mapExercises(allExercises);
  const targetEngine = engineExercises.find((e) => e.id === exerciseId);
  const defaultConstraints: Constraints = {
    daysPerWeek: 4,
    sessionMinutes: 60,
    splitType: "ppl",
    availableEquipment: [
      "barbell", "dumbbell", "machine", "cable",
      "bodyweight", "kettlebell", "band", "bench", "rack",
    ],
  };

  let substitutes: { id: string; name: string; primaryMuscles: string[] }[] = [];
  if (targetEngine) {
    const subs = suggestSubstitutes(
      targetEngine,
      engineExercises,
      defaultConstraints
    );
    substitutes = subs.map((s) => ({
      id: s.id,
      name: s.name,
      primaryMuscles: s.primaryMuscles ?? [],
    }));
  }

  return {
    id: exercise.id,
    name: exercise.name,
    isCompound: exercise.isCompound ?? false,
    isMainLiftEligible: exercise.isMainLiftEligible ?? false,
    movementPatterns: (exercise.movementPatterns ?? []).map(
      (p) => p.toLowerCase()
    ) as ExerciseDetail["movementPatterns"],
    splitTags: (exercise.splitTags ?? []).map(
      (t) => t.toLowerCase()
    ) as ExerciseDetail["splitTags"],
    jointStress: exercise.jointStress.toLowerCase() as ExerciseDetail["jointStress"],
    equipment: exercise.exerciseEquipment.map(
      (e) => e.equipment.type.toLowerCase()
    ) as ExerciseDetail["equipment"],
    primaryMuscles: exercise.exerciseMuscles
      .filter((m) => m.role === "PRIMARY")
      .map((m) => m.muscle.name),
    secondaryMuscles: exercise.exerciseMuscles
      .filter((m) => m.role === "SECONDARY")
      .map((m) => m.muscle.name),
    fatigueCost: exercise.fatigueCost ?? 3,
    stimulusBias: (exercise.stimulusBias ?? []).map(
      (b) => b.toLowerCase()
    ) as ExerciseDetail["stimulusBias"],
    contraindications: (exercise.contraindications as Record<string, unknown>) ?? undefined,
    sfrScore: exercise.sfrScore ?? 3,
    lengthPositionScore: exercise.lengthPositionScore ?? 3,
    difficulty: exercise.difficulty ? exercise.difficulty.toLowerCase() as "beginner" | "intermediate" | "advanced" : undefined,
    isUnilateral: exercise.isUnilateral ?? undefined,
    timePerSetSec: exercise.timePerSetSec ?? 120,
    repRangeMin: exercise.repRangeMin ?? undefined,
    repRangeMax: exercise.repRangeMax ?? undefined,
    aliases: exercise.aliases.map((a) => a.alias),
    variations: exercise.variations.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description ?? undefined,
    })),
    substitutes,
    isFavorite: favorites.has(exercise.name),
    isAvoided: avoids.has(exercise.name),
    baseline: baseline
      ? {
          id: baseline.id,
          context: baseline.context,
          workingWeightMin: baseline.workingWeightMin ?? undefined,
          workingWeightMax: baseline.workingWeightMax ?? undefined,
          workingRepsMin: baseline.workingRepsMin ?? undefined,
          workingRepsMax: baseline.workingRepsMax ?? undefined,
          topSetWeight: baseline.topSetWeight ?? undefined,
          topSetReps: baseline.topSetReps ?? undefined,
          notes: baseline.notes ?? undefined,
        }
      : undefined,
  };
}
