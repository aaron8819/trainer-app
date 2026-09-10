
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign, randomUUID, webcrypto } from "node:crypto";
import { NextRequest } from "next/server";
import { AUTH_COOKIE, authenticateHostedRequest, authConfiguration, authCookieOptions } from "./authentication";
import { authDestination, authHttp, refreshAuthRequest } from "./auth-http";
import { connectionString } from "./database";

const config = { TRAINER2_AUTH_URL: "https://auth.synthetic.invalid", TRAINER2_AUTH_PUBLISHABLE_KEY: "sb_publishable_fixture",
  TRAINER2_AUTH_ISSUER: "https://auth.synthetic.invalid/auth/v1", TRAINER2_AUTH_AUDIENCE: "authenticated",
  TRAINER2_APP_ORIGIN: "https://trainer.synthetic.invalid" };
const subject = randomUUID();
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "fixture-key", alg: "RS256", use: "sig" };
function token(overrides: Record<string, unknown> = {}, validSignature = true) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: config.TRAINER2_AUTH_ISSUER, aud: "authenticated", sub: subject, exp: now + 3600, iat: now - 1, ...overrides };
  const message = [ { alg: "RS256", kid: jwk.kid, typ: "JWT" }, payload ].map(x => Buffer.from(JSON.stringify(x)).toString("base64url")).join(".");
  return message + "." + (validSignature ? sign("sha256", Buffer.from(message), keys.privateKey) : Buffer.alloc(256)).toString("base64url");
}
function request(jwt?: string, expiresAt = Math.floor(Date.now() / 1000) + 3600) {
  const cookie = jwt ? AUTH_COOKIE + "=base64-" + Buffer.from(JSON.stringify({
    access_token: jwt, refresh_token: "fixture-refresh", token_type: "bearer", expires_at: expiresAt, user: { id: "untrusted-cookie-user" },
  })).toString("base64url") : "";
  return new NextRequest(config.TRAINER2_APP_ORIGIN + "/trainer2/auth", { headers: { cookie } });
}
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  for (const [k, v] of Object.entries(config)) vi.stubEnv(k, v);
  fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/user")) return Response.json({ id: subject });
    return Response.json({ error: "fixture_provider_failure" }, { status: 503 });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("real SDK verification with a controlled JWKS/provider fixture (not real Supabase)", () => {
  it("trusts only verified Supabase sub, ignoring cookie user and request identity assertions", async () => {
    const req = request(token());
    req.headers.set("x-subject", "attacker"); req.headers.set("x-account-id", "attacker");
    expect(await authenticateHostedRequest(req)).toEqual({ issuer: config.TRAINER2_AUTH_ISSUER, subject });
    expect(fetcher.mock.calls.every(([url]) => String(url).startsWith(config.TRAINER2_AUTH_URL + "/auth/v1/"))).toBe(true);
  });
  it.each([
    ["signature", {}, false], ["issuer", { iss: "https://attacker.invalid" }, true],
    ["audience", { aud: "service_role" }, true], ["multi-audience", { aud: ["authenticated", "evil"] }, true],
    ["expiry", { exp: 1 }, true], ["missing-expiry", { exp: undefined }, true],
    ["subject", { sub: "" }, true], ["missing-subject", { sub: undefined }, true],
    ["email-subject", { sub: "a@example.invalid" }, true],
    ["not-before", { nbf: 9e12 }, true], ["future-issued", { iat: 9e12 }, true],
  ])("rejects %s", async (_name, overrides, valid) => {
    await expect(authenticateHostedRequest(request(token(overrides as Record<string, unknown>, valid as boolean)))).rejects.toThrow("UNAUTHENTICATED");
  });
  it.each([undefined, "malformed", "a.b.c"])("rejects missing/malformed transport %s", async jwt => {
    await expect(authenticateHostedRequest(request(jwt))).rejects.toThrow("UNAUTHENTICATED");
  });
  it("requires configured trust; bearer-only and conflicting transports are rejected", async () => {
    for (const jwt of [undefined, token()]) {
      const req = request(jwt); req.headers.set("authorization", "Bearer ignored");
      await expect(authenticateHostedRequest(req)).rejects.toThrow("UNSUPPORTED_CREDENTIAL_TRANSPORT");
    }
    vi.stubEnv("TRAINER2_AUTH_URL", "");
    await expect(authenticateHostedRequest(request())).rejects.toThrow("AUTHENTICATION_NOT_CONFIGURED");
  });
  it("provider outage and refresh failure never produce an identity", async () => {
    fetcher.mockImplementation(async () => Response.json({ error: "fixture outage" }, { status: 503 }));
    await expect(authenticateHostedRequest(request(token()))).rejects.toThrow("UNAUTHENTICATED");
    fetcher.mockImplementation(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    await expect(authenticateHostedRequest(request(token(), 1))).rejects.toThrow("UNAUTHENTICATED");
  });
  it("requires live provider user to agree with verified subject", async () => {
    fetcher.mockImplementation(async (input: unknown) => Response.json(String(input).endsWith("/user") ? { id: randomUUID() } : { keys: [jwk] }));
    await expect(authenticateHostedRequest(request(token()))).rejects.toThrow("UNAUTHENTICATED");
  });
  it("keeps independent concurrent sessions isolated", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => authenticateHostedRequest(request(i % 2 ? token() : undefined)).catch(() => null)));
    results.forEach((r, i) => expect(r).toEqual(i % 2 ? { issuer: config.TRAINER2_AUTH_ISSUER, subject } : null));
  });
  it("propagates a refreshed session to both request and response with no-store", async () => {
    fetcher.mockImplementation(async (input: unknown) => {
      if (String(input).includes("/token")) return Response.json({ access_token: token(), refresh_token: "fixture-new-refresh", expires_in: 3600, token_type: "bearer", user: { id: subject } });
      return Response.json(String(input).endsWith("/user") ? { id: subject } : { keys: [jwk] });
    });
    const req = request(token(), 1);
    const response = await refreshAuthRequest(req);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.cookies.getAll().some(c => c.name.startsWith(AUTH_COOKIE))).toBe(true);
    expect(response.headers.get("x-middleware-request-cookie")).toContain(AUTH_COOKIE);
    expect(req.cookies.get(AUTH_COOKIE)?.value).toContain("base64-");
    expect(response.cookies.getAll().every(c => c.secure && c.sameSite === "lax" && c.path === "/" && !c.httpOnly)).toBe(true);
  });
});

