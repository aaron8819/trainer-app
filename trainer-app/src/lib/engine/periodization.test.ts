import { describe, expect, it } from "vitest";
import { getPeriodizationModifiers } from "./rules";

describe("getPeriodizationModifiers", () => {
  it("returns correct modifiers for hypertrophy weeks", () => {
    expect(getPeriodizationModifiers(0, "hypertrophy")).toEqual({
      rpeOffset: -1,
      setMultiplier: 1,
      backOffMultiplier: 0.85,
      isDeload: false,
    });

    expect(getPeriodizationModifiers(1, "hypertrophy")).toEqual({
      rpeOffset: 0,
      setMultiplier: 1,
      backOffMultiplier: 0.85,
      isDeload: false,
    });

    expect(getPeriodizationModifiers(2, "hypertrophy")).toEqual({
      rpeOffset: 0.5,
      setMultiplier: 0.85,
      backOffMultiplier: 0.85,
      isDeload: false,
    });

    expect(getPeriodizationModifiers(3, "hypertrophy")).toEqual({
      rpeOffset: 0,
      setMultiplier: 0.6,
      backOffMultiplier: 0.75,
      isDeload: true,
    });
  });

  it("returns correct modifiers for strength weeks", () => {
    expect(getPeriodizationModifiers(0, "strength")).toEqual({
      rpeOffset: -1,
      setMultiplier: 1,
      backOffMultiplier: 0.9,
      isDeload: false,
    });

    expect(getPeriodizationModifiers(2, "strength")).toEqual({
      rpeOffset: 0.5,
      setMultiplier: 0.85,
      backOffMultiplier: 0.9,
      isDeload: false,
    });

    expect(getPeriodizationModifiers(3, "strength")).toEqual({
      rpeOffset: 0,
      setMultiplier: 0.6,
      backOffMultiplier: 0.75,
      isDeload: true,
    });
  });

  it("wraps week indices within the 4-week block", () => {
    expect(getPeriodizationModifiers(4, "hypertrophy").rpeOffset).toBe(-1);
    expect(getPeriodizationModifiers(7, "hypertrophy").isDeload).toBe(true);
  });
});
