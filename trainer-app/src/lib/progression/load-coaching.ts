export type LoadRecommendationInput = {
  reps?: number | null;
  rir?: number | null;
  repRange: { min: number; max: number };
  targetRir: number;
};

export type LoadRecommendation =
  | { action: "increase"; message: string }
  | { action: "decrease"; message: string }
  | { action: "hold"; message: string };

export function getLoadRecommendation(input: LoadRecommendationInput): LoadRecommendation | null {
  const { reps, rir, repRange, targetRir } = input;
  if (reps == null || rir == null) {
    return null;
  }

  if (reps >= repRange.max && rir >= targetRir + 1) {
    return { action: "increase", message: "Set felt easier than target. Consider +2.5 lbs for next set." };
  }

  if (reps < repRange.min && rir <= targetRir - 1) {
    return { action: "decrease", message: "Set was harder than target. Consider -2.5 lbs or -1 rep." };
  }

  return { action: "hold", message: "Hold load and target cleaner reps before increasing." };
}
