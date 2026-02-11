import { describe, expect, it } from "vitest";
import {
  buildProjectedWarmupSets,
  buildWarmupSetsFromTopSet,
  canResolveLoadForWarmupRamp,
} from "./warmup-ramp";
import type { Exercise } from "./types";

const roundToHalf = (value: number) => Math.round(value * 2) / 2;

describe("warmup-ramp", () => {
  it("builds beginner projected warmup sets with two ramp steps", () => {
    const sets = buildProjectedWarmupSets("beginner");

    expect(sets).toEqual([
      { setIndex: 1, role: "warmup", targetReps: 8, restSeconds: 60 },
      { setIndex: 2, role: "warmup", targetReps: 3, restSeconds: 90 },
    ]);
  });

  it("builds intermediate projected warmup sets with three ramp steps", () => {
    const sets = buildProjectedWarmupSets("intermediate");

    expect(sets).toEqual([
      { setIndex: 1, role: "warmup", targetReps: 8, restSeconds: 60 },
      { setIndex: 2, role: "warmup", targetReps: 5, restSeconds: 60 },
      { setIndex: 3, role: "warmup", targetReps: 3, restSeconds: 90 },
    ]);
  });

  it("converts top-set load into ramp loads using scheme percentages", () => {
    const sets = buildWarmupSetsFromTopSet(205, "intermediate", roundToHalf);

    expect(sets).toEqual([
      { setIndex: 1, role: "warmup", targetReps: 8, targetLoad: 102.5, restSeconds: 60 },
      { setIndex: 2, role: "warmup", targetReps: 5, targetLoad: 143.5, restSeconds: 60 },
      { setIndex: 3, role: "warmup", targetReps: 3, targetLoad: 174.5, restSeconds: 90 },
    ]);
  });

  it("treats bodyweight-only equipment as non-load-resolvable for warmup ramps", () => {
    const pullup: Exercise = {
      id: "pullup",
      name: "Pull-Up",
      movementPatterns: ["vertical_pull"],
      splitTags: ["pull"],
      jointStress: "medium",
      isMainLiftEligible: true,
      equipment: ["bodyweight"],
    };

    const bench: Exercise = {
      id: "bench",
      name: "Bench Press",
      movementPatterns: ["horizontal_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: true,
      equipment: ["barbell", "bench", "rack"],
    };

    expect(canResolveLoadForWarmupRamp(pullup)).toBe(false);
    expect(canResolveLoadForWarmupRamp(bench)).toBe(true);
  });
});
