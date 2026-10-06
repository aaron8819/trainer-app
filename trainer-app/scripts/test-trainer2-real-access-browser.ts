import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { openPersistentBrowser } from './trainer2/persistent-browser';
import { cleanupSteps, ownedProcessTree, terminateOwnedProcesses, waitForWorker } from './trainer2/disposable-cleanup';
import { finishQualification } from './trainer2/qualification-report';
import { authWebPlatformEnvironment, authWebEnvironmentProbe } from './trainer2/auth-web-environment';

export async function browserReview(input: { accountId: string; passcode: string; setupCode: string; staleCookie: string; syntheticPasscode: string; verify: (cookies: string[], stage: string) => Promise<void>; identityUrl: string; readUrl: string; writeUrl: string; record: (name: string, result?: unknown) => void }) {
  const output = resolve(`artifacts/real-access-fixes/browser-${Date.now()}`); mkdirSync(output, { recursive: true });
  const listener = createServer(); await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
  const port = (listener.address() as { port: number }).port; await new Promise<void>(r => listener.close(() => r()));
  const origin = `http://localhost:${port}`;
  const env: NodeJS.ProcessEnv = { ...authWebPlatformEnvironment(process.env), NODE_ENV: 'development', TRAINER2_LOCAL_DRAFTS: 'enabled', TRAINER2_APP_ORIGIN: origin, TRAINER2_OWNER_USER_ID: input.accountId, TRAINER2_IDENTITY_CONNECTION_STRING: input.identityUrl, TRAINER2_READ_CONNECTION_STRING: input.readUrl, TRAINER2_WRITE_CONNECTION_STRING: input.writeUrl };
  const bootstrap = resolve(output, 'server.cjs'); writeFileSync(bootstrap, authWebEnvironmentProbe(Object.keys(env)));
  const lifecycle: Record<string, unknown>[] = [];
  const trace = (result: Record<string, unknown>) => lifecycle.push({ at: new Date().toISOString(), ...result });
  let primaryError: unknown;
  let operation = 'setup and empty-home assertions';
  let server: ChildProcess | undefined;
  let serverCompletion: ReturnType<typeof waitForWorker> | undefined;
  async function start() {
    const log = openSync(resolve(output, 'server.log'), 'a');
    const startedServer = spawn(process.execPath, [bootstrap, 'dev', '--webpack', '-p', String(port)], { env, windowsHide: true, stdio: ['ignore', log, log] });
    closeSync(log); server = startedServer; serverCompletion = waitForWorker(startedServer, 20 * 60_000);
    trace({ event: 'server-start', pid: startedServer.pid, port });
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      assert.equal(startedServer.exitCode, null, 'Owned Next process exited');
      try { const response = await fetch(origin + '/trainer2/auth', { signal: AbortSignal.timeout(45000) }); if (response.ok && (await response.text()).includes('Trainer2 sign in')) return; } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Owned Next readiness timed out');
  }
  async function stop() {
    if (!server?.pid) return;
    const child = server;
    await terminateOwnedProcesses(ownedProcessTree(child.pid!, bootstrap), trace);
    for (const stream of child.stdio) stream?.destroy();
    const result = await serverCompletion;
    assert(result && !result.timedOut && !result.error, 'Next child close unobserved');
    trace({ event: 'server-close', pid: child.pid, ...result }); server = undefined;
  }
  const profiles = ['desktop', 'phone-sized'];
  let contexts: Awaited<ReturnType<typeof openPersistentBrowser>>[] = [];
  async function closeContext(context: typeof contexts[number]['context']) {
    const resource = contexts.find(item => item.context === context); assert(resource);
    await resource.close();
  }
  async function openProfile(profile: string, signIn: boolean) {
    const resource = await openPersistentBrowser(resolve(output, profile), profile === 'desktop' ? { width: 1360, height: 900 } : { width: 390, height: 844 }, trace);
    contexts.push(resource); const { context, page } = resource;
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
    return { context, page, cookie: cookie.value, sessionId: cookie.value.split('.')[0] };
  }
  async function verify(cookies: string[], stage: string) {
    await input.verify(cookies, stage);
    for (const [index, cookie] of cookies.entries()) {
      const denied = stage === 'synthetic-denied' || stage === 'global-revocation' || (stage === 'device-sign-out' && index === 1);
      const response = await fetch(origin + '/trainer2', { headers: { cookie: '__Host-trainer2-session=' + cookie }, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
      if (denied) { assert.equal(response.status, 307); assert(response.headers.get('location')?.includes('/trainer2/auth')); }
      else { assert.equal(response.status, 200); assert((await response.text()).includes('You have no plan yet.')); }
    }
    input.record('http-training-authorization-' + stage);
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
    await verify([desktop.cookie, phone.cookie], 'setup');
    operation = 'browser restart shutdown';
    for (const resource of contexts) await resource.close(); contexts = [];
    operation = 'browser restart assertions';
    const browserDesktop = await openProfile(profiles[0], false), browserPhone = await openProfile(profiles[1], false);
    assert.equal(browserDesktop.sessionId, desktop.sessionId); assert.equal(browserPhone.sessionId, phone.sessionId);
    await verify([browserDesktop.cookie, browserPhone.cookie], 'browser-restart');
    input.record('native-profile-browser-restart-session-ids-retained');
    operation = 'application restart shutdown';
    await stop(); await start();
    operation = 'application restart assertions';
    await browserDesktop.page.reload(); await browserPhone.page.reload();
    await verify([browserDesktop.cookie, browserPhone.cookie], 'application-restart');
    input.record('application-restart-original-sessions-authorized');
    for (const resource of contexts) await resource.close(); contexts = [];
    await stop(); await start();
    operation = 'compatible recovery assertions';
    const restartedDesktop = await openProfile(profiles[0], false), restartedPhone = await openProfile(profiles[1], false);
    assert.equal(restartedDesktop.sessionId, desktop.sessionId); assert.equal(restartedPhone.sessionId, phone.sessionId);
    const stale = await fetch(origin + '/trainer2/auth', { headers: { cookie: '__Host-trainer2-session=' + input.staleCookie } });
    assert((await stale.text()).includes('Signed out.'));
    await verify([restartedDesktop.cookie, restartedPhone.cookie], 'compatible-recovery');
    const rejected = await fetch(origin + '/trainer2/auth/sign-in', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ passcode: input.syntheticPasscode }) });
    assert.equal(rejected.status, 400);
    await verify([input.staleCookie], 'synthetic-denied');
    input.record('synthetic-passcode-http-denied-no-session-issued');
    input.record('compatible-recovery-same-real-binding-configuration-stale-synthetic-cookie-denied');
    input.record('separate-profiles-reload-browser-and-server-restart', 'PASS pinned Chromium desktop + 390px viewport; no physical device or protection-cookie qualification');
    operation = 'device and global revocation assertions';
    await restartedPhone.page.getByRole('button', { name: 'Sign out this device' }).click(); await restartedPhone.page.getByText('Signed out.', { exact: true }).waitFor();
    await verify([restartedDesktop.cookie, restartedPhone.cookie], 'device-sign-out');
    await restartedDesktop.page.reload(); await restartedDesktop.page.getByText('Signed in.', { exact: true }).waitFor();
    await restartedPhone.page.locator('input[name="passcode"]').fill(input.passcode);
    await restartedPhone.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await restartedPhone.page.getByRole('heading', { name: 'Training', exact: true }).waitFor();
    await restartedPhone.page.goto(origin + '/trainer2/auth');
    await restartedPhone.page.getByText('Signed in.', { exact: true }).waitFor();
    const replacement = (await restartedPhone.context.cookies()).find(c => c.name === '__Host-trainer2-session')!;
    await verify([restartedDesktop.cookie, replacement.value], 'phone-sign-in-again');
    await restartedDesktop.page.getByRole('button', { name: 'Sign out every device' }).click(); await restartedDesktop.page.getByText('Signed out.', { exact: true }).waitFor();
    await restartedPhone.page.goto(origin + '/trainer2/auth', { waitUntil: 'networkidle' }); await restartedPhone.page.getByText('Signed out.', { exact: true }).waitFor();
    // A closed profile containing its original persistent cookie must also lose access.
    operation = 'revoked profile shutdown';
    await closeContext(restartedPhone.context); contexts = contexts.filter(c => c.context !== restartedPhone.context);
    const check = await openPersistentBrowser(resolve(output, 'phone-sized'), { width: 390, height: 844 }, trace); contexts.push(check);
    const page = check.page; await page.goto(origin + '/trainer2/auth'); await page.getByText('Signed out.', { exact: true }).waitFor();
    await verify([restartedDesktop.cookie, replacement.value], 'global-revocation');
    input.record('browser-independent-sign-out-and-global-revocation');
  } catch (error) { primaryError = error; input.record('browser-primary-error', { operation, category: operation.includes('shutdown') ? 'lifecycle' : 'assertion', message: String((error as Error).message) }); }
  const cleanup = await cleanupSteps([
    ...contexts.map((resource, index) => ({ name: `profile ${index}`, timeoutMs: 45_000, run: () => resource.close() })),
    { name: 'Next process', timeoutMs: 30_000, run: stop },
    { name: 'owned port absence', run: async () => {
      const probe = createServer();
      const released = await new Promise<boolean>(r => { probe.once('error', () => r(false)); probe.listen(port, '127.0.0.1', () => probe.close(() => r(true))); });
      assert(released, 'Owned Next port survived');
    } },
  ]);
  writeFileSync(resolve(output, 'cleanup.json'), JSON.stringify({ primaryOperation: operation, primaryError: primaryError ? String(primaryError) : null, cleanup, lifecycle, port, profilesRetained: true }, null, 2));
  finishQualification(primaryError, cleanup);
}
