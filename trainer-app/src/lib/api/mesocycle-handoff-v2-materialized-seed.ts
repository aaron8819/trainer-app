import {
  buildV2MaterializationDryRunReport,
  buildV2MaterializationPromotionReadiness,
  type V2ExerciseMaterializationInput,
  type V2ExerciseMaterializationPlan,
  type V2ExerciseSelectionPlan,
  type V2AcceptedPlannerIntentDto,
  type V2ExerciseClassTaxonomy,
  type V2MaterializationDryRunReport,
  type V2MaterializationExercise,
  type V2MaterializationProductionWriteGates,
  type V2MaterializationPromotionBlocker,
  type V2MaterializationPromotionReadiness,
  type V2MaterializationRequiredLaneCoverage,
  type V2PlannerMesocyclePolicy,
} from "@/lib/engine/planning/v2";
import {
  buildMesocycleSlotPlanSeed,
  type MesocycleSlotPlanSeed,
  type ProjectedSuccessorSlotPlan,
} from "./mesocycle-handoff-slot-plan-projection.seed-serialization";
import type { MesocycleSlotSequence } from "./mesocycle-slot-contract";

export type BuildV2MaterializedSeedForAcceptanceBlocker = {
  category: string;
  reason: string;
};

export type V2MaterializedSeedAcceptanceProvenance = {
  source:
    | "v2_disabled"
    | "v2_blocked_fail_closed"
    | "v2_materialized_seed";
  readOnly: boolean;
  dryRunOnly: boolean;
  seedSerializer: "buildMesocycleSlotPlanSeed";
  dryRunReportVersion?: number;
  promotionReadinessVersion?: number;
  productionGates?: {
    acceptancePath: boolean;
    seedWriteGate: boolean;
    receiptContract: boolean;
    runtimeReplayContract: boolean;
    auditObservabilityContract: boolean;
    rollbackStrategy: boolean;
  };
  blockerCategories?: string[];
  dbWriteOccurred: false;
  runtimeReplayContractExpectedUnchanged: true;
  executableSeedTruth: {
    source: "slotPlanSeedJson";
    runtimeConsumedFields: ["exerciseId", "role", "setCount"];
    runtimeIgnoresPlannerMetadata: true;
  };
};

export type BuildV2MaterializedSeedForAcceptanceResult =
  | {
      status: "disabled";
      provenance: V2MaterializedSeedAcceptanceProvenance;
    }
  | {
      status: "blocked";
      reason: string;
      blockers: BuildV2MaterializedSeedForAcceptanceBlocker[];
      provenance: V2MaterializedSeedAcceptanceProvenance;
    }
  | {
      status: "ready";
      slotPlanSeedJson: MesocycleSlotPlanSeed;
      provenance: V2MaterializedSeedAcceptanceProvenance;
    };

type V2MaterializedSeedAcceptanceDependencies = {
  buildDryRunReport?: typeof buildV2MaterializationDryRunReport;
  buildPromotionReadiness?: typeof buildV2MaterializationPromotionReadiness;
  buildSlotPlanSeed?: typeof buildMesocycleSlotPlanSeed;
};

export type BuildV2MaterializedSeedForAcceptanceInput = {
  enableV2MaterializedSeedWrite?: boolean;
  slotSequence: MesocycleSlotSequence;
  plannerPolicy?: V2PlannerMesocyclePolicy | null;
  exerciseSelectionPlan?: V2ExerciseSelectionPlan | null;
  taxonomy?: V2ExerciseClassTaxonomy | null;
  inventory?: V2MaterializationExercise[] | null;
  materializedPlan?: V2ExerciseMaterializationPlan | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
  exerciseNameById?: Record<string, string | undefined>;
  slotIntentById?: Record<string, string | undefined>;
  requiredLaneCoverageBySlot?: V2MaterializationRequiredLaneCoverage[];
  productionWriteGates?: Partial<V2MaterializationProductionWriteGates>;
  seedSerializerRequiresExerciseNames?: boolean;
  acceptedPlannerIntent?: V2AcceptedPlannerIntentDto;
  dependencies?: V2MaterializedSeedAcceptanceDependencies;
};

const ALL_PRODUCTION_WRITE_GATES_PROVIDED: V2MaterializationProductionWriteGates = {
  acceptancePathDesigned: true,
  slotPlanSeedJsonWriteGateDesigned: true,
  receiptContractDesigned: true,
  runtimeReplayContractVerified: true,
  auditSerializationContractDesigned: true,
  rollbackStrategyDefined: true,
};

