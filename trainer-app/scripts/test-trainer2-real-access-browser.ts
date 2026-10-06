import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from '@playwright/test';
import { authWebPlatformEnvironment, authWebEnvironmentProbe } from './trainer2/auth-web-environment';

export async function browserReview(input: { accountId: string; passcode: string; setupCode: string; staleCookie: string; identityUrl: string; readUrl: string; writeUrl: string; record: (name: string, result?: unknown) => void }) {
  const output = resolve(`artifacts/real-access-fixes/browser-${Date.now()}`); mkdirSync(output, { recursive: true });
  const listener = createServer(); await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
  const port = (listener.address() as { port: number }).port; await new Promise<void>(r => listener.close(() => r()));
  const origin = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = { ...authWebPlatformEnvironment(process.env), NODE_ENV: 'development', TRAINER2_LOCAL_DRAFTS: 'enabled', TRAINER2_APP_ORIGIN: origin, TRAINER2_OWNER_USER_ID: input.accountId, TRAINER2_IDENTITY_CONNECTION_STRING: input.identityUrl, TRAINER2_READ_CONNECTION_STRING: input.readUrl, TRAINER2_WRITE_CONNECTION_STRING: input.writeUrl };
  const bootstrap = resolve(output, 'server.cjs'); writeFileSync(bootstrap, authWebEnvironmentProbe(Object.keys(env)));
  let server: ChildProcess | undefined;
  async function start() {
    const log = openSync(resolve(output, 'server.log'), 'a');
    const startedServer = spawn(process.execPath, [bootstrap, 'dev', '--webpack', '-p', String(port)], { env, windowsHide: true, stdio: ['ignore', log, log] });
    server = startedServer;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      assert.equal(startedServer.exitCode, null, 'Owned Next process exited');
      try { const response = await fetch(origin + '/trainer2/auth', { signal: AbortSignal.timeout(45000) }); if (response.ok && (await response.text()).includes('Trainer2 sign in')) return; } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Owned Next readiness timed out');
  }
  function stop() { if (server?.pid && server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 }); server = undefined; }
  const profiles = ['desktop', 'phone-sized'];
  let contexts: Awaited<ReturnType<typeof chromium.launchPersistentContext>>[] = [];
  async function closeContext(context: typeof contexts[number]) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([context.close(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('OWNED_BROWSER_CLOSE_TIMEOUT')), 15000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  async function openProfile(profile: string, signIn: boolean) {
    const context = await chromium.launchPersistentContext(resolve(output, profile), { channel: 'msedge', headless: true, viewport: profile === 'desktop' ? { width: 1360, height: 900 } : { width: 390, height: 844 } });
    contexts.push(context); const page = await context.newPage();
    await page.goto(origin + '/trainer2/auth', { timeout: 60000 });
    if (signIn) {
      const setup = await page.locator('input[name="setupCode"]').count() > 0;
      if (setup) await page.locator('input[name="setupCode"]').fill(input.setupCode);
      await page.locator('input[name="passcode"]').fill(input.passcode); await page.getByRole('button', { name: setup ? 'Set passcode' : 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Training', exact: true }).waitFor({ timeout: 60000 });
      assert.equal(new URL(page.url()).pathname, '/trainer2');
      await page.goto(origin + '/trainer2/auth');
    }
    await page.getByText('Signed in.', { exact: true }).waitFor({ timeout: 60000 });
    const cookie = (await context.cookies()).find(c => c.name === '__Host-trainer2-session'); assert(cookie);
    assert(cookie.httpOnly && cookie.secure && cookie.sameSite === 'Lax' && cookie.path === '/' && cookie.expires > Date.now() / 1000);
    await page.reload(); await page.getByText('Signed in.', { exact: true }).waitFor();
    return { context, page, sessionId: cookie.value.split('.')[0] };
  }
  try {
    await start(); const desktop = await openProfile(profiles[0], true), phone = await openProfile(profiles[1], true);
    assert.notEqual(desktop.sessionId, phone.sessionId);
    // Inspect the no-plan landing without entering inputs or submitting any training command.
    await desktop.page.goto(origin + '/trainer2/dev/drafts', { timeout: 60000 });
    await desktop.page.getByRole('heading', { name: 'Training', exact: true }).waitFor({ timeout: 60000 });
    await desktop.page.getByText('You have no plan yet.', { exact: true }).waitFor();
    assert.equal(await desktop.page.locator('input,select,textarea').count(), 0);
    assert.equal(await desktop.page.getByRole('link', { name: 'Create plan', exact: true }).getAttribute('href'), '/trainer2/dev/drafts?view=builder');
    await desktop.page.reload(); await desktop.page.getByRole('heading', { name: 'Training', exact: true }).waitFor();
    await desktop.page.screenshot({ path: resolve(output, 'empty-owner-landing.png'), fullPage: true });
    input.record('empty-owner-training-home-reload-explicit-create-action-no-builder-inputs');
    await Promise.all(contexts.map(closeContext)); contexts = []; stop(); await new Promise(r => setTimeout(r, 1500)); await start();
    const restartedDesktop = await openProfile(profiles[0], false), restartedPhone = await openProfile(profiles[1], false);
    assert.equal(restartedDesktop.sessionId, desktop.sessionId); assert.equal(restartedPhone.sessionId, phone.sessionId);
    const stale = await fetch(origin + '/trainer2/auth', { headers: { cookie: '__Host-trainer2-session=' + input.staleCookie } });
    assert((await stale.text()).includes('Signed out.'));
    input.record('compatible-recovery-same-real-binding-configuration-stale-synthetic-cookie-denied');
    input.record('separate-profiles-reload-browser-and-server-restart', 'PASS Edge desktop + 390px viewport; no physical device or protection-cookie qualification');
    await restartedPhone.page.getByRole('button', { name: 'Sign out this device' }).click(); await restartedPhone.page.getByText('Signed out.', { exact: true }).waitFor();
    await restartedDesktop.page.reload(); await restartedDesktop.page.getByText('Signed in.', { exact: true }).waitFor();
    await restartedPhone.page.locator('input[name="passcode"]').fill(input.passcode);
    await restartedPhone.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await restartedPhone.page.getByRole('heading', { name: 'Training', exact: true }).waitFor();
    await restartedPhone.page.goto(origin + '/trainer2/auth');
    await restartedPhone.page.getByText('Signed in.', { exact: true }).waitFor();
    await restartedDesktop.page.getByRole('button', { name: 'Sign out every device' }).click(); await restartedDesktop.page.getByText('Signed out.', { exact: true }).waitFor();
    await restartedPhone.page.goto(origin + '/trainer2/auth', { waitUntil: 'networkidle' }); await restartedPhone.page.getByText('Signed out.', { exact: true }).waitFor();
    // A closed profile containing its original persistent cookie must also lose access.
    await closeContext(restartedPhone.context); contexts = contexts.filter(c => c !== restartedPhone.context);
    const check = await chromium.launchPersistentContext(resolve(output, 'phone-sized'), { channel: 'msedge', headless: true }); contexts.push(check);
    const page = await check.newPage(); await page.goto(origin + '/trainer2/auth'); await page.getByText('Signed out.', { exact: true }).waitFor();
    input.record('browser-independent-sign-out-and-global-revocation');
  } finally {
    let contextsClosed = true;
    for (const context of contexts) await closeContext(context).catch(() => { contextsClosed = false; });
    stop();
    const command = '$ErrorActionPreference="Stop"; $rows=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "msedge.exe" -and $_.CommandLine -like ("*--user-data-dir=" + $env:TRAINER2_OWNED_PROFILE_ROOT + "*") }); [Console]::Write($rows.Count)';
    const inventory = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], {
      env: { ...process.env, PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules'), TRAINER2_OWNED_PROFILE_ROOT: output }, windowsHide: true, encoding: 'utf8', timeout: 15000,
    });
    const browserProcessesAbsent = inventory.status === 0 && inventory.stdout.trim() === '0';
    const portProbe = createServer();
    const ownedPortReleased = await new Promise<boolean>(r => { portProbe.once('error', () => r(false)); portProbe.listen(port, '127.0.0.1', () => portProbe.close(() => r(true))); });
    writeFileSync(resolve(output, 'cleanup.json'), JSON.stringify({ contextsClosed, browserProcessesAbsent, ownedPortReleased }));
    assert(contextsClosed && browserProcessesAbsent && ownedPortReleased, 'Owned browser/server cleanup incomplete');
  }
}
