import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { createHypertrophyPlan } from '../../engine/trainer2/plan-builder';
import { catalog, catalogExercise } from '../../engine/trainer2/catalog';
import { currentAssignment, replacementContent } from '../../engine/trainer2/exercise-swap';
import type { ExerciseSwap } from '../../trainer2-contracts/exercise-swap';
import type { PerformedResult } from '../../trainer2-contracts/set-results';
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

it.each(['legacy', 'plate-optional'] as const)('shows sets performed on the %s back extension swapped into Lower A from Lower B', async (variant) => {
  const plan = createHypertrophyPlan();
  const deadlift = catalog.find(e => e.id === 't2:barbell-romanian-deadlift')!;
  const generic = catalog.find(e => e.id === 't2:45-degree-back-extension')!;
  const selected = variant === 'legacy' ? catalog.find(e => e.id === 't2:bodyweight-45-degree-back-extension')! : generic;
  const sourcePosition = { ...plan.occurrences[0].positions[0], exercise: catalogExercise(deadlift) };
  const currentPosition = { ...sourcePosition, id: randomUUID(), exercise: catalogExercise(generic),
    targets: sourcePosition.targets.map(t => ({ ...t, measurement: null })) };
  const buildExecution = (position: typeof sourcePosition, name: string, startedAt: string, hash: string) => ({
    executionId: randomUUID(), lifecycle: 'Open', contentHash: hash.repeat(64),
    initial: { startedAt, occurrence: { name, positions: [position] },
      positions: [{ id: randomUUID(), sourcePositionId: position.id,
        targets: position.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id })) }] },
    results: [],
  }) as unknown as ExecutionRead;
  const current = buildExecution(currentPosition, 'Lower B', '2026-11-23T17:14:00.000Z', 'a');
  const source = buildExecution(sourcePosition, 'Lower A', '2026-11-18T18:29:00.000Z', 'b');
  const sourceOwned = source.initial.positions[0], currentOwned = current.initial.positions[0];
  const swap = { positionId: sourceOwned.id, version: 1, actionId: randomUUID(), contentHash: 'c'.repeat(64),
    content: replacementContent(source, sourceOwned.id, selected) } as ExerciseSwap;
  const swapped = { ...source, lifecycle: 'Finished', swaps: [swap], finish: { finishedAt: '2026-11-18T19:28:00.000Z' } } as ExecutionRead;
  const assignment = currentAssignment(swapped, sourceOwned.id);
  const result: PerformedResult = { reps: { value: 10, basis: 'total' },
    measurement: variant === 'legacy' ? { kind: 'bodyweight', convention: 'bodyweightOnly' } :
      { kind: 'addedLoad', convention: 'addedExternal', zeroMeaning: 'noAddedLoad', value: '25', unit: 'lb' }, rir: null };
  swapped.results = [
    ...sourceOwned.targets.slice(0, 2).map(t => ({ targetId: t.id, result, assignment })),
    { targetId: sourceOwned.targets[2].id, result, assignment: { ...assignment, version: 0 } },
  ] as ExecutionRead['results'];
  current.results = [{ targetId: currentOwned.targets[0].id,
    result: { reps: { value: 12, basis: 'total' }, measurement: null, rir: null } }] as ExecutionRead['results'];
  const tx = { trainer2ExecutionFinish: { findMany: vi.fn().mockResolvedValue([{ executionId: source.executionId }]) },
    trainer2PlanRevision: { findFirst: vi.fn().mockResolvedValue(null) } } as unknown as Prisma.TransactionClient;
  const principal = { accountId: 'owner', sessionId: 'session' };
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(swapped);
  const history = await readExerciseHistory(tx, principal, current.executionId, currentOwned.id);
  expect(history?.sessions[0]).toMatchObject({ workoutName: 'Lower A',
    sets: [{ number: 1, result }, { number: 2, result }] });

  // The original prescribed deadlift no longer owns these results.
  const deadliftQuery = buildExecution(sourcePosition, 'Other', '2026-11-23T17:14:00.000Z', 'd');
  mocks.read.mockResolvedValueOnce(deadliftQuery).mockResolvedValueOnce(swapped);
  expect((await readExerciseHistory(tx, principal, deadliftQuery.executionId, deadliftQuery.initial.positions[0].id))?.sessions).toEqual([]);
});
