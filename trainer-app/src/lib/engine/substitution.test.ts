import { describe, expect, it } from "vitest";
import { suggestSubstitutes } from "./substitution";
import type { Constraints, Exercise } from "./types";

const baseExercise: Exercise = {
  id: "target",
  name: "Barbell Bench Press",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  jointStress: "high",
  isMainLiftEligible: true,
  isCompound: true,
  fatigueCost: 4,
  equipment: ["barbell"],
  primaryMuscles: ["chest", "triceps"],
  stimulusBias: ["mechanical"],
};

const constraints: Constraints = {
  daysPerWeek: 4,
  sessionMinutes: 60,
  splitType: "ppl",
  availableEquipment: ["barbell", "dumbbell", "cable", "machine"],
};

function makeExercise(overrides: Partial<Exercise> & { id: string; name: string }): Exercise {
  return {
    movementPatterns: [],
    splitTags: ["push"],
    jointStress: "low",
    equipment: ["dumbbell"],
    ...overrides,
  };
}

describe("suggestSubstitutes", () => {
  it("scores pattern overlap highest (weight 4)", () => {
    const library: Exercise[] = [
      makeExercise({
        id: "pattern-match",
        name: "Dumbbell Bench Press",
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["chest"],
        stimulusBias: ["mechanical"],
      }),
      makeExercise({
        id: "no-pattern",
        name: "Lateral Raise",
        movementPatterns: ["vertical_push"],
        primaryMuscles: ["chest"],
        stimulusBias: ["mechanical"],
      }),
    ];

    const result = suggestSubstitutes(baseExercise, library, constraints);
    expect(result[0].id).toBe("pattern-match");
  });

  it("scores muscle overlap (weight 3)", () => {
    const library: Exercise[] = [
      makeExercise({
        id: "muscle-match",
        name: "Dumbbell Fly",
        movementPatterns: [],
        primaryMuscles: ["chest", "triceps"],
      }),
      makeExercise({
        id: "no-muscle",
        name: "Lateral Raise",
        movementPatterns: [],
        primaryMuscles: ["side delts"],
      }),
    ];

    const result = suggestSubstitutes(baseExercise, library, constraints);
    expect(result[0].id).toBe("muscle-match");
  });

  it("scores stimulus overlap (weight 2)", () => {
    const library: Exercise[] = [
      makeExercise({
        id: "stim-match",
        name: "Cable Fly",
        movementPatterns: [],
        primaryMuscles: [],
        stimulusBias: ["mechanical"],
      }),
      makeExercise({
        id: "no-stim",
        name: "Pec Deck",
        movementPatterns: [],
        primaryMuscles: [],
        stimulusBias: ["stretch"],
      }),
    ];

    const result = suggestSubstitutes(baseExercise, library, constraints);
    expect(result[0].id).toBe("stim-match");
  });

  it("returns at most 3 candidates", () => {
    const library: Exercise[] = Array.from({ length: 10 }, (_, i) =>
      makeExercise({
        id: `ex-${i}`,
        name: `Exercise ${i}`,
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["chest"],
      })
    );

    const result = suggestSubstitutes(baseExercise, library, constraints);
    expect(result).toHaveLength(3);
  });

  it("returns empty array when no candidates match", () => {
    const library: Exercise[] = [
      makeExercise({
        id: "wrong-equip",
        name: "Sled Press",
        equipment: ["sled"],
      }),
    ];

    const result = suggestSubstitutes(baseExercise, library, constraints);
    expect(result).toHaveLength(0);
  });

  it("excludes exercises with blocked tags", () => {
    const library: Exercise[] = [
      makeExercise({
        id: "blocked",
        name: "Plank",
        splitTags: ["push", "core"],
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["chest"],
      }),
      makeExercise({
        id: "allowed",
        name: "Dumbbell Press",
        splitTags: ["push"],
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["chest"],
      }),
    ];

    const result = suggestSubstitutes(baseExercise, library, constraints);
    expect(result.map((e) => e.id)).not.toContain("blocked");
    expect(result.map((e) => e.id)).toContain("allowed");
  });

  it("excludes the target exercise itself", () => {
    const library: Exercise[] = [
      baseExercise,
      makeExercise({
        id: "other",
        name: "Dumbbell Press",
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["chest"],
      }),
    ];

    const result = suggestSubstitutes(baseExercise, library, constraints);
    expect(result.map((e) => e.id)).not.toContain("target");
  });

  it("applies pain constraints to filter candidates", () => {
    const library: Exercise[] = [
      makeExercise({
        id: "contra",
        name: "Skull Crusher",
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["triceps"],
        contraindications: { elbow: true },
      }),
      makeExercise({
        id: "safe",
        name: "Cable Pushdown",
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["triceps"],
      }),
    ];

    const result = suggestSubstitutes(baseExercise, library, constraints, { elbow: 2 });
    expect(result.map((e) => e.id)).not.toContain("contra");
    expect(result.map((e) => e.id)).toContain("safe");
  });
});
