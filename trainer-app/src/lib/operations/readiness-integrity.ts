import { createHash } from "node:crypto";
import {
  hashPreSessionReadinessIdentity,
  hashPreSessionReadinessTarget,
  hashPreSessionReadinessValue,
  parsePreSessionReadinessIdentity,
  PRE_SESSION_READINESS_IDENTITY_CONTRACT_VERSION,
  type PreSessionReadinessIdentity,
} from "@/lib/api/pre-session-readiness-identity";
import {
  isPreSessionReadinessContract,
  type PreSessionReadinessContract,
} from "@/lib/api/pre-session-readiness-contract";
import {
  EXPECTED_MIGRATION_CHAIN,
  type CheckedInMigration,
  type LedgerRow,
} from "./migration-integrity";

export type ReadinessSchemaStage =
  | "pre_architecture_migration"
  | "fully_migrated"
  | "partial_or_incompatible";

export type ReadinessCatalogFacts = {
  tables: string[];
  columns: Array<{ table: string; name: string }>;
  indexes: Array<{
    table: string;
    name: string;
    unique: boolean;
    columns: string[];
    predicate: string | null;
    valid: boolean;
    ready: boolean;
    live: boolean;
  }>;
};

export type ReadinessDatabaseRow = {
  id: string;
  userId: string;
  activeMesocycleId: string;
  mesocycleState: string;
  weekInMeso: number;
  sessionInWeek: number;
  slotId: string;
  slotIntent: string;
  plannedWorkoutId: string | null;
  plannedWorkoutRevision: number | null;
  contractVersion: number;
  contractJson: unknown;
  sourceStateHash: string | null;
  slotPlanSeedHash: string | null;
  slotSequenceHash: string | null;
  createdAt: string;
  expiresAt: string | null;
  invalidatedAt: string | null;
  invalidatedReason: string | null;
  workoutExists: boolean;
  currentWorkoutRevision: number | null;
  identityStatus?: string | null;
  identityContractVersion?: number | null;
  identityJson?: unknown;
  identityHash?: string | null;
  targetHash?: string | null;
  payloadHash?: string | null;
  readinessEvidenceFingerprint?: string | null;
  projectionFingerprint?: string | null;
  seedRevisionId?: string | null;
  seedRevisionNumber?: number | null;
  seedPayloadHash?: string | null;
  prescriptionFingerprint?: string | null;
  seedRevisionExists?: boolean;
  persistedSeedRevisionNumber?: number | null;
  persistedSeedPayloadHash?: string | null;
  seedProvenanceStatus?: string | null;
  currentSeedRevisionId?: string | null;
};

export type IntegrityIssue = {
  snapshotId: string;
  code: string;
  detail: string;
};

export type DuplicateGroup = {
  key: string;
  snapshotIds: string[];
};

export type ReadinessIntegrityReport = {
  schemaStage: ReadinessSchemaStage;
  checkedObjects: Array<{ object: string; present: boolean }>;
  ledger: {
    applied: number;
    expectedApplied: number | null;
    agreesWithCatalog: boolean;
    blockers: string[];
  };
  snapshots: {
    total: number;
    active: number;
    invalidated: number;
    workoutTargeted: number;
    futureSlotTargeted: number;
    rowsReferencingExistingWorkouts: number;
    rowsReferencingMissingWorkouts: number;
    staleWorkoutRevision: number;
    unclassifiableTarget: number;
  };
  legacy: {
    valid: number;
    duplicate: number;
    stale: number;
    invalid: number;
    unknown: number;
    rows: Array<{
      snapshotId: string;
      classification:
        | "legacy_valid"
        | "legacy_duplicate"
        | "legacy_stale"
        | "legacy_invalid"
        | "legacy_unknown";
      reasons: string[];
      targetKey: string | null;
    }>;
    duplicateActiveTargetGroups: DuplicateGroup[];
    duplicateExactEvidenceGroups: DuplicateGroup[];
    invalidContractPayloads: string[];
    unsupportedContractVersions: string[];
    contradictoryRows: string[];
  };
  migrationSafety: {
    applicability: "pre_migration_projection" | "already_migrated" | "blocked_partial_schema";
    migrationBehavior: string;
    definiteUniqueConflicts: DuplicateGroup[];
    ambiguousGroups: DuplicateGroup[];
    rowsBecomingLegacyUnknown: string[];
    indexCreationWouldSucceed: boolean | null;
    readinessMigrationSafe: boolean;
    repairRequiredBeforeMigration: boolean;
  };
  exact: {
    applicability: "not_applicable_pre_migration" | "verified_fully_migrated" | "blocked_partial_schema";
    exactRows: number;
    legacyRows: number;
    identityHashFailures: IntegrityIssue[];
    targetHashFailures: IntegrityIssue[];
    payloadHashFailures: IntegrityIssue[];
    identityContractFailures: IntegrityIssue[];
    contractFailures: IntegrityIssue[];
    lifecycleFailures: IntegrityIssue[];
    duplicateActiveIdentity: DuplicateGroup[];
    duplicateActiveTarget: DuplicateGroup[];
    staleWorkoutRevision: IntegrityIssue[];
    staleSeedRevision: IntegrityIssue[];
    projectionFingerprintMismatch: IntegrityIssue[];
    readinessEvidenceFingerprintMismatch: IntegrityIssue[];
    prescriptionFingerprintMismatch: IntegrityIssue[];
    supersededChainFailures: IntegrityIssue[];
    legacyFieldFailures: IntegrityIssue[];
    currentReadinessStatus: "not_reconstructed_by_integrity_audit";
  };
  fingerprints: {
    before: string;
    after: string;
    unchanged: boolean;
    transactionReadOnly: boolean;
  };
  writes: 0;
  readinessIntegrityReady: boolean;
};

