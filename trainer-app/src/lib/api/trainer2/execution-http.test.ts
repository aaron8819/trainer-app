import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { executionHttp } from './execution-http';
import { InvalidStartSnapshot } from './execution';
const mocks = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn(), next: vi.fn(), start: vi.fn(), save: vi.fn(), finish: vi.fn(), historical: vi.fn(), discard: vi.fn(), skip: vi.fn() }));
vi.mock('./access', () => ({ requestContext: mocks.context }));
vi.mock('./skip-occurrence', () => ({ skipOccurrence: mocks.skip }));
vi.mock('./discard-execution', () => ({ discardEmptyExecution: mocks.discard }));
vi.mock('./workout-finish', () => ({ finishExecution: mocks.finish }));
vi.mock('./set-results', () => ({ saveSetResult: mocks.save, correctHistoricalSetResult: mocks.historical }));
vi.mock('./execution', async importOriginal => ({ ...await importOriginal<typeof import('./execution')>(), readExecution: mocks.read, readNextWorkout: mocks.next, startOccurrence: mocks.start }));
afterEach(() => vi.resetAllMocks());
describe('execution HTTP boundary', () => {
  it.each([['Accepted', 200], ['Conflict', 409], ['Rejected', 422]])('uses the trusted write context and durable %s outcome for set results', async (status, httpStatus) => {
    const db = {}, principal = { accountId: 'trusted' }, input = { commandType: 'RecordSetResult' };
    mocks.context.mockResolvedValue({ db, principal }); mocks.save.mockResolvedValue({ outcome: { status } });
    const request = new Request('http://localhost/results', { method: 'POST', body: JSON.stringify(input) });
    const result = await executionHttp(request, 'SaveSetResult');
    expect(mocks.context).toHaveBeenCalledWith(request, 'write'); expect(mocks.save).toHaveBeenCalledWith(db, principal, input);
    expect(result.status).toBe(httpStatus); expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([['Accepted', 200], ['Conflict', 409], ['Rejected', 422]])('routes finish %s through trusted write context', async (status, httpStatus) => {
    const db = {}, principal = { accountId: 'trusted' }, input = { commandType: 'FinishExecution' };
    mocks.context.mockResolvedValue({ db, principal }); mocks.finish.mockResolvedValue({ outcome: { status } });
    const request = new Request('http://localhost/finish', { method: 'POST', body: JSON.stringify(input) });
    const result = await executionHttp(request, 'FinishExecution');
    expect(mocks.context).toHaveBeenCalledWith(request, 'write'); expect(mocks.finish).toHaveBeenCalledWith(db, principal, input);
    expect(result.status).toBe(httpStatus); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(['StartOccurrence', 'SaveSetResult', 'FinishExecution', 'CorrectHistoricalSetResult', 'DiscardEmptyExecution'] as const)('retains the per-command body bound for %s', async operation => {
    mocks.context.mockResolvedValue({ db: {}, principal: { accountId: 'trusted' } });
    const request = new Request('http://localhost/command', { method: 'POST', body: ' '.repeat(operation === 'FinishExecution' || operation === 'DiscardEmptyExecution' ? 2000001 : 10001) });
    expect((await executionHttp(request, operation)).status).toBe(413);
    expect(mocks.finish).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('uses read-only transaction, private response and never a start on reads', async () => {
    const sql = vi.fn(); mocks.context.mockResolvedValue({ db: { $transaction: (f: (tx: unknown) => unknown) => f({ $executeRaw: sql }) }, principal: { accountId: 'test' } }); mocks.read.mockResolvedValue(null);
    const result = await executionHttp(new Request('http://localhost/workout'), 'ReadExecution', randomUUID());
    expect(result.status).toBe(404); expect(sql.mock.calls[0][0][0]).toContain('READ ONLY'); expect(mocks.start).not.toHaveBeenCalled();
    expect(result.headers.get('cache-control')).toBe('private, no-store'); expect(result.headers.get('vary')).toBe('Cookie, Authorization');
  });
  it('returns an explicit corrupt snapshot failure without rebuilding', async () => {
    mocks.context.mockResolvedValue({ db: { $transaction: (f: (tx: unknown) => unknown) => f({ $executeRaw: vi.fn() }) }, principal: { accountId: 'test' } }); mocks.read.mockRejectedValue(new InvalidStartSnapshot());
    const result = await executionHttp(new Request('http://localhost/workout'), 'ReadExecution', randomUUID());
    expect(result.status).toBe(422); expect(await result.json()).toEqual({ error: 'INVALID_START_SNAPSHOT' }); expect(mocks.start).not.toHaveBeenCalled();
  });
});

it('routes historical correction through its dedicated trusted write command', async () => {
  const db = {}, principal = { accountId: 'trusted' }, input = { commandType: 'CorrectHistoricalSetResult' };
  mocks.context.mockResolvedValue({ db, principal }); mocks.historical.mockResolvedValue({ outcome: { status: 'Accepted' } });
  const request = new Request('http://localhost/corrections', { method: 'POST', body: JSON.stringify(input) });
  expect((await executionHttp(request, 'CorrectHistoricalSetResult')).status).toBe(200);
  expect(mocks.context).toHaveBeenCalledWith(request, 'write'); expect(mocks.historical).toHaveBeenCalledWith(db, principal, input);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
});

it('routes discard through trusted write context without redirecting identity', async () => {
  const db = {}, principal = { accountId: 'trusted' }, input = { commandType: 'DiscardEmptyExecution' };
  mocks.context.mockResolvedValue({ db, principal }); mocks.discard.mockResolvedValue({ outcome: { status: 'Accepted' } });
  const request = new Request('http://localhost/discard', { method: 'POST', body: JSON.stringify(input) });
  expect((await executionHttp(request, 'DiscardEmptyExecution')).status).toBe(200);
  expect(mocks.context).toHaveBeenCalledWith(request, 'write'); expect(mocks.discard).toHaveBeenCalledWith(db, principal, input);
  expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
});

it.each([['Accepted',200],['Conflict',409],['Rejected',422]])('routes skip through trusted write context: %s', async(status,code)=>{
  const db={},principal={accountId:'trusted'},input={commandType:'SkipOccurrence'};
  mocks.context.mockResolvedValue({db,principal});mocks.skip.mockResolvedValue({outcome:{status}});
  const request=new Request('http://localhost/skip',{method:'POST',body:JSON.stringify(input)});
  expect((await executionHttp(request,'SkipOccurrence')).status).toBe(code);
  expect(mocks.context).toHaveBeenCalledWith(request,'write');expect(mocks.skip).toHaveBeenCalledWith(db,principal,input);
  expect(mocks.start).not.toHaveBeenCalled();expect(mocks.discard).not.toHaveBeenCalled();
});
import { readExecutionWithPrevious } from './previous-performance';
import { createHypertrophyPlan } from '../../engine/trainer2/plan-builder';
import type { ExecutionRead } from '../../trainer2-contracts/execution';
import type { Prisma } from '@prisma/client';

it('reads latest corrected exercise summaries in finished-date order with exact account and cutoff', async () => {
  const p = createHypertrophyPlan().occurrences[0].positions[0];
  const currentId = randomUUID(), sourceId = randomUUID(), ownedTarget = randomUUID();
  const current = { executionId: currentId, lifecycle: 'Open', results: [], initial: { positions: [], startedAt: '2026-09-15T12:00:00.000Z', occurrence: { positions: [p] } } } as unknown as ExecutionRead;
  const result = { targetId: ownedTarget, version: 2, result: { reps: { value: 8, basis: 'total' }, measurement: { kind: 'externalLoad', value: '70', unit: 'kg', convention: 'barbellTotal', zeroMeaning: 'validZero' }, rir: '2' } };
  const prior = { executionId: sourceId, lifecycle: 'Finished', finish: { finishedAt: '2026-09-14T12:00:00.000Z' }, initial: { occurrence: { name: 'Previous workout', positions: [p] }, positions: [{ sourcePositionId: p.id, targets: [{ id: ownedTarget }] }] }, results: [result] };
  const candidates = vi.fn().mockResolvedValue([{ executionId: sourceId }]);
  const tx = { trainer2ExecutionFinish: { findMany: candidates } } as unknown as Prisma.TransactionClient;
  const principal = { accountId: 'trusted', issuer: 'test', subject: 'test' };
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(prior);
  const read = await readExecutionWithPrevious(tx, principal, currentId);
  expect(candidates).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'trusted', executionId: { not: currentId }, finishedAt: { lte: new Date(current.initial.startedAt) } } }));
  expect(read?.previous?.[0]).toMatchObject({ positionId: p.id, executionId: sourceId, workoutName: 'Previous workout', results: [result] });
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce({ ...prior, initial: { ...prior.initial, occurrence: { ...prior.initial.occurrence, positions: [p, { ...p, id: randomUUID() }] } } });
  expect((await readExecutionWithPrevious(tx, principal, currentId))?.previous).toEqual([]);
  mocks.read.mockResolvedValueOnce({ ...current, lifecycle: 'Discarded' });
  expect((await readExecutionWithPrevious(tx, principal, currentId))?.previous).toEqual([]);
  expect(candidates).toHaveBeenCalledTimes(2);
});
