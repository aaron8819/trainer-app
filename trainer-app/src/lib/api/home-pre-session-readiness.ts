import type { PreSessionReadinessContract } from "@/lib/audit/workout-audit/types";

export type HomePreSessionReadinessContractCandidate = {
  contract: unknown;
  stale?: boolean;
  source?: "typed_read_model" | "audit_artifact" | "in_memory_audit_payload";
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

function hasReadOnlyScope(scope: unknown): boolean {
  return (
    isRecord(scope) &&
    scope.mode === "pre-session-readiness" &&
    scope.ownerSeam === "workout-audit/pre-session-readiness" &&
    scope.readOnly === true &&
    scope.auditOnly === true &&
    scope.affectsScoringOrGeneration === false &&
    scope.consumedByProduction === false
  );
}

function hasReadOnlyBoundaries(boundaries: unknown): boolean {
  return (
    isRecord(boundaries) &&
    boundaries.readOnly === true &&
    boundaries.affectsScoringOrGeneration === false &&
    boundaries.consumedByProduction === false &&
    boundaries.wouldWriteTransaction === false &&
    boundaries.dbMutation === false &&
    boundaries.workoutLogSessionCreated === false &&
    boundaries.seedRuntimeChanged === false &&
    boundaries.plannerMaterializerChanged === false &&
    isStringArray(boundaries.notes)
  );
}

function hasValidIdentity(identity: unknown, userId: string): boolean {
  if (!isRecord(identity)) {
    return false;
  }

  if (identity.userId !== userId) {
    return false;
  }

  if (identity.mesocycleIdMatchesRequest === false) {
    return false;
  }

  return (
    isStringOrNull(identity.activeMesocycleId) &&
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
    Array.isArray(projectedWeekStatus.doseGuidanceRows)
  );
}

function hasValidDoseClosure(doseClosure: unknown): boolean {
  return (
    isRecord(doseClosure) &&
    isStringArray(doseClosure.priority) &&
    isStringArray(doseClosure.optional) &&
    isStringArray(doseClosure.monitor) &&
    isStringArray(doseClosure.suppress) &&
    isStringArray(doseClosure.guardrails) &&
    Array.isArray(doseClosure.recommendations)
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
      addOnState.status === "blocked") &&
    typeof addOnState.reason === "string"
  );
}

function hasValidCalibrationWatches(calibrationWatches: unknown): boolean {
  return (
    isRecord(calibrationWatches) &&
    Array.isArray(calibrationWatches.prescriptionConfidence) &&
    Array.isArray(calibrationWatches.recoveryCaveats) &&
    Array.isArray(calibrationWatches.fatigue)
  );
}

function isHomeSafePreSessionReadinessContract(
  value: unknown,
  userId: string
): value is PreSessionReadinessContract {
  return (
    isRecord(value) &&
    value.contractVersion === 1 &&
    hasReadOnlyScope(value.scope) &&
    hasValidIdentity(value.nextSessionIdentity, userId) &&
    hasValidStartability(value.startability) &&
    hasValidSeedRuntimeProof(value.seedRuntimeProof) &&
    hasValidProjectedWeekStatus(value.projectedWeekStatus) &&
    hasValidDoseClosure(value.doseClosure) &&
    hasValidSessionLocalCoaching(value.sessionLocalCoaching) &&
    hasValidCalibrationWatches(value.calibrationWatches) &&
    Array.isArray(value.consistencyChecks) &&
    hasReadOnlyBoundaries(value.boundaries)
  );
}

export function resolveHomePreSessionReadinessContract(input: {
  userId: string;
  candidate: HomePreSessionReadinessContractCandidate | null | undefined;
}): PreSessionReadinessContract | null {
  if (!input.candidate || input.candidate.stale === true) {
    return null;
  }

  return isHomeSafePreSessionReadinessContract(
    input.candidate.contract,
    input.userId
  )
    ? input.candidate.contract
    : null;
}

export async function loadLatestHomePreSessionReadinessContractCandidate(
  userId: string
): Promise<HomePreSessionReadinessContractCandidate | null> {
  void userId;
  return null;
}
