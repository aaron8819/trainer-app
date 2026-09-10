import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { chromium, type BrowserContext } from "@playwright/test";
import { sanitizeDatabaseTargetEnvironment } from "../../src/lib/operations/test-environment-preflight";
import { authenticateHostedRequest, AUTH_COOKIE } from "../../src/lib/api/trainer2/authentication";
import { verificationSource } from "./verification-source";
import { authWebEnvironmentProbe, authWebPlatformEnvironment } from "./auth-web-environment";

export async function verifySupabaseAuth() {
  const output = resolve("artifacts/trainer2-auth"); mkdirSync(output, { recursive: true });
  const source = verificationSource(), started = new Date().toISOString();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12), network = "trainer2-auth-" + suffix;
  const database = "trainer2_disposable_" + suffix, password = randomUUID(), secret = randomUUID() + randomUUID();
  const rolePasswords = { postgres: password, trainer2_identity_reader: randomUUID(), trainer2_draft_reader: randomUUID(), trainer2_draft_runtime: randomUUID() };
  assert.equal(new Set(Object.values(rolePasswords)).size, 4, "setup and application passwords must be distinct");
  const names: string[] = [], results: string[] = [], commands: unknown[] = [];
  const sensitive = [secret, ...Object.values(rolePasswords)];
  const evidence: Record<string, unknown> = { source, started, node: process.version };
  let server: ReturnType<typeof spawn> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let owner: Pool | undefined, providerPort = "", outage = false;
  const oldEnvironment = { ...process.env };
  const scrub = (s: string) => {
    for (const value of sensitive) s = s.replaceAll(value, "[redacted]");
    return s.replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/g, "[disposable-target]")
      .replace(/(code|token|token_hash)=[^\s&"'<>]+/g, "$1=[redacted]")
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]");
  };
  const command = (exe: string, args: string[], env?: NodeJS.ProcessEnv) => {
    const start = new Date().toISOString();
    const r = spawnSync(exe, args, { encoding: "utf8", env, windowsHide: true, maxBuffer: 20_000_000 });
    commands.push({ command: scrub([exe, ...args].join(" ")), started: start, finished: new Date().toISOString(), status: r.status,
      stdout: scrub(r.stdout ?? ""), stderr: scrub(r.stderr ?? "") });
    if (r.status !== 0) throw new Error("Command failed: " + exe);
    return (r.stdout ?? "").trim();
  };
  const pass = (name: string) => { results.push(name); console.log("PASS " + name); };
  const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
  const gateway = createServer((req, res) => {
    if (outage) { res.writeHead(503); res.end('{"error":"qualification outage"}'); return; }
    if (!req.url?.startsWith("/auth/v1/")) { res.writeHead(404); res.end(); return; }
    const proxy = httpRequest({ hostname: "127.0.0.1", port: providerPort, path: req.url.slice("/auth/v1".length),
      method: req.method, headers: req.headers }, upstream => { res.writeHead(upstream.statusCode!, upstream.headers); upstream.pipe(res); });
    proxy.on("error", () => { res.writeHead(503); res.end(); }); req.pipe(proxy);
  });
  const listen = (s: ReturnType<typeof createServer>) => new Promise<number>(resolvePort => s.listen(0, "127.0.0.1", () => resolvePort((s.address() as { port: number }).port)));
  let serverLog = "";
  try {
    const gatewayPort = await listen(gateway), authUrl = "http://127.0.0.1:" + gatewayPort;
    const probe = createServer(); const appPort = await listen(probe); await new Promise<void>(r => probe.close(() => r()));
    const origin = "http://127.0.0.1:" + appPort;
    command("docker", ["network", "create", network]);
    const run = (name: string, image: string, env: Record<string, string>, ports: string[]) => {
      names.push(name);
      command("docker", ["run", "--pull=never", "-d", "--name", name, "--network", network,
        ...(image === "postgres:17-alpine" ? ["--tmpfs", "/var/lib/postgresql/data"] : []),
        ...Object.entries(env).flatMap(([k, v]) => ["-e", k + "=" + v]), ...ports.flatMap(p => ["-p", "127.0.0.1::" + p]), image]);
    };
    const dbName = network + "-db", mailName = network + "-mail", authName = network + "-provider";
    run(dbName, "postgres:17-alpine", { POSTGRES_PASSWORD: password, POSTGRES_DB: database }, ["5432"]);
    for (let i = 0; ; i++) {
      if (spawnSync("docker", ["exec", dbName, "pg_isready", "-U", "postgres"], { windowsHide: true }).status === 0) break;
      if (i > 60) throw new Error("Postgres startup"); await pause(500);
    }
    const portOf = (name: string, port: string) => command("docker", ["port", name, port]).match(/:(\d+)$/)![1];
    const dbPort = portOf(dbName, "5432/tcp");
    const url = (role: keyof typeof rolePasswords) => "postgresql://" + role + ":" + rolePasswords[role] + "@127.0.0.1:" + dbPort + "/" + database;
    owner = new Pool({ connectionString: url("postgres") });
    await owner.query("CREATE DATABASE auth_disposable");
    await owner.query("ALTER DATABASE auth_disposable SET search_path TO auth, public");
    const authSetup = new Pool({ connectionString: url("postgres").replace(database, "auth_disposable") });
    try { await authSetup.query("CREATE SCHEMA auth"); } finally { await authSetup.end(); }
    const env = { ...sanitizeDatabaseTargetEnvironment(process.env), DATABASE_URL: url("postgres"), DIRECT_URL: url("postgres"), TEST_DATABASE_URL: url("postgres") };
    command(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], env);
    await owner.query(readFileSync(resolve("prisma/trainer2-runtime-grants.sql"), "utf8"));
    for (const role of ["trainer2_identity_reader", "trainer2_draft_reader", "trainer2_draft_runtime"] as const) {
      await owner.query("ALTER ROLE " + role + " LOGIN PASSWORD '" + rolePasswords[role] + "'");
      const impersonated = new URL(url(role)); impersonated.username = "postgres";
      const denied = new Pool({ connectionString: impersonated.toString() });
      try { await assert.rejects(denied.query("SELECT 1"), { code: "28P01" }); }
      finally { await denied.end(); }
    }
    await owner.query('INSERT INTO "User" (id,email) VALUES (\'auth-account-A\',\'a@synthetic.invalid\'),(\'auth-account-B\',\'b@synthetic.invalid\')');
    run(mailName, "public.ecr.aws/supabase/mailpit:v1.22.3", {}, ["8025"]);
    const mailUrl = "http://127.0.0.1:" + portOf(mailName, "8025/tcp");
    run(authName, "public.ecr.aws/supabase/gotrue:v2.187.0", {
      GOTRUE_API_HOST: "0.0.0.0", GOTRUE_API_PORT: "9999", API_EXTERNAL_URL: authUrl,
      GOTRUE_DB_DRIVER: "postgres", GOTRUE_DB_DATABASE_URL: "postgres://postgres:" + password + "@" + dbName + ":5432/auth_disposable?sslmode=disable",
      GOTRUE_SITE_URL: origin, GOTRUE_URI_ALLOW_LIST: origin + "/trainer2/auth/callback",
      GOTRUE_JWT_SECRET: secret, GOTRUE_JWT_ISSUER: authUrl + "/auth/v1", GOTRUE_JWT_AUD: "authenticated",
      GOTRUE_JWT_ADMIN_ROLES: "service_role", GOTRUE_JWT_EXP: "3600",
      GOTRUE_DISABLE_SIGNUP: "true", GOTRUE_EXTERNAL_EMAIL_ENABLED: "true", GOTRUE_MAILER_AUTOCONFIRM: "false",
      GOTRUE_SMTP_HOST: mailName, GOTRUE_SMTP_PORT: "1025", GOTRUE_SMTP_ADMIN_EMAIL: "noreply@synthetic.invalid",
      GOTRUE_SMTP_SENDER_NAME: "Trainer2 local test", GOTRUE_SMTP_MAX_FREQUENCY: "1s",
      GOTRUE_MAILER_URLPATHS_CONFIRMATION: "/auth/v1/verify",
      GOTRUE_MAILER_URLPATHS_INVITE: "/auth/v1/verify", GOTRUE_MAILER_URLPATHS_RECOVERY: "/auth/v1/verify",
      GOTRUE_LOG_LEVEL: "error",
    }, ["9999"]);
    providerPort = portOf(authName, "9999/tcp");
    for (let i = 0; ; i++) {
      try { if ((await fetch(authUrl + "/auth/v1/health")).ok) break; } catch { /* starting */ }
      if (i > 60) throw new Error("Auth startup"); await pause(500);
    }
    const jwt = (role: string) => {
      const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const body = Buffer.from(JSON.stringify({ role, aud: "authenticated", iss: authUrl + "/auth/v1", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
      return head + "." + body + "." + createHmac("sha256", secret).update(head + "." + body).digest("base64url");
    };
    const adminToken = jwt("service_role"), anonToken = jwt("anon"); sensitive.push(adminToken, anonToken);
    const users: { id: string; email: string }[] = [];
    for (const email of ["a@synthetic.invalid", "b@synthetic.invalid"]) {
      const r = await fetch(authUrl + "/auth/v1/admin/users", { method: "POST", headers: { authorization: "Bearer " + adminToken, "content-type": "application/json" },
        body: JSON.stringify({ email, email_confirm: true }) });
      assert(r.ok, "explicit synthetic Auth provisioning"); const user = await r.json(); users.push({ id: user.id, email });
    }
    const authEnv = { TRAINER2_AUTH_URL: authUrl, TRAINER2_AUTH_PUBLISHABLE_KEY: anonToken, TRAINER2_AUTH_ISSUER: authUrl + "/auth/v1",
      TRAINER2_AUTH_AUDIENCE: "authenticated", TRAINER2_APP_ORIGIN: origin };
    Object.assign(process.env, authEnv);
    const webEnv: NodeJS.ProcessEnv = { ...authWebPlatformEnvironment(process.env), ...authEnv, NODE_ENV: "development", TRAINER2_LOCAL_DRAFTS: "",
      TRAINER2_IDENTITY_CONNECTION_STRING: url("trainer2_identity_reader"), TRAINER2_READ_CONNECTION_STRING: url("trainer2_draft_reader"),
      TRAINER2_WRITE_CONNECTION_STRING: url("trainer2_draft_runtime"), NEXT_TELEMETRY_DISABLED: "1" };
    assert(Object.values(webEnv).every(value => !value || ![password, secret, adminToken].some(credential => value.includes(credential))),
      "setup administrator password, signing secret and admin token must not enter Next environment");
    const environmentProbe = resolve(output, "assert-web-environment.cjs");
    writeFileSync(environmentProbe, authWebEnvironmentProbe(Object.keys(webEnv)));
    server = spawn(process.execPath, [environmentProbe, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", String(appPort)], { env: webEnv, windowsHide: true, stdio: "pipe" });
    server.stdout?.on("data", d => { serverLog += d.toString(); }); server.stderr?.on("data", d => { serverLog += d.toString(); });
    for (let i = 0; ; i++) {
      try { if ((await fetch(origin + "/trainer2/auth")).ok) break; } catch { /* starting */ }
      if (i > 90 || server.exitCode !== null) throw new Error("App startup"); await pause(500);
    }
    assert(serverLog.includes("TRAINER2_AUTH_WEB_ENVIRONMENT_VERIFIED "), "actual Next child environment verified before startup");
    evidence.webEnvironment = { keys: Object.keys(webEnv).sort(), actualChildVerified: true, dotenvAbsent: true, inheritedCredentials: false,
      setupSecretsAbsent: true, applicationPasswordsCannotLoginAsAdministrator: true };
    pass("actual Next process environment excludes setup administrator and inherited task credentials; all three application passwords fail administrator login");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    evidence.browser = browser.version();
    const a = await browser.newContext(), b = await browser.newContext();
    const page = await a.newPage(), other = await b.newPage();
    const cookieHeader = async (context: BrowserContext) => (await context.cookies(origin)).map(c => c.name + "=" + c.value).join("; ");
    const identity = async (context: BrowserContext) => authenticateHostedRequest(new Request(origin, { headers: { cookie: await cookieHeader(context) } }));
    const signIn = async (context: BrowserContext, tab: typeof page, email: string, expire = false) => {
      assert((await fetch(mailUrl + "/api/v1/messages", { method: "DELETE" })).ok);
      await tab.goto(origin + "/trainer2/auth"); await tab.getByLabel("Email").fill(email);
      const initiation = tab.waitForResponse(r => r.url().endsWith("/trainer2/auth/sign-in"));
      await tab.getByRole("button", { name: "Send sign-in link" }).click();
      const initiated = await initiation;
      if (initiated.status() !== 303) throw new Error("Sign-in initiation: " + await initiated.text() +
        "; origin=" + initiated.request().headers().origin + "; site=" + initiated.request().headers()["sec-fetch-site"]);
      await tab.getByRole("status").waitFor();
      let link = "";
      for (let i = 0; i < 40 && !link; i++) {
        const list = await (await fetch(mailUrl + "/api/v1/messages")).json();
        for (const message of list.messages ?? []) {
          if (!message.To.some((to: { Address: string }) => to.Address === email)) continue;
          const detail = await (await fetch(mailUrl + "/api/v1/message/" + message.ID)).json();
          link = (detail.HTML as string).match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&") ?? "";
          if (link) break;
        }
        if (!link) await pause(250);
      }
      assert(link.startsWith(authUrl + "/auth/v1/verify?"), "local captured magic link"); sensitive.push(link);
      const callback = await context.request.get(link, { maxRedirects: 0 });
      const location = callback.headers().location; assert(location?.startsWith(origin + "/trainer2/auth/callback?code="));
      sensitive.push(location, new URL(location).searchParams.get("code")!);
      if (expire) {
        const authDb = new Pool({ connectionString: url("postgres").replace(database, "auth_disposable") });
        try {
          // Controlled expiry of this disposable flow; protocol verification still runs in real Auth.
          await authDb.query("UPDATE auth.flow_state SET created_at=now()-interval '1 hour', auth_code_issued_at=now()-interval '1 hour' WHERE auth_code=$1",
            [new URL(location).searchParams.get("code")]);
        } finally { await authDb.end(); }
        assert.equal((await context.request.get(location)).status(), 400);
        await assert.rejects(identity(context), /UNAUTHENTICATED/);
        return location;
      }
      const foreign = await browser!.newContext();
      try {
        assert.equal((await foreign.request.get(location)).status(), 400);
        await assert.rejects(identity(foreign), /UNAUTHENTICATED/);
      } finally { await foreign.close(); }
      await tab.goto(location); await tab.getByText("Signed in.", { exact: true }).waitFor();
      assert((await context.cookies()).some(c => c.name.startsWith(AUTH_COOKIE)));
      return location;
    };
    const callbackA = await signIn(a, page, users[0].email);
    assert.equal((await identity(a)).subject, users[0].id);
    await page.reload(); await page.getByText("Signed in.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("link").count(), 0, "auth page cannot prefetch legacy application pages");
    assert.equal((await a.request.get(callbackA)).status(), 400);
    assert.equal((await identity(a)).subject, users[0].id);
    await other.goto(origin + "/trainer2/auth"); await other.getByText("Signed out.", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(output, "signed-in.png") });
    pass("real local email PKCE sign-in, callback, reload, browser isolation; authentication alone opens no training connection");
    const replay = await b.request.get(callbackA); assert.equal(replay.status(), 400);
    await assert.rejects(identity(b), /UNAUTHENTICATED/);
    pass("callback replay in independent browser denied without PKCE verifier");
    await signIn(b, other, users[1].email);
    const concurrent = await Promise.all(Array.from({ length: 8 }, (_, i) => identity(i % 2 ? a : b)));
    concurrent.forEach((p, i) => assert.equal(p.subject, users[i % 2 ? 0 : 1].id));
    pass("two real independent users and concurrent server requests retain exact identity");
    // Force only the cookie expiry hint stale. Real Auth must rotate the real refresh token.
    const beforeCookies = await a.cookies(origin);
    const sessionText = beforeCookies.filter(c => c.name === AUTH_COOKIE || c.name.startsWith(AUTH_COOKIE + ".")).sort((x, y) => x.name.localeCompare(y.name)).map(c => c.value).join("");
    const session = JSON.parse(Buffer.from(sessionText.slice("base64-".length), "base64url").toString());
    sensitive.push(session.access_token, session.refresh_token);
    const oldRefresh = session.refresh_token;
    session.expires_at = 1;
    await a.clearCookies();
    await a.addCookies([{ name: AUTH_COOKIE, value: "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"), url: origin, sameSite: "Lax" }]);
    const refreshedResponse = await page.reload(); assert(refreshedResponse);
    await page.getByText("Signed in.", { exact: true }).waitFor();
    assert.match(refreshedResponse.headers()["cache-control"], /no-store/);
    const refreshedCookies = await a.cookies(origin);
    assert(refreshedCookies.every(c => c.sameSite === "Lax" && !c.httpOnly));
    const refreshedText = refreshedCookies.filter(c => c.name === AUTH_COOKIE || c.name.startsWith(AUTH_COOKIE + ".")).sort((x, y) => x.name.localeCompare(y.name)).map(c => c.value).join("");
    const refreshed = JSON.parse(Buffer.from(refreshedText.slice("base64-".length), "base64url").toString());
    sensitive.push(refreshed.access_token, refreshed.refresh_token); assert.notEqual(refreshed.refresh_token, oldRefresh);
    assert.equal((await identity(a)).subject, users[0].id);
    pass("real refresh-token rotation propagated through Next proxy request/response; private no-store reload");
    const counts = await owner.query('SELECT (SELECT count(*) FROM "User")::int AS users,(SELECT count(*) FROM "Trainer2AccountPrincipal")::int AS bindings,(SELECT count(*) FROM "Trainer2DurableAction")::int AS actions');
    assert.deepEqual(counts.rows[0], { users: 2, bindings: 0, actions: 0 });
    const unknown = await a.request.post(origin + "/trainer2/auth/sign-in", { headers: { origin },
      form: { email: "unprovisioned@synthetic.invalid" }, maxRedirects: 0 });
    assert.equal(unknown.status(), 303);
    assert.equal(unknown.headers().location, origin + "/trainer2/auth?notice=sent");
    const authInventory = await (await fetch(authUrl + "/auth/v1/admin/users", { headers: { authorization: "Bearer " + adminToken } })).json();
    assert.equal(authInventory.users.length, 2);
    const fixtureConfig = resolve(output, "vitest.auth.mts");
    writeFileSync(fixtureConfig, 'export default { test: { environment: "node", include: ["scripts/trainer2/auth-boundary.fixture.ts"], reporters: ["default"] } };\n');
    // Async child: the loopback gateway in this process must keep serving during the test.
    const fixture = spawn(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--config", fixtureConfig], {
      // This is a disposable setup/assertion worker, not the Next application.
      env: { ...webEnv, TEST_DATABASE_URL: url("postgres"), TRAINER2_TEST_SESSION: await cookieHeader(a) }, windowsHide: true, stdio: "pipe" });
    let fixtureLog = ""; fixture.stdout.on("data", d => { fixtureLog += d; }); fixture.stderr.on("data", d => { fixtureLog += d; });
    const fixtureStatus = await new Promise<number | null>(r => fixture.on("exit", r));
    commands.push({ command: "vitest run --config artifacts/trainer2-auth/vitest.auth.mts (session in child environment, never retained)", status: fixtureStatus, output: scrub(fixtureLog) });
    assert.equal(fixtureStatus, 0, "real verifier + PostgreSQL boundary fixture");
    pass("real verifier + exact restricted mapping, unmapped denial, hosted gate, removal/reassignment and historical action replay; no auto-provisioning");
    for (const op of ["logout", "sign-in"]) {
      const csrf = await a.request.post(origin + "/trainer2/auth/" + op, { headers: { origin: "https://evil.invalid" }, form: { email: users[0].email } });
      assert.equal(csrf.status(), 400);
    }
    outage = true;
    await assert.rejects(identity(a), /UNAUTHENTICATED/);
    await page.reload(); await page.getByText("Signed out.", { exact: true }).waitFor();
    outage = false;
    await page.reload(); await page.getByText("Signed in.", { exact: true }).waitFor();
    pass("provider outage denies identity and page state without fallback; cross-origin auth mutations denied");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByText("Signed out.", { exact: true }).waitFor();
    await assert.rejects(identity(a), /UNAUTHENTICATED/);
    const refreshAttempt = await fetch(authUrl + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: refreshed.refresh_token }) });
    assert(!refreshAttempt.ok, "logout invalidates refresh");
    assert.equal((await identity(b)).subject, users[1].id);
    await page.reload(); await page.getByText("Signed out.", { exact: true }).waitFor();
    pass("browser POST logout clears cookies, revokes this refresh session and survives reload; second session remains valid");
    // Replaying the revoked refresh credential with a stale expiry hint cannot authenticate.
    await a.addCookies([{ name: AUTH_COOKIE, value: "base64-" + Buffer.from(JSON.stringify({ ...refreshed, expires_at: 1 })).toString("base64url"), url: origin, sameSite: "Lax" }]);
    await page.reload(); await page.getByText("Signed out.", { exact: true }).waitFor();
    await assert.rejects(identity(a), /UNAUTHENTICATED/);
    pass("real revoked-refresh failure cannot restore browser or server authentication");
    const expiredContext = await browser.newContext();
    try { await signIn(expiredContext, await expiredContext.newPage(), users[0].email, true); }
    finally { await expiredContext.close(); }
    pass("real callback with controlled expired Auth flow denied; fresh codes require originating browser; failed callback preserves prior valid session");
    evidence.images = command("docker", ["image", "inspect", "--format", "{{.Id}}", "postgres:17-alpine",
      "public.ecr.aws/supabase/gotrue:v2.187.0", "public.ecr.aws/supabase/mailpit:v1.22.3"]).split("\n");
    evidence.versions = { auth: "gotrue v2.187.0", mail: "mailpit v1.22.3", postgres: (await owner.query("SELECT version()")).rows[0],
      ssr: JSON.parse(readFileSync("node_modules/@supabase/ssr/package.json", "utf8")).version,
      supabase: JSON.parse(readFileSync("node_modules/@supabase/supabase-js/package.json", "utf8")).version };
    evidence.sourceAfter = verificationSource();
    assert.equal((evidence.sourceAfter as ReturnType<typeof verificationSource>).manifestHash, source.manifestHash);
    evidence.status = "passed";
  } catch (error) {
    // Assertion messages may contain a session; retain only a scrubbed message, no browser trace/network dump.
    evidence.error = scrub(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await browser?.close();
    if (server?.pid && server.exitCode === null) {
      spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      for (let i = 0; i < 50 && server.exitCode === null; i++) await pause(100);
      evidence.serverExitCode = server.exitCode;
    }
    evidence.serverLog = scrub(serverLog);
    evidence.serviceLogs = names.map(name => ({ name, log: scrub(spawnSync("docker", ["logs", name], { windowsHide: true, encoding: "utf8" }).stderr ?? "") }));
    gateway.closeAllConnections(); await new Promise<void>(r => gateway.close(() => r()));
    await owner?.end();
    evidence.cleanup = names.reverse().map(name => ({ name, status: spawnSync("docker", ["rm", "-f", "--volumes", name], { windowsHide: true, stdio: "ignore" }).status }));
    evidence.networkCleanup = spawnSync("docker", ["network", "rm", network], { windowsHide: true, stdio: "ignore" }).status;
    for (const key of Object.keys(process.env)) if (!(key in oldEnvironment)) delete process.env[key];
    Object.assign(process.env, oldEnvironment);
    writeFileSync(resolve(output, "verification.json"), JSON.stringify({ ...evidence, status: evidence.status ?? "failed", results, commands, finished: new Date().toISOString() }, null, 2));
  }
}
