import { describe, it, expect } from "vitest";
import {
  resolveTargetMuscles,
  filterPool,
  scoreExerciseForBuild,
  smartBuild,
  type SmartBuildExercise,
} from "./smart-build";

// --- Test helpers ---

function makeExercise(overrides: Partial<SmartBuildExercise> & { id: string }): SmartBuildExercise {
  return {
    name: overrides.id,
    isCompound: false,
    movementPatternsV2: [],
    splitTags: [],
    jointStress: "medium",
    equipment: ["barbell"],
    primaryMuscles: [],
    secondaryMuscles: [],
    isFavorite: false,
    isAvoided: false,
    ...overrides,
  };
}

/** Build a realistic pool from the sample-data exercises */
function buildTestPool(): SmartBuildExercise[] {
  return [
    makeExercise({
      id: "bench",
      name: "Barbell Bench Press",
      isCompound: true,
      movementPatternsV2: ["horizontal_push"],
      splitTags: ["push"],
      jointStress: "high",
      equipment: ["barbell", "bench", "rack"],
      primaryMuscles: ["Chest", "Triceps"],
      secondaryMuscles: ["Front Delts"],
    }),
    makeExercise({
      id: "row",
      name: "Barbell Row",
      isCompound: true,
      movementPatternsV2: ["horizontal_pull"],
      splitTags: ["pull"],
      equipment: ["barbell"],
      primaryMuscles: ["Back", "Upper Back"],
      secondaryMuscles: ["Biceps", "Rear Delts", "Forearms"],
    }),
    makeExercise({
      id: "squat",
      name: "Barbell Back Squat",
      isCompound: true,
      movementPatternsV2: ["squat"],
      splitTags: ["legs"],
      jointStress: "high",
      equipment: ["barbell", "rack"],
      primaryMuscles: ["Quads", "Glutes"],
      secondaryMuscles: ["Hamstrings", "Core", "Lower Back"],
    }),
    makeExercise({
      id: "rdl",
      name: "Romanian Deadlift",
      isCompound: true,
      movementPatternsV2: ["hinge"],
      splitTags: ["legs"],
      equipment: ["barbell"],
      primaryMuscles: ["Hamstrings", "Glutes"],
      secondaryMuscles: ["Lower Back", "Core"],
    }),
    makeExercise({
      id: "lat-pull",
      name: "Lat Pulldown",
      isCompound: true,
      movementPatternsV2: ["vertical_pull"],
      splitTags: ["pull"],
      equipment: ["cable", "machine"],
      primaryMuscles: ["Back"],
      secondaryMuscles: ["Biceps", "Forearms"],
    }),
    makeExercise({
      id: "db-press",
      name: "Dumbbell Bench Press",
      isCompound: true,
      movementPatternsV2: ["horizontal_push"],
      splitTags: ["push"],
      equipment: ["dumbbell", "bench"],
      primaryMuscles: ["Chest"],
      secondaryMuscles: ["Triceps", "Front Delts"],
    }),
    makeExercise({
      id: "split-squat",
      name: "Bulgarian Split Squat",
      isCompound: true,
      movementPatternsV2: ["lunge"],
      splitTags: ["legs"],
      equipment: ["dumbbell", "bench"],
      primaryMuscles: ["Quads", "Glutes"],
      secondaryMuscles: ["Hamstrings", "Core"],
    }),
    makeExercise({
      id: "leg-press",
      name: "Leg Press",
      isCompound: true,
      movementPatternsV2: ["squat"],
      splitTags: ["legs"],
      equipment: ["machine"],
      primaryMuscles: ["Quads"],
      secondaryMuscles: ["Glutes", "Hamstrings"],
    }),
    makeExercise({
      id: "face-pull",
      name: "Face Pull",
      isCompound: false,
      movementPatternsV2: ["horizontal_pull"],
      splitTags: ["pull"],
      jointStress: "low",
      equipment: ["cable"],
      primaryMuscles: ["Rear Delts", "Upper Back"],
      secondaryMuscles: ["Side Delts"],
    }),
    makeExercise({
      id: "lateral-raise",
      name: "Lateral Raise",
      isCompound: false,
      movementPatternsV2: ["vertical_push"],
      splitTags: ["push"],
      jointStress: "low",
      equipment: ["dumbbell"],
      primaryMuscles: ["Side Delts"],
    }),
    makeExercise({
      id: "curl",
      name: "Barbell Curl",
      isCompound: false,
      movementPatternsV2: ["flexion"],
      splitTags: ["pull"],
      jointStress: "low",
      equipment: ["barbell"],
      primaryMuscles: ["Biceps"],
      secondaryMuscles: ["Forearms"],
    }),
    makeExercise({
      id: "tricep-push",
      name: "Tricep Pushdown",
      isCompound: false,
      movementPatternsV2: ["extension"],
      splitTags: ["push"],
      jointStress: "low",
      equipment: ["cable"],
      primaryMuscles: ["Triceps"],
    }),
    makeExercise({
      id: "plank",
      name: "Plank",
      isCompound: false,
      movementPatternsV2: ["anti_rotation"],
      splitTags: ["core"],
      jointStress: "low",
      equipment: ["bodyweight"],
      primaryMuscles: ["Core"],
    }),
    makeExercise({
      id: "farmers-carry",
      name: "Farmer's Carry",
      isCompound: false,
      movementPatternsV2: ["carry"],
      splitTags: ["conditioning"],
      equipment: ["dumbbell"],
      primaryMuscles: ["Forearms", "Core"],
      secondaryMuscles: ["Upper Back"],
    }),
  ];
}

