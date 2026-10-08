import { randomUUID, createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { replacePasscode, sessionForRequest, SESSION_COOKIE } from './sessions';
import { MAX_SESSION_EPOCH } from './session-epoch';

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const accountId = randomUUID(), id = randomUUID(), secret = 's'.repeat(43);
  vi.stubEnv('TRAINER2_OWNER_USER_ID', accountId);
  const owner = { id: 1, accountId, passcodeVerifier: 'synthetic-old-verifier',
    setupVerifier: null, sessionEpoch: 4, failedAttempts: 3, lockedUntil: null };
  const session = { id, ownerId: 1, tokenHash: createHash('sha256').update(secret).digest('hex'),
    epoch: 4, revokedAt: null as Date | null, expiresAt: new Date(Date.now() + 100000),
    absoluteExpiresAt: new Date(Date.now() + 100000) };
  const training = Object.freeze({ planId: randomUUID(), history: ['synthetic completed workout'] });
  const update = vi.fn(async ({ data }: { data: { passcodeVerifier: string;
    setupVerifier: null; sessionEpoch: { increment: number }; failedAttempts: number;
    lockedUntil: null } }) => { Object.assign(owner, data,
      { sessionEpoch: owner.sessionEpoch + data.sessionEpoch.increment }); });
  const revoke = vi.fn(async () => { session.revokedAt = new Date(); });
  const tx = { $queryRaw: vi.fn(async () => []),
    trainer2Owner: { findMany: vi.fn(async () => [owner]), update },
    trainer2DeviceSession: { findUnique: vi.fn(async () => session), updateMany: revoke } };
  let queue = Promise.resolve();
  const transaction = vi.fn(async (run: (client: typeof tx) => Promise<void>) => {
    const previous = queue; let release!: () => void;
    queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const before = structuredClone({ owner, session });
    try { await run(tx); } catch (error) {
      Object.assign(owner, before.owner); Object.assign(session, before.session); throw error;
    } finally { release(); }
  });
  const db = { ...tx, $transaction: transaction };
  const request = new Request('https://synthetic.invalid', {
    headers: { cookie: `${SESSION_COOKIE}=${id}.${secret}` },
  });
  const input = { accountId, epoch: 4, passcode: 'synthetic replacement phrase',
    confirmation: 'synthetic replacement phrase' };
  return { db, request, input, owner, session, training, update, revoke, transaction, tx };
}
describe('same-owner signed-in passcode replacement', () => {
  it('changes only auth fields, advances epoch and invalidates old devices atomically', async () => {
    const f = fixture(), before = structuredClone(f.training);
    await replacePasscode(f.db as never, f.request, f.input);
    expect(f.owner.accountId).toBe(f.input.accountId);
    expect(f.owner.sessionEpoch).toBe(5);
    expect(f.owner.passcodeVerifier).toMatch(/^scrypt-v1:/);
    expect(f.owner.passcodeVerifier).not.toContain(f.input.passcode);
    expect(f.owner.setupVerifier).toBeNull();
    expect(f.owner.failedAttempts).toBe(0);
    expect(f.session.revokedAt).toBeInstanceOf(Date);
    expect(f.revoke).toHaveBeenCalledWith({ where: { ownerId: 1, revokedAt: null },
      data: { revokedAt: expect.any(Date) } });
    expect(Object.keys(f.update.mock.calls[0][0].data).sort()).toEqual([
      'failedAttempts', 'lockedUntil', 'passcodeVerifier', 'sessionEpoch', 'setupVerifier',
    ]);
    expect(f.training).toEqual(before);
    await expect(sessionForRequest(f.db as never, f.request)).rejects.toThrow('UNAUTHENTICATED');
  });
  it.each(['mismatch', 'short', 'absent cookie', 'wrong owner', 'stale epoch', 'exhausted epoch'])(
    'fails closed without mutations: %s', async scenario => {
      const f = fixture(); let request = f.request;
      if (scenario === 'mismatch') f.input.confirmation = 'different synthetic phrase';
      if (scenario === 'short') f.input.passcode = f.input.confirmation = 'short';
      if (scenario === 'absent cookie') request = new Request('https://synthetic.invalid');
      if (scenario === 'wrong owner') f.input.accountId = randomUUID();
      if (scenario === 'stale epoch') f.input.epoch = 3;
      if (scenario === 'exhausted epoch') {
        f.input.epoch = f.owner.sessionEpoch = f.session.epoch = MAX_SESSION_EPOCH;
      }
      await expect(replacePasscode(f.db as never, request, f.input)).rejects.toThrow();
      expect(f.update).not.toHaveBeenCalled(); expect(f.revoke).not.toHaveBeenCalled();
    }
  );
  it('rechecks revocation after waiting for the owner lock', async () => {
    const f = fixture(); f.tx.$queryRaw.mockImplementationOnce(async () => {
      f.owner.sessionEpoch++; return [];
    });
    await expect(replacePasscode(f.db as never, f.request, f.input)).rejects.toThrow();
    expect(f.update).not.toHaveBeenCalled(); expect(f.revoke).not.toHaveBeenCalled();
  });
  it('admits only one concurrent request for the expected owner epoch', async () => {
    const f = fixture();
    const outcomes = await Promise.allSettled([
      replacePasscode(f.db as never, f.request, f.input),
      replacePasscode(f.db as never, f.request, f.input),
    ]);
    expect(outcomes.map(o => o.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(f.update).toHaveBeenCalledTimes(1); expect(f.revoke).toHaveBeenCalledTimes(1);
  });
  it('rolls back verifier and epoch if transactional revocation fails', async () => {
    const f = fixture(), before = structuredClone({ owner: f.owner, session: f.session });
    f.revoke.mockRejectedValueOnce(new Error('synthetic transaction failure'));
    await expect(replacePasscode(f.db as never, f.request, f.input)).rejects.toThrow();
    expect({ owner: f.owner, session: f.session }).toEqual(before);
  });
});
