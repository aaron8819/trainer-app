import { buildV2DeloadTransformPolicy } from "./deload-transform";
import { buildV2ExerciseClassDistributionBySlot } from "./exercise-class-distribution";
import { buildV2MesocycleDemand } from "./mesocycle-demand";
import { buildV2SetDistributionIntent } from "./set-distribution-intent";
import { buildV2SlotDemandAllocationByWeek } from "./slot-demand-allocation";
import { buildV2SupportLanePolicy } from "./support-lane-policy";
import { buildV2TargetSkeleton } from "./target-skeleton";
import type { V2PlannerMesocyclePolicy } from "./types";
import { buildV2WeeklyDemandCurve } from "./weekly-demand-curve";
import { buildV2WeeklyProgressionModel } from "./weekly-progression";

export function buildV2PlannerMesocyclePolicy(): V2PlannerMesocyclePolicy {
  const targetSkeleton = buildV2TargetSkeleton();
  const weeklyProgressionModel = buildV2WeeklyProgressionModel();
  const deloadTransform = buildV2DeloadTransformPolicy();
  const mesocycleDemand = buildV2MesocycleDemand({ targetSkeleton });
  const weeklyDemandCurve = buildV2WeeklyDemandCurve({
    mesocycleDemand,
    weeklyProgressionModel,
  });
  const slotDemandAllocationByWeek = buildV2SlotDemandAllocationByWeek({
    targetSkeleton,
    weeklyDemandCurve,
  });
  const exerciseClassDistributionBySlot = buildV2ExerciseClassDistributionBySlot({
    slotDemandAllocationByWeek,
  });
  const v2SetDistributionIntent = buildV2SetDistributionIntent({
    targetSkeleton,
    weeklyProgressionModel,
  });
  const v2SupportLanePolicy = buildV2SupportLanePolicy({ targetSkeleton });

  return {
    targetSkeleton,
    weeklyProgressionModel,
    deloadTransform,
    mesocycleDemand,
    weeklyDemandCurve,
    slotDemandAllocationByWeek,
    exerciseClassDistributionBySlot,
    v2SetDistributionIntent,
    v2SupportLanePolicy,
  };
}
