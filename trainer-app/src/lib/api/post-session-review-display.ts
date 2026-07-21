import type {
  PostSessionReviewContract,
  PostSessionReviewExerciseReconciliationRow,
  PostSessionReviewLearningSignal,
  PostSessionReviewNextExposureRow,
  PostSessionReviewPerformedRealityRow,
  PostSessionReviewPerformedRealityTrendGroup,
  PostSessionReviewPrescriptionCalibrationRow,
  PostSessionReviewWeeklyImpactRow,
} from "./post-session-review-contract";
import { getCanonicalNextExposureCopy } from "@/lib/ui/next-exposure-copy";

export type PostSessionReviewDisplayStatus = "reviewed" | "blocked" | "not_ready";

export type PostSessionReviewDisplayCompletion = {
  plannedSetCount: number;
  completedSetCount: number;
  skippedSetCount: number;
  extraSetCount: number;
  missingLogSetCount: number;
  completionPct: number | null;
  label: string;
};

export type PostSessionReviewDisplayExerciseChange = {
  kind:
    | "skipped"
    | "partial"
    | "unlogged"
    | "runtime_added"
    | "added_sets"
    | "replacement_evidence";
  exerciseName: string;
  headline: string;
  detail: string;
  evidenceOnly: true;
};

export type PostSessionReviewDisplayLoadCalibration = {
  exerciseName: string;
  status: "watch" | "info";
  headline: string;
  detail: string;
  nextExposureNote?: string;
  evidenceOnly: true;
};

export type PostSessionReviewDisplayPerformedReality = {
  exerciseName: string;
  status: "info" | "watch";
  label:
    | "Performed as planned"
    | "Under plan"
    | "Over plan"
    | "Needs actuals";
  headline: string;
  detail: string;
  evidenceOnly: true;
};

export type PostSessionReviewDisplayPerformedRealityTrend = {
  status: "info" | "watch";
  label:
    | "Repeated under plan"
    | "Repeated over plan"
    | "Stable as planned"
    | "Missing actuals pattern";
  headline: string;
  detail: string;
  evidenceOnly: true;
};

export type PostSessionReviewDisplayNextExposureNote = {
  exerciseName: string;
  recommendation: string;
  basis: string;
  evidenceOnly: true;
  mutation: false;
};

export type PostSessionReviewDisplayWeeklyImpact = {
  muscle: string;
  headline: string;
  detail: string;
};

export type PostSessionReviewDisplayLearningSignal = {
  label: string;
  severity: "info" | "watch";
  summary: string;
};

export type PostSessionReviewDisplaySource = {
  workoutId?: string;
  userId?: string;
  ownerSeam: "api/post-session-review-display";
  contractOwnerSeam?: string;
  readOnly: true;
  evidenceOnly: true;
  noMutationNote: "No seed or plan changes made";
};

export type PostSessionReviewDisplayDto = {
  status: PostSessionReviewDisplayStatus;
  headline: string;
  summaryBullets: string[];
  completion: PostSessionReviewDisplayCompletion | null;
  exerciseChanges: PostSessionReviewDisplayExerciseChange[];
  performedReality?: PostSessionReviewDisplayPerformedReality[];
  performedRealityTrends?: PostSessionReviewDisplayPerformedRealityTrend[];
  loadCalibration: PostSessionReviewDisplayLoadCalibration[];
  nextExposureNotes: PostSessionReviewDisplayNextExposureNote[];
  weeklyImpact: PostSessionReviewDisplayWeeklyImpact[];
  learningSignals: PostSessionReviewDisplayLearningSignal[];
  warnings: string[];
  source: PostSessionReviewDisplaySource;
};

export type PostSessionReviewBlockedDisplayInput = {
  status: "blocked";
  reason: "not_found_or_unauthorized" | "not_ready" | "invalid_contract" | string;
  message?: string;
};

function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

function roundPct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 100);
}

