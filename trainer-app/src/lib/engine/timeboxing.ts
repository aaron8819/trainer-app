import type { WorkoutExercise, WorkoutSet } from "./types";
import { getRestSeconds, REST_SECONDS, resolveSetTargetReps } from "./prescription";

const SUPERSET_SHARED_REST_MULTIPLIER = 0.6;
const SUPERSET_SHARED_REST_FLOOR_SECONDS = 60;

export function estimateWorkoutMinutes(exercises: WorkoutExercise[]): number {
  const estimateWorkSeconds = (reps?: number, fallback?: number) => {
    if (reps === undefined || Number.isNaN(reps)) {
      return fallback ?? 30;
    }
    const seconds = reps * 2 + 10;
    return Math.max(20, Math.min(90, seconds));
  };

  const resolveSetTiming = (
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
    const workSeconds = estimateWorkSeconds(resolveSetTargetReps(set), fallbackWork);
    const cappedWorkSeconds = isWarmupSet ? Math.min(30, workSeconds) : workSeconds;
    return { workSeconds: cappedWorkSeconds, restSeconds };
  };

  const estimateWarmupSeconds = (exercise: WorkoutExercise) =>
    (exercise.warmupSets ?? []).reduce((sum, set) => {
      const timing = resolveSetTiming(set, exercise, true);
      return sum + timing.workSeconds + timing.restSeconds;
    }, 0);

  const estimateWorkingSeconds = (exercise: WorkoutExercise) =>
    exercise.sets.reduce((sum, set) => {
      const timing = resolveSetTiming(set, exercise, false);
      return sum + timing.workSeconds + timing.restSeconds;
    }, 0);

  const supersetGroups = new Map<number, WorkoutExercise[]>();
  for (const exercise of exercises) {
    if (!exercise.supersetGroup || exercise.isMainLift) {
      continue;
    }
    const group = supersetGroups.get(exercise.supersetGroup) ?? [];
    group.push(exercise);
    supersetGroups.set(exercise.supersetGroup, group);
  }

  const pairedIds = new Set<string>();
  const pairedGroups: WorkoutExercise[][] = [];
  for (const items of supersetGroups.values()) {
    if (items.length === 2) {
      pairedGroups.push(items);
      for (const item of items) {
        pairedIds.add(item.id);
      }
    }
  }

  const estimateSupersetPairSeconds = (
    first: WorkoutExercise,
    second: WorkoutExercise
  ) => {
    const rounds = Math.max(first.sets.length, second.sets.length);
    let seconds = 0;

    for (let i = 0; i < rounds; i += 1) {
      const firstSet = first.sets[i];
      const secondSet = second.sets[i];
      const timingA = firstSet ? resolveSetTiming(firstSet, first, false) : undefined;
      const timingB = secondSet ? resolveSetTiming(secondSet, second, false) : undefined;

      if (timingA) {
        seconds += timingA.workSeconds;
      }
      if (timingB) {
        seconds += timingB.workSeconds;
      }

      const restCandidates: number[] = [];
      if (timingA) {
        restCandidates.push(timingA.restSeconds);
      }
      if (timingB) {
        restCandidates.push(timingB.restSeconds);
      }
      if (restCandidates.length > 0) {
        const maxStandaloneRest = Math.max(...restCandidates);
        const sharedRest = Math.max(
          SUPERSET_SHARED_REST_FLOOR_SECONDS,
          Math.round(maxStandaloneRest * SUPERSET_SHARED_REST_MULTIPLIER)
        );
        seconds += sharedRest;
      }
    }

    return seconds;
  };

  const warmupSeconds = exercises.reduce(
    (sum, exercise) => sum + estimateWarmupSeconds(exercise),
    0
  );

  let totalSeconds = warmupSeconds;

  for (const [first, second] of pairedGroups) {
    totalSeconds += estimateSupersetPairSeconds(first, second);
  }

  for (const exercise of exercises) {
    if (pairedIds.has(exercise.id)) {
      continue;
    }
    totalSeconds += estimateWorkingSeconds(exercise);
  }

  return Math.round(totalSeconds / 60);
}

export function trimAccessoriesByPriority<T extends WorkoutExercise>(
  accessories: T[],
  mainLifts: WorkoutExercise[],
  count: number
): T[] {
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
