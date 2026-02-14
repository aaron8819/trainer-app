type SelectionStep = "pin" | "anchor" | "main_pick" | "accessory_pick";

export type ExplainabilityRationaleEntry = {
  score: number;
  components: Record<string, number>;
  hardFilterPass: boolean;
  selectedStep: SelectionStep;
};

export type ExplainabilitySelectionMetadata = {
  rationale?: Record<string, ExplainabilityRationaleEntry>;
  selectedExerciseIds?: string[];
  perExerciseSetTargets?: Record<string, number>;
  adaptiveDeloadApplied?: boolean;
  periodizationWeek?: number;
};

type DriverLabel =
  | "pins"
  | "continuity"
  | "deficit_fill"
  | "time_fit"
  | "recovery_aware"
  | "balanced";

const STEP_LABELS: Record<SelectionStep, string> = {
  pin: "Pinned",
  anchor: "Continuity",
  main_pick: "Main pick",
  accessory_pick: "Accessory pick",
};

const COMPONENT_LABELS: Record<string, string> = {
  pinned: "Pinned by you",
  continuityScore: "Keeps continuity with recent sessions",
  muscleDeficitScore: "Closes a muscle-volume gap",
  targetednessScore: "Targets high-priority muscles",
  preferenceScore: "Matches your preferences",
  movementDiversityScore: "Improves movement variety",
  timeFitScore: "Fits your session time budget",
  sfrScore: "High stimulus-to-fatigue efficiency",
  lengthenedScore: "Strong lengthened-position stimulus",
  recencyPenalty: "Recently performed (slight penalty)",
  redundancyPenalty: "Overlaps with selected movements (penalty)",
  fatigueCostPenalty: "Higher fatigue cost (penalty)",
  starterTargetHits: "Hits intent target muscles",
  starterSafety: "Lower joint-stress option",
  starterFatiguePenalty: "Lower startup fatigue",
};

export const TEMPLATE_METRIC_HELP: Record<string, string> = {
  "Muscle Coverage": "How well exercises cover target muscles for this intent.",
  "Push/Pull Balance": "Balance between pushing and pulling volume in the session.",
  "Compound/Isolation": "Healthy mix of big lifts and focused isolation work.",
  "Movement Diversity": "Variety across movement patterns to reduce redundancy.",
  "Stretch Position": "Coverage of exercises that train muscles in lengthened positions.",
  "Fatigue Efficiency": "Expected stimulus relative to fatigue cost across selections.",
  "Exercise Order": "Whether higher-priority lifts appear early in the session.",
};

export const EXERCISE_ATTRIBUTE_HELP: Record<string, string> = {
  "SFR Score": "Stimulus-to-Fatigue Ratio. Higher means more growth stimulus per unit of fatigue.",
  "Lengthened Position": "How strongly this exercise loads muscles at longer lengths.",
  "Joint Stress": "Estimated joint demand. Lower is usually easier to recover from.",
  "Fatigue Cost": "Expected systemic fatigue. Higher values may require more recovery.",
};

export function parseExplainabilitySelectionMetadata(
  value: unknown
): ExplainabilitySelectionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const parsed = value as Record<string, unknown>;
  const rationale =
    parsed.rationale && typeof parsed.rationale === "object" && !Array.isArray(parsed.rationale)
      ? (parsed.rationale as Record<string, ExplainabilityRationaleEntry>)
      : undefined;
  const selectedExerciseIds = Array.isArray(parsed.selectedExerciseIds)
    ? parsed.selectedExerciseIds.filter((id): id is string => typeof id === "string")
    : undefined;
  const perExerciseSetTargets =
    parsed.perExerciseSetTargets &&
    typeof parsed.perExerciseSetTargets === "object" &&
    !Array.isArray(parsed.perExerciseSetTargets)
      ? (parsed.perExerciseSetTargets as Record<string, number>)
      : undefined;
  const adaptiveDeloadApplied = parsed.adaptiveDeloadApplied === true;
  const periodizationWeek =
    typeof parsed.periodizationWeek === "number" && Number.isFinite(parsed.periodizationWeek)
      ? parsed.periodizationWeek
      : undefined;

  return {
    rationale,
    selectedExerciseIds,
    perExerciseSetTargets,
    adaptiveDeloadApplied,
    periodizationWeek,
  };
}

export function getSelectionStepLabel(step: SelectionStep | undefined): string {
  if (!step) {
    return "Selected";
  }
  return STEP_LABELS[step] ?? "Selected";
}

export function getTopComponentLabels(
  components: Record<string, number> | undefined,
  limit = 2
): string[] {
  if (!components) {
    return [];
  }
  return Object.entries(components)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key]) => COMPONENT_LABELS[key] ?? key);
}

export function summarizeSelectionDrivers(
  rationale: Record<string, ExplainabilityRationaleEntry> | undefined
): { primaryDriver: DriverLabel; countsByStep: Record<SelectionStep, number> } {
  const countsByStep: Record<SelectionStep, number> = {
    pin: 0,
    anchor: 0,
    main_pick: 0,
    accessory_pick: 0,
  };
  const componentTotals: Record<string, number> = {};

  for (const entry of Object.values(rationale ?? {})) {
    countsByStep[entry.selectedStep] += 1;
    for (const [name, value] of Object.entries(entry.components ?? {})) {
      componentTotals[name] = (componentTotals[name] ?? 0) + value;
    }
  }

  const drivers: Array<{ key: DriverLabel; score: number }> = [
    { key: "pins", score: countsByStep.pin + (componentTotals.pinned ?? 0) },
    { key: "continuity", score: countsByStep.anchor + (componentTotals.continuityScore ?? 0) },
    { key: "deficit_fill", score: componentTotals.muscleDeficitScore ?? 0 },
    { key: "time_fit", score: componentTotals.timeFitScore ?? 0 },
    { key: "recovery_aware", score: componentTotals.fatigueCostPenalty ?? 0 },
  ];
  drivers.sort((a, b) => b.score - a.score);

  return {
    primaryDriver: drivers[0]?.score > 0 ? drivers[0].key : "balanced",
    countsByStep,
  };
}

export function describePrimaryDriver(driver: DriverLabel): string {
  switch (driver) {
    case "pins":
      return "Selection prioritized exercises you pinned.";
    case "continuity":
      return "Selection prioritized continuity from recent sessions.";
    case "deficit_fill":
      return "Selection prioritized muscles below target weekly volume.";
    case "time_fit":
      return "Selection prioritized options that fit your time budget.";
    case "recovery_aware":
      return "Selection balanced fatigue and recovery constraints.";
    default:
      return "Selection balanced multiple training factors.";
  }
}
