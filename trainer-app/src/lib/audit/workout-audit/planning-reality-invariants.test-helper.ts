type PlanningRealityForForbiddenInvariant = {
  finalSlotPlan?: ReadonlyArray<{
    slotId: string;
    exercises: ReadonlyArray<{
      exerciseId: string;
      exerciseName: string;
      primaryMuscles?: ReadonlyArray<string>;
    }>;
  }>;
  slotPrescriptionIntents?: ReadonlyArray<{
    slotId: string;
    musclePrescriptions: ReadonlyArray<{
      muscle: string;
      targetStatus: string;
      demandType: string;
    }>;
  }>;
};

type DistributionGuardActionForInvariant = {
  slotId: string;
  exerciseName: string;
  muscle: string;
  attemptedAction: string;
  decision: string;
  reason?: string | null;
  alternativeExerciseName?: string | null;
};

type PlanningRealityForDistributionGuardInvariant = {
  distributionGuardActions?: ReadonlyArray<DistributionGuardActionForInvariant>;
  setDistributionIntents?: ReadonlyArray<{
    slotId: string;
    musclePolicies?: ReadonlyArray<{
      muscle: string;
      maxSingleExerciseShare?: number | null;
      maxSinglePatternShare?: number | null;
      whenAtLimit?: string | null;
    }>;
    evidence?: {
      concentrationRows?: ReadonlyArray<string>;
      capCleanupRows?: ReadonlyArray<string>;
      repairRowsStillRepairOwned?: ReadonlyArray<string>;
    };
  }>;
  exerciseConcentration?: ReadonlyArray<{
    slotId: string;
    exerciseName: string;
    primaryMuscles?: ReadonlyArray<string>;
    effectiveStimulusContributionByMuscle?: Record<string, number>;
    percentageOfWeeklyProjectedStimulusByMuscle?: Record<string, number>;
    flags?: ReadonlyArray<string>;
  }>;
  repairMaterialityAfterShadowAllocation?: ReadonlyArray<{
    slotId?: string | null;
    muscle?: string | null;
    exerciseName?: string | null;
    action?: string | null;
    shadowAllocationBasis?: string | null;
  }>;
  slotPrescriptionIntents?: ReadonlyArray<{
    slotId: string;
    diagnostic?: {
      blockedRepairs?: ReadonlyArray<string>;
      priorRepairsStillRepairOwned?: ReadonlyArray<string>;
    };
    musclePrescriptions?: ReadonlyArray<{
      muscle: string;
      collateralLimits?: ReadonlyArray<{
        muscle: string;
      }>;
      reasons?: ReadonlyArray<string>;
    }>;
  }>;
};

export type FinalSlotForbiddenPrescriptionViolation = {
  slotId: string;
  muscle: string;
  exerciseId: string;
  exerciseName: string;
};

export type DistributionGuardActionInvariantViolation = {
  code:
    | "reroute_missing_alternative"
    | "reroute_to_same_exercise"
    | "left_unresolved_has_alternative"
    | "left_unresolved_missing_reason"
    | "duplicate_distribution_guard_action"
    | "transient_distribution_guard_attempt_leaked"
    | "untraceable_distribution_guard_action";
  slotId: string;
  exerciseName: string;
  muscle: string;
  attemptedAction: string;
  reason: string | null;
  decision: string;
  alternativeExerciseName: string | null;
};

export type ProjectionBehaviorTrialGateMetrics = {
  materialRepairCount: number;
  majorRepairCount: number;
  suspiciousRepairCount: number;
  highExerciseConcentrationCount: number;
  weakPreselectionConsumptionCount: number;
  forbiddenFinalPrimaryViolationCount: number;
};

export type ProjectionBehaviorTrialGateInput = {
  baseline: ProjectionBehaviorTrialGateMetrics;
  trial: ProjectionBehaviorTrialGateMetrics;
  intendedImprovement?: {
    metric: string;
    baselineValue: number;
    trialValue: number;
    direction: "increase" | "decrease";
  };
};

export type ProjectionBehaviorTrialGateResult = {
  decision: "keep_candidate" | "revert_candidate";
  failedReasons: string[];
  improvedSignals: string[];
};

