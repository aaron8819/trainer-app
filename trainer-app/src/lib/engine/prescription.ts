import {
  DELOAD_RPE_CAP,
  getBaseTargetRpe,
  type PeriodizationModifiers,
  REP_RANGES_BY_GOAL,
} from "./rules";
import type {
  Exercise,
  FatigueState,
  Goals,
  UserPreferences,
  UserProfile,
  WorkoutSet,
} from "./types";

export const REST_SECONDS = {
  main: 150,
  accessory: 75,
  warmup: 45,
};

export type ExerciseRepRange = { min: number; max: number };

export function resolveSetTargetReps(
  set: Pick<WorkoutSet, "targetReps" | "targetRepRange">
): number | undefined {
  return set.targetReps ?? set.targetRepRange?.min;
}

export function prescribeSetsReps(
  isMainLift: boolean,
  trainingAge: UserProfile["trainingAge"],
  goals: Goals,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers,
  exerciseRepRange?: ExerciseRepRange,
  isIsolationAccessory = false
): WorkoutSet[] {
  if (isMainLift) {
    return prescribeMainLiftSets(trainingAge, goals, fatigueState, preferences, periodization, exerciseRepRange);
  }
  return prescribeAccessorySets(
    trainingAge,
    goals,
    fatigueState,
    preferences,
    periodization,
    exerciseRepRange,
    isIsolationAccessory
  );
}

export function clampRepRange(
  goalRange: [number, number],
  exerciseRange?: ExerciseRepRange
): [number, number] {
  if (!exerciseRange) return goalRange;
  const min = Math.max(goalRange[0], exerciseRange.min);
  const max = Math.min(goalRange[1], exerciseRange.max);
  // If clamping produces an invalid range, fall back to the exercise's range
  if (min > max) return [exerciseRange.min, exerciseRange.max];
  return [min, max];
}

function widenAccessoryRangeForProgression(
  range: [number, number],
  exerciseRange?: ExerciseRepRange,
  minimumSpan = 2
): [number, number] {
  if (!exerciseRange) return range;

  let [min, max] = range;
  if (max - min >= minimumSpan) {
    return [min, max];
  }

  // Prefer expanding upward first within the exercise's practical range.
  max = Math.max(max, Math.min(exerciseRange.max, min + minimumSpan));
  if (max - min >= minimumSpan) {
    return [min, max];
  }

  // Only expand downward when upward expansion cannot satisfy the span.
  min = Math.min(min, Math.max(exerciseRange.min, max - minimumSpan));
  return [min, max];
}

function prescribeMainLiftSets(
  trainingAge: UserProfile["trainingAge"],
  goals: Goals,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers,
  exerciseRepRange?: ExerciseRepRange
): WorkoutSet[] {
  const goalRepRange = REP_RANGES_BY_GOAL[goals.primary];
  const effectiveMain = clampRepRange(goalRepRange.main, exerciseRepRange);
  const setCount = resolveSetCount(
    true,
    trainingAge,
    fatigueState,
    periodization?.setMultiplier
  );
  const topSetReps = effectiveMain[0];
  // Keep back-off reps aligned with the top set to avoid rep cliffs between nearby multipliers.
  const backOffReps = topSetReps;
  const targetRpe = resolveTargetRpe(
    topSetReps,
    trainingAge,
    goals,
    fatigueState,
    preferences,
    periodization,
    false
  );

  if (periodization?.isDeload) {
    return Array.from({ length: setCount }, (_, index) => ({
      setIndex: index + 1,
      targetReps: topSetReps,
      targetRpe,
      targetLoad: undefined,
    }));
  }

  return Array.from({ length: setCount }, (_, index) => ({
    setIndex: index + 1,
    targetReps: index === 0 ? topSetReps : backOffReps,
    targetRpe,
    targetLoad: undefined,
  }));
}

function prescribeAccessorySets(
  trainingAge: UserProfile["trainingAge"],
  goals: Goals,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers,
  exerciseRepRange?: ExerciseRepRange,
  isIsolationAccessory = false
): WorkoutSet[] {
  const goalRepRange = REP_RANGES_BY_GOAL[goals.primary];
  const clampedAccessory = clampRepRange(goalRepRange.accessory, exerciseRepRange);
  const effectiveAccessory = widenAccessoryRangeForProgression(
    clampedAccessory,
    exerciseRepRange
  );
  const setCount = resolveSetCount(
    false,
    trainingAge,
    fatigueState,
    periodization?.setMultiplier
  );
  const targetReps = effectiveAccessory[0];
  const targetRepRange = {
    min: effectiveAccessory[0],
    max: effectiveAccessory[1],
  };
  const targetRpe = resolveTargetRpe(
    targetReps,
    trainingAge,
    goals,
    fatigueState,
    preferences,
    periodization,
    isIsolationAccessory
  );

  return Array.from({ length: setCount }, (_, index) => ({
    setIndex: index + 1,
    targetReps,
    targetRepRange,
    targetRpe,
    targetLoad: undefined,
  }));
}

export function resolveSetCount(
  isMainLift: boolean,
  trainingAge: UserProfile["trainingAge"],
  fatigueState: FatigueState,
  setMultiplier = 1
) {
  const baseSets = isMainLift ? 4 : 3;
  const ageModifier = trainingAge === "advanced" ? 1.15 : trainingAge === "beginner" ? 0.85 : 1;
  const baselineSets = Math.max(2, Math.round(baseSets * ageModifier));
  const hasRecoveryPenalty =
    fatigueState.readinessScore <= 2 || fatigueState.missedLastSession;
  const recoveryAdjusted = hasRecoveryPenalty
    ? Math.max(2, baselineSets - 1)
    : baselineSets;
  return Math.max(2, Math.round(recoveryAdjusted * setMultiplier));
}

function resolveTargetRpe(
  _targetReps: number,
  trainingAge: UserProfile["trainingAge"],
  goals: Goals,
  fatigueState: FatigueState,
  _preferences?: UserPreferences,
  periodization?: PeriodizationModifiers,
  isIsolationAccessory = false
) {
  let targetRpe =
    getBaseTargetRpe(goals.primary, trainingAge) -
    (fatigueState.readinessScore <= 2 ? 0.5 : 0);
  if (goals.primary === "hypertrophy" && isIsolationAccessory) {
    targetRpe += 0.5;
  }
  if (periodization?.rpeOffset) {
    targetRpe += periodization.rpeOffset;
  }
  if (periodization?.isDeload) {
    targetRpe = Math.min(targetRpe, DELOAD_RPE_CAP);
  }
  return targetRpe;
}

export function getRestSeconds(
  exercise: Exercise,
  isMainLift: boolean,
  targetReps?: number
) {
  const fatigueCost = exercise.fatigueCost ?? 3;
  const isCompound = exercise.isCompound ?? false;
  const reps = targetReps ?? (isMainLift ? 5 : 10);

  // Heavy compounds (1-5 reps)
  if (isMainLift && reps <= 5) {
    return fatigueCost >= 4 ? 300 : 240;
  }

  // Main lifts moderate rep range (6-12)
  if (isMainLift) {
    return fatigueCost >= 4 ? 180 : 150;
  }

  // Compound accessories
  if (isCompound) {
    return reps <= 8 ? 150 : 120;
  }

  // Isolation exercises
  if (fatigueCost >= 3) return 90;
  return 75;
}