// --- Tests ---

describe("resolveTargetMuscles", () => {
  it("expands coarse groups to fine muscles", () => {
    const result = resolveTargetMuscles(["chest", "arms"]);
    expect(result).toContain("Chest");
    expect(result).toContain("Biceps");
    expect(result).toContain("Triceps");
    expect(result).toContain("Forearms");
  });

  it("deduplicates muscles across groups", () => {
    const result = resolveTargetMuscles(["chest", "chest"]);
    const chestCount = result.filter((m) => m === "Chest").length;
    expect(chestCount).toBe(1);
  });

  it("returns empty array for empty input", () => {
    expect(resolveTargetMuscles([])).toEqual([]);
  });

  it("returns empty for unknown group", () => {
    expect(resolveTargetMuscles(["unknown"])).toEqual([]);
  });

  it("expands legs to all leg muscles", () => {
    const result = resolveTargetMuscles(["legs"]);
    expect(result).toEqual(
      expect.arrayContaining(["Quads", "Hamstrings", "Glutes", "Adductors", "Calves", "Hip Flexors"])
    );
  });
});

describe("filterPool", () => {
  const pool = buildTestPool();
  const targetMuscles = resolveTargetMuscles(["chest", "back"]);

  it("removes avoided exercises", () => {
    const poolWithAvoided = [
      ...pool,
      makeExercise({ id: "avoided", isAvoided: true, primaryMuscles: ["Chest"] }),
    ];
    const result = filterPool(poolWithAvoided, targetMuscles);
    expect(result.find((e) => e.id === "avoided")).toBeUndefined();
  });

  it("removes blocked-tag exercises when muscles don't overlap targets", () => {
    const result = filterPool(pool, targetMuscles);
    // Plank (core tag, primary: Core) should be removed — Core is not in chest/back targets
    expect(result.find((e) => e.id === "plank")).toBeUndefined();
    // Farmer's carry (conditioning tag, primary: Forearms/Core) — neither in chest/back targets
    expect(result.find((e) => e.id === "farmers-carry")).toBeUndefined();
  });

  it("keeps blocked-tag exercises when primary muscles overlap targets", () => {
    // Target core — plank's primary "Core" overlaps
    const coreTargets = resolveTargetMuscles(["core"]);
    const result = filterPool(pool, coreTargets);
    expect(result.find((e) => e.id === "plank")).toBeDefined();
  });

  it("filters by available equipment", () => {
    const result = filterPool(pool, targetMuscles, ["dumbbell"]);
    // Barbell-only exercises should be removed
    expect(result.find((e) => e.id === "row")).toBeUndefined();
    // Dumbbell exercises should remain
    expect(result.find((e) => e.id === "lateral-raise")).toBeDefined();
  });

  it("returns all non-avoided when no equipment filter", () => {
    const allTargets = resolveTargetMuscles(["chest", "back", "shoulders", "arms", "legs", "core"]);
    const result = filterPool(pool, allTargets);
    expect(result.length).toBe(pool.length);
  });
});

