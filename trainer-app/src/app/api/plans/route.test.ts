import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPlan: vi.fn(),
  loadPlanManagementData: vi.fn(),
  provisionOwnerForMutation: vi.fn(),
}));

vi.mock("@/lib/api/plan-management", () => ({
  createPlan: mocks.createPlan,
  loadPlanManagementData: mocks.loadPlanManagementData,
}));
vi.mock("@/lib/api/workout-context", () => ({
  provisionOwnerForMutation: mocks.provisionOwnerForMutation,
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/operations/production-write-gate-http", () => ({
  productionWritePauseResponse: vi.fn(() => null),
}));

import { POST } from "./route";

describe("POST /api/plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed Strength requests before owner resolution or creation", async () => {
    const response = await POST(
      new Request("http://localhost/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planType: "STRENGTH",
          name: "Malformed",
          startDate: "2026-08-03",
          configuration: {
            emphasis: "BALANCED",
            daysPerWeek: 1,
            sessionDurationMinutes: 30,
            equipmentProfile: "FULL_GYM",
            preferredLifts: {
              squat: "AUTO",
              press: "AUTO",
              hinge: "AUTO",
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "PLAN_VALIDATION_FAILED",
    });
    expect(mocks.provisionOwnerForMutation).not.toHaveBeenCalled();
    expect(mocks.createPlan).not.toHaveBeenCalled();
  });
});
