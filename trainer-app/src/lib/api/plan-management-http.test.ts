import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { PlanManagementError } from "./plan-management-errors";
import { planManagementErrorResponse } from "./plan-management-http";

describe("plan management HTTP errors", () => {
  it("returns stable creation-specific guidance for Strength infeasibility", async () => {
    const response = planManagementErrorResponse(
      new PlanManagementError("PLAN_CREATION_INFEASIBLE"),
    );

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      code: "PLAN_CREATION_INFEASIBLE",
      error:
        "The requested Strength plan could not be created because the available equipment and/or active limitations leave no compatible exercise for required programming. Adjust your available equipment, active limitations, training schedule or configuration, or lift preferences, then try again.",
    });
  });

  it("keeps finalize-time invalid-plan guidance distinct", async () => {
    const response = planManagementErrorResponse(
      new PlanManagementError("PLAN_INVALID"),
    );

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      code: "PLAN_INVALID",
      error: "The generated plan is incomplete and cannot be finalized.",
    });
  });

  it("returns a stable conflict for untrusted draft measurement snapshots", async () => {
    const response = planManagementErrorResponse(
      new PlanManagementError(
        "PLAN_DRAFT_MEASUREMENT_PROVENANCE_INVALID",
      ),
    );

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      code: "PLAN_DRAFT_MEASUREMENT_PROVENANCE_INVALID",
      error:
        "The saved measurement snapshot is not trusted. Refresh the draft and try again.",
    });
  });

  it("does not expose unrecognized V4 limitation text", async () => {
    const response = planManagementErrorResponse(
      new PlanManagementError("PLAN_LIMITATION_UNRECOGNIZED", {
        scope: "custom_hypertrophy",
      }),
    );

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toEqual({
      code: "PLAN_LIMITATION_UNRECOGNIZED",
      error:
        "An active exercise limitation is not recognized. Update or remove it before finalizing this plan.",
    });
  });

  it("returns the server-authored current Health when warning confirmation is stale", async () => {
    const health = {
      status: "AVAILABLE",
      policyVersion: "draft-plan-health.v2",
      draftId: "plan-1",
      draftRevision: 3,
      confirmationScope: `plan-health-confirmation.v1.${"a".repeat(64)}`,
    };
    const response = planManagementErrorResponse(
      new PlanManagementError(
        "PLAN_WARNING_CONFIRMATION_REQUIRED",
        { warningCount: "1", confirmationStatus: "MISMATCH" },
        { health },
      ),
    );

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toMatchObject({
      code: "PLAN_WARNING_CONFIRMATION_REQUIRED",
      confirmationStatus: "MISMATCH",
      warningCount: "1",
      health,
    });
  });

  it("fails closed when finalization-time Health evaluation is unavailable", async () => {
    const response = planManagementErrorResponse(
      new PlanManagementError("PLAN_HEALTH_EVALUATION_FAILED"),
    );

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      code: "PLAN_HEALTH_EVALUATION_FAILED",
      error:
        "Plan Health could not be refreshed. Keep editing and try again; finalization remains unavailable until the current plan can be checked.",
    });
  });
});
