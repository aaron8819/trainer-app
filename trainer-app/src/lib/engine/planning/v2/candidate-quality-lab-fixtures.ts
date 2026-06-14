import type {
  V2LaneSelectionIntentBenchmark,
  V2LaneSelectionIntentBenchmarkLaneJob,
} from "./lane-selection-intent-benchmark";

export type V2CandidateQualityLabOutcome =
  | "pass"
  | "warn"
  | "fail"
  | "watch";

export type V2CandidateQualityLabGapKind =
  | "none"
  | "ontology_gap"
  | "lane_contract_gap"
  | "materializer_ranking_gap"
  | "acceptance_watch_gap"
  | "seed_runtime_boundary_issue";

type CandidateQualityScenarioFixture = {
  scenarioId: string;
  laneJob: V2LaneSelectionIntentBenchmarkLaneJob;
  label: string;
  scenarioRole: "golden_reference" | "diagnostic_fixture";
  expectedOutcome: V2CandidateQualityLabOutcome;
  ownerSeam: string;
  evidenceSource: string;
  equipmentConstraints: string[];
  inventoryConstraints: string[];
  gapKindsUnderTest: V2CandidateQualityLabGapKind[];
  expectedNextSafeAction: string;
  noImpactArchitectureReview: boolean;
};

export type V2CandidateQualityLabFixtures = {
  version: 1;
  source: "v2_candidate_quality_lab_fixtures";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  scenarioCount: number;
  summary: {
    passCount: number;
    warnCount: number;
    failCount: number;
    watchCount: number;
    goldenStableCount: number;
    nonConsumingScenarioCount: number;
  };
  architectureBoundary: {
    noProductionPlannerChange: true;
    noProductionMaterializerRankingChange: true;
    noSeedRuntimeReceiptDbChange: true;
    noAcceptanceThresholdChange: true;
    noRepairBehaviorChange: true;
  };
  scenarios: Array<{
    scenarioId: string;
    laneJob: V2LaneSelectionIntentBenchmarkLaneJob;
    label: string;
    scenarioRole: "golden_reference" | "diagnostic_fixture";
    expectedOutcome: V2CandidateQualityLabOutcome;
    actualOutcome: V2CandidateQualityLabOutcome;
    ownerSeam: string;
    evidenceSource: string;
    equipmentConstraints: string[];
    inventoryConstraints: string[];
    gapKindsUnderTest: V2CandidateQualityLabGapKind[];
    observedGapKind: V2CandidateQualityLabGapKind;
    evidence: string[];
    missingEvidence: string[];
    expectedNextSafeAction: string;
    nextSafeAction: string;
    noImpactArchitectureReview: boolean;
    labConsumedByDemandOrMaterializer: false;
    seedRuntimeBoundaryIssue: boolean;
  }>;
};

const OWNER_SEAMS = {
  laneIntentToMaterializer:
    "V2LaneSelectionIntent -> ExerciseSelectionPlan -> V2 materializer consumption",
  materializerRanking:
    "V2 materializer ranking inside planner-owned lane intent",
  seedRuntimeBoundary: "accepted seed/runtime/receipt/persistence boundary",
} as const;

