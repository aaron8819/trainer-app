import { describe, it, expect } from "vitest";
import { clampRepRange, prescribeSetsReps, type ExerciseRepRange } from "./prescription";
import type { FatigueState, Goals } from "./types";

const defaultFatigue: FatigueState = {
  readinessScore: 3,
  missedLastSession: false,
};

const hypertrophyGoals: Goals = { primary: "hypertrophy", secondary: "none" };
const strengthGoals: Goals = { primary: "strength", secondary: "none" };

describe("clampRepRange", () => {
  it("returns goal range when no exercise range provided", () => {
    expect(clampRepRange([6, 10], undefined)).toEqual([6, 10]);
  });

  it("returns goal range when exercise range is wider", () => {
    expect(clampRepRange([6, 10], { min: 1, max: 30 })).toEqual([6, 10]);
  });

  it("clamps to exercise range when narrower", () => {
    expect(clampRepRange([6, 10], { min: 8, max: 12 })).toEqual([8, 10]);
  });

  it("uses intersection when partially overlapping", () => {
    expect(clampRepRange([6, 10], { min: 8, max: 15 })).toEqual([8, 10]);
    expect(clampRepRange([6, 10], { min: 3, max: 8 })).toEqual([6, 8]);
  });

  it("falls back to exercise range when no overlap", () => {
    // Goal wants 3-6 but exercise is 10-15
    expect(clampRepRange([3, 6], { min: 10, max: 15 })).toEqual([10, 15]);
  });
});

describe("prescribeSetsReps with exerciseRepRange", () => {
  it("uses goal-based reps when no exercise range is provided", () => {
    // Hypertrophy main: [6, 10]
    const sets = prescribeSetsReps(
      true, "intermediate", hypertrophyGoals, defaultFatigue,
      undefined, undefined, undefined
    );
    expect(sets[0].targetReps).toBe(6);
  });

  it("clamps main lift reps to exercise range when narrower", () => {
    // Hypertrophy main: [6, 10], exercise: [8, 12] → effective [8, 10]
    const exerciseRange: ExerciseRepRange = { min: 8, max: 12 };
    const sets = prescribeSetsReps(
      true, "intermediate", hypertrophyGoals, defaultFatigue,
      undefined, undefined, exerciseRange
    );
    expect(sets[0].targetReps).toBe(8);
  });

  it("falls back to exercise range when no overlap with goal", () => {
    // Strength main: [3, 6], exercise: [10, 15] → effective [10, 15]
    const exerciseRange: ExerciseRepRange = { min: 10, max: 15 };
    const sets = prescribeSetsReps(
      true, "intermediate", strengthGoals, defaultFatigue,
      undefined, undefined, exerciseRange
    );
    expect(sets[0].targetReps).toBe(10);
  });

  it("clamps accessory reps to exercise range when narrower", () => {
    // Hypertrophy accessory: [10, 15], exercise: [12, 20] → effective [12, 15]
    const exerciseRange: ExerciseRepRange = { min: 12, max: 20 };
    const sets = prescribeSetsReps(
      false, "intermediate", hypertrophyGoals, defaultFatigue,
      undefined, undefined, exerciseRange
    );
    expect(sets[0].targetReps).toBe(12);
  });

  it("does not affect reps when exercise range is wider than goal", () => {
    // Hypertrophy main: [6, 10], exercise: [1, 30] → effective [6, 10]
    const exerciseRange: ExerciseRepRange = { min: 1, max: 30 };
    const sets = prescribeSetsReps(
      true, "intermediate", hypertrophyGoals, defaultFatigue,
      undefined, undefined, exerciseRange
    );
    expect(sets[0].targetReps).toBe(6);
  });
});
