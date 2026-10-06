import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, win32 } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { authWebPlatformEnvironment } from './auth-web-environment';
import { captureNativeBrowserOwnership, cleanupSteps, settleBrowserTree, shutdownOwnedBrowser, waitForWorker, type BrowserOwnership } from './disposable-cleanup';
import { finishQualification } from './qualification-report';

/** Native disk profile; no storageState export/import substitutes for persistence.
 * The pinned native launcher observes browser exit without Node browser pipes.
 */
export async function openPersistentBrowser(profile: string, viewport: { width: number; height: number }, record: (result: Record<string, unknown>) => void) {
  mkdirSync(profile, { recursive: true });
  const executable = win32.normalize(chromium.executablePath().replace(/chromium-(\d+)[\\/]chrome-win64[\\/]chrome\.exe$/, 'chromium_headless_shell-$1/chrome-headless-shell-win64/chrome-headless-shell.exe'));
  assert(executable !== chromium.executablePath() && existsSync(executable), 'Pinned headless-shell unavailable');
  const launcher = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/trainer2/persistent-browser-launcher.ps1'), '-Executable', executable, '-Profile', profile],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...authWebPlatformEnvironment(process.env), NODE_ENV: 'test',
      PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') } });
  const completion = waitForWorker(launcher, 16 * 60_000);
  let nativeExit: { exited: boolean; exitCode: number | null } | undefined;
  let output = '', stderr = '';
  launcher.stdout?.on('data', value => {
    output += value;
    for (const line of String(value).trim().split(/\r?\n/)) {
      try { const receipt = JSON.parse(line); record(receipt); if (receipt.event === 'native-exit') nativeExit = receipt; } catch { /* Partial line is consumed from output below. */ }
    }
  });
  launcher.stderr?.on('data', value => { stderr += value; });
  let ownership: BrowserOwnership | undefined;
  let browser: Browser | undefined;
  let closed = false;
  let nativeShutdown: { forceFallback: boolean } | undefined;
  async function close() {
    if (closed) return;
    const results = await cleanupSteps([
      { name: 'browser connection disposal', run: () => browser?.close() },
      { name: 'native browser shutdown', timeoutMs: 12_000, run: async () => {
        assert(ownership, 'Browser ownership unqualified');
        const result = await shutdownOwnedBrowser({ close: async () => {
          // Use a separate CDP client after the qualification client disconnects.
          const [port, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
          const closingBrowser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${path}`, { timeout: 5000 });
          const cdp = await closingBrowser.newBrowserCDPSession();
          try { await cdp.send('Browser.close'); } catch (error) { if (!/closed/i.test(String(error))) throw error; }
          finally { await closingBrowser.close(); }
          const result = await completion; assert(!result.timedOut && !result.error, 'Native launcher close unobserved');
        } }, ownership, record);
        nativeShutdown = result; record({ event: 'native-shutdown', ...result });
      } },
      { name: 'qualified browser absence', run: () => { assert(ownership); return settleBrowserTree(ownership, 'observe', record); } },
      { name: 'native exit and launcher close', timeoutMs: 5000, run: async () => {
        const result = await completion;
        assert(!result.timedOut && !result.error && result.exitCode === 0, 'Native launcher failed to close');
        for (const line of output.trim().split(/\r?\n/)) { const receipt = JSON.parse(line); if (receipt.event === 'native-exit') nativeExit = receipt; }
        assert(nativeExit?.exited, 'Native browser exit unobserved');
        if (!nativeShutdown?.forceFallback) assert.equal(nativeExit.exitCode, 0, 'Unexpected native browser exit');
        record({ event: 'launcher-child-close', ...result, nativeExit });
      } },
      { name: 'launcher pipes', run: () => { for (const stream of launcher.stdio) stream?.destroy(); } },
    ]);
    record({ event: 'profile-cleanup', profile, results, stderr });
    closed = results.every(result => result.status === 'passed'); finishQualification(undefined, results);
  }
  try {
    const deadline = Date.now() + 30_000;
    let launch: { rootPid: number; runnerPid: number; executable: string; profile: string } | undefined;
    while (Date.now() < deadline) {
      for (const line of output.trim().split(/\r?\n/).filter(Boolean)) { try { const value = JSON.parse(line); if (value.event === 'native-launch') launch = value; } catch {} }
      if (launch && existsSync(join(profile, 'DevToolsActivePort'))) break;
      assert.equal(launcher.exitCode, null, 'Native launcher exited before readiness');
      await new Promise(r => setTimeout(r, 100));
    }
    assert(launch, 'Native launch receipt unavailable');
    ownership = await captureNativeBrowserOwnership({ rootPid: launch.rootPid, runnerPid: launch.runnerPid, executable: launch.executable, profile: launch.profile }, value => { if (value.ownership) ownership = value.ownership as BrowserOwnership; record(value); }); process.send?.({ kind: 'browser-ownership', ownership });
    const [port, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
    browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}${path}`, { timeout: 30_000 });
    const context = browser.contexts()[0]; assert(context, 'Missing native persistent context');
    const page = await context.newPage(); await page.setViewportSize(viewport);
    return { context, page, ownership, close };
  } catch (primary) {
    const cleanup = await cleanupSteps([{ name: 'failed profile startup', timeoutMs: 45_000, run: close }]);
    finishQualification(primary, cleanup); throw primary;
  }
}