const PRE_MIGRATION_COUNT = 10;
const READINESS_IDENTITY_COLUMNS = [
  "identityStatus",
  "identityContractVersion",
  "identityJson",
  "identityHash",
  "targetHash",
  "payloadHash",
  "readinessEvidenceFingerprint",
  "projectionFingerprint",
  "seedRevisionId",
  "seedRevisionNumber",
  "seedPayloadHash",
  "prescriptionFingerprint",
] as const;
const READINESS_LIFECYCLE_COLUMNS = ["expiresAt", "invalidatedAt", "invalidatedReason"] as const;
const READINESS_PARTIAL_INDEXES = [
  "psrs_one_active_exact_identity_uidx",
  "psrs_one_active_target_uidx",
] as const;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(hashPreSessionReadinessValue(value))
    .digest("hex");
}

function hasColumn(catalog: ReadinessCatalogFacts, table: string, name: string): boolean {
  return catalog.columns.some((column) => column.table === table && column.name === name);
}

function hasTable(catalog: ReadinessCatalogFacts, name: string): boolean {
  return catalog.tables.includes(name);
}

function hasRequiredPartialIndex(catalog: ReadinessCatalogFacts, name: string): boolean {
  const expectedColumns =
    name === "psrs_one_active_exact_identity_uidx"
      ? ["userId", "identityHash"]
      : ["userId", "targetHash"];
  const index = catalog.indexes.find(
    (candidate) => candidate.table === "PreSessionReadinessSnapshot" && candidate.name === name,
  );
  return Boolean(
    index &&
      index.unique &&
      index.valid &&
      index.ready &&
      index.live &&
      JSON.stringify(index.columns.map((column) => column.replaceAll('"', "").trim())) ===
        JSON.stringify(expectedColumns) &&
      index.predicate?.includes("invalidatedAt") &&
      index.predicate.includes("identityStatus") &&
      index.predicate.includes("EXACT"),
  );
}

type LedgerState = "successful" | "failed" | "rolled_back" | "incomplete";

function ledgerState(row: LedgerRow): LedgerState {
  const required = Boolean(row.id.trim() && row.migrationName.trim() && row.checksum?.trim());
  const validSteps = Number.isInteger(row.appliedStepsCount) && row.appliedStepsCount >= 0;
  if (!required || !validSteps || (row.finishedAt && row.rolledBackAt)) return "incomplete";
  if (row.rolledBackAt) return row.finishedAt ? "incomplete" : "rolled_back";
  if (row.logs?.trim()) return "failed";
  if (row.finishedAt) return "successful";
  return "incomplete";
}

