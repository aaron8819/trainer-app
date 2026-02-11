const SPLIT_LABELS = {
  PPL: "PPL",
  UPPER_LOWER: "Upper/Lower",
  FULL_BODY: "Full Body",
  CUSTOM: "Custom",
} as const;

type ProfileSplitType = keyof typeof SPLIT_LABELS;

function normalizeDays(daysPerWeek: number | undefined): number {
  if (!Number.isFinite(daysPerWeek)) {
    return 0;
  }
  return Math.min(Math.max(Math.round(daysPerWeek ?? 0), 0), 7);
}

function recommendedSplits(daysPerWeek: number): ProfileSplitType[] {
  if (daysPerWeek <= 2) {
    return ["FULL_BODY"];
  }
  if (daysPerWeek === 3) {
    return ["FULL_BODY", "UPPER_LOWER"];
  }
  if (daysPerWeek === 4) {
    return ["UPPER_LOWER"];
  }
  return ["PPL", "UPPER_LOWER"];
}

function formatRecommendedSplits(splits: ProfileSplitType[]): string {
  return splits.map((split) => SPLIT_LABELS[split]).join(" or ");
}

function describeFrequency(splitType: ProfileSplitType, daysPerWeek: number): string {
  if (splitType === "PPL") {
    if (daysPerWeek <= 3) {
      return "once per week";
    }
    return `about ${(daysPerWeek / 3).toFixed(1)}x per week`;
  }
  if (splitType === "UPPER_LOWER") {
    return `about ${(daysPerWeek / 2).toFixed(1)}x per week`;
  }
  if (splitType === "FULL_BODY") {
    return `${daysPerWeek}x per week`;
  }
  return "at a variable frequency";
}

export function getSplitMismatchWarning(
  daysPerWeek: number | undefined,
  splitType: ProfileSplitType | undefined
): string | null {
  if (!splitType || splitType === "CUSTOM") {
    return null;
  }

  const normalizedDays = normalizeDays(daysPerWeek);
  if (normalizedDays <= 0) {
    return null;
  }

  const recommended = recommendedSplits(normalizedDays);
  if (recommended.includes(splitType)) {
    return null;
  }

  const recommendedLabel = formatRecommendedSplits(recommended);
  const splitLabel = SPLIT_LABELS[splitType];
  const frequency = describeFrequency(splitType, normalizedDays);

  return `${splitLabel} with ${normalizedDays} days/week trains each muscle ${frequency}. Consider ${recommendedLabel} for better weekly frequency.`;
}
