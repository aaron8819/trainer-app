import type { Prisma } from "@prisma/client";
import { WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { countCompletedSets } from "./weekly-volume";

type WorkoutReader = Pick<Prisma.TransactionClient, "workout"> | Pick<typeof prisma, "workout">;

export type RecentMuscleStimulus = {
  muscle: string;
  lastStimulatedAt: Date | null;
  hoursSinceStimulus: number | null;
  recentEffectiveSets: number;
  recentStimulusRatio: number;
  sraHours: number;
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function loadRecentMuscleStimulus(
  client: WorkoutReader,
  input: {
    userId: string;
    targetByMuscle: Record<string, number>;
    asOf?: Date;
    windowDays?: number;
  }
): Promise<Record<string, RecentMuscleStimulus>> {
  const asOf = input.asOf ?? new Date();
  const windowDays = Math.max(1, input.windowDays ?? 7);
  const cutoff = new Date(asOf);
  cutoff.setDate(cutoff.getDate() - windowDays);

  const workouts = await client.workout.findMany({
    where: {
      userId: input.userId,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
      scheduledDate: { gte: cutoff, lte: asOf },
    },
    orderBy: { scheduledDate: "desc" },
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

  const allMuscles = new Set<string>([
    ...Object.keys(VOLUME_LANDMARKS),
    ...Object.keys(input.targetByMuscle),
  ]);
  const recentEffectiveSetsByMuscle = new Map<string, number>();
  const lastStimulatedAtByMuscle = new Map<string, Date>();
  const sraHoursByMuscle = new Map<string, number>(
    Object.entries(VOLUME_LANDMARKS).map(([muscle, landmark]) => [muscle, landmark.sraHours])
  );

  for (const workout of workouts) {
    for (const workoutExercise of workout.exercises) {
      const completedSets = countCompletedSets(workoutExercise.sets);
      if (completedSets <= 0) {
        continue;
      }

      const primaryMuscles = workoutExercise.exercise.exerciseMuscles
        .filter((mapping) => mapping.role === "PRIMARY")
        .map((mapping) => {
          sraHoursByMuscle.set(mapping.muscle.name, mapping.muscle.sraHours);
          allMuscles.add(mapping.muscle.name);
          return mapping.muscle.name;
        });
      const secondaryMuscles = workoutExercise.exercise.exerciseMuscles
        .filter((mapping) => mapping.role === "SECONDARY")
        .map((mapping) => {
          sraHoursByMuscle.set(mapping.muscle.name, mapping.muscle.sraHours);
          allMuscles.add(mapping.muscle.name);
          return mapping.muscle.name;
        });

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
        recentEffectiveSetsByMuscle.set(
          muscle,
          (recentEffectiveSetsByMuscle.get(muscle) ?? 0) + effectiveSets
        );
        allMuscles.add(muscle);

        const previous = lastStimulatedAtByMuscle.get(muscle);
        if (!previous || workout.scheduledDate > previous) {
          lastStimulatedAtByMuscle.set(muscle, workout.scheduledDate);
        }
      }
    }
  }

  return Object.fromEntries(
    Array.from(allMuscles)
      .sort((left, right) => left.localeCompare(right))
      .map((muscle) => {
        const lastStimulatedAt = lastStimulatedAtByMuscle.get(muscle) ?? null;
        const hoursSinceStimulus =
          lastStimulatedAt == null
            ? null
            : Math.round((asOf.getTime() - lastStimulatedAt.getTime()) / 3_600_000);
        const recentEffectiveSets = roundToTenth(recentEffectiveSetsByMuscle.get(muscle) ?? 0);
        const targetEffectiveSets = Math.max(input.targetByMuscle[muscle] ?? 0, 1);
        const recentStimulusRatio = roundToTenth(recentEffectiveSets / targetEffectiveSets);
        const sraHours = sraHoursByMuscle.get(muscle) ?? VOLUME_LANDMARKS[muscle]?.sraHours ?? 48;

        return [
          muscle,
          {
            muscle,
            lastStimulatedAt,
            hoursSinceStimulus,
            recentEffectiveSets,
            recentStimulusRatio,
            sraHours,
          },
        ];
      })
  );
}
