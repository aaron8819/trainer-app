import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { sanitizeDatabaseTargetEnvironment, validateDisposableDatabaseTargets } from '../../src/lib/operations/test-environment-preflight';
import { verificationSource } from '../../scripts/trainer2/verification-source';

async function main() {
  const [sourceContainer, targetContainer, confirmation] = process.argv.slice(2);
  assert(confirmation === '--confirm-synthetic-trial');
  assert(sourceContainer !== targetContainer);
  const inspect = (name: string) => {
    assert(/^trainer2-draft-[a-f0-9]+$/.test(name));
    const m = JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8', windowsHide: true }))[0];
    const port = m.NetworkSettings.Ports['5432/tcp'][0]; assert.equal(port.HostIp, '127.0.0.1');
    const env = Object.fromEntries(m.Config.Env.map((v: string) => [v.slice(0, v.indexOf('=')), v.slice(v.indexOf('=') + 1)]));
    assert(/^trainer2_disposable_/.test(env.POSTGRES_DB));
    return { port: Number(port.HostPort), env };
  };
  const original = inspect(sourceContainer), target = inspect(targetContainer);
  const admin = new Pool({ host: '127.0.0.1', port: target.port, user: 'postgres', password: target.env.POSTGRES_PASSWORD, database: target.env.POSTGRES_DB });
  const database = 'trainer2_disposable_alignment_upgrade_' + randomUUID().replaceAll('-', '');
  const dir = 'artifacts/trainer2/alignment-evidence/'; mkdirSync(dir, { recursive: true });
  let pool: Pool | undefined;
  try {
    // Read-only copy of the existing synthetic demo. Never migrate or restart its source.
    const dump = execFileSync('docker', ['exec', sourceContainer, 'pg_dump', '-U', 'postgres', '-d', original.env.POSTGRES_DB, '--no-owner', '--no-privileges'], { encoding: 'utf8', windowsHide: true, maxBuffer: 50_000_000 });
    await admin.query(`CREATE DATABASE "${database}"`);
    execFileSync('docker', ['exec', '-i', targetContainer, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: dump, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 50_000_000 });
    pool = new Pool({ host: '127.0.0.1', port: target.port, user: 'postgres', password: target.env.POSTGRES_PASSWORD, database });
    const migrations = (await pool.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows.map(r => r.migration_name);
    assert.equal(migrations.at(-1), '20260916010000_trainer2_optional_correction_reason');
    const tables: string[] = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'Trainer2%' OR tablename='User') ORDER BY tablename")).rows.map(r => r.tablename);
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await pool!.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(t)::text, '' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${t}" t`)).rows[0]])));
    const before = await snapshot(); assert(before.Trainer2SetResultRevision.count > 0); assert(before.Trainer2ExecutionFinish.count > 0);
    const url = `postgresql://postgres:${target.env.POSTGRES_PASSWORD}@127.0.0.1:${target.port}/${database}`;
    const env = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: url, DIRECT_URL: url, TEST_DATABASE_URL: url };
    assert(validateDisposableDatabaseTargets({ environment: env, confirmed: true }).valid);
    const migrate = () => execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env, encoding: 'utf8', windowsHide: true });
    const migrationOutput = migrate(); const replayOutput = migrate();
    const after = await snapshot(); assert.deepEqual(after, before);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM "Trainer2SetSkip"')).rows[0].n, 0);
    const checksums = (await pool.query('SELECT migration_name,checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows;
    const sourceMigration = readFileSync('prisma/migrations/20260922010000_trainer2_set_skip/migration.sql', 'utf8'); assert(sourceMigration.includes('trainer2_set_skip_seal'));
    writeFileSync(dir + 'populated-upgrade.json', JSON.stringify({ at: new Date().toISOString(), source: verificationSource(), sourceContainer, targetContainer, database, before, after, checksums, migrationOutput, replayOutput, newSkips: 0 }, null, 2));
    console.log('Populated accepted-base upgrade passed; historical rows identical; no invented skips; second deploy no-op.');
  } finally { await pool?.end(); await admin.end(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
