import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import type { WorkoutExercise } from "@/lib/engine/types";
import { roundToTenth, SUPPORT_FLOOR_EPSILON } from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";

export const STIMULUS_DIVERSITY_ACTIVATION_SETS = 8;
export const SINGLE_EXERCISE_SHARE_ACTIVATION_SETS = 10;
export const MAX_SINGLE_EXERCISE_MUSCLE_SHARE = 0.5;
export const MAX_SINGLE_PATTERN_MUSCLE_SHARE = 0.7;

export type DistributionGuardAction = {
  slotId: string;
  exerciseName: string;
  muscle: string;
  attemptedAction: "set_bump";
  decision: "blocked" | "rerouted" | "left_unresolved";
  reason:
    | "single_exercise_share_limit"
    | "single_pattern_share_limit"
    | "cap_cleanup_risk"
    | "collateral_risk";
  alternativeExerciseName?: string;
};

export function getSingleExerciseMuscleShare(input: {
  exercise: WorkoutExercise;
  muscle: string;
  weeklyTotals: ReadonlyMap<string, number>;
}): number {
  const total = input.weeklyTotals.get(input.muscle) ?? 0;
  if (total <= SUPPORT_FLOOR_EPSILON) {
    return 0;
  }
  const contribution =
    getEffectiveStimulusByMuscle(
      input.exercise.exercise,
      input.exercise.sets.length,
    ).get(input.muscle) ?? 0;
  return contribution / total;
}

export function wouldWorsenOverConcentratedSetBump(input: {
  exercise: WorkoutExercise;
  muscle: string;
  weeklyTotals: ReadonlyMap<string, number>;
  maxSingleExerciseShare?: number;
}): boolean {
  const effectivePerSet =
    getEffectiveStimulusByMuscle(input.exercise.exercise, 1).get(input.muscle) ??
    0;
  if (effectivePerSet <= SUPPORT_FLOOR_EPSILON) {
    return false;
  }
  const maxShare =
    input.maxSingleExerciseShare ?? MAX_SINGLE_EXERCISE_MUSCLE_SHARE;
  return (
    getSingleExerciseMuscleShare({
      exercise: input.exercise,
      muscle: input.muscle,
      weeklyTotals: input.weeklyTotals,
    }) > maxShare + SUPPORT_FLOOR_EPSILON
  );
}

export function formatSingleExerciseSharePercent(input: {
  exercise: WorkoutExercise;
  muscle: string;
  weeklyTotals: ReadonlyMap<string, number>;
}): number {
  return roundToTenth(
    getSingleExerciseMuscleShare(input) * 100,
  );
}
