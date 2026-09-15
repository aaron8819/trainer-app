import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { sanitizeDatabaseTargetEnvironment, validateDisposableDatabaseTargets } from '../../src/lib/operations/test-environment-preflight';
export async function verifyHistoricalUpgrade(admin: Pool, ownerUrl: string, sourceRuntimeUrl: string,
  command: (exe: string, args: string[], env?: NodeJS.ProcessEnv) => string,
  seed: (runtime: PrismaClient, owner: PrismaClient) => Promise<() => Promise<void>>) {
  const candidate = resolve('artifacts/trainer2/historical-base/prisma'); mkdirSync(resolve(candidate, 'migrations'), { recursive: true });
  cpSync(resolve('prisma/schema.prisma'), resolve(candidate, 'schema.prisma')); cpSync(resolve('prisma.config.ts'), resolve(candidate, '../prisma.config.ts'));
  for (const entry of readdirSync(resolve('prisma/migrations'))) if (entry < '20260915010000_trainer2_historical_set_corrections' || entry === 'migration_lock.toml')
    cpSync(resolve('prisma/migrations', entry), resolve(candidate, 'migrations', entry), { recursive: true });
  const database = `trainer2_disposable_historical_upgrade_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  const target = new URL(ownerUrl); target.pathname = `/${database}`;
  const env = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: target.href, DIRECT_URL: target.href, TEST_DATABASE_URL: target.href };
  assert(validateDisposableDatabaseTargets({ environment: env, confirmed: true }).valid);
  const migrate = (config: string) => command(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', config], env);
  migrate(resolve(candidate, '../prisma.config.ts'));
  const pool = new Pool({ connectionString: target.href });
  const runtimeUrl = new URL(sourceRuntimeUrl); runtimeUrl.pathname = target.pathname;
  const rp = new Pool({ connectionString: runtimeUrl.href });
  const owner = new PrismaClient({ adapter: new PrismaPg(pool) }), runtime = new PrismaClient({ adapter: new PrismaPg(rp) });
  try {
    await pool.query(readFileSync(resolve('prisma/trainer2-runtime-grants.sql'), 'utf8').split('\n').filter(l => !l.startsWith('CREATE ROLE ')).join('\n'));
    const afterUpgrade = await seed(runtime, owner);
    const tables = (await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'Trainer2%' OR tablename='User') ORDER BY tablename`)).rows.map(r => r.tablename as string);
    const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await pool.query(`SELECT to_jsonb(t) row FROM "${t}" t ORDER BY to_jsonb(t)::text`)).rows])));
    const before = await snapshot(); migrate(resolve('prisma.config.ts')); migrate(resolve('prisma.config.ts')); assert.deepEqual(await snapshot(), before);
    await afterUpgrade();
    return { status: 'passed', base: '1fd454d389cf30ce87590f8078d0d168748a62c9', preservedTables: tables, existingOpenAndFinished: true, inventedCorrections: 0 };
  } finally { await runtime.$disconnect(); await owner.$disconnect(); await rp.end(); await pool.end(); }
}
