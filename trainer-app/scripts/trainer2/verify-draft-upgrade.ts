import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { sanitizeDatabaseTargetEnvironment, validateDisposableDatabaseTargets } from "../../src/lib/operations/test-environment-preflight";
import { createDraft, editDraft, readDraft } from "../../src/lib/api/trainer2/planning";
import { canonicalJson, commandBinding, integrityHash } from "../../src/lib/api/trainer2/integrity";
import type { CreateDraftCommand, EditDraftCommand } from "../../src/lib/trainer2-contracts/draft";
import { constraintError, draftTables, snapshot } from "./verify-acceptance";

export const correctionMigration = "20260910020000_trainer2_acceptance_integrity";
type Command = (exe: string, args: string[], env?: NodeJS.ProcessEnv) => string;
export async function verifyDraftUpgrade(admin: Pool, ownerUrl: string, runtimeUrl: string, command: Command,
  sample: (account: string) => CreateDraftCommand) {
  const candidate = resolve("artifacts/trainer2/candidate-schema/prisma");
  mkdirSync(resolve(candidate, "migrations"), { recursive: true });
  cpSync(resolve("prisma/schema.prisma"), resolve(candidate, "schema.prisma"));
  cpSync(resolve("prisma.config.ts"), resolve(candidate, "../prisma.config.ts"));
  for (const entry of readdirSync(resolve("prisma/migrations"))) {
    if (entry !== correctionMigration) cpSync(resolve("prisma/migrations", entry), resolve(candidate, "migrations", entry), { recursive: true });
  }
  const evidence: string[] = [];
  for (const corrupt of ["none", "phantom", "counter"] as const) {
    const database = `trainer2_disposable_upgrade_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${database}"`); // Generated identifier in this harness's own disposable container.
    const ownerTarget = new URL(ownerUrl); ownerTarget.pathname = `/${database}`;
    const runtimeTarget = new URL(runtimeUrl); runtimeTarget.pathname = `/${database}`;
    const env = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: ownerTarget.href, DIRECT_URL: ownerTarget.href, TEST_DATABASE_URL: ownerTarget.href };
    assert(validateDisposableDatabaseTargets({ environment: env, confirmed: true }).valid);
    const migrate = (config: string) => command(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", "--config", config], env);
    migrate(resolve(candidate, "../prisma.config.ts"));
    const pool = new Pool({ connectionString: ownerTarget.href });
    const runtimePool = new Pool({ connectionString: runtimeTarget.href });
    const owner = new PrismaClient({ adapter: new PrismaPg(pool) });
    const runtime = new PrismaClient({ adapter: new PrismaPg(runtimePool) });
    try {
      assert.equal((await pool.query('SELECT count(*) FROM "_prisma_migrations" WHERE "migration_name"=$1', [correctionMigration])).rows[0].count, "0");
      for (const name of draftTables) {
        const table = `"Trainer2${name}"`;
        await pool.query(`GRANT SELECT ON ${table} TO trainer2_draft_runtime; CREATE POLICY trainer2_server ON ${table} TO trainer2_draft_runtime USING (true) WITH CHECK (true)`);
        if (name !== "AccountPrincipal") await pool.query(`GRANT INSERT ON ${table} TO trainer2_draft_runtime`);
      }
      await pool.query('GRANT UPDATE ON "Trainer2AccountTrainingState","Trainer2Plan" TO trainer2_draft_runtime');
      const principal = { accountId: randomUUID(), sessionId: randomUUID(), issuer: "upgrade-fixture", subject: "developer" };
      await owner.user.create({ data: { id: principal.accountId, email: `${principal.accountId}@trainer2.invalid` } });
      await owner.trainer2AccountPrincipal.create({ data: { id: randomUUID(), ...principal } });
      const create = sample(principal.accountId);
      const first = await createDraft(runtime, principal, create); assert(first.outcome.status === "Accepted");
      const edit: EditDraftCommand = { ...create, actionId: randomUUID(), commandType: "EditDraft", expected: { planRevisionId: first.outcome.result.revisionId }, intent: { operations: [{ op: "renamePlan", name: "Upgrade successor" }] } };
      const second = await editDraft(runtime, principal, edit); assert(second.outcome.status === "Accepted");
      const third = await editDraft(runtime, principal, { ...edit, actionId: randomUUID(), expected: { planRevisionId: second.outcome.result.revisionId } });
      assert(third.outcome.status === "Accepted");
      assert.equal((await editDraft(runtime, principal, { ...edit, actionId: randomUUID() })).outcome.status, "Conflict");
      const tombstone = sample(principal.accountId);
      const deleted = await createDraft(runtime, principal, tombstone); assert(deleted.outcome.status === "Accepted");
      await runtime.trainer2Plan.update({ where: { id: tombstone.target.planId }, data: { tombstonedAt: new Date() } });
      const dependent = sample(principal.accountId); dependent.dependsOn = [randomUUID()];
      assert.equal((await createDraft(runtime, principal, dependent)).outcome.status, "Rejected");
      let phantom: CreateDraftCommand | undefined;
      if (corrupt === "phantom") {
        phantom = sample(principal.accountId);
        const binding = commandBinding(phantom);
        const outcome = { status: "Accepted", actionId: phantom.actionId, commandType: "CreateDraft", acceptedSequence: "999",
          result: { planId: phantom.target.planId, revisionId: randomUUID(), revisionNumber: 1, contentHash: integrityHash(canonicalJson(phantom.intent)) } };
        await runtime.$transaction(async tx => {
          await tx.trainer2DurableAction.create({ data: { accountId: principal.accountId, actionId: phantom!.actionId, ...binding } });
          await tx.trainer2ActionOutcome.create({ data: { accountId: principal.accountId, actionId: phantom!.actionId, status: "Accepted", outcome } });
        });
        assert.deepEqual((await createDraft(runtime, principal, phantom)).outcome, outcome);
        assert.equal(await readDraft(runtime, principal, phantom.target.planId), null);
        evidence.push("Reviewed schema reproduces runtime phantom replay");
      }
      if (corrupt === "counter") {
        // Independent counter-only inconsistency: no malformed revision to mask it.
        await runtimePool.query('UPDATE "Trainer2AccountTrainingState" SET "acceptedSequence"="acceptedSequence"+1 WHERE "accountId"=$1', [principal.accountId]);
        evidence.push("Reviewed schema reproduces runtime counter-only increment");
      }
      const before = await snapshot(pool);
      if (corrupt !== "none") {
        const expected = corrupt === "phantom" ? /TRAINER2_ACCEPTANCE_REVISION/ : /TRAINER2_ACCEPTANCE_SEQUENCE/;
        // PostgreSQL reports the precise primary error. Prisma 7's migration
        // connection can mask it with 25P02 while handling an explicit BEGIN.
        const connection = await pool.connect();
        try {
          await assert.rejects(connection.query(readFileSync(resolve("prisma/migrations", correctionMigration, "migration.sql"), "utf8")),
            constraintError(corrupt === "phantom" ? "trainer2_acceptance_revision" : "trainer2_acceptance_sequence"));
        } finally { await connection.query("ROLLBACK"); connection.release(); }
        assert.deepEqual(await snapshot(pool), before);
        assert.throws(() => migrate(resolve("prisma.config.ts")), /TRAINER2_ACCEPTANCE_(REVISION|SEQUENCE)|current transaction is aborted/);
        assert.deepEqual(await snapshot(pool), before);
        assert.equal((await pool.query("SELECT to_regprocedure('trainer2_check_acceptance(text)') AS function")).rows[0].function, null);
        const ledger = await pool.query('SELECT "finished_at", "logs" FROM "_prisma_migrations" WHERE "migration_name"=$1', [correctionMigration]);
        assert.equal(ledger.rowCount, 1); assert.equal(ledger.rows[0].finished_at, null);
        if (phantom) assert.equal(await readDraft(runtime, principal, phantom.target.planId), null);
        evidence.push(`Inconsistent populated upgrade (${corrupt}): exact SQL rejects with 23514/${expected.source}; deploy fails (Prisma may surface aborted transaction); all domain records unchanged; DDL rolled back; unfinished migration ledger retained; no repair. Ledger logs: ${ledger.rows[0].logs ?? "null"}`);
      } else {
        migrate(resolve("prisma.config.ts"));
        assert.deepEqual(await snapshot(pool), before);
        assert.deepEqual((await createDraft(runtime, principal, create)).outcome, first.outcome);
        assert.deepEqual((await editDraft(runtime, principal, edit)).outcome, second.outcome);
        assert.equal((await readDraft(runtime, principal, create.target.planId))?.revisionId, third.outcome.result.revisionId);
        assert.deepEqual((await createDraft(runtime, principal, tombstone)).outcome, deleted.outcome);
        assert.equal(await readDraft(runtime, principal, tombstone.target.planId), null);
        assert.deepEqual(await snapshot(pool), before);
        const ledger = await pool.query('SELECT * FROM "_prisma_migrations" ORDER BY "migration_name"');
        migrate(resolve("prisma.config.ts"));
        assert.deepEqual((await pool.query('SELECT * FROM "_prisma_migrations" ORDER BY "migration_name"')).rows, ledger.rows);
        evidence.push("Populated candidate upgrade preserves all drafts/revisions/outcomes/conflicts/rejections/tombstones/counters byte-for-value; historical replay preserved; second deploy is already-applied ledger no-op");
      }
    } finally { await runtime.$disconnect(); await owner.$disconnect(); await runtimePool.end(); await pool.end(); }
  }
  return evidence;
}
