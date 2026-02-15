/**
 * Tests for candidate.ts - Volume contribution and candidate building
 */

import { describe, it, expect } from "vitest";
import {
  computeVolumeContribution,
  mergeVolume,
  buildCandidate,
  computeProposedSets,
} from "./candidate";
import { INDIRECT_SET_MULTIPLIER } from "../volume-constants";
import type { Exercise, Muscle } from "../types";
import type { SelectionObjective, VolumeContribution } from "./types";

describe("computeVolumeContribution", () => {
  it("should compute direct volume for primary muscles", () => {
    const exercise: Exercise = {
      id: "bench",
      name: "Bench Press",
      primaryMuscles: ["Chest" as Muscle],
      secondaryMuscles: [],
      equipment: ["barbell"],
      repRangeMin: 5,
      repRangeMax: 8,
      timePerSetSec: 60,
      fatigueCost: 4,
      sfrScore: 5,
      lengthPositionScore: 3,
    };

    const contribution = computeVolumeContribution(exercise, 3);

    expect(contribution.get("Chest" as Muscle)).toEqual({
      direct: 3,
      indirect: 0,
    });
  });

  it("should compute indirect volume for secondary muscles", () => {
    const exercise: Exercise = {
      id: "bench",
      name: "Bench Press",
      primaryMuscles: ["Chest" as Muscle],
      secondaryMuscles: ["Front Delts" as Muscle, "Triceps" as Muscle],
      equipment: ["barbell"],
      repRangeMin: 5,
      repRangeMax: 8,
      timePerSetSec: 60,
      fatigueCost: 4,
      sfrScore: 5,
      lengthPositionScore: 3,
    };

    const contribution = computeVolumeContribution(exercise, 4);

    expect(contribution.get("Chest" as Muscle)).toEqual({
      direct: 4,
      indirect: 0,
    });
    expect(contribution.get("Front Delts" as Muscle)).toEqual({
      direct: 0,
      indirect: 4,
    });
    expect(contribution.get("Triceps" as Muscle)).toEqual({
      direct: 0,
      indirect: 4,
    });
  });

  it("should handle exercises with no secondary muscles", () => {
    const exercise: Exercise = {
      id: "lateral_raise",
      name: "Lateral Raise",
      primaryMuscles: ["Side Delts" as Muscle],
      secondaryMuscles: [],
      equipment: ["dumbbell"],
      repRangeMin: 10,
      repRangeMax: 15,
      timePerSetSec: 30,
      fatigueCost: 2,
      sfrScore: 4,
      lengthPositionScore: 3,
    };

    const contribution = computeVolumeContribution(exercise, 3);

    expect(contribution.size).toBe(1);
    expect(contribution.get("Side Delts" as Muscle)).toEqual({
      direct: 3,
      indirect: 0,
    });
  });

  it("should handle exercises with multiple primary muscles", () => {
    const exercise: Exercise = {
      id: "deadlift",
      name: "Deadlift",
      primaryMuscles: ["Lats" as Muscle, "Glutes" as Muscle, "Hamstrings" as Muscle],
      secondaryMuscles: ["Traps" as Muscle],
      equipment: ["barbell"],
      repRangeMin: 3,
      repRangeMax: 6,
      timePerSetSec: 90,
      fatigueCost: 5,
      sfrScore: 5,
      lengthPositionScore: 4,
    };

    const contribution = computeVolumeContribution(exercise, 3);

    expect(contribution.get("Lats" as Muscle)).toEqual({ direct: 3, indirect: 0 });
    expect(contribution.get("Glutes" as Muscle)).toEqual({ direct: 3, indirect: 0 });
    expect(contribution.get("Hamstrings" as Muscle)).toEqual({ direct: 3, indirect: 0 });
    expect(contribution.get("Traps" as Muscle)).toEqual({ direct: 0, indirect: 3 });
  });
});

