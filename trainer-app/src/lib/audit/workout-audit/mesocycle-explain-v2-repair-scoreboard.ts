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
  v2CapacityMaterializerProjection?: MesocycleExplainPlannerOnlyNoRepair["v2CapacityMaterializerProjection"];
  v2LaneIntentMaterializerProjection?: MesocycleExplainPlannerOnlyNoRepair["v2LaneIntentMaterializerProjection"];
  v2BasePlanShadowConsumptionTrial?: MesocycleExplainPlannerOnlyNoRepair["v2BasePlanShadowConsumptionTrial"];
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

type GapInventoryRow =
  V2RepairPromotionScoreboard["interpretation"]["gapInventory"][number];
type GapInventoryCandidate = Omit<GapInventoryRow, "rank"> & {
  score: number;
};
type TaxonomyMismatchInventory = NonNullable<
  V2RepairPromotionScoreboard["interpretation"]["taxonomyMismatchInventory"]
>;
type TaxonomyMismatchRow = TaxonomyMismatchInventory["rows"][number];

function importanceScore(importance: GapInventoryRow["trainingImportance"]): number {
  if (importance === "high") {
    return 60;
  }
  if (importance === "medium") {
    return 30;
  }
  return 10;
}

function measuredProjectionBonus(
  evidenceQuality: GapInventoryRow["evidenceQuality"],
): number {
  return evidenceQuality === "measured_materializer_projection" ? 50 : 0;
}

function buildGapCandidate(
  input: Omit<GapInventoryCandidate, "score">,
): GapInventoryCandidate {
  return {
    ...input,
    score:
      importanceScore(input.trainingImportance) +
      measuredProjectionBonus(input.evidenceQuality) +
      input.gapCount,
  };
}

function taxonomyMismatchId(input: {
  week: number;
  slotId: string;
  laneId: string;
}): string {
  return `week_${input.week}:${input.slotId}:${input.laneId}`;
}

function taxonomyMismatchOwner(
  lane: V2RepairPromotionReadoutContext["v2ExerciseSelectionPlanDiagnostic"]["weeks"][number]["slots"][number]["lanes"][number],
): TaxonomyMismatchRow["likelyOwnerSeam"] {
  if (
    lane.inventoryStatus === "classification_gap" ||
    lane.selectedIdentity == null
  ) {
    return "ExerciseClassDistributionBySlot";
  }
  if (lane.cleanAlternatives.length > 0) {
    return "ExerciseSelectionPlan";
  }
  if (
    lane.evidenceRefs.some((ref) =>
      /readout_note|diagnostic_only|keep_diagnostic_only/i.test(ref),
    )
  ) {
    return "audit_readout_cleanup";
  }
  return "ExerciseClassDistributionBySlot";
}

function taxonomyMismatchEvidenceQuality(
  lane: V2RepairPromotionReadoutContext["v2ExerciseSelectionPlanDiagnostic"]["weeks"][number]["slots"][number]["lanes"][number],
): TaxonomyMismatchRow["evidenceQuality"] {
  if (lane.cleanAlternatives.length > 0) {
    return "candidate_alternative_available";
  }
  if (
    lane.evidenceRefs.some((ref) =>
      /readout_note|diagnostic_only|keep_diagnostic_only/i.test(ref),
    )
  ) {
    return "diagnostic_only";
  }
  return "selected_identity_lane_mismatch";
}

function taxonomyMismatchTrainingImportance(
  lane: V2RepairPromotionReadoutContext["v2ExerciseSelectionPlanDiagnostic"]["weeks"][number]["slots"][number]["lanes"][number],
): TaxonomyMismatchRow["trainingImportance"] {
  if (
    lane.selectedIdentity &&
    lane.selectedIdentity.setCount >= 2 &&
    lane.primaryMuscles.some((muscle) =>
      ["Chest", "Hamstrings", "Quads", "Lats", "Side Delts"].includes(muscle),
    )
  ) {
    return "high";
  }
  return lane.selectedIdentity ? "medium" : "low";
}

