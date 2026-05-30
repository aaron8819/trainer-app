import type {
  MesocycleExplainAuditPayload,
  NextMesocycleAcceptanceGatePayload,
} from "./types";

export type CandidateRepairBurdenAssessment = Pick<
  NextMesocycleAcceptanceGatePayload["decisionSummary"],
  | "repairBurden"
  | "repairBurdenEvidence"
  | "repairBurdenSource"
  | "repairBurdenClassification"
> & {
  materialRepairCount: number | null;
  majorRepairCount: number | null;
};

type SupportLaneBoundaryRow = NonNullable<
  MesocycleExplainAuditPayload["plannerOnlyNoRepair"]
>["v2SupportLaneProjectionDiagnostic"]["laneBoundaryRows"][number];

export type CandidateSupportLaneBoundaryAssessment = {
  droppedRows: SupportLaneBoundaryRow[];
  blockingRows: SupportLaneBoundaryRow[];
  warningRows: SupportLaneBoundaryRow[];
  evidence: string;
};

type ShadowConsumptionTrial = NonNullable<
  NonNullable<
    MesocycleExplainAuditPayload["plannerOnlyNoRepair"]
  >["v2BasePlanShadowConsumptionTrial"]
>;

export type CandidateShadowConsumptionAssessment = Pick<
  NextMesocycleAcceptanceGatePayload["decisionSummary"],
  | "shadowConsumptionClassification"
  | "shadowConsumptionNextSafeAction"
  | "shadowConsumptionEvidence"
>;

export type CandidateMaterializerGuardrailAssessment = Pick<
  NextMesocycleAcceptanceGatePayload["decisionSummary"],
  | "materializerGuardrailClassification"
  | "materializerGuardrailNextSafeAction"
  | "materializerGuardrailEvidence"
> & {
  selectionBlindSpotCount: number;
  inventoryClassificationGapCount: number;
  duplicateContinuityConflictCount: number;
  slotCapacityIssueCount: number;
  selectionBlockerCount: number | null;
  capacityBlockerCount: number | null;
  capacityPressureCount: number | null;
};

export type CandidateEvaluationAssessments = {
  repairBurden: CandidateRepairBurdenAssessment;
  supportLaneBoundary: CandidateSupportLaneBoundaryAssessment;
  shadowConsumption: CandidateShadowConsumptionAssessment;
  materializerGuardrail: CandidateMaterializerGuardrailAssessment;
};

function formatGateNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "unknown";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function buildSupportLaneBoundaryAssessment(input: {
  preview: MesocycleExplainAuditPayload | undefined;
  candidateFound: boolean;
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"];
}): CandidateSupportLaneBoundaryAssessment {
  const weeklyByMuscle = new Map(input.weeklyRows.map((row) => [row.muscle, row]));
  const droppedRows =
    input.preview?.plannerOnlyNoRepair?.v2SupportLaneProjectionDiagnostic
      .laneBoundaryRows?.filter(
        (row) => row.status === "authored_support_lane_dropped",
      ) ?? [];
  const blockingRows = input.candidateFound
    ? droppedRows.filter((row) => {
        const weekly = weeklyByMuscle.get(row.muscle);
        return weekly?.status === "below_mev_fail";
      })
    : [];
  const warningRows = input.candidateFound
    ? droppedRows.filter((row) => !blockingRows.includes(row))
    : [];
  const evidence =
    droppedRows.length > 0
      ? droppedRows
          .slice(0, 4)
          .map(
            (row) =>
              `${row.muscle}:${row.slotId}/${row.laneId}:${row.status}:floor=${formatGateNumber(row.projectedEffectiveSets)}/${formatGateNumber(row.mevFloor)}`,
          )
          .join(", ")
      : "no authored support lane drops reported";

  return {
    droppedRows,
    blockingRows,
    warningRows,
    evidence,
  };
}

function classifyShadowConsumption(
  trial: ShadowConsumptionTrial | undefined,
): NextMesocycleAcceptanceGatePayload["decisionSummary"]["shadowConsumptionClassification"] {
  if (!trial) {
    return "not_available";
  }
  if (
    trial.readOnly !== true ||
    trial.affectsScoringOrGeneration !== false ||
    trial.consumedByProduction !== false ||
    (trial.guardrails != null &&
      (trial.guardrails.consumedByProduction !== false ||
        trial.guardrails.consumedByDemandOrMaterializer !== false))
  ) {
    return "guardrail_violation";
  }
  if (
    trial.status === "blocked" ||
    trial.nextSafeAction === "fix_v2_base_plan" ||
    trial.nextSafeAction === "fix_shadow_adapter" ||
    trial.nextSafeAction === "do_not_promote" ||
    trial.summary.regressionCount > 0
  ) {
    return "blocked_for_promotion";
  }
  if (
    trial.status === "available" &&
    (trial.summary.repairDependencyDelta ?? 0) < 0 &&
    trial.summary.regressionCount === 0
  ) {
    return "diagnostic_positive_needs_inspection";
  }
  return "diagnostic_limited_needs_inspection";
}

