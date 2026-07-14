import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { Prisma } from "@prisma/client";
import {
  isPostSessionReviewContract,
  type PostSessionReviewContract,
} from "./post-session-review-contract";
import {
  produceCurrentPostSessionReviewInterpretation,
  type PostSessionReviewProducerResult,
} from "./post-session-review-producer";
import type { ExplainabilityReader } from "./explainability";

export const POST_SESSION_REVIEW_CONTRACT_VERSION = 1 as const;
export const POST_SESSION_REVIEW_POLICY_VERSION = 1 as const;
export const POST_SESSION_REVIEW_HASH_ALGORITHM = "sha256" as const;
const SUPPORTED_POST_SESSION_REVIEW_CONTRACT_VERSIONS = [1] as const;
const SUPPORTED_POST_SESSION_REVIEW_POLICY_VERSIONS = [1] as const;

export type PostSessionReviewSnapshotProvenance =
  | "exact"
  | "legacy_derived"
  | "legacy_unknown";

export type PostSessionReviewSnapshotReader = ExplainabilityReader &
  Pick<Prisma.TransactionClient, "postSessionReviewSnapshot">;

export type PostSessionReviewSnapshotMetadata = {
  snapshotId: string | null;
  provenance: PostSessionReviewSnapshotProvenance;
  contractVersion: number;
  computationPolicyVersion: number;
  payloadHash: string | null;
  evidenceFingerprint: string | null;
  finalizedAt: string | null;
  exactHistoricalInterpretation: boolean;
};

export type HistoricalPostSessionReviewResult =
  | {
      status: "ready";
      contract: PostSessionReviewContract;
      metadata: PostSessionReviewSnapshotMetadata;
    }
  | {
      status: "legacy_missing";
    }
  | {
      status: "not_found_or_unauthorized";
    }
  | {
      status: "integrity_error";
      reason:
        | "unsupported_contract_version"
        | "unsupported_policy_version"
        | "invalid_payload"
        | "payload_hash_mismatch"
        | "evidence_fingerprint_mismatch";
      message: string;
      metadata: PostSessionReviewSnapshotMetadata;
    };

function normalizeForHash(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForHash);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForHash(item)])
    );
  }
  return value;
}

export function stablePostSessionReviewJson(value: unknown): string {
  return JSON.stringify(normalizeForHash(value));
}

export function hashPostSessionReviewValue(value: unknown): string {
  return createHash(POST_SESSION_REVIEW_HASH_ALGORITHM)
    .update(stablePostSessionReviewJson(value), "utf8")
    .digest("hex");
}

