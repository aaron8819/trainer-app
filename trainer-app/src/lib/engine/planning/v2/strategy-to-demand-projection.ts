import type {
  V2MesocycleDemand,
  V2SlotOwnedDemandAdjustmentPlan,
  V2SlotDemandAllocationByWeek,
  V2StrategyToDemandDiff,
  V2StrategyToDemandProjection,
  V2WeeklyDemandCurve,
} from "./types";
import type { V2SetDistributionIntent } from "./set-distribution-intent";

export type V2StrategyToDemandProjectionInput = {
  strategyToDemandDiff: V2StrategyToDemandDiff;
  mesocycleDemand: V2MesocycleDemand;
  slotOwnedDemandAdjustmentPlan?: V2SlotOwnedDemandAdjustmentPlan;
  weeklyDemandCurve?: V2WeeklyDemandCurve;
  slotDemandAllocationByWeek?: V2SlotDemandAllocationByWeek;
  v2SetDistributionIntent?: V2SetDistributionIntent;
};

type ProjectionRow = V2StrategyToDemandProjection["rows"][number];
type BoundedTrial = V2StrategyToDemandProjection["boundedBehaviorTrial"];
type BoundedTrialRow = BoundedTrial["rows"][number];
type RedistributionContext = BoundedTrial["redistributionContext"];
type DownstreamBehaviorProjection = BoundedTrial["downstreamBehaviorProjection"];
type DownstreamBehaviorProjectionRow =
  DownstreamBehaviorProjection["rows"][number];

function demandByMuscle(
  demand: V2MesocycleDemand,
): ReadonlyMap<string, V2MesocycleDemand["muscles"][number]> {
  return new Map(demand.muscles.map((row) => [row.muscle, row]));
}

function requiredEvidenceForRow(
  row: V2StrategyToDemandDiff["rows"][number],
): string[] {
  if (row.readiness === "blocked") {
    return [
      "resolve_owner_or_safety_blocker_before_projection",
      "measured_non_regression_projection_required_before_behavior",
    ];
  }
  if (row.readiness === "monitor_only") {
    return [
      "additional_recurring_performed_evidence_before_behavior",
      "measured_non_regression_projection_required_before_behavior",
    ];
  }
  if (row.readiness === "needs_evidence") {
    return [
      "more_performed_history_evidence",
      "base_demand_owner_confirmation",
      "measured_non_regression_projection_required_before_behavior",
    ];
  }
  return [
    "measured_week_by_week_demand_projection",
    "priority_floor_preservation",
    "session_size_and_capacity_non_regression",
    "materializer_repair_pressure_non_regression",
  ];
}

function behaviorReadinessForRow(
  row: V2StrategyToDemandDiff["rows"][number],
): ProjectionRow["behaviorPromotion"]["readiness"] {
  if (row.readiness === "blocked") {
    return "blocked";
  }
  if (row.readiness === "monitor_only") {
    return "monitor_only";
  }
  if (row.readiness === "needs_evidence") {
    return "needs_more_evidence";
  }
  return "not_behavior_ready";
}

function zeroRangeDelta(): NonNullable<
  ProjectionRow["measuredCurrentNonRegression"]["rangeDelta"]
> {
  return { min: 0, preferred: 0, max: 0 };
}