export function buildShadowConsumptionAssessment(input: {
  preview: MesocycleExplainAuditPayload | undefined;
}): CandidateShadowConsumptionAssessment {
  const trial = input.preview?.plannerOnlyNoRepair?.v2BasePlanShadowConsumptionTrial;
  const classification = classifyShadowConsumption(trial);
  const nextSafeAction = trial?.nextSafeAction ?? "not_available";
  const summary = trial?.summary;
  const evidence = trial
    ? [
        `status=${trial.status}`,
        `delta=${formatGateNumber(summary?.repairDependencyDelta)}`,
        `remaining=${formatGateNumber(summary?.shadowRemainingRepairDependencyCount)}`,
        `current=${formatGateNumber(summary?.currentRepairDependencyCount)}`,
        `regressions=${formatGateNumber(summary?.regressionCount)}`,
        `consumedByProduction=${trial.consumedByProduction ? "true" : "false"}`,
        `readOnly=${trial.readOnly ? "true" : "false"}`,
        `affectsScoringOrGeneration=${trial.affectsScoringOrGeneration ? "true" : "false"}`,
        `next=${nextSafeAction}`,
        `classification=${classification}`,
      ].join(" ")
    : "no v2 base-plan shadow consumption trial reported";

  return {
    shadowConsumptionClassification: classification,
    shadowConsumptionNextSafeAction: nextSafeAction,
    shadowConsumptionEvidence: evidence,
  };
}

function countUnresolvedCause(input: {
  preview: MesocycleExplainAuditPayload | undefined;
  owningCause: string;
}): number {
  const rows =
    input.preview?.preview.projectionDiagnostics.planningReality
      ?.exerciseClassUnresolvedCauses ?? [];
  return rows.filter((row) => row.owningCause === input.owningCause).length;
}

function classifyMaterializerGuardrails(input: {
  hasDiagnostics: boolean;
  diagnosticsGuarded: boolean;
  selectionBlindSpotCount: number;
  inventoryClassificationGapCount: number;
  duplicateContinuityConflictCount: number;
  slotCapacityIssueCount: number;
  diagnosticOnlyCount: number;
  supportFloorLateRepairCount: number;
  repairIdentityChurnCount: number;
  capCleanupCount: number;
  selectionBlockerCount: number | null;
  selectionClassMismatchCount: number | null;
  duplicateRequiresJustificationCount: number | null;
  capacityBlockerCount: number | null;
  capacityPressureCount: number | null;
  capAwareExpansionNeededCount: number | null;
  optionalSuppressedCount: number | null;
}): NextMesocycleAcceptanceGatePayload["decisionSummary"]["materializerGuardrailClassification"] {
  if (!input.hasDiagnostics) {
    return "not_available";
  }
  if (!input.diagnosticsGuarded) {
    return "guardrail_violation";
  }
  if (
    input.slotCapacityIssueCount > 0 ||
    (input.selectionBlockerCount ?? 0) > 0 ||
    (input.capacityBlockerCount ?? 0) > 0
  ) {
    return "capacity_policy_gap";
  }
  if (
    input.inventoryClassificationGapCount > 0 ||
    (input.selectionClassMismatchCount ?? 0) > 0
  ) {
    return "exercise_metadata_gap";
  }
  if (
    input.selectionBlindSpotCount > 0 ||
    input.duplicateContinuityConflictCount > 0 ||
    (input.duplicateRequiresJustificationCount ?? 0) > 0
  ) {
    return "selection_ranking_gap";
  }
  if (
    (input.capacityPressureCount ?? 0) > 0 ||
    (input.capAwareExpansionNeededCount ?? 0) > 0 ||
    (input.optionalSuppressedCount ?? 0) > 0
  ) {
    return "capacity_policy_gap";
  }
  if (
    input.diagnosticOnlyCount > 0 ||
    input.supportFloorLateRepairCount > 0 ||
    input.repairIdentityChurnCount > 0 ||
    input.capCleanupCount > 0
  ) {
    return "diagnostic_or_legacy_context";
  }
  return "no_material_guardrail_issue";
}

