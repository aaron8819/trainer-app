import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { authWebPlatformEnvironment } from "./auth-web-environment";
import { resolve } from "node:path";

async function probe(runtime: string | undefined, expected: { v1: number; auth: number; data: number }, credential?: "legacy" | "trainer2",
  vercelEnvironment = "preview") {
  const port = 40000 + Math.floor(Math.random() * 10000);
  const origin = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...authWebPlatformEnvironment(process.env), NODE_ENV: "production",
    VERCEL_ENV: vercelEnvironment, NEXT_TELEMETRY_DISABLED: "1",
    ...(runtime === undefined ? {} : { TRAINER_DEPLOYMENT_MODE: runtime }),
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
if (mode === "preview") {
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
} else throw new Error("EXPECTED_PREVIEW_OR_V1_ARTIFACT");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