function buildProjectionRow(input: {
  row: V2StrategyToDemandDiff["rows"][number];
  demand:
    | V2MesocycleDemand["muscles"][number]
    | undefined;
}): ProjectionRow {
  const baseDemandKnown = input.demand ? "pass" : "unknown";
  const floorPreservation =
    input.demand && input.demand.baselineSetRange.min > 0 ? "pass" : "unknown";
  const measuredCurrentProjection = input.demand ? "pass" : "unknown";
  const noNetNewVolume = input.demand ? "pass" : "unknown";
  const projectedRange = input.demand
    ? { ...input.demand.baselineSetRange }
    : undefined;

  return {
    zone: input.row.zone,
    scope: input.row.scope,
    ...(input.row.muscle ? { muscle: input.row.muscle } : {}),
    owner: input.row.owner,
    action: input.row.action,
    readiness: input.row.readiness,
    baseDemand: {
      available: Boolean(input.demand),
      ...(input.demand
        ? {
            role: input.demand.role,
            targetStatus: input.demand.targetStatus,
            targetTier: input.demand.targetTier,
            baselineSetRange: { ...input.demand.baselineSetRange },
            directSetFloor: input.demand.directness.directSetFloor,
          }
        : {}),
    },
    currentProjection: {
      rangeMutation: "none",
      ...(projectedRange ? { projectedRange } : {}),
      consumedByDemandOrMaterializer: false,
    },
    measuredCurrentNonRegression: {
      measurementMode: "current_no_mutation_projection",
      measured: Boolean(input.demand),
      ...(input.demand
        ? {
            baselineRange: { ...input.demand.baselineSetRange },
            projectedRange: { ...input.demand.baselineSetRange },
            rangeDelta: zeroRangeDelta(),
            netNewVolumeDelta: 0,
          }
        : {}),
      gateStatus: input.demand ? "pass" : "unknown",
      behaviorProjectionMeasured: false,
      limitations: input.demand
        ? [
            "measures_only_current_no_mutation_projection_against_static_mesocycle_demand",
            "does_not_measure_future_behavior_candidate_projection",
          ]
        : [
            "base_mesocycle_demand_missing_for_row",
            "future_behavior_candidate_projection_not_measured",
          ],
    },
    behaviorPromotion: {
      readiness: behaviorReadinessForRow(input.row),
      requiredEvidence: requiredEvidenceForRow(input.row),
      nonRegressionGates: {
        currentDemandUnchanged: "pass",
        baseDemandKnown,
        measuredCurrentProjection,
        measuredBehaviorProjection: "unknown",
        floorPreservation,
        noNetNewVolume,
      },
    },
    evidence: [...input.row.evidence],
    limitations: [
      ...input.row.limitations,
      "read_only_projection_does_not_mutate_mesocycle_demand",
      "current_no_mutation_projection_measured_against_static_mesocycle_demand",
      "future_behavior_candidate_projection_not_measured",
      "not_consumed_by_weekly_curve_slot_allocation_set_distribution_materializer_seed_or_runtime",
    ],
  };
}

function countRows(
  rows: ProjectionRow[],
  predicate: (row: ProjectionRow) => boolean,
): number {
  return rows.filter(predicate).length;
}

function allGatesPass(
  gates: BoundedTrialRow["gates"],
): boolean {
  return Object.values(gates).every((gate) => gate === "pass");
}

function boundedTrialReadiness(
  gates: BoundedTrialRow["gates"],
): BoundedTrialRow["readiness"] {
  if (allGatesPass(gates)) {
    return "ready_for_bounded_behavior_trial";
  }
  if (gates.slotOwnedRedistributionContext !== "pass") {
    return "needs_slot_owned_redistribution_context";
  }
  if (
    gates.noNetNewVolume !== "pass" ||
    gates.downstreamProjectionMeasured === "unknown" ||
    gates.materializerNonRegressionMeasured === "unknown"
  ) {
    return "needs_downstream_projection";
  }
  return "not_ready";
}

function boundedTrialBlockers(
  gates: BoundedTrialRow["gates"],
): string[] {
  const blockingReasons: string[] = [];
  if (gates.baseDemandKnown !== "pass") {
    blockingReasons.push("base_mesocycle_demand_missing");
  }
  if (gates.ownerIsDemandOrSlotAllocation !== "pass") {
    blockingReasons.push("behavior_owner_not_demand_or_slot_allocation");
  }
  if (gates.boundedDelta !== "pass") {
    blockingReasons.push("bounded_delta_not_available");
  }
  if (gates.slotOwnedRedistributionContext !== "pass") {
    blockingReasons.push("slot_owned_redistribution_context_required");
  }
  if (gates.noNetNewVolume === "fail") {
    blockingReasons.push("net_new_static_delta_requires_redistribution");
  } else if (gates.noNetNewVolume === "unknown") {
    blockingReasons.push("net_new_volume_non_regression_not_measured");
  }
  if (gates.downstreamProjectionMeasured !== "pass") {
    blockingReasons.push("downstream_projection_not_measured");
  }
  if (gates.materializerNonRegressionMeasured !== "pass") {
    blockingReasons.push("materializer_non_regression_not_measured");
  }
  return blockingReasons;
}