function materializerGuardrailNextSafeAction(
  classification: NextMesocycleAcceptanceGatePayload["decisionSummary"]["materializerGuardrailClassification"],
): NextMesocycleAcceptanceGatePayload["decisionSummary"]["materializerGuardrailNextSafeAction"] {
  switch (classification) {
    case "exercise_metadata_gap":
      return "inspect_exercise_metadata";
    case "selection_ranking_gap":
      return "inspect_selection_ranking";
    case "capacity_policy_gap":
      return "inspect_capacity_policy";
    case "diagnostic_or_legacy_context":
      return "keep_diagnostic_only";
    case "no_material_guardrail_issue":
      return "no_action";
    case "guardrail_violation":
      return "stop_guardrail_violation";
    case "not_available":
      return "not_available";
  }
}

export function buildMaterializerGuardrailAssessment(input: {
  preview: MesocycleExplainAuditPayload | undefined;
}): CandidateMaterializerGuardrailAssessment {
  const plannerOnly = input.preview?.plannerOnlyNoRepair;
  const selectionDiagnostic = plannerOnly?.v2ExerciseSelectionPlanDiagnostic;
  const capacityDiagnostic = plannerOnly?.v2SelectionCapacityPlanDiagnostic;
  const planningReality =
    input.preview?.preview.projectionDiagnostics.planningReality;
  const hasDiagnostics =
    Boolean(planningReality) ||
    Boolean(selectionDiagnostic) ||
    Boolean(capacityDiagnostic);
  const selectionBlindSpotCount = countUnresolvedCause({
    preview: input.preview,
    owningCause: "selection_blind_spot",
  });
  const inventoryClassificationGapCount = countUnresolvedCause({
    preview: input.preview,
    owningCause: "inventory_classification_gap",
  });
  const duplicateContinuityConflictCount = countUnresolvedCause({
    preview: input.preview,
    owningCause: "duplicate_continuity_conflict",
  });
  const slotCapacityIssueCount = countUnresolvedCause({
    preview: input.preview,
    owningCause: "slot_capacity_issue",
  });
  const diagnosticOnlyCount = countUnresolvedCause({
    preview: input.preview,
    owningCause: "diagnostic_only_not_actionable",
  });
  const supportFloorLateRepairCount = countUnresolvedCause({
    preview: input.preview,
    owningCause: "support_floor_late_repair",
  });
  const repairIdentityChurnCount = countUnresolvedCause({
    preview: input.preview,
    owningCause: "repair_identity_churn",
  });
  const capCleanupCount = countUnresolvedCause({
    preview: input.preview,
    owningCause: "cap_cleanup_or_final_shaping",
  });
  const selectionBlockerCount =
    selectionDiagnostic?.summary.blockedLaneCount ??
    (selectionDiagnostic ? selectionDiagnostic.blockers.length : null);
  const selectionClassMismatchCount =
    selectionDiagnostic?.summary.classMismatchCount ?? null;
  const duplicateRequiresJustificationCount =
    selectionDiagnostic?.summary.duplicateRequiresJustificationCount ?? null;
  const capacityBlockerCount =
    capacityDiagnostic?.summary.blockerCount ??
    (capacityDiagnostic ? capacityDiagnostic.blockers.length : null);
  const capacityPressureCount =
    capacityDiagnostic?.summary.capacityPressureCount ?? null;
  const capAwareExpansionNeededCount =
    capacityDiagnostic?.summary.capAwareExpansionNeededCount ?? null;
  const optionalSuppressedCount =
    capacityDiagnostic?.summary.optionalSuppressedCount ?? null;
  const diagnosticsGuarded =
    (selectionDiagnostic == null ||
      (selectionDiagnostic.readOnly === true &&
        selectionDiagnostic.affectsScoringOrGeneration === false &&
        selectionDiagnostic.safeForBehaviorPromotion === false)) &&
    (capacityDiagnostic == null ||
      (capacityDiagnostic.readOnly === true &&
        capacityDiagnostic.affectsScoringOrGeneration === false &&
        capacityDiagnostic.safeForBehaviorPromotion === false));
  const classification = classifyMaterializerGuardrails({
    hasDiagnostics,
    diagnosticsGuarded,
    selectionBlindSpotCount,
    inventoryClassificationGapCount,
    duplicateContinuityConflictCount,
    slotCapacityIssueCount,
    diagnosticOnlyCount,
    supportFloorLateRepairCount,
    repairIdentityChurnCount,
    capCleanupCount,
    selectionBlockerCount,
    selectionClassMismatchCount,
    duplicateRequiresJustificationCount,
    capacityBlockerCount,
    capacityPressureCount,
    capAwareExpansionNeededCount,
    optionalSuppressedCount,
  });
  const nextSafeAction = materializerGuardrailNextSafeAction(classification);
  const evidence = hasDiagnostics
    ? [
        `classification=${classification}`,
        `selectionBlindSpots=${selectionBlindSpotCount}`,
        `inventoryClassificationGaps=${inventoryClassificationGapCount}`,
        `duplicateContinuityConflicts=${duplicateContinuityConflictCount}`,
        `slotCapacityIssues=${slotCapacityIssueCount}`,
        `selectionBlockers=${formatGateNumber(selectionBlockerCount)}`,
        `selectionClassMismatches=${formatGateNumber(selectionClassMismatchCount)}`,
        `duplicateJustifications=${formatGateNumber(duplicateRequiresJustificationCount)}`,
        `capacityBlockers=${formatGateNumber(capacityBlockerCount)}`,
        `capacityPressure=${formatGateNumber(capacityPressureCount)}`,
        `capAwareExpansionNeeded=${formatGateNumber(capAwareExpansionNeededCount)}`,
        `optionalSuppressed=${formatGateNumber(optionalSuppressedCount)}`,
        `diagnosticsGuarded=${diagnosticsGuarded ? "true" : "false"}`,
      ].join(" ")
    : "no planning-reality or V2 materializer diagnostics reported";

  return {
    materializerGuardrailClassification: classification,
    materializerGuardrailNextSafeAction: nextSafeAction,
    materializerGuardrailEvidence: evidence,
    selectionBlindSpotCount,
    inventoryClassificationGapCount,
    duplicateContinuityConflictCount,
    slotCapacityIssueCount,
    selectionBlockerCount,
    capacityBlockerCount,
    capacityPressureCount,
  };
}

