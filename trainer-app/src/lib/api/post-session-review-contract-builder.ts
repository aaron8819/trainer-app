import {
  POST_SESSION_REVIEW_CONTRACT_OWNER_SEAM,
  type PostSessionReviewCalibrationClassification,
  type PostSessionReviewConsistencyCheck,
  type PostSessionReviewContract,
  type PostSessionReviewExerciseReconciliationRow,
  type PostSessionReviewExecutionSummary,
  type PostSessionReviewLearningSignal,
  type PostSessionReviewPrescriptionCalibrationRow,
} from "./post-session-review-contract";
import type {
  PostSessionReviewContractBuildInput,
  PostSessionReviewExerciseEvidence,
  PostSessionReviewSetEvidence,
} from "./post-session-review-evidence";

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

function getPlannedSets(exercise: PostSessionReviewExerciseEvidence) {
  return exercise.sets.filter((set) => isPlannedSet(exercise, set));
}

function getAddedSets(exercise: PostSessionReviewExerciseEvidence) {
  return exercise.sets.filter((set) => !isPlannedSet(exercise, set));
}

function countPerformed(sets: PostSessionReviewSetEvidence[]): number {
  return sets.filter(isPerformedSet).length;
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

  return {
    medianLoad: median(performedLoads),
    anchorLoad: performedLoads.length > 0 ? Math.max(...performedLoads) : null,
    medianReps: median(performedReps),
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

  if (input.loadDeltaPct <= -15 || repsBelowTarget) {
    return {
      classification: "target_too_high",
      reasonCodes: [
        input.loadDeltaPct <= -15
          ? "performed_load_materially_below_target"
          : "median_reps_below_target",
      ],
      notes: [`load_delta_pct:${input.loadDeltaPct}`],
    };
  }

  if (input.loadDeltaPct >= 15 && !repsBelowTarget) {
    return {
      classification: "target_too_low",
      reasonCodes: ["performed_load_materially_above_target"],
      notes: [`load_delta_pct:${input.loadDeltaPct}`],
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
  exercises: PostSessionReviewExerciseEvidence[]
): PostSessionReviewPrescriptionCalibrationRow[] {
  return exercises.map((exercise) => {
    const plannedSets = getPlannedSets(exercise);
    const addedSets = getAddedSets(exercise);
    const plannedSetCount = plannedSets.length;
    const performedSetCount = countPerformed(plannedSets);
    const skippedSetCount = countSkipped(plannedSets);
    const addedSetCount =
      exercise.isRuntimeAdded === true
        ? countPerformed(exercise.sets)
        : countPerformed(addedSets);
    const targetLoad = resolveTargetLoad(plannedSets);
    const performedLoad = summarizePerformedLoad(plannedSets);
    const targetRepRange = resolveTargetRepRange(plannedSets);
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
      medianPerformedLoad: performedLoad.medianLoad,
      anchorLoad: performedLoad.anchorLoad,
      loadDeltaPct,
      medianReps: performedLoad.medianReps,
      evidenceOnly: true,
      affectsPrescriptionPolicy: false,
    };
  });
}

function buildLearningSignals(input: {
  executionSummary: PostSessionReviewExecutionSummary;
  rows: PostSessionReviewExerciseReconciliationRow[];
  calibrationRows: PostSessionReviewPrescriptionCalibrationRow[];
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
    signals.push({
      kind: "calibration_signal",
      severity: "watch",
      summary: "Prescription calibration rows contain watch evidence.",
      evidence: calibrationRows.map(
        (row) => `${row.exerciseName}:${row.classification}`
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
  return {
    targetTooHighCount: count("target_too_high"),
    targetTooLowCount: count("target_too_low"),
    insufficientEvidenceCount: count("insufficient_evidence"),
    skippedOrLowCoverageCount: count("skipped_or_low_coverage"),
  };
}

export function buildPostSessionReviewContract(
  input: PostSessionReviewContractBuildInput
): PostSessionReviewContract {
  const exerciseRows = buildExerciseRows(input.exercises);
  const executionSummary = buildExecutionSummary(exerciseRows);
  const calibrationRows = buildCalibrationRows(input.exercises);
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
      contractInput: input,
    }),
    boundaries,
  };

  return {
    ...contractBase,
    consistencyChecks: buildConsistencyChecks({ contract: contractBase }),
  };
}
