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

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  FinishMesocycleEarlyBlockedWorkoutError: class FinishMesocycleEarlyBlockedWorkoutError extends Error {
    readonly workoutIds: string[];

    constructor(workoutIds: string[]) {
      super("MESOCYCLE_FINISH_EARLY_WORKOUT_HAS_PERFORMED_LOGS");
      this.workoutIds = workoutIds;
    }
  },
}));

import { PATCH } from "./route";
import { FinishMesocycleEarlyBlockedWorkoutError } from "@/lib/api/mesocycle-lifecycle";

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

  it("delegates the explicit early-close action to the canonical lifecycle owner", async () => {
    mocks.applyCycleAnchor.mockResolvedValue(undefined);

    const response = await PATCH(
      new NextRequest("http://localhost/api/program", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end_early" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.applyCycleAnchor).toHaveBeenCalledWith("user-1", "end_early");
  });

  it("returns a conflict when incomplete performed work blocks early close", async () => {
    mocks.applyCycleAnchor.mockRejectedValue(
      new FinishMesocycleEarlyBlockedWorkoutError(["workout-1"])
    );

    const response = await PATCH(
      new NextRequest("http://localhost/api/program", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end_early" }),
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Resolve incomplete workouts with performed logs before ending the mesocycle early.",
      workoutIds: ["workout-1"],
    });
  });
});
