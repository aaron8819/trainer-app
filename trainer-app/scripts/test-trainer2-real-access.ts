import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { EXPECTED_MIGRATION_CHAIN } from '../src/lib/operations/migration-integrity';
import { transitionSyntheticOwner } from '../src/lib/api/trainer2/owner-transition';
import { makeVerifier, enterPasscode, sessionForRequest, renewSession, revokeSession, SESSION_COOKIE } from '../src/lib/api/trainer2/sessions';
import { authorizeAccount } from '../src/lib/api/trainer2/principal';
import { readDraft } from '../src/lib/api/trainer2/planning';
import { acceptCommand } from '../src/lib/api/trainer2/command';
import { assertConnectionPrivileges } from '../src/lib/api/trainer2/database';
import { readTrainingHome } from '../src/lib/api/trainer2/training-home';
import { publishAttribution } from './trainer2/private-attribution';

const artifact = resolve('artifacts/real-access-fixes', `run-${Date.now()}`); mkdirSync(artifact, { recursive: true });
const results: Record<string, unknown>[] = [];
function record(test: string, detail: unknown = 'PASS') { results.push({ test, detail }); console.log(test, typeof detail === 'string' ? detail : 'recorded'); }
function docker(args: string[]) { const r = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, 'Docker command failed'); return r.stdout.trim(); }
function deferred() { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; }
const container = 'trainer2-real-fixes-' + randomUUID().slice(0, 8), password = randomUUID();
const clients: PrismaClient[] = [], pools: Pool[] = [];
const synthetic = randomUUID(), target = randomUUID(), other = randomUUID();
const setupCode = randomBytes(32).toString('base64url'), passcode = randomBytes(32).toString('base64url');
const request = (token: string) => new Request('http://localhost/trainer2/auth', { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
let oldTokens: string[] = [];
async function main() {
  assert.deepEqual(process.argv.slice(2), ['--confirm-disposable']);
  docker(['run', '--pull=never', '--rm', '-d', '--name', container, '--label', 'trainer2.real-review=owned', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=trainer2_disposable_review', '-p', '127.0.0.1::5432', 'postgres:17-alpine']);
  for (let n = 0; n < 60; n++) { if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { windowsHide: true }).status === 0) break; await new Promise(r => setTimeout(r, 500)); }
  const port = docker(['port', container, '5432/tcp']).match(/:(\d+)$/)![1];
  const url = (role: string) => `postgresql://${role}:${password}@127.0.0.1:${port}/trainer2_disposable_review`;
  const db = (role: string) => { const pool = new Pool({ connectionString: url(role) }); pools.push(pool); const client = new PrismaClient({ adapter: new PrismaPg(pool) }); clients.push(client); return client; };
  const admin = db('postgres'), pool = pools[0];
  for (let n = 0; ; n++) {
    try { await pool.query('SELECT 1'); break; }
    catch (error) { if (n >= 60) throw error; await new Promise(r => setTimeout(r, 500)); }
  }
  await pool.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for (const name of EXPECTED_MIGRATION_CHAIN) await pool.query(readFileSync(resolve('prisma/migrations', name, 'migration.sql'), 'utf8'));
  await pool.query(`BEGIN; ${readFileSync('prisma/trainer2-runtime-grants.sql', 'utf8')} COMMIT;`);
  for (const role of ['trainer2_identity_runtime', 'trainer2_draft_reader', 'trainer2_draft_runtime']) await pool.query(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
  const identity = db('trainer2_identity_runtime'), reader = db('trainer2_draft_reader'), writer = db('trainer2_draft_runtime');
  for (const [index, purpose] of [[1, 'identity'], [2, 'read'], [3, 'write']] as const) { const connection = await pools[index].connect(); try { await assertConnectionPrivileges(connection, purpose); } finally { connection.release(); } }
  await admin.user.createMany({ data: [{ id: synthetic, email: `trainer2-hosted-synthetic-${synthetic}@example.invalid` }, { id: target, email: 'target@synthetic.invalid' }, { id: other, email: 'other@synthetic.invalid' }] });
  await pool.query('INSERT INTO "Trainer2AccountTrainingState" ("accountId") VALUES ($1),($2)', [synthetic, other]);
  const oldVerifier = await makeVerifier(passcode);
  async function reset() {
    process.env.TRAINER2_OWNER_USER_ID = synthetic;
    await admin.trainer2DeviceSession.deleteMany();
    await admin.trainer2Owner.upsert({ where: { id: 1 }, create: { id: 1, accountId: synthetic, passcodeVerifier: oldVerifier, sessionEpoch: 8 }, update: { accountId: synthetic, passcodeVerifier: oldVerifier, setupVerifier: null, sessionEpoch: 8, failedAttempts: 0, lockedUntil: null } });
    oldTokens = [];
    for (let n = 0; n < 24; n++) { const id = randomUUID(), secret = randomBytes(32).toString('base64url'); oldTokens.push(`${id}.${secret}`); await admin.trainer2DeviceSession.create({ data: { id, ownerId: 1, epoch: 8, tokenHash: createHash('sha256').update(secret).digest('hex'), createdAt: new Date(), renewedAt: new Date(), expiresAt: new Date(Date.now() + 86400000), absoluteExpiresAt: new Date(Date.now() + 90 * 86400000) } }); }
  }
  const input = { expectedSyntheticAccountId: synthetic, verifiedRealAccountId: target, setupCode, preserveArchive: async () => {} };
  const snapshot = async () => ({ owner: await admin.trainer2Owner.findUniqueOrThrow({ where: { id: 1 } }), sessions: await admin.trainer2DeviceSession.findMany({ orderBy: { id: 'asc' } }) });
  await reset(); const before = await snapshot();
  await assert.rejects(transitionSyntheticOwner(admin, { ...input, preserveArchive: async () => { throw new Error('ARCHIVE_FAILURE'); } }), /ARCHIVE_FAILURE/);
  assert.deepEqual(await snapshot(), before); record('archive-failure-rollback');
  await pool.query(`CREATE FUNCTION review_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'REVIEW_INTERRUPTION'; END $$; CREATE TRIGGER review_abort BEFORE UPDATE ON "Trainer2Owner" FOR EACH ROW EXECUTE FUNCTION review_abort();`);
  await assert.rejects(transitionSyntheticOwner(admin, input)); assert.deepEqual(await snapshot(), before);
  await pool.query('DROP TRIGGER review_abort ON "Trainer2Owner"; DROP FUNCTION review_abort();'); record('failure-after-session-revocation-rolls-back');
  await admin.trainer2AccountTrainingState.create({ data: { accountId: target } });
  await assert.rejects(transitionSyntheticOwner(admin, input), /REAL_OWNER_TRAINER2_DATA_EXISTS/);
  await admin.trainer2AccountTrainingState.delete({ where: { accountId: target } }); record('nonempty-target-denied');
  await assert.rejects(transitionSyntheticOwner(identity, input)); record('runtime-role-cannot-transition-binding');
  const locked = deferred(), release = deferred();
  const transition = transitionSyntheticOwner(admin, { ...input, preserveArchive: async () => { locked.release(); await release.promise; } });
  await locked.promise;
  const auth = enterPasscode(identity, { passcode }).then(() => 'admitted', () => 'denied');
  const renewal = renewSession(identity, request(oldTokens[0])).then(() => 'resolved', () => 'denied');
  release.release(); await transition;
  assert.equal(await auth, 'denied'); await renewal;
  process.env.TRAINER2_OWNER_USER_ID = target;
  const setups = await Promise.allSettled([enterPasscode(identity, { setupCode, passcode }), enterPasscode(identity, { setupCode, passcode })]);
  assert.equal(setups.filter(result => result.status === 'fulfilled').length, 1);
  const newToken = (setups.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<string>).value;
  record('concurrent-one-time-setup-exactly-one-session-issued');
  for (const token of oldTokens) await assert.rejects(sessionForRequest(identity, request(token)), /UNAUTHENTICATED/);
  assert.equal(await admin.trainer2DeviceSession.count({ where: { revokedAt: { not: null } } }), 24);
  await assert.rejects(authorizeAccount(reader, { accountId: synthetic, sessionId: oldTokens[0].split('.')[0] }), /UNAUTHORIZED/);
  await assert.rejects(transitionSyntheticOwner(admin, input), /OWNER_TRANSITION_BINDING_MISMATCH/);
  await assert.rejects(enterPasscode(identity, { setupCode, passcode }), /AUTHENTICATION_FAILED/);
  const principal = await sessionForRequest(identity, request(newToken));
  assert.deepEqual(await readTrainingHome(reader, principal), { plans: [] });
  await authorizeAccount(reader, principal);
  for (const accountId of [synthetic, other]) {
    await assert.rejects(readDraft(reader, { ...principal, accountId }, randomUUID()), /UNAUTHORIZED/);
    await assert.rejects(acceptCommand(writer, principal, {}, { actionId: randomUUID(), commandType: 'ReviewDeniedWrite', originatingAccountId: accountId, ownershipEpoch: 0, dependsOn: [] }, async () => { throw new Error('WRITE_MUST_NOT_RUN'); }), /ACCOUNT_MISMATCH/);
  }
  assert.equal(await readDraft(reader, principal, randomUUID()), null);
  assert.equal(await admin.trainer2Plan.count(), 0);
  assert.equal(await admin.trainer2DurableAction.count(), 0);
  assert.equal((await admin.trainer2AccountTrainingState.findUniqueOrThrow({ where: { accountId: synthetic } })).acceptedSequence, BigInt(0));
  assert.equal((await admin.trainer2AccountTrainingState.findUniqueOrThrow({ where: { accountId: other } })).acceptedSequence, BigInt(0));
  record('transition-concurrent-auth-renewal-stale-cookies-repeat-setup-cross-owner-denial');
  await reset();
  const outcomes = await Promise.allSettled([transitionSyntheticOwner(admin, input), transitionSyntheticOwner(admin, input)]);
  assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
  assert.equal((await snapshot()).owner.sessionEpoch, 9); record('competing-transitions-exactly-one-commits');
  for (const epoch of [2147483645, 2147483646, 2147483647]) {
    await reset(); await admin.trainer2Owner.update({ where: { id: 1 }, data: { sessionEpoch: epoch } });
    const unchanged = await snapshot();
    await assert.rejects(transitionSyntheticOwner(admin, input), /SESSION_EPOCH_EXHAUSTED/);
    assert.deepEqual(await snapshot(), unchanged);
  }
  for (const epoch of [0, 2147483644]) {
    await reset(); await admin.trainer2Owner.update({ where: { id: 1 }, data: { sessionEpoch: epoch } });
    await transitionSyntheticOwner(admin, input); process.env.TRAINER2_OWNER_USER_ID = target;
    const token = await enterPasscode(identity, { setupCode, passcode });
    await revokeSession(identity, request(token), true);
    assert.equal((await snapshot()).owner.sessionEpoch, epoch + 3);
    const signedIn = await enterPasscode(identity, { passcode });
    await renewSession(identity, request(signedIn));
    if (epoch !== 0) {
      const unchanged = await snapshot();
      await assert.rejects(revokeSession(identity, request(signedIn), true), /SESSION_EPOCH_EXHAUSTED/);
      assert.deepEqual(await snapshot(), unchanged);
    }
    await revokeSession(identity, request(signedIn), false);
  }
  await reset(); await admin.trainer2Owner.update({ where: { id: 1 }, data: {
    passcodeVerifier: null, setupVerifier: await makeVerifier(setupCode), sessionEpoch: 2147483647,
  } });
  const exhaustedSetup = await snapshot();
  await assert.rejects(enterPasscode(identity, { setupCode, passcode }), /SESSION_EPOCH_EXHAUSTED/);
  assert.deepEqual(await snapshot(), exhaustedSetup);
  record('epoch-rejected-boundaries-unchanged-and-last-admissible-full-session-lifecycle');
  // Freeze the ingress-authorized old request before it can acquire the owner lock.
  await reset(); const reachedUpdate = deferred(), resumeUpdate = deferred();
  const staleDb = new Proxy(identity, { get(object, key) { if (key === '$transaction') return async (...args: unknown[]) => { reachedUpdate.release(); await resumeUpdate.promise; return object.$transaction(args[0] as (tx: import("@prisma/client").Prisma.TransactionClient) => Promise<unknown>); }; return Reflect.get(object, key); } });
  const staleRevoke = revokeSession(staleDb, request(oldTokens[0]), true).then(() => 'accepted', () => 'denied'); await reachedUpdate.promise;
  await transitionSyntheticOwner(admin, input); process.env.TRAINER2_OWNER_USER_ID = target;
  const fresh = await enterPasscode(identity, { setupCode, passcode }); await sessionForRequest(identity, request(fresh));
  const beforeRelease = await snapshot();
  resumeUpdate.release(); assert.equal(await staleRevoke, 'denied');
  assert.deepEqual(await snapshot(), beforeRelease);
  await sessionForRequest(identity, request(fresh));
  record('held-synthetic-revoke-all-denied-new-owner-session-valid');
  // Minimal private attribution, no credential archive or credential restore path.
  await reset();
  await transitionSyntheticOwner(admin, { ...input, preserveArchive: async archive => {
    assert(!/Verifier|tokenHash|passcode|setupCode/.test(JSON.stringify(archive)));
    assert(process.env.TRAINER2_TEST_MANIFEST_DIRECTORY);
    publishAttribution(process.env.TRAINER2_TEST_MANIFEST_DIRECTORY, archive, spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim());
    assert.equal(archive.sessions.length, 24);
  } }); record('private-attribution-no-credentials-durable-separate-process-readback');
  process.env.TRAINER2_OWNER_USER_ID = target;
  if (process.env.REVIEW_BROWSER === '1') {
    const { browserReview } = await import('./test-trainer2-real-access-browser');
    await browserReview({ accountId: target, passcode, setupCode, staleCookie: oldTokens[0], identityUrl: url('trainer2_identity_runtime'), readUrl: url('trainer2_draft_reader'), writeUrl: url('trainer2_draft_runtime'), record });
  } else await enterPasscode(identity, { setupCode, passcode });
  assert.equal(await admin.trainer2Plan.count(), 0); assert.equal(await admin.trainer2Execution.count(), 0);
  record('no-plans-or-executions-created');
}
main().catch(error => { record('harness-error', { name: error?.name, code: error?.code, message: String(error?.message).replace(/postgresql:\/\/\S+/g, '[redacted]') }); process.exitCode = 1; }).finally(async () => {
  writeFileSync(resolve(artifact, 'qualification.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  for (const client of clients) await client.$disconnect().catch(() => {});
  for (const pool of pools) await pool.end().catch(() => {});
  const cleanup = spawnSync('docker', ['stop', container], { encoding: 'utf8', windowsHide: true });
  writeFileSync(resolve(artifact, 'completion.json'), JSON.stringify({ cleanup: { container, stoppedAndRemoved: cleanup.status === 0 }, runnerComplete: true, exitCode: process.exitCode ?? 0 }));
  if (cleanup.status !== 0) process.exitCode = 1;
});
