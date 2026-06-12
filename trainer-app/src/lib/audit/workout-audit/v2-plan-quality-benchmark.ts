import type {
  MesocycleExplainPlannerOnlyNoRepair,
  V2PlanQualityBenchmark,
} from "./types";

type BenchmarkGate = V2PlanQualityBenchmark["gates"][number];
type BenchmarkStatus = BenchmarkGate["status"];

function countByStatus(
  gates: BenchmarkGate[],
  status: BenchmarkStatus,
): number {
  return gates.filter((gate) => gate.status === status).length;
}

function benchmarkStatus(gates: BenchmarkGate[]): V2PlanQualityBenchmark["status"] {
  if (countByStatus(gates, "fail") > 0) {
    return "fail";
  }
  if (countByStatus(gates, "missing_evidence") > 0) {
    return "blocked_by_missing_evidence";
  }
  if (countByStatus(gates, "warning") > 0) {
    return "warning";
  }
  return "pass";
}

function gate(input: {
  gate: BenchmarkGate["gate"];
  status: BenchmarkStatus;
  ownerSeam: string;
  evidence: string[];
  missingEvidence?: string[];
  mustFixBeforeWeek1?: boolean;
}): BenchmarkGate {
  return {
    gate: input.gate,
    status: input.status,
    ownerSeam: input.ownerSeam,
    evidence: input.evidence,
    missingEvidence: input.missingEvidence ?? [],
    candidateImpact:
      input.status === "pass"
        ? "supports_deprecation_review"
        : input.status === "fail"
          ? "blocks_deprecation"
          : "needs_more_evidence",
    mustFixBeforeWeek1:
      input.mustFixBeforeWeek1 === true || input.status === "fail",
  };
}

function numberEvidence(label: string, value: number | null | undefined): string {
  return `${label}=${typeof value === "number" ? value : "unknown"}`;
}

function buildSupportFloorsGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const diagnostic = noRepair.v2SupportLaneProjectionDiagnostic;
  if (!diagnostic) {
    return gate({
      gate: "support_floors",
      status: "missing_evidence",
      ownerSeam: "v2SupportLaneProjectionDiagnostic",
      evidence: ["support_lane_projection_diagnostic_missing"],
      missingEvidence: ["support_lane_direct_floor_status"],
    });
  }
  const highRiskRows = diagnostic.laneBoundaryRows.filter(
    (row) => row.mustFixBeforeWeek1 || row.severity === "high_risk",
  );
  const warningRows = diagnostic.laneBoundaryRows.filter(
    (row) => row.severity === "warning",
  );
  return gate({
    gate: "support_floors",
    status:
      highRiskRows.length > 0
        ? "fail"
        : diagnostic.summary.directFloorsBelow > 0 || warningRows.length > 0
          ? "warning"
          : "pass",
    ownerSeam: "v2SupportLaneProjectionDiagnostic",
    evidence: [
      numberEvidence("directFloorsMet", diagnostic.summary.directFloorsMet),
      numberEvidence("directFloorsBelow", diagnostic.summary.directFloorsBelow),
      numberEvidence("authoredDropped", diagnostic.summary.authoredDroppedCount),
      numberEvidence("highRiskDropped", diagnostic.summary.highRiskDroppedCount),
    ],
    missingEvidence: diagnostic.missingInputs,
    mustFixBeforeWeek1: highRiskRows.length > 0,
  });
}

function buildDirectWorkGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const belowFloor = noRepair.weeklyMuscleTotals.filter(
    (row) => row.targetMin != null && row.projectedEffectiveSets < row.targetMin,
  );
  if (noRepair.weeklyMuscleTotals.length === 0) {
    return gate({
      gate: "direct_work",
      status: "missing_evidence",
      ownerSeam: "weeklyMuscleTotals",
      evidence: ["weekly_muscle_totals_missing"],
      missingEvidence: ["week_1_direct_work_totals"],
    });
  }
  return gate({
    gate: "direct_work",
    status: belowFloor.length > 0 ? "fail" : "pass",
    ownerSeam: "weeklyMuscleTotals",
    evidence:
      belowFloor.length > 0
        ? belowFloor
            .slice(0, 6)
            .map(
              (row) =>
                `${row.muscle}:${row.projectedEffectiveSets}/${row.targetMin}`,
            )
        : [`musclesEvaluated=${noRepair.weeklyMuscleTotals.length}`],
    mustFixBeforeWeek1: belowFloor.length > 0,
  });
}

function buildLanePreservationGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const summary = noRepair.v2TargetVsNoRepairDiff.summary;
  return gate({
    gate: "lane_preservation",
    status:
      summary.blockedLaneCount > 0 || summary.missingLaneCount > 0
        ? "fail"
        : summary.partialLaneCount > 0 || summary.repairDependentLaneCount > 0
          ? "warning"
          : "pass",
    ownerSeam: "v2TargetVsNoRepairDiff",
    evidence: [
      numberEvidence("target", summary.targetLaneCount),
      numberEvidence("satisfied", summary.satisfiedLaneCount),
      numberEvidence("partial", summary.partialLaneCount),
      numberEvidence("missing", summary.missingLaneCount),
      numberEvidence("blocked", summary.blockedLaneCount),
      numberEvidence("repairDependent", summary.repairDependentLaneCount),
    ],
  });
}

function buildSessionSizeGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const capacity = noRepair.v2SelectionCapacityPlanDiagnostic;
  if (!capacity) {
    return gate({
      gate: "session_size",
      status: "missing_evidence",
      ownerSeam: "v2SelectionCapacityPlanDiagnostic",
      evidence: ["selection_capacity_diagnostic_missing"],
      missingEvidence: ["session_size_capacity_projection"],
    });
  }
  return gate({
    gate: "session_size",
    status:
      capacity.summary.blockerCount > 0
        ? "fail"
        : capacity.summary.capacityPressureCount > 0 ||
            capacity.summary.capAwareExpansionNeededCount > 0
          ? "warning"
          : "pass",
    ownerSeam: "v2SelectionCapacityPlanDiagnostic",
    evidence: [
      numberEvidence("blockers", capacity.summary.blockerCount),
      numberEvidence("capacityPressure", capacity.summary.capacityPressureCount),
      numberEvidence(
        "capAwareExpansion",
        capacity.summary.capAwareExpansionNeededCount,
      ),
      numberEvidence("optionalSuppressed", capacity.summary.optionalSuppressedCount),
    ],
    missingEvidence: capacity.missingInputs,
  });
}

function buildFatigueDistributionGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const selection = noRepair.v2ExerciseSelectionPlanDiagnostic;
  if (!selection) {
    return gate({
      gate: "fatigue_distribution",
      status: "missing_evidence",
      ownerSeam: "v2ExerciseSelectionPlanDiagnostic",
      evidence: ["exercise_selection_plan_diagnostic_missing"],
      missingEvidence: ["fatigue_distribution_projection"],
    });
  }
  const blocked = selection.weeks.flatMap((week) =>
    week.slots.flatMap((slot) =>
      slot.lanes.filter((lane) => lane.fatigueStatus === "blocked"),
    ),
  );
  const warnings = selection.weeks.flatMap((week) =>
    week.slots.flatMap((slot) =>
      slot.lanes.filter((lane) => lane.fatigueStatus === "quality_warning"),
    ),
  );
  return gate({
    gate: "fatigue_distribution",
    status:
      blocked.length > 0 ? "fail" : warnings.length > 0 ? "warning" : "pass",
    ownerSeam: "v2ExerciseSelectionPlanDiagnostic",
    evidence: [
      numberEvidence("fatigueBlocked", blocked.length),
      numberEvidence("fatigueWarnings", warnings.length),
    ],
    missingEvidence: selection.missingInputs,
  });
}

function buildDuplicateConcentrationGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const selection = noRepair.v2ExerciseSelectionPlanDiagnostic;
  if (!selection) {
    return gate({
      gate: "duplicate_concentration_risk",
      status: "missing_evidence",
      ownerSeam: "v2ExerciseSelectionPlanDiagnostic",
      evidence: ["exercise_selection_plan_diagnostic_missing"],
      missingEvidence: ["duplicate_and_concentration_diagnostics"],
    });
  }
  return gate({
    gate: "duplicate_concentration_risk",
    status:
      selection.summary.blockedLaneCount > 0
        ? "fail"
        : selection.summary.duplicateRequiresJustificationCount > 0 ||
            selection.summary.concentrationWarningCount > 0
          ? "warning"
          : "pass",
    ownerSeam: "v2ExerciseSelectionPlanDiagnostic",
    evidence: [
      numberEvidence("blockedLanes", selection.summary.blockedLaneCount),
      numberEvidence(
        "duplicateNeedsJustification",
        selection.summary.duplicateRequiresJustificationCount,
      ),
      numberEvidence(
        "concentrationWarnings",
        selection.summary.concentrationWarningCount,
      ),
    ],
    missingEvidence: selection.missingInputs,
  });
}

function buildMaterializerOmissionsGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const basePlanCompare = noRepair.v2BasePlanCompare;
  const shadowTrial = noRepair.v2BasePlanShadowConsumptionTrial;
  const baseRegressions = basePlanCompare?.summary.v2RegressionCount ?? 0;
  const shadowRegressions = shadowTrial?.summary.regressionCount ?? 0;
  if (!basePlanCompare && !shadowTrial) {
    return gate({
      gate: "materializer_omissions",
      status: "missing_evidence",
      ownerSeam: "v2_materialization_dry_run",
      evidence: ["v2_materializer_dry_run_evidence_missing"],
      missingEvidence: ["base_plan_compare_or_shadow_consumption_trial"],
    });
  }
  return gate({
    gate: "materializer_omissions",
    status:
      baseRegressions > 0 || shadowRegressions > 0
        ? "fail"
        : shadowTrial?.status === "blocked"
          ? "warning"
          : "pass",
    ownerSeam: "v2_materialization_dry_run",
    evidence: [
      `baseStatus=${basePlanCompare?.status ?? "not_available"}`,
      numberEvidence("baseRegressions", baseRegressions),
      `shadowStatus=${shadowTrial?.status ?? "not_available"}`,
      numberEvidence("shadowRegressions", shadowRegressions),
      `consumedByProduction=${Boolean(shadowTrial?.consumedByProduction)}`,
    ],
  });
}

function buildWeekOneTrainabilityGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const classification = noRepair.acceptanceClassification;
  return gate({
    gate: "week_1_trainability",
    status:
      classification.basicMesocycleShapeStatus === "fail"
        ? "fail"
        : classification.basicMesocycleShapeStatus === "partial" ||
            classification.basicMesocycleShapeStatus === "pass_with_warnings"
          ? "warning"
          : "pass",
    ownerSeam: "plannerOnlyNoRepair.acceptanceClassification",
    evidence: [
      `basicMesocycleShapeStatus=${classification.basicMesocycleShapeStatus}`,
      `replacementReadinessStatus=${classification.replacementReadinessStatus}`,
      numberEvidence("hardBlockers", classification.hardBlockers.length),
      numberEvidence("qualityWarnings", classification.qualityWarnings.length),
    ],
    missingEvidence:
      classification.replacementReadinessStatus === "blocked"
        ? ["replacement_readiness_blocked"]
        : [],
    mustFixBeforeWeek1: classification.hardBlockers.length > 0,
  });
}

export function buildV2PlanQualityBenchmark(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): V2PlanQualityBenchmark {
  const gates = [
    buildSupportFloorsGate(noRepair),
    buildDirectWorkGate(noRepair),
    buildLanePreservationGate(noRepair),
    buildSessionSizeGate(noRepair),
    buildFatigueDistributionGate(noRepair),
    buildDuplicateConcentrationGate(noRepair),
    buildMaterializerOmissionsGate(noRepair),
    buildWeekOneTrainabilityGate(noRepair),
  ];
  const failCount = countByStatus(gates, "fail");
  const missingEvidenceCount = countByStatus(gates, "missing_evidence");
  const warningCount = countByStatus(gates, "warning");
  const mustFixBeforeWeek1Count = gates.filter(
    (row) => row.mustFixBeforeWeek1,
  ).length;
  const status = benchmarkStatus(gates);
  const deprecationReady =
    status === "pass" || (status === "warning" && mustFixBeforeWeek1Count === 0);

  return {
    version: 1,
    source: "v2_candidate_quality_benchmark",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    repairedProjectionUsedAs: "evidence_only_not_target_policy",
    status,
    summary: {
      passCount: countByStatus(gates, "pass"),
      warningCount,
      failCount,
      missingEvidenceCount,
      mustFixBeforeWeek1Count,
      nextSafeAction:
        failCount > 0
          ? "fix_failed_first_principles_gates"
          : missingEvidenceCount > 0
            ? "collect_missing_benchmark_evidence"
            : warningCount > 0
              ? "review_warning_gates_before_deprecation"
              : "review_legacy_repair_deprecation_candidates",
    },
    gates,
    deprecationReadiness: {
      status: deprecationReady
        ? "ready_for_review"
        : failCount > 0
          ? "blocked"
          : "not_ready",
      evidence: gates
        .filter((row) => row.status === "pass")
        .map((row) => `${row.gate}:pass`),
      missingEvidence: gates.flatMap((row) => row.missingEvidence),
    },
    guardrails: {
      seedRuntimeChanged: false,
      productionMaterializerChanged: false,
      acceptanceThresholdChanged: false,
      persistenceChanged: false,
    },
  };
}