const EXECUTABLE_SEED_TRUTH: V2MaterializedSeedAcceptanceProvenance["executableSeedTruth"] = {
  source: "slotPlanSeedJson",
  runtimeConsumedFields: ["exerciseId", "role", "setCount"],
  runtimeIgnoresPlannerMetadata: true,
};

type CallerOwnedEvidenceKey =
  | "planner_policy"
  | "inventory"
  | "taxonomy"
  | "lane_coverage"
  | "production_gates"
  | "receipt_contract_evidence"
  | "runtime_replay_evidence"
  | "audit_observability_evidence"
  | "rollback_strategy_evidence";

export type V2MaterializedSeedAcceptanceProbeBlockerGroup = {
  category: string;
  reasons: string[];
};

export type BuildV2MaterializedSeedAcceptanceProbeInput = Omit<
  BuildV2MaterializedSeedForAcceptanceInput,
  "enableV2MaterializedSeedWrite"
> & {
  ownerLoaded?: boolean;
  mesocycleLoaded?: boolean;
  liveNormalizedInventoryAvailable?: boolean;
};

export type BuildV2MaterializedSeedAcceptanceProbeResult = {
  version: 1;
  source: "v2_materialized_seed_acceptance_probe";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  context: {
    ownerLoaded: boolean;
    mesocycleLoaded: boolean;
    slotSequenceAvailable: boolean;
    slotSequenceSlotCount: number;
  };
  evidence: {
    plannerPolicyAvailable: boolean;
    exerciseSelectionPlanAvailable: boolean;
    liveNormalizedInventoryAvailable: boolean;
    taxonomyAvailable: boolean;
    requiredLaneCoverageEvidenceAvailable: boolean;
    callerOwnedEvidence: Array<{
      key: CallerOwnedEvidenceKey;
      provided: boolean;
      futureCallerMustProvide: true;
    }>;
  };
  requiredLaneCoverageBySlot: V2MaterializationRequiredLaneCoverage[];
  dryRunReport: {
    status: V2MaterializationDryRunReport["status"];
    materializerStatus: V2MaterializationDryRunReport["materializer"]["status"];
    seedShapeCompatibility: V2MaterializationDryRunReport["seedShapeCompatibility"];
  };
  promotionReadiness: {
    status: V2MaterializationPromotionReadiness["status"];
    safeToPromoteToProductionWrite: false;
    productionWriteGates: V2MaterializationProductionWriteGates;
  };
  helperResultWithOptInDisabled: Extract<
    BuildV2MaterializedSeedForAcceptanceResult,
    { status: "disabled" }
  >;
  provenance: V2MaterializedSeedAcceptanceProvenance;
  simulated_opt_in_readiness: {
    label: "simulated_opt_in_readiness";
    status: "blocked" | "ready";
    promotionReadinessStatus: V2MaterializationPromotionReadiness["status"];
    readinessWouldBeEligibleForGuardedWrite: boolean;
    safeToPromoteToProductionWrite: false;
    blockersByCategory: V2MaterializedSeedAcceptanceProbeBlockerGroup[];
  };
  blockersByCategory: V2MaterializedSeedAcceptanceProbeBlockerGroup[];
  optionalOmissions: V2MaterializationPromotionReadiness["nonBlockingOmissions"];
  seedPreviewCountsBySlot: Array<{
    slotId: string;
    exerciseCount: number;
  }>;
  safeToPromoteToProductionWrite: false;
};

