import type {
  MesocycleExplainPlannerOnlyNoRepair,
  MesocycleExplainProjectionDiagnostics,
} from "./types";

type PlanningRealityDiagnostic = NonNullable<
  MesocycleExplainProjectionDiagnostics["planningReality"]
>;
type V2MesocyclePlan = MesocycleExplainPlannerOnlyNoRepair["v2MesocyclePlan"];
type V2TargetVsNoRepairDiff =
  MesocycleExplainPlannerOnlyNoRepair["v2TargetVsNoRepairDiff"];
type V2TargetVsNoRepairLaneDiff =
  V2TargetVsNoRepairDiff["slotDiffs"][number]["laneDiffs"][number];
type V2RepairPromotionScoreboard = NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["repairPromotionScoreboard"]
>;
type V2RepairPromotionCandidate =
  V2RepairPromotionScoreboard["promotionCandidates"][number];
type V2RepairDoNotPromoteRow =
  V2RepairPromotionScoreboard["doNotPromoteRows"][number];
type V2RepairPromotionReadoutContext = {
  weeklyMuscleTotals: MesocycleExplainPlannerOnlyNoRepair["weeklyMuscleTotals"];
  slotPlans: MesocycleExplainPlannerOnlyNoRepair["slotPlans"];
  v2MesocyclePlan: V2MesocyclePlan;
  v2SetDistributionIntent: MesocycleExplainPlannerOnlyNoRepair["v2SetDistributionIntent"];
  v2TargetVsNoRepairDiff: V2TargetVsNoRepairDiff;
  v2SupportLaneProjectionDiagnostic: MesocycleExplainPlannerOnlyNoRepair["v2SupportLaneProjectionDiagnostic"];
  v2ExerciseSelectionPlanDiagnostic: MesocycleExplainPlannerOnlyNoRepair["v2ExerciseSelectionPlanDiagnostic"];
};

const STALE_REPAIRED_PROJECTION_REASONS = [
  "v2_already_solved_differently",
  "collateral_support_accounting",
  "legacy_repaired_artifact",
  "support_floor_design_needed",
] as const;

type QuarantineGroupName =
  | "safetyRepairOnly"
  | "collateralAmbiguous"
  | "staleArtifact"
  | "missingEvidenceOrUnmeasuredGate";

function uniqueSorted(values: string[]): string[] {
  return Array.from(
    new Set(values.filter((value) => value.trim().length > 0))
  ).sort((left, right) => left.localeCompare(right));
}

function isRawMaterialRepair(row: {
  materiality?: string | null;
}): boolean {
  return row.materiality === "moderate" || row.materiality === "major";
}

function isPositiveRepairRow(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number]
): boolean {
  return (
    row.action === "added" ||
    row.action === "set_bumped" ||
    row.rawSetDelta > 0 ||
    row.effectiveStimulusDelta > 0 ||
    row.effectiveStimulusAdded > 0
  );
}

function repairRowKey(input: {
  slotId?: string | null;
  muscle?: string | null;
  exerciseName?: string | null;
  repairMechanism?: string | null;
}): string {
  return [
    input.slotId ?? "",
    input.muscle ?? "",
    input.exerciseName ?? "",
    input.repairMechanism ?? "",
  ].join(":");
}

function correctPromotionOwner(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number]
): V2RepairPromotionCandidate["correctOwner"] {
  if (row.action === "set_bumped") {
    return row.muscle === "Chest" || row.muscle === "Hamstrings"
      ? "SlotDemandAllocationByWeek"
      : "SetDistributionIntent";
  }
  if (row.changedExerciseIdentity && row.muscle === "Hamstrings") {
    return "ExerciseClassDistributionBySlot";
  }
  if (row.changedExerciseIdentity) {
    return "ExerciseSelectionPlan";
  }
  return "SlotDemandAllocationByWeek";
}

function repairPromotionEvidence(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number]
): string[] {
  return uniqueSorted([
    `action:${row.action}`,
    `materiality:${row.materiality}`,
    `mechanism:${row.repairMechanism}`,
    `shadowAllocationBasis:${row.shadowAllocationBasis}`,
    ...row.shadowRationale,
  ]);
}

function isPromotionCandidateRepairRow(input: {
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number];
  suspiciousKeys: ReadonlySet<string>;
}): boolean {
  const row = input.row;
  return Boolean(
    row.slotId &&
      row.muscle &&
      isRawMaterialRepair(row) &&
      row.likelyAvoidableWithShadowAllocation &&
      row.shadowAllocationBasis === "slot_owned_muscle_before_selection" &&
      isPositiveRepairRow(row) &&
      !input.suspiciousKeys.has(repairRowKey(row))
  );
}

function normalizeRepairIdentity(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function matchingV2LaneDiffsForRepairRow(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number],
  context?: V2RepairPromotionReadoutContext
): Array<
  V2TargetVsNoRepairDiff["slotDiffs"][number]["laneDiffs"][number] & {
    slotId: V2TargetVsNoRepairDiff["slotDiffs"][number]["slotId"];
  }