function taxonomyMismatchScore(row: Omit<TaxonomyMismatchRow, "rank">): number {
  return (
    importanceScore(row.trainingImportance) +
    (row.affectsSelectedIdentities ? 30 : 0) +
    (row.evidenceQuality === "candidate_alternative_available" ? 20 : 0) +
    row.affectsSelectedIdentitySets
  );
}

function taxonomyMismatchClassification(
  row: Omit<TaxonomyMismatchRow, "rank">,
): TaxonomyMismatchRow["classification"] {
  if (row.evidenceQuality === "diagnostic_only") {
    return "diagnostic_only_mismatch";
  }
  if (row.evidenceQuality === "stale_or_ambiguous") {
    return "stale_or_ambiguous";
  }
  return row.likelyOwnerSeam === "ExerciseClassDistributionBySlot"
    ? "true_v2_policy_class_taxonomy_gap"
    : "blocked_by_missing_evidence";
}

function buildTaxonomyMismatchInventoryForDiagnostic(
  diagnostic: V2RepairPromotionReadoutContext["v2ExerciseSelectionPlanDiagnostic"],
): TaxonomyMismatchInventory | undefined {
  const candidates = diagnostic.weeks.flatMap((week) =>
    week.slots.flatMap((slot) =>
      slot.lanes
        .filter((lane) => lane.laneClassStatus === "mismatch")
        .map((lane) => {
          const owner = taxonomyMismatchOwner(lane);
          const evidenceQuality = taxonomyMismatchEvidenceQuality(lane);
          const base = {
            mismatchId: taxonomyMismatchId({
              week: week.week,
              slotId: slot.slotId,
              laneId: lane.laneId,
            }),
            week: week.week,
            slotId: slot.slotId,
            laneId: lane.laneId,
            muscles: lane.primaryMuscles,
            plannedClasses: lane.plannedClass,
            selectedExerciseName: lane.selectedIdentity?.exerciseName ?? null,
            selectedExerciseId: lane.selectedIdentity?.exerciseId ?? null,
            selectedClass:
              lane.selectedIdentity && lane.selectedIdentity.exerciseName
                ? lane.evidenceRefs
                    .find((ref) => ref.startsWith("selectedClass:"))
                    ?.replace(/^selectedClass:/, "") ?? null
                : null,
            laneClassStatus: "mismatch" as const,
            likelyOwnerSeam: owner,
            evidenceQuality,
            trainingImportance: taxonomyMismatchTrainingImportance(lane),
            affectsSelectedIdentities: Boolean(lane.selectedIdentity),
            affectsSelectedIdentitySets: lane.selectedIdentity?.setCount ?? 0,
            evidence: uniqueSorted([
              `week=${week.week}`,
              `slot=${slot.slotId}`,
              `lane=${lane.laneId}`,
              `plannedClasses=${lane.plannedClass.join(",")}`,
              ...(lane.selectedIdentity
                ? [
                    `selectedIdentity=${lane.selectedIdentity.exerciseName}`,
                    `selectedSets=${lane.selectedIdentity.setCount}`,
                  ]
                : ["selectedIdentity=none"]),
              `inventoryStatus=${lane.inventoryStatus}`,
              `identityStatus=${lane.identityStatus}`,
              ...lane.evidenceRefs.slice(0, 6),
            ]),
            missingProof: uniqueSorted([
              "taxonomy_bridge_no_drift_materializer_probe",
              "selected_identity_non_regression",
              "seed_runtime_non_consumption_gate",
              ...(lane.cleanAlternatives.length > 0
                ? ["exercise_selection_alternative_ranking_proof"]
                : ["taxonomy_bridge_fixture"]),
            ]),
            nextMeasurement: "build_taxonomy_bridge_no_drift_probe",
            classification: "blocked_by_missing_evidence" as const,
          };
          return {
            ...base,
            classification: taxonomyMismatchClassification(base),
            score: taxonomyMismatchScore(base),
          };
        }),
    ),
  );

  const rows = candidates
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.mismatchId.localeCompare(right.mismatchId),
    )
    .map((row, index) => {
      const { score, ...rest } = row;
      void score;
      return { ...rest, rank: index + 1 };
    });
  if (rows.length === 0) {
    return undefined;
  }
  const ownerCounts = rows.reduce<TaxonomyMismatchInventory["summary"]["ownerCounts"]>(
    (counts, row) => {
      counts[row.likelyOwnerSeam] = (counts[row.likelyOwnerSeam] ?? 0) + 1;
      return counts;
    },
    {},
  );

  return {
    version: 1,
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    source: "v2_exercise_selection_plan_diagnostic",
    summary: {
      mismatchRowCount: rows.length,
      selectedIdentityAffectedCount: rows.filter(
        (row) => row.affectsSelectedIdentities,
      ).length,
      cleanAlternativeAvailableCount: rows.filter(
        (row) => row.evidenceQuality === "candidate_alternative_available",
      ).length,
      ownerCounts,
      selectedMismatchId: rows[0]?.mismatchId ?? null,
    },
    rows,
  };
}

