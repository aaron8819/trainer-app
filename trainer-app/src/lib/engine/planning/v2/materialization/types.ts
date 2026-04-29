import type {
  V2ExerciseSelectionPlan,
  V2PlannerMesocyclePolicy,
} from "../types";

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
  | "vertical_press"
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

export type V2MaterializationDryRunReportStatus =
  | "materialized"
  | "blocked"
  | "partial";

export type V2MaterializationDryRunReportReason = {
  slotId?: string;
  laneId?: string;
  reason: string;
};

export type V2MaterializationDryRunReportPreviewSlot = {
  slotId: string;
  intent?: string;
  exercises: Array<{
    exerciseId: string;
    name?: string;
    role: "CORE_COMPOUND" | "ACCESSORY";
    setCount: number;
  }>;
};

export type V2MaterializationDryRunReport = {
  version: 1;
  source: "v2_exercise_materialization";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  status: V2MaterializationDryRunReportStatus;
  plannerPolicyAvailable: boolean;
  exerciseSelectionPlanAvailable: boolean;
  taxonomyAvailable: boolean;
  inventoryAvailable: boolean;
  materializer: {
    status: "materialized" | "blocked";
    blockerCount: number;
    omissionCount: number;
  };
  seedShapeCompatibility: {
    compatible: boolean;
    slotCount: number;
    exerciseCount: number;
    missingNameCount: number;
    duplicateExerciseIdWithinSlotCount: number;
    invalidRoleCount: number;
    invalidSetCount: number;
    unsupportedClassCount: number;
  };
  executableSeedPreview: V2MaterializationDryRunReportPreviewSlot[];
  strippedMaterializerFields: string[];
  blockers: V2MaterializationDryRunReportReason[];
  omissions: V2MaterializationDryRunReportReason[];
  readiness: {
    safeToPromoteToProductionWrite: false;
    missingBeforePromotion: string[];
  };
};

export type V2MaterializationDryRunReportInput = {
  plannerPolicy?: V2PlannerMesocyclePolicy | null;
  exerciseSelectionPlan?: V2ExerciseSelectionPlan | null;
  taxonomy?: V2ExerciseClassTaxonomy | null;
  inventory?: V2MaterializationExercise[] | null;
  materializedPlan?: V2ExerciseMaterializationPlan | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
  exerciseNameById?: Record<string, string | undefined>;
  slotIntentById?: Record<string, string | undefined>;
};
