import type {
  V2LaneSelectionIntentDirectnessRequirement,
  V2LaneSelectionIntentDuplicatePolicy,
  V2LaneSelectionIntentExerciseClass,
  V2LaneSelectionIntentFallbackPolicy,
  V2LaneSelectionIntentFatiguePreference,
  V2LaneSelectionIntentIdentityPreservationMode,
  V2LaneSelectionIntentLaneJob,
  V2LaneSelectionIntentLoadabilityPreference,
  V2LaneSelectionIntentMovementPattern,
  V2LaneSelectionIntentStabilityPreference,
  V2LaneSelectionIntentV0,
} from "./lane-selection-intent";

type LaneSelectionIntentBenchmarkAuditInput = {
  lanes: Array<{
    slotId: string;
    laneId: string;
    consumedByMaterializer: boolean;
    proposedLaneSelectionIntent?: V2LaneSelectionIntentV0;
  }>;
};

export type V2LaneSelectionIntentBenchmarkLaneJob =
  | "calf_direct"
  | "hamstring_curl"
  | "side_delt_direct"
  | "rear_delt_direct"
  | "chest_biased_press_support"
  | "vertical_pull_anchor"
  | "low_axial_hip_extension";

export type V2LaneSelectionIntentBenchmarkStatus =
  | "pass"
  | "warning"
  | "fail"
  | "missing_evidence";

type BenchmarkLaneExpectation = {
  laneJob: V2LaneSelectionIntentBenchmarkLaneJob;
  slotId: string;
  laneId: string;
  required: boolean;
  expected: {
    laneJob?: V2LaneSelectionIntentLaneJob;
    requiredMovementPattern?: V2LaneSelectionIntentMovementPattern;
    preferredMovementPatterns?: V2LaneSelectionIntentMovementPattern[];
    allowedExerciseClasses?: V2LaneSelectionIntentExerciseClass[];
    disallowedExerciseClasses?: V2LaneSelectionIntentExerciseClass[];
    directnessRequirement?: V2LaneSelectionIntentDirectnessRequirement;
    minimumTargetStimulus?: V2LaneSelectionIntentV0["minimumTargetStimulus"];
    stabilityPreference?: V2LaneSelectionIntentStabilityPreference;
    fatiguePreference?: V2LaneSelectionIntentFatiguePreference;
    loadabilityPreference?: V2LaneSelectionIntentLoadabilityPreference;
    duplicatePolicy?: V2LaneSelectionIntentDuplicatePolicy;
    fallbackPolicy?: V2LaneSelectionIntentFallbackPolicy;
    identityPreservationMode?: V2LaneSelectionIntentIdentityPreservationMode;
  };
  coverageGaps?: {
    laneIntentContract?: string[];
    ontologyInventory?: string[];
  };
  failureMeaning: string;
};

const LOW_AXIAL_SUPPORT_COVERAGE_CONTRACT_GAPS = [
  "requiredRole=laneJob:support_coverage for optional lower_b posterior-chain support, not anchor_overload or direct_floor",
  "requiredMovementPattern=low_axial_hip_extension is not expressible in laneSelectionIntent v0 yet",
  "requiredExerciseClass=low_axial_hip_extension_anchor is not expressible in laneSelectionIntent v0 yet; current v0 can only proxy the family through allowedExerciseClasses=hip_thrust",
  "preferredPatterns=hip_thrust,glute_bridge,cable_pull_through,reverse_hyperextension when a clean variation exists",
  "allowedClasses=low_axial_hip_extension_anchor hip-thrust/bridge/pull-through/reverse-hyper family",
  "disallowedClasses=hinge_compound/hinge,knee_flexion_curl/hamstring_curl,back_extension,generic_glute_accessory",
  "stimulusExpectation=meaningful Glutes stimulus minimumTargetStimulus:Glutes:0.75; Hamstrings are support/collateral only and must not be delivered by adding Glute Bridge sets alone",
  "fatigueAndLoadability=low_axial fatiguePreference with moderate_or_high loadabilityPreference",
  "directness=direct_or_high_support hip-extension support, not generic same-muscle accessory work",
  "substitutionFamily=low_axial_hip_extension_family only; true hinges, hamstring curls, back extensions, and generic glute accessories are not equivalent substitutions",
  "duplicateFamily=low_axial_hip_extension_anchor family with prefer_variation_if_clean before same-family reuse",
  "failureMeaning=unresolved planner-owned lane-intent contract; keep diagnostic until a measured materializer projection proves value",
];

