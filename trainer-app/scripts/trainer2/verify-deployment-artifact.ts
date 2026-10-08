import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { authWebPlatformEnvironment } from "./auth-web-environment";
import { resolve } from "node:path";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createHmac, randomBytes } from "node:crypto";
import { isolatedLinuxJob, ownLinuxGroup } from "./isolated-linux-lifecycle";
import { verificationSource } from "./verification-source";
import { artifactGet } from "./artifact-http";

async function productionArtifact(): Promise<void> {
  assert(isolatedLinuxJob(process.platform, process.env), "Requires isolated Linux CI");
  for (const file of ['.env', '.env.local', '.env.production', '.env.production.local'])
    assert(!existsSync(file), 'Qualification requires a dotenv-free checkout');
  const artifact = resolve('artifacts/linux-qualification/production-artifact');
  mkdirSync(artifact, { recursive: true });
  const source = verificationSource();
  assert.equal(source.dirtyState, '', 'Built qualification requires a clean frozen source');
  writeFileSync(resolve(artifact, 'source.json'), JSON.stringify(source, null, 2));
  writeFileSync(resolve(artifact, 'ownership-plan.json'), JSON.stringify({
    scope: 'Five servers spawned only inside the existing isolated GitHub Linux job',
    cleanup: 'Existing ownLinuxGroup; birth-bound detached children only',
    database: 'Blocked loopback targets; no database or browser launched',
    preserved: 'No shared laptop or hosted resources used, restarted or stopped',
  }, null, 2));
  const emitted = JSON.parse(readFileSync('.next/required-server-files.json', 'utf8')) as {
    config: { env: { TRAINER_BUILT_MODE?: string } };
  };
  assert.equal(emitted.config.env.TRAINER_BUILT_MODE, 'v2-production');
  assert(readFileSync('.next/BUILD_ID', 'utf8').trim(), 'Missing built artifact');
  const host = 'production-artifact.example.test';
  const receipts: unknown[] = [];
  for (const scenario of ['production', 'preview-environment', 'unknown-environment',
    'missing-runtime', 'wrong-runtime']) {
    const port = await new Promise<number>((resolvePort, reject) => {
      const probe = createServer(); probe.once('error', reject);
      probe.listen(0, 'localhost', () => {
        const address = probe.address(); assert(address && typeof address !== 'string');
        probe.close(error => error ? reject(error) : resolvePort(address.port));
      });
    });
    // NextURL normalizes 127.0.0.1 to localhost. Match the server's initial origin
    // so its root rewrite stays internal and preserves the synthetic public Host.
    const origin = `http://localhost:${port}`, key = randomBytes(32).toString('hex');
    const env: NodeJS.ProcessEnv = { ...authWebPlatformEnvironment(process.env),
      NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      VERCEL_GIT_COMMIT_SHA: source.commit, TRAINER_BUILD_GIT_SHA: source.commit,
      VERCEL_ENV: scenario === 'preview-environment' ? 'preview' :
        scenario === 'unknown-environment' ? 'unknown' : 'production',
      ...(scenario === 'missing-runtime' ? {} : {
        TRAINER_DEPLOYMENT_MODE: scenario === 'wrong-runtime' ? 'hosted-test' : 'v2-production',
      }),
      // Attempt a runtime override: the emitted build binding must still govern admission.
      TRAINER_BUILT_MODE: 'v1', TRAINER2_APP_ORIGIN: `https://${host}`,
      TRAINER2_OWNER_USER_ID: '00000000-0000-0000-0000-000000000001',
      TRAINER2_DB_CA_CERT_PEM: 'synthetic-blocked-ca',
      TRAINER2_IDENTITY_CONNECTION_STRING:
        'postgresql://trainer2_identity_runtime:blocked@127.0.0.1:9/blocked',
      TRAINER2_READ_CONNECTION_STRING:
        'postgresql://trainer2_draft_reader:blocked@127.0.0.1:9/blocked',
      TRAINER2_WRITE_CONNECTION_STRING:
        'postgresql://trainer2_draft_runtime:blocked@127.0.0.1:9/blocked',
      TRAINER2_READINESS_KEY: key,
      NODE_OPTIONS: `--require="${resolve('scripts/trainer2/web-readiness-preload.cjs')}"`,
    };
    const log = openSync(resolve(artifact, `${scenario}-server.log`), 'w');
    const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'),
      'start', '--hostname', 'localhost', '-p', String(port)],
    { env, detached: true, stdio: ['ignore', log, log] });
    const owned = ownLinuxGroup(child);
    writeFileSync(resolve(artifact, `${scenario}-ownership.json`), JSON.stringify({
      pid: child.pid, group: child.pid, runnerPid: process.pid, run: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT, environmentKeys: Object.keys(env).sort(),
    }, null, 2));
    const get = (path: string, requestedHost = host): Promise<Response> =>
      artifactGet(origin, path, requestedHost);
    try {
      const challenge = randomBytes(16).toString('hex');
      let ready: Response | undefined;
      for (let attempt = 0; attempt < 40; attempt++) {
        try { ready = await get(`/trainer2/auth?readiness=${challenge}`); break; }
        catch (error) {
          if ((error as { cause?: { code?: string } }).cause?.code !== 'ECONNREFUSED') throw error;
          assert(child.exitCode === null && child.signalCode === null, 'Owned server exited');
          await new Promise(resolveWait => setTimeout(resolveWait, 250));
        }
      }
      assert(ready, 'Owned artifact readiness timeout');
      const pid = ready.headers.get('x-trainer2-readiness-pid');
      assert(pid && /^\d+$/.test(pid), 'Readiness process identity missing');
      assert.equal(ready.headers.get('x-trainer2-readiness-proof'),
        createHmac('sha256', key).update(`${challenge}\n${child.pid}\n${pid}`).digest('hex'));
      writeFileSync(resolve(artifact, `${scenario}-readiness.json`), JSON.stringify({
        status: ready.status, identityVerified: true, transportHost: 'localhost',
      }, null, 2));
      assert.equal(ready.status, scenario === 'production' ? 200 : 503);
      const paths = ['/', '/trainer2', '/trainer2/auth', '/manifest.webmanifest',
        '/icons/trainer-icon-192.png', '/icons/trainer-icon-512.png', '/apple-icon.png'];
      const statuses: Record<string, number> = {};
      for (const path of paths) {
        const response = await get(path); statuses[path] = response.status;
        if (scenario !== 'production') { assert.equal(response.status, 503); continue; }
        if (path === '/' || path === '/trainer2') {
          assert.equal(response.status, 307);
          assert.equal(new URL(response.headers.get('location')!, origin).pathname, '/trainer2/auth');
        } else assert.equal(response.status, 200);
        if (path === '/' || path.startsWith('/trainer2')) {
          const cache = response.headers.get('cache-control')?.split(',').map(value => value.trim());
          assert(cache?.includes('private') && cache.includes('no-store'), 'Private headers missing');
        }
        if (path === '/trainer2/auth') {
          const html = await response.text();
          assert(/<h1\b[^>]*>Trainer2 sign in<\/h1>/.test(html), 'Auth heading missing');
          assert(html.includes('action="/trainer2/auth/sign-in"'), 'Auth form missing');
        }
        if (path === '/manifest.webmanifest') {
          const manifest: unknown = await response.json();
          assert(manifest && typeof manifest === 'object' && 'start_url' in manifest &&
            'scope' in manifest && 'display' in manifest, 'Manifest shape invalid');
          assert.deepEqual([manifest.start_url, manifest.scope, manifest.display],
            ['/', '/', 'standalone']);
        }
        if (path.endsWith('.png')) assert(response.headers.get('content-type')?.startsWith('image/png'));
      }
      if (scenario === 'production') {
        for (const path of paths) assert.equal((await get(path, 'wrong.example.test')).status, 404);
        assert.equal((await get('/api/program')).status, 404);
      }
      receipts.push({ scenario, statuses, readinessIdentityVerified: true });
      writeFileSync(resolve(artifact, 'checks.json'), JSON.stringify(receipts, null, 2));
    } finally {
      try {
        const completion = await owned.stop();
        writeFileSync(resolve(artifact, `${scenario}-cleanup.json`), JSON.stringify(completion, null, 2));
      } finally { closeSync(log); }
    }
  }
  assert.equal(verificationSource().manifestHash, source.manifestHash, 'Source changed');
  console.log('PASS emitted V2 production artifact: root/auth, install assets, private headers and admission negatives');
}

