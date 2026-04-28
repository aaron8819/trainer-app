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
};