export function buildV2MaterializedSeedForAcceptance(
  input: BuildV2MaterializedSeedForAcceptanceInput,
): BuildV2MaterializedSeedForAcceptanceResult {
  if (input.enableV2MaterializedSeedWrite !== true) {
    return {
      status: "disabled",
      provenance: buildAcceptanceProvenance({
        source: "v2_disabled",
        readOnly: true,
        dryRunOnly: true,
      }),
    };
  }

  const buildDryRunReport =
    input.dependencies?.buildDryRunReport ?? buildV2MaterializationDryRunReport;
  const buildPromotionReadiness =
    input.dependencies?.buildPromotionReadiness ??
    buildV2MaterializationPromotionReadiness;
  const buildSlotPlanSeed =
    input.dependencies?.buildSlotPlanSeed ?? buildMesocycleSlotPlanSeed;
  const slotIntentById =
    input.slotIntentById ??
    Object.fromEntries(
      input.slotSequence.slots.map((slot) => [slot.slotId, slot.intent]),
    );

  const dryRunReport = buildDryRunReport({
    ...(input.plannerPolicy !== undefined
      ? { plannerPolicy: input.plannerPolicy }
      : {}),
    ...(input.exerciseSelectionPlan !== undefined
      ? { exerciseSelectionPlan: input.exerciseSelectionPlan }
      : {}),
    ...(input.taxonomy !== undefined ? { taxonomy: input.taxonomy } : {}),
    ...(input.inventory !== undefined ? { inventory: input.inventory } : {}),
    ...(input.materializedPlan !== undefined
      ? { materializedPlan: input.materializedPlan }
      : {}),
    ...(input.constraints ? { constraints: input.constraints } : {}),
    ...(input.continuity ? { continuity: input.continuity } : {}),
    ...(input.exerciseNameById ? { exerciseNameById: input.exerciseNameById } : {}),
    slotIntentById,
  });
  const promotionReadiness = buildPromotionReadiness({
    dryRunReport,
    requiredLaneCoverageBySlot: input.requiredLaneCoverageBySlot,
    expectedSlotCount: input.slotSequence.slots.length,
    seedSerializerRequiresExerciseNames:
      input.seedSerializerRequiresExerciseNames ?? true,
    productionWriteGates: input.productionWriteGates,
  });

  if (
    promotionReadiness.status !== "eligible_for_guarded_write" ||
    promotionReadiness.safeToPromoteToProductionWrite !== true
  ) {
    return blockedFromReadiness({ dryRunReport, readiness: promotionReadiness });
  }

  const projectedSlotPlans = materializedReportToProjectedSlotPlans({
    dryRunReport,
    slotSequence: input.slotSequence,
  });
  if ("blocked" in projectedSlotPlans) {
    return projectedSlotPlans.blocked;
  }

  return {
    status: "ready",
    slotPlanSeedJson: buildSlotPlanSeed({
      slotSequence: input.slotSequence,
      slotPlans: projectedSlotPlans.slotPlans,
      ...(input.acceptedPlannerIntent
        ? { acceptedPlannerIntent: input.acceptedPlannerIntent }
        : {}),
    }),
    provenance: buildAcceptanceProvenance({
      source: "v2_materialized_seed",
      dryRunReportVersion: dryRunReport.version,
      promotionReadinessVersion: promotionReadiness.version,
      productionWriteGates: promotionReadiness.productionWriteGates,
      blockers: promotionReadiness.blockers,
      readOnly: false,
      dryRunOnly: false,
    }),
  };
}

