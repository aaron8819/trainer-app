import {
  VOLUME_LANDMARKS,
  getMuscleTargetSemantics,
} from "@/lib/engine/volume-landmarks";
import type {
  V2MesocycleDemand,
  V2PlannerDemandTargetMode,
  V2PlannerDemandRole,
  V2PlannerDirectnessPolicy,
  V2PlannerSetRange,
  V2PlannerTargetStatus,
  V2TargetSkeleton,
} from "./types";

export type V2MesocycleDemandInput = {
  targetSkeleton: V2TargetSkeleton;
};

export const V2_POLICY_GUARDRAILS: V2MesocycleDemand["guardrails"] = {
  doesNotUsePlanningReality: true,
  doesNotUseNoRepairOutput: true,
  doesNotUseRepairedProjection: true,
  doesNotUseAcceptedSeed: true,
  doesNotUseRuntimeReplay: true,
};

type V2BalancedBlockMusclePolicy = {
  muscle: string;
  role: V2PlannerDemandRole;
  targetStatus: V2PlannerTargetStatus;
  targetMode: V2PlannerDemandTargetMode;
  baselineSetRange: V2PlannerSetRange;
  exposureCount: number;
  directness: V2PlannerDirectnessPolicy;
  cautions: string[];
};

const V2_BALANCED_BLOCK_DEMAND_POLICY: V2BalancedBlockMusclePolicy[] = [
  {
    muscle: "Chest",
    role: "primary",
    targetStatus: "hard",
    targetMode: "default",
    baselineSetRange: { min: 7, preferred: 8, max: 10 },
    exposureCount: 2,
    directness: {
      directSetFloor: 6,
      preferredDirectSets: 7,
      collateralCreditLimit: 1,
      collateralCanSatisfyFloor: false,
      requiredClassIntents: [
        "horizontal_press_or_slight_incline",
        "distinct_second_chest_press_or_fly",
      ],
    },
    cautions: ["avoid_duplicate_chest_press_class_by_default"],
  },
  {
    muscle: "Lats",
    role: "primary",
    targetStatus: "hard",
    targetMode: "default",
    baselineSetRange: { min: 7, preferred: 9, max: 12 },
    exposureCount: 2,
    directness: {
      directSetFloor: 6,
      preferredDirectSets: 8,
      collateralCreditLimit: 2,
      collateralCanSatisfyFloor: false,
      requiredClassIntents: ["vertical_pull", "row_support"],
    },
    cautions: ["balance_vertical_pull_and_row_work"],
  },
  {
    muscle: "Upper Back",
    role: "primary",
    targetStatus: "hard",
    targetMode: "default",
    baselineSetRange: { min: 5, preferred: 7, max: 10 },
    exposureCount: 2,
    directness: {
      directSetFloor: 4,
      preferredDirectSets: 6,
      collateralCreditLimit: 2,
      collateralCanSatisfyFloor: false,
      requiredClassIntents: ["row_anchor", "horizontal_pull_support"],
    },
    cautions: ["avoid_turning_back_balance_into_extra_pull_volume"],
  },
  {
    muscle: "Quads",
    role: "primary",
    targetStatus: "hard",
    targetMode: "default",
    baselineSetRange: { min: 7, preferred: 9, max: 12 },
    exposureCount: 2,
    directness: {
      directSetFloor: 6,
      preferredDirectSets: 8,
      collateralCreditLimit: 1,
      collateralCanSatisfyFloor: false,
      requiredClassIntents: [
        "squat_or_leg_press_anchor",
        "quad_isolation_or_support",
      ],
    },
    cautions: ["lower_b_quad_support_must_not_become_second_squat_day"],
  },
  {
    muscle: "Hamstrings",
    role: "primary",
    targetStatus: "hard",
    targetMode: "default",
    baselineSetRange: { min: 6, preferred: 8, max: 9 },
    exposureCount: 3,
    directness: {
      directSetFloor: 8,
      preferredDirectSets: 8,
      collateralCreditLimit: 2,
      collateralCanSatisfyFloor: false,
      requiredClassIntents: ["hinge_compound", "knee_flexion_curl"],
    },
    cautions: [
      "hinge_and_curl_lanes_do_not_sum_into_separate_full_targets",
      "limit_lower_back_collateral_from_hinge_work",
    ],
  },
  {
    muscle: "Side Delts",
    role: "support",
    targetStatus: "soft",
    targetMode: "default",
    baselineSetRange: { min: 4, preferred: 6, max: 8 },
    exposureCount: 2,
    directness: {
      directSetFloor: 4,
      preferredDirectSets: 6,
      collateralCreditLimit: 2,
      collateralCanSatisfyFloor: false,
      requiredClassIntents: ["lateral_raise", "low_collateral_side_delt"],
    },
    cautions: ["vertical_press_collateral_does_not_satisfy_direct_floor"],
  },
  {
    muscle: "Rear Delts",
    role: "support",
    targetStatus: "soft",
    targetMode: "default",
    baselineSetRange: { min: 2, preferred: 2, max: 5 },
    exposureCount: 1,
    directness: {
      directSetFloor: 2,
      preferredDirectSets: 2,
      collateralCreditLimit: 2,
      collateralCanSatisfyFloor: false,
      requiredClassIntents: ["rear_delt_isolation"],
    },
    cautions: ["upper_back_collateral_does_not_replace_rear_delt_direct_work"],
  },
  {
    muscle: "Biceps",
    role: "support",
    targetStatus: "soft",
    targetMode: "default",
    baselineSetRange: { min: 3, preferred: 4, max: 6 },
    exposureCount: 1,
    directness: {
      directSetFloor: 2,
      preferredDirectSets: 3,
      collateralCreditLimit: 2,
      collateralCanSatisfyFloor: false,
      requiredClassIntents: ["biceps_isolation"],
    },
    cautions: ["pulling_collateral_does_not_replace_direct_arm_floor"],
  },
  {
    muscle: "Triceps",
    role: "support",
    targetStatus: "soft",
    targetMode: "default",
    baselineSetRange: { min: 3, preferred: 4, max: 6 },
    exposureCount: 1,
    directness: {
      directSetFloor: 2,
      preferredDirectSets: 3,
      collateralCreditLimit: 2,
      collateralCanSatisfyFloor: false,
      requiredClassIntents: ["triceps_isolation", "pressdown"],
    },
    cautions: ["optional_second_triceps_lane_activates_only_if_under_floor"],
  },
  {
    muscle: "Calves",
    role: "support",
    targetStatus: "soft",
    targetMode: "default",
    baselineSetRange: { min: 6, preferred: 8, max: 10 },
    exposureCount: 2,
    directness: {
      directSetFloor: 6,
      preferredDirectSets: 8,
      collateralCreditLimit: 0,
      collateralCanSatisfyFloor: false,
      requiredClassIntents: ["calf_isolation"],
    },
    cautions: ["avoid_same_session_calf_duplicate_without_specialization"],
  },
  {
    muscle: "Glutes",
    role: "implicit",
    targetStatus: "diagnostic",
    targetMode: "managed_collateral",
    baselineSetRange: { min: 0, preferred: 2, max: 4 },
    exposureCount: 0,
    directness: {
      directSetFloor: 0,
      preferredDirectSets: 0,
      collateralCreditLimit: 4,
      collateralCanSatisfyFloor: true,
      requiredClassIntents: [],
    },
    cautions: ["manage_hip_extension_collateral_without_target_runaway"],
  },
  {
    muscle: "Front Delts",
    role: "implicit",
    targetStatus: "diagnostic",
    targetMode: "managed_collateral",
    baselineSetRange: { min: 0, preferred: 1, max: 3 },
    exposureCount: 0,
    directness: {
      directSetFloor: 0,
      preferredDirectSets: 0,
      collateralCreditLimit: 3,
      collateralCanSatisfyFloor: true,
      requiredClassIntents: [],
    },
    cautions: ["manage_pressing_collateral_without_primary_target_status"],
  },
  {
    muscle: "Lower Back",
    role: "implicit",
    targetStatus: "diagnostic",
    targetMode: "managed_collateral",
    baselineSetRange: { min: 0, preferred: 0, max: 2 },
    exposureCount: 0,
    directness: {
      directSetFloor: 0,
      preferredDirectSets: 0,
      collateralCreditLimit: 2,
      collateralCanSatisfyFloor: true,
      requiredClassIntents: [],
    },
    cautions: ["cap_axial_fatigue_from_hinge_and_squat_patterns"],
  },
  {
    muscle: "Core",
    role: "secondary",
    targetStatus: "diagnostic",
    targetMode: "maintenance",
    baselineSetRange: { min: 0, preferred: 0, max: 2 },
    exposureCount: 0,
    directness: {
      directSetFloor: 0,
      preferredDirectSets: 0,
      collateralCreditLimit: 2,
      collateralCanSatisfyFloor: true,
      requiredClassIntents: [],
    },
    cautions: ["optional_core_work_is_not_base_hypertrophy_demand"],
  },
];

