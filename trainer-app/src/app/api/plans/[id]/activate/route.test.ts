import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalWritePause = process.env.TRAINER_WRITE_PAUSE;

const mocks = vi.hoisted(() => ({
  provisionOwnerForMutation: vi.fn(),
  loadPlanActivationTarget: vi.fn(),
  selectActivePlan: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  provisionOwnerForMutation: (...args: unknown[]) => mocks.provisionOwnerForMutation(...args),
}));
vi.mock("@/lib/api/plan-management", () => ({
  PlanManagementError: class PlanManagementError extends Error {},
  loadPlanActivationTarget: (...args: unknown[]) =>
    mocks.loadPlanActivationTarget(...args),
}));
vi.mock("@/lib/api/active-plan-context", () => {
  class ActivePlanSelectionConflictError extends Error {
    constructor(readonly currentActiveMacroCycleId: string | null) {
      super("ACTIVE_PLAN_SELECTION_CONFLICT");
    }
  }
  class ActivePlanTargetNotReadyError extends Error {
    constructor() {
      super("ACTIVE_PLAN_TARGET_NOT_READY");
    }
  }
  class ActivePlanTargetArchivedError extends Error {
    constructor() {
      super("ACTIVE_PLAN_TARGET_ARCHIVED");
    }
  }
  class ActivePlanTargetNotFoundError extends Error {
    constructor() {
      super("ACTIVE_PLAN_TARGET_NOT_FOUND");
    }
  }
  class ActiveWorkoutInProgressError extends Error {
    constructor(readonly workoutId: string) {
      super("ACTIVE_WORKOUT_IN_PROGRESS");
    }
  }
  return {
    ActivePlanSelectionConflictError,
    ActivePlanTargetArchivedError,
    ActivePlanTargetNotFoundError,
    ActivePlanTargetNotReadyError,
    ActiveWorkoutInProgressError,
    selectActivePlan: (...args: unknown[]) => mocks.selectActivePlan(...args),
  };
});

import { ActiveWorkoutInProgressError } from "@/lib/api/active-plan-context";
import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/plans/plan-b/activate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/plans/[id]/activate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRAINER_WRITE_PAUSE;
    mocks.provisionOwnerForMutation.mockResolvedValue({ id: "user-1" });
  });

  afterEach(() => {
    if (originalWritePause === undefined) {
      delete process.env.TRAINER_WRITE_PAUSE;
    } else {
      process.env.TRAINER_WRITE_PAUSE = originalWritePause;
    }
  });

  it("returns 503 before owner or plan resolution when writes are paused", async () => {
    process.env.TRAINER_WRITE_PAUSE = "enabled";

    const response = await POST(
      request({ expectedActiveMacroCycleId: null }),
      { params: Promise.resolve({ id: "plan-b" }) },
    );

    expect(response.status).toBe(503);
    expect(mocks.provisionOwnerForMutation).not.toHaveBeenCalled();
    expect(mocks.loadPlanActivationTarget).not.toHaveBeenCalled();
  });

  it("rejects activation of a plan that is not READY", async () => {
    mocks.loadPlanActivationTarget.mockResolvedValue({ status: "NOT_READY" });

    const response = await POST(
      request({ expectedActiveMacroCycleId: "00000000-0000-4000-8000-000000000001" }),
      { params: Promise.resolve({ id: "plan-b" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACTIVE_PLAN_TARGET_NOT_READY",
    });
    expect(mocks.selectActivePlan).not.toHaveBeenCalled();
  });

  it("rejects a V4 draft before active-plan selection writes", async () => {
    mocks.loadPlanActivationTarget.mockResolvedValue({
      status: "VERSION_NOT_EXECUTABLE",
    });

    const response = await POST(
      request({ expectedActiveMacroCycleId: null }),
      { params: Promise.resolve({ id: "plan-b" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PLAN_VERSION_NOT_EXECUTABLE",
    });
    expect(mocks.selectActivePlan).not.toHaveBeenCalled();
  });

  it("returns a structured conflict for an owned archived target", async () => {
    mocks.loadPlanActivationTarget.mockResolvedValue({ status: "ARCHIVED" });

    const response = await POST(
      request({ expectedActiveMacroCycleId: null }),
      { params: Promise.resolve({ id: "plan-b" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACTIVE_PLAN_TARGET_ARCHIVED",
    });
    expect(mocks.selectActivePlan).not.toHaveBeenCalled();
  });

  it("keeps foreign and missing target identities indistinguishable", async () => {
    mocks.loadPlanActivationTarget.mockResolvedValue({ status: "NOT_FOUND" });

    const response = await POST(
      request({ expectedActiveMacroCycleId: null }),
      { params: Promise.resolve({ id: "foreign-plan" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "PLAN_NOT_FOUND",
    });
    expect(mocks.selectActivePlan).not.toHaveBeenCalled();
  });

  it("returns a structured conflict when a workout is in progress", async () => {
    mocks.loadPlanActivationTarget.mockResolvedValue({
      status: "READY",
      activeMesocycleId: "meso-b",
    });
    mocks.selectActivePlan.mockRejectedValue(
      new ActiveWorkoutInProgressError("workout-1"),
    );

    const response = await POST(
      request({ expectedActiveMacroCycleId: "00000000-0000-4000-8000-000000000001" }),
      { params: Promise.resolve({ id: "plan-b" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACTIVE_WORKOUT_IN_PROGRESS",
      workoutId: "workout-1",
    });
  });
});