function buildTaxonomyMismatchInventory(
  context?: V2RepairPromotionReadoutContext,
): TaxonomyMismatchInventory | undefined {
  return context
    ? buildTaxonomyMismatchInventoryForDiagnostic(
        context.v2ExerciseSelectionPlanDiagnostic,
      )
    : undefined;
}

export function selectTaxonomyMismatchMaterializerTarget(
  diagnostic: V2RepairPromotionReadoutContext["v2ExerciseSelectionPlanDiagnostic"],
): { slotId: string; laneId: string; trialId: string } | undefined {
  const inventory = buildTaxonomyMismatchInventoryForDiagnostic(diagnostic);
  const row = selectTaxonomyMismatchRow({ inventory });
  return row
    ? {
        slotId: row.slotId,
        laneId: row.laneId,
        trialId: `${row.slotId}_${row.laneId}_taxonomy_bridge_shadow`,
      }
    : undefined;
}

function materializerGateSummary(
  projection?: V2RepairPromotionReadoutContext["v2CapacityMaterializerProjection"],
): string[] {
  if (!projection) {
    return [];
  }
  const gateCounts = projection.gates.reduce<Record<string, number>>(
    (counts, gate) => {
      counts[gate.status] = (counts[gate.status] ?? 0) + 1;
      return counts;
    },
    {},
  );
  return [
    `capacityMaterializerStatus=${projection.status}`,
    `candidateImpact.selectedIdentityDelta=${projection.candidateImpact.selectedIdentityDelta}`,
    `candidateImpact.totalSetDelta=${projection.candidateImpact.totalSetDelta}`,
    `candidateImpact.targetSlotExerciseDelta=${projection.candidateImpact.targetSlotExerciseDelta}`,
    `candidateImpact.regressionCount=${projection.candidateImpact.regressionCount}`,
    `materializer.baseline=${projection.materializer.baselineStatus}`,
    `materializer.trial=${projection.materializer.trialStatus}`,
    `gates.pass=${gateCounts.pass ?? 0}`,
    `gates.fail=${gateCounts.fail ?? 0}`,
    `gates.unknown=${gateCounts.unknown ?? 0}`,
  ];
}

function materializerMissingGates(
  projection?: V2RepairPromotionReadoutContext["v2CapacityMaterializerProjection"],
): string[] {
  if (!projection) {
    return [
      "read_only_materializer_projection",
      "candidate_identity_delta",
      "seed_runtime_non_consumption_gate",
    ];
  }
  return uniqueSorted([
    ...projection.blockersBeforeBehavior,
    ...projection.gates
      .filter((gate) => gate.status !== "pass" || !gate.measured)
      .flatMap((gate) => [
        `${gate.gateId}:${gate.status}`,
        ...gate.requiredNextEvidence,
      ]),
  ]);
}

