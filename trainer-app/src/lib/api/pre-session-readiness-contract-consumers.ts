import type {
  PreSessionReadinessCoachingRecommendation,
  PreSessionReadinessConsistencyCheck,
  PreSessionReadinessContract,
  PreSessionReadinessPrescriptionConfidenceWatch,
  PreSessionReadinessPrescriptionConfidenceWatchRow,
} from "./pre-session-readiness-contract";

export type ReadinessStartAction = {
  status: PreSessionReadinessContract["startability"]["status"];
  action: PreSessionReadinessContract["startability"]["action"];
  safeToTrain: boolean;
  normalStartCoachingAllowed: boolean;
  canStartNormalSession: boolean;
  blockerSummary: string | null;
  reasons: string[];
};

export type ReadinessOptionalAddOn = Pick<
  PreSessionReadinessCoachingRecommendation,
  "kind" | "muscle" | "targetMuscle" | "candidateExerciseName"
> & {
  source: "dose_closure_recommendation";
  reason: string;
  guardrail: string;
};

export type ReadinessSuppressedTarget = {
  targetMuscle: string;
  candidateExerciseName: string | null;
  reasons: string[];
  source:
    | "closure_decision"
    | "suppressed_recommendation"
    | "projected_week_over_mav"
    | "add_on_state";
};

export type ReadinessCalibrationWatchRow = {
  kind: "prescription_confidence" | "recovery_caveat" | "fatigue";
  message: string;
  exerciseLabel?: string;
  reasonCode?: PreSessionReadinessPrescriptionConfidenceWatchRow["reasonCode"];
  displayActionCode?: PreSessionReadinessPrescriptionConfidenceWatchRow["displayActionCode"];
  severity?: PreSessionReadinessPrescriptionConfidenceWatchRow["severity"];
  confidence?: number;
  targetLoad?: PreSessionReadinessPrescriptionConfidenceWatchRow["targetLoad"];
  targetReps?: PreSessionReadinessPrescriptionConfidenceWatchRow["targetReps"];
  repRange?: PreSessionReadinessPrescriptionConfidenceWatchRow["repRange"];
  targetRpe?: PreSessionReadinessPrescriptionConfidenceWatchRow["targetRpe"];
  targetRir?: PreSessionReadinessPrescriptionConfidenceWatchRow["targetRir"];
  loadSource?: PreSessionReadinessPrescriptionConfidenceWatchRow["loadSource"];
  loadConfidence?: PreSessionReadinessPrescriptionConfidenceWatchRow["loadConfidence"];
  cautionLevel?: PreSessionReadinessPrescriptionConfidenceWatchRow["cautionLevel"];
  cautionReason?: PreSessionReadinessPrescriptionConfidenceWatchRow["cautionReason"];
  adjustmentRangeBasis?: PreSessionReadinessPrescriptionConfidenceWatchRow["adjustmentRangeBasis"];
  suggestedAdjustmentRange?: PreSessionReadinessPrescriptionConfidenceWatchRow["suggestedAdjustmentRange"];
  source?: PreSessionReadinessPrescriptionConfidenceWatchRow["source"];
};

export type ReadinessContractConsistencyAssertion = {
  status: "pass" | "warning" | "fail";
  warnings: PreSessionReadinessConsistencyCheck[];
  failures: PreSessionReadinessConsistencyCheck[];
  checks: PreSessionReadinessConsistencyCheck[];
};

export type ReadinessGymCard = {
  ready: boolean;
  primaryAction: "start_seed" | "start_deload_seed" | "resolve_blocker";
  normalStartAction:
    | "run_seed_as_prescribed"
    | "run_deload_seed_as_prescribed"
    | null;
  blockerSummary: string | null;
  activeMesocycleId: string | null;
  currentWeek: number | null;
  currentSession: number | null;
  nextSlotId: string | null;
  nextIntent: string | null;
  existingWorkoutId: string | null;
  existingWorkoutAction: string;
  optionalAddOnStatus: PreSessionReadinessContract["sessionLocalCoaching"]["addOnState"]["status"];
  validOptionalAddOnCount: number;
  suppressedTargetCount: number;
  calibrationWatchCount: number;
  consistencyWarningCount: number;
};

function getActiveRecommendations(
  contract: PreSessionReadinessContract
): PreSessionReadinessCoachingRecommendation[] {
  if (
    !contract.startability.safeToTrain ||
    contract.sessionLocalCoaching.addOnState.status !== "available"
  ) {
    return [];
  }

  return contract.doseClosure.recommendations.filter(
    (recommendation) => !recommendation.suppressed
  );
}

