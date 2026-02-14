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
    repRangeMin: 5,
    repRangeMax: 8,
    timePerSetSec: 60,
    fatigueCost: 3,
    sfrScore,
    lengthPositionScore: 3,
  });

  const createMockObjective = (
    weeklyTarget: Map<Muscle, number>,
    equipment: Set<EquipmentType> = new Set(["barbell", "dumbbell"]),
    contraindications: Set<string> = new Set()
  ): SelectionObjective => ({
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map(
        Array.from(weeklyTarget.entries()).map(([muscle, target]) => [
          muscle,
          target * 1.5,
        ])
      ),
      timeBudget: 60,
      equipment,
      contraindications,
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
    it("should filter out exercises with unavailable equipment", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle], ["barbell"]),
        createMockExercise("dumbbell_press", ["Chest" as Muscle], ["dumbbell"]),
        createMockExercise("cable_fly", ["Chest" as Muscle], ["cable"]),
      ];

      const objective = createMockObjective(
        new Map([["Chest" as Muscle, 12]]),
        new Set(["barbell", "dumbbell"]) // No cable
      );

      const result = selectExercisesOptimized(pool, objective);

      // Cable fly should be rejected
      const rejectedIds = result.rejected.map((r) => r.exercise.id);
      expect(rejectedIds).toContain("cable_fly");

      // Bench and dumbbell should be considered
      const selectedIds = result.selected.map((s) => s.exercise.id);
      expect(selectedIds.some((id) => ["bench_press", "dumbbell_press"].includes(id))).toBe(
        true
      );
    });

    it("should filter out contraindicated exercises", () => {
      const pool = [
        createMockExercise("bench_press", ["Chest" as Muscle]),
        createMockExercise("incline_press", ["Chest" as Muscle]),
        createMockExercise("dips", ["Chest" as Muscle]),
      ];

      const objective = createMockObjective(
        new Map([["Chest" as Muscle, 12]]),
        new Set(["barbell", "dumbbell", "bodyweight"]),
        new Set(["dips"]) // User avoids dips
      );

      const result = selectExercisesOptimized(pool, objective);

      // Dips should be rejected
      const rejectedIds = result.rejected.map((r) => r.exercise.id);
      expect(rejectedIds).toContain("dips");

      const rejectedDips = result.rejected.find((r) => r.exercise.id === "dips");
      expect(rejectedDips?.reason).toBe("contraindicated");

      // Bench and incline should be considered
      const selectedIds = result.selected.map((s) => s.exercise.id);
      expect(selectedIds.length).toBeGreaterThan(0);
      expect(selectedIds).not.toContain("dips");
    });

    it("should allow bodyweight exercises even without explicit equipment", () => {
      const pool = [
        createMockExercise("pushup", ["Chest" as Muscle], ["bodyweight"]),
        createMockExercise("bench_press", ["Chest" as Muscle], ["barbell"]),
      ];

      const objective = createMockObjective(
        new Map([["Chest" as Muscle, 12]]),
        new Set(["dumbbell"]) // No barbell or bodyweight listed
      );

      const result = selectExercisesOptimized(pool, objective);

      // Pushup should pass (bodyweight always available)
      const selectedIds = result.selected.map((s) => s.exercise.id);
      expect(selectedIds).toContain("pushup");

      // Bench should be rejected (no barbell)
      const rejectedIds = result.rejected.map((r) => r.exercise.id);
      expect(rejectedIds).toContain("bench_press");
    });

    it("should handle exercises with no equipment required", () => {
      const pool = [
        createMockExercise("plank", ["Abs" as Muscle], []),
      ];

      const objective = createMockObjective(
        new Map([["Abs" as Muscle, 6]]),
        new Set() // No equipment available
      );

      const result = selectExercisesOptimized(pool, objective);

      // Exercise with no equipment should pass
      const selectedIds = result.selected.map((s) => s.exercise.id);
      expect(selectedIds).toContain("plank");
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
        createMockExercise("cable_fly", ["Chest" as Muscle], ["cable"]), // No cable
        createMockExercise("dips", ["Chest" as Muscle], ["bodyweight"]),
      ];

      const objective = createMockObjective(
        new Map([["Chest" as Muscle, 12]]),
        new Set(["barbell", "bodyweight"]), // No cable
        new Set(["dips"]) // Contraindicated
      );

      const result = selectExercisesOptimized(pool, objective);

      // Should have rejections from both hard filter and beam search
      const rejectedIds = result.rejected.map((r) => r.exercise.id);

      // Cable fly rejected by equipment filter
      expect(rejectedIds).toContain("cable_fly");

      // Dips rejected by contraindication filter
      expect(rejectedIds).toContain("dips");

      // Should have rejection reasons
      const cableFlyRejection = result.rejected.find((r) => r.exercise.id === "cable_fly");
      expect(cableFlyRejection?.reason).toBe("equipment_unavailable");

      const dipsRejection = result.rejected.find((r) => r.exercise.id === "dips");
      expect(dipsRejection?.reason).toBe("contraindicated");
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

    it("should handle all exercises filtered out", () => {
      const pool = [
        createMockExercise("cable_fly", ["Chest" as Muscle], ["cable"]),
        createMockExercise("machine_press", ["Chest" as Muscle], ["machine"]),
      ];

      const objective = createMockObjective(
        new Map([["Chest" as Muscle, 12]]),
        new Set(["barbell", "dumbbell"]) // No cable or machine
      );

      const result = selectExercisesOptimized(pool, objective);

      expect(result.selected).toEqual([]);
      expect(result.rejected.length).toBe(2);
      expect(result.constraintsSatisfied).toBe(false);
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
});
