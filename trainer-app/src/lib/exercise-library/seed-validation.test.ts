/**
 * Validates seed data consistency without a DB connection.
 * Uses exercises_comprehensive.json as the source of truth.
 */
import { describe, it, expect } from "vitest";
import { MUSCLE_GROUP_HIERARCHY } from "./constants";
import exercisesJson from "../../../prisma/exercises_comprehensive.json";

const exercises = exercisesJson.exercises;
const exerciseNames = exercises.map((e) => e.name);

describe("seed data consistency", () => {
  it("has 133 canonical exercises", () => {
    expect(exercises).toHaveLength(133);
  });

  it("has no duplicate exercise names", () => {
    const names = new Set(exerciseNames);
    expect(names.size).toBe(exerciseNames.length);
  });

  it("every exercise has valid required fields", () => {
    for (const ex of exercises) {
      expect(ex.name, `exercise missing name`).toBeTruthy();
      expect(ex.movementPatterns.length, `${ex.name} missing movementPatterns`).toBeGreaterThan(0);
      expect(ex.splitTag, `${ex.name} missing splitTag`).toBeTruthy();
      expect(ex.jointStress, `${ex.name} missing jointStress`).toBeTruthy();
      expect(ex.equipment.length, `${ex.name} missing equipment`).toBeGreaterThan(0);
      expect(ex.primaryMuscles.length, `${ex.name} missing primaryMuscles`).toBeGreaterThan(0);
      expect(typeof ex.isCompound, `${ex.name} isCompound`).toBe("boolean");
      expect(typeof ex.isMainLiftEligible, `${ex.name} isMainLiftEligible`).toBe("boolean");
      expect(ex.fatigueCost, `${ex.name} fatigueCost`).toBeGreaterThanOrEqual(1);
      expect(ex.fatigueCost, `${ex.name} fatigueCost`).toBeLessThanOrEqual(5);
      expect(ex.sfrScore, `${ex.name} sfrScore`).toBeGreaterThanOrEqual(1);
      expect(ex.sfrScore, `${ex.name} sfrScore`).toBeLessThanOrEqual(5);
      expect(ex.lengthPositionScore, `${ex.name} lengthPositionScore`).toBeGreaterThanOrEqual(1);
      expect(ex.lengthPositionScore, `${ex.name} lengthPositionScore`).toBeLessThanOrEqual(5);
      expect(["beginner", "intermediate", "advanced"]).toContain(ex.difficulty);
      expect(typeof ex.unilateral).toBe("boolean");
      expect(ex.repRangeRecommendation.min).toBeGreaterThanOrEqual(1);
      expect(ex.repRangeRecommendation.max).toBeGreaterThanOrEqual(ex.repRangeRecommendation.min);
    }
  });

  it("compound and isolation classification is consistent", () => {
    const compounds = exercises.filter((e) => e.isCompound);
    const isolations = exercises.filter((e) => !e.isCompound);
    // Should have a reasonable mix
    expect(compounds.length).toBeGreaterThan(40);
    expect(isolations.length).toBeGreaterThan(40);
    expect(compounds.length + isolations.length).toBe(133);
  });

  it("all muscles in exercises are in the 18 canonical muscles", () => {
    const knownMuscles = new Set([
      "Chest", "Lats", "Upper Back", "Lower Back",
      "Front Delts", "Side Delts", "Rear Delts",
      "Biceps", "Triceps", "Forearms",
      "Quads", "Hamstrings", "Glutes", "Adductors", "Abductors", "Calves",
      "Core", "Abs",
    ]);
    for (const ex of exercises) {
      for (const muscle of [...ex.primaryMuscles, ...ex.secondaryMuscles]) {
        expect(knownMuscles.has(muscle), `${ex.name} uses unknown muscle "${muscle}"`).toBe(true);
      }
    }
  });

  it("all muscles in MUSCLE_GROUP_HIERARCHY are canonical muscles", () => {
    const knownMuscles = new Set([
      "Chest", "Lats", "Upper Back", "Lower Back",
      "Front Delts", "Side Delts", "Rear Delts",
      "Biceps", "Triceps", "Forearms",
      "Quads", "Hamstrings", "Glutes", "Adductors", "Abductors", "Calves",
      "Core", "Abs",
    ]);
    for (const muscles of Object.values(MUSCLE_GROUP_HIERARCHY)) {
      for (const muscle of muscles) {
        expect(knownMuscles.has(muscle), `MUSCLE_GROUP_HIERARCHY has unknown muscle "${muscle}"`).toBe(true);
      }
    }
  });

  it("every muscle group has at least one exercise targeting it", () => {
    const allMuscles = Object.values(MUSCLE_GROUP_HIERARCHY).flat();
    for (const muscle of allMuscles) {
      const targeting = exercises.filter((ex) =>
        ex.primaryMuscles.includes(muscle) || ex.secondaryMuscles.includes(muscle)
      );
      expect(targeting.length, `No exercises target "${muscle}"`).toBeGreaterThan(0);
    }
  });

  it("valid movement patterns used", () => {
    const validPatterns = new Set([
      "horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull",
      "squat", "hinge", "lunge", "carry", "rotation", "anti_rotation",
      "flexion", "extension", "abduction", "adduction", "isolation",
      "calf_raise_extended", "calf_raise_flexed",
    ]);
    for (const ex of exercises) {
      for (const p of ex.movementPatterns) {
        expect(validPatterns.has(p), `${ex.name} has unknown pattern "${p}"`).toBe(true);
      }
    }
  });

  it("valid split tags used", () => {
    const validTags = new Set(["push", "pull", "legs", "core", "conditioning", "mobility", "prehab"]);
    for (const ex of exercises) {
      expect(validTags.has(ex.splitTag), `${ex.name} has unknown tag "${ex.splitTag}"`).toBe(true);
    }
  });

  it("valid equipment types used", () => {
    const validEquipment = new Set([
      "Barbell", "Dumbbell", "Machine", "Cable", "Bodyweight",
      "Kettlebell", "Band", "Sled", "Bench", "Rack", "EZ_Bar", "Trap_Bar",
    ]);
    for (const ex of exercises) {
      for (const e of ex.equipment) {
        expect(validEquipment.has(e), `${ex.name} has unknown equipment "${e}"`).toBe(true);
      }
    }
  });
});
