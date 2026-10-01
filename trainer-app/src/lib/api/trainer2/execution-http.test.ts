import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { executionHttp } from './execution-http';
import { InvalidStartSnapshot } from './execution';
const mocks = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn(), next: vi.fn(), start: vi.fn(), save: vi.fn(), finish: vi.fn(), historical: vi.fn(), discard: vi.fn(), skip: vi.fn(), skipSet: vi.fn() }));
vi.mock('./access', () => ({ requestContext: mocks.context }));
vi.mock('./skip-set', () => ({ skipSet: mocks.skipSet }));
vi.mock('./skip-occurrence', () => ({ skipOccurrence: mocks.skip }));
vi.mock('./discard-execution', () => ({ discardEmptyExecution: mocks.discard }));
vi.mock('./workout-finish', () => ({ finishExecution: mocks.finish }));
vi.mock('./set-results', () => ({ saveSetResult: mocks.save, correctHistoricalSetResult: mocks.historical }));
vi.mock('./execution', async importOriginal => ({ ...await importOriginal<typeof import('./execution')>(), readExecution: mocks.read, readNextWorkout: mocks.next, startOccurrence: mocks.start }));
afterEach(() => vi.resetAllMocks());
describe('execution HTTP boundary', () => {
  it('logs bounded failure metadata without exception text or submitted secrets', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.context.mockRejectedValue(Object.assign(new Error('postgresql://secret-password cookie-secret'), { code: 'P2028', cause: { code: '08006' } }));
      const result = await executionHttp(new Request('http://localhost/results'), 'SaveSetResult');
      expect(result.status).toBe(503);
      expect(log).toHaveBeenCalledWith('trainer2_execution_failed', { operation: 'SaveSetResult', stage: 'admission', elapsedMs: expect.any(Number), code: 'P2028', causeCode: '08006', errorType: 'Error' });
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
      expect(await result.json()).toEqual({ error: 'EXECUTION_TRANSACTION_FAILED', retry: 'Retry the same action envelope' });
    } finally { log.mockRestore(); }
  });
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
  it.each(['SkipSet', 'StartOccurrence', 'SaveSetResult', 'FinishExecution', 'CorrectHistoricalSetResult', 'DiscardEmptyExecution'] as const)('retains the per-command body bound for %s', async operation => {
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
  const principal = { accountId: 'trusted', sessionId: 'fixture-session' };
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(prior);
  const read = await readExecutionWithPrevious(tx, principal, currentId);
  expect(candidates).toHaveBeenCalledWith(expect.objectContaining({ where: { accountId: 'trusted', executionId: { not: currentId }, finishedAt: { lte: new Date(current.initial.startedAt) } } }));
  expect(read?.previous?.[0]).toMatchObject({ positionId: p.id, executionId: sourceId, workoutName: 'Previous workout', results: [result] });
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce({ ...prior, initial: { ...prior.initial, occurrence: { ...prior.initial.occurrence, positions: [p, { ...p, id: randomUUID() }] } } });
  const ambiguous = await readExecutionWithPrevious(tx, principal, currentId);
  expect(ambiguous?.previous).toEqual([]);
  expect(ambiguous?.firstSetLoads).toEqual([]);
  mocks.read.mockResolvedValueOnce({ ...current, lifecycle: 'Discarded' });
  expect((await readExecutionWithPrevious(tx, principal, currentId))?.previous).toEqual([]);
  expect(candidates).toHaveBeenCalledTimes(2);
});

