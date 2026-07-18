import {
  normalizeAcceptedSeedPayload,
  SEED_PAYLOAD_HASH_ALGORITHM,
} from "@/lib/api/mesocycle-seed-revision";
import { parseSlotPlanSeedJson } from "@/lib/api/slot-plan-seed-parser";

export type SeedInventoryClassification =
  | "normalizable"
  | "already_exact"
  | "legacy_baseline_only"
  | "legacy_exception"
  | "invalid_seed"
  | "conflict"
  | "missing_seed";

export type SeedInventorySourceRow = {
  mesocycleId: string;
  state: string;
  isActive: boolean;
  seedPayload: unknown;
  revisionSchemaPresent: boolean;
  currentRevisionId: string | null;
  currentRevision: number | null;
  provenanceStatus: string | null;
  payloadHash: string | null;
  hashAlgorithm: string | null;
  workoutCount: number;
  completedWorkoutCount: number;
};

export type SeedInventoryRow = {
  mesocycleId: string;
  classification: SeedInventoryClassification;
  lifecycleStatus: string;
  active: boolean;
  workoutCount: number;
  completedWorkoutCount: number;
  fromRevision: number | null;
  hash: string | null;
  validationFailure: string | null;
  invalidLocation: { slotId: string; exerciseId: string } | null;
  invalidLocations: Array<{ slotId: string; exerciseId: string }>;
  affectsCurrentRuntime: boolean;
  canRemainLegacyUnknown: boolean;
};

export type SeedInventory = {
  rows: SeedInventoryRow[];
  summary: {
    total: number;
    normalizable: number;
    alreadyExact: number;
    legacyBaselineOnly: number;
    legacyExceptions: number;
    invalid: number;
    conflicts: number;
    missingSeed: number;
    expectedInserts: number;
    expectedPointerUpdates: number;
  };
};

function invalidLocation(message: string): SeedInventoryRow["invalidLocation"] {
  const match = /^ACCEPTED_SEED_SET_COUNT_MISSING:([^:]+):(.+)$/.exec(message);
  return match ? { slotId: match[1], exerciseId: match[2] } : null;
}

function invalidLocations(seedPayload: unknown): SeedInventoryRow["invalidLocations"] {
  const parsed = parseSlotPlanSeedJson(seedPayload);
  if (!parsed) return [];
  return parsed.slots.flatMap((slot) =>
    slot.exercises
      .filter((exercise) => !exercise.hasExplicitSetCount)
      .map((exercise) => ({ slotId: slot.slotId, exerciseId: exercise.exerciseId })),
  );
}

const IDENTITY_ONLY_LEGACY_EXCEPTION_ID =
  "12079700-5333-4ffc-9cbd-bb303588f288";

function isIdentityOnlyLegacyException(
  source: SeedInventorySourceRow,
  validationFailure: string,
): boolean {
  if (
    source.mesocycleId !== IDENTITY_ONLY_LEGACY_EXCEPTION_ID ||
    source.isActive ||
    source.state !== "COMPLETED" ||
    !validationFailure.startsWith("ACCEPTED_SEED_SET_COUNT_MISSING:")
  ) {
    return false;
  }

  const parsed = parseSlotPlanSeedJson(source.seedPayload);
  return Boolean(
    parsed?.slots.length &&
      parsed.slots.every(
        (slot) =>
          slot.exercises.length > 0 &&
          slot.exercises.every((exercise) => !exercise.hasExplicitSetCount),
      ),
  );
}

function baseRow(source: SeedInventorySourceRow): Omit<
  SeedInventoryRow,
  "classification" | "hash" | "validationFailure" | "invalidLocation" | "invalidLocations"
> {
  return {
    mesocycleId: source.mesocycleId,
    lifecycleStatus: source.state,
    active: source.isActive,
    workoutCount: source.workoutCount,
    completedWorkoutCount: source.completedWorkoutCount,
    fromRevision: source.currentRevision,
    affectsCurrentRuntime:
      source.isActive &&
      (source.state === "ACTIVE_ACCUMULATION" || source.state === "ACTIVE_DELOAD"),
    canRemainLegacyUnknown: !source.isActive && source.state === "COMPLETED",
  };
}

export function classifySeedInventoryRow(
  source: SeedInventorySourceRow,
): SeedInventoryRow {
  const base = baseRow(source);
  if (source.seedPayload == null) {
    return {
      ...base,
      classification: "missing_seed",
      hash: null,
      validationFailure: null,
      invalidLocation: null,
      invalidLocations: [],
    };
  }

  let normalized: ReturnType<typeof normalizeAcceptedSeedPayload>;
  try {
    normalized = normalizeAcceptedSeedPayload(source.seedPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const legacyException = isIdentityOnlyLegacyException(source, message);
    return {
      ...base,
      classification: legacyException ? "legacy_exception" : "invalid_seed",
      hash: null,
      validationFailure: message,
      invalidLocation: invalidLocation(message),
      invalidLocations: invalidLocations(source.seedPayload),
    };
  }

  if (!source.revisionSchemaPresent) {
    return {
      ...base,
      classification: "legacy_baseline_only",
      hash: normalized.hash,
      validationFailure: null,
      invalidLocation: null,
      invalidLocations: [],
    };
  }

  if (!source.currentRevisionId) {
    return {
      ...base,
      classification: "conflict",
      hash: normalized.hash,
      validationFailure: "CURRENT_SEED_REVISION_POINTER_MISSING",
      invalidLocation: null,
      invalidLocations: [],
    };
  }

  if (source.provenanceStatus === "exact") {
    const exact =
      source.payloadHash === normalized.hash &&
      source.hashAlgorithm === SEED_PAYLOAD_HASH_ALGORITHM;
    return {
      ...base,
      classification: exact ? "already_exact" : "conflict",
      hash: normalized.hash,
      validationFailure: exact ? null : "EXACT_SEED_REVISION_HASH_MISMATCH",
      invalidLocation: null,
      invalidLocations: [],
    };
  }

  return {
    ...base,
    classification: "normalizable",
    hash: normalized.hash,
    validationFailure: null,
    invalidLocation: null,
    invalidLocations: [],
  };
}

export function buildSeedInventory(
  sourceRows: SeedInventorySourceRow[],
): SeedInventory {
  const rows = sourceRows.map(classifySeedInventoryRow);
  const count = (classification: SeedInventoryClassification) =>
    rows.filter((row) => row.classification === classification).length;
  const normalizable = count("normalizable");
  return {
    rows,
    summary: {
      total: rows.length,
      normalizable,
      alreadyExact: count("already_exact"),
      legacyBaselineOnly: count("legacy_baseline_only"),
      legacyExceptions: count("legacy_exception"),
      invalid: count("invalid_seed"),
      conflicts: count("conflict"),
      missingSeed: count("missing_seed"),
      expectedInserts: normalizable,
      expectedPointerUpdates: normalizable,
    },
  };
}

export function assertSeedInventoryWritable(inventory: SeedInventory): void {
  if (inventory.summary.invalid > 0 || inventory.summary.conflicts > 0) {
    throw new Error(
      "Seed revision write blocked: invalid or conflicting rows require separately approved per-row remediation.",
    );
  }
  if (inventory.summary.legacyBaselineOnly > 0) {
    throw new Error(
      "Seed revision write blocked: immutable revision schema is not available.",
    );
  }
}
