import { createHash } from "node:crypto";
import type {
  MesocycleState,
  PreSessionReadinessSnapshot,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loadNextWorkoutContext } from "./next-session";
import {
  isPreSessionReadinessContract,
  type PreSessionReadinessContract,
} from "./pre-session-readiness-contract";

const PRE_SESSION_READINESS_CONTRACT_VERSION = 1;

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

export type SavePreSessionReadinessSnapshotInput = SnapshotIdentity & {
  contract: PreSessionReadinessContract;
  sourceStateHash?: string | null;
  slotPlanSeedHash?: string | null;
  slotSequenceHash?: string | null;
  expiresAt?: Date | null;
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
  | "sourceStateHash"
  | "slotPlanSeedHash"
  | "slotSequenceHash"
  | "createdAt"
  | "expiresAt"
  | "invalidatedAt"
  | "invalidatedReason"
>;

type CurrentSnapshotIdentity = SnapshotIdentity & {
  slotPlanSeedHash: string | null;
  slotSequenceHash: string | null;
};

function normalizeIntent(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizeForHash(value: unknown): unknown {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForHash);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeForHash(entryValue)])
    );
  }
  return value;
}

export function hashPreSessionReadinessSnapshotSource(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeForHash(value)))
    .digest("hex");
}

function sourceStateForHash(identity: SnapshotIdentity): Record<string, unknown> {
  return {
    activeMesocycleId: identity.activeMesocycleId,
    contractVersion: identity.contractVersion,
    mesocycleState: identity.mesocycleState,
    plannedWorkoutId: identity.plannedWorkoutId,
    plannedWorkoutRevision: identity.plannedWorkoutRevision,
    sessionInWeek: identity.sessionInWeek,
    slotId: identity.slotId,
    slotIntent: normalizeIntent(identity.slotIntent),
    userId: identity.userId,
    weekInMeso: identity.weekInMeso,
  };
}

function sourceStateHash(identity: SnapshotIdentity): string {
  return hashPreSessionReadinessSnapshotSource(sourceStateForHash(identity));
}

function getContractIdentity(
  contract: PreSessionReadinessContract
): PreSessionReadinessContract["nextSessionIdentity"] {
  return contract.nextSessionIdentity;
}

