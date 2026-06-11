import type {
  NextExposureDecision,
  VolumeComplianceStatus,
} from "@/lib/engine/explainability";
import type {
  PostSessionReviewReplacementEvidence,
  PostSessionReviewSessionSemanticsEvidence,
  PostSessionReviewWorkoutIdentityEvidence,
} from "./post-session-review-evidence";

export const POST_SESSION_REVIEW_CONTRACT_OWNER_SEAM =
  "api/post-session-review-contract" as const;

export type PostSessionReviewContractSource = {
  producer: "in_memory_read_model";
  provenance: "app_read_model";
};

export type PostSessionReviewSourceTruth = {
  setLogs: {
    source: "SetLog";
    available: boolean;
    performedSetCount: number;
    skippedSetCount: number;
    missingLogSetCount: number;
  };
  workoutStructure: {
    source: "Workout/WorkoutExercise/WorkoutSet";
    available: boolean;
    plannedExerciseCount: number;
    plannedSetCount: number;
    revision: number | null;
  };
  receipt: {
    source: "selectionMetadata.sessionDecisionReceipt";
    available: boolean;
    mutated: false;
  };
  runtimeEditReconciliation: {
    source: "selectionMetadata.runtimeEditReconciliation";
    available: boolean;
    evidenceOnly: true;
  };
  sessionSemantics: {
    source: "deriveSessionSemantics";
    available: boolean;
    evidence?: PostSessionReviewSessionSemanticsEvidence;
  };
};

export type PostSessionReviewExecutionSummary = {
  plannedSetCount: number;
  completedSetCount: number;
  skippedSetCount: number;
  uncoveredSkippedSetCount: number;
  extraSetCount: number;
  missingLogSetCount: number;
  performedExerciseCount: number;
  fullySkippedExerciseCount: number;
  partialExerciseCount: number;
};

export type PostSessionReviewExerciseReconciliationStatus =
  | "as_planned"
  | "partial"
  | "skipped"
  | "unlogged"
  | "runtime_added"
  | "replacement_like";

export type PostSessionReviewExerciseReconciliationRow = {
  workoutExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  status: PostSessionReviewExerciseReconciliationStatus;
  plannedSetCount: number;
  performedSetCount: number;
  skippedSetCount: number;
  missingLogSetCount: number;
  addedSetCount: number;
  runtimeAdded: boolean;
  replacement?: PostSessionReviewReplacementEvidence;
  evidenceOnly: true;
  policyMutation: false;
  seedMutation: false;
};

export type PostSessionReviewNextExposureRow = {
  exerciseId: string;
  exerciseName?: string;
  action: NextExposureDecision["action"];
  summary: string;
  reason: string;
  anchorLoad: number | null;
  repRange: NextExposureDecision["repRange"];
  modalRpe: number | null;
  medianReps: number | null;
  decisionLog: string[];
  evidenceOnly: true;
  affectsProgressionPolicy: false;
};

export type PostSessionReviewCalibrationClassification =
  | "clean"
  | "target_too_high"
  | "target_too_low"
  | "recalibrated_hold"
  | "insufficient_evidence"
  | "skipped_or_low_coverage"
  | "runtime_added"
  | "replacement_like";

export type PostSessionReviewRepRangeResult =
  | "below_target"
  | "in_range"
  | "above_target"
  | "unknown";

export type PostSessionReviewEffortResult =
  | "below_target"
  | "near_target"
  | "above_target"
  | "unknown";

export type PostSessionReviewPerformedRealityCoherence =
  | "coherent"
  | "load_too_heavy"
  | "load_too_light"
  | "mixed_signal"
  | "insufficient_evidence"
  | "low_coverage"
  | "session_local";

