import {
  POST_SESSION_REVIEW_CONTRACT_OWNER_SEAM,
  type PostSessionReviewCalibrationClassification,
  type PostSessionReviewConsistencyCheck,
  type PostSessionReviewContract,
  type PostSessionReviewExerciseReconciliationRow,
  type PostSessionReviewExecutionSummary,
  type PostSessionReviewLearningSignal,
  type PostSessionReviewPerformedRealityRow,
  type PostSessionReviewPerformedRealityTrendGroup,
  type PostSessionReviewPrescriptionCalibrationRow,
  type PostSessionReviewRecentExposureCalibrationSummaryRow,
} from "./post-session-review-contract";
import type {
  PostSessionReviewContractBuildInput,
  PostSessionReviewExerciseEvidence,
  PostSessionReviewNextExposureEvidence,
  PostSessionReviewRecentExerciseExposureEvidence,
  PostSessionReviewSetEvidence,
} from "./post-session-review-evidence";

const RECENT_EXPOSURE_LOOKBACK_WORKOUT_LIMIT = 3;

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle] ?? null;
}

function isPlannedSet(
  exercise: PostSessionReviewExerciseEvidence,
  set: PostSessionReviewSetEvidence
): boolean {
  return exercise.isRuntimeAdded !== true && set.isRuntimeAdded !== true;
}

function isPerformedSet(set: PostSessionReviewSetEvidence): boolean {
  return set.wasLogged && !set.wasSkipped;
}

function isWorkSet(set: PostSessionReviewSetEvidence): boolean {
  return set.setIntent !== "WARMUP";
}

function isPerformedWorkSet(set: PostSessionReviewSetEvidence): boolean {
  return isPerformedSet(set) && isWorkSet(set);
}

function getPlannedSets(exercise: PostSessionReviewExerciseEvidence) {
  return exercise.sets.filter((set) => isPlannedSet(exercise, set));
}

function getAddedSets(exercise: PostSessionReviewExerciseEvidence) {
  return exercise.sets.filter((set) => !isPlannedSet(exercise, set));
}

function getCalibrationSets(exercise: PostSessionReviewExerciseEvidence) {
  const candidateSets =
    exercise.isRuntimeAdded === true ? exercise.sets : getPlannedSets(exercise);
  return candidateSets.filter(isWorkSet);
}

function countPerformed(sets: PostSessionReviewSetEvidence[]): number {
  return sets.filter(isPerformedSet).length;
}

function countPerformedWorkSets(sets: PostSessionReviewSetEvidence[]): number {
  return sets.filter(isPerformedWorkSet).length;
}

function countSkipped(sets: PostSessionReviewSetEvidence[]): number {
  return sets.filter((set) => set.wasLogged && set.wasSkipped).length;
}

function countMissingLogs(sets: PostSessionReviewSetEvidence[]): number {
  return sets.filter((set) => !set.wasLogged).length;
}

function resolveTargetLoad(sets: PostSessionReviewSetEvidence[]): number | null {
  const targetLoads = sets
    .map((set) => set.targetLoad)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return median(targetLoads);
}

function resolveTargetRpe(sets: PostSessionReviewSetEvidence[]): number | null {
  const targetRpes = sets
    .map((set) => set.targetRpe)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return median(targetRpes);
}

function resolveTargetRepRange(
  sets: PostSessionReviewSetEvidence[]
): { min: number | null; max: number | null } {
  const ranges = sets
    .map((set) => {
      if (
        typeof set.targetRepMin === "number" &&
        Number.isFinite(set.targetRepMin) &&
        typeof set.targetRepMax === "number" &&
        Number.isFinite(set.targetRepMax)
      ) {
        return { min: set.targetRepMin, max: set.targetRepMax };
      }
      if (typeof set.targetReps === "number" && Number.isFinite(set.targetReps)) {
        return { min: set.targetReps, max: set.targetReps };
      }
      return null;
    })
    .filter((range): range is { min: number; max: number } => range !== null);

  return {
    min: median(ranges.map((range) => range.min)),
    max: median(ranges.map((range) => range.max)),
  };
}

function summarizePerformedLoad(sets: PostSessionReviewSetEvidence[]) {
  const performed = sets.filter(isPerformedSet);
  const performedLoads = performed
    .map((set) => set.actualLoad)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const performedReps = performed
    .map((set) => set.actualReps)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const performedRpes = performed
    .map((set) => set.actualRpe)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    medianLoad: median(performedLoads),
    anchorLoad: performedLoads.length > 0 ? Math.max(...performedLoads) : null,
    medianReps: median(performedReps),
    medianRpe: median(performedRpes),
  };
}

function classifyCalibration(input: {
  exercise: PostSessionReviewExerciseEvidence;
  plannedSetCount: number;
  performedSetCount: number;
  skippedSetCount: number;
  addedSetCount: number;
  targetLoad: number | null;
  medianPerformedLoad: number | null;
  loadDeltaPct: number | null;
  medianReps: number | null;
  lowerRepTarget: number | null;
  upperRepTarget: number | null;
  targetRpe: number | null;
  medianActualRpe: number | null;
  nextExposureDecision?: PostSessionReviewNextExposureEvidence["decision"];
}): Pick<
  PostSessionReviewPrescriptionCalibrationRow,
  "classification" | "reasonCodes" | "notes"
