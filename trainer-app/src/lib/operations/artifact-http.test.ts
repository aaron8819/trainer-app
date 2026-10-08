// @vitest-environment node
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('node:http', () => ({ request: fixture.request }));
import { artifactGet } from '../../../scripts/trainer2/artifact-http';

beforeEach(() => { fixture.request.mockReset(); });
afterEach(() => vi.restoreAllMocks());
function reply(statusCode: number, body: Buffer, headers: Record<string, string>): void {
  fixture.request.mockImplementation((_options: RequestOptions,
    callback: (message: IncomingMessage) => void) => {
    const incoming = Object.assign(new PassThrough(), { statusCode, headers });
    return Object.assign(new EventEmitter(), { end: () => {
      callback(incoming as unknown as IncomingMessage); incoming.end(body);
    } });
  });
}

it('sends the exact requested Host to the owned listener and preserves redirects without following',
  async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    reply(307, Buffer.from('redirect body'), { location: '/trainer2/auth',
      'cache-control': 'private, no-store' });
    const response = await artifactGet('http://localhost:43000', '/?view=program',
      'production-artifact.example.test');
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(fixture.request.mock.calls[0][0]).toMatchObject({ hostname: 'localhost', port: '43000',
      path: '/?view=program', method: 'GET', agent: false,
      headers: { Host: 'production-artifact.example.test' } });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/trainer2/auth');
    expect(await response.text()).toBe('redirect body');
  });

it('preserves wrong-host probes, status and binary icon bodies', async () => {
  const bytes = Buffer.from([0, 255, 128, 1]);
  reply(404, bytes, { 'content-type': 'image/png' });
  const response = await artifactGet('http://localhost:43000', '/icons/test.png', 'wrong.example.test');
  expect(fixture.request.mock.calls[0][0].headers).toEqual({ Host: 'wrong.example.test' });
  expect(response.status).toBe(404);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(bytes));
});

it('retains connection-refusal identity for the existing bounded readiness retry', async () => {
  const cause = Object.assign(new Error('synthetic refusal'), { code: 'ECONNREFUSED' });
  fixture.request.mockImplementation(() => {
    const outgoing = Object.assign(new EventEmitter(), {
      end: () => queueMicrotask(() => outgoing.emit('error', cause)),
    });
    return outgoing;
  });
  await expect(artifactGet('http://localhost:43000', '/', 'production-artifact.example.test'))
    .rejects.toMatchObject({ cause: { code: 'ECONNREFUSED' } });
});
