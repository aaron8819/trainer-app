import { describe, expect, it } from "vitest";
import {
  computeExercisePreferenceToggle,
  resolveExercisePreferenceState,
} from "./exercise-preferences";

const EXERCISE = {
  id: "ex-1",
  name: "Barbell Bench Press",
};

describe("resolveExercisePreferenceState", () => {
  it("matches by ID or name for backward compatibility", () => {
    const byName = resolveExercisePreferenceState(
      {
        favoriteExercises: ["Barbell Bench Press"],
      },
      EXERCISE
    );
    expect(byName.isFavorite).toBe(true);
    expect(byName.isAvoided).toBe(false);

    const byId = resolveExercisePreferenceState(
      {
        avoidExerciseIds: ["ex-1"],
      },
      EXERCISE
    );
    expect(byId.isFavorite).toBe(false);
    expect(byId.isAvoided).toBe(true);
  });
});

describe("computeExercisePreferenceToggle", () => {
  it("adds favorite by both id and name, and removes avoid entries", () => {
    const result = computeExercisePreferenceToggle(
      {
        avoidExercises: ["Barbell Bench Press"],
        avoidExerciseIds: ["ex-1"],
      },
      EXERCISE,
      "favorite"
    );

    expect(result.favoriteExercises).toContain("Barbell Bench Press");
    expect(result.favoriteExerciseIds).toContain("ex-1");
    expect(result.avoidExercises).not.toContain("Barbell Bench Press");
    expect(result.avoidExerciseIds).not.toContain("ex-1");
    expect(result.state).toEqual({ isFavorite: true, isAvoided: false });
  });

  it("toggles favorite off cleanly", () => {
    const result = computeExercisePreferenceToggle(
      {
        favoriteExercises: ["Barbell Bench Press"],
        favoriteExerciseIds: ["ex-1"],
      },
      EXERCISE,
      "favorite"
    );

    expect(result.favoriteExercises).not.toContain("Barbell Bench Press");
    expect(result.favoriteExerciseIds).not.toContain("ex-1");
    expect(result.state).toEqual({ isFavorite: false, isAvoided: false });
  });

  it("adds avoid by both id and name, and removes favorite entries", () => {
    const result = computeExercisePreferenceToggle(
      {
        favoriteExercises: ["Barbell Bench Press"],
        favoriteExerciseIds: ["ex-1"],
      },
      EXERCISE,
      "avoid"
    );

    expect(result.avoidExercises).toContain("Barbell Bench Press");
    expect(result.avoidExerciseIds).toContain("ex-1");
    expect(result.favoriteExercises).not.toContain("Barbell Bench Press");
    expect(result.favoriteExerciseIds).not.toContain("ex-1");
    expect(result.state).toEqual({ isFavorite: false, isAvoided: true });
  });

  it("normalizes names when removing stale entries", () => {
    const result = computeExercisePreferenceToggle(
      {
        favoriteExercises: ["  barbell   bench  press "],
        favoriteExerciseIds: ["ex-1"],
      },
      EXERCISE,
      "favorite"
    );

    expect(result.favoriteExercises).toHaveLength(0);
    expect(result.favoriteExerciseIds).toHaveLength(0);
    expect(result.state).toEqual({ isFavorite: false, isAvoided: false });
  });
});
