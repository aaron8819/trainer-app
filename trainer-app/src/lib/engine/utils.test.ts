import { describe, expect, it } from "vitest";
import {
  normalizeName,
  buildNameSet,
  buildRecencyIndex,
  getRecencyMultiplier,
  getNoveltyMultiplier,
  weightedPick,
  getPrimaryMuscles,
  roundLoad,
  createId,
} from "./utils";
import type { Exercise, WorkoutHistoryEntry } from "./types";

describe("normalizeName", () => {
  it("lowercases and trims", () => {
    expect(normalizeName("  Bench Press  ")).toBe("bench press");
  });

  it("collapses whitespace", () => {
    expect(normalizeName("Incline   Dumbbell  Press")).toBe("incline dumbbell press");
  });

  it("strips special characters but keeps parentheses and hyphens", () => {
    expect(normalizeName("Cable Fly (High)")).toBe("cable fly (high)");
    expect(normalizeName("Chest-Supported Row")).toBe("chest-supported row");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeName("")).toBe("");
  });
});

describe("buildNameSet", () => {
  it("returns empty set for undefined", () => {
    expect(buildNameSet(undefined).size).toBe(0);
  });

  it("returns empty set for empty array", () => {
    expect(buildNameSet([]).size).toBe(0);
  });

  it("normalizes names into the set", () => {
    const set = buildNameSet(["Bench Press", "  SQUAT "]);
    expect(set.has("bench press")).toBe(true);
    expect(set.has("squat")).toBe(true);
    expect(set.has("Bench Press")).toBe(false);
  });
});

describe("buildRecencyIndex", () => {
  it("returns empty map for no history", () => {
    expect(buildRecencyIndex([]).size).toBe(0);
  });

  it("indexes exercises by most recent workout appearance", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date("2024-01-03").toISOString(),
        completed: true,
        exercises: [
          { exerciseId: "bench", movementPattern: "push", sets: [] },
        ],
      },
      {
        date: new Date("2024-01-01").toISOString(),
        completed: true,
        exercises: [
          { exerciseId: "squat", movementPattern: "squat", sets: [] },
          { exerciseId: "bench", movementPattern: "push", sets: [] },
        ],
      },
    ];

    const index = buildRecencyIndex(history);
    expect(index.get("bench")).toBe(0);
    expect(index.get("squat")).toBe(1);
  });
});

describe("getRecencyMultiplier", () => {
  const index = new Map<string, number>([
    ["a", 0],
    ["b", 1],
    ["c", 2],
    ["d", 3],
  ]);

  it("returns 0.3 for most recent (index 0)", () => {
    expect(getRecencyMultiplier("a", index)).toBe(0.3);
  });

  it("returns 0.5 for index 1", () => {
    expect(getRecencyMultiplier("b", index)).toBe(0.5);
  });

  it("returns 0.7 for index 2", () => {
    expect(getRecencyMultiplier("c", index)).toBe(0.7);
  });

  it("returns 1 for index >= 3", () => {
    expect(getRecencyMultiplier("d", index)).toBe(1);
  });

  it("returns 1 for unknown exercise", () => {
    expect(getRecencyMultiplier("unknown", index)).toBe(1);
  });
});

describe("getNoveltyMultiplier", () => {
  const index = new Map<string, number>([["a", 0]]);

  it("returns 1 for known exercise", () => {
    expect(getNoveltyMultiplier("a", index)).toBe(1);
  });

  it("returns 1.5 for novel exercise", () => {
    expect(getNoveltyMultiplier("b", index)).toBe(1.5);
  });
});

describe("weightedPick", () => {
  it("returns undefined for empty array", () => {
    expect(weightedPick([], () => 0.5)).toBeUndefined();
  });

  it("returns first item if all weights are zero", () => {
    const items = [
      { exercise: { id: "a" } as Exercise, weight: 0 },
      { exercise: { id: "b" } as Exercise, weight: 0 },
    ];
    expect(weightedPick(items, () => 0.5)?.id).toBe("a");
  });

  it("picks deterministically based on rng", () => {
    const items = [
      { exercise: { id: "a" } as Exercise, weight: 1 },
      { exercise: { id: "b" } as Exercise, weight: 1 },
    ];
    // rng returns 0.1 => roll = 0.2, subtract 1 => -0.8 <= 0 => picks "a"
    expect(weightedPick(items, () => 0.1)?.id).toBe("a");
    // rng returns 0.9 => roll = 1.8, subtract 1 => 0.8, subtract 1 => -0.2 <= 0 => picks "b"
    expect(weightedPick(items, () => 0.9)?.id).toBe("b");
  });
});

describe("getPrimaryMuscles", () => {
  it("returns primaryMuscles when present", () => {
    const exercise = { primaryMuscles: ["chest", "triceps"] } as Exercise;
    expect(getPrimaryMuscles(exercise)).toEqual(["chest", "triceps"]);
  });

  it("falls back to secondaryMuscles when primaryMuscles is empty", () => {
    const exercise = {
      primaryMuscles: [],
      secondaryMuscles: ["front delts"],
    } as unknown as Exercise;
    expect(getPrimaryMuscles(exercise)).toEqual(["front delts"]);
  });

  it("returns empty array when neither is populated", () => {
    const exercise = {} as Exercise;
    expect(getPrimaryMuscles(exercise)).toEqual([]);
  });
});

describe("roundLoad", () => {
  it("rounds to nearest 0.5", () => {
    expect(roundLoad(100.3)).toBe(100.5);
    expect(roundLoad(100.1)).toBe(100);
    expect(roundLoad(100.75)).toBe(101);
    expect(roundLoad(100.25)).toBe(100.5);
  });
});

describe("createId", () => {
  it("returns seed when provided", () => {
    expect(createId("my-id")).toBe("my-id");
  });

  it("returns a string when no seed", () => {
    const id = createId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns unique values", () => {
    const a = createId();
    const b = createId();
    expect(a).not.toBe(b);
  });
});
