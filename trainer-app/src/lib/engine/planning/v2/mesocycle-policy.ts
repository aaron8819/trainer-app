import { buildV2DeloadTransformPolicy } from "./deload-transform";
import { buildV2TargetSkeleton } from "./target-skeleton";
import type { V2PlannerMesocyclePolicy } from "./types";
import { buildV2WeeklyProgressionModel } from "./weekly-progression";

export function buildV2PlannerMesocyclePolicy(): V2PlannerMesocyclePolicy {
  return {
    targetSkeleton: buildV2TargetSkeleton(),
    weeklyProgressionModel: buildV2WeeklyProgressionModel(),
    deloadTransform: buildV2DeloadTransformPolicy(),
  };
}