it('includes performed session additions in comparable history and historical load fallback', async () => {
  const p=createHypertrophyPlan().occurrences[0].positions[0],positionId=randomUUID(),targetId=randomUUID();
  const current={executionId:randomUUID(),lifecycle:'Open',results:[],initial:{positions:[],startedAt:'2026-10-01T12:00:00.000Z',occurrence:{positions:[p]}}} as unknown as ExecutionRead;
  const result={targetId,version:1,result:{reps:{value:8,basis:'total'},measurement:{kind:'externalLoad',value:'12.50',unit:'lb',convention:'barbellTotal',zeroMeaning:'validZero'},rir:'2'}};
  const prior={executionId:randomUUID(),lifecycle:'Finished',finish:{finishedAt:'2026-09-30T12:00:00.000Z'},
    initial:{occurrence:{name:'Previous workout',positions:[p]},positions:[{id:positionId,sourcePositionId:p.id,targets:p.targets.map(t=>({id:randomUUID(),sourceTargetId:t.id}))}]},results:[result],
    additions:[{content:{positionId,ordinal:p.targets.length+1,target:{...p.targets[0],id:targetId}}}]} as unknown as ExecutionRead;
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(prior);
  const tx={trainer2ExecutionFinish:{findMany:vi.fn().mockResolvedValue([{executionId:prior.executionId}])}} as unknown as Prisma.TransactionClient;
  const read=await readExecutionWithPrevious(tx,{accountId:'trusted',sessionId:'fixture-session'},current.executionId);
  expect(read?.previous?.[0].results).toEqual([result]);expect(read?.firstSetLoads?.[0].result).toEqual(result);
});

it('selects the latest eligible workout and first corrected working mass in saved order without requiring reps', async () => {
  const p = createHypertrophyPlan().occurrences[0].positions[0];
  p.targets = [p.targets[0], { ...p.targets[0], id: randomUUID() }, { ...p.targets[0], id: randomUUID() }];
  p.targets[0] = { ...p.targets[0], classification: 'rampUp' };
  const make = (load: string, convention = 'barbellTotal') => ({ result: { reps: null, rir: null, measurement: { kind: 'externalLoad', value: load, unit: 'lb', convention, zeroMeaning: 'validZero' } }, version: 2 });
  const owned = p.targets.map(t => ({ id: randomUUID(), sourceTargetId: t.id }));
  const current = { executionId: randomUUID(), lifecycle: 'Open', results: [], initial: { positions: [], startedAt: '2026-09-16T12:00:00.000Z', occurrence: { positions: [p] } } } as unknown as ExecutionRead;
  const makeSource = (id: string, convention: string) => ({ executionId: id, lifecycle: 'Finished', finish: { finishedAt: '2026-09-15T12:00:00.000Z' }, initial: { occurrence: { name: 'History', positions: [p] }, positions: [{ sourcePositionId: p.id, targets: owned }] }, results: [2, 0, 1].map(i => ({ ...make(String(100 + i), convention), targetId: owned[i].id })) });
  const invalidId = randomUUID(), eligibleId = randomUUID(), olderId = randomUUID();
  const candidates = vi.fn().mockResolvedValue([invalidId, eligibleId, olderId].map(executionId => ({ executionId })));
  const tx = { trainer2ExecutionFinish: { findMany: candidates } } as unknown as Prisma.TransactionClient;
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(makeSource(invalidId, 'perImplement')).mockResolvedValueOnce(makeSource(eligibleId, 'barbellTotal')).mockResolvedValueOnce(makeSource(olderId, 'barbellTotal'));
  const read = await readExecutionWithPrevious(tx, { accountId: 'trusted', sessionId: 'fixture-session' }, current.executionId);
  expect(read?.firstSetLoads).toEqual([{ positionId: p.id, executionId: eligibleId, result: expect.objectContaining({ targetId: owned[1].id, version: 2, result: expect.objectContaining({ measurement: expect.objectContaining({ value: '101' }) }) }) }]);
});

it.each([['original', false], ['reversed', true], ['equal loads', false]])('omits prefill and displayed history for ambiguous %s exercise occurrences', async (label, reversed) => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  const other = { ...position, id: randomUUID(), targets: position.targets.map(t => ({ ...t, id: randomUUID() })) };
  const positions = reversed ? [other, position] : [position, other];
  const loads = positions.map(p => label === 'equal loads' ? '100' : p.id === position.id ? '100' : '200');
  const current = { executionId: randomUUID(), lifecycle: 'Open', results: [], initial: { positions: [], startedAt: '2026-09-16T12:00:00.000Z', occurrence: { positions: [position] } } } as unknown as ExecutionRead;
  const sourceId = randomUUID();
  const owned = positions.map(p => ({ sourcePositionId: p.id, targets: [{ id: randomUUID(), sourceTargetId: p.targets[0].id }] }));
  const source = { executionId: sourceId, lifecycle: 'Finished', finish: { finishedAt: '2026-09-15T12:00:00.000Z' }, initial: { occurrence: { name: 'History', positions }, positions: owned },
    results: owned.map((p, i) => ({ executionId: sourceId, targetId: p.targets[0].id, version: 2, result: { reps: { value: 8, basis: position.exercise.kind === 'catalogSnapshot' ? position.exercise.repBasis : 'total' }, measurement: { kind: 'externalLoad', value: loads[i], unit: 'lb', convention: 'barbellTotal', zeroMeaning: 'validZero' }, rir: null } })) };
  const tx = { trainer2ExecutionFinish: { findMany: vi.fn().mockResolvedValue([{ executionId: sourceId }]) } } as unknown as Prisma.TransactionClient;
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(source);
  const read = await readExecutionWithPrevious(tx, { accountId: 'trusted', sessionId: 'fixture-session' }, current.executionId);
  expect(read?.firstSetLoads).toEqual([]);
  expect(read?.previous).toEqual([]);
});

