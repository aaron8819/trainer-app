import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { makeVerifier, sessionForRequest, SESSION_COOKIE, sessionCookieOptions } from "./sessions";

afterEach(() => vi.unstubAllEnvs());

describe("single-user device sessions", () => {
  it("does not admit a retained synthetic cookie after an owner transition", async () => {
    const realAccountId = randomUUID(); vi.stubEnv("TRAINER2_OWNER_USER_ID", realAccountId);
    const id = randomUUID(), secret = randomBytes(32).toString("base64url");
    const owner = { id: 1, accountId: realAccountId, passcodeVerifier: "real-verifier", sessionEpoch: 9 };
    const session = { id, ownerId: 1, tokenHash: createHash("sha256").update(secret).digest("hex"),
      epoch: 8, revokedAt: null as Date | null, expiresAt: new Date(Date.now() + 100000), absoluteExpiresAt: new Date(Date.now() + 100000) };
    const db = { trainer2Owner: { findMany: vi.fn(async () => [owner]) },
      trainer2DeviceSession: { findUnique: vi.fn(async () => session) } };
    const request = new Request("https://example.invalid", { headers: { cookie: `${SESSION_COOKIE}=${id}.${secret}` } });
    await expect(sessionForRequest(db as never, request)).rejects.toThrow("UNAUTHENTICATED");
    session.epoch = 9; session.revokedAt = new Date();
    await expect(sessionForRequest(db as never, request)).rejects.toThrow("UNAUTHENTICATED");
  });
  it("keeps only a strong verifier and an HttpOnly persistent host cookie", async () => {
    const encoded = await makeVerifier("a long synthetic passcode");
    expect(encoded).toMatch(/^scrypt-v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(encoded).not.toContain("synthetic passcode");
    expect(sessionCookieOptions()).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 7776000 });
  });
  it("denies absent binding, mismatched owner, missing cookie, expiry, revocation and epoch change", async () => {
    const accountId = randomUUID(); vi.stubEnv("TRAINER2_OWNER_USER_ID", accountId);
    const id = randomUUID(), secret = randomBytes(32).toString("base64url");
    const session: { id: string; ownerId: number; tokenHash: string; epoch: number; revokedAt: Date | null;
      expiresAt: Date; absoluteExpiresAt: Date } = { id, ownerId: 1,
      tokenHash: createHash("sha256").update(secret).digest("hex"),
      epoch: 0, revokedAt: null, expiresAt: new Date(Date.now() + 100000), absoluteExpiresAt: new Date(Date.now() + 100000) };
    const owner = { id: 1, accountId, passcodeVerifier: "verifier", setupVerifier: null, sessionEpoch: 0 };
    const db = { trainer2Owner: { findMany: vi.fn(async () => [owner]) },
      trainer2DeviceSession: { findUnique: vi.fn(async () => session) } };
    const request = new Request("https://example.invalid", { headers: { cookie: `${SESSION_COOKIE}=${id}.${secret}` } });
    expect(await sessionForRequest(db as never, request)).toEqual({ accountId, sessionId: id });
    await expect(sessionForRequest(db as never, new Request("https://example.invalid"))).rejects.toThrow("UNAUTHENTICATED");
    owner.accountId = randomUUID();
    await expect(sessionForRequest(db as never, request)).rejects.toThrow("OWNER_BINDING_INVALID");
    owner.accountId = accountId;
    session.revokedAt = new Date();
    await expect(sessionForRequest(db as never, request)).rejects.toThrow("UNAUTHENTICATED");
    session.revokedAt = null;
    session.expiresAt = new Date(Date.now() - 1);
    await expect(sessionForRequest(db as never, request)).rejects.toThrow("UNAUTHENTICATED");
    session.expiresAt = new Date(Date.now() + 100000); session.epoch = 1;
    await expect(sessionForRequest(db as never, request)).rejects.toThrow("UNAUTHENTICATED");
  });
});
