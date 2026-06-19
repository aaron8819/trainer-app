import type {
  MuscleVolumeCompliance,
  NextExposureDecision,
} from "@/lib/engine/explainability";

export type PostSessionReviewSourceTruthEvidence = {
  setLogsAvailable: boolean;
  workoutStructureAvailable: boolean;
  sessionDecisionReceiptAvailable: boolean;
  workoutStructureStateAvailable?: boolean;
  runtimeEditReconciliationAvailable?: boolean;
};

export type PostSessionReviewWorkoutIdentityEvidence = {
  userId: string;
  ownerEmail?: string;
  workoutId: string;
  status: string;
  revision: number | null;
  scheduledDate?: string;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  advancesSplit?: boolean | null;
  mesocycleId?: string | null;
  mesocycleWeekSnapshot?: number | null;
  mesoSessionSnapshot?: number | null;
  mesocyclePhaseSnapshot?: string | null;
  slotId?: string | null;
};

export type PostSessionReviewSessionSemanticsEvidence = {
  kind: string;
  isDeload: boolean;
  countsTowardWeeklyVolume: boolean;
  countsTowardProgressionHistory: boolean;
  countsTowardPerformanceHistory: boolean;
  updatesProgressionAnchor: boolean;
  reasons?: string[];
};

export type PostSessionReviewSetEvidence = {
  workoutSetId: string;
  setIndex: number;
  isRuntimeAdded?: boolean;
  setIntent?: "WORK" | "WARMUP";
  targetReps?: number | null;
  targetRepMin?: number | null;
  targetRepMax?: number | null;
  targetRpe?: number | null;
  targetLoad?: number | null;
  wasLogged: boolean;
  wasSkipped: boolean;
  actualReps?: number | null;
  actualLoad?: number | null;
  actualRpe?: number | null;
  completedAt?: string | null;
};

export type PostSessionReviewReplacementEvidence = {
  source: "runtime_edit_reconciliation" | "replacement_like_inference";
  fromExerciseId: string;
  fromExerciseName?: string;
  toExerciseId: string;
  toExerciseName?: string;
  reason?: string;
  setCount?: number;
  evidence: string[];
  seedMutation: false;
  policyMutation: false;
};

export type PostSessionReviewExerciseEvidence = {
  workoutExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  orderIndex?: number;
  section?: "WARMUP" | "MAIN" | "ACCESSORY" | string | null;
  isMainLift?: boolean;
  isRuntimeAdded?: boolean;
  replacement?: PostSessionReviewReplacementEvidence;
  sets: PostSessionReviewSetEvidence[];
};

export type PostSessionReviewRecentExerciseExposureEvidence =
  PostSessionReviewExerciseEvidence & {
    workoutId: string;
    performedAt: string;
  };

export type PostSessionReviewNextExposureEvidence = {
  exerciseId: string;
  exerciseName?: string;
  decision: NextExposureDecision;
};

export type PostSessionReviewWeeklyImpactEvidence = {
  source: "explainability_volume_compliance";
  rows: MuscleVolumeCompliance[];
};

export type PostSessionReviewContractBuildInput = {
  workoutIdentity: PostSessionReviewWorkoutIdentityEvidence;
  sourceTruth: PostSessionReviewSourceTruthEvidence;
  sessionSemantics?: PostSessionReviewSessionSemanticsEvidence;
  exercises: PostSessionReviewExerciseEvidence[];
  recentExerciseExposures?: PostSessionReviewRecentExerciseExposureEvidence[];
  nextExposureDecisions?: PostSessionReviewNextExposureEvidence[];
  weeklyImpact?: PostSessionReviewWeeklyImpactEvidence;
  boundaryNotes?: string[];
};
