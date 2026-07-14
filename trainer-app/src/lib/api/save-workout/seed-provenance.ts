import type { Prisma } from "@prisma/client";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";

export type PersistedWorkoutSeedProvenance = {
  seedRevisionId: string;
  seedRevisionNumber: number;
  seedPayloadHash: string;
};

function receiptUsesAcceptedSeed(receipt: SessionDecisionReceipt): boolean {
  return (
    receipt.sessionProvenance?.compositionSource === "persisted_slot_plan_seed" ||
    receipt.sessionProvenance?.compositionSource === "deload_seed_replay"
  );
}

export async function resolveWorkoutSeedProvenanceForSave(
  tx: Prisma.TransactionClient,
  input: {
    receipt: SessionDecisionReceipt;
    resolvedMesocycleId: string | null;
    existingWorkout: {
      seedRevisionId: string | null;
      seedRevisionNumber: number | null;
      seedPayloadHash: string | null;
    } | null;
  },
): Promise<PersistedWorkoutSeedProvenance | null> {
  const receiptSeed = input.receipt.sessionProvenance?.seedProvenance;
  const existing = input.existingWorkout;
  if (
    existing?.seedRevisionId &&
    existing.seedRevisionNumber != null &&
    existing.seedPayloadHash
  ) {
    if (
      receiptSeed &&
      (receiptSeed.revisionId !== existing.seedRevisionId ||
        receiptSeed.revision !== existing.seedRevisionNumber ||
        receiptSeed.hash !== existing.seedPayloadHash)
    ) {
      throw new Error("WORKOUT_SEED_PROVENANCE_IMMUTABLE");
    }
    return {
      seedRevisionId: existing.seedRevisionId,
      seedRevisionNumber: existing.seedRevisionNumber,
      seedPayloadHash: existing.seedPayloadHash,
    };
  }
  if (existing) {
    return null;
  }

  if (!receiptUsesAcceptedSeed(input.receipt)) {
    return null;
  }
  if (!receiptSeed || !input.resolvedMesocycleId) {
    throw new Error("WORKOUT_EXACT_SEED_PROVENANCE_REQUIRED");
  }

  const revision = await tx.mesocycleSeedRevision.findFirst({
    where: {
      id: receiptSeed.revisionId,
      mesocycleId: input.resolvedMesocycleId,
      revision: receiptSeed.revision,
      payloadHash: receiptSeed.hash,
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
    },
    select: { id: true, revision: true, payloadHash: true },
  });
  if (!revision?.payloadHash) {
    throw new Error("WORKOUT_SEED_PROVENANCE_INVALID");
  }

  return {
    seedRevisionId: revision.id,
    seedRevisionNumber: revision.revision,
    seedPayloadHash: revision.payloadHash,
  };
}
