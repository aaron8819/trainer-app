import { prisma } from "@/lib/db/prisma";
import { VOLUME_LANDMARKS, MUSCLE_SPLIT_MAP } from "@/lib/engine/volume-landmarks";

export type BonusSuggestion = {
  exerciseId: string;
  exerciseName: string;
  primaryMuscles: string[];
  equipment: string[];
  reason: string;
  suggestedSets: number;
  suggestedLoad: number | null;
};

export async function getBonusSuggestions(
  workoutId: string,
  userId: string
): Promise<BonusSuggestion[]> {
  // Load workout to determine split and current exercise set
  const workout = await prisma.workout.findUnique({
    where: { id: workoutId },
    include: {
      exercises: {
        select: {
          exercise: { select: { name: true } },
        },
      },
    },
  });
  if (!workout) return [];

  const workoutSplit = workout.forcedSplit?.toLowerCase() as "push" | "pull" | "legs" | undefined;
  const currentExerciseNames = new Set(workout.exercises.map((ex) => ex.exercise.name));

  // Count sets per muscle from last 7 days of completed workouts
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentSets = await prisma.workoutSet.findMany({
    where: {
      workoutExercise: {
        workout: {
          userId,
          status: "COMPLETED",
          completedAt: { gte: sevenDaysAgo },
        },
      },
      logs: { some: { wasSkipped: false } },
    },
    include: {
      workoutExercise: {
        include: {
          exercise: {
            include: {
              exerciseMuscles: { include: { muscle: true } },
            },
          },
        },
      },
    },
  });

  const setsPerMuscle: Record<string, number> = {};
  for (const set of recentSets) {
    const primaryMuscleNames = set.workoutExercise.exercise.exerciseMuscles
      .filter((m) => m.role === "PRIMARY")
      .map((m) => m.muscle.name);
    for (const muscle of primaryMuscleNames) {
      setsPerMuscle[muscle] = (setsPerMuscle[muscle] ?? 0) + 1;
    }
  }

  // Find undertrained muscles compatible with the current split
  const undertrainedMuscles: { muscle: string; gap: number; reason: string }[] = [];
  for (const [muscle, landmarks] of Object.entries(VOLUME_LANDMARKS)) {
    if (workoutSplit) {
      const muscleSplit = MUSCLE_SPLIT_MAP[muscle];
      if (muscleSplit && muscleSplit !== workoutSplit) continue;
    }
    const current = setsPerMuscle[muscle] ?? 0;
    if (landmarks.mev > 0 && current < landmarks.mev) {
      undertrainedMuscles.push({
        muscle,
        gap: landmarks.mev - current,
        reason: `${muscle} below MEV (${current}/${landmarks.mev} sets this week)`,
      });
    } else if (landmarks.mav > 0 && current < landmarks.mav) {
      undertrainedMuscles.push({
        muscle,
        gap: (landmarks.mav - current) / 2,
        reason: `${muscle} has room to grow (${current}/${landmarks.mav} sets this week)`,
      });
    }
  }
  undertrainedMuscles.sort((a, b) => b.gap - a.gap);
  const targetMuscles = undertrainedMuscles.slice(0, 4).map((m) => m.muscle);

  if (targetMuscles.length === 0) return [];

  // Filter out exercises used in the last 48h
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recentExposure = await prisma.exerciseExposure.findMany({
    where: { userId, lastUsedAt: { gte: twoDaysAgo } },
    select: { exerciseName: true },
  });
  const recentlyUsedNames = new Set(recentExposure.map((e) => e.exerciseName));

  // Find muscle DB IDs for target muscles
  const muscleRecords = await prisma.muscle.findMany({
    where: { name: { in: targetMuscles } },
    select: { id: true, name: true },
  });
  const muscleIds = muscleRecords.map((m) => m.id);
  if (muscleIds.length === 0) return [];

  // Find candidate exercises — high SFR score first
  const candidates = await prisma.exercise.findMany({
    where: {
      name: { notIn: [...currentExerciseNames, ...recentlyUsedNames] },
      exerciseMuscles: { some: { muscleId: { in: muscleIds }, role: "PRIMARY" } },
    },
    include: {
      exerciseMuscles: { include: { muscle: true } },
      exerciseEquipment: { include: { equipment: true } },
    },
    orderBy: { sfrScore: "desc" },
    take: 30,
  });

  // Pick top 5
  const suggestions: BonusSuggestion[] = [];
  for (const exercise of candidates) {
    if (suggestions.length >= 5) break;
    const primaryMuscleNames = exercise.exerciseMuscles
      .filter((m) => m.role === "PRIMARY")
      .map((m) => m.muscle.name);
    const matchingMuscle = targetMuscles.find((m) => primaryMuscleNames.includes(m));
    if (!matchingMuscle) continue;
    const muscleInfo = undertrainedMuscles.find((m) => m.muscle === matchingMuscle);

    const baseline = await prisma.baseline.findFirst({
      where: { userId, exerciseId: exercise.id },
      orderBy: { createdAt: "desc" },
      select: { workingWeightMin: true, topSetWeight: true },
    });
    const suggestedLoad = baseline?.workingWeightMin ?? baseline?.topSetWeight ?? null;

    suggestions.push({
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      primaryMuscles: primaryMuscleNames,
      equipment: exercise.exerciseEquipment.map((eq) => eq.equipment.type),
      reason: muscleInfo?.reason ?? `Good choice for ${matchingMuscle}`,
      suggestedSets: 3,
      suggestedLoad,
    });
  }

  return suggestions;
}
