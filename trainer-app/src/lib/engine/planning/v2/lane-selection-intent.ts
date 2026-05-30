export type V2LaneSelectionIntentLaneJob =
  | "anchor_overload"
  | "direct_floor"
  | "support_coverage";

export type V2LaneSelectionIntentMovementPattern =
  | "calf_raise"
  | "chest_press"
  | "elbow_extension"
  | "elbow_flexion"
  | "horizontal_pull"
  | "knee_extension"
  | "knee_flexion"
  | "rear_delt_fly"
  | "shoulder_abduction"
  | "shoulder_horizontal_abduction"
  | "vertical_pull";

export type V2LaneSelectionIntentExerciseClass =
  | "back_extension"
  | "biceps_isolation"
  | "calf_isolation"
  | "chest_biased_press_support"
  | "chest_press"
  | "chin_up"
  | "hamstring_curl"
  | "hinge"
  | "hip_thrust"
  | "lateral_raise"
  | "leg_press"
  | "lunge"
  | "pullover"
  | "quad_isolation"
  | "rear_delt_isolation"
  | "row"
  | "row_only"
  | "shoulder_biased_press"
  | "shrug"
  | "squat_pattern"
  | "straight_arm_pulldown"
  | "triceps_isolation"
  | "vertical_press"
  | "vertical_pull";

export type V2LaneSelectionIntentDirectnessRequirement =
  | "direct_only"
  | "direct_or_high_support"
  | "high_directness";

export type V2LaneSelectionIntentStabilityPreference =
  | "stable_preferred";

export type V2LaneSelectionIntentFatiguePreference =
  | "low_axial"
  | "low_systemic"
  | "moderate_or_low";

export type V2LaneSelectionIntentLoadabilityPreference =
  | "high"
  | "moderate_or_high";

export type V2LaneSelectionIntentDuplicatePolicy =
  | "allow_duplicate_if_only_clean_option"
  | "prefer_variation_if_clean";

export type V2LaneSelectionIntentCapacityPriority =
  | "floor_critical"
  | "high"
  | "normal";

export type V2LaneSelectionIntentFallbackPolicy =
  | "allow_duplicate_if_only_clean_option"
  | "allow_labeled_fallback"
  | "block_if_floor_critical"
  | "block_if_no_true_vertical_pull";

export type V2LaneSelectionIntentIdentityPreservationMode =
  | "preserve_lane_job"
  | "variation_allowed_within_lane_job";

export type V2LaneSelectionIntentV0 = {
  version: 0;
  source: "v2_planner_policy";
  contract: "laneSelectionIntent";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByMaterializer: boolean;
  laneJob: V2LaneSelectionIntentLaneJob;
  requiredMovementPattern: V2LaneSelectionIntentMovementPattern;
  preferredMovementPatterns?: V2LaneSelectionIntentMovementPattern[];
  allowedExerciseClasses: V2LaneSelectionIntentExerciseClass[];
  disallowedExerciseClasses?: V2LaneSelectionIntentExerciseClass[];
  directnessRequirement: V2LaneSelectionIntentDirectnessRequirement;
  minimumTargetStimulus?: {
    muscle: string;
    minimumPerSetStimulus: number;
  };
  stabilityPreference?: V2LaneSelectionIntentStabilityPreference;
  fatiguePreference?: V2LaneSelectionIntentFatiguePreference;
  loadabilityPreference?: V2LaneSelectionIntentLoadabilityPreference;
  duplicatePolicy?: V2LaneSelectionIntentDuplicatePolicy;
  capacityPriority: V2LaneSelectionIntentCapacityPriority;
  fallbackPolicy: V2LaneSelectionIntentFallbackPolicy;
  identityPreservationMode: V2LaneSelectionIntentIdentityPreservationMode;
};

export type V2LaneSelectionIntentV0Field = Exclude<
  keyof V2LaneSelectionIntentV0,
  | "version"
  | "source"
  | "contract"
  | "readOnly"
  | "affectsScoringOrGeneration"
  | "consumedByMaterializer"
>;

