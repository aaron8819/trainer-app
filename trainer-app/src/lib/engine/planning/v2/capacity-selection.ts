import type { V2DirectVolumeCapacityProfileId } from "./direct-volume-policy";

export const V2_CAPACITY_PRODUCT_CHOICES = [
  "efficient",
  "balanced",
  "full",
] as const;

export type V2CapacityProductChoice =
  (typeof V2_CAPACITY_PRODUCT_CHOICES)[number];

export const V2_CAPACITY_TIME_PRIORITIES = [
  "strict_45",
  "flexible_45_60",
  "full_60_plus_high_volume",
] as const;

export type V2CapacityTimePriority =
  (typeof V2_CAPACITY_TIME_PRIORITIES)[number];

export type V2CapacityTrainingAge =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "unknown";

export type V2CapacityRecoveryTolerance = "low" | "normal" | "high";

export type V2CapacityRecommendation = {
  choice: V2CapacityProductChoice;
  reason: string;
};

export type V2CapacitySelectionExplanation = {
  productChoice: V2CapacityProductChoice;
  internalProfileId: V2DirectVolumeCapacityProfileId;
  recommendationReason: string;
  recommendationAccepted: boolean;
  representativeProfileSummary: string;
  durationDisclaimer: string;
};

export const V2_CAPACITY_DURATION_DISCLAIMER =
  "Session duration is a planning priority, not an exact guarantee. Representative workload can vary when protected roles or direct floors require it.";

export const V2_CAPACITY_PRODUCT_OPTIONS: ReadonlyArray<{
  id: V2CapacityProductChoice;
  label: string;
  sessionPriority: string;
  volumeSummary: string;
  protectionSummary: string;
}> = [
  {
    id: "efficient",
    label: "Efficient",
    sessionPriority: "Approximately 45-minute priority",
    volumeSummary: "Lowest valid accessory volume",
    protectionSummary: "Protected major roles and direct floors remain",
  },
  {
    id: "balanced",
    label: "Balanced",
    sessionPriority: "Flexible 45–60-minute sessions",
    volumeSummary: "Moderate accessory volume",
    protectionSummary: "Default recommendation when no stricter preference applies",
  },
  {
    id: "full",
    label: "Full",
    sessionPriority: "60+ minute priority",
    volumeSummary: "Highest implemented accessory volume",
    protectionSummary: "For an explicit high-volume choice with sufficient recovery",
  },
] as const;

const REPRESENTATIVE_PROFILE_SUMMARY: Record<
  V2CapacityProductChoice,
  string
> = {
  efficient:
    "Representative Week 2 workload: about 50 direct sets across 17 exercises, while retaining protected major roles and direct floors.",
  balanced:
    "Representative Week 2 workload: about 59 direct sets across 19 exercises for a flexible session-time priority.",
  full:
    "Representative Week 2 workload: about 67 direct sets across 21 exercises for an explicit high-volume choice.",
};

function assertNever(value: never): never {
  throw new Error(`Unsupported V2 capacity product choice: ${String(value)}`);
}

export function mapV2CapacityChoiceToProfile(
  choice: V2CapacityProductChoice,
): V2DirectVolumeCapacityProfileId {
  switch (choice) {
    case "efficient":
      return "minimal";
    case "balanced":
      return "moderate";
    case "full":
      return "preferred";
    default:
      return assertNever(choice);
  }
}

export function recommendV2CapacityChoice(input: {
  supportedFourDayUpperLower: boolean;
  timePriority?: V2CapacityTimePriority;
  trainingAge?: V2CapacityTrainingAge;
  recoveryTolerance?: V2CapacityRecoveryTolerance;
}): V2CapacityRecommendation | null {
  if (!input.supportedFourDayUpperLower) {
    return null;
  }

  const timePriority = input.timePriority ?? "flexible_45_60";
  if (timePriority === "strict_45") {
    return {
      choice: "efficient",
      reason:
        "Recommended because you prioritize approximately 45-minute sessions. It keeps protected hamstring, calf, delt, and triceps work while yielding optional volume first.",
    };
  }

  const fullEligible =
    timePriority === "full_60_plus_high_volume" &&
    (input.trainingAge === "intermediate" ||
      input.trainingAge === "advanced") &&
    (input.recoveryTolerance === "normal" ||
      input.recoveryTolerance === "high");

  if (fullEligible) {
    return {
      choice: "full",
      reason:
        "Recommended because you allow 60+ minute sessions, prefer high volume, and have the experience and recovery room for it.",
    };
  }

  return {
    choice: "balanced",
    reason:
      "Recommended because you did not set a strict 45-minute limit or request the full high-volume plan.",
  };
}

export function buildV2CapacitySelectionExplanation(input: {
  productChoice: V2CapacityProductChoice;
  recommendation: V2CapacityRecommendation;
}): V2CapacitySelectionExplanation {
  return {
    productChoice: input.productChoice,
    internalProfileId: mapV2CapacityChoiceToProfile(input.productChoice),
    recommendationReason: input.recommendation.reason,
    recommendationAccepted:
      input.productChoice === input.recommendation.choice,
    representativeProfileSummary:
      REPRESENTATIVE_PROFILE_SUMMARY[input.productChoice],
    durationDisclaimer: V2_CAPACITY_DURATION_DISCLAIMER,
  };
}

export function isSupportedV2CapacityTopology(input: {
  splitType: string;
  sessionsPerWeek: number;
  daysPerWeek: number;
  slots: ReadonlyArray<{ intent: string }>;
}): boolean {
  return (
    input.splitType === "UPPER_LOWER" &&
    input.sessionsPerWeek === 4 &&
    input.daysPerWeek === 4 &&
    input.slots.length === 4 &&
    input.slots.map((slot) => slot.intent).join("|") ===
      "UPPER|LOWER|UPPER|LOWER"
  );
}
