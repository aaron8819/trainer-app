import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { provisionSingleUser } from "./provision-single-user";
import { assertConnectionPrivileges } from "../../src/lib/api/trainer2/database";
import { authorizeAccount } from "../../src/lib/api/trainer2/principal";
import { createDraft, readDraft } from "../../src/lib/api/trainer2/planning";
import { enterPasscode, revokeSession, sessionForRequest, SESSION_COOKIE } from "../../src/lib/api/trainer2/sessions";
import { sanitizeDatabaseTargetEnvironment } from "../../src/lib/operations/test-environment-preflight";

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
    const env = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: url("postgres"), DIRECT_URL: url("postgres") };
    run(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], env);
    const admin = db(url("postgres"));
    await pools[0].query(`BEGIN; ${readFileSync(resolve("prisma/trainer2-runtime-grants.sql"), "utf8")} COMMIT;`);
    for (const role of ["trainer2_identity_runtime", "trainer2_draft_reader", "trainer2_draft_runtime"])
      await pools[0].query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
    const identity = db(url("trainer2_identity_runtime"));
    const reader = db(url("trainer2_draft_reader"));
    const writer = db(url("trainer2_draft_runtime"));
    for (const [pool, purpose] of [[pools[1], "identity"], [pools[2], "read"], [pools[3], "write"]] as const) {
      const connection = await pool.connect();
      try { await assertConnectionPrivileges(connection, purpose); } finally { connection.release(); }
    }
    const accountId = randomUUID();
    process.env.TRAINER2_OWNER_USER_ID = accountId;
    await admin.user.create({ data: { id: accountId, email: `${suffix}@synthetic.invalid` } });
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
