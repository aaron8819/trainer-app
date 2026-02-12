import { describe, expect, it } from "vitest";
import { getPeriodizationModifiers } from "./rules";

describe("getPeriodizationModifiers", () => {
  it("returns correct modifiers for hypertrophy weeks", () => {
    // Week 0: early in mesocycle, low RPE, base volume
    expect(getPeriodizationModifiers(0, "hypertrophy")).toEqual({
      rpeOffset: -1.5,
      setMultiplier: 1,
      backOffMultiplier: 0.88,
      isDeload: false,
    });

    // Week 1: middle of mesocycle, moderate RPE, ramping volume
    expect(getPeriodizationModifiers(1, "hypertrophy")).toEqual({
      rpeOffset: -0.5,
      setMultiplier: 1.15,
      backOffMultiplier: 0.88,
      isDeload: false,
    });

    // Week 2: late in mesocycle, high RPE, peak volume
    expect(getPeriodizationModifiers(2, "hypertrophy")).toEqual({
      rpeOffset: 1.0,
      setMultiplier: 1.3,
      backOffMultiplier: 0.88,
      isDeload: false,
    });

    // Week 3: deload
    expect(getPeriodizationModifiers(3, "hypertrophy")).toEqual({
      rpeOffset: -2.0,
      setMultiplier: 0.5,
      backOffMultiplier: 0.75,
      isDeload: true,
    });
  });

  it("returns correct modifiers for strength weeks", () => {
    expect(getPeriodizationModifiers(0, "strength")).toEqual({
      rpeOffset: -1.5,
      setMultiplier: 1,
      backOffMultiplier: 0.9,
      isDeload: false,
    });

    expect(getPeriodizationModifiers(2, "strength")).toEqual({
      rpeOffset: 1.0,
      setMultiplier: 1.3,
      backOffMultiplier: 0.9,
      isDeload: false,
    });

    expect(getPeriodizationModifiers(3, "strength")).toEqual({
      rpeOffset: -2.0,
      setMultiplier: 0.5,
      backOffMultiplier: 0.75,
      isDeload: true,
    });
  });

  it("wraps week indices within the 4-week block", () => {
    expect(getPeriodizationModifiers(4, "hypertrophy").rpeOffset).toBe(-1.5);
    expect(getPeriodizationModifiers(7, "hypertrophy").isDeload).toBe(true);
  });

  it("uses training-age-scaled offsets when trainingAge is provided", () => {
    expect(getPeriodizationModifiers(0, "hypertrophy", "beginner").rpeOffset).toBe(-0.5);
    expect(getPeriodizationModifiers(1, "hypertrophy", "intermediate").rpeOffset).toBe(-0.5);
    expect(getPeriodizationModifiers(2, "hypertrophy", "advanced").rpeOffset).toBe(1.0);
  });
});