> {
  if (!context || !row.slotId || !row.muscle) {
    return [];
  }
  return context.v2TargetVsNoRepairDiff.slotDiffs
    .filter((slot) => slot.slotId === row.slotId)
    .flatMap((slot) =>
      slot.laneDiffs
        .filter((lane) => lane.targetPrimaryMuscles.includes(row.muscle as string))
        .map((lane) => ({ ...lane, slotId: slot.slotId }))
    );
}

function allV2LaneDiffsForRepairMuscle(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number],
  context?: V2RepairPromotionReadoutContext
): Array<
  V2TargetVsNoRepairDiff["slotDiffs"][number]["laneDiffs"][number] & {
    slotId: V2TargetVsNoRepairDiff["slotDiffs"][number]["slotId"];
  }
> {
  if (!context || !row.muscle) {
    return [];
  }
  return context.v2TargetVsNoRepairDiff.slotDiffs.flatMap((slot) =>
    slot.laneDiffs
      .filter((lane) => lane.targetPrimaryMuscles.includes(row.muscle as string))
      .map((lane) => ({ ...lane, slotId: slot.slotId }))
  );
}

function weeklyRepairTargetMet(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number],
  context?: V2RepairPromotionReadoutContext
): boolean {
  if (!context || !row.muscle) {
    return false;
  }
  const total = context.weeklyMuscleTotals.find(
    (weekly) => weekly.muscle === row.muscle
  );
  return Boolean(
    total &&
      (total.status === "within" ||
        total.status === "above" ||
        (total.targetMin != null &&
          total.projectedEffectiveSets >= total.targetMin))
  );
}

function v2LaneSelectedDifferentIdentity(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number],
  lane: V2TargetVsNoRepairLaneDiff & { slotId?: string }
): boolean {
  const repairedIdentity = normalizeRepairIdentity(row.exerciseName);
  return lane.currentEvidence.selectedExercises.some((exercise) => {
    const selectedIdentity = normalizeRepairIdentity(exercise.name);
    return (
      selectedIdentity !== "" &&
      (repairedIdentity === "" ||
        selectedIdentity !== repairedIdentity ||
        (row.slotId != null && lane.slotId != null && lane.slotId !== row.slotId)) &&
      exercise.matchedClass != null
    );
  });
}

function noRepairSlotPlanExerciseOwnsRepairMuscle(input: {
  muscle?: string | null;
  lane: string;
  exerciseClass: string;
}): boolean {
  const muscle = normalizeRepairIdentity(input.muscle);
  const lane = input.lane.toLowerCase();
  const exerciseClass = input.exerciseClass.toLowerCase();
  if (muscle === "hamstrings") {
    return lane.includes("knee_flexion") || lane.includes("hinge");
  }
  if (muscle === "chest") {
    return lane.includes("chest") || exerciseClass.includes("chest");
  }
  if (muscle === "lats") {
    return lane.includes("vertical_pull") || lane.includes("row");
  }
  if (muscle === "biceps") {
    return lane.includes("biceps") || exerciseClass.includes("biceps");
  }
  if (muscle === "triceps") {
    return lane.includes("triceps") || exerciseClass.includes("triceps");
  }
  if (muscle === "rear delts" || muscle === "rear delt") {
    return lane.includes("rear_delt") || exerciseClass.includes("rear_delt");
  }
  if (muscle === "side delts" || muscle === "side delt") {
    return (
      lane.includes("side_delt") ||
      lane.includes("vertical_press") ||
      exerciseClass.includes("lateral_raise") ||
      exerciseClass.includes("vertical_press")
    );
  }
  return false;
}

function noRepairSelectedDifferentIdentity(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number],
  context: V2RepairPromotionReadoutContext
): boolean {
  const repairedIdentity = normalizeRepairIdentity(row.exerciseName);
  return context.slotPlans.some((slot) =>
    slot.exercises.some((exercise) => {
      const selectedIdentity = normalizeRepairIdentity(exercise.exerciseName);
      return (
        selectedIdentity !== "" &&
        (selectedIdentity !== repairedIdentity || slot.slotId !== row.slotId) &&
        noRepairSlotPlanExerciseOwnsRepairMuscle({
          muscle: row.muscle,
          lane: exercise.lane,
          exerciseClass: exercise.exerciseClass,
        })
      );
    })
  );
}

function repairRowLooksCollateral(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number]
): boolean {
  const muscle = normalizeRepairIdentity(row.muscle);
  const exerciseName = normalizeRepairIdentity(row.exerciseName);
  if (!muscle || !exerciseName) {
    return false;
  }
  if (muscle === "biceps" && exerciseName.includes("row")) {
    return true;
  }
  if (
    (muscle === "rear delts" || muscle === "rear delt") &&
    (exerciseName.includes("row") ||
      exerciseName.includes("pulldown") ||
      exerciseName.includes("pull-up"))
  ) {
    return true;
  }
  if (
    muscle === "triceps" &&
    (exerciseName.includes("bench") ||
      exerciseName.includes("chest press") ||
      exerciseName.includes("shoulder press") ||
      exerciseName.includes("overhead press"))
  ) {
    return true;
  }
  if (
    muscle === "front delts" &&
    (exerciseName.includes("bench") || exerciseName.includes("press"))
  ) {
    return true;
  }
  if (muscle === "forearms" && exerciseName.includes("curl")) {
    return true;
  }
  return false;
}

