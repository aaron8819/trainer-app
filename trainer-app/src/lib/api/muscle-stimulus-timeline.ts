import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { countCompletedSets } from "./weekly-volume";

export type MuscleStimulusTimelineDay = {
  date: string;
  effectiveSets: number;
  intensityBand: 0 | 1 | 2 | 3;
};

export type MuscleStimulusTimeline = {
  muscle: string;
  days: MuscleStimulusTimelineDay[];
};

type TimelineWorkout = {
  scheduledDate: Date;
  exercises: Array<{
    exercise: {
      id?: string | null;
      name?: string | null;
      aliases?: Array<{ alias: string }>;
      exerciseMuscles: Array<{
        role: string;
        muscle: {
          name: string;
        };
      }>;
    };
    sets: Array<{
      logs: Array<{
        wasSkipped: boolean;
      }>;
    }>;
  }>;
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function intensityBandForEffectiveSets(effectiveSets: number): 0 | 1 | 2 | 3 {
  if (effectiveSets <= 0) {
    return 0;
  }
  if (effectiveSets < 1) {
    return 1;
  }
  if (effectiveSets < 2.5) {
    return 2;
  }
  return 3;
}

function buildWindowDates(asOf: Date, windowDays: number): string[] {
  return Array.from({ length: windowDays }, (_, index) => {
    const day = new Date(asOf);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (windowDays - 1 - index));
    return day.toISOString().slice(0, 10);
  });
}

export function buildMuscleStimulusTimeline(
  workouts: TimelineWorkout[],
  input?: {
    asOf?: Date;
    windowDays?: number;
    muscles?: string[];
  }
): Record<string, MuscleStimulusTimeline> {
  const asOf = input?.asOf ?? new Date();
  const windowDays = Math.max(1, input?.windowDays ?? 7);
  const windowDates = buildWindowDates(asOf, windowDays);
  const validDates = new Set(windowDates);
  const requestedMuscles = new Set(input?.muscles ?? []);
  const effectiveSetsByMuscleDate = new Map<string, Map<string, number>>();

  for (const workout of workouts) {
    const dateKey = workout.scheduledDate.toISOString().slice(0, 10);
    if (!validDates.has(dateKey)) {
      continue;
    }

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
        requestedMuscles.add(muscle);
        const byDate = effectiveSetsByMuscleDate.get(muscle) ?? new Map<string, number>();
        byDate.set(dateKey, (byDate.get(dateKey) ?? 0) + effectiveSets);
        effectiveSetsByMuscleDate.set(muscle, byDate);
      }
    }
  }

  return Object.fromEntries(
    Array.from(requestedMuscles)
      .sort((left, right) => left.localeCompare(right))
      .map((muscle) => {
        const byDate = effectiveSetsByMuscleDate.get(muscle) ?? new Map<string, number>();
        const days = windowDates.map((date) => {
          const effectiveSets = roundToTenth(byDate.get(date) ?? 0);
          return {
            date,
            effectiveSets,
            intensityBand: intensityBandForEffectiveSets(effectiveSets),
          };
        });

        return [muscle, { muscle, days }];
      })
  );
}
