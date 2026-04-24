import { prisma } from "@/lib/db/prisma";

export type BonusSuggestion = {
  muscle: string | null;
  exerciseId: string;
  exerciseName: string;
  primaryMuscles: string[];
  equipment: string[];
  sets: number;
  reps: string | null;
  rationale: string;
  reason: string;
  suggestedSets: number;
  suggestedLoad: number | null;
};

export async function getBonusSuggestions(
  workoutId: string,
  userId: string
): Promise<BonusSuggestion[]> {
  const workout = await prisma.workout.findFirst({
    where: { id: workoutId, userId },
    include: {
      exercises: {
        select: {
          exercise: { select: { name: true } },
        },
      },
    },
  });
  if (!workout) return [];

  const currentExerciseNames = new Set(workout.exercises.map((ex) => ex.exercise.name));
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recentExposure = await prisma.exerciseExposure.findMany({
    where: { userId, lastUsedAt: { gte: twoDaysAgo } },
    select: { exerciseName: true },
  });
  const recentlyUsedNames = new Set(recentExposure.map((entry) => entry.exerciseName));

  const candidates = await prisma.exercise.findMany({
    where: {
      name: { notIn: [...currentExerciseNames, ...recentlyUsedNames] },
      isMainLiftEligible: false,
    },
    include: {
      exerciseMuscles: { include: { muscle: true } },
      exerciseEquipment: { include: { equipment: true } },
    },
    orderBy: [{ sfrScore: "desc" }, { name: "asc" }],
    take: 30,
  });

  return candidates.slice(0, 5).map((exercise) => {
    const primaryMuscles = exercise.exerciseMuscles
      .filter((mapping) => mapping.role === "PRIMARY")
      .map((mapping) => mapping.muscle.name);
    const muscle = primaryMuscles[0] ?? null;
    const rationale = muscle
      ? `Neutral accessory option for ${muscle}.`
      : "Neutral accessory option.";

    return {
      muscle,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      primaryMuscles,
      equipment: exercise.exerciseEquipment.map((entry) => entry.equipment.type),
      sets: 3,
      reps: null,
      rationale,
      reason: rationale,
      suggestedSets: 3,
      suggestedLoad: null,
    };
  });
}
