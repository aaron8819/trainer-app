import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';

// The former 120 * (2s request + 0.5s pause) budget was 300s, but each
// abort interrupted cold compilation/rendering. Keep that total bound while
// allowing one connected request to finish; retry only connection refusal.
export async function observeWebReadiness(base: string, child: ChildProcess, record: (row: Record<string, unknown>) => void, budgetMs = 300_000) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error('Invalid readiness budget');
  const start = performance.now(), deadline = start + budgetMs;
  const abort = new AbortController();
  const exited = () => abort.abort(new Error('Task web exited during readiness'));
  child.once('exit', exited);
  const timer = setTimeout(() => abort.abort(new Error('Task web readiness deadline exceeded')), budgetMs);
  let attempt = 0;
  try {
    while (performance.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Task web exited during readiness');
      const started = performance.now();
      const row: Record<string, unknown> = { attempt, startedAt: new Date().toISOString(), pid: child.pid, origin: base, budgetMs, remainingMs: deadline - started };
      try {
        const response = await fetch(base + '/trainer2/auth?readiness=' + child.pid + '-' + attempt, { signal: abort.signal, redirect: 'manual' });
        Object.assign(row, { status: response.status, headersMs: performance.now() - started, location: response.headers.get('location') ? new URL(response.headers.get('location')!, base).pathname : null });
        const body = await response.text();
        Object.assign(row, { elapsedMs: performance.now() - started, bytes: Buffer.byteLength(body), bodyHash: createHash('sha256').update(body).digest('hex'), authHeading: body.includes('Trainer2 sign in'), exitCode: child.exitCode, signalCode: child.signalCode });
        record(row);
        if (response.status !== 200 || !body.includes('Trainer2 sign in')) throw new Error('Task web readiness response did not match auth page');
        if (performance.now() > deadline) throw new Error('Task web readiness deadline exceeded');
        if (abort.signal.aborted) throw abort.signal.reason;
        return;
      } catch (error) {
        const code = (error as {cause?: {code?: string}}).cause?.code;
        record({ ...row, elapsedMs: performance.now() - started, errorName: (error as Error).name, errorCode: code });
        if (code !== 'ECONNREFUSED' || abort.signal.aborted) throw error;
      }
      attempt++;
      await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, deadline - performance.now()))));
    }
    throw new Error('Task web readiness deadline exceeded');
  } finally { clearTimeout(timer); child.off('exit', exited); }
}
