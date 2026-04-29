import type { V2ExerciseSelectionPlan } from "../types";

export type V2MaterializationExercise = {
  exerciseId: string;
  name: string;
  aliases?: string[];
  movementPatterns: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  isCompound: boolean;
  isMainLiftEligible: boolean;
  fatigueCost?: number;
  stimulusByMusclePerSet: Record<string, number>;
};

export type V2ExerciseClassId =
  | "knee_flexion_curl"
  | "distinct_chest_press_or_fly"
  | "low_axial_hip_extension_anchor"
  | "calf_isolation"
  | "lateral_raise"
  | "rear_delt_isolation"
  | "triceps_isolation"
  | "biceps_isolation"
  | "horizontal_pull_support"
  | "vertical_pull"
  | "hinge_compound"
  | "squat_pattern";

export type V2ExerciseClassMatch = {
  classId: string;
  directMuscles: string[];
  duplicateFamily: string;
  rank: number;
};

export type V2ExerciseClassTaxonomy = {
  version: 1;
  source: "v2_exercise_class_taxonomy";
  classOrder: V2ExerciseClassId[];
  classAliases: Record<string, V2ExerciseClassId[]>;
};

export type V2MaterializedSelection = {
  slotId: string;
  laneId: string;
  exerciseId: string;
  classId: string;
  duplicateFamily: string;
};

export type V2ExerciseMaterializationInput = {
  exerciseSelectionPlan: V2ExerciseSelectionPlan;
  inventory: V2MaterializationExercise[];
  taxonomy: V2ExerciseClassTaxonomy;
  constraints: {
    avoidExerciseIds: string[];
    favoriteExerciseIds: string[];
    painConflictExerciseIds: string[];
    availableEquipment?: string[];
  };
  continuity?: {
    carryForwardExerciseIdsByLane?: Record<string, string[]>;
    priorMaterializedSelections?: V2MaterializedSelection[];
  };
};

export type V2ExerciseMaterializationPlan = {
  version: 1;
  source: "v2_exercise_materialization";
  dryRunOnly: true;
  status: "materialized" | "blocked";
  slots: Array<{
    slotId: string;
    exercises: Array<{
      exerciseId: string;
      role: "CORE_COMPOUND" | "ACCESSORY";
      setCount: number;
      laneIds: string[];
    }>;
  }>;
  blockers: Array<{
    slotId: string;
    laneId: string;
    reason:
      | "no_class_match"
      | "direct_floor_unmaterialized"
      | "capacity_exhausted"
      | "duplicate_requires_clean_alternative"
      | "taxonomy_gap";
  }>;
  omissions: Array<{
    slotId: string;
    laneId: string;
    reason:
      | "optional_no_match"
      | "optional_capacity_exhausted"
      | "optional_not_activated";
  }>;
};