function buildRedistributionContext(
  slotOwnedPlan: V2SlotOwnedDemandAdjustmentPlan | undefined,
): RedistributionContext {
  const eligibleDonorCount =
    slotOwnedPlan?.donorDemand.filter((row) => row.eligible).length ?? 0;
  const protectedOwnedCount =
    slotOwnedPlan?.protectedDemand.filter((row) => row.status === "owned")
      .length ?? 0;

  return {
    source: slotOwnedPlan
      ? "v2_slot_owned_demand_adjustment_plan"
      : "not_provided",
    available:
      slotOwnedPlan?.status === "feasible" &&
      slotOwnedPlan.feasibility.status === "feasible" &&
      eligibleDonorCount > 0,
    ...(slotOwnedPlan
      ? {
          status: slotOwnedPlan.status,
          feasibilityStatus: slotOwnedPlan.feasibility.status,
        }
      : {}),
    protectedDemandCount: slotOwnedPlan?.protectedDemand.length ?? 0,
    protectedOwnedCount,
    donorDemandCount: slotOwnedPlan?.donorDemand.length ?? 0,
    eligibleDonorCount,
    netNewVolumeAllowed: false,
    maxSlotIncreaseAllowed: 0,
    nextRequiredEvidence: [
      ...(slotOwnedPlan?.feasibility.nextRequiredEvidence ?? []),
    ],
  };
}

function buildRowRedistributionContext(input: {
  row: ProjectionRow;
  slotOwnedPlan: V2SlotOwnedDemandAdjustmentPlan | undefined;
  context: RedistributionContext;
}): BoundedTrialRow["redistributionContext"] {
  const protectedRow = input.row.muscle
    ? input.slotOwnedPlan?.protectedDemand.find(
        (row) => row.muscle === input.row.muscle,
      )
    : undefined;
  const available =
    input.context.available &&
    protectedRow?.status === "owned" &&
    input.context.eligibleDonorCount > 0;

  return {
    available,
    ...(protectedRow
      ? {
          protectedStatus: protectedRow.status,
          reason: protectedRow.reason,
        }
      : {}),
    candidateSlotOwners: [...(protectedRow?.candidateSlotOwners ?? [])],
    eligibleDonorCount: input.context.eligibleDonorCount,
    limitations: [
      "redistribution_context_is_read_only_and_non_binding",
      "does_not_select_donor_offsets_or_mutate_slot_allocation",
      ...(available
        ? [
            "slot_owned_context_available_but_downstream_projection_not_measured",
          ]
        : ["matching_slot_owned_context_not_available_for_row"]),
    ],
  };
}

function buildBoundedTrialRow(input: {
  row: ProjectionRow;
  slotOwnedPlan: V2SlotOwnedDemandAdjustmentPlan | undefined;
  context: RedistributionContext;
}): BoundedTrialRow {
  const row = input.row;
  const redistributionContext = buildRowRedistributionContext({
    row,
    slotOwnedPlan: input.slotOwnedPlan,
    context: input.context,
  });
  const eligibleFloorDemand =
    row.readiness === "read_only_diff" &&
    row.action === "protect_floor" &&
    (row.owner === "MesocycleDemand" ||
      row.owner === "SlotDemandAllocation") &&
    row.baseDemand.available &&
    Boolean(row.baseDemand.baselineSetRange);
  const baselineRange = row.baseDemand.baselineSetRange;
  const proposedDelta = eligibleFloorDemand
    ? { min: 1, preferred: 1, max: 1 }
    : undefined;
  const proposedRange =
    eligibleFloorDemand && baselineRange
      ? {
          min: baselineRange.min + 1,
          preferred: baselineRange.preferred + 1,
          max: baselineRange.max + 1,
        }
      : undefined;
  const gates: BoundedTrialRow["gates"] = {
    baseDemandKnown: row.baseDemand.available ? "pass" : "unknown",
    ownerIsDemandOrSlotAllocation:
      row.owner === "MesocycleDemand" || row.owner === "SlotDemandAllocation"
        ? "pass"
        : "fail",
    boundedDelta: eligibleFloorDemand ? "pass" : "unknown",
    slotOwnedRedistributionContext: redistributionContext.available
      ? "pass"
      : eligibleFloorDemand
        ? "unknown"
        : "unknown",
    noNetNewVolume: eligibleFloorDemand
      ? redistributionContext.available
        ? "unknown"
        : "fail"
      : "unknown",
    downstreamProjectionMeasured: "unknown",
    materializerNonRegressionMeasured: "unknown",
  };
  const trialStatus: BoundedTrialRow["trialStatus"] =
    row.readiness === "monitor_only"
      ? "monitor_only"
      : eligibleFloorDemand
        ? "trial_candidate"
        : "blocked";
  const trialKind: BoundedTrialRow["trialKind"] =
    eligibleFloorDemand
      ? "single_set_floor_buffer"
      : row.action === "redistribute_or_cap"
        ? "requires_slot_owned_redistribution_context"
        : "no_behavior_trial";

  return {
    zone: row.zone,
    scope: row.scope,
    ...(row.muscle ? { muscle: row.muscle } : {}),
    owner: row.owner,
    action: row.action,
    trialStatus,
    trialKind,
    ...(baselineRange ? { baselineRange: { ...baselineRange } } : {}),
    ...(proposedRange ? { proposedRange } : {}),
    ...(proposedDelta ? { proposedDelta } : {}),
    gates,
    redistributionContext,
    readiness: boundedTrialReadiness(gates),
    blockingReasons: boundedTrialBlockers(gates),
    limitations: [
      "row_level_trial_is_read_only_and_non_binding",
      "does_not_mutate_mesocycle_demand_or_downstream_policy",
      ...(eligibleFloorDemand
        ? [
            "single_set_floor_buffer_requires_slot_owned_redistribution_before_behavior",
            "downstream_weekly_curve_slot_allocation_materializer_non_regression_not_measured",
            ...(redistributionContext.available
              ? [
                  "slot_owned_redistribution_context_available_but_not_projected_downstream",
                ]
              : []),
          ]
        : ["no_safe_bounded_behavior_trial_for_row"]),
    ],
  };
}

