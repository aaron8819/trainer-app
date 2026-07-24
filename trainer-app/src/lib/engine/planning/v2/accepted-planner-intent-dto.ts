import { buildV2PlannerMesocyclePolicy } from "./mesocycle-policy";
import type {
  V2AuthoredSetBudgetRange,
  V2PlannerDemandRole,
  V2PlannerLaneRole,
  V2PlannerMesocyclePolicy,
  V2PlannerPhase,
  V2PlannerSetRange,
  V2PlannerSlotId,
  V2PlannerSplit,
  V2WeeklyDemandRange,
} from "./types";

type MuscleTargetTier =
  V2PlannerMesocyclePolicy["mesocycleDemand"]["muscles"][number]["targetTier"];

type SetBudgetBasis =
  V2PlannerMesocyclePolicy["v2SetDistributionIntent"]["weeks"][number]["slots"][number]["lanes"][number]["setBudget"]["basis"];

type ConcentrationPolicy = {
  warningShare: number;
  blockerShare: number;
  appliesTo: "primary_target" | "support_target" | "optional_lane";
};

type PerExerciseCap =
  V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number]["perExerciseCap"];

type DuplicatePolicy =
  V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number]["duplicatePolicy"];

type CleanAlternativePolicy =
  V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number]["cleanAlternativePolicy"];

type ContinuityPolicy =
  V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number]["continuityPolicy"];

type OptionalActivationPolicy =
  V2PlannerMesocyclePolicy["selectionCapacityPlan"]["weeks"][number]["slots"][number]["lanes"][number]["optionalActivation"];

export type V2AcceptedPlannerIntentDto = {
  version: 1;
  source: "v2_planner_policy";
  targetSkeletonId: "upper_lower_4x_v2";
  split: V2PlannerSplit;
  weekCount: number;
  slotSequence: Array<{
    slotIndex: number;
    slotId: V2PlannerSlotId;
  }>;
  phases: Array<{
    week: number;
    phase: V2PlannerPhase;
    volumeMultiplier: number | null;
    rirTarget: string;
  }>;
  muscleTargets: Array<{
    muscle: string;
    targetTier: MuscleTargetTier;
    role: V2PlannerDemandRole;
    setRange: V2WeeklyDemandRange;
    exposureCount: number;
  }>;
  weekPolicies: Array<{
    week: number;
    phase: V2PlannerPhase;
    volumeMultiplier: number;
    rirTarget: string;
    slots: Array<{
      slotIndex: number;
      slotId: V2PlannerSlotId;
      intent: string;
      targetSessionSets: V2PlannerSetRange;
      maxExerciseCount: number;
      lanes: Array<{
        laneId: string;
        targetLaneId?: string;
        role: V2PlannerLaneRole;
        requirement: "required" | "conditional_optional" | "optional";
        primaryMuscles: string[];
        acceptableExerciseClasses: string[];
        preferredExerciseClasses: string[];
        setBudget: V2AuthoredSetBudgetRange & {
          basis: SetBudgetBasis | "capacity_policy";
        };
        supportDirectFloor?: {
          muscle: string;
          minDirectSets: number;
          requiredExerciseClasses: string[];
          collateralCanSatisfy: false;
        };
        collateralCreditLimit?: {
          maxWeeklyEffectiveSetsCreditable: number;
          collateralExerciseClasses: string[];
          creditAppliesToWeeklyTotalOnly: true;
        };
        perExerciseCap: PerExerciseCap;
        concentrationPolicy: ConcentrationPolicy;
        duplicatePolicy: DuplicatePolicy;
        cleanAlternativePolicy: CleanAlternativePolicy;
        optionalActivationPolicy: OptionalActivationPolicy;
        continuityPolicy: ContinuityPolicy;
      }>;
    }>;
  }>;
  deloadTransform: {
    preservePlannedMovements: boolean;
    targetVolumeReductionPercent: {
      min: number;
      max: number;
    };
    targetRir: string;
    removeRedundantAccessories: boolean;
    introduceNewMovements: false;
  };
};