export function buildV2MaterializedSeedAcceptanceProbe(
  input: BuildV2MaterializedSeedAcceptanceProbeInput,
): BuildV2MaterializedSeedAcceptanceProbeResult {
  const buildDryRunReport =
    input.dependencies?.buildDryRunReport ?? buildV2MaterializationDryRunReport;
  const buildPromotionReadiness =
    input.dependencies?.buildPromotionReadiness ??
    buildV2MaterializationPromotionReadiness;
  const slotIntentById =
    input.slotIntentById ??
    Object.fromEntries(
      input.slotSequence.slots.map((slot) => [slot.slotId, slot.intent]),
    );
  const dryRunReport = buildDryRunReport({
    ...(input.plannerPolicy !== undefined
      ? { plannerPolicy: input.plannerPolicy }
      : {}),
    ...(input.exerciseSelectionPlan !== undefined
      ? { exerciseSelectionPlan: input.exerciseSelectionPlan }
      : {}),
    ...(input.taxonomy !== undefined ? { taxonomy: input.taxonomy } : {}),
    ...(input.inventory !== undefined ? { inventory: input.inventory } : {}),
    ...(input.materializedPlan !== undefined
      ? { materializedPlan: input.materializedPlan }
      : {}),
    ...(input.constraints ? { constraints: input.constraints } : {}),
    ...(input.continuity ? { continuity: input.continuity } : {}),
    ...(input.exerciseNameById ? { exerciseNameById: input.exerciseNameById } : {}),
    slotIntentById,
  });
  const requiredLaneCoverageBySlot =
    input.requiredLaneCoverageBySlot ?? dryRunReport.requiredLaneCoverageBySlot;
  const promotionReadiness = buildPromotionReadiness({
    dryRunReport,
    requiredLaneCoverageBySlot,
    expectedSlotCount: input.slotSequence.slots.length,
    seedSerializerRequiresExerciseNames:
      input.seedSerializerRequiresExerciseNames ?? true,
    productionWriteGates: input.productionWriteGates,
  });
  const simulatedReadiness = buildPromotionReadiness({
    dryRunReport,
    requiredLaneCoverageBySlot,
    expectedSlotCount: input.slotSequence.slots.length,
    seedSerializerRequiresExerciseNames:
      input.seedSerializerRequiresExerciseNames ?? true,
    productionWriteGates: ALL_PRODUCTION_WRITE_GATES_PROVIDED,
  });
  const helperResultWithOptInDisabled = buildV2MaterializedSeedForAcceptance({
    ...input,
    requiredLaneCoverageBySlot,
    enableV2MaterializedSeedWrite: false,
  });
  if (helperResultWithOptInDisabled.status !== "disabled") {
    throw new Error("V2_MATERIALIZED_SEED_PROBE_DISABLED_HELPER_UNEXPECTED");
  }
  const contextBlockers = contextBlockersForProbe({
    ownerLoaded: input.ownerLoaded === true,
    mesocycleLoaded: input.mesocycleLoaded === true,
    slotSequenceAvailable: input.slotSequence.slots.length > 0,
  });
  const blockersByCategory = groupProbeBlockers([
    ...contextBlockers,
    ...promotionReadiness.blockers,
  ]);
  const simulatedBlockersByCategory = groupProbeBlockers([
    ...contextBlockers,
    ...simulatedReadiness.blockers,
  ]);

  return {
    version: 1,
    source: "v2_materialized_seed_acceptance_probe",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    context: {
      ownerLoaded: input.ownerLoaded === true,
      mesocycleLoaded: input.mesocycleLoaded === true,
      slotSequenceAvailable: input.slotSequence.slots.length > 0,
      slotSequenceSlotCount: input.slotSequence.slots.length,
    },
    evidence: {
      plannerPolicyAvailable: dryRunReport.plannerPolicyAvailable,
      exerciseSelectionPlanAvailable: dryRunReport.exerciseSelectionPlanAvailable,
      liveNormalizedInventoryAvailable:
        input.liveNormalizedInventoryAvailable ?? dryRunReport.inventoryAvailable,
      taxonomyAvailable: dryRunReport.taxonomyAvailable,
      requiredLaneCoverageEvidenceAvailable:
        requiredLaneCoverageBySlot.length > 0,
      callerOwnedEvidence: callerOwnedEvidenceForProbe({
        plannerPolicyAvailable: dryRunReport.plannerPolicyAvailable,
        inventoryAvailable:
          input.liveNormalizedInventoryAvailable ?? dryRunReport.inventoryAvailable,
        taxonomyAvailable: dryRunReport.taxonomyAvailable,
        requiredLaneCoverageEvidenceAvailable:
          requiredLaneCoverageBySlot.length > 0,
        productionWriteGates: promotionReadiness.productionWriteGates,
      }),
    },
    requiredLaneCoverageBySlot,
    dryRunReport: {
      status: dryRunReport.status,
      materializerStatus: dryRunReport.materializer.status,
      seedShapeCompatibility: dryRunReport.seedShapeCompatibility,
    },
    promotionReadiness: {
      status: promotionReadiness.status,
      safeToPromoteToProductionWrite: false,
      productionWriteGates: promotionReadiness.productionWriteGates,
    },
    helperResultWithOptInDisabled,
    provenance: buildAcceptanceProvenance({
      source: "v2_disabled",
      dryRunReportVersion: dryRunReport.version,
      promotionReadinessVersion: promotionReadiness.version,
      productionWriteGates: promotionReadiness.productionWriteGates,
      blockers: promotionReadiness.blockers,
      readOnly: true,
      dryRunOnly: true,
    }),
    simulated_opt_in_readiness: {
      label: "simulated_opt_in_readiness",
      status:
        simulatedReadiness.status === "eligible_for_guarded_write" &&
        simulatedReadiness.safeToPromoteToProductionWrite === true &&
        simulatedBlockersByCategory.length === 0
          ? "ready"
          : "blocked",
      promotionReadinessStatus: simulatedReadiness.status,
      readinessWouldBeEligibleForGuardedWrite:
        simulatedReadiness.status === "eligible_for_guarded_write" &&
        simulatedReadiness.safeToPromoteToProductionWrite === true,
      safeToPromoteToProductionWrite: false,
      blockersByCategory: simulatedBlockersByCategory,
    },
    blockersByCategory,
    optionalOmissions: promotionReadiness.nonBlockingOmissions,
    seedPreviewCountsBySlot: dryRunReport.executableSeedPreview.map((slot) => ({
      slotId: slot.slotId,
      exerciseCount: slot.exercises.length,
    })),
    safeToPromoteToProductionWrite: false,
  };
}

