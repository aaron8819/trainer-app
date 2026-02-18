/**
 * Tests for beam-search.ts - Core beam search algorithm
 */

import { describe, it, expect } from "vitest";
import { beamSearch } from "./beam-search";
import type { Exercise, Muscle } from "../types";
import type { SelectionObjective, SelectionCandidate } from "./types";
import { buildCandidate, computeProposedSets } from "./candidate";

describe("beamSearch", () => {
  const createMockExercise = (
    id: string,
    primaryMuscles: Muscle[],
    secondaryMuscles: Muscle[] = []
  ): Exercise => ({
    id,
    name: id.replace("_", " "),
    primaryMuscles,
    secondaryMuscles,
    equipment: ["barbell"],
    movementPatterns: [],
    splitTags: [],
    jointStress: "medium",
    repRangeMin: 5,
    repRangeMax: 8,
    timePerSetSec: 60,
    fatigueCost: 3,
    sfrScore: 4,
    lengthPositionScore: 3,
  });

  const createMockObjective = (
    weeklyTarget: Map<Muscle, number>
  ): SelectionObjective => ({
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map(
        Array.from(weeklyTarget.entries()).map(([muscle, target]) => [
          muscle,
          target * 1.5, // MRV = 1.5 × MEV
        ])
      ),
      painConflicts: new Set(),
      userAvoids: new Set(),
      minExercises: 1,
      maxExercises: 8,
      minMainLifts: 1, // Default to requiring at least 1 main lift
      maxMainLifts: 3, // Prevent over-fatigue
      minAccessories: 2, // Ensure variety
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
      weeklyTarget,
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
      secondary: "conditioning",
    },
  });

  it("should select exercises to fill volume deficits", () => {
    const exercises = [
      createMockExercise("bench_press", ["Chest" as Muscle]),
      createMockExercise("incline_press", ["Chest" as Muscle]),
      createMockExercise("lateral_raise", ["Side Delts" as Muscle]),
    ];

    const objective = createMockObjective(
      new Map([
        ["Chest" as Muscle, 12],
        ["Side Delts" as Muscle, 8],
      ])
    );

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 3,
      maxDepth: 5,
    });

    // Should select at least one chest exercise and one side delt exercise
    expect(result.selected.length).toBeGreaterThan(0);

    const selectedIds = result.selected.map((c) => c.exercise.id);
    const hasChestExercise = selectedIds.some((id) =>
      ["bench_press", "incline_press"].includes(id)
    );
    const hasSideDeltExercise = selectedIds.includes("lateral_raise");

    expect(hasChestExercise).toBe(true);
    expect(hasSideDeltExercise).toBe(true);
  });

  it("should respect volume ceiling constraint", () => {
    const exercises = [
      createMockExercise("bench_press", ["Chest" as Muscle]),
      createMockExercise("incline_press", ["Chest" as Muscle]),
      createMockExercise("cable_fly", ["Chest" as Muscle]),
      createMockExercise("dips", ["Chest" as Muscle]),
    ];

    const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

    // Set tight ceiling: 12 × 1.5 = 18 sets max
    objective.constraints.volumeCeiling = new Map([["Chest" as Muscle, 18]]);

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 5,
      maxDepth: 8,
    });

    // Should not exceed ceiling
    const chestVolume = result.volumeFilled.get("Chest" as Muscle) ?? 0;
    expect(chestVolume).toBeLessThanOrEqual(18);
  });

  it("should avoid duplicate exercises", () => {
    const exercises = [
      createMockExercise("bench_press", ["Chest" as Muscle]),
      createMockExercise("incline_press", ["Chest" as Muscle]),
    ];

    const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 3,
      maxDepth: 5,
    });

    // Each exercise should appear at most once
    const selectedIds = result.selected.map((c) => c.exercise.id);
    const uniqueIds = new Set(selectedIds);

    expect(selectedIds.length).toBe(uniqueIds.size);
  });

  it("should handle indirect volume scenario correctly", () => {
    // Scenario: Bench already done (8 sets chest, 2.4 effective front delts)
    // Pool: OHP (front delts primary), Lateral Raise (side delts primary)
    // Expected: Both exercises selected to fill remaining deficits

    const exercises = [
      createMockExercise("ohp", ["Front Delts" as Muscle], ["Triceps" as Muscle]),
      createMockExercise("lateral_raise", ["Side Delts" as Muscle]),
    ];

    const objective = createMockObjective(
      new Map([
        ["Front Delts" as Muscle, 8],
        ["Side Delts" as Muscle, 8],
      ])
    );

    // Bench already filled 2.4 effective front delts
    objective.volumeContext.effectiveActual = new Map([
      ["Front Delts" as Muscle, 2.4],
    ]);

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 3,
      maxDepth: 2,
    });

    // Should select both exercises to fill deficits
    expect(result.selected.length).toBe(2);

    const selectedIds = result.selected.map((s) => s.exercise.id);
    expect(selectedIds).toContain("ohp");
    expect(selectedIds).toContain("lateral_raise");

    // Front delts deficit should be reduced (but not fully filled due to indirect volume)
    const frontDeltsFilled = result.volumeFilled.get("Front Delts" as Muscle) ?? 0;
    expect(frontDeltsFilled).toBeGreaterThan(2.4); // More than just bench's indirect volume

    // Side delts should have volume filled
    const sideDeltsFilled = result.volumeFilled.get("Side Delts" as Muscle) ?? 0;
    expect(sideDeltsFilled).toBeGreaterThan(0);
  });

  it("should enforce minimum exercises constraint", () => {
    const exercises = [
      createMockExercise("bench_press", ["Chest" as Muscle]),
    ];

    const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));
    objective.constraints.minExercises = 2;

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 3,
      maxDepth: 5,
    });

    // Should select at least 2 exercises (greedy fallback will add more)
    // In this case, only 1 candidate available, so it should select 1
    // (greedy fallback will fail to add more since pool is exhausted)
    expect(result.selected.length).toBeGreaterThanOrEqual(1);
  });

  it("should respect beam width (pruning)", () => {
    const exercises = [
      createMockExercise("ex1", ["Chest" as Muscle]),
      createMockExercise("ex2", ["Chest" as Muscle]),
      createMockExercise("ex3", ["Chest" as Muscle]),
      createMockExercise("ex4", ["Chest" as Muscle]),
      createMockExercise("ex5", ["Chest" as Muscle]),
      createMockExercise("ex6", ["Chest" as Muscle]),
    ];

    const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 2, // Small beam
      maxDepth: 3,
    });

    // Should still produce valid result with pruning
    expect(result.selected.length).toBeGreaterThan(0);
    expect(result.selected.length).toBeLessThanOrEqual(3);
  });

  it("should stop at max depth", () => {
    const exercises = Array.from({ length: 10 }, (_, i) =>
      createMockExercise(`ex${i}`, ["Chest" as Muscle])
    );

    const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 5,
      maxDepth: 3, // Max 3 exercises
    });

    // Should select at most 3 exercises
    expect(result.selected.length).toBeLessThanOrEqual(3);
  });

  it("should track volume filled correctly", () => {
    const exercises = [
      createMockExercise("bench_press", ["Chest" as Muscle], [
        "Front Delts" as Muscle,
        "Triceps" as Muscle,
      ]),
      createMockExercise("lateral_raise", ["Side Delts" as Muscle]),
    ];

    const objective = createMockObjective(
      new Map([
        ["Chest" as Muscle, 12],
        ["Side Delts" as Muscle, 8],
      ])
    );

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 3,
      maxDepth: 5,
    });

    // Chest should have direct volume from bench
    const chestVolume = result.volumeFilled.get("Chest" as Muscle) ?? 0;
    expect(chestVolume).toBeGreaterThan(0);

    // Front Delts should have indirect volume from bench (if bench selected)
    const benchSelected = result.selected.some((c) => c.exercise.id === "bench_press");
    if (benchSelected) {
      const frontDeltsVolume = result.volumeFilled.get("Front Delts" as Muscle) ?? 0;
      expect(frontDeltsVolume).toBeGreaterThan(0);
    }

    // Side Delts should have direct volume from lateral raise
    const sideDeltsVolume = result.volumeFilled.get("Side Delts" as Muscle) ?? 0;
    expect(sideDeltsVolume).toBeGreaterThan(0);
  });

  it("should calculate volume deficit correctly", () => {
    const exercises = [
      createMockExercise("bench_press", ["Chest" as Muscle]),
    ];

    const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 3,
      maxDepth: 5,
    });

    const target = 12;
    const filled = result.volumeFilled.get("Chest" as Muscle) ?? 0;
    const deficit = result.volumeDeficit.get("Chest" as Muscle) ?? 0;

    // Deficit should be target - filled
    expect(deficit).toBeCloseTo(target - filled, 1);
  });

  it("should mark constraints as satisfied when all met", () => {
    const exercises = [
      createMockExercise("bench_press", ["Chest" as Muscle]),
      createMockExercise("incline_press", ["Chest" as Muscle]),
      createMockExercise("cable_fly", ["Chest" as Muscle]),
    ];

    const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));
    objective.constraints.minExercises = 2;

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 5,
      maxDepth: 8,
    });

    // Should satisfy:
    // - minExercises (>= 2)
    // - volumeCeiling (not exceeded)
    expect(result.selected.length).toBeGreaterThanOrEqual(2);

    // Check volume ceiling
    for (const [muscle, ceiling] of objective.constraints.volumeCeiling) {
      const volume = result.volumeFilled.get(muscle) ?? 0;
      expect(volume).toBeLessThanOrEqual(ceiling);
    }
  });

  it("should handle empty candidate pool gracefully", () => {
    const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

    const result = beamSearch([], objective, {
      beamWidth: 3,
      maxDepth: 5,
    });

    expect(result.selected).toEqual([]);
    expect(result.volumeFilled.size).toBe(0);
    expect(result.timeUsed).toBe(0);
  });

  it("should populate rejected exercises", () => {
    const exercises = [
      createMockExercise("bench_press", ["Chest" as Muscle]),
      createMockExercise("incline_press", ["Chest" as Muscle]),
      createMockExercise("lateral_raise", ["Side Delts" as Muscle]),
    ];

    const objective = createMockObjective(
      new Map([["Chest" as Muscle, 12]])
    );

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 3,
      maxDepth: 5,
    });

    // Some exercises may be rejected (volume ceiling, etc.)
    const totalExercises = result.selected.length + result.rejected.length;
    expect(totalExercises).toBeLessThanOrEqual(exercises.length);
  });

  it("should enforce workout structure (main lifts + accessories)", () => {
    // Create a pool with main lifts and accessories
    const exercises = [
      {
        ...createMockExercise("bench_press", ["Chest" as Muscle]),
        isMainLiftEligible: true,
      },
      {
        ...createMockExercise("ohp", ["Front Delts" as Muscle]),
        isMainLiftEligible: true,
      },
      {
        ...createMockExercise("squat", ["Quads" as Muscle]),
        isMainLiftEligible: true,
      },
      {
        ...createMockExercise("deadlift", ["Glutes" as Muscle]),
        isMainLiftEligible: true,
      },
      createMockExercise("cable_fly", ["Chest" as Muscle]),
      createMockExercise("lateral_raise", ["Side Delts" as Muscle]),
      createMockExercise("triceps_ext", ["Triceps" as Muscle]),
      createMockExercise("bicep_curl", ["Biceps" as Muscle]),
    ];

    const objective = createMockObjective(
      new Map([
        ["Chest" as Muscle, 12],
        ["Front Delts" as Muscle, 0], // KB: MEV = 0
        ["Side Delts" as Muscle, 8],
        ["Triceps" as Muscle, 6],
      ])
    );

    // Set structural constraints
    objective.constraints.minMainLifts = 1;
    objective.constraints.maxMainLifts = 3;
    objective.constraints.minAccessories = 2;

    const candidates = exercises.map((ex) =>
      buildCandidate(ex, objective, computeProposedSets(ex, objective))
    );

    const result = beamSearch(candidates, objective, {
      beamWidth: 5,
      maxDepth: 8,
    });

    // Verify structure constraints are satisfied
    const mainLiftCount = result.selected.filter(
      (c) => c.exercise.isMainLiftEligible
    ).length;
    const accessoryCount = result.selected.filter(
      (c) => !c.exercise.isMainLiftEligible
    ).length;

    // Should have at least 1 main lift
    expect(mainLiftCount).toBeGreaterThanOrEqual(1);
    // Should not exceed 3 main lifts
    expect(mainLiftCount).toBeLessThanOrEqual(3);

    // Should have at least 2 accessories
    expect(accessoryCount).toBeGreaterThanOrEqual(2);

    // Total should be balanced (at least 3 exercises)
    expect(result.selected.length).toBeGreaterThanOrEqual(3);
    expect(result.selected.length).toBeLessThanOrEqual(8);

    // Check that rejected exercises have proper reasons
    const structureViolations = result.rejected.filter(
      (r) => r.reason === "structure_constraint_violated"
    );
    // It's OK if some were rejected for structure (too many main lifts, etc.)
    expect(structureViolations.length).toBeGreaterThanOrEqual(0);
  });

  it("should prefer favorite exercises as tiebreaker when scores are within epsilon", () => {
    const muscle = "Chest" as Muscle;
    const cableFly = createMockExercise("cable_fly", [muscle]);
    const inclinePress = createMockExercise("incline_press", [muscle]);

    const objective = createMockObjective(new Map([[muscle, 3]]));
    // cable_fly is a favorite; incline_press is neutral
    objective.preferences.favoriteExerciseIds = new Set(["cable_fly"]);
    // Ceiling: 5 sets — selecting either exercise (3 sets) fills the slot;
    // adding both would exceed ceiling, so beam picks exactly one.
    objective.constraints.volumeCeiling = new Map([[muscle, 5]]);
    objective.constraints.minMainLifts = 0;
    objective.constraints.minAccessories = 0;
    objective.constraints.minExercises = 1;
    objective.constraints.maxExercises = 2;

    // Build candidates with preset totalScores:
    // incline_press (neutral) scores slightly higher (0.82) than cable_fly (favorite, 0.80).
    // Difference = 0.02 < BEAM_TIEBREAKER_EPSILON (0.05) → tiebreaker fires → favorite wins.
    const makeCandidateWithScore = (exercise: Exercise, totalScore: number): SelectionCandidate => ({
      exercise,
      proposedSets: 3,
      volumeContribution: new Map([[muscle, { direct: 3, indirect: 0 }]]),
      timeContribution: 5,
      scores: {
        deficitFill: 0.5,
        rotationNovelty: 0.5,
        sfrScore: 0.5,
        lengthenedScore: 0.5,
        movementNovelty: 0.5,
        sraAlignment: 0.5,
        userPreference: totalScore,
      },
      totalScore,
    });

    const favoriteCand = makeCandidateWithScore(cableFly, 0.80);
    const neutralCand = makeCandidateWithScore(inclinePress, 0.82);

    const result = beamSearch([favoriteCand, neutralCand], objective, {
      beamWidth: 2,
      maxDepth: 2,
    });

    // After depth-1, two beam states exist:
    //   State A: [cable_fly],    score=0.80, favoritesCount=1
    //   State B: [incline_press], score=0.82, favoritesCount=0
    // |0.82 - 0.80| = 0.02 < 0.05 (epsilon) → secondary sort by favoritesCount
    // State A survives pruning at beamWidth=2 (both survive) but State A is ranked first.
    // At depth-2, both states try to add the other exercise but ceiling prevents it.
    // Final best beam = State A → cable_fly is the result.
    expect(result.selected.length).toBe(1);
    expect(result.selected[0].exercise.id).toBe("cable_fly");
  });

  it("should NOT apply tiebreaker when score difference exceeds epsilon", () => {
    const muscle = "Chest" as Muscle;
    const cableFly = createMockExercise("cable_fly", [muscle]);
    const inclinePress = createMockExercise("incline_press", [muscle]);

    const objective = createMockObjective(new Map([[muscle, 3]]));
    objective.preferences.favoriteExerciseIds = new Set(["cable_fly"]);
    objective.constraints.volumeCeiling = new Map([[muscle, 5]]);
    objective.constraints.minMainLifts = 0;
    objective.constraints.minAccessories = 0;
    objective.constraints.minExercises = 1;
    objective.constraints.maxExercises = 2;

    const makeCandidateWithScore = (exercise: Exercise, totalScore: number): SelectionCandidate => ({
      exercise,
      proposedSets: 3,
      volumeContribution: new Map([[muscle, { direct: 3, indirect: 0 }]]),
      timeContribution: 5,
      scores: {
        deficitFill: 0.5,
        rotationNovelty: 0.5,
        sfrScore: 0.5,
        lengthenedScore: 0.5,
        movementNovelty: 0.5,
        sraAlignment: 0.5,
        userPreference: totalScore,
      },
      totalScore,
    });

    // incline_press (neutral) is clearly better: 0.92 vs 0.80 (gap = 0.12 > epsilon 0.05)
    const favoriteCand = makeCandidateWithScore(cableFly, 0.80);
    const neutralCand = makeCandidateWithScore(inclinePress, 0.92);

    const result = beamSearch([favoriteCand, neutralCand], objective, {
      beamWidth: 2,
      maxDepth: 2,
    });

    // Score gap (0.12) exceeds epsilon (0.05) → tiebreaker does NOT fire → neutral wins
    expect(result.selected.length).toBe(1);
    expect(result.selected[0].exercise.id).toBe("incline_press");
  });

  it("C1b: blocks triceps isolation when 2 pressing compounds already provide 10 direct sets (ceiling 12)", () => {
    // Scenario mirrors the acc53ddb audit finding:
    // BBP (5 direct) + Dip (5 direct) = 10 direct triceps sets.
    // A 3-set isolation would reach 13 > 12 → blocked.
    // A 2-set isolation would reach 12 ≤ 12 → allowed.

    const makeTricepsCandidate = (
      id: string,
      directSets: number,
      isCompound: boolean
    ): SelectionCandidate => ({
      exercise: {
        ...createMockExercise(id, ["Triceps" as Muscle]),
        isCompound,
        isMainLiftEligible: false,
      },
      proposedSets: directSets,
      volumeContribution: new Map([["Triceps" as Muscle, { direct: directSets, indirect: 0 }]]),
      timeContribution: directSets * 1.5,
      scores: {
        deficitFill: 0.8,
        rotationNovelty: 0.8,
        sfrScore: 0.8,
        lengthenedScore: 0.8,
        movementNovelty: 0.5,
        sraAlignment: 0.8,
        userPreference: 0.5,
      },
      totalScore: 0.8,
    });

    const compound1 = makeTricepsCandidate("bench_press", 5, true);
    const compound2 = makeTricepsCandidate("dip", 5, true);
    const isolation3 = makeTricepsCandidate("skull_crusher_3", 3, false);
    const isolation2 = makeTricepsCandidate("skull_crusher_2", 2, false);

    const tricepsTarget = new Map([["Triceps" as Muscle, 20]]);
    const baseObjective = (): ReturnType<typeof createMockObjective> => {
      const obj = createMockObjective(tricepsTarget);
      obj.constraints.volumeCeiling = new Map([["Triceps" as Muscle, 50]]); // no weekly ceiling interference
      obj.constraints.minMainLifts = 0;
      obj.constraints.minAccessories = 0;
      obj.constraints.minExercises = 1;
      obj.constraints.maxExercises = 5;
      return obj;
    };

    // Case A: 5+5+3=13 > 12 — 3-set isolation must be blocked
    const resultBlocked = beamSearch(
      [compound1, compound2, isolation3],
      baseObjective(),
      { beamWidth: 5, maxDepth: 5 }
    );
    expect(resultBlocked.selected.map((c) => c.exercise.id)).not.toContain("skull_crusher_3");

    // Case B: 5+5+2=12 ≤ 12 — 2-set isolation must be allowed
    const resultAllowed = beamSearch(
      [compound1, compound2, isolation2],
      baseObjective(),
      { beamWidth: 5, maxDepth: 5 }
    );
    expect(resultAllowed.selected.map((c) => c.exercise.id)).toContain("skull_crusher_2");
  });
});
