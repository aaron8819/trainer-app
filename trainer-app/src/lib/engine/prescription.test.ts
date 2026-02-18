import { describe, it, expect } from "vitest";
import {
  clampRepRange,
  getRestSeconds,
  prescribeSetsReps,
  resolveSetCount,
  type ExerciseRepRange,
} from "./prescription";
import type { Exercise, FatigueState, Goals } from "./types";

const defaultFatigue: FatigueState = {
  readinessScore: 3,
  missedLastSession: false,
};

const hypertrophyGoals: Goals = { primary: "hypertrophy", secondary: "none" };
const strengthGoals: Goals = { primary: "strength", secondary: "none" };
const fatLossGoals: Goals = { primary: "fat_loss", secondary: "none" };
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
      undefined, exerciseRange
    );
    expect(sets[0].targetReps).toBe(8);
  });

  it("falls back to exercise range when no overlap with goal", () => {
    // Strength main: [3, 6], exercise: [10, 15] → effective [10, 15]
    const exerciseRange: ExerciseRepRange = { min: 10, max: 15 };
    const sets = prescribeSetsReps(
      true, "intermediate", strengthGoals, defaultFatigue,
      undefined, exerciseRange
    );
    expect(sets[0].targetReps).toBe(10);
  });

  it("clamps accessory reps to exercise range when narrower", () => {
    // Hypertrophy accessory: [10, 15], exercise: [12, 20] → effective [12, 15]
    const exerciseRange: ExerciseRepRange = { min: 12, max: 20 };
    const sets = prescribeSetsReps(
      false, "intermediate", hypertrophyGoals, defaultFatigue,
      undefined, exerciseRange
    );
    expect(sets[0].targetReps).toBe(12);
    expect(sets[0].targetRepRange).toEqual({ min: 12, max: 15 });
  });

  it("does not affect reps when exercise range is wider than goal", () => {
    // Hypertrophy main: [6, 10], exercise: [1, 30] → effective [6, 10]
    const exerciseRange: ExerciseRepRange = { min: 1, max: 30 };
    const sets = prescribeSetsReps(
      true, "intermediate", hypertrophyGoals, defaultFatigue,
      undefined, exerciseRange
    );
    expect(sets[0].targetReps).toBe(6);
    expect(sets[0].targetRepRange).toBeUndefined();
  });

  it("keeps accessory targetReps at the lower bound for backward compatibility", () => {
    const sets = prescribeSetsReps(
      false,
      "intermediate",
      hypertrophyGoals,
      defaultFatigue
    );

    expect(sets[0].targetReps).toBe(10);
    expect(sets[0].targetRepRange).toEqual({ min: 10, max: 15 });
  });

  it("widens single-point accessory intersections upward to preserve progression room", () => {
    const exerciseRange: ExerciseRepRange = { min: 10, max: 20 };
    const sets = prescribeSetsReps(
      false,
      "intermediate",
      strengthGoals,
      defaultFatigue,
      undefined,
      exerciseRange
    );

    expect(sets[0].targetReps).toBe(10);
    expect(sets[0].targetRepRange).toEqual({ min: 10, max: 12 });
  });

  it("expands downward only when upward widening cannot fit inside exercise range", () => {
    const exerciseRange: ExerciseRepRange = { min: 5, max: 10 };
    const sets = prescribeSetsReps(
      false,
      "intermediate",
      hypertrophyGoals,
      defaultFatigue,
      undefined,
      exerciseRange
    );

    expect(sets[0].targetReps).toBe(8);
    expect(sets[0].targetRepRange).toEqual({ min: 8, max: 10 });
  });

  it("keeps beginner main-lift back-off reps equal to top-set reps", () => {
    const sets = prescribeSetsReps(
      true,
      "beginner",
      hypertrophyGoals,
      defaultFatigue
    );

    expect(sets.length).toBeGreaterThan(1);
    expect(sets[1].targetReps).toBe(sets[0].targetReps);
  });

  it("applies training-age back-off rep bumps for non-top main sets", () => {
    const intermediateSets = prescribeSetsReps(
      true,
      "intermediate",
      hypertrophyGoals,
      defaultFatigue
    );
    const advancedSets = prescribeSetsReps(
      true,
      "advanced",
      hypertrophyGoals,
      defaultFatigue
    );

    expect(intermediateSets[1].targetReps).toBe(intermediateSets[0].targetReps! + 1);
    expect(advancedSets[1].targetReps).toBe(advancedSets[0].targetReps! + 2);
  });

  it("clamps back-off rep bumps to exercise rep-range max", () => {
    const sets = prescribeSetsReps(
      true,
      "advanced",
      hypertrophyGoals,
      defaultFatigue,
      undefined,
      { min: 9, max: 10 }
    );

    expect(sets[0].targetReps).toBe(9);
    expect(sets[1].targetReps).toBe(10);
  });
});