export type PostSessionReviewPrescriptionCalibrationRow = {
  exerciseId: string;
  exerciseName: string;
  classification: PostSessionReviewCalibrationClassification;
  plannedSetCount: number;
  performedSetCount: number;
  skippedSetCount: number;
  addedSetCount: number;
  targetLoad: number | null;
  targetRepRange: { min: number | null; max: number | null };
  targetRpe: number | null;
  medianPerformedLoad: number | null;
  anchorLoad: number | null;
  loadDeltaPct: number | null;
  medianReps: number | null;
  medianActualRpe: number | null;
  rpeDelta: number | null;
  repRangeResult: PostSessionReviewRepRangeResult;
  effortResult: PostSessionReviewEffortResult;
  performedRealityCoherence: PostSessionReviewPerformedRealityCoherence;
  reasonCodes: string[];
  notes: string[];
  evidenceOnly: true;
  affectsPrescriptionPolicy: false;
};

export type PostSessionReviewRecentExposureCalibrationSummaryRow = {
  exerciseId: string;
  exerciseName: string;
  priorExposureCount: number;
  lookbackWorkoutLimit: number;
  latestPerformedAt: string | null;
  coherentCount: number;
  loadTooHeavyCount: number;
  loadTooLightCount: number;
  mixedSignalCount: number;
  lowCoverageCount: number;
  insufficientEvidenceCount: number;
  sessionLocalCount: number;
  evidenceOnly: true;
  affectsPrescriptionPolicy: false;
  affectsProgressionPolicy: false;
};

export type PostSessionReviewWeeklyImpactRow = {
  muscle: string;
  performedEffectiveVolumeBeforeSession: number;
  plannedEffectiveVolumeThisSession: number;
  projectedEffectiveVolume: number;
  weeklyTarget: number;
  mev: number;
  mav: number;
  status: VolumeComplianceStatus;
};

export type PostSessionReviewLearningSignal = {
  kind:
    | "performed_set_signal"
    | "skipped_set_signal"
    | "runtime_edit_signal"
    | "next_exposure_signal"
    | "calibration_signal"
    | "weekly_volume_signal"
    | "session_semantics_signal";
  severity: "info" | "watch";
  summary: string;
  evidence: string[];
};

export type PostSessionReviewConsistencyCheck = {
  id:
    | "boundary_flags_read_only"
    | "source_truth_present"
    | "performed_status_reviewable"
    | "runtime_edit_evidence_only"
    | "replacement_evidence_non_mutating"
    | "next_exposure_read_only";
  status: "pass" | "warning" | "fail";
  severity: "info" | "warning" | "error";
  message: string;
  evidence: string[];
};