const HIGH_RISK_LAB_SCENARIOS: CandidateQualityScenarioFixture[] = [
  {
    scenarioId: "low_axial_hip_extension_golden",
    laneJob: "low_axial_hip_extension",
    label: "Low-axial hip-extension support golden",
    scenarioRole: "golden_reference",
    expectedOutcome: "pass",
    ownerSeam: OWNER_SEAMS.laneIntentToMaterializer,
    evidenceSource: "v2_lane_selection_intent_benchmark",
    equipmentConstraints: [
      "low-axial hip-extension option exists",
      "true hinge overload is not required to close support coverage",
    ],
    inventoryConstraints: [
      "allow hip-thrust, bridge, pull-through, or reverse-hyper family",
      "exclude back-extension, true hinge, generic glute accessory, and hamstring curl substitutions",
    ],
    gapKindsUnderTest: [
      "ontology_gap",
      "lane_contract_gap",
      "materializer_ranking_gap",
      "acceptance_watch_gap",
      "seed_runtime_boundary_issue",
    ],
    expectedNextSafeAction: "no_action",
    noImpactArchitectureReview: true,
  },
  {
    scenarioId: "vertical_pull_anchor_true_pull",
    laneJob: "vertical_pull_anchor",
    label: "Vertical pull anchor",
    scenarioRole: "diagnostic_fixture",
    expectedOutcome: "pass",
    ownerSeam: OWNER_SEAMS.laneIntentToMaterializer,
    evidenceSource: "v2_lane_selection_intent_benchmark",
    equipmentConstraints: [
      "pull-up bar, assisted pull-up, or lat-pulldown path exists",
    ],
    inventoryConstraints: [
      "exclude row, pullover, and straight-arm pulldown as anchor substitutions",
    ],
    gapKindsUnderTest: ["lane_contract_gap", "materializer_ranking_gap"],
    expectedNextSafeAction: "no_action",
    noImpactArchitectureReview: false,
  },
  {
    scenarioId: "hamstring_curl_direct_floor",
    laneJob: "hamstring_curl",
    label: "Hamstring curl direct floor",
    scenarioRole: "diagnostic_fixture",
    expectedOutcome: "pass",
    ownerSeam: OWNER_SEAMS.laneIntentToMaterializer,
    evidenceSource: "v2_lane_selection_intent_benchmark",
    equipmentConstraints: [
      "leg-curl machine, cable curl, band curl, or sliding curl path exists",
    ],
    inventoryConstraints: [
      "exclude hinge, back-extension, and hip-thrust collateral as curl closure",
    ],
    gapKindsUnderTest: ["ontology_gap", "lane_contract_gap"],
    expectedNextSafeAction: "no_action",
    noImpactArchitectureReview: true,
  },
  {
    scenarioId: "side_delt_direct_isolation",
    laneJob: "side_delt_direct",
    label: "Side delt direct isolation",
    scenarioRole: "diagnostic_fixture",
    expectedOutcome: "pass",
    ownerSeam: OWNER_SEAMS.laneIntentToMaterializer,
    evidenceSource: "v2_lane_selection_intent_benchmark",
    equipmentConstraints: ["dumbbell, cable, or machine lateral raise exists"],
    inventoryConstraints: [
      "exclude vertical pressing as direct side-delt floor closure",
    ],
    gapKindsUnderTest: ["lane_contract_gap", "acceptance_watch_gap"],
    expectedNextSafeAction: "no_action",
    noImpactArchitectureReview: true,
  },
  {
    scenarioId: "rear_delt_direct_isolation",
    laneJob: "rear_delt_direct",
    label: "Rear delt direct isolation",
    scenarioRole: "diagnostic_fixture",
    expectedOutcome: "pass",
    ownerSeam: OWNER_SEAMS.laneIntentToMaterializer,
    evidenceSource: "v2_lane_selection_intent_benchmark",
    equipmentConstraints: [
      "reverse fly, cable rear-delt fly, or machine rear-delt path exists",
    ],
    inventoryConstraints: [
      "exclude row-only upper-back stimulus as direct rear-delt closure",
    ],
    gapKindsUnderTest: ["ontology_gap", "lane_contract_gap"],
    expectedNextSafeAction: "no_action",
    noImpactArchitectureReview: true,
  },
  {
    scenarioId: "calf_direct_floor",
    laneJob: "calf_direct",
    label: "Calf direct floor",
    scenarioRole: "diagnostic_fixture",
    expectedOutcome: "pass",
    ownerSeam: OWNER_SEAMS.laneIntentToMaterializer,
    evidenceSource: "v2_lane_selection_intent_benchmark",
    equipmentConstraints: [
      "standing, seated, leg-press, smith, or bodyweight calf raise path exists",
    ],
    inventoryConstraints: [
      "prefer clean calf-raise variation before duplicate reuse",
    ],
    gapKindsUnderTest: ["materializer_ranking_gap", "acceptance_watch_gap"],
    expectedNextSafeAction: "no_action",
    noImpactArchitectureReview: true,
  },
  {
    scenarioId: "chest_biased_press_support",
    laneJob: "chest_biased_press_support",
    label: "Chest-biased press support",
    scenarioRole: "diagnostic_fixture",
    expectedOutcome: "pass",
    ownerSeam: OWNER_SEAMS.laneIntentToMaterializer,
    evidenceSource: "v2_lane_selection_intent_benchmark",
    equipmentConstraints: [
      "stable chest press, machine press, cable press, or chest-biased support press path exists",
    ],
    inventoryConstraints: [
      "exclude shoulder-biased pressing when the lane needs chest support",
    ],
    gapKindsUnderTest: ["lane_contract_gap", "materializer_ranking_gap"],
    expectedNextSafeAction: "no_action",
    noImpactArchitectureReview: false,
  },
];

function labOutcomeFromLaneStatus(
  status: V2LaneSelectionIntentBenchmark["lanes"][number]["status"] | undefined,
): V2CandidateQualityLabOutcome {
  if (status === "pass") {
    return "pass";
  }
  if (status === "warning") {
    return "watch";
  }
  if (status === "fail") {
    return "fail";
  }
  return "warn";
}

