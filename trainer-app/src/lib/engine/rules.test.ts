import { describe, expect, it } from "vitest";
import {
  getBaseTargetRpe,
  getMesocyclePeriodization,
  getPeriodizationModifiers,
  type MesocycleConfig,
} from "./rules";

describe("getMesocyclePeriodization", () => {
  it("returns deload modifiers when isDeload is true", () => {
    const config: MesocycleConfig = { totalWeeks: 4, currentWeek: 0, isDeload: true };
    const result = getMesocyclePeriodization(config, "hypertrophy");
    expect(result.isDeload).toBe(true);
    expect(result.setMultiplier).toBe(0.5);
    expect(result.rpeOffset).toBe(-2.0);
  });

  it("ramps RPE offset from negative to positive across mesocycle", () => {
    const results = [0, 1, 2, 3, 4, 5].map((week) =>
      getMesocyclePeriodization({ totalWeeks: 6, currentWeek: week, isDeload: false }, "hypertrophy")
    );
    // Early weeks should have negative RPE offset (lower intensity)
    expect(results[0].rpeOffset).toBeLessThan(0);
    // Late weeks should have positive RPE offset (higher intensity)
    expect(results[5].rpeOffset).toBeGreaterThan(0);
    // RPE offset should generally increase
    expect(results[5].rpeOffset).toBeGreaterThan(results[0].rpeOffset);
  });

  it("ramps set multiplier from 1.0 to 1.3", () => {
    const early = getMesocyclePeriodization({ totalWeeks: 5, currentWeek: 0, isDeload: false }, "hypertrophy");
    const late = getMesocyclePeriodization({ totalWeeks: 5, currentWeek: 4, isDeload: false }, "hypertrophy");
    expect(early.setMultiplier).toBeCloseTo(1.0, 1);
    expect(late.setMultiplier).toBeCloseTo(1.3, 1);
  });

  it("works with 3-week mesocycle", () => {
    const week0 = getMesocyclePeriodization({ totalWeeks: 3, currentWeek: 0, isDeload: false }, "strength");
    const week2 = getMesocyclePeriodization({ totalWeeks: 3, currentWeek: 2, isDeload: false }, "strength");
    expect(week0.rpeOffset).toBeLessThan(week2.rpeOffset);
    expect(week0.setMultiplier).toBeLessThan(week2.setMultiplier);
  });

  it("uses goal-specific backoff multiplier", () => {
    const hyp = getMesocyclePeriodization({ totalWeeks: 4, currentWeek: 1, isDeload: false }, "hypertrophy");
    const str = getMesocyclePeriodization({ totalWeeks: 4, currentWeek: 1, isDeload: false }, "strength");
    expect(hyp.backOffMultiplier).toBe(0.88);
    expect(str.backOffMultiplier).toBe(0.9);
  });
});

describe("getPeriodizationModifiers (backward compat)", () => {
  it("returns deload on week 3 of a 4-week block", () => {
    const result = getPeriodizationModifiers(3, "hypertrophy");
    expect(result.isDeload).toBe(true);
    expect(result.setMultiplier).toBe(0.5);
  });

  it("returns non-deload on week 0", () => {
    const result = getPeriodizationModifiers(0, "hypertrophy");
    expect(result.isDeload).toBe(false);
    expect(result.rpeOffset).toBeLessThan(0);
  });

  it("wraps around for week indices > 3", () => {
    const week4 = getPeriodizationModifiers(4, "hypertrophy");
    const week0 = getPeriodizationModifiers(0, "hypertrophy");
    expect(week4.rpeOffset).toBe(week0.rpeOffset);
  });
});

describe("getBaseTargetRpe", () => {
  it("uses training-age-specific values for hypertrophy", () => {
    expect(getBaseTargetRpe("hypertrophy", "beginner")).toBe(7);
    expect(getBaseTargetRpe("hypertrophy", "intermediate")).toBe(8);
    expect(getBaseTargetRpe("hypertrophy", "advanced")).toBe(8.5);
  });

  it("keeps non-hypertrophy goals unchanged", () => {
    expect(getBaseTargetRpe("strength", "beginner")).toBe(8);
    expect(getBaseTargetRpe("fat_loss", "advanced")).toBe(7);
  });
});