function hasV2ReadoutOnlyConcentration(lane: V2TargetVsNoRepairLaneDiff): boolean {
  return (
    lane.migrationRecommendation === "keep_diagnostic_only" ||
    (lane.currentEvidence.relevantDiagnostics.includes(
      "concentration:quality_warning"
    ) &&
      lane.severity !== "hard_blocker" &&
      lane.severity !== "migration_candidate")
  );
}

function buildV2RepairDemotionReasons(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number],
  context?: V2RepairPromotionReadoutContext
): string[] {
  if (!context) {
    return [];
  }
  const matchingSlotLanes = matchingV2LaneDiffsForRepairRow(row, context);
  const muscleLanes = allV2LaneDiffsForRepairMuscle(row, context);
  const reasons: string[] = [];
  const targetMet = weeklyRepairTargetMet(row, context);
  const selectedDifferently = muscleLanes.some(
    (lane) =>
      (lane.currentStatus === "satisfied" || lane.currentStatus === "partial") &&
      v2LaneSelectedDifferentIdentity(row, lane)
  ) || noRepairSelectedDifferentIdentity(row, context);
  const optionalOrDiagnosticOnly =
    matchingSlotLanes.length > 0 &&
    matchingSlotLanes.every(
      (lane) =>
        lane.targetRole === "optional" ||
        lane.severity === "diagnostic_only" ||
        lane.migrationRecommendation === "keep_diagnostic_only"
    );

  if (targetMet && selectedDifferently) {
    reasons.push("v2_already_solved_differently");
  }
  if (matchingSlotLanes.length === 0 || optionalOrDiagnosticOnly) {
    reasons.push("no_matching_v2_lane_ownership");
  }
  if (
    matchingSlotLanes.some(hasV2ReadoutOnlyConcentration) &&
    !matchingSlotLanes.some(
      (lane) =>
        lane.severity === "hard_blocker" ||
        lane.severity === "migration_candidate"
    )
  ) {
    reasons.push("diagnostic_concentration_readout", "readout_cleanup_needed");
  }
  if (
    (targetMet || matchingSlotLanes.some((lane) => lane.currentStatus === "partial")) &&
    matchingSlotLanes.some((lane) =>
      lane.currentEvidence.relevantDiagnostics.some(
        (diagnostic) =>
          diagnostic.includes("concentration:") ||
          (diagnostic.startsWith("setPolicy:") &&
            diagnostic !== "setPolicy:in_budget")
      )
    )
  ) {
    reasons.push("readout_cleanup_needed");
  }
  if (repairRowLooksCollateral(row)) {
    reasons.push("collateral_support_accounting", "collateral_diagnostic");
  }
  if (
    matchingSlotLanes.some(
      (lane) =>
        lane.gapCause === "classification_gap" ||
        lane.migrationRecommendation === "needs_classification_review" ||
        lane.currentEvidence.relevantDiagnostics.some((diagnostic) =>
          /class_(cause|mismatch)|classification_gap/.test(
            diagnostic.toLowerCase()
          )
        )
    )
      || (row.changedExerciseIdentity === true &&
        row.muscle === "Hamstrings" &&
        matchingSlotLanes.some(
          (lane) =>
            lane.currentStatus === "satisfied" || lane.currentStatus === "partial"
        ))
  ) {
    reasons.push("taxonomy_bridge_needed");
  }
  if (
    !targetMet &&
    matchingSlotLanes.length > 0 &&
    matchingSlotLanes.every(
      (lane) =>
        lane.targetRole === "support" ||
        lane.targetRole === "accessory" ||
        lane.targetRole === "optional" ||
        lane.migrationRecommendation === "keep_diagnostic_only" ||
        lane.severity === "diagnostic_only"
    )
  ) {
    reasons.push("support_floor_design_needed");
  }
  if (
    matchingSlotLanes.some(
      (lane) =>
        lane.gapCause === "capacity_gap" ||
        lane.gapCause === "set_distribution_gap" ||
        lane.migrationRecommendation === "needs_set_distribution_policy" ||
        lane.migrationRecommendation === "needs_set_budget_justification" ||
        lane.currentEvidence.relevantDiagnostics.some(
          (diagnostic) =>
            diagnostic.startsWith("setPolicy:") &&
            diagnostic !== "setPolicy:in_budget"
        )
    )
  ) {
    reasons.push("set_distribution_design_needed");
  }
  if (
    matchingSlotLanes.length > 0 &&
    !matchingSlotLanes.some((lane) =>
      lane.currentEvidence.selectedExercises.some(
        (exercise) =>
          normalizeRepairIdentity(exercise.name) ===
          normalizeRepairIdentity(row.exerciseName)
      )
    ) &&
    selectedDifferently &&
    !reasons.includes("taxonomy_bridge_needed")
  ) {
    reasons.push("legacy_repaired_artifact", "do_not_promote_repaired_row");
  }

  if (
    reasons.includes("support_floor_design_needed") &&
    !reasons.includes("do_not_promote_repaired_row")
  ) {
    reasons.push("do_not_promote_repaired_row");
  }
  if (reasons.includes("support_floor_design_needed")) {
    reasons.push("readout_cleanup_needed");
  }
  if (
    reasons.includes("no_matching_v2_lane_ownership") &&
    reasons.includes("v2_already_solved_differently")
  ) {
    reasons.push("do_not_promote_repaired_row");
  }

  return uniqueSorted(reasons);
}

