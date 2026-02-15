import type { WorkoutExercise, WorkoutSet, Exercise, WorkoutPlan } from "./types";
import { getRestSeconds, REST_SECONDS, resolveSetTargetReps } from "./prescription";

const SUPERSET_SHARED_REST_MULTIPLIER = 0.6;
const SUPERSET_SHARED_REST_FLOOR_SECONDS = 60;

/**
 * Estimate time for a single exercise (for beam search candidate evaluation)
 *
 * This matches the accuracy of estimateWorkoutMinutes() for a single exercise.
 * Accounts for:
 * - Warmup sets (if main lift)
 * - Rep-aware rest periods
 * - Exercise-specific work time
 *
 * @param exercise - Exercise metadata
 * @param sets - Number of working sets
 * @param isMainLift - Whether this is a main lift (gets warmup sets)
 * @param targetReps - Target reps per set (for rep-aware rest)
 * @returns Estimated minutes
 */
export function estimateExerciseMinutes(
  exercise: Exercise,
  sets: number,
  isMainLift: boolean,
  targetReps?: number
): number {
  if (sets <= 0) return 0;

  // Work time per set
  const workSeconds = exercise.timePerSetSec ?? (isMainLift ? 60 : 40);

  // Rep-aware work time if we have target reps
  const repAwareWorkSeconds =
    targetReps !== undefined
      ? Math.max(20, Math.min(90, targetReps * 2 + 10))
      : undefined;
  const finalWorkSeconds = repAwareWorkSeconds ?? workSeconds;

  // Rest time (rep-aware via getRestSeconds)
  const restSeconds = getRestSeconds(exercise, isMainLift, targetReps);

  // Working sets time
  const workingSeconds = (finalWorkSeconds + restSeconds) * sets;

  // Warmup sets time (main lifts get 2-4 warmup sets)
  let warmupSeconds = 0;
  if (isMainLift) {
    // Conservative estimate: 3 warmup sets @ 30s work + 45s rest
    const warmupSetCount = 3;
    const warmupWorkSeconds = 30;
    const warmupRestSeconds = REST_SECONDS.warmup;
    warmupSeconds = warmupSetCount * (warmupWorkSeconds + warmupRestSeconds);
  }

  return Math.round((workingSeconds + warmupSeconds) / 60);
}

function isSupersetTimingEligible(exercise: WorkoutExercise) {
  return Boolean(exercise.supersetGroup) && !exercise.isMainLift;
}

export function estimateWorkoutMinutes(exercises: WorkoutExercise[]): number {
  const resolveSetTiming = (
    set: WorkoutSet,
    exercise: WorkoutExercise,
    isWarmupSet: boolean
  ) => {
    const targetReps = resolveSetTargetReps(set);
    const restSeconds =
      set.restSeconds ??
      (isWarmupSet
        ? REST_SECONDS.warmup
        : getRestSeconds(exercise.exercise, exercise.isMainLift, targetReps));
    const fallbackWork =
      exercise.exercise.timePerSetSec ??
      (exercise.isMainLift ? 60 : 40);
    const repAwareFallbackWork =
      targetReps !== undefined
        ? Math.max(20, Math.min(90, targetReps * 2 + 10))
        : undefined;
    const workSeconds = fallbackWork ?? repAwareFallbackWork ?? 30;
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
    if (!isSupersetTimingEligible(exercise)) {
      continue;
    }
    const groupId = exercise.supersetGroup;
    if (!groupId) {
      continue;
    }
    const group = supersetGroups.get(groupId) ?? [];
    group.push(exercise);
    supersetGroups.set(groupId, group);
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
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      const fatigueA = a.exercise.exercise.fatigueCost ?? 3;
      const fatigueB = b.exercise.exercise.fatigueCost ?? 3;
      if (fatigueA !== fatigueB) {
        return fatigueB - fatigueA;
      }
      return a.exercise.exercise.name.localeCompare(b.exercise.exercise.name);
    });

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
  const primary = accessory.exercise.primaryMuscles ?? [];
  const secondary = accessory.exercise.secondaryMuscles ?? [];
  const uncoveredPrimary = primary.filter((muscle) => !coveredMuscles.has(muscle));
  const uncoveredSecondary = secondary.filter((muscle) => !coveredMuscles.has(muscle));
  const muscleCoverageScore = uncoveredPrimary.length + uncoveredSecondary.length * 0.3;
  const redundancyPenalty = primary.reduce((sum, muscle) => {
    const count = muscleCounts[muscle] ?? 0;
    return sum + Math.max(0, count - 1);
  }, 0);
  const fatigueCostPenalty = normalizePositive((accessory.exercise.fatigueCost ?? 3) - 3, 2);
  const sfrScore = normalizeCentered(accessory.exercise.sfrScore ?? 3, 3, 2);
  const lengthenedScore = normalizeCentered(accessory.exercise.lengthPositionScore ?? 3, 3, 2);

  return (
    3.0 * muscleCoverageScore +
    1.2 * sfrScore +
    0.8 * lengthenedScore -
    1.0 * redundancyPenalty -
    1.3 * fatigueCostPenalty
  );
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeCentered(value: number, center: number, range: number): number {
  if (range <= 0) {
    return 0;
  }
  return clamp((value - center) / range, -1, 1);
}

