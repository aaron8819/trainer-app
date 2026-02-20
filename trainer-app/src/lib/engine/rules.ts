import type { PrimaryGoal, TrainingAge } from "./types";

export const FAT_LOSS_SET_MULTIPLIER = 0.75;

export const REP_RANGES_BY_GOAL: Record<
  PrimaryGoal,
  { main: [number, number]; accessory: [number, number] }
> = {
  hypertrophy: { main: [6, 10], accessory: [10, 15] },
  strength: { main: [3, 6], accessory: [6, 10] },
  // KB: 6-10 reps with maintained load is optimal for muscle preservation during deficit (Helms 2014)
  fat_loss: { main: [6, 10], accessory: [12, 20] },
  athleticism: { main: [4, 8], accessory: [8, 12] },
  general_health: { main: [8, 12], accessory: [10, 15] },
};

export const TARGET_RPE_BY_GOAL: Record<PrimaryGoal, number> = {
  hypertrophy: 7.5,
  strength: 8.0,
  // KB: stop 1-2 RIR during deficit; 7.5 RPE reflects this conservative but effective approach
  fat_loss: 7.5,
  athleticism: 7.5,
  general_health: 7.0,
};

const HYPERTROPHY_TARGET_RPE_BY_TRAINING_AGE: Record<TrainingAge, number> = {
  beginner: 7.0,
  intermediate: 8.0,
  advanced: 8.5,
};

const TRAINING_AGE_RPE_OFFSETS: Record<
  TrainingAge,
  { early: number; middle: number; late: number }
> = {
  beginner: { early: -0.5, middle: 0.0, late: 0.5 },
  intermediate: { early: -1.0, middle: -0.5, late: 0.5 },
  advanced: { early: -1.5, middle: -0.5, late: 1.0 },
};

export const DELOAD_RPE_CAP = 6.0;

export type PeriodizationModifiers = {
  rpeOffset: number;
  setMultiplier: number;
  backOffMultiplier: number;
  isDeload: boolean;
  weekInBlock?: number;
};

export type MesocycleConfig = {
  totalWeeks: number;
  currentWeek: number;
  isDeload: boolean;
};

const DEFAULT_BACKOFF_MULTIPLIER_BY_GOAL: Record<PrimaryGoal, number> = {
  hypertrophy: 0.88,
  strength: 0.9,
  fat_loss: 0.85,
  athleticism: 0.85,
  general_health: 0.85,
};

export function getBackOffMultiplier(primaryGoal: PrimaryGoal): number {
  return DEFAULT_BACKOFF_MULTIPLIER_BY_GOAL[primaryGoal] ?? 0.85;
}

export function getGoalRepRanges(primaryGoal: PrimaryGoal) {
  return REP_RANGES_BY_GOAL[primaryGoal];
}

export function getGoalSetMultiplier(primaryGoal: PrimaryGoal): number {
  // KB: reduce volume 20-33% during caloric deficit (Roth 2022: 6-10 sets/muscle/week sufficient)
  if (primaryGoal === "fat_loss") {
    return FAT_LOSS_SET_MULTIPLIER;
  }
  return 1;
}

export function getBaseTargetRpe(primaryGoal: PrimaryGoal, trainingAge: TrainingAge): number {
  if (primaryGoal === "hypertrophy") {
    return HYPERTROPHY_TARGET_RPE_BY_TRAINING_AGE[trainingAge] ?? 8.0;
  }
  return TARGET_RPE_BY_GOAL[primaryGoal];
}

export function getMesocyclePeriodization(
  config: MesocycleConfig,
  goal: PrimaryGoal,
  trainingAge?: TrainingAge
): PeriodizationModifiers {
  const standardBackOff = DEFAULT_BACKOFF_MULTIPLIER_BY_GOAL[goal] ?? 0.85;

  if (config.isDeload) {
    return {
      rpeOffset: -2.0,
      setMultiplier: 0.5,
      backOffMultiplier: 0.75,
      isDeload: true,
    };
  }

  const totalWeeks = Math.max(1, config.totalWeeks);
  const t = totalWeeks <= 1 ? 0.5 : config.currentWeek / (totalWeeks - 1);
  const rpeOffset =
    trainingAge === undefined
      ? resolveGenericRpeOffset(t)
      : resolveTrainingAgeRpeOffset(trainingAge, t);

  // Set multiplier ramps from 1.0 to 1.3
  const setMultiplier = 1.0 + 0.3 * t;

  return {
    rpeOffset,
    setMultiplier,
    backOffMultiplier: standardBackOff,
    isDeload: false,
  };
}

export function getPeriodizationModifiers(
  weekInBlock: number,
  goal: PrimaryGoal,
  trainingAge?: TrainingAge
): PeriodizationModifiers {
  const totalWeeks = 4;
  // weekInBlock is 1-based (week 1 = first week, week 4 = deload)
  const weekIndex = Math.min(weekInBlock - 1, totalWeeks - 1);
  const isDeload = weekIndex >= totalWeeks - 1;

  return {
    ...getMesocyclePeriodization(
      { totalWeeks: totalWeeks - 1, currentWeek: Math.min(weekIndex, totalWeeks - 2), isDeload },
      goal,
      trainingAge
    ),
    weekInBlock,
  };
}

export const DELOAD_THRESHOLDS = {
  lowReadinessScore: 2 as const,
  consecutiveLowReadiness: 4,
  plateauSessions: 5,
};

export const PLATEAU_CRITERIA = {
  noProgressSessions: 5,
};

/**
 * Generic RPE offset for workouts without training age specified
 *
 * Used as fallback for older workouts or users who haven't set training age.
 * Provides conservative progression similar to intermediate template.
 */
function resolveGenericRpeOffset(t: number): number {
  if (t <= 0.25) {
    return -1.5;
  }
  if (t <= 0.5) {
    return -0.5;
  }
  if (t <= 0.75) {
    return 0.5;
  }
  return 1.0;
}

function resolveTrainingAgeRpeOffset(trainingAge: TrainingAge, t: number): number {
  const offsets = TRAINING_AGE_RPE_OFFSETS[trainingAge];
  if (t <= 0.25) {
    return offsets.early;
  }
  if (t <= 0.75) {
    return offsets.middle;
  }
  return offsets.late;
}
