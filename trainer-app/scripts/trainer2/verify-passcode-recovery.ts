import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { PrismaClient } from '@prisma/client';
import {
  enterPasscode, replacePasscode, sessionForRequest, SESSION_COOKIE,
} from '../../src/lib/api/trainer2/sessions';
import { isolatedLinuxJob } from './isolated-linux-lifecycle';

/** Runs only inside the existing isolated Linux equipment fixture; never logs credentials. */
export async function verifyPasscodeRecovery(
  identity: PrismaClient, admin: Pool, accountId: string, initialCookie: string,
  pass: (message: string) => void,
): Promise<void> {
  assert(isolatedLinuxJob(process.platform, process.env), 'Requires existing isolated Linux CI');
  const request = (cookie: string): Request => new Request('https://fixture.invalid', {
    headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
  });
  const secret = (): string => randomBytes(32).toString('base64url');
  const input = async (passcode: string) => ({ accountId,
    epoch: (await identity.trainer2Owner.findUniqueOrThrow({ where: { id: 1 } })).sessionEpoch,
    passcode, confirmation: passcode,
  });
  const training = async (): Promise<string> => {
    const tables = await admin.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       AND (tablename LIKE 'Trainer2%' OR tablename = 'User')
       AND tablename NOT IN ('Trainer2Owner', 'Trainer2DeviceSession') ORDER BY tablename`,
    );
    const hashes: string[] = [];
    for (const { tablename } of tables.rows) {
      const quoted = tablename.replaceAll('"', '""');
      const result = await admin.query<{ hash: string }>(
        `SELECT md5(COALESCE(string_agg(row, E'\\n' ORDER BY row), '')) AS hash
         FROM (SELECT to_jsonb(t)::text AS row FROM "${quoted}" t) rows`,
      );
      hashes.push(`${tablename}:${result.rows[0].hash}`);
    }
    return hashes.join('\n');
  };
  // These snapshots stay in memory: even a failed assertion must not print verifiers/hashes.
  const auth = async (): Promise<string> => JSON.stringify({
    owner: await identity.trainer2Owner.findMany(),
    sessions: await identity.trainer2DeviceSession.findMany({ orderBy: { id: 'asc' } }),
  });
  const before = await training();
  try {
    const first = secret();
    const startingEpoch = (await input(first)).epoch;
    await replacePasscode(identity, request(initialCookie), await input(first));
    assert((await identity.trainer2Owner.findUniqueOrThrow({ where: { id: 1 } }))
      .sessionEpoch === startingEpoch + 1, 'Replacement increments epoch once');
    assert(await identity.trainer2DeviceSession.count({ where: { revokedAt: null } }) === 0,
      'Replacement revokes every active fixture session');
    await assert.rejects(sessionForRequest(identity, request(initialCookie)));
    const currentCookie = await enterPasscode(identity, { passcode: first });
    await sessionForRequest(identity, request(currentCookie));
    assert(await training() === before, 'Replacement preserves all synthetic training records');
    pass('PostgreSQL recovery replaces verifier, invalidates old session and preserves training');

    const competitors = [secret(), secret()];
    const expectedEpoch = (await input(competitors[0])).epoch;
    const outcomes = await Promise.allSettled(competitors.map(passcode =>
      replacePasscode(identity, request(currentCookie), {
        accountId, epoch: expectedEpoch, passcode, confirmation: passcode,
      })));
    assert(outcomes.filter(result => result.status === 'fulfilled').length === 1,
      'Exactly one competing old-session request succeeds');
    const loser = outcomes.find(result => result.status === 'rejected');
    assert(loser?.status === 'rejected' && loser.reason instanceof Error &&
      loser.reason.message === 'UNAUTHENTICATED', 'Losing request fails authorization');
    assert((await identity.trainer2Owner.findUniqueOrThrow({ where: { id: 1 } }))
      .sessionEpoch === expectedEpoch + 1, 'Competing requests increment epoch once');
    await assert.rejects(sessionForRequest(identity, request(currentCookie)));
    assert(await training() === before, 'Competing requests preserve training');
    const winner = outcomes.findIndex(result => result.status === 'fulfilled');
    const rollbackCookie = await enterPasscode(identity, { passcode: competitors[winner] });
    pass('PostgreSQL competing old-session recovery requests have exactly one winner');

    const authBefore = await auth();
    await admin.query(`CREATE FUNCTION trainer2_fixture_revoke_failure() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic revocation failure'; END $$`);
    try {
      await admin.query(`CREATE TRIGGER trainer2_fixture_revoke_failure
        BEFORE UPDATE OF "revokedAt" ON "Trainer2DeviceSession"
        FOR EACH ROW EXECUTE FUNCTION trainer2_fixture_revoke_failure()`);
      await assert.rejects(replacePasscode(identity, request(rollbackCookie), await input(secret())),
        (error: unknown) => error instanceof Error &&
          error.message.includes('Synthetic revocation failure'));
      assert(await auth() === authBefore, 'Failed revocation rolls back every auth field');
      await sessionForRequest(identity, request(rollbackCookie));
      assert(await training() === before, 'Failed transaction preserves training');
      pass('PostgreSQL failed revocation rolls back verifier, epoch and sessions; training unchanged');
    } finally {
      await admin.query('DROP TRIGGER IF EXISTS trainer2_fixture_revoke_failure ON "Trainer2DeviceSession"');
      await admin.query('DROP FUNCTION trainer2_fixture_revoke_failure()');
    }
  } catch {
    // Database driver diagnostics may include parameter values; retain a bounded safe failure.
    throw new Error('Disposable PostgreSQL passcode recovery qualification failed');
  }
}
