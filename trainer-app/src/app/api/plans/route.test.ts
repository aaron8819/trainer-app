import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalCustomRollout =
  process.env.TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT;

const mocks = vi.hoisted(() => ({
  createPlan: vi.fn(),
  loadPlanManagementData: vi.fn(),
  provisionOwnerForMutation: vi.fn(),
  createCustomHypertrophyPlan: vi.fn(),
}));

vi.mock("@/lib/api/plan-management", () => ({
  createPlan: mocks.createPlan,
  loadPlanManagementData: mocks.loadPlanManagementData,
}));
vi.mock("@/lib/api/workout-context", () => ({
  provisionOwnerForMutation: mocks.provisionOwnerForMutation,
}));
vi.mock("@/lib/api/hypertrophy-plan-drafts", () => ({
  createCustomHypertrophyPlan: mocks.createCustomHypertrophyPlan,
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/operations/production-write-gate-http", () => ({
  productionWritePauseResponse: vi.fn(() => null),
}));

import { POST } from "./route";

describe("POST /api/plans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT;
  });

  afterEach(() => {
    if (originalCustomRollout === undefined) {
      delete process.env.TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT;
    } else {
      process.env.TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT =
        originalCustomRollout;
    }
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

  it("keeps weekly authoring unavailable when the custom-plan flag is off", async () => {
    const response = await POST(
      new Request("http://localhost/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planType: "HYPERTROPHY",
          name: "Weekly",
          sessionsPerWeek: 4,
          equipmentProfile: "FULL_GYM",
          sessionDurationMinutes: 60,
          authorMethod: "WEEKLY",
          preset: "UPPER_LOWER_4",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.provisionOwnerForMutation).not.toHaveBeenCalled();
    expect(mocks.createCustomHypertrophyPlan).not.toHaveBeenCalled();
  });

  it("creates an explicit V4 weekly draft when the custom-plan flag is on", async () => {
    process.env.TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT = "enabled";
    mocks.provisionOwnerForMutation.mockResolvedValue({ id: "user-1" });
    mocks.createCustomHypertrophyPlan.mockResolvedValue({
      planId: "plan-v4",
      draftRevision: 1,
    });
    mocks.loadPlanManagementData.mockResolvedValue({
      activeMacroCycleId: null,
      plans: [{ id: "plan-v4", status: "DRAFT" }],
    });

    const response = await POST(
      new Request("http://localhost/api/plans", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planType: "HYPERTROPHY",
          name: "Weekly",
          sessionsPerWeek: 4,
          equipmentProfile: "FULL_GYM",
          sessionDurationMinutes: 60,
          authorMethod: "WEEKLY",
          preset: "UPPER_LOWER_4",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createCustomHypertrophyPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        authorMethod: "WEEKLY",
        sessionsPerWeek: 4,
      }),
    );
  });
});
