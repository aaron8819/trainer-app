import { describe, expect, it } from "vitest";
import { BASELINE_RPE_TOLERANCE, isSetQualifiedForBaseline } from "./baseline-qualification";

describe("isSetQualifiedForBaseline", () => {
  it("passes when rep target is met and no RPE data is present", () => {
    expect(isSetQualifiedForBaseline({ targetReps: 8, actualReps: 8 })).toBe(true);
  });

  it("rejects when rep target is not met", () => {
    expect(isSetQualifiedForBaseline({ targetReps: 8, actualReps: 7 })).toBe(false);
  });

  it("passes when actual RPE is within tolerance above target", () => {
    expect(
      isSetQualifiedForBaseline({
        targetReps: 8,
        actualReps: 8,
        targetRpe: 8,
        actualRpe: 8 + BASELINE_RPE_TOLERANCE,
      })
    ).toBe(true);
  });

  it("rejects when actual RPE exceeds tolerance above target", () => {
    expect(
      isSetQualifiedForBaseline({
        targetReps: 8,
        actualReps: 8,
        targetRpe: 8,
        actualRpe: 8 + BASELINE_RPE_TOLERANCE + 0.5,
      })
    ).toBe(false);
  });
});
