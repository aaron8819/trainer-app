import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { createHypertrophyPlan } from '../../engine/trainer2/plan-builder';
import type { ExecutionRead } from '../../trainer2-contracts/execution';
import { canonicalJson, integrityHash } from './integrity';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./execution', () => ({ readExecution: mocks.read }));
import { readExerciseHistory } from './exercise-history';

beforeEach(() => vi.clearAllMocks());
it('reads bounded account-scoped sessions, verifies deload evidence and retains partial sets', async () => {
  const plan = createHypertrophyPlan(), position = plan.occurrences[0].positions[0];
  const currentId = randomUUID(), sourceId = randomUUID(), positionId = randomUUID();
  const targets = position.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id }));
  const result = { reps: { value: 8, basis: 'total' }, measurement: { kind: 'externalLoad', value: '100', unit: 'lb', convention: 'barbellTotal', zeroMeaning: 'validZero' }, rir: '2' };
  const hash = integrityHash(canonicalJson(plan));
  const current = { executionId: currentId, lifecycle: 'Open', contentHash: 'a'.repeat(64), results: [], initial: { startedAt: '2026-10-15T12:00:00.000Z', occurrence: { positions: [position] }, positions: [{ id: positionId, sourcePositionId: position.id, targets }] } } as unknown as ExecutionRead;
  const source = { executionId: sourceId, lifecycle: 'Finished', contentHash: 'b'.repeat(64), finish: { finishedAt: '2026-10-08T12:00:00.000Z' }, initial: { planId: randomUUID(), revisionId: randomUUID(), sourceContentHash: hash, stage: plan.stages[4], occurrence: { id: plan.occurrences[16].id, name: 'Previous', positions: [position] }, positions: [{ id: randomUUID(), sourcePositionId: position.id, targets }] }, results: [{ targetId: targets[0].id, result }, { targetId: targets[1].id, result: { ...result, measurement: null, rir: null } }] } as unknown as ExecutionRead;
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(source);
  const findMany = vi.fn().mockResolvedValue([{ executionId: sourceId }]);
  const findFirst = vi.fn().mockResolvedValue({ document: plan, contentHash: hash });
  const tx = { trainer2ExecutionFinish: { findMany }, trainer2PlanRevision: { findFirst } } as unknown as Prisma.TransactionClient;
  const principal = { accountId: 'owner', sessionId: 'session' };
  const data = await readExerciseHistory(tx, principal, currentId, positionId);
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 6, where: expect.objectContaining({ accountId: 'owner' }) }));
  expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: source.initial.revisionId, planId: source.initial.planId, accountId: 'owner' } }));
  expect(data?.sessions[0]).toMatchObject({ executionId: sourceId, deload: true, sets: [{ number: 1, result }, { number: 2, result: { measurement: null, rir: null } }] });
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(source);
  findFirst.mockResolvedValueOnce({ document: plan, contentHash: 'invalid' });
  expect((await readExerciseHistory(tx, principal, currentId, positionId))?.sessions[0].deload).toBeNull();
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce({ ...source, initial: { ...source.initial, occurrence: { ...source.initial.occurrence, positions: [position, { ...position, id: randomUUID() }] } } });
  expect((await readExerciseHistory(tx, principal, currentId, positionId))?.sessions).toEqual([]);
});

it('bounds history scanning and rejects positions outside the owned execution', async () => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  const executionId = randomUUID(), positionId = randomUUID();
  const current = { executionId, lifecycle: 'Open', contentHash: 'a'.repeat(64), results: [], initial: { startedAt: '2026-10-15T12:00:00.000Z', occurrence: { positions: [position] }, positions: [{ id: positionId, sourcePositionId: position.id, targets: [] }] } } as unknown as ExecutionRead;
  const findMany = vi.fn().mockResolvedValue(Array.from({ length: 6 }, () => ({ executionId: randomUUID() })));
  const tx = { trainer2ExecutionFinish: { findMany } } as unknown as Prisma.TransactionClient;
  const principal = { accountId: 'owner', sessionId: 'session' };
  mocks.read.mockResolvedValueOnce(current).mockResolvedValue(null);
  expect(await readExerciseHistory(tx, principal, executionId, positionId)).toEqual({ executionId, positionId, sessions: [], limited: false, nextCursor: expect.any(String) });
  expect(mocks.read).toHaveBeenCalledTimes(6);
  mocks.read.mockResolvedValueOnce(current);
  expect(await readExerciseHistory(tx, principal, executionId, randomUUID())).toBeNull();
  expect(findMany).toHaveBeenCalledTimes(1);
});

it('scopes pagination cursors to the owner and continues after the exact date and identity', async () => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  const executionId = randomUUID(), positionId = randomUUID(), cursor = randomUUID();
  const current = { executionId, lifecycle: 'Open', contentHash: 'a'.repeat(64), results: [], initial: { startedAt: '2026-10-15T12:00:00.000Z', occurrence: { positions: [position] }, positions: [{ id: positionId, sourcePositionId: position.id, targets: [] }] } } as unknown as ExecutionRead;
  const finishedAt = new Date('2026-10-01T12:00:00.000Z');
  const findFirst = vi.fn().mockResolvedValue({ executionId: cursor, finishedAt });
  const findMany = vi.fn().mockResolvedValue([]);
  const tx = { trainer2ExecutionFinish: { findFirst, findMany } } as unknown as Prisma.TransactionClient;
  const principal = { accountId: 'owner', sessionId: 'session' };
  mocks.read.mockResolvedValueOnce(current);
  expect(await readExerciseHistory(tx, principal, executionId, positionId, cursor)).toEqual({ executionId, positionId, sessions: [], limited: false, nextCursor: null });
  expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ accountId: 'owner', executionId: cursor }) }));
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 6, where: expect.objectContaining({ OR: [{ finishedAt: { lt: finishedAt } }, { finishedAt, executionId: { gt: cursor } }] }) }));
  findFirst.mockResolvedValueOnce(null); mocks.read.mockResolvedValueOnce(current);
  expect(await readExerciseHistory(tx, principal, executionId, positionId, randomUUID())).toBeNull();
  expect(findMany).toHaveBeenCalledTimes(1);
});
