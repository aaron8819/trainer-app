import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalCustomRollout =
  process.env.TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT;

const mocks = vi.hoisted(() => ({
  assertPlanVersionFinalizable: vi.fn(),
  finalizePlan: vi.fn(),
  makeHypertrophyPlanReady: vi.fn(),
  findOwnerReadOnly: vi.fn(),
  provisionOwnerForMutation: vi.fn(),
}));

vi.mock("@/lib/api/plan-management", () => ({
  assertPlanVersionFinalizable: mocks.assertPlanVersionFinalizable,
  finalizePlan: mocks.finalizePlan,
}));
vi.mock("@/lib/api/hypertrophy-plan-drafts", () => ({
  makeHypertrophyPlanReady: mocks.makeHypertrophyPlanReady,
}));
vi.mock("@/lib/api/workout-context", () => ({
  findOwnerReadOnly: mocks.findOwnerReadOnly,
  provisionOwnerForMutation: mocks.provisionOwnerForMutation,
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/operations/production-write-gate-http", () => ({
  productionWritePauseResponse: vi.fn(() => null),
}));

import { PlanManagementError } from "@/lib/api/plan-management-errors";
import { POST } from "./route";

const context = { params: Promise.resolve({ id: "weekly-plan" }) };

describe("POST /api/plans/[id]/finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT = "enabled";
    mocks.assertPlanVersionFinalizable.mockResolvedValue(undefined);
    mocks.findOwnerReadOnly.mockResolvedValue({ id: "user-1" });
    mocks.provisionOwnerForMutation.mockResolvedValue({ id: "user-1" });
    mocks.finalizePlan.mockResolvedValue({ id: "legacy-plan" });
    mocks.makeHypertrophyPlanReady.mockResolvedValue({ planId: "custom-plan" });
  });

  afterEach(() => {
    if (originalCustomRollout === undefined) {
      delete process.env.TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT;
    } else {
      process.env.TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT =
        originalCustomRollout;
    }
  });

  it("forwards the confirmed V4 preview to atomic make-ready acceptance", async () => {
    const hash = "a".repeat(64);
    const response = await POST(
      new Request("http://localhost/api/plans/weekly-plan/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedDraftRevision: 3,
          warningsConfirmed: true,
          confirmedPreviewHash: hash,
        }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.assertPlanVersionFinalizable).not.toHaveBeenCalled();
    expect(mocks.makeHypertrophyPlanReady).toHaveBeenCalledWith({
      userId: "user-1",
      planId: "weekly-plan",
      expectedDraftRevision: 3,
      warningsConfirmed: true,
      confirmedPreviewHash: hash,
    });
    expect(mocks.finalizePlan).not.toHaveBeenCalled();
  });

  it("rejects a custom finalize request explicitly when rollout is disabled", async () => {
    delete process.env.TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT;
    const response = await POST(
      new Request("http://localhost/api/plans/weekly-plan/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedDraftRevision: 3 }),
      }),
      context,
    );

    expect(response.status).toBe(503);
    expect(mocks.provisionOwnerForMutation).not.toHaveBeenCalled();
    expect(mocks.makeHypertrophyPlanReady).not.toHaveBeenCalled();
  });

  it("keeps the legacy non-executable guard on legacy finalize requests", async () => {
    mocks.assertPlanVersionFinalizable.mockRejectedValue(
      new PlanManagementError("PLAN_VERSION_NOT_EXECUTABLE"),
    );
    const response = await POST(
      new Request("http://localhost/api/plans/weekly-plan/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: "2026-08-06T00:00:00.000Z" }),
      }),
      context,
    );
    expect(response.status).toBe(409);
    expect(mocks.provisionOwnerForMutation).not.toHaveBeenCalled();
  });

  it("preserves legacy expectedUpdatedAt finalization", async () => {
    const expectedUpdatedAt = "2026-08-06T00:00:00.000Z";
    const response = await POST(
      new Request("http://localhost/api/plans/legacy-plan/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt }),
      }),
      { params: Promise.resolve({ id: "legacy-plan" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.finalizePlan).toHaveBeenCalledWith({
      userId: "user-1",
      planId: "legacy-plan",
      expectedUpdatedAt,
    });
  });
});