function classifyV2DemotedPromotionRepairRow(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number],
  demotionReasons: string[]
): V2RepairDoNotPromoteRow {
  const bucket: V2RepairDoNotPromoteRow["bucket"] =
    demotionReasons.includes("collateral_diagnostic") ||
    demotionReasons.includes("collateral_support_accounting")
      ? "collateral_diagnostic"
      : "diagnostic_only";
  const reason =
    demotionReasons.find((value) =>
      [
        "v2_already_solved_differently",
        "support_floor_design_needed",
        "set_distribution_design_needed",
        "taxonomy_bridge_needed",
        "readout_cleanup_needed",
        "collateral_diagnostic",
        "do_not_promote_repaired_row",
      ].includes(value)
    ) ?? demotionReasons[0] ?? "do_not_promote_repaired_row";

  return {
    slotId: row.slotId ?? null,
    muscle: row.muscle ?? null,
    exerciseName: row.exerciseName ?? null,
    action: row.action,
    materiality: row.materiality,
    repairMechanism: row.repairMechanism,
    reason,
    demotionReasons,
    bucket,
    evidence: uniqueSorted([
      ...repairPromotionEvidence(row),
      ...demotionReasons.map((tag) => `demotion:${tag}`),
    ]),
  };
}

function classifyDoNotPromoteRepairRow(
  row: PlanningRealityDiagnostic["repairMaterialityAfterShadowAllocation"][number],
  suspiciousKeys: ReadonlySet<string>
): V2RepairDoNotPromoteRow {
  const rowKey = repairRowKey(row);
  const mechanism = row.repairMechanism.toLowerCase();
  const source = row.source.toLowerCase();
  const rationale = row.rationale.toLowerCase();
  const evidence = repairPromotionEvidence(row);
  if (row.materiality === "none" || row.action === "diagnostic_only") {
    return {
      slotId: row.slotId ?? null,
      muscle: row.muscle ?? null,
      exerciseName: row.exerciseName ?? null,
      action: row.action,
      materiality: row.materiality,
      repairMechanism: row.repairMechanism,
      reason: "materiality_none_or_diagnostic_denominator_artifact",
      demotionReasons: ["materiality_none_or_diagnostic_denominator_artifact"],
      bucket: "diagnostic_only",
      evidence,
    };
  }
  if (
    suspiciousKeys.has(rowKey) ||
    row.action === "removed" ||
    row.action === "set_trimmed" ||
    row.rawSetDelta < 0 ||
    row.effectiveStimulusDelta < 0 ||
    row.shadowAllocationBasis === "diagnostic_or_cap_cleanup" ||
    mechanism.includes("cap") ||
    mechanism.includes("trim") ||
    mechanism.includes("forbidden") ||
    source.includes("forbidden") ||
    rationale.includes("forbidden") ||
    mechanism.includes("distribution_guard")
  ) {
    return {
      slotId: row.slotId ?? null,
      muscle: row.muscle ?? null,
      exerciseName: row.exerciseName ?? null,
      action: row.action,
      materiality: row.materiality,
      repairMechanism: row.repairMechanism,
      reason: suspiciousKeys.has(rowKey)
        ? "raw_suspicious_do_not_promote"
        : "cap_trim_removal_or_safety_guard",
      demotionReasons: [
        suspiciousKeys.has(rowKey)
          ? "raw_suspicious_do_not_promote"
          : "cap_trim_removal_or_safety_guard",
      ],
      bucket: "safety_net",
      evidence,
    };
  }
  const reason =
    row.shadowAllocationBasis === "weekly_demand_owned_elsewhere"
      ? "collateral_or_non_owned_muscle"
      : "diagnostic_or_collateral_only";
  return {
    slotId: row.slotId ?? null,
    muscle: row.muscle ?? null,
    exerciseName: row.exerciseName ?? null,
    action: row.action,
    materiality: row.materiality,
    repairMechanism: row.repairMechanism,
    reason,
    demotionReasons: [reason],
    bucket: "collateral_diagnostic",
    evidence,
  };
}