async function loadReviewEvidence(
  client: PostSessionReviewSnapshotReader,
  userId: string,
  workoutId: string
) {
  const workout = await client.workout.findFirst({
    where: { id: workoutId, userId },
    select: {
      id: true,
      userId: true,
      scheduledDate: true,
      completedAt: true,
      status: true,
      revision: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      advancesSplit: true,
      templateId: true,
      mesocycleId: true,
      seedRevisionId: true,
      seedRevisionNumber: true,
      seedPayloadHash: true,
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
      mesocyclePhaseSnapshot: true,
      exercises: {
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
        select: {
          id: true,
          exerciseId: true,
          orderIndex: true,
          section: true,
          isMainLift: true,
          stimulusAccountingSnapshot: true,
          sets: {
            orderBy: [{ setIndex: "asc" }, { id: "asc" }],
            select: {
              id: true,
              setIndex: true,
              targetReps: true,
              targetRepMin: true,
              targetRepMax: true,
              targetRpe: true,
              targetLoad: true,
              restSeconds: true,
              logs: {
                orderBy: { completedAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  setIntent: true,
                  actualReps: true,
                  actualRpe: true,
                  actualLoad: true,
                  completedAt: true,
                  notes: true,
                  wasSkipped: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!workout) return null;

  const exerciseIds = workout.exercises.map((exercise) => exercise.exerciseId);
  const sevenDaysBefore = new Date(workout.scheduledDate);
  sevenDaysBefore.setDate(sevenDaysBefore.getDate() - 7);
  const [priorExerciseHistory, weeklyPerformedHistory] = await Promise.all([
    exerciseIds.length > 0
      ? client.workoutExercise.findMany({
          where: {
            exerciseId: { in: exerciseIds },
            workout: {
              userId,
              id: { not: workoutId },
              scheduledDate: { lt: workout.scheduledDate },
              status: { in: [...PERFORMED_WORKOUT_STATUSES] },
            },
          },
          orderBy: [
            { workout: { scheduledDate: "asc" } },
            { orderIndex: "asc" },
            { id: "asc" },
          ],
          select: {
            id: true,
            workoutId: true,
            exerciseId: true,
            orderIndex: true,
            section: true,
            isMainLift: true,
            stimulusAccountingSnapshot: true,
            workout: {
              select: {
                scheduledDate: true,
                completedAt: true,
                status: true,
                revision: true,
                selectionMode: true,
                sessionIntent: true,
                selectionMetadata: true,
                advancesSplit: true,
                mesocyclePhaseSnapshot: true,
              },
            },
            sets: {
              orderBy: [{ setIndex: "asc" }, { id: "asc" }],
              select: {
                id: true,
                setIndex: true,
                targetReps: true,
                targetRepMin: true,
                targetRepMax: true,
                targetRpe: true,
                targetLoad: true,
                logs: {
                  orderBy: { completedAt: "desc" },
                  take: 1,
                  select: {
                    setIntent: true,
                    actualReps: true,
                    actualRpe: true,
                    actualLoad: true,
                    completedAt: true,
                    wasSkipped: true,
                  },
                },
              },
            },
          },
        })
      : Promise.resolve([]),
    client.workout.findMany({
      where: {
        userId,
        id: { not: workoutId },
        status: { in: [...PERFORMED_WORKOUT_STATUSES] },
        scheduledDate: { gte: sevenDaysBefore, lte: workout.scheduledDate },
      },
      orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
      select: {
        id: true,
        scheduledDate: true,
        completedAt: true,
        status: true,
        revision: true,
        selectionMetadata: true,
        advancesSplit: true,
        mesocycleId: true,
        mesocycleWeekSnapshot: true,
        exercises: {
          orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
          select: {
            id: true,
            exerciseId: true,
            orderIndex: true,
            stimulusAccountingSnapshot: true,
            sets: {
              orderBy: [{ setIndex: "asc" }, { id: "asc" }],
              select: {
                id: true,
                setIndex: true,
                logs: {
                  orderBy: { completedAt: "desc" },
                  take: 1,
                  select: {
                    setIntent: true,
                    actualReps: true,
                    actualRpe: true,
                    actualLoad: true,
                    completedAt: true,
                    wasSkipped: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  return { workout, priorExerciseHistory, weeklyPerformedHistory };
}

export async function buildPostSessionReviewEvidenceFingerprint(
  client: PostSessionReviewSnapshotReader,
  input: { userId: string; workoutId: string }
): Promise<string | null> {
  const evidence = await loadReviewEvidence(client, input.userId, input.workoutId);
  return evidence ? hashPostSessionReviewValue(evidence) : null;
}

function metadataFromSnapshot(snapshot: {
  id: string;
  provenance: string;
  contractVersion: number;
  computationPolicyVersion: number;
  payloadHash: string;
  evidenceFingerprint: string;
  finalizedAt: Date;
}): PostSessionReviewSnapshotMetadata {
  return {
    snapshotId: snapshot.id,
    provenance: snapshot.provenance as PostSessionReviewSnapshotProvenance,
    contractVersion: snapshot.contractVersion,
    computationPolicyVersion: snapshot.computationPolicyVersion,
    payloadHash: snapshot.payloadHash,
    evidenceFingerprint: snapshot.evidenceFingerprint,
    finalizedAt: snapshot.finalizedAt.toISOString(),
    exactHistoricalInterpretation: snapshot.provenance === "exact",
  };
}

function integrityError(
  reason: Extract<HistoricalPostSessionReviewResult, { status: "integrity_error" }>["reason"],
  message: string,
  metadata: PostSessionReviewSnapshotMetadata
): HistoricalPostSessionReviewResult {
  return { status: "integrity_error", reason, message, metadata };
}

export async function loadHistoricalPostSessionReview(
  userId: string,
  workoutId: string,
  client: PostSessionReviewSnapshotReader = prisma
): Promise<HistoricalPostSessionReviewResult> {
  const workout = await client.workout.findFirst({
    where: { id: workoutId, userId },
    select: {
      id: true,
      postSessionReviewSnapshot: {
        select: {
          id: true,
          contractVersion: true,
          computationPolicyVersion: true,
          payload: true,
          payloadHash: true,
          evidenceFingerprint: true,
          provenance: true,
          finalizedAt: true,
        },
      },
    },
  });
  if (!workout) {
    return { status: "not_found_or_unauthorized" };
  }
  const snapshot = workout.postSessionReviewSnapshot;
  if (!snapshot) {
    return { status: "legacy_missing" };
  }

  const metadata = metadataFromSnapshot(snapshot);
  if (
    !(SUPPORTED_POST_SESSION_REVIEW_CONTRACT_VERSIONS as readonly number[]).includes(
      snapshot.contractVersion
    )
  ) {
    return integrityError(
      "unsupported_contract_version",
      `Unsupported post-session review contract version ${snapshot.contractVersion}.`,
      metadata
    );
  }
  if (
    !(SUPPORTED_POST_SESSION_REVIEW_POLICY_VERSIONS as readonly number[]).includes(
      snapshot.computationPolicyVersion
    )
  ) {
    return integrityError(
      "unsupported_policy_version",
      `Unsupported post-session review policy version ${snapshot.computationPolicyVersion}.`,
      metadata
    );
  }
  if (!isPostSessionReviewContract(snapshot.payload, { userId, workoutId })) {
    return integrityError(
      "invalid_payload",
      "Persisted post-session review payload failed contract validation.",
      metadata
    );
  }
  if (hashPostSessionReviewValue(snapshot.payload) !== snapshot.payloadHash) {
    return integrityError(
      "payload_hash_mismatch",
      "Persisted post-session review payload hash does not match.",
      metadata
    );
  }
  const evidenceFingerprint = await buildPostSessionReviewEvidenceFingerprint(client, {
    userId,
    workoutId,
  });
  if (!evidenceFingerprint || evidenceFingerprint !== snapshot.evidenceFingerprint) {
    return integrityError(
      "evidence_fingerprint_mismatch",
      "Persisted workout evidence no longer matches the finalized review.",
      metadata
    );
  }

  return { status: "ready", contract: snapshot.payload, metadata };
}

export async function createPostSessionReviewSnapshotInTransaction(
  tx: PostSessionReviewSnapshotReader,
  input: {
    userId: string;
    workoutId: string;
    provenance: Extract<PostSessionReviewSnapshotProvenance, "exact" | "legacy_derived">;
    finalizedAt?: Date;
  }
) {
  const existing = await tx.postSessionReviewSnapshot.findUnique({
    where: { workoutId: input.workoutId },
  });
  if (existing) {
    const currentEvidenceFingerprint =
      await buildPostSessionReviewEvidenceFingerprint(tx, input);
    if (
      existing.contractVersion !== POST_SESSION_REVIEW_CONTRACT_VERSION ||
      hashPostSessionReviewValue(existing.payload) !== existing.payloadHash ||
      !currentEvidenceFingerprint ||
      currentEvidenceFingerprint !== existing.evidenceFingerprint
    ) {
      throw new Error("POST_SESSION_REVIEW_SNAPSHOT_CONFLICT");
    }
    return { snapshot: existing, created: false };
  }

  const produced = await produceCurrentPostSessionReviewInterpretation(
    input.userId,
    input.workoutId,
    tx
  );
  if (produced.status !== "ready") {
    throw new Error(`POST_SESSION_REVIEW_FINALIZATION_FAILED:${produced.reason}`);
  }
  if (
    !(PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(
      produced.contract.workoutIdentity.status
    )
  ) {
    throw new Error("POST_SESSION_REVIEW_FINALIZATION_FAILED:not_ready");
  }
  const evidenceFingerprint = await buildPostSessionReviewEvidenceFingerprint(tx, input);
  if (!evidenceFingerprint) {
    throw new Error("POST_SESSION_REVIEW_FINALIZATION_FAILED:evidence_missing");
  }

  let snapshot;
  try {
    snapshot = await tx.postSessionReviewSnapshot.create({
      data: {
        workoutId: input.workoutId,
        contractVersion: POST_SESSION_REVIEW_CONTRACT_VERSION,
        computationPolicyVersion: POST_SESSION_REVIEW_POLICY_VERSION,
        payload: produced.contract as unknown as Prisma.InputJsonValue,
        payloadHash: hashPostSessionReviewValue(produced.contract),
        evidenceFingerprint,
        provenance: input.provenance,
        finalizedAt: input.finalizedAt ?? new Date(),
      },
    });
  } catch (error) {
    mapPostSessionReviewSnapshotWriteError(error);
  }
  return { snapshot, created: true };
}

export function legacyDerivedSnapshotMetadata(
  contract: PostSessionReviewContract
): PostSessionReviewSnapshotMetadata {
  return {
    snapshotId: null,
    provenance: "legacy_derived",
    contractVersion: contract.contractVersion,
    computationPolicyVersion: POST_SESSION_REVIEW_POLICY_VERSION,
    payloadHash: null,
    evidenceFingerprint: null,
    finalizedAt: null,
    exactHistoricalInterpretation: false,
  };
}

export function mapPostSessionReviewSnapshotWriteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new Error("POST_SESSION_REVIEW_SNAPSHOT_CONFLICT");
  }
  throw error;
}

export type CurrentPostSessionReviewInterpretationResult = PostSessionReviewProducerResult;
