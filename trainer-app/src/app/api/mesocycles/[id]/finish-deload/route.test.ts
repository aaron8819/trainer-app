import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const finishDeloadEarly = vi.fn();

  return {
    resolveOwner,
    finishDeloadEarly,
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/mesocycle-lifecycle")>();
  return {
    ...actual,
    finishDeloadEarly: (...args: unknown[]) => mocks.finishDeloadEarly(...args),
  };
});

import { FinishDeloadEarlyBlockedWorkoutError } from "@/lib/api/mesocycle-lifecycle";
import { POST } from "./route";

describe("POST /api/mesocycles/[id]/finish-deload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
  });

  it("requires an owner", async () => {
    mocks.resolveOwner.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/finish-deload", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "User not found",
    });
    expect(mocks.finishDeloadEarly).not.toHaveBeenCalled();
  });

  it("finishes an active deload and returns handoff readiness", async () => {
    mocks.finishDeloadEarly.mockResolvedValue({
      mesocycle: {
        id: "meso-1",
        state: "AWAITING_HANDOFF",
        closedAt: new Date("2026-03-10T00:00:00.000Z"),
      },
      skippedWorkoutIds: ["planned-deload"],
      skippedWorkoutCount: 1,
      handoffSummaryCreated: true,
      nextSeedDraftCreated: true,
    });

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/finish-deload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      action: "finish_deload_early",
      mesocycle: {
        id: "meso-1",
        state: "AWAITING_HANDOFF",
        closedAt: "2026-03-10T00:00:00.000Z",
      },
      skippedWorkoutIds: ["planned-deload"],
      skippedWorkoutCount: 1,
      handoffSummaryCreated: true,
      nextSeedDraftCreated: true,
    });
    expect(mocks.finishDeloadEarly).toHaveBeenCalledWith({
      userId: "user-1",
      mesocycleId: "meso-1",
    });
  });

  it("rejects non-object request payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/finish-deload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify("finish"),
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(400);
    expect(mocks.finishDeloadEarly).not.toHaveBeenCalled();
  });

  it("rejects non-ACTIVE_DELOAD mesocycles", async () => {
    mocks.finishDeloadEarly.mockRejectedValue(
      new Error("MESOCYCLE_FINISH_DELOAD_INVALID_STATE")
    );

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/finish-deload", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "Mesocycle is not in active deload.",
    });
  });

  it("surfaces performed-log blockers without entering handoff", async () => {
    mocks.finishDeloadEarly.mockRejectedValue(
      new FinishDeloadEarlyBlockedWorkoutError(["workout-1"])
    );

    const response = await POST(
      new Request("http://localhost/api/mesocycles/meso-1/finish-deload", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "meso-1" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error:
        "Resolve incomplete workouts with performed logs or unclear deload scope before finishing deload early.",
      workoutIds: ["workout-1"],
    });
  });
});
