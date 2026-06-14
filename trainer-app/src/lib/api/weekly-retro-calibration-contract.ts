import type {
  PostSessionReviewContract,
  PostSessionReviewPerformedRealityLabel,
} from "./post-session-review-contract";

export const WEEKLY_RETRO_CALIBRATION_CONTRACT_OWNER_SEAM =
  "api/weekly-retro-calibration-contract" as const;

export type WeeklyRetroCalibrationSummaryKind =
  | "no_history"
  | "repeated_under_plan"
  | "repeated_over_plan"
  | "stable_as_planned"
  | "missing_actuals"
  | "mixed";

export type WeeklyRetroCalibrationPatternKind =
  | "repeated_under_plan"
  | "repeated_over_plan"
  | "stable_as_planned"
  | "missing_actuals_pattern";

export type WeeklyRetroCalibrationSourceRow = {
  workoutId: string;
  workoutExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  scheduledDate: string | null;
  sourceOrder: number;
  label: PostSessionReviewPerformedRealityLabel;
  plannedSetCount: number;
  performedSetCount: number;
  skippedSetCount: number;
  missingLogSetCount: number;
  evidenceOnly: true;
};

export type WeeklyRetroCalibrationPattern = {
  kind: WeeklyRetroCalibrationPatternKind;
  rowCount: number;
  exerciseCount: number;
  examples: Array<
    Pick<
      WeeklyRetroCalibrationSourceRow,
      "workoutId" | "workoutExerciseId" | "exerciseId" | "exerciseName" | "label"
    >
  >;
  evidenceOnly: true;
  affectsProgressionPolicy: false;
  affectsPrescriptionPolicy: false;
  seedRuntimeChanged: false;
  plannerMaterializerChanged: false;
  receiptMutated: false;
  acceptanceChanged: false;
};

export type WeeklyRetroCalibrationContract = {
  contractVersion: 1;
  scope: {
    mode: "weekly-retro-calibration";
    ownerSeam: typeof WEEKLY_RETRO_CALIBRATION_CONTRACT_OWNER_SEAM;
    source: "post_session_review_performed_reality";
    readOnly: true;
    affectsScoringOrGeneration: false;
  };
  identity: {
    userId: string;
    mesocycleId?: string;
    week?: number;
  };
  sourceEvidence: {
    reviewCount: number;
    rowCount: number;
    rows: WeeklyRetroCalibrationSourceRow[];
    readOnly: true;
  };
  patterns: WeeklyRetroCalibrationPattern[];
  summary: {
    kind: WeeklyRetroCalibrationSummaryKind;
    headline: string;
    detail: string;
    bullets: string[];
    displaySafe: true;
  };
  nonConsumption: {
    progressionPolicy: false;
    prescriptionPolicy: false;
    seedRuntimeReplay: false;
    receipts: false;
    plannerMaterializer: false;
    acceptance: false;
    auditArtifacts: false;
    dbWrites: false;
  };
  boundaries: {
    readOnly: true;
    dbMutation: false;
    workoutChanged: false;
    selectionMetadataMutated: false;
    receiptMutated: false;
    seedRuntimeChanged: false;
    plannerMaterializerChanged: false;
    acceptanceChanged: false;
    affectsScoringOrGeneration: false;
    notes: string[];
  };
};

export type BuildWeeklyRetroCalibrationContractInput = {
  userId: string;
  mesocycleId?: string;
  week?: number;
  reviews: PostSessionReviewContract[];
};