export type V2LaneSelectionIntentBenchmark = {
  version: 1;
  source: "v2_lane_selection_intent_benchmark";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  status: V2LaneSelectionIntentBenchmarkStatus;
  summary: {
    laneJobCount: number;
    passCount: number;
    warningCount: number;
    failCount: number;
    missingEvidenceCount: number;
    materializerConsumedCount: number;
    diagnosticOnlyCount: number;
  };
  lanes: Array<{
    laneJob: V2LaneSelectionIntentBenchmarkLaneJob;
    slotId: string;
    laneId: string;
    required: boolean;
    status: V2LaneSelectionIntentBenchmarkStatus;
    materializerConsumed: boolean;
    evidence: string[];
    missingEvidence: string[];
    coverageGaps: {
      laneIntentContract: string[];
      ontologyInventory: string[];
    };
    failureMeaning: string;
    nextSafeAction:
      | "no_action"
      | "complete_lane_selection_intent_contract"
      | "fix_lane_selection_intent_mismatch"
      | "keep_diagnostic_watch";
  }>;
};

type V2LaneSelectionIntentBenchmarkNextSafeAction =
  V2LaneSelectionIntentBenchmark["lanes"][number]["nextSafeAction"];

const HIGH_RISK_LANE_EXPECTATIONS: BenchmarkLaneExpectation[] = [
  {
    laneJob: "calf_direct",
    slotId: "lower_a",
    laneId: "calves",
    required: true,
    expected: {
      laneJob: "direct_floor",
      requiredMovementPattern: "calf_raise",
      allowedExerciseClasses: ["calf_isolation"],
      directnessRequirement: "direct_only",
      duplicatePolicy: "prefer_variation_if_clean",
      fallbackPolicy: "allow_duplicate_if_only_clean_option",
      identityPreservationMode: "variation_allowed_within_lane_job",
    },
    failureMeaning:
      "calf direct work can collapse into same-muscle duplicate or variant guesswork instead of a direct calf-raise job",
  },
  {
    laneJob: "hamstring_curl",
    slotId: "lower_a",
    laneId: "hamstring_curl",
    required: true,
    expected: {
      laneJob: "direct_floor",
      requiredMovementPattern: "knee_flexion",
      allowedExerciseClasses: ["hamstring_curl"],
      disallowedExerciseClasses: ["hinge", "back_extension", "hip_thrust"],
      directnessRequirement: "direct_only",
      fatiguePreference: "low_axial",
      fallbackPolicy: "block_if_floor_critical",
      identityPreservationMode: "variation_allowed_within_lane_job",
    },
    failureMeaning:
      "hamstring direct work can be replaced by hinge or back-extension collateral instead of knee-flexion curl stimulus",
  },
  {
    laneJob: "side_delt_direct",
    slotId: "upper_b",
    laneId: "side_delt_isolation",
    required: true,
    expected: {
      laneJob: "direct_floor",
      requiredMovementPattern: "shoulder_abduction",
      allowedExerciseClasses: ["lateral_raise"],
      disallowedExerciseClasses: ["vertical_press"],
      directnessRequirement: "direct_only",
      duplicatePolicy: "prefer_variation_if_clean",
      fallbackPolicy: "block_if_floor_critical",
      identityPreservationMode: "variation_allowed_within_lane_job",
    },
    failureMeaning:
      "side-delt floor work can be treated as press collateral instead of direct shoulder-abduction isolation",
  },
  {
    laneJob: "rear_delt_direct",
    slotId: "upper_a",
    laneId: "rear_delt",
    required: true,
    expected: {
      laneJob: "direct_floor",
      requiredMovementPattern: "rear_delt_fly",
      preferredMovementPatterns: ["shoulder_horizontal_abduction"],
      allowedExerciseClasses: ["rear_delt_isolation"],
      disallowedExerciseClasses: ["row_only"],
      directnessRequirement: "direct_only",
      fallbackPolicy: "block_if_floor_critical",
      identityPreservationMode: "variation_allowed_within_lane_job",
    },
    failureMeaning:
      "rear-delt direct work can be hidden inside row-family upper-back stimulus instead of direct rear-delt isolation",
  },
  {
    laneJob: "chest_biased_press_support",
    slotId: "upper_b",
    laneId: "vertical_press",
    required: true,
    expected: {
      laneJob: "support_coverage",
      requiredMovementPattern: "chest_press",
      allowedExerciseClasses: ["chest_press", "chest_biased_press_support"],
      disallowedExerciseClasses: ["shoulder_biased_press"],
      directnessRequirement: "high_directness",
      stabilityPreference: "stable_preferred",
      fatiguePreference: "moderate_or_low",
      duplicatePolicy: "prefer_variation_if_clean",
      fallbackPolicy: "allow_labeled_fallback",
      identityPreservationMode: "variation_allowed_within_lane_job",
    },
    failureMeaning:
      "upper-b press support can drift into shoulder-biased vertical pressing instead of chest-biased support stimulus",
  },
  {
    laneJob: "vertical_pull_anchor",
    slotId: "upper_b",
    laneId: "vertical_pull_anchor",
    required: true,
    expected: {
      laneJob: "anchor_overload",
      requiredMovementPattern: "vertical_pull",
      allowedExerciseClasses: ["vertical_pull"],
      disallowedExerciseClasses: ["row", "pullover", "straight_arm_pulldown"],
      directnessRequirement: "direct_only",
      loadabilityPreference: "high",
      fallbackPolicy: "block_if_no_true_vertical_pull",
      identityPreservationMode: "preserve_lane_job",
    },
    failureMeaning:
      "lat anchor work can be satisfied by row or pullover-family substitutions that do not preserve the vertical-pull job",
  },
  {
    laneJob: "low_axial_hip_extension",
    slotId: "lower_b",
    laneId: "hinge_anchor",
    required: false,
    expected: {
      laneJob: "support_coverage",
      allowedExerciseClasses: ["hip_thrust"],
      disallowedExerciseClasses: ["hinge", "hamstring_curl", "back_extension"],
      directnessRequirement: "direct_or_high_support",
      minimumTargetStimulus: {
        muscle: "Glutes",
        minimumPerSetStimulus: 0.75,
      },
      fatiguePreference: "low_axial",
      loadabilityPreference: "moderate_or_high",
      duplicatePolicy: "prefer_variation_if_clean",
      fallbackPolicy: "allow_labeled_fallback",
      identityPreservationMode: "variation_allowed_within_lane_job",
    },
    coverageGaps: {
      laneIntentContract: [
        "lower_b:hinge_anchor has no proposed support_coverage laneSelectionIntent for low-axial Glutes support",
        ...LOW_AXIAL_SUPPORT_COVERAGE_CONTRACT_GAPS,
      ],
    },
    failureMeaning:
      "low-axial hip-extension support remains a planner-owned contract watch until laneSelectionIntent can express a support_coverage job for loadable low-axial hip extension with meaningful Glutes stimulus, Hamstrings support-only semantics, low axial fatigue, clean low-axial variation preference, and explicit disallowance of true hinge overload, knee-flexion curl substitution, back-extension/lower-back-heavy closure, and generic glute accessory work; taxonomy now recognizes Reverse Hyperextension as low_axial_hip_extension_anchor",
  },
];