function hasCurrentV2PolicyGap(
  scoreboard:
    | NonNullable<
        NonNullable<
          MesocycleExplainAuditPayload["plannerOnlyNoRepair"]
        >["repairPromotionScoreboard"]
      >
    | undefined,
): boolean {
  const gap = scoreboard?.interpretation.currentV2PolicyGap;
  if (!gap) {
    return false;
  }
  return Object.values(gap).some(
    (value) => typeof value === "number" && value > 0,
  );
}

function classifyRepairBurden(input: {
  candidateFound: boolean;
  candidateTruthFailure: boolean;
  materialRepairCount: number | null;
  majorRepairCount: number | null;
  planningShape?: string;
  hasCurrentPolicyGap: boolean;
}): NextMesocycleAcceptanceGatePayload["decisionSummary"]["repairBurdenClassification"] {
  if (input.candidateTruthFailure) {
    return "candidate_truth";
  }
  if (!input.candidateFound) {
    return "legacy_diagnostic_context";
  }
  if (
    input.planningShape === "mostly_repair_shaped" ||
    input.planningShape === "mixed_upstream_plus_repair_shaped" ||
    input.hasCurrentPolicyGap ||
    (input.majorRepairCount ?? 0) > 0 ||
    (input.materialRepairCount ?? 0) >= 6
  ) {
    return "architecture_debt";
  }
  return "noisy_watch_item";
}