type PlanningRealityForProjectionBehaviorTrialGate =
  PlanningRealityForForbiddenInvariant & {
    summary?: {
      materialRepairCount?: number;
      majorRepairCount?: number;
      highExerciseConcentrationCount?: number;
    };
    suspiciousRepairsNotEligibleForPromotion?: ReadonlyArray<unknown>;
    weakPreselectionConsumption?: ReadonlyArray<unknown>;
  };

const CLEAR_LEFT_UNRESOLVED_REASONS = new Set([
  "single_exercise_share_limit",
  "single_pattern_share_limit",
  "cap_cleanup_risk",
  "collateral_risk",
  "no_clean_alternative",
]);

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function baseDistributionGuardKey(
  action: DistributionGuardActionForInvariant,
): string {
  return [
    action.slotId,
    action.exerciseName,
    action.muscle,
    action.attemptedAction,
    action.reason ?? "",
  ].join("\u0000");
}

function finalDistributionGuardKey(
  action: DistributionGuardActionForInvariant,
): string {
  return [
    baseDistributionGuardKey(action),
    action.decision,
    action.alternativeExerciseName ?? "",
  ].join("\u0000");
}

function toDistributionGuardViolation(
  code: DistributionGuardActionInvariantViolation["code"],
  action: DistributionGuardActionForInvariant,
): DistributionGuardActionInvariantViolation {
  return {
    code,
    slotId: action.slotId,
    exerciseName: action.exerciseName,
    muscle: action.muscle,
    attemptedAction: action.attemptedAction,
    reason: normalizeNullableText(action.reason),
    decision: action.decision,
    alternativeExerciseName: normalizeNullableText(
      action.alternativeExerciseName,
    ),
  };
}

function evidenceRowsIncludeAction(
  rows: ReadonlyArray<string>,
  action: DistributionGuardActionForInvariant,
): boolean {
  return rows.some(
    (row) =>
      row.includes(action.slotId) &&
      row.includes(action.exerciseName) &&
      row.includes(action.muscle),
  );
}

function hasSetDistributionPolicyOrEvidence(
  planningReality: PlanningRealityForDistributionGuardInvariant,
  action: DistributionGuardActionForInvariant,
): boolean {
  return (planningReality.setDistributionIntents ?? []).some((intent) => {
    if (intent.slotId !== action.slotId) {
      return false;
    }
    const policyMatch = (intent.musclePolicies ?? []).some(
      (policy) =>
        policy.muscle === action.muscle &&
        (policy.maxSingleExerciseShare != null ||
          policy.maxSinglePatternShare != null ||
          policy.whenAtLimit === "prefer_alternative" ||
          policy.whenAtLimit === "do_not_bump" ||
          policy.whenAtLimit === "leave_unresolved"),
    );
    const evidence = intent.evidence;
    const evidenceMatch =
      evidenceRowsIncludeAction(evidence?.concentrationRows ?? [], action) ||
      evidenceRowsIncludeAction(evidence?.capCleanupRows ?? [], action) ||
      evidenceRowsIncludeAction(
        evidence?.repairRowsStillRepairOwned ?? [],
        action,
      );

    return policyMatch || evidenceMatch;
  });
}

function hasExerciseConcentrationEvidence(
  planningReality: PlanningRealityForDistributionGuardInvariant,
  action: DistributionGuardActionForInvariant,
): boolean {
  return (planningReality.exerciseConcentration ?? []).some(
    (row) =>
      row.slotId === action.slotId &&
      row.exerciseName === action.exerciseName &&
      ((row.primaryMuscles ?? []).includes(action.muscle) ||
        row.effectiveStimulusContributionByMuscle?.[action.muscle] != null ||
        row.percentageOfWeeklyProjectedStimulusByMuscle?.[action.muscle] !=
          null ||
        (row.flags ?? []).some((flag) => flag.includes("CONCENTRATION"))),
  );
}