function taxonomyProjectionMatchesRow(input: {
  row: TaxonomyMismatchRow;
  projection?: V2RepairPromotionReadoutContext["v2LaneIntentMaterializerProjection"];
}): boolean {
  return Boolean(
    input.projection &&
      input.projection.targetLane.slotId === input.row.slotId &&
      input.projection.targetLane.laneId === input.row.laneId,
  );
}

function selectTaxonomyMismatchRow(input: {
  inventory?: TaxonomyMismatchInventory;
  projection?: V2RepairPromotionReadoutContext["v2LaneIntentMaterializerProjection"];
}): TaxonomyMismatchRow | undefined {
  if (!input.inventory) {
    return undefined;
  }
  const projectedRow = input.inventory.rows.find((row) =>
    taxonomyProjectionMatchesRow({ row, projection: input.projection }),
  );
  return projectedRow ?? input.inventory.rows[0];
}

function taxonomyMaterializerGateSummary(
  projection: NonNullable<
    V2RepairPromotionReadoutContext["v2LaneIntentMaterializerProjection"]
  >,
): string[] {
  return [
    `taxonomyBridgeTrialId=${projection.trialId}`,
    `taxonomyBridgeStatus=${projection.status}`,
    `candidateImpact.selectedIdentityDelta=${projection.candidateImpact.selectedIdentityDelta}`,
    `candidateImpact.totalSetDelta=${projection.candidateImpact.totalSetDelta}`,
    `candidateImpact.targetLaneExerciseDelta=${projection.candidateImpact.targetLaneExerciseDelta}`,
    `candidateImpact.materializerBlockerDelta=${projection.candidateImpact.materializerBlockerDelta}`,
    `candidateImpact.regressionCount=${projection.candidateImpact.regressionCount}`,
    `materializer.baseline=${projection.materializer.baselineStatus}`,
    `materializer.trial=${projection.materializer.trialStatus}`,
    `targetLane.baselineConsumedByProduction=${projection.targetLane.baselineConsumedByProduction}`,
    `targetLane.trialConsumesLaneIntent=${projection.targetLane.trialConsumesLaneIntent}`,
  ];
}

function taxonomyMaterializerMissingGates(
  projection?: V2RepairPromotionReadoutContext["v2LaneIntentMaterializerProjection"],
): string[] {
  if (!projection) {
    return [
      "taxonomy_bridge_fixture",
      "materializer_identity_non_regression",
      "seed_runtime_non_consumption_gate",
    ];
  }
  return uniqueSorted([
    ...projection.blockersBeforeBehavior,
    ...(projection.materializer.trialSeedShapeCompatible
      ? []
      : ["trial_seed_shape_incompatible"]),
    ...(projection.consumedByProduction
      ? ["projection_must_not_be_consumed_by_production"]
      : []),
    ...(projection.consumedByDemandOrMaterializer
      ? ["projection_must_not_feed_demand_or_materializer_policy"]
      : []),
  ]);
}

