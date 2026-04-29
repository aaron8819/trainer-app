import { prisma } from "@/lib/db/prisma";
import {
  buildV2ExerciseMaterializationPlan,
  buildV2MaterializationDryRunReport,
  buildV2PlannerMesocyclePolicy,
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  type V2ExerciseClassTaxonomy,
  type V2ExerciseMaterializationInput,
  type V2ExerciseMaterializationPlan,
  type V2ExerciseSelectionPlan,
  type V2MaterializationDryRunReport,
  type V2MaterializationExercise,
  type V2PlannerMesocyclePolicy,
} from "@/lib/engine/planning/v2";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { resolveMesocycleSlotContract } from "@/lib/api/mesocycle-slot-contract";

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

type LiveInventoryExerciseRow = {
  id: string;
  name: string;
  aliases?: Array<{ alias: string }>;
  movementPatterns?: readonly string[] | null;
  isCompound?: boolean | null;
  isMainLiftEligible?: boolean | null;
  fatigueCost?: number | null;
  exerciseEquipment?: Array<{ equipment: { type: string } }>;
  exerciseMuscles?: Array<{ role: string; muscle: { name: string } }>;
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

const EMPTY_CONSTRAINTS: V2ExerciseMaterializationInput["constraints"] = {
  avoidExerciseIds: [],
  favoriteExerciseIds: [],
  painConflictExerciseIds: [],
};

export function normalizeLiveInventoryForV2Materialization(
  exercises: LiveInventoryExerciseRow[],
): V2MaterializationExercise[] {
  return exercises.map((exercise) => {
    const primaryMuscles = musclesByRole(exercise, "PRIMARY");
    const secondaryMuscles = musclesByRole(exercise, "SECONDARY");
    const aliases = (exercise.aliases ?? []).map((alias) => alias.alias);
    const stimulusByMusclePerSet = Object.fromEntries(
      getEffectiveStimulusByMuscle(
        {
          id: exercise.id,
          name: exercise.name,
          aliases,
          primaryMuscles,
          secondaryMuscles,
        },
        1,
        { logFallback: false },
      ),
    );

    return {
      exerciseId: exercise.id,
      name: exercise.name,
      aliases,
      movementPatterns: [...(exercise.movementPatterns ?? [])].map((pattern) =>
        pattern.toLowerCase(),
      ),
      primaryMuscles,
      secondaryMuscles,
      equipment: (exercise.exerciseEquipment ?? []).map((entry) =>
        entry.equipment.type.toLowerCase(),
      ),
      isCompound: exercise.isCompound ?? false,
      isMainLiftEligible: exercise.isMainLiftEligible ?? false,
      fatigueCost: exercise.fatigueCost ?? undefined,
      stimulusByMusclePerSet,
    };
  });
}

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
    requiredLaneCoverageBySlot: summarizeRequiredLaneCoverage({
      exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
      materializedPlan,
      dryRunReport,
    }),
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

function musclesByRole(
  exercise: Pick<LiveInventoryExerciseRow, "exerciseMuscles">,
  role: "PRIMARY" | "SECONDARY",
): string[] {
  return (exercise.exerciseMuscles ?? [])
    .filter((entry) => entry.role === role)
    .map((entry) => entry.muscle.name)
    .sort((left, right) => left.localeCompare(right));
}

function summarizeRequiredLaneCoverage(input: {
  exerciseSelectionPlan: V2ExerciseSelectionPlan;
  materializedPlan: V2ExerciseMaterializationPlan | null;
  dryRunReport: V2MaterializationDryRunReport;
}): V2LiveContextMaterializationDryRunResult["requiredLaneCoverageBySlot"] {
  const blockers = new Set(
    input.dryRunReport.blockers.map((blocker) =>
      blocker.slotId && blocker.laneId ? `${blocker.slotId}:${blocker.laneId}` : "",
    ),
  );
  const materialized = new Set(
    (input.materializedPlan?.slots ?? []).flatMap((slot) =>
      slot.exercises.flatMap((exercise) =>
        exercise.laneIds.map((laneId) => `${slot.slotId}:${laneId}`),
      ),
    ),
  );
  const seenSlots = new Set<string>();

  return input.exerciseSelectionPlan.weeks.flatMap((week) =>
    week.slots.flatMap((slot) => {
      if (seenSlots.has(slot.slotId)) {
        return [];
      }
      seenSlots.add(slot.slotId);
      const requiredLaneIds = slot.lanes
        .filter((lane) => lane.requirement === "required")
        .map((lane) => lane.laneId);
      const materializedRequiredLaneIds = requiredLaneIds.filter((laneId) =>
        materialized.has(`${slot.slotId}:${laneId}`),
      );
      const blockedRequiredLaneIds = requiredLaneIds.filter((laneId) =>
        blockers.has(`${slot.slotId}:${laneId}`),
      );

      return [
        {
          slotId: slot.slotId,
          requiredLaneCount: requiredLaneIds.length,
          materializedRequiredLaneCount: materializedRequiredLaneIds.length,
          blockedRequiredLaneCount: blockedRequiredLaneIds.length,
          missingRequiredLaneIds: requiredLaneIds.filter(
            (laneId) => !materialized.has(`${slot.slotId}:${laneId}`),
          ),
        },
      ];
    }),
  );
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