function statusFromCounts(input: {
  failCount: number;
  missingEvidenceCount: number;
  warningCount: number;
}): V2LaneSelectionIntentBenchmarkStatus {
  if (input.failCount > 0) {
    return "fail";
  }
  if (input.missingEvidenceCount > 0) {
    return "missing_evidence";
  }
  if (input.warningCount > 0) {
    return "warning";
  }
  return "pass";
}

function includesAll<T>(actual: T[] | undefined, expected: T[] | undefined): boolean {
  if (!expected || expected.length === 0) {
    return true;
  }
  return expected.every((value) => actual?.includes(value));
}

function expectedEvidenceFields(expectation: BenchmarkLaneExpectation): string[] {
  const expected = expectation.expected;
  const fields: string[] = [];
  if (expected.laneJob) {
    fields.push(`laneJob:${expected.laneJob}`);
  }
  if (expected.requiredMovementPattern) {
    fields.push(`requiredMovementPattern:${expected.requiredMovementPattern}`);
  }
  if (expected.preferredMovementPatterns?.length) {
    fields.push(
      `preferredMovementPatterns:${expected.preferredMovementPatterns.join(",")}`,
    );
  }
  if (expected.allowedExerciseClasses?.length) {
    fields.push(
      `allowedExerciseClasses:${expected.allowedExerciseClasses.join(",")}`,
    );
  }
  if (expected.disallowedExerciseClasses?.length) {
    fields.push(
      `disallowedExerciseClasses:${expected.disallowedExerciseClasses.join(",")}`,
    );
  }
  if (expected.directnessRequirement) {
    fields.push(`directnessRequirement:${expected.directnessRequirement}`);
  }
  if (expected.minimumTargetStimulus) {
    fields.push(
      `minimumTargetStimulus:${expected.minimumTargetStimulus.muscle}:${expected.minimumTargetStimulus.minimumPerSetStimulus}`,
    );
  }
  if (expected.stabilityPreference) {
    fields.push(`stabilityPreference:${expected.stabilityPreference}`);
  }
  if (expected.fatiguePreference) {
    fields.push(`fatiguePreference:${expected.fatiguePreference}`);
  }
  if (expected.loadabilityPreference) {
    fields.push(`loadabilityPreference:${expected.loadabilityPreference}`);
  }
  if (expected.duplicatePolicy) {
    fields.push(`duplicatePolicy:${expected.duplicatePolicy}`);
  }
  if (expected.fallbackPolicy) {
    fields.push(`fallbackPolicy:${expected.fallbackPolicy}`);
  }
  if (expected.identityPreservationMode) {
    fields.push(`identityPreservationMode:${expected.identityPreservationMode}`);
  }
  return fields.length ? fields : ["laneSelectionIntent"];
}

