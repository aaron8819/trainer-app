import type {
  MesocycleExplainPlannerOnlyNoRepair,
  V2PlanQualityBenchmark,
} from "./types";

type BenchmarkGate = V2PlanQualityBenchmark["gates"][number];
type BenchmarkStatus = BenchmarkGate["status"];
type BasePlanCompare = NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["v2BasePlanCompare"]
>;
type ShadowConsumptionTrial = NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["v2BasePlanShadowConsumptionTrial"]
>;

const V2_BASE_SESSION_SIZE_WATCH_SET_CAP = 21;

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
  evidenceSource: BenchmarkGate["evidenceSource"];
  evidence: string[];
  missingEvidence?: string[];
  mustFixBeforeWeek1?: boolean;
}): BenchmarkGate {
  return {
    gate: input.gate,
    status: input.status,
    ownerSeam: input.ownerSeam,
    evidenceSource: input.evidenceSource,
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

function pureV2BaseEvidence(noRepair: MesocycleExplainPlannerOnlyNoRepair): {
  baseCompare?: BasePlanCompare;
  shadowTrial?: ShadowConsumptionTrial;
  baseAvailable: boolean;
  shadowAvailable: boolean;
  baseValidationStatus: string;
  baseRegressionCount: number;
  shadowRegressionCount: number;
  shadowUnclearCount: number;
} {
  const baseCompare = noRepair.v2BasePlanCompare;
  const shadowTrial = noRepair.v2BasePlanShadowConsumptionTrial;
  return {
    ...(baseCompare ? { baseCompare } : {}),
    ...(shadowTrial ? { shadowTrial } : {}),
    baseAvailable:
      baseCompare?.readOnly === true &&
      baseCompare.affectsScoringOrGeneration === false &&
      (baseCompare.status === "available" ||
        baseCompare.status === "available_with_limitations"),
    shadowAvailable:
      shadowTrial?.readOnly === true &&
      shadowTrial.affectsScoringOrGeneration === false &&
      shadowTrial.consumedByProduction === false &&
      (shadowTrial.status === "available" ||
        shadowTrial.status === "available_with_limitations"),
    baseValidationStatus:
      baseCompare?.summary.v2BaseValidationStatus ?? "not_available",
    baseRegressionCount: baseCompare?.summary.v2RegressionCount ?? 0,
    shadowRegressionCount: shadowTrial?.summary.regressionCount ?? 0,
    shadowUnclearCount: shadowTrial?.summary.unclearCount ?? 0,
  };
}

function pureV2BaseIsValid(
  evidence: ReturnType<typeof pureV2BaseEvidence>,
): boolean {
  return (
    evidence.baseAvailable &&
    (evidence.baseValidationStatus === "pass" ||
      evidence.baseValidationStatus === "pass_with_warnings") &&
    evidence.baseRegressionCount === 0
  );
}

function buildSupportFloorsGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const pureV2 = pureV2BaseEvidence(noRepair);
  const supportResponsibility =
    pureV2.baseCompare?.comparisons?.repairDependency.responsibilities.find(
      (row) => row.item === "support-floor closure as planner author",
    );
  if (
    pureV2BaseIsValid(pureV2) &&
    supportResponsibility &&
    (supportResponsibility.classification === "v2_improves" ||
      supportResponsibility.classification === "v2_preserves")
  ) {
    return gate({
      gate: "support_floors",
      status: "pass",
      ownerSeam: "v2_base_plan_validation.support_direct_floors",
      evidenceSource: "pure_v2_base_plan",
      evidence: [
        `baseValidationStatus=${pureV2.baseValidationStatus}`,
        numberEvidence("baseRegressions", pureV2.baseRegressionCount),
        `supportFloorClassification=${supportResponsibility.classification}`,
        ...supportResponsibility.evidence.slice(0, 4),
        "legacy_no_repair_projection_not_used_as_target_policy",
      ],
    });
  }

  const diagnostic = noRepair.v2SupportLaneProjectionDiagnostic;
  if (!diagnostic) {
    return gate({
      gate: "support_floors",
      status: "missing_evidence",
      ownerSeam: "v2SupportLaneProjectionDiagnostic",
      evidenceSource: "missing_evidence",
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
    evidenceSource: "no_repair_projection",
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
  const pureV2 = pureV2BaseEvidence(noRepair);
  const underHitMuscles =
    pureV2.baseCompare?.comparisons?.muscleCoverage.underHitMuscles ?? [];
  if (pureV2BaseIsValid(pureV2) && underHitMuscles.length === 0) {
    return gate({
      gate: "direct_work",
      status: "pass",
      ownerSeam: "v2_base_plan_validation.muscle_coverage",
      evidenceSource: "pure_v2_base_plan",
      evidence: [
        `baseValidationStatus=${pureV2.baseValidationStatus}`,
        numberEvidence("baseRegressions", pureV2.baseRegressionCount),
        numberEvidence(
          "v2TotalSets",
          pureV2.baseCompare?.summary.v2TotalSets,
        ),
        numberEvidence("underHitMuscles", underHitMuscles.length),
        "legacy_no_repair_projection_not_used_as_target_policy",
      ],
    });
  }

  const belowFloor = noRepair.weeklyMuscleTotals.filter(
    (row) => row.targetMin != null && row.projectedEffectiveSets < row.targetMin,
  );
  if (noRepair.weeklyMuscleTotals.length === 0) {
    return gate({
      gate: "direct_work",
      status: "missing_evidence",
      ownerSeam: "weeklyMuscleTotals",
      evidenceSource: "missing_evidence",
      evidence: ["weekly_muscle_totals_missing"],
      missingEvidence: ["week_1_direct_work_totals"],
    });
  }
  return gate({
    gate: "direct_work",
    status: belowFloor.length > 0 ? "fail" : "pass",
    ownerSeam: "weeklyMuscleTotals",
    evidenceSource: "no_repair_projection",
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
  const pureV2 = pureV2BaseEvidence(noRepair);
  if (pureV2BaseIsValid(pureV2) && pureV2.shadowAvailable) {
    const status: BenchmarkStatus =
      pureV2.shadowRegressionCount > 0
        ? "fail"
        : pureV2.shadowUnclearCount > 0
          ? "warning"
          : "pass";
    return gate({
      gate: "lane_preservation",
      status,
      ownerSeam: "v2_base_plan_shadow_consumption_trial",
      evidenceSource: "shadow_diagnostic",
      evidence: [
        `baseValidationStatus=${pureV2.baseValidationStatus}`,
        numberEvidence("baseRegressions", pureV2.baseRegressionCount),
        numberEvidence("shadowRegressions", pureV2.shadowRegressionCount),
        numberEvidence("shadowUnclear", pureV2.shadowUnclearCount),
        `shadowStatus=${pureV2.shadowTrial?.status ?? "not_available"}`,
        "shadow_consumption_is_diagnostic_only",
      ],
      mustFixBeforeWeek1: pureV2.shadowRegressionCount > 0,
    });
  }

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
    evidenceSource: "no_repair_projection",
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
  const pureV2 = pureV2BaseEvidence(noRepair);
  const slotShape = pureV2.baseCompare?.comparisons?.slotShape;
  if (pureV2BaseIsValid(pureV2) && slotShape?.v2Base) {
    const slotShapeRegression =
      slotShape.classification === "v2_regresses" ||
      slotShape.rows.some((row) => row.classification === "v2_regresses");
    const sessionSizeUnclearRows = slotShape.rows.filter(
      (row) =>
        row.classification === "unclear" &&
        (row.item === "standalone_one_set_exercises" ||
          row.item === "five_set_stacking" ||
          (row.item === "max_slot_sets" &&
            slotShape.v2Base.maxSlotSets > V2_BASE_SESSION_SIZE_WATCH_SET_CAP)),
    );
    return gate({
      gate: "session_size",
      status: slotShapeRegression
        ? "fail"
        : sessionSizeUnclearRows.length > 0
          ? "warning"
          : "pass",
      ownerSeam: "v2_base_plan_validation.slot_shape",
      evidenceSource: "pure_v2_base_plan",
      evidence: [
        `baseValidationStatus=${pureV2.baseValidationStatus}`,
        numberEvidence("baseRegressions", pureV2.baseRegressionCount),
        `slotShapeClassification=${slotShape.classification}`,
        numberEvidence("sessionSizeWatchSetCap", V2_BASE_SESSION_SIZE_WATCH_SET_CAP),
        `sessionSizeUnclearRows=${
          sessionSizeUnclearRows.map((row) => row.item).join(",") || "none"
        }`,
        numberEvidence("v2MaxSlotSets", slotShape.v2Base.maxSlotSets),
        numberEvidence("v2ExerciseCount", slotShape.v2Base.exerciseCount),
        ...slotShape.v2Base.setsBySlot
          .slice(0, 4)
          .map(
            (slot) =>
              `${slot.slotId}:exercises_${slot.exerciseCount}:sets_${slot.setCount}`,
          ),
        "legacy_no_repair_projection_not_used_as_target_policy",
      ],
      mustFixBeforeWeek1: slotShapeRegression,
    });
  }

  const materializerProjection = noRepair.v2CapacityMaterializerProjection;
  const materializerSessionGate = materializerProjection?.gates.find(
    (row) => row.gateId === "session_size",
  );
  if (
    materializerProjection?.readOnly === true &&
    materializerProjection.affectsScoringOrGeneration === false &&
    materializerProjection.dryRunOnly === true &&
    materializerProjection.consumedByProduction === false &&
    materializerProjection.consumedByDemandOrMaterializer === false &&
    materializerSessionGate?.measured === true
  ) {
    return gate({
      gate: "session_size",
      status: materializerSessionGate.status === "fail" ? "fail" : "pass",
      ownerSeam: "v2_capacity_materializer_projection.session_size",
      evidenceSource: "pure_v2_materializer_projection",
      evidence: [
        `projectionStatus=${materializerProjection.status}`,
        `trialId=${materializerProjection.trialId ?? "none"}`,
        `gateStatus=${materializerSessionGate.status}`,
        ...materializerSessionGate.evidence.slice(0, 4),
        ...materializerSessionGate.regressions.slice(0, 4),
        "capacity_materializer_projection_is_diagnostic_only",
      ],
      mustFixBeforeWeek1: materializerSessionGate.status === "fail",
    });
  }

  const capacity = noRepair.v2SelectionCapacityPlanDiagnostic;
  if (!capacity) {
    return gate({
      gate: "session_size",
      status: "missing_evidence",
      ownerSeam: "v2SelectionCapacityPlanDiagnostic",
      evidenceSource: "missing_evidence",
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
    evidenceSource: "no_repair_projection",
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
      evidenceSource: "missing_evidence",
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
      slot.lanes
        .filter((lane) => lane.fatigueStatus === "quality_warning")
        .map((lane) => ({ week: week.week, slotId: slot.slotId, lane })),
    ),
  );
  const warningsFromConcentration = warnings.filter(
    ({ lane }) => lane.concentrationStatus === "quality_warning",
  );
  const warningsWithFatigueEvidence = warnings.filter(({ lane }) =>
    lane.evidenceRefs.some((row) => /fatigue|collateral/i.test(row)),
  );
  return gate({
    gate: "fatigue_distribution",
    status:
      blocked.length > 0 ? "fail" : warnings.length > 0 ? "warning" : "pass",
    ownerSeam: "v2ExerciseSelectionPlanDiagnostic",
    evidenceSource: "no_repair_projection",
    evidence: [
      numberEvidence("fatigueBlocked", blocked.length),
      numberEvidence("fatigueWarnings", warnings.length),
      numberEvidence(
        "fatigueWarningsFromConcentration",
        warningsFromConcentration.length,
      ),
      numberEvidence(
        "fatigueWarningsWithFatigueOrCollateralEvidence",
        warningsWithFatigueEvidence.length,
      ),
      ...warnings.slice(0, 4).map(
        ({ week, slotId, lane }) =>
          `fatigueWarning:${[
            `week_${week}`,
            slotId,
            lane.laneId,
            `concentration=${lane.concentrationStatus}`,
            `duplicate=${lane.duplicateStatus}`,
            `identity=${lane.identityStatus}`,
            `capacity=${lane.capacityStatus}`,
          ].join(":")}`,
      ),
      "no_repair_projection_not_pure_v2_policy",
      "concentration_quality_gap_requires_measured_projection_delta",
    ],
    missingEvidence: selection.missingInputs,
  });
}

function buildDuplicateConcentrationGate(
  noRepair: MesocycleExplainPlannerOnlyNoRepair,
): BenchmarkGate {
  const pureV2 = pureV2BaseEvidence(noRepair);
  const exerciseIdentity = pureV2.baseCompare?.comparisons?.exerciseIdentity;
  if (pureV2BaseIsValid(pureV2) && exerciseIdentity) {
    const exactDuplicateCount =
      exerciseIdentity.duplicateExactExercises.v2Base.length;
    const duplicateFamilyCount =
      exerciseIdentity.duplicateClassFamilies.v2Base.length;
    const status: BenchmarkStatus =
      exerciseIdentity.classification === "v2_regresses"
        ? "fail"
        : exerciseIdentity.classification === "unclear" ||
            exactDuplicateCount > 0 ||
            duplicateFamilyCount > 0
          ? "warning"
          : "pass";
    return gate({
      gate: "duplicate_concentration_risk",
      status,
      ownerSeam: "v2_base_plan_validation.duplicate_distinctness",
      evidenceSource: "pure_v2_base_plan",
      evidence: [
        `baseValidationStatus=${pureV2.baseValidationStatus}`,
        numberEvidence("baseRegressions", pureV2.baseRegressionCount),
        `exerciseIdentityClassification=${exerciseIdentity.classification}`,
        numberEvidence("v2DuplicateExactExercises", exactDuplicateCount),
        numberEvidence("v2DuplicateClassFamilies", duplicateFamilyCount),
        ...(exerciseIdentity.classification === "unclear"
          ? ["watch:identity_differs_from_projection_evidence"]
          : []),
        ...(exactDuplicateCount > 0
          ? ["watch:exact_duplicate_reuse_needs_variant_or_continuity_justification"]
          : []),
        ...(duplicateFamilyCount > 0
          ? ["watch:class_family_reuse_needs_distinctness_policy"]
          : []),
        ...exerciseIdentity.duplicateExactExercises.v2Base
          .slice(0, 4)
          .map((exercise) => `v2DuplicateExact:${exercise}`),
        ...exerciseIdentity.duplicateClassFamilies.v2Base
          .slice(0, 4)
          .map((family) => `v2DuplicateFamily:${family}`),
        "legacy_no_repair_projection_not_used_as_target_policy",
      ],
      mustFixBeforeWeek1: exerciseIdentity.classification === "v2_regresses",
    });
  }

  const selection = noRepair.v2ExerciseSelectionPlanDiagnostic;
  if (!selection) {
    return gate({
      gate: "duplicate_concentration_risk",
      status: "missing_evidence",
      ownerSeam: "v2ExerciseSelectionPlanDiagnostic",
      evidenceSource: "missing_evidence",
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
    evidenceSource: "no_repair_projection",
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
      evidenceSource: "missing_evidence",
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
    evidenceSource: basePlanCompare
      ? "pure_v2_base_plan"
      : "shadow_diagnostic",
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
    evidenceSource: "acceptance_classification_no_repair",
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
