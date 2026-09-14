import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { executionHttp } from './execution-http';
import { InvalidStartSnapshot } from './execution';
const mocks = vi.hoisted(() => ({ context: vi.fn(), read: vi.fn(), next: vi.fn(), start: vi.fn() }));
vi.mock('./access', () => ({ requestContext: mocks.context }));
vi.mock('./execution', async importOriginal => ({ ...await importOriginal<typeof import('./execution')>(), readExecution: mocks.read, readNextWorkout: mocks.next, startOccurrence: mocks.start }));
afterEach(() => vi.resetAllMocks());
describe('execution HTTP boundary', () => {
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
