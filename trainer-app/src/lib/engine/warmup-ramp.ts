import type { Exercise, UserProfile, WorkoutSet } from "./types";
import { getStrengthPrimaryWarmupRamp } from "./strength-session-timing";

const BODYWEIGHT_ONLY_EQUIPMENT = new Set(["bodyweight", "bench", "rack"]);

type WarmupRampStep = {
  percent: number;
  reps: number;
  restSeconds: number;
};

export function getWarmupRampScheme(
  trainingAge: UserProfile["trainingAge"]
): WarmupRampStep[] {
  return getStrengthPrimaryWarmupRamp(trainingAge).map((step) => ({
    ...step,
  }));
}

export function buildProjectedWarmupSets(
  trainingAge: UserProfile["trainingAge"]
): WorkoutSet[] {
  return getWarmupRampScheme(trainingAge).map((step, index) => ({
    setIndex: index + 1,
    role: "warmup",
    targetReps: step.reps,
    restSeconds: step.restSeconds,
  }));
}

export function buildWarmupSetsFromTopSet(
  topSetLoad: number,
  trainingAge: UserProfile["trainingAge"],
  roundToHalf: (value: number) => number
): WorkoutSet[] {
  return getWarmupRampScheme(trainingAge).map((step, index) => ({
    setIndex: index + 1,
    role: "warmup",
    targetReps: step.reps,
    targetLoad: roundToHalf(topSetLoad * step.percent),
    restSeconds: step.restSeconds,
  }));
}

export function canResolveLoadForWarmupRamp(exercise: Exercise): boolean {
  if (!exercise.equipment || exercise.equipment.length === 0) {
    return true;
  }
  return !exercise.equipment.every((item) => BODYWEIGHT_ONLY_EQUIPMENT.has(item));
}
