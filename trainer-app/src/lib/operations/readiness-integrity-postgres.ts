import { createHash } from "node:crypto";
import type { QueryResult, QueryResultRow } from "pg";
import type { CheckedInMigration, LedgerRow } from "./migration-integrity";
import {
  classifyReadinessSchemaStage,
  type ReadinessCatalogFacts,
  type ReadinessDatabaseRow,
} from "./readiness-integrity";

type ReadOnlyClient = {
  query<R extends QueryResultRow = QueryResultRow>(sql: string): Promise<QueryResult<R>>;
};

const MUTATION_TOKEN =
  /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|CALL|DO|GRANT|REVOKE|VACUUM|ANALYZE|REFRESH|REINDEX|CLUSTER|COMMENT)\b/i;
const READ_QUERY_PREFIX = /^(?:SELECT|WITH|SHOW)\b/i;
const TRANSACTION_STATEMENT = /^(?:BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY|COMMIT|ROLLBACK)$/i;

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").trim();
}

export function assertReadinessIntegrityReadOnlySql(sql: string): void {
  const normalized = stripComments(sql);
  if (
    MUTATION_TOKEN.test(normalized) ||
    (!READ_QUERY_PREFIX.test(normalized) && !TRANSACTION_STATEMENT.test(normalized))
  ) {
    throw new Error("READINESS_INTEGRITY_MUTATING_QUERY_BLOCKED");
  }
}

async function query<R extends QueryResultRow>(
  client: ReadOnlyClient,
  sql: string,
): Promise<QueryResult<R>> {
  assertReadinessIntegrityReadOnlySql(sql);
  return client.query<R>(sql);
}

