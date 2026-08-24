import type {
  MeasurementSemantics,
  ZeroLoadMeaning,
} from "@/lib/exercise-measurement/semantics";
import type { NormalizedPerformedExerciseEvidence } from "@/lib/session-semantics/performed-exercise-semantics";

export const PRESCRIPTION_RESULT_VERSION = 1 as const;

export const PRESCRIPTION_CONFIDENCE_POLICY = {
  directionalActionFloor: 0.75,
  incompleteEvidenceCap: 0.7,
  exactMachineDisplayed: {
    confidenceCap: 0.7,
    cleanEvidenceActionFloor: 0.7,
  },
} as const;

export type PrescriptionConfidence = "high" | "reduced" | "low";

export type PrescriptionReasonCode =
  | "same_exercise_same_measurement"
  | "same_exercise_displayed_load"
  | "legacy_barbell_bridge"
  | "legacy_machine_calibration_only"
  | "measurement_changed"
  | "exercise_identity_changed"
  | "complete_performed_evidence"
  | "missing_performed_load"
  | "missing_reps"
  | "missing_effort"
  | "incomplete_set_coverage"
  | "skipped_exposure"
  | "deload_excluded"
  | "stale_evidence"
  | "runtime_added_evidence"
  | "substituted_exposure"
  | "bodyweight_no_load_not_applicable"
  | "bodyweight_no_added_load"
  | "machine_default_no_added_load"
  | "displayed_assistance_unsupported"
  | "double_progression_increase"
  | "hold"
  | "decrease"
  | "existing_target_preserved"
  | "no_comparable_history"
  | "measurement_unsupported"
  | "warmup_load_not_owned";

export type PrescriptionBlockingField =
  | "canonicalExerciseId"
  | "measurement"
  | "performedLoad"
  | "performedReps"
  | "performedSetCoverage"
  | "progressionEligibility"
  | "evidence";

export type PrescriptionEvidenceReference = NormalizedPerformedExerciseEvidence & {
  progressionEligible: boolean;
};

type PrescriptionBase = {
  version: typeof PRESCRIPTION_RESULT_VERSION;
  canonicalExerciseId: string;
  measurement: MeasurementSemantics | null;
  reasonCodes: PrescriptionReasonCode[];
  evidence: PrescriptionEvidenceReference[];
};

export type NumericPrescription = PrescriptionBase & {
  kind: "numeric";
  value: number;
  source:
    | "existing_target"
    | "exact_history"
    | "legacy_barbell_history"
    | "baseline"
    | "estimate"
    | "runtime_added_same_exercise"
    | "deload_history";
  confidence: PrescriptionConfidence;
};

export type SemanticZeroPrescription = PrescriptionBase & {
  kind: "semantic_zero";
  value: 0;
  zeroLoadMeaning: ZeroLoadMeaning;
};

export type PriorObservedLoadHint = {
  value: number;
  observedAt: string;
  evidenceId: string;
  anchor: "representative_working_set";
  progressionEligible: false;
};

export type CalibrationRequiredPrescription = PrescriptionBase & {
  kind: "calibration_required";
  confidence: "low";
  priorObservedHint?: PriorObservedLoadHint;
};

export type NotApplicablePrescription = PrescriptionBase & {
  kind: "not_applicable";
};

export type UnavailablePrescription = PrescriptionBase & {
  kind: "unavailable";
  blockingFields: PrescriptionBlockingField[];
};

export type PrescriptionResult =
  | NumericPrescription
  | SemanticZeroPrescription
  | CalibrationRequiredPrescription
  | NotApplicablePrescription
  | UnavailablePrescription;

type ComparableResult = {
  kind: "comparable" | "comparable_reduced_confidence";
  confidence: "high" | "reduced";
  reasonCodes: PrescriptionReasonCode[];
  evidence: PrescriptionEvidenceReference;
  directionalActionEligible: boolean;
};