describe("scoreExerciseForBuild", () => {
  const targetMuscles = new Set(["Chest", "Triceps", "Front Delts"]);
  const coveredMuscles = new Set<string>();
  const coveredPatterns = new Set<string>();

  it("scores based on primary and secondary muscle hits", () => {
    const bench = buildTestPool().find((e) => e.id === "bench")!;
    const score = scoreExerciseForBuild(bench, targetMuscles, coveredMuscles, coveredPatterns, true);
    // bench: primary Chest(+6) + Triceps(+6) + secondary Front Delts(+2) + uncovered bonus 0.5*2 = 15
    expect(score).toBeGreaterThan(0);
    expect(score).toBe(6 + 6 + 2 + 0.5 + 0.5);
  });

  it("gives favorites a higher score", () => {
    const bench = buildTestPool().find((e) => e.id === "bench")!;
    const favBench = { ...bench, isFavorite: true };
    const normalScore = scoreExerciseForBuild(
      bench, targetMuscles, coveredMuscles, coveredPatterns, true
    );
    const favScore = scoreExerciseForBuild(
      favBench, targetMuscles, coveredMuscles, coveredPatterns, true
    );
    expect(favScore).toBe(normalScore + 3);
  });

  it("gives uncovered muscles higher score in isolation phase", () => {
    const curl = buildTestPool().find((e) => e.id === "curl")!;

    const armTargets = new Set(["Biceps", "Triceps", "Forearms"]);
    const noCoverage = new Set<string>();
    const someCoverage = new Set(["Biceps"]);

    const uncoveredScore = scoreExerciseForBuild(
      curl, armTargets, noCoverage, coveredPatterns, false
    );
    const coveredScore = scoreExerciseForBuild(
      curl, armTargets, someCoverage, coveredPatterns, false
    );
    expect(uncoveredScore).toBeGreaterThan(coveredScore);
  });

  it("gives novel movement patterns a bonus in isolation phase", () => {
    const facePull = buildTestPool().find((e) => e.id === "face-pull")!;
    const targets = new Set(["Rear Delts", "Upper Back"]);

    const noPatterns = new Set<string>();
    const withPatterns = new Set(["horizontal_pull"]);

    const novelScore = scoreExerciseForBuild(facePull, targets, coveredMuscles, noPatterns, false);
    const knownScore = scoreExerciseForBuild(facePull, targets, coveredMuscles, withPatterns, false);
    expect(novelScore).toBeGreaterThan(knownScore);
  });
});