async function probe(runtime: string | undefined, expected: { v1: number; auth: number; data: number }, credential?: "legacy" | "trainer2",
  vercelEnvironment = "preview", hosted = false) {
  const port = 40000 + Math.floor(Math.random() * 10000);
  const origin = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...authWebPlatformEnvironment(process.env), NODE_ENV: "production",
    VERCEL_ENV: vercelEnvironment, NEXT_TELEMETRY_DISABLED: "1",
    ...(runtime === undefined ? {} : { TRAINER_DEPLOYMENT_MODE: runtime }),
    ...(hosted ? { TRAINER2_APP_ORIGIN: origin, TRAINER2_OWNER_USER_ID: "00000000-0000-0000-0000-000000000001",
      TRAINER2_DB_CA_CERT_PEM: "test-ca", TRAINER2_IDENTITY_CONNECTION_STRING: "postgresql://trainer2_identity_runtime:blocked@127.0.0.1:9/blocked",
      TRAINER2_READ_CONNECTION_STRING: "postgresql://trainer2_draft_reader:blocked@127.0.0.1:9/blocked",
      TRAINER2_WRITE_CONNECTION_STRING: "postgresql://trainer2_draft_runtime:blocked@127.0.0.1:9/blocked" } : {}),
    ...(credential === "legacy" ? { DATABASE_URL: "postgresql://blocked:blocked@127.0.0.1:9/blocked" } : {}),
    ...(credential === "trainer2" ? { TRAINER2_IDENTITY_CONNECTION_STRING: "postgresql://blocked:blocked@127.0.0.1:9/blocked" } : {}) };
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-p", String(port)],
    { cwd: process.cwd(), env, windowsHide: true, stdio: "ignore" });
  try {
    for (let i = 0; i < 40; i++) {
      try { await fetch(origin + "/trainer2/auth"); break; } catch { /* startup */ }
      if (child.exitCode !== null) throw new Error("NEXT_START_EXITED");
      if (i === 39) throw new Error("NEXT_START_TIMEOUT");
      await new Promise(r => setTimeout(r, 500));
    }
    const v1 = await fetch(origin + "/api/program");
    const auth = await fetch(origin + "/trainer2/auth");
    const data = await fetch(origin + "/api/trainer2/drafts/create", { method: "POST" });
    assert.deepEqual([v1.status, auth.status, data.status], [expected.v1, expected.auth, expected.data]);
  } finally {
    if (child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  }
}