export type PrescriptionComparabilityResult =
  | ComparableResult
  | {
      kind: "calibration_required";
      confidence: "low";
      reasonCodes: PrescriptionReasonCode[];
      evidence: PrescriptionEvidenceReference;
      priorObservedHint?: PriorObservedLoadHint;
    }
  | {
      kind: "not_comparable";
      reasonCodes: PrescriptionReasonCode[];
      blockingFields: PrescriptionBlockingField[];
      evidence?: PrescriptionEvidenceReference;
    }
  | {
      kind: "not_applicable";
      reasonCodes: PrescriptionReasonCode[];
      evidence?: PrescriptionEvidenceReference;
    };

export type SelectedPrescriptionEvidence = {
  comparability: PrescriptionComparabilityResult;
  evidence: PrescriptionEvidenceReference;
};

export function toTargetLoad(result: PrescriptionResult): number | null {
  return result.kind === "numeric" || result.kind === "semantic_zero"
    ? result.value
    : null;
}

export function createNumericPrescription(
  input: Omit<NumericPrescription, "version" | "kind">,
): NumericPrescription {
  if (!Number.isFinite(input.value) || input.value <= 0) {
    throw new Error("NUMERIC_PRESCRIPTION_REQUIRES_POSITIVE_VALUE");
  }
  return { version: PRESCRIPTION_RESULT_VERSION, kind: "numeric", ...input };
}

export function createSemanticZeroPrescription(input: {
  canonicalExerciseId: string;
  measurement: MeasurementSemantics | null;
  zeroLoadMeaning: ZeroLoadMeaning;
  evidence?: PrescriptionEvidenceReference[];
}): SemanticZeroPrescription {
  return {
    version: PRESCRIPTION_RESULT_VERSION,
    kind: "semantic_zero",
    canonicalExerciseId: input.canonicalExerciseId,
    measurement: input.measurement,
    value: 0,
    zeroLoadMeaning: input.zeroLoadMeaning,
    reasonCodes: [
      input.zeroLoadMeaning === "BODYWEIGHT_NO_ADDED_LOAD"
        ? "bodyweight_no_added_load"
        : "machine_default_no_added_load",
    ],
    evidence: input.evidence ?? [],
  };
}

