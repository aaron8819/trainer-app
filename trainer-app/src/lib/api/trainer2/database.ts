import "next/headers";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { DraftAccessError } from "./principal";
import { currentDeploymentDecision } from "@/lib/operations/deployment-boundary";

export const connectionRoles = { identity: "trainer2_identity_runtime", read: "trainer2_draft_reader", write: "trainer2_draft_runtime" } as const;
export type ConnectionPurpose = keyof typeof connectionRoles;
const variables = { identity: "TRAINER2_IDENTITY_CONNECTION_STRING", read: "TRAINER2_READ_CONNECTION_STRING", write: "TRAINER2_WRITE_CONNECTION_STRING" } as const;
const identityTables = ["Trainer2Owner", "Trainer2DeviceSession"];
const trainingTables = ["Trainer2AccountTrainingState", "Trainer2Plan", "Trainer2PlanRevision", "Trainer2Identity", "Trainer2DurableAction", "Trainer2ActionOutcome", "Trainer2InstructionRevision", "Trainer2PlanDecision", "Trainer2Execution", "Trainer2SetResultRevision", "Trainer2ExecutionFinish", "Trainer2ExecutionDiscard", "Trainer2OccurrenceSkip", "Trainer2SetSkip"];
const tables = [...identityTables, ...trainingTables];