function plural(value: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralLabel}`;
}

function toSourceRows(
  reviews: PostSessionReviewContract[]
): WeeklyRetroCalibrationSourceRow[] {
  return reviews.flatMap((review) =>
    review.performedReality.rows.map((row, sourceOrder) => ({
      workoutId: review.workoutIdentity.workoutId,
      workoutExerciseId: row.workoutExerciseId,
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      scheduledDate: review.workoutIdentity.scheduledDate ?? null,
      sourceOrder,
      label: row.label,
      plannedSetCount: row.plannedSetCount,
      performedSetCount: row.performedSetCount,
      skippedSetCount: row.skippedSetCount,
      missingLogSetCount: row.missingLogSetCount,
      evidenceOnly: true as const,
    }))
  );
}

function rowsForLabel(
  rows: WeeklyRetroCalibrationSourceRow[],
  label: PostSessionReviewPerformedRealityLabel
): WeeklyRetroCalibrationSourceRow[] {
  return rows.filter((row) => row.label === label);
}

function buildPattern(
  kind: WeeklyRetroCalibrationPatternKind,
  rows: WeeklyRetroCalibrationSourceRow[]
): WeeklyRetroCalibrationPattern {
  return {
    kind,
    rowCount: rows.length,
    exerciseCount: new Set(rows.map((row) => row.exerciseId)).size,
    examples: rows.slice(0, 3).map((row) => ({
      workoutId: row.workoutId,
      workoutExerciseId: row.workoutExerciseId,
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      label: row.label,
    })),
    evidenceOnly: true,
    affectsProgressionPolicy: false,
    affectsPrescriptionPolicy: false,
    seedRuntimeChanged: false,
    plannerMaterializerChanged: false,
    receiptMutated: false,
    acceptanceChanged: false,
  };
}

function buildPatterns(
  rows: WeeklyRetroCalibrationSourceRow[]
): WeeklyRetroCalibrationPattern[] {
  if (rows.length === 0) {
    return [];
  }

  const underRows = rowsForLabel(rows, "under_performed");
  const overRows = rowsForLabel(rows, "over_performed");
  const stableRows = rowsForLabel(rows, "performed_as_planned");
  const missingRows = rowsForLabel(rows, "missing_actuals");
  const patterns: WeeklyRetroCalibrationPattern[] = [];

  if (underRows.length >= 2) {
    patterns.push(buildPattern("repeated_under_plan", underRows));
  }
  if (overRows.length >= 2) {
    patterns.push(buildPattern("repeated_over_plan", overRows));
  }
  if (missingRows.length > 0) {
    patterns.push(buildPattern("missing_actuals_pattern", missingRows));
  }
  if (stableRows.length === rows.length) {
    patterns.push(buildPattern("stable_as_planned", stableRows));
  }

  return patterns;
}

function resolveSummaryKind(input: {
  rows: WeeklyRetroCalibrationSourceRow[];
  patterns: WeeklyRetroCalibrationPattern[];
}): WeeklyRetroCalibrationSummaryKind {
  if (input.rows.length === 0) {
    return "no_history";
  }

  const patternKinds = new Set(input.patterns.map((pattern) => pattern.kind));
  const underCount = rowsForLabel(input.rows, "under_performed").length;
  const overCount = rowsForLabel(input.rows, "over_performed").length;
  const missingCount = rowsForLabel(input.rows, "missing_actuals").length;
  const stableCount = rowsForLabel(input.rows, "performed_as_planned").length;
  const activeKinds = [
    underCount > 0 ? "under" : null,
    overCount > 0 ? "over" : null,
    missingCount > 0 ? "missing" : null,
    stableCount > 0 ? "stable" : null,
  ].filter(Boolean);

  if (patternKinds.has("stable_as_planned")) {
    return "stable_as_planned";
  }
  if (activeKinds.length > 1) {
    return "mixed";
  }
  if (patternKinds.has("repeated_under_plan")) {
    return "repeated_under_plan";
  }
  if (patternKinds.has("repeated_over_plan")) {
    return "repeated_over_plan";
  }
  if (missingCount > 0) {
    return "missing_actuals";
  }
  return "mixed";
}

function buildSummary(input: {
  kind: WeeklyRetroCalibrationSummaryKind;
  rows: WeeklyRetroCalibrationSourceRow[];
}): WeeklyRetroCalibrationContract["summary"] {
  const underCount = rowsForLabel(input.rows, "under_performed").length;
  const overCount = rowsForLabel(input.rows, "over_performed").length;
  const stableCount = rowsForLabel(input.rows, "performed_as_planned").length;
  const missingCount = rowsForLabel(input.rows, "missing_actuals").length;
  const countCopy = [
    underCount > 0 ? `${underCount} under plan` : null,
    overCount > 0 ? `${overCount} over plan` : null,
    stableCount > 0 ? `${stableCount} as planned` : null,
    missingCount > 0 ? `${missingCount} need actuals` : null,
  ].filter((part): part is string => part !== null);

  switch (input.kind) {
    case "no_history":
      return {
        kind: input.kind,
        headline: "No weekly retro calibration evidence yet",
        detail: "No performed-reality rows were available for this weekly review.",
        bullets: ["No seed or plan changes made"],
        displaySafe: true,
      };
    case "repeated_under_plan":
      return {
        kind: input.kind,
        headline: "Repeated under-plan execution",
        detail: `${plural(underCount, "row")} came in under the written plan. Review evidence only; no automatic plan change.`,
        bullets: countCopy,
        displaySafe: true,
      };
    case "repeated_over_plan":
      return {
        kind: input.kind,
        headline: "Repeated over-plan execution",
        detail: `${plural(overCount, "row")} exceeded the written plan. Review evidence only; no automatic plan change.`,
        bullets: countCopy,
        displaySafe: true,
      };
    case "stable_as_planned":
      return {
        kind: input.kind,
        headline: "Execution stable as planned",
        detail: `${plural(stableCount, "row")} matched the written plan across this review window.`,
        bullets: ["No seed or plan changes made", ...countCopy],
        displaySafe: true,
      };
    case "missing_actuals":
      return {
        kind: input.kind,
        headline: "Missing actuals limit calibration",
        detail: `${plural(missingCount, "row")} need logged actuals before weekly calibration is trustworthy.`,
        bullets: countCopy,
        displaySafe: true,
      };
    case "mixed":
      return {
        kind: input.kind,
        headline: "Mixed weekly execution signals",
        detail: `${plural(input.rows.length, "performed-reality row")} produced mixed calibration evidence. Review evidence only; no automatic plan change.`,
        bullets: countCopy.length > 0 ? countCopy : ["No dominant weekly pattern"],
        displaySafe: true,
      };
  }
}

export function buildWeeklyRetroCalibrationContract(
  input: BuildWeeklyRetroCalibrationContractInput
): WeeklyRetroCalibrationContract {
  const rows = toSourceRows(input.reviews);
  const patterns = buildPatterns(rows);
  const summaryKind = resolveSummaryKind({ rows, patterns });

  return {
    contractVersion: 1,
    scope: {
      mode: "weekly-retro-calibration",
      ownerSeam: WEEKLY_RETRO_CALIBRATION_CONTRACT_OWNER_SEAM,
      source: "post_session_review_performed_reality",
      readOnly: true,
      affectsScoringOrGeneration: false,
    },
    identity: {
      userId: input.userId,
      ...(input.mesocycleId ? { mesocycleId: input.mesocycleId } : {}),
      ...(typeof input.week === "number" ? { week: input.week } : {}),
    },
    sourceEvidence: {
      reviewCount: input.reviews.length,
      rowCount: rows.length,
      rows,
      readOnly: true,
    },
    patterns,
    summary: buildSummary({ kind: summaryKind, rows }),
    nonConsumption: {
      progressionPolicy: false,
      prescriptionPolicy: false,
      seedRuntimeReplay: false,
      receipts: false,
      plannerMaterializer: false,
      acceptance: false,
      auditArtifacts: false,
      dbWrites: false,
    },
    boundaries: {
      readOnly: true,
      dbMutation: false,
      workoutChanged: false,
      selectionMetadataMutated: false,
      receiptMutated: false,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      acceptanceChanged: false,
      affectsScoringOrGeneration: false,
      notes: [
        "summarizes app-owned post-session performed-reality rows",
        "does not consume audit artifacts or planner/materializer diagnostics",
        "does not mutate progression, prescription, receipts, seed/runtime replay, workouts, logs, or DB state",
      ],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasFalseFlags(record: unknown, keys: string[]): boolean {
  return isRecord(record) && keys.every((key) => record[key] === false);
}

export function isWeeklyRetroCalibrationContract(
  value: unknown,
  options: { userId?: string } = {}
): value is WeeklyRetroCalibrationContract {
  return (
    isRecord(value) &&
    value.contractVersion === 1 &&
    isRecord(value.scope) &&
    value.scope.mode === "weekly-retro-calibration" &&
    value.scope.ownerSeam === WEEKLY_RETRO_CALIBRATION_CONTRACT_OWNER_SEAM &&
    value.scope.source === "post_session_review_performed_reality" &&
    value.scope.readOnly === true &&
    value.scope.affectsScoringOrGeneration === false &&
    isRecord(value.identity) &&
    typeof value.identity.userId === "string" &&
    (!options.userId || value.identity.userId === options.userId) &&
    isRecord(value.sourceEvidence) &&
    Array.isArray(value.sourceEvidence.rows) &&
    value.sourceEvidence.readOnly === true &&
    Array.isArray(value.patterns) &&
    value.patterns.every(
      (pattern) =>
        isRecord(pattern) &&
        typeof pattern.kind === "string" &&
        typeof pattern.rowCount === "number" &&
        typeof pattern.exerciseCount === "number" &&
        Array.isArray(pattern.examples) &&
        pattern.evidenceOnly === true &&
        pattern.affectsProgressionPolicy === false &&
        pattern.affectsPrescriptionPolicy === false &&
        pattern.seedRuntimeChanged === false &&
        pattern.plannerMaterializerChanged === false &&
        pattern.receiptMutated === false &&
        pattern.acceptanceChanged === false
    ) &&
    isRecord(value.summary) &&
    typeof value.summary.headline === "string" &&
    typeof value.summary.detail === "string" &&
    Array.isArray(value.summary.bullets) &&
    value.summary.displaySafe === true &&
    hasFalseFlags(value.nonConsumption, [
      "progressionPolicy",
      "prescriptionPolicy",
      "seedRuntimeReplay",
      "receipts",
      "plannerMaterializer",
      "acceptance",
      "auditArtifacts",
      "dbWrites",
    ]) &&
    isRecord(value.boundaries) &&
    value.boundaries.readOnly === true &&
    hasFalseFlags(value.boundaries, [
      "dbMutation",
      "workoutChanged",
      "selectionMetadataMutated",
      "receiptMutated",
      "seedRuntimeChanged",
      "plannerMaterializerChanged",
      "acceptanceChanged",
      "affectsScoringOrGeneration",
    ])
  );
}
