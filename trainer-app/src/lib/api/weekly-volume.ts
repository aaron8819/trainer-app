import type { Prisma } from "@prisma/client";
import { WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";

type WorkoutReader = Pick<Prisma.TransactionClient, "workout"> | Pick<typeof prisma, "workout">;

export type WeeklyMuscleVolumeRow = {
  directSets: number;
  indirectSets: number;
  effectiveSets: number;
};

type WeeklyMuscleVolumeMap = Record<string, WeeklyMuscleVolumeRow>;

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function countCompletedSets(
  sets: Array<{ logs: Array<{ wasSkipped: boolean }> }>
): number {
  return sets.filter((set) => set.logs.length > 0 && !set.logs[0]?.wasSkipped).length;
}

function getOrCreateMuscleRow(
  muscles: WeeklyMuscleVolumeMap,
  muscle: string
): WeeklyMuscleVolumeRow {
  if (!muscles[muscle]) {
    muscles[muscle] = { directSets: 0, indirectSets: 0, effectiveSets: 0 };
  }
  return muscles[muscle];
}

export async function loadMesocycleWeekMuscleVolume(
  client: WorkoutReader,
  input: {
    userId: string;
    mesocycleId: string;
    targetWeek: number;
    weekStart: Date;
    excludeWorkoutId?: string;
    performedBefore?: Date;
  }
): Promise<WeeklyMuscleVolumeMap> {
  const weekEnd = new Date(input.weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const workouts = await client.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
      ...(input.excludeWorkoutId ? { id: { not: input.excludeWorkoutId } } : {}),
      ...(input.performedBefore ? { scheduledDate: { lt: input.performedBefore } } : {}),
      OR: [
        { mesocycleWeekSnapshot: input.targetWeek },
        {
          mesocycleWeekSnapshot: null,
          scheduledDate: { gte: input.weekStart, lt: weekEnd },
        },
      ],
    },
    include: {
      exercises: {
        include: {
          exercise: {
            include: {
              aliases: true,
              exerciseMuscles: { include: { muscle: true } },
            },
          },
          sets: { include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } } },
        },
      },
    },
  });

  const muscles: WeeklyMuscleVolumeMap = {};
  for (const workout of workouts) {
    for (const workoutExercise of workout.exercises) {
      const completedSets = countCompletedSets(workoutExercise.sets);
      if (completedSets <= 0) {
        continue;
      }

      const primaryMuscles = workoutExercise.exercise.exerciseMuscles
        .filter((mapping) => mapping.role === "PRIMARY")
        .map((mapping) => mapping.muscle.name);
      const secondaryMuscles = workoutExercise.exercise.exerciseMuscles
        .filter((mapping) => mapping.role === "SECONDARY")
        .map((mapping) => mapping.muscle.name);

      for (const muscle of primaryMuscles) {
        getOrCreateMuscleRow(muscles, muscle).directSets += completedSets;
      }
      for (const muscle of secondaryMuscles) {
        getOrCreateMuscleRow(muscles, muscle).indirectSets += completedSets;
      }

      const effectiveContribution = getEffectiveStimulusByMuscle(
        {
          id: workoutExercise.exercise.id ?? workoutExercise.exercise.name ?? "unknown-exercise",
          name: workoutExercise.exercise.name ?? workoutExercise.exercise.id ?? "Unknown Exercise",
          primaryMuscles,
          secondaryMuscles,
          aliases: (workoutExercise.exercise.aliases ?? []).map((alias) => alias.alias),
        },
        completedSets
      );
      for (const [muscle, effectiveSets] of effectiveContribution) {
        const row = getOrCreateMuscleRow(muscles, muscle);
        row.effectiveSets = roundToTenth(row.effectiveSets + effectiveSets);
      }
    }
  }

  return muscles;
}
