import { request } from 'node:http';

/** Qualification-only transport: connect to the owned listener, preserving the public Host. */
export function artifactGet(
  origin: string, path: string, host: string, timeoutMs = 10_000,
): Promise<Response> {
  const target = new URL(origin);
  if (target.protocol !== 'http:' || target.hostname !== 'localhost' ||
    target.origin !== origin || !target.port || !path.startsWith('/'))
    throw new Error('Invalid owned artifact transport');
  return new Promise((resolve, reject) => {
    const fail = (cause: unknown): void => reject(new Error('Artifact HTTP request failed', { cause }));
    const outgoing = request({ hostname: 'localhost', port: target.port, path, method: 'GET',
      headers: { Host: host }, agent: false, signal: AbortSignal.timeout(timeoutMs) }, incoming => {
      const chunks: Buffer[] = []; let bytes = 0;
      incoming.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) {
          outgoing.destroy(new Error('Artifact response exceeds bounded body size'));
        } else chunks.push(chunk);
      });
      incoming.once('error', fail);
      incoming.once('aborted', () => fail(new Error('Artifact response aborted')));
      incoming.once('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) for (const item of value) headers.append(name, item);
          else if (value !== undefined) headers.set(name, value);
        }
        const status = incoming.statusCode;
        if (!status) { fail(new Error('Artifact status missing')); return; }
        resolve(new Response([204, 205, 304].includes(status) ? null :
          new Uint8Array(Buffer.concat(chunks)), { status, headers }));
      });
    });
    outgoing.once('error', fail);
    outgoing.end();
  });
}