function observedGapKind(input: {
  fixture: CandidateQualityScenarioFixture;
  missingEvidence: string[];
  actualOutcome: V2CandidateQualityLabOutcome;
}): V2CandidateQualityLabGapKind {
  if (input.actualOutcome === "pass") {
    return "none";
  }
  if (
    input.missingEvidence.some((row) =>
      row.startsWith("allowedExerciseClasses:"),
    )
  ) {
    return "ontology_gap";
  }
  if (input.missingEvidence.length > 0) {
    return "lane_contract_gap";
  }
  if (input.fixture.gapKindsUnderTest.includes("materializer_ranking_gap")) {
    return "materializer_ranking_gap";
  }
  if (input.fixture.gapKindsUnderTest.includes("acceptance_watch_gap")) {
    return "acceptance_watch_gap";
  }
  return "seed_runtime_boundary_issue";
}

export function buildV2CandidateQualityLabFixtures(
  laneIntentBenchmark: V2LaneSelectionIntentBenchmark | undefined,
): V2CandidateQualityLabFixtures {
  const scenarios = HIGH_RISK_LAB_SCENARIOS.map((fixture) => {
    const lane = laneIntentBenchmark?.lanes.find(
      (row) => row.laneJob === fixture.laneJob,
    );
    const actualOutcome = labOutcomeFromLaneStatus(lane?.status);
    const missingEvidence = lane?.missingEvidence ?? ["lane_benchmark_row"];
    const seedRuntimeBoundaryIssue = actualOutcome !== "pass" &&
      fixture.gapKindsUnderTest.includes("seed_runtime_boundary_issue");

    return {
      scenarioId: fixture.scenarioId,
      laneJob: fixture.laneJob,
      label: fixture.label,
      scenarioRole: fixture.scenarioRole,
      expectedOutcome: fixture.expectedOutcome,
      actualOutcome,
      ownerSeam: seedRuntimeBoundaryIssue
        ? OWNER_SEAMS.seedRuntimeBoundary
        : fixture.ownerSeam,
      evidenceSource: laneIntentBenchmark?.source ?? fixture.evidenceSource,
      equipmentConstraints: fixture.equipmentConstraints,
      inventoryConstraints: fixture.inventoryConstraints,
      gapKindsUnderTest: fixture.gapKindsUnderTest,
      observedGapKind: observedGapKind({
        fixture,
        missingEvidence,
        actualOutcome,
      }),
      evidence: [
        `expectedOutcome=${fixture.expectedOutcome}`,
        `actualOutcome=${actualOutcome}`,
        `ownerSeam=${fixture.ownerSeam}`,
        `evidenceSource=${laneIntentBenchmark?.source ?? fixture.evidenceSource}`,
        `noImpactArchitectureReview=${fixture.noImpactArchitectureReview}`,
        ...(lane?.evidence ?? []),
      ],
      missingEvidence,
      expectedNextSafeAction: fixture.expectedNextSafeAction,
      nextSafeAction: lane?.nextSafeAction ?? "complete_lane_selection_intent_contract",
      noImpactArchitectureReview: fixture.noImpactArchitectureReview,
      labConsumedByDemandOrMaterializer: false as const,
      seedRuntimeBoundaryIssue,
    };
  });

  const passCount = scenarios.filter((scenario) => scenario.actualOutcome === "pass")
    .length;
  const warnCount = scenarios.filter((scenario) => scenario.actualOutcome === "warn")
    .length;
  const failCount = scenarios.filter((scenario) => scenario.actualOutcome === "fail")
    .length;
  const watchCount = scenarios.filter(
    (scenario) => scenario.actualOutcome === "watch",
  ).length;

  return {
    version: 1,
    source: "v2_candidate_quality_lab_fixtures",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    scenarioCount: scenarios.length,
    summary: {
      passCount,
      warnCount,
      failCount,
      watchCount,
      goldenStableCount: scenarios.filter(
        (scenario) =>
          scenario.scenarioRole === "golden_reference" &&
          scenario.expectedOutcome === "pass" &&
          scenario.actualOutcome === "pass",
      ).length,
      nonConsumingScenarioCount: scenarios.filter(
        (scenario) => !scenario.labConsumedByDemandOrMaterializer,
      ).length,
    },
    architectureBoundary: {
      noProductionPlannerChange: true,
      noProductionMaterializerRankingChange: true,
      noSeedRuntimeReceiptDbChange: true,
      noAcceptanceThresholdChange: true,
      noRepairBehaviorChange: true,
    },
    scenarios,
  };
}