function accumulationWeeks(
  weeklyDemandCurve: V2WeeklyDemandCurve | undefined,
): V2WeeklyDemandCurve["weeks"] {
  return (weeklyDemandCurve?.weeks ?? []).filter(
    (week) => week.phase !== "deload",
  );
}

function allocationAccumulationWeeks(
  allocation: V2SlotDemandAllocationByWeek | undefined,
): V2SlotDemandAllocationByWeek["weeks"] {
  return (allocation?.weeks ?? []).filter((week) => week.phase !== "deload");
}

function setDistributionAccumulationWeeks(
  setDistribution: V2SetDistributionIntent | undefined,
): V2SetDistributionIntent["weeks"] {
  return (setDistribution?.weeks ?? []).filter((week) => week.phase !== "deload");
}

function laneTargetsMuscle(input: {
  lane: V2SetDistributionIntent["weeks"][number]["slots"][number]["lanes"][number];
  muscle: string | undefined;
}): boolean {
  if (!input.muscle || input.lane.setBudget.max <= 0) {
    return false;
  }
  return (
    input.lane.primaryMuscles.includes(input.muscle) ||
    input.lane.supportMuscles.includes(input.muscle) ||
    input.lane.optionalMuscles.includes(input.muscle) ||
    input.lane.managedCollateralMuscles.includes(input.muscle) ||
    input.lane.directFloor?.muscle === input.muscle
  );
}

