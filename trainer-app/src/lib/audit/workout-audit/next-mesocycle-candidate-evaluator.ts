import type {
  MesocycleExplainAuditPayload,
  NextMesocycleAcceptanceGatePayload,
  NextMesocycleAcceptanceGateStatus,
  WeeklyRetroAuditPayload,
  WeeklyRetroAuditVolumeRow,
  WeeklyRetroExerciseLoadCalibrationClassification,
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
  inventoryMetadataGapExamples: string[];
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

type WeeklyMuscleGateRow =
  NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"][number];

export type CandidateCompletedBlockEvidenceRow =
  NextMesocycleAcceptanceGatePayload["completedBlockEvidence"][number];

export type CandidateCompletedBlockEvidenceAssessment = {
  rows: CandidateCompletedBlockEvidenceRow[];
  candidateFailureRisks: string[];
  candidateWarningRisks: string[];
};

const LOAD_CALIBRATION_DRIFT_CLASSIFICATIONS: ReadonlySet<WeeklyRetroExerciseLoadCalibrationClassification> =
  new Set<WeeklyRetroExerciseLoadCalibrationClassification>([
    "target_too_low",
    "target_too_high",
    "recalibrated_hold",
  ]);

function formatGateNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "unknown";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function joinEvidence(values: string[]): string {
  return values.filter((value) => value.length > 0).join("; ") || "none";
}

function statusFromBooleans(input: {
  fail?: boolean;
  warning?: boolean;
  pass?: boolean;
}): NextMesocycleAcceptanceGateStatus {
  if (input.fail) {
    return "fail";
  }
  if (input.warning) {
    return "warning";
  }
  if (input.pass) {
    return "pass";
  }
  return "unknown";
}

export function buildPriorRiskRows(
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"],
): NextMesocycleAcceptanceGatePayload["priorBlockRecurringRisks"] {
  const byMuscle = new Map(weeklyRows.map((row) => [row.muscle, row]));
  const chest = byMuscle.get("Chest");
  const calves = byMuscle.get("Calves");
  const sideDelts = byMuscle.get("Side Delts");
  const rearDelts = byMuscle.get("Rear Delts");
  const thinMargin = (row: typeof sideDelts): boolean =>
    Boolean(row && row.projectedSets - row.mev <= 1.5);

  return [
    {
      risk: "Chest MEV fragility",
      status: statusFromBooleans({
        fail: chest?.status === "below_mev_fail",
        warning: Boolean(chest && chest.projectedSets - chest.mev <= 1.5),
        pass: Boolean(chest && chest.projectedSets > chest.mev + 1),
      }),
      severity:
        chest?.status === "below_mev_fail"
          ? "high_risk"
          : chest && chest.projectedSets - chest.mev <= 1.5
            ? "warning"
            : chest
              ? "pass"
              : "info",
      evidence: chest
        ? `projected=${chest.projectedSets} mev=${chest.mev}`
        : "candidate volume unavailable",
      notes: "watch recurring chest floor misses before acceptance",
    },
    {
      risk: "Calves MEV fragility",
      status: statusFromBooleans({
        fail: calves?.status === "below_mev_fail",
        warning: Boolean(calves && calves.projectedSets - calves.mev <= 1.5),
        pass: Boolean(calves && calves.projectedSets > calves.mev + 1),
      }),
      severity:
        calves?.status === "below_mev_fail"
          ? "high_risk"
          : calves && calves.projectedSets - calves.mev <= 1.5
            ? "warning"
            : calves
              ? "pass"
              : "info",
      evidence: calves
        ? `projected=${calves.projectedSets} mev=${calves.mev}`
        : "candidate volume unavailable",
      notes: "watch recurring calves floor misses before acceptance",
    },
    {
      risk: "Side/rear delt thin margins",
      status: statusFromBooleans({
        warning: thinMargin(sideDelts) || thinMargin(rearDelts),
        pass: Boolean(sideDelts && rearDelts),
      }),
      severity:
        !sideDelts || !rearDelts
          ? "info"
          : thinMargin(sideDelts) || thinMargin(rearDelts)
            ? "warning"
            : "pass",
      evidence: joinEvidence([
        sideDelts
          ? `side_delts=${sideDelts.projectedSets}/${sideDelts.mev}`
          : "side_delts=unknown",
        rearDelts
          ? `rear_delts=${rearDelts.projectedSets}/${rearDelts.mev}`
          : "rear_delts=unknown",
      ]),
      notes: "thin support margins should stay visible even when above MEV",
    },
    {
      risk: "recurring load calibration issues",
      status: "unknown",
      severity: "info",
      evidence: "weekly-retro evidence not embedded in this candidate",
      notes: "review recent weekly retros for target-too-low/high patterns",
    },
    {
      risk: "reliance on runtime add-ons",
      status: "unknown",
      severity: "info",
      evidence: "weekly-retro runtime-addition evidence not embedded in this candidate",
      notes: "candidate should not depend on session-local add-ons to satisfy floors",
    },
    {
      risk: "target semantics friction",
      status: "pass",
      severity: "pass",
      evidence: "gate treats MEV/MAV as hard boundaries and target as productive aim",
      notes: "above MEV but below target is not failed",
    },
  ];
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

function compactEvidenceToken(value: string | null | undefined): string {
  const compacted = (value ?? "unknown")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[;,|]+/g, "_");
  return compacted || "unknown";
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function buildInventoryMetadataGapExamples(input: {
  preview: MesocycleExplainAuditPayload | undefined;
}): string[] {
  const planningReality =
    input.preview?.preview.projectionDiagnostics.planningReality;
  const selectionDiagnostic =
    input.preview?.plannerOnlyNoRepair?.v2ExerciseSelectionPlanDiagnostic;
  const unresolvedExamples =
    planningReality?.exerciseClassUnresolvedCauses
      ?.filter((row) => row.owningCause === "inventory_classification_gap")
      .map((row) =>
        [
          compactEvidenceToken(row.slotId),
          compactEvidenceToken(row.muscle),
          compactEvidenceToken(row.demandType),
          compactEvidenceToken(row.recommendedOwner),
        ].join(":"),
      ) ?? [];
  const laneExamples =
    selectionDiagnostic?.weeks?.flatMap((week) =>
      week.slots.flatMap((slot) =>
        slot.lanes
          .filter(
            (lane) =>
              lane.laneClassStatus === "mismatch" ||
              lane.inventoryStatus === "classification_gap",
          )
          .map((lane) =>
            [
              `week_${week.week}`,
              compactEvidenceToken(slot.slotId),
              compactEvidenceToken(lane.laneId),
              compactEvidenceToken(
                lane.selectedIdentity?.exerciseName ?? "unselected",
              ),
              `${compactEvidenceToken(lane.laneClassStatus)}/${compactEvidenceToken(lane.inventoryStatus)}`,
            ].join(":"),
          ),
      ),
    ) ?? [];

  return uniqueSorted([...unresolvedExamples, ...laneExamples]).slice(0, 4);
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
  const inventoryMetadataGapExamples = buildInventoryMetadataGapExamples({
    preview: input.preview,
  });
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
        ...(inventoryMetadataGapExamples.length > 0
          ? [`metadataGapExamples=${inventoryMetadataGapExamples.join(",")}`]
          : []),
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
    inventoryMetadataGapExamples,
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
  if (!input.candidateFound) {
    return "legacy_diagnostic_context";
  }
  if (input.candidateTruthFailure) {
    return "candidate_truth";
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

function retroVolumeRowsForMuscle(
  retros: WeeklyRetroAuditPayload[],
  muscle: string,
): Array<{ week: number; row: WeeklyRetroAuditVolumeRow }> {
  return retros
    .flatMap((retro) =>
      retro.volumeTargeting.muscles
        .filter((row) => row.muscle === muscle)
        .map((row) => ({ week: retro.week, row })),
    )
    .sort((left, right) => left.week - right.week);
}

function retroVolumeRowForWeek(
  retros: WeeklyRetroAuditPayload[],
  week: number,
  muscle: string,
): WeeklyRetroAuditVolumeRow | undefined {
  return retros
    .find((retro) => retro.week === week)
    ?.volumeTargeting.muscles.find((row) => row.muscle === muscle);
}

function runtimeTopUpWeeksForMuscle(
  retros: WeeklyRetroAuditPayload[],
  muscle: string,
): number[] {
  return retros
    .filter((retro) =>
      retro.planAdherence.interpretations.some(
        (interpretation) =>
          interpretation.setDelta > 0 &&
          interpretation.muscles.includes(muscle) &&
          (interpretation.intent === "final_weekly_opportunity_mev_closure" ||
            interpretation.intent === "target_gap_closure"),
      ),
    )
    .map((retro) => retro.week)
    .sort((left, right) => left - right);
}

function candidateRowByMuscle(
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"],
): Map<string, WeeklyMuscleGateRow> {
  return new Map(weeklyRows.map((row) => [row.muscle, row]));
}

function candidateMevImplication(input: {
  candidateFound: boolean;
  row?: WeeklyMuscleGateRow;
  muscle: string;
  floorKind: string;
}): { text: string; failure: boolean; warning: boolean } {
  if (!input.candidateFound) {
    return {
      text: "candidate evidence pending; apply when a persisted handoff candidate exists",
      failure: false,
      warning: false,
    };
  }
  if (!input.row) {
    return {
      text: `candidate ${input.muscle} volume unavailable; cannot prove prior ${input.floorKind} addressed`,
      failure: false,
      warning: true,
    };
  }
  if (input.row.projectedSets < input.row.mev) {
    return {
      text: `candidate repeats predictable ${input.muscle} below-MEV floor (${formatGateNumber(input.row.projectedSets)}/${formatGateNumber(input.row.mev)}); acceptance should fail`,
      failure: true,
      warning: false,
    };
  }
  if (input.row.projectedSets - input.row.mev <= 1.5) {
    return {
      text: `candidate clears ${input.muscle} MEV but leaves a thin planned floor (${formatGateNumber(input.row.projectedSets)}/${formatGateNumber(input.row.mev)}); acceptance should warn`,
      failure: false,
      warning: true,
    };
  }
  return {
    text: `candidate addresses ${input.muscle} floor with planned seed volume (${formatGateNumber(input.row.projectedSets)}/${formatGateNumber(input.row.mev)})`,
    failure: false,
    warning: false,
  };
}

function buildMevFragilityEvidence(input: {
  retros: WeeklyRetroAuditPayload[];
  candidateRows: Map<string, WeeklyMuscleGateRow>;
  candidateFound: boolean;
  muscle: "Chest" | "Calves";
  risk: string;
}): {
  row: CandidateCompletedBlockEvidenceRow;
  failure: boolean;
  warning: boolean;
} {
  const finalWeek = retroVolumeRowForWeek(input.retros, 4, input.muscle);
  const topUpWeeks = runtimeTopUpWeeksForMuscle(input.retros, input.muscle);
  const belowMevRows = retroVolumeRowsForMuscle(input.retros, input.muscle).filter(
    ({ row }) => row.status === "below_mev" || row.deltaToMev < 0,
  );
  const implication = candidateMevImplication({
    candidateFound: input.candidateFound,
    row: input.candidateRows.get(input.muscle),
    muscle: input.muscle,
    floorKind: "MEV fragility",
  });
  const recurringFragility =
    (finalWeek?.status === "below_mev" || (finalWeek?.deltaToMev ?? 0) < 0) ||
    topUpWeeks.length > 0 ||
    belowMevRows.length > 0;
  const severity: CandidateCompletedBlockEvidenceRow["severity"] =
    implication.failure
      ? "high_risk"
      : recurringFragility && implication.warning
        ? "warning"
        : "info";
  const evidence = joinEvidence([
    topUpWeeks.length > 0
      ? `${topUpWeeks.map((week) => `W${week}`).join(", ")} required top-up`
      : "",
    finalWeek
      ? `W4 finished ${formatGateNumber(finalWeek.actualEffectiveSets)}/${formatGateNumber(finalWeek.mev)} MEV`
      : "",
    belowMevRows.length > 0
      ? `below-MEV weeks=${belowMevRows.map(({ week }) => `W${week}`).join(",")}`
      : "",
  ]);

  return {
    row: {
      risk: input.risk,
      evidence:
        evidence === "none"
          ? "weekly-retro muscle evidence unavailable or clean"
          : evidence,
      hypothesis: recurringFragility
        ? `${input.muscle} may need planned floor margin instead of relying on late-block or session-local top-ups`
        : `${input.muscle} prior-block evidence does not show a recurring floor problem`,
      acceptanceImplication: implication.text,
      requiredFix: implication.failure
        ? `raise planned ${input.muscle} Week 1/block volume to at least MEV through the canonical volume-floor owner`
        : "none unless the persisted candidate repeats below-MEV or razor-thin floor exposure",
      severity,
      ownerSeam: "volume floors",
      smallestSafeFix: implication.failure
        ? `investigate candidate ${input.muscle} allocation and adjust the canonical planner/materializer owner before accepting`
        : "monitor in the gate/pre-session readout; do not implement planner behavior from prior evidence alone",
      mustFixBeforeWeek1: implication.failure,
    },
    failure: severity === "high_risk" && implication.failure,
    warning: severity === "warning" || implication.warning,
  };
}

function buildDeltThinMarginEvidence(input: {
  retros: WeeklyRetroAuditPayload[];
  candidateRows: Map<string, WeeklyMuscleGateRow>;
  candidateFound: boolean;
}): {
  row: CandidateCompletedBlockEvidenceRow;
  failure: boolean;
  warning: boolean;
} {
  const sideFinal = retroVolumeRowForWeek(input.retros, 4, "Side Delts");
  const rearFinal = retroVolumeRowForWeek(input.retros, 4, "Rear Delts");
  const sideCandidate = candidateMevImplication({
    candidateFound: input.candidateFound,
    row: input.candidateRows.get("Side Delts"),
    muscle: "Side Delts",
    floorKind: "thin margin",
  });
  const rearCandidate = candidateMevImplication({
    candidateFound: input.candidateFound,
    row: input.candidateRows.get("Rear Delts"),
    muscle: "Rear Delts",
    floorKind: "thin margin",
  });
  const finalRows = [sideFinal, rearFinal].filter(
    Boolean,
  ) as WeeklyRetroAuditVolumeRow[];
  const belowOrThin = finalRows.some(
    (row) => row.deltaToMev <= 1.5 || row.status === "below_mev",
  );
  const severity: CandidateCompletedBlockEvidenceRow["severity"] = belowOrThin
    ? "warning"
    : "info";
  const implications = [sideCandidate.text, rearCandidate.text];

  return {
    row: {
      risk: "Side/rear delt thin margins",
      evidence: joinEvidence([
        sideFinal
          ? `Side Delts W4 ${formatGateNumber(sideFinal.actualEffectiveSets)}/${formatGateNumber(sideFinal.mev)} MEV`
          : "Side Delts W4 unavailable",
        rearFinal
          ? `Rear Delts W4 ${formatGateNumber(rearFinal.actualEffectiveSets)}/${formatGateNumber(rearFinal.mev)} MEV`
          : "Rear Delts W4 unavailable",
      ]),
      acceptanceImplication: input.candidateFound
        ? implications.join("; ")
        : "candidate evidence pending; avoid razor-thin side/rear delt floors when a persisted candidate exists",
      hypothesis:
        "side/rear delt support may be too close to the floor when prior block margins were thin",
      requiredFix:
        sideCandidate.failure || rearCandidate.failure
          ? "fix candidate side/rear delt volume below MEV before Week 1"
          : "none unless the candidate projects below MEV; exact or thin margins become watch items",
      severity,
      ownerSeam: "volume floors",
      smallestSafeFix:
        sideCandidate.failure || rearCandidate.failure
          ? "investigate slot allocation for direct delt support before accepting"
          : "track as a watch item through pre-session volume/readiness checks",
      mustFixBeforeWeek1: sideCandidate.failure || rearCandidate.failure,
    },
    failure: false,
    warning:
      severity === "warning" &&
      (sideCandidate.failure ||
        sideCandidate.warning ||
        rearCandidate.failure ||
        rearCandidate.warning),
  };
}

function buildRuntimeAddonEvidence(
  retros: WeeklyRetroAuditPayload[],
): CandidateCompletedBlockEvidenceRow {
  const weeks = retros
    .map((retro) => ({
      week: retro.week,
      addedSets: retro.planAdherence.explainedAdditions.totalSets,
      addedRows:
        retro.exerciseLoadCalibrationRows?.filter(
          (row) => row.classification === "runtime_added" || row.addedSetCount > 0,
        ).length ?? 0,
    }))
    .filter((row) => row.addedSets > 0 || row.addedRows > 0);
  const totalAddedSets = weeks.reduce((sum, row) => sum + row.addedSets, 0);

  return {
    risk: "Repeated runtime add-ons",
    evidence:
      weeks.length > 0
        ? joinEvidence(
            weeks.map(
              (row) =>
                `W${row.week} added_sets=${formatGateNumber(row.addedSets)} added_rows=${row.addedRows}`,
            ),
          )
        : "no runtime-added weekly-retro evidence",
    acceptanceImplication:
      totalAddedSets > 0
        ? "candidate should satisfy predictable floors with planned seed volume, not session-local add-ons"
        : "informational; no recurring add-on dependency visible",
    hypothesis:
      totalAddedSets > 0
        ? "prior block needed operator/session-local work to close predictable dose gaps"
        : "no recurring runtime-addition dependency is visible",
    requiredFix:
      "none by itself; fix only when the persisted candidate repeats a real floor/cap/trainability failure",
    severity: weeks.length > 0 ? "warning" : "info",
    ownerSeam: "planner policy",
    smallestSafeFix:
      totalAddedSets > 0
        ? "investigate whether the candidate planned seed covers the same predictable floors before changing planner policy"
        : "no implementation required",
    mustFixBeforeWeek1: false,
  };
}

function buildLoadCalibrationEvidence(
  retros: WeeklyRetroAuditPayload[],
): CandidateCompletedBlockEvidenceRow {
  const driftRows = retros
    .flatMap((retro) =>
      (retro.exerciseLoadCalibrationRows ?? []).map((row) => ({
        week: retro.week,
        row,
      })),
    )
    .filter(({ row }) => LOAD_CALIBRATION_DRIFT_CLASSIFICATIONS.has(row.classification));
  const examples = driftRows.slice(0, 4).map(
    ({ week, row }) => `W${week} ${row.exerciseName} ${row.classification}`,
  );

  return {
    risk: "Load calibration drift",
    evidence:
      examples.length > 0
        ? joinEvidence(examples)
        : "no target-too-low/high or recalibrated-hold rows",
    acceptanceImplication:
      driftRows.length > 0
        ? "Week 1 prescriptions should use recent anchors/confidence warnings; this audit does not mutate loads"
        : "informational; no calibration drift visible in loaded retros",
    hypothesis:
      driftRows.length > 0
        ? "some Week 1 prescriptions may need extra confidence/readiness attention"
        : "loaded retros do not show prescription calibration pressure",
    requiredFix:
      "none unless Week 1 candidate prescriptions are low-confidence or contradicted by canonical progression anchors",
    severity: driftRows.length > 0 ? "warning" : "info",
    ownerSeam: "prescription/readout",
    smallestSafeFix:
      driftRows.length > 0
        ? "investigate prescription/readout confidence before changing load policy"
        : "no implementation required",
    mustFixBeforeWeek1: false,
  };
}

function buildTargetSemanticsEvidence(
  retros: WeeklyRetroAuditPayload[],
): CandidateCompletedBlockEvidenceRow {
  const underTargetOnly = retros.reduce(
    (sum, retro) => sum + retro.volumeTargeting.underTargetOnly.length,
    0,
  );
  const belowMev = retros.reduce(
    (sum, retro) => sum + retro.volumeTargeting.belowMev.length,
    0,
  );

  return {
    risk: "Target semantics noise",
    evidence: `below_target_above_mev_rows=${underTargetOnly}; below_mev_rows=${belowMev}`,
    acceptanceImplication:
      "do not fail candidate solely for below-target rows when projected volume is at or above MEV",
    hypothesis:
      underTargetOnly > 0
        ? "productive target misses may be stretch-target or normal block-noise rather than trainability failures"
        : "target semantics evidence is clean in loaded retros",
    requiredFix:
      "none for below-target/above-MEV rows unless another hard floor, cap, or trainability failure is present",
    severity: underTargetOnly > 0 ? "info" : "pass",
    ownerSeam: "target semantics",
    smallestSafeFix:
      "do not implement planner changes for below-target/above-MEV evidence alone",
    mustFixBeforeWeek1: false,
  };
}

function buildOptionalGapFillDependencyEvidence(input: {
  retros: WeeklyRetroAuditPayload[];
  candidateRows: Map<string, WeeklyMuscleGateRow>;
  candidateFound: boolean;
}): {
  row: CandidateCompletedBlockEvidenceRow;
  failure: boolean;
  warning: boolean;
} {
  const topUpWeeks = Array.from(
    new Set([
      ...runtimeTopUpWeeksForMuscle(input.retros, "Chest"),
      ...runtimeTopUpWeeksForMuscle(input.retros, "Calves"),
    ]),
  ).sort((left, right) => left - right);
  const chest = candidateMevImplication({
    candidateFound: input.candidateFound,
    row: input.candidateRows.get("Chest"),
    muscle: "Chest",
    floorKind: "optional gap-fill dependency",
  });
  const calves = candidateMevImplication({
    candidateFound: input.candidateFound,
    row: input.candidateRows.get("Calves"),
    muscle: "Calves",
    floorKind: "optional gap-fill dependency",
  });
  const hasCandidateFailure = chest.failure || calves.failure;
  const hasCandidateWarning = chest.warning || calves.warning;
  const severity: CandidateCompletedBlockEvidenceRow["severity"] =
    hasCandidateFailure ? "high_risk" : hasCandidateWarning ? "warning" : "info";
  const candidateImplication = !input.candidateFound
    ? "evidence will be applied when a persisted handoff candidate exists"
    : chest.failure || calves.failure
      ? "candidate still depends on non-planned top-ups for predictable floors; acceptance should fail"
      : chest.warning || calves.warning
        ? "candidate planned floors are thin; acceptance should warn against optional gap-fill dependency"
        : "candidate planned floors clear prior top-up dependency; optional gap-fill should remain unnecessary";

  return {
    row: {
      risk: "Optional gap-fill dependency risk",
      evidence:
        topUpWeeks.length > 0
          ? `${topUpWeeks.map((week) => `W${week}`).join(", ")} session-local top-up evidence`
          : "normal week close should not rely on optional gap-fill",
      acceptanceImplication: candidateImplication,
      hypothesis:
        topUpWeeks.length > 0
          ? "the next plan should not rely on optional gap-fill/top-up behavior for predictable priority floors"
          : "no optional gap-fill dependency is visible",
      requiredFix: hasCandidateFailure
        ? "fix candidate Chest/Calves below-MEV repeat before Week 1"
        : "none unless the persisted candidate repeats below-MEV priority floor exposure",
      severity,
      ownerSeam: "volume floors",
      smallestSafeFix: hasCandidateFailure
        ? "investigate candidate volume floors at the canonical planner/materializer owner"
        : "keep as watch/evidence; do not implement from prior top-up history alone",
      mustFixBeforeWeek1: hasCandidateFailure,
    },
    failure: hasCandidateFailure,
    warning: severity === "warning",
  };
}

export function buildCompletedBlockEvidenceAssessment(input: {
  retros: WeeklyRetroAuditPayload[];
  weeklyRows: NextMesocycleAcceptanceGatePayload["weeklyMuscleTable"];
  candidateFound: boolean;
}): CandidateCompletedBlockEvidenceAssessment {
  const candidateRows = candidateRowByMuscle(input.weeklyRows);
  const assessedRows = [
    buildMevFragilityEvidence({
      retros: input.retros,
      candidateRows,
      candidateFound: input.candidateFound,
      muscle: "Chest",
      risk: "Chest MEV fragility",
    }),
    buildMevFragilityEvidence({
      retros: input.retros,
      candidateRows,
      candidateFound: input.candidateFound,
      muscle: "Calves",
      risk: "Calf MEV fragility",
    }),
    buildDeltThinMarginEvidence({
      retros: input.retros,
      candidateRows,
      candidateFound: input.candidateFound,
    }),
    {
      row: buildRuntimeAddonEvidence(input.retros),
      failure: false,
      warning: false,
    },
    {
      row: buildLoadCalibrationEvidence(input.retros),
      failure: false,
      warning: false,
    },
    {
      row: buildTargetSemanticsEvidence(input.retros),
      failure: false,
      warning: false,
    },
    buildOptionalGapFillDependencyEvidence({
      retros: input.retros,
      candidateRows,
      candidateFound: input.candidateFound,
    }),
  ];

  return {
    rows: assessedRows.map((entry) => entry.row),
    candidateFailureRisks: assessedRows
      .filter((entry) => entry.failure)
      .map((entry) => entry.row.risk),
    candidateWarningRisks: assessedRows
      .filter((entry) => entry.warning)
      .map((entry) => entry.row.risk),
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
