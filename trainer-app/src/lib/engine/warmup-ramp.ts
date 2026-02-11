import type { Exercise, UserProfile, WorkoutSet } from "./types";

const BODYWEIGHT_ONLY_EQUIPMENT = new Set(["bodyweight", "bench", "rack"]);

type WarmupRampStep = {
  percent: number;
  reps: number;
  restSeconds: number;
};

export function getWarmupRampScheme(
  trainingAge: UserProfile["trainingAge"]
): WarmupRampStep[] {
  if (trainingAge === "beginner") {
    return [
      { percent: 0.6, reps: 8, restSeconds: 60 },
      { percent: 0.8, reps: 3, restSeconds: 90 },
    ];
  }

  return [
    { percent: 0.5, reps: 8, restSeconds: 60 },
    { percent: 0.7, reps: 5, restSeconds: 60 },
    { percent: 0.85, reps: 3, restSeconds: 90 },
  ];
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