export function resolvePrescriptionResult(input: {
  canonicalExerciseId: string;
  measurement: MeasurementSemantics | null;
  zeroLoadMeaning: ZeroLoadMeaning | null;
  existingTargetLoad?: number;
  candidate?: {
    value: number;
    source: NumericPrescription["source"];
  } | null;
  comparability: PrescriptionComparabilityResult | null;
  isDeload: boolean;
}): PrescriptionResult {
  if (input.measurement?.profile === "REPS_BODYWEIGHT") {
    return {
      version: PRESCRIPTION_RESULT_VERSION,
      kind: "not_applicable",
      canonicalExerciseId: input.canonicalExerciseId,
      measurement: input.measurement,
      reasonCodes: ["bodyweight_no_load_not_applicable"],
      evidence: [],
    };
  }

  if (input.measurement?.profile === "REPS_ASSISTED") {
    return {
      version: PRESCRIPTION_RESULT_VERSION,
      kind: "unavailable",
      canonicalExerciseId: input.canonicalExerciseId,
      measurement: input.measurement,
      reasonCodes: ["displayed_assistance_unsupported"],
      evidence: [],
      blockingFields: ["measurement"],
    };
  }

  if (
    (input.existingTargetLoad === 0 || input.candidate?.value === 0) &&
    input.zeroLoadMeaning != null
  ) {
    return createSemanticZeroPrescription({
      canonicalExerciseId: input.canonicalExerciseId,
      measurement: input.measurement,
      zeroLoadMeaning: input.zeroLoadMeaning,
    });
  }

  const selectedCandidate =
    !input.isDeload &&
    Number.isFinite(input.existingTargetLoad) &&
    (input.existingTargetLoad ?? 0) > 0
      ? {
          value: input.existingTargetLoad as number,
          source: "existing_target" as const,
        }
      : input.candidate && Number.isFinite(input.candidate.value) && input.candidate.value > 0
        ? input.candidate
        : null;

  if (selectedCandidate) {
    const evidence =
      selectedCandidate.source === "existing_target"
        ? []
        : comparableEvidence(input.comparability);
    return createNumericPrescription({
      canonicalExerciseId: input.canonicalExerciseId,
      measurement: input.measurement,
      value: selectedCandidate.value,
      source: selectedCandidate.source,
      confidence: numericConfidence(selectedCandidate.source, input.comparability),
      reasonCodes:
        selectedCandidate.source === "existing_target"
          ? ["existing_target_preserved"]
          : uniqueReasons([
              ...(input.comparability?.reasonCodes ?? []),
              decisionReason({
                existingTargetLoad: input.existingTargetLoad,
                candidateValue: selectedCandidate.value,
                evidenceLoad: evidence[0]?.representativeLoad ?? null,
                isDeload: input.isDeload,
              }),
            ]),
      evidence,
    });
  }

  if (input.comparability?.kind === "calibration_required") {
    return {
      version: PRESCRIPTION_RESULT_VERSION,
      kind: "calibration_required",
      canonicalExerciseId: input.canonicalExerciseId,
      measurement: input.measurement,
      confidence: "low",
      reasonCodes: input.comparability.reasonCodes,
      evidence: [input.comparability.evidence],
      ...(input.comparability.priorObservedHint
        ? { priorObservedHint: input.comparability.priorObservedHint }
        : {}),
    };
  }

  if (
    input.comparability?.kind === "not_applicable"
  ) {
    return {
      version: PRESCRIPTION_RESULT_VERSION,
      kind: "not_applicable",
      canonicalExerciseId: input.canonicalExerciseId,
      measurement: input.measurement,
      reasonCodes:
        input.comparability.reasonCodes,
      evidence:
        input.comparability.evidence
          ? [input.comparability.evidence]
          : [],
    };
  }

  return {
    version: PRESCRIPTION_RESULT_VERSION,
    kind: "unavailable",
    canonicalExerciseId: input.canonicalExerciseId,
    measurement: input.measurement,
    reasonCodes: input.comparability?.reasonCodes ?? ["no_comparable_history"],
    evidence:
      input.comparability?.kind === "not_comparable" && input.comparability.evidence
        ? [input.comparability.evidence]
        : [],
    blockingFields:
      input.comparability?.kind === "not_comparable"
        ? input.comparability.blockingFields
        : ["evidence"],
  };
}