> {
  if (input.exercise.replacement) {
    return {
      classification: "replacement_like",
      reasonCodes: ["replacement_like"],
      notes: [
        `replacement_source:${input.exercise.replacement.source}`,
        "seed_mutation:no",
        "policy_mutation:no",
      ],
    };
  }

  if (input.exercise.isRuntimeAdded === true || input.plannedSetCount === 0) {
    return {
      classification: "runtime_added",
      reasonCodes: ["runtime_added_session_local"],
      notes: ["runtime_added_evidence_only", "seed_mutation:no"],
    };
  }

  const coverage =
    input.plannedSetCount > 0 ? input.performedSetCount / input.plannedSetCount : null;
  if (
    input.plannedSetCount > 0 &&
    (input.performedSetCount === 0 ||
      (coverage != null && coverage < 0.5) ||
      input.skippedSetCount >= Math.ceil(input.plannedSetCount / 2))
  ) {
    return {
      classification: "skipped_or_low_coverage",
      reasonCodes: [
        "planned_exercise_low_performed_coverage",
        ...(input.skippedSetCount > 0 ? ["skipped_sets_present"] : []),
      ],
      notes: [
        `coverage:${coverage == null ? "n/a" : roundToTenth(coverage * 100)}%`,
        `skipped_sets:${input.skippedSetCount}`,
      ],
    };
  }

  const repsBelowTarget =
    typeof input.medianReps === "number" &&
    typeof input.lowerRepTarget === "number" &&
    input.medianReps < input.lowerRepTarget - 1;
  const repsAboveTarget =
    typeof input.medianReps === "number" &&
    typeof input.upperRepTarget === "number" &&
    input.medianReps > input.upperRepTarget + 1;
  const effortAboveTarget =
    typeof input.medianActualRpe === "number" &&
    typeof input.targetRpe === "number" &&
    input.medianActualRpe > input.targetRpe + 1;
  const effortBelowTarget =
    typeof input.medianActualRpe === "number" &&
    typeof input.targetRpe === "number" &&
    input.medianActualRpe < input.targetRpe - 1;

  if (
    typeof input.targetLoad !== "number" ||
    typeof input.medianPerformedLoad !== "number" ||
    typeof input.loadDeltaPct !== "number"
  ) {
    return {
      classification: "insufficient_evidence",
      reasonCodes: ["missing_target_or_performed_load"],
      notes: [
        `target_load:${input.targetLoad ?? "missing"}`,
        `median_load:${input.medianPerformedLoad ?? "missing"}`,
      ],
    };
  }

  if (input.nextExposureDecision?.action === "target_too_high") {
    return {
      classification: "target_too_high",
      reasonCodes: ["next_exposure_target_too_high"],
      notes: [
        `next_exposure_action:${input.nextExposureDecision.action}`,
        `load_delta_pct:${input.loadDeltaPct}`,
        ...(typeof input.nextExposureDecision.anchorLoad === "number"
          ? [`next_exposure_anchor_load:${input.nextExposureDecision.anchorLoad}`]
          : []),
      ],
    };
  }

  if (input.loadDeltaPct <= -15 || repsBelowTarget || effortAboveTarget) {
    return {
      classification: "target_too_high",
      reasonCodes: [
        ...(input.loadDeltaPct <= -15
          ? ["performed_load_materially_below_target"]
          : []),
        ...(repsBelowTarget ? ["median_reps_below_target"] : []),
        ...(effortAboveTarget ? ["median_rpe_above_target"] : []),
      ],
      notes: [
        `load_delta_pct:${input.loadDeltaPct}`,
        ...(typeof input.medianActualRpe === "number"
          ? [`median_rpe:${input.medianActualRpe}`]
          : []),
      ],
    };
  }

  if ((input.loadDeltaPct >= 15 || (repsAboveTarget && effortBelowTarget)) && !repsBelowTarget) {
    return {
      classification: "target_too_low",
      reasonCodes: [
        ...(input.loadDeltaPct >= 15
          ? ["performed_load_materially_above_target"]
          : []),
        ...(repsAboveTarget ? ["median_reps_above_target"] : []),
        ...(effortBelowTarget ? ["median_rpe_below_target"] : []),
      ],
      notes: [
        `load_delta_pct:${input.loadDeltaPct}`,
        ...(typeof input.medianActualRpe === "number"
          ? [`median_rpe:${input.medianActualRpe}`]
          : []),
      ],
    };
  }

  if (input.nextExposureDecision?.action === "hold_at_recalibrated_anchor") {
    return {
      classification: "recalibrated_hold",
      reasonCodes: ["next_exposure_recalibrated_hold"],
      notes: [
        `next_exposure_action:${input.nextExposureDecision.action}`,
        `load_delta_pct:${input.loadDeltaPct}`,
        ...(typeof input.nextExposureDecision.anchorLoad === "number"
          ? [`next_exposure_anchor_load:${input.nextExposureDecision.anchorLoad}`]
          : []),
      ],
    };
  }

  return {
    classification: "clean",
    reasonCodes: ["performed_load_within_target_band"],
    notes: [
      `load_delta_pct:${input.loadDeltaPct}`,
      ...(input.addedSetCount > 0 ? [`added_sets:${input.addedSetCount}`] : []),
      ...(input.skippedSetCount > 0 ? [`skipped_sets:${input.skippedSetCount}`] : []),
    ],
  };
}

function resolveRepRangeResult(input: {
  medianReps: number | null;
  lowerRepTarget: number | null;
  upperRepTarget: number | null;
}): PostSessionReviewPrescriptionCalibrationRow["repRangeResult"] {
  if (typeof input.medianReps !== "number") {
    return "unknown";
  }
  if (
    typeof input.lowerRepTarget === "number" &&
    input.medianReps < input.lowerRepTarget - 1
  ) {
    return "below_target";
  }
  if (
    typeof input.upperRepTarget === "number" &&
    input.medianReps > input.upperRepTarget + 1
  ) {
    return "above_target";
  }
  if (
    typeof input.lowerRepTarget === "number" ||
    typeof input.upperRepTarget === "number"
  ) {
    return "in_range";
  }
  return "unknown";
}

function resolveEffortResult(input: {
  targetRpe: number | null;
  medianActualRpe: number | null;
}): PostSessionReviewPrescriptionCalibrationRow["effortResult"] {
  if (
    typeof input.targetRpe !== "number" ||
    typeof input.medianActualRpe !== "number"
  ) {
    return "unknown";
  }
  const delta = input.medianActualRpe - input.targetRpe;
  if (delta > 1) {
    return "above_target";
  }
  if (delta < -1) {
    return "below_target";
  }
  return "near_target";
}

function resolvePerformedRealityCoherence(input: {
  classification: PostSessionReviewCalibrationClassification;
  repRangeResult: PostSessionReviewPrescriptionCalibrationRow["repRangeResult"];
  effortResult: PostSessionReviewPrescriptionCalibrationRow["effortResult"];
}): PostSessionReviewPrescriptionCalibrationRow["performedRealityCoherence"] {
  switch (input.classification) {
    case "target_too_high":
      return "load_too_heavy";
    case "target_too_low":
      return "load_too_light";
    case "insufficient_evidence":
      return "insufficient_evidence";
    case "skipped_or_low_coverage":
      return "low_coverage";
    case "runtime_added":
    case "replacement_like":
      return "session_local";
    case "recalibrated_hold":
      return "mixed_signal";
    case "clean":
      return input.repRangeResult === "in_range" &&
        (input.effortResult === "near_target" || input.effortResult === "unknown")
        ? "coherent"
        : "mixed_signal";
  }
}

