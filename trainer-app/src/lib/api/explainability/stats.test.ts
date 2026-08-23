import { describe, expect, it } from "vitest";
import { hasPRPotential } from "./stats";

describe("explainability PR-potential load evidence", () => {
  it.each([
    [0, 0],
    [0, 100],
    [100, 0],
  ])("excludes non-positive planned or historical load (%s vs %s)", (planned, historical) => {
    expect(
      hasPRPotential(
        new Map([["exercise", { maxLoad: planned, maxReps: 10 }]]),
        new Map([["exercise", { maxLoad: historical, maxReps: 10 }]])
      )
    ).toBe(false);
  });

  it("preserves positive-load and explicit reps-only PR evidence", () => {
    expect(
      hasPRPotential(
        new Map([["exercise", { maxLoad: 97, maxReps: 8 }]]),
        new Map([["exercise", { maxLoad: 100, maxReps: 8 }]])
      )
    ).toBe(true);
    expect(
      hasPRPotential(
        new Map([["reps-only", { maxLoad: null, maxReps: 11, repsOnlyEvidence: true }]]),
        new Map([["reps-only", { maxLoad: null, maxReps: 10, repsOnlyEvidence: true }]])
      )
    ).toBe(true);
  });
});
