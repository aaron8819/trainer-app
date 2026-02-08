import type { PrimaryGoal } from "./types";

export const REP_RANGES_BY_GOAL: Record<
  PrimaryGoal,
  { main: [number, number]; accessory: [number, number] }
> = {
  hypertrophy: { main: [6, 10], accessory: [10, 15] },
  strength: { main: [3, 6], accessory: [6, 10] },
  fat_loss: { main: [8, 12], accessory: [12, 20] },
  athleticism: { main: [4, 8], accessory: [8, 12] },
  general_health: { main: [8, 12], accessory: [10, 15] },
};

export const TARGET_RPE_BY_GOAL: Record<PrimaryGoal, number> = {
  hypertrophy: 7.5,
  strength: 8.0,
  fat_loss: 7.0,
  athleticism: 7.5,
  general_health: 7.0,
};

export const DELOAD_RPE_CAP = 6.0;

export type PeriodizationModifiers = {
  rpeOffset: number;
  setMultiplier: number;
  backOffMultiplier: number;
  isDeload: boolean;
};

export type MesocycleConfig = {
  totalWeeks: number;
  currentWeek: number;
  isDeload: boolean;
};

const DEFAULT_BACKOFF_MULTIPLIER_BY_GOAL: Record<PrimaryGoal, number> = {
  hypertrophy: 0.85,
  strength: 0.9,
  fat_loss: 0.85,
  athleticism: 0.85,
  general_health: 0.85,
};

export function getBackOffMultiplier(primaryGoal: PrimaryGoal): number {
  return DEFAULT_BACKOFF_MULTIPLIER_BY_GOAL[primaryGoal] ?? 0.85;
}

export function getMesocyclePeriodization(
  config: MesocycleConfig,
  goal: PrimaryGoal
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

  // RIR ramp: early weeks 3-4 RIR (low RPE), late weeks 0-1 RIR (high RPE)
  let rpeOffset: number;
  if (t <= 0.25) {
    rpeOffset = -1.5; // early: 3-4 RIR
  } else if (t <= 0.5) {
    rpeOffset = -0.5; // middle: 2-3 RIR
  } else if (t <= 0.75) {
    rpeOffset = 0.5;  // late: 1-2 RIR
  } else {
    rpeOffset = 1.0;  // final: 0-1 RIR
  }

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
  goal: PrimaryGoal
): PeriodizationModifiers {
  const totalWeeks = 4;
  const weekIndex = ((weekInBlock % totalWeeks) + totalWeeks) % totalWeeks;
  const isDeload = weekIndex === totalWeeks - 1;

  return getMesocyclePeriodization(
    { totalWeeks: totalWeeks - 1, currentWeek: Math.min(weekIndex, totalWeeks - 2), isDeload },
    goal
  );
}

export const DELOAD_THRESHOLDS = {
  lowReadinessScore: 2 as const,
  consecutiveLowReadiness: 4,
  plateauSessions: 5,
  proactiveMaxWeeks: 6,
};

export const PLATEAU_CRITERIA = {
  noProgressSessions: 5,
};