export function classifyPrescriptionComparability(input: {
  canonicalExerciseId: string;
  measurement: MeasurementSemantics | null;
  evidence: NormalizedPerformedExerciseEvidence;
}): PrescriptionComparabilityResult {
  const evidence = asEvidenceReference(input.evidence, false);
  const currentMeasurement = input.measurement;

  if (currentMeasurement?.profile === "REPS_BODYWEIGHT") {
    return {
      kind: "not_applicable",
      reasonCodes: ["bodyweight_no_load_not_applicable"],
      evidence,
    };
  }
  if (currentMeasurement?.profile === "REPS_ASSISTED") {
    return notComparable(["displayed_assistance_unsupported"], ["measurement"], evidence);
  }
  if (input.canonicalExerciseId !== input.evidence.canonicalExerciseId) {
    return notComparable(["exercise_identity_changed"], ["canonicalExerciseId"], evidence);
  }
  if (input.evidence.status === "SKIPPED") {
    return notComparable(["skipped_exposure"], ["progressionEligibility"], evidence);
  }
  if (input.evidence.isDeload) {
    return notComparable(["deload_excluded"], ["progressionEligibility"], evidence);
  }

  const missingReasons: PrescriptionReasonCode[] = [];
  const blockingFields: PrescriptionBlockingField[] = [];
  if (!input.evidence.hasPerformedLoad || (input.evidence.representativeLoad ?? 0) <= 0) {
    missingReasons.push("missing_performed_load");
    blockingFields.push("performedLoad");
  }
  if (!input.evidence.hasPerformedReps) {
    missingReasons.push("missing_reps");
    blockingFields.push("performedReps");
  }
  if (input.evidence.coverage === "inadequate_partial") {
    missingReasons.push("incomplete_set_coverage");
    blockingFields.push("performedSetCoverage");
  }
  if (blockingFields.length > 0) {
    return notComparable(missingReasons, blockingFields, evidence);
  }

  const qualityReasons: PrescriptionReasonCode[] = [
    input.evidence.coverage === "complete"
      ? "complete_performed_evidence"
      : "incomplete_set_coverage",
    ...(input.evidence.hasPerformedEffort ? [] : ["missing_effort" as const]),
    ...(input.evidence.runtimeAdded ? ["runtime_added_evidence" as const] : []),
    ...(input.evidence.substituted ? ["substituted_exposure" as const] : []),
  ];

  if (input.evidence.measurement == null) {
    if (isBarbellTotal(currentMeasurement)) {
      return comparableReduced(
        ["legacy_barbell_bridge", ...qualityReasons],
        asEvidenceReference(input.evidence, true),
        directionalActionEligible(input.evidence, currentMeasurement),
      );
    }
    if (isMachineDisplayed(currentMeasurement)) {
      const priorObservedHint = buildPriorObservedHint(input.evidence);
      return {
        kind: "calibration_required",
        confidence: "low",
        reasonCodes: ["legacy_machine_calibration_only", ...qualityReasons],
        evidence,
        ...(priorObservedHint ? { priorObservedHint } : {}),
      };
    }
    return notComparable(["measurement_changed"], ["measurement"], evidence);
  }

  if (!measurementsEqual(currentMeasurement, input.evidence.measurement)) {
    return notComparable(["measurement_changed"], ["measurement"], evidence);
  }

  if (isMachineDisplayed(currentMeasurement)) {
    return comparableReduced(
      ["same_exercise_displayed_load", ...qualityReasons],
      asEvidenceReference(input.evidence, true),
      directionalActionEligible(input.evidence, currentMeasurement),
    );
  }

  const requiresReducedConfidence =
    input.evidence.coverage !== "complete" ||
    !input.evidence.hasPerformedEffort ||
    input.evidence.runtimeAdded ||
    input.evidence.substituted;
  if (requiresReducedConfidence) {
    return comparableReduced(
      ["same_exercise_same_measurement", ...qualityReasons],
      asEvidenceReference(input.evidence, true),
      false,
    );
  }
  const actionEligible = directionalActionEligible(
    input.evidence,
    currentMeasurement,
  );
  return {
    kind: "comparable",
    confidence: "high",
    reasonCodes: ["same_exercise_same_measurement", ...qualityReasons],
    evidence: asEvidenceReference(input.evidence, true),
    directionalActionEligible: actionEligible,
  };
}

export function selectBestPrescriptionComparability(input: {
  canonicalExerciseId: string;
  measurement: MeasurementSemantics | null;
  evidence: NormalizedPerformedExerciseEvidence[];
}): PrescriptionComparabilityResult | null {
  const results = input.evidence.map((evidence) =>
    classifyPrescriptionComparability({
      canonicalExerciseId: input.canonicalExerciseId,
      measurement: input.measurement,
      evidence,
    }),
  );
  const firstFrozenBlockingResult = results.find(
    (result) =>
      result.kind === "not_comparable" &&
      result.evidence?.measurementProvenance === "frozen",
  );
  return (
    results.find(
      (result) =>
        result.kind === "comparable" ||
        result.kind === "comparable_reduced_confidence",
    ) ??
    firstFrozenBlockingResult ??
    results.find((result) => result.kind === "calibration_required") ??
    results.find((result) => result.kind === "not_applicable") ??
    results[0] ??
    null
  );
}

export function selectedPrescriptionEvidence(
  comparability: PrescriptionComparabilityResult | null,
): SelectedPrescriptionEvidence | null {
  if (!comparability?.evidence) return null;
  return { comparability, evidence: comparability.evidence };
}

function comparableReduced(
  reasonCodes: PrescriptionReasonCode[],
  evidence: PrescriptionEvidenceReference,
  actionEligible: boolean,
): ComparableResult {
  return {
    kind: "comparable_reduced_confidence",
    confidence: "reduced",
    reasonCodes,
    evidence,
    directionalActionEligible: actionEligible,
  };
}