function missingExpectedFields(
  lane: LaneSelectionIntentBenchmarkAuditInput["lanes"][number] | undefined,
  expectation: BenchmarkLaneExpectation,
): string[] {
  const intent = lane?.proposedLaneSelectionIntent;
  if (!lane || !intent) {
    return expectation.required
      ? ["laneSelectionIntent"]
      : expectedEvidenceFields(expectation);
  }

  const missing: string[] = [];
  const expected = expectation.expected;
  if (expected.laneJob && intent.laneJob !== expected.laneJob) {
    missing.push(`laneJob:${expected.laneJob}`);
  }
  if (
    expected.requiredMovementPattern &&
    intent.requiredMovementPattern !== expected.requiredMovementPattern
  ) {
    missing.push(`requiredMovementPattern:${expected.requiredMovementPattern}`);
  }
  if (
    !includesAll(
      intent.preferredMovementPatterns,
      expected.preferredMovementPatterns,
    )
  ) {
    missing.push(
      `preferredMovementPatterns:${expected.preferredMovementPatterns?.join(",")}`,
    );
  }
  if (!includesAll(intent.allowedExerciseClasses, expected.allowedExerciseClasses)) {
    missing.push(
      `allowedExerciseClasses:${expected.allowedExerciseClasses?.join(",")}`,
    );
  }
  if (
    !includesAll(intent.disallowedExerciseClasses, expected.disallowedExerciseClasses)
  ) {
    missing.push(
      `disallowedExerciseClasses:${expected.disallowedExerciseClasses?.join(",")}`,
    );
  }
  if (
    expected.directnessRequirement &&
    intent.directnessRequirement !== expected.directnessRequirement
  ) {
    missing.push(`directnessRequirement:${expected.directnessRequirement}`);
  }
  if (
    expected.minimumTargetStimulus &&
    (intent.minimumTargetStimulus?.muscle !==
      expected.minimumTargetStimulus.muscle ||
      intent.minimumTargetStimulus?.minimumPerSetStimulus !==
        expected.minimumTargetStimulus.minimumPerSetStimulus)
  ) {
    missing.push(
      `minimumTargetStimulus:${expected.minimumTargetStimulus.muscle}:${expected.minimumTargetStimulus.minimumPerSetStimulus}`,
    );
  }
  if (
    expected.stabilityPreference &&
    intent.stabilityPreference !== expected.stabilityPreference
  ) {
    missing.push(`stabilityPreference:${expected.stabilityPreference}`);
  }
  if (
    expected.fatiguePreference &&
    intent.fatiguePreference !== expected.fatiguePreference
  ) {
    missing.push(`fatiguePreference:${expected.fatiguePreference}`);
  }
  if (
    expected.loadabilityPreference &&
    intent.loadabilityPreference !== expected.loadabilityPreference
  ) {
    missing.push(`loadabilityPreference:${expected.loadabilityPreference}`);
  }
  if (expected.duplicatePolicy && intent.duplicatePolicy !== expected.duplicatePolicy) {
    missing.push(`duplicatePolicy:${expected.duplicatePolicy}`);
  }
  if (expected.fallbackPolicy && intent.fallbackPolicy !== expected.fallbackPolicy) {
    missing.push(`fallbackPolicy:${expected.fallbackPolicy}`);
  }
  if (
    expected.identityPreservationMode &&
    intent.identityPreservationMode !== expected.identityPreservationMode
  ) {
    missing.push(`identityPreservationMode:${expected.identityPreservationMode}`);
  }
  return missing;
}

