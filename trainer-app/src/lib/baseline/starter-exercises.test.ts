import { describe, expect, it } from "vitest";
import type { StarterExerciseCandidate } from "./starter-exercises";
import { resolveBaselineContextForGoal, selectStarterExercises } from "./starter-exercises";

function exercise(
  id: string,
  name: string,
  equipment: string[],
  isMainLiftEligible = true
): StarterExerciseCandidate {
  return {
    id,
    name,
    isMainLiftEligible,
    equipment,
    primaryMuscles: ["Chest"],
  };
}

const pool: StarterExerciseCandidate[] = [
  exercise("1", "Barbell Bench Press", ["barbell", "bench", "rack"]),
  exercise("2", "Barbell Overhead Press", ["barbell", "rack"]),
  exercise("3", "Barbell Back Squat", ["barbell", "rack"]),
  exercise("4", "Conventional Deadlift", ["barbell"]),
  exercise("5", "Barbell Row", ["barbell"]),
  exercise("6", "Chin-Up", ["bodyweight"]),
  exercise("7", "Romanian Deadlift", ["barbell"]),
  exercise("8", "Dip (Chest Emphasis)", ["bodyweight"]),
  exercise("9", "Lat Pulldown", ["machine", "cable"]),
  exercise("10", "Seated Cable Row", ["cable", "machine"]),
];

describe("selectStarterExercises", () => {
  it("returns a curated PPL list capped to eight", () => {
    const selected = selectStarterExercises(pool, "PPL", ["barbell", "rack", "bench"]);
    expect(selected.length).toBeGreaterThanOrEqual(5);
    expect(selected.length).toBeLessThanOrEqual(8);
    expect(selected.some((exercise) => exercise.name === "Barbell Bench Press")).toBe(true);
    expect(selected.some((exercise) => exercise.name === "Barbell Back Squat")).toBe(true);
  });

  it("adapts pull slot to lat pulldown when chin-up unavailable", () => {
    const selected = selectStarterExercises(
      pool.filter((item) => item.name !== "Chin-Up"),
      "UPPER_LOWER",
      ["cable", "machine", "barbell", "rack", "bench"]
    );
    expect(selected.some((exercise) => exercise.name === "Lat Pulldown")).toBe(true);
  });

  it("filters out exercises requiring unavailable equipment", () => {
    const selected = selectStarterExercises(pool, "PPL", ["bodyweight"]);
    expect(selected.some((exercise) => exercise.name === "Barbell Bench Press")).toBe(false);
    expect(selected.some((exercise) => exercise.name === "Chin-Up")).toBe(true);
  });

  it("defaults to full equipment when none is provided", () => {
    const selected = selectStarterExercises(pool, "PPL", undefined);
    expect(selected.some((exercise) => exercise.name === "Barbell Bench Press")).toBe(true);
    expect(selected.some((exercise) => exercise.name === "Conventional Deadlift")).toBe(true);
  });
});

describe("resolveBaselineContextForGoal", () => {
  it("maps strength and athleticism to strength context", () => {
    expect(resolveBaselineContextForGoal("STRENGTH")).toBe("strength");
    expect(resolveBaselineContextForGoal("ATHLETICISM")).toBe("strength");
  });

  it("maps hypertrophy and fat-loss style goals to volume context", () => {
    expect(resolveBaselineContextForGoal("HYPERTROPHY")).toBe("volume");
    expect(resolveBaselineContextForGoal("FAT_LOSS")).toBe("volume");
    expect(resolveBaselineContextForGoal("GENERAL_HEALTH")).toBe("volume");
  });
});