function assessLedger(input: {
  ledgerRows: LedgerRow[];
  checkedIn: CheckedInMigration[];
}): { applied: number; prefixLength: number; blockers: string[] } {
  const blockers: string[] = [];
  if (
    JSON.stringify(input.checkedIn.map((migration) => migration.name)) !==
    JSON.stringify(EXPECTED_MIGRATION_CHAIN)
  ) {
    blockers.push("checked_in_migration_chain_mismatch");
  }
  const checkedInByName = new Map(input.checkedIn.map((migration) => [migration.name, migration]));
  const grouped = new Map<string, LedgerRow[]>();
  for (const row of input.ledgerRows) {
    grouped.set(row.migrationName, [...(grouped.get(row.migrationName) ?? []), row]);
  }
  const successfulRows: LedgerRow[] = [];
  for (const [name, rows] of grouped) {
    const successful = rows.filter((row) => ledgerState(row) === "successful");
    const failed = rows.filter((row) => ledgerState(row) === "failed");
    const incomplete = rows.filter((row) => ledgerState(row) === "incomplete");
    const cleanReplacement = successful.length === 1 && failed.length === 0 && incomplete.length === 0;
    if (!checkedInByName.has(name)) blockers.push(`unknown_migration:${name}`);
    if (!cleanReplacement) blockers.push(`ambiguous_ledger:${name}`);
    if (cleanReplacement) successfulRows.push(successful[0]);
    const checkedIn = checkedInByName.get(name);
    if (cleanReplacement && checkedIn && successful[0].checksum !== checkedIn.checksum) {
      blockers.push(`checksum_mismatch:${name}`);
    }
    if (incomplete.length > 0) {
      blockers.push(`incomplete_migration:${name}`);
    }
  }

  const successfulNames = new Set(successfulRows.map((row) => row.migrationName));
  let prefixLength = 0;
  for (const name of EXPECTED_MIGRATION_CHAIN) {
    if (!successfulNames.has(name)) break;
    prefixLength += 1;
  }
  if (successfulNames.size !== prefixLength) blockers.push("migration_order_or_prefix_mismatch");
  return {
    applied: successfulNames.size,
    prefixLength,
    blockers: uniqueSorted(blockers),
  };
}

export function classifyReadinessSchemaStage(input: {
  catalog: ReadinessCatalogFacts;
  ledgerRows: LedgerRow[];
  checkedIn: CheckedInMigration[];
}): {
  stage: ReadinessSchemaStage;
  checkedObjects: Array<{ object: string; present: boolean }>;
  ledger: ReadinessIntegrityReport["ledger"];
} {
  const { catalog } = input;
  const checkedObjects = [
    { object: "table:MesocycleSeedRevision", present: hasTable(catalog, "MesocycleSeedRevision") },
    {
      object: "column:Mesocycle.currentSeedRevisionId",
      present: hasColumn(catalog, "Mesocycle", "currentSeedRevisionId"),
    },
    ...READINESS_LIFECYCLE_COLUMNS.map((name) => ({
      object: `column:PreSessionReadinessSnapshot.${name}`,
      present: hasColumn(catalog, "PreSessionReadinessSnapshot", name),
    })),
    ...READINESS_IDENTITY_COLUMNS.map((name) => ({
      object: `column:PreSessionReadinessSnapshot.${name}`,
      present: hasColumn(catalog, "PreSessionReadinessSnapshot", name),
    })),
    ...READINESS_PARTIAL_INDEXES.map((name) => ({
      object: `index:PreSessionReadinessSnapshot.${name}`,
      present: hasRequiredPartialIndex(catalog, name),
    })),
  ];
  const ledgerAssessment = assessLedger(input);
  const lifecycleComplete = READINESS_LIFECYCLE_COLUMNS.every((name) =>
    hasColumn(catalog, "PreSessionReadinessSnapshot", name),
  );
  const futurePresence = [
    hasTable(catalog, "MesocycleSeedRevision"),
    hasColumn(catalog, "Mesocycle", "currentSeedRevisionId"),
    ...READINESS_IDENTITY_COLUMNS.map((name) =>
      hasColumn(catalog, "PreSessionReadinessSnapshot", name),
    ),
    ...READINESS_PARTIAL_INDEXES.map((name) => hasRequiredPartialIndex(catalog, name)),
  ];
  const allFutureAbsent = futurePresence.every((present) => !present);
  const allFuturePresent = futurePresence.every(Boolean);
  const preCatalog =
    hasTable(catalog, "PreSessionReadinessSnapshot") && lifecycleComplete && allFutureAbsent;
  const fullCatalog =
    hasTable(catalog, "PreSessionReadinessSnapshot") && lifecycleComplete && allFuturePresent;
  const preLedger =
    ledgerAssessment.blockers.length === 0 && ledgerAssessment.prefixLength === PRE_MIGRATION_COUNT;
  const fullLedger =
    ledgerAssessment.blockers.length === 0 &&
    ledgerAssessment.prefixLength === EXPECTED_MIGRATION_CHAIN.length;

  const stage =
    preCatalog && preLedger
      ? "pre_architecture_migration"
      : fullCatalog && fullLedger
        ? "fully_migrated"
        : "partial_or_incompatible";
  const expectedApplied = preCatalog
    ? PRE_MIGRATION_COUNT
    : fullCatalog
      ? EXPECTED_MIGRATION_CHAIN.length
      : null;
  const ledgerBlockers = [...ledgerAssessment.blockers];
  if (expectedApplied != null && ledgerAssessment.prefixLength !== expectedApplied) {
    ledgerBlockers.push(
      `catalog_ledger_disagreement:catalog_expected_${expectedApplied}:ledger_${ledgerAssessment.prefixLength}`,
    );
  }
  if (!preCatalog && !fullCatalog) ledgerBlockers.push("catalog_partial_or_incompatible");

  return {
    stage,
    checkedObjects,
    ledger: {
      applied: ledgerAssessment.applied,
      expectedApplied,
      agreesWithCatalog: stage !== "partial_or_incompatible",
      blockers: uniqueSorted(ledgerBlockers),
    },
  };
}