describe("smartBuild", () => {
  const pool = buildTestPool();

  it("returns empty result for empty target muscles", () => {
    const result = smartBuild({ targetMuscleGroups: [], exercisePool: pool, seed: 42 });
    expect(result.exercises).toEqual([]);
    expect(result.analysis.exerciseCount).toBe(0);
  });

  it("respects exercise count", () => {
    const result = smartBuild({
      targetMuscleGroups: ["chest", "back"],
      exercisePool: pool,
      exerciseCount: 5,
      seed: 42,
    });
    expect(result.exercises.length).toBe(5);
  });

  it("places compounds first", () => {
    const result = smartBuild({
      targetMuscleGroups: ["chest", "back", "legs"],
      exercisePool: pool,
      exerciseCount: 7,
      seed: 42,
    });
    // Find transition point: last compound, first isolation
    const lastCompoundIdx = result.exercises.reduce(
      (acc, ex, i) => (ex.isCompound ? i : acc),
      -1
    );
    const firstIsolationIdx = result.exercises.findIndex((ex) => !ex.isCompound);
    if (firstIsolationIdx >= 0 && lastCompoundIdx >= 0) {
      expect(lastCompoundIdx).toBeLessThan(firstIsolationIdx);
    }
  });

  it("is deterministic with same seed", () => {
    const input = {
      targetMuscleGroups: ["chest", "back"],
      exercisePool: pool,
      exerciseCount: 5,
      seed: 12345,
    };
    const result1 = smartBuild(input);
    const result2 = smartBuild(input);
    expect(result1.exercises.map((e) => e.id)).toEqual(result2.exercises.map((e) => e.id));
  });

  it("prefers favorites", () => {
    const poolWithFav = pool.map((ex) =>
      ex.id === "face-pull" ? { ...ex, isFavorite: true } : ex
    );

    // Run multiple seeds and count how often face-pull appears
    let favCount = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const seed of seeds) {
      const result = smartBuild({
        targetMuscleGroups: ["back", "shoulders"],
        exercisePool: poolWithFav,
        exerciseCount: 5,
        seed,
      });
      if (result.exercises.find((e) => e.id === "face-pull")) favCount++;
    }
    // Favorite should appear in most builds (at least 7/10)
    expect(favCount).toBeGreaterThanOrEqual(7);
  });

  it("never includes avoided exercises", () => {
    const poolWithAvoided = pool.map((ex) =>
      ex.id === "bench" ? { ...ex, isAvoided: true } : ex
    );
    const result = smartBuild({
      targetMuscleGroups: ["chest"],
      exercisePool: poolWithAvoided,
      exerciseCount: 5,
      seed: 42,
    });
    expect(result.exercises.find((e) => e.id === "bench")).toBeUndefined();
  });

  it("filters by available equipment", () => {
    const result = smartBuild({
      targetMuscleGroups: ["chest", "back"],
      exercisePool: pool,
      availableEquipment: ["dumbbell", "cable", "machine", "bench"],
      exerciseCount: 5,
      seed: 42,
    });
    // No barbell-only exercises (barbell Row requires only barbell)
    for (const ex of result.exercises) {
      const equipSet = new Set(["dumbbell", "cable", "machine", "bench"]);
      const hasEquip = ex.equipment.some((e) => equipSet.has(e));
      expect(hasEquip).toBe(true);
    }
  });

  it("returns all available when pool is smaller than requested count", () => {
    const smallPool = pool.slice(0, 3);
    const result = smartBuild({
      targetMuscleGroups: ["chest", "back", "legs"],
      exercisePool: smallPool,
      exerciseCount: 10,
      seed: 42,
    });
    expect(result.exercises.length).toBe(3);
  });

  it("produces a valid analysis object", () => {
    const result = smartBuild({
      targetMuscleGroups: ["chest", "back", "shoulders"],
      exercisePool: pool,
      exerciseCount: 7,
      seed: 42,
    });
    expect(result.analysis).toBeDefined();
    expect(result.analysis.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.analysis.overallScore).toBeLessThanOrEqual(100);
    expect(result.analysis.overallLabel).toBeDefined();
    expect(result.analysis.muscleCoverage).toBeDefined();
  });

  it("full-body selection produces reasonable score", () => {
    const result = smartBuild({
      targetMuscleGroups: ["chest", "back", "shoulders", "arms", "legs", "core"],
      exercisePool: pool,
      exerciseCount: 10,
      seed: 42,
    });
    expect(result.exercises.length).toBe(10);
    // With a full-body selection from a decent pool, score should be fair or better
    expect(result.analysis.overallScore).toBeGreaterThanOrEqual(30);
  });
});
