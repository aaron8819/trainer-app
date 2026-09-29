import { afterEach, expect, it, vi } from 'vitest';
import { fetchWithRecovery } from './request-recovery';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('replays identical command bytes after transient failures with a bounded backoff', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response('ok'));
  vi.stubGlobal('fetch', fetch);
  const init = { method: 'POST', body: '{"actionId":"same","expected":1}' };
  const promise = fetchWithRecovery('/results', init, () => true);
  await vi.runAllTimersAsync(); expect((await promise).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls.every(c => c[1] === init)).toBe(true);
});
it.each([400, 401, 403, 409, 422, 500])('does not retry a definitive %s response', async status => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status })); vi.stubGlobal('fetch', fetch);
  expect((await fetchWithRecovery('/results', {}, () => true)).status).toBe(status);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('returns exhausted transient failures for manual recovery', async () => {
  vi.useFakeTimers(); const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 503 })));
  vi.stubGlobal('fetch', fetch); const pending = fetchWithRecovery('/results', {}, () => true);
  await vi.runAllTimersAsync(); expect((await pending).status).toBe(503); expect(fetch).toHaveBeenCalledTimes(3);
});
it('does not retry after the owning execution is replaced', async () => {
  vi.useFakeTimers(); let current = true;
  const fetch = vi.fn().mockImplementation(() => { current = false; return Promise.resolve(new Response('', { status: 503 })); });
  vi.stubGlobal('fetch', fetch); const pending = fetchWithRecovery('/results', {}, () => current);
  const rejected = expect(pending).rejects.toThrow('Request superseded');
  await vi.runAllTimersAsync(); await rejected; expect(fetch).toHaveBeenCalledTimes(1);
});