describe("mergeVolume", () => {
  it("should merge effective volume from direct and indirect contributions", () => {
    const existing = new Map<Muscle, number>([
      ["Chest" as Muscle, 8], // From previous bench press
    ]);

    const contribution: VolumeContribution = new Map([
      ["Chest" as Muscle, { direct: 0, indirect: 0 }],
      ["Front Delts" as Muscle, { direct: 3, indirect: 0 }], // OHP
      ["Triceps" as Muscle, { direct: 0, indirect: 3 }],
    ]);

    const merged = mergeVolume(existing, contribution);

    // Chest: 8 + 0 = 8
    expect(merged.get("Chest" as Muscle)).toBe(8);

    // Front Delts: 0 + 3 = 3
    expect(merged.get("Front Delts" as Muscle)).toBe(3);

    // Triceps: 0 + (3 × 0.3) = 0.9
    expect(merged.get("Triceps" as Muscle)).toBeCloseTo(3 * INDIRECT_SET_MULTIPLIER, 2);
  });

  it("should accumulate indirect volume correctly", () => {
    // Simulate: Bench (8 sets chest, 2.4 effective front delts) already done
    const existing = new Map<Muscle, number>([
      ["Chest" as Muscle, 8],
      ["Front Delts" as Muscle, 2.4], // 8 × 0.3 from bench secondary
      ["Triceps" as Muscle, 2.4], // 8 × 0.3 from bench secondary
    ]);

    // Add OHP (3 sets front delts, 0.9 effective triceps)
    const contribution: VolumeContribution = new Map([
      ["Front Delts" as Muscle, { direct: 3, indirect: 0 }],
      ["Triceps" as Muscle, { direct: 0, indirect: 3 }],
    ]);

    const merged = mergeVolume(existing, contribution);

    // Front Delts: 2.4 + 3 = 5.4
    expect(merged.get("Front Delts" as Muscle)).toBeCloseTo(5.4, 2);

    // Triceps: 2.4 + 0.9 = 3.3
    expect(merged.get("Triceps" as Muscle)).toBeCloseTo(3.3, 2);
  });

  it("should handle new muscles not in existing map", () => {
    const existing = new Map<Muscle, number>([
      ["Chest" as Muscle, 8],
    ]);

    const contribution: VolumeContribution = new Map([
      ["Side Delts" as Muscle, { direct: 3, indirect: 0 }],
    ]);

    const merged = mergeVolume(existing, contribution);

    expect(merged.get("Chest" as Muscle)).toBe(8);
    expect(merged.get("Side Delts" as Muscle)).toBe(3);
  });

  it("should not mutate the existing volume map", () => {
    const existing = new Map<Muscle, number>([
      ["Chest" as Muscle, 8],
    ]);

    const contribution: VolumeContribution = new Map([
      ["Chest" as Muscle, { direct: 2, indirect: 0 }],
    ]);

    const merged = mergeVolume(existing, contribution);

    // Original should be unchanged
    expect(existing.get("Chest" as Muscle)).toBe(8);

    // Merged should have new value
    expect(merged.get("Chest" as Muscle)).toBe(10);
  });
});

describe("computeProposedSets", () => {
  const mockExercise: Exercise = {
    id: "bench",
    name: "Bench Press",
    primaryMuscles: ["Chest" as Muscle],
    secondaryMuscles: [],
    equipment: ["barbell"],
    repRangeMin: 5,
    repRangeMax: 8,
    timePerSetSec: 60,
    fatigueCost: 4,
    sfrScore: 5,
    lengthPositionScore: 3,
  };

  const mockObjective: SelectionObjective = {
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map(),
      timeBudget: 60,
      equipment: new Set(["barbell"]),
      contraindications: new Set(),
      minExercises: 1,
      maxExercises: 8,
    },
    weights: {
      volumeDeficitFill: 0.4,
      rotationNovelty: 0.25,
      sfrEfficiency: 0.15,
      lengthenedBias: 0.1,
      movementDiversity: 0.05,
      sraReadiness: 0.03,
      userPreference: 0.02,
    },
    volumeContext: {
      weeklyTarget: new Map([["Chest" as Muscle, 12]]),
      weeklyActual: new Map([["Chest" as Muscle, 0]]),
      effectiveActual: new Map([["Chest" as Muscle, 0]]),
    },
    rotationContext: new Map(),
    sraContext: new Map(),
    preferences: {
      favoriteExerciseIds: new Set(),
      avoidExerciseIds: new Set(),
    },
  };

  it("should propose sets based on deficit (12-set deficit → 5 sets)", () => {
    // Deficit = 12, proposedSets = Math.ceil(12/2) = 6, clamped to MAX_SETS = 5
    const sets = computeProposedSets(mockExercise, mockObjective);
    expect(sets).toBe(5);
  });

  it("should propose fewer sets for smaller deficits", () => {
    const smallDeficitObjective: SelectionObjective = {
      ...mockObjective,
      volumeContext: {
        weeklyTarget: new Map([["Chest" as Muscle, 12]]),
        weeklyActual: new Map([["Chest" as Muscle, 8]]),
        effectiveActual: new Map([["Chest" as Muscle, 8]]),
      },
    };

    // Deficit = 4, proposedSets = Math.ceil(4/2) = 2
    const sets = computeProposedSets(mockExercise, smallDeficitObjective);
    expect(sets).toBe(2);
  });

  it("should cap at MIN_SETS (2) for very small deficits", () => {
    const tinyDeficitObjective: SelectionObjective = {
      ...mockObjective,
      volumeContext: {
        weeklyTarget: new Map([["Chest" as Muscle, 12]]),
        weeklyActual: new Map([["Chest" as Muscle, 11]]),
        effectiveActual: new Map([["Chest" as Muscle, 11]]),
      },
    };

    // Deficit = 1, proposedSets = Math.ceil(1/2) = 1, clamped to MIN_SETS = 2
    const sets = computeProposedSets(mockExercise, tinyDeficitObjective);
    expect(sets).toBe(2);
  });

  it("should respect block context if provided", () => {
    const objectiveWithBlock: SelectionObjective = {
      ...mockObjective,
      blockContext: {
        phase: "hypertrophy",
        blockType: "accumulation",
        weekInBlock: 2,
        volumeMultiplier: 1.2,
        intensityMultiplier: 1.0,
        rirAdjustment: 0,
        restMultiplier: 1.0,
      },
    };

    const sets = computeProposedSets(mockExercise, objectiveWithBlock);

    // Base 3 × 1.2 = 3.6 → round to 4
    expect(sets).toBeGreaterThanOrEqual(3);
    expect(sets).toBeLessThanOrEqual(5);
  });
});

