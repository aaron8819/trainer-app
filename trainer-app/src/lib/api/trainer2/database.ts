import "next/headers";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolClient } from "pg";
import { DraftAccessError } from "./principal";

export const connectionRoles = { identity: "trainer2_identity_reader", read: "trainer2_draft_reader", write: "trainer2_draft_runtime" } as const;
export type ConnectionPurpose = keyof typeof connectionRoles;
const variables = { identity: "TRAINER2_IDENTITY_CONNECTION_STRING", read: "TRAINER2_READ_CONNECTION_STRING", write: "TRAINER2_WRITE_CONNECTION_STRING" } as const;
const tables = ["Trainer2AccountPrincipal", "Trainer2AccountTrainingState", "Trainer2Plan", "Trainer2PlanRevision", "Trainer2Identity", "Trainer2DurableAction", "Trainer2ActionOutcome"];

export function connectionString(purpose: ConnectionPurpose, local: boolean, env: Record<string, string | undefined> = process.env) {
  let url: URL;
  try { url = new URL(env[variables[purpose]] ?? ""); } catch { throw new DraftAccessError("DATABASE_CONFIGURATION_REQUIRED"); }
  if (url.protocol !== "postgresql:" || url.username !== connectionRoles[purpose] || !url.password || url.hash || url.search || !url.pathname.slice(1))
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
  const role = (await client.query(`SELECT current_user AS name, session_user AS session, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
    FROM pg_roles WHERE rolname=current_user`)).rows[0];
  if (!role || role.name !== connectionRoles[purpose] || role.session !== role.name || role.rolsuper || role.rolbypassrls || role.rolcreaterole || role.rolcreatedb || role.rolreplication) fail();
  if ((await client.query(`SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)`)).rowCount) fail();
  if ((await client.query(`SELECT 1 FROM pg_database WHERE datname=current_database() AND (datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR has_database_privilege(current_user,oid,'CREATE'))
    UNION ALL SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' AND (nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR has_schema_privilege(current_user,oid,'CREATE'))`)).rowCount) fail();
  if ((await client.query(`SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND (p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR (p.prosecdef AND has_function_privilege(current_user,p.oid,'EXECUTE')))`)).rowCount) fail();
  const relations = (await client.query(`SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
    c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owner,
    has_table_privilege(current_user,c.oid,'SELECT') OR has_any_column_privilege(current_user,c.oid,'SELECT') AS read,
    has_table_privilege(current_user,c.oid,'INSERT') OR has_any_column_privilege(current_user,c.oid,'INSERT') AS insert,
    has_table_privilege(current_user,c.oid,'UPDATE') OR has_any_column_privilege(current_user,c.oid,'UPDATE') AS update,
    has_table_privilege(current_user,c.oid,'DELETE,TRUNCATE,TRIGGER,REFERENCES') OR has_any_column_privilege(current_user,c.oid,'REFERENCES') AS other
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f')`)).rows;
  for (const r of relations) {
    const allowed = r.schema === "public" && ["r", "p"].includes(r.kind) && (purpose === "identity" ? r.name === tables[0] : tables.includes(r.name));
    if (r.owner || r.other || (r.read && !allowed) || (r.insert && !(allowed && purpose === "write" && r.name !== tables[0])) ||
      (r.update && !(allowed && purpose === "write" && ["Trainer2AccountTrainingState", "Trainer2Plan"].includes(r.name)))) fail();
  }
  for (const name of purpose === "identity" ? [tables[0]] : tables) {
    const r = relations.find(r => r.schema === "public" && r.name === name);
    if (!r?.read || (purpose === "write" && name !== tables[0] && !r.insert) ||
      (purpose === "write" && ["Trainer2AccountTrainingState", "Trainer2Plan"].includes(name) && !r?.update)) fail();
  }
  if ((await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind='S'
    AND (c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) OR has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE'))`)).rowCount) fail();
}

const connections = new Map<ConnectionPurpose, { url: string; local: boolean; pool: Pool; db: PrismaClient }>();
export async function databaseFor(purpose: ConnectionPurpose, local: boolean): Promise<PrismaClient> {
  const url = connectionString(purpose, local);
  if (purpose !== "identity") {
    const identity = new URL(connectionString("identity", local));
    const target = new URL(url);
    if (identity.host !== target.host || identity.pathname !== target.pathname) throw new DraftAccessError("DATABASE_TARGET_MISMATCH");
  }
  let connection = connections.get(purpose);
  if (connection && (connection.url !== url || connection.local !== local)) throw new DraftAccessError("DATABASE_CONFIGURATION_CHANGED_RESTART_REQUIRED");
  if (!connection) {
    const pool = new Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000, ssl: local ? false : { rejectUnauthorized: true } });
    connection = { url, local, pool, db: new PrismaClient({ adapter: new PrismaPg(pool) }) };
    connections.set(purpose, connection);
  }
  const client = await connection.pool.connect();
  try { await assertConnectionPrivileges(client, purpose); } finally { client.release(); }
  return connection.db;
}

export async function closeTrainer2Connections() {
  for (const { db, pool } of connections.values()) { await db.$disconnect(); await pool.end(); }
  connections.clear();
}
