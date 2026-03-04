import { describe, expect, it, vi } from "vitest";
import type { Exercise } from "./types";
import {
  collectStimulusFallbackExercises,
  getEffectiveStimulusByMuscle,
  resolveStimulusProfile,
  toMuscleId,
  validateStimulusProfileCoverage,
} from "./stimulus";

function makeExercise(partial: Partial<Exercise> & Pick<Exercise, "id" | "name">): Exercise {
  return {
    id: partial.id,
    name: partial.name,
    movementPatterns: partial.movementPatterns ?? ["horizontal_push"],
    splitTags: partial.splitTags ?? ["push"],
    jointStress: partial.jointStress ?? "medium",
    equipment: partial.equipment ?? ["dumbbell"],
    primaryMuscles: partial.primaryMuscles ?? [],
    secondaryMuscles: partial.secondaryMuscles ?? [],
    stimulusProfile: partial.stimulusProfile,
  };
}

describe("stimulus helper", () => {
  it("uses explicit production profiles when available", () => {
    const exercise = makeExercise({
      id: "incline-db-bench",
      name: "Incline Dumbbell Bench Press",
      primaryMuscles: ["Chest"],
      secondaryMuscles: ["Triceps", "Front Delts"],
    });

    expect(resolveStimulusProfile(exercise)).toEqual({
      chest: 1,
      triceps: 0.4,
      front_delts: 0.45,
    });
    expect(getEffectiveStimulusByMuscle(exercise, 4)).toEqual(
      new Map([
        ["Chest", 4],
        ["Triceps", 1.6],
        ["Front Delts", 1.8],
      ])
    );
  });

  it("falls back centrally to taxonomy-derived weights and logs once", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const exercise = makeExercise({
      id: "custom-row",
      name: "Custom Row",
      primaryMuscles: ["Lats", "Upper Back"],
      secondaryMuscles: ["Biceps"],
    });

    const first = resolveStimulusProfile(exercise);
    const second = resolveStimulusProfile(exercise);

    expect(first).toEqual({
      lats: 1,
      upper_back: 1,
      biceps: 0.3,
    });
    expect(second).toEqual(first);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("normalizes title-case muscle names into canonical muscle ids", () => {
    expect(toMuscleId("Front Delts")).toBe("front_delts");
    expect(toMuscleId("Lower Back")).toBe("lower_back");
  });

  it("reports uncovered planner exercises through one centralized coverage helper", () => {
    const exercises = [
      makeExercise({
        id: "bench",
        name: "Barbell Bench Press",
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps", "Front Delts"],
      }),
      makeExercise({
        id: "custom-row",
        name: "Custom Row",
        primaryMuscles: ["Lats"],
        secondaryMuscles: ["Biceps"],
      }),
    ];

    expect(collectStimulusFallbackExercises(exercises)).toEqual([
      { id: "custom-row", name: "Custom Row" },
    ]);
  });

  it("can fail fast on uncovered stimulus profiles when strict coverage is enabled", () => {
    const exercise = makeExercise({
      id: "custom-row",
      name: "Custom Row",
      primaryMuscles: ["Lats"],
      secondaryMuscles: ["Biceps"],
    });

    expect(() =>
      validateStimulusProfileCoverage([exercise], {
        context: "test planner",
        strict: true,
      })
    ).toThrow(/without explicit stimulusProfile coverage/i);
  });
});