function buildDownstreamBehaviorProjectionRow(input: {
  row: BoundedTrialRow;
  weeklyDemandCurve?: V2WeeklyDemandCurve;
  slotDemandAllocationByWeek?: V2SlotDemandAllocationByWeek;
  v2SetDistributionIntent?: V2SetDistributionIntent;
}): DownstreamBehaviorProjectionRow {
  const weeklyWeeks = accumulationWeeks(input.weeklyDemandCurve);
  const matchingWeekCount = input.row.muscle
    ? weeklyWeeks.filter((week) =>
        week.muscles.some((muscle) => muscle.muscle === input.row.muscle),
      ).length
    : 0;
  const weeklyCurveAvailable =
    Boolean(input.row.muscle) &&
    weeklyWeeks.length > 0 &&
    matchingWeekCount === weeklyWeeks.length;
  const allocationWeeks = allocationAccumulationWeeks(
    input.slotDemandAllocationByWeek,
  );
  const candidateSlotOwners = input.row.redistributionContext.candidateSlotOwners;
  const ownersWithAllocation = new Set<string>();
  let allocationRowCount = 0;

  for (const week of allocationWeeks) {
    for (const slot of week.slots) {
      if (!candidateSlotOwners.includes(slot.slotId)) {
        continue;
      }
      const matchingRows = slot.lanes.flatMap((lane) =>
        lane.allocatedMuscles.filter(
          (muscle) =>
            muscle.muscle === input.row.muscle &&
            muscle.targetSetRange.max > 0,
        ),
      );
      if (matchingRows.length > 0) {
        ownersWithAllocation.add(slot.slotId);
        allocationRowCount += matchingRows.length;
      }
    }
  }

  const slotAllocationAvailable =
    candidateSlotOwners.length > 0 &&
    ownersWithAllocation.size === candidateSlotOwners.length &&
    allocationRowCount > 0;
  const setDistributionWeeks = setDistributionAccumulationWeeks(
    input.v2SetDistributionIntent,
  );
  const ownersWithSetDistribution = new Set<string>();
  let setDistributionLaneCount = 0;

  for (const week of setDistributionWeeks) {
    for (const slot of week.slots) {
      if (!candidateSlotOwners.includes(slot.slotId)) {
        continue;
      }
      const matchingLanes = slot.lanes.filter((lane) =>
        laneTargetsMuscle({ lane, muscle: input.row.muscle }),
      );
      if (matchingLanes.length > 0) {
        ownersWithSetDistribution.add(slot.slotId);
        setDistributionLaneCount += matchingLanes.length;
      }
    }
  }

  const setDistributionAvailable =
    candidateSlotOwners.length > 0 &&
    ownersWithSetDistribution.size === candidateSlotOwners.length &&
    setDistributionLaneCount > 0;
  const gates: DownstreamBehaviorProjectionRow["gates"] = {
    redistributionContextAvailable:
      input.row.gates.slotOwnedRedistributionContext,
    weeklyCurveAvailable: weeklyCurveAvailable ? "pass" : "unknown",
    slotAllocationAvailable: slotAllocationAvailable ? "pass" : "unknown",
    setDistributionContextAvailable: setDistributionAvailable
      ? "pass"
      : "unknown",
    netNewVolumePreservationMeasured: "unknown",
    materializerNonRegressionMeasured: "unknown",
  };
  const blockingReasons = [
    ...(gates.redistributionContextAvailable === "pass"
      ? []
      : ["slot_owned_redistribution_context_required"]),
    ...(gates.weeklyCurveAvailable === "pass"
      ? []
      : ["weekly_curve_context_not_available_for_candidate"]),
    ...(gates.slotAllocationAvailable === "pass"
      ? []
      : ["slot_allocation_context_not_available_for_candidate"]),
    ...(gates.setDistributionContextAvailable === "pass"
      ? []
      : ["set_distribution_context_not_available_for_candidate"]),
    "net_new_volume_preservation_not_measured",
    "materializer_non_regression_not_measured",
  ];
  const readiness: DownstreamBehaviorProjectionRow["readiness"] =
    gates.weeklyCurveAvailable !== "pass" ||
    gates.slotAllocationAvailable !== "pass"
      ? "needs_weekly_or_slot_context"
      : gates.setDistributionContextAvailable !== "pass"
        ? "needs_set_distribution_projection"
        : "needs_measured_redistribution_projection";

  return {
    zone: input.row.zone,
    scope: input.row.scope,
    ...(input.row.muscle ? { muscle: input.row.muscle } : {}),
    owner: input.row.owner,
    action: input.row.action,
    trialStatus: "trial_candidate",
    candidateSlotOwners: [...candidateSlotOwners],
    gates,
    weeklyCurve: {
      available: weeklyCurveAvailable,
      accumulationWeekCount: weeklyWeeks.length,
      matchingWeekCount,
    },
    slotAllocation: {
      available: slotAllocationAvailable,
      candidateSlotOwnerCount: candidateSlotOwners.length,
      ownersWithAllocationCount: ownersWithAllocation.size,
      allocationRowCount,
    },
    setDistribution: {
      available: setDistributionAvailable,
      candidateSlotOwnerCount: candidateSlotOwners.length,
      ownersWithSetDistributionCount: ownersWithSetDistribution.size,
      laneCount: setDistributionLaneCount,
    },
    readiness,
    blockingReasons,
    limitations: [
      "downstream_behavior_projection_is_read_only_context_inventory",
      "does_not_mutate_weekly_curve_slot_allocation_or_set_distribution",
      "does_not_choose_donor_offsets_or_materializer_candidates",
      "set_distribution_context_does_not_measure_redistribution_or_behavior_safety",
      "materializer_non_regression_remains_unmeasured",
    ],
  };
}

