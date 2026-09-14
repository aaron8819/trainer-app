import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { sanitizeDatabaseTargetEnvironment, validateDisposableDatabaseTargets } from '../../src/lib/operations/test-environment-preflight';
import { readDraft } from '../../src/lib/api/trainer2/planning';
import { startOccurrence, readExecution } from '../../src/lib/api/trainer2/execution';
type Command = (exe: string, args: string[], env?: NodeJS.ProcessEnv) => string;
export async function verifyWorkoutStartUpgrade(admin: Pool, ownerUrl: string, sourceRuntimeUrl: string, command: Command, accountId: string) {
  const candidate = resolve('artifacts/trainer2/workout-start-base/prisma'); mkdirSync(resolve(candidate, 'migrations'), { recursive: true });
  cpSync(resolve('prisma/schema.prisma'), resolve(candidate, 'schema.prisma')); cpSync(resolve('prisma.config.ts'), resolve(candidate, '../prisma.config.ts'));
  for (const entry of readdirSync(resolve('prisma/migrations'))) if (entry !== '20260914010000_trainer2_workout_start')
    cpSync(resolve('prisma/migrations', entry), resolve(candidate, 'migrations', entry), { recursive: true });
  const database = `trainer2_disposable_start_upgrade_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const target = new URL(ownerUrl); target.pathname = `/${database}`;
  const env = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: target.href, DIRECT_URL: target.href, TEST_DATABASE_URL: target.href };
  assert(validateDisposableDatabaseTargets({ environment: env, confirmed: true }).valid);
  const migrate = (config: string) => command(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', config], env);
  migrate(resolve(candidate, '../prisma.config.ts'));
  const pool = new Pool({ connectionString: target.href });
  const tables = ['User', 'Trainer2AccountPrincipal', 'Trainer2AccountTrainingState', 'Trainer2DurableAction', 'Trainer2Plan', 'Trainer2PlanRevision', 'Trainer2Identity', 'Trainer2InstructionRevision', 'Trainer2PlanDecision', 'Trainer2ActionOutcome'];
  let runtime: PrismaClient | undefined, runtimePool: Pool | undefined;
  try {
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.row)])));
    await pool.query('BEGIN');
    // Activation guard must see the original Draft insertion; approved state is restored in the same acceptance transaction.
    for (const table of tables) {
      const rows = (await admin.query(`SELECT to_jsonb(t) AS row FROM "${table}" t WHERE "${table === 'User' ? 'id' : 'accountId'}"=$1 ORDER BY to_jsonb(t)::text`, [accountId])).rows.map(r => r.row);
      if (table === 'Trainer2AccountTrainingState') rows.forEach(r => { r.outcomeSequence = 0; });
      if (table === 'Trainer2Plan') rows.forEach(r => { r.lifecycle = 'Draft'; r.initialApprovedRevisionId = null; });
      if (table === 'Trainer2PlanRevision') { const tx = (await pool.query('SELECT txid_current()::text AS id')).rows[0].id; rows.forEach(r => { r.createdTx = tx; }); }
      if (table === 'Trainer2ActionOutcome') rows.sort((a, b) => Number(a.outcomeCursor) - Number(b.outcomeCursor));
      for (const row of rows) await pool.query(`INSERT INTO "${table}" SELECT * FROM jsonb_populate_record(NULL::"${table}", $1::jsonb)`, [JSON.stringify(row)]);
    }
    await pool.query(`UPDATE "Trainer2Plan" SET "lifecycle"='Active', "initialApprovedRevisionId"="currentRevisionId" WHERE "accountId"=$1`, [accountId]);
    await pool.query('COMMIT'); const before = await snapshot();
    migrate(resolve('prisma.config.ts')); const migrationCount = (await pool.query('SELECT count(*) FROM "_prisma_migrations"')).rows[0].count;
    migrate(resolve('prisma.config.ts')); assert.equal((await pool.query('SELECT count(*) FROM "_prisma_migrations"')).rows[0].count, migrationCount);
    assert.deepEqual(await snapshot(), before); assert.equal((await pool.query('SELECT count(*) FROM "Trainer2Execution"')).rows[0].count, '0');
    await pool.query(readFileSync(resolve('prisma/trainer2-runtime-grants.sql'), 'utf8').split('\n').filter(l => !l.startsWith('CREATE ROLE ')).join('\n'));
    const runtimeUrl = new URL(sourceRuntimeUrl); runtimeUrl.pathname = target.pathname;
    runtimePool = new Pool({ connectionString: runtimeUrl.href, max: 1 });
    runtime = new PrismaClient({ adapter: new PrismaPg(runtimePool) });
    const principal = (await pool.query('SELECT "accountId", issuer, subject FROM "Trainer2AccountPrincipal" WHERE "accountId"=$1', [accountId])).rows[0];
    const planId = before.Trainer2Plan[0].id;
    const h = (await readDraft(runtime, principal, planId))!;
    assert.equal(h.state.lifecycle, 'Active');
    const result = await startOccurrence(runtime, principal, { schemaVersion: 1, commandType: 'StartOccurrence', actionId: randomUUID(),
      deviceId: randomUUID(), originatingAccountId: accountId, ownershipEpoch: 0, dependsOn: [], target: { planId, occurrenceId: h.intent.occurrences[0].id },
      expected: { planRevisionId: h.revisionId, instructionEpoch: h.activation.instructions.epoch }, intent: {} });
    assert.equal(result.outcome.status, 'Accepted'); if (result.outcome.status !== 'Accepted') throw new Error('Upgrade start failed');
    assert.deepEqual((await readExecution(runtime, principal, result.outcome.result.executionId))!.initial.occurrence, h.intent.occurrences[0]);
    return { status: 'passed', base: '010836c5a12f5e85a36b53c00b408ffeb5cbdee9', preservedTables: tables.length, activatedPlanStartable: true, repeatedDeploy: 'no-op' };
  } finally { await runtime?.$disconnect(); await runtimePool?.end(); await pool.end(); }
}
