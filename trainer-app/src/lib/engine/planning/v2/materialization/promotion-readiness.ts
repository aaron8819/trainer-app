import type {
  V2MaterializationDryRunReportReason,
  V2MaterializationProductionWriteGates,
  V2MaterializationPromotionBlocker,
  V2MaterializationPromotionReadiness,
  V2MaterializationPromotionReadinessInput,
} from "./types";

const DEFAULT_PRODUCTION_WRITE_GATES: V2MaterializationProductionWriteGates = {
  acceptancePathDesigned: false,
  slotPlanSeedJsonWriteGateDesigned: false,
  receiptContractDesigned: false,
  runtimeReplayContractVerified: false,
  auditSerializationContractDesigned: false,
  rollbackStrategyDefined: false,
};

const SEED_SHAPE_REASONS = new Set([
  "missing_exercise_name",
  "duplicate_exercise_id_within_slot",
  "invalid_seed_role",
  "invalid_seed_set_count",
]);

export function buildV2MaterializationPromotionReadiness(
  input: V2MaterializationPromotionReadinessInput,
): V2MaterializationPromotionReadiness {
  const productionWriteGates = {
    ...DEFAULT_PRODUCTION_WRITE_GATES,
    ...(input.productionWriteGates ?? {}),
  };
  const expectedSlotCount =
    input.expectedSlotCount ?? input.requiredLaneCoverageBySlot?.length;
  const seedSerializerRequiresExerciseNames =
    input.seedSerializerRequiresExerciseNames ?? true;
  const coverageBlockers = requiredLaneCoverageBlockers(input);
  const requiredMaterializationBlockers = [
    ...input.dryRunReport.blockers
      .filter((blocker) => !SEED_SHAPE_REASONS.has(blocker.reason))
      .map((blocker) =>
        blockerFor("required_materialization", reasonWithLocation(blocker)),
      ),
    ...coverageBlockers,
  ];
  const seedShapeBlockers = seedShapeBlockersFor({
    input,
    expectedSlotCount,
    seedSerializerRequiresExerciseNames,
  });
  const productionGateBlockers =
    productionWriteGateBlockers(productionWriteGates);
  const requiredLaneCoveragePassed = requiredLaneCoveragePassedFor(input);
  const requiredMaterializationPassed =
    input.dryRunReport.materializer.status === "materialized" &&
    requiredLaneCoveragePassed &&
    requiredMaterializationBlockers.length === 0;
  const seedShape = {
    compatible: seedShapeBlockers.length === 0,
    slotCountMatches:
      expectedSlotCount !== undefined &&
      input.dryRunReport.seedShapeCompatibility.slotCount === expectedSlotCount,
    noDuplicateExerciseIdsWithinSlot:
      input.dryRunReport.seedShapeCompatibility
        .duplicateExerciseIdWithinSlotCount === 0,
    rolesValid: input.dryRunReport.seedShapeCompatibility.invalidRoleCount === 0,
    setCountsValid:
      input.dryRunReport.seedShapeCompatibility.invalidSetCount === 0,
    namesAvailable:
      !seedSerializerRequiresExerciseNames ||
      input.dryRunReport.seedShapeCompatibility.missingNameCount === 0,
  };
  const blockers = [
    ...requiredMaterializationBlockers,
    ...seedShapeBlockers,
    ...productionGateBlockers,
  ];
  const safeToPromoteToProductionWrite =
    requiredMaterializationPassed &&
    seedShape.compatible &&
    productionGateBlockers.length === 0;

  return {
    version: 1,
    source: "v2_materialization_promotion_readiness",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status: safeToPromoteToProductionWrite
      ? "eligible_for_guarded_write"
      : requiredMaterializationBlockers.length > 0 || seedShapeBlockers.length > 0
        ? "blocked"
        : "not_ready",
    safeToPromoteToProductionWrite,
    requiredMaterialization: {
      status: requiredMaterializationPassed ? "passed" : "blocked",
      requiredLaneCoveragePassed,
      materializerStatus: input.dryRunReport.status,
      requiredBlockerCount: requiredMaterializationBlockers.length,
    },
    optionalOmissions: {
      count: input.dryRunReport.omissions.length,
      affectsPromotion: false,
      reasons: uniqueSorted(input.dryRunReport.omissions.map((row) => row.reason)),
    },
    seedShape,
    productionWriteGates,
    blockers,
    nonBlockingOmissions: input.dryRunReport.omissions.map((omission) => ({
      ...(omission.slotId ? { slotId: omission.slotId } : {}),
      ...(omission.laneId ? { laneId: omission.laneId } : {}),
      reason: omission.reason,
    })),
  };
}