function hasCapCleanupOrCollateralEvidence(
  planningReality: PlanningRealityForDistributionGuardInvariant,
  action: DistributionGuardActionForInvariant,
): boolean {
  if (
    action.reason === "cap_cleanup_risk" ||
    action.reason === "collateral_risk"
  ) {
    return true;
  }

  const repairEvidence = (
    planningReality.repairMaterialityAfterShadowAllocation ?? []
  ).some(
    (row) =>
      row.slotId === action.slotId &&
      row.muscle === action.muscle &&
      (row.exerciseName == null || row.exerciseName === action.exerciseName) &&
      (row.action === "set_trimmed" ||
        row.action === "removed" ||
        row.shadowAllocationBasis === "diagnostic_or_cap_cleanup"),
  );
  if (repairEvidence) {
    return true;
  }

  return (planningReality.slotPrescriptionIntents ?? []).some((intent) => {
    if (intent.slotId !== action.slotId) {
      return false;
    }
    const diagnosticRows = [
      ...(intent.diagnostic?.blockedRepairs ?? []),
      ...(intent.diagnostic?.priorRepairsStillRepairOwned ?? []),
    ];
    if (evidenceRowsIncludeAction(diagnosticRows, action)) {
      return true;
    }
    return (intent.musclePrescriptions ?? []).some(
      (prescription) =>
        prescription.muscle === action.muscle &&
        ((prescription.collateralLimits ?? []).length > 0 ||
          (prescription.reasons ?? []).some(
            (reason) => reason.includes("cap") || reason.includes("collateral"),
          )),
    );
  });
}

function isIntendedImprovementMet(
  improvement: ProjectionBehaviorTrialGateInput["intendedImprovement"],
): boolean {
  if (!improvement) {
    return false;
  }

  return improvement.direction === "increase"
    ? improvement.trialValue > improvement.baselineValue
    : improvement.trialValue < improvement.baselineValue;
}

function formatDelta(name: string, baseline: number, trial: number): string {
  return `${name}:${baseline}->${trial}`;
}

export function buildProjectionBehaviorTrialGateMetricsFromPlanningReality(
  planningReality:
    | PlanningRealityForProjectionBehaviorTrialGate
    | null
    | undefined,
): ProjectionBehaviorTrialGateMetrics {
  return {
    materialRepairCount: planningReality?.summary?.materialRepairCount ?? 0,
    majorRepairCount: planningReality?.summary?.majorRepairCount ?? 0,
    suspiciousRepairCount:
      planningReality?.suspiciousRepairsNotEligibleForPromotion?.length ?? 0,
    highExerciseConcentrationCount:
      planningReality?.summary?.highExerciseConcentrationCount ?? 0,
    weakPreselectionConsumptionCount:
      planningReality?.weakPreselectionConsumption?.length ?? 0,
    forbiddenFinalPrimaryViolationCount:
      findFinalSlotForbiddenPrescriptionViolations(planningReality).length,
  };
}

export function evaluateProjectionBehaviorTrialGate(
  input: ProjectionBehaviorTrialGateInput,
): ProjectionBehaviorTrialGateResult {
  const failedReasons: string[] = [];
  const improvedSignals: string[] = [];

  if (input.intendedImprovement) {
    const { metric, baselineValue, trialValue, direction } =
      input.intendedImprovement;
    const signal = formatDelta(metric, baselineValue, trialValue);

    if (isIntendedImprovementMet(input.intendedImprovement)) {
      improvedSignals.push(`${signal}:improved`);
    } else {
      failedReasons.push(`${signal}:not_improved:${direction}`);
    }
  } else {
    failedReasons.push("intendedImprovement:missing");
  }

  const protectedMetrics: Array<keyof ProjectionBehaviorTrialGateMetrics> = [
    "materialRepairCount",
    "majorRepairCount",
    "suspiciousRepairCount",
    "highExerciseConcentrationCount",
    "weakPreselectionConsumptionCount",
    "forbiddenFinalPrimaryViolationCount",
  ];

  for (const metric of protectedMetrics) {
    const baselineValue = input.baseline[metric];
    const trialValue = input.trial[metric];
    const signal = formatDelta(metric, baselineValue, trialValue);

    if (trialValue > baselineValue) {
      failedReasons.push(`${signal}:regressed`);
    } else if (trialValue < baselineValue) {
      improvedSignals.push(`${signal}:improved`);
    }
  }

  return {
    decision: failedReasons.length === 0 ? "keep_candidate" : "revert_candidate",
    failedReasons,
    improvedSignals,
  };
}

