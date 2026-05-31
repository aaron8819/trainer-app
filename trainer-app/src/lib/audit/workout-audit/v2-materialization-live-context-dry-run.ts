import { prisma } from "@/lib/db/prisma";
import type { WorkoutSessionIntent } from "@prisma/client";
import {
  buildV2ExerciseMaterializationPlan,
  buildV2ExerciseSelectionPlan,
  buildV2BasePlanCompare,
  buildV2BasePlanShadowConsumptionTrial,
  buildV2BasePlanValidation,
  buildV2MaterializationDryRunReport,
  buildV2PlannerMesocyclePolicy,
  buildV2SelectionCapacityPlan,
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  matchV2ExerciseClasses,
  type V2BasePlanCompare,
  type V2BasePlanComparePlanView,
  type V2BasePlanShadowConsumptionTrial,
  type V2ExerciseClassTaxonomy,
  type V2ExerciseMaterializationInput,
  type V2MaterializationDryRunReport,
  type V2MaterializationExercise,
  type V2PlannerMesocyclePolicy,
  type V2PlannerSlotId,
} from "@/lib/engine/planning/v2";
import type { V2SelectionCapacityPlanDiagnostic } from "@/lib/api/planning-reality";
import type { SlotPlanPlanningRealityDiagnostic } from "@/lib/api/planning-reality";
import {
  buildMesocycleSlotSequence,
  resolveMesocycleSlotContract,
} from "@/lib/api/mesocycle-slot-contract";
import {
  buildV2MaterializedSeedAcceptanceProbe,
  type BuildV2MaterializedSeedAcceptanceProbeResult,
} from "@/lib/api/mesocycle-handoff-v2-materialized-seed";
import {
  normalizeLiveInventoryForV2Materialization,
  type LiveV2MaterializationExerciseRow,
} from "@/lib/api/v2-materialization-live-inventory";

export { normalizeLiveInventoryForV2Materialization };

export type V2LiveContextInventorySource =
  | "live_normalized_inventory"
  | "fixture_snapshot"
  | "unavailable";

export type V2LiveContextMaterializationDryRunResult = {
  version: 1;
  source: "v2_live_context_materialization_dry_run";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  context: {
    ownerLoaded: boolean;
    mesocycleLoaded: boolean;
    userId?: string;
    ownerEmail?: string | null;
    mesocycleId?: string;
    mesocycleState?: string;
    splitType?: string;
    slotSequenceSource?: "mesocycle_slot_sequence" | "legacy_weekly_schedule";
    slotSequenceSlotCount: number;
  };
  inventorySource: V2LiveContextInventorySource;
  inventoryExerciseCount: number;
  unsupportedClassCount: number;
  requiredLaneCoverageBySlot: Array<{
    slotId: string;
    requiredLaneCount: number;
    materializedRequiredLaneCount: number;
    blockedRequiredLaneCount: number;
    missingRequiredLaneIds: string[];
  }>;
  materializerStatus: V2MaterializationDryRunReport["materializer"]["status"];
  seedShapeCompatibility: V2MaterializationDryRunReport["seedShapeCompatibility"];
  executablePreviewCountBySlot: Array<{
    slotId: string;
    exerciseCount: number;
  }>;
  blockersBeforePromotion: string[];
  safeToPromoteToProductionWrite: false;
};

type OwnerContext = {
  userId?: string;
  ownerEmail?: string | null;
};

type MesocycleContext = {
  id?: string;
  state?: string;
  splitType?: string;
  slotSequenceJson?: unknown;
  weeklySchedule?: readonly string[] | null;
};

export type V2MaterializedSeedAcceptanceProbeReader = {
  user: {
    findUnique(args: unknown): Promise<{
      id: string;
      email: string | null;
    } | null>;
  };
  mesocycle: {
    findFirst(args: unknown): Promise<{
      id: string;
      state: string;
      splitType: string;
      slotSequenceJson: unknown;
    } | null>;
  };
  exercise: {
    findMany(args: unknown): Promise<LiveV2MaterializationExerciseRow[]>;
  };
  userPreference: {
    findUnique(args: unknown): Promise<{
      avoidExerciseIds: string[];
      favoriteExerciseIds: string[];
    } | null>;
  };
};

export type V2LiveContextMaterializationDryRunInput = {
  ownerContext?: OwnerContext | null;
  mesocycleContext?: MesocycleContext | null;
  inventory?: V2MaterializationExercise[] | null;
  inventorySource: V2LiveContextInventorySource;
  plannerPolicy?: V2PlannerMesocyclePolicy;
  taxonomy?: V2ExerciseClassTaxonomy;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
};

export type V2LiveContextBasePlanCompareInput = {
  plannerPolicy?: V2PlannerMesocyclePolicy;
  taxonomy?: V2ExerciseClassTaxonomy;
  inventory?: V2MaterializationExercise[] | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
  noRepairPlanningReality?: SlotPlanPlanningRealityDiagnostic | null;
  repairedPlanningReality?: SlotPlanPlanningRealityDiagnostic | null;
};

export type V2CapacityMaterializerProjectionGateStatus =
  | "pass"
  | "fail"
  | "unknown";