function buildGapInventory(input: {
  currentV2PolicyGap: V2RepairPromotionScoreboard["interpretation"]["currentV2PolicyGap"];
  taxonomyMismatchInventory?: TaxonomyMismatchInventory;
  context?: V2RepairPromotionReadoutContext;
}): V2RepairPromotionScoreboard["interpretation"]["gapInventory"] {
  const gap = input.currentV2PolicyGap;
  const capacityProjection = input.context?.v2CapacityMaterializerProjection;
  const taxonomyProjection = input.context?.v2LaneIntentMaterializerProjection;
  const taxonomyInventory = input.taxonomyMismatchInventory;
  const selectedTaxonomyRow = selectTaxonomyMismatchRow({
    inventory: taxonomyInventory,
    projection: taxonomyProjection,
  });
  const candidates: GapInventoryCandidate[] = [];

  if (
    gap.selectionFeasibilityCapacityPressureCount > 0 ||
    capacityProjection
  ) {
    const measuredNoImpact =
      capacityProjection &&
      capacityProjection.candidateImpact.selectedIdentityDelta === 0 &&
      capacityProjection.candidateImpact.totalSetDelta === 0 &&
      capacityProjection.candidateImpact.targetSlotExerciseDelta === 0 &&
      capacityProjection.candidateImpact.regressionCount === 0;
    candidates.push(
      buildGapCandidate({
        gapId: "selection_capacity_pressure",
        description:
          "Selection capacity pressure needs proof that extra slot capacity changes materialized identities or sets.",
        likelyOwnerSeam: "SelectionCapacityPlan -> v2_materialization_dry_run",
        evidenceQuality: capacityProjection
          ? "measured_materializer_projection"
          : "diagnostic_count",
        trainingImportance: measuredNoImpact ? "low" : "high",
        gapCount: gap.selectionFeasibilityCapacityPressureCount,
        currentEvidence: uniqueSorted([
          `selectionFeasibilityCapacityPressureCount=${gap.selectionFeasibilityCapacityPressureCount}`,
          ...(capacityProjection?.trialId
            ? [`trialId=${capacityProjection.trialId}`]
            : []),
          ...materializerGateSummary(capacityProjection),
        ]),
        missingProof: materializerMissingGates(capacityProjection),
        measurableNextStep:
          capacityProjection?.nextSafeAction ??
          "run_read_only_materializer_capacity_projection",
        status: measuredNoImpact
          ? "measured_no_candidate_impact"
          : capacityProjection
            ? "selected_for_measured_proof"
            : "blocked_by_missing_evidence",
      }),
    );
  }

  if (gap.supportDirectFloorBlockerCount > 0) {
    candidates.push(
      buildGapCandidate({
        gapId: "support_direct_floor",
        description:
          "Support muscles still need direct-floor ownership separated from collateral credit.",
        likelyOwnerSeam: "SetDistributionIntent",
        evidenceQuality: "diagnostic_count",
        trainingImportance: "high",
        gapCount: gap.supportDirectFloorBlockerCount,
        currentEvidence: [
          `supportDirectFloorBlockerCount=${gap.supportDirectFloorBlockerCount}`,
        ],
        missingProof: [
          "owner_specific_projection_delta",
          "materializer_non_regression",
          "cross_week_direct_floor_projection",
        ],
        measurableNextStep: "measure_support_floor_materializer_projection",
        status: "blocked_by_missing_evidence",
      }),
    );
  }

  if (gap.classTaxonomyMismatchCount > 0) {
    const taxonomyProjectionMatches =
      selectedTaxonomyRow &&
      taxonomyProjectionMatchesRow({
        row: selectedTaxonomyRow,
        projection: taxonomyProjection,
      });
    const taxonomyNoDrift =
      taxonomyProjectionMatches &&
      taxonomyProjection &&
      taxonomyProjection.candidateImpact.selectedIdentityDelta === 0 &&
      taxonomyProjection.candidateImpact.totalSetDelta === 0 &&
      taxonomyProjection.candidateImpact.targetLaneExerciseDelta === 0 &&
      taxonomyProjection.candidateImpact.materializerBlockerDelta === 0 &&
      taxonomyProjection.candidateImpact.regressionCount === 0;
    candidates.push(
      buildGapCandidate({
        gapId: "class_taxonomy_mismatch",
        description:
          "Exercise class/taxonomy mismatches block trusting selected identities as lane-fit proof.",
        likelyOwnerSeam:
          selectedTaxonomyRow?.likelyOwnerSeam ?? "ExerciseClassDistributionBySlot",
        evidenceQuality: "diagnostic_count",
        trainingImportance: "high",
        gapCount:
          taxonomyInventory?.summary.mismatchRowCount ??
          gap.classTaxonomyMismatchCount,
        currentEvidence: uniqueSorted([
          `classTaxonomyMismatchCount=${gap.classTaxonomyMismatchCount}`,
          ...(taxonomyInventory
            ? [
                `inventoryRows=${taxonomyInventory.summary.mismatchRowCount}`,
                `selectedIdentityAffected=${taxonomyInventory.summary.selectedIdentityAffectedCount}`,
              ]
            : []),
          ...(selectedTaxonomyRow
            ? [
                `selectedMismatchId=${selectedTaxonomyRow.mismatchId}`,
                `selectedLane=${selectedTaxonomyRow.slotId}:${selectedTaxonomyRow.laneId}`,
                `selectedOwner=${selectedTaxonomyRow.likelyOwnerSeam}`,
              ]
            : []),
          ...(taxonomyProjectionMatches && taxonomyProjection
            ? taxonomyMaterializerGateSummary(taxonomyProjection)
            : []),
        ]),
        missingProof: taxonomyProjectionMatches
          ? taxonomyMaterializerMissingGates(taxonomyProjection)
          : selectedTaxonomyRow?.missingProof ?? [
              "taxonomy_bridge_fixture",
              "materializer_identity_non_regression",
            ],
        measurableNextStep:
          taxonomyProjectionMatches && taxonomyProjection
            ? taxonomyProjection.nextSafeAction
            : "build_taxonomy_bridge_no_drift_probe",
        status: taxonomyNoDrift
          ? "measured_no_drift"
          : taxonomyProjectionMatches
            ? "selected_for_measured_proof"
            : "blocked_by_missing_evidence",
      }),
    );
  }

  if (
    gap.setDistributionCapacityGapCount > 0 ||
    gap.setBudgetPolicyFailureCount > 0
  ) {
    candidates.push(
      buildGapCandidate({
        gapId: "set_distribution_budget",
        description:
          "Lane set budgets still need owner-specific proof before changing planner policy.",
        likelyOwnerSeam: "SetDistributionIntent",
        evidenceQuality: "diagnostic_count",
        trainingImportance: "high",
        gapCount:
          gap.setDistributionCapacityGapCount +
          gap.setBudgetPolicyFailureCount,
        currentEvidence: [
          `setDistributionCapacityGapCount=${gap.setDistributionCapacityGapCount}`,
          `setBudgetPolicyFailureCount=${gap.setBudgetPolicyFailureCount}`,
        ],
        missingProof: [
          "bounded_set_budget_projection_delta",
          "session_size_non_regression",
          "materializer_non_regression",
        ],
        measurableNextStep: "measure_set_distribution_projection_delta",
        status: "blocked_by_missing_evidence",
      }),
    );
  }

  if (gap.concentrationQualityGapCount > 0) {
    candidates.push(
      buildGapCandidate({
        gapId: "concentration_quality",
        description:
          "Concentration warnings need proof they are planner policy gaps rather than diagnostic readout noise.",
        likelyOwnerSeam: "SlotDemandAllocationByWeek",
        evidenceQuality: "diagnostic_count",
        trainingImportance: "medium",
        gapCount: gap.concentrationQualityGapCount,
        currentEvidence: [
          `concentrationQualityGapCount=${gap.concentrationQualityGapCount}`,
        ],
        missingProof: [
          "weekly_distribution_non_regression",
          "fatigue_concentration_delta",
        ],
        measurableNextStep: "measure_concentration_projection_delta",
        status: "blocked_by_missing_evidence",
      }),
    );
  }

  if (gap.staleWeek1ReadoutArtifactCount > 0) {
    candidates.push(
      buildGapCandidate({
        gapId: "stale_week1_readout",
        description:
          "Some Week 1 gaps are stale readout artifacts and must not become policy.",
        likelyOwnerSeam: "audit_readout_cleanup",
        evidenceQuality: "stale_or_ambiguous",
        trainingImportance: "low",
        gapCount: gap.staleWeek1ReadoutArtifactCount,
        currentEvidence: [
          `staleWeek1ReadoutArtifactCount=${gap.staleWeek1ReadoutArtifactCount}`,
        ],
        missingProof: ["compare_against_current_v2_no_repair_solution"],
        measurableNextStep: "clean_stale_readout_before_policy_work",
        status: "stale_or_ambiguous",
      }),
    );
  }

  if (gap.optionalDiagnosticLaneCount > 0) {
    candidates.push(
      buildGapCandidate({
        gapId: "optional_diagnostic_lane",
        description:
          "Optional lane misses are diagnostic until a direct behavior gate proves need and recoverability.",
        likelyOwnerSeam: "SlotDemandAllocationByWeek",
        evidenceQuality: "diagnostic_count",
        trainingImportance: "low",
        gapCount: gap.optionalDiagnosticLaneCount,
        currentEvidence: [
          `optionalDiagnosticLaneCount=${gap.optionalDiagnosticLaneCount}`,
        ],
        missingProof: [
          "optional_activation_need",
          "recoverability_non_regression",
        ],
        measurableNextStep: "keep_optional_lane_diagnostic_only",
        status: "diagnostic_only",
      }),
    );
  }

  return candidates
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.gapId.localeCompare(right.gapId),
    )
    .map((row, index) => ({
      gapId: row.gapId,
      description: row.description,
      likelyOwnerSeam: row.likelyOwnerSeam,
      evidenceQuality: row.evidenceQuality,
      trainingImportance: row.trainingImportance,
      gapCount: row.gapCount,
      currentEvidence: row.currentEvidence,
      missingProof: row.missingProof,
      measurableNextStep: row.measurableNextStep,
      status: row.status,
      rank: index + 1,
    }));
}