async function main() {
const mode = process.argv[2];
if (mode === "v2-production") {
  await productionArtifact();
} else if (mode === "preview") {
  await probe(undefined, { v1: 503, auth: 503, data: 503 });
  await probe("", { v1: 503, auth: 503, data: 503 });
  await probe("v1", { v1: 503, auth: 503, data: 503 });
  await probe("preview", { v1: 404, auth: 200, data: 403 });
  await probe("preview", { v1: 503, auth: 503, data: 503 }, "legacy");
  await probe("preview", { v1: 503, auth: 503, data: 503 }, "trainer2");
  console.log("PASS built Preview artifact: absent/empty/wrong runtime mode, V1 route denial, inherited credential denial");
} else if (mode === "v1") {
  await probe("preview", { v1: 503, auth: 503, data: 503 });
  const port = 40000 + Math.floor(Math.random() * 10000);
  const env: NodeJS.ProcessEnv = { ...authWebPlatformEnvironment(process.env), NODE_ENV: "production", VERCEL_ENV: "production" };
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-p", String(port)],
    { cwd: process.cwd(), env, windowsHide: true, stdio: "ignore" });
  try {
    let status = 0;
    for (let i = 0; i < 40; i++) {
      try { status = (await fetch(`http://127.0.0.1:${port}/api/version`)).status; break; } catch { /* startup */ }
      await new Promise(r => setTimeout(r, 500));
    }
    assert.equal(status, 200);
  } finally { if (child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }); }
  console.log("PASS built V1 artifact: Preview runtime mismatch denies V1 and Trainer2 before handlers");
} else if (mode === "hosted-test") {
  await probe(undefined, { v1: 503, auth: 503, data: 503 }, undefined, "preview", true);
  await probe("preview", { v1: 503, auth: 503, data: 503 }, undefined, "preview", true);
  await probe("hosted-test", { v1: 404, auth: 200, data: 403 }, undefined, "preview", true);
  await probe("hosted-test", { v1: 503, auth: 503, data: 503 }, "legacy", "preview", true);
  await probe("hosted-test", { v1: 503, auth: 503, data: 503 }, undefined, "production", true);
  console.log("PASS built hosted-test artifact: exact mode binding, V1 route denial, inherited credential denial");
} else throw new Error("EXPECTED_PREVIEW_V1_OR_HOSTED_TEST_ARTIFACT");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