function buildExerciseRows(
  exercises: PostSessionReviewExerciseEvidence[]
): PostSessionReviewExerciseReconciliationRow[] {
  return exercises.map((exercise) => {
    const plannedSets = getPlannedSets(exercise);
    const addedSets = getAddedSets(exercise);
    const plannedSetCount = plannedSets.length;
    const performedSetCount = countPerformed(plannedSets);
    const skippedSetCount = countSkipped(plannedSets);
    const missingLogSetCount = countMissingLogs(plannedSets);
    const addedSetCount =
      exercise.isRuntimeAdded === true
        ? countPerformed(exercise.sets)
        : countPerformed(addedSets);
    const status =
      exercise.replacement != null
        ? "replacement_like"
        : exercise.isRuntimeAdded === true
          ? "runtime_added"
          : performedSetCount === 0 && skippedSetCount > 0
            ? "skipped"
            : performedSetCount === 0 && missingLogSetCount > 0
              ? "unlogged"
              : performedSetCount < plannedSetCount || skippedSetCount > 0
                ? "partial"
                : "as_planned";

    return {
      workoutExerciseId: exercise.workoutExerciseId,
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      status,
      plannedSetCount,
      performedSetCount,
      skippedSetCount,
      missingLogSetCount,
      addedSetCount,
      runtimeAdded: exercise.isRuntimeAdded === true,
      ...(exercise.replacement ? { replacement: exercise.replacement } : {}),
      evidenceOnly: true,
      policyMutation: false,
      seedMutation: false,
    };
  });
}

function formatTargetRange(row: PostSessionReviewPrescriptionCalibrationRow): string {
  const min = row.targetRepRange.min;
  const max = row.targetRepRange.max;
  if (typeof min === "number" && typeof max === "number") {
    return min === max ? `${min} reps` : `${min}-${max} reps`;
  }
  if (typeof min === "number") {
    return `${min}+ reps`;
  }
  if (typeof max === "number") {
    return `up to ${max} reps`;
  }
  return "reps not prescribed";
}