describe("buildCandidate", () => {
  const mockExercise: Exercise = {
    id: "bench",
    name: "Bench Press",
    primaryMuscles: ["Chest" as Muscle],
    secondaryMuscles: ["Front Delts" as Muscle, "Triceps" as Muscle],
    equipment: ["barbell"],
    repRangeMin: 5,
    repRangeMax: 8,
    timePerSetSec: 60,
    fatigueCost: 4,
    sfrScore: 5,
    lengthPositionScore: 4,
  };

  const mockObjective: SelectionObjective = {
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map(),
      timeBudget: 60,
      equipment: new Set(["barbell"]),
      contraindications: new Set(),
      minExercises: 1,
      maxExercises: 8,
    },
    weights: {
      volumeDeficitFill: 0.4,
      rotationNovelty: 0.25,
      sfrEfficiency: 0.15,
      lengthenedBias: 0.1,
      movementDiversity: 0.05,
      sraReadiness: 0.03,
      userPreference: 0.02,
    },
    volumeContext: {
      weeklyTarget: new Map([
        ["Chest" as Muscle, 12],
        ["Front Delts" as Muscle, 8],
      ]),
      weeklyActual: new Map([
        ["Chest" as Muscle, 0],
        ["Front Delts" as Muscle, 0],
      ]),
      effectiveActual: new Map([
        ["Chest" as Muscle, 0],
        ["Front Delts" as Muscle, 0],
      ]),
    },
    rotationContext: new Map(),
    sraContext: new Map([
      ["Chest" as Muscle, 1.0], // Fully recovered
      ["Front Delts" as Muscle, 0.8],
    ]),
    preferences: {
      favoriteExerciseIds: new Set(),
      avoidExerciseIds: new Set(),
    },
  };

  it("should build a complete candidate with all scores", () => {
    const candidate = buildCandidate(mockExercise, mockObjective, 4);

    expect(candidate.exercise).toBe(mockExercise);
    expect(candidate.proposedSets).toBe(4);

    // Volume contribution
    expect(candidate.volumeContribution.get("Chest" as Muscle)).toEqual({
      direct: 4,
      indirect: 0,
    });
    expect(candidate.volumeContribution.get("Front Delts" as Muscle)).toEqual({
      direct: 0,
      indirect: 4,
    });

    // Time contribution (4 sets × 60s work + 90s rest = ~10 min)
    expect(candidate.timeContribution).toBeGreaterThan(0);

    // Scores should all be between 0 and 1
    expect(candidate.scores.deficitFill).toBeGreaterThanOrEqual(0);
    expect(candidate.scores.deficitFill).toBeLessThanOrEqual(1);

    expect(candidate.scores.sfrScore).toBeCloseTo(1.0, 2); // 5/5 = 1.0
    expect(candidate.scores.lengthenedScore).toBeCloseTo(0.8, 2); // 4/5 = 0.8

    // Total score should be weighted sum
    expect(candidate.totalScore).toBeGreaterThan(0);
  });

  it("should score deficit fill correctly with partial completion", () => {
    const partialObjective: SelectionObjective = {
      ...mockObjective,
      volumeContext: {
        weeklyTarget: new Map([
          ["Chest" as Muscle, 12],
        ]),
        weeklyActual: new Map([
          ["Chest" as Muscle, 8],
        ]),
        effectiveActual: new Map([
          ["Chest" as Muscle, 8],
        ]),
      },
    };

    const candidate = buildCandidate(mockExercise, partialObjective, 4);

    // Deficit = 12 - 8 = 4 sets
    // Contribution = 4 direct sets
    // Score = 4 / 4 = 1.0 (fills entire deficit)
    expect(candidate.scores.deficitFill).toBeCloseTo(1.0, 2);
  });

  it("should handle favorite exercises", () => {
    const favoriteObjective: SelectionObjective = {
      ...mockObjective,
      preferences: {
        favoriteExerciseIds: new Set(["bench"]),
        avoidExerciseIds: new Set(),
      },
    };

    const candidate = buildCandidate(mockExercise, favoriteObjective, 3);

    expect(candidate.scores.userPreference).toBe(1.0); // Favorite
  });

  it("should penalize avoided exercises", () => {
    const avoidObjective: SelectionObjective = {
      ...mockObjective,
      preferences: {
        favoriteExerciseIds: new Set(),
        avoidExerciseIds: new Set(["bench"]),
      },
    };

    const candidate = buildCandidate(mockExercise, avoidObjective, 3);

    expect(candidate.scores.userPreference).toBe(0.0); // Avoided
  });

  it("should score rotation novelty for never-used exercises", () => {
    const candidate = buildCandidate(mockExercise, mockObjective, 3);

    // Never used = max novelty
    expect(candidate.scores.rotationNovelty).toBe(1.0);
  });

  it("should score rotation novelty for recently-used exercises", () => {
    const recentObjective: SelectionObjective = {
      ...mockObjective,
      rotationContext: new Map([
        [
          // CRITICAL: RotationContext is keyed by exercise NAME, not ID
          "Bench Press", // mockExercise.name (not mockExercise.id which is "bench")
          {
            lastUsed: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
            weeksAgo: 1,
            usageCount: 10,
            trend: "improving" as const,
          },
        ],
      ]),
    };

    const candidate = buildCandidate(mockExercise, recentObjective, 3);

    // 1 week ago with 3-week target cadence = 1/3 = 0.33
    expect(candidate.scores.rotationNovelty).toBeCloseTo(0.33, 2);
  });
});

