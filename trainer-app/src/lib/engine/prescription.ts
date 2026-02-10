import {
  DELOAD_RPE_CAP,
  getBackOffMultiplier,
  type PeriodizationModifiers,
  REP_RANGES_BY_GOAL,
  TARGET_RPE_BY_GOAL,
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

export function prescribeSetsReps(
  isMainLift: boolean,
  trainingAge: UserProfile["trainingAge"],
  goals: Goals,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers,
  exerciseRepRange?: ExerciseRepRange
): WorkoutSet[] {
  if (isMainLift) {
    return prescribeMainLiftSets(trainingAge, goals, fatigueState, preferences, periodization, exerciseRepRange);
  }
  return prescribeAccessorySets(trainingAge, goals, fatigueState, preferences, periodization, exerciseRepRange);
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
  const backOffMultiplier = getBackOffMultiplier(goals.primary);
  const backOffReps =
    backOffMultiplier >= 0.9
      ? effectiveMain[0]
      : Math.min(effectiveMain[1], effectiveMain[0] + 2);
  const targetRpe = resolveTargetRpe(
    topSetReps,
    goals,
    fatigueState,
    preferences,
    periodization
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
  exerciseRepRange?: ExerciseRepRange
): WorkoutSet[] {
  const goalRepRange = REP_RANGES_BY_GOAL[goals.primary];
  const effectiveAccessory = clampRepRange(goalRepRange.accessory, exerciseRepRange);
  const setCount = resolveSetCount(
    false,
    trainingAge,
    fatigueState,
    periodization?.setMultiplier
  );
  const targetReps = effectiveAccessory[0];
  const targetRpe = resolveTargetRpe(
    targetReps,
    goals,
    fatigueState,
    preferences,
    periodization
  );

  return Array.from({ length: setCount }, (_, index) => ({
    setIndex: index + 1,
    targetReps,
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
  const fatigueAdjusted = fatigueState.readinessScore <= 2 ? Math.max(2, baselineSets - 1) : baselineSets;
  const missedAdjusted = fatigueState.missedLastSession ? Math.max(2, fatigueAdjusted - 1) : fatigueAdjusted;
  return Math.max(2, Math.round(missedAdjusted * setMultiplier));
}

function resolveTargetRpe(
  targetReps: number,
  goals: Goals,
  fatigueState: FatigueState,
  preferences?: UserPreferences,
  periodization?: PeriodizationModifiers
) {
  let targetRpe = TARGET_RPE_BY_GOAL[goals.primary] - (fatigueState.readinessScore <= 2 ? 0.5 : 0);
  const preferredRpe = preferences?.rpeTargets?.find(
    (range) => targetReps >= range.min && targetReps <= range.max
  );
  if (preferredRpe) {
    targetRpe = preferredRpe.targetRpe;
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
  return 60;
}