function withoutDoNotPromoteBucket(
  row: V2RepairDoNotPromoteRow
): Omit<V2RepairDoNotPromoteRow, "bucket"> {
  return {
    slotId: row.slotId,
    muscle: row.muscle,
    exerciseName: row.exerciseName,
    action: row.action,
    materiality: row.materiality,
    repairMechanism: row.repairMechanism,
    reason: row.reason,
    demotionReasons: row.demotionReasons,
    evidence: row.evidence,
  };
}

function buildCurrentV2PolicyGap(
  context?: V2RepairPromotionReadoutContext
): V2RepairPromotionScoreboard["interpretation"]["currentV2PolicyGap"] {
  if (!context) {
    return {
      supportDirectFloorBlockerCount: 0,
      setDistributionCapacityGapCount: 0,
      setBudgetPolicyFailureCount: 0,
      selectionFeasibilityCapacityPressureCount: 0,
      staleWeek1ReadoutArtifactCount: 0,
      capAwareExpansionLimitationCount: 0,
      concentrationQualityGapCount: 0,
      optionalDiagnosticLaneCount: 0,
      selectionBlockerCount: 0,
      classTaxonomyMismatchCount: 0,
    };
  }

  const laneDiffs = context.v2TargetVsNoRepairDiff.slotDiffs.flatMap(
    (slot) => slot.laneDiffs
  );
  const activeNonOptionalLanes = laneDiffs.filter(
    (lane) => lane.targetRole !== "optional" && lane.severity !== "diagnostic_only"
  );
  const setBudgetPolicyFailureCount = activeNonOptionalLanes.filter(
    (lane) =>
      lane.gapCause === "set_distribution_gap" ||
      lane.migrationRecommendation === "needs_set_budget_justification"
  ).length;
  const selectionFeasibilityCapacityPressureCount = activeNonOptionalLanes.filter(
    (lane) => lane.gapCause === "selection_feasibility_pressure"
  ).length;
  const staleWeek1ReadoutArtifactCount = activeNonOptionalLanes.filter(
    (lane) =>
      lane.gapCause === "stale_week1_readout_artifact" ||
      lane.currentEvidence.relevantDiagnostics.includes(
        "readout_note:stale_calves_shortfall_suppressed_weekly_within_lane_satisfied"
      )
  ).length;
  const capAwareExpansionLimitationCount = activeNonOptionalLanes.filter(
    (lane) =>
      lane.gapCause === "cap_aware_expansion_limitation" ||
      lane.currentEvidence.relevantDiagnostics.includes(
        "capAwareExpansion:preferred_exceeds_single_exercise_cap"
      )
  ).length;
  return {
    supportDirectFloorBlockerCount:
      context.v2SupportLaneProjectionDiagnostic.summary.directFloorsBelow,
    setDistributionCapacityGapCount: activeNonOptionalLanes.filter(
      (lane) =>
        lane.gapCause === "capacity_gap" ||
        lane.gapCause === "set_distribution_gap" ||
        lane.migrationRecommendation === "needs_set_budget_justification"
    ).length,
    setBudgetPolicyFailureCount,
    selectionFeasibilityCapacityPressureCount,
    staleWeek1ReadoutArtifactCount,
    capAwareExpansionLimitationCount,
    concentrationQualityGapCount: laneDiffs.filter(
      (lane) =>
        lane.gapCause === "concentration_policy_gap" &&
        lane.severity === "quality_warning"
    ).length,
    optionalDiagnosticLaneCount: laneDiffs.filter(
      (lane) =>
        lane.targetRole === "optional" &&
        lane.currentStatus === "missing" &&
        lane.severity === "diagnostic_only"
    ).length,
    selectionBlockerCount:
      context.v2ExerciseSelectionPlanDiagnostic.summary.blockedLaneCount,
    classTaxonomyMismatchCount:
      context.v2ExerciseSelectionPlanDiagnostic.summary.classMismatchCount,
  };
}

function countStaleRepairedProjectionArtifacts(
  rows: V2RepairDoNotPromoteRow[]
): V2RepairPromotionScoreboard["interpretation"]["staleRepairedProjectionArtifacts"] {
  const reasonCounts = Object.fromEntries(
    STALE_REPAIRED_PROJECTION_REASONS.map((reason) => [reason, 0])
  ) as Record<string, number>;
  const staleRows = rows.filter((row) =>
    STALE_REPAIRED_PROJECTION_REASONS.some((reason) =>
      row.demotionReasons.includes(reason)
    )
  );

  for (const row of rows) {
    for (const reason of STALE_REPAIRED_PROJECTION_REASONS) {
      if (row.demotionReasons.includes(reason)) {
        reasonCounts[reason] += 1;
      }
    }
  }

  return {
    count: staleRows.length,
    reasonCounts,
  };
}

