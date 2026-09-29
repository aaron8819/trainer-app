import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { provisionSingleUser } from "./provision-single-user";
import { assertConnectionPrivileges, connectionString } from "../../src/lib/api/trainer2/database";
import { authorizeAccount } from "../../src/lib/api/trainer2/principal";
import { createDraft, readDraft } from "../../src/lib/api/trainer2/planning";
import { enterPasscode, revokeSession, sessionForRequest, SESSION_COOKIE } from "../../src/lib/api/trainer2/sessions";
import { EXPECTED_MIGRATION_CHAIN } from "../../src/lib/operations/migration-integrity";

function run(command: string, args: string[], env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, { encoding: "utf8", env, windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}`);
  return result.stdout.trim();
}

export async function verifySingleUser() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const container = `trainer2-single-user-${suffix}`;
  const database = `trainer2_disposable_${suffix}`;
  const password = randomUUID();
  const pools: Pool[] = [];
  const clients: PrismaClient[] = [];
  const db = (url: string) => { const pool = new Pool({ connectionString: url }); pools.push(pool);
    const client = new PrismaClient({ adapter: new PrismaPg(pool) }); clients.push(client); return client; };
  try {
    run("docker", ["run", "--pull=never", "--rm", "-d", "--name", container,
      "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${database}`,
      "-p", "127.0.0.1::5432", "postgres:17-alpine"]);
    for (let i = 0; i < 60; i++) {
      if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { windowsHide: true }).status === 0) break;
      if (i === 59) throw new Error("POSTGRES_START_FAILED");
      await new Promise(r => setTimeout(r, 500));
    }
    const port = run("docker", ["port", container, "5432/tcp"]).match(/:(\d+)$/)?.[1]; assert(port);
    const url = (role: string) => `postgresql://${role}:${password}@127.0.0.1:${port}/${database}`;
    const admin = db(url("postgres"));
    await pools[0].query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;`);
    const trainer2Start = EXPECTED_MIGRATION_CHAIN.indexOf("20260909120000_trainer2_drafts");
    assert(trainer2Start > 0);
    const apply = async (name: string) => pools[0].query(readFileSync(resolve("prisma/migrations", name, "migration.sql"), "utf8"));
    for (const name of EXPECTED_MIGRATION_CHAIN.slice(0, trainer2Start)) await apply(name);
    const accountId = randomUUID();
    process.env.TRAINER2_OWNER_USER_ID = accountId;
    await admin.user.create({ data: { id: accountId, email: `${suffix}@synthetic.invalid` } });
    const v1Columns = await pools[0].query(`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name NOT LIKE 'Trainer2%' ORDER BY table_name,ordinal_position`);
    const v1Definitions = async () => (await pools[0].query(`
      SELECT 'index' AS kind, c.relname AS name, pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public' AND t.relname NOT LIKE 'Trainer2%'
      UNION ALL SELECT 'constraint', con.conname, pg_get_constraintdef(con.oid)
        FROM pg_constraint con JOIN pg_class t ON t.oid=con.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public' AND t.relname NOT LIKE 'Trainer2%'
      UNION ALL SELECT 'trigger', t.tgname, pg_get_triggerdef(t.oid)
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname NOT LIKE 'Trainer2%' AND NOT t.tgisinternal
      UNION ALL SELECT 'function', p.proname, pg_get_functiondef(p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND left(p.proname,9) <> 'trainer2_' AND p.prokind IN ('f','p')
      UNION ALL SELECT 'relation_acl', c.relname, coalesce(c.relacl::text,'')
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname NOT LIKE 'Trainer2%' AND c.relkind IN ('r','p','v','m','S')
      UNION ALL SELECT 'function_acl', p.proname, coalesce(p.proacl::text,'')
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND left(p.proname,9) <> 'trainer2_'
      ORDER BY kind,name,definition`)).rows;
    const v1Before = await v1Definitions();
    for (const name of EXPECTED_MIGRATION_CHAIN.slice(trainer2Start)) await apply(name);
    const afterColumns = await pools[0].query(`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name NOT LIKE 'Trainer2%' ORDER BY table_name,ordinal_position`);
    assert.deepEqual(afterColumns.rows, v1Columns.rows, "Trainer2 migrations changed V1 columns");
    assert.deepEqual(await v1Definitions(), v1Before, "Trainer2 migrations changed V1 definitions");
    assert.equal((await admin.user.findUnique({ where: { id: accountId } }))?.email, `${suffix}@synthetic.invalid`);
    await admin.user.update({ where: { id: accountId }, data: { email: `updated-${suffix}@synthetic.invalid` } });
    assert.equal((await admin.user.findUnique({ where: { id: accountId } }))?.email, `updated-${suffix}@synthetic.invalid`);
    await pools[0].query(`CREATE SCHEMA extensions;
      CREATE VIEW extensions.pg_stat_statements AS SELECT 1 AS calls;
      CREATE VIEW extensions.pg_stat_statements_info AS SELECT 1 AS dealloc;
      GRANT USAGE ON SCHEMA extensions TO PUBLIC;
      GRANT SELECT ON extensions.pg_stat_statements, extensions.pg_stat_statements_info TO PUBLIC;`);
    await pools[0].query(`BEGIN; ${readFileSync(resolve("prisma/trainer2-runtime-grants.sql"), "utf8")} COMMIT;`);
    for (const apiRole of ["anon", "authenticated", "service_role"]) {
      const access = await pools[0].query(`SELECT count(*)::int AS unsafe FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname LIKE 'Trainer2%' AND c.relkind IN ('r','p')
        AND has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')`, [apiRole]);
      assert.equal(access.rows[0].unsafe, 0, `${apiRole} retained Trainer2 access`);
      const sequenceAccess = await pools[0].query(`SELECT count(*)::int AS unsafe FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname LIKE 'Trainer2%' AND c.relkind='S'
        AND CASE WHEN c.relkind='S' THEN has_sequence_privilege($1,c.oid,'USAGE,SELECT,UPDATE') ELSE false END`, [apiRole]);
      assert.equal(sequenceAccess.rows[0].unsafe, 0, `${apiRole} retained Trainer2 sequence access`);
      const functionAccess = await pools[0].query(`SELECT count(*)::int AS unsafe FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND left(p.proname,9) = 'trainer2_'
        AND has_function_privilege($1,p.oid,'EXECUTE')`, [apiRole]);
      assert.equal(functionAccess.rows[0].unsafe, 0, `${apiRole} retained Trainer2 function access`);
    }
    assert.equal(connectionString("identity", false, { TRAINER2_IDENTITY_CONNECTION_STRING:
      "postgresql://trainer2_identity_runtime.siqmohcbvnbdrssgofzu:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres" }).includes("pooler.supabase.com"), true);
    for (const role of ["trainer2_identity_runtime", "trainer2_draft_reader", "trainer2_draft_runtime"])
      await pools[0].query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
    const identity = db(url("trainer2_identity_runtime"));
    const reader = db(url("trainer2_draft_reader"));
    const writer = db(url("trainer2_draft_runtime"));
    for (const [pool, purpose] of [[pools[1], "identity"], [pools[2], "read"], [pools[3], "write"]] as const) {
      const connection = await pool.connect();
      try { await assertConnectionPrivileges(connection, purpose); } finally { connection.release(); }
    }
    const setupCode = randomBytes(32).toString("base64url");
    await provisionSingleUser(admin, accountId, setupCode);
    await assert.rejects(provisionSingleUser(admin, accountId, setupCode), /OWNER_ALREADY_BOUND/);
    const passcode = `synthetic passcode ${randomUUID()}`;
    const first = await enterPasscode(identity, { setupCode, passcode });
    const request = (token: string) => new Request("http://localhost/api/trainer2/drafts", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    const principal = await sessionForRequest(identity, request(first));
    assert.deepEqual(principal, { accountId, sessionId: first.split(".")[0] });
    await authorizeAccount(reader, principal);
    const planId = randomUUID();
    const created = await createDraft(writer, principal, { schemaVersion: 1, commandType: "CreateDraft", actionId: randomUUID(),
      originatingAccountId: accountId, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [],
      target: { planId }, expected: {}, intent: { schemaVersion: 1, name: "Synthetic session plan",
        endpoint: "endOfOrderedOccurrences", stages: [], occurrences: [] } });
    assert.equal(created.outcome.status, "Accepted");
    assert(await readDraft(reader, principal, planId));
    await assert.rejects(readDraft(reader, { ...principal, accountId: randomUUID() }, planId), /UNAUTHORIZED/);
    await assert.rejects(enterPasscode(identity, { setupCode, passcode }), /AUTHENTICATION_FAILED/);
    const second = await enterPasscode(identity, { passcode });
    assert.notEqual(first, second);
    for (let i = 0; i < 5; i++) await assert.rejects(enterPasscode(identity, { passcode: `wrong synthetic ${i}` }), /AUTHENTICATION_FAILED/);
    await assert.rejects(enterPasscode(identity, { passcode }), /AUTHENTICATION_FAILED/);
    await admin.trainer2Owner.update({ where: { id: 1 }, data: { lockedUntil: new Date(0) } });
    const third = await enterPasscode(identity, { passcode });
    await revokeSession(identity, request(first), false);
    await assert.rejects(sessionForRequest(identity, request(first)), /UNAUTHENTICATED/);
    assert.equal((await sessionForRequest(identity, request(second))).accountId, accountId);
    await revokeSession(identity, request(second), true);
    for (const token of [second, third]) await assert.rejects(sessionForRequest(identity, request(token)), /UNAUTHENTICATED/);
    const fourth = await enterPasscode(identity, { passcode });
    await identity.$disconnect(); await pools[1].end();
    const restarted = db(url("trainer2_identity_runtime"));
    assert.equal((await sessionForRequest(restarted, request(fourth))).accountId, accountId);
    await admin.trainer2DeviceSession.update({ where: { id: fourth.split(".")[0] }, data: { expiresAt: new Date(0) } });
    await assert.rejects(sessionForRequest(restarted, request(fourth)), /UNAUTHENTICATED/);
    await admin.trainer2Owner.update({ where: { id: 1 }, data: { accountId: randomUUID() } }).then(
      () => { throw new Error("FK_SHOULD_REJECT_UNKNOWN_USER"); }, () => {});
    process.env.TRAINER2_OWNER_USER_ID = randomUUID();
    await assert.rejects(sessionForRequest(restarted, request(fourth)), /OWNER_BINDING_INVALID/);
    process.env.TRAINER2_OWNER_USER_ID = accountId;
    if (process.env.TRAINER2_BROWSER === "1") {
      const { verifySingleUserBrowser } = await import("./verify-single-user-browser");
      await verifySingleUserBrowser({ accountId, passcode,
        identityUrl: url("trainer2_identity_runtime"), readUrl: url("trainer2_draft_reader"),
        writeUrl: url("trainer2_draft_runtime") });
    }
    console.log("PASS disposable owner binding, setup, guessing limit, independent sessions, sign-out, global revocation, restart and expiry");
  } finally {
    for (const client of clients) await client.$disconnect().catch(() => {});
    for (const pool of pools) await pool.end().catch(() => {});
    spawnSync("docker", ["rm", "-f", container], { windowsHide: true });
  }
}