function buildDownstreamBehaviorProjection(input: {
  rows: BoundedTrialRow[];
  weeklyDemandCurve?: V2WeeklyDemandCurve;
  slotDemandAllocationByWeek?: V2SlotDemandAllocationByWeek;
  v2SetDistributionIntent?: V2SetDistributionIntent;
}): DownstreamBehaviorProjection {
  const candidateRows = input.rows.filter(
    (row) => row.trialStatus === "trial_candidate",
  );
  const rows = candidateRows.map((row) =>
    buildDownstreamBehaviorProjectionRow({
      row,
      weeklyDemandCurve: input.weeklyDemandCurve,
      slotDemandAllocationByWeek: input.slotDemandAllocationByWeek,
      v2SetDistributionIntent: input.v2SetDistributionIntent,
    }),
  );
  const weeklyCurveAvailableCount = rows.filter(
    (row) => row.gates.weeklyCurveAvailable === "pass",
  ).length;
  const slotAllocationAvailableCount = rows.filter(
    (row) => row.gates.slotAllocationAvailable === "pass",
  ).length;
  const setDistributionContextAvailableCount = rows.filter(
    (row) => row.gates.setDistributionContextAvailable === "pass",
  ).length;
  const netNewVolumeUnknownCount = rows.filter(
    (row) => row.gates.netNewVolumePreservationMeasured === "unknown",
  ).length;
  const materializerUnknownCount = rows.filter(
    (row) => row.gates.materializerNonRegressionMeasured === "unknown",
  ).length;
  const readyForBehaviorCount = rows.filter(
    (row) => row.readiness === "ready_for_behavior",
  ).length;
  const candidateCount = rows.length;

  return {
    version: 1,
    source: "v2_strategy_to_demand_downstream_context_inventory",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    projectionMode: "read_only_weekly_slot_context_inventory",
    status:
      candidateCount === 0
        ? "not_available"
        : weeklyCurveAvailableCount === 0 && slotAllocationAvailableCount === 0
          ? "blocked"
          : "available_with_limitations",
    rows,
    summary: {
      candidateCount,
      weeklyCurveAvailableCount,
      slotAllocationAvailableCount,
      setDistributionContextAvailableCount,
      netNewVolumeUnknownCount,
      materializerUnknownCount,
      readyForBehaviorCount,
    },
    nextSafeAction:
      candidateCount === 0
        ? input.rows.length === 0
          ? "collect_more_evidence"
          : "keep_diagnostic_only"
        : weeklyCurveAvailableCount === candidateCount &&
            slotAllocationAvailableCount === candidateCount &&
            setDistributionContextAvailableCount === candidateCount
          ? "add_measured_redistribution_projection"
          : weeklyCurveAvailableCount === candidateCount &&
              slotAllocationAvailableCount === candidateCount
            ? "add_set_distribution_projection"
          : "add_downstream_behavior_projection",
    limitations: [
      "downstream_projection_inventory_is_diagnostic_only",
      "weekly_curve_and_slot_allocation_availability_do_not_make_behavior_safe",
      "set_distribution_availability_does_not_choose_or_apply_offsets",
      "net_new_volume_preservation_not_measured",
      "materializer_non_regression_not_measured",
    ],
  };
}

