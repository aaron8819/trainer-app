import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { EXPECTED_MIGRATION_CHAIN } from '../../src/lib/operations/migration-integrity';
import { transitionSyntheticOwner } from '../../src/lib/api/trainer2/owner-transition';
import { publishAttribution } from './private-attribution';
import { assertConnectionPrivileges } from '../../src/lib/api/trainer2/database';

/** Narrow operator entry. No route, credential generation, schema/grant writes or restore. */
async function main() {
  const operation = process.argv.slice(2).join(' ');
  if (!['--inspect', '--confirm-hosted-real-transition'].includes(operation)) throw new Error('EXACT_OPERATOR_ACTION_REQUIRED');
  const path = process.env.TRAINER2_OPERATOR_ENV_PATH;
  if (!path) throw new Error('PRIVATE_OPERATOR_CONFIGURATION_REQUIRED');
  const config = parse(readFileSync(path));
  const expectedEpoch = Number(config.TRAINER2_EXPECTED_SESSION_EPOCH);
  if (!config.TRAINER2_EXPECTED_SESSION_EPOCH || !Number.isInteger(expectedEpoch) || expectedEpoch < 0)
    throw new Error('OPERATOR_EXPECTED_EPOCH_REQUIRED');
  const url = new URL(config.DIRECT_URL ?? '');
  if (url.protocol !== 'postgresql:' || !url.hostname.endsWith('.pooler.supabase.com') ||
      url.port !== '5432' || url.pathname !== '/postgres' || url.username !== 'postgres.siqmohcbvnbdrssgofzu' ||
      !url.password || !config.OWNER_EMAIL || !config.TRAINER2_OPERATOR_CA_CERT_PEM?.includes('BEGIN CERTIFICATE'))
    throw new Error('HOSTED_OPERATOR_TARGET_MISMATCH');
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', windowsHide: true });
  if (head.status !== 0 || dirty.status !== 0 || dirty.stdout.trim() || head.stdout.trim() !== config.TRAINER2_APPROVED_COMMIT)
    throw new Error('OPERATOR_SOURCE_MISMATCH');
  url.search = '';
  const pool = new Pool({ connectionString: url.toString(), ssl: { ca: config.TRAINER2_OPERATOR_CA_CERT_PEM, rejectUnauthorized: true }, max: 1 });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    for (const [purpose, key, role] of [
      ['identity', 'TRAINER2_IDENTITY_CONNECTION_STRING', 'trainer2_identity_runtime'],
      ['read', 'TRAINER2_READ_CONNECTION_STRING', 'trainer2_draft_reader'],
      ['write', 'TRAINER2_WRITE_CONNECTION_STRING', 'trainer2_draft_runtime'],
    ] as const) {
      const restricted = new URL(config[key] ?? '');
      if (restricted.hostname !== url.hostname || restricted.pathname !== url.pathname ||
          decodeURIComponent(restricted.username) !== role + '.siqmohcbvnbdrssgofzu' || restricted.port !== '5432') throw new Error('OPERATOR_RESTRICTED_TARGET_MISMATCH');
      restricted.search = '';
      const checkPool = new Pool({ connectionString: restricted.toString(), ssl: { ca: config.TRAINER2_OPERATOR_CA_CERT_PEM, rejectUnauthorized: true } });
      try { const connection = await checkPool.connect(); try { await assertConnectionPrivileges(connection, purpose); } finally { connection.release(); } }
      finally { await checkPool.end(); }
    }
    const resolved = await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const migrations = await tx.$queryRaw<Array<{ migration_name: string; finished: boolean }>>`
        SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS finished
        FROM public._prisma_migrations ORDER BY migration_name`;
      if (migrations.length !== EXPECTED_MIGRATION_CHAIN.length || migrations.some((row, index) =>
        !row.finished || row.migration_name !== [...EXPECTED_MIGRATION_CHAIN].sort()[index])) throw new Error('OPERATOR_MIGRATION_MISMATCH');
      const users = await tx.user.findMany({ where: { email: config.OWNER_EMAIL }, select: { id: true }, take: 2 });
      if (users.length !== 1 || users[0].id !== config.TRAINER2_VERIFIED_REAL_ID) throw new Error('OPERATOR_REAL_ID_MISMATCH');
      const owner = await tx.trainer2Owner.findUniqueOrThrow({ where: { id: 1 }, select: { accountId: true, sessionEpoch: true } });
      const binding = owner.accountId === config.TRAINER2_EXPECTED_SYNTHETIC_ID && owner.sessionEpoch === expectedEpoch ? 'synthetic' :
        owner.accountId === users[0].id && owner.sessionEpoch > expectedEpoch ? 'real' : null;
      if (!binding) throw new Error('OPERATOR_BINDING_CHANGED_INSPECT_RECOVERY');
      if (binding === 'real' && (await tx.trainer2DeviceSession.count({ where: { epoch: { lte: expectedEpoch } } }) !== 24 ||
          await tx.trainer2DeviceSession.count({ where: { epoch: { lte: expectedEpoch }, revokedAt: null } }) !== 0))
        throw new Error('OPERATOR_HISTORICAL_SESSIONS_MISMATCH');
      return { id: users[0].id, binding, epoch: owner.sessionEpoch };
    }, { isolationLevel: 'RepeatableRead' });
    if (operation === '--inspect') { console.log(JSON.stringify({ inspected: true, binding: resolved.binding, epoch: resolved.epoch, writes: 0 })); return; }
    if (resolved.binding !== 'synthetic') throw new Error('ALREADY_REAL_BOUND_NO_REPEAT_TRANSITION');
    if (!config.TRAINER2_PRIVATE_MANIFEST_DIRECTORY || !config.TRAINER2_ONE_TIME_SETUP_CODE ||
        config.TRAINER2_APPROVED_STABLE_ORIGIN !== 'https://trainer2-hosted-synthetic-git-codex-e763ff-aaron8819s-projects.vercel.app')
      throw new Error('OPERATOR_EXECUTION_CONFIGURATION_REQUIRED');
    let receipt: ReturnType<typeof publishAttribution> | undefined;
    const result = await transitionSyntheticOwner(db, {
      expectedSyntheticAccountId: config.TRAINER2_EXPECTED_SYNTHETIC_ID,
      expectedSessionEpoch: expectedEpoch, expectedSessionCount: 24,
      verifiedRealAccountId: resolved.id, verifiedRealEmail: config.OWNER_EMAIL, setupCode: config.TRAINER2_ONE_TIME_SETUP_CODE,
      preserveArchive: async archive => { receipt = publishAttribution(config.TRAINER2_PRIVATE_MANIFEST_DIRECTORY, archive, head.stdout.trim()); },
    });
    const after = await db.trainer2Owner.findUniqueOrThrow({ where: { id: 1 } });
    if (after.accountId !== resolved.id || after.passcodeVerifier !== null || !after.setupVerifier ||
        await db.trainer2DeviceSession.count({ where: { ownerId: 1, revokedAt: null } })) throw new Error('OPERATOR_COMMIT_READBACK_REQUIRED');
    console.log(JSON.stringify({ committed: true, manifest: receipt, ...result }));
  } finally { await db.$disconnect(); await pool.end(); }
}
void main().catch(() => { console.error('OPERATOR_STOP: inspect binding and private manifest before retry; no automatic rollback'); process.exitCode = 1; });