function countByReason(rows: ReadonlyArray<V2RepairDoNotPromoteRow>): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const reason = row.reason || "unknown";
    counts[reason] = (counts[reason] ?? 0) + 1;
    return counts;
  }, {});
}

function countByOwner(
  rows: ReadonlyArray<V2RepairPromotionCandidate>
): V2RepairPromotionScoreboard["interpretation"]["quarantineGroups"]["upstreamOwnedCandidate"]["ownerCounts"] {
  return rows.reduce<
    V2RepairPromotionScoreboard["interpretation"]["quarantineGroups"]["upstreamOwnedCandidate"]["ownerCounts"]
  >((counts, row) => {
    counts[row.correctOwner] = (counts[row.correctOwner] ?? 0) + 1;
    return counts;
  }, {});
}

function isStaleArtifactRow(row: V2RepairDoNotPromoteRow): boolean {
  return STALE_REPAIRED_PROJECTION_REASONS.some((reason) =>
    row.demotionReasons.includes(reason)
  );
}

function quarantineGroupForRow(row: V2RepairDoNotPromoteRow): QuarantineGroupName {
  if (row.bucket === "safety_net") {
    return "safetyRepairOnly";
  }
  if (isStaleArtifactRow(row)) {
    return "staleArtifact";
  }
  if (row.bucket === "collateral_diagnostic") {
    return "collateralAmbiguous";
  }
  return "missingEvidenceOrUnmeasuredGate";
}

function buildQuarantineGroups(input: {
  promotionCandidates: ReadonlyArray<V2RepairPromotionCandidate>;
  doNotPromoteRows: ReadonlyArray<V2RepairDoNotPromoteRow>;
}): V2RepairPromotionScoreboard["interpretation"]["quarantineGroups"] {
  const groupedRows: Record<QuarantineGroupName, V2RepairDoNotPromoteRow[]> = {
    safetyRepairOnly: [],
    collateralAmbiguous: [],
    staleArtifact: [],
    missingEvidenceOrUnmeasuredGate: [],
  };
  for (const row of input.doNotPromoteRows) {
    groupedRows[quarantineGroupForRow(row)].push(row);
  }

  return {
    upstreamOwnedCandidate: {
      count: input.promotionCandidates.length,
      evidenceQuality: "owner_specific_behavior_candidate",
      ownerCounts: countByOwner(input.promotionCandidates),
      requiredProof:
        input.promotionCandidates.length > 0
          ? [
              "bounded_owner_specific_behavior_trial",
              "measured_projection_non_regression",
              "seed_runtime_non_consumption_verified",
            ]
          : ["positive_slot_owned_likely_avoidable_row_not_demoted_by_v2_context"],
    },
    safetyRepairOnly: {
      count: groupedRows.safetyRepairOnly.length,
      evidenceQuality: "safety_or_legacy_only",
      topReasons: countByReason(groupedRows.safetyRepairOnly),
      requiredProof: [
        "prove_safety_guard_can_be_owned_upstream_without_regression",
        "keep_repair_as_fallback_until_replaced",
      ],
    },
    collateralAmbiguous: {
      count: groupedRows.collateralAmbiguous.length,
      evidenceQuality: "collateral_or_ambiguous",
      topReasons: countByReason(groupedRows.collateralAmbiguous),
      requiredProof: [
        "prove_target_muscle_slot_ownership",
        "separate_collateral_credit_from_direct_floor_satisfaction",
      ],
    },
    staleArtifact: {
      count: groupedRows.staleArtifact.length,
      evidenceQuality: "stale_repaired_projection_artifact",
      topReasons: countByReason(groupedRows.staleArtifact),
      requiredProof: [
        "compare_against_current_v2_no_repair_solution",
        "do_not_copy_legacy_repaired_identity_or_set_bump",
      ],
    },
    missingEvidenceOrUnmeasuredGate: {
      count: groupedRows.missingEvidenceOrUnmeasuredGate.length,
      evidenceQuality: "missing_or_unmeasured_gate",
      topReasons: countByReason(groupedRows.missingEvidenceOrUnmeasuredGate),
      requiredProof: [
        "owner_specific_projection_delta",
        "materializer_non_regression",
        "cross_week_and_deload_projection",
      ],
    },
  };
}