function directionalActionEligible(
  evidence: NormalizedPerformedExerciseEvidence,
  measurement: MeasurementSemantics | null,
): boolean {
  const cleanEvidence =
    evidence.coverage === "complete" &&
    evidence.hasPerformedEffort &&
    !evidence.runtimeAdded &&
    !evidence.substituted;
  if (!cleanEvidence) return false;

  const actionFloor = isMachineDisplayed(measurement)
    ? PRESCRIPTION_CONFIDENCE_POLICY.exactMachineDisplayed.cleanEvidenceActionFloor
    : PRESCRIPTION_CONFIDENCE_POLICY.directionalActionFloor;
  return evidence.confidence >= actionFloor;
}

function comparableEvidence(
  comparability: PrescriptionComparabilityResult | null,
): PrescriptionEvidenceReference[] {
  return comparability?.kind === "comparable" ||
    comparability?.kind === "comparable_reduced_confidence"
    ? [comparability.evidence]
    : [];
}

function decisionReason(input: {
  existingTargetLoad?: number;
  candidateValue: number;
  evidenceLoad: number | null;
  isDeload: boolean;
}): PrescriptionReasonCode {
  if (input.existingTargetLoad != null && !input.isDeload) {
    return "existing_target_preserved";
  }
  if (input.evidenceLoad == null) return "no_comparable_history";
  if (input.candidateValue > input.evidenceLoad) return "double_progression_increase";
  if (input.candidateValue < input.evidenceLoad) return "decrease";
  return "hold";
}

function numericConfidence(
  source: NumericPrescription["source"],
  comparability: PrescriptionComparabilityResult | null,
): PrescriptionConfidence {
  if (source === "existing_target") return "high";
  if (source === "baseline" || source === "estimate") return "low";
  if (source === "legacy_barbell_history" || source === "runtime_added_same_exercise") {
    return "reduced";
  }
  return comparability?.kind === "comparable" ? "high" : "reduced";
}

function uniqueReasons(reasonCodes: PrescriptionReasonCode[]): PrescriptionReasonCode[] {
  return [...new Set(reasonCodes)];
}

function notComparable(
  reasonCodes: PrescriptionReasonCode[],
  blockingFields: PrescriptionBlockingField[],
  evidence?: PrescriptionEvidenceReference,
): PrescriptionComparabilityResult {
  return {
    kind: "not_comparable",
    reasonCodes,
    blockingFields,
    ...(evidence ? { evidence } : {}),
  };
}

function buildPriorObservedHint(
  evidence: NormalizedPerformedExerciseEvidence,
): PriorObservedLoadHint | undefined {
  if (!Number.isFinite(evidence.representativeLoad) || (evidence.representativeLoad ?? 0) <= 0) {
    return undefined;
  }
  return {
    value: evidence.representativeLoad as number,
    observedAt: evidence.performedAt,
    evidenceId: evidence.evidenceId,
    anchor: "representative_working_set",
    progressionEligible: false,
  };
}

function asEvidenceReference(
  evidence: NormalizedPerformedExerciseEvidence,
  progressionEligible: boolean,
): PrescriptionEvidenceReference {
  return { ...evidence, progressionEligible };
}

function isBarbellTotal(measurement: MeasurementSemantics | null): boolean {
  return Boolean(
    measurement?.profile === "REPS_EXTERNAL_LOAD" &&
      measurement.loadConvention === "BARBELL_TOTAL" &&
      measurement.repBasis === "TOTAL",
  );
}

function isMachineDisplayed(measurement: MeasurementSemantics | null): boolean {
  return Boolean(
    measurement?.profile === "REPS_EXTERNAL_LOAD" &&
      measurement.loadConvention === "MACHINE_DISPLAYED",
  );
}

function measurementsEqual(
  left: MeasurementSemantics | null,
  right: MeasurementSemantics | null,
): boolean {
  if (!left || !right || left.profile !== right.profile || left.repBasis !== right.repBasis) {
    return false;
  }
  const leftConvention = "loadConvention" in left ? left.loadConvention : null;
  const rightConvention = "loadConvention" in right ? right.loadConvention : null;
  return leftConvention === rightConvention;
}