function buildSelectedGapProof(input: {
  gapInventory: ReadonlyArray<GapInventoryRow>;
  taxonomyMismatchInventory?: TaxonomyMismatchInventory;
  context?: V2RepairPromotionReadoutContext;
}): V2RepairPromotionScoreboard["interpretation"]["selectedGapProof"] {
  const taxonomyProjection = input.context?.v2LaneIntentMaterializerProjection;
  const selectedTaxonomyRow = selectTaxonomyMismatchRow({
    inventory: input.taxonomyMismatchInventory,
    projection: taxonomyProjection,
  });
  const taxonomyGap = input.gapInventory.find(
    (row) => row.gapId === "class_taxonomy_mismatch",
  );
  const selected =
    (taxonomyGap &&
    (input.gapInventory[0]?.gapId === "selection_capacity_pressure"
      ? input.gapInventory[0].status === "measured_no_candidate_impact"
      : true)
      ? taxonomyGap
      : undefined) ??
    input.gapInventory.find(
      (row) =>
        row.evidenceQuality === "measured_materializer_projection" &&
        row.status !== "measured_no_candidate_impact",
    ) ??
    input.gapInventory[0];
  if (!selected) {
    return undefined;
  }
  const capacityProjection = input.context?.v2CapacityMaterializerProjection;
  if (
    selected.gapId === "selection_capacity_pressure" &&
    capacityProjection
  ) {
    const noCandidateImpact =
      capacityProjection.candidateImpact.selectedIdentityDelta === 0 &&
      capacityProjection.candidateImpact.totalSetDelta === 0 &&
      capacityProjection.candidateImpact.targetSlotExerciseDelta === 0 &&
      capacityProjection.candidateImpact.regressionCount === 0;
    return {
      gapId: selected.gapId,
      classification: "materializer_owned",
      proofResult: noCandidateImpact
        ? "measured_no_candidate_impact"
        : "measured_with_missing_gates",
      rightfulOwnerSeam: selected.likelyOwnerSeam,
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      safeForBehaviorPromotion: false,
      measuredEvidence: selected.currentEvidence,
      missingGates: selected.missingProof,
      nextSafeAction: capacityProjection.nextSafeAction,
    };
  }
  if (selected.gapId === "class_taxonomy_mismatch") {
    const projectionMatches =
      selectedTaxonomyRow &&
      taxonomyProjectionMatchesRow({
        row: selectedTaxonomyRow,
        projection: taxonomyProjection,
      });
    const noDrift =
      projectionMatches &&
      taxonomyProjection &&
      taxonomyProjection.candidateImpact.selectedIdentityDelta === 0 &&
      taxonomyProjection.candidateImpact.totalSetDelta === 0 &&
      taxonomyProjection.candidateImpact.targetLaneExerciseDelta === 0 &&
      taxonomyProjection.candidateImpact.materializerBlockerDelta === 0 &&
      taxonomyProjection.candidateImpact.regressionCount === 0;
    const candidateDelta =
      projectionMatches &&
      taxonomyProjection &&
      !noDrift &&
      (taxonomyProjection.candidateImpact.selectedIdentityDelta !== 0 ||
        taxonomyProjection.candidateImpact.totalSetDelta !== 0 ||
        taxonomyProjection.candidateImpact.targetLaneExerciseDelta !== 0 ||
        taxonomyProjection.candidateImpact.materializerBlockerDelta !== 0);

    return {
      gapId: selected.gapId,
      ...(selectedTaxonomyRow
        ? { selectedMismatchId: selectedTaxonomyRow.mismatchId }
        : {}),
      classification: noDrift
        ? "diagnostic_only_mismatch"
        : candidateDelta
          ? "materializer_taxonomy_bridge_gap"
          : selectedTaxonomyRow?.classification ??
            "blocked_by_missing_evidence",
      proofResult: noDrift
        ? "measured_no_drift"
        : projectionMatches
          ? "measured_with_missing_gates"
          : "blocked_by_missing_evidence",
      rightfulOwnerSeam:
        selectedTaxonomyRow?.likelyOwnerSeam ?? selected.likelyOwnerSeam,
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      safeForBehaviorPromotion: false,
      measuredEvidence: uniqueSorted([
        ...selected.currentEvidence,
        ...(selectedTaxonomyRow ? selectedTaxonomyRow.evidence : []),
        ...(projectionMatches && taxonomyProjection
          ? taxonomyMaterializerGateSummary(taxonomyProjection)
          : []),
      ]),
      missingGates: projectionMatches
        ? taxonomyMaterializerMissingGates(taxonomyProjection)
        : selectedTaxonomyRow?.missingProof ?? selected.missingProof,
      nextSafeAction:
        projectionMatches && taxonomyProjection
          ? taxonomyProjection.nextSafeAction
          : selected.measurableNextStep,
    };
  }
  return {
    gapId: selected.gapId,
    classification:
      selected.status === "stale_or_ambiguous"
        ? "stale_or_ambiguous"
        : "blocked_by_missing_evidence",
    proofResult: "blocked_by_missing_evidence",
    rightfulOwnerSeam: selected.likelyOwnerSeam,
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    safeForBehaviorPromotion: false,
    measuredEvidence: selected.currentEvidence,
    missingGates: selected.missingProof,
    nextSafeAction: selected.measurableNextStep,
  };
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
  const taxonomyMismatchInventory = buildTaxonomyMismatchInventory(v2Context);
  const gapInventory = buildGapInventory({
    currentV2PolicyGap,
    taxonomyMismatchInventory,
    context: v2Context,
  });
  const selectedGapProof = buildSelectedGapProof({
    gapInventory,
    taxonomyMismatchInventory,
    context: v2Context,
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
      gapInventory,
      ...(taxonomyMismatchInventory ? { taxonomyMismatchInventory } : {}),
      ...(selectedGapProof ? { selectedGapProof } : {}),
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