function textTimestamp(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

async function readCatalog(client: ReadOnlyClient): Promise<ReadinessCatalogFacts> {
  const [tables, columns, indexes] = await Promise.all([
    query<{ name: string }>(client, `
      SELECT c.relname AS name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      ORDER BY c.relname
    `),
    query<{ table_name: string; column_name: string }>(client, `
      SELECT c.relname AS table_name, a.attname AS column_name
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY c.relname, a.attnum
    `),
    query<{
      table_name: string;
      index_name: string;
      is_unique: boolean;
      columns: string[];
      predicate: string | null;
      is_valid: boolean;
      is_ready: boolean;
      is_live: boolean;
    }>(client, `
      SELECT tab.relname AS table_name,
        idx.relname AS index_name,
        i.indisunique AS is_unique,
        ARRAY(
          SELECT pg_catalog.pg_get_indexdef(i.indexrelid, position, true)
          FROM generate_series(1, i.indnkeyatts) AS position
          ORDER BY position
        ) AS columns,
        pg_catalog.pg_get_expr(i.indpred, i.indrelid) AS predicate,
        i.indisvalid AS is_valid,
        i.indisready AS is_ready,
        i.indislive AS is_live
      FROM pg_catalog.pg_index i
      JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_catalog.pg_class tab ON tab.oid = i.indrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = tab.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY tab.relname, idx.relname
    `),
  ]);
  return {
    tables: tables.rows.map((row) => row.name),
    columns: columns.rows.map((row) => ({ table: row.table_name, name: row.column_name })),
    indexes: indexes.rows.map((row) => ({
      table: row.table_name,
      name: row.index_name,
      unique: row.is_unique,
      columns: row.columns,
      predicate: row.predicate,
      valid: row.is_valid,
      ready: row.is_ready,
      live: row.is_live,
    })),
  };
}

async function readLedger(client: ReadOnlyClient): Promise<LedgerRow[]> {
  const result = await query<{
    id: string;
    migration_name: string;
    checksum: string | null;
    finished_at: string | null;
    rolled_back_at: string | null;
    logs: string | null;
    applied_steps_count: number;
  }>(client, `
    SELECT id, migration_name, checksum,
      finished_at::text AS finished_at,
      rolled_back_at::text AS rolled_back_at,
      logs,
      applied_steps_count
    FROM public._prisma_migrations
    ORDER BY migration_name, started_at, id
  `);
  return result.rows.map((row) => ({
    id: row.id,
    migrationName: row.migration_name,
    checksum: row.checksum,
    finishedAt: textTimestamp(row.finished_at),
    rolledBackAt: textTimestamp(row.rolled_back_at),
    logs: row.logs,
    appliedStepsCount: Number(row.applied_steps_count),
  }));
}

type CommonDatabaseRecord = {
  id: string;
  user_id: string;
  active_mesocycle_id: string;
  mesocycle_state: string;
  week_in_meso: number;
  session_in_week: number;
  slot_id: string;
  slot_intent: string;
  planned_workout_id: string | null;
  planned_workout_revision: number | null;
  contract_version: number;
  contract_json: unknown;
  source_state_hash: string | null;
  slot_plan_seed_hash: string | null;
  slot_sequence_hash: string | null;
  created_at: string;
  expires_at: string | null;
  invalidated_at: string | null;
  invalidated_reason: string | null;
  workout_exists: boolean;
  current_workout_revision: number | null;
};

function mapCommonRow(row: CommonDatabaseRecord): ReadinessDatabaseRow {
  return {
    id: row.id,
    userId: row.user_id,
    activeMesocycleId: row.active_mesocycle_id,
    mesocycleState: row.mesocycle_state,
    weekInMeso: Number(row.week_in_meso),
    sessionInWeek: Number(row.session_in_week),
    slotId: row.slot_id,
    slotIntent: row.slot_intent,
    plannedWorkoutId: row.planned_workout_id,
    plannedWorkoutRevision:
      row.planned_workout_revision == null ? null : Number(row.planned_workout_revision),
    contractVersion: Number(row.contract_version),
    contractJson: row.contract_json,
    sourceStateHash: row.source_state_hash,
    slotPlanSeedHash: row.slot_plan_seed_hash,
    slotSequenceHash: row.slot_sequence_hash,
    createdAt: textTimestamp(row.created_at) ?? "",
    expiresAt: textTimestamp(row.expires_at),
    invalidatedAt: textTimestamp(row.invalidated_at),
    invalidatedReason: row.invalidated_reason,
    workoutExists: row.workout_exists,
    currentWorkoutRevision:
      row.current_workout_revision == null ? null : Number(row.current_workout_revision),
  };
}

const COMMON_READINESS_SELECT = `
  s.id,
  s."userId" AS user_id,
  s."activeMesocycleId" AS active_mesocycle_id,
  s."mesocycleState"::text AS mesocycle_state,
  s."weekInMeso" AS week_in_meso,
  s."sessionInWeek" AS session_in_week,
  s."slotId" AS slot_id,
  s."slotIntent" AS slot_intent,
  s."plannedWorkoutId" AS planned_workout_id,
  s."plannedWorkoutRevision" AS planned_workout_revision,
  s."contractVersion" AS contract_version,
  s."contractJson" AS contract_json,
  s."sourceStateHash" AS source_state_hash,
  s."slotPlanSeedHash" AS slot_plan_seed_hash,
  s."slotSequenceHash" AS slot_sequence_hash,
  s."createdAt"::text AS created_at,
  s."expiresAt"::text AS expires_at,
  s."invalidatedAt"::text AS invalidated_at,
  s."invalidatedReason" AS invalidated_reason,
  (w.id IS NOT NULL) AS workout_exists,
  w.revision AS current_workout_revision
`;

async function readPreMigrationRows(client: ReadOnlyClient): Promise<ReadinessDatabaseRow[]> {
  const result = await query<CommonDatabaseRecord>(client, `
    SELECT ${COMMON_READINESS_SELECT}
    FROM "PreSessionReadinessSnapshot" s
    LEFT JOIN "Workout" w ON w.id = s."plannedWorkoutId"
    ORDER BY s.id
  `);
  return result.rows.map(mapCommonRow);
}

type PostMigrationRecord = CommonDatabaseRecord & {
  identity_status: string;
  identity_contract_version: number | null;
  identity_json: unknown;
  identity_hash: string | null;
  target_hash: string | null;
  payload_hash: string | null;
  readiness_evidence_fingerprint: string | null;
  projection_fingerprint: string | null;
  seed_revision_id: string | null;
  seed_revision_number: number | null;
  seed_payload_hash: string | null;
  prescription_fingerprint: string | null;
  seed_revision_exists: boolean;
  persisted_seed_revision_number: number | null;
  persisted_seed_payload_hash: string | null;
  seed_provenance_status: string | null;
  current_seed_revision_id: string | null;
};

async function readPostMigrationRows(client: ReadOnlyClient): Promise<ReadinessDatabaseRow[]> {
  const result = await query<PostMigrationRecord>(client, `
    SELECT ${COMMON_READINESS_SELECT},
      s."identityStatus" AS identity_status,
      s."identityContractVersion" AS identity_contract_version,
      s."identityJson" AS identity_json,
      s."identityHash" AS identity_hash,
      s."targetHash" AS target_hash,
      s."payloadHash" AS payload_hash,
      s."readinessEvidenceFingerprint" AS readiness_evidence_fingerprint,
      s."projectionFingerprint" AS projection_fingerprint,
      s."seedRevisionId" AS seed_revision_id,
      s."seedRevisionNumber" AS seed_revision_number,
      s."seedPayloadHash" AS seed_payload_hash,
      s."prescriptionFingerprint" AS prescription_fingerprint,
      (sr.id IS NOT NULL) AS seed_revision_exists,
      sr.revision AS persisted_seed_revision_number,
      sr."payloadHash" AS persisted_seed_payload_hash,
      sr."provenanceStatus" AS seed_provenance_status,
      m."currentSeedRevisionId" AS current_seed_revision_id
    FROM "PreSessionReadinessSnapshot" s
    LEFT JOIN "Workout" w ON w.id = s."plannedWorkoutId"
    LEFT JOIN "MesocycleSeedRevision" sr ON sr.id = s."seedRevisionId"
    LEFT JOIN "Mesocycle" m ON m.id = s."activeMesocycleId"
    ORDER BY s.id
  `);
  return result.rows.map((row) => ({
    ...mapCommonRow(row),
    identityStatus: row.identity_status,
    identityContractVersion:
      row.identity_contract_version == null ? null : Number(row.identity_contract_version),
    identityJson: row.identity_json,
    identityHash: row.identity_hash,
    targetHash: row.target_hash,
    payloadHash: row.payload_hash,
    readinessEvidenceFingerprint: row.readiness_evidence_fingerprint,
    projectionFingerprint: row.projection_fingerprint,
    seedRevisionId: row.seed_revision_id,
    seedRevisionNumber:
      row.seed_revision_number == null ? null : Number(row.seed_revision_number),
    seedPayloadHash: row.seed_payload_hash,
    prescriptionFingerprint: row.prescription_fingerprint,
    seedRevisionExists: row.seed_revision_exists,
    persistedSeedRevisionNumber:
      row.persisted_seed_revision_number == null
        ? null
        : Number(row.persisted_seed_revision_number),
    persistedSeedPayloadHash: row.persisted_seed_payload_hash,
    seedProvenanceStatus: row.seed_provenance_status,
    currentSeedRevisionId: row.current_seed_revision_id,
  }));
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readSnapshot(
  client: ReadOnlyClient,
  checkedIn: CheckedInMigration[],
): Promise<{
  catalog: ReadinessCatalogFacts;
  ledgerRows: LedgerRow[];
  rows: ReadinessDatabaseRow[];
}> {
  const [catalog, ledgerRows] = await Promise.all([readCatalog(client), readLedger(client)]);
  const stage = classifyReadinessSchemaStage({ catalog, ledgerRows, checkedIn }).stage;
  const rows =
    stage === "pre_architecture_migration"
      ? await readPreMigrationRows(client)
      : stage === "fully_migrated"
        ? await readPostMigrationRows(client)
        : [];
  return { catalog, ledgerRows, rows };
}

export async function inspectReadinessIntegrityDatabase(
  client: ReadOnlyClient,
  checkedIn: CheckedInMigration[],
): Promise<{
  catalog: ReadinessCatalogFacts;
  ledgerRows: LedgerRow[];
  rows: ReadinessDatabaseRow[];
  fingerprintBefore: string;
  fingerprintAfter: string;
  transactionReadOnly: boolean;
  writes: 0;
}> {
  await query(client, "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const readOnly = await query<{ transaction_read_only: string }>(
      client,
      "SHOW transaction_read_only",
    );
    const transactionReadOnly = readOnly.rows[0]?.transaction_read_only === "on";
    const before = await readSnapshot(client, checkedIn);
    const after = await readSnapshot(client, checkedIn);
    await query(client, "COMMIT");
    return {
      ...before,
      fingerprintBefore: fingerprint(before),
      fingerprintAfter: fingerprint(after),
      transactionReadOnly,
      writes: 0,
    };
  } catch (error) {
    await query(client, "ROLLBACK").catch(() => undefined);
    throw error;
  }
}
