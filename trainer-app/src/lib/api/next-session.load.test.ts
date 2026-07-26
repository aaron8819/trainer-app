import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveActivePlanContext: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("./active-plan-context", () => ({
  resolveActivePlanContext: (...args: unknown[]) =>
    mocks.resolveActivePlanContext(...args),
}));

import { loadNextWorkoutContext } from "./next-session";

describe("loadNextWorkoutContext selected-plan boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed without deriving legacy rotation when the selected plan is unavailable", async () => {
    mocks.resolveActivePlanContext.mockResolvedValue({
      status: "NO_SELECTED_PLAN",
      owner: {
        id: "user-1",
        email: "owner@test.local",
        activeMacroCycleId: null,
      },
      activeMacroCycle: null,
      activeMesocycle: null,
    });

    await expect(loadNextWorkoutContext("user-1")).resolves.toMatchObject({
      activeMesocycleId: null,
      intent: null,
      source: "active_plan_unavailable",
      derivationTrace: ["active_plan_context status=NO_SELECTED_PLAN"],
    });
  });

  it("uses the selected plan's pending handoff identity", async () => {
    mocks.resolveActivePlanContext.mockResolvedValue({
      status: "HANDOFF_PENDING",
      owner: {
        id: "user-1",
        email: "owner@test.local",
        activeMacroCycleId: "plan-1",
      },
      activeMacroCycle: { id: "plan-1", userId: "user-1" },
      activeMesocycle: null,
      handoff: { id: "meso-1", macroCycleId: "plan-1" },
    });

    await expect(loadNextWorkoutContext("user-1")).resolves.toMatchObject({
      activeMesocycleId: null,
      intent: null,
      source: "handoff_pending",
      derivationTrace: ["pending_handoff mesocycle=meso-1"],
    });
  });
});
