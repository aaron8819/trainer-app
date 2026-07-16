import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalWritePause = process.env.TRAINER_WRITE_PAUSE;

afterEach(() => {
  if (originalWritePause === undefined) delete process.env.TRAINER_WRITE_PAUSE;
  else process.env.TRAINER_WRITE_PAUSE = originalWritePause;
});

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const preparePreSessionReadinessSnapshot = vi.fn();

  return {
    resolveOwner,
    preparePreSessionReadinessSnapshot,
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/pre-session-readiness-producer", () => ({
  preparePreSessionReadinessSnapshot: (...args: unknown[]) =>
    mocks.preparePreSessionReadinessSnapshot(...args),
}));

import { POST } from "./route";

describe("POST /api/pre-session-readiness/prepare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRAINER_WRITE_PAUSE;
    mocks.resolveOwner.mockResolvedValue({
      id: "user-1",
      email: "owner@local",
    });
    mocks.preparePreSessionReadinessSnapshot.mockResolvedValue({
      status: "prepared",
      snapshot: { id: "snapshot-1" },
      invalidatedSnapshotCount: 1,
      replacementPolicy: "atomic_replace",
      contract: { contractVersion: 1 },
      gymCard: { action: "start" },
    });
  });

  it("returns 503 before owner resolution or readiness snapshot changes when writes are paused", async () => {
    process.env.TRAINER_WRITE_PAUSE = "enabled";
    const response = await POST();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    await expect(response.json()).resolves.toMatchObject({ code: "PRODUCTION_WRITE_PAUSED" });
    expect(mocks.resolveOwner).not.toHaveBeenCalled();
    expect(mocks.preparePreSessionReadinessSnapshot).not.toHaveBeenCalled();
  });

  it("delegates to the app-owned producer and returns the saved contract/card", async () => {
    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.preparePreSessionReadinessSnapshot).toHaveBeenCalledWith(
      "user-1",
      { ownerEmail: "owner@local" }
    );
    expect(body).toEqual({
      ok: true,
      status: "prepared",
      snapshotId: "snapshot-1",
      invalidatedSnapshotCount: 1,
      replacementPolicy: "atomic_replace",
      preSessionReadinessContract: { contractVersion: 1 },
      preSessionReadinessCard: { action: "start" },
    });
  });

  it("returns a blocked response without synthesizing readiness", async () => {
    mocks.preparePreSessionReadinessSnapshot.mockResolvedValue({
      status: "blocked",
      reason: "no_next_session",
      message: "No concrete next-session identity is available.",
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      status: "blocked",
      reason: "no_next_session",
      message: "No concrete next-session identity is available.",
    });
  });
});