function contractMatchesIdentity(input: {
  contract: PreSessionReadinessContract;
  identity: SnapshotIdentity;
}): boolean {
  const contractIdentity = getContractIdentity(input.contract);
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

function assertValidSnapshotSaveInput(
  input: SavePreSessionReadinessSnapshotInput
): void {
  if (
    input.contractVersion !== PRE_SESSION_READINESS_CONTRACT_VERSION ||
    input.contract.contractVersion !== PRE_SESSION_READINESS_CONTRACT_VERSION ||
    !isPreSessionReadinessContract(input.contract, { userId: input.userId }) ||
    !contractMatchesIdentity({ contract: input.contract, identity: input })
  ) {
    throw new Error("Invalid pre-session readiness snapshot contract identity.");
  }
}

function toSnapshotIdentity(
  snapshot: PreSessionReadinessSnapshotCandidate
): SnapshotIdentity {
  return {
    userId: snapshot.userId,
    activeMesocycleId: snapshot.activeMesocycleId,
    mesocycleState: snapshot.mesocycleState,
    weekInMeso: snapshot.weekInMeso,
    sessionInWeek: snapshot.sessionInWeek,
    slotId: snapshot.slotId,
    slotIntent: snapshot.slotIntent,
    plannedWorkoutId: snapshot.plannedWorkoutId ?? null,
    plannedWorkoutRevision: snapshot.plannedWorkoutRevision ?? null,
    contractVersion: snapshot.contractVersion,
  };
}

async function loadCurrentSnapshotIdentity(
  userId: string
): Promise<CurrentSnapshotIdentity | null> {
  const [activeMesocycle, nextWorkoutContext] = await Promise.all([
    prisma.mesocycle.findFirst({
      where: { macroCycle: { userId }, isActive: true },
      select: {
        id: true,
        state: true,
        slotPlanSeedJson: true,
        slotSequenceJson: true,
      },
    }),
    loadNextWorkoutContext(userId),
  ]);

  if (
    !activeMesocycle ||
    nextWorkoutContext.weekInMeso == null ||
    nextWorkoutContext.sessionInWeek == null ||
    !nextWorkoutContext.slotId ||
    !nextWorkoutContext.intent
  ) {
    return null;
  }

  const plannedWorkout =
    nextWorkoutContext.existingWorkoutId == null
      ? null
      : await prisma.workout.findFirst({
          where: {
            id: nextWorkoutContext.existingWorkoutId,
            userId,
          },
          select: {
            id: true,
            revision: true,
          },
        });
  if (nextWorkoutContext.existingWorkoutId != null && !plannedWorkout) {
    return null;
  }

  const identity: SnapshotIdentity = {
    userId,
    activeMesocycleId: activeMesocycle.id,
    mesocycleState: activeMesocycle.state,
    weekInMeso: nextWorkoutContext.weekInMeso,
    sessionInWeek: nextWorkoutContext.sessionInWeek,
    slotId: nextWorkoutContext.slotId,
    slotIntent: nextWorkoutContext.intent,
    plannedWorkoutId: plannedWorkout?.id ?? null,
    plannedWorkoutRevision: plannedWorkout?.revision ?? null,
    contractVersion: PRE_SESSION_READINESS_CONTRACT_VERSION,
  };

  return {
    ...identity,
    slotPlanSeedHash:
      activeMesocycle.slotPlanSeedJson == null
        ? null
        : hashPreSessionReadinessSnapshotSource(activeMesocycle.slotPlanSeedJson),
    slotSequenceHash:
      activeMesocycle.slotSequenceJson == null
        ? null
        : hashPreSessionReadinessSnapshotSource(activeMesocycle.slotSequenceJson),
  };
}

function identityMatchesCurrent(input: {
  snapshot: PreSessionReadinessSnapshotCandidate;
  current: CurrentSnapshotIdentity;
}): boolean {
  const snapshotIdentity = toSnapshotIdentity(input.snapshot);
  return (
    snapshotIdentity.userId === input.current.userId &&
    snapshotIdentity.activeMesocycleId === input.current.activeMesocycleId &&
    snapshotIdentity.mesocycleState === input.current.mesocycleState &&
    snapshotIdentity.weekInMeso === input.current.weekInMeso &&
    snapshotIdentity.sessionInWeek === input.current.sessionInWeek &&
    snapshotIdentity.slotId === input.current.slotId &&
    normalizeIntent(snapshotIdentity.slotIntent) ===
      normalizeIntent(input.current.slotIntent) &&
    snapshotIdentity.plannedWorkoutId === input.current.plannedWorkoutId &&
    snapshotIdentity.plannedWorkoutRevision ===
      input.current.plannedWorkoutRevision &&
    snapshotIdentity.contractVersion === input.current.contractVersion
  );
}

function optionalHashMatches(
  storedHash: string | null,
  currentHash: string | null
): boolean {
  return storedHash == null || storedHash === currentHash;
}

export async function savePreSessionReadinessSnapshot(
  input: SavePreSessionReadinessSnapshotInput
): Promise<PreSessionReadinessSnapshot> {
  assertValidSnapshotSaveInput(input);

  return prisma.preSessionReadinessSnapshot.create({
    data: {
      userId: input.userId,
      activeMesocycleId: input.activeMesocycleId,
      mesocycleState: input.mesocycleState,
      weekInMeso: input.weekInMeso,
      sessionInWeek: input.sessionInWeek,
      slotId: input.slotId,
      slotIntent: normalizeIntent(input.slotIntent) ?? input.slotIntent,
      plannedWorkoutId: input.plannedWorkoutId,
      plannedWorkoutRevision: input.plannedWorkoutRevision,
      contractVersion: input.contractVersion,
      contractJson: input.contract as unknown as Prisma.InputJsonValue,
      sourceStateHash: input.sourceStateHash ?? sourceStateHash(input),
      slotPlanSeedHash: input.slotPlanSeedHash ?? null,
      slotSequenceHash: input.slotSequenceHash ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export async function loadLatestPreSessionReadinessSnapshotCandidate(
  userId: string
): Promise<PreSessionReadinessSnapshotCandidate | null> {
  return prisma.preSessionReadinessSnapshot.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function validatePreSessionReadinessSnapshotForHome(input: {
  userId: string;
  snapshot: PreSessionReadinessSnapshotCandidate | null | undefined;
  now?: Date;
}): Promise<PreSessionReadinessContract | null> {
  const snapshot = input.snapshot;
  const now = input.now ?? new Date();
  if (!snapshot || snapshot.userId !== input.userId) {
    return null;
  }
  if (snapshot.invalidatedAt || (snapshot.expiresAt && snapshot.expiresAt <= now)) {
    return null;
  }

  const contract = isPreSessionReadinessContract(snapshot.contractJson, {
    userId: input.userId,
  })
    ? snapshot.contractJson
    : null;
  if (!contract || snapshot.contractVersion !== PRE_SESSION_READINESS_CONTRACT_VERSION) {
    return null;
  }

  if (
    !contractMatchesIdentity({
      contract,
      identity: toSnapshotIdentity(snapshot),
    })
  ) {
    return null;
  }

  const current = await loadCurrentSnapshotIdentity(input.userId);
  if (!current || !identityMatchesCurrent({ snapshot, current })) {
    return null;
  }

  if (
    !optionalHashMatches(snapshot.sourceStateHash, sourceStateHash(current)) ||
    !optionalHashMatches(snapshot.slotPlanSeedHash, current.slotPlanSeedHash) ||
    !optionalHashMatches(snapshot.slotSequenceHash, current.slotSequenceHash)
  ) {
    return null;
  }

  return contract;
}

export async function invalidatePreSessionReadinessSnapshotsForIdentity(input: {
  userId: string;
  activeMesocycleId: string;
  weekInMeso: number;
  sessionInWeek: number;
  slotId: string;
  slotIntent?: string;
  contractVersion?: number;
  invalidatedReason: string;
  invalidatedAt?: Date;
}): Promise<{ count: number }> {
  const result = await prisma.preSessionReadinessSnapshot.updateMany({
    where: {
      userId: input.userId,
      activeMesocycleId: input.activeMesocycleId,
      weekInMeso: input.weekInMeso,
      sessionInWeek: input.sessionInWeek,
      slotId: input.slotId,
      ...(input.slotIntent ? { slotIntent: normalizeIntent(input.slotIntent) ?? input.slotIntent } : {}),
      contractVersion:
        input.contractVersion ?? PRE_SESSION_READINESS_CONTRACT_VERSION,
      invalidatedAt: null,
    },
    data: {
      invalidatedAt: input.invalidatedAt ?? new Date(),
      invalidatedReason: input.invalidatedReason,
    },
  });

  return { count: result.count };
}
