import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { captureSource } from "../../legacy-history/source";
import { sourceScopeSchema, rawSourceSchema, type RawSource, type SourceScope, type SourceAssertion } from "../../trainer2-contracts/legacy-source";
import { legacyQueries } from "./legacy-source-queries";

export const legacyCaptureLimits = { perFamily: 500, totalRecords: 2000, perRowBytes: 1_000_000, totalBytes: 16_000_000 } as const;
export function validateLegacySourceTarget(value: string): URL {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^\/trainer2_disposable_[a-z0-9_]+$/.test(url.pathname) || url.username !== "trainer2_legacy_reader" || url.search || url.hash || !url.port)
    throw new Error("LEGACY_SOURCE_REQUIRES_DISPOSABLE_READER_TARGET");
  return url;
}

/** Reusable database read boundary. Caller owns connection cleanup. No mutation services. */
export async function readLegacySource(pool: Pick<Pool, "connect">, scopeInput: SourceScope, assertions: SourceAssertion[] = []) {
  const scope = sourceScopeSchema.parse(scopeInput);
  const families = legacyQueries.map(q => q.family).sort();
  if (scope.kind !== "synthetic-postgres" || scope.completeness !== "complete-within-declared-families" || JSON.stringify([...scope.families].sort()) !== JSON.stringify(families))
    throw new Error("LEGACY_SOURCE_SCOPE_UNSUPPORTED");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    await client.query("SET LOCAL search_path=pg_catalog,public");
    await client.query("SET LOCAL timezone='UTC'");
    await client.query("SET LOCAL datestyle='ISO, YMD'");
    await client.query("SET LOCAL extra_float_digits=3");
    const role = (await client.query(`SELECT current_user AS name, current_database() AS database, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
      current_setting('transaction_read_only') AS readonly, current_setting('transaction_isolation') AS isolation,
      pg_current_snapshot()::text AS snapshot FROM pg_roles WHERE rolname=current_user`)).rows[0];
    if (role?.name !== "trainer2_legacy_reader" || !/^trainer2_disposable_[a-z0-9_]+$/.test(role.database) || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.readonly !== "on" || role.isolation !== "repeatable read")
      throw new Error("LEGACY_SOURCE_READER_ROLE_INVALID");
    if ((await client.query(`SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user) LIMIT 1`)).rowCount)
      throw new Error("LEGACY_SOURCE_READER_ROLE_MEMBERSHIP");
    const writable = await client.query(`SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (pg_has_role(current_user,c.relowner,'USAGE') OR has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege(current_user,c.oid,'INSERT,UPDATE')) LIMIT 1`);
    if (writable.rowCount) throw new Error("LEGACY_SOURCE_READER_HAS_MUTATION_PRIVILEGES");
    const rows: RawSource[] = [];
    let bytes = 0;
    for (const q of legacyQueries) {
      // Full stored representation with numeric/timestamp/JSON fields retained as
      // PostgreSQL-produced text. Size guard executes before data reaches JS.
      // Cast each column directly: to_jsonb(row) would collapse SQL NULL and
      // a JSONB column containing JSON null. Catalog names are quoted as data.
      const columns = await client.query<{ name: string }>(`SELECT attname AS name FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum LIMIT 257`, [`public."${q.family}"`]);
      if (!columns.rows.length || columns.rows.length > 256) throw new Error("LEGACY_SOURCE_COLUMN_LIMIT");
      const pairs = columns.rows.map(({ name }) => `SELECT '${name.replaceAll("'", "''")}' AS key,t."${name.replaceAll('"', '""')}"::text AS value`).join(" UNION ALL ");
      const result = await client.query(`SELECT ${q.key ?? "t.id"} AS record,
        octet_length(raw.payload) AS bytes,
        CASE WHEN octet_length(raw.payload)<=$3 THEN raw.payload ELSE NULL END AS payload
        FROM public."${q.family}" t ${q.joins}
        CROSS JOIN LATERAL (SELECT jsonb_object_agg(key,value)::text AS payload FROM (${pairs}) fields) raw
        WHERE ${q.owner} ORDER BY (${q.key ?? "t.id"}) COLLATE "C" LIMIT $2`, [scope.account, legacyCaptureLimits.perFamily + 1, legacyCaptureLimits.perRowBytes]);
      if (result.rows.length > legacyCaptureLimits.perFamily) throw new Error(`LEGACY_SOURCE_FAMILY_LIMIT:${q.family}`);
      for (const r of result.rows) {
        bytes += r.bytes;
        if (r.payload === null || bytes > legacyCaptureLimits.totalBytes || rows.length >= legacyCaptureLimits.totalRecords) throw new Error("LEGACY_SOURCE_CAPTURE_LIMIT");
        rows.push(rawSourceSchema.parse({ family: q.family, record: r.record, fields: JSON.parse(r.payload) }));
      }
    }
    await client.query("COMMIT");
    return captureSource({ schemaVersion: 1, synthetic: true, scope, rows }, { batchId: randomUUID(), capturedAt: new Date().toISOString(), databaseSnapshot: role.snapshot }, assertions);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function captureLegacyDatabase(url: string, system: string, account: string) {
  validateLegacySourceTarget(url);
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  try { return await readLegacySource(pool, { system, account, kind: "synthetic-postgres", selection: "all-owner-reachable-rows-v1", families: legacyQueries.map(q => q.family), completeness: "complete-within-declared-families" }); }
  finally { await pool.end(); }
}
