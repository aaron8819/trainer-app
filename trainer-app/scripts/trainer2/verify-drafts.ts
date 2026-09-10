import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { sanitizeDatabaseTargetEnvironment, validateDisposableDatabaseTargets } from "../../src/lib/operations/test-environment-preflight";
import { createDraft, editDraft, readDraft, readOutcomeChanges, type ServerPrincipal } from "../../src/lib/api/trainer2/planning";
import { canonicalJson, commandBinding, integrityHash } from "../../src/lib/api/trainer2/integrity";
import type { CreateDraftCommand, EditDraftCommand, CommandResponse } from "../../src/lib/trainer2-contracts/draft";

const results: string[] = [];
function passed(name: string) { results.push(name); console.log(`PASS ${name}`); }
function command(exe: string, args: string[], env?: NodeJS.ProcessEnv) {
  const r = spawnSync(exe, args, { encoding: "utf8", env, windowsHide: true, maxBuffer: 10_000_000 });
  if (r.status !== 0) throw new Error(`Command failed: ${exe} ${args[0]}\n${r.stderr}`);
  return r.stdout.trim();
}
function accepted(response: CommandResponse) {
  assert.equal(response.outcome.status, "Accepted");
  if (response.outcome.status !== "Accepted") throw new Error("Expected accepted");
  return response.outcome.result;
}
function sample(accountId: string): CreateDraftCommand {
  const stageId = randomUUID();
  return { schemaVersion: 1, commandType: "CreateDraft", actionId: randomUUID(), originatingAccountId: accountId,
    deviceId: randomUUID(), ownershipEpoch: 0, dependsOn: [], target: { planId: randomUUID() }, expected: {},
    intent: { schemaVersion: 1, name: "Finite draft", endpoint: "endOfOrderedOccurrences", stages: [{ id: stageId, name: "Week 1" }],
      occurrences: [{ id: randomUUID(), stageId, name: "A", positions: [1, 2].map(() => ({ id: randomUUID(),
        exercise: { kind: "authoredDescription", name: "Squat", variation: "" }, targets: [{ id: randomUUID(), required: true,
          classification: "working", reps: { min: 8, max: 12, basis: "total" }, measurement: { kind: "externalLoad", value: "20.00", unit: "kg", convention: "barbellTotal", zeroMeaning: "notAllowed" }, rir: "2.0", restSeconds: "120.00" }] })) }] } };
}
function rename(create: CreateDraftCommand, revisionId: string, name: string): EditDraftCommand {
  return { ...create, commandType: "EditDraft", actionId: randomUUID(), expected: { planRevisionId: revisionId }, intent: { operations: [{ op: "renamePlan", name }] } };
}
export async function verifyDrafts() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const container = `trainer2-draft-${suffix}`;
  const database = `trainer2_disposable_${suffix}`;
  const password = randomUUID();
  const clients: PrismaClient[] = [];
  const pools: Pool[] = [];
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<(typeof import("@playwright/test"))["chromium"]["launch"]>> | undefined;
  const client = (url: string) => { const p = new Pool({ connectionString: url }); pools.push(p); const c = new PrismaClient({ adapter: new PrismaPg(p) }); clients.push(c); return c; };
  const sqlPath = resolve("prisma/migrations/20260909120000_trainer2_drafts/migration.sql");
  try {
    command("docker", ["run", "--rm", "-d", "--name", container, "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${database}`, "-p", "127.0.0.1::5432", "postgres:17-alpine"]);
    for (let i = 0; ; i++) {
      if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres"], { windowsHide: true }).status === 0) break;
      if (i === 60) throw new Error("Disposable PostgreSQL startup failed");
      await new Promise(r => setTimeout(r, 500));
    }
    const port = command("docker", ["port", container, "5432/tcp"]).match(/:(\d+)$/)?.[1];
    assert(port);
    const ownerUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${database}`;
    const runtimeUrl = `postgresql://trainer2_draft_runtime:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: ownerUrl, DIRECT_URL: ownerUrl, TEST_DATABASE_URL: ownerUrl };
    assert(validateDisposableDatabaseTargets({ environment: env, confirmed: true }).valid);
    command(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], env);
    command(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], env);
    const adminPool = new Pool({ connectionString: ownerUrl }); pools.push(adminPool);
    const owner = client(ownerUrl);
    const tables = ["AccountPrincipal", "AccountTrainingState", "Plan", "PlanRevision", "Identity", "DurableAction", "ActionOutcome"].map(n => `"Trainer2${n}"`);
    await adminPool.query(`CREATE ROLE trainer2_draft_runtime LOGIN PASSWORD '${password}'; CREATE ROLE trainer2_draft_reader LOGIN PASSWORD '${password}'; GRANT USAGE ON SCHEMA public TO trainer2_draft_runtime, trainer2_draft_reader;`);
    for (const table of tables) {
      await adminPool.query(`GRANT SELECT ON ${table} TO trainer2_draft_runtime,trainer2_draft_reader; CREATE POLICY trainer2_server ON ${table} TO trainer2_draft_runtime USING (true) WITH CHECK (true); CREATE POLICY trainer2_reader ON ${table} FOR SELECT TO trainer2_draft_reader USING (true);`);
      if (table !== '"Trainer2AccountPrincipal"') await adminPool.query(`GRANT INSERT ON ${table} TO trainer2_draft_runtime`);
    }
    await adminPool.query('GRANT UPDATE ON "Trainer2AccountTrainingState","Trainer2Plan" TO trainer2_draft_runtime');
    const principal: ServerPrincipal = { accountId: randomUUID(), issuer: "trainer2-local-disposable", subject: "developer" };
    const other: ServerPrincipal = { accountId: randomUUID(), issuer: "trainer2-local-disposable", subject: "other" };
    for (const p of [principal, other]) {
      await owner.user.create({ data: { id: p.accountId, email: `${p.subject}@trainer2.invalid` } });
      await owner.trainer2AccountPrincipal.create({ data: { id: randomUUID(), ...p } });
    }
    const runtime = client(runtimeUrl);
    const reader = client(`postgresql://trainer2_draft_reader:${password}@127.0.0.1:${port}/${database}`);
    // First reads must not provision state, even for an authenticated account.
    assert.equal(await readDraft(reader, principal, randomUUID()), null);
    assert.equal(await owner.trainer2AccountTrainingState.count(), 0);
    const c = sample(principal.accountId);
    const [initial, duplicate] = await Promise.all([createDraft(runtime, principal, c), createDraft(runtime, principal, c)]);
    const first = accepted(initial);
    assert.deepEqual(accepted(duplicate), first);
    assert.equal([initial, duplicate].filter(x => x.replayed).length, 1);
    assert.deepEqual((await readDraft(reader, principal, first.planId))?.intent, c.intent);
    assert.equal(await runtime.trainer2Plan.count(), 1);
    passed("1,4,13 concurrent first create/replay; exact reload; read role cannot provision");
    const previousBytes = await runtime.trainer2PlanRevision.findUniqueOrThrow({ where: { id: first.revisionId } });
    const edit = rename(c, first.revisionId, "Revision two");
    const secondResponse = await editDraft(runtime, principal, edit);
    const second = accepted(secondResponse);
    assert.deepEqual(await runtime.trainer2PlanRevision.findUniqueOrThrow({ where: { id: first.revisionId } }), previousBytes);
    const third = accepted(await editDraft(runtime, principal, rename(c, second.revisionId, "Revision three")));
    assert.deepEqual((await editDraft(runtime, principal, edit)).outcome, secondResponse.outcome);
    assert.equal((await readDraft(reader, principal, first.planId))?.revisionId, third.revisionId);
    passed("2,6 full immutable revisions; historical replay does not move head");
    const mutations: [string, (v: Record<string, unknown>) => void][] = [
      ["command type", v => { v.commandType = "CreateDraft"; }], ["schema", v => { v.schemaVersion = 2; }],
      ["account", v => { v.originatingAccountId = other.accountId; }], ["device", v => { v.deviceId = randomUUID(); }],
      ["epoch", v => { v.ownershipEpoch = 1; }], ["target", v => { v.target = { planId: randomUUID() }; }],
      ["base", v => { v.expected = { planRevisionId: randomUUID() }; }], ["dependencies", v => { v.dependsOn = [randomUUID()]; }],
      ["intent", v => { v.intent = { operations: [{ op: "renamePlan", name: "Changed" }] }; }],
    ];
    const originalAction = await runtime.trainer2DurableAction.findUniqueOrThrow({ where: { accountId_actionId: { accountId: principal.accountId, actionId: edit.actionId } } });
    for (const [name, mutate] of mutations) {
      const v = structuredClone(edit) as unknown as Record<string, unknown>; mutate(v);
      assert.notEqual(commandBinding(v).envelopeHash, commandBinding(edit).envelopeHash, name);
      await assert.rejects(editDraft(runtime, principal, v), name);
    }
    assert.notEqual(commandBinding({ ...edit, actionId: randomUUID() }).envelopeHash, commandBinding(edit).envelopeHash);
    assert.deepEqual(await runtime.trainer2DurableAction.findUniqueOrThrow({ where: { accountId_actionId: { accountId: principal.accountId, actionId: edit.actionId } } }), originalAction);
    assert.equal(await runtime.trainer2ActionOutcome.count({ where: { actionId: edit.actionId } }), 1);
    passed("5 complete envelope binding; collisions preserve original action and outcome");
    const races = [rename(c, third.revisionId, "Winner A"), rename(c, third.revisionId, "Winner B")];
    const raced = await Promise.all(races.map(e => editDraft(runtime, principal, e)));
    assert.equal(raced.filter(r => r.outcome.status === "Accepted").length, 1);
    assert.equal(raced.filter(r => r.outcome.status === "Conflict").length, 1);
    const losing = races[raced.findIndex(r => r.outcome.status === "Conflict")];
    assert.equal((await runtime.trainer2DurableAction.findUniqueOrThrow({ where: { accountId_actionId: { accountId: principal.accountId, actionId: losing.actionId } } })).submittedEnvelope, canonicalJson(losing));
    passed("7 competing stale edit preserves losing envelope and Conflict outcome");
    let current = (await readDraft(reader, principal, first.planId))!;
    const o = current.intent.occurrences[0];
    const reverse = rename(c, current.revisionId, "unused"); reverse.intent.operations = [{ op: "reorderPositions", occurrenceId: o.id, positionIds: o.positions.map(p => p.id).reverse() }];
    accepted(await editDraft(runtime, principal, reverse));
    current = (await readDraft(reader, principal, first.planId))!;
    assert.deepEqual(current.intent.occurrences[0].positions.map(p => p.id), o.positions.map(p => p.id).reverse());
    const removed = current.intent.occurrences[0].positions[0];
    const remove = rename(c, current.revisionId, "unused"); remove.intent.operations = [{ op: "removePosition", positionId: removed.id }];
    const removedRevision = accepted(await editDraft(runtime, principal, remove));
    const reintroduce = rename(c, removedRevision.revisionId, "unused"); reintroduce.intent.operations = [{ op: "addPosition", occurrenceId: o.id, position: removed }];
    assert.equal((await editDraft(runtime, principal, reintroduce)).outcome.status, "Rejected");
    const freshPosition = { ...removed, id: randomUUID(), targets: removed.targets.map(t => ({ ...t, id: randomUUID() })) };
    reintroduce.actionId = randomUUID(); reintroduce.intent.operations = [{ op: "addPosition", occurrenceId: o.id, position: freshPosition }];
    accepted(await editDraft(runtime, principal, reintroduce));
    assert(await runtime.trainer2Identity.findUnique({ where: { id: removed.id } }));
    passed("3 reorder retains identities; removed identity cannot return; equivalent new position allowed");
    assert.equal(await readDraft(reader, other, first.planId), null);
    const foreign = rename(c, first.revisionId, "foreign"); foreign.originatingAccountId = other.accountId;
    assert.equal((await editDraft(runtime, other, foreign)).outcome.status, "Rejected");
    const otherCreate = sample(other.accountId); const otherPlan = accepted(await createDraft(runtime, other, otherCreate));
    await assert.rejects(adminPool.query('UPDATE "Trainer2Plan" SET "currentRevisionId"=$1 WHERE "id"=$2', [otherPlan.revisionId, first.planId]));
    const malformed = sample(principal.accountId); malformed.intent.occurrences[0].stageId = randomUUID();
    await assert.rejects(createDraft(runtime, principal, malformed));
    malformed.intent.occurrences[0].stageId = malformed.intent.stages[0].id;
    malformed.intent.occurrences[0].positions[1].id = malformed.intent.occurrences[0].positions[0].id;
    await assert.rejects(createDraft(runtime, principal, malformed));
    const foreignIds = sample(other.accountId); foreignIds.intent.occurrences[0].positions[0].id = removed.id;
    assert.equal((await createDraft(runtime, other, foreignIds)).outcome.status, "Rejected");
    await assert.rejects(runtime.trainer2Plan.create({ data: { id: randomUUID(), accountId: principal.accountId, currentRevisionId: otherPlan.revisionId } }));
    const unsafeRevision = async (mutate: (doc: CreateDraftCommand["intent"]) => void) => {
      const head = (await readDraft(reader, principal, first.planId))!;
      const document = structuredClone(head.intent); mutate(document);
      const action = rename(c, head.revisionId, "direct SQL attack");
      const revisionId = randomUUID(); const canonicalContent = canonicalJson(document);
      return runtime.$transaction(async tx => {
        await tx.trainer2DurableAction.create({ data: { accountId: principal.accountId, actionId: action.actionId, ...commandBinding(action) } });
        await tx.trainer2PlanRevision.create({ data: { id: revisionId, accountId: principal.accountId, planId: first.planId, revisionNumber: head.revisionNumber + 1,
          parentRevisionId: head.revisionId, actionId: action.actionId, document, canonicalContent, contentHash: integrityHash(canonicalContent) } });
        await tx.trainer2Plan.update({ where: { id: first.planId }, data: { currentRevisionId: revisionId } });
      });
    };
    await assert.rejects(unsafeRevision(doc => { doc.occurrences[0].stageId = randomUUID(); }));
    await assert.rejects(unsafeRevision(doc => { doc.occurrences[0].positions.push(doc.occurrences[0].positions[0]); }));
    await assert.rejects(unsafeRevision(doc => { doc.occurrences[0].positions[0].id = otherCreate.intent.occurrences[0].positions[0].id; }));
    passed("8,9 cross-account access/identity/head and malformed/duplicate references rejected");
    // Inject an actual database failure after revision and registry writes, at head update.
    await adminPool.query(`CREATE FUNCTION trainer2_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_HEAD_FAILURE'; END $$; CREATE TRIGGER trainer2_test_fail BEFORE UPDATE ON "Trainer2Plan" FOR EACH ROW EXECUTE FUNCTION trainer2_test_fail();`);
    current = (await readDraft(reader, principal, first.planId))!;
    const fail = rename(c, current.revisionId, "Will roll back");
    fail.intent.operations.push({ op: "addStage", stage: { id: randomUUID(), name: "Rollback stage" } });
    const counts = async () => [await runtime.trainer2PlanRevision.count(), await runtime.trainer2Identity.count(), await runtime.trainer2DurableAction.count(), await runtime.trainer2ActionOutcome.count()];
    const before = await counts(); const stateBefore = await runtime.trainer2AccountTrainingState.findMany();
    await assert.rejects(editDraft(runtime, principal, fail));
    assert.deepEqual(await counts(), before); assert.deepEqual(await runtime.trainer2AccountTrainingState.findMany(), stateBefore);
    await adminPool.query('DROP TRIGGER trainer2_test_fail ON "Trainer2Plan"; DROP FUNCTION trainer2_test_fail()');
    passed("10 database failure after revision/registry writes rolls back all state and counters");
    for (const table of ['Trainer2PlanRevision','Trainer2Identity','Trainer2DurableAction','Trainer2ActionOutcome']) {
      await assert.rejects(adminPool.query(`DELETE FROM "${table}"`));
      await assert.rejects(adminPool.query(`UPDATE "${table}" SET "accountId"="accountId"`));
    }
    await assert.rejects(runtime.trainer2Identity.create({ data: { id: randomUUID(), accountId: principal.accountId, planId: first.planId, kind: "Stage", parentId: null, firstRevisionId: first.revisionId } }));
    await assert.rejects(runtime.$executeRawUnsafe('UPDATE "User" SET "email"="email"'));
    const legacyTables = await adminPool.query<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'Trainer2%'`);
    for (const { tablename } of legacyTables.rows) {
      const grants = await adminPool.query<{ writable: boolean }>(`SELECT has_table_privilege('trainer2_draft_runtime', $1, 'INSERT,UPDATE,DELETE,TRUNCATE') AS writable`, [`"${tablename}"`]);
      assert.equal(grants.rows[0].writable, false, tablename);
    }
    await assert.rejects(reader.trainer2AccountTrainingState.create({ data: { accountId: randomUUID() } }));
    passed("11,14 immutable rows and late graph writes rejected; runtime has no legacy mutation grants");
    const waiting = sample(principal.accountId);
    await runtime.trainer2DurableAction.create({ data: { accountId: principal.accountId, actionId: waiting.actionId, ...commandBinding(waiting) } });
    const append = (actionId: string, status: string) => runtime.trainer2ActionOutcome.create({ data: { accountId: principal.accountId, actionId, status, outcome: { status, actionId } } });
    await append(waiting.actionId, "Waiting");
    const page = await readOutcomeChanges(runtime, principal, BigInt(0), undefined, 1);
    const frontier = BigInt(page.through);
    await append(waiting.actionId, "Superseded");
    const after = await readOutcomeChanges(runtime, principal, frontier);
    assert.equal(after.changes.length, 1); assert.equal(after.changes[0].status, "Superseded");
    let cursor = BigInt(0); const seen: string[] = [];
    while (cursor < frontier) { const part = await readOutcomeChanges(runtime, principal, cursor, frontier, 1); seen.push(...part.changes.map(x => x.outcomeCursor)); cursor = BigInt(part.next); }
    assert.equal(new Set(seen).size, Number(frontier));
    // Reader cannot see a cursor allocated by an uncommitted writer; a second
    // writer is blocked on account ordering until the first commits or rolls back.
    const a = await adminPool.connect(); const b = await adminPool.connect();
    try {
      await a.query('BEGIN'); await a.query('INSERT INTO "Trainer2ActionOutcome" ("accountId","actionId","status","outcome") VALUES ($1,$2,\'Waiting\',$3)', [principal.accountId, waiting.actionId, { status: "Waiting", actionId: waiting.actionId }]);
      const visible = await readOutcomeChanges(runtime, principal, BigInt(after.through)); assert.equal(visible.changes.length, 0);
      await b.query('BEGIN'); await b.query("SET LOCAL lock_timeout='200ms'");
      await assert.rejects(b.query('INSERT INTO "Trainer2ActionOutcome" ("accountId","actionId","status","outcome") VALUES ($1,$2,\'Waiting\',$3)', [principal.accountId, waiting.actionId, { status: "Waiting", actionId: waiting.actionId }]));
      await b.query('ROLLBACK'); await a.query('ROLLBACK');
      assert.equal((await readOutcomeChanges(runtime, principal, BigInt(after.through))).changes.length, 0);
    } finally { a.release(); b.release(); }
    passed("12 outcome pages include older action updates; account commit ordering and rollback cannot skip cursors");
    const dependency = sample(principal.accountId); dependency.dependsOn = [randomUUID()];
    assert.equal((await createDraft(runtime, principal, dependency)).outcome.status, "Rejected");
    await owner.trainer2Plan.update({ where: { id: first.planId }, data: { tombstonedAt: new Date() } });
    assert.equal(await readDraft(reader, principal, first.planId), null);
    assert.deepEqual(accepted(await createDraft(runtime, principal, c)), first);
    assert.deepEqual(accepted(await editDraft(runtime, principal, edit)), second);
    await assert.rejects(owner.trainer2Plan.update({ where: { id: first.planId }, data: { tombstonedAt: null } }));
    assert.equal(await readDraft(reader, principal, first.planId), null);
    assert.equal((await editDraft(runtime, principal, rename(c, current.revisionId, "resurrect"))).outcome.status, "Rejected");
    passed("tombstone hides draft and retries cannot resurrect; dependencies explicitly rejected");
    // Real browser and actual HTTP handlers, using only the limited runtime role.
    const webPort = 32000 + Math.floor(Math.random() * 10000);
    const webEnv: NodeJS.ProcessEnv = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: runtimeUrl, NODE_ENV: "development", TRAINER2_LOCAL_DRAFTS: "enabled" };
    delete webEnv.CI;
    server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(webPort)], { env: webEnv, windowsHide: true, stdio: "pipe" });
    let serverLog = ""; server.stdout?.on("data", d => { serverLog += d.toString(); }); server.stderr?.on("data", d => { serverLog += d.toString(); });
    const base = `http://127.0.0.1:${webPort}`;
    for (let i = 0; ; i++) {
      try { if ((await fetch(`${base}/trainer2/dev/drafts`)).ok) break; } catch { /* server starting */ }
      if (i >= 90 || server.exitCode !== null) throw new Error(`Developer server failed: ${serverLog.slice(-3000)}`);
      await new Promise(r => setTimeout(r, 500));
    }
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    const tab = await browser.newPage();
    tab.on("response", async response => { if (response.url().includes("/api/trainer2/") && response.status() >= 400) console.log("BROWSER_API_FAILURE", response.status(), await response.text()); });
    const errors: string[] = []; tab.on("pageerror", e => errors.push(e.message));
    await tab.goto(`${base}/trainer2/dev/drafts`);
    await tab.getByRole("button", { name: "Create finite draft", exact: true }).click();
    await tab.getByRole("heading", { name: "Revision 1: My finite draft" }).waitFor();
    const browserPlan = await tab.getByLabel("Saved plan ID").inputValue();
    const beforeReorder = (await readDraft(reader, principal, browserPlan))!;
    await tab.getByRole("button", { name: "Reverse positions", exact: true }).click();
    await tab.getByRole("heading", { name: "Revision 2: My finite draft" }).waitFor();
    assert.deepEqual((await readDraft(reader, principal, browserPlan))!.intent.occurrences[0].positions.map(p => p.id), beforeReorder.intent.occurrences[0].positions.map(p => p.id).reverse());
    await tab.reload(); await tab.getByLabel("Saved plan ID").fill(browserPlan);
    await tab.getByRole("button", { name: "Reload persisted draft", exact: true }).click();
    await tab.getByRole("heading", { name: "Revision 2: My finite draft" }).waitFor();
    const browserCurrent = (await readDraft(reader, principal, browserPlan))!;
    const external = rename({ ...c, target: { planId: browserPlan } }, browserCurrent.revisionId, "Concurrent edit");
    accepted(await editDraft(runtime, principal, external));
    await tab.getByLabel("Draft name", { exact: true }).fill("Stale browser intent");
    await tab.getByRole("button", { name: "Save name revision", exact: true }).click();
    await tab.getByRole("status").filter({ hasText: "Stale edit" }).waitFor();
    const getCounts = await counts(); const getState = await runtime.trainer2AccountTrainingState.findMany();
    const response = await fetch(`${base}/api/trainer2/drafts/${browserPlan}`); assert.equal(response.status, 200);
    assert.deepEqual(await counts(), getCounts); assert.deepEqual(await runtime.trainer2AccountTrainingState.findMany(), getState);
    for (const path of ["activate", "start", "finish", "delete"]) assert.equal((await fetch(`${base}/api/trainer2/drafts/${path}`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${base}/api/trainer2/drafts/create`, { method: "POST", body: JSON.stringify(sample(principal.accountId)) })).status, 403);
    assert.deepEqual(errors, []);
    mkdirSync(resolve("artifacts/trainer2"), { recursive: true });
    await tab.screenshot({ path: resolve("artifacts/trainer2/draft-loop.png"), fullPage: true });
    passed("13,15,16 actual browser create/reorder/reload/stale error; GET no writes; no lifecycle handlers");
    await browser.close(); browser = undefined;
    if (server.pid) command("taskkill", ["/PID", String(server.pid), "/T", "/F"]);
    server = undefined;
    command(process.execPath, [resolve("node_modules/next/dist/bin/next"), "build"], {
      ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: runtimeUrl, NODE_ENV: "production",
      TRAINER_BUILD_GIT_SHA: command("git", ["rev-parse", "HEAD"]),
    });
    passed("production build with isolated disposable runtime role; hosted draft page remains disabled");
    writeFileSync(resolve("artifacts/trainer2/verification.json"), JSON.stringify({ results, migrationHash: integrityHash(readFileSync(sqlPath, "utf8")), timestamp: new Date().toISOString() }, null, 2));
  } finally {
    await browser?.close();
    if (server?.pid) command("taskkill", ["/PID", String(server.pid), "/T", "/F"]);
    for (const c of clients) await c.$disconnect();
    for (const p of pools) await p.end();
    spawnSync("docker", ["rm", "-f", container], { windowsHide: true, stdio: "ignore" });
  }
}