describe("prescribeSetsReps target RPE", () => {
  it("uses training-age-specific base RPE for hypertrophy main lifts", () => {
    const beginner = prescribeSetsReps(
      true,
      "beginner",
      hypertrophyGoals,
      defaultFatigue
    );
    const advanced = prescribeSetsReps(
      true,
      "advanced",
      hypertrophyGoals,
      defaultFatigue
    );

    expect(beginner[0].targetRpe).toBe(7);
    expect(advanced[0].targetRpe).toBe(8.5);
  });

  it("applies +0.5 RPE bump to hypertrophy isolation accessories", () => {
    const sets = prescribeSetsReps(
      false,
      "intermediate",
      hypertrophyGoals,
      defaultFatigue,
      undefined,
      undefined,
      true
    );

    expect(sets[0].targetRpe).toBe(8.5);
  });

  it("keeps compound accessories at the base hypertrophy RPE", () => {
    const sets = prescribeSetsReps(
      false,
      "intermediate",
      hypertrophyGoals,
      defaultFatigue
    );

    expect(sets[0].targetRpe).toBe(8);
  });
});

describe("getRestSeconds", () => {
  const isolationExercise: Exercise = {
    id: "lateral-raise",
    name: "Lateral Raise",
    movementPatterns: ["isolation"],
    splitTags: ["push"],
    jointStress: "low",
    isMainLiftEligible: false,
    isCompound: false,
    fatigueCost: 2,
    equipment: ["dumbbell"],
  };

  const compoundAccessory: Exercise = {
    id: "dip",
    name: "Dip",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    isMainLiftEligible: false,
    isCompound: true,
    fatigueCost: 3,
    equipment: ["bodyweight"],
  };

  it("uses 90 seconds as the isolation rest floor", () => {
    expect(getRestSeconds(isolationExercise, false, 15)).toBe(90);
  });

  it("keeps higher-fatigue isolations at 90 seconds", () => {
    expect(
      getRestSeconds({ ...isolationExercise, fatigueCost: 3 }, false, 15)
    ).toBe(90);
  });

  it("uses 150 seconds for compound accessories regardless of rep count", () => {
    // KB: compound accessories require 2–3 min at all rep ranges (W5 audit fix)
    expect(getRestSeconds(compoundAccessory, false, 6)).toBe(150);
    expect(getRestSeconds(compoundAccessory, false, 8)).toBe(150);
    expect(getRestSeconds(compoundAccessory, false, 10)).toBe(150);
    expect(getRestSeconds(compoundAccessory, false, 12)).toBe(150);
  });
});

describe("resolveSetCount", () => {
  it("applies readiness and missed-session penalties as a single non-stacking reduction", () => {
    const stackedPenaltyState: FatigueState = {
      readinessScore: 2,
      missedLastSession: true,
    };

    const sets = resolveSetCount(true, "advanced", stackedPenaltyState);
    expect(sets).toBe(4);
  });

  it("fat-loss-set-reduction", () => {
    withRevisedFatLossPolicy("true", () => {
      const hypertrophySets = prescribeSetsReps(
        true,
        "intermediate",
        hypertrophyGoals,
        defaultFatigue
      );
      const fatLossSets = prescribeSetsReps(
        true,
        "intermediate",
        fatLossGoals,
        defaultFatigue
      );

      expect(hypertrophySets).toHaveLength(4);
      expect(fatLossSets).toHaveLength(3);
    });
  });

  it("applies fat-loss goal multiplier before periodization multiplier", () => {
    withRevisedFatLossPolicy("true", () => {
      const sets = prescribeSetsReps(
        true,
        "intermediate",
        fatLossGoals,
        defaultFatigue,
        {
          rpeOffset: 0,
          setMultiplier: 1.3,
          backOffMultiplier: 0.85,
          isDeload: false,
        }
      );

      expect(sets).toHaveLength(4);
    });
  });
});