function legacyTargetKey(row: ReadinessDatabaseRow): string | null {
  if (row.plannedWorkoutId) return `workout:${row.userId}:${row.plannedWorkoutId}`;
  if (
    row.userId &&
    row.activeMesocycleId &&
    Number.isInteger(row.weekInMeso) &&
    row.weekInMeso >= 0 &&
    Number.isInteger(row.sessionInWeek) &&
    row.sessionInWeek >= 0 &&
    row.slotId
  ) {
    return [
      "future_slot",
      row.userId,
      row.activeMesocycleId,
      row.weekInMeso,
      row.sessionInWeek,
      row.slotId,
    ].join(":");
  }
  return null;
}

function legacyEvidenceKey(row: ReadinessDatabaseRow): string {
  return stableHash({
    userId: row.userId,
    activeMesocycleId: row.activeMesocycleId,
    mesocycleState: row.mesocycleState,
    weekInMeso: row.weekInMeso,
    sessionInWeek: row.sessionInWeek,
    slotId: row.slotId,
    slotIntent: row.slotIntent,
    plannedWorkoutId: row.plannedWorkoutId,
    plannedWorkoutRevision: row.plannedWorkoutRevision,
    contractVersion: row.contractVersion,
    contractJson: row.contractJson,
    sourceStateHash: row.sourceStateHash,
    slotPlanSeedHash: row.slotPlanSeedHash,
    slotSequenceHash: row.slotSequenceHash,
    invalidatedAt: row.invalidatedAt,
    invalidatedReason: row.invalidatedReason,
  });
}

