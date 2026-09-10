import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { provisionPrincipal } from "./provision-principal";
import { resolveAccount, authorizeAccount } from "../../src/lib/api/trainer2/principal";
import { assertConnectionPrivileges, type ConnectionPurpose } from "../../src/lib/api/trainer2/database";
import { createDraft, editDraft, readDraft, readOutcomeChanges } from "../../src/lib/api/trainer2/planning";
import { sanitizeDatabaseTargetEnvironment, validateDisposableDatabaseTargets } from "../../src/lib/operations/test-environment-preflight";
import { verificationSource } from "./verification-source";

export async function verifyPrincipal() {
  const output = resolve("artifacts/trainer2-principal"); mkdirSync(output, { recursive: true });
  const source = verificationSource();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const container = `trainer2-principal-${suffix}`, database = `trainer2_disposable_${suffix}`, password = randomUUID();
  const pools: Pool[] = [], clients: PrismaClient[] = [], results: string[] = [], commands: unknown[] = [];
  const evidence: Record<string, unknown> = { source, started: new Date().toISOString(), node: process.version,
    invocation: "node node_modules/tsx/dist/cli.mjs scripts/test-trainer2-principal-postgres.ts --confirm-disposable",
    authentication: "This provider-independent PostgreSQL suite begins at synthetic verified principal output; real token/session evidence is produced separately by verify-supabase-auth." };
  const scrub = (s: string) => s.replaceAll(password, "[disposable-secret]").replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[disposable-target]");
  const command = (exe: string, args: string[], env?: NodeJS.ProcessEnv) => {
    const started = new Date().toISOString();
    const r = spawnSync(exe, args, { encoding: "utf8", env, windowsHide: true, maxBuffer: 20_000_000 });
    commands.push({ command: scrub([exe, ...args].join(" ")), started, finished: new Date().toISOString(), status: r.status, stdout: scrub(r.stdout ?? ""), stderr: scrub(r.stderr ?? "") });
    if (r.status !== 0) throw new Error(scrub(`Command failed: ${exe}: ${r.stderr}`));
    return r.stdout.trim();
  };
  const passed = (name: string) => { results.push(name); console.log(`PASS ${name}`); };
  const pool = (url: string) => { const p = new Pool({ connectionString: url }); pools.push(p); return p; };
  const prisma = (p: Pool) => { const db = new PrismaClient({ adapter: new PrismaPg(p) }); clients.push(db); return db; };
  try {
    command("docker", ["run", "--pull=never", "--rm", "-d", "--name", container, "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${database}`, "-p", "127.0.0.1::5432", "postgres:17-alpine"]);
    for (let i = 0; ; i++) {
      if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { windowsHide: true }).status === 0) break;
      if (i === 60) throw new Error("PostgreSQL startup failed");
      await new Promise(r => setTimeout(r, 500));
    }
    const port = command("docker", ["port", container, "5432/tcp"]).match(/:(\d+)$/)?.[1]; assert(port);
    const url = (role: string) => `postgresql://${role}:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: url("postgres"), DIRECT_URL: url("postgres"), TEST_DATABASE_URL: url("postgres") };
    assert(validateDisposableDatabaseTargets({ environment: env, confirmed: true }).valid);
    command(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], env);
    const owner = pool(url("postgres"));
    evidence.postgres = (await owner.query("SELECT version()")).rows[0];
    evidence.docker = command("docker", ["version", "--format", "{{.Server.Version}}"]);
    evidence.pg = JSON.parse(readFileSync(resolve("node_modules/pg/package.json"), "utf8")).version;
    await owner.query(`BEGIN; ${readFileSync(resolve("prisma/trainer2-runtime-grants.sql"), "utf8")} COMMIT;`);
    for (const role of ["trainer2_identity_reader", "trainer2_draft_reader", "trainer2_draft_runtime", "trainer2_principal_admin"])
      await owner.query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
    const admin = pool(url("trainer2_principal_admin"));
    const identity = pool(url("trainer2_identity_reader")), reader = pool(url("trainer2_draft_reader")), writer = pool(url("trainer2_draft_runtime"));
    const lookup = prisma(identity), read = prisma(reader), write = prisma(writer);
    const check = async (p: Pool, purpose: ConnectionPurpose) => { const c = await p.connect(); try { await assertConnectionPrivileges(c, purpose); } finally { c.release(); } };
    for (const [p, purpose] of [[identity, "identity"], [reader, "read"], [writer, "write"]] as const) await check(p, purpose);
    passed("fresh grant file: all three restricted connections admitted by effective privilege checks");
    await assert.rejects(check(owner, "write"), /DATABASE_ROLE_UNSAFE/);
    await assert.rejects(check(reader, "write"), /DATABASE_ROLE_UNSAFE/);
    await owner.query(`INSERT INTO "User" (id,email) VALUES ('account-A','a@synthetic.invalid'),('account-B','b@synthetic.invalid')`);
    const a = { issuer: "https://synthetic.invalid/issuer-A", subject: "subject-A", accountId: "account-A" };
    const b = { issuer: "https://synthetic.invalid/issuer-B", subject: "subject-A", accountId: "account-B" };
    const first = await provisionPrincipal(admin, a); assert(first.created);
    assert.equal((await provisionPrincipal(admin, a)).created, false);
    await provisionPrincipal(admin, b);
    assert.deepEqual(await resolveAccount(lookup, a), a); assert.deepEqual(await resolveAccount(lookup, b), b);
    await assert.rejects(resolveAccount(lookup, { ...a, subject: "same-email-different-subject", ...{ email: "a@synthetic.invalid" } }), /UNAUTHORIZED/);
    await assert.rejects(provisionPrincipal(admin, { ...a, accountId: b.accountId }), /PRINCIPAL_BINDING_CONFLICT/);
    await assert.rejects(provisionPrincipal(admin, { ...a, subject: "unknown-account", accountId: "absent" }), (e: unknown) => (e as { code: string }).code === "23503");
    await assert.rejects(provisionPrincipal(writer, { ...a, subject: "runtime-provision" }), /PRINCIPAL_ADMIN_ROLE_REQUIRED/);
    const concurrent = await Promise.allSettled([a, b].map(p => provisionPrincipal(admin, { ...p, issuer: a.issuer, subject: "race" })));
    assert.equal(concurrent.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter(r => r.status === "rejected").length, 1);
    assert.equal((await owner.query(`SELECT * FROM "Trainer2AccountPrincipal" WHERE subject='race'`)).rowCount, 1);
    const duplicates = await Promise.all(Array.from({ length: 6 }, () => provisionPrincipal(admin, { ...a, subject: "duplicate-race" })));
    assert.equal(duplicates.filter(r => r.created).length, 1);
    passed("exact issuer/subject lookup; issuer separation; no email linking or unknown-account creation; administrative conflicts and concurrent uniqueness");

    const envelope = { schemaVersion: 1, commandType: "CreateDraft" as const, actionId: randomUUID(), originatingAccountId: a.accountId, deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [], target: { planId: randomUUID() }, expected: {},
      intent: { schemaVersion: 1, name: "Synthetic boundary draft", endpoint: "endOfOrderedOccurrences", stages: [], occurrences: [] } };
    const accepted = await createDraft(write, a, envelope); assert.equal(accepted.outcome.status, "Accepted");
    assert.equal(await readDraft(read, b, envelope.target.planId), null);
    await assert.rejects(createDraft(write, b, envelope), /ACCOUNT_MISMATCH/);
    await assert.rejects(createDraft(write, { ...a, accountId: b.accountId }, { ...envelope, originatingAccountId: b.accountId }), /UNAUTHORIZED/);
    const foreignEdit = await editDraft(write, b, { ...envelope, originatingAccountId: b.accountId, commandType: "EditDraft", actionId: randomUUID(), expected: { planRevisionId: randomUUID() }, intent: { operations: [{ op: "renamePlan", name: "attack" }] } });
    assert.equal(foreignEdit.outcome.status, "Rejected");
    const snapshot = async () => {
      const names = (await owner.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`)).rows;
      const rows: Record<string, unknown> = {};
      for (const { tablename } of names) rows[tablename] = (await owner.query(`SELECT to_jsonb(t)::text AS row FROM public."${tablename.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`)).rows;
      return rows;
    };
    const before = await snapshot();
    assert(await readDraft(read, a, envelope.target.planId));
    assert.equal((await readOutcomeChanges(read, b, BigInt(0))).changes.some(r => r.actionId === envelope.actionId), false);
    assert.deepEqual(await snapshot(), before);
    passed("real PostgreSQL named create/read/edit/replay account predicates reject cross-account requests");
    const configPath = resolve(output, "vitest.hosted.mts");
    writeFileSync(configPath, `export default { test: { environment: "node", include: ["scripts/trainer2/hosted-boundary.fixture.ts"], reporters: ["default"] } };\n`);
    command(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--config", configPath], {
      ...sanitizeDatabaseTargetEnvironment(process.env), TRAINER2_IDENTITY_CONNECTION_STRING: url("trainer2_identity_reader"),
      TRAINER2_READ_CONNECTION_STRING: url("trainer2_draft_reader"), TRAINER2_WRITE_CONNECTION_STRING: url("trainer2_draft_runtime"),
    });
    assert.deepEqual(await snapshot(), before);
    passed("hosted HTTP orchestration with controlled verifier fixture and real mapping/privilege checks: no admission, fallback or database writes");

    // Existing principals carry no cached authorization: deletion and replacement are checked anew.
    await admin.query(`DELETE FROM "Trainer2AccountPrincipal" WHERE id=$1`, [first.id]);
    for (const operation of [() => authorizeAccount(lookup, a), () => readDraft(read, a, envelope.target.planId), () => createDraft(write, a, envelope), () => readOutcomeChanges(read, a, BigInt(0))])
      await assert.rejects(operation(), /UNAUTHORIZED/);
    await provisionPrincipal(admin, { ...a, accountId: b.accountId });
    await assert.rejects(createDraft(write, a, envelope), /UNAUTHORIZED/);
    assert.equal((await resolveAccount(lookup, a)).accountId, b.accountId);
    assert.equal(await readDraft(read, await resolveAccount(lookup, a), envelope.target.planId), null);
    passed("removed mapping denies existing principal and historical replay; deliberate replacement takes effect on next resolution");

    for (const p of [identity, reader, writer]) {
      for (const sql of [`UPDATE "Trainer2AccountPrincipal" SET "accountId"='account-B'`, `DELETE FROM "Trainer2AccountPrincipal"`, `INSERT INTO "Trainer2AccountPrincipal" (id,issuer,subject,"accountId") VALUES ('${randomUUID()}','x','y','account-A')`, `UPDATE "User" SET email=email`, `DELETE FROM "Workout"`, `TRUNCATE "SetLog"`])
        await assert.rejects(p.query(sql), (e: unknown) => (e as { code: string }).code === "42501");
    }
    for (const p of [identity, reader])
      await assert.rejects(p.query(`UPDATE "Trainer2AccountTrainingState" SET "ownershipEpoch"="ownershipEpoch"`), (e: unknown) => (e as { code: string }).code === "42501");
    await assert.rejects(identity.query(`SELECT * FROM "Trainer2Plan"`), (e: unknown) => (e as { code: string }).code === "42501");
    passed("actual SQL denies mapping administration, legacy mutations and read-role writes; identity role cannot read plans");

    const unsafe = async (name: string, grant: string, revoke: string, p = writer, purpose: ConnectionPurpose = "write") => {
      await owner.query(grant);
      try { await assert.rejects(check(p, purpose), /DATABASE_ROLE_UNSAFE/, name); } finally { await owner.query(revoke); }
      await check(p, purpose); passed(`unsafe effective privilege rejected: ${name}`);
    };
    await unsafe("PUBLIC legacy column update", `GRANT UPDATE(email) ON "User" TO PUBLIC`, `REVOKE UPDATE(email) ON "User" FROM PUBLIC`);
    await unsafe("read role column update", `GRANT UPDATE("ownershipEpoch") ON "Trainer2AccountTrainingState" TO trainer2_draft_reader`, `REVOKE UPDATE("ownershipEpoch") ON "Trainer2AccountTrainingState" FROM trainer2_draft_reader`, reader, "read");
    await unsafe("runtime mapping INSERT", `GRANT INSERT ON "Trainer2AccountPrincipal" TO trainer2_draft_runtime`, `REVOKE INSERT ON "Trainer2AccountPrincipal" FROM trainer2_draft_runtime`);
    await unsafe("NOINHERIT membership still permits SET ROLE", `CREATE ROLE boundary_escalation NOLOGIN; GRANT boundary_escalation TO trainer2_draft_runtime WITH INHERIT FALSE`, `REVOKE boundary_escalation FROM trainer2_draft_runtime; DROP ROLE boundary_escalation`);
    await unsafe("table ownership", `CREATE TABLE public.boundary_owned(id int); ALTER TABLE public.boundary_owned OWNER TO trainer2_draft_runtime`, `DROP TABLE public.boundary_owned`);
    await unsafe("PUBLIC SECURITY DEFINER outside public schema", `CREATE SCHEMA boundary_test; GRANT USAGE ON SCHEMA boundary_test TO PUBLIC; CREATE FUNCTION boundary_test.escalate() RETURNS void LANGUAGE sql SECURITY DEFINER AS 'UPDATE public."User" SET email=email'`, `DROP SCHEMA boundary_test CASCADE`);
    await unsafe("schema CREATE through PUBLIC", `GRANT CREATE ON SCHEMA public TO PUBLIC`, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await unsafe("legacy owner view", `CREATE VIEW public.boundary_view AS SELECT * FROM "User"; GRANT SELECT ON public.boundary_view TO trainer2_draft_runtime`, `DROP VIEW public.boundary_view`);
    await unsafe("BYPASSRLS", `ALTER ROLE trainer2_draft_runtime BYPASSRLS`, `ALTER ROLE trainer2_draft_runtime NOBYPASSRLS`);
    await unsafe("same-name superuser", `ALTER ROLE trainer2_draft_runtime SUPERUSER`, `ALTER ROLE trainer2_draft_runtime NOSUPERUSER`);
    await unsafe("database ownership", `ALTER DATABASE ${database} OWNER TO trainer2_draft_runtime`, `ALTER DATABASE ${database} OWNER TO postgres`);
    evidence.sourceAfter = verificationSource();
    assert.equal((evidence.sourceAfter as ReturnType<typeof verificationSource>).manifestHash, source.manifestHash);
    evidence.status = "passed";
  } catch (error) { evidence.error = scrub(error instanceof Error ? error.stack ?? error.message : String(error)); throw error; }
  finally {
    for (const db of clients) await db.$disconnect();
    for (const p of pools) await p.end();
    const cleanup = spawnSync("docker", ["rm", "-f", container], { windowsHide: true, encoding: "utf8" });
    evidence.cleanup = { container, status: cleanup.status };
    writeFileSync(resolve(output, "verification.json"), JSON.stringify({ ...evidence, status: evidence.status ?? "failed", results, commands, finished: new Date().toISOString() }, null, 2));
  }
}