function coverageGapEvidence(expectation: BenchmarkLaneExpectation): string[] {
  return [
    ...(expectation.coverageGaps?.laneIntentContract ?? []).map(
      (gap) => `coverageGap:laneIntentContract:${gap}`,
    ),
    ...(expectation.coverageGaps?.ontologyInventory ?? []).map(
      (gap) => `coverageGap:ontologyInventory:${gap}`,
    ),
  ];
}

export function buildV2LaneSelectionIntentBenchmark(
  audit: LaneSelectionIntentBenchmarkAuditInput | undefined,
): V2LaneSelectionIntentBenchmark {
  const lanes = HIGH_RISK_LANE_EXPECTATIONS.map((expectation) => {
    const lane = audit?.lanes.find(
      (row) =>
        row.slotId === expectation.slotId && row.laneId === expectation.laneId,
    );
    const missingEvidence = missingExpectedFields(lane, expectation);
    const materializerConsumed = lane?.consumedByMaterializer === true;
    const status: V2LaneSelectionIntentBenchmarkStatus =
      missingEvidence.length === 0
        ? materializerConsumed || !expectation.required
          ? "pass"
          : "warning"
        : expectation.required
          ? lane
            ? "fail"
            : "missing_evidence"
          : "warning";
    const nextSafeAction: V2LaneSelectionIntentBenchmarkNextSafeAction =
      status === "pass"
        ? "no_action"
        : !expectation.required
          ? "keep_diagnostic_watch"
          : lane
            ? "fix_lane_selection_intent_mismatch"
            : "complete_lane_selection_intent_contract";

    return {
      laneJob: expectation.laneJob,
      slotId: expectation.slotId,
      laneId: expectation.laneId,
      required: expectation.required,
      status,
      materializerConsumed,
      evidence: [
        `required=${expectation.required}`,
        `materializerConsumed=${materializerConsumed}`,
        ...(lane?.proposedLaneSelectionIntent
          ? [
              `movement=${lane.proposedLaneSelectionIntent.requiredMovementPattern}`,
              `classes=${lane.proposedLaneSelectionIntent.allowedExerciseClasses.join(",")}`,
              `failureMeaning=${expectation.failureMeaning}`,
            ]
          : [`failureMeaning=${expectation.failureMeaning}`]),
        ...coverageGapEvidence(expectation),
      ],
      missingEvidence,
      coverageGaps: {
        laneIntentContract: [
          ...(expectation.coverageGaps?.laneIntentContract ?? []),
        ],
        ontologyInventory: [
          ...(expectation.coverageGaps?.ontologyInventory ?? []),
        ],
      },
      failureMeaning: expectation.failureMeaning,
      nextSafeAction,
    };
  });

  const passCount = lanes.filter((lane) => lane.status === "pass").length;
  const warningCount = lanes.filter((lane) => lane.status === "warning").length;
  const failCount = lanes.filter((lane) => lane.status === "fail").length;
  const missingEvidenceCount = lanes.filter(
    (lane) => lane.status === "missing_evidence",
  ).length;

  return {
    version: 1,
    source: "v2_lane_selection_intent_benchmark",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    status: statusFromCounts({ failCount, missingEvidenceCount, warningCount }),
    summary: {
      laneJobCount: lanes.length,
      passCount,
      warningCount,
      failCount,
      missingEvidenceCount,
      materializerConsumedCount: lanes.filter((lane) => lane.materializerConsumed)
        .length,
      diagnosticOnlyCount: lanes.filter((lane) => !lane.materializerConsumed)
        .length,
    },
    lanes,
  };
}