export const V2_LANE_SELECTION_INTENT_V0_FIELD_REQUIREMENTS: Record<
  V2LaneSelectionIntentV0Field,
  "required" | "optional"
> = {
  laneJob: "required",
  requiredMovementPattern: "required",
  preferredMovementPatterns: "optional",
  allowedExerciseClasses: "required",
  disallowedExerciseClasses: "optional",
  directnessRequirement: "required",
  minimumTargetStimulus: "optional",
  stabilityPreference: "optional",
  fatiguePreference: "optional",
  loadabilityPreference: "optional",
  duplicatePolicy: "optional",
  capacityPriority: "required",
  fallbackPolicy: "required",
  identityPreservationMode: "required",
};

type LaneSelectionIntentSourceLane = {
  laneId: string;
  role: string;
  primaryMuscles: string[];
  supportMuscles: string[];
  acceptableExerciseClasses: string[];
  preferredExerciseClasses: string[];
  directFloor?: {
    muscle: string;
    requiredExerciseClasses: string[];
  };
};

type LaneSelectionIntentConsumptionLane = {
  laneId: string;
  laneSelectionIntent?: V2LaneSelectionIntentV0;
};

function baseIntent(
  input: Omit<
    V2LaneSelectionIntentV0,
    | "version"
    | "source"
    | "contract"
    | "readOnly"
    | "affectsScoringOrGeneration"
    | "consumedByMaterializer"
  >,
  options: { consumedByMaterializer?: boolean } = {},
): V2LaneSelectionIntentV0 {
  return {
    version: 0,
    source: "v2_planner_policy",
    contract: "laneSelectionIntent",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByMaterializer: options.consumedByMaterializer ?? false,
    ...input,
  };
}

function hasMuscle(lane: LaneSelectionIntentSourceLane, muscle: string): boolean {
  return [...lane.primaryMuscles, ...lane.supportMuscles].includes(muscle);
}

function hasClass(
  lane: LaneSelectionIntentSourceLane,
  exerciseClass: string,
): boolean {
  return [
    ...lane.acceptableExerciseClasses,
    ...lane.preferredExerciseClasses,
    ...(lane.directFloor?.requiredExerciseClasses ?? []),
  ].includes(exerciseClass);
}

function isChestBiasedPressSupportLane(
  lane: LaneSelectionIntentSourceLane,
): boolean {
  return (
    lane.laneId === "chest_biased_press_support" ||
    (lane.laneId === "vertical_press" &&
      hasMuscle(lane, "Chest") &&
      hasClass(lane, "vertical_press") &&
      (hasClass(lane, "distinct_chest_press_or_fly") ||
        hasClass(lane, "machine_press") ||
        hasClass(lane, "cable_press")))
  );
}

function isHamstringCurlLane(lane: LaneSelectionIntentSourceLane): boolean {
  return (
    lane.laneId === "hamstring_curl" ||
    lane.laneId === "knee_flexion_curl" ||
    hasClass(lane, "hamstring_curl")
  );
}

function isTricepsDirectLane(lane: LaneSelectionIntentSourceLane): boolean {
  return lane.laneId === "triceps" || lane.laneId.includes("triceps");
}

function isBicepsDirectLane(lane: LaneSelectionIntentSourceLane): boolean {
  return lane.laneId === "biceps" || lane.laneId.includes("biceps");
}