function getAddOnReason(
  recommendation: PreSessionReadinessCoachingRecommendation
): string {
  if (recommendation.kind === "floor_buffer") {
    return `${recommendation.targetMuscle} is the useful floor-buffer today.`;
  }
  if (recommendation.kind === "priority") {
    return `${recommendation.targetMuscle} is the highest-value session-local gap.`;
  }
  return `${recommendation.targetMuscle} has a small useful session-local gap.`;
}

function getAddOnGuardrail(
  recommendation: PreSessionReadinessCoachingRecommendation
): string {
  const exercise = recommendation.candidateExerciseName;
  if (recommendation.kind === "floor_buffer") {
    return `Add only if planned ${exercise} work feels clean.`;
  }
  if (recommendation.kind === "priority") {
    return `Add only if warm-ups and planned ${exercise} work feel normal.`;
  }
  return `Skip it if the planned workout feels heavy.`;
}

export function getReadinessStartAction(
  contract: PreSessionReadinessContract
): ReadinessStartAction {
  const canStartNormalSession =
    contract.startability.safeToTrain &&
    contract.startability.normalStartCoachingAllowed;

  return {
    status: contract.startability.status,
    action: contract.startability.action,
    safeToTrain: contract.startability.safeToTrain,
    normalStartCoachingAllowed:
      contract.startability.normalStartCoachingAllowed,
    canStartNormalSession,
    blockerSummary: canStartNormalSession
      ? null
      : contract.startability.blockerSummary,
    reasons: [...contract.startability.reasons],
  };
}

export function getValidOptionalAddOns(
  contract: PreSessionReadinessContract
): ReadinessOptionalAddOn[] {
  return getActiveRecommendations(contract).map((recommendation) => ({
    kind: recommendation.kind,
    muscle: recommendation.muscle,
    targetMuscle: recommendation.targetMuscle,
    candidateExerciseName: recommendation.candidateExerciseName,
    source: "dose_closure_recommendation",
    reason: getAddOnReason(recommendation),
    guardrail: getAddOnGuardrail(recommendation),
  }));
}

export function getSuppressedMusclesOrTargets(
  contract: PreSessionReadinessContract
): ReadinessSuppressedTarget[] {
  const closureDecisions = contract.doseClosure.decisions;
  const suppressedRecommendations = closureDecisions
    ? closureDecisions
        .filter(
          (decision) =>
            decision.status === "suppressed" ||
            decision.status === "no_valid_candidate"
        )
        .map((decision) => ({
          targetMuscle: decision.muscle,
          candidateExerciseName: null,
          reasons:
            decision.constraints.reasons.length > 0
              ? [...decision.constraints.reasons]
              : [decision.status],
          source: "closure_decision" as const,
        }))
    : contract.doseClosure.recommendations
        .filter((recommendation) => recommendation.suppressed)
        .map((recommendation) => ({
          targetMuscle: recommendation.targetMuscle,
          candidateExerciseName: recommendation.candidateExerciseName,
          reasons: [...recommendation.suppressionReasons],
          source: "suppressed_recommendation" as const,
        }));
  const overMavTargets = contract.projectedWeekStatus.overMav.map((muscle) => ({
    targetMuscle: muscle,
    candidateExerciseName: null,
    reasons: ["over_mav"],
    source: "projected_week_over_mav" as const,
  }));
  const statusSuppression =
    contract.sessionLocalCoaching.addOnState.status === "blocked" ||
    contract.sessionLocalCoaching.addOnState.status === "deload_suppressed" ||
    contract.sessionLocalCoaching.addOnState.status === "suppressed"
      ? [
          {
            targetMuscle: "all",
            candidateExerciseName: null,
            reasons: [contract.sessionLocalCoaching.addOnState.status],
            source: "add_on_state" as const,
          },
        ]
      : [];

  return [...suppressedRecommendations, ...overMavTargets, ...statusSuppression];
}

export function getCalibrationWatchRows(
  contract: PreSessionReadinessContract
): ReadinessCalibrationWatchRow[] {
  const prescriptionConfidence = contract.calibrationWatches.prescriptionConfidence.map(
    (watch) => toPrescriptionConfidenceWatchRow(watch)
  );

  return [
    ...prescriptionConfidence,
    ...contract.calibrationWatches.recoveryCaveats.map((message) => ({
      kind: "recovery_caveat" as const,
      message,
    })),
    ...contract.calibrationWatches.fatigue.map((message) => ({
      kind: "fatigue" as const,
      message,
    })),
  ];
}

