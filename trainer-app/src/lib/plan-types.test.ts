import { describe, expect, it } from "vitest";
import {
  isSupportedPlanType,
  planTypeDescription,
  planTypeLabel,
  planTypeLifecyclePolicy,
  requireSupportedPlanType,
  SUPPORTED_PLAN_TYPES,
  toEnginePlanGoal,
} from "./plan-types";

describe("supported plan types", () => {
  it("dispatches every supported persisted type explicitly", () => {
    expect(SUPPORTED_PLAN_TYPES).toEqual(["HYPERTROPHY", "STRENGTH"]);
    expect(SUPPORTED_PLAN_TYPES.map(planTypeLabel)).toEqual([
      "Hypertrophy",
      "Strength",
    ]);
    expect(SUPPORTED_PLAN_TYPES.map(toEnginePlanGoal)).toEqual([
      "hypertrophy",
      "strength",
    ]);
    expect(SUPPORTED_PLAN_TYPES.map(planTypeLifecyclePolicy)).toEqual([
      { completionMode: "HANDOFF" },
      { completionMode: "TERMINAL" },
    ]);
    expect(SUPPORTED_PLAN_TYPES.every(isSupportedPlanType)).toBe(true);
    expect(
      SUPPORTED_PLAN_TYPES.every(
        (planType) => planTypeDescription(planType).length > 20,
      ),
    ).toBe(true);
  });

  it("fails unknown types closed", () => {
    expect(isSupportedPlanType("CONDITIONING")).toBe(false);
    expect(isSupportedPlanType(null)).toBe(false);
    expect(() => requireSupportedPlanType("CONDITIONING")).toThrow(
      "UNSUPPORTED_PLAN_TYPE",
    );
  });
});
