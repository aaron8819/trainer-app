import { describe, it, expect } from "vitest";
import { filterExercises, sortExercises } from "./filtering";
import type { ExerciseListItem } from "./types";

function makeExercise(overrides: Partial<ExerciseListItem> = {}): ExerciseListItem {
  return {
    id: "ex-1",
    name: "Barbell Bench Press",
    isCompound: true,
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    equipment: ["barbell", "bench"],
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps", "Front Delts"],
    fatigueCost: 3,
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
    movementPatterns: ["horizontal_push"],
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
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    equipment: ["cable"],
    primaryMuscles: ["Side Delts"],
    secondaryMuscles: [],
  }),
  makeExercise({
    id: "3",
    name: "Barbell Back Squat",
    isCompound: true,
    movementPatterns: ["squat"],
    splitTags: ["legs"],
    equipment: ["barbell", "rack"],
    primaryMuscles: ["Quads", "Glutes"],
    secondaryMuscles: ["Core", "Hamstrings"],
  }),
  makeExercise({
    id: "4",
    name: "Dumbbell Bicep Curl",
    isCompound: false,
    movementPatterns: ["flexion"],
    splitTags: ["pull"],
    equipment: ["dumbbell"],
    primaryMuscles: ["Biceps"],
    secondaryMuscles: ["Forearms"],
  }),
  makeExercise({
    id: "5",
    name: "Pull-Up",
    isCompound: true,
    movementPatterns: ["vertical_pull"],
    splitTags: ["pull"],
    equipment: ["bodyweight"],
    primaryMuscles: ["Lats", "Upper Back"],
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

  it("sorts by sfrScore ascending", () => {
    const items = [
      makeExercise({ id: "a", name: "A", sfrScore: 5 }),
      makeExercise({ id: "b", name: "B", sfrScore: 2 }),
      makeExercise({ id: "c", name: "C", sfrScore: 4 }),
    ];
    const result = sortExercises(items, { field: "sfrScore", direction: "asc" });
    expect(result.map((e) => e.sfrScore)).toEqual([2, 4, 5]);
  });

  it("sorts by lengthPositionScore descending", () => {
    const items = [
      makeExercise({ id: "a", name: "A", lengthPositionScore: 2 }),
      makeExercise({ id: "b", name: "B", lengthPositionScore: 5 }),
      makeExercise({ id: "c", name: "C", lengthPositionScore: 3 }),
    ];
    const result = sortExercises(items, { field: "lengthPositionScore", direction: "desc" });
    expect(result.map((e) => e.lengthPositionScore)).toEqual([5, 3, 2]);
  });

  it("sorts by muscleGroup (first primary muscle)", () => {
    const items = [
      makeExercise({ id: "a", name: "A", primaryMuscles: ["Triceps"] }),
      makeExercise({ id: "b", name: "B", primaryMuscles: ["Biceps"] }),
      makeExercise({ id: "c", name: "C", primaryMuscles: ["Chest"] }),
    ];
    const result = sortExercises(items, { field: "muscleGroup", direction: "asc" });
    expect(result.map((e) => e.primaryMuscles[0])).toEqual(["Biceps", "Chest", "Triceps"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Comprehensive tests with a realistic full library (reflecting corrected seed)
// ═══════════════════════════════════════════════════════════════════════════

/** Build a realistic library matching the corrected seed data */
const fullLibrary: ExerciseListItem[] = [
  // ── Legs ───────────────────────────────────────────────────────────────
  makeExercise({ id: "l1", name: "Barbell Back Squat", isCompound: true, movementPatterns: ["squat"], splitTags: ["legs"], equipment: ["barbell", "rack"], primaryMuscles: ["Quads", "Glutes"], secondaryMuscles: ["Hamstrings", "Core", "Calves", "Lower Back", "Adductors"] }),
  makeExercise({ id: "l2", name: "Front Squat", isCompound: true, movementPatterns: ["squat"], splitTags: ["legs"], equipment: ["barbell", "rack"], primaryMuscles: ["Quads"], secondaryMuscles: ["Glutes", "Hamstrings", "Core", "Lower Back", "Upper Back"] }),
  makeExercise({ id: "l3", name: "Hack Squat", isCompound: true, movementPatterns: ["squat"], splitTags: ["legs"], equipment: ["machine"], primaryMuscles: ["Quads"], secondaryMuscles: ["Glutes"] }),
  makeExercise({ id: "l4", name: "Leg Press", isCompound: true, movementPatterns: ["squat"], splitTags: ["legs"], equipment: ["machine"], primaryMuscles: ["Quads"], secondaryMuscles: ["Glutes", "Hamstrings", "Adductors"] }),
  makeExercise({ id: "l5", name: "Leg Extension", isCompound: false, movementPatterns: ["extension"], splitTags: ["legs"], equipment: ["machine"], primaryMuscles: ["Quads"], secondaryMuscles: [] }),
  makeExercise({ id: "l6", name: "Romanian Deadlift", isCompound: true, movementPatterns: ["hinge"], splitTags: ["legs"], equipment: ["barbell"], primaryMuscles: ["Hamstrings", "Glutes"], secondaryMuscles: ["Lower Back", "Core"] }),
  makeExercise({ id: "l7", name: "Conventional Deadlift", isCompound: true, movementPatterns: ["hinge"], splitTags: ["legs"], equipment: ["barbell"], primaryMuscles: ["Hamstrings", "Glutes", "Lower Back"], secondaryMuscles: ["Quads", "Upper Back", "Core", "Forearms"] }),
  makeExercise({ id: "l8", name: "Hip Thrust", isCompound: true, movementPatterns: ["hinge"], splitTags: ["legs"], equipment: ["barbell", "bench"], primaryMuscles: ["Glutes"], secondaryMuscles: ["Hamstrings", "Core", "Adductors"] }),
  makeExercise({ id: "l9", name: "Leg Curl", isCompound: false, movementPatterns: ["flexion"], splitTags: ["legs"], equipment: ["machine"], primaryMuscles: ["Hamstrings"], secondaryMuscles: [] }),
  makeExercise({ id: "l10", name: "Hip Abduction Machine", isCompound: false, movementPatterns: ["hinge"], splitTags: ["legs"], equipment: ["machine"], primaryMuscles: ["Glutes"], secondaryMuscles: [] }),
  makeExercise({ id: "l11", name: "Walking Lunge", isCompound: true, movementPatterns: ["lunge"], splitTags: ["legs"], equipment: ["dumbbell"], primaryMuscles: ["Quads", "Glutes"], secondaryMuscles: ["Hamstrings", "Core", "Abductors", "Adductors"] }),
  makeExercise({ id: "l12", name: "Bulgarian Split Squat", isCompound: true, movementPatterns: ["lunge"], splitTags: ["legs"], equipment: ["dumbbell", "bench"], primaryMuscles: ["Quads", "Glutes"], secondaryMuscles: ["Hamstrings", "Core", "Abductors", "Adductors"] }),
  makeExercise({ id: "l13", name: "Standing Calf Raise", isCompound: false, movementPatterns: ["extension"], splitTags: ["legs"], equipment: ["machine"], primaryMuscles: ["Calves"], secondaryMuscles: [] }),
  makeExercise({ id: "l14", name: "Seated Calf Raise", isCompound: false, movementPatterns: ["extension"], splitTags: ["legs"], equipment: ["machine"], primaryMuscles: ["Calves"], secondaryMuscles: [] }),
  makeExercise({ id: "l15", name: "Glute Bridge", isCompound: true, movementPatterns: ["hinge"], splitTags: ["legs"], equipment: ["bodyweight"], primaryMuscles: ["Glutes"], secondaryMuscles: ["Hamstrings", "Core"] }),

  // ── Push ───────────────────────────────────────────────────────────────
  makeExercise({ id: "p1", name: "Barbell Bench Press", isCompound: true, movementPatterns: ["horizontal_push"], splitTags: ["push"], equipment: ["barbell", "bench", "rack"], primaryMuscles: ["Chest"], secondaryMuscles: ["Triceps", "Front Delts"] }),
  makeExercise({ id: "p2", name: "Incline Barbell Bench", isCompound: true, movementPatterns: ["horizontal_push"], splitTags: ["push"], equipment: ["barbell", "bench"], primaryMuscles: ["Chest", "Front Delts"], secondaryMuscles: ["Triceps"] }),
  makeExercise({ id: "p3", name: "Dumbbell Bench Press", isCompound: true, movementPatterns: ["horizontal_push"], splitTags: ["push"], equipment: ["dumbbell", "bench"], primaryMuscles: ["Chest"], secondaryMuscles: ["Triceps", "Front Delts"] }),
  makeExercise({ id: "p4", name: "Push-Up", isCompound: true, movementPatterns: ["horizontal_push"], splitTags: ["push"], equipment: ["bodyweight"], primaryMuscles: ["Chest"], secondaryMuscles: ["Triceps", "Front Delts", "Core"] }),
  makeExercise({ id: "p5", name: "Cable Fly", isCompound: false, movementPatterns: ["horizontal_push"], splitTags: ["push"], equipment: ["cable"], primaryMuscles: ["Chest"], secondaryMuscles: ["Front Delts"] }),
  makeExercise({ id: "p6", name: "Pec Deck", isCompound: false, movementPatterns: ["horizontal_push"], splitTags: ["push"], equipment: ["machine"], primaryMuscles: ["Chest"], secondaryMuscles: ["Front Delts"] }),
  makeExercise({ id: "p7", name: "Overhead Press", isCompound: true, movementPatterns: ["vertical_push"], splitTags: ["push"], equipment: ["barbell"], primaryMuscles: ["Front Delts"], secondaryMuscles: ["Triceps", "Side Delts", "Upper Back", "Core"] }),
  makeExercise({ id: "p8", name: "Dumbbell Shoulder Press", isCompound: true, movementPatterns: ["vertical_push"], splitTags: ["push"], equipment: ["dumbbell", "bench"], primaryMuscles: ["Front Delts"], secondaryMuscles: ["Triceps", "Side Delts"] }),
  makeExercise({ id: "p9", name: "Machine Shoulder Press", isCompound: true, movementPatterns: ["vertical_push"], splitTags: ["push"], equipment: ["machine"], primaryMuscles: ["Front Delts"], secondaryMuscles: ["Triceps", "Side Delts"] }),
  makeExercise({ id: "p10", name: "Lateral Raise", isCompound: false, movementPatterns: ["horizontal_push"], splitTags: ["push"], equipment: ["dumbbell"], primaryMuscles: ["Side Delts"], secondaryMuscles: [] }),
  makeExercise({ id: "p11", name: "Cable Lateral Raise", isCompound: false, movementPatterns: ["horizontal_push"], splitTags: ["push"], equipment: ["cable"], primaryMuscles: ["Side Delts"], secondaryMuscles: [] }),
  makeExercise({ id: "p12", name: "Triceps Pushdown", isCompound: false, movementPatterns: ["extension"], splitTags: ["push"], equipment: ["cable"], primaryMuscles: ["Triceps"], secondaryMuscles: [] }),
  makeExercise({ id: "p13", name: "Skull Crusher", isCompound: false, movementPatterns: ["extension"], splitTags: ["push"], equipment: ["barbell", "bench"], primaryMuscles: ["Triceps"], secondaryMuscles: [] }),
  makeExercise({ id: "p14", name: "Dips", isCompound: true, movementPatterns: ["horizontal_push"], splitTags: ["push"], equipment: ["bodyweight"], primaryMuscles: ["Chest", "Triceps"], secondaryMuscles: ["Front Delts"] }),
  makeExercise({ id: "p15", name: "Overhead Triceps Extension", isCompound: false, movementPatterns: ["extension"], splitTags: ["push"], equipment: ["dumbbell"], primaryMuscles: ["Triceps"], secondaryMuscles: [] }),

  // ── Pull ───────────────────────────────────────────────────────────────
  makeExercise({ id: "r1", name: "Pull-Up", isCompound: true, movementPatterns: ["vertical_pull"], splitTags: ["pull"], equipment: ["bodyweight"], primaryMuscles: ["Lats"], secondaryMuscles: ["Biceps", "Forearms", "Core"] }),
  makeExercise({ id: "r2", name: "Lat Pulldown", isCompound: true, movementPatterns: ["vertical_pull"], splitTags: ["pull"], equipment: ["cable", "machine"], primaryMuscles: ["Lats"], secondaryMuscles: ["Biceps", "Forearms"] }),
  makeExercise({ id: "r3", name: "Barbell Row", isCompound: true, movementPatterns: ["horizontal_pull"], splitTags: ["pull"], equipment: ["barbell"], primaryMuscles: ["Lats", "Upper Back"], secondaryMuscles: ["Biceps", "Rear Delts", "Lower Back", "Forearms"] }),
  makeExercise({ id: "r4", name: "Seated Cable Row", isCompound: true, movementPatterns: ["horizontal_pull"], splitTags: ["pull"], equipment: ["cable"], primaryMuscles: ["Lats"], secondaryMuscles: ["Upper Back", "Biceps", "Rear Delts"] }),
  makeExercise({ id: "r5", name: "T-Bar Row", isCompound: true, movementPatterns: ["horizontal_pull"], splitTags: ["pull"], equipment: ["machine"], primaryMuscles: ["Lats", "Upper Back"], secondaryMuscles: ["Biceps", "Rear Delts", "Lower Back"] }),
  makeExercise({ id: "r6", name: "Face Pull", isCompound: true, movementPatterns: ["horizontal_pull"], splitTags: ["pull"], equipment: ["cable"], primaryMuscles: ["Rear Delts", "Upper Back"], secondaryMuscles: ["Side Delts"] }),
  makeExercise({ id: "r7", name: "Machine Rear Delt Fly", isCompound: false, movementPatterns: ["horizontal_pull"], splitTags: ["pull"], equipment: ["machine"], primaryMuscles: ["Rear Delts", "Upper Back"], secondaryMuscles: [] }),
  makeExercise({ id: "r8", name: "Reverse Fly", isCompound: false, movementPatterns: ["horizontal_pull"], splitTags: ["pull"], equipment: ["dumbbell"], primaryMuscles: ["Rear Delts", "Upper Back"], secondaryMuscles: [] }),
  makeExercise({ id: "r9", name: "Dumbbell Curl", isCompound: false, movementPatterns: ["flexion"], splitTags: ["pull"], equipment: ["dumbbell"], primaryMuscles: ["Biceps"], secondaryMuscles: ["Forearms"] }),
  makeExercise({ id: "r10", name: "Barbell Curl", isCompound: false, movementPatterns: ["flexion"], splitTags: ["pull"], equipment: ["barbell"], primaryMuscles: ["Biceps"], secondaryMuscles: ["Forearms"] }),
  makeExercise({ id: "r11", name: "Hammer Curl", isCompound: false, movementPatterns: ["flexion"], splitTags: ["pull"], equipment: ["dumbbell"], primaryMuscles: ["Biceps", "Forearms"], secondaryMuscles: [] }),
  makeExercise({ id: "r12", name: "Bayesian Curl", isCompound: false, movementPatterns: ["flexion"], splitTags: ["pull"], equipment: ["cable"], primaryMuscles: ["Biceps"], secondaryMuscles: [] }),

  // ── Core ───────────────────────────────────────────────────────────────
  makeExercise({ id: "c1", name: "Plank", isCompound: false, movementPatterns: ["anti_rotation"], splitTags: ["core"], equipment: ["bodyweight"], primaryMuscles: ["Core"], secondaryMuscles: ["Front Delts"] }),
  makeExercise({ id: "c2", name: "Cable Crunch", isCompound: false, movementPatterns: ["flexion"], splitTags: ["core"], equipment: ["cable"], primaryMuscles: ["Core"], secondaryMuscles: [] }),
  makeExercise({ id: "c3", name: "Pallof Press", isCompound: false, movementPatterns: ["anti_rotation"], splitTags: ["core"], equipment: ["cable"], primaryMuscles: ["Core"], secondaryMuscles: ["Front Delts"] }),

  // ── Conditioning ───────────────────────────────────────────────────────
  makeExercise({ id: "d1", name: "Farmer's Carry", isCompound: true, movementPatterns: ["carry"], splitTags: ["conditioning"], equipment: ["dumbbell"], primaryMuscles: ["Forearms", "Core"], secondaryMuscles: ["Upper Back", "Side Delts"] }),
];

describe("filterExercises — comprehensive", () => {
  // ── Muscle Group Filters ─────────────────────────────────────────────

  it("muscleGroup=chest finds exercises with Chest primary/secondary", () => {
    const result = filterExercises(fullLibrary, { muscleGroup: "chest" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Barbell Bench Press");
    expect(names).toContain("Cable Fly");
    expect(names).toContain("Pec Deck");
    expect(names).toContain("Dips");
    expect(names.length).toBeGreaterThanOrEqual(6);
  });

  it("muscleGroup=shoulders finds front delts, side delts, rear delts", () => {
    const result = filterExercises(fullLibrary, { muscleGroup: "shoulders" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Overhead Press");
    expect(names).toContain("Lateral Raise");
    expect(names).toContain("Cable Lateral Raise");
    expect(names).toContain("Face Pull");
    expect(names).toContain("Reverse Fly");
    expect(names).toContain("Machine Rear Delt Fly");
    expect(names.length).toBeGreaterThanOrEqual(6);
  });

  it("muscleGroup=arms finds biceps, triceps, forearms", () => {
    const result = filterExercises(fullLibrary, { muscleGroup: "arms" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Dumbbell Curl");
    expect(names).toContain("Barbell Curl");
    expect(names).toContain("Hammer Curl");
    expect(names).toContain("Triceps Pushdown");
    expect(names).toContain("Skull Crusher");
    expect(names).toContain("Overhead Triceps Extension");
    expect(names.length).toBeGreaterThanOrEqual(6);
  });

  it("muscleGroup=legs finds quads, hamstrings, glutes, calves, etc.", () => {
    const result = filterExercises(fullLibrary, { muscleGroup: "legs" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Barbell Back Squat");
    expect(names).toContain("Leg Extension");
    expect(names).toContain("Leg Curl");
    expect(names).toContain("Standing Calf Raise");
    expect(names).toContain("Romanian Deadlift");
    expect(names).toContain("Hip Thrust");
    expect(names).toContain("Walking Lunge");
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  it("muscleGroup=back finds back, upper back, lower back", () => {
    const result = filterExercises(fullLibrary, { muscleGroup: "back" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Pull-Up");
    expect(names).toContain("Lat Pulldown");
    expect(names).toContain("Barbell Row");
    expect(names).toContain("T-Bar Row");
    expect(names).toContain("Face Pull");
    expect(names.length).toBeGreaterThanOrEqual(5);
  });

  it("muscleGroup=core finds core exercises", () => {
    const result = filterExercises(fullLibrary, { muscleGroup: "core" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Plank");
    expect(names).toContain("Cable Crunch");
    expect(names).toContain("Pallof Press");
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  // ── Movement Pattern Filters ─────────────────────────────────────────

  it("movementPattern=horizontal_push finds bench, flies, laterals, dips", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "horizontal_push" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Barbell Bench Press");
    expect(names).toContain("Cable Fly");
    expect(names).toContain("Pec Deck");
    expect(names).toContain("Lateral Raise");
    expect(names).toContain("Dips");
    // Curls should NOT be here
    expect(names).not.toContain("Dumbbell Curl");
    expect(names).not.toContain("Barbell Curl");
  });

  it("movementPattern=vertical_push finds OHP and shoulder presses", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "vertical_push" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Overhead Press");
    expect(names).toContain("Dumbbell Shoulder Press");
    expect(names).toContain("Machine Shoulder Press");
    expect(names).toHaveLength(3);
  });

  it("movementPattern=horizontal_pull finds rows, face pulls, rear delts", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "horizontal_pull" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Barbell Row");
    expect(names).toContain("Seated Cable Row");
    expect(names).toContain("T-Bar Row");
    expect(names).toContain("Face Pull");
    expect(names).toContain("Machine Rear Delt Fly");
    expect(names).toContain("Reverse Fly");
    // Curls should NOT be here
    expect(names).not.toContain("Dumbbell Curl");
  });

  it("movementPattern=vertical_pull finds pull-ups and pulldowns", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "vertical_pull" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Pull-Up");
    expect(names).toContain("Lat Pulldown");
    expect(names).toHaveLength(2);
  });

  it("movementPattern=flexion finds curls and leg curl", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "flexion" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Dumbbell Curl");
    expect(names).toContain("Barbell Curl");
    expect(names).toContain("Hammer Curl");
    expect(names).toContain("Bayesian Curl");
    expect(names).toContain("Leg Curl");
    expect(names).toContain("Cable Crunch");
  });

  it("movementPattern=extension finds triceps isolation, leg extension, calves", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "extension" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Triceps Pushdown");
    expect(names).toContain("Skull Crusher");
    expect(names).toContain("Overhead Triceps Extension");
    expect(names).toContain("Leg Extension");
    expect(names).toContain("Standing Calf Raise");
    expect(names).toContain("Seated Calf Raise");
  });

  it("movementPattern=squat finds squat-pattern exercises", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "squat" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Barbell Back Squat");
    expect(names).toContain("Front Squat");
    expect(names).toContain("Hack Squat");
    expect(names).toContain("Leg Press");
    // Leg Extension should NOT be here (it's extension now)
    expect(names).not.toContain("Leg Extension");
  });

  it("movementPattern=hinge finds deadlifts, hip thrusts, etc.", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "hinge" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Romanian Deadlift");
    expect(names).toContain("Conventional Deadlift");
    expect(names).toContain("Hip Thrust");
    expect(names).toContain("Hip Abduction Machine");
    expect(names).toContain("Glute Bridge");
  });

  it("movementPattern=lunge finds lunges and split squats", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "lunge" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Walking Lunge");
    expect(names).toContain("Bulgarian Split Squat");
  });

  it("movementPattern=carry finds farmer carry and sled work (if present)", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "carry" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Farmer's Carry");
  });

  it("movementPattern=anti_rotation finds plank, pallof press", () => {
    const result = filterExercises(fullLibrary, { movementPattern: "anti_rotation" });
    const names = result.map((e) => e.name);
    expect(names).toContain("Plank");
    expect(names).toContain("Pallof Press");
  });

  // ── Compound / Isolation Filters ─────────────────────────────────────

  it("isCompound=true finds multi-joint exercises", () => {
    const result = filterExercises(fullLibrary, { isCompound: true });
    const names = result.map((e) => e.name);
    expect(names).toContain("Barbell Back Squat");
    expect(names).toContain("Barbell Bench Press");
    expect(names).toContain("Pull-Up");
    expect(names).toContain("Overhead Press");
    expect(names).toContain("Face Pull");
    expect(names).toContain("Dips");
    // Isolation exercises should NOT be here
    expect(names).not.toContain("Dumbbell Curl");
    expect(names).not.toContain("Leg Extension");
    expect(names).not.toContain("Standing Calf Raise");
  });

  it("isCompound=false finds isolation exercises", () => {
    const result = filterExercises(fullLibrary, { isCompound: false });
    const names = result.map((e) => e.name);
    expect(names).toContain("Leg Extension");
    expect(names).toContain("Leg Curl");
    expect(names).toContain("Standing Calf Raise");
    expect(names).toContain("Cable Fly");
    expect(names).toContain("Lateral Raise");
    expect(names).toContain("Triceps Pushdown");
    expect(names).toContain("Skull Crusher");
    expect(names).toContain("Dumbbell Curl");
    expect(names).toContain("Bayesian Curl");
    expect(names).toContain("Plank");
    // Compound exercises should NOT be here
    expect(names).not.toContain("Barbell Back Squat");
    expect(names).not.toContain("Barbell Bench Press");
  });

  // ── Combined Filters ─────────────────────────────────────────────────

  it("shoulders + compound finds presses but not lateral raises", () => {
    const result = filterExercises(fullLibrary, {
      muscleGroup: "shoulders",
      isCompound: true,
    });
    const names = result.map((e) => e.name);
    expect(names).toContain("Overhead Press");
    expect(names).toContain("Dumbbell Shoulder Press");
    expect(names).toContain("Face Pull");
    expect(names).not.toContain("Lateral Raise");
    expect(names).not.toContain("Cable Lateral Raise");
  });

  it("legs + isolation finds leg extension, leg curl, calf raises", () => {
    const result = filterExercises(fullLibrary, {
      muscleGroup: "legs",
      isCompound: false,
    });
    const names = result.map((e) => e.name);
    expect(names).toContain("Leg Extension");
    expect(names).toContain("Leg Curl");
    expect(names).toContain("Standing Calf Raise");
    expect(names).toContain("Seated Calf Raise");
    expect(names).toContain("Hip Abduction Machine");
    expect(names).not.toContain("Barbell Back Squat");
    expect(names).not.toContain("Romanian Deadlift");
  });

  it("arms + flexion finds only curls", () => {
    const result = filterExercises(fullLibrary, {
      muscleGroup: "arms",
      movementPattern: "flexion",
    });
    const names = result.map((e) => e.name);
    expect(names).toContain("Dumbbell Curl");
    expect(names).toContain("Barbell Curl");
    expect(names).toContain("Hammer Curl");
    expect(names).toContain("Bayesian Curl");
    expect(names).not.toContain("Triceps Pushdown");
    expect(names).not.toContain("Leg Curl");
  });

  it("push + extension finds triceps isolation only", () => {
    const result = filterExercises(fullLibrary, {
      splitTag: "push",
      movementPattern: "extension",
    });
    const names = result.map((e) => e.name);
    expect(names).toContain("Triceps Pushdown");
    expect(names).toContain("Skull Crusher");
    expect(names).toContain("Overhead Triceps Extension");
    expect(names).not.toContain("Standing Calf Raise");
    expect(names).not.toContain("Leg Extension");
  });

  it("pull + compound finds rows and pulldowns but not curls", () => {
    const result = filterExercises(fullLibrary, {
      splitTag: "pull",
      isCompound: true,
    });
    const names = result.map((e) => e.name);
    expect(names).toContain("Pull-Up");
    expect(names).toContain("Barbell Row");
    expect(names).toContain("Face Pull");
    expect(names).not.toContain("Dumbbell Curl");
    expect(names).not.toContain("Barbell Curl");
  });
});
