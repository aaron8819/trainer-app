import {
  buildV2MaterializationDryRunReport,
  buildV2MaterializationPromotionReadiness,
  type V2ExerciseMaterializationInput,
  type V2ExerciseMaterializationPlan,
  type V2ExerciseSelectionPlan,
  type V2BasePlanValidation,
  type V2BasePlanValidationNextSafeAction,
  type V2BasePlanValidationStatus,
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

export type AcceptedSeedPersistenceSource =
  | "legacy_projection_seed"
  | "v2_disabled"
  | "v2_blocked_fail_closed"
  | "v2_materialized_seed";

export type AcceptedSeedPersistenceProvenance = {
  source: AcceptedSeedPersistenceSource;
  dbWriteOccurred: boolean;
  seedSerializer: "buildMesocycleSlotPlanSeed";
  seedSourceSelectedBeforeTransaction: boolean;
  persistedInsideExistingAcceptanceTransaction: boolean;
  persistedMesocycleId?: string;
  fallback?: {
    occurred: boolean;
    source?: "fallback_existing_projection";
    reason?: string;
  };
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

const ACCEPTED_SEED_EXECUTABLE_TRUTH: AcceptedSeedPersistenceProvenance["executableSeedTruth"] = {
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

export type V2MaterializedSeedAcceptanceProbeSlotSequenceSource =
  | "caller_supplied"
  | "handoff_acceptance_preparation"
  | "live_mesocycle_slot_sequence"
  | "missing";

export type V2MaterializedSeedAcceptanceProbeBasePlanValidationEvidence = {
  source: "v2_base_plan_validation";
  status: V2BasePlanValidationStatus;
  blockerCount: number;
  warningCount: number;
  nextSafeAction: V2BasePlanValidationNextSafeAction;
};

export type BuildV2MaterializedSeedAcceptanceProbeInput = Omit<
  BuildV2MaterializedSeedForAcceptanceInput,
  "enableV2MaterializedSeedWrite"
> & {
  ownerLoaded?: boolean;
  mesocycleLoaded?: boolean;
  liveNormalizedInventoryAvailable?: boolean;
  slotSequenceSource?: V2MaterializedSeedAcceptanceProbeSlotSequenceSource;
  handoffContext?: {
    sourceState?: string;
    summaryLoaded?: boolean;
    draftLoaded?: boolean;
    acceptanceProjectionBuilt?: boolean;
  };
  basePlanValidation?:
    | V2MaterializedSeedAcceptanceProbeBasePlanValidationEvidence
    | V2BasePlanValidation
    | null;
};

export type BuildV2MaterializedSeedAcceptanceProbeResult = {
  version: 1;
  source: "v2_materialized_seed_acceptance_probe";
  readOnly: true;
  affectsScoringOrGeneration: false;
  wouldWriteTransaction: false;
  wouldCallLegacyProjection: false;
  wouldCallLegacyRepair: false;
  seedSerializer: "buildMesocycleSlotPlanSeed";
  dryRunOnly: true;
  context: {
    ownerLoaded: boolean;
    mesocycleLoaded: boolean;
    slotSequenceAvailable: boolean;
    slotSequenceSlotCount: number;
    slotSequence: {
      source: V2MaterializedSeedAcceptanceProbeSlotSequenceSource;
      slots: Array<{
        slotId: string;
        intent: string;
      }>;
    };
    handoff?: {
      sourceState?: string;
      summaryLoaded?: boolean;
      draftLoaded?: boolean;
      acceptanceProjectionBuilt?: boolean;
    };
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
  gates: {
    basePlanValidation: {
      status: V2BasePlanValidationStatus | "missing";
      passed: boolean;
      blockerCount: number | null;
      warningCount: number | null;
      nextSafeAction?: V2BasePlanValidationNextSafeAction;
      missingReason?: "base_plan_validation_not_provided";
    };
    materializerStatus: {
      status: V2MaterializationDryRunReport["materializer"]["status"];
      passed: boolean;
    };
    seedShapeCompatibility: {
      passed: boolean;
      compatible: boolean;
      slotCountMatches: boolean;
      rolesValid: boolean;
      setCountsValid: boolean;
      noDuplicateExerciseIdsWithinSlot: boolean;
      namesAvailable: boolean;
    };
    requiredLaneCoverage: {
      passed: boolean;
      slotCount: number;
      missingRequiredLaneCount: number;
    };
    noRequiredBlockersRemain: {
      passed: boolean;
      requiredMaterializationBlockerCount: number;
      basePlanBlockerCount: number | null;
    };
    promotionReadiness: {
      status: V2MaterializationPromotionReadiness["status"];
      eligibleForGuardedWrite: boolean;
      safeToPromoteToProductionWrite: false;
      blockerReasons: string[];
    };
    productionGates: {
      explicit: boolean;
      allProvided: boolean;
      values: V2MaterializationProductionWriteGates;
      missing: string[];
    };
    provenance: {
      available: true;
      source: V2MaterializedSeedAcceptanceProvenance["source"];
      dbWriteOccurred: false;
    };
    runtimeReplayContract: {
      unchanged: true;
      runtimeConsumedFields: ["exerciseId", "role", "setCount"];
      runtimeIgnoresPlannerMetadata: true;
    };
    fallbackPolicy: {
      explicit: true;
      v2BlockedFailsClosed: true;
      silentlyFallsBackToLegacyProjection: false;
      allowedFallbackLabels: ["legacy_projection_seed", "fallback_existing_projection"];
    };
  };
  projectionRepairBoundary: {
    legacyProjectionCalled: false;
    legacyRepairEngineCalled: false;
    supportFloorClosureCalled: false;
    weeklyObligationClosureCalled: false;
    lateSetBumpingCalled: false;
    capTrimCalled: false;
    repairAddedExercisesIntroduced: false;
    duplicateCleanupMutatedV2Output: false;
    dirtyCollateralCleanupMutatedV2Output: false;
  };
  seedSerializationBoundary: {
    serializer: "buildMesocycleSlotPlanSeed";
    handcraftedSlotPlanSeedJson: false;
    executableRowFields: ["exerciseId", "role", "setCount"];
    acceptedPlannerIntentRuntimeInert: true;
    runtimeConsumesPlannerMetadata: false;
    previewExposedAsSlotPlanSeedJson: false;
    serializerProbe: {
      attempted: boolean;
      status: "passed" | "blocked" | "not_attempted";
      slotCount: number;
      exerciseCount: number;
      blockers: string[];
    };
  };
  acceptancePreparation: {
    helperOptIn: "disabled";
    helperStatus: "disabled";
    wouldWriteTransaction: false;
    persistenceProvenanceIsSeparate: true;
    dbWriteOccurred: false;
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
      source: "v2_materialized_seed",
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

export function buildAcceptedSeedPersistenceProvenance(input: {
  source: AcceptedSeedPersistenceSource;
  dbWriteOccurred?: boolean;
  seedSourceSelectedBeforeTransaction?: boolean;
  persistedInsideExistingAcceptanceTransaction?: boolean;
  persistedMesocycleId?: string;
  fallback?: AcceptedSeedPersistenceProvenance["fallback"];
}): AcceptedSeedPersistenceProvenance {
  return {
    source: input.source,
    dbWriteOccurred: input.dbWriteOccurred ?? false,
    seedSerializer: "buildMesocycleSlotPlanSeed",
    seedSourceSelectedBeforeTransaction:
      input.seedSourceSelectedBeforeTransaction ?? true,
    persistedInsideExistingAcceptanceTransaction:
      input.persistedInsideExistingAcceptanceTransaction ?? false,
    ...(input.persistedMesocycleId
      ? { persistedMesocycleId: input.persistedMesocycleId }
      : {}),
    fallback: input.fallback ?? { occurred: false },
    executableSeedTruth: ACCEPTED_SEED_EXECUTABLE_TRUTH,
  };
}

export function completeAcceptedSeedPersistenceProvenance(input: {
  provenance: AcceptedSeedPersistenceProvenance;
  persistedMesocycleId?: string;
  dbWriteOccurred: boolean;
}): AcceptedSeedPersistenceProvenance {
  return buildAcceptedSeedPersistenceProvenance({
    source: input.provenance.source,
    dbWriteOccurred: input.dbWriteOccurred,
    seedSourceSelectedBeforeTransaction:
      input.provenance.seedSourceSelectedBeforeTransaction,
    persistedInsideExistingAcceptanceTransaction: input.dbWriteOccurred,
    persistedMesocycleId: input.persistedMesocycleId,
    fallback: input.provenance.fallback,
  });
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
    summaryLoaded: input.handoffContext?.summaryLoaded,
    draftLoaded: input.handoffContext?.draftLoaded,
    acceptanceProjectionBuilt: input.handoffContext?.acceptanceProjectionBuilt,
  });
  const blockersByCategory = groupProbeBlockers([
    ...contextBlockers,
    ...promotionReadiness.blockers,
  ]);
  const simulatedBlockersByCategory = groupProbeBlockers([
    ...contextBlockers,
    ...simulatedReadiness.blockers,
  ]);
  const basePlanValidation = normalizeBasePlanValidationEvidence(
    input.basePlanValidation,
  );
  const seedSerializerProbe = buildReadOnlySeedSerializerProbe({
    dryRunReport,
    slotSequence: input.slotSequence,
    buildSlotPlanSeed:
      input.dependencies?.buildSlotPlanSeed ?? buildMesocycleSlotPlanSeed,
  });
  const productionGateMissing = missingProductionGateKeys(
    promotionReadiness.productionWriteGates,
  );
  const provenance = buildAcceptanceProvenance({
    source: "v2_disabled",
    dryRunReportVersion: dryRunReport.version,
    promotionReadinessVersion: promotionReadiness.version,
    productionWriteGates: promotionReadiness.productionWriteGates,
    blockers: promotionReadiness.blockers,
    readOnly: true,
    dryRunOnly: true,
  });

  return {
    version: 1,
    source: "v2_materialized_seed_acceptance_probe",
    readOnly: true,
    affectsScoringOrGeneration: false,
    wouldWriteTransaction: false,
    wouldCallLegacyProjection: false,
    wouldCallLegacyRepair: false,
    seedSerializer: "buildMesocycleSlotPlanSeed",
    dryRunOnly: true,
    context: {
      ownerLoaded: input.ownerLoaded === true,
      mesocycleLoaded: input.mesocycleLoaded === true,
      slotSequenceAvailable: input.slotSequence.slots.length > 0,
      slotSequenceSlotCount: input.slotSequence.slots.length,
      slotSequence: {
        source:
          input.slotSequenceSource ??
          (input.slotSequence.slots.length > 0 ? "caller_supplied" : "missing"),
        slots: input.slotSequence.slots.map((slot) => ({
          slotId: slot.slotId,
          intent: slot.intent,
        })),
      },
      ...(input.handoffContext
        ? {
            handoff: {
              ...(input.handoffContext.sourceState
                ? { sourceState: input.handoffContext.sourceState }
                : {}),
              ...(input.handoffContext.summaryLoaded !== undefined
                ? { summaryLoaded: input.handoffContext.summaryLoaded }
                : {}),
              ...(input.handoffContext.draftLoaded !== undefined
                ? { draftLoaded: input.handoffContext.draftLoaded }
                : {}),
              ...(input.handoffContext.acceptanceProjectionBuilt !== undefined
                ? {
                    acceptanceProjectionBuilt:
                      input.handoffContext.acceptanceProjectionBuilt,
                  }
                : {}),
            },
          }
        : {}),
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
    gates: {
      basePlanValidation: basePlanValidation
        ? {
            status: basePlanValidation.status,
            passed:
              basePlanValidation.status === "pass" ||
              basePlanValidation.status === "pass_with_warnings",
            blockerCount: basePlanValidation.blockerCount,
            warningCount: basePlanValidation.warningCount,
            nextSafeAction: basePlanValidation.nextSafeAction,
          }
        : {
            status: "missing",
            passed: false,
            blockerCount: null,
            warningCount: null,
            missingReason: "base_plan_validation_not_provided",
          },
      materializerStatus: {
        status: dryRunReport.materializer.status,
        passed: dryRunReport.materializer.status === "materialized",
      },
      seedShapeCompatibility: {
        passed: promotionReadiness.seedShape.compatible,
        compatible: dryRunReport.seedShapeCompatibility.compatible,
        slotCountMatches: promotionReadiness.seedShape.slotCountMatches,
        rolesValid: promotionReadiness.seedShape.rolesValid,
        setCountsValid: promotionReadiness.seedShape.setCountsValid,
        noDuplicateExerciseIdsWithinSlot:
          promotionReadiness.seedShape.noDuplicateExerciseIdsWithinSlot,
        namesAvailable: promotionReadiness.seedShape.namesAvailable,
      },
      requiredLaneCoverage: {
        passed:
          promotionReadiness.requiredMaterialization.requiredLaneCoveragePassed,
        slotCount: requiredLaneCoverageBySlot.length,
        missingRequiredLaneCount: requiredLaneCoverageBySlot.reduce(
          (sum, slot) => sum + slot.missingRequiredLaneIds.length,
          0,
        ),
      },
      noRequiredBlockersRemain: {
        passed:
          promotionReadiness.requiredMaterialization.requiredBlockerCount === 0 &&
          (basePlanValidation?.blockerCount ?? 0) === 0,
        requiredMaterializationBlockerCount:
          promotionReadiness.requiredMaterialization.requiredBlockerCount,
        basePlanBlockerCount: basePlanValidation?.blockerCount ?? null,
      },
      promotionReadiness: {
        status: promotionReadiness.status,
        eligibleForGuardedWrite:
          promotionReadiness.status === "eligible_for_guarded_write" &&
          promotionReadiness.safeToPromoteToProductionWrite === true,
        safeToPromoteToProductionWrite: false,
        blockerReasons: promotionReadiness.blockers.map((blocker) =>
          `${blocker.category}:${blocker.reason}`,
        ),
      },
      productionGates: {
        explicit: input.productionWriteGates !== undefined,
        allProvided: productionGateMissing.length === 0,
        values: promotionReadiness.productionWriteGates,
        missing: productionGateMissing,
      },
      provenance: {
        available: true,
        source: provenance.source,
        dbWriteOccurred: false,
      },
      runtimeReplayContract: {
        unchanged: true,
        runtimeConsumedFields: ["exerciseId", "role", "setCount"],
        runtimeIgnoresPlannerMetadata: true,
      },
      fallbackPolicy: {
        explicit: true,
        v2BlockedFailsClosed: true,
        silentlyFallsBackToLegacyProjection: false,
        allowedFallbackLabels: [
          "legacy_projection_seed",
          "fallback_existing_projection",
        ],
      },
    },
    projectionRepairBoundary: {
      legacyProjectionCalled: false,
      legacyRepairEngineCalled: false,
      supportFloorClosureCalled: false,
      weeklyObligationClosureCalled: false,
      lateSetBumpingCalled: false,
      capTrimCalled: false,
      repairAddedExercisesIntroduced: false,
      duplicateCleanupMutatedV2Output: false,
      dirtyCollateralCleanupMutatedV2Output: false,
    },
    seedSerializationBoundary: {
      serializer: "buildMesocycleSlotPlanSeed",
      handcraftedSlotPlanSeedJson: false,
      executableRowFields: ["exerciseId", "role", "setCount"],
      acceptedPlannerIntentRuntimeInert: true,
      runtimeConsumesPlannerMetadata: false,
      previewExposedAsSlotPlanSeedJson: false,
      serializerProbe: seedSerializerProbe,
    },
    acceptancePreparation: {
      helperOptIn: "disabled",
      helperStatus: "disabled",
      wouldWriteTransaction: false,
      persistenceProvenanceIsSeparate: true,
      dbWriteOccurred: false,
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
    provenance,
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

function normalizeBasePlanValidationEvidence(
  validation:
    | V2MaterializedSeedAcceptanceProbeBasePlanValidationEvidence
    | V2BasePlanValidation
    | null
    | undefined,
): V2MaterializedSeedAcceptanceProbeBasePlanValidationEvidence | null {
  if (!validation) {
    return null;
  }
  if ("summary" in validation) {
    return {
      source: "v2_base_plan_validation",
      status: validation.status,
      blockerCount: validation.summary.blockerCount,
      warningCount: validation.summary.warningCount,
      nextSafeAction: validation.nextSafeAction,
    };
  }
  return validation;
}

function buildReadOnlySeedSerializerProbe(input: {
  dryRunReport: V2MaterializationDryRunReport;
  slotSequence: MesocycleSlotSequence;
  buildSlotPlanSeed: typeof buildMesocycleSlotPlanSeed;
}): BuildV2MaterializedSeedAcceptanceProbeResult["seedSerializationBoundary"]["serializerProbe"] {
  const projectedSlotPlans = materializedReportToProjectedSlotPlans({
    dryRunReport: input.dryRunReport,
    slotSequence: input.slotSequence,
  });
  if ("blocked" in projectedSlotPlans) {
    return {
      attempted: false,
      status: input.dryRunReport.executableSeedPreview.length > 0
        ? "blocked"
        : "not_attempted",
      slotCount: 0,
      exerciseCount: 0,
      blockers: [projectedSlotPlans.blocked.reason],
    };
  }

  try {
    const seedPreview = input.buildSlotPlanSeed({
      slotSequence: input.slotSequence,
      slotPlans: projectedSlotPlans.slotPlans,
    });
    return {
      attempted: true,
      status: "passed",
      slotCount: seedPreview.slots.length,
      exerciseCount: seedPreview.slots.reduce(
        (sum, slot) => sum + slot.exercises.length,
        0,
      ),
      blockers: [],
    };
  } catch (error) {
    return {
      attempted: true,
      status: "blocked",
      slotCount: 0,
      exerciseCount: 0,
      blockers: [error instanceof Error ? error.message : "seed_serializer_failed"],
    };
  }
}

function missingProductionGateKeys(
  gates: V2MaterializationProductionWriteGates,
): string[] {
  return Object.entries(gates)
    .flatMap(([key, value]) => (value ? [] : [key]))
    .sort((left, right) => left.localeCompare(right));
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
  summaryLoaded?: boolean;
  draftLoaded?: boolean;
  acceptanceProjectionBuilt?: boolean;
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
    ...(input.summaryLoaded === false
      ? [
          {
            category: "required_materialization" as const,
            reason: "handoff_summary_not_loaded",
          },
        ]
      : []),
    ...(input.draftLoaded === false
      ? [
          {
            category: "required_materialization" as const,
            reason: "handoff_draft_not_loaded",
          },
        ]
      : []),
    ...(input.acceptanceProjectionBuilt === false
      ? [
          {
            category: "required_materialization" as const,
            reason: "handoff_acceptance_projection_not_built",
          },
        ]
      : []),
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
