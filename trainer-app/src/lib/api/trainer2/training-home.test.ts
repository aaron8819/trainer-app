import { beforeEach, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('./principal', () => ({ authorizeAccount: mocks.authorize }));
import { readTrainingHome } from './training-home';

const principal = { accountId: 'owner', sessionId: 'session' };
beforeEach(() => { mocks.authorize.mockReset().mockResolvedValue(undefined); });
function database(plans: unknown[], revisions: unknown[]) {
  return { trainer2Plan: { findMany: vi.fn().mockResolvedValue(plans) },
    trainer2PlanRevision: { findMany: vi.fn().mockResolvedValue(revisions) } };
}
it('lists retained plans with account-scoped revision labels without writing or inferring completion', async () => {
  const db = database([{ id: 'old', lifecycle: 'Completed', currentRevisionId: 'r1' },
    { id: 'new', lifecycle: 'Active', currentRevisionId: 'r2' }], [
    { id: 'r1', planId: 'old', document: { name: 'First program' }, createdAt: new Date('2026-10-01Z') },
    { id: 'r2', planId: 'new', document: { name: 'Second program' }, createdAt: new Date('2026-11-01Z') },
  ]);
  expect(await readTrainingHome(db as unknown as PrismaClient, principal)).toEqual({ plans: [
    { id: 'old', lifecycle: 'Completed', name: 'First program', savedAt: '2026-10-01T00:00:00.000Z' },
    { id: 'new', lifecycle: 'Active', name: 'Second program', savedAt: '2026-11-01T00:00:00.000Z' },
  ] });
  expect(mocks.authorize).toHaveBeenCalledWith(db, principal);
  expect(db.trainer2Plan.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { accountId: 'owner', tombstonedAt: null },
  }));
  expect(db.trainer2PlanRevision.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { accountId: 'owner', OR: [{ planId: 'old', id: 'r1' }, { planId: 'new', id: 'r2' }] },
  }));
});
it('keeps missing or malformed label metadata navigable and never uses another plan revision', async () => {
  const db = database([{ id: 'old', lifecycle: 'Completed', currentRevisionId: 'r1' }],
    [{ id: 'r1', planId: 'different', document: { name: 'Wrong' }, createdAt: new Date() }]);
  expect((await readTrainingHome(db as unknown as PrismaClient, principal)).plans[0])
    .toEqual({ id: 'old', lifecycle: 'Completed', name: 'Saved program', savedAt: null });
});
it('does not query revisions for an empty account', async () => {
  const db = database([], []);
  expect(await readTrainingHome(db as unknown as PrismaClient, principal)).toEqual({ plans: [] });
  expect(db.trainer2PlanRevision.findMany).not.toHaveBeenCalled();
});
it('authorizes before querying any history', async () => {
  mocks.authorize.mockRejectedValue(new Error('UNAUTHORIZED'));
  const db = database([], []);
  await expect(readTrainingHome(db as unknown as PrismaClient, principal)).rejects.toThrow('UNAUTHORIZED');
  expect(db.trainer2Plan.findMany).not.toHaveBeenCalled();
});