export function connectionString(purpose: ConnectionPurpose, local: boolean, env: Record<string, string | undefined> = process.env) {
  let url: URL;
  try { url = new URL(env[variables[purpose]] ?? ""); } catch { throw new DraftAccessError("DATABASE_CONFIGURATION_REQUIRED"); }
  const expectedRole = connectionRoles[purpose];
  const pooledUsername = new RegExp(`^${expectedRole}\\.[a-z0-9]{20}$`).test(url.username);
  const providerPooler = url.hostname.endsWith(".pooler.supabase.com");
  if (url.protocol !== "postgresql:" || (url.username !== expectedRole && !(providerPooler && pooledUsername)) || !url.password || url.hash || url.search || !url.pathname.slice(1))
    throw new DraftAccessError("DATABASE_CONFIGURATION_INVALID");
  if (local && (url.hostname !== "127.0.0.1" || !/^\/trainer2_disposable_[a-z0-9_]+$/.test(url.pathname)))
    throw new DraftAccessError("DISPOSABLE_TARGET_REQUIRED");
  // Hosted TLS cannot be disabled through URL options or the legacy SSL override.
  if (!local && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new DraftAccessError("DATABASE_CONFIGURATION_INVALID");
  return url.toString();
}

/** Checks effective grants (including PUBLIC/column grants), not only role spelling.
 * This qualifies privileges, NOT per-account RLS. All non-system schemas are inspected.
 * Administrative DDL must be frozen during admission; checks are repeated per context. */
export async function assertConnectionPrivileges(client: PoolClient, purpose: ConnectionPurpose) {
  const fail = () => { throw new DraftAccessError("DATABASE_ROLE_UNSAFE"); };
  // PostgreSQL 17 is the qualified contract (including MAINTAIN and parameter ACLs).
  // Fail closed on another major, rather than silently omitting unsupported checks.
  const state = (await client.query(`SELECT current_setting('server_version_num')::int AS version,
    current_setting('session_replication_role') AS replication, current_setting('row_security') AS row_security`)).rows[0];
  if (!state || state.version < 170000 || state.version >= 180000 || state.replication !== "origin" || state.row_security !== "on") fail();
  const role = (await client.query(`SELECT current_user AS name, session_user AS session, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
    FROM pg_roles WHERE rolname=current_user`)).rows[0];
  if (!role || role.name !== connectionRoles[purpose] || role.session !== role.name || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.rolreplication) fail();
  if ((await client.query(`SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)`)).rowCount) fail();
  // Ordinary user/backend settings remain configurable. All elevated SET, all ALTER
  // SYSTEM and all delegation authority are forbidden. Include ACL-only names:
  // unloaded extension parameters must not escape inspection via pg_settings.
  if ((await client.query(`WITH parameters AS (
    SELECT name, context FROM pg_settings
    UNION ALL SELECT parname, NULL FROM pg_parameter_acl WHERE parname NOT IN (SELECT name FROM pg_settings)
  ) SELECT 1 FROM parameters WHERE
    (COALESCE(context NOT IN ('user','backend'),true) AND has_parameter_privilege(current_user,name,'SET'))
    OR has_parameter_privilege(current_user,name,'ALTER SYSTEM,SET WITH GRANT OPTION,ALTER SYSTEM WITH GRANT OPTION')`)).rowCount) fail();
  if ((await client.query(`SELECT 1 FROM pg_database WHERE datname=current_database() AND (datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR has_database_privilege(current_user,oid,'CREATE'))
    UNION ALL SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' AND (nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR has_schema_privilege(current_user,oid,'CREATE'))`)).rowCount) fail();
  if ((await client.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND (p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR (p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE')))`)).rowCount) fail();
  if ((await client.query(`SELECT 1 FROM pg_database WHERE datname=current_database()
    AND has_database_privilege(current_user,oid,'CREATE WITH GRANT OPTION,CONNECT WITH GRANT OPTION,TEMPORARY WITH GRANT OPTION')
    UNION ALL SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'
    AND has_schema_privilege(current_user,oid,'CREATE WITH GRANT OPTION,USAGE WITH GRANT OPTION')
    UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND has_function_privilege(current_user,p.oid,'EXECUTE WITH GRANT OPTION')`)).rowCount) fail();
  const relations = (await client.query(`SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
    c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owner,
    has_table_privilege(current_user,c.oid,'SELECT') OR has_any_column_privilege(current_user,c.oid,'SELECT') AS read,
    has_table_privilege(current_user,c.oid,'INSERT') OR has_any_column_privilege(current_user,c.oid,'INSERT') AS insert,
    has_table_privilege(current_user,c.oid,'UPDATE') OR has_any_column_privilege(current_user,c.oid,'UPDATE') AS update,
    has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN') OR has_any_column_privilege(current_user,c.oid,'REFERENCES') AS other,
    has_table_privilege(current_user,c.oid,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION,TRUNCATE WITH GRANT OPTION,TRIGGER WITH GRANT OPTION,REFERENCES WITH GRANT OPTION,MAINTAIN WITH GRANT OPTION')
      OR has_any_column_privilege(current_user,c.oid,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION') AS delegation
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f')`)).rows;
  for (const r of relations) {
    const allowed = r.schema === "public" && ["r", "p"].includes(r.kind) &&
      (purpose === "identity" ? identityTables.includes(r.name) : tables.includes(r.name));
    // Supabase exposes these two extension statistics views to PUBLIC by default.
    // They contain no Trainer2 table rows and receive no grant from this app.
    const providerStatistic = r.schema === "extensions" && ["pg_stat_statements", "pg_stat_statements_info"].includes(r.name) && r.kind === "v";
    if (r.owner || r.other || r.delegation || (r.read && !allowed && !providerStatistic) ||
      (r.insert && !(allowed && (purpose === "identity" ? r.name === "Trainer2DeviceSession" : purpose === "write" && trainingTables.includes(r.name)))) ||
      (r.update && !(allowed && (purpose === "identity" ? identityTables.includes(r.name) : purpose === "write" && ["Trainer2AccountTrainingState", "Trainer2Plan", "Trainer2Execution"].includes(r.name))))) fail();
  }
  if ((await client.query(`SELECT 1 FROM pg_attribute WHERE attrelid='"Trainer2Execution"'::regclass AND attnum>0 AND NOT attisdropped
    AND attname<>'lifecycle' AND has_column_privilege(current_user,attrelid,attnum,'UPDATE')`)).rowCount) fail();
  if (purpose === "identity" && (await client.query(`SELECT 1 FROM pg_attribute WHERE attnum>0 AND NOT attisdropped AND (
    (attrelid='"Trainer2Owner"'::regclass AND attname NOT IN ('passcodeVerifier','setupVerifier','failedAttempts','lockedUntil','sessionEpoch') AND has_column_privilege(current_user,attrelid,attnum,'UPDATE'))
    OR (attrelid='"Trainer2DeviceSession"'::regclass AND attname NOT IN ('expiresAt','renewedAt','revokedAt') AND has_column_privilege(current_user,attrelid,attnum,'UPDATE')))`)).rowCount) fail();
  if (purpose !== "identity" && (await client.query(`SELECT 1 WHERE
    has_column_privilege(current_user,'"Trainer2Owner"','passcodeVerifier','SELECT') OR
    has_column_privilege(current_user,'"Trainer2Owner"','setupVerifier','SELECT') OR
    has_column_privilege(current_user,'"Trainer2DeviceSession"','tokenHash','SELECT')`)).rowCount) fail();
  for (const name of purpose === "identity" ? identityTables : tables) {
    const r = relations.find(r => r.schema === "public" && r.name === name);
    if (!r?.read || ((purpose === "write" && trainingTables.includes(name) || purpose === "identity" && name === "Trainer2DeviceSession") && !r.insert) ||
      ((purpose === "write" && ["Trainer2AccountTrainingState", "Trainer2Plan", "Trainer2Execution"].includes(name) || purpose === "identity" && identityTables.includes(name)) && !r?.update)) fail();
  }
  if ((await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind='S'
    AND (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE,SELECT WITH GRANT OPTION,USAGE WITH GRANT OPTION,UPDATE WITH GRANT OPTION'))`)).rowCount) fail();
}

const connections = new Map<ConnectionPurpose, { url: string; local: boolean; pool: Pool; db: PrismaClient }>();
export async function databaseFor(purpose: ConnectionPurpose, local: boolean): Promise<PrismaClient> {
  const deployment = currentDeploymentDecision();
  if (deployment !== "v1")
    throw new DraftAccessError("DEPLOYMENT_BOUNDARY_DENIED");
  const url = connectionString(purpose, local);
  if (purpose !== "identity") {
    const identity = new URL(connectionString("identity", local));
    const target = new URL(url);
    if (identity.host !== target.host || identity.pathname !== target.pathname) throw new DraftAccessError("DATABASE_TARGET_MISMATCH");
  }
  let connection = connections.get(purpose);
  if (connection && (connection.url !== url || connection.local !== local)) throw new DraftAccessError("DATABASE_CONFIGURATION_CHANGED_RESTART_REQUIRED");
  if (!connection) {
    const ca = process.env.TRAINER2_DB_CA_CERT_PEM;
    const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000, ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) } });
    connection = { url, local, pool, db: new PrismaClient({ adapter: new PrismaPg(pool) }) };
    connections.set(purpose, connection);
  }
  const client = await connection.pool.connect();
  try { await assertConnectionPrivileges(client, purpose); }
  catch (error) { client.release(true); throw error; }
  client.release();
  return connection.db;
}

export async function closeTrainer2Connections() {
  for (const { db, pool } of connections.values()) { await db.$disconnect(); await pool.end(); }
  connections.clear();
}