function groupsByKey(
  rows: ReadinessDatabaseRow[],
  keyFor: (row: ReadinessDatabaseRow) => string | null,
  minimum = 2,
): DuplicateGroup[] {
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const key = keyFor(row);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row.id]);
  }
  return [...groups.entries()]
    .filter(([, snapshotIds]) => snapshotIds.length >= minimum)
    .map(([key, snapshotIds]) => ({ key, snapshotIds: snapshotIds.sort() }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function contractIdentityContradictions(
  row: ReadinessDatabaseRow,
  contract: PreSessionReadinessContract,
): string[] {
  const identity = contract.nextSessionIdentity;
  const contradictions: string[] = [];
  if (identity.userId !== row.userId) contradictions.push("contract_user_mismatch");
  if (identity.activeMesocycleId !== row.activeMesocycleId) {
    contradictions.push("contract_mesocycle_mismatch");
  }
  if (identity.activeState !== row.mesocycleState) contradictions.push("contract_state_mismatch");
  if (identity.currentWeek !== row.weekInMeso) contradictions.push("contract_week_mismatch");
  if (identity.currentSession !== row.sessionInWeek) contradictions.push("contract_session_mismatch");
  if (identity.nextSlotId !== row.slotId) contradictions.push("contract_slot_mismatch");
  if ((identity.existingWorkoutId ?? null) !== row.plannedWorkoutId) {
    contradictions.push("contract_workout_mismatch");
  }
  return contradictions;
}

function classifyLegacyRows(rows: ReadinessDatabaseRow[]): {
  summary: ReadinessIntegrityReport["legacy"];
  staleWorkoutCount: number;
} {
  const ordered = [...rows].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  const active = ordered.filter((row) => row.invalidatedAt == null);
  const duplicateTargetGroups = groupsByKey(active, legacyTargetKey);
  const duplicateEvidenceGroups = groupsByKey(ordered, legacyEvidenceKey);
  const duplicateIds = new Set<string>();
  for (const group of duplicateTargetGroups) {
    for (const snapshotId of group.snapshotIds.slice(1)) duplicateIds.add(snapshotId);
  }
  const invalidContractPayloads: string[] = [];
  const unsupportedContractVersions: string[] = [];
  const contradictoryRows: string[] = [];
  let staleWorkoutCount = 0;
  const classified = ordered.map((row) => {
    const reasons: string[] = [];
    const targetKey = legacyTargetKey(row);
    let invalid = false;
    let stale = false;
    let unknown = false;

    if (row.contractVersion !== 1) {
      unsupportedContractVersions.push(row.id);
      reasons.push("unsupported_contract_version");
      invalid = true;
    }
    const validContract = isPreSessionReadinessContract(row.contractJson, { userId: row.userId });
    if (!validContract) {
      invalidContractPayloads.push(row.id);
      reasons.push("invalid_contract_payload");
      invalid = true;
    } else {
      const contradictions = contractIdentityContradictions(
        row,
        row.contractJson as PreSessionReadinessContract,
      );
      if (contradictions.length > 0) {
        contradictoryRows.push(row.id);
        reasons.push(...contradictions);
        invalid = true;
      }
    }
    if (
      (row.plannedWorkoutId == null) !== (row.plannedWorkoutRevision == null) ||
      !row.userId ||
      !row.activeMesocycleId ||
      !row.mesocycleState ||
      !Number.isInteger(row.weekInMeso) ||
      row.weekInMeso < 0 ||
      !Number.isInteger(row.sessionInWeek) ||
      row.sessionInWeek < 0
    ) {
      contradictoryRows.push(row.id);
      reasons.push("null_or_contradictory_legacy_fields");
      invalid = true;
    }
    if (row.plannedWorkoutId && !row.workoutExists) {
      reasons.push("missing_workout_reference");
      invalid = true;
    }
    if (
      row.plannedWorkoutId &&
      row.workoutExists &&
      row.plannedWorkoutRevision !== row.currentWorkoutRevision
    ) {
      reasons.push("stale_workout_revision");
      stale = true;
      staleWorkoutCount += 1;
    }
    if (!targetKey) {
      reasons.push("legacy_target_not_exactly_reconstructable");
      unknown = true;
    }

    const classification: ReadinessIntegrityReport["legacy"]["rows"][number]["classification"] = invalid
      ? "legacy_invalid"
      : stale
        ? "legacy_stale"
        : duplicateIds.has(row.id)
          ? "legacy_duplicate"
          : unknown
            ? "legacy_unknown"
            : "legacy_valid";
    return { snapshotId: row.id, classification, reasons: uniqueSorted(reasons), targetKey };
  });

  return {
    staleWorkoutCount,
    summary: {
      valid: classified.filter((row) => row.classification === "legacy_valid").length,
      duplicate: classified.filter((row) => row.classification === "legacy_duplicate").length,
      stale: classified.filter((row) => row.classification === "legacy_stale").length,
      invalid: classified.filter((row) => row.classification === "legacy_invalid").length,
      unknown: classified.filter((row) => row.classification === "legacy_unknown").length,
      rows: classified.sort((left, right) => left.snapshotId.localeCompare(right.snapshotId)),
      duplicateActiveTargetGroups: duplicateTargetGroups,
      duplicateExactEvidenceGroups: duplicateEvidenceGroups,
      invalidContractPayloads: uniqueSorted(invalidContractPayloads),
      unsupportedContractVersions: uniqueSorted(unsupportedContractVersions),
      contradictoryRows: uniqueSorted(contradictoryRows),
    },
  };
}

function issue(snapshotId: string, code: string, detail: string): IntegrityIssue {
  return { snapshotId, code, detail };
}

function contractMatchesPersistedRow(
  row: ReadinessDatabaseRow,
  contract: PreSessionReadinessContract,
): boolean {
  return contractIdentityContradictions(row, contract).length === 0;
}

function identityMatchesPersistedRow(
  row: ReadinessDatabaseRow,
  identity: PreSessionReadinessIdentity,
): boolean {
  return (
    identity.ownerId === row.userId &&
    identity.activeMesocycleId === row.activeMesocycleId &&
    identity.mesocycleState === row.mesocycleState &&
    identity.weekInMeso === row.weekInMeso &&
    identity.sessionInWeek === row.sessionInWeek
  );
}

function buildExactAudit(rows: ReadinessDatabaseRow[]): ReadinessIntegrityReport["exact"] {
  const result: ReadinessIntegrityReport["exact"] = {
    applicability: "verified_fully_migrated",
    exactRows: 0,
    legacyRows: 0,
    identityHashFailures: [],
    targetHashFailures: [],
    payloadHashFailures: [],
    identityContractFailures: [],
    contractFailures: [],
    lifecycleFailures: [],
    duplicateActiveIdentity: [],
    duplicateActiveTarget: [],
    staleWorkoutRevision: [],
    staleSeedRevision: [],
    projectionFingerprintMismatch: [],
    readinessEvidenceFingerprintMismatch: [],
    prescriptionFingerprintMismatch: [],
    supersededChainFailures: [],
    legacyFieldFailures: [],
    currentReadinessStatus: "not_reconstructed_by_integrity_audit",
  };
  const parsedById = new Map<string, PreSessionReadinessIdentity>();
  const activeExact: ReadinessDatabaseRow[] = [];

  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
    if (row.identityStatus !== "EXACT") {
      result.legacyRows += 1;
      const populatedExactFields = [
        row.identityContractVersion,
        row.identityJson,
        row.identityHash,
        row.targetHash,
        row.payloadHash,
        row.readinessEvidenceFingerprint,
        row.projectionFingerprint,
      ].some((value) => value != null);
      if (row.identityStatus !== "LEGACY_UNKNOWN" || populatedExactFields) {
        result.legacyFieldFailures.push(
          issue(row.id, "legacy_exact_field_contradiction", "Legacy rows must not claim exact identity evidence."),
        );
      }
      continue;
    }

    result.exactRows += 1;
    if (row.invalidatedAt == null) activeExact.push(row);
    if ((row.invalidatedAt == null && row.invalidatedReason != null) ||
        (row.invalidatedAt != null && row.invalidatedReason == null)) {
      result.lifecycleFailures.push(
        issue(row.id, "invalid_lifecycle_fields", "Invalidation timestamp and reason are contradictory."),
      );
    }
    if (row.identityContractVersion !== PRE_SESSION_READINESS_IDENTITY_CONTRACT_VERSION) {
      result.identityContractFailures.push(
        issue(row.id, "unsupported_identity_contract_version", "Identity contract version is unsupported."),
      );
    }
    const identity = parsePreSessionReadinessIdentity(row.identityJson);
    if (!identity) {
      result.identityContractFailures.push(
        issue(row.id, "invalid_identity_json", "Persisted exact identity is malformed or unsupported."),
      );
      continue;
    }
    parsedById.set(row.id, identity);
    const computedIdentityHash = hashPreSessionReadinessIdentity(identity);
    const computedTargetHash = hashPreSessionReadinessTarget(identity);
    if (row.identityHash !== computedIdentityHash) {
      result.identityHashFailures.push(
        issue(row.id, "identity_hash_mismatch", "Persisted identity hash does not match canonical identity JSON."),
      );
    }
    if (row.targetHash !== computedTargetHash) {
      result.targetHashFailures.push(
        issue(row.id, "target_hash_mismatch", "Persisted logical-target hash does not match canonical identity JSON."),
      );
    }
    if (!identityMatchesPersistedRow(row, identity)) {
      result.identityContractFailures.push(
        issue(row.id, "identity_row_mismatch", "Exact identity disagrees with persisted snapshot columns."),
      );
    }
    if (row.payloadHash !== hashPreSessionReadinessValue(row.contractJson)) {
      result.payloadHashFailures.push(
        issue(row.id, "payload_hash_mismatch", "Persisted payload hash does not match canonical contract JSON."),
      );
    }
    if (!isPreSessionReadinessContract(row.contractJson, { userId: row.userId })) {
      result.contractFailures.push(
        issue(row.id, "invalid_contract_payload", "Readiness contract payload is invalid or unsupported."),
      );
    } else if (!contractMatchesPersistedRow(row, row.contractJson)) {
      result.contractFailures.push(
        issue(row.id, "contract_row_mismatch", "Readiness contract identity disagrees with persisted columns."),
      );
    }
    if (row.readinessEvidenceFingerprint !== identity.readinessEvidenceFingerprint) {
      result.readinessEvidenceFingerprintMismatch.push(
        issue(row.id, "readiness_fingerprint_mismatch", "Row fingerprint disagrees with exact identity evidence."),
      );
    }
    if (row.projectionFingerprint !== identity.projectionFingerprint) {
      result.projectionFingerprintMismatch.push(
        issue(row.id, "projection_fingerprint_mismatch", "Row fingerprint disagrees with exact identity evidence."),
      );
    }

    if (identity.target.kind === "materialized_workout") {
      if (!row.workoutExists) {
        result.staleWorkoutRevision.push(
          issue(row.id, "missing_workout", "Exact workout target no longer resolves."),
        );
      } else if (
        identity.target.workoutRevision !== row.currentWorkoutRevision ||
        row.plannedWorkoutRevision !== row.currentWorkoutRevision
      ) {
        result.staleWorkoutRevision.push(
          issue(row.id, "stale_workout_revision", "Persisted workout evidence is older than the current revision."),
        );
      }
      if (
        row.plannedWorkoutId !== identity.target.workoutId ||
        row.prescriptionFingerprint !== identity.target.prescriptionFingerprint
      ) {
        result.prescriptionFingerprintMismatch.push(
          issue(row.id, "workout_target_evidence_mismatch", "Workout target or prescription fingerprint disagrees with identity JSON."),
        );
      }
    } else {
      const seed = identity.target.seedRevision;
      if (seed.status === "exact_revision") {
        if (
          !row.seedRevisionExists ||
          row.seedRevisionId !== seed.revisionId ||
          row.seedRevisionNumber !== seed.revision ||
          row.persistedSeedRevisionNumber !== seed.revision ||
          row.persistedSeedPayloadHash !== seed.payloadHash ||
          row.seedPayloadHash !== seed.payloadHash ||
          row.seedProvenanceStatus !== "exact" ||
          row.currentSeedRevisionId !== seed.revisionId
        ) {
          result.staleSeedRevision.push(
            issue(row.id, "stale_seed_revision", "Exact seed evidence is missing, non-current, or inconsistent."),
          );
        }
      } else if (row.seedRevisionId != null || row.seedRevisionNumber != null || row.seedPayloadHash !== seed.payloadHash) {
        result.staleSeedRevision.push(
          issue(row.id, "legacy_seed_evidence_mismatch", "Legacy payload identity contains contradictory revision evidence."),
        );
      }
    }
  }

  result.duplicateActiveIdentity = groupsByKey(activeExact, (row) => {
    const identity = parsedById.get(row.id);
    return identity ? hashPreSessionReadinessIdentity(identity) : null;
  });
  result.duplicateActiveTarget = groupsByKey(activeExact, (row) => {
    const identity = parsedById.get(row.id);
    return identity ? hashPreSessionReadinessTarget(identity) : null;
  });

  for (const row of rows.filter(
    (candidate) => candidate.identityStatus === "EXACT" && candidate.invalidatedAt != null,
  )) {
    if (row.invalidatedReason !== "superseded_by_atomic_prepare") continue;
    const identity = parsedById.get(row.id);
    const replacement = identity
      ? rows.find((candidate) => {
          const candidateIdentity = parsedById.get(candidate.id);
          return (
            candidate.identityStatus === "EXACT" &&
            candidate.id !== row.id &&
            candidate.createdAt >= (row.invalidatedAt ?? row.createdAt) &&
            candidateIdentity != null &&
            hashPreSessionReadinessTarget(candidateIdentity) === hashPreSessionReadinessTarget(identity)
          );
        })
      : null;
    if (!replacement) {
      result.supersededChainFailures.push(
        issue(row.id, "missing_superseding_snapshot", "Superseded row has no later exact snapshot for the same target."),
      );
    }
  }
  return result;
}

function emptyExact(
  applicability: ReadinessIntegrityReport["exact"]["applicability"],
): ReadinessIntegrityReport["exact"] {
  return {
    applicability,
    exactRows: 0,
    legacyRows: 0,
    identityHashFailures: [],
    targetHashFailures: [],
    payloadHashFailures: [],
    identityContractFailures: [],
    contractFailures: [],
    lifecycleFailures: [],
    duplicateActiveIdentity: [],
    duplicateActiveTarget: [],
    staleWorkoutRevision: [],
    staleSeedRevision: [],
    projectionFingerprintMismatch: [],
    readinessEvidenceFingerprintMismatch: [],
    prescriptionFingerprintMismatch: [],
    supersededChainFailures: [],
    legacyFieldFailures: [],
    currentReadinessStatus: "not_reconstructed_by_integrity_audit",
  };
}

function exactFailureCount(exact: ReadinessIntegrityReport["exact"]): number {
  return Object.entries(exact).reduce((count, [key, value]) => {
    if (
      key === "duplicateActiveIdentity" ||
      key === "duplicateActiveTarget" ||
      key.endsWith("Failures") ||
      key.endsWith("Mismatch") ||
      key === "staleWorkoutRevision" ||
      key === "staleSeedRevision"
    ) {
      return count + (Array.isArray(value) ? value.length : 0);
    }
    return count;
  }, 0);
}

export function buildReadinessIntegrityReport(input: {
  catalog: ReadinessCatalogFacts;
  ledgerRows: LedgerRow[];
  checkedIn: CheckedInMigration[];
  rows: ReadinessDatabaseRow[];
  fingerprintBefore: string;
  fingerprintAfter: string;
  transactionReadOnly: boolean;
}): ReadinessIntegrityReport {
  const stage = classifyReadinessSchemaStage(input);
  const rows = [...input.rows].sort((left, right) => left.id.localeCompare(right.id));
  const legacyRows =
    stage.stage === "fully_migrated"
      ? rows.filter((row) => row.identityStatus !== "EXACT")
      : rows;
  const legacy = classifyLegacyRows(legacyRows);
  const active = rows.filter((row) => row.invalidatedAt == null);
  const exact =
    stage.stage === "fully_migrated"
      ? buildExactAudit(rows)
      : emptyExact(
          stage.stage === "pre_architecture_migration"
            ? "not_applicable_pre_migration"
            : "blocked_partial_schema",
        );
  const ambiguousRows = active.filter((row) => legacyTargetKey(row) == null);
  const ambiguousGroups = ambiguousRows.length
    ? [{ key: "legacy_target_not_exactly_reconstructable", snapshotIds: ambiguousRows.map((row) => row.id).sort() }]
    : [];
  const legacyFailures = legacy.summary.duplicate + legacy.summary.stale + legacy.summary.invalid + legacy.summary.unknown;
  const definiteUniqueConflicts = legacy.summary.duplicateActiveTargetGroups;
  const preMigration = stage.stage === "pre_architecture_migration";
  const indexCreationWouldSucceed = preMigration
    ? true
    : stage.stage === "fully_migrated"
      ? true
      : null;
  const readinessMigrationSafe =
    preMigration && definiteUniqueConflicts.length === 0 && legacyFailures === 0;
  const report: ReadinessIntegrityReport = {
    schemaStage: stage.stage,
    checkedObjects: stage.checkedObjects,
    ledger: stage.ledger,
    snapshots: {
      total: rows.length,
      active: active.length,
      invalidated: rows.length - active.length,
      workoutTargeted: rows.filter((row) => row.plannedWorkoutId != null).length,
      futureSlotTargeted: rows.filter(
        (row) => row.plannedWorkoutId == null && legacyTargetKey(row) != null,
      ).length,
      rowsReferencingExistingWorkouts: rows.filter(
        (row) => row.plannedWorkoutId != null && row.workoutExists,
      ).length,
      rowsReferencingMissingWorkouts: rows.filter(
        (row) => row.plannedWorkoutId != null && !row.workoutExists,
      ).length,
      staleWorkoutRevision: legacy.staleWorkoutCount + exact.staleWorkoutRevision.length,
      unclassifiableTarget: rows.filter((row) => legacyTargetKey(row) == null).length,
    },
    legacy: legacy.summary,
    migrationSafety: {
      applicability: preMigration
        ? "pre_migration_projection"
        : stage.stage === "fully_migrated"
          ? "already_migrated"
          : "blocked_partial_schema",
      migrationBehavior: preMigration
        ? "The checked-in migration assigns every existing row identityStatus=LEGACY_UNKNOWN; partial unique indexes include only active EXACT rows. No exact hashes are fabricated."
        : stage.stage === "fully_migrated"
          ? "The atomic-readiness migration is already represented in the catalog and ledger."
          : "Migration safety is not projected from a partial or ledger-incompatible schema.",
      definiteUniqueConflicts,
      ambiguousGroups,
      rowsBecomingLegacyUnknown: preMigration ? rows.map((row) => row.id).sort() : [],
      indexCreationWouldSucceed,
      readinessMigrationSafe:
        stage.stage === "fully_migrated" ? exactFailureCount(exact) === 0 : readinessMigrationSafe,
      repairRequiredBeforeMigration: preMigration && legacyFailures > 0,
    },
    exact,
    fingerprints: {
      before: input.fingerprintBefore,
      after: input.fingerprintAfter,
      unchanged: input.fingerprintBefore === input.fingerprintAfter,
      transactionReadOnly: input.transactionReadOnly,
    },
    writes: 0,
    readinessIntegrityReady: false,
  };
  report.readinessIntegrityReady =
    report.writes === 0 &&
    report.fingerprints.unchanged &&
    report.fingerprints.transactionReadOnly &&
    report.ledger.agreesWithCatalog &&
    ((preMigration && report.migrationSafety.readinessMigrationSafe) ||
      (stage.stage === "fully_migrated" && exactFailureCount(exact) === 0 && legacyFailures === 0));
  return report;
}
