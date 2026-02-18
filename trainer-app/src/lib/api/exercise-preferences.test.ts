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
  it("detects favorite by ID", () => {
    const result = resolveExercisePreferenceState(
      { favoriteExerciseIds: ["ex-1"] },
      EXERCISE
    );
    expect(result.isFavorite).toBe(true);
    expect(result.isAvoided).toBe(false);
  });

  it("detects avoid by ID", () => {
    const result = resolveExercisePreferenceState(
      { avoidExerciseIds: ["ex-1"] },
      EXERCISE
    );
    expect(result.isFavorite).toBe(false);
    expect(result.isAvoided).toBe(true);
  });

  it("returns false for unrecognized exercise", () => {
    const result = resolveExercisePreferenceState(
      { favoriteExerciseIds: ["other-id"] },
      EXERCISE
    );
    expect(result.isFavorite).toBe(false);
    expect(result.isAvoided).toBe(false);
  });
});

describe("computeExercisePreferenceToggle", () => {
  it("adds favorite by ID and removes avoid entry", () => {
    const result = computeExercisePreferenceToggle(
      { avoidExerciseIds: ["ex-1"] },
      EXERCISE,
      "favorite"
    );

    expect(result.favoriteExerciseIds).toContain("ex-1");
    expect(result.avoidExerciseIds).not.toContain("ex-1");
    expect(result.state).toEqual({ isFavorite: true, isAvoided: false });
  });

  it("toggles favorite off cleanly", () => {
    const result = computeExercisePreferenceToggle(
      { favoriteExerciseIds: ["ex-1"] },
      EXERCISE,
      "favorite"
    );

    expect(result.favoriteExerciseIds).not.toContain("ex-1");
    expect(result.state).toEqual({ isFavorite: false, isAvoided: false });
  });

  it("adds avoid by ID and removes favorite entry", () => {
    const result = computeExercisePreferenceToggle(
      { favoriteExerciseIds: ["ex-1"] },
      EXERCISE,
      "avoid"
    );

    expect(result.avoidExerciseIds).toContain("ex-1");
    expect(result.favoriteExerciseIds).not.toContain("ex-1");
    expect(result.state).toEqual({ isFavorite: false, isAvoided: true });
  });

  it("toggles avoid off cleanly", () => {
    const result = computeExercisePreferenceToggle(
      { avoidExerciseIds: ["ex-1"] },
      EXERCISE,
      "avoid"
    );

    expect(result.avoidExerciseIds).not.toContain("ex-1");
    expect(result.state).toEqual({ isFavorite: false, isAvoided: false });
  });
});
