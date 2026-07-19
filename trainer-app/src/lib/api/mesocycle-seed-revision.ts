import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { parseSlotPlanSeedJson } from "./slot-plan-seed-parser";

export const SEED_PAYLOAD_HASH_ALGORITHM = "sha256" as const;

function assertJsonNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error("CANONICAL_JSON_NON_FINITE_NUMBER");
  }
}

export function canonicalizeJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    assertJsonNumber(value);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalizeJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("CANONICAL_JSON_NON_PLAIN_OBJECT");
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined) {
          throw new Error("CANONICAL_JSON_UNDEFINED_VALUE");
        }
        return `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`;
      })
      .join(",")}}`;
  }
  throw new Error("CANONICAL_JSON_UNSUPPORTED_VALUE");
}

export function fingerprintCanonicalJson(value: unknown): string {
  return createHash(SEED_PAYLOAD_HASH_ALGORITHM)
    .update(canonicalizeJson(value), "utf8")
    .digest("hex");
}

export type ExactSeedRevisionProvenance = {
  revisionId: string;
  revision: number;
  hash: string;
};

export type SeedRevisionRecord = {
  id: string;
  mesocycleId: string;
  revision: number;
  seedPayload: unknown;
  payloadHash: string | null;
  hashAlgorithm: string | null;
  provenanceStatus: string;
  creationReason: string;
  actorSource: string | null;
  sourceRevisionId: string | null;
  activatedAt: Date;
};

type SeedRevisionTransaction = Pick<
  Prisma.TransactionClient,
  "mesocycle" | "mesocycleSeedRevision"
>;

function normalizedExecutablePayload(seed: unknown) {
  const parsed = parseSlotPlanSeedJson(seed);
  if (!parsed || parsed.slots.length === 0) {
    throw new Error("ACCEPTED_SEED_PAYLOAD_INVALID");
  }

  return {
    version: 1 as const,
    slots: parsed.slots.map((slot) => {
      if (slot.exercises.length === 0) {
        throw new Error(`ACCEPTED_SEED_SLOT_EMPTY:${slot.slotId}`);
      }
      return {
        slotId: slot.slotId,
        exercises: slot.exercises.map((exercise) => {
          if (!exercise.hasExplicitSetCount || exercise.setCount == null) {
            throw new Error(
              `ACCEPTED_SEED_SET_COUNT_MISSING:${slot.slotId}:${exercise.exerciseId}`,
            );
          }
          return {
            exerciseId: exercise.exerciseId,
            role: exercise.role,
            setCount: exercise.setCount,
          };
        }),
      };
    }),
  };
}

export function normalizeAcceptedSeedPayload(seed: unknown): {
  canonicalPayload: Prisma.InputJsonValue;
  executablePayload: Prisma.InputJsonValue;
  hash: string;
  hashAlgorithm: typeof SEED_PAYLOAD_HASH_ALGORITHM;
} {
  const parsed = parseSlotPlanSeedJson(seed);
  const executablePayload = normalizedExecutablePayload(seed);
  const canonicalPayload = {
    version: 1,
    ...(parsed?.source ? { source: parsed.source } : {}),
    slots: executablePayload.slots,
  } satisfies Prisma.InputJsonValue;
  const serialized = JSON.stringify(executablePayload);

  return {
    canonicalPayload,
    executablePayload,
    hash: createHash(SEED_PAYLOAD_HASH_ALGORITHM)
      .update(serialized, "utf8")
      .digest("hex"),
    hashAlgorithm: SEED_PAYLOAD_HASH_ALGORITHM,
  };
}

export function exactSeedRevisionProvenance(
  revision: Pick<SeedRevisionRecord, "id" | "revision" | "payloadHash" | "hashAlgorithm" | "provenanceStatus">,
): ExactSeedRevisionProvenance | null {
  if (
    revision.provenanceStatus !== "exact" ||
    revision.hashAlgorithm !== SEED_PAYLOAD_HASH_ALGORITHM ||
    !revision.payloadHash
  ) {
    return null;
  }
  return {
    revisionId: revision.id,
    revision: revision.revision,
    hash: revision.payloadHash,
  };
}

async function loadCurrentRevision(
  tx: SeedRevisionTransaction,
  mesocycleId: string,
): Promise<SeedRevisionRecord | null> {
  const mesocycle = await tx.mesocycle.findUnique({
    where: { id: mesocycleId },
    select: {
      currentSeedRevision: {
        select: {
          id: true,
          mesocycleId: true,
          revision: true,
          seedPayload: true,
          payloadHash: true,
          hashAlgorithm: true,
          provenanceStatus: true,
          creationReason: true,
          actorSource: true,
          sourceRevisionId: true,
          activatedAt: true,
        },
      },
    },
  });
  return (mesocycle?.currentSeedRevision as SeedRevisionRecord | null) ?? null;
}

export async function createInitialAcceptedSeedRevisionInTransaction(
  tx: SeedRevisionTransaction,
  input: {
    mesocycleId: string;
    seedPayload: unknown;
    creationReason: string;
    actorSource?: string;
  },
): Promise<SeedRevisionRecord> {
  const normalized = normalizeAcceptedSeedPayload(input.seedPayload);
  const current = await loadCurrentRevision(tx, input.mesocycleId);
  if (current) {
    const currentHash = normalizeAcceptedSeedPayload(current.seedPayload).hash;
    if (currentHash !== normalized.hash) {
      throw new Error("ACCEPTED_SEED_INITIAL_REVISION_CONFLICT");
    }
    return current;
  }

  const revision = await tx.mesocycleSeedRevision.create({
    data: {
      mesocycleId: input.mesocycleId,
      revision: 1,
      seedPayload: normalized.canonicalPayload,
      payloadHash: normalized.hash,
      hashAlgorithm: normalized.hashAlgorithm,
      provenanceStatus: "exact",
      creationReason: input.creationReason,
      actorSource: input.actorSource,
    },
  });
  const activated = await tx.mesocycle.updateMany({
    where: { id: input.mesocycleId, currentSeedRevisionId: null },
    data: { currentSeedRevisionId: revision.id },
  });
  if (activated.count !== 1) {
    throw new Error("ACCEPTED_SEED_REVISION_CONFLICT");
  }
  return revision as SeedRevisionRecord;
}

export async function createCorrectiveSeedRevisionInTransaction(
  tx: SeedRevisionTransaction,
  input: {
    mesocycleId: string;
    expectedCurrentRevisionId?: string;
    seedPayload: unknown;
    creationReason: string;
    actorSource?: string;
  },
): Promise<{ revision: SeedRevisionRecord; created: boolean }> {
  const normalized = normalizeAcceptedSeedPayload(input.seedPayload);
  const current = await loadCurrentRevision(tx, input.mesocycleId);
  if (!current) {
    throw new Error("ACCEPTED_SEED_CURRENT_REVISION_MISSING");
  }
  if (
    input.expectedCurrentRevisionId &&
    current.id !== input.expectedCurrentRevisionId
  ) {
    throw new Error("ACCEPTED_SEED_REVISION_CONFLICT");
  }

  const currentHash = normalizeAcceptedSeedPayload(current.seedPayload).hash;
  if (currentHash === normalized.hash) {
    return { revision: current, created: false };
  }

  const next = await tx.mesocycleSeedRevision.create({
    data: {
      mesocycleId: input.mesocycleId,
      revision: current.revision + 1,
      seedPayload: normalized.canonicalPayload,
      payloadHash: normalized.hash,
      hashAlgorithm: normalized.hashAlgorithm,
      provenanceStatus: "exact",
      creationReason: input.creationReason,
      actorSource: input.actorSource,
      sourceRevisionId: current.id,
    },
  });
  const activated = await tx.mesocycle.updateMany({
    where: {
      id: input.mesocycleId,
      currentSeedRevisionId: current.id,
    },
    data: { currentSeedRevisionId: next.id },
  });
  if (activated.count !== 1) {
    throw new Error("ACCEPTED_SEED_REVISION_CONFLICT");
  }
  return { revision: next as SeedRevisionRecord, created: true };
}

export async function promoteLegacySeedRevisionToExactInTransaction(
  tx: SeedRevisionTransaction,
  input: {
    mesocycleId: string;
    actorSource: string;
    expectedLegacyRevisionFingerprint?: string;
  },
): Promise<{ revision: SeedRevisionRecord; created: boolean }> {
  const current = await loadCurrentRevision(tx, input.mesocycleId);
  if (!current) {
    throw new Error("ACCEPTED_SEED_CURRENT_REVISION_MISSING");
  }
  if (
    input.expectedLegacyRevisionFingerprint &&
    fingerprintCanonicalJson(current.seedPayload) !==
      input.expectedLegacyRevisionFingerprint
  ) {
    throw new Error("LEGACY_REVISION_CHANGED_IN_TRANSACTION");
  }
  if (exactSeedRevisionProvenance(current)) {
    return { revision: current, created: false };
  }

  const normalized = normalizeAcceptedSeedPayload(current.seedPayload);
  const next = await tx.mesocycleSeedRevision.create({
    data: {
      mesocycleId: input.mesocycleId,
      revision: current.revision + 1,
      seedPayload: normalized.canonicalPayload,
      payloadHash: normalized.hash,
      hashAlgorithm: normalized.hashAlgorithm,
      provenanceStatus: "exact",
      creationReason: "legacy_rollout_normalization",
      actorSource: input.actorSource,
      sourceRevisionId: current.id,
    },
  });
  const activated = await tx.mesocycle.updateMany({
    where: { id: input.mesocycleId, currentSeedRevisionId: current.id },
    data: { currentSeedRevisionId: next.id },
  });
  if (activated.count !== 1) {
    throw new Error("ACCEPTED_SEED_REVISION_CONFLICT");
  }
  return { revision: next as SeedRevisionRecord, created: true };
}

export function mapSeedRevisionWriteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    throw new Error("ACCEPTED_SEED_REVISION_CONFLICT");
  }
  throw error;
}
