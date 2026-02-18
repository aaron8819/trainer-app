/**
 * Tests for optimizer.ts - Main entry point and hard constraint filtering
 */

import { describe, it, expect } from "vitest";
import { selectExercisesOptimized } from "./optimizer";
import type { Exercise, Muscle, EquipmentType } from "../types";
import type { SelectionObjective } from "./types";

describe("selectExercisesOptimized", () => {
  const createMockExercise = (
    id: string,
    primaryMuscles: Muscle[],
    equipment: EquipmentType[] = ["barbell"],
    sfrScore: number = 4
  ): Exercise => ({
    id,
    name: id.replace("_", " "),
    primaryMuscles,
    secondaryMuscles: [],
    equipment,
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "low",
    repRangeMin: 5,
    repRangeMax: 8,
    timePerSetSec: 60,
    fatigueCost: 3,
    sfrScore,
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
          target * 1.5,
        ])
      ),
      painConflicts: new Set(),
      userAvoids: new Set(),
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
  });

  describe("Hard Constraint Filtering", () => {
    it("should filter out exercises with pain conflicts", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
        createMockExercise("incline_press", ["Chest" as Muscle]),
        createMockExercise("dips", ["Chest" as Muscle]),
      ];

      const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));
      objective.constraints.painConflicts = new Set(["dips"]); // Dips flagged for pain

      const result = selectExercisesOptimized(pool, objective);

      // Dips should be rejected
      const rejectedIds = result.rejected.map((r) => r.exercise.id);
      expect(rejectedIds).toContain("dips");

      const rejectedDips = result.rejected.find((r) => r.exercise.id === "dips");
      expect(rejectedDips?.reason).toBe("pain_conflict");

      // Bench and incline should be considered
      const selectedIds = result.selected.map((s) => s.exercise.id);
      expect(selectedIds.length).toBeGreaterThan(0);
      expect(selectedIds).not.toContain("dips");
    });

    // Phase 2: Specific rejection reasons (ADR-063)
    it("should return 'pain_conflict' rejection reason for exercises in painConflicts set", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
        createMockExercise("incline_press", ["Chest" as Muscle]),
      ];

      const objective: SelectionObjective = {
        ...createMockObjective(new Map([["Chest" as Muscle, 12]])),
        constraints: {
          ...createMockObjective(new Map([["Chest" as Muscle, 12]])).constraints,
          painConflicts: new Set(["bench_press"]),
          userAvoids: new Set(),
        },
      };

      const result = selectExercisesOptimized(pool, objective);

      const rejectedBench = result.rejected.find((r) => r.exercise.id === "bench_press");
      expect(rejectedBench).toBeDefined();
      expect(rejectedBench?.reason).toBe("pain_conflict");
    });

    it("should return 'user_avoided' rejection reason for exercises in userAvoids set", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
        createMockExercise("incline_press", ["Chest" as Muscle]),
      ];

      const objective: SelectionObjective = {
        ...createMockObjective(new Map([["Chest" as Muscle, 12]])),
        constraints: {
          ...createMockObjective(new Map([["Chest" as Muscle, 12]])).constraints,
          painConflicts: new Set(),
          userAvoids: new Set(["incline_press"]),
        },
      };

      const result = selectExercisesOptimized(pool, objective);

      const rejectedIncline = result.rejected.find((r) => r.exercise.id === "incline_press");
      expect(rejectedIncline).toBeDefined();
      expect(rejectedIncline?.reason).toBe("user_avoided");
    });

    it("should prioritize painConflicts over userAvoids when exercise is in both sets", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
        createMockExercise("incline_press", ["Chest" as Muscle]),
      ];

      const objective: SelectionObjective = {
        ...createMockObjective(new Map([["Chest" as Muscle, 12]])),
        constraints: {
          ...createMockObjective(new Map([["Chest" as Muscle, 12]])).constraints,
          painConflicts: new Set(["bench_press"]),
          userAvoids: new Set(["bench_press"]),
        },
      };

      const result = selectExercisesOptimized(pool, objective);

      const rejectedBench = result.rejected.find((r) => r.exercise.id === "bench_press");
      expect(rejectedBench).toBeDefined();
      expect(rejectedBench?.reason).toBe("pain_conflict"); // pain_conflict takes precedence
    });

    it("should handle multiple hard-filter rejection reasons", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
        createMockExercise("incline_press", ["Chest" as Muscle]),
        createMockExercise("dips", ["Chest" as Muscle]),
      ];

      const objective: SelectionObjective = {
        ...createMockObjective(new Map([["Chest" as Muscle, 12]])),
        constraints: {
          ...createMockObjective(new Map([["Chest" as Muscle, 12]])).constraints,
          painConflicts: new Set(["bench_press"]),
          userAvoids: new Set(["incline_press"]),
        },
      };

      const result = selectExercisesOptimized(pool, objective);

      const rejectedBench = result.rejected.find((r) => r.exercise.id === "bench_press");
      expect(rejectedBench?.reason).toBe("pain_conflict");

      const rejectedIncline = result.rejected.find((r) => r.exercise.id === "incline_press");
      expect(rejectedIncline?.reason).toBe("user_avoided");
    });
  });

  describe("Integration", () => {
    it("should return complete SelectionResult", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
        createMockExercise("incline_press", ["Chest" as Muscle]),
      ];

      const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

      const result = selectExercisesOptimized(pool, objective);

      // Should have all expected fields
      expect(result).toHaveProperty("selected");
      expect(result).toHaveProperty("rejected");
      expect(result).toHaveProperty("volumeFilled");
      expect(result).toHaveProperty("volumeDeficit");
      expect(result).toHaveProperty("timeUsed");
      expect(result).toHaveProperty("constraintsSatisfied");
      expect(result).toHaveProperty("rationale");

      // Selected should be array of candidates
      expect(Array.isArray(result.selected)).toBe(true);
      expect(result.selected.length).toBeGreaterThan(0);

      // Rejected should be array of rejected exercises
      expect(Array.isArray(result.rejected)).toBe(true);

      // Rationale should have structure
      expect(result.rationale).toHaveProperty("overallStrategy");
      expect(result.rationale).toHaveProperty("perExercise");
    });

    it("should merge hard filter rejections with beam search rejections", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle], ["barbell"]),
        createMockExercise("dips", ["Chest" as Muscle], ["bodyweight"]),
      ];

      const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));
      objective.constraints.painConflicts = new Set(["dips"]); // Dips flagged for pain

      const result = selectExercisesOptimized(pool, objective);

      // Dips rejected by pain conflict filter
      const rejectedIds = result.rejected.map((r) => r.exercise.id);
      expect(rejectedIds).toContain("dips");

      const dipsRejection = result.rejected.find((r) => r.exercise.id === "dips");
      expect(dipsRejection?.reason).toBe("pain_conflict");
    });

    it("should handle empty pool gracefully", () => {
      const pool: Exercise[] = [];
      const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

      const result = selectExercisesOptimized(pool, objective);

      expect(result.selected).toEqual([]);
      expect(result.volumeFilled.size).toBe(0);
      expect(result.constraintsSatisfied).toBe(false);
      expect(result.rationale.overallStrategy).toContain("No feasible exercises");
    });

    it("should respect custom beam config", () => {
      const pool = Array.from({ length: 10 }, (_, i) =>
        createMockExercise(`ex${i}`, ["Chest" as Muscle])
      );

      const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

      const result = selectExercisesOptimized(pool, objective, {
        beamWidth: 2,
        maxDepth: 3,
      });

      // Should respect max depth
      expect(result.selected.length).toBeLessThanOrEqual(3);
    });

    it("should use default beam config when not provided", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
        createMockExercise("incline_press", ["Chest" as Muscle]),
      ];

      const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

      const result = selectExercisesOptimized(pool, objective);

      // Should still work with defaults
      expect(result.selected.length).toBeGreaterThan(0);
    });
  });

  describe("Volume Accounting", () => {
    it("should track effective volume correctly", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
      ];

      pool[0].secondaryMuscles = ["Front Delts" as Muscle, "Triceps" as Muscle];

      const objective = createMockObjective(
        new Map([
          ["Chest" as Muscle, 12],
          ["Front Delts" as Muscle, 8],
        ])
      );

      const result = selectExercisesOptimized(pool, objective);

      // Chest should have direct volume
      const chestVolume = result.volumeFilled.get("Chest" as Muscle) ?? 0;
      expect(chestVolume).toBeGreaterThan(0);

      // Front Delts should have indirect volume (if bench selected)
      const benchSelected = result.selected.some((c) => c.exercise.id === "bench_press");
      if (benchSelected) {
        const frontDeltsVolume = result.volumeFilled.get("Front Delts" as Muscle) ?? 0;
        expect(frontDeltsVolume).toBeGreaterThan(0);
        expect(frontDeltsVolume).toBeLessThan(chestVolume); // Indirect < direct
      }
    });

    it("should calculate deficit correctly", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
      ];

      const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

      const result = selectExercisesOptimized(pool, objective);

      const target = 12;
      const filled = result.volumeFilled.get("Chest" as Muscle) ?? 0;
      const deficit = result.volumeDeficit.get("Chest" as Muscle) ?? 0;

      expect(deficit).toBeCloseTo(Math.max(0, target - filled), 1);
    });
  });

  describe("Explainability", () => {
    it("should generate rationale with overall strategy", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
      ];

      const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

      const result = selectExercisesOptimized(pool, objective);

      expect(typeof result.rationale.overallStrategy).toBe("string");
      expect(result.rationale.overallStrategy.length).toBeGreaterThan(0);
    });

    it("should generate per-exercise rationale", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
      ];

      const objective = createMockObjective(new Map([["Chest" as Muscle, 12]]));

      const result = selectExercisesOptimized(pool, objective);

      expect(result.rationale.perExercise instanceof Map).toBe(true);

      // Each selected exercise should have rationale
      for (const candidate of result.selected) {
        const rationale = result.rationale.perExercise.get(candidate.exercise.id);
        expect(typeof rationale).toBe("string");
        expect(rationale!.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Candidate ordering — stretch quality priority", () => {
    // Overhead Cable Triceps Extension (5/5 lengthened) vs Skull Crusher (3/5).
    // Both are Triceps isolations with the same "extension" movement pattern.
    // The pre-sort ensures overhead cable is evaluated first in each beam state;
    // the isolation-duplicate filter then blocks skull crusher as dominated.
    it("selects higher-stretch isolation over lower-stretch isolation for the same muscle slot", () => {
      const base: Exercise = {
        id: "",
        name: "",
        primaryMuscles: ["Triceps" as Muscle],
        secondaryMuscles: [],
        equipment: ["cable" as EquipmentType],
        movementPatterns: ["extension"],
        splitTags: ["push"],
        jointStress: "low" as const,
        repRangeMin: 8,
        repRangeMax: 15,
        timePerSetSec: 40,
        fatigueCost: 2,
        isMainLiftEligible: false,
        isCompound: false,
      };

      const overheadCable: Exercise = {
        ...base,
        id: "overhead_cable_extension",
        name: "Overhead Cable Triceps Extension",
        sfrScore: 5,
        lengthPositionScore: 5,
      };

      const skullCrusher: Exercise = {
        ...base,
        id: "skull_crusher",
        name: "Lying Triceps Extension (Skull Crusher)",
        equipment: ["barbell" as EquipmentType],
        sfrScore: 4,
        lengthPositionScore: 3,
      };

      // Pool with skull crusher listed first (inverse of desired selection order)
      // to confirm the sort in optimizer.ts overrides input order.
      const pool: Exercise[] = [skullCrusher, overheadCable];

      const objective = createMockObjective(
        new Map([["Triceps" as Muscle, 9]])
      );
      // No main lift required — purely testing isolation slot resolution
      const result = selectExercisesOptimized(pool, objective);

      const selectedIds = result.selected.map((c) => c.exercise.id);
      const rejectedIds = result.rejected.map((r) => r.exercise.id);

      expect(selectedIds).toContain("overhead_cable_extension");
      expect(rejectedIds).toContain("skull_crusher");

      const skullCrusherRejection = result.rejected.find(
        (r) => r.exercise.id === "skull_crusher"
      );
      expect(skullCrusherRejection?.reason).toBe("dominated_by_better_option");
    });
  });
});