export function buildV2LaneSelectionIntentV0ForPlanLane(
  lane: LaneSelectionIntentSourceLane,
): V2LaneSelectionIntentV0 | undefined {
  if (isChestBiasedPressSupportLane(lane)) {
    return baseIntent(
      {
        laneJob: "support_coverage",
        requiredMovementPattern: "chest_press",
        allowedExerciseClasses: ["chest_press", "chest_biased_press_support"],
        disallowedExerciseClasses: ["shoulder_biased_press"],
        directnessRequirement: "high_directness",
        minimumTargetStimulus: {
          muscle: "Chest",
          minimumPerSetStimulus: 0.75,
        },
        stabilityPreference: "stable_preferred",
        fatiguePreference: "moderate_or_low",
        duplicatePolicy: "prefer_variation_if_clean",
        capacityPriority: "high",
        fallbackPolicy: "allow_labeled_fallback",
        identityPreservationMode: "variation_allowed_within_lane_job",
      },
      { consumedByMaterializer: true },
    );
  }

  if (lane.laneId === "vertical_pull_anchor") {
    return baseIntent(
      {
        laneJob: "anchor_overload",
        requiredMovementPattern: "vertical_pull",
        allowedExerciseClasses: ["vertical_pull"],
        disallowedExerciseClasses: ["row", "pullover", "straight_arm_pulldown"],
        directnessRequirement: "direct_only",
        minimumTargetStimulus: {
          muscle: "Lats",
          minimumPerSetStimulus: 0.75,
        },
        loadabilityPreference: "high",
        capacityPriority: "floor_critical",
        fallbackPolicy: "block_if_no_true_vertical_pull",
        identityPreservationMode: "preserve_lane_job",
      },
      { consumedByMaterializer: true },
    );
  }

  if (isHamstringCurlLane(lane)) {
    return baseIntent({
      laneJob: "direct_floor",
      requiredMovementPattern: "knee_flexion",
      allowedExerciseClasses: ["hamstring_curl"],
      disallowedExerciseClasses: ["hinge", "back_extension", "hip_thrust"],
      directnessRequirement: "direct_only",
      fatiguePreference: "low_axial",
      capacityPriority: "floor_critical",
      fallbackPolicy: "block_if_floor_critical",
      identityPreservationMode: "variation_allowed_within_lane_job",
    }, { consumedByMaterializer: lane.laneId === "hamstring_curl" });
  }

  if (lane.laneId === "quad_isolation") {
    return baseIntent(
      {
        laneJob: "direct_floor",
        requiredMovementPattern: "knee_extension",
        allowedExerciseClasses: ["quad_isolation"],
        disallowedExerciseClasses: ["squat_pattern", "lunge", "leg_press"],
        directnessRequirement: "direct_only",
        fatiguePreference: "low_systemic",
        capacityPriority: "floor_critical",
        fallbackPolicy: "block_if_floor_critical",
        identityPreservationMode: "variation_allowed_within_lane_job",
      },
      { consumedByMaterializer: true },
    );
  }

  if (lane.laneId === "calves") {
    return baseIntent(
      {
        laneJob: "direct_floor",
        requiredMovementPattern: "calf_raise",
        allowedExerciseClasses: ["calf_isolation"],
        directnessRequirement: "direct_only",
        duplicatePolicy: "prefer_variation_if_clean",
        capacityPriority: "floor_critical",
        fallbackPolicy: "allow_duplicate_if_only_clean_option",
        identityPreservationMode: "variation_allowed_within_lane_job",
      },
      { consumedByMaterializer: true },
    );
  }

  if (lane.laneId === "side_delt_isolation") {
    return baseIntent(
      {
        laneJob: "direct_floor",
        requiredMovementPattern: "shoulder_abduction",
        allowedExerciseClasses: ["lateral_raise"],
        disallowedExerciseClasses: ["vertical_press"],
        directnessRequirement: "direct_only",
        duplicatePolicy: "prefer_variation_if_clean",
        capacityPriority: "floor_critical",
        fallbackPolicy: "block_if_floor_critical",
        identityPreservationMode: "variation_allowed_within_lane_job",
      },
      { consumedByMaterializer: true },
    );
  }

  if (lane.laneId === "rear_delt") {
    return baseIntent(
      {
        laneJob: "direct_floor",
        requiredMovementPattern: "rear_delt_fly",
        preferredMovementPatterns: ["shoulder_horizontal_abduction"],
        allowedExerciseClasses: ["rear_delt_isolation"],
        disallowedExerciseClasses: ["row_only"],
        directnessRequirement: "direct_only",
        capacityPriority: "floor_critical",
        fallbackPolicy: "block_if_floor_critical",
        identityPreservationMode: "variation_allowed_within_lane_job",
      },
      { consumedByMaterializer: true },
    );
  }

  if (isTricepsDirectLane(lane)) {
    return baseIntent(
      {
        laneJob: "direct_floor",
        requiredMovementPattern: "elbow_extension",
        allowedExerciseClasses: ["triceps_isolation"],
        disallowedExerciseClasses: ["chest_press", "vertical_press"],
        directnessRequirement: "direct_only",
        duplicatePolicy: "prefer_variation_if_clean",
        capacityPriority: "floor_critical",
        fallbackPolicy: "block_if_floor_critical",
        identityPreservationMode: "variation_allowed_within_lane_job",
      },
      { consumedByMaterializer: lane.laneId === "triceps" },
    );
  }

  if (isBicepsDirectLane(lane)) {
    return baseIntent({
      laneJob: "direct_floor",
      requiredMovementPattern: "elbow_flexion",
      allowedExerciseClasses: ["biceps_isolation"],
      disallowedExerciseClasses: ["row", "chin_up"],
      directnessRequirement: "direct_only",
      duplicatePolicy: "prefer_variation_if_clean",
      capacityPriority: "floor_critical",
      fallbackPolicy: "block_if_floor_critical",
      identityPreservationMode: "variation_allowed_within_lane_job",
    });
  }

  if (lane.laneId === "row_support") {
    return baseIntent(
      {
        laneJob: "support_coverage",
        requiredMovementPattern: "horizontal_pull",
        allowedExerciseClasses: ["row"],
        disallowedExerciseClasses: ["shrug", "vertical_pull", "pullover"],
        directnessRequirement: "direct_or_high_support",
        loadabilityPreference: "moderate_or_high",
        capacityPriority: "high",
        fallbackPolicy: "allow_labeled_fallback",
        identityPreservationMode: "preserve_lane_job",
      },
      { consumedByMaterializer: true },
    );
  }

  return undefined;
}

