import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ownedProcessTree, terminateOwnedProcesses, waitForWorker, settleBrowserTree, cleanupSteps, type BrowserOwnership } from './trainer2/disposable-cleanup';

async function main() {
  assert.deepEqual(process.argv.slice(2), ['--confirm-disposable']);
  const output = resolve('artifacts/real-access-fixes', `controller-${Date.now()}`); mkdirSync(output, { recursive: true });
  const definition = resolve('scripts/test-trainer2-real-access.ts');
  const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), definition, '--confirm-disposable'],
    { windowsHide: true, env: { ...process.env, REVIEW_BROWSER: '1', REVIEW_BROWSER_ONLY: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const ownerships: BrowserOwnership[] = [];
  child.on('message', (message: { kind?: string; ownership?: BrowserOwnership }) => { if (message.kind === 'browser-ownership' && message.ownership) ownerships.push(message.ownership); });
  let log = ''; child.stdout!.on('data', value => { log += value; process.stdout.write(value); });
  child.stderr!.on('data', value => { log += value; process.stderr.write(value); });
  const result = await waitForWorker(child, 15 * 60_000);
  if (result.timedOut && child.pid) {
    const cleanup = await cleanupSteps([
      ...ownerships.map(ownership => ({ name: 'orphan browser', run: () => settleBrowserTree(ownership, 'terminate') })),
      { name: 'worker tree', run: () => terminateOwnedProcesses(ownedProcessTree(child.pid!, definition)) },
      { name: 'worker pipes', run: () => { for (const stream of child.stdio) stream?.destroy(); } },
    ]);
    writeFileSync(resolve(output, 'timeout-cleanup.json'), JSON.stringify(cleanup, null, 2));
  }
  writeFileSync(resolve(output, 'worker.log'), log);
  writeFileSync(resolve(output, 'runner.json'), JSON.stringify({ observedWorkerClose: result, pid: child.pid }, null, 2));
  process.exitCode = result.exitCode === 0 && !result.timedOut && !result.error ? 0 : 1;
  process.once('exit', exitCode => writeFileSync(resolve(output, 'controller-exit.json'), JSON.stringify({ exitCode })));
}
void main().catch(error => { console.error(String(error)); process.exitCode = 1; });
