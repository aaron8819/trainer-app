import type { V2DeloadTransformPolicy } from "./types";

export function buildV2DeloadTransformPolicy(): V2DeloadTransformPolicy {
  return {
    preserveExerciseIdentities: true,
    targetVolumeReductionPercent: { min: 40, max: 60 },
    targetRir: "4-5",
    removeRedundantAccessories: true,
    introduceNewMovements: false,
    projectionStatus: "partially_modeled",
    limitations: [
      "transform_defined_from_target_spec",
      "not_applied_to_slotPlanSeedJson",
      "not_used_by_runtime_replay",
    ],
  };
}
