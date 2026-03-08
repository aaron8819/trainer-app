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

  it("supports strict coverage allowlists for phased cleanup", () => {
    const allowlisted = makeExercise({
      id: "rear-delt-fly",
      name: "Rear Delt Fly",
      primaryMuscles: ["Rear Delts"],
    });
    const blocking = makeExercise({
      id: "custom-uncovered-curl",
      name: "Custom Uncovered Curl",
      primaryMuscles: ["Biceps"],
    });

    expect(() =>
      validateStimulusProfileCoverage([allowlisted, blocking], {
        context: "cleanup",
        strict: true,
        allowExerciseIds: ["rear-delt-fly"],
      })
    ).toThrow(/Custom Uncovered Curl \(custom-uncovered-curl\)/i);
  });

  it("keeps bench variants chest-dominant unless explicitly triceps-emphasis", () => {
    const bench = makeExercise({
      id: "barbell-bench-press",
      name: "Barbell Bench Press",
      primaryMuscles: ["Chest"],
      secondaryMuscles: ["Triceps", "Front Delts"],
    });
    const tricepsDip = makeExercise({
      id: "dip-triceps",
      name: "Dip (Triceps Emphasis)",
      primaryMuscles: ["Triceps"],
      secondaryMuscles: ["Chest", "Front Delts"],
    });

    const benchProfile = resolveStimulusProfile(bench);
    const dipProfile = resolveStimulusProfile(tricepsDip);

    expect((benchProfile.chest ?? 0)).toBeGreaterThanOrEqual(benchProfile.triceps ?? 0);
    expect((dipProfile.triceps ?? 0)).toBeGreaterThanOrEqual(dipProfile.chest ?? 0);
  });

  it("keeps rows prime-mover dominant over elbow flexors", () => {
    const row = makeExercise({
      id: "barbell-row",
      name: "Barbell Row",
      primaryMuscles: ["Upper Back", "Lats"],
      secondaryMuscles: ["Biceps"],
    });
    const profile = resolveStimulusProfile(row);
    const rowPrimeMover = Math.max(profile.upper_back ?? 0, profile.lats ?? 0);

    expect(rowPrimeMover).toBeGreaterThan(profile.biceps ?? 0);
  });

  it("keeps knee-dominant squats quad-dominant and non-hamstring-prime", () => {
    const squat = makeExercise({
      id: "barbell-back-squat",
      name: "Barbell Back Squat",
      primaryMuscles: ["Quads"],
      secondaryMuscles: ["Glutes", "Adductors"],
    });
    const profile = resolveStimulusProfile(squat);

    expect((profile.quads ?? 0)).toBeGreaterThan(profile.glutes ?? 0);
    expect(profile.hamstrings ?? 0).toBeLessThan(0.5);
  });

  it("keeps vertical presses side-delt dominant with front-delt support", () => {
    const overheadPress = makeExercise({
      id: "barbell-overhead-press",
      name: "Barbell Overhead Press",
      primaryMuscles: ["Side Delts", "Triceps"],
      secondaryMuscles: ["Front Delts"],
    });
    const arnold = makeExercise({
      id: "arnold-press",
      name: "Arnold Press",
      primaryMuscles: ["Side Delts"],
      secondaryMuscles: ["Front Delts", "Triceps"],
    });

    const overheadProfile = resolveStimulusProfile(overheadPress);
    const arnoldProfile = resolveStimulusProfile(arnold);

    expect(overheadProfile).toEqual({
      side_delts: 1,
      front_delts: 0.7,
      triceps: 0.5,
    });
    expect((overheadProfile.side_delts ?? 0)).toBeGreaterThan(overheadProfile.front_delts ?? 0);
    expect((overheadProfile.front_delts ?? 0)).toBeGreaterThan(overheadProfile.triceps ?? 0);

    expect(arnoldProfile).toEqual({
      side_delts: 1,
      front_delts: 0.75,
      triceps: 0.35,
    });
    expect((arnoldProfile.side_delts ?? 0)).toBeGreaterThan(arnoldProfile.front_delts ?? 0);
  });

  it("caps carry upper-back hypertrophy credit below direct carry/grip drivers", () => {
    const carry = makeExercise({
      id: "farmers-carry",
      name: "Farmer's Carry",
      primaryMuscles: ["Forearms", "Upper Back"],
      secondaryMuscles: ["Core"],
    });
    const profile = resolveStimulusProfile(carry);

    expect(profile.upper_back ?? 0).toBeLessThanOrEqual(0.5);
    expect(profile.forearms ?? 0).toBeGreaterThanOrEqual(profile.upper_back ?? 0);
  });
});
