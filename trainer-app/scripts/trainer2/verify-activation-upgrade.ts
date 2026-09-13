import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { sanitizeDatabaseTargetEnvironment, validateDisposableDatabaseTargets } from '../../src/lib/operations/test-environment-preflight';

type Command = (exe: string, args: string[], env?: NodeJS.ProcessEnv) => string;
export async function verifyActivationUpgrade(admin: Pool, ownerUrl: string, command: Command, accountId: string) {
  const candidate = resolve('artifacts/trainer2/activation-base/prisma'); mkdirSync(resolve(candidate, 'migrations'), { recursive: true });
  cpSync(resolve('prisma/schema.prisma'), resolve(candidate, 'schema.prisma'));
  cpSync(resolve('prisma.config.ts'), resolve(candidate, '../prisma.config.ts'));
  for (const entry of readdirSync(resolve('prisma/migrations'))) if (entry !== '20260913120000_trainer2_activation') cpSync(resolve('prisma/migrations', entry), resolve(candidate, 'migrations', entry), { recursive: true });
  const database = `trainer2_disposable_activation_upgrade_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const target = new URL(ownerUrl); target.pathname = `/${database}`;
  const env = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: target.href, DIRECT_URL: target.href, TEST_DATABASE_URL: target.href };
  assert(validateDisposableDatabaseTargets({ environment: env, confirmed: true }).valid);
  const migrate = (config: string) => command(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', config], env);
  migrate(resolve(candidate, '../prisma.config.ts'));
  const pool = new Pool({ connectionString: target.href });
  const tables = ['User', 'Trainer2AccountPrincipal', 'Trainer2AccountTrainingState', 'Trainer2DurableAction', 'Trainer2Plan', 'Trainer2PlanRevision', 'Trainer2Identity', 'Trainer2ActionOutcome'];
  try {
    assert.equal((await pool.query(`SELECT count(*) FROM information_schema.columns WHERE table_name='Trainer2Plan' AND column_name='lifecycle'`)).rows[0].count, '0');
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`)).rows.map(r => r.row)])));
    await pool.query('BEGIN');
    for (const table of tables) {
      const rows = (await admin.query(`SELECT to_jsonb(t) AS row FROM "${table}" t WHERE "${table === 'User' ? 'id' : 'accountId'}"=$1 ORDER BY to_jsonb(t)::text`, [accountId])).rows.map(r => r.row);
      if (table === 'Trainer2AccountTrainingState') rows.forEach(r => { r.outcomeSequence = 0; });
      if (table === 'Trainer2PlanRevision') { const tx = (await pool.query('SELECT txid_current()::text AS id')).rows[0].id; rows.forEach(r => { r.createdTx = tx; }); }
      if (table === 'Trainer2ActionOutcome') rows.sort((a, b) => Number(a.outcomeCursor) - Number(b.outcomeCursor));
      for (const row of rows) await pool.query(`INSERT INTO "${table}" SELECT * FROM jsonb_populate_record(NULL::"${table}", $1::jsonb)`, [JSON.stringify(row)]);
    }
    await pool.query('COMMIT');
    const before = await snapshot();
    migrate(resolve('prisma.config.ts'));
    migrate(resolve('prisma.config.ts'));
    const after = await snapshot();
    for (const p of after.Trainer2Plan) { assert.equal(p.lifecycle, 'Draft'); assert.equal(p.initialApprovedRevisionId, null); delete p.lifecycle; delete p.initialApprovedRevisionId; }
    for (const s of after.Trainer2AccountTrainingState) { assert.equal(s.instructionEpoch, 0); delete s.instructionEpoch; }
    assert.deepEqual(after, before);
    assert.equal((await pool.query('SELECT count(*) FROM "Trainer2PlanDecision"')).rows[0].count, '0');
    assert.equal((await pool.query('SELECT count(*) FROM "Trainer2InstructionRevision"')).rows[0].count, '0');
    const grants = readFileSync(resolve('prisma/trainer2-runtime-grants.sql'), 'utf8');
    // Roles already exist in this disposable cluster. Apply their database grants/policies.
    await pool.query(grants.split('\n').filter(line => !line.startsWith('CREATE ROLE ')).join('\n'));
    // Effective grants, independent of the application privilege helper.
    for (const table of ['Trainer2PlanDecision', 'Trainer2InstructionRevision']) {
      const rights = (await pool.query('SELECT has_table_privilege($1,$2,\'SELECT\') AS read, has_table_privilege($1,$2,\'INSERT,UPDATE,DELETE\') AS write', ['trainer2_draft_reader', `"${table}"`])).rows[0];
      assert.equal(rights.read, true); assert.equal(rights.write, false);
      const write = (await pool.query('SELECT has_table_privilege($1,$2,\'INSERT\') AS insert, has_table_privilege($1,$2,\'UPDATE,DELETE\') AS mutate', ['trainer2_draft_runtime', `"${table}"`])).rows[0];
      assert.equal(write.insert, true); assert.equal(write.mutate, false);
    }
    return { status: 'passed', base: '5865cb9dec901d55a9c0afdad1ea397dd1b7347e', tables: tables.length, preserved: true, repeatedDeploy: 'no-op', grants: 'restricted append/read only' };
  } finally { await pool.end(); }
}