export type PostSessionReviewContract = {
  contractVersion: 1;
  scope: {
    mode: "post-session-review";
    ownerSeam: typeof POST_SESSION_REVIEW_CONTRACT_OWNER_SEAM;
    source: PostSessionReviewContractSource;
    readOnly: true;
    affectsScoringOrGeneration: false;
  };
  workoutIdentity: PostSessionReviewWorkoutIdentityEvidence;
  sourceTruth: PostSessionReviewSourceTruth;
  executionSummary: PostSessionReviewExecutionSummary;
  exerciseReconciliation: {
    rows: PostSessionReviewExerciseReconciliationRow[];
  };
  nextExposure: {
    source: "explainability.nextExposureDecisions";
    available: boolean;
    rows: PostSessionReviewNextExposureRow[];
    readOnly: true;
  };
  prescriptionCalibration: {
    source: "set_log_vs_workout_set_targets";
    rows: PostSessionReviewPrescriptionCalibrationRow[];
    summary: {
      targetTooHighCount: number;
      targetTooLowCount: number;
      insufficientEvidenceCount: number;
      skippedOrLowCoverageCount: number;
      coherentCount: number;
      loadTooHeavyCount: number;
      loadTooLightCount: number;
      mixedSignalCount: number;
      lowCoverageCount: number;
      sessionLocalCount: number;
    };
    recentExposureSummary?: {
      source: "exact_exercise_prior_performed_workouts";
      rows: PostSessionReviewRecentExposureCalibrationSummaryRow[];
      readOnly: true;
      affectsPrescriptionPolicy: false;
      affectsProgressionPolicy: false;
    };
    readOnly: true;
  };
  weeklyImpact?: {
    source: "explainability.volumeCompliance";
    rows: PostSessionReviewWeeklyImpactRow[];
    readOnly: true;
  };
  learningSignals: PostSessionReviewLearningSignal[];
  boundaries: {
    readOnly: true;
    affectsScoringOrGeneration: false;
    dbMutation: false;
    workoutChanged: false;
    seedRuntimeChanged: false;
    plannerMaterializerChanged: false;
    selectionMetadataMutated: false;
    receiptMutated: false;
    notes: string[];
  };
  consistencyChecks: PostSessionReviewConsistencyCheck[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringOrNullish(value: unknown): boolean {
  return value == null || typeof value === "string";
}

function isBooleanOrNullish(value: unknown): boolean {
  return value == null || typeof value === "boolean";
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalNumber(value: unknown): boolean {
  return value == null || (typeof value === "number" && Number.isFinite(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasValidScope(scope: unknown): boolean {
  return (
    isRecord(scope) &&
    scope.mode === "post-session-review" &&
    scope.ownerSeam === POST_SESSION_REVIEW_CONTRACT_OWNER_SEAM &&
    isRecord(scope.source) &&
    scope.source.producer === "in_memory_read_model" &&
    scope.source.provenance === "app_read_model" &&
    scope.readOnly === true &&
    scope.affectsScoringOrGeneration === false
  );
}

function hasValidWorkoutIdentity(
  identity: unknown,
  options: { userId?: string; workoutId?: string }
): boolean {
  if (!isRecord(identity)) {
    return false;
  }
  if (options.userId && identity.userId !== options.userId) {
    return false;
  }
  if (options.workoutId && identity.workoutId !== options.workoutId) {
    return false;
  }

  return (
    isString(identity.userId) &&
    (identity.ownerEmail == null || typeof identity.ownerEmail === "string") &&
    isString(identity.workoutId) &&
    isString(identity.status) &&
    isNumberOrNull(identity.revision) &&
    (identity.scheduledDate == null || typeof identity.scheduledDate === "string") &&
    isStringOrNullish(identity.selectionMode) &&
    isStringOrNullish(identity.sessionIntent) &&
    isBooleanOrNullish(identity.advancesSplit) &&
    isStringOrNullish(identity.mesocycleId) &&
    isOptionalNumber(identity.mesocycleWeekSnapshot) &&
    isOptionalNumber(identity.mesoSessionSnapshot) &&
    isStringOrNullish(identity.mesocyclePhaseSnapshot) &&
    isStringOrNullish(identity.slotId)
  );
}

function hasValidSourceTruth(sourceTruth: unknown): boolean {
  if (!isRecord(sourceTruth)) {
    return false;
  }
  const setLogs = sourceTruth.setLogs;
  const workoutStructure = sourceTruth.workoutStructure;
  const receipt = sourceTruth.receipt;
  const runtimeEditReconciliation = sourceTruth.runtimeEditReconciliation;
  const sessionSemantics = sourceTruth.sessionSemantics;

  return (
    isRecord(setLogs) &&
    setLogs.source === "SetLog" &&
    typeof setLogs.available === "boolean" &&
    isOptionalNumber(setLogs.performedSetCount) &&
    isOptionalNumber(setLogs.skippedSetCount) &&
    isOptionalNumber(setLogs.missingLogSetCount) &&
    isRecord(workoutStructure) &&
    workoutStructure.source === "Workout/WorkoutExercise/WorkoutSet" &&
    typeof workoutStructure.available === "boolean" &&
    isOptionalNumber(workoutStructure.plannedExerciseCount) &&
    isOptionalNumber(workoutStructure.plannedSetCount) &&
    isNumberOrNull(workoutStructure.revision) &&
    isRecord(receipt) &&
    receipt.source === "selectionMetadata.sessionDecisionReceipt" &&
    typeof receipt.available === "boolean" &&
    receipt.mutated === false &&
    isRecord(runtimeEditReconciliation) &&
    runtimeEditReconciliation.source === "selectionMetadata.runtimeEditReconciliation" &&
    typeof runtimeEditReconciliation.available === "boolean" &&
    runtimeEditReconciliation.evidenceOnly === true &&
    isRecord(sessionSemantics) &&
    sessionSemantics.source === "deriveSessionSemantics" &&
    typeof sessionSemantics.available === "boolean"
  );
}

function hasReadOnlyBoundaries(boundaries: unknown): boolean {
  return (
    isRecord(boundaries) &&
    boundaries.readOnly === true &&
    boundaries.affectsScoringOrGeneration === false &&
    boundaries.dbMutation === false &&
    boundaries.workoutChanged === false &&
    boundaries.seedRuntimeChanged === false &&
    boundaries.plannerMaterializerChanged === false &&
    boundaries.selectionMetadataMutated === false &&
    boundaries.receiptMutated === false &&
    isStringArray(boundaries.notes)
  );
}

function hasValidConsistencyCheck(check: unknown): boolean {
  return (
    isRecord(check) &&
    typeof check.id === "string" &&
    (check.status === "pass" || check.status === "warning" || check.status === "fail") &&
    (check.severity === "info" ||
      check.severity === "warning" ||
      check.severity === "error") &&
    typeof check.message === "string" &&
    isStringArray(check.evidence)
  );
}

function hasValidRecentExposureSummary(summary: unknown): boolean {
  if (!isRecord(summary)) {
    return false;
  }
  return (
    summary.source === "exact_exercise_prior_performed_workouts" &&
    Array.isArray(summary.rows) &&
    summary.rows.every(
      (row) =>
        isRecord(row) &&
        isString(row.exerciseId) &&
        isString(row.exerciseName) &&
        isOptionalNumber(row.priorExposureCount) &&
        isOptionalNumber(row.lookbackWorkoutLimit) &&
        (row.latestPerformedAt == null || typeof row.latestPerformedAt === "string") &&
        isOptionalNumber(row.coherentCount) &&
        isOptionalNumber(row.loadTooHeavyCount) &&
        isOptionalNumber(row.loadTooLightCount) &&
        isOptionalNumber(row.mixedSignalCount) &&
        isOptionalNumber(row.lowCoverageCount) &&
        isOptionalNumber(row.insufficientEvidenceCount) &&
        isOptionalNumber(row.sessionLocalCount) &&
        row.evidenceOnly === true &&
        row.affectsPrescriptionPolicy === false &&
        row.affectsProgressionPolicy === false
    ) &&
    summary.readOnly === true &&
    summary.affectsPrescriptionPolicy === false &&
    summary.affectsProgressionPolicy === false
  );
}

export function isPostSessionReviewContract(
  value: unknown,
  options: { userId?: string; workoutId?: string } = {}
): value is PostSessionReviewContract {
  return (
    isRecord(value) &&
    value.contractVersion === 1 &&
    hasValidScope(value.scope) &&
    hasValidWorkoutIdentity(value.workoutIdentity, options) &&
    hasValidSourceTruth(value.sourceTruth) &&
    isRecord(value.executionSummary) &&
    isRecord(value.exerciseReconciliation) &&
    Array.isArray(value.exerciseReconciliation.rows) &&
    isRecord(value.nextExposure) &&
    value.nextExposure.source === "explainability.nextExposureDecisions" &&
    typeof value.nextExposure.available === "boolean" &&
    Array.isArray(value.nextExposure.rows) &&
    value.nextExposure.readOnly === true &&
    isRecord(value.prescriptionCalibration) &&
    value.prescriptionCalibration.source === "set_log_vs_workout_set_targets" &&
    Array.isArray(value.prescriptionCalibration.rows) &&
    isRecord(value.prescriptionCalibration.summary) &&
    (value.prescriptionCalibration.recentExposureSummary == null ||
      hasValidRecentExposureSummary(
        value.prescriptionCalibration.recentExposureSummary
      )) &&
    value.prescriptionCalibration.readOnly === true &&
    (value.weeklyImpact == null ||
      (isRecord(value.weeklyImpact) &&
        value.weeklyImpact.source === "explainability.volumeCompliance" &&
        Array.isArray(value.weeklyImpact.rows) &&
        value.weeklyImpact.readOnly === true)) &&
    Array.isArray(value.learningSignals) &&
    hasReadOnlyBoundaries(value.boundaries) &&
    Array.isArray(value.consistencyChecks) &&
    value.consistencyChecks.every(hasValidConsistencyCheck)
  );
}
