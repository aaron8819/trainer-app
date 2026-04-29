import type { MuscleTargetTier } from "@/lib/engine/volume-landmarks";
import type { V2SetDistributionIntent } from "./set-distribution-intent";
import type { V2SupportLanePolicy } from "./support-lane-policy";

export type V2PlannerSlotId = "upper_a" | "lower_a" | "upper_b" | "lower_b";

export type V2PlannerSplit = "upper_lower_4x";

export type V2PlannerPhase =
  | "entry_calibration"
  | "accumulation"
  | "hard_accumulation"
  | "peak_overreach_lite"
  | "deload";

export type V2PlannerLaneRole = "anchor" | "support" | "accessory" | "optional";

export type V2PlannerProgressionIntent =
  | "establish_anchors"
  | "productive_volume"
  | "push_stimulus"
  | "peak_effort"
  | "reduce_fatigue";

export type V2PlannerLaneDefinition = {
  laneId: string;
  targetLaneId?: string;
  required: boolean;
  role: V2PlannerLaneRole;
  primaryMuscles: string[];
  preferredExerciseClasses: string[];
  targetSets: {
    min: number;
    preferred: number;
    max: number;
  };
};

export type V2PlannerSlotDefinition = {
  slotId: V2PlannerSlotId;
  intent: string;
  targetSessionSets: {
    min: number;
    max: number;
  };
  lanes: V2PlannerLaneDefinition[];
};

export type V2TargetSkeleton = {
  split: V2PlannerSplit;
  weeks: 5;
  slotSequence: V2PlannerSlotId[];
  slots: V2PlannerSlotDefinition[];
};

export type V2WeeklyProgressionWeek = {
  week: number;
  phase: V2PlannerPhase;
  volumeMultiplier: number | null;
  rirTarget: string;
  progressionIntent: V2PlannerProgressionIntent;
  limitations: string[];
};

export type V2WeeklyProgressionModel = {
  weeks: V2WeeklyProgressionWeek[];
};

export type V2DeloadTransformPolicy = {
  preserveExerciseIdentities: boolean;
  targetVolumeReductionPercent: {
    min: number;
    max: number;
  };
  targetRir: string;
  removeRedundantAccessories: boolean;
  introduceNewMovements: false;
  projectionStatus: "modeled" | "partially_modeled" | "not_yet_projected";
  limitations: string[];
};

export type V2PlannerMesocyclePolicy = {
  targetSkeleton: V2TargetSkeleton;
  weeklyProgressionModel: V2WeeklyProgressionModel;
  deloadTransform: V2DeloadTransformPolicy;
  mesocycleDemand: V2MesocycleDemand;
  weeklyDemandCurve: V2WeeklyDemandCurve;
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
  exerciseClassDistributionBySlot: V2ExerciseClassDistributionBySlot;
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2SupportLanePolicy: V2SupportLanePolicy;
  selectionCapacityPlan: V2SelectionCapacityPlan;
};

export type V2PlannerTargetStatus = "hard" | "soft" | "diagnostic";

export type V2PlannerDemandRole =
  | "primary"
  | "support"
  | "secondary"
  | "implicit";

export type V2PlannerSetRange = {
  min: number;
  preferred: number;
  max: number;
};

export type V2MesocycleDemand = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  split: V2PlannerSplit;
  weekCount: number;
  designBasis: {
    targetSkeleton: "upper_lower_4x_v2";
    evidencePolicy: "volume_landmarks_and_target_tiers";
    allocationTiming: "before_exercise_selection";
  };
  muscles: Array<{
    muscle: string;
    targetTier: MuscleTargetTier | null;
    role: V2PlannerDemandRole;
    targetStatus: V2PlannerTargetStatus;
    landmark: {
      mv: number;
      mev: number;
      mav: number;
      mrv: number;
    } | null;
    baselineSetRange: V2PlannerSetRange;
    exposureCount: number;
    source: string[];
    limitations: string[];
  }>;
  guardrails: {
    doesNotUsePlanningReality: true;
    doesNotUseNoRepairOutput: true;
    doesNotUseRepairedProjection: true;
    doesNotUseAcceptedSeed: true;
    doesNotUseRuntimeReplay: true;
  };
};