export function buildCandidateRepairBurdenAssessment(input: {
  preview: MesocycleExplainAuditPayload | undefined;
  candidateFound: boolean;
  candidateTruthFailure?: boolean;
}): CandidateRepairBurdenAssessment {
  const planningReality =
    input.preview?.preview.projectionDiagnostics.planningReality;
  const summary = planningReality?.summary;
  const materialRepairCount =
    planningReality?.shadowRepairSummary?.materialRepairCount ??
    summary?.materialRepairCount ??
    null;
  const majorRepairCount =
    planningReality?.shadowRepairSummary?.majorRepairCount ??
    summary?.majorRepairCount ??
    null;
  const planningShape = summary?.planningShape;
  const repairBurdenSource: NextMesocycleAcceptanceGatePayload["decisionSummary"]["repairBurdenSource"] =
    planningReality?.shadowRepairSummary
      ? "planning_reality_shadow_repair_summary"
      : summary
        ? "planning_reality_summary"
        : "missing_planning_reality";
  const hasPolicyGap = hasCurrentV2PolicyGap(
    input.preview?.plannerOnlyNoRepair?.repairPromotionScoreboard,
  );
  const repairBurdenClassification = classifyRepairBurden({
    candidateFound: input.candidateFound,
    candidateTruthFailure: input.candidateTruthFailure === true,
    materialRepairCount,
    majorRepairCount,
    planningShape,
    hasCurrentPolicyGap: hasPolicyGap,
  });
  const evidence = [
    `planning_shape=${planningShape ?? "unknown"}`,
    `materialRepairCount=${formatGateNumber(materialRepairCount)}`,
    `majorRepairCount=${formatGateNumber(majorRepairCount)}`,
    `source=${repairBurdenSource}`,
    `classification=${repairBurdenClassification}`,
  ].join(" ");

  if (
    planningShape === "mostly_repair_shaped" ||
    planningShape === "mixed_upstream_plus_repair_shaped" ||
    (majorRepairCount ?? 0) > 0 ||
    (materialRepairCount ?? 0) >= 6
  ) {
    return {
      repairBurden: "high",
      repairBurdenEvidence: evidence,
      repairBurdenSource,
      repairBurdenClassification,
      materialRepairCount,
      majorRepairCount,
    };
  }

  if ((materialRepairCount ?? 0) >= 3) {
    return {
      repairBurden: "medium",
      repairBurdenEvidence: evidence,
      repairBurdenSource,
      repairBurdenClassification,
      materialRepairCount,
      majorRepairCount,
    };
  }

  if ((materialRepairCount ?? 0) > 0) {
    return {
      repairBurden: "low",
      repairBurdenEvidence: evidence,
      repairBurdenSource,
      repairBurdenClassification,
      materialRepairCount,
      majorRepairCount,
    };
  }

  return {
    repairBurden: materialRepairCount == null ? "low" : "none",
    repairBurdenEvidence: evidence,
    repairBurdenSource,
    repairBurdenClassification,
    materialRepairCount,
    majorRepairCount,
  };
}

export function buildCandidateEvaluationAssessments(input: {
  preview: MesocycleExplainAuditPayload | undefined;
  candidateFound: boolean;
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"];
  candidateTruthFailure?: boolean;
}): CandidateEvaluationAssessments {
  return {
    repairBurden: buildCandidateRepairBurdenAssessment({
      preview: input.preview,
      candidateFound: input.candidateFound,
      candidateTruthFailure: input.candidateTruthFailure,
    }),
    supportLaneBoundary: buildSupportLaneBoundaryAssessment({
      preview: input.preview,
      candidateFound: input.candidateFound,
      weeklyRows: input.weeklyRows,
    }),
    shadowConsumption: buildShadowConsumptionAssessment({
      preview: input.preview,
    }),
    materializerGuardrail: buildMaterializerGuardrailAssessment({
      preview: input.preview,
    }),
  };
}

export function buildCandidateDecisionSummary(input: {
  candidateFound: boolean;
  gates: NextMesocycleAcceptanceGatePayload["gates"];
  assessments: Pick<
    CandidateEvaluationAssessments,
    "repairBurden" | "shadowConsumption" | "materializerGuardrail"
  >;
}): NextMesocycleAcceptanceGatePayload["decisionSummary"] {
  const weekOneGate = input.gates.find(
    (gate) => gate.gate === "Week 1 trainability",
  );
  const materializerGate = input.gates.find(
    (gate) => gate.gate === "Exercise/materialization quality",
  );
  const trainability =
    weekOneGate?.status === "pass"
      ? "pass"
      : input.candidateFound && weekOneGate?.status === "warning"
        ? "warning"
        : "fail";
  const plannerMaterializerQuality =
    materializerGate?.status === "fail"
      ? "fail"
      : materializerGate?.status === "warning" ||
          input.assessments.repairBurden.repairBurden === "medium" ||
          input.assessments.repairBurden.repairBurden === "high"
        ? "warning"
        : "pass";

  return {
    trainability,
    plannerMaterializerQuality,
    repairBurden: input.assessments.repairBurden.repairBurden,
    repairBurdenEvidence:
      input.assessments.repairBurden.repairBurdenEvidence,
    repairBurdenSource: input.assessments.repairBurden.repairBurdenSource,
    repairBurdenClassification:
      input.assessments.repairBurden.repairBurdenClassification,
    shadowConsumptionClassification:
      input.assessments.shadowConsumption.shadowConsumptionClassification,
    shadowConsumptionNextSafeAction:
      input.assessments.shadowConsumption.shadowConsumptionNextSafeAction,
    shadowConsumptionEvidence:
      input.assessments.shadowConsumption.shadowConsumptionEvidence,
    materializerGuardrailClassification:
      input.assessments.materializerGuardrail
        .materializerGuardrailClassification,
    materializerGuardrailNextSafeAction:
      input.assessments.materializerGuardrail
        .materializerGuardrailNextSafeAction,
    materializerGuardrailEvidence:
      input.assessments.materializerGuardrail.materializerGuardrailEvidence,
  };
}