function requiredLaneCoveragePassedFor(
  input: V2MaterializationPromotionReadinessInput,
): boolean {
  const coverage = input.requiredLaneCoverageBySlot;
  if (!coverage?.length) {
    return false;
  }
  return coverage.every(
    (slot) =>
      slot.requiredLaneCount === slot.materializedRequiredLaneCount &&
      slot.blockedRequiredLaneCount === 0 &&
      slot.missingRequiredLaneIds.length === 0,
  );
}

function requiredLaneCoverageBlockers(
  input: V2MaterializationPromotionReadinessInput,
): V2MaterializationPromotionBlocker[] {
  const coverage = input.requiredLaneCoverageBySlot;
  if (!coverage?.length) {
    return [
      blockerFor(
        "required_materialization",
        "required_lane_coverage_evidence_missing",
      ),
    ];
  }

  return coverage.flatMap((slot) => {
    if (
      slot.requiredLaneCount === slot.materializedRequiredLaneCount &&
      slot.blockedRequiredLaneCount === 0 &&
      slot.missingRequiredLaneIds.length === 0
    ) {
      return [];
    }
    return [
      blockerFor(
        "required_materialization",
        `${slot.slotId}:required_lane_coverage_incomplete`,
      ),
      ...slot.missingRequiredLaneIds.map((laneId) =>
        blockerFor(
          "required_materialization",
          `${slot.slotId}:${laneId}:required_lane_not_materialized`,
        ),
      ),
    ];
  });
}

function seedShapeBlockersFor(input: {
  input: V2MaterializationPromotionReadinessInput;
  expectedSlotCount: number | undefined;
  seedSerializerRequiresExerciseNames: boolean;
}): V2MaterializationPromotionBlocker[] {
  const compatibility = input.input.dryRunReport.seedShapeCompatibility;
  return [
    ...(input.expectedSlotCount !== undefined &&
    compatibility.slotCount === input.expectedSlotCount
      ? []
      : [blockerFor("seed_shape", "slot_count_mismatch")]),
    ...(compatibility.duplicateExerciseIdWithinSlotCount === 0
      ? []
      : [blockerFor("seed_shape", "duplicate_exercise_id_within_slot")]),
    ...(compatibility.invalidRoleCount === 0
      ? []
      : [blockerFor("seed_shape", "invalid_seed_role")]),
    ...(compatibility.invalidSetCount === 0
      ? []
      : [blockerFor("seed_shape", "invalid_seed_set_count")]),
    ...(!input.seedSerializerRequiresExerciseNames ||
    compatibility.missingNameCount === 0
      ? []
      : [blockerFor("seed_shape", "missing_exercise_name")]),
  ];
}

function productionWriteGateBlockers(
  gates: V2MaterializationProductionWriteGates,
): V2MaterializationPromotionBlocker[] {
  return [
    ...(gates.acceptancePathDesigned
      ? []
      : [
          blockerFor(
            "production_write_gate",
            "production_acceptance_path_not_designed",
          ),
        ]),
    ...(gates.slotPlanSeedJsonWriteGateDesigned
      ? []
      : [
          blockerFor(
            "production_write_gate",
            "slotPlanSeedJson_write_gate_not_designed",
          ),
        ]),
    ...(gates.receiptContractDesigned
      ? []
      : [blockerFor("receipt_contract", "receipt_contract_not_designed")]),
    ...(gates.runtimeReplayContractVerified
      ? []
      : [blockerFor("runtime_replay", "runtime_replay_contract_not_verified")]),
    ...(gates.auditSerializationContractDesigned
      ? []
      : [
          blockerFor(
            "audit_contract",
            "audit_serialization_contract_not_designed",
          ),
        ]),
    ...(gates.rollbackStrategyDefined
      ? []
      : [blockerFor("rollback", "rollback_strategy_not_defined")]),
  ];
}

function blockerFor(
  category: V2MaterializationPromotionBlocker["category"],
  reason: string,
): V2MaterializationPromotionBlocker {
  return { category, reason };
}

function reasonWithLocation(
  blocker: V2MaterializationDryRunReportReason,
): string {
  return [blocker.slotId, blocker.laneId, blocker.reason]
    .filter(Boolean)
    .join(":");
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}