export type V2CapacityMaterializerProjection = {
  version: 1;
  source: "v2_capacity_materializer_projection";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  consumedByProduction: false;
  consumedByDemandOrMaterializer: false;
  status: "projected_with_limitations" | "blocked" | "not_available";
  projectionMode: "slot_cap_delta_materializer_dry_run";
  trialId: string | null;
  candidateChange: {
    kind: "slot_max_exercise_count_delta";
    slotId: string;
    delta: 1;
  } | null;
  comparedPlans: {
    baselineAvailable: boolean;
    trialAvailable: boolean;
    inventoryExerciseCount: number;
  };
  targetSlot: {
    slotId: string | null;
    maxExerciseCountBefore: number | null;
    maxExerciseCountAfter: number | null;
    baselineExerciseCount: number;
    trialExerciseCount: number;
    baselineSetCount: number;
    trialSetCount: number;
    addedIdentities: string[];
    removedIdentities: string[];
    floorCriticalLaneIds: string[];
    floorCriticalLaneIdsMaterialized: string[];
    floorCriticalLaneIdsMissing: string[];
  };
  materializer: {
    baselineStatus: V2MaterializationDryRunReport["materializer"]["status"];
    trialStatus: V2MaterializationDryRunReport["materializer"]["status"];
    baselineBlockerCount: number;
    trialBlockerCount: number;
    baselineSeedShapeCompatible: boolean;
    trialSeedShapeCompatible: boolean;
  };
  candidateImpact: {
    selectedIdentityDelta: number;
    totalSetDelta: number;
    targetSlotExerciseDelta: number;
    materializerBlockerDelta: number;
    regressionCount: number;
    regressions: string[];
    improvements: string[];
  };
  gates: Array<{
    gateId:
      | "hard_floors"
      | "over_mav"
      | "session_size"
      | "five_set_stacking"
      | "lane_survival"
      | "duplicates"
      | "materializer_validity"
      | "acceptance_result";
    status: V2CapacityMaterializerProjectionGateStatus;
    measured: boolean;
    ownerSeam: string;
    evidence: string[];
    regressions: string[];
    requiredNextEvidence: string[];
  }>;
  blockersBeforeBehavior: string[];
  nextSafeAction:
    | "inspect_materializer_capacity_projection"
    | "run_read_only_acceptance_projection"
    | "pivot_to_higher_roi_track"
    | "inspect_capacity_rows";
  limitations: string[];
  safeForBehaviorPromotion: false;
};

const EMPTY_CONSTRAINTS: V2ExerciseMaterializationInput["constraints"] = {
  avoidExerciseIds: [],
  favoriteExerciseIds: [],
  painConflictExerciseIds: [],
};

export function buildV2LiveContextMaterializationDryRunHarness(
  input: V2LiveContextMaterializationDryRunInput,
): V2LiveContextMaterializationDryRunResult {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const inventory = input.inventory ?? [];
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const slotContract = resolveMesocycleSlotContract({
    slotSequenceJson: input.mesocycleContext?.slotSequenceJson,
    weeklySchedule: input.mesocycleContext?.weeklySchedule ?? [],
  });
  const slotIntentById = Object.fromEntries(
    slotContract.slots.map((slot) => [slot.slotId, slot.intent]),
  );
  const materializedPlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null;
  const dryRunReport = buildV2MaterializationDryRunReport({
    plannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    ...(materializedPlan ? { materializedPlan } : {}),
    slotIntentById,
  });

  return {
    version: 1,
    source: "v2_live_context_materialization_dry_run",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    context: {
      ownerLoaded: Boolean(input.ownerContext?.userId),
      mesocycleLoaded: Boolean(input.mesocycleContext?.id),
      ...(input.ownerContext?.userId ? { userId: input.ownerContext.userId } : {}),
      ...(input.ownerContext?.ownerEmail !== undefined
        ? { ownerEmail: input.ownerContext.ownerEmail }
        : {}),
      ...(input.mesocycleContext?.id
        ? { mesocycleId: input.mesocycleContext.id }
        : {}),
      ...(input.mesocycleContext?.state
        ? { mesocycleState: input.mesocycleContext.state }
        : {}),
      ...(input.mesocycleContext?.splitType
        ? { splitType: input.mesocycleContext.splitType }
        : {}),
      slotSequenceSource: slotContract.source,
      slotSequenceSlotCount: slotContract.slots.length,
    },
    inventorySource: input.inventorySource,
    inventoryExerciseCount: inventory.length,
    unsupportedClassCount:
      dryRunReport.seedShapeCompatibility.unsupportedClassCount,
    requiredLaneCoverageBySlot: dryRunReport.requiredLaneCoverageBySlot,
    materializerStatus: dryRunReport.materializer.status,
    seedShapeCompatibility: dryRunReport.seedShapeCompatibility,
    executablePreviewCountBySlot: dryRunReport.executableSeedPreview.map((slot) => ({
      slotId: slot.slotId,
      exerciseCount: slot.exercises.length,
    })),
    blockersBeforePromotion: summarizeBlockersBeforePromotion({
      dryRunReport,
      inventorySource: input.inventorySource,
      ownerLoaded: Boolean(input.ownerContext?.userId),
      mesocycleLoaded: Boolean(input.mesocycleContext?.id),
    }),
    safeToPromoteToProductionWrite: false,
  };
}

