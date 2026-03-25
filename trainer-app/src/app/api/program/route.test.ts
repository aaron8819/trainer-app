import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const loadPendingMesocycleHandoff = vi.fn();
  const loadProgramDashboardData = vi.fn();
  const applyCycleAnchor = vi.fn();

  return {
    resolveOwner,
    loadPendingMesocycleHandoff,
    loadProgramDashboardData,
    applyCycleAnchor,
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff", () => ({
  loadPendingMesocycleHandoff: (...args: unknown[]) => mocks.loadPendingMesocycleHandoff(...args),
}));

vi.mock("@/lib/api/program", () => ({
  loadProgramDashboardData: (...args: unknown[]) => mocks.loadProgramDashboardData(...args),
  applyCycleAnchor: (...args: unknown[]) => mocks.applyCycleAnchor(...args),
}));

import { PATCH } from "./route";

describe("PATCH /api/program", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.loadPendingMesocycleHandoff.mockResolvedValue(null);
  });

  it("rejects the removed skip_phase action", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/program", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "skip_phase" }),
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid action" });
    expect(mocks.applyCycleAnchor).not.toHaveBeenCalled();
  });
});