describe("timeContribution accuracy (Step 1: Improved Estimation)", () => {
  it("should account for warmup sets in time estimation for main lifts", () => {
    const mainLiftExercise: Exercise = {
      id: "squat",
      name: "Squat",
      primaryMuscles: ["Quads" as Muscle],
      secondaryMuscles: ["Glutes" as Muscle],
      equipment: ["barbell"],
      repRangeMin: 3,
      repRangeMax: 6,
      timePerSetSec: 60,
      fatigueCost: 5,
      sfrScore: 5,
      lengthPositionScore: 4,
      isMainLiftEligible: true,
    };

    const objective: SelectionObjective = {
      constraints: {
        volumeFloor: new Map(),
        volumeCeiling: new Map(),
        timeBudget: 60,
        equipment: new Set(["barbell"]),
        contraindications: new Set(),
        minExercises: 1,
        maxExercises: 8,
      },
      weights: {
        volumeDeficitFill: 0.4,
        rotationNovelty: 0.25,
        sfrEfficiency: 0.15,
        lengthenedBias: 0.1,
        movementDiversity: 0.05,
        sraReadiness: 0.03,
        userPreference: 0.02,
      },
      volumeContext: {
        weeklyTarget: new Map([["Quads" as Muscle, 12]]),
        weeklyActual: new Map([["Quads" as Muscle, 0]]),
        effectiveActual: new Map([["Quads" as Muscle, 0]]),
      },
      rotationContext: new Map(),
      sraContext: new Map(),
      preferences: {
        favoriteExerciseIds: new Set(),
        avoidExerciseIds: new Set(),
      },
      goals: {
        primary: "hypertrophy",
      },
    };

    const candidate = buildCandidate(mainLiftExercise, objective, 4);

    // Main lifts should have significantly higher time contribution due to warmup sets
    // 4 working sets + ~3 warmup sets = ~7 sets total
    // Working: 4 × (60s work + 240s rest heavy) = ~20 min
    // Warmup: 3 × (30s work + 45s rest) = ~4 min
    // Total: ~24 min
    expect(candidate.timeContribution).toBeGreaterThan(15); // At least 15 min
    expect(candidate.timeContribution).toBeLessThan(30); // Less than 30 min
  });

  it("should use rep-aware rest periods for accurate time estimation", () => {
    const lowRepExercise: Exercise = {
      id: "bench",
      name: "Bench Press",
      primaryMuscles: ["Chest" as Muscle],
      secondaryMuscles: [],
      equipment: ["barbell"],
      repRangeMin: 3,
      repRangeMax: 6,
      timePerSetSec: 60,
      fatigueCost: 4,
      sfrScore: 5,
      lengthPositionScore: 3,
      isMainLiftEligible: true,
    };

    const highRepExercise: Exercise = {
      id: "lateral_raise",
      name: "Lateral Raise",
      primaryMuscles: ["Side Delts" as Muscle],
      secondaryMuscles: [],
      equipment: ["dumbbell"],
      repRangeMin: 12,
      repRangeMax: 20,
      timePerSetSec: 40,
      fatigueCost: 2,
      sfrScore: 4,
      lengthPositionScore: 3,
      isMainLiftEligible: false,
    };

    const objective: SelectionObjective = {
      constraints: {
        volumeFloor: new Map(),
        volumeCeiling: new Map(),
        timeBudget: 60,
        equipment: new Set(["barbell", "dumbbell"]),
        contraindications: new Set(),
        minExercises: 1,
        maxExercises: 8,
      },
      weights: {
        volumeDeficitFill: 0.4,
        rotationNovelty: 0.25,
        sfrEfficiency: 0.15,
        lengthenedBias: 0.1,
        movementDiversity: 0.05,
        sraReadiness: 0.03,
        userPreference: 0.02,
      },
      volumeContext: {
        weeklyTarget: new Map(),
        weeklyActual: new Map(),
        effectiveActual: new Map(),
      },
      rotationContext: new Map(),
      sraContext: new Map(),
      preferences: {
        favoriteExerciseIds: new Set(),
        avoidExerciseIds: new Set(),
      },
      goals: {
        primary: "hypertrophy",
      },
    };

    const lowRepCandidate = buildCandidate(lowRepExercise, objective, 3);
    const highRepCandidate = buildCandidate(highRepExercise, objective, 3);

    // Low-rep main lifts should take longer (longer rest periods + warmups)
    // High-rep accessories should be faster (shorter rest, no warmups)
    expect(lowRepCandidate.timeContribution).toBeGreaterThan(highRepCandidate.timeContribution);
  });

  it("should match estimateExerciseMinutes accuracy for accessories", () => {
    const accessoryExercise: Exercise = {
      id: "cable_fly",
      name: "Cable Fly",
      primaryMuscles: ["Chest" as Muscle],
      secondaryMuscles: [],
      equipment: ["cable"],
      repRangeMin: 10,
      repRangeMax: 15,
      timePerSetSec: 40,
      fatigueCost: 2,
      sfrScore: 4,
      lengthPositionScore: 5,
      isMainLiftEligible: false,
    };

    const objective: SelectionObjective = {
      constraints: {
        volumeFloor: new Map(),
        volumeCeiling: new Map(),
        timeBudget: 60,
        equipment: new Set(["cable"]),
        contraindications: new Set(),
        minExercises: 1,
        maxExercises: 8,
      },
      weights: {
        volumeDeficitFill: 0.4,
        rotationNovelty: 0.25,
        sfrEfficiency: 0.15,
        lengthenedBias: 0.1,
        movementDiversity: 0.05,
        sraReadiness: 0.03,
        userPreference: 0.02,
      },
      volumeContext: {
        weeklyTarget: new Map([["Chest" as Muscle, 12]]),
        weeklyActual: new Map([["Chest" as Muscle, 0]]),
        effectiveActual: new Map([["Chest" as Muscle, 0]]),
      },
      rotationContext: new Map(),
      sraContext: new Map(),
      preferences: {
        favoriteExerciseIds: new Set(),
        avoidExerciseIds: new Set(),
      },
      goals: {
        primary: "hypertrophy",
      },
    };

    const candidate = buildCandidate(accessoryExercise, objective, 3);

    // Accessories: 3 sets × (40s work + 90s rest) = ~6.5 min
    expect(candidate.timeContribution).toBeGreaterThan(5);
    expect(candidate.timeContribution).toBeLessThan(10);
  });
});