function currentV2PolicyGapEvidence(
  gap: V2RepairPromotionScoreboard["interpretation"]["currentV2PolicyGap"]
): string[] {
  return Object.entries(gap)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}=${value}`);
}

function currentV2PolicyGapOwnerSeams(
  gap: V2RepairPromotionScoreboard["interpretation"]["currentV2PolicyGap"]
): string[] {
  const owners: string[] = [];
  if (
    gap.supportDirectFloorBlockerCount > 0 ||
    gap.setDistributionCapacityGapCount > 0 ||
    gap.setBudgetPolicyFailureCount > 0 ||
    gap.capAwareExpansionLimitationCount > 0
  ) {
    owners.push("SetDistributionIntent");
  }
  if (
    gap.selectionFeasibilityCapacityPressureCount > 0 ||
    gap.selectionBlockerCount > 0
  ) {
    owners.push("ExerciseSelectionPlan");
  }
  if (gap.classTaxonomyMismatchCount > 0) {
    owners.push("ExerciseClassDistributionBySlot");
  }
  if (gap.concentrationQualityGapCount > 0 || gap.optionalDiagnosticLaneCount > 0) {
    owners.push("SlotDemandAllocationByWeek");
  }
  if (gap.staleWeek1ReadoutArtifactCount > 0) {
    owners.push("audit_readout_cleanup");
  }
  return uniqueSorted(owners);
}

function buildMissingProofBeforeBehaviorPromotion(input: {
  promotionCandidates: ReadonlyArray<V2RepairPromotionCandidate>;
  currentV2PolicyGap: V2RepairPromotionScoreboard["interpretation"]["currentV2PolicyGap"];
}): V2RepairPromotionScoreboard["interpretation"]["missingProofBeforeBehaviorPromotion"] {
  const gapEvidence = currentV2PolicyGapEvidence(input.currentV2PolicyGap);
  const gapOwnerSeams = currentV2PolicyGapOwnerSeams(input.currentV2PolicyGap);
  return [
    {
      gate: "owner_specific_behavior_candidate",
      status: input.promotionCandidates.length > 0 ? "pass" : "missing",
      ownerSeam:
        input.promotionCandidates.length > 0
          ? uniqueSorted(input.promotionCandidates.map((row) => row.correctOwner)).join(",")
          : "repairPromotionScoreboard",
      missingEvidence:
        input.promotionCandidates.length > 0
          ? []
          : ["positive_slot_owned_likely_avoidable_row_not_demoted_by_v2_context"],
      evidence: [`behaviorPromotionCandidateCount=${input.promotionCandidates.length}`],
    },
    {
      gate: "current_v2_policy_gap",
      status: gapEvidence.length > 0 ? "blocked" : "pass",
      ownerSeam: gapOwnerSeams.length > 0 ? gapOwnerSeams.join(",") : "none",
      missingEvidence:
        gapEvidence.length > 0
          ? ["resolve_or_measure_current_v2_policy_gaps_before_behavior"]
          : [],
      evidence: gapEvidence.length > 0 ? gapEvidence : ["currentV2PolicyGap=none"],
    },
    {
      gate: "measured_behavior_projection",
      status: "missing",
      ownerSeam: "read_only_projection_or_materializer_comparison",
      missingEvidence: [
        "measured_projection_delta",
        "materializer_non_regression",
        "cross_week_accumulation_projection",
        "deload_projection",
      ],
      evidence: ["repair_scoreboard_is_repaired_projection_evidence_only"],
    },
    {
      gate: "seed_runtime_non_consumption",
      status: "required_before_promotion",
      ownerSeam: "accepted_seed_runtime_replay",
      missingEvidence: [
        "focused_seed_runtime_guard_tests_for_any_future_behavior_promotion",
      ],
      evidence: [
        "diagnostic_readout_does_not_change_slotPlanSeedJson_or_runtime_replay",
      ],
    },
  ];
}

export function buildRepairPromotionScoreboard(
  planningReality: PlanningRealityDiagnostic | undefined,
  v2Context?: V2RepairPromotionReadoutContext
): V2RepairPromotionScoreboard | undefined {
  if (!planningReality) {
    return undefined;
  }
  const repairRows = planningReality.repairMaterialityAfterShadowAllocation;
  const rawSuspiciousRows = planningReality.suspiciousRepairsNotEligibleForPromotion.map(
    (row) => ({
      slotId: row.slotId,
      muscle: row.muscle,
      exerciseName: row.exerciseName,
      repairMechanism: row.repairMechanism,
      reason: row.reason,
      recommendation: row.recommendation,
    })
  );
  const suspiciousKeys = new Set(rawSuspiciousRows.map(repairRowKey));
  const rawPromotionCandidateRows = repairRows.filter((row) =>
    isPromotionCandidateRepairRow({ row, suspiciousKeys })
  );
  const v2DemotedPromotionRows = rawPromotionCandidateRows
    .map((row) => ({
      row,
      demotionReasons: buildV2RepairDemotionReasons(row, v2Context),
    }))
    .filter((row) => row.demotionReasons.length > 0);
  const v2DemotedKeys = new Set(
    v2DemotedPromotionRows.map(({ row }) => repairRowKey(row))
  );
  const promotionCandidates = rawPromotionCandidateRows
    .filter((row) => !v2DemotedKeys.has(repairRowKey(row)))
    .map((row) => ({
      slotId: row.slotId as string,
      muscle: row.muscle as string,
      exerciseName: row.exerciseName ?? null,
      action: row.action,
      materiality: row.materiality,
      repairMechanism: row.repairMechanism,
      correctOwner: correctPromotionOwner(row),
      evidence: repairPromotionEvidence(row),
    }))
    .sort(
      (left, right) =>
        left.slotId.localeCompare(right.slotId) ||
        left.muscle.localeCompare(right.muscle) ||
        (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "") ||
        left.action.localeCompare(right.action)
    );
  const promotionKeys = new Set(
    promotionCandidates.map((row) => repairRowKey(row))
  );
  const rawPromotionKeys = new Set(rawPromotionCandidateRows.map(repairRowKey));
  const doNotPromoteRows = repairRows
    .filter((row) => !promotionKeys.has(repairRowKey(row)))
    .filter((row) => !rawPromotionKeys.has(repairRowKey(row)))
    .map((row) => classifyDoNotPromoteRepairRow(row, suspiciousKeys))
    .concat(
      v2DemotedPromotionRows.map(({ row, demotionReasons }) =>
        classifyV2DemotedPromotionRepairRow(row, demotionReasons)
      )
    )
    .sort(
      (left, right) =>
        (left.bucket ?? "").localeCompare(right.bucket ?? "") ||
        (left.slotId ?? "").localeCompare(right.slotId ?? "") ||
        (left.muscle ?? "").localeCompare(right.muscle ?? "") ||
        (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "") ||
        left.action.localeCompare(right.action)
    );
  const safetyNetRows = doNotPromoteRows
    .filter((row) => row.bucket === "safety_net")
    .map(withoutDoNotPromoteBucket);
  const collateralDiagnosticRows = doNotPromoteRows
    .filter((row) => row.bucket === "collateral_diagnostic")
    .map(withoutDoNotPromoteBucket);
  const diagnosticRows = doNotPromoteRows
    .filter((row) => row.bucket === "diagnostic_only")
    .map(withoutDoNotPromoteBucket);
  const materialRows = repairRows.filter(isRawMaterialRepair);
  const rawRepairEvidence = {
    rawRowCount: repairRows.length,
    materialRepairCount:
      planningReality.shadowRepairSummary?.materialRepairCount ??
      materialRows.length,
    majorRepairCount:
      planningReality.shadowRepairSummary?.majorRepairCount ??
      repairRows.filter((row) => row.materiality === "major").length,
    likelyAvoidableMaterialRepairCount:
      planningReality.shadowRepairSummary?.likelyAvoidableMaterialRepairCount ??
      materialRows.filter((row) => row.likelyAvoidableWithShadowAllocation)
        .length,
    remainingMaterialRepairCount:
      planningReality.shadowRepairSummary?.remainingMaterialRepairCount ??
      materialRows.filter((row) => !row.likelyAvoidableWithShadowAllocation)
        .length,
    suspiciousRepairCount: rawSuspiciousRows.length,
  };
  const staleRepairedProjectionArtifacts =
    countStaleRepairedProjectionArtifacts(doNotPromoteRows);
  const currentV2PolicyGap = buildCurrentV2PolicyGap(v2Context);
  const quarantineGroups = buildQuarantineGroups({
    promotionCandidates,
    doNotPromoteRows,
  });
  const missingProofBeforeBehaviorPromotion =
    buildMissingProofBeforeBehaviorPromotion({
      promotionCandidates,
      currentV2PolicyGap,
    });

  return {
    version: 1,
    readOnly: true,
    affectsScoringOrGeneration: false,
    source: "repaired_planning_reality",
    rawRepairEvidence,
    summary: {
      promotionCandidateCount: promotionCandidates.length,
      doNotPromoteCount: doNotPromoteRows.length,
      safetyNetCount: safetyNetRows.length,
      collateralDiagnosticCount: collateralDiagnosticRows.length,
      diagnosticOnlyCount: diagnosticRows.length,
    },
    interpretation: {
      legacyRepairPressure: {
        ...rawRepairEvidence,
        note: "raw_legacy_repair_evidence_not_behavior_promotion_pressure",
      },
      currentV2PolicyGap,
      safetyNonRegressionRows: {
        count: safetyNetRows.length,
        includesSuspiciousRows: rawSuspiciousRows.length > 0,
      },
      staleRepairedProjectionArtifacts,
      quarantineGroups,
      missingProofBeforeBehaviorPromotion,
      legacyRepairQuarantine: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        repairedProjectionRole: "legacy_evidence_not_target_policy",
        policyPromotionBasis: "positive_slot_owned_likely_avoidable_rows_only",
        rawLegacyEvidenceRowCount: repairRows.length,
        behaviorPromotionCandidateCount: promotionCandidates.length,
        quarantinedRowCount: doNotPromoteRows.length,
        safetyNetCount: safetyNetRows.length,
        collateralDiagnosticCount: collateralDiagnosticRows.length,
        diagnosticOnlyCount: diagnosticRows.length,
        staleRepairedProjectionArtifactCount:
          staleRepairedProjectionArtifacts.count,
        suspiciousRepairCount: rawSuspiciousRows.length,
      },
    },
    promotionCandidates,
    doNotPromoteRows,
    safetyNetRows,
    collateralDiagnosticRows,
    diagnosticRows,
    rawSuspiciousRows,
  };
}
