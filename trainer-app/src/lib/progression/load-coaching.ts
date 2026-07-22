export type LoadRecommendationInput = {
  reps?: number | null;
  rir?: number | null;
  actualLoad?: number | null;
  targetLoad?: number | null;
  repRange: { min: number; max: number };
  targetRir: number;
  loadIncrement?: number;
};

export type LoadRecommendation =
  | { action: "increase"; suggestedLoad: number; message: string }
  | { action: "decrease"; suggestedLoad: number; message: string }
  | { action: "hold"; suggestedLoad: number; message: string };

const LOAD_EPSILON = 1e-6;

export function getLoadRecommendation(input: LoadRecommendationInput): LoadRecommendation | null {
  const { reps, rir, actualLoad, targetLoad, repRange, targetRir } = input;
  const currentLoad = resolveCurrentLoad(actualLoad, targetLoad);
  if (reps == null || rir == null || currentLoad == null) {
    return null;
  }
  const increment = resolveIncrement(input.loadIncrement);

  const isAbovePrescribedLoad =
    actualLoad != null &&
    targetLoad != null &&
    Number.isFinite(actualLoad) &&
    Number.isFinite(targetLoad) &&
    actualLoad > targetLoad + LOAD_EPSILON;

  if (reps >= repRange.max && rir >= targetRir + 1) {
    const suggestedLoad = currentLoad + increment;
    return {
      action: "increase",
      suggestedLoad,
      message: `Set clearly beat the target. Consider ${formatLoad(suggestedLoad)} lbs for the next set (+${formatLoad(increment)}).`,
    };
  }

  if (reps < repRange.min || rir <= targetRir - 1) {
    const suggestedLoad = Math.max(0, currentLoad - increment);
    if (isAbovePrescribedLoad) {
      return {
        action: "decrease",
        suggestedLoad,
        message: `The set overshot the target. Consider ${formatLoad(suggestedLoad)} lbs for the next set (-${formatLoad(increment)}).`,
      };
    }
    return {
      action: "decrease",
      suggestedLoad,
      message: `Set was harder than target. Consider ${formatLoad(suggestedLoad)} lbs for the next set (-${formatLoad(increment)}).`,
    };
  }

  if (isAbovePrescribedLoad) {
    if (rir >= targetRir) {
      return {
        action: "hold",
        suggestedLoad: currentLoad,
        message:
          "You're above the prescribed load. Keep it if technique stays stable; formal progression is evaluated across the full session.",
      };
    }
    return {
      action: "hold",
      suggestedLoad: currentLoad,
      message: "You're above the prescribed load, but effort is climbing. Keep it only if technique stays stable.",
    };
  }

  return {
    action: "hold",
    suggestedLoad: currentLoad,
    message: `Hold at ${formatLoad(currentLoad)} lbs and target cleaner reps before increasing.`,
  };
}

function resolveCurrentLoad(actualLoad?: number | null, targetLoad?: number | null): number | null {
  if (Number.isFinite(actualLoad) && (actualLoad ?? 0) >= 0) return actualLoad as number;
  if (Number.isFinite(targetLoad) && (targetLoad ?? 0) >= 0) return targetLoad as number;
  return null;
}

function resolveIncrement(increment?: number): number {
  return Number.isFinite(increment) && (increment ?? 0) > 0 ? (increment as number) : 2.5;
}

function formatLoad(load: number): string {
  return Number.isInteger(load) ? load.toFixed(0) : load.toFixed(1);
}
