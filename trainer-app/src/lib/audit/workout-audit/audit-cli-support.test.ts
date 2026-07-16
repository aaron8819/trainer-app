import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

import {
  buildResolvedAuditIdentityRequest,
  loadAuditEnv,
  runAuditPreflight,
} from "../../../../scripts/audit-cli-support";

describe("audit-cli-support", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalOwnerEmail = process.env.OWNER_EMAIL;
  const originalWritePause = process.env.TRAINER_WRITE_PAUSE;
  const tempRoots: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgres://example.test:5432/trainer";
    delete process.env.OWNER_EMAIL;
    delete process.env.TRAINER_WRITE_PAUSE;
  });

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
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

    if (originalWritePause === undefined) {
      delete process.env.TRAINER_WRITE_PAUSE;
    } else {
      process.env.TRAINER_WRITE_PAUSE = originalWritePause;
    }
  });

  it("requires an explicitly supplied environment file", () => {
    expect(() => loadAuditEnv([])).toThrow("Missing required --env-file");
  });

  it("loads only the explicitly supplied audit environment", () => {
    const root = join(tmpdir(), `trainer-audit-env-${crypto.randomUUID()}`);
    mkdirSync(root, { recursive: true });
    tempRoots.push(root);
    const envFile = join(root, "audit.env");
    writeFileSync(envFile, "DATABASE_URL=postgresql://trainer:secret@127.0.0.1:5432/trainer\n");

    expect(loadAuditEnv(["--env-file", envFile])).toMatchObject({
      envLoaded: true,
      envFilePath: envFile,
      targetClass: "local",
    });
  });

  it("blocks a confirmed remote audit mutation before database imports when paused", () => {
    const root = join(tmpdir(), `trainer-audit-paused-${crypto.randomUUID()}`);
    mkdirSync(root, { recursive: true });
    tempRoots.push(root);
    const envFile = join(root, "audit.env");
    writeFileSync(
      envFile,
      "DATABASE_URL=postgresql://trainer:secret@db.example.test:5432/trainer\nTRAINER_WRITE_PAUSE=enabled\n",
    );

    expect(() =>
      loadAuditEnv(["--env-file", envFile, "--confirm-remote-write"], {
        allowWrite: true,
        writeRequested: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "PRODUCTION_WRITE_PAUSED" }));
  });

  it("allows a paused remote audit dry run", () => {
    const root = join(tmpdir(), `trainer-audit-dry-${crypto.randomUUID()}`);
    mkdirSync(root, { recursive: true });
    tempRoots.push(root);
    const envFile = join(root, "audit.env");
    writeFileSync(
      envFile,
      "DATABASE_URL=postgresql://trainer:secret@db.example.test:5432/trainer\nTRAINER_WRITE_PAUSE=enabled\n",
    );

    expect(loadAuditEnv(["--env-file", envFile], { allowWrite: true })).toMatchObject({
      targetClass: "remote",
    });
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
