import { describe, expect, it } from "vitest";
import {
  getGoalRepRanges,
  getGoalSetMultiplier,
  getBaseTargetRpe,
  getMesocyclePeriodization,
  getPeriodizationModifiers,
  type MesocycleConfig,
} from "./rules";

const USE_REVISED_FAT_LOSS_POLICY_ENV = "USE_REVISED_FAT_LOSS_POLICY";

function withRevisedFatLossPolicy(value: string | undefined, run: () => void) {
  const previous = process.env[USE_REVISED_FAT_LOSS_POLICY_ENV];
  if (value === undefined) {
    delete process.env[USE_REVISED_FAT_LOSS_POLICY_ENV];
  } else {
    process.env[USE_REVISED_FAT_LOSS_POLICY_ENV] = value;
  }
  try {
    run();
  } finally {
    if (previous === undefined) {
      delete process.env[USE_REVISED_FAT_LOSS_POLICY_ENV];
    } else {
      process.env[USE_REVISED_FAT_LOSS_POLICY_ENV] = previous;
    }
  }
}

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

  it("uses age-scaled offsets for beginners", () => {
    const week0 = getMesocyclePeriodization(
      { totalWeeks: 3, currentWeek: 0, isDeload: false },
      "hypertrophy",
      "beginner"
    );
    const week1 = getMesocyclePeriodization(
      { totalWeeks: 3, currentWeek: 1, isDeload: false },
      "hypertrophy",
      "beginner"
    );
    const week2 = getMesocyclePeriodization(
      { totalWeeks: 3, currentWeek: 2, isDeload: false },
      "hypertrophy",
      "beginner"
    );

    expect(week0.rpeOffset).toBe(-0.5);
    expect(week1.rpeOffset).toBe(0.0);
    expect(week2.rpeOffset).toBe(0.5);
  });

  it("uses age-scaled offsets for intermediate and advanced lifters", () => {
    const intermediateWeek0 = getMesocyclePeriodization(
      { totalWeeks: 3, currentWeek: 0, isDeload: false },
      "hypertrophy",
      "intermediate"
    );
    const intermediateWeek1 = getMesocyclePeriodization(
      { totalWeeks: 3, currentWeek: 1, isDeload: false },
      "hypertrophy",
      "intermediate"
    );
    const intermediateWeek2 = getMesocyclePeriodization(
      { totalWeeks: 3, currentWeek: 2, isDeload: false },
      "hypertrophy",
      "intermediate"
    );

    const advancedWeek0 = getMesocyclePeriodization(
      { totalWeeks: 3, currentWeek: 0, isDeload: false },
      "hypertrophy",
      "advanced"
    );
    const advancedWeek1 = getMesocyclePeriodization(
      { totalWeeks: 3, currentWeek: 1, isDeload: false },
      "hypertrophy",
      "advanced"
    );
    const advancedWeek2 = getMesocyclePeriodization(
      { totalWeeks: 3, currentWeek: 2, isDeload: false },
      "hypertrophy",
      "advanced"
    );

    expect(intermediateWeek0.rpeOffset).toBe(-1.0);
    expect(intermediateWeek1.rpeOffset).toBe(-0.5);
    expect(intermediateWeek2.rpeOffset).toBe(0.5);

    expect(advancedWeek0.rpeOffset).toBe(-1.5);
    expect(advancedWeek1.rpeOffset).toBe(-0.5);
    expect(advancedWeek2.rpeOffset).toBe(1.0);
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

describe("revised fat-loss policy flag", () => {
  it("fat-loss-policy-flag-on", () => {
    withRevisedFatLossPolicy("true", () => {
      expect(getGoalRepRanges("fat_loss").main).toEqual([6, 10]);
      expect(getBaseTargetRpe("fat_loss", "intermediate")).toBe(7.5);
      expect(getGoalSetMultiplier("fat_loss")).toBe(0.75);
    });
  });

  it("fat-loss-policy-flag-off", () => {
    withRevisedFatLossPolicy("false", () => {
      expect(getGoalRepRanges("fat_loss").main).toEqual([8, 12]);
      expect(getBaseTargetRpe("fat_loss", "intermediate")).toBe(7.0);
      expect(getGoalSetMultiplier("fat_loss")).toBe(1);
    });
  });
});
