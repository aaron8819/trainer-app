import { performance } from 'node:perf_hooks';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Already a repository dependency. Parse without executing scripts or fetching
// resources: strings in Next's scripts/error payloads are not page elements.
const { JSDOM, VirtualConsole } = createRequire(resolve('package.json'))('jsdom') as {
  JSDOM: new (html: string, options: { virtualConsole: object }) => { window: { document: Document; close(): void } };
  VirtualConsole: new () => object;
};
function successfulAuthPage(body: string): boolean {
  if (!/^<!doctype html>/i.test(body) || !/<\/body>\s*<\/html>\s*$/i.test(body)) return false;
  const dom = new JSDOM(body, { virtualConsole: new VirtualConsole() });
  try {
    const doc = dom.window.document, main = doc.querySelector('body main');
    const heading = main?.querySelector('h1'), state = main?.querySelector('p');
    const form = main?.querySelector('form[action="/trainer2/auth/sign-in"][method="post"]');
    const input = form?.querySelector('input[name="passcode"][type="password"][required][minlength="12"][maxlength="128"][autocomplete="current-password"]');
    const submit = form?.querySelector('button[type="submit"]');
    return !!(heading?.textContent === 'Trainer2 sign in' && state?.textContent === 'Signed out.' &&
      input?.closest('label')?.textContent?.trim() === 'Passcode' && submit?.textContent === 'Sign in' &&
      !main?.closest('[hidden], [aria-hidden="true"]') && !main?.querySelector('[hidden], [aria-hidden="true"], [disabled]') &&
      !doc.querySelector('[data-next-error-message], #__next_error__'));
  } finally { dom.window.close(); }
}

// The former 120 * (2s request + 0.5s pause) budget was 300s, but each
// abort interrupted cold compilation/rendering. Keep that total bound while
// allowing one connected request to finish; retry only connection refusal.
export async function observeWebReadiness(base: string, child: ChildProcess, record: (row: Record<string, unknown>) => void,
  { key, budgetMs = 300_000 }: { key: string; budgetMs?: number }) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error('Invalid readiness budget');
  if (!/^[a-f0-9]{64}$/.test(key) || !child.pid) throw new Error('Missing task readiness identity');
  const origin = new URL(base);
  if (origin.origin !== base || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') throw new Error('Invalid task readiness origin');
  const start = performance.now(), deadline = start + budgetMs;
  const abort = new AbortController();
  const exited = () => abort.abort(new Error('Task web exited during readiness'));
  child.once('exit', exited);
  const timer = setTimeout(() => abort.abort(new Error('Task web readiness deadline exceeded')), budgetMs);
  let attempt = 0;
  try {
    while (performance.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        record({ failure: 'Task web exited during readiness', launcherPid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode });
        throw new Error('Task web exited during readiness');
      }
      const started = performance.now();
      const challenge = randomBytes(16).toString('hex');
      const row: Record<string, unknown> = { attempt, challenge, startedAt: new Date().toISOString(), launcherPid: child.pid, origin: base, budgetMs, remainingMs: deadline - started };
      try {
        const response = await fetch(base + '/trainer2/auth?readiness=' + challenge, { signal: abort.signal, redirect: 'manual' });
        const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
        const reportedPid = response.headers.get('x-trainer2-readiness-pid') ?? '';
        const proof = response.headers.get('x-trainer2-readiness-proof');
        const instanceMatched = /^[1-9]\d*$/.test(reportedPid) && Number.isSafeInteger(Number(reportedPid)) &&
          proof === createHmac('sha256', key).update(challenge + '\n' + child.pid + '\n' + reportedPid).digest('hex');
        Object.assign(row, { status: response.status, headersMs: performance.now() - started,
          htmlContentType: contentType === 'text/html', redirect: response.headers.has('location'), instanceMatched,
          responderPid: instanceMatched ? Number(reportedPid) : null });
        if (response.status !== 200 || response.headers.has('location')) throw new Error('Task web readiness unsuccessful response');
        if (!instanceMatched) throw new Error('Task web readiness instance mismatch');
        if (contentType !== 'text/html') throw new Error('Task web readiness content type mismatch');
        const body = await response.text();
        const authPageMatched = successfulAuthPage(body);
        Object.assign(row, { elapsedMs: performance.now() - started, bytes: Buffer.byteLength(body), bodyHash: createHash('sha256').update(body).digest('hex'), authPageMatched, exitCode: child.exitCode, signalCode: child.signalCode });
        record(row);
        if (!authPageMatched) throw new Error('Task web readiness auth page mismatch');
        if (child.exitCode !== null || child.signalCode !== null) throw new Error('Task web exited during readiness');
        if (performance.now() > deadline) throw new Error('Task web readiness deadline exceeded');
        if (abort.signal.aborted) throw abort.signal.reason;
        return;
      } catch (error) {
        const code = (error as {cause?: {code?: string}}).cause?.code;
        record({ ...row, elapsedMs: performance.now() - started, failure: error instanceof Error && error.message.startsWith('Task web ') ? error.message : 'Task web readiness request failed', errorName: (error as Error).name, errorCode: code });
        if (code !== 'ECONNREFUSED' || abort.signal.aborted) throw error;
      }
      attempt++;
      await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, deadline - performance.now()))));
    }
    throw new Error('Task web readiness deadline exceeded');
  } finally { abort.abort(); clearTimeout(timer); child.off('exit', exited); }
}