export function buildV2BasePlanCompareFromLiveContext(
  input: V2LiveContextBasePlanCompareInput,
): V2BasePlanCompare {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const inventory = input.inventory ?? [];
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const materializedPlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null;
  const validation = buildV2BasePlanValidation({
    plannerPolicy,
    materializedPlan,
    inventory,
    taxonomy,
  });

  return buildV2BasePlanCompare({
    v2BasePlanValidation: validation,
    v2MaterializedPlan: materializedPlan,
    inventory,
    taxonomy,
    plannerOnlyNoRepairPlan: normalizePlanningRealityForBasePlanCompare({
      planId: "planner_only_no_repair",
      planningReality: input.noRepairPlanningReality,
      taxonomy,
    }),
    repairedPlan: normalizePlanningRealityForBasePlanCompare({
      planId: "repaired_projection",
      planningReality: input.repairedPlanningReality,
      taxonomy,
      includeRepairEvidence: true,
    }),
  });
}

export function buildV2BasePlanShadowConsumptionTrialFromLiveContext(
  input: V2LiveContextBasePlanCompareInput,
): V2BasePlanShadowConsumptionTrial {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const inventory = input.inventory ?? [];
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const materializedPlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null;
  const validation = buildV2BasePlanValidation({
    plannerPolicy,
    materializedPlan,
    inventory,
    taxonomy,
  });

  return buildV2BasePlanShadowConsumptionTrial({
    v2BasePlanValidation: validation,
    v2MaterializedPlan: materializedPlan,
    inventory,
    taxonomy,
    plannerOnlyNoRepairPlan: normalizePlanningRealityForBasePlanCompare({
      planId: "planner_only_no_repair",
      planningReality: input.noRepairPlanningReality,
      taxonomy,
    }),
    repairedPlan: normalizePlanningRealityForBasePlanCompare({
      planId: "repaired_projection",
      planningReality: input.repairedPlanningReality,
      taxonomy,
      includeRepairEvidence: true,
    }),
  });
}

