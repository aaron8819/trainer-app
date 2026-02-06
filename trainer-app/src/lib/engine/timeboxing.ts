import type { WorkoutExercise, WorkoutSet } from "./types";
import { getRestSeconds, REST_SECONDS } from "./prescription";

export function estimateWorkoutMinutes(exercises: WorkoutExercise[]): number {
  const estimateWorkSeconds = (reps?: number, fallback?: number) => {
    if (reps === undefined || Number.isNaN(reps)) {
      return fallback ?? 30;
    }
    const seconds = reps * 2 + 10;
    return Math.max(20, Math.min(90, seconds));
  };

  const estimateSetSeconds = (
    set: WorkoutSet,
    exercise: WorkoutExercise,
    isWarmupSet: boolean
  ) => {
    const restSeconds =
      set.restSeconds ??
      (isWarmupSet
        ? REST_SECONDS.warmup
        : getRestSeconds(exercise.exercise, exercise.isMainLift));
    const fallbackWork =
      exercise.exercise.timePerSetSec ??
      (exercise.isMainLift ? 60 : 40);
    const workSeconds = estimateWorkSeconds(set.targetReps, fallbackWork);
    const cappedWorkSeconds = isWarmupSet ? Math.min(30, workSeconds) : workSeconds;
    return restSeconds + cappedWorkSeconds;
  };

  const totalSeconds = exercises.reduce((total, exercise) => {
    const workSeconds = exercise.sets.reduce(
      (sum, set) => sum + estimateSetSeconds(set, exercise, false),
      0
    );
    const warmupSeconds = (exercise.warmupSets ?? []).reduce(
      (sum, set) => sum + estimateSetSeconds(set, exercise, true),
      0
    );
    return total + workSeconds + warmupSeconds;
  }, 0);

  return Math.round(totalSeconds / 60);
}

export function trimAccessoriesByPriority(
  accessories: WorkoutExercise[],
  mainLifts: WorkoutExercise[],
  count: number
) {
  if (accessories.length === 0 || count <= 0) {
    return accessories;
  }
  const trimmed = [...accessories];
  const coveredMuscles = new Set(
    mainLifts.flatMap((exercise) => exercise.exercise.primaryMuscles ?? [])
  );
  const muscleCounts = buildAccessoryMuscleCounts(trimmed);
  const scored = trimmed
    .map((exercise) => ({
      exercise,
      score: scoreAccessoryRetention(exercise, coveredMuscles, muscleCounts),
    }))
    .sort((a, b) => a.score - b.score);

  for (let i = 0; i < count && scored.length > 0; i += 1) {
    const remove = scored.shift();
    if (!remove) {
      break;
    }
    const index = trimmed.findIndex((item) => item.id === remove.exercise.id);
    if (index >= 0) {
      trimmed.splice(index, 1);
    }
  }

  return trimmed;
}

export function scoreAccessoryRetention(
  accessory: WorkoutExercise,
  coveredMuscles: Set<string>,
  muscleCounts: Record<string, number>
) {
  const fatigueCost = accessory.exercise.fatigueCost ?? 3;
  const primary = accessory.exercise.primaryMuscles ?? [];
  const uncovered = primary.filter((muscle) => !coveredMuscles.has(muscle));
  const noveltyBonus = uncovered.length * 2;
  const redundancyPenalty = primary.reduce((sum, muscle) => {
    const count = muscleCounts[muscle] ?? 0;
    return sum + Math.max(0, count - 1);
  }, 0);
  return fatigueCost + noveltyBonus - redundancyPenalty;
}

export function buildAccessoryMuscleCounts(accessories: WorkoutExercise[]) {
  const counts: Record<string, number> = {};
  for (const accessory of accessories) {
    const primary = accessory.exercise.primaryMuscles ?? [];
    for (const muscle of primary) {
      counts[muscle] = (counts[muscle] ?? 0) + 1;
    }
  }
  return counts;
}
