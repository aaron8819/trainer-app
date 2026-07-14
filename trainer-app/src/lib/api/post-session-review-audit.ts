import { prisma } from "@/lib/db/prisma";
import {
  hashPostSessionReviewValue,
  loadHistoricalPostSessionReview,
  type PostSessionReviewSnapshotReader,
} from "./post-session-review-snapshot";
import { produceCurrentPostSessionReviewInterpretation } from "./post-session-review-producer";

export type PostSessionReviewAuditRow = {
  workoutId: string;
  workoutStatus: string;
  snapshotPresent: boolean;
  contractVersion: number | null;
  computationPolicyVersion: number | null;
  provenance: string | null;
  payloadHashValid: boolean | null;
  evidenceFingerprintValid: boolean | null;
  finalizedAt: string | null;
  currentInterpretationDiffers: boolean | null;
  issues: string[];
};

export type PostSessionReviewAuditReport = {
  generatedAt: string;
  readOnly: true;
  rows: PostSessionReviewAuditRow[];
  summary: {
    completedWorkoutCount: number;
    exactCount: number;
    legacyDerivedCount: number;
    missingRequiredExactCount: number;
    integrityErrorCount: number;
    statusDisagreementCount: number;
    unsupportedVersionCount: number;
    currentInterpretationDifferenceCount: number;
  };
};

export async function auditPostSessionReviewSnapshots(
  input: {
    userId?: string;
    includeCurrentReinterpretation?: boolean;
  } = {},
  client: PostSessionReviewSnapshotReader = prisma
): Promise<PostSessionReviewAuditReport> {
  const workouts = await client.workout.findMany({
    where: {
      OR: [
        { status: "COMPLETED" },
        { postSessionReviewSnapshot: { isNot: null } },
      ],
      ...(input.userId ? { userId: input.userId } : {}),
    },
    orderBy: { id: "asc" },
    select: { id: true, userId: true, status: true },
  });

  const rows: PostSessionReviewAuditRow[] = [];
  for (const workout of workouts) {
    const result = await loadHistoricalPostSessionReview(
      workout.userId,
      workout.id,
      client
    );
    if (result.status === "legacy_missing") {
      rows.push({
        workoutId: workout.id,
        workoutStatus: workout.status,
        snapshotPresent: false,
        contractVersion: null,
        computationPolicyVersion: null,
        provenance: null,
        payloadHashValid: null,
        evidenceFingerprintValid: null,
        finalizedAt: null,
        currentInterpretationDiffers: null,
        issues: ["completed_workout_missing_required_exact_snapshot"],
      });
      continue;
    }
    if (result.status === "not_found_or_unauthorized") {
      rows.push({
        workoutId: workout.id,
        workoutStatus: workout.status,
        snapshotPresent: false,
        contractVersion: null,
        computationPolicyVersion: null,
        provenance: null,
        payloadHashValid: null,
        evidenceFingerprintValid: null,
        finalizedAt: null,
        currentInterpretationDiffers: null,
        issues: ["review_workout_status_disagreement"],
      });
      continue;
    }

    const metadata = result.metadata;
    const issues: string[] =
      result.status === "integrity_error" ? [result.reason] : [];
    if (
      result.status === "ready" &&
      (workout.status !== "COMPLETED" ||
        result.contract.workoutIdentity.status !== workout.status)
    ) {
      issues.push("review_workout_status_disagreement");
    }
    let currentInterpretationDiffers: boolean | null = null;
    if (input.includeCurrentReinterpretation && result.status === "ready") {
      const current = await produceCurrentPostSessionReviewInterpretation(
        workout.userId,
        workout.id,
        client
      );
      currentInterpretationDiffers =
        current.status === "ready"
          ? hashPostSessionReviewValue(current.contract) !== metadata.payloadHash
          : null;
    }
    rows.push({
      workoutId: workout.id,
      workoutStatus: workout.status,
      snapshotPresent: true,
      contractVersion: metadata.contractVersion,
      computationPolicyVersion: metadata.computationPolicyVersion,
      provenance: metadata.provenance,
      payloadHashValid:
        result.status === "integrity_error"
          ? result.reason === "payload_hash_mismatch" || result.reason === "invalid_payload"
            ? false
            : null
          : true,
      evidenceFingerprintValid:
        result.status === "integrity_error"
          ? result.reason === "evidence_fingerprint_mismatch"
            ? false
            : null
          : true,
      finalizedAt: metadata.finalizedAt,
      currentInterpretationDiffers,
      issues,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    rows,
    summary: {
      completedWorkoutCount: rows.filter((row) => row.workoutStatus === "COMPLETED")
        .length,
      exactCount: rows.filter((row) => row.provenance === "exact").length,
      legacyDerivedCount: rows.filter((row) => row.provenance === "legacy_derived").length,
      missingRequiredExactCount: rows.filter((row) =>
        row.issues.includes("completed_workout_missing_required_exact_snapshot")
      ).length,
      integrityErrorCount: rows.filter((row) =>
        row.issues.some(
          (issue) =>
            issue !== "completed_workout_missing_required_exact_snapshot" &&
            issue !== "review_workout_status_disagreement"
        )
      ).length,
      statusDisagreementCount: rows.filter((row) =>
        row.issues.includes("review_workout_status_disagreement")
      ).length,
      unsupportedVersionCount: rows.filter((row) =>
        row.issues.some((issue) => issue.startsWith("unsupported_"))
      ).length,
      currentInterpretationDifferenceCount: rows.filter(
        (row) => row.currentInterpretationDiffers === true
      ).length,
    },
  };
}