function normalizePositive(value: number, range: number): number {
  if (range <= 0) {
    return 0;
  }
  return clamp(value / range, 0, 1);
}

/**
 * Enforce time budget by trimming accessories if needed
 *
 * This is the Phase 2 safety net that guarantees no workout exceeds the time budget.
 * Works for both template and intent-based generation paths.
 *
 * Behavior:
 * 1. If main lifts alone exceed budget → return warning (main lifts are sacred)
 * 2. If under budget → return unchanged
 * 3. If accessories push over budget → trim lowest-priority accessories until under budget
 *
 * @param workout - The workout to enforce time budget on
 * @param timeBudgetMinutes - Maximum session duration
 * @returns Adjusted workout with optional notification
 */
export function enforceTimeBudget(
  workout: WorkoutPlan,
  timeBudgetMinutes: number
): {
  workout: WorkoutPlan;
  notification?: string;
  removedExercises?: string[];
} {
  const currentMinutes = estimateWorkoutMinutes([
    ...workout.mainLifts,
    ...workout.accessories,
  ]);

  // Already under budget - no action needed
  if (currentMinutes <= timeBudgetMinutes) {
    return { workout };
  }

  // Check if main lifts alone exceed budget
  const mainLiftMinutes = estimateWorkoutMinutes(workout.mainLifts);
  if (mainLiftMinutes > timeBudgetMinutes) {
    // Main lifts are sacred - don't trim, just warn
    const notification = `Main lifts require ${mainLiftMinutes} min (budget: ${timeBudgetMinutes} min). Consider reducing volume or increasing time budget.`;
    return {
      workout: {
        ...workout,
        notes: workout.notes ? `${workout.notes}. ${notification}` : notification,
      },
      notification,
    };
  }

  // Accessories push us over budget - trim them
  const remainingBudget = timeBudgetMinutes - mainLiftMinutes;
  const { trimmed, removed } = trimAccessoriesToFitBudget(
    workout.accessories,
    workout.mainLifts,
    remainingBudget
  );

  const finalMinutes = estimateWorkoutMinutes([...workout.mainLifts, ...trimmed]);
  const removedNames = removed.map((e) => e.exercise.name);
  const notification = `Adjusted workout to ${finalMinutes} min to fit ${timeBudgetMinutes}-minute budget (removed: ${removedNames.join(", ")})`;

  return {
    workout: {
      ...workout,
      accessories: trimmed,
      estimatedMinutes: finalMinutes,
      notes: workout.notes ? `${workout.notes}. ${notification}` : notification,
    },
    notification,
    removedExercises: removedNames,
  };
}

/**
 * Trim accessories to fit within time budget
 *
 * Iteratively removes lowest-priority accessories until time budget is met.
 * Uses existing trimAccessoriesByPriority scoring (muscle coverage, SFR, fatigue).
 *
 * @param accessories - All accessories
 * @param mainLifts - Main lifts (for muscle coverage scoring)
 * @param budgetMinutes - Remaining time budget for accessories
 * @returns Trimmed accessories + removed accessories
 */
function trimAccessoriesToFitBudget(
  accessories: WorkoutExercise[],
  mainLifts: WorkoutExercise[],
  budgetMinutes: number
): {
  trimmed: WorkoutExercise[];
  removed: WorkoutExercise[];
} {
  if (accessories.length === 0) {
    return { trimmed: [], removed: [] };
  }

  let current = [...accessories];
  const removed: WorkoutExercise[] = [];

  // Iteratively trim until we fit the budget
  while (current.length > 0) {
    const currentMinutes = estimateWorkoutMinutes(current);
    if (currentMinutes <= budgetMinutes) {
      break; // Success - we fit the budget
    }

    // Trim the lowest-priority accessory
    const trimmed = trimAccessoriesByPriority(current, mainLifts, 1);
    const removedExercise = current.find((e) => !trimmed.includes(e));
    if (!removedExercise) {
      break; // Safety - shouldn't happen
    }

    removed.push(removedExercise);
    current = trimmed;
  }

  return { trimmed: current, removed };
}