type SetDistributionLane =
  V2PlannerMesocyclePolicy["v2SetDistributionIntent"]["weeks"][number]["slots"][number]["lanes"][number];

type CapacityLane =
  V2PlannerMesocyclePolicy["selectionCapacityPlan"]["weeks"][number]["slots"][number]["lanes"][number];

type SupportLane =
  V2PlannerMesocyclePolicy["v2SupportLanePolicy"]["supportLanes"][number];

function setRange(range: V2PlannerSetRange): V2PlannerSetRange {
  return {
    min: range.min,
    preferred: range.preferred,
    max: range.max,
  };
}

function laneKey(slotId: V2PlannerSlotId, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function buildSetDistributionLaneIndex(
  policy: V2PlannerMesocyclePolicy,
): Map<string, SetDistributionLane> {
  const index = new Map<string, SetDistributionLane>();
  for (const week of policy.v2SetDistributionIntent.weeks) {
    for (const slot of week.slots) {
      for (const lane of slot.lanes) {
        index.set(`${week.week}:${laneKey(slot.slotId, lane.laneId)}`, lane);
      }
    }
  }
  return index;
}

function buildCapacityLaneIndex(
  policy: V2PlannerMesocyclePolicy,
): Map<string, CapacityLane> {
  const index = new Map<string, CapacityLane>();
  for (const week of policy.selectionCapacityPlan.weeks) {
    for (const slot of week.slots) {
      for (const lane of slot.lanes) {
        index.set(`${week.week}:${laneKey(slot.slotId, lane.laneId)}`, lane);
      }
    }
  }
  return index;
}

function buildSupportLaneIndex(
  policy: V2PlannerMesocyclePolicy,
): Map<string, SupportLane> {
  const index = new Map<string, SupportLane>();
  for (const lane of policy.v2SupportLanePolicy.supportLanes) {
    index.set(laneKey(lane.owningSlotId, lane.owningLaneId), lane);
    const activation = lane.optionalActivationRule;
    if (activation.type === "conditional_under_support_floor") {
      index.set(laneKey(activation.slotId, activation.laneId), lane);
    }
  }
  return index;
}

function buildTargetLaneIndex(
  policy: V2PlannerMesocyclePolicy,
): Map<string, string | undefined> {
  const index = new Map<string, string | undefined>();
  for (const slot of policy.targetSkeleton.slots) {
    for (const lane of slot.lanes) {
      index.set(laneKey(slot.slotId, lane.laneId), lane.targetLaneId);
    }
  }
  return index;
}

export function buildV2AcceptedPlannerIntentDto(
  policy: V2PlannerMesocyclePolicy = buildV2PlannerMesocyclePolicy(),
): V2AcceptedPlannerIntentDto {
  const setLaneIndex = buildSetDistributionLaneIndex(policy);
  const capacityLaneIndex = buildCapacityLaneIndex(policy);
  const supportLaneIndex = buildSupportLaneIndex(policy);
  const targetLaneIndex = buildTargetLaneIndex(policy);

  return {
    version: 1,
    source: "v2_planner_policy",
    targetSkeletonId: "upper_lower_4x_v2",
    split: policy.targetSkeleton.split,
    weekCount: policy.targetSkeleton.weeks,
    slotSequence: policy.targetSkeleton.slotSequence.map((slotId, slotIndex) => ({
      slotIndex,
      slotId,
    })),
    phases: policy.weeklyProgressionModel.weeks.map((week) => ({
      week: week.week,
      phase: week.phase,
      volumeMultiplier: week.volumeMultiplier,
      rirTarget: week.rirTarget,
    })),
    muscleTargets: policy.mesocycleDemand.muscles.map((muscle) => ({
      muscle: muscle.muscle,
      targetTier: muscle.targetTier,
      role: muscle.role,
      setRange: setRange(muscle.baselineSetRange),
      exposureCount: muscle.exposureCount,
    })),
    weekPolicies: policy.exerciseSelectionPlan.weeks.map((week) => {
      const setIntentWeek = policy.v2SetDistributionIntent.weeks.find(
        (row) => row.week === week.week,
      );
      return {
        week: week.week,
        phase: week.phase,
        volumeMultiplier: setIntentWeek?.volumeMultiplier ?? 1,
        rirTarget:
          setIntentWeek?.rirTarget ??
          policy.weeklyProgressionModel.weeks.find((row) => row.week === week.week)
            ?.rirTarget ??
          "",
        slots: week.slots.map((slot) => ({
          slotIndex: slot.slotIndex,
          slotId: slot.slotId,
          intent:
            policy.targetSkeleton.slots.find((row) => row.slotId === slot.slotId)
              ?.intent ?? "",
          targetSessionSets: setRange(slot.targetSessionSets),
          maxExerciseCount: slot.maxExerciseCount,
          lanes: slot.lanes.map((lane) => {
            const key = laneKey(slot.slotId, lane.laneId);
            const setLane = setLaneIndex.get(`${week.week}:${key}`);
            const capacityLane = capacityLaneIndex.get(`${week.week}:${key}`);
            const supportLane = supportLaneIndex.get(key);
            return {
              laneId: lane.laneId,
              ...(targetLaneIndex.get(key)
                ? { targetLaneId: targetLaneIndex.get(key) }
                : {}),
              role: lane.role,
              requirement: lane.requirement,
              primaryMuscles: [...lane.primaryMuscles],
              acceptableExerciseClasses: [...lane.acceptableExerciseClasses],
              preferredExerciseClasses: [...lane.preferredExerciseClasses],
              setBudget: {
                ...setRange(lane.setBudget),
                basis: setLane?.setBudget.basis ?? "capacity_policy",
              },
              ...(lane.directFloor
                ? {
                    supportDirectFloor: {
                      muscle: lane.directFloor.muscle,
                      minDirectSets: lane.directFloor.minDirectSets,
                      requiredExerciseClasses: [
                        ...(supportLane?.directFloor.requiredExerciseClasses ?? []),
                      ],
                      collateralCanSatisfy: false as const,
                    },
                  }
                : {}),
              ...(supportLane
                ? {
                    collateralCreditLimit: {
                      maxWeeklyEffectiveSetsCreditable:
                        supportLane.collateralCreditLimit
                          .maxWeeklyEffectiveSetsCreditable,
                      collateralExerciseClasses: [
                        ...supportLane.collateralCreditLimit.collateralSources,
                      ],
                      creditAppliesToWeeklyTotalOnly: true as const,
                    },
                  }
                : {}),
              perExerciseCap: { ...lane.perExerciseCap },
              concentrationPolicy: {
                warningShare: setLane?.concentrationPolicy.warningShare ?? 0.5,
                blockerShare: setLane?.concentrationPolicy.blockerShare ?? 0.6,
                appliesTo:
                  setLane?.concentrationPolicy.appliesTo === "diagnostic_only"
                    ? "optional_lane"
                    : (setLane?.concentrationPolicy.appliesTo ??
                      (lane.role === "anchor"
                        ? "primary_target"
                        : lane.role === "optional"
                          ? "optional_lane"
                          : "support_target")),
              },
              duplicatePolicy: { ...lane.duplicatePolicy },
              cleanAlternativePolicy: { ...lane.cleanAlternativePolicy },
              optionalActivationPolicy: capacityLane
                ? { ...capacityLane.optionalActivation }
                : { type: "not_applicable" as const },
              continuityPolicy: { ...lane.continuityPolicy },
            };
          }),
        })),
      };
    }),
    deloadTransform: {
      preservePlannedMovements: policy.deloadTransform.preserveExerciseIdentities,
      targetVolumeReductionPercent: {
        min: policy.deloadTransform.targetVolumeReductionPercent.min,
        max: policy.deloadTransform.targetVolumeReductionPercent.max,
      },
      targetRir: policy.deloadTransform.targetRir,
      removeRedundantAccessories: policy.deloadTransform.removeRedundantAccessories,
      introduceNewMovements: policy.deloadTransform.introduceNewMovements,
    },
  };
}
