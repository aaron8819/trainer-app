import { beforeEach, describe, expect, it, vi } from "vitest";

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
    mocks.resolveOwner.mockResolvedValue({
      id: "user-1",
      email: "owner@local",
    });
    mocks.preparePreSessionReadinessSnapshot.mockResolvedValue({
      status: "prepared",
      snapshot: { id: "snapshot-1" },
      invalidatedSnapshotCount: 1,
      replacementPolicy: "replace_matching_identity",
      contract: { contractVersion: 1 },
      gymCard: { action: "start" },
    });
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
      replacementPolicy: "replace_matching_identity",
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
