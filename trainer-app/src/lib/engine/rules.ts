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

export function getPeriodizationModifiers(
  weekInBlock: number,
  goal: PrimaryGoal
): PeriodizationModifiers {
  const weekIndex = ((weekInBlock % 4) + 4) % 4;
  const standardBackOff = DEFAULT_BACKOFF_MULTIPLIER_BY_GOAL[goal] ?? 0.85;

  switch (weekIndex) {
    case 0: // Introduction week (lighter RPE, not a deload)
      return {
        rpeOffset: -1.0,
        setMultiplier: 1.0,
        backOffMultiplier: standardBackOff,
        isDeload: false,
      };
    case 1:
      return {
        rpeOffset: 0,
        setMultiplier: 1.0,
        backOffMultiplier: standardBackOff,
        isDeload: false,
      };
    case 2:
      return {
        rpeOffset: 0.5,
        setMultiplier: 0.85,
        backOffMultiplier: standardBackOff,
        isDeload: false,
      };
    default:
      return {
        rpeOffset: 0,
        setMultiplier: 0.6,
        backOffMultiplier: 0.75,
        isDeload: true,
      };
  }
}

export const DELOAD_THRESHOLDS = {
  lowReadinessScore: 2 as const,
  consecutiveLowReadiness: 2,
  plateauWeeks: 3,
};

export const PLATEAU_CRITERIA = {
  noProgressSessions: 3,
};
