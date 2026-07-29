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
});