export function findFinalSlotForbiddenPrescriptionViolations(
  planningReality: PlanningRealityForForbiddenInvariant | null | undefined,
): FinalSlotForbiddenPrescriptionViolation[] {
  const finalSlotById = new Map(
    (planningReality?.finalSlotPlan ?? []).map((slot) => [slot.slotId, slot]),
  );

  return (planningReality?.slotPrescriptionIntents ?? []).flatMap((intent) => {
    const forbiddenMuscles = new Set(
      intent.musclePrescriptions
        .filter(
          (prescription) =>
            prescription.targetStatus === "forbidden" &&
            prescription.demandType === "do_not_train_here",
        )
        .map((prescription) => prescription.muscle),
    );
    if (forbiddenMuscles.size === 0) {
      return [];
    }

    const finalSlot = finalSlotById.get(intent.slotId);
    return (finalSlot?.exercises ?? []).flatMap((exercise) =>
      (exercise.primaryMuscles ?? [])
        .filter((muscle) => forbiddenMuscles.has(muscle))
        .map((muscle) => ({
          slotId: intent.slotId,
          muscle,
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exerciseName,
        })),
    );
  });
}

export function findDistributionGuardActionInvariantViolations(
  planningReality:
    | PlanningRealityForDistributionGuardInvariant
    | null
    | undefined,
): DistributionGuardActionInvariantViolation[] {
  const actions = planningReality?.distributionGuardActions ?? [];
  const reality = planningReality ?? {};
  const violations: DistributionGuardActionInvariantViolation[] = [];
  const seenFinalRows = new Set<string>();
  const decisionsByBaseKey = new Map<string, Set<string>>();

  for (const action of actions) {
    const alternativeExerciseName = normalizeNullableText(
      action.alternativeExerciseName,
    );
    const reason = normalizeNullableText(action.reason);

    if (action.decision === "rerouted") {
      if (!alternativeExerciseName) {
        violations.push(
          toDistributionGuardViolation("reroute_missing_alternative", action),
        );
      } else if (alternativeExerciseName === action.exerciseName) {
        violations.push(
          toDistributionGuardViolation("reroute_to_same_exercise", action),
        );
      }
    }

    if (action.decision === "left_unresolved") {
      if (alternativeExerciseName) {
        violations.push(
          toDistributionGuardViolation(
            "left_unresolved_has_alternative",
            action,
          ),
        );
      }
      if (!reason || !CLEAR_LEFT_UNRESOLVED_REASONS.has(reason)) {
        violations.push(
          toDistributionGuardViolation(
            "left_unresolved_missing_reason",
            action,
          ),
        );
      }
    }

    const finalKey = finalDistributionGuardKey(action);
    if (seenFinalRows.has(finalKey)) {
      violations.push(
        toDistributionGuardViolation(
          "duplicate_distribution_guard_action",
          action,
        ),
      );
    }
    seenFinalRows.add(finalKey);

    const baseKey = baseDistributionGuardKey(action);
    const decisions = decisionsByBaseKey.get(baseKey) ?? new Set<string>();
    decisions.add(action.decision);
    decisionsByBaseKey.set(baseKey, decisions);

    const traceable =
      hasSetDistributionPolicyOrEvidence(reality, action) ||
      hasExerciseConcentrationEvidence(reality, action) ||
      hasCapCleanupOrCollateralEvidence(reality, action);
    if (!traceable) {
      violations.push(
        toDistributionGuardViolation(
          "untraceable_distribution_guard_action",
          action,
        ),
      );
    }
  }

  for (const action of actions) {
    const decisions = decisionsByBaseKey.get(baseDistributionGuardKey(action));
    if (
      action.decision === "blocked" &&
      decisions &&
      (decisions.has("rerouted") || decisions.has("left_unresolved"))
    ) {
      violations.push(
        toDistributionGuardViolation(
          "transient_distribution_guard_attempt_leaked",
          action,
        ),
      );
    }
  }

  return violations;
}