function buildBoundedBehaviorTrial(input: {
  rows: ProjectionRow[];
  slotOwnedPlan?: V2SlotOwnedDemandAdjustmentPlan;
  weeklyDemandCurve?: V2WeeklyDemandCurve;
  slotDemandAllocationByWeek?: V2SlotDemandAllocationByWeek;
  v2SetDistributionIntent?: V2SetDistributionIntent;
}): BoundedTrial {
  const redistributionContext = buildRedistributionContext(input.slotOwnedPlan);
  const trialRows = input.rows.map((row) =>
    buildBoundedTrialRow({
      row,
      slotOwnedPlan: input.slotOwnedPlan,
      context: redistributionContext,
    }),
  );
  const candidateCount = trialRows.filter(
    (row) => row.trialStatus === "trial_candidate",
  ).length;
  const readyForBehaviorCount = trialRows.filter(
    (row) => row.readiness === "ready_for_bounded_behavior_trial",
  ).length;
  const blockedCount = trialRows.filter(
    (row) => row.trialStatus === "blocked",
  ).length;
  const monitorOnlyCount = trialRows.filter(
    (row) => row.trialStatus === "monitor_only",
  ).length;
  const netNewVolumeFailCount = trialRows.filter(
    (row) => row.gates.noNetNewVolume === "fail",
  ).length;
  const redistributionContextReadyCount = trialRows.filter(
    (row) =>
      row.trialStatus === "trial_candidate" &&
      row.gates.slotOwnedRedistributionContext === "pass",
  ).length;
  const redistributionContextMissingCount = trialRows.filter(
    (row) =>
      row.trialStatus === "trial_candidate" &&
      row.gates.slotOwnedRedistributionContext !== "pass",
  ).length;
  const downstreamUnknownCount = trialRows.filter(
    (row) => row.gates.downstreamProjectionMeasured === "unknown",
  ).length;
  const materializerUnknownCount = trialRows.filter(
    (row) => row.gates.materializerNonRegressionMeasured === "unknown",
  ).length;
  const downstreamBehaviorProjection = buildDownstreamBehaviorProjection({
    rows: trialRows,
    weeklyDemandCurve: input.weeklyDemandCurve,
    slotDemandAllocationByWeek: input.slotDemandAllocationByWeek,
    v2SetDistributionIntent: input.v2SetDistributionIntent,
  });

  return {
    version: 1,
    source: "v2_strategy_to_demand_bounded_behavior_trial",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    trialMode: "row_level_static_demand_delta",
    status:
      input.rows.length === 0
        ? "not_available"
        : candidateCount > 0
          ? "available_with_limitations"
          : "blocked",
    redistributionContext,
    downstreamBehaviorProjection,
    rows: trialRows,
    summary: {
      rowCount: trialRows.length,
      candidateCount,
      blockedCount,
      monitorOnlyCount,
      readyForBehaviorCount,
      netNewVolumeFailCount,
      redistributionContextReadyCount,
      redistributionContextMissingCount,
      downstreamUnknownCount,
      materializerUnknownCount,
    },
    nextSafeAction:
      candidateCount === 0
        ? input.rows.length === 0
          ? "collect_more_evidence"
          : "keep_diagnostic_only"
        : redistributionContextReadyCount < candidateCount
          ? "add_slot_owned_redistribution_context"
          : downstreamBehaviorProjection.nextSafeAction,
    limitations: [
      "bounded_behavior_trial_is_diagnostic_only",
      "row_level_deltas_do_not_feed_mesocycle_demand",
      "no_weekly_curve_slot_allocation_set_distribution_or_materializer_rerun",
      "no_seed_runtime_receipt_or_acceptance_threshold_impact",
    ],
  };
}

function resolveProjectionNextSafeAction(input: {
  hasRows: boolean;
  measuredAllRows: boolean;
  maxAbsoluteRangeDelta: number;
  boundedBehaviorNextSafeAction: BoundedTrial["nextSafeAction"];
  diffNextSafeAction: V2StrategyToDemandDiff["nextSafeAction"];
}): V2StrategyToDemandProjection["nextSafeAction"] {
  if (!input.hasRows) {
    return input.diffNextSafeAction === "add_read_only_demand_projection"
      ? "collect_more_evidence"
      : "keep_diagnostic_only";
  }
  if (!input.measuredAllRows || input.maxAbsoluteRangeDelta !== 0) {
    return "add_measured_non_regression_projection";
  }
  if (
    input.boundedBehaviorNextSafeAction ===
      "add_slot_owned_redistribution_context" ||
    input.boundedBehaviorNextSafeAction ===
      "add_downstream_behavior_projection" ||
    input.boundedBehaviorNextSafeAction ===
      "add_set_distribution_projection" ||
    input.boundedBehaviorNextSafeAction ===
      "add_measured_redistribution_projection"
  ) {
    return input.boundedBehaviorNextSafeAction;
  }
  return "add_bounded_behavior_projection_trial";
}

