import {
  buildV2MaterializationDryRunReport,
  buildV2MaterializationPromotionReadiness,
  type V2ExerciseMaterializationInput,
  type V2ExerciseMaterializationPlan,
  type V2ExerciseSelectionPlan,
  type V2ExerciseClassTaxonomy,
  type V2MaterializationDryRunReport,
  type V2MaterializationExercise,
  type V2MaterializationProductionWriteGates,
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

export type BuildV2MaterializedSeedForAcceptanceResult =
  | {
      status: "disabled";
    }
  | {
      status: "blocked";
      reason: string;
      blockers: BuildV2MaterializedSeedForAcceptanceBlocker[];
    }
  | {
      status: "ready";
      slotPlanSeedJson: MesocycleSlotPlanSeed;
      provenance: {
        source: "v2_materialized_seed";
        dryRunReportVersion: number;
        promotionReadinessVersion: number;
      };
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
  dependencies?: V2MaterializedSeedAcceptanceDependencies;
};

export function buildV2MaterializedSeedForAcceptance(
  input: BuildV2MaterializedSeedForAcceptanceInput,
): BuildV2MaterializedSeedForAcceptanceResult {
  if (input.enableV2MaterializedSeedWrite !== true) {
    return { status: "disabled" };
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
    return blockedFromReadiness(promotionReadiness);
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
    }),
    provenance: {
      source: "v2_materialized_seed",
      dryRunReportVersion: dryRunReport.version,
      promotionReadinessVersion: promotionReadiness.version,
    },
  };
}

function blockedFromReadiness(
  readiness: V2MaterializationPromotionReadiness,
): Extract<BuildV2MaterializedSeedForAcceptanceResult, { status: "blocked" }> {
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
  };
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
    },
  };
}
