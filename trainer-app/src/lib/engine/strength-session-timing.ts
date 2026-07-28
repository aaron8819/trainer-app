import type { TrainingAge } from "./types";

export type StrengthTimingRole = "CORE_COMPOUND" | "ACCESSORY";

export type StrengthTimingExercise = {
  role: StrengthTimingRole;
  setCount: number;
  fatigueCost: number;
  isCompound: boolean;
};

export const STRENGTH_SESSION_TIMING = {
  primaryWorkSecondsPerSet: 22,
  assistanceWorkSecondsPerSet: 40,
  primaryHighFatigueThreshold: 4,
  primaryHighFatigueRestSeconds: 300,
  primaryStandardRestSeconds: 240,
  compoundAssistanceRestSeconds: 150,
  isolationAssistanceRestSeconds: 90,
  transitionSecondsBetweenExercises: 30,
  roundingIncrementMinutes: 5,
  fixedOverheadSeconds: 0,
  minimumMinutes: 0,
  countsRestAfterFinalSet: true,
} as const;

const PRIMARY_WARMUP_RAMP = {
  beginner: [
    { percent: 0.6, reps: 8, restSeconds: 60 },
    { percent: 0.8, reps: 3, restSeconds: 90 },
  ],
  intermediate: [
    { percent: 0.5, reps: 8, restSeconds: 60 },
    { percent: 0.7, reps: 5, restSeconds: 60 },
    { percent: 0.85, reps: 3, restSeconds: 90 },
  ],
  advanced: [
    { percent: 0.5, reps: 8, restSeconds: 60 },
    { percent: 0.7, reps: 5, restSeconds: 60 },
    { percent: 0.85, reps: 3, restSeconds: 90 },
  ],
} as const;

export function getStrengthPrimaryWarmupRamp(trainingAge: TrainingAge) {
  return PRIMARY_WARMUP_RAMP[trainingAge];
}

export function getStrengthExerciseRestSeconds(input: {
  role: StrengthTimingRole;
  fatigueCost: number;
  isCompound: boolean;
}): number {
  if (input.role === "CORE_COMPOUND") {
    return input.fatigueCost >=
      STRENGTH_SESSION_TIMING.primaryHighFatigueThreshold
      ? STRENGTH_SESSION_TIMING.primaryHighFatigueRestSeconds
      : STRENGTH_SESSION_TIMING.primaryStandardRestSeconds;
  }
  return input.isCompound
    ? STRENGTH_SESSION_TIMING.compoundAssistanceRestSeconds
    : STRENGTH_SESSION_TIMING.isolationAssistanceRestSeconds;
}

export function roundStrengthSessionMinutes(totalSeconds: number): number {
  if (totalSeconds <= 0) {
    return STRENGTH_SESSION_TIMING.minimumMinutes;
  }
  const incrementSeconds =
    STRENGTH_SESSION_TIMING.roundingIncrementMinutes * 60;
  return Math.max(
    STRENGTH_SESSION_TIMING.minimumMinutes,
    (Math.ceil(totalSeconds / incrementSeconds) * incrementSeconds) / 60,
  );
}

function getWarmupWorkSeconds(reps: number): number {
  return Math.max(20, Math.min(30, reps * 2 + 10));
}

export function estimateStrengthSessionTiming(input: {
  trainingAge: TrainingAge;
  exercises: readonly StrengthTimingExercise[];
}): {
  estimatedMinutes: number;
  totalSeconds: number;
  primaryWarmupSeconds: number;
  workSeconds: number;
  prescribedRestSeconds: number;
  transitionSeconds: number;
  fixedOverheadSeconds: number;
} {
  let primaryWarmupSeconds = 0;
  let workSeconds = 0;
  let prescribedRestSeconds = 0;

  for (const exercise of input.exercises) {
    if (exercise.role === "CORE_COMPOUND") {
      primaryWarmupSeconds += getStrengthPrimaryWarmupRamp(
        input.trainingAge,
      ).reduce(
        (total, set) =>
          total + getWarmupWorkSeconds(set.reps) + set.restSeconds,
        0,
      );
    }

    const workSecondsPerSet =
      exercise.role === "CORE_COMPOUND"
        ? STRENGTH_SESSION_TIMING.primaryWorkSecondsPerSet
        : STRENGTH_SESSION_TIMING.assistanceWorkSecondsPerSet;
    const restSecondsPerSet = getStrengthExerciseRestSeconds(exercise);
    workSeconds += exercise.setCount * workSecondsPerSet;
    prescribedRestSeconds += exercise.setCount * restSecondsPerSet;
  }

  const transitionSeconds =
    Math.max(0, input.exercises.length - 1) *
    STRENGTH_SESSION_TIMING.transitionSecondsBetweenExercises;
  const fixedOverheadSeconds =
    STRENGTH_SESSION_TIMING.fixedOverheadSeconds;
  const totalSeconds =
    primaryWarmupSeconds +
    workSeconds +
    prescribedRestSeconds +
    transitionSeconds +
    fixedOverheadSeconds;

  return {
    estimatedMinutes: roundStrengthSessionMinutes(totalSeconds),
    totalSeconds,
    primaryWarmupSeconds,
    workSeconds,
    prescribedRestSeconds,
    transitionSeconds,
    fixedOverheadSeconds,
  };
}