it('does not search an older workout past an ambiguous compatible occurrence', async () => {
  const position = createHypertrophyPlan().occurrences[0].positions[0];
  const duplicate = { ...position, id: randomUUID() };
  const current = { executionId: randomUUID(), lifecycle: 'Open', results: [], initial: { positions: [], startedAt: '2026-09-16T12:00:00.000Z', occurrence: { positions: [position] } } } as unknown as ExecutionRead;
  const source = { executionId: randomUUID(), lifecycle: 'Finished', finish: { finishedAt: '2026-09-15T12:00:00.000Z' }, initial: { occurrence: { name: 'Ambiguous', positions: [position, duplicate] }, positions: [] }, results: [] };
  const older = { ...source, executionId: randomUUID(), initial: { ...source.initial, occurrence: { name: 'Older', positions: [position] } } };
  const tx = { trainer2ExecutionFinish: { findMany: vi.fn().mockResolvedValue([{ executionId: source.executionId }, { executionId: older.executionId }]) } } as unknown as Prisma.TransactionClient;
  mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(source);
  const read = await readExecutionWithPrevious(tx, { accountId: 'trusted', sessionId: 'fixture-session' }, current.executionId);
  expect(read?.firstSetLoads).toEqual([]);
  expect(read?.previous).toEqual([]);
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it.each([['Accepted', 200], ['Conflict', 409], ['Rejected', 422]])('routes set skip %s through trusted writes', async (status, httpStatus) => {
  const db = {}, principal = { accountId: 'trusted' }, input = { commandType: 'SkipSet' };
  mocks.context.mockResolvedValue({ db, principal }); mocks.skipSet.mockResolvedValue({ outcome: { status } });
  const request = new Request('http://localhost/skip-set', { method: 'POST', body: JSON.stringify(input) });
  expect((await executionHttp(request, 'SkipSet')).status).toBe(httpStatus);
  expect(mocks.context).toHaveBeenCalledWith(request, 'write'); expect(mocks.skipSet).toHaveBeenCalledWith(db, principal, input);
  expect(mocks.skip).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});


it('blocks SkipSet at the central maintenance gate before opening a write context', async () => {
  vi.stubEnv('TRAINER_WRITE_PAUSE', 'enabled');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    const { POST } = await import('../../../app/api/trainer2/executions/skip-set/route');
    const response = await POST(new Request('http://localhost/api/trainer2/executions/skip-set', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('PRODUCTION_WRITE_PAUSED');
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.skipSet).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    warning.mockRestore();
  }
});


it('delegates admitted SkipSet requests through the registered route', async () => {
  vi.stubEnv('TRAINER_WRITE_PAUSE', '');
  try {
    mocks.context.mockResolvedValue({ db: {}, principal: { accountId: 'trusted' } });
    mocks.skipSet.mockResolvedValue({ outcome: { status: 'Accepted' } });
    const { POST } = await import('../../../app/api/trainer2/executions/skip-set/route');
    const response = await POST(new Request('http://localhost/api/trainer2/executions/skip-set', { method: 'POST', body: '{"commandType":"SkipSet"}' }));
    expect(response.status).toBe(200);
    expect(mocks.skipSet).toHaveBeenCalledOnce();
  } finally { vi.unstubAllEnvs(); }
});