function callerOwnedEvidenceForProbe(input: {
  plannerPolicyAvailable: boolean;
  inventoryAvailable: boolean;
  taxonomyAvailable: boolean;
  requiredLaneCoverageEvidenceAvailable: boolean;
  productionWriteGates: V2MaterializationProductionWriteGates;
}): BuildV2MaterializedSeedAcceptanceProbeResult["evidence"]["callerOwnedEvidence"] {
  return [
    {
      key: "planner_policy",
      provided: input.plannerPolicyAvailable,
      futureCallerMustProvide: true,
    },
    {
      key: "inventory",
      provided: input.inventoryAvailable,
      futureCallerMustProvide: true,
    },
    {
      key: "taxonomy",
      provided: input.taxonomyAvailable,
      futureCallerMustProvide: true,
    },
    {
      key: "lane_coverage",
      provided: input.requiredLaneCoverageEvidenceAvailable,
      futureCallerMustProvide: true,
    },
    {
      key: "production_gates",
      provided: Object.values(input.productionWriteGates).every(Boolean),
      futureCallerMustProvide: true,
    },
    {
      key: "receipt_contract_evidence",
      provided: input.productionWriteGates.receiptContractDesigned,
      futureCallerMustProvide: true,
    },
    {
      key: "runtime_replay_evidence",
      provided: input.productionWriteGates.runtimeReplayContractVerified,
      futureCallerMustProvide: true,
    },
    {
      key: "audit_observability_evidence",
      provided: input.productionWriteGates.auditSerializationContractDesigned,
      futureCallerMustProvide: true,
    },
    {
      key: "rollback_strategy_evidence",
      provided: input.productionWriteGates.rollbackStrategyDefined,
      futureCallerMustProvide: true,
    },
  ];
}

function contextBlockersForProbe(input: {
  ownerLoaded: boolean;
  mesocycleLoaded: boolean;
  slotSequenceAvailable: boolean;
}): V2MaterializationPromotionBlocker[] {
  return [
    ...(input.ownerLoaded
      ? []
      : [{ category: "required_materialization" as const, reason: "owner_not_loaded" }]),
    ...(input.mesocycleLoaded
      ? []
      : [
          {
            category: "required_materialization" as const,
            reason: "mesocycle_not_loaded",
          },
        ]),
    ...(input.slotSequenceAvailable
      ? []
      : [
          {
            category: "required_materialization" as const,
            reason: "slot_sequence_unavailable",
          },
        ]),
  ];
}