export function buildV2CapacityMaterializerProjectionFromLiveContext(input: {
  plannerPolicy?: V2PlannerMesocyclePolicy;
  capacityDiagnostic?: V2SelectionCapacityPlanDiagnostic | null;
  taxonomy?: V2ExerciseClassTaxonomy;
  inventory?: V2MaterializationExercise[] | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
}): V2CapacityMaterializerProjection {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const diagnostic = input.capacityDiagnostic;
  const change = diagnostic?.capacityPolicyTrialDesign.candidateChange ?? null;
  const inventory = input.inventory ?? [];
  if (!diagnostic || !change) {
    return emptyCapacityMaterializerProjection([
      "capacity_policy_trial_design_unavailable",
    ]);
  }

  const slotId = change.slotId as V2PlannerSlotId;
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const maxExerciseCountBefore =
    plannerPolicy.selectionCapacityPlan.weeks[0]?.slots.find(
      (slot) => slot.slotId === slotId,
    )?.maxExerciseCount ?? null;
  if (maxExerciseCountBefore == null) {
    return emptyCapacityMaterializerProjection([
      `capacity_slot_not_found:${change.slotId}`,
    ]);
  }

  const trialSelectionCapacityPlan = buildV2SelectionCapacityPlan({
    exerciseClassDistributionBySlot:
      plannerPolicy.exerciseClassDistributionBySlot,
    v2SetDistributionIntent: plannerPolicy.v2SetDistributionIntent,
    v2SupportLanePolicy: plannerPolicy.v2SupportLanePolicy,
    sessionCapacity: {
      maxExerciseCountBySlot: {
        [slotId]: maxExerciseCountBefore + change.delta,
      },
    },
  });
  const trialExerciseSelectionPlan = buildV2ExerciseSelectionPlan({
    exerciseClassDistributionBySlot:
      plannerPolicy.exerciseClassDistributionBySlot,
    v2SetDistributionIntent: plannerPolicy.v2SetDistributionIntent,
    v2SupportLanePolicy: plannerPolicy.v2SupportLanePolicy,
    selectionCapacityPlan: trialSelectionCapacityPlan,
  });
  const trialPlannerPolicy: V2PlannerMesocyclePolicy = {
    ...plannerPolicy,
    selectionCapacityPlan: trialSelectionCapacityPlan,
    exerciseSelectionPlan: trialExerciseSelectionPlan,
  };
  const baselinePlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null;
  const trialPlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: trialPlannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null;
  const baselineReport = buildV2MaterializationDryRunReport({
    plannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    ...(baselinePlan ? { materializedPlan: baselinePlan } : {}),
  });
  const trialReport = buildV2MaterializationDryRunReport({
    plannerPolicy: trialPlannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    ...(trialPlan ? { materializedPlan: trialPlan } : {}),
  });
  const targetSlot = summarizeCapacityProjectionSlot({
    slotId,
    diagnostic,
    baselinePlan,
    trialPlan,
    maxExerciseCountBefore,
    maxExerciseCountAfter: maxExerciseCountBefore + change.delta,
    inventory,
  });
  const candidateImpact = summarizeCapacityProjectionImpact({
    baselinePlan,
    trialPlan,
    baselineReport,
    trialReport,
    targetSlot,
  });
  const gates = buildCapacityMaterializerProjectionGates({
    targetSlot,
    trialReport,
    trialPlan,
    candidateImpact,
  });
  const failedGates = gates.filter((gate) => gate.status === "fail");
  const unknownGates = gates.filter((gate) => gate.status === "unknown");
  const noCandidateImpact =
    candidateImpact.selectedIdentityDelta === 0 &&
    candidateImpact.totalSetDelta === 0 &&
    candidateImpact.targetSlotExerciseDelta === 0 &&
    candidateImpact.materializerBlockerDelta === 0 &&
    candidateImpact.regressionCount === 0 &&
    candidateImpact.improvements.length === 0;
  const nextSafeAction =
    failedGates.length > 0 || unknownGates.length > 1
      ? "inspect_materializer_capacity_projection"
      : noCandidateImpact
        ? "pivot_to_higher_roi_track"
        : "run_read_only_acceptance_projection";

  return {
    version: 1,
    source: "v2_capacity_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status:
      failedGates.length > 0 || trialReport.status === "blocked"
        ? "blocked"
        : "projected_with_limitations",
    projectionMode: "slot_cap_delta_materializer_dry_run",
    trialId: diagnostic?.capacityPolicyTrialDesign.trialId ?? null,
    candidateChange: {
      kind: change.kind,
      slotId: change.slotId,
      delta: change.delta,
    },
    comparedPlans: {
      baselineAvailable: Boolean(baselinePlan),
      trialAvailable: Boolean(trialPlan),
      inventoryExerciseCount: inventory.length,
    },
    targetSlot,
    materializer: {
      baselineStatus: baselineReport.materializer.status,
      trialStatus: trialReport.materializer.status,
      baselineBlockerCount: baselineReport.materializer.blockerCount,
      trialBlockerCount: trialReport.materializer.blockerCount,
      baselineSeedShapeCompatible:
        baselineReport.seedShapeCompatibility.compatible,
      trialSeedShapeCompatible: trialReport.seedShapeCompatibility.compatible,
    },
    candidateImpact,
    gates,
    blockersBeforeBehavior: uniqueSorted([
      ...failedGates.map((gate) => `${gate.gateId}_gate_failed`),
      ...unknownGates.map((gate) => `${gate.gateId}_gate_unknown`),
      ...(noCandidateImpact ? ["capacity_trial_no_candidate_impact"] : []),
      "acceptance_gate_not_rerun",
      "production_projection_not_consuming_trial",
    ]),
    nextSafeAction,
    limitations: [
      "read_only_materializer_dry_run_only",
      "trial_capacity_plan_is_projection_copy_only",
      ...(noCandidateImpact
        ? ["capacity_trial_did_not_change_candidate_identity_or_sets"]
        : []),
      "does_not_change_selection_capacity_plan",
      "does_not_feed_production_materializer",
      "does_not_feed_acceptance_scoring",
      "does_not_write_slotPlanSeedJson",
      "does_not_change_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

export async function runV2LiveContextMaterializationDryRunHarness(input: {
  userId?: string;
  ownerEmail?: string;
} = {}): Promise<V2LiveContextMaterializationDryRunResult> {
  const ownerEmail =
    input.ownerEmail ?? process.env.OWNER_EMAIL?.trim().toLowerCase() ?? "owner@local";
  const user = input.userId
    ? await prisma.user.findUnique({ where: { id: input.userId } })
    : await prisma.user.findUnique({ where: { email: ownerEmail } });

  if (!user) {
    return buildV2LiveContextMaterializationDryRunHarness({
      ownerContext: {
        ...(input.userId ? { userId: input.userId } : {}),
        ownerEmail,
      },
      mesocycleContext: null,
      inventory: null,
      inventorySource: "unavailable",
    });
  }

  const [mesocycle, exercises, preferences] = await Promise.all([
    prisma.mesocycle.findFirst({
      where: {
        isActive: true,
        macroCycle: { userId: user.id },
      },
      orderBy: [{ mesoNumber: "desc" }],
      select: {
        id: true,
        state: true,
        splitType: true,
        slotSequenceJson: true,
      },
    }),
    prisma.exercise.findMany({
      orderBy: { name: "asc" },
      include: {
        aliases: true,
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
    }),
    prisma.userPreference.findUnique({ where: { userId: user.id } }),
  ]);

  return buildV2LiveContextMaterializationDryRunHarness({
    ownerContext: { userId: user.id, ownerEmail: user.email },
    mesocycleContext: mesocycle
      ? {
          id: mesocycle.id,
          state: mesocycle.state,
          splitType: mesocycle.splitType,
          slotSequenceJson: mesocycle.slotSequenceJson,
        }
      : null,
    inventory: normalizeLiveInventoryForV2Materialization(exercises),
    inventorySource: "live_normalized_inventory",
    constraints: {
      avoidExerciseIds: preferences?.avoidExerciseIds ?? [],
      favoriteExerciseIds: preferences?.favoriteExerciseIds ?? [],
      painConflictExerciseIds: [],
    },
  });
}

export async function runV2MaterializedSeedAcceptanceProbe(input: {
  userId?: string;
  ownerEmail?: string;
  mesocycleId?: string;
  reader?: V2MaterializedSeedAcceptanceProbeReader;
} = {}): Promise<BuildV2MaterializedSeedAcceptanceProbeResult> {
  const reader = input.reader ?? prisma;
  const ownerEmail =
    input.ownerEmail ?? process.env.OWNER_EMAIL?.trim().toLowerCase() ?? "owner@local";
  const user = input.userId
    ? await reader.user.findUnique({ where: { id: input.userId } })
    : await reader.user.findUnique({ where: { email: ownerEmail } });

  if (!user) {
    return buildV2MaterializedSeedAcceptanceProbe({
      ownerLoaded: false,
      mesocycleLoaded: false,
      slotSequence: buildMesocycleSlotSequence([]),
      plannerPolicy: null,
      exerciseSelectionPlan: null,
      taxonomy: null,
      inventory: null,
      liveNormalizedInventoryAvailable: false,
    });
  }

  const [mesocycle, exercises, preferences] = await Promise.all([
    reader.mesocycle.findFirst({
      where: {
        ...(input.mesocycleId ? { id: input.mesocycleId } : { isActive: true }),
        macroCycle: { userId: user.id },
      },
      orderBy: input.mesocycleId ? undefined : [{ mesoNumber: "desc" }],
      select: {
        id: true,
        state: true,
        splitType: true,
        slotSequenceJson: true,
      },
    }),
    reader.exercise.findMany({
      orderBy: { name: "asc" },
      include: {
        aliases: true,
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
    }),
    reader.userPreference.findUnique({ where: { userId: user.id } }),
  ]);
  const slotContract = resolveMesocycleSlotContract({
    slotSequenceJson: mesocycle?.slotSequenceJson,
    weeklySchedule: [],
  });
  const slotSequence = buildMesocycleSlotSequence(
    slotContract.slots.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent.toUpperCase() as WorkoutSessionIntent,
      ...(slot.authoredSemantics
        ? { authoredSemantics: slot.authoredSemantics }
        : {}),
    })),
  );
  const plannerPolicy = buildV2PlannerMesocyclePolicy();
  const inventory = normalizeLiveInventoryForV2Materialization(exercises);
  const taxonomy = DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const constraints = {
    avoidExerciseIds: preferences?.avoidExerciseIds ?? [],
    favoriteExerciseIds: preferences?.favoriteExerciseIds ?? [],
    painConflictExerciseIds: [],
  };
  const materializedPlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
        })
      : null;
  const basePlanValidation = buildV2BasePlanValidation({
    plannerPolicy,
    materializedPlan,
    inventory,
    taxonomy,
  });

  return buildV2MaterializedSeedAcceptanceProbe({
    ownerLoaded: true,
    mesocycleLoaded: Boolean(mesocycle),
    slotSequence,
    slotSequenceSource: "live_mesocycle_slot_sequence",
    plannerPolicy,
    exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
    taxonomy,
    inventory,
    materializedPlan,
    basePlanValidation,
    liveNormalizedInventoryAvailable: inventory.length > 0,
    constraints,
  });
}

