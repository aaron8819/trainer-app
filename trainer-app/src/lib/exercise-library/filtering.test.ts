import { describe, it, expect } from "vitest";
import { filterExercises, sortExercises } from "./filtering";
import type { ExerciseListItem } from "./types";

function makeExercise(overrides: Partial<ExerciseListItem> = {}): ExerciseListItem {
  return {
    id: "ex-1",
    name: "Barbell Bench Press",
    isCompound: true,
    movementPatternsV2: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    equipment: ["barbell", "bench"],
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps", "Front Delts"],
    sfrScore: 3,
    lengthPositionScore: 3,
    isFavorite: false,
    isAvoided: false,
    ...overrides,
  };
}

const library: ExerciseListItem[] = [
  makeExercise({
    id: "1",
    name: "Barbell Bench Press",
    isCompound: true,
    movementPatternsV2: ["horizontal_push"],
    splitTags: ["push"],
    equipment: ["barbell", "bench"],
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps", "Front Delts"],
    isFavorite: true,
  }),
  makeExercise({
    id: "2",
    name: "Cable Lateral Raise",
    isCompound: false,
    movementPatternsV2: [],
    splitTags: ["push"],
    equipment: ["cable"],
    primaryMuscles: ["Side Delts"],
    secondaryMuscles: [],
  }),
  makeExercise({
    id: "3",
    name: "Barbell Back Squat",
    isCompound: true,
    movementPatternsV2: ["squat"],
    splitTags: ["legs"],
    equipment: ["barbell", "rack"],
    primaryMuscles: ["Quads", "Glutes"],
    secondaryMuscles: ["Core", "Hamstrings"],
  }),
  makeExercise({
    id: "4",
    name: "Dumbbell Bicep Curl",
    isCompound: false,
    movementPatternsV2: ["flexion"],
    splitTags: ["pull"],
    equipment: ["dumbbell"],
    primaryMuscles: ["Biceps"],
    secondaryMuscles: ["Forearms"],
  }),
  makeExercise({
    id: "5",
    name: "Pull-Up",
    isCompound: true,
    movementPatternsV2: ["vertical_pull"],
    splitTags: ["pull"],
    equipment: ["bodyweight"],
    primaryMuscles: ["Back", "Upper Back"],
    secondaryMuscles: ["Biceps", "Rear Delts"],
    isAvoided: true,
  }),
];

describe("filterExercises", () => {
  it("returns all exercises with empty filters", () => {
    expect(filterExercises(library, {})).toHaveLength(5);
  });

  it("filters by search text (case-insensitive)", () => {
    const result = filterExercises(library, { search: "barbell" });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.name)).toEqual([
      "Barbell Bench Press",
      "Barbell Back Squat",
    ]);
  });

  it("filters by search with partial match", () => {
    const result = filterExercises(library, { search: "curl" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Dumbbell Bicep Curl");
  });

  it("filters by muscle group", () => {
    const result = filterExercises(library, { muscleGroup: "back" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Pull-Up");
  });

  it("filters by muscle group — legs finds quads, glutes, etc.", () => {
    const result = filterExercises(library, { muscleGroup: "legs" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Barbell Back Squat");
  });

  it("filters by specific muscle", () => {
    const result = filterExercises(library, { muscle: "Triceps" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Barbell Bench Press");
  });

  it("muscle filter overrides muscleGroup filter", () => {
    const result = filterExercises(library, {
      muscleGroup: "arms",
      muscle: "Biceps",
    });
    // Should match Dumbbell Bicep Curl (primary) and Pull-Up (secondary)
    expect(result).toHaveLength(2);
  });

  it("filters by isCompound = true", () => {
    const result = filterExercises(library, { isCompound: true });
    expect(result).toHaveLength(3);
  });

  it("filters by isCompound = false", () => {
    const result = filterExercises(library, { isCompound: false });
    expect(result).toHaveLength(2);
  });

  it("filters by movement pattern", () => {
    const result = filterExercises(library, { movementPattern: "squat" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Barbell Back Squat");
  });

  it("filters by equipment", () => {
    const result = filterExercises(library, { equipment: "cable" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Cable Lateral Raise");
  });

  it("filters by split tag", () => {
    const result = filterExercises(library, { splitTag: "pull" });
    expect(result).toHaveLength(2);
  });

  it("filters by favorites only", () => {
    const result = filterExercises(library, { favoritesOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Barbell Bench Press");
  });

  it("combines multiple filters with AND logic", () => {
    const result = filterExercises(library, {
      isCompound: true,
      splitTag: "push",
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Barbell Bench Press");
  });

  it("returns empty array when no matches", () => {
    const result = filterExercises(library, { search: "zzz_nonexistent" });
    expect(result).toHaveLength(0);
  });

  it("handles search + muscleGroup together", () => {
    const result = filterExercises(library, {
      search: "barbell",
      muscleGroup: "chest",
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Barbell Bench Press");
  });
});

describe("sortExercises", () => {
  it("sorts by name ascending", () => {
    const result = sortExercises(library, { field: "name", direction: "asc" });
    expect(result.map((e) => e.name)).toEqual([
      "Barbell Back Squat",
      "Barbell Bench Press",
      "Cable Lateral Raise",
      "Dumbbell Bicep Curl",
      "Pull-Up",
    ]);
  });

  it("sorts by name descending", () => {
    const result = sortExercises(library, { field: "name", direction: "desc" });
    expect(result.map((e) => e.name)).toEqual([
      "Pull-Up",
      "Dumbbell Bicep Curl",
      "Cable Lateral Raise",
      "Barbell Bench Press",
      "Barbell Back Squat",
    ]);
  });

  it("does not mutate the original array", () => {
    const original = [...library];
    sortExercises(library, { field: "name", direction: "asc" });
    expect(library.map((e) => e.id)).toEqual(original.map((e) => e.id));
  });
});