function groupProbeBlockers(
  blockers: Array<Pick<V2MaterializationPromotionBlocker, "category" | "reason">>,
): V2MaterializedSeedAcceptanceProbeBlockerGroup[] {
  const reasonsByCategory = new Map<string, Set<string>>();
  for (const blocker of blockers) {
    const reasons = reasonsByCategory.get(blocker.category) ?? new Set<string>();
    reasons.add(blocker.reason);
    reasonsByCategory.set(blocker.category, reasons);
  }

  return Array.from(reasonsByCategory.entries())
    .map(([category, reasons]) => ({
      category,
      reasons: Array.from(reasons).sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

function blockedFromReadiness(input: {
  dryRunReport: V2MaterializationDryRunReport;
  readiness: V2MaterializationPromotionReadiness;
}): Extract<BuildV2MaterializedSeedForAcceptanceResult, { status: "blocked" }> {
  const { dryRunReport, readiness } = input;
  const blockers =
    readiness.blockers.length > 0
      ? readiness.blockers
      : [
          {
            category: "promotion_readiness",
            reason: readiness.status,
          },
        ];
  return {
    status: "blocked",
    reason: blockers[0]?.reason ?? "v2_materialized_seed_not_ready",
    blockers,
    provenance: buildAcceptanceProvenance({
      source: "v2_blocked_fail_closed",
      dryRunReportVersion: dryRunReport.version,
      promotionReadinessVersion: readiness.version,
      productionWriteGates: readiness.productionWriteGates,
      blockers,
      readOnly: true,
      dryRunOnly: true,
    }),
  };
}

function buildAcceptanceProvenance(input: {
  source: V2MaterializedSeedAcceptanceProvenance["source"];
  dryRunReportVersion?: number;
  promotionReadinessVersion?: number;
  productionWriteGates?: V2MaterializationProductionWriteGates;
  blockers?: Array<{ category: string }>;
  readOnly: boolean;
  dryRunOnly: boolean;
}): V2MaterializedSeedAcceptanceProvenance {
  const blockerCategories = input.blockers
    ? uniqueSorted(input.blockers.map((blocker) => blocker.category))
    : undefined;

  return {
    source: input.source,
    readOnly: input.readOnly,
    dryRunOnly: input.dryRunOnly,
    seedSerializer: "buildMesocycleSlotPlanSeed",
    ...(input.dryRunReportVersion !== undefined
      ? { dryRunReportVersion: input.dryRunReportVersion }
      : {}),
    ...(input.promotionReadinessVersion !== undefined
      ? { promotionReadinessVersion: input.promotionReadinessVersion }
      : {}),
    ...(input.productionWriteGates
      ? { productionGates: productionGatesForProvenance(input.productionWriteGates) }
      : {}),
    ...(blockerCategories && blockerCategories.length > 0
      ? { blockerCategories }
      : {}),
    dbWriteOccurred: false,
    runtimeReplayContractExpectedUnchanged: true,
    executableSeedTruth: EXECUTABLE_SEED_TRUTH,
  };
}

function productionGatesForProvenance(
  gates: V2MaterializationProductionWriteGates,
): NonNullable<V2MaterializedSeedAcceptanceProvenance["productionGates"]> {
  return {
    acceptancePath: gates.acceptancePathDesigned,
    seedWriteGate: gates.slotPlanSeedJsonWriteGateDesigned,
    receiptContract: gates.receiptContractDesigned,
    runtimeReplayContract: gates.runtimeReplayContractVerified,
    auditObservabilityContract: gates.auditSerializationContractDesigned,
    rollbackStrategy: gates.rollbackStrategyDefined,
  };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function materializedReportToProjectedSlotPlans(input: {
  dryRunReport: V2MaterializationDryRunReport;
  slotSequence: MesocycleSlotSequence;
}):
  | { slotPlans: ProjectedSuccessorSlotPlan[] }
  | {
      blocked: Extract<
        BuildV2MaterializedSeedForAcceptanceResult,
        { status: "blocked" }
      >;
    } {
  const previewBySlotId = new Map(
    input.dryRunReport.executableSeedPreview.map((slot) => [slot.slotId, slot]),
  );

  if (
    input.dryRunReport.executableSeedPreview.length !==
    input.slotSequence.slots.length
  ) {
    return seedShapeBlocked("slot_count_mismatch");
  }

  const slotPlans: ProjectedSuccessorSlotPlan[] = [];
  for (const sequenceSlot of input.slotSequence.slots) {
    const previewSlot = previewBySlotId.get(sequenceSlot.slotId);
    if (!previewSlot) {
      return seedShapeBlocked(`${sequenceSlot.slotId}:missing_preview_slot`);
    }
    slotPlans.push({
      slotId: sequenceSlot.slotId,
      intent: sequenceSlot.intent,
      exercises: previewSlot.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        name: exercise.name ?? exercise.exerciseId,
        role: exercise.role,
        setCount: exercise.setCount,
      })),
    });
  }

  return { slotPlans };
}

function seedShapeBlocked(reason: string): {
  blocked: Extract<
    BuildV2MaterializedSeedForAcceptanceResult,
    { status: "blocked" }
  >;
} {
  return {
    blocked: {
      status: "blocked",
      reason,
      blockers: [{ category: "seed_shape", reason }],
      provenance: buildAcceptanceProvenance({
        source: "v2_blocked_fail_closed",
        blockers: [{ category: "seed_shape" }],
        readOnly: true,
        dryRunOnly: true,
      }),
    },
  };
}
