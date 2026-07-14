import { createHash } from "node:crypto";

export const PRE_SESSION_READINESS_IDENTITY_CONTRACT_VERSION = 1 as const;
export const PRE_SESSION_READINESS_IDENTITY_STATUS_EXACT = "EXACT" as const;
export const PRE_SESSION_READINESS_IDENTITY_STATUS_LEGACY_UNKNOWN =
  "LEGACY_UNKNOWN" as const;

type SeedRevisionIdentity =
  | {
      status: "exact_revision";
      revisionId: string;
      revision: number;
      payloadHash: string;
    }
  | {
      status: "legacy_payload";
      payloadHash: string;
    };

export type PreSessionReadinessIdentity = {
  identityContractVersion: typeof PRE_SESSION_READINESS_IDENTITY_CONTRACT_VERSION;
  ownerId: string;
  activeMesocycleId: string;
  mesocycleState: string;
  weekInMeso: number;
  sessionInWeek: number;
  target:
    | {
        kind: "materialized_workout";
        workoutId: string;
        workoutRevision: number;
        prescriptionFingerprint: string;
      }
    | {
        kind: "future_slot";
        mesocycleId: string;
        weekInMeso: number;
        sessionInWeek: number;
        slotId: string;
        slotIntent: string;
        seedRevision: SeedRevisionIdentity;
        slotSequenceHash: string | null;
      };
  readinessEvidenceFingerprint: string;
  projectionFingerprint: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function normalizeForHash(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForHash(entry)])
    );
  }
  return value;
}

export function normalizePreSessionReadinessHashInput(value: unknown): string {
  return JSON.stringify(normalizeForHash(value));
}

export function hashPreSessionReadinessValue(value: unknown): string {
  return createHash("sha256")
    .update(normalizePreSessionReadinessHashInput(value))
    .digest("hex");
}

function parseSeedRevisionIdentity(value: unknown): SeedRevisionIdentity | null {
  if (!isRecord(value) || !isNonEmptyString(value.payloadHash)) return null;
  if (value.status === "legacy_payload") {
    return { status: value.status, payloadHash: value.payloadHash };
  }
  if (
    value.status === "exact_revision" &&
    isNonEmptyString(value.revisionId) &&
    isNonNegativeInteger(value.revision)
  ) {
    return {
      status: value.status,
      revisionId: value.revisionId,
      revision: value.revision,
      payloadHash: value.payloadHash,
    };
  }
  return null;
}

function parseTarget(
  value: unknown
): PreSessionReadinessIdentity["target"] | null {
  if (!isRecord(value)) return null;
  if (
    value.kind === "materialized_workout" &&
    isNonEmptyString(value.workoutId) &&
    isNonNegativeInteger(value.workoutRevision) &&
    isNonEmptyString(value.prescriptionFingerprint)
  ) {
    return {
      kind: value.kind,
      workoutId: value.workoutId,
      workoutRevision: value.workoutRevision,
      prescriptionFingerprint: value.prescriptionFingerprint,
    };
  }
  const seedRevision = parseSeedRevisionIdentity(value.seedRevision);
  if (
    value.kind === "future_slot" &&
    isNonEmptyString(value.mesocycleId) &&
    isNonNegativeInteger(value.weekInMeso) &&
    isNonNegativeInteger(value.sessionInWeek) &&
    isNonEmptyString(value.slotId) &&
    isNonEmptyString(value.slotIntent) &&
    seedRevision &&
    (value.slotSequenceHash === null ||
      isNonEmptyString(value.slotSequenceHash))
  ) {
    return {
      kind: value.kind,
      mesocycleId: value.mesocycleId,
      weekInMeso: value.weekInMeso,
      sessionInWeek: value.sessionInWeek,
      slotId: value.slotId,
      slotIntent: value.slotIntent,
      seedRevision,
      slotSequenceHash: value.slotSequenceHash,
    };
  }
  return null;
}

export function parsePreSessionReadinessIdentity(
  value: unknown
): PreSessionReadinessIdentity | null {
  if (!isRecord(value)) return null;
  const target = parseTarget(value.target);
  if (
    value.identityContractVersion !==
      PRE_SESSION_READINESS_IDENTITY_CONTRACT_VERSION ||
    !isNonEmptyString(value.ownerId) ||
    !isNonEmptyString(value.activeMesocycleId) ||
    !isNonEmptyString(value.mesocycleState) ||
    !isNonNegativeInteger(value.weekInMeso) ||
    !isNonNegativeInteger(value.sessionInWeek) ||
    !target ||
    !isNonEmptyString(value.readinessEvidenceFingerprint) ||
    !isNonEmptyString(value.projectionFingerprint)
  ) {
    return null;
  }

  return {
    identityContractVersion: value.identityContractVersion,
    ownerId: value.ownerId,
    activeMesocycleId: value.activeMesocycleId,
    mesocycleState: value.mesocycleState,
    weekInMeso: value.weekInMeso,
    sessionInWeek: value.sessionInWeek,
    target,
    readinessEvidenceFingerprint: value.readinessEvidenceFingerprint,
    projectionFingerprint: value.projectionFingerprint,
  };
}

export function hashPreSessionReadinessIdentity(
  identity: PreSessionReadinessIdentity
): string {
  return hashPreSessionReadinessValue(identity);
}

export function hashPreSessionReadinessTarget(
  identity: PreSessionReadinessIdentity
): string {
  const target =
    identity.target.kind === "materialized_workout"
      ? {
          kind: identity.target.kind,
          workoutId: identity.target.workoutId,
        }
      : {
          kind: identity.target.kind,
          mesocycleId: identity.target.mesocycleId,
          weekInMeso: identity.target.weekInMeso,
          sessionInWeek: identity.target.sessionInWeek,
          slotId: identity.target.slotId,
        };

  return hashPreSessionReadinessValue({
    identityContractVersion: identity.identityContractVersion,
    ownerId: identity.ownerId,
    activeMesocycleId: identity.activeMesocycleId,
    target,
  });
}

