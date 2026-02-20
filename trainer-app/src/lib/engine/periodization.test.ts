import { describe, expect, it } from "vitest";
import { getPeriodizationModifiers } from "./rules";

describe("getPeriodizationModifiers", () => {
  it("returns correct modifiers for hypertrophy weeks", () => {
    // Week 1: early in mesocycle, low RPE, base volume
    expect(getPeriodizationModifiers(1, "hypertrophy")).toEqual({
      rpeOffset: -1.5,
      setMultiplier: 1,
      backOffMultiplier: 0.88,
      isDeload: false,
      weekInBlock: 1,
    });

    // Week 2: middle of mesocycle, moderate RPE, ramping volume
    expect(getPeriodizationModifiers(2, "hypertrophy")).toEqual({
      rpeOffset: -0.5,
      setMultiplier: 1.15,
      backOffMultiplier: 0.88,
      isDeload: false,
      weekInBlock: 2,
    });

    // Week 3: late in mesocycle, high RPE, peak volume
    expect(getPeriodizationModifiers(3, "hypertrophy")).toEqual({
      rpeOffset: 1.0,
      setMultiplier: 1.3,
      backOffMultiplier: 0.88,
      isDeload: false,
      weekInBlock: 3,
    });

    // Week 4: deload
    expect(getPeriodizationModifiers(4, "hypertrophy")).toEqual({
      rpeOffset: -2.0,
      setMultiplier: 0.5,
      backOffMultiplier: 0.75,
      isDeload: true,
      weekInBlock: 4,
    });
  });

  it("returns correct modifiers for strength weeks", () => {
    expect(getPeriodizationModifiers(1, "strength")).toEqual({
      rpeOffset: -1.5,
      setMultiplier: 1,
      backOffMultiplier: 0.9,
      isDeload: false,
      weekInBlock: 1,
    });

    expect(getPeriodizationModifiers(3, "strength")).toEqual({
      rpeOffset: 1.0,
      setMultiplier: 1.3,
      backOffMultiplier: 0.9,
      isDeload: false,
      weekInBlock: 3,
    });

    expect(getPeriodizationModifiers(4, "strength")).toEqual({
      rpeOffset: -2.0,
      setMultiplier: 0.5,
      backOffMultiplier: 0.75,
      isDeload: true,
      weekInBlock: 4,
    });
  });

  it("caps week indices beyond the 4-week block at deload", () => {
    expect(getPeriodizationModifiers(5, "hypertrophy").rpeOffset).toBe(-2.0);
    expect(getPeriodizationModifiers(8, "hypertrophy").isDeload).toBe(true);
  });

  it("uses training-age-scaled offsets when trainingAge is provided", () => {
    expect(getPeriodizationModifiers(1, "hypertrophy", "beginner").rpeOffset).toBe(-0.5);
    expect(getPeriodizationModifiers(2, "hypertrophy", "intermediate").rpeOffset).toBe(-0.5);
    expect(getPeriodizationModifiers(3, "hypertrophy", "advanced").rpeOffset).toBe(1.0);
  });
});
