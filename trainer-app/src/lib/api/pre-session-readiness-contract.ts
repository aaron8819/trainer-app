import type { PrescriptionConfidenceLoadSource } from "@/lib/api/template-session/types";

export const PRE_SESSION_READINESS_CONTRACT_OWNER_SEAM =
  "api/pre-session-readiness-contract" as const;

export const LEGACY_AUDIT_PRE_SESSION_READINESS_OWNER_SEAM =
  "workout-audit/pre-session-readiness" as const;

export type PreSessionReadinessContractOwnerSeam =
  | typeof PRE_SESSION_READINESS_CONTRACT_OWNER_SEAM
  | typeof LEGACY_AUDIT_PRE_SESSION_READINESS_OWNER_SEAM;

export type PreSessionReadinessContractProducerMode =
  | "audit_readout"
  | "persisted_snapshot";

export type PreSessionReadinessContractSource = {
  producerMode: PreSessionReadinessContractProducerMode;
  producer:
    | "workout_audit"
    | "pre_session_readiness_snapshot"
    | "in_memory_read_model";
  provenance: "operator_audit" | "app_read_model";
};

export type PreSessionReadinessConsistencyCheck = {
  id:
    | "optional_add_on_matches_flagged_muscle"
    | "optional_add_on_not_suppressed_muscle"
    | "no_add_on_state_explicit"
    | "blocked_state_no_normal_start_coaching"
    | "seed_runtime_proof_read_only";
  status: "pass" | "warning" | "fail";
  severity: "info" | "warning" | "error";
  message: string;
  evidence: string[];
};

export type PreSessionReadinessCoachingRecommendation = {
  kind: "priority" | "optional" | "floor_buffer";
  muscle: string;
  targetMuscle: string;
  candidateExerciseName: string;
  line: string;
  addonLine: string;
  suppressed: boolean;
  suppressionReasons: string[];
};

export type PreSessionReadinessPrescriptionConfidenceWatchRow = {
  exerciseLabel: string;
  watchType: "prescription_confidence";
  reasonCode:
    | "progression_trace_unavailable"
    | "low_confidence"
    | "decrease_recommended"
    | "estimate_or_low_signal"
    | "load_calibration";
  displayActionCode:
    | "use_target_as_starting_point"
    | "hold_target_load"
    | "calibrate_from_first_working_set"
    | "machine_or_cable_target_may_need_calibration";
  severity: "info" | "warning";
  confidence?: number;
  targetLoad?: number | null;
  targetReps?: number | null;
  repRange?: { min: number; max: number } | null;
  targetRpe?: number | null;
  targetRir?: number | null;
  loadSource?: PrescriptionConfidenceLoadSource;
  loadConfidence?: "high" | "medium" | "low";
  cautionLevel?: "none" | "notice" | "caution";
  cautionReason?: string | null;
  adjustmentRangeBasis?: "exact_range" | "target_load_start" | "not_available";
  suggestedAdjustmentRange?: {
    minLoad: number;
    maxLoad: number;
    unit: "lb";
    basis: string;
  } | null;
  source: "generated_progression_trace";
};

export type PreSessionReadinessPrescriptionConfidenceWatch =
  | string
  | PreSessionReadinessPrescriptionConfidenceWatchRow;

export type PreSessionReadinessWorkoutPreviewExercise = {
  exerciseId: string;
  exerciseName: string;
  setCount: number;
  repTargetLabel: string;
  targetLoadLabel: string | null;
  targetRpeLabel: string | null;
};

export type PreSessionReadinessWorkoutPreview = {
  source: "generated_session_audit_snapshot";
  exercises: PreSessionReadinessWorkoutPreviewExercise[];
  targetRpeLabel: string | null;
};