function summarizeBlockersBeforePromotion(input: {
  dryRunReport: V2MaterializationDryRunReport;
  inventorySource: V2LiveContextInventorySource;
  ownerLoaded: boolean;
  mesocycleLoaded: boolean;
}): string[] {
  return Array.from(
    new Set([
      ...(input.ownerLoaded ? [] : ["owner_context_unavailable"]),
      ...(input.mesocycleLoaded ? [] : ["mesocycle_context_unavailable"]),
      ...(input.inventorySource === "live_normalized_inventory"
        ? []
        : [`inventory_source_${input.inventorySource}`]),
      ...input.dryRunReport.blockers.map((blocker) =>
        [blocker.slotId, blocker.laneId, blocker.reason]
          .filter(Boolean)
          .join(":"),
      ),
      ...input.dryRunReport.readiness.missingBeforePromotion,
    ]),
  );
}

function emptyCapacityMaterializerProjection(
  blockers: string[],
): V2CapacityMaterializerProjection {
  return {
    version: 1,
    source: "v2_capacity_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "not_available",
    projectionMode: "slot_cap_delta_materializer_dry_run",
    trialId: null,
    candidateChange: null,
    comparedPlans: {
      baselineAvailable: false,
      trialAvailable: false,
      inventoryExerciseCount: 0,
    },
    targetSlot: {
      slotId: null,
      maxExerciseCountBefore: null,
      maxExerciseCountAfter: null,
      baselineExerciseCount: 0,
      trialExerciseCount: 0,
      baselineSetCount: 0,
      trialSetCount: 0,
      addedIdentities: [],
      removedIdentities: [],
      floorCriticalLaneIds: [],
      floorCriticalLaneIdsMaterialized: [],
      floorCriticalLaneIdsMissing: [],
    },
    materializer: {
      baselineStatus: "blocked",
      trialStatus: "blocked",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: false,
      trialSeedShapeCompatible: false,
    },
    candidateImpact: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      targetSlotExerciseDelta: 0,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      regressions: [],
      improvements: [],
    },
    gates: [],
    blockersBeforeBehavior: blockers,
    nextSafeAction: "inspect_capacity_rows",
    limitations: [
      "projection_not_available_without_capacity_policy_trial_design",
      "does_not_change_selection_capacity_plan",
      "does_not_feed_production_materializer",
      "does_not_change_seed_or_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

function summarizeCapacityProjectionSlot(input: {
  slotId: V2PlannerSlotId;
  diagnostic: V2SelectionCapacityPlanDiagnostic;
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null;
  maxExerciseCountBefore: number;
  maxExerciseCountAfter: number;
  inventory: ReadonlyArray<V2MaterializationExercise>;
}): V2CapacityMaterializerProjection["targetSlot"] {
  const baselineSlot = input.baselinePlan?.slots.find(
    (slot) => slot.slotId === input.slotId,
  );
  const trialSlot = input.trialPlan?.slots.find(
    (slot) => slot.slotId === input.slotId,
  );
  const baselineIds = new Set(
    baselineSlot?.exercises.map((exercise) => exercise.exerciseId) ?? [],
  );
  const trialIds = new Set(
    trialSlot?.exercises.map((exercise) => exercise.exerciseId) ?? [],
  );
  const floorCriticalLaneIds = uniqueSorted(
    input.diagnostic.weeks.flatMap((week) =>
      week.slots
        .filter((slot) => slot.slotId === input.slotId)
        .flatMap((slot) =>
          slot.lanes
            .filter((lane) => lane.inspectionCategory === "floor_critical")
            .map((lane) => lane.laneId),
        ),
    ),
  );
  const materializedLaneIds = new Set(
    trialSlot?.exercises.flatMap((exercise) => exercise.laneIds) ?? [],
  );

  return {
    slotId: input.slotId,
    maxExerciseCountBefore: input.maxExerciseCountBefore,
    maxExerciseCountAfter: input.maxExerciseCountAfter,
    baselineExerciseCount: baselineSlot?.exercises.length ?? 0,
    trialExerciseCount: trialSlot?.exercises.length ?? 0,
    baselineSetCount: sumMaterializedSlotSets(baselineSlot),
    trialSetCount: sumMaterializedSlotSets(trialSlot),
    addedIdentities: exerciseNamesForIds({
      exerciseIds: [...trialIds].filter((id) => !baselineIds.has(id)),
      inventory: input.inventory,
    }),
    removedIdentities: exerciseNamesForIds({
      exerciseIds: [...baselineIds].filter((id) => !trialIds.has(id)),
      inventory: input.inventory,
    }),
    floorCriticalLaneIds,
    floorCriticalLaneIdsMaterialized: floorCriticalLaneIds.filter((laneId) =>
      materializedLaneIds.has(laneId),
    ),
    floorCriticalLaneIdsMissing: floorCriticalLaneIds.filter(
      (laneId) => !materializedLaneIds.has(laneId),
    ),
  };
}

function summarizeCapacityProjectionImpact(input: {
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null;
  baselineReport: V2MaterializationDryRunReport;
  trialReport: V2MaterializationDryRunReport;
  targetSlot: V2CapacityMaterializerProjection["targetSlot"];
}): V2CapacityMaterializerProjection["candidateImpact"] {
  const baselineIds = materializedExerciseIds(input.baselinePlan);
  const trialIds = materializedExerciseIds(input.trialPlan);
  const regressions = uniqueSorted([
    ...(input.targetSlot.removedIdentities.length > 0
      ? [`removed_identities:${input.targetSlot.removedIdentities.length}`]
      : []),
    ...(input.trialReport.materializer.status !== "materialized"
      ? [`trial_materializer_status:${input.trialReport.materializer.status}`]
      : []),
    ...(!input.trialReport.seedShapeCompatibility.compatible
      ? ["trial_seed_shape_incompatible"]
      : []),
  ]);
  const totalSetDelta =
    sumMaterializedPlanSets(input.trialPlan) -
    sumMaterializedPlanSets(input.baselinePlan);
  const materializerBlockerDelta =
    input.trialReport.materializer.blockerCount -
    input.baselineReport.materializer.blockerCount;

  return {
    selectedIdentityDelta:
      [...trialIds].filter((id) => !baselineIds.has(id)).length +
      [...baselineIds].filter((id) => !trialIds.has(id)).length,
    totalSetDelta,
    targetSlotExerciseDelta:
      input.targetSlot.trialExerciseCount - input.targetSlot.baselineExerciseCount,
    materializerBlockerDelta,
    regressionCount: regressions.length,
    regressions,
    improvements: uniqueSorted([
      ...(input.targetSlot.addedIdentities.length > 0
        ? [`added_identities:${input.targetSlot.addedIdentities.length}`]
        : []),
      ...(materializerBlockerDelta < 0
        ? [`materializer_blockers_reduced:${Math.abs(materializerBlockerDelta)}`]
        : []),
    ]),
  };
}

function buildCapacityMaterializerProjectionGates(input: {
  targetSlot: V2CapacityMaterializerProjection["targetSlot"];
  trialReport: V2MaterializationDryRunReport;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null;
  candidateImpact: V2CapacityMaterializerProjection["candidateImpact"];
}): V2CapacityMaterializerProjection["gates"] {
  const targetSlot = input.targetSlot;
  const trialSlot = input.trialPlan?.slots.find(
    (slot) => slot.slotId === targetSlot.slotId,
  );
  const duplicateIds = duplicateExerciseIds(trialSlot);
  const setStacking = (trialSlot?.exercises ?? [])
    .filter((exercise) => exercise.setCount >= 5)
    .map((exercise) => `${exercise.exerciseId}:${exercise.setCount}`);
  const sessionSizeRegressions = [
    ...(targetSlot.maxExerciseCountAfter != null &&
    targetSlot.trialExerciseCount > targetSlot.maxExerciseCountAfter
      ? [
          `exercise_count:${targetSlot.trialExerciseCount}/${targetSlot.maxExerciseCountAfter}`,
        ]
      : []),
  ];

  return [
    {
      gateId: "hard_floors",
      status:
        targetSlot.floorCriticalLaneIds.length === 0
          ? "unknown"
          : targetSlot.floorCriticalLaneIdsMissing.length === 0
            ? "pass"
            : "fail",
      measured: targetSlot.floorCriticalLaneIds.length > 0,
      ownerSeam: "candidate_evaluator",
      evidence: [
        `floorCriticalLaneCount:${targetSlot.floorCriticalLaneIds.length}`,
        `floorCriticalMaterialized:${targetSlot.floorCriticalLaneIdsMaterialized.length}`,
      ],
      regressions: targetSlot.floorCriticalLaneIdsMissing.map(
        (laneId) => `floor_critical_lane_missing:${laneId}`,
      ),
      requiredNextEvidence:
        targetSlot.floorCriticalLaneIds.length === 0
          ? ["capacity_floor_critical_lane_basis"]
          : [],
    },
    {
      gateId: "over_mav",
      status: input.candidateImpact.totalSetDelta === 0 ? "pass" : "unknown",
      measured: input.candidateImpact.totalSetDelta === 0,
      ownerSeam: "candidate_evaluator",
      evidence: [`totalSetDelta:${input.candidateImpact.totalSetDelta}`],
      regressions: [],
      requiredNextEvidence:
        input.candidateImpact.totalSetDelta === 0
          ? []
          : ["weekly_muscle_volume_delta_and_mav_check"],
    },
    {
      gateId: "session_size",
      status: sessionSizeRegressions.length > 0 ? "fail" : "pass",
      measured: true,
      ownerSeam: "selection_capacity_plan",
      evidence: [
        `exerciseCount:${targetSlot.trialExerciseCount}/${targetSlot.maxExerciseCountAfter ?? "unknown"}`,
        `setCount:${targetSlot.trialSetCount}`,
      ],
      regressions: sessionSizeRegressions,
      requiredNextEvidence: [],
    },
    {
      gateId: "five_set_stacking",
      status: setStacking.length > 0 ? "fail" : "pass",
      measured: true,
      ownerSeam: "set_distribution_intent",
      evidence: [`fiveSetStackCount:${setStacking.length}`],
      regressions: setStacking.map((entry) => `five_set_stack:${entry}`),
      requiredNextEvidence: [],
    },
    {
      gateId: "lane_survival",
      status: targetSlot.removedIdentities.length > 0 ? "fail" : "pass",
      measured: true,
      ownerSeam: "materializer_exercise_selection_capacity",
      evidence: [
        `added:${targetSlot.addedIdentities.length}`,
        `removed:${targetSlot.removedIdentities.length}`,
      ],
      regressions: targetSlot.removedIdentities.map(
        (identity) => `removed_identity:${identity}`,
      ),
      requiredNextEvidence: [],
    },
    {
      gateId: "duplicates",
      status: duplicateIds.length > 0 ? "fail" : "pass",
      measured: true,
      ownerSeam: "exercise_selection_plan",
      evidence: [`duplicateExerciseIdWithinTargetSlot:${duplicateIds.length}`],
      regressions: duplicateIds.map((id) => `duplicate_exercise_id:${id}`),
      requiredNextEvidence: [],
    },
    {
      gateId: "materializer_validity",
      status:
        input.trialReport.materializer.status === "materialized" &&
        input.trialReport.seedShapeCompatibility.compatible
          ? "pass"
          : "fail",
      measured: true,
      ownerSeam: "v2_materialization_dry_run",
      evidence: [
        `materializerStatus:${input.trialReport.materializer.status}`,
        `seedShapeCompatible:${input.trialReport.seedShapeCompatibility.compatible}`,
        `blockerCount:${input.trialReport.materializer.blockerCount}`,
      ],
      regressions:
        input.trialReport.materializer.status === "materialized" &&
        input.trialReport.seedShapeCompatibility.compatible
          ? []
          : ["trial_materializer_invalid_or_seed_shape_incompatible"],
      requiredNextEvidence: [],
    },
    {
      gateId: "acceptance_result",
      status: "unknown",
      measured: false,
      ownerSeam: "next_mesocycle_acceptance_gate",
      evidence: ["acceptance_gate:not_rerun"],
      regressions: [],
      requiredNextEvidence: [
        "candidate_evaluator_projection",
        "read_only_acceptance_gate_result_for_projected_candidate",
      ],
    },
  ];
}

function normalizePlanningRealityForBasePlanCompare(input: {
  planId: V2BasePlanComparePlanView["planId"];
  planningReality?: SlotPlanPlanningRealityDiagnostic | null;
  taxonomy: V2ExerciseClassTaxonomy;
  includeRepairEvidence?: boolean;
}): V2BasePlanComparePlanView {
  const planningReality = input.planningReality;
  return {
    planId: input.planId,
    available: Boolean(planningReality?.finalSlotPlan.length),
    source: "planning_reality_final_slot_plan",
    slots:
      planningReality?.finalSlotPlan.map((slot) => ({
        slotId: slot.slotId,
        intent: slot.intent,
        exercises: slot.exercises.map((exercise) => {
          const materializationExercise =
            planningRealityExerciseToMaterializationExercise(exercise);
          return {
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.exerciseName,
            setCount: exercise.setCount,
            role: exercise.role,
            classIds: matchV2ExerciseClasses(
              materializationExercise,
              input.taxonomy,
            ).map((match) => match.classId),
            primaryMuscles: exercise.primaryMuscles,
            movementPatterns: exercise.movementPatterns,
            effectiveStimulusByMuscle: exercise.effectiveStimulusByMuscle,
          };
        }),
      })) ?? [],
    ...(input.includeRepairEvidence && planningReality
      ? {
          repairEvidence: planningReality.repairMaterialityAfterShadowAllocation.map(
            (row) => ({
              repairMechanism: row.repairMechanism,
              action: row.action,
              materiality: row.materiality,
              slotId: row.slotId,
              muscle: row.muscle,
              exerciseName: row.exerciseName,
              changedExerciseIdentity: row.changedExerciseIdentity,
              changedSlotShapeMaterially: row.changedSlotShapeMaterially,
              evidence: [
                row.rationale,
                `shadowAllocationBasis:${row.shadowAllocationBasis}`,
                ...row.shadowRationale,
              ],
            }),
          ),
        }
      : {}),
  };
}

function materializedExerciseIds(
  plan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null,
): Set<string> {
  return new Set(
    (plan?.slots ?? []).flatMap((slot) =>
      slot.exercises.map((exercise) => exercise.exerciseId),
    ),
  );
}

function sumMaterializedPlanSets(
  plan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null,
): number {
  return (plan?.slots ?? []).reduce(
    (sum, slot) => sum + sumMaterializedSlotSets(slot),
    0,
  );
}

function sumMaterializedSlotSets(
  slot:
    | ReturnType<typeof buildV2ExerciseMaterializationPlan>["slots"][number]
    | undefined,
): number {
  return (slot?.exercises ?? []).reduce(
    (sum, exercise) => sum + exercise.setCount,
    0,
  );
}

function exerciseNamesForIds(input: {
  exerciseIds: string[];
  inventory: ReadonlyArray<V2MaterializationExercise>;
}): string[] {
  const nameById = new Map(
    input.inventory.map((exercise) => [exercise.exerciseId, exercise.name]),
  );
  return input.exerciseIds
    .map((id) => nameById.get(id) ?? id)
    .sort((left, right) => left.localeCompare(right));
}

function duplicateExerciseIds(
  slot:
    | ReturnType<typeof buildV2ExerciseMaterializationPlan>["slots"][number]
    | undefined,
): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const exercise of slot?.exercises ?? []) {
    if (seen.has(exercise.exerciseId)) {
      duplicated.add(exercise.exerciseId);
    }
    seen.add(exercise.exerciseId);
  }
  return [...duplicated].sort((left, right) => left.localeCompare(right));
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function planningRealityExerciseToMaterializationExercise(
  exercise: SlotPlanPlanningRealityDiagnostic["finalSlotPlan"][number]["exercises"][number],
): V2MaterializationExercise {
  return {
    exerciseId: exercise.exerciseId,
    name: exercise.exerciseName,
    aliases: [],
    movementPatterns: exercise.movementPatterns,
    primaryMuscles: exercise.primaryMuscles,
    secondaryMuscles: [],
    equipment: [],
    isCompound: exercise.role === "main",
    isMainLiftEligible: exercise.role === "main",
    fatigueCost: 1,
    stimulusByMusclePerSet: Object.fromEntries(
      Object.entries(exercise.effectiveStimulusByMuscle).map(
        ([muscle, stimulus]) => [
          muscle,
          exercise.setCount > 0 ? stimulus / exercise.setCount : 0,
        ],
      ),
    ),
  };
}
