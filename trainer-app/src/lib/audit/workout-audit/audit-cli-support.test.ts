import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

import {
  buildResolvedAuditIdentityRequest,
  runAuditPreflight,
} from "../../../../scripts/audit-cli-support";

describe("audit-cli-support", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalOwnerEmail = process.env.OWNER_EMAIL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://example.test:5432/trainer";
    delete process.env.OWNER_EMAIL;
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }

    if (originalOwnerEmail === undefined) {
      delete process.env.OWNER_EMAIL;
    } else {
      process.env.OWNER_EMAIL = originalOwnerEmail;
    }
  });

  it("uses explicit owner flag without changing precedence", async () => {
    const resolveIdentity = vi.fn().mockResolvedValue({
      userId: "user-1",
      ownerEmail: "owner@test.local",
    });

    const preflight = await runAuditPreflight({
      args: { owner: "owner@test.local" },
      resolveIdentity,
      checkDb: vi.fn().mockResolvedValue(undefined),
    });

    expect(resolveIdentity).toHaveBeenCalledWith({
      userId: undefined,
      ownerEmail: "owner@test.local",
    });
    expect(preflight.ownerEmail).toBe("owner@test.local");
    expect(preflight.resolvedUserId).toBe("user-1");
    expect(preflight.ownerSource).toBe("owner-flag");
  });

  it("falls back to the app default owner from OWNER_EMAIL when no flags are provided", async () => {
    process.env.OWNER_EMAIL = "app-owner@test.local";
    mocks.resolveOwner.mockResolvedValue({
      id: "user-2",
      email: "app-owner@test.local",
    });
    const resolveIdentity = vi.fn();

    const preflight = await runAuditPreflight({
      args: {},
      resolveIdentity,
      checkDb: vi.fn().mockResolvedValue(undefined),
    });

    expect(resolveIdentity).not.toHaveBeenCalled();
    expect(mocks.resolveOwner).toHaveBeenCalledTimes(1);
    expect(preflight.ownerEmail).toBe("app-owner@test.local");
    expect(preflight.resolvedUserId).toBe("user-2");
    expect(preflight.ownerSource).toBe("env-default");
  });

  it("falls back to owner@local app default semantics when OWNER_EMAIL is absent", async () => {
    mocks.resolveOwner.mockResolvedValue({
      id: "user-3",
      email: "owner@local",
    });

    const preflight = await runAuditPreflight({
      args: {},
      resolveIdentity: vi.fn(),
      checkDb: vi.fn().mockResolvedValue(undefined),
    });

    expect(preflight.ownerEmail).toBe("owner@local");
    expect(preflight.resolvedUserId).toBe("user-3");
    expect(preflight.ownerSource).toBe("fallback-default");
  });

  it("builds request identity from explicit flags before preflight defaults", () => {
    expect(
      buildResolvedAuditIdentityRequest(
        { "user-id": "user-4", owner: "owner@test.local" },
        { resolvedUserId: "ignored", ownerEmail: "ignored@test.local" }
      )
    ).toEqual({ userId: "user-4" });

    expect(
      buildResolvedAuditIdentityRequest(
        { owner: "owner@test.local" },
        { resolvedUserId: "ignored", ownerEmail: "ignored@test.local" }
      )
    ).toEqual({ ownerEmail: "owner@test.local" });

    expect(
      buildResolvedAuditIdentityRequest(
        {},
        { resolvedUserId: "user-5", ownerEmail: "app-owner@test.local" }
      )
    ).toEqual({ ownerEmail: "app-owner@test.local" });
  });
});