function formatLoad(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 10) / 10}`
    : "not captured";
}

function formatRepRangeResult(
  row: PostSessionReviewPrescriptionCalibrationRow
): string | null {
  if (row.medianReps == null) {
    return null;
  }

  const repLabel = `${formatLoad(row.medianReps)} median reps`;
  switch (row.repRangeResult) {
    case "below_target":
      return `${repLabel}, below the target rep range`;
    case "above_target":
      return `${repLabel}, above the target rep range`;
    case "in_range":
      return `${repLabel}, in the target rep range`;
    case "unknown":
      return `${repLabel}`;
  }
}

function formatEffortResult(
  row: PostSessionReviewPrescriptionCalibrationRow
): string | null {
  if (row.medianActualRpe == null) {
    return null;
  }

  const rpeLabel = `RPE ${formatLoad(row.medianActualRpe)}`;
  switch (row.effortResult) {
    case "above_target":
      return `${rpeLabel}, harder than target`;
    case "below_target":
      return `${rpeLabel}, easier than target`;
    case "near_target":
      return `${rpeLabel}, near target`;
    case "unknown":
      return rpeLabel;
  }
}

function performedRealityDetail(
  row: PostSessionReviewPrescriptionCalibrationRow
): string {
  const parts = [
    `Performed median load ${formatLoad(row.medianPerformedLoad)} vs target ${formatLoad(row.targetLoad)}`,
    formatRepRangeResult(row),
    formatEffortResult(row),
  ].filter((part): part is string => Boolean(part));

  return `${parts.join("; ")}.`;
}

function buildCompletion(
  contract: PostSessionReviewContract
): PostSessionReviewDisplayCompletion {
  const summary = contract.executionSummary;
  const completionPct = roundPct(
    summary.completedSetCount,
    summary.plannedSetCount + summary.extraSetCount
  );
  return {
    plannedSetCount: summary.plannedSetCount,
    completedSetCount: summary.completedSetCount,
    skippedSetCount: summary.skippedSetCount,
    extraSetCount: summary.extraSetCount,
    missingLogSetCount: summary.missingLogSetCount,
    completionPct,
    label:
      completionPct == null
        ? `${plural(summary.completedSetCount, "set")} logged`
        : `${completionPct}% of planned/session-local work logged`,
  };
}

function buildSummaryBullets(contract: PostSessionReviewContract): string[] {
  const summary = contract.executionSummary;
  if (
    summary.plannedSetCount > 0 &&
    summary.completedSetCount >= summary.plannedSetCount &&
    summary.skippedSetCount === 0 &&
    summary.missingLogSetCount === 0
  ) {
    return [
      summary.extraSetCount > 0
        ? `You completed the planned work and added ${plural(summary.extraSetCount, "extra set")}.`
        : "You completed the planned work with no skipped or unlogged sets.",
    ];
  }

  const exceptions = [
    summary.skippedSetCount > 0
      ? `${plural(summary.skippedSetCount, "planned set")} skipped`
      : null,
    summary.missingLogSetCount > 0
      ? `${plural(summary.missingLogSetCount, "planned set")} unlogged`
      : null,
    summary.extraSetCount > 0
      ? `${plural(summary.extraSetCount, "extra set")} added`
      : null,
  ].filter((part): part is string => part !== null);

  return [
    `${plural(summary.completedSetCount, "performed set")} recorded${
      exceptions.length > 0 ? `; ${exceptions.join(", ")}` : ""
    }.`,
  ];
}

function replacementHeadline(row: PostSessionReviewExerciseReconciliationRow): string {
  const fromName = row.replacement?.fromExerciseName;
  if (fromName) {
    return `Used ${row.exerciseName} instead of ${fromName}`;
  }
  return `${row.exerciseName} was marked as replacement evidence`;
}

function mapExerciseChange(
  row: PostSessionReviewExerciseReconciliationRow
): PostSessionReviewDisplayExerciseChange | null {
  if (row.replacement) {
    return {
      kind: "replacement_evidence",
      exerciseName: row.exerciseName,
      headline: replacementHeadline(row),
      detail: "Captured as evidence only; no automatic exercise or seed change.",
      evidenceOnly: true,
    };
  }

  if (row.runtimeAdded) {
    return {
      kind: "runtime_added",
      exerciseName: row.exerciseName,
      headline: `Added ${row.exerciseName}`,
      detail: `${plural(row.addedSetCount, "session-local set")} performed.`,
      evidenceOnly: true,
    };
  }

  if (row.status === "skipped") {
    return {
      kind: "skipped",
      exerciseName: row.exerciseName,
      headline: `Skipped planned ${row.exerciseName}`,
      detail: `${row.performedSetCount} of ${plural(row.plannedSetCount, "planned set")} performed.`,
      evidenceOnly: true,
    };
  }

  if (row.status === "partial") {
    return {
      kind: "partial",
      exerciseName: row.exerciseName,
      headline: `Partially completed ${row.exerciseName}`,
      detail: `${row.performedSetCount} of ${plural(row.plannedSetCount, "planned set")} performed.`,
      evidenceOnly: true,
    };
  }

  if (row.status === "unlogged") {
    return {
      kind: "unlogged",
      exerciseName: row.exerciseName,
      headline: `${row.exerciseName} has unlogged planned work`,
      detail: `${plural(row.missingLogSetCount, "planned set")} still needs a log or skip mark.`,
      evidenceOnly: true,
    };
  }

  if (row.addedSetCount > 0) {
    return {
      kind: "added_sets",
      exerciseName: row.exerciseName,
      headline: `Added extra ${row.exerciseName} work`,
      detail: `${plural(row.addedSetCount, "session-local set")} performed.`,
      evidenceOnly: true,
    };
  }

  return null;
}

function mapExerciseChanges(
  rows: PostSessionReviewExerciseReconciliationRow[]
): PostSessionReviewDisplayExerciseChange[] {
  return rows
    .map(mapExerciseChange)
    .filter((row): row is PostSessionReviewDisplayExerciseChange => row !== null);
}

function calibrationCopy(
  row: PostSessionReviewPrescriptionCalibrationRow
): Pick<
  PostSessionReviewDisplayLoadCalibration,
  "status" | "headline" | "detail" | "nextExposureNote"
> | null {
  switch (row.classification) {
    case "target_too_high":
      return {
        status: "watch",
        headline: `${row.exerciseName} target looked too heavy`,
        detail: performedRealityDetail(row),
        nextExposureNote: "Next exposure: review the starting point before increasing.",
      };
    case "target_too_low":
      return {
        status: "watch",
        headline: `${row.exerciseName} target looked too light`,
        detail: performedRealityDetail(row),
        nextExposureNote: "Next exposure: raise starting point modestly.",
      };
    case "recalibrated_hold":
      return {
        status: "info",
        headline: `${row.exerciseName} looked recalibrated`,
        detail: "The performed load gives a better starting point for review.",
        nextExposureNote: "Next exposure: hold the recalibrated starting point.",
      };
    case "insufficient_evidence":
      return {
        status: "info",
        headline: `${row.exerciseName} needs more logged evidence`,
        detail: "Target and performed load evidence was not complete enough to judge.",
      };
    case "skipped_or_low_coverage":
      return {
        status: "watch",
        headline: `${row.exerciseName} had low performed coverage`,
        detail: `${row.performedSetCount} of ${plural(row.plannedSetCount, "planned set")} performed.`,
      };
    case "runtime_added":
      return {
        status: "info",
        headline: `${row.exerciseName} was session-local add-on evidence`,
        detail: "Use this as review context only.",
      };
    case "replacement_like":
      return {
        status: "info",
        headline: `${row.exerciseName} was replacement evidence`,
        detail: "Use this as review context only; no automatic exercise change.",
      };
    case "clean":
      return null;
  }
}

function mapLoadCalibration(
  rows: PostSessionReviewPrescriptionCalibrationRow[]
): PostSessionReviewDisplayLoadCalibration[] {
  return rows
    .map((row) => {
      const copy = calibrationCopy(row);
      if (!copy) {
        return null;
      }
      return {
        exerciseName: row.exerciseName,
        ...copy,
        evidenceOnly: true as const,
      };
    })
    .filter((row): row is PostSessionReviewDisplayLoadCalibration => row !== null);
}

function displayPerformedRealityLabel(
  label: PostSessionReviewPerformedRealityRow["label"]
): PostSessionReviewDisplayPerformedReality["label"] {
  switch (label) {
    case "performed_as_planned":
      return "Performed as planned";
    case "under_performed":
      return "Under plan";
    case "over_performed":
      return "Over plan";
    case "missing_actuals":
      return "Needs actuals";
  }
}

function mapPerformedReality(
  rows: PostSessionReviewPerformedRealityRow[]
): PostSessionReviewDisplayPerformedReality[] {
  return rows.map((row) => ({
    exerciseName: row.exerciseName,
    status: row.label === "performed_as_planned" ? "info" : "watch",
    label: displayPerformedRealityLabel(row.label),
    headline: row.headline,
    detail: row.detail,
    evidenceOnly: true,
  }));
}

function trendExerciseLabel(group: PostSessionReviewPerformedRealityTrendGroup): string {
  const uniqueNames = Array.from(
    new Set(group.currentRows.map((row) => row.exerciseName))
  );
  if (uniqueNames.length === 0) {
    return "Recent work";
  }
  if (uniqueNames.length === 1) {
    const suffix = group.currentRowCount > 1 ? ` (${group.currentRowCount} rows)` : "";
    return `${uniqueNames[0]}${suffix}`;
  }
  return `${uniqueNames.slice(0, 2).join(", ")}${
    uniqueNames.length > 2 ? ` +${uniqueNames.length - 2} more` : ""
  }`;
}

function trendCopy(group: PostSessionReviewPerformedRealityTrendGroup): Pick<
  PostSessionReviewDisplayPerformedRealityTrend,
  "status" | "label" | "headline" | "detail"
> {
  const exerciseLabel = trendExerciseLabel(group);
  const exposureCopy = `${plural(group.priorExposureCount, "recent row")} in the last ${group.lookbackWorkoutLimit} eligible exposure(s)`;

  switch (group.kind) {
    case "repeated_underperformance":
      return {
        status: "watch",
        label: "Repeated under plan",
        headline: `${exerciseLabel} has repeated under-plan evidence`,
        detail: `${exposureCopy} also came in under plan. Review evidence only; no automatic plan change.`,
      };
    case "repeated_overperformance":
      return {
        status: "watch",
        label: "Repeated over plan",
        headline: `${exerciseLabel} has repeated over-plan evidence`,
        detail: `${exposureCopy} also exceeded plan. Review evidence only; no automatic plan change.`,
      };
    case "stable_as_planned":
      return {
        status: "info",
        label: "Stable as planned",
        headline: `${exerciseLabel} is tracking as planned`,
        detail: `${exposureCopy} also matched plan. Review evidence only; no automatic plan change.`,
      };
    case "missing_actuals_pattern":
      return {
        status: "watch",
        label: "Missing actuals pattern",
        headline: `${exerciseLabel} has a missing-actuals pattern`,
        detail: `${exposureCopy} also needed actuals. Review evidence only; no automatic plan change.`,
      };
  }
}

function mapPerformedRealityTrends(
  groups: PostSessionReviewPerformedRealityTrendGroup[]
): PostSessionReviewDisplayPerformedRealityTrend[] {
  return groups.map((group) => ({
    ...trendCopy(group),
    evidenceOnly: true,
  }));
}

function mapNextExposure(
  rows: PostSessionReviewNextExposureRow[]
): PostSessionReviewDisplayNextExposureNote[] {
  return rows.map((row) => ({
    exerciseName: row.exerciseName ?? row.exerciseId,
    recommendation: getCanonicalNextExposureCopy(row.action).nextTimeImperative,
    basis: "Based on the saved reps, effort, and comparable-session evidence.",
    evidenceOnly: true,
    mutation: false,
  }));
}

function weeklyStatusLabel(row: PostSessionReviewWeeklyImpactRow): string {
  switch (row.status) {
    case "UNDER_MEV":
      return "below minimum effective volume";
    case "APPROACHING_TARGET":
      return "approaching weekly target";
    case "ON_TARGET":
      return "on weekly target";
    case "OVER_TARGET":
      return "above weekly target";
    case "APPROACHING_MAV":
      return "near weekly cap";
    case "AT_MAV":
      return "at weekly cap";
    case "OVER_MAV":
      return "over weekly cap";
  }
}

function mapWeeklyImpact(
  rows: PostSessionReviewWeeklyImpactRow[] | undefined
): PostSessionReviewDisplayWeeklyImpact[] {
  return (rows ?? []).map((row) => ({
    muscle: row.muscle,
    headline: `${row.muscle} is ${weeklyStatusLabel(row)}`,
    detail: `${row.projectedEffectiveVolume} effective sets this week against a target of ${row.weeklyTarget}.`,
  }));
}

function learningSignalCopy(signal: PostSessionReviewLearningSignal): {
  label: string;
  summary: string;
} {
  switch (signal.kind) {
    case "performed_set_signal":
      return {
        label: "Logged performance",
        summary: "Performed set evidence is available for review.",
      };
    case "skipped_set_signal":
      return {
        label: "Skipped work",
        summary: "Skipped planned work is available as review evidence.",
      };
    case "runtime_edit_signal":
      return {
        label: "Runtime edits",
        summary: "Session-local exercise changes are review evidence only.",
      };
    case "next_exposure_signal":
      return {
        label: "Next exposure",
        summary: "Next-exposure notes are recommendations, not mutations.",
      };
    case "calibration_signal":
      return {
        label: "Load calibration",
        summary: signal.summary,
      };
    case "weekly_volume_signal":
      return {
        label: "Weekly impact",
        summary: "Weekly volume impact is available for review.",
      };
    case "session_semantics_signal":
      return {
        label: "Session meaning",
        summary: "Session classification is available as review context.",
      };
  }
}

function mapLearningSignals(
  signals: PostSessionReviewLearningSignal[]
): PostSessionReviewDisplayLearningSignal[] {
  return signals.map((signal) => ({
    severity: signal.severity,
    ...learningSignalCopy(signal),
  }));
}

function consistencyWarning(message: string): string {
  if (message.includes("not a terminal performed status")) {
    return "Workout is not completed or partial enough for review.";
  }
  if (message.includes("source truth is missing")) {
    return "Some review source evidence is missing.";
  }
  if (message.includes("mutation or generation impact")) {
    return "Review source boundaries did not stay read-only.";
  }
  return "Review evidence needs manual attention.";
}

function mapWarnings(contract: PostSessionReviewContract): string[] {
  const warnings = contract.consistencyChecks
    .filter((check) => check.status !== "pass")
    .map((check) => consistencyWarning(check.message));

  for (const row of contract.exerciseReconciliation.rows) {
    if (row.replacement) {
      warnings.push(
        row.replacement.fromExerciseName
          ? `${row.exerciseName} replaced ${row.replacement.fromExerciseName} for this session.`
          : `${row.exerciseName} was recorded as a session replacement.`
      );
    } else if (row.runtimeAdded) {
      warnings.push(`${row.exerciseName} was added for this session.`);
    } else if (row.status === "skipped") {
      warnings.push(`${row.exerciseName} was skipped.`);
    } else if (row.status === "partial") {
      warnings.push(`${row.exerciseName} was only partially completed.`);
    } else if (row.status === "unlogged") {
      warnings.push(`${row.exerciseName} still has unlogged planned work.`);
    } else if (row.addedSetCount > 0) {
      warnings.push(`${row.exerciseName} included ${plural(row.addedSetCount, "extra set")}.`);
    }
  }

  for (const row of contract.prescriptionCalibration.rows) {
    if (row.classification === "target_too_high") {
      warnings.push(`${row.exerciseName} may have been prescribed too heavy.`);
    } else if (row.classification === "target_too_low") {
      warnings.push(`${row.exerciseName} may have been prescribed too light.`);
    } else if (row.classification === "skipped_or_low_coverage") {
      warnings.push(`${row.exerciseName} has too little performed work for a confident read.`);
    }
  }

  for (const trend of contract.performedReality.trendGroups) {
    const exerciseLabel = trendExerciseLabel(trend);
    if (trend.kind === "repeated_underperformance") {
      warnings.push(`${exerciseLabel} has repeatedly come in under plan.`);
    } else if (trend.kind === "repeated_overperformance") {
      warnings.push(`${exerciseLabel} has repeatedly exceeded plan.`);
    } else if (trend.kind === "missing_actuals_pattern") {
      warnings.push(`${exerciseLabel} has a repeated missing-actuals pattern.`);
    }
  }

  return Array.from(new Set(warnings));
}

function hasMixedOutcome(contract: PostSessionReviewContract): boolean {
  const summary = contract.executionSummary;
  return (
    contract.workoutIdentity.status === "PARTIAL" ||
    summary.skippedSetCount > 0 ||
    summary.missingLogSetCount > 0 ||
    contract.exerciseReconciliation.rows.some((row) =>
      ["skipped", "partial", "unlogged"].includes(row.status)
    ) ||
    contract.performedReality.rows.some((row) => row.label !== "performed_as_planned") ||
    contract.consistencyChecks.some((check) => check.status !== "pass")
  );
}

function hasFailingConsistencyCheck(contract: PostSessionReviewContract): boolean {
  return contract.consistencyChecks.some((check) => check.status === "fail");
}

export function adaptPostSessionReviewContractToDisplay(
  contract: PostSessionReviewContract
): PostSessionReviewDisplayDto {
  const status: PostSessionReviewDisplayStatus = hasFailingConsistencyCheck(contract)
    ? "blocked"
    : "reviewed";

  return {
    status,
    headline:
      status === "reviewed"
        ? hasMixedOutcome(contract)
          ? "Mixed session"
          : "Good session"
        : "Post-session review needs source review",
    summaryBullets: buildSummaryBullets(contract),
    completion: buildCompletion(contract),
    exerciseChanges: mapExerciseChanges(contract.exerciseReconciliation.rows),
    performedReality: mapPerformedReality(contract.performedReality.rows),
    performedRealityTrends: mapPerformedRealityTrends(
      contract.performedReality.trendGroups
    ),
    loadCalibration: mapLoadCalibration(contract.prescriptionCalibration.rows),
    nextExposureNotes: mapNextExposure(contract.nextExposure.rows),
    weeklyImpact: mapWeeklyImpact(contract.weeklyImpact?.rows),
    learningSignals: mapLearningSignals(contract.learningSignals),
    warnings: mapWarnings(contract),
    source: {
      workoutId: contract.workoutIdentity.workoutId,
      userId: contract.workoutIdentity.userId,
      ownerSeam: "api/post-session-review-display",
      contractOwnerSeam: contract.scope.ownerSeam,
      readOnly: true,
      evidenceOnly: true,
      noMutationNote: "No seed or plan changes made",
    },
  };
}

export function adaptBlockedPostSessionReviewToDisplay(
  input: PostSessionReviewBlockedDisplayInput
): PostSessionReviewDisplayDto {
  const notReady = input.reason === "not_ready";
  return {
    status: notReady ? "not_ready" : "blocked",
    headline: notReady
      ? "Post-session review is not ready"
      : "Post-session review unavailable",
    summaryBullets: ["No seed or plan changes made"],
    completion: null,
    exerciseChanges: [],
    performedReality: [],
    performedRealityTrends: [],
    loadCalibration: [],
    nextExposureNotes: [],
    weeklyImpact: [],
    learningSignals: [],
    warnings: [
      input.message ??
        (notReady
          ? "Workout needs to be completed or partially completed first."
          : "Review source evidence could not be prepared safely."),
    ],
    source: {
      ownerSeam: "api/post-session-review-display",
      readOnly: true,
      evidenceOnly: true,
      noMutationNote: "No seed or plan changes made",
    },
  };
}
