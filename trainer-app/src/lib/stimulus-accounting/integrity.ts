import type { ExerciseStimulusAccountingEvidence } from "./snapshot";
import {
  resolveHistoricalStimulusAccounting,
  type StimulusSnapshotExerciseSource,
} from "./snapshot";

export type StimulusAccountingIntegrityStatus =
  | "exact_verified"
  | "legacy_derived"
  | "legacy_unknown"
  | "invalid_snapshot"
  | "missing_exact_snapshot"
  | "evidence_mismatch";

export type StimulusAccountingIntegrityRow = {
  workoutId: string;
  workoutExerciseId: string;
  exerciseId: string;
  status: StimulusAccountingIntegrityStatus;
  snapshotHash?: string;
  expectedHash?: string;
};

export type StimulusAccountingIntegritySummary = {
  contractVersion: 1;
  classification: "candidate_truth";
  exactVerifiedCount: number;
  legacyDerivedCount: number;
  legacyUnknownCount: number;
  invalidSnapshotCount: number;
  missingExactSnapshotCount: number;
  evidenceMismatchCount: number;
  rowsRequiringAttention: StimulusAccountingIntegrityRow[];
};

export function auditStimulusAccountingIntegrity(
  rows: Array<{
    workoutId: string;
    workoutExerciseId: string;
    exerciseId: string;
    persistedSnapshot: unknown;
    exercise?: StimulusSnapshotExerciseSource | null;
    expectedEvidence?: ExerciseStimulusAccountingEvidence;
  }>
): StimulusAccountingIntegritySummary {
  const result: StimulusAccountingIntegritySummary = {
    contractVersion: 1,
    classification: "candidate_truth",
    exactVerifiedCount: 0,
    legacyDerivedCount: 0,
    legacyUnknownCount: 0,
    invalidSnapshotCount: 0,
    missingExactSnapshotCount: 0,
    evidenceMismatchCount: 0,
    rowsRequiringAttention: [],
  };

  for (const row of rows) {
    const resolution = resolveHistoricalStimulusAccounting({
      persistedSnapshot: row.persistedSnapshot,
      exercise: row.exercise,
    });
    let status: StimulusAccountingIntegrityStatus;
    if (row.persistedSnapshot == null && row.expectedEvidence) {
      status = "missing_exact_snapshot";
      result.missingExactSnapshotCount += 1;
    } else if (resolution.integrity === "invalid") {
      status = "invalid_snapshot";
      result.invalidSnapshotCount += 1;
    } else if (!resolution.snapshot) {
      status = "legacy_unknown";
      result.legacyUnknownCount += 1;
    } else if (
      row.expectedEvidence &&
      (row.expectedEvidence.contractVersion !== resolution.snapshot.version ||
        row.expectedEvidence.snapshotHash !== resolution.snapshot.policyHash ||
        row.expectedEvidence.provenance !== resolution.snapshot.provenance)
    ) {
      status = "evidence_mismatch";
      result.evidenceMismatchCount += 1;
    } else if (resolution.snapshot.provenance === "exact") {
      status = "exact_verified";
      result.exactVerifiedCount += 1;
    } else {
      status = "legacy_derived";
      result.legacyDerivedCount += 1;
    }

    if (
      status === "invalid_snapshot" ||
      status === "missing_exact_snapshot" ||
      status === "evidence_mismatch" ||
      status === "legacy_unknown"
    ) {
      result.rowsRequiringAttention.push({
        workoutId: row.workoutId,
        workoutExerciseId: row.workoutExerciseId,
        exerciseId: row.exerciseId,
        status,
        snapshotHash: resolution.snapshot?.policyHash,
        expectedHash: row.expectedEvidence?.snapshotHash,
      });
    }
  }

  return result;
}
