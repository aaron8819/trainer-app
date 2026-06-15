import type {
  MesocycleExplainPlannerOnlyNoRepair,
  V2DefaultAuthorBlockerCategory,
  V2DefaultAuthorReadiness,
  V2DefaultAuthorReadinessConcept,
  V2DefaultAuthorReadinessEvidenceSource,
  V2DefaultAuthorReadinessMap,
  V2PlanQualityBenchmark,
} from "./types";

type ConceptRow = V2DefaultAuthorReadinessMap["concepts"][number];
type BenchmarkGate = V2PlanQualityBenchmark["gates"][number];
type BenchmarkGateName = BenchmarkGate["gate"];

const CONCEPT_ORDER: V2DefaultAuthorReadinessConcept[] = [
  "MesocycleDemand",
  "WeeklyDemandCurve",
  "SlotDemandAllocationByWeek",
  "SetDistributionIntent",
  "ExerciseClassDistributionBySlot",
  "ExerciseSelectionPlan / selection capacity",
  "V2 materializer",
  "Acceptance / promotion readiness",
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function gateByName(
  benchmark: V2PlanQualityBenchmark | undefined,
  name: BenchmarkGateName,
): BenchmarkGate | undefined {
  return benchmark?.gates.find((gate) => gate.gate === name);
}

function gateEvidenceSource(
  gate: BenchmarkGate | undefined,
): V2DefaultAuthorReadinessEvidenceSource {
  if (!gate) {
    return "unknown";
  }
  if (
    gate.evidenceSource === "pure_v2_base_plan" ||
    gate.evidenceSource === "pure_v2_materializer_projection" ||
    gate.evidenceSource === "pure_v2_lane_selection_intent_audit"
  ) {
    return "pure_v2_candidate";
  }
  if (
    gate.evidenceSource === "no_repair_projection" ||
    gate.evidenceSource === "acceptance_classification_no_repair"
  ) {
    return "audit_projection";
  }
  if (gate.evidenceSource === "shadow_diagnostic") {
    return "stale_noise";
  }
  return "unknown";
}

function combineEvidenceSource(
  sources: V2DefaultAuthorReadinessEvidenceSource[],
): V2DefaultAuthorReadinessEvidenceSource {
  if (sources.includes("repair_safety_net")) {
    return "repair_safety_net";
  }
  if (sources.includes("stale_noise")) {
    return "stale_noise";
  }
  if (sources.includes("planning_reality_diagnostic")) {
    return "planning_reality_diagnostic";
  }
  if (sources.includes("audit_projection")) {
    return "audit_projection";
  }
  if (sources.includes("pure_v2_candidate")) {
    return "pure_v2_candidate";
  }
  return "unknown";
}

function readinessFromGateStatus(
  status: BenchmarkGate["status"] | undefined,
): V2DefaultAuthorReadiness {
  if (status === "pass") {
    return "ready";
  }
  if (status === "warning") {
    return "watch";
  }
  if (status === "fail" || status === "missing_evidence") {
    return "blocked";
  }
  return "diagnostic_only";
}

function combineReadiness(
  values: V2DefaultAuthorReadiness[],
): V2DefaultAuthorReadiness {
  if (values.includes("blocked")) {
    return "blocked";
  }
  if (values.includes("watch")) {
    return "watch";
  }
  if (values.includes("ready")) {
    return "ready";
  }
  if (values.includes("diagnostic_only")) {
    return "diagnostic_only";
  }
  return "no_action";
}

function blockerForReadiness(
  readiness: V2DefaultAuthorReadiness,
  fallback: V2DefaultAuthorBlockerCategory | null,
): V2DefaultAuthorBlockerCategory | null {
  return readiness === "blocked" || readiness === "diagnostic_only"
    ? fallback
    : null;
}

function gateEvidence(gates: Array<BenchmarkGate | undefined>): string[] {
  return unique(
    gates.flatMap((gate) =>
      gate
        ? [
            `${gate.gate}:${gate.status}:${gate.evidenceSource}`,
            ...gate.evidence.slice(0, 2),
            ...gate.missingEvidence.slice(0, 2).map((row) => `missing:${row}`),
          ]
        : [],
    ),
  ).slice(0, 6);
}

function conceptCandidateRows(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
  concept: V2DefaultAuthorReadinessConcept,
): NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["v2PromotionCandidateEvaluator"]
>["candidates"] {
  const candidates = noRepair.v2PromotionCandidateEvaluator?.candidates ?? [];
  return candidates.filter((candidate) => {
    const owner = candidate.ownerSeam;
    if (concept === "MesocycleDemand") {
      return owner === "MesocycleDemand";
    }
    if (concept === "WeeklyDemandCurve") {
      return owner === "WeeklyDemandCurve";
    }
    if (concept === "SlotDemandAllocationByWeek") {
      return owner === "SlotDemandAllocationByWeek";
    }
    if (concept === "SetDistributionIntent") {
      return owner === "SetDistributionIntent";
    }
    if (concept === "ExerciseClassDistributionBySlot") {
      return owner.includes("ExerciseClassDistributionBySlot");
    }
    if (concept === "ExerciseSelectionPlan / selection capacity") {
      return (
        owner.includes("ExerciseSelectionPlan") ||
        owner.includes("selection") ||
        owner.includes("capacity")
      );
    }
    if (concept === "V2 materializer") {
      return owner.includes("materializer");
    }
    return candidate.sourceSurface === "v2_plan_quality_benchmark";
  });
}

function applyCandidateOverride(
  row: ConceptRow,
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): ConceptRow {
  const candidates = conceptCandidateRows(noRepair, row.concept);
  const blocked = candidates.filter((candidate) => candidate.status === "blocked");
  const ready = candidates.filter((candidate) => candidate.status === "ready");
  if (ready.length > 0) {
    return {
      ...row,
      readiness: "ready",
      evidenceSource: "audit_projection",
      blockerCategory: null,
      nextSafeAction: ready[0]?.nextSafeAction ?? row.nextSafeAction,
      evidence: unique([
        ...row.evidence,
        `candidateReady=${ready[0]?.candidateId ?? "unknown"}`,
      ]).slice(0, 6),
    };
  }
  if (blocked.length > 0) {
    const blockedRow = blocked[0];
    return {
      ...row,
      readiness: "blocked",
      evidenceSource:
        blockedRow.sourceSurface === "repair_promotion_scoreboard"
          ? "repair_safety_net"
          : "audit_projection",
      blockerCategory: blockedRow.stopReasons.includes(
        "missing_seed_runtime_receipt_db_non_consumption",
      )
        ? "seed_runtime_non_consumption_required"
        : "missing_bounded_projection",
      nextSafeAction:
        "collect_concept_level_owner_proof_before_behavior_or_pivot",
      evidence: unique([
        ...row.evidence,
        `blockedCandidate=${blockedRow.candidateId}`,
        `sourceSurface=${blockedRow.sourceSurface}`,
        `missingProof=${blockedRow.missingProof.length}`,
      ]).slice(0, 6),
    };
  }
  return row;
}

function rowFromGates(input: {
  concept: V2DefaultAuthorReadinessConcept;
  ownerSeam: string;
  gates: Array<BenchmarkGate | undefined>;
  blockedCategory: V2DefaultAuthorBlockerCategory;
  watchNextSafeAction: string;
  readyNextSafeAction: string;
  noEvidenceNextSafeAction: string;
}): ConceptRow {
  const statuses = input.gates.map((gate) => readinessFromGateStatus(gate?.status));
  const readiness = combineReadiness(statuses);
  return {
    concept: input.concept,
    ownerSeam: input.ownerSeam,
    evidenceSource: combineEvidenceSource(input.gates.map(gateEvidenceSource)),
    readiness,
    blockerCategory: blockerForReadiness(readiness, input.blockedCategory),
    nextSafeAction:
      readiness === "ready"
        ? input.readyNextSafeAction
        : readiness === "watch"
          ? input.watchNextSafeAction
          : input.noEvidenceNextSafeAction,
    evidence: gateEvidence(input.gates),
  };
}

function weeklyDemandCurveRow(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): ConceptRow {
  const readiness = noRepair.v2ConcentrationMaterializerProjection
    ?.crossWeekReadiness;
  const decision = readiness?.decision;
  const blockerCount = readiness?.blockerCount ?? 0;
  const rowReadiness: V2DefaultAuthorReadiness =
    blockerCount > 0
      ? "blocked"
      : decision === "candidate_for_bounded_policy_design"
        ? "watch"
        : decision
          ? "watch"
          : "diagnostic_only";

  return {
    concept: "WeeklyDemandCurve",
    ownerSeam: "WeeklyDemandCurve / cross-week projection diagnostics",
    evidenceSource: decision ? "audit_projection" : "planning_reality_diagnostic",
    readiness: rowReadiness,
    blockerCategory: blockerForReadiness(
      rowReadiness,
      decision ? "missing_bounded_projection" : "planning_reality_diagnostic_only",
    ),
    nextSafeAction:
      readiness?.nextSafeSlice ??
      "keep_weekly_curve_diagnostic_until_cross_week_candidate_truth_exists",
    evidence: unique([
      `crossWeekDecision=${decision ?? "not_available"}`,
      `blockerCount=${blockerCount}`,
      `projectedWeekCount=${readiness?.projectedWeekCount ?? "unknown"}`,
    ]),
  };
}

function slotAllocationRow(
  benchmark: V2PlanQualityBenchmark | undefined,
): ConceptRow {
  const projection = benchmark?.slotWeekAllocationAcceptanceProjection;
  const decision = projection?.decision;
  const readiness: V2DefaultAuthorReadiness =
    decision === "behavior_ready_candidate"
      ? "ready"
      : decision === "accepted_with_watch_items"
        ? "watch"
        : decision === "blocked_by_acceptance_trainability_or_non_regression"
          ? "blocked"
          : "diagnostic_only";

  return {
    concept: "SlotDemandAllocationByWeek",
    ownerSeam: "SlotDemandAllocationByWeek",
    evidenceSource: decision ? "audit_projection" : "unknown",
    readiness,
    blockerCategory: blockerForReadiness(readiness, "missing_bounded_projection"),
    nextSafeAction:
      projection?.acceptance.nextSafeSlice ??
      "collect_slot_week_acceptance_projection_evidence",
    evidence: unique([
      `decision=${decision ?? "not_available"}`,
      `watchItems=${projection?.acceptance.watchItems.length ?? 0}`,
      `blockers=${projection?.acceptance.blockers.length ?? 0}`,
      `representativeWeeks=${projection?.representativeAccumulationWeeks.join("|") ?? "none"}`,
    ]),
  };
}

function materializerRow(
  benchmark: V2PlanQualityBenchmark | undefined,
): ConceptRow {
  const omissionsGate = gateByName(benchmark, "materializer_omissions");
  const slotProjection = benchmark?.slotWeekAllocationAcceptanceProjection;
  const laneProjection = benchmark?.laneIntentAcceptanceProjection;
  const nonRegressionStatuses = [
    slotProjection?.materializerNonRegression.status,
    laneProjection?.materializerNonRegression.status,
  ].filter((value): value is "pass" | "fail" | "unknown" => Boolean(value));
  const hasFailure = nonRegressionStatuses.includes("fail");
  const hasUnknown = nonRegressionStatuses.includes("unknown");
  const gateReadiness = readinessFromGateStatus(omissionsGate?.status);
  const readiness: V2DefaultAuthorReadiness = hasFailure
    ? "blocked"
    : gateReadiness === "blocked"
      ? "blocked"
      : hasUnknown
        ? "watch"
        : gateReadiness;

  return {
    concept: "V2 materializer",
    ownerSeam: "V2 materializer / materialization dry-run",
    evidenceSource: omissionsGate
      ? gateEvidenceSource(omissionsGate)
      : "audit_projection",
    readiness,
    blockerCategory: blockerForReadiness(readiness, "materializer_non_regression"),
    nextSafeAction:
      readiness === "ready"
        ? "no_materializer_action_from_current_readout"
        : "resolve_materializer_omission_or_non_regression_proof_before_promotion",
    evidence: unique([
      ...gateEvidence([omissionsGate]),
      `slotWeekMaterializer=${slotProjection?.materializerNonRegression.status ?? "not_available"}`,
      `laneIntentMaterializer=${laneProjection?.materializerNonRegression.status ?? "not_available"}`,
    ]).slice(0, 6),
  };
}

function acceptancePromotionRow(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): ConceptRow {
  const benchmark = noRepair.v2PlanQualityBenchmark;
  const evaluator = noRepair.v2PromotionCandidateEvaluator;
  const readiness: V2DefaultAuthorReadiness =
    benchmark?.status === "fail" ||
    benchmark?.status === "blocked_by_missing_evidence" ||
    evaluator?.status === "blocked_actionable_missing_proof"
      ? "blocked"
      : evaluator?.status === "candidate_ready"
        ? "ready"
        : benchmark?.status === "warning" ||
            evaluator?.status === "watch_only_benchmark_item"
          ? "watch"
          : evaluator?.status === "no_action_roi_cutoff"
            ? "no_action"
            : "diagnostic_only";

  return {
    concept: "Acceptance / promotion readiness",
    ownerSeam: "V2 plan-quality benchmark -> promotion-candidate evaluator",
    evidenceSource: benchmark || evaluator ? "audit_projection" : "unknown",
    readiness,
    blockerCategory:
      readiness === "blocked"
        ? "acceptance_or_promotion_blocked"
        : readiness === "watch"
          ? "watch_only_benchmark"
          : null,
    nextSafeAction:
      evaluator?.summary.nextSafeAction ??
      benchmark?.summary.nextSafeAction ??
      "collect_benchmark_and_evaluator_evidence",
    evidence: unique([
      `benchmark=${benchmark?.status ?? "not_available"}`,
      `evaluator=${evaluator?.status ?? "not_available"}`,
      `readyCandidates=${evaluator?.summary.readyCandidateCount ?? "unknown"}`,
      `actionableMissingProof=${evaluator?.summary.actionableMissingProofCandidateCount ?? "unknown"}`,
    ]),
  };
}

function repairSafetyNetSymptomCount(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): number {
  const raw = noRepair.repairPromotionScoreboard?.rawRepairEvidence;
  return (
    (raw?.materialRepairCount ?? 0) +
    (raw?.majorRepairCount ?? 0) +
    (raw?.suspiciousRepairCount ?? 0)
  );
}

function buildRows(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): ConceptRow[] {
  const benchmark = noRepair.v2PlanQualityBenchmark;
  const rows: ConceptRow[] = [
    rowFromGates({
      concept: "MesocycleDemand",
      ownerSeam: "MesocycleDemand / V2 base-plan demand validation",
      gates: [gateByName(benchmark, "support_floors"), gateByName(benchmark, "direct_work")],
      blockedCategory: "missing_candidate_truth",
      readyNextSafeAction: "no_mesocycle_demand_action_from_current_readout",
      watchNextSafeAction: "review_support_or_direct_work_watch_before_promotion",
      noEvidenceNextSafeAction: "collect_pure_v2_demand_gate_evidence",
    }),
    weeklyDemandCurveRow(noRepair),
    slotAllocationRow(benchmark),
    rowFromGates({
      concept: "SetDistributionIntent",
      ownerSeam: "SetDistributionIntent / session-size fatigue concentration gates",
      gates: [
        gateByName(benchmark, "session_size"),
        gateByName(benchmark, "fatigue_distribution"),
        gateByName(benchmark, "duplicate_concentration_risk"),
      ],
      blockedCategory: "missing_bounded_projection",
      readyNextSafeAction: "no_set_distribution_action_from_current_readout",
      watchNextSafeAction:
        "carry_distribution_watches_until_bounded_owner_projection_or_acceptance_review",
      noEvidenceNextSafeAction: "collect_set_distribution_candidate_truth",
    }),
    rowFromGates({
      concept: "ExerciseClassDistributionBySlot",
      ownerSeam: "ExerciseClassDistributionBySlot / lane-intent class distribution",
      gates: [
        gateByName(benchmark, "lane_intent_explicitness"),
        gateByName(benchmark, "materializer_omissions"),
      ],
      blockedCategory: "missing_candidate_truth",
      readyNextSafeAction: "no_class_distribution_action_from_current_readout",
      watchNextSafeAction:
        "use_lane_intent_or_class_distribution_watch_as_fixture_input_only",
      noEvidenceNextSafeAction: "collect_class_distribution_candidate_truth",
    }),
    rowFromGates({
      concept: "ExerciseSelectionPlan / selection capacity",
      ownerSeam: "ExerciseSelectionPlan / V2 selection capacity diagnostics",
      gates: [gateByName(benchmark, "lane_preservation")],
      blockedCategory: "planning_reality_diagnostic_only",
      readyNextSafeAction: "no_selection_capacity_action_from_current_readout",
      watchNextSafeAction:
        "keep_selection_watch_in_debug_evidence_until_measured_projection_exists",
      noEvidenceNextSafeAction: "collect_selection_capacity_candidate_truth",
    }),
    materializerRow(benchmark),
    acceptancePromotionRow(noRepair),
  ].map((row) => applyCandidateOverride(row, noRepair));

  const byConcept = new Map(rows.map((row) => [row.concept, row]));
  return CONCEPT_ORDER.map((concept) => byConcept.get(concept)).filter(
    (row): row is ConceptRow => Boolean(row),
  );
}

export function buildV2DefaultAuthorReadinessMap(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): V2DefaultAuthorReadinessMap {
  const concepts = buildRows(noRepair);
  const count = (readiness: V2DefaultAuthorReadiness) =>
    concepts.filter((row) => row.readiness === readiness).length;
  const blockedCount = count("blocked");
  const watchCount = count("watch");
  const actionableConceptCount = blockedCount + watchCount;

  return {
    version: 1,
    source: "v2_default_author_readiness_map",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    repairedProjectionUsedAs: "evidence_only_not_target_policy",
    summary: {
      conceptCount: concepts.length,
      readyCount: count("ready"),
      watchCount,
      blockedCount,
      diagnosticOnlyCount: count("diagnostic_only"),
      noActionCount: count("no_action"),
      actionableConceptCount,
      repairSafetyNetSymptomCount: repairSafetyNetSymptomCount(noRepair),
      nextSafeAction:
        blockedCount > 0
          ? "resolve_blocked_concept_owner_proof_before_behavior"
          : watchCount > 0
            ? "review_watch_concepts_without_chasing_repair_rows"
            : "no_default_author_action_from_current_readout",
    },
    concepts,
    guardrails: {
      seedRuntimeChanged: false,
      receiptChanged: false,
      persistenceChanged: false,
      productionMaterializerChanged: false,
      acceptanceThresholdChanged: false,
      repairBehaviorChanged: false,
    },
  };
}