export type PreSessionReadinessContract = {
  contractVersion: 1;
  scope: {
    mode: "pre-session-readiness";
    ownerSeam: PreSessionReadinessContractOwnerSeam;
    source?: PreSessionReadinessContractSource;
    readOnly: true;
    auditOnly?: boolean;
    affectsScoringOrGeneration: false;
    consumedByProduction?: false;
  };
  nextSessionIdentity: {
    userId: string;
    ownerEmail?: string;
    activeMesocycleId: string | null;
    requestedMesocycleId?: string;
    mesocycleIdMatchesRequest?: boolean;
    activeState: string | null;
    currentWeek: number | null;
    currentSession: number | null;
    nextSlotId: string | null;
    nextIntent: string | null;
    existingWorkoutId: string | null;
    incompleteWorkoutStatus: string | null;
    incompleteWorkoutReadiness: string;
    existingWorkoutAction: string;
    generationPath: string;
    generator: string;
  };
  startability: {
    status: "startable" | "blocked" | "not_runnable";
    safeToTrain: boolean;
    normalStartCoachingAllowed: boolean;
    action:
      | "run_seed_as_prescribed"
      | "run_deload_seed_as_prescribed"
      | "resolve_blocker_first";
    reasons: string[];
    blockerSummary: string;
  };
  seedRuntimeProof: {
    status: "valid" | "warning" | "not_available";
    compositionSource: string | null;
    receiptMesocycleId: string | null;
    seedSource: string | null;
    seedExecutableShape: string | null;
    seedOrderSetCountsRespected: boolean | null;
    readOnlyEvidenceOnly: true;
    seedRuntimeChanged: false;
    proofLines: string[];
  };
  projectedWeekStatus: {
    status:
      | "no_further_action"
      | "top_up_candidate"
      | "watch"
      | "blocked"
      | "deload_non_actionable";
    currentWeek: number | null;
    phase: string | null;
    belowMev: string[];
    overMav: string[];
    fatigueRisks: string[];
    projectionNotes: string[];
    doseGuidanceRows: Array<{
      muscle: string;
      projectedVsTargets: string;
      status: string;
      recommendedAction: string;
      confidence: string;
      line: string;
    }>;
    noAddOnReason?: string;
  };
  doseClosure: {
    heading: string;
    priority: string[];
    optional: string[];
    monitor: string[];
    suppress: string[];
    guardrails: string[];
    recommendations: PreSessionReadinessCoachingRecommendation[];
  };
  sessionLocalCoaching: {
    defaultInstruction: string;
    floorBufferOpportunities: string[];
    prescriptionConfidenceWatches: string[];
    fatigueCautions: string[];
    safeOptionalAddOns: string[];
    suppressAvoid: string[];
    addOnState: {
      status:
        | "available"
        | "none"
        | "suppressed"
        | "deload_suppressed"
        | "blocked";
      reason: string;
    };
  };
  calibrationWatches: {
    prescriptionConfidence: PreSessionReadinessPrescriptionConfidenceWatch[];
    recoveryCaveats: string[];
    fatigue: string[];
  };
  workoutPreview?: PreSessionReadinessWorkoutPreview;
  consistencyChecks: PreSessionReadinessConsistencyCheck[];
  boundaries: {
    readOnly: true;
    affectsScoringOrGeneration: false;
    consumedByProduction?: false;
    wouldWriteTransaction: false;
    dbMutation: false;
    workoutLogSessionCreated: false;
    seedRuntimeChanged: false;
    plannerMaterializerChanged: false;
    notes: string[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isNumberOrNull(value: unknown): value is number | null {
  return typeof value === "number" || value === null;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value == null || (typeof value === "number" && Number.isFinite(value));
}

function hasValidOptionalRepRange(value: unknown): boolean {
  return (
    value == null ||
    (isRecord(value) &&
      typeof value.min === "number" &&
      Number.isFinite(value.min) &&
      typeof value.max === "number" &&
      Number.isFinite(value.max))
  );
}

function hasValidOptionalAdjustmentRange(value: unknown): boolean {
  return (
    value == null ||
    (isRecord(value) &&
      typeof value.minLoad === "number" &&
      Number.isFinite(value.minLoad) &&
      typeof value.maxLoad === "number" &&
      Number.isFinite(value.maxLoad) &&
      value.unit === "lb" &&
      typeof value.basis === "string")
  );
}

function isLoadSource(value: unknown): value is PrescriptionConfidenceLoadSource {
  return (
    value === "history" ||
    value === "baseline" ||
    value === "estimate" ||
    value === "existing_target_load" ||
    value === "runtime_added_same_exercise_calibration_anchor" ||
    value === "bodyweight" ||
    value === "none" ||
    value === "unknown"
  );
}

function isOwnerSeam(value: unknown): value is PreSessionReadinessContractOwnerSeam {
  return (
    value === PRE_SESSION_READINESS_CONTRACT_OWNER_SEAM ||
    value === LEGACY_AUDIT_PRE_SESSION_READINESS_OWNER_SEAM
  );
}

function hasValidSource(source: unknown): boolean {
  if (source == null) {
    return true;
  }

  return (
    isRecord(source) &&
    (source.producerMode === "audit_readout" ||
      source.producerMode === "persisted_snapshot") &&
    (source.producer === "workout_audit" ||
      source.producer === "pre_session_readiness_snapshot" ||
      source.producer === "in_memory_read_model") &&
    (source.provenance === "operator_audit" ||
      source.provenance === "app_read_model")
  );
}

function hasReadOnlyScope(scope: unknown): boolean {
  return (
    isRecord(scope) &&
    scope.mode === "pre-session-readiness" &&
    isOwnerSeam(scope.ownerSeam) &&
    hasValidSource(scope.source) &&
    scope.readOnly === true &&
    (scope.auditOnly == null || isBoolean(scope.auditOnly)) &&
    scope.affectsScoringOrGeneration === false &&
    (scope.consumedByProduction == null ||
      scope.consumedByProduction === false)
  );
}

function hasReadOnlyBoundaries(boundaries: unknown): boolean {
  return (
    isRecord(boundaries) &&
    boundaries.readOnly === true &&
    boundaries.affectsScoringOrGeneration === false &&
    (boundaries.consumedByProduction == null ||
      boundaries.consumedByProduction === false) &&
    boundaries.wouldWriteTransaction === false &&
    boundaries.dbMutation === false &&
    boundaries.workoutLogSessionCreated === false &&
    boundaries.seedRuntimeChanged === false &&
    boundaries.plannerMaterializerChanged === false &&
    isStringArray(boundaries.notes)
  );
}

function hasValidIdentity(identity: unknown, userId?: string): boolean {
  if (!isRecord(identity)) {
    return false;
  }

  if (userId && identity.userId !== userId) {
    return false;
  }

  if (identity.mesocycleIdMatchesRequest === false) {
    return false;
  }

  return (
    typeof identity.userId === "string" &&
    (identity.ownerEmail == null || typeof identity.ownerEmail === "string") &&
    isStringOrNull(identity.activeMesocycleId) &&
    (identity.requestedMesocycleId == null ||
      typeof identity.requestedMesocycleId === "string") &&
    (identity.mesocycleIdMatchesRequest == null ||
      isBoolean(identity.mesocycleIdMatchesRequest)) &&
    isStringOrNull(identity.activeState) &&
    isNumberOrNull(identity.currentWeek) &&
    isNumberOrNull(identity.currentSession) &&
    isStringOrNull(identity.nextSlotId) &&
    isStringOrNull(identity.nextIntent) &&
    isStringOrNull(identity.existingWorkoutId) &&
    isStringOrNull(identity.incompleteWorkoutStatus) &&
    typeof identity.incompleteWorkoutReadiness === "string" &&
    typeof identity.existingWorkoutAction === "string" &&
    typeof identity.generationPath === "string" &&
    typeof identity.generator === "string"
  );
}

function hasValidStartability(startability: unknown): boolean {
  return (
    isRecord(startability) &&
    (startability.status === "startable" ||
      startability.status === "blocked" ||
      startability.status === "not_runnable") &&
    isBoolean(startability.safeToTrain) &&
    isBoolean(startability.normalStartCoachingAllowed) &&
    (startability.action === "run_seed_as_prescribed" ||
      startability.action === "run_deload_seed_as_prescribed" ||
      startability.action === "resolve_blocker_first") &&
    isStringArray(startability.reasons) &&
    typeof startability.blockerSummary === "string"
  );
}

function hasValidSeedRuntimeProof(seedRuntimeProof: unknown): boolean {
  return (
    isRecord(seedRuntimeProof) &&
    (seedRuntimeProof.status === "valid" ||
      seedRuntimeProof.status === "warning" ||
      seedRuntimeProof.status === "not_available") &&
    isStringOrNull(seedRuntimeProof.compositionSource) &&
    isStringOrNull(seedRuntimeProof.receiptMesocycleId) &&
    isStringOrNull(seedRuntimeProof.seedSource) &&
    isStringOrNull(seedRuntimeProof.seedExecutableShape) &&
    (isBoolean(seedRuntimeProof.seedOrderSetCountsRespected) ||
      seedRuntimeProof.seedOrderSetCountsRespected === null) &&
    seedRuntimeProof.readOnlyEvidenceOnly === true &&
    seedRuntimeProof.seedRuntimeChanged === false &&
    isStringArray(seedRuntimeProof.proofLines)
  );
}

function hasValidProjectedWeekStatus(projectedWeekStatus: unknown): boolean {
  return (
    isRecord(projectedWeekStatus) &&
    (projectedWeekStatus.status === "no_further_action" ||
      projectedWeekStatus.status === "top_up_candidate" ||
      projectedWeekStatus.status === "watch" ||
      projectedWeekStatus.status === "blocked" ||
      projectedWeekStatus.status === "deload_non_actionable") &&
    isNumberOrNull(projectedWeekStatus.currentWeek) &&
    isStringOrNull(projectedWeekStatus.phase) &&
    isStringArray(projectedWeekStatus.belowMev) &&
    isStringArray(projectedWeekStatus.overMav) &&
    isStringArray(projectedWeekStatus.fatigueRisks) &&
    isStringArray(projectedWeekStatus.projectionNotes) &&
    Array.isArray(projectedWeekStatus.doseGuidanceRows) &&
    (projectedWeekStatus.noAddOnReason == null ||
      typeof projectedWeekStatus.noAddOnReason === "string")
  );
}

function hasValidRecommendation(recommendation: unknown): boolean {
  return (
    isRecord(recommendation) &&
    (recommendation.kind === "priority" ||
      recommendation.kind === "optional" ||
      recommendation.kind === "floor_buffer") &&
    typeof recommendation.muscle === "string" &&
    typeof recommendation.targetMuscle === "string" &&
    typeof recommendation.candidateExerciseName === "string" &&
    typeof recommendation.line === "string" &&
    typeof recommendation.addonLine === "string" &&
    isBoolean(recommendation.suppressed) &&
    isStringArray(recommendation.suppressionReasons)
  );
}

function hasValidDoseClosure(doseClosure: unknown): boolean {
  return (
    isRecord(doseClosure) &&
    typeof doseClosure.heading === "string" &&
    isStringArray(doseClosure.priority) &&
    isStringArray(doseClosure.optional) &&
    isStringArray(doseClosure.monitor) &&
    isStringArray(doseClosure.suppress) &&
    isStringArray(doseClosure.guardrails) &&
    Array.isArray(doseClosure.recommendations) &&
    doseClosure.recommendations.every(hasValidRecommendation)
  );
}

function hasValidSessionLocalCoaching(sessionLocalCoaching: unknown): boolean {
  const addOnState = isRecord(sessionLocalCoaching)
    ? sessionLocalCoaching.addOnState
    : null;

  return (
    isRecord(sessionLocalCoaching) &&
    typeof sessionLocalCoaching.defaultInstruction === "string" &&
    isStringArray(sessionLocalCoaching.floorBufferOpportunities) &&
    isStringArray(sessionLocalCoaching.prescriptionConfidenceWatches) &&
    isStringArray(sessionLocalCoaching.fatigueCautions) &&
    isStringArray(sessionLocalCoaching.safeOptionalAddOns) &&
    isStringArray(sessionLocalCoaching.suppressAvoid) &&
    isRecord(addOnState) &&
    (addOnState.status === "available" ||
      addOnState.status === "none" ||
      addOnState.status === "suppressed" ||
      addOnState.status === "deload_suppressed" ||
      addOnState.status === "blocked") &&
    typeof addOnState.reason === "string"
  );
}

function hasValidPrescriptionConfidenceWatch(
  value: unknown
): value is PreSessionReadinessPrescriptionConfidenceWatch {
  if (typeof value === "string") {
    return true;
  }

  return (
    isRecord(value) &&
    typeof value.exerciseLabel === "string" &&
    value.watchType === "prescription_confidence" &&
    (value.reasonCode === "progression_trace_unavailable" ||
      value.reasonCode === "low_confidence" ||
      value.reasonCode === "decrease_recommended" ||
      value.reasonCode === "estimate_or_low_signal" ||
      value.reasonCode === "load_calibration") &&
    (value.displayActionCode === "use_target_as_starting_point" ||
      value.displayActionCode === "hold_target_load" ||
      value.displayActionCode === "calibrate_from_first_working_set" ||
      value.displayActionCode === "machine_or_cable_target_may_need_calibration") &&
    (value.severity === "info" || value.severity === "warning") &&
    isOptionalFiniteNumber(value.confidence) &&
    isOptionalFiniteNumber(value.targetLoad) &&
    isOptionalFiniteNumber(value.targetReps) &&
    hasValidOptionalRepRange(value.repRange) &&
    isOptionalFiniteNumber(value.targetRpe) &&
    isOptionalFiniteNumber(value.targetRir) &&
    (value.loadSource == null || isLoadSource(value.loadSource)) &&
    (value.loadConfidence == null ||
      value.loadConfidence === "high" ||
      value.loadConfidence === "medium" ||
      value.loadConfidence === "low") &&
    (value.cautionLevel == null ||
      value.cautionLevel === "none" ||
      value.cautionLevel === "notice" ||
      value.cautionLevel === "caution") &&
    (value.cautionReason == null || typeof value.cautionReason === "string") &&
    (value.adjustmentRangeBasis == null ||
      value.adjustmentRangeBasis === "exact_range" ||
      value.adjustmentRangeBasis === "target_load_start" ||
      value.adjustmentRangeBasis === "not_available") &&
    hasValidOptionalAdjustmentRange(value.suggestedAdjustmentRange) &&
    value.source === "generated_progression_trace"
  );
}

function hasValidCalibrationWatches(calibrationWatches: unknown): boolean {
  return (
    isRecord(calibrationWatches) &&
    Array.isArray(calibrationWatches.prescriptionConfidence) &&
    calibrationWatches.prescriptionConfidence.every(
      hasValidPrescriptionConfidenceWatch
    ) &&
    isStringArray(calibrationWatches.recoveryCaveats) &&
    isStringArray(calibrationWatches.fatigue)
  );
}

function hasValidWorkoutPreviewExercise(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.exerciseId === "string" &&
    typeof value.exerciseName === "string" &&
    typeof value.setCount === "number" &&
    Number.isFinite(value.setCount) &&
    value.setCount >= 0 &&
    typeof value.repTargetLabel === "string" &&
    (typeof value.targetLoadLabel === "string" ||
      value.targetLoadLabel === null) &&
    (typeof value.targetRpeLabel === "string" || value.targetRpeLabel === null)
  );
}

function hasValidWorkoutPreview(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.source === "generated_session_audit_snapshot" &&
    Array.isArray(value.exercises) &&
    value.exercises.every(hasValidWorkoutPreviewExercise) &&
    (typeof value.targetRpeLabel === "string" || value.targetRpeLabel === null)
  );
}

function hasValidConsistencyCheck(check: unknown): boolean {
  return (
    isRecord(check) &&
    (check.id === "optional_add_on_matches_flagged_muscle" ||
      check.id === "optional_add_on_not_suppressed_muscle" ||
      check.id === "no_add_on_state_explicit" ||
      check.id === "blocked_state_no_normal_start_coaching" ||
      check.id === "seed_runtime_proof_read_only") &&
    (check.status === "pass" ||
      check.status === "warning" ||
      check.status === "fail") &&
    (check.severity === "info" ||
      check.severity === "warning" ||
      check.severity === "error") &&
    typeof check.message === "string" &&
    isStringArray(check.evidence)
  );
}

export function isPreSessionReadinessContract(
  value: unknown,
  options: { userId?: string } = {}
): value is PreSessionReadinessContract {
  return (
    isRecord(value) &&
    value.contractVersion === 1 &&
    hasReadOnlyScope(value.scope) &&
    hasValidIdentity(value.nextSessionIdentity, options.userId) &&
    hasValidStartability(value.startability) &&
    hasValidSeedRuntimeProof(value.seedRuntimeProof) &&
    hasValidProjectedWeekStatus(value.projectedWeekStatus) &&
    hasValidDoseClosure(value.doseClosure) &&
    hasValidSessionLocalCoaching(value.sessionLocalCoaching) &&
    hasValidCalibrationWatches(value.calibrationWatches) &&
    (value.workoutPreview == null ||
      hasValidWorkoutPreview(value.workoutPreview)) &&
    Array.isArray(value.consistencyChecks) &&
    value.consistencyChecks.every(hasValidConsistencyCheck) &&
    hasReadOnlyBoundaries(value.boundaries)
  );
}