function rolePriority(role: V2PlannerDemandRole): number {
  if (role === "primary") {
    return 0;
  }
  if (role === "support") {
    return 1;
  }
  if (role === "secondary") {
    return 2;
  }
  return 3;
}

type V2SkeletonMuscleEvidence = {
  slots: Set<string>;
  lanes: Set<string>;
  optionalLaneCount: number;
  requiredLaneCount: number;
};

function buildSkeletonEvidence(
  targetSkeleton: V2TargetSkeleton,
): Map<string, V2SkeletonMuscleEvidence> {
  const evidence = new Map<string, V2SkeletonMuscleEvidence>();
  for (const slot of targetSkeleton.slots) {
    for (const lane of slot.lanes) {
      for (const muscle of lane.primaryMuscles) {
        const existing =
          evidence.get(muscle) ??
          {
            slots: new Set<string>(),
            lanes: new Set<string>(),
            optionalLaneCount: 0,
            requiredLaneCount: 0,
          };
        existing.slots.add(slot.slotId);
        existing.lanes.add(lane.laneId);
        if (lane.required) {
          existing.requiredLaneCount += 1;
        } else {
          existing.optionalLaneCount += 1;
        }
        evidence.set(muscle, existing);
      }
    }
  }
  return evidence;
}

export function buildV2MesocycleDemand(
  input: V2MesocycleDemandInput,
): V2MesocycleDemand {
  const skeletonEvidence = buildSkeletonEvidence(input.targetSkeleton);

  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    split: input.targetSkeleton.split,
    weekCount: input.targetSkeleton.weeks,
    designBasis: {
      targetSkeleton: "upper_lower_4x_v2",
      evidencePolicy: "balanced_static_block_policy_and_volume_landmarks",
      allocationTiming: "before_exercise_selection",
      demandTiming: "before_slot_allocation",
    },
    muscles: V2_BALANCED_BLOCK_DEMAND_POLICY.map((policy) => {
      const semantics = getMuscleTargetSemantics(policy.muscle);
      const landmarks = VOLUME_LANDMARKS[policy.muscle] ?? null;
      const evidence = skeletonEvidence.get(policy.muscle);
      const source = new Set<string>([
        "balanced_static_block_target_policy",
        "volume_landmarks",
        "muscle_target_tiers",
        ...(evidence ? ["v2_target_skeleton_exposure_map"] : []),
        ...(evidence
          ? Array.from(evidence.slots).map((slotId) => `slot:${slotId}`)
          : []),
        ...(evidence
          ? Array.from(evidence.lanes).map((laneId) => `lane:${laneId}`)
          : []),
      ]);
      const limitations = new Set<string>();
      if (!landmarks) {
        limitations.add("volume_landmark_missing");
      }
      if (!evidence) {
        limitations.add("no_target_skeleton_lane_managed_by_policy");
      }
      if (evidence && evidence.optionalLaneCount > 0) {
        limitations.add("optional_lanes_do_not_increase_base_demand");
      }
      if (evidence && evidence.lanes.size !== policy.exposureCount) {
        limitations.add("skeleton_lane_count_not_used_as_demand_count");
      }
      if (policy.targetMode === "managed_collateral") {
        limitations.add("managed_collateral_not_primary_target_demand");
      }
      return {
        muscle: policy.muscle,
        targetTier: semantics.targetTier,
        role: policy.role,
        targetStatus: policy.targetStatus,
        targetMode: policy.targetMode,
        landmark: landmarks
          ? {
              mv: landmarks.mv,
              mev: landmarks.mev,
              mav: landmarks.mav,
              mrv: landmarks.mrv,
            }
          : null,
        baselineSetRange: { ...policy.baselineSetRange },
        exposureCount: policy.exposureCount,
        directness: {
          ...policy.directness,
          requiredClassIntents: [...policy.directness.requiredClassIntents],
        },
        cautions: [...policy.cautions],
        source: Array.from(source).sort((left, right) =>
          left.localeCompare(right),
        ),
        limitations: Array.from(limitations).sort((left, right) =>
          left.localeCompare(right),
        ),
      };
    })
      .sort(
        (left, right) =>
          rolePriority(left.role) - rolePriority(right.role) ||
          left.muscle.localeCompare(right.muscle),
      ),
    guardrails: V2_POLICY_GUARDRAILS,
  };
}
