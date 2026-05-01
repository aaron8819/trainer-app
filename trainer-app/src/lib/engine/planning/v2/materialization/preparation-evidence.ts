import { buildV2BasePlanValidation } from "./base-plan-validation";
import { buildV2ExerciseMaterializationPlan } from "./materializer";
import type {
  V2BasePlanValidation,
} from "./base-plan-validation";
import type {
  V2ExerciseClassTaxonomy,
  V2ExerciseMaterializationInput,
  V2ExerciseMaterializationPlan,
  V2MaterializationExercise,
} from "./types";
import type {
  V2ExerciseSelectionPlan,
  V2PlannerMesocyclePolicy,
} from "../types";

export type V2MaterializationPreparationEvidence = {
  plannerPolicy: V2PlannerMesocyclePolicy;
  exerciseSelectionPlan: V2ExerciseSelectionPlan;
  taxonomy: V2ExerciseClassTaxonomy;
  inventory: V2MaterializationExercise[];
  constraints: V2ExerciseMaterializationInput["constraints"];
  materializedPlan: V2ExerciseMaterializationPlan | null;
  basePlanValidation: V2BasePlanValidation;
  liveNormalizedInventoryAvailable: boolean;
};

export function buildV2MaterializationPreparationEvidence(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  taxonomy: V2ExerciseClassTaxonomy;
  inventory: V2MaterializationExercise[];
  constraints?: V2ExerciseMaterializationInput["constraints"];
}): V2MaterializationPreparationEvidence {
  const constraints = input.constraints ?? {
    avoidExerciseIds: [],
    favoriteExerciseIds: [],
    painConflictExerciseIds: [],
  };
  const materializedPlan =
    input.inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: input.plannerPolicy.exerciseSelectionPlan,
          inventory: input.inventory,
          taxonomy: input.taxonomy,
          constraints,
        })
      : null;
  const basePlanValidation = buildV2BasePlanValidation({
    plannerPolicy: input.plannerPolicy,
    materializedPlan,
    inventory: input.inventory,
    taxonomy: input.taxonomy,
  });

  return {
    plannerPolicy: input.plannerPolicy,
    exerciseSelectionPlan: input.plannerPolicy.exerciseSelectionPlan,
    taxonomy: input.taxonomy,
    inventory: input.inventory,
    constraints,
    materializedPlan,
    basePlanValidation,
    liveNormalizedInventoryAvailable: input.inventory.length > 0,
  };
}
