import { prisma } from "@/lib/db/prisma";
import type { WorkoutSessionIntent } from "@prisma/client";
import {
  buildV2ExerciseMaterializationPlan,
  buildV2BasePlanCompare,
  buildV2BasePlanShadowConsumptionTrial,
  buildV2BasePlanValidation,
  buildV2MaterializationDryRunReport,
  buildV2PlannerMesocyclePolicy,
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
} from "@/lib/engine/planning/v2";
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
