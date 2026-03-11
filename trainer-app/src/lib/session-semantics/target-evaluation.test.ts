import { describe, expect, it } from "vitest";
import { evaluateTargetReps } from "./target-evaluation";

describe("evaluateTargetReps", () => {
  it("treats reps inside a target range as in range", () => {
    expect(
      evaluateTargetReps({
        actualReps: 10,
        targetReps: 12,
        targetRepRange: { min: 8, max: 12 },
      })
    ).toMatchObject({
      kind: "in_range",
      targetRange: { min: 8, max: 12 },
      usesRangeTarget: true,
      deviation: 0,
    });
  });

  it("treats reps below a target range as below", () => {
    expect(
      evaluateTargetReps({
        actualReps: 7,
        targetReps: 10,
        targetRepRange: { min: 8, max: 12 },
      })
    ).toMatchObject({
      kind: "below",
      targetRange: { min: 8, max: 12 },
      usesRangeTarget: true,
      deviation: -1,
    });
  });

  it("treats reps above a target range as above", () => {
    expect(
      evaluateTargetReps({
        actualReps: 13,
        targetReps: 10,
        targetRepRange: { min: 8, max: 12 },
      })
    ).toMatchObject({
      kind: "above",
      targetRange: { min: 8, max: 12 },
      usesRangeTarget: true,
      deviation: 1,
    });
  });

  it("falls back to the point target when no range exists", () => {
    expect(
      evaluateTargetReps({
        actualReps: 9,
        targetReps: 10,
      })
    ).toMatchObject({
      kind: "below",
      targetRange: { min: 10, max: 10 },
      usesRangeTarget: false,
      deviation: -1,
    });
  });
});