function formatValue(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 10) / 10}`
    : "not captured";
}

function resolvePerformedRealityCompletionStatus(
  row: PostSessionReviewExerciseReconciliationRow
): PostSessionReviewPerformedRealityRow["completionStatus"] {
  if (row.runtimeAdded || row.plannedSetCount === 0) {
    return "session_local";
  }
  if (row.status === "skipped") {
    return "skipped";
  }
  if (row.status === "unlogged") {
    return "unlogged";
  }
  if (row.status === "partial") {
    return "partial";
  }
  return "complete";
}

function resolvePerformedRealityLabel(input: {
  exerciseRow: PostSessionReviewExerciseReconciliationRow;
  calibrationRow: PostSessionReviewPrescriptionCalibrationRow;
}): PostSessionReviewPerformedRealityRow["label"] {
  const completionStatus = resolvePerformedRealityCompletionStatus(input.exerciseRow);
  if (
    completionStatus === "unlogged" ||
    (completionStatus === "session_local" &&
      input.calibrationRow.classification === "runtime_added" &&
      input.calibrationRow.performedSetCount === 0) ||
    input.calibrationRow.classification === "insufficient_evidence"
  ) {
    return "missing_actuals";
  }
  if (
    completionStatus === "partial" ||
    completionStatus === "skipped" ||
    input.calibrationRow.classification === "skipped_or_low_coverage" ||
    input.calibrationRow.classification === "target_too_high" ||
    input.calibrationRow.repRangeResult === "below_target" ||
    input.calibrationRow.effortResult === "above_target"
  ) {
    return "under_performed";
  }
  if (
    input.calibrationRow.classification === "target_too_low" ||
    (input.calibrationRow.repRangeResult === "above_target" &&
      input.calibrationRow.effortResult === "below_target")
  ) {
    return "over_performed";
  }
  return "performed_as_planned";
}

function performedRealityHeadline(input: {
  exerciseName: string;
  label: PostSessionReviewPerformedRealityRow["label"];
}): string {
  switch (input.label) {
    case "performed_as_planned":
      return `${input.exerciseName} matched the plan`;
    case "under_performed":
      return `${input.exerciseName} came in under the plan`;
    case "over_performed":
      return `${input.exerciseName} exceeded the plan`;
    case "missing_actuals":
      return `${input.exerciseName} needs more actuals`;
  }
}

function performedRealityDetail(input: {
  exerciseRow: PostSessionReviewExerciseReconciliationRow;
  calibrationRow: PostSessionReviewPrescriptionCalibrationRow;
}): string {
  const row = input.calibrationRow;
  const completionDetail =
    input.exerciseRow.runtimeAdded || input.exerciseRow.plannedSetCount === 0
      ? row.performedSetCount > 0
        ? `${row.performedSetCount} session-local sets performed`
        : "No session-local set actuals were captured"
      : `${input.exerciseRow.performedSetCount} of ${input.exerciseRow.plannedSetCount} prescribed sets performed`;
  const actualReps =
    typeof row.medianReps === "number"
      ? `${formatValue(row.medianReps)} reps`
      : "reps not captured";

  return [
    completionDetail,
    `target ${formatTargetRange(row)}, load ${formatValue(row.targetLoad)}, RPE ${formatValue(row.targetRpe)}`,
    `actual median ${actualReps}, load ${formatValue(row.medianPerformedLoad)}, RPE ${formatValue(row.medianActualRpe)}`,
  ].join("; ") + ".";
}

function buildPerformedRealityRows(input: {
  exerciseRows: PostSessionReviewExerciseReconciliationRow[];
  calibrationRows: PostSessionReviewPrescriptionCalibrationRow[];
}): PostSessionReviewPerformedRealityRow[] {
  return input.exerciseRows.map((exerciseRow, index) => {
    const calibrationRow = input.calibrationRows[index];
    if (!calibrationRow) {
      return {
        workoutExerciseId: exerciseRow.workoutExerciseId,
        exerciseId: exerciseRow.exerciseId,
        exerciseName: exerciseRow.exerciseName,
        label: "missing_actuals",
        completionStatus: resolvePerformedRealityCompletionStatus(exerciseRow),
        plannedSetCount: exerciseRow.plannedSetCount,
        performedSetCount: exerciseRow.performedSetCount,
        skippedSetCount: exerciseRow.skippedSetCount,
        missingLogSetCount: exerciseRow.missingLogSetCount,
        target: { reps: { min: null, max: null }, load: null, rpe: null },
        actual: { medianReps: null, medianLoad: null, medianRpe: null },
        headline: `${exerciseRow.exerciseName} needs more actuals`,
        detail: `${exerciseRow.performedSetCount} of ${exerciseRow.plannedSetCount} prescribed sets performed; target and actual set evidence was not complete.`,
        evidenceOnly: true,
        affectsProgressionPolicy: false,
        affectsPrescriptionPolicy: false,
        seedRuntimeChanged: false,
      };
    }

    const label = resolvePerformedRealityLabel({ exerciseRow, calibrationRow });
    const performedSetCount =
      exerciseRow.runtimeAdded || exerciseRow.plannedSetCount === 0
        ? calibrationRow.performedSetCount
        : exerciseRow.performedSetCount;
    return {
      workoutExerciseId: exerciseRow.workoutExerciseId,
      exerciseId: exerciseRow.exerciseId,
      exerciseName: exerciseRow.exerciseName,
      label,
      completionStatus: resolvePerformedRealityCompletionStatus(exerciseRow),
      plannedSetCount: exerciseRow.plannedSetCount,
      performedSetCount,
      skippedSetCount: exerciseRow.skippedSetCount,
      missingLogSetCount: exerciseRow.missingLogSetCount,
      target: {
        reps: calibrationRow.targetRepRange,
        load: calibrationRow.targetLoad,
        rpe: calibrationRow.targetRpe,
      },
      actual: {
        medianReps: calibrationRow.medianReps,
        medianLoad: calibrationRow.medianPerformedLoad,
        medianRpe: calibrationRow.medianActualRpe,
      },
      headline: performedRealityHeadline({
        exerciseName: exerciseRow.exerciseName,
        label,
      }),
      detail: performedRealityDetail({ exerciseRow, calibrationRow }),
      evidenceOnly: true,
      affectsProgressionPolicy: false,
      affectsPrescriptionPolicy: false,
      seedRuntimeChanged: false,
    };
  });
}

function buildExecutionSummary(
  rows: PostSessionReviewExerciseReconciliationRow[]
): PostSessionReviewExecutionSummary {
  return {
    plannedSetCount: rows.reduce((sum, row) => sum + row.plannedSetCount, 0),
    completedSetCount: rows.reduce(
      (sum, row) => sum + row.performedSetCount + row.addedSetCount,
      0
    ),
    skippedSetCount: rows.reduce((sum, row) => sum + row.skippedSetCount, 0),
    uncoveredSkippedSetCount: rows.reduce(
      (sum, row) => sum + row.skippedSetCount,
      0
    ),
    extraSetCount: rows.reduce((sum, row) => sum + row.addedSetCount, 0),
    missingLogSetCount: rows.reduce((sum, row) => sum + row.missingLogSetCount, 0),
    performedExerciseCount: rows.filter(
      (row) => row.performedSetCount + row.addedSetCount > 0
    ).length,
    fullySkippedExerciseCount: rows.filter((row) => row.status === "skipped").length,
    partialExerciseCount: rows.filter((row) => row.status === "partial").length,
  };
}

function buildCalibrationRows(
  exercises: PostSessionReviewExerciseEvidence[],
  nextExposureDecisions: PostSessionReviewNextExposureEvidence[] = []
): PostSessionReviewPrescriptionCalibrationRow[] {
  const nextExposureByExerciseId = new Map(
    nextExposureDecisions.map((row) => [row.exerciseId, row.decision])
  );
  return exercises.map((exercise) => {
    const addedSets = getAddedSets(exercise);
    const calibrationSets = getCalibrationSets(exercise);
    const plannedSetCount = exercise.isRuntimeAdded === true ? 0 : calibrationSets.length;
    const performedSetCount = countPerformedWorkSets(calibrationSets);
    const skippedSetCount = countSkipped(calibrationSets);
    const addedSetCount =
      exercise.isRuntimeAdded === true
        ? countPerformedWorkSets(exercise.sets)
        : countPerformedWorkSets(addedSets);
    const targetLoad = resolveTargetLoad(calibrationSets);
    const targetRpe = resolveTargetRpe(calibrationSets);
    const performedLoad = summarizePerformedLoad(calibrationSets);
    const targetRepRange = resolveTargetRepRange(calibrationSets);
    const loadDeltaPct =
      typeof targetLoad === "number" &&
      targetLoad > 0 &&
      typeof performedLoad.medianLoad === "number"
        ? roundToTenth(((performedLoad.medianLoad - targetLoad) / targetLoad) * 100)
        : null;
    const classification = classifyCalibration({
      exercise,
      plannedSetCount,
      performedSetCount,
      skippedSetCount,
      addedSetCount,
      targetLoad,
      medianPerformedLoad: performedLoad.medianLoad,
      loadDeltaPct,
      medianReps: performedLoad.medianReps,
      lowerRepTarget: targetRepRange.min,
      upperRepTarget: targetRepRange.max,
      targetRpe,
      medianActualRpe: performedLoad.medianRpe,
      nextExposureDecision: nextExposureByExerciseId.get(exercise.exerciseId),
    });
    const rpeDelta =
      typeof targetRpe === "number" && typeof performedLoad.medianRpe === "number"
        ? roundToTenth(performedLoad.medianRpe - targetRpe)
        : null;
    const repRangeResult = resolveRepRangeResult({
      medianReps: performedLoad.medianReps,
      lowerRepTarget: targetRepRange.min,
      upperRepTarget: targetRepRange.max,
    });
    const effortResult = resolveEffortResult({
      targetRpe,
      medianActualRpe: performedLoad.medianRpe,
    });
    const performedRealityCoherence = resolvePerformedRealityCoherence({
      classification: classification.classification,
      repRangeResult,
      effortResult,
    });

    return {
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      ...classification,
      plannedSetCount,
      performedSetCount,
      skippedSetCount,
      addedSetCount,
      targetLoad,
      targetRepRange,
      targetRpe,
      medianPerformedLoad: performedLoad.medianLoad,
      anchorLoad: performedLoad.anchorLoad,
      loadDeltaPct,
      medianReps: performedLoad.medianReps,
      medianActualRpe: performedLoad.medianRpe,
      rpeDelta,
      repRangeResult,
      effortResult,
      performedRealityCoherence,
      evidenceOnly: true,
      affectsPrescriptionPolicy: false,
    };
  });
}

function buildLearningSignals(input: {
  executionSummary: PostSessionReviewExecutionSummary;
  rows: PostSessionReviewExerciseReconciliationRow[];
  calibrationRows: PostSessionReviewPrescriptionCalibrationRow[];
  recentExposureRows: PostSessionReviewRecentExposureCalibrationSummaryRow[];
  contractInput: PostSessionReviewContractBuildInput;
}): PostSessionReviewLearningSignal[] {
  const signals: PostSessionReviewLearningSignal[] = [
    {
      kind: "performed_set_signal",
      severity: "info",
      summary: `${input.executionSummary.completedSetCount} performed set(s) captured from set logs.`,
      evidence: [`completed_sets:${input.executionSummary.completedSetCount}`],
    },
  ];

  if (input.executionSummary.skippedSetCount > 0) {
    signals.push({
      kind: "skipped_set_signal",
      severity: "watch",
      summary: `${input.executionSummary.skippedSetCount} skipped set(s) represented as evidence.`,
      evidence: input.rows
        .filter((row) => row.skippedSetCount > 0)
        .map((row) => `${row.exerciseName}:${row.skippedSetCount}`),
    });
  }

  const runtimeRows = input.rows.filter(
    (row) => row.runtimeAdded || row.replacement != null || row.addedSetCount > 0
  );
  if (runtimeRows.length > 0) {
    signals.push({
      kind: "runtime_edit_signal",
      severity: "watch",
      summary: "Runtime edits are represented as session-local evidence only.",
      evidence: runtimeRows.map((row) => `${row.exerciseName}:${row.status}`),
    });
  }

  const calibrationRows = input.calibrationRows.filter(
    (row) => row.classification !== "clean"
  );
  if (calibrationRows.length > 0) {
    const summary = buildCalibrationSummary(input.calibrationRows);
    const summaryParts = [
      summary.coherentCount > 0 ? `${summary.coherentCount} coherent` : null,
      summary.loadTooHeavyCount > 0
        ? `${summary.loadTooHeavyCount} looked too heavy`
        : null,
      summary.loadTooLightCount > 0
        ? `${summary.loadTooLightCount} looked too light`
        : null,
      summary.mixedSignalCount > 0 ? `${summary.mixedSignalCount} mixed` : null,
      summary.lowCoverageCount > 0
        ? `${summary.lowCoverageCount} low coverage`
        : null,
      summary.sessionLocalCount > 0
        ? `${summary.sessionLocalCount} session-local`
        : null,
      summary.insufficientEvidenceCount > 0
        ? `${summary.insufficientEvidenceCount} incomplete`
        : null,
    ].filter((part): part is string => Boolean(part));
    signals.push({
      kind: "calibration_signal",
      severity: "watch",
      summary:
        summaryParts.length > 0
          ? `Prescription calibration evidence: ${summaryParts.join(", ")}.`
          : "Prescription calibration rows contain watch evidence.",
      evidence: calibrationRows.map(
        (row) => `${row.exerciseName}:${row.classification}`
      ),
    });
  }

  if (input.recentExposureRows.length > 0) {
    const watchedRows = input.recentExposureRows.filter(
      (row) =>
        row.loadTooHeavyCount > 0 ||
        row.loadTooLightCount > 0 ||
        row.mixedSignalCount > 0 ||
        row.lowCoverageCount > 0 ||
        row.insufficientEvidenceCount > 0
    );
    signals.push({
      kind: "calibration_signal",
      severity: watchedRows.length > 0 ? "watch" : "info",
      summary:
        watchedRows.length > 0
          ? `Recent exact-exercise calibration history has watch evidence for ${watchedRows.length} exercise(s).`
          : "Recent exact-exercise calibration history was coherent.",
      evidence: input.recentExposureRows.map(
        (row) => `${row.exerciseName}:prior_exposures:${row.priorExposureCount}`
      ),
    });
  }

  if ((input.contractInput.nextExposureDecisions ?? []).length > 0) {
    signals.push({
      kind: "next_exposure_signal",
      severity: "info",
      summary: "Explainability next-exposure rows were included as read-only evidence.",
      evidence: (input.contractInput.nextExposureDecisions ?? []).map(
        (row) => `${row.exerciseName ?? row.exerciseId}:${row.decision.action}`
      ),
    });
  }

  if (input.contractInput.weeklyImpact?.rows.length) {
    signals.push({
      kind: "weekly_volume_signal",
      severity: "info",
      summary: "Weekly impact rows were included from app-owned volume compliance evidence.",
      evidence: input.contractInput.weeklyImpact.rows.map(
        (row) => `${row.muscle}:${row.status}`
      ),
    });
  }

  if (input.contractInput.sessionSemantics) {
    signals.push({
      kind: "session_semantics_signal",
      severity: "info",
      summary: `Session semantics classified this workout as ${input.contractInput.sessionSemantics.kind}.`,
      evidence: [
        `progression_history:${input.contractInput.sessionSemantics.countsTowardProgressionHistory ? "yes" : "no"}`,
        `performance_history:${input.contractInput.sessionSemantics.countsTowardPerformanceHistory ? "yes" : "no"}`,
      ],
    });
  }

  return signals;
}

function buildConsistencyChecks(input: {
  contract: Omit<PostSessionReviewContract, "consistencyChecks">;
}): PostSessionReviewConsistencyCheck[] {
  const contract = input.contract;
  const boundariesReadOnly =
    contract.boundaries.readOnly === true &&
    contract.boundaries.affectsScoringOrGeneration === false &&
    contract.boundaries.dbMutation === false &&
    contract.boundaries.workoutChanged === false &&
    contract.boundaries.seedRuntimeChanged === false &&
    contract.boundaries.plannerMaterializerChanged === false &&
    contract.boundaries.selectionMetadataMutated === false &&
    contract.boundaries.receiptMutated === false;
  const hasSourceTruth =
    contract.sourceTruth.setLogs.available &&
    contract.sourceTruth.workoutStructure.available;
  const reviewableStatus =
    contract.workoutIdentity.status === "COMPLETED" ||
    contract.workoutIdentity.status === "PARTIAL";
  const runtimeRows = contract.exerciseReconciliation.rows.filter(
    (row) => row.runtimeAdded || row.replacement != null || row.addedSetCount > 0
  );
  const replacementRows = contract.exerciseReconciliation.rows.filter(
    (row) => row.replacement != null
  );
  const nextExposureReadOnly = contract.nextExposure.rows.every(
    (row) => row.evidenceOnly && row.affectsProgressionPolicy === false
  );

  return [
    {
      id: "boundary_flags_read_only",
      status: boundariesReadOnly ? "pass" : "fail",
      severity: boundariesReadOnly ? "info" : "error",
      message: boundariesReadOnly
        ? "Contract boundaries are read-only and non-mutating."
        : "Contract boundaries imply mutation or generation impact.",
      evidence: contract.boundaries.notes,
    },
    {
      id: "source_truth_present",
      status: hasSourceTruth ? "pass" : "fail",
      severity: hasSourceTruth ? "info" : "error",
      message: hasSourceTruth
        ? "Set-log and workout-structure source truth are present."
        : "Set-log or workout-structure source truth is missing.",
      evidence: [
        `set_logs:${contract.sourceTruth.setLogs.available ? "available" : "missing"}`,
        `workout_structure:${contract.sourceTruth.workoutStructure.available ? "available" : "missing"}`,
      ],
    },
    {
      id: "performed_status_reviewable",
      status: reviewableStatus ? "pass" : "warning",
      severity: reviewableStatus ? "info" : "warning",
      message: reviewableStatus
        ? "Workout status is reviewable for post-session evidence."
        : "Workout status is not a terminal performed status.",
      evidence: [`status:${contract.workoutIdentity.status}`],
    },
    {
      id: "runtime_edit_evidence_only",
      status: runtimeRows.every((row) => row.evidenceOnly && !row.policyMutation)
        ? "pass"
        : "fail",
      severity: runtimeRows.every((row) => row.evidenceOnly && !row.policyMutation)
        ? "info"
        : "error",
      message: "Runtime edit rows remain evidence-only.",
      evidence: runtimeRows.map((row) => `${row.exerciseName}:${row.status}`),
    },
    {
      id: "replacement_evidence_non_mutating",
      status: replacementRows.every((row) => row.seedMutation === false)
        ? "pass"
        : "fail",
      severity: replacementRows.every((row) => row.seedMutation === false)
        ? "info"
        : "error",
      message: "Replacement-like rows do not imply seed or policy mutation.",
      evidence: replacementRows.map((row) => `${row.exerciseName}:seed_mutation:no`),
    },
    {
      id: "next_exposure_read_only",
      status: nextExposureReadOnly ? "pass" : "fail",
      severity: nextExposureReadOnly ? "info" : "error",
      message: "Next-exposure rows are copied as read-only explainability evidence.",
      evidence: contract.nextExposure.rows.map(
        (row) => `${row.exerciseName ?? row.exerciseId}:${row.action}`
      ),
    },
  ];
}

function buildCalibrationSummary(rows: PostSessionReviewPrescriptionCalibrationRow[]) {
  const count = (classification: PostSessionReviewCalibrationClassification) =>
    rows.filter((row) => row.classification === classification).length;
  const countCoherence = (
    coherence: PostSessionReviewPrescriptionCalibrationRow["performedRealityCoherence"]
  ) => rows.filter((row) => row.performedRealityCoherence === coherence).length;
  return {
    targetTooHighCount: count("target_too_high"),
    targetTooLowCount: count("target_too_low"),
    insufficientEvidenceCount: count("insufficient_evidence"),
    skippedOrLowCoverageCount: count("skipped_or_low_coverage"),
    coherentCount: countCoherence("coherent"),
    loadTooHeavyCount: countCoherence("load_too_heavy"),
    loadTooLightCount: countCoherence("load_too_light"),
    mixedSignalCount: countCoherence("mixed_signal"),
    lowCoverageCount: countCoherence("low_coverage"),
    sessionLocalCount: countCoherence("session_local"),
  };
}

function summarizeRecentExposureRows(input: {
  exerciseId: string;
  exerciseName: string;
  rows: PostSessionReviewPrescriptionCalibrationRow[];
  performedAtValues: Array<string | null | undefined>;
}): PostSessionReviewRecentExposureCalibrationSummaryRow {
  const countCoherence = (
    coherence: PostSessionReviewPrescriptionCalibrationRow["performedRealityCoherence"]
  ) => input.rows.filter((row) => row.performedRealityCoherence === coherence).length;
  const latestPerformedAt =
    input.performedAtValues
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .sort()
      .at(-1) ?? null;

  return {
    exerciseId: input.exerciseId,
    exerciseName: input.exerciseName,
    priorExposureCount: input.rows.length,
    lookbackWorkoutLimit: RECENT_EXPOSURE_LOOKBACK_WORKOUT_LIMIT,
    latestPerformedAt,
    coherentCount: countCoherence("coherent"),
    loadTooHeavyCount: countCoherence("load_too_heavy"),
    loadTooLightCount: countCoherence("load_too_light"),
    mixedSignalCount: countCoherence("mixed_signal"),
    lowCoverageCount: countCoherence("low_coverage"),
    insufficientEvidenceCount: countCoherence("insufficient_evidence"),
    sessionLocalCount: countCoherence("session_local"),
    evidenceOnly: true,
    affectsPrescriptionPolicy: false,
    affectsProgressionPolicy: false,
  };
}

function buildRecentExposureSummaryRows(input: {
  currentRows: PostSessionReviewPrescriptionCalibrationRow[];
  recentExposures: PostSessionReviewRecentExerciseExposureEvidence[] | undefined;
}): PostSessionReviewRecentExposureCalibrationSummaryRow[] {
  const currentExerciseIds = new Set(input.currentRows.map((row) => row.exerciseId));
  const exposuresByExerciseId = new Map<
    string,
    PostSessionReviewRecentExerciseExposureEvidence[]
  >();

  for (const exposure of input.recentExposures ?? []) {
    if (!currentExerciseIds.has(exposure.exerciseId)) {
      continue;
    }
    const existing = exposuresByExerciseId.get(exposure.exerciseId) ?? [];
    existing.push(exposure);
    exposuresByExerciseId.set(exposure.exerciseId, existing);
  }

  return Array.from(exposuresByExerciseId.entries()).flatMap(
    ([exerciseId, exposures]) => {
      const limitedExposures = exposures
        .slice()
        .sort((left, right) => right.performedAt.localeCompare(left.performedAt))
        .slice(0, RECENT_EXPOSURE_LOOKBACK_WORKOUT_LIMIT);
      if (limitedExposures.length === 0) {
        return [];
      }
      const calibrationRows = buildCalibrationRows(limitedExposures);
      const exerciseName =
        input.currentRows.find((row) => row.exerciseId === exerciseId)?.exerciseName ??
        limitedExposures[0]?.exerciseName ??
        exerciseId;

      return summarizeRecentExposureRows({
        exerciseId,
        exerciseName,
        rows: calibrationRows,
        performedAtValues: limitedExposures.map((exposure) => exposure.performedAt),
      });
    }
  );
}

type RecentPerformedRealityRow = PostSessionReviewPerformedRealityRow & {
  workoutId: string;
  performedAt: string;
};

function buildRecentPerformedRealityRows(
  recentExposures: PostSessionReviewRecentExerciseExposureEvidence[] | undefined
): RecentPerformedRealityRow[] {
  const exposures = recentExposures ?? [];
  if (exposures.length === 0) {
    return [];
  }

  const exerciseRows = buildExerciseRows(exposures);
  const calibrationRows = buildCalibrationRows(exposures);
  return buildPerformedRealityRows({ exerciseRows, calibrationRows }).map(
    (row, index) => ({
      ...row,
      workoutId: exposures[index]?.workoutId ?? row.workoutExerciseId,
      performedAt: exposures[index]?.performedAt ?? "",
    })
  );
}

function trendKindForLabels(input: {
  currentLabel: PostSessionReviewPerformedRealityRow["label"];
  recentLabels: PostSessionReviewPerformedRealityRow["label"][];
}): PostSessionReviewPerformedRealityTrendGroup["kind"] | null {
  const recentCount = (label: PostSessionReviewPerformedRealityRow["label"]) =>
    input.recentLabels.filter((value) => value === label).length;

  if (
    input.currentLabel === "under_performed" &&
    recentCount("under_performed") > 0
  ) {
    return "repeated_underperformance";
  }
  if (
    input.currentLabel === "over_performed" &&
    recentCount("over_performed") > 0
  ) {
    return "repeated_overperformance";
  }
  if (
    input.currentLabel === "missing_actuals" &&
    recentCount("missing_actuals") > 0
  ) {
    return "missing_actuals_pattern";
  }
  if (
    input.currentLabel === "performed_as_planned" &&
    input.recentLabels.length > 0 &&
    input.recentLabels.every((label) => label === "performed_as_planned")
  ) {
    return "stable_as_planned";
  }
  return null;
}

function trendRelevantLabel(
  kind: PostSessionReviewPerformedRealityTrendGroup["kind"]
): PostSessionReviewPerformedRealityRow["label"] {
  switch (kind) {
    case "repeated_underperformance":
      return "under_performed";
    case "repeated_overperformance":
      return "over_performed";
    case "missing_actuals_pattern":
      return "missing_actuals";
    case "stable_as_planned":
      return "performed_as_planned";
  }
}

function buildPerformedRealityTrendGroups(input: {
  currentRows: PostSessionReviewPerformedRealityRow[];
  recentExposures: PostSessionReviewRecentExerciseExposureEvidence[] | undefined;
}): PostSessionReviewPerformedRealityTrendGroup[] {
  const recentRows = buildRecentPerformedRealityRows(input.recentExposures);
  if (recentRows.length === 0) {
    return [];
  }

  const groups = new Map<
    PostSessionReviewPerformedRealityTrendGroup["kind"],
    PostSessionReviewPerformedRealityTrendGroup
  >();

  input.currentRows.forEach((currentRow, sourceOrder) => {
    const matchingRecentRows = recentRows
      .filter((row) => row.exerciseId === currentRow.exerciseId)
      .sort((left, right) => right.performedAt.localeCompare(left.performedAt))
      .slice(0, RECENT_EXPOSURE_LOOKBACK_WORKOUT_LIMIT);
    const recentLabels = matchingRecentRows.map((row) => row.label);
    const kind = trendKindForLabels({
      currentLabel: currentRow.label,
      recentLabels,
    });
    if (!kind) {
      return;
    }

    const relevantRecentRows = matchingRecentRows.filter(
      (row) => row.label === trendRelevantLabel(kind)
    );
    const existing = groups.get(kind);
    const currentEvidence = {
      workoutExerciseId: currentRow.workoutExerciseId,
      exerciseId: currentRow.exerciseId,
      exerciseName: currentRow.exerciseName,
      sourceOrder,
      currentLabel: currentRow.label,
      recentLabels,
    };
    if (existing) {
      const latestPerformedAt =
        [...relevantRecentRows.map((row) => row.performedAt), existing.latestPerformedAt]
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .sort()
          .at(-1) ?? null;
      groups.set(kind, {
        ...existing,
        currentRowCount: existing.currentRowCount + 1,
        priorExposureCount: existing.priorExposureCount + relevantRecentRows.length,
        latestPerformedAt,
        currentRows: [...existing.currentRows, currentEvidence],
      });
      return;
    }

    groups.set(kind, {
      kind,
      currentRowCount: 1,
      priorExposureCount: relevantRecentRows.length,
      lookbackWorkoutLimit: RECENT_EXPOSURE_LOOKBACK_WORKOUT_LIMIT,
      latestPerformedAt:
        relevantRecentRows
          .map((row) => row.performedAt)
          .filter((value): value is string => value.length > 0)
          .sort()
          .at(-1) ?? null,
      currentRows: [currentEvidence],
      evidenceOnly: true,
      affectsProgressionPolicy: false,
      affectsPrescriptionPolicy: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      receiptMutated: false,
    });
  });

  return Array.from(groups.values()).sort((left, right) => {
    const order: Record<PostSessionReviewPerformedRealityTrendGroup["kind"], number> = {
      repeated_underperformance: 0,
      repeated_overperformance: 1,
      missing_actuals_pattern: 2,
      stable_as_planned: 3,
    };
    return order[left.kind] - order[right.kind];
  });
}

export function buildPostSessionReviewContract(
  input: PostSessionReviewContractBuildInput
): PostSessionReviewContract {
  const exerciseRows = buildExerciseRows(input.exercises);
  const executionSummary = buildExecutionSummary(exerciseRows);
  const calibrationRows = buildCalibrationRows(
    input.exercises,
    input.nextExposureDecisions
  );
  const performedRealityRows = buildPerformedRealityRows({
    exerciseRows,
    calibrationRows,
  });
  const recentExposureRows = buildRecentExposureSummaryRows({
    currentRows: calibrationRows,
    recentExposures: input.recentExerciseExposures,
  });
  const performedRealityTrendGroups = buildPerformedRealityTrendGroups({
    currentRows: performedRealityRows,
    recentExposures: input.recentExerciseExposures,
  });
  const boundaries = {
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    dbMutation: false as const,
    workoutChanged: false as const,
    seedRuntimeChanged: false as const,
    plannerMaterializerChanged: false as const,
    selectionMetadataMutated: false as const,
    receiptMutated: false as const,
    notes: input.boundaryNotes ?? [
      "read-only post-session review contract",
      "does not mutate workouts, logs, selectionMetadata, receipts, seed, or planner/materializer behavior",
      "calibration and runtime edit rows are evidence only",
    ],
  };

  const contractBase = {
    contractVersion: 1 as const,
    scope: {
      mode: "post-session-review" as const,
      ownerSeam: POST_SESSION_REVIEW_CONTRACT_OWNER_SEAM,
      source: {
        producer: "in_memory_read_model" as const,
        provenance: "app_read_model" as const,
      },
      readOnly: true as const,
      affectsScoringOrGeneration: false as const,
    },
    workoutIdentity: input.workoutIdentity,
    sourceTruth: {
      setLogs: {
        source: "SetLog" as const,
        available: input.sourceTruth.setLogsAvailable,
        performedSetCount: executionSummary.completedSetCount,
        skippedSetCount: executionSummary.skippedSetCount,
        missingLogSetCount: executionSummary.missingLogSetCount,
      },
      workoutStructure: {
        source: "Workout/WorkoutExercise/WorkoutSet" as const,
        available: input.sourceTruth.workoutStructureAvailable,
        plannedExerciseCount: exerciseRows.filter((row) => !row.runtimeAdded).length,
        plannedSetCount: executionSummary.plannedSetCount,
        revision: input.workoutIdentity.revision,
      },
      receipt: {
        source: "selectionMetadata.sessionDecisionReceipt" as const,
        available: input.sourceTruth.sessionDecisionReceiptAvailable,
        mutated: false as const,
      },
      runtimeEditReconciliation: {
        source: "selectionMetadata.runtimeEditReconciliation" as const,
        available: input.sourceTruth.runtimeEditReconciliationAvailable === true,
        evidenceOnly: true as const,
      },
      sessionSemantics: {
        source: "deriveSessionSemantics" as const,
        available: Boolean(input.sessionSemantics),
        ...(input.sessionSemantics ? { evidence: input.sessionSemantics } : {}),
      },
    },
    executionSummary,
    exerciseReconciliation: {
      rows: exerciseRows,
    },
    performedReality: {
      source: "set_log_vs_workout_set_targets" as const,
      rows: performedRealityRows,
      trendGroups: performedRealityTrendGroups,
      readOnly: true as const,
      affectsProgressionPolicy: false as const,
      affectsPrescriptionPolicy: false as const,
      seedRuntimeChanged: false as const,
    },
    nextExposure: {
      source: "explainability.nextExposureDecisions" as const,
      available: (input.nextExposureDecisions ?? []).length > 0,
      rows: (input.nextExposureDecisions ?? []).map((row) => ({
        exerciseId: row.exerciseId,
        ...(row.exerciseName ? { exerciseName: row.exerciseName } : {}),
        action: row.decision.action,
        summary: row.decision.summary,
        reason: row.decision.reason,
        anchorLoad: row.decision.anchorLoad,
        repRange: row.decision.repRange,
        modalRpe: row.decision.modalRpe,
        medianReps: row.decision.medianReps,
        decisionLog: row.decision.decisionLog ?? [],
        evidenceOnly: true as const,
        affectsProgressionPolicy: false as const,
      })),
      readOnly: true as const,
    },
    prescriptionCalibration: {
      source: "set_log_vs_workout_set_targets" as const,
      rows: calibrationRows,
      summary: buildCalibrationSummary(calibrationRows),
      ...(recentExposureRows.length > 0
        ? {
            recentExposureSummary: {
              source: "exact_exercise_prior_performed_workouts" as const,
              rows: recentExposureRows,
              readOnly: true as const,
              affectsPrescriptionPolicy: false as const,
              affectsProgressionPolicy: false as const,
            },
          }
        : {}),
      readOnly: true as const,
    },
    ...(input.weeklyImpact
      ? {
          weeklyImpact: {
            source: "explainability.volumeCompliance" as const,
            rows: input.weeklyImpact.rows.map((row) => ({ ...row })),
            readOnly: true as const,
          },
        }
      : {}),
    learningSignals: buildLearningSignals({
      executionSummary,
      rows: exerciseRows,
      calibrationRows,
      recentExposureRows,
      contractInput: input,
    }),
    boundaries,
  };

  return {
    ...contractBase,
    consistencyChecks: buildConsistencyChecks({ contract: contractBase }),
  };
}
