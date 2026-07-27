import { describe, expect, it } from "vitest";
import {
  activatePlanSchema,
  createHypertrophyPlanSchema,
  renamePlanSchema,
} from "./validation";

describe("plan management validation", () => {
  it("normalizes plan names consistently for create and rename", () => {
    const create = createHypertrophyPlanSchema.parse({
      name: "  Summer   Hypertrophy  ",
      startDate: "2026-08-01",
      durationWeeks: 24,
    });
    const rename = renamePlanSchema.parse({
      name: "  Summer   Hypertrophy  ",
      expectedUpdatedAt: "2026-07-27T01:00:00.000Z",
    });

    expect(create.name).toBe("Summer Hypertrophy");
    expect(rename.name).toBe("Summer Hypertrophy");
  });

  it("rejects blank and overlong names", () => {
    expect(
      renamePlanSchema.safeParse({
        name: "   ",
        expectedUpdatedAt: "2026-07-27T01:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      renamePlanSchema.safeParse({
        name: "x".repeat(61),
        expectedUpdatedAt: "2026-07-27T01:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("requires an explicit active-plan compare-and-swap value", () => {
    expect(
      activatePlanSchema.safeParse({
        expectedActiveMacroCycleId: null,
      }).success,
    ).toBe(true);
    expect(activatePlanSchema.safeParse({}).success).toBe(false);
  });
});
