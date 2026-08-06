import { describe, expect, it } from "vitest";
import {
  TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT_VARIABLE,
  isCustomHypertrophyPlanRolloutEnabled,
} from "./custom-hypertrophy-plan-rollout";

describe("custom hypertrophy plan rollout", () => {
  it("is default-off and requires the exact enabled value", () => {
    expect(isCustomHypertrophyPlanRolloutEnabled({})).toBe(false);
    expect(
      isCustomHypertrophyPlanRolloutEnabled({
        [TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT_VARIABLE]: "true",
      }),
    ).toBe(false);
    expect(
      isCustomHypertrophyPlanRolloutEnabled({
        [TRAINER_CUSTOM_HYPERTROPHY_PLANS_ROLLOUT_VARIABLE]: "enabled",
      }),
    ).toBe(true);
  });
});