function toPrescriptionConfidenceWatchRow(
  watch: PreSessionReadinessPrescriptionConfidenceWatch
): ReadinessCalibrationWatchRow {
  if (typeof watch === "string") {
    return {
      kind: "prescription_confidence",
      message: watch,
    };
  }

  return {
    kind: "prescription_confidence",
    message: watch.exerciseLabel,
    exerciseLabel: watch.exerciseLabel,
    reasonCode: watch.reasonCode,
    displayActionCode: watch.displayActionCode,
    severity: watch.severity,
    ...(watch.confidence == null ? {} : { confidence: watch.confidence }),
    ...(watch.targetLoad === undefined ? {} : { targetLoad: watch.targetLoad }),
    ...(watch.targetReps === undefined ? {} : { targetReps: watch.targetReps }),
    ...(watch.repRange === undefined ? {} : { repRange: watch.repRange }),
    ...(watch.targetRpe === undefined ? {} : { targetRpe: watch.targetRpe }),
    ...(watch.targetRir === undefined ? {} : { targetRir: watch.targetRir }),
    ...(watch.loadSource === undefined ? {} : { loadSource: watch.loadSource }),
    ...(watch.loadConfidence === undefined
      ? {}
      : { loadConfidence: watch.loadConfidence }),
    ...(watch.cautionLevel === undefined
      ? {}
      : { cautionLevel: watch.cautionLevel }),
    ...(watch.cautionReason === undefined
      ? {}
      : { cautionReason: watch.cautionReason }),
    ...(watch.adjustmentRangeBasis === undefined
      ? {}
      : { adjustmentRangeBasis: watch.adjustmentRangeBasis }),
    ...(watch.suggestedAdjustmentRange === undefined
      ? {}
      : { suggestedAdjustmentRange: watch.suggestedAdjustmentRange }),
    source: watch.source,
  };
}

export function assertReadinessContractConsistency(
  contract: PreSessionReadinessContract
): ReadinessContractConsistencyAssertion {
  const warnings = contract.consistencyChecks.filter(
    (check) => check.status === "warning"
  );
  const failures = contract.consistencyChecks.filter(
    (check) => check.status === "fail"
  );

  return {
    status:
      failures.length > 0
        ? "fail"
        : warnings.length > 0
          ? "warning"
          : "pass",
    warnings,
    failures,
    checks: [...contract.consistencyChecks],
  };
}

export function hasBlockingReadinessIssue(
  contract: PreSessionReadinessContract
): boolean {
  return (
    !contract.startability.safeToTrain ||
    contract.startability.status !== "startable" ||
    contract.projectedWeekStatus.status === "blocked" ||
    assertReadinessContractConsistency(contract).failures.some(
      (check) => check.severity === "error"
    )
  );
}

export function getReadinessGymCard(
  contract: PreSessionReadinessContract
): ReadinessGymCard {
  const startAction = getReadinessStartAction(contract);
  const validOptionalAddOns = getValidOptionalAddOns(contract);
  const suppressedTargets = getSuppressedMusclesOrTargets(contract);
  const calibrationWatches = getCalibrationWatchRows(contract);
  const consistency = assertReadinessContractConsistency(contract);
  const normalStartAction = startAction.canStartNormalSession
    ? startAction.action === "run_deload_seed_as_prescribed"
      ? "run_deload_seed_as_prescribed"
      : "run_seed_as_prescribed"
    : null;

  return {
    ready: startAction.canStartNormalSession,
    primaryAction:
      normalStartAction === "run_deload_seed_as_prescribed"
        ? "start_deload_seed"
        : normalStartAction === "run_seed_as_prescribed"
          ? "start_seed"
          : "resolve_blocker",
    normalStartAction,
    blockerSummary: startAction.blockerSummary,
    activeMesocycleId: contract.nextSessionIdentity.activeMesocycleId,
    currentWeek: contract.nextSessionIdentity.currentWeek,
    currentSession: contract.nextSessionIdentity.currentSession,
    nextSlotId: contract.nextSessionIdentity.nextSlotId,
    nextIntent: contract.nextSessionIdentity.nextIntent,
    existingWorkoutId: contract.nextSessionIdentity.existingWorkoutId,
    existingWorkoutAction: contract.nextSessionIdentity.existingWorkoutAction,
    optionalAddOnStatus: contract.sessionLocalCoaching.addOnState.status,
    validOptionalAddOnCount: validOptionalAddOns.length,
    suppressedTargetCount: suppressedTargets.length,
    calibrationWatchCount: calibrationWatches.length,
    consistencyWarningCount: consistency.warnings.length,
  };
}