export type V2WeeklyDemandCurve = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  weeks: Array<{
    week: number;
    phase: V2PlannerPhase;
    volumeMultiplier: number;
    rirTarget: string;
    progressionIntent: V2PlannerProgressionIntent;
    projectionStatus:
      | "projected_from_mesocycle_demand"
      | "projected_from_deload_policy";
    muscles: Array<{
      muscle: string;
      targetTier: MuscleTargetTier | null;
      role: V2PlannerDemandRole;
      targetStatus: V2PlannerTargetStatus;
      targetSetRange: V2PlannerSetRange;
      exposureCount: number;
      source: string[];
      limitations: string[];
    }>;
  }>;
  guardrails: V2MesocycleDemand["guardrails"];
};

export type V2SlotDemandAllocationByWeek = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  allocationTiming: "before_exercise_selection";
  weeks: Array<{
    week: number;
    phase: V2PlannerPhase;
    projectionStatus: "allocated_from_v2_policy";
    slots: Array<{
      slotId: V2PlannerSlotId;
      slotIndex: number;
      intent: string;
      targetSessionSets: V2PlannerSetRange;
      lanes: Array<{
        laneId: string;
        required: boolean;
        role: V2PlannerLaneRole;
        primaryMuscles: string[];
        preferredExerciseClasses: string[];
        setBudget: V2PlannerSetRange;
        allocatedMuscles: Array<{
          muscle: string;
          role: V2PlannerDemandRole;
          targetStatus: V2PlannerTargetStatus;
          targetSetRange: V2PlannerSetRange;
          allocationBasis:
            | "target_lane"
            | "slot_role_policy"
            | "weekly_demand_curve"
            | "deload_transform";
        }>;
      }>;
    }>;
  }>;
  guardrails: V2MesocycleDemand["guardrails"];
};

export type V2ExerciseClassDistributionBySlot = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  distributionTiming: "before_exercise_selection";
  weeks: Array<{
    week: number;
    phase: V2PlannerPhase;
    slots: Array<{
      slotId: V2PlannerSlotId;
      slotIndex: number;
      intent: string;
      classLanes: Array<{
        laneId: string;
        role: V2PlannerLaneRole;
        primaryMuscles: string[];
        requiredExerciseClasses: string[];
        preferredExerciseClasses: string[];
        setBudget: V2PlannerSetRange;
        preferredSetSplit:
          | "single_anchor"
          | "anchor_plus_support"
          | "direct_accessory"
          | "optional_if_recoverable";
        duplicatePolicy:
          | "discourage_if_alternative_exists"
          | "block_if_clean_alternative_exists"
          | "allow_with_justification";
        source: string[];
      }>;
    }>;
  }>;
  guardrails: V2MesocycleDemand["guardrails"];
};

export type V2SelectionCapacityPlan = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  capacityTiming: "before_exercise_selection";
  weeks: Array<{
    week: number;
    phase: V2PlannerPhase;
    slots: Array<{
      slotId: V2PlannerSlotId;
      slotIndex: number;
      maxExerciseCount: number;
      targetSessionSets: V2PlannerSetRange;
      lanes: Array<{
        laneId: string;
        role: V2PlannerLaneRole;
        primaryMuscles: string[];
        preferredExerciseClasses: string[];
        targetWeeklySetRange: V2PlannerSetRange;
        setBudget: V2PlannerSetRange;
        perExerciseCap: {
          maxSetsWithoutJustification: number;
          maxDirectExercises: number;
          allowAboveFiveSetsOnlyWithJustification: boolean;
        };
        laneHeadroomPolicy: {
          preferredRequiresHeadroom: boolean;
          cleanAlternativeRequiredForExpansion: boolean;
          capAwareExpansion:
            | "not_needed"
            | "second_direct_exercise_allowed"
            | "limited_by_max_direct_exercises";
        };
        optionalActivation:
          | { type: "not_applicable" }
          | {
              type: "activate_only_if_weekly_target_below_range";
              weeklyFloorSets: number;
              requiresSlotExerciseHeadroom: true;
              requiresCleanAlternative: true;
              requiresRecoverability: true;
            };
      }>;
    }>;
  }>;
  guardrails: {
    doesNotUseSelectedIdentities: true;
    doesNotUseNoRepairOutput: true;
    doesNotUseRepairedProjection: true;
    doesNotAffectSelection: true;
    doesNotAffectRepair: true;
    doesNotAffectRuntimeReplay: true;
  };
};

export type MesocycleDemand = V2MesocycleDemand;
export type WeeklyDemandCurve = V2WeeklyDemandCurve;
export type SlotDemandAllocationByWeek = V2SlotDemandAllocationByWeek;
export type ExerciseClassDistributionBySlot = V2ExerciseClassDistributionBySlot;
export type SelectionCapacityPlan = V2SelectionCapacityPlan;