describe("auth request protections", () => {
  it.each(["https://evil.invalid", "//evil.invalid", "/%2f%2fevil.invalid", "%2ftrainer2%2fauth", "/trainer2/auth?next=x", "/trainer2/auth/../dev", "/\\evil", "", "/trainer2/auth#x"])("rejects redirect %s", value => {
    expect(() => authDestination(value)).toThrow("INVALID_REDIRECT");
  });
  it("accepts only the configured destination and uses secure cookies off loopback", () => {
    expect(authDestination(null)).toBe("/trainer2/auth");
    expect(authDestination("/trainer2/auth")).toBe("/trainer2/auth");
    expect(authCookieOptions(authConfiguration()).secure).toBe(true);
    for (const values of [{ TRAINER2_AUTH_ISSUER: "https://evil.invalid" }, { TRAINER2_APP_ORIGIN: "https://example.invalid/" }, { TRAINER2_AUTH_URL: "http://remote.invalid" }, { TRAINER2_AUTH_AUDIENCE: "other" }])
      expect(() => authConfiguration({ ...config, ...values })).toThrow("AUTHENTICATION_CONFIGURATION_INVALID");
  });
  it.each(["sign-in", "logout"] as const)("rejects missing/foreign origin and wrong method for %s", async op => {
    for (const [method, origin, site] of [["GET", config.TRAINER2_APP_ORIGIN, "same-origin"], ["POST", "", "same-origin"], ["POST", "https://evil.invalid", "cross-site"], ["POST", config.TRAINER2_APP_ORIGIN, "cross-site"]]) {
      const res = await authHttp(new NextRequest(config.TRAINER2_APP_ORIGIN, { method, headers: { origin, "sec-fetch-site": site } }), op);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_ORIGIN" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("initiation suppresses provider errors and disables Auth user creation", async () => {
    const res = await authHttp(new NextRequest(config.TRAINER2_APP_ORIGIN, { method: "POST", headers: { origin: config.TRAINER2_APP_ORIGIN }, body: "email=a%40synthetic.invalid" }), "sign-in");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(config.TRAINER2_APP_ORIGIN + "/trainer2/auth?notice=sent");
    const [, init] = fetcher.mock.calls.find(([url]) => String(url).includes("/otp"))!;
    expect(JSON.parse((init as RequestInit).body as string).create_user).toBe(false);
  });
  it.each(["", "?code=bad", "?code=a&code=b", "?token_hash=secret&type=email", "?code=" + randomUUID()])("denies malformed/missing/invalid callbacks %s", async query => {
    const res = await authHttp(new NextRequest(config.TRAINER2_APP_ORIGIN + "/trainer2/auth/callback" + query), "callback");
    expect(res.status).toBe(400); expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

it("dedicated connection configuration fails closed without a privileged default", () => {
  const env = { DATABASE_URL: "postgresql://postgres:synthetic@127.0.0.1/trainer2_disposable_test" };
  expect(() => connectionString("identity", true, env)).toThrow("DATABASE_CONFIGURATION_REQUIRED");
  for (const url of [env.DATABASE_URL, "postgresql://trainer2_identity_reader:x@remote.invalid/trainer2_disposable_test", "postgresql://trainer2_identity_reader:x@127.0.0.1/shared", "postgresql://trainer2_identity_reader:x@127.0.0.1/trainer2_disposable_test?options=-c%20role=postgres"])
    expect(() => connectionString("identity", true, { TRAINER2_IDENTITY_CONNECTION_STRING: url })).toThrow();
});