export function buildV2StrategyToDemandProjection(
  input: V2StrategyToDemandProjectionInput,
): V2StrategyToDemandProjection {
  const demandIndex = demandByMuscle(input.mesocycleDemand);
  const rows = input.strategyToDemandDiff.rows.map((row) =>
    buildProjectionRow({
      row,
      demand: row.muscle ? demandIndex.get(row.muscle) : undefined,
    }),
  );
  const hasRows = rows.length > 0;
  const measuredRows = rows.filter(
    (row) => row.measuredCurrentNonRegression.measured,
  );
  const measuredPassRows = rows.filter(
    (row) => row.measuredCurrentNonRegression.gateStatus === "pass",
  );
  const maxAbsoluteRangeDelta = measuredRows.reduce((max, row) => {
    const delta = row.measuredCurrentNonRegression.rangeDelta;
    if (!delta) {
      return max;
    }
    return Math.max(
      max,
      Math.abs(delta.min),
      Math.abs(delta.preferred),
      Math.abs(delta.max),
    );
  }, 0);
  const totalNetNewVolumeDelta = measuredRows.reduce(
    (sum, row) => sum + (row.measuredCurrentNonRegression.netNewVolumeDelta ?? 0),
    0,
  );
  const boundedBehaviorTrial = buildBoundedBehaviorTrial({
    rows,
    slotOwnedPlan: input.slotOwnedDemandAdjustmentPlan,
    weeklyDemandCurve: input.weeklyDemandCurve,
    slotDemandAllocationByWeek: input.slotDemandAllocationByWeek,
    v2SetDistributionIntent: input.v2SetDistributionIntent,
  });

  return {
    version: 1,
    source: "v2_strategy_to_demand_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    projectionMode: "read_only_non_mutating_join",
    status: hasRows ? input.strategyToDemandDiff.status : "not_available",
    basis: {
      strategyToDemandDiff: true,
      mesocycleDemand: true,
      mesocycleDemandMutation: false,
      weeklyCurveMutation: false,
      slotAllocationMutation: false,
      setDistributionMutation: false,
    },
    rows,
    summary: {
      rowCount: rows.length,
      floorProtectionCount: countRows(rows, (row) => row.zone === "floor"),
      productiveMonitorCount: countRows(
        rows,
        (row) => row.zone === "productive",
      ),
      stretchMonitorCount: countRows(rows, (row) => row.zone === "stretch"),
      capRedistributionCount: countRows(rows, (row) => row.zone === "cap"),
      baseDemandMatchedCount: countRows(
        rows,
        (row) => row.baseDemand.available,
      ),
      currentNoMutationProjectionCount: countRows(
        rows,
        (row) => row.currentProjection.rangeMutation === "none",
      ),
      measuredCurrentProjectionCount: measuredRows.length,
      measuredCurrentProjectionPassCount: measuredPassRows.length,
      blockedCount: countRows(rows, (row) => row.readiness === "blocked"),
      monitorOnlyCount: countRows(
        rows,
        (row) => row.readiness === "monitor_only",
      ),
      behaviorProjectionUnknownCount: countRows(
        rows,
        (row) =>
          row.behaviorPromotion.nonRegressionGates
            .measuredBehaviorProjection === "unknown",
      ),
    },
    measuredCurrentNonRegressionSummary: {
      measurementMode: "current_no_mutation_projection",
      measuredRowCount: measuredRows.length,
      passCount: measuredPassRows.length,
      unknownCount: rows.length - measuredRows.length,
      behaviorProjectionMeasured: false,
      maxAbsoluteRangeDelta,
      totalNetNewVolumeDelta,
    },
    boundedBehaviorTrial,
    nonMutationGates: {
      noMesocycleDemandMutation: "pass",
      noWeeklyCurveMutation: "pass",
      noSlotAllocationMutation: "pass",
      noSetDistributionMutation: "pass",
      noMaterializerRankingMutation: "pass",
      noSeedOrRuntimeImpact: "pass",
      noAcceptanceThresholdImpact: "pass",
    },
    nextSafeAction: resolveProjectionNextSafeAction({
      hasRows,
      measuredAllRows: measuredRows.length === rows.length,
      maxAbsoluteRangeDelta,
      boundedBehaviorNextSafeAction: boundedBehaviorTrial.nextSafeAction,
      diffNextSafeAction: input.strategyToDemandDiff.nextSafeAction,
    }),
    limitations: [
      "projection_is_a_read_only_join_between_strategy_diff_and_static_mesocycle_demand",
      "projected_ranges_equal_current_static_demand_until_a_separate_behavior_slice",
      "current_no_mutation_projection_is_measured_only_against_static_mesocycle_demand",
      "future_behavior_candidate_projection_gates_remain_unknown",
      "does_not_feed_weekly_curve_slot_allocation_set_distribution_materializer_seed_runtime_or_acceptance_thresholds",
    ],
  };
}
