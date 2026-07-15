import type {
  MesocycleState,
  PreSessionReadinessSnapshot,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { SIGNAL_STALENESS_THRESHOLD_MS } from "./readiness";
import { loadNextWorkoutContext } from "./next-session";
import {
  isPreSessionReadinessContract,
  type PreSessionReadinessContract,
} from "./pre-session-readiness-contract";
import {
  hashPreSessionReadinessIdentity,
  hashPreSessionReadinessTarget,
  hashPreSessionReadinessValue,
  parsePreSessionReadinessIdentity,
  PRE_SESSION_READINESS_IDENTITY_CONTRACT_VERSION,
  PRE_SESSION_READINESS_IDENTITY_STATUS_EXACT,
  type PreSessionReadinessIdentity,
} from "./pre-session-readiness-identity";

const PRE_SESSION_READINESS_CONTRACT_VERSION = 1;
const MAX_TRANSACTION_ATTEMPTS = 2;

type SnapshotReader = typeof prisma | Prisma.TransactionClient;

type SnapshotIdentity = {
  userId: string;
  activeMesocycleId: string;
  mesocycleState: MesocycleState;
  weekInMeso: number;
  sessionInWeek: number;
  slotId: string;
  slotIntent: string;
  plannedWorkoutId: string | null;
  plannedWorkoutRevision: number | null;
  contractVersion: number;
};

export type PreSessionReadinessCurrentSnapshotIdentity = SnapshotIdentity & {
  identity: PreSessionReadinessIdentity;
  identityHash: string;
  targetHash: string;
  readinessEvidenceFingerprint: string;
  projectionFingerprint: string;
  slotPlanSeedHash: string | null;
  slotSequenceHash: string | null;
  seedRevisionId: string | null;
  seedRevisionNumber: number | null;
  seedPayloadHash: string | null;
  prescriptionFingerprint: string | null;
};

export type ActivatePreSessionReadinessSnapshotInput = {
  preparedIdentity: PreSessionReadinessCurrentSnapshotIdentity;
  contract: PreSessionReadinessContract;
  expiresAt?: Date | null;
};

export type ActivatePreSessionReadinessSnapshotResult = {
  snapshot: PreSessionReadinessSnapshot;
  invalidatedSnapshotCount: number;
  outcome: "created" | "reused";
};

export type PreSessionReadinessSnapshotCandidate = Pick<
  PreSessionReadinessSnapshot,
  | "id"
  | "userId"
  | "activeMesocycleId"
  | "mesocycleState"
  | "weekInMeso"
  | "sessionInWeek"
  | "slotId"
  | "slotIntent"
  | "plannedWorkoutId"
  | "plannedWorkoutRevision"
  | "contractVersion"
  | "contractJson"
  | "identityStatus"
  | "identityContractVersion"
  | "identityJson"
  | "identityHash"
  | "targetHash"
  | "payloadHash"
  | "readinessEvidenceFingerprint"
  | "projectionFingerprint"
  | "seedRevisionId"
  | "seedRevisionNumber"
  | "seedPayloadHash"
  | "prescriptionFingerprint"
  | "sourceStateHash"
  | "slotPlanSeedHash"
  | "slotSequenceHash"
  | "createdAt"
  | "expiresAt"
  | "invalidatedAt"
  | "invalidatedReason"
>;

export type PreSessionReadinessSnapshotLoadResult =
  | {
      status: "available";
      snapshot: PreSessionReadinessSnapshotCandidate;
      contract: PreSessionReadinessContract;
      identity: PreSessionReadinessCurrentSnapshotIdentity;
    }
  | {
      status: "unavailable" | "integrity_error";
      reason:
        | "no_current_identity"
        | "no_active_exact_snapshot"
        | "expired"
        | "unsupported_identity_version"
        | "invalid_identity"
        | "identity_hash_mismatch"
        | "payload_hash_mismatch"
        | "invalid_contract"
        | "contract_identity_mismatch"
        | "current_identity_mismatch";
      snapshotId?: string;
    };

export class PreSessionReadinessSnapshotConflictError extends Error {
  constructor(
    public readonly code:
      | "STALE_PREPARATION"
      | "PAYLOAD_INTEGRITY_CONFLICT"
      | "CONCURRENT_TARGET_CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "PreSessionReadinessSnapshotConflictError";
  }
}

function normalizeIntent(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export const hashPreSessionReadinessSnapshotSource =
  hashPreSessionReadinessValue;

const workoutPrescriptionSelect = {
  id: true,
  revision: true,
  status: true,
  sessionIntent: true,
  selectionMode: true,
  selectionMetadata: true,
  exercises: {
    orderBy: [{ orderIndex: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      exerciseId: true,
      orderIndex: true,
      section: true,
      isMainLift: true,
      movementPatterns: true,
      stimulusAccountingSnapshot: true,
      sets: {
        orderBy: [{ setIndex: "asc" as const }, { id: "asc" as const }],
        select: {
          id: true,
          setIndex: true,
          targetReps: true,
          targetRepMin: true,
          targetRepMax: true,
          targetRpe: true,
          targetLoad: true,
          restSeconds: true,
        },
      },
    },
  },
} satisfies Prisma.WorkoutSelect;

const projectionWorkoutSelect = {
  ...workoutPrescriptionSelect,
  scheduledDate: true,
  completedAt: true,
  mesocycleWeekSnapshot: true,
  mesoSessionSnapshot: true,
  advancesSplit: true,
  seedRevisionId: true,
  seedRevisionNumber: true,
  seedPayloadHash: true,
  exercises: {
    ...workoutPrescriptionSelect.exercises,
    select: {
      ...workoutPrescriptionSelect.exercises.select,
      sets: {
        ...workoutPrescriptionSelect.exercises.select.sets,
        select: {
          ...workoutPrescriptionSelect.exercises.select.sets.select,
          logs: {
            orderBy: [{ completedAt: "asc" as const }, { id: "asc" as const }],
            select: {
              id: true,
              setIntent: true,
              actualReps: true,
              actualRpe: true,
              actualLoad: true,
              wasSkipped: true,
              completedAt: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.WorkoutSelect;

type BoundaryEvidence = {
  mesocycle: NonNullable<Awaited<ReturnType<typeof loadBoundaryEvidenceRows>>>["mesocycle"];
  plannedWorkout: NonNullable<Awaited<ReturnType<typeof loadBoundaryEvidenceRows>>>["plannedWorkout"];
  readinessEvidenceFingerprint: string;
  projectionFingerprint: string;
  slotPlanSeedHash: string | null;
  slotSequenceHash: string | null;
  seedRevisionId: string | null;
  seedRevisionNumber: number | null;
  seedPayloadHash: string | null;
  prescriptionFingerprint: string | null;
};

async function loadBoundaryEvidenceRows(
  reader: SnapshotReader,
  input: {
    userId: string;
    activeMesocycleId?: string;
    weekInMeso: number;
    plannedWorkoutId: string | null;
  }
) {
  const mesocycle = await reader.mesocycle.findFirst({
    where: {
      ...(input.activeMesocycleId ? { id: input.activeMesocycleId } : {}),
      isActive: true,
      macroCycle: { userId: input.userId },
    },
    select: {
      id: true,
      state: true,
      completedSessions: true,
      accumulationSessionsCompleted: true,
      deloadSessionsCompleted: true,
      sessionsPerWeek: true,
      slotPlanSeedJson: true,
      slotSequenceJson: true,
      currentSeedRevisionId: true,
      currentSeedRevision: {
        select: {
          id: true,
          revision: true,
          seedPayload: true,
          payloadHash: true,
          provenanceStatus: true,
        },
      },
      weekCloses: {
        where: { targetWeek: input.weekInMeso },
        orderBy: { id: "asc" },
        select: {
          id: true,
          targetWeek: true,
          status: true,
          resolution: true,
          optionalWorkoutId: true,
          deficitSnapshotJson: true,
          triggeredAt: true,
          resolvedAt: true,
        },
      },
    },
  });
  if (!mesocycle) return null;

  const [readinessSignal, projectionWorkouts, plannedWorkout] =
    await Promise.all([
      reader.readinessSignal.findFirst({
        where: { userId: input.userId },
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      }),
      reader.workout.findMany({
        where: {
          userId: input.userId,
          mesocycleId: mesocycle.id,
          OR: [
            { mesocycleWeekSnapshot: input.weekInMeso },
            { mesocycleWeekSnapshot: null },
            { status: { in: ["PLANNED", "IN_PROGRESS"] } },
          ],
        },
        orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
        select: projectionWorkoutSelect,
      }),
      input.plannedWorkoutId
        ? reader.workout.findFirst({
            where: { id: input.plannedWorkoutId, userId: input.userId },
            select: workoutPrescriptionSelect,
          })
        : Promise.resolve(null),
    ]);

  return { mesocycle, readinessSignal, projectionWorkouts, plannedWorkout };
}

async function loadBoundaryEvidence(
  reader: SnapshotReader,
  input: {
    userId: string;
    activeMesocycleId?: string;
    weekInMeso: number;
    plannedWorkoutId: string | null;
    now?: Date;
  }
): Promise<BoundaryEvidence | null> {
  const rows = await loadBoundaryEvidenceRows(reader, input);
  if (!rows) return null;
  if (input.plannedWorkoutId && !rows.plannedWorkout) return null;

  const now = input.now ?? new Date();
  const readinessIsFresh = Boolean(
    rows.readinessSignal &&
      now.getTime() - rows.readinessSignal.timestamp.getTime() <=
        SIGNAL_STALENESS_THRESHOLD_MS
  );
  const readinessEvidenceFingerprint = hashPreSessionReadinessValue(
    readinessIsFresh
      ? { availability: "fresh", signal: rows.readinessSignal }
      : { availability: "none_or_stale" }
  );
  const seedPayload =
    rows.mesocycle.currentSeedRevision?.seedPayload ??
    rows.mesocycle.slotPlanSeedJson;
  const seedPayloadHash =
    seedPayload == null ? null : hashPreSessionReadinessValue(seedPayload);
  const slotSequenceHash =
    rows.mesocycle.slotSequenceJson == null
      ? null
      : hashPreSessionReadinessValue(rows.mesocycle.slotSequenceJson);
  const prescriptionFingerprint = rows.plannedWorkout
    ? hashPreSessionReadinessValue(rows.plannedWorkout)
    : null;

  return {
    mesocycle: rows.mesocycle,
    plannedWorkout: rows.plannedWorkout,
    readinessEvidenceFingerprint,
    projectionFingerprint: hashPreSessionReadinessValue({
      lifecycle: {
        id: rows.mesocycle.id,
        state: rows.mesocycle.state,
        completedSessions: rows.mesocycle.completedSessions,
        accumulationSessionsCompleted:
          rows.mesocycle.accumulationSessionsCompleted,
        deloadSessionsCompleted: rows.mesocycle.deloadSessionsCompleted,
        sessionsPerWeek: rows.mesocycle.sessionsPerWeek,
        currentSeedRevisionId: rows.mesocycle.currentSeedRevisionId,
        slotSequenceHash,
        seedPayloadHash,
      },
      weekCloses: rows.mesocycle.weekCloses,
      workouts: rows.projectionWorkouts,
    }),
    slotPlanSeedHash: seedPayloadHash,
    slotSequenceHash,
    seedRevisionId: rows.mesocycle.currentSeedRevision?.id ?? null,
    seedRevisionNumber: rows.mesocycle.currentSeedRevision?.revision ?? null,
    seedPayloadHash,
    prescriptionFingerprint,
  };
}

function buildExactIdentity(input: {
  userId: string;
  weekInMeso: number;
  sessionInWeek: number;
  slotId: string;
  slotIntent: string;
  boundary: BoundaryEvidence;
}): PreSessionReadinessIdentity | null {
  const { boundary } = input;
  const target: PreSessionReadinessIdentity["target"] | null = boundary.plannedWorkout
    ? {
        kind: "materialized_workout",
        workoutId: boundary.plannedWorkout.id,
        workoutRevision: boundary.plannedWorkout.revision,
        prescriptionFingerprint: boundary.prescriptionFingerprint!,
      }
    : boundary.seedPayloadHash
      ? {
          kind: "future_slot",
          mesocycleId: boundary.mesocycle.id,
          weekInMeso: input.weekInMeso,
          sessionInWeek: input.sessionInWeek,
          slotId: input.slotId,
          slotIntent: normalizeIntent(input.slotIntent) ?? input.slotIntent,
          seedRevision:
            boundary.mesocycle.currentSeedRevision?.provenanceStatus === "exact" &&
            boundary.seedRevisionId &&
            boundary.seedRevisionNumber != null
              ? {
                  status: "exact_revision",
                  revisionId: boundary.seedRevisionId,
                  revision: boundary.seedRevisionNumber,
                  payloadHash: boundary.seedPayloadHash,
                }
              : {
                  status: "legacy_payload",
                  payloadHash: boundary.seedPayloadHash,
                },
          slotSequenceHash: boundary.slotSequenceHash,
        }
      : null;
  if (!target) return null;

  return {
    identityContractVersion: PRE_SESSION_READINESS_IDENTITY_CONTRACT_VERSION,
    ownerId: input.userId,
    activeMesocycleId: boundary.mesocycle.id,
    mesocycleState: boundary.mesocycle.state,
    weekInMeso: input.weekInMeso,
    sessionInWeek: input.sessionInWeek,
    target,
    readinessEvidenceFingerprint: boundary.readinessEvidenceFingerprint,
    projectionFingerprint: boundary.projectionFingerprint,
  };
}

export async function loadCurrentPreSessionReadinessSnapshotIdentity(
  userId: string,
  options: { now?: Date } = {}
): Promise<PreSessionReadinessCurrentSnapshotIdentity | null> {
  const nextWorkoutContext = await loadNextWorkoutContext(userId);
  if (
    nextWorkoutContext.weekInMeso == null ||
    nextWorkoutContext.sessionInWeek == null ||
    !nextWorkoutContext.slotId ||
    !nextWorkoutContext.intent
  ) {
    return null;
  }

  const boundary = await loadBoundaryEvidence(prisma, {
    userId,
    weekInMeso: nextWorkoutContext.weekInMeso,
    plannedWorkoutId: nextWorkoutContext.existingWorkoutId ?? null,
    now: options.now,
  });
  if (!boundary) return null;
  const identity = buildExactIdentity({
    userId,
    weekInMeso: nextWorkoutContext.weekInMeso,
    sessionInWeek: nextWorkoutContext.sessionInWeek,
    slotId: nextWorkoutContext.slotId,
    slotIntent: nextWorkoutContext.intent,
    boundary,
  });
  if (!identity) return null;

  return {
    userId,
    activeMesocycleId: boundary.mesocycle.id,
    mesocycleState: boundary.mesocycle.state,
    weekInMeso: nextWorkoutContext.weekInMeso,
    sessionInWeek: nextWorkoutContext.sessionInWeek,
    slotId: nextWorkoutContext.slotId,
    slotIntent: normalizeIntent(nextWorkoutContext.intent) ?? nextWorkoutContext.intent,
    plannedWorkoutId: boundary.plannedWorkout?.id ?? null,
    plannedWorkoutRevision: boundary.plannedWorkout?.revision ?? null,
    contractVersion: PRE_SESSION_READINESS_CONTRACT_VERSION,
    identity,
    identityHash: hashPreSessionReadinessIdentity(identity),
    targetHash: hashPreSessionReadinessTarget(identity),
    readinessEvidenceFingerprint: identity.readinessEvidenceFingerprint,
    projectionFingerprint: identity.projectionFingerprint,
    slotPlanSeedHash: boundary.slotPlanSeedHash,
    slotSequenceHash: boundary.slotSequenceHash,
    seedRevisionId: boundary.seedRevisionId,
    seedRevisionNumber: boundary.seedRevisionNumber,
    seedPayloadHash: boundary.seedPayloadHash,
    prescriptionFingerprint: boundary.prescriptionFingerprint,
  };
}

function contractMatchesIdentity(input: {
  contract: PreSessionReadinessContract;
  identity: SnapshotIdentity;
}): boolean {
  const contractIdentity = input.contract.nextSessionIdentity;
  return (
    contractIdentity.userId === input.identity.userId &&
    contractIdentity.activeMesocycleId === input.identity.activeMesocycleId &&
    contractIdentity.activeState === input.identity.mesocycleState &&
    contractIdentity.currentWeek === input.identity.weekInMeso &&
    contractIdentity.currentSession === input.identity.sessionInWeek &&
    contractIdentity.nextSlotId === input.identity.slotId &&
    normalizeIntent(contractIdentity.nextIntent) ===
      normalizeIntent(input.identity.slotIntent) &&
    (contractIdentity.existingWorkoutId ?? null) ===
      input.identity.plannedWorkoutId
  );
}

function assertValidActivationInput(
  input: ActivatePreSessionReadinessSnapshotInput
): void {
  const prepared = input.preparedIdentity;
  const parsedIdentity = parsePreSessionReadinessIdentity(prepared.identity);
  if (
    prepared.contractVersion !== PRE_SESSION_READINESS_CONTRACT_VERSION ||
    input.contract.contractVersion !== PRE_SESSION_READINESS_CONTRACT_VERSION ||
    !isPreSessionReadinessContract(input.contract, { userId: prepared.userId }) ||
    !contractMatchesIdentity({ contract: input.contract, identity: prepared }) ||
    !parsedIdentity ||
    hashPreSessionReadinessIdentity(parsedIdentity) !== prepared.identityHash ||
    hashPreSessionReadinessTarget(parsedIdentity) !== prepared.targetHash
  ) {
    throw new Error("Invalid pre-session readiness snapshot activation input.");
  }
}

async function revalidatePreparedIdentity(
  tx: Prisma.TransactionClient,
  prepared: PreSessionReadinessCurrentSnapshotIdentity
): Promise<void> {
  const boundary = await loadBoundaryEvidence(tx, {
    userId: prepared.userId,
    activeMesocycleId: prepared.activeMesocycleId,
    weekInMeso: prepared.weekInMeso,
    plannedWorkoutId: prepared.plannedWorkoutId,
  });
  const currentIdentity = boundary
    ? buildExactIdentity({
        userId: prepared.userId,
        weekInMeso: prepared.weekInMeso,
        sessionInWeek: prepared.sessionInWeek,
        slotId: prepared.slotId,
        slotIntent: prepared.slotIntent,
        boundary,
      })
    : null;
  if (
    !currentIdentity ||
    hashPreSessionReadinessIdentity(currentIdentity) !== prepared.identityHash
  ) {
    throw new PreSessionReadinessSnapshotConflictError(
      "STALE_PREPARATION",
      "Readiness evidence changed while the snapshot was being prepared."
    );
  }
}

function candidateIdentity(snapshot: PreSessionReadinessSnapshotCandidate) {
  return parsePreSessionReadinessIdentity(snapshot.identityJson);
}

type SnapshotIntegrityReason =
  | "unsupported_identity_version"
  | "invalid_identity"
  | "identity_hash_mismatch"
  | "payload_hash_mismatch"
  | "invalid_contract"
  | "contract_identity_mismatch"
  | "current_identity_mismatch";

function exactSnapshotIntegrityReason(input: {
  snapshot: PreSessionReadinessSnapshotCandidate;
  expected?: PreSessionReadinessCurrentSnapshotIdentity;
}): SnapshotIntegrityReason | null {
  const { snapshot, expected } = input;
  if (
    snapshot.identityStatus !== PRE_SESSION_READINESS_IDENTITY_STATUS_EXACT ||
    snapshot.identityContractVersion !==
      PRE_SESSION_READINESS_IDENTITY_CONTRACT_VERSION
  ) {
    return "unsupported_identity_version";
  }
  const identity = candidateIdentity(snapshot);
  if (!identity) return "invalid_identity";
  if (
    !snapshot.identityHash ||
    hashPreSessionReadinessIdentity(identity) !== snapshot.identityHash ||
    !snapshot.targetHash ||
    hashPreSessionReadinessTarget(identity) !== snapshot.targetHash
  ) {
    return "identity_hash_mismatch";
  }
  if (
    !snapshot.payloadHash ||
    hashPreSessionReadinessValue(snapshot.contractJson) !== snapshot.payloadHash
  ) {
    return "payload_hash_mismatch";
  }
  if (
    !isPreSessionReadinessContract(snapshot.contractJson, {
      userId: snapshot.userId,
    })
  ) {
    return "invalid_contract";
  }
  if (
    !contractMatchesIdentity({
      contract: snapshot.contractJson,
      identity: snapshot,
    })
  ) {
    return "contract_identity_mismatch";
  }
  if (
    expected &&
    (snapshot.identityHash !== expected.identityHash ||
      snapshot.readinessEvidenceFingerprint !==
        expected.readinessEvidenceFingerprint ||
      snapshot.projectionFingerprint !== expected.projectionFingerprint)
  ) {
    return "current_identity_mismatch";
  }
  return null;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function loadActiveExactSnapshotByIdentity(
  reader: SnapshotReader,
  userId: string,
  identityHash: string
): Promise<PreSessionReadinessSnapshotCandidate | null> {
  return reader.preSessionReadinessSnapshot.findFirst({
    where: {
      userId,
      identityStatus: PRE_SESSION_READINESS_IDENTITY_STATUS_EXACT,
      identityHash,
      invalidatedAt: null,
    },
  });
}

async function reuseAfterConcurrentInsert(input: {
  prepared: PreSessionReadinessCurrentSnapshotIdentity;
  payloadHash: string;
}): Promise<ActivatePreSessionReadinessSnapshotResult | null> {
  const snapshot = await loadActiveExactSnapshotByIdentity(
    prisma,
    input.prepared.userId,
    input.prepared.identityHash
  );
  if (!snapshot) return null;
  const integrityReason = exactSnapshotIntegrityReason({
    snapshot,
    expected: input.prepared,
  });
  if (integrityReason || snapshot.payloadHash !== input.payloadHash) {
    throw new PreSessionReadinessSnapshotConflictError(
      "PAYLOAD_INTEGRITY_CONFLICT",
      "Concurrent readiness preparation produced a conflicting payload for the same identity."
    );
  }
  return { snapshot: snapshot as PreSessionReadinessSnapshot, invalidatedSnapshotCount: 0, outcome: "reused" };
}

export async function activatePreSessionReadinessSnapshot(
  input: ActivatePreSessionReadinessSnapshotInput
): Promise<ActivatePreSessionReadinessSnapshotResult> {
  assertValidActivationInput(input);
  const prepared = input.preparedIdentity;
  const payloadHash = hashPreSessionReadinessValue(input.contract);

  for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await revalidatePreparedIdentity(tx, prepared);
          const existing = await loadActiveExactSnapshotByIdentity(
            tx,
            prepared.userId,
            prepared.identityHash
          );
          if (existing) {
            const integrityReason = exactSnapshotIntegrityReason({
              snapshot: existing,
              expected: prepared,
            });
            if (integrityReason || existing.payloadHash !== payloadHash) {
              throw new PreSessionReadinessSnapshotConflictError(
                "PAYLOAD_INTEGRITY_CONFLICT",
                "The active readiness snapshot has a different payload for the same exact identity."
              );
            }
            return {
              snapshot: existing as PreSessionReadinessSnapshot,
              invalidatedSnapshotCount: 0,
              outcome: "reused" as const,
            };
          }

          const invalidated = await tx.preSessionReadinessSnapshot.updateMany({
            where: {
              userId: prepared.userId,
              targetHash: prepared.targetHash,
              identityStatus: PRE_SESSION_READINESS_IDENTITY_STATUS_EXACT,
              invalidatedAt: null,
            },
            data: {
              invalidatedAt: new Date(),
              invalidatedReason: "superseded_by_atomic_prepare",
            },
          });
          const snapshot = await tx.preSessionReadinessSnapshot.create({
            data: {
              userId: prepared.userId,
              activeMesocycleId: prepared.activeMesocycleId,
              mesocycleState: prepared.mesocycleState,
              weekInMeso: prepared.weekInMeso,
              sessionInWeek: prepared.sessionInWeek,
              slotId: prepared.slotId,
              slotIntent: prepared.slotIntent,
              plannedWorkoutId: prepared.plannedWorkoutId,
              plannedWorkoutRevision: prepared.plannedWorkoutRevision,
              contractVersion: prepared.contractVersion,
              contractJson: input.contract as unknown as Prisma.InputJsonValue,
              identityStatus: PRE_SESSION_READINESS_IDENTITY_STATUS_EXACT,
              identityContractVersion:
                PRE_SESSION_READINESS_IDENTITY_CONTRACT_VERSION,
              identityJson: prepared.identity as unknown as Prisma.InputJsonValue,
              identityHash: prepared.identityHash,
              targetHash: prepared.targetHash,
              payloadHash,
              readinessEvidenceFingerprint:
                prepared.readinessEvidenceFingerprint,
              projectionFingerprint: prepared.projectionFingerprint,
              seedRevisionId: prepared.seedRevisionId,
              seedRevisionNumber: prepared.seedRevisionNumber,
              seedPayloadHash: prepared.seedPayloadHash,
              prescriptionFingerprint: prepared.prescriptionFingerprint,
              sourceStateHash: prepared.identityHash,
              slotPlanSeedHash: prepared.slotPlanSeedHash,
              slotSequenceHash: prepared.slotSequenceHash,
              expiresAt: input.expiresAt ?? null,
            },
          });
          return {
            snapshot,
            invalidatedSnapshotCount: invalidated.count,
            outcome: "created" as const,
          };
        },
        { isolationLevel: "ReadCommitted" }
      );
    } catch (error) {
      if (error instanceof PreSessionReadinessSnapshotConflictError) throw error;
      if (isPrismaCode(error, "P2002")) {
        const reused = await reuseAfterConcurrentInsert({ prepared, payloadHash });
        if (reused) return reused;
        throw new PreSessionReadinessSnapshotConflictError(
          "CONCURRENT_TARGET_CONFLICT",
          "A concurrent preparation activated a different current identity."
        );
      }
      if (isPrismaCode(error, "P2034") && attempt < MAX_TRANSACTION_ATTEMPTS) {
        continue;
      }
      throw error;
    }
  }
  throw new PreSessionReadinessSnapshotConflictError(
    "CONCURRENT_TARGET_CONFLICT",
    "Readiness preparation could not select an authoritative concurrent winner."
  );
}

export async function loadCurrentPreSessionReadinessSnapshot(
  userId: string,
  options: { now?: Date } = {}
): Promise<PreSessionReadinessSnapshotLoadResult> {
  const current = await loadCurrentPreSessionReadinessSnapshotIdentity(userId, options);
  if (!current) {
    return { status: "unavailable", reason: "no_current_identity" };
  }
  const snapshot = await loadActiveExactSnapshotByIdentity(
    prisma,
    userId,
    current.identityHash
  );
  if (!snapshot) {
    return { status: "unavailable", reason: "no_active_exact_snapshot" };
  }
  if (snapshot.expiresAt && snapshot.expiresAt <= (options.now ?? new Date())) {
    return { status: "unavailable", reason: "expired", snapshotId: snapshot.id };
  }
  const integrityReason = exactSnapshotIntegrityReason({ snapshot, expected: current });
  if (integrityReason) {
    return { status: "integrity_error", reason: integrityReason, snapshotId: snapshot.id };
  }
  return {
    status: "available",
    snapshot,
    contract: snapshot.contractJson as unknown as PreSessionReadinessContract,
    identity: current,
  };
}

export async function validatePreSessionReadinessSnapshotForHome(input: {
  userId: string;
  snapshot: PreSessionReadinessSnapshotCandidate | null | undefined;
  now?: Date;
}): Promise<PreSessionReadinessContract | null> {
  if (!input.snapshot || input.snapshot.invalidatedAt) return null;
  const current = await loadCurrentPreSessionReadinessSnapshotIdentity(input.userId, {
    now: input.now,
  });
  if (!current) return null;
  if (input.snapshot.expiresAt && input.snapshot.expiresAt <= (input.now ?? new Date())) {
    return null;
  }
  return exactSnapshotIntegrityReason({ snapshot: input.snapshot, expected: current })
    ? null
    : (input.snapshot.contractJson as unknown as PreSessionReadinessContract);
}

export type PreSessionReadinessSnapshotAuditDiagnostics = {
  currentIdentityHash: string | null;
  currentTargetHash: string | null;
  currentSnapshotId: string | null;
  activeSnapshotMatchesCurrentEvidence: boolean;
  duplicateActiveIdentity: boolean;
  duplicateActiveTarget: boolean;
  sameIdentityDifferentPayloadHashes: boolean;
  legacyUnknownCount: number;
  supersededSnapshotIds: string[];
  snapshots: Array<{
    snapshotId: string;
    identityStatus: string;
    identityContractVersion: number | null;
    identityHash: string | null;
    identityHashValid: boolean | null;
    payloadHashValid: boolean | null;
    lifecycleState: "ACTIVE" | "SUPERSEDED_OR_INVALID";
    targetKind: string | null;
    workoutId: string | null;
    workoutRevision: number | null;
    seedRevisionId: string | null;
    seedRevisionNumber: number | null;
    seedPayloadHash: string | null;
    readinessEvidenceFingerprint: string | null;
    projectionFingerprint: string | null;
  }>;
};

export async function loadPreSessionReadinessSnapshotAuditDiagnostics(
  userId: string
): Promise<PreSessionReadinessSnapshotAuditDiagnostics> {
  const current = await loadCurrentPreSessionReadinessSnapshotIdentity(userId);
  const rows = await prisma.preSessionReadinessSnapshot.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const activeExact = rows.filter(
    (row) =>
      row.identityStatus === PRE_SESSION_READINESS_IDENTITY_STATUS_EXACT &&
      row.invalidatedAt == null
  );
  const identityCounts = new Map<string, number>();
  const targetCounts = new Map<string, number>();
  const payloadsByIdentity = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.identityHash && row.payloadHash) {
      const payloads = payloadsByIdentity.get(row.identityHash) ?? new Set<string>();
      payloads.add(row.payloadHash);
      payloadsByIdentity.set(row.identityHash, payloads);
    }
  }
  for (const row of activeExact) {
    if (row.identityHash) identityCounts.set(row.identityHash, (identityCounts.get(row.identityHash) ?? 0) + 1);
    if (row.targetHash) targetCounts.set(row.targetHash, (targetCounts.get(row.targetHash) ?? 0) + 1);
  }
  const currentSnapshot = current
    ? activeExact.find((row) => row.identityHash === current.identityHash) ?? null
    : null;

  return {
    currentIdentityHash: current?.identityHash ?? null,
    currentTargetHash: current?.targetHash ?? null,
    currentSnapshotId: currentSnapshot?.id ?? null,
    activeSnapshotMatchesCurrentEvidence: Boolean(currentSnapshot),
    duplicateActiveIdentity: Array.from(identityCounts.values()).some((count) => count > 1),
    duplicateActiveTarget: Array.from(targetCounts.values()).some((count) => count > 1),
    sameIdentityDifferentPayloadHashes: Array.from(payloadsByIdentity.values()).some((hashes) => hashes.size > 1),
    legacyUnknownCount: rows.filter((row) => row.identityStatus !== PRE_SESSION_READINESS_IDENTITY_STATUS_EXACT).length,
    supersededSnapshotIds: current
      ? rows.filter((row) => row.targetHash === current.targetHash && row.invalidatedAt != null).map((row) => row.id)
      : [],
    snapshots: rows.map((row) => {
      const identity = parsePreSessionReadinessIdentity(row.identityJson);
      return {
        snapshotId: row.id,
        identityStatus: row.identityStatus,
        identityContractVersion: row.identityContractVersion,
        identityHash: row.identityHash,
        identityHashValid:
          identity && row.identityHash
            ? hashPreSessionReadinessIdentity(identity) === row.identityHash
            : null,
        payloadHashValid: row.payloadHash
          ? hashPreSessionReadinessValue(row.contractJson) === row.payloadHash
          : null,
        lifecycleState: row.invalidatedAt == null ? "ACTIVE" : "SUPERSEDED_OR_INVALID",
        targetKind: identity?.target.kind ?? null,
        workoutId:
          identity?.target.kind === "materialized_workout"
            ? identity.target.workoutId
            : null,
        workoutRevision:
          identity?.target.kind === "materialized_workout"
            ? identity.target.workoutRevision
            : null,
        seedRevisionId: row.seedRevisionId,
        seedRevisionNumber: row.seedRevisionNumber,
        seedPayloadHash: row.seedPayloadHash,
        readinessEvidenceFingerprint: row.readinessEvidenceFingerprint,
        projectionFingerprint: row.projectionFingerprint,
      };
    }),
  };
}
