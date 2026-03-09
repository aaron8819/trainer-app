export type LoadRecommendationInput = {
  reps?: number | null;
  rir?: number | null;
  actualLoad?: number | null;
  targetLoad?: number | null;
  repRange: { min: number; max: number };
  targetRir: number;
};

export type LoadRecommendation =
  | { action: "increase"; message: string }
  | { action: "decrease"; message: string }
  | { action: "hold"; message: string };

const LOAD_EPSILON = 1e-6;

export function getLoadRecommendation(input: LoadRecommendationInput): LoadRecommendation | null {
  const { reps, rir, actualLoad, targetLoad, repRange, targetRir } = input;
  if (reps == null || rir == null) {
    return null;
  }

  const isAbovePrescribedLoad =
    actualLoad != null &&
    targetLoad != null &&
    Number.isFinite(actualLoad) &&
    Number.isFinite(targetLoad) &&
    actualLoad > targetLoad + LOAD_EPSILON;

  if (reps >= repRange.max && rir >= targetRir + 1) {
    return { action: "increase", message: "Set felt easier than target. Consider +2.5 lbs for next set." };
  }

  if (reps < repRange.min && rir <= targetRir - 1) {
    if (isAbovePrescribedLoad) {
      return {
        action: "decrease",
        message: "Heavier load overshot the target. Drop back toward the prescribed load.",
      };
    }
    return { action: "decrease", message: "Set was harder than target. Consider -2.5 lbs or -1 rep." };
  }

  if (isAbovePrescribedLoad) {
    if (rir >= targetRir) {
      return {
        action: "hold",
        message:
          "You're above the prescribed load. Keep it if technique stays stable; formal progression is evaluated across the full session.",
      };
    }
    return {
      action: "hold",
      message: "You're above the prescribed load, but effort is climbing. Keep it only if technique stays stable.",
    };
  }

  return { action: "hold", message: "Hold load and target cleaner reps before increasing." };
}