export function isV2LaneSelectionIntentConsumedByMaterializer(
  lane: LaneSelectionIntentConsumptionLane,
): boolean {
  const intent = lane.laneSelectionIntent;
  if (
    !intent ||
    intent.version !== 0 ||
    intent.source !== "v2_planner_policy" ||
    intent.contract !== "laneSelectionIntent"
  ) {
    return false;
  }

  if (
    lane.laneId === "vertical_pull_anchor" &&
    intent.requiredMovementPattern === "vertical_pull"
  ) {
    return true;
  }

  if (
    lane.laneId === "hamstring_curl" &&
    intent.requiredMovementPattern === "knee_flexion" &&
    intent.allowedExerciseClasses.includes("hamstring_curl")
  ) {
    return true;
  }

  if (
    lane.laneId === "calves" &&
    intent.requiredMovementPattern === "calf_raise" &&
    intent.allowedExerciseClasses.includes("calf_isolation")
  ) {
    return true;
  }

  if (
    lane.laneId === "side_delt_isolation" &&
    intent.requiredMovementPattern === "shoulder_abduction" &&
    intent.allowedExerciseClasses.includes("lateral_raise")
  ) {
    return true;
  }

  if (
    lane.laneId === "triceps" &&
    intent.requiredMovementPattern === "elbow_extension" &&
    intent.allowedExerciseClasses.includes("triceps_isolation")
  ) {
    return true;
  }

  if (
    lane.laneId === "rear_delt" &&
    (intent.requiredMovementPattern === "rear_delt_fly" ||
      intent.requiredMovementPattern === "shoulder_horizontal_abduction") &&
    intent.allowedExerciseClasses.includes("rear_delt_isolation")
  ) {
    return true;
  }

  if (
    lane.laneId === "row_support" &&
    intent.requiredMovementPattern === "horizontal_pull" &&
    intent.allowedExerciseClasses.includes("row")
  ) {
    return true;
  }

  if (
    lane.laneId === "quad_isolation" &&
    intent.requiredMovementPattern === "knee_extension" &&
    intent.allowedExerciseClasses.includes("quad_isolation")
  ) {
    return true;
  }

  return (
    (lane.laneId === "vertical_press" ||
      lane.laneId === "chest_biased_press_support") &&
    intent.requiredMovementPattern === "chest_press" &&
    intent.allowedExerciseClasses.includes("chest_biased_press_support")
  );
}
