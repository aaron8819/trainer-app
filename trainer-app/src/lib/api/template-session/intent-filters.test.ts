import { describe, expect, it } from "vitest";

import {
  enforceIntentAlignment,
  filterPoolForIntent,
  filterPoolForInventory,
  isIntentAlignedExercise,
} from "./intent-filters";
import type { Exercise } from "@/lib/engine/types";
import type { SelectionOutput } from "@/lib/engine/session-types";

describe("intent filter evidence guardrails", () => {
  it("records diagnostics instead of failing when some selected exercises are off-intent", () => {
    const pool: Exercise[] = [
      {
        id: "bench",
        name: "Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 4,
        lengthPositionScore: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Front Delts", "Triceps"],
      },
      {
        id: "row",
        name: "Barbell Row",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 3,
        lengthPositionScore: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Lats", "Upper Back"],
        secondaryMuscles: ["Biceps"],
      },
    ];

    const selection: SelectionOutput = {
      selectedExerciseIds: ["bench", "row"],
      mainLiftIds: ["bench", "row"],
      accessoryIds: [],
      perExerciseSetTargets: { bench: 4, row: 4 },
      volumePlanByMuscle: {},
      rationale: {
        bench: {
          score: 1,
          components: {},
          hardFilterPass: true,
          selectedStep: "main_pick",
        },
        row: {
          score: 1,
          components: {},
          hardFilterPass: true,
          selectedStep: "main_pick",
        },
      },
    };

    const result = enforceIntentAlignment(selection, pool, "push");

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.intentDiagnostics?.alignedRatio).toBe(0.5);
    expect(result.intentDiagnostics?.minAlignedRatio).toBe(0);
  });

  it("keeps upper, lower, and body_part filtering aligned with centralized opportunity rules", () => {
    const pool: Exercise[] = [
      {
        id: "press",
        name: "Shoulder Press",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 4,
        lengthPositionScore: 3,
        equipment: ["dumbbell"],
        primaryMuscles: ["Front Delts"],
        secondaryMuscles: ["Triceps"],
      },
      {
        id: "rdl",
        name: "Romanian Deadlift",
        movementPatterns: ["hinge"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 4,
        lengthPositionScore: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Hamstrings", "Glutes"],
        secondaryMuscles: ["Lower Back"],
      },
      {
        id: "curl",
        name: "Cable Curl",
        movementPatterns: ["isolation"],
        splitTags: [],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        sfrScore: 3,
        lengthPositionScore: 3,
        equipment: ["cable"],
        primaryMuscles: ["Biceps"],
        secondaryMuscles: [],
      },
    ];

    expect(isIntentAlignedExercise(pool[0], "upper")).toBe(true);
    expect(isIntentAlignedExercise(pool[1], "upper")).toBe(false);
    expect(isIntentAlignedExercise(pool[1], "lower")).toBe(true);
    expect(isIntentAlignedExercise(pool[2], "body_part", ["Biceps"])).toBe(true);
    expect(isIntentAlignedExercise(pool[2], "body_part")).toBe(false);

    expect(filterPoolForIntent(pool, "upper").map((exercise) => exercise.id)).toEqual([
      "press",
      "curl",
    ]);
    expect(filterPoolForIntent(pool, "lower").map((exercise) => exercise.id)).toEqual([
      "rdl",
    ]);
    expect(
      filterPoolForIntent(pool, "body_part", ["Biceps"]).map((exercise) => exercise.id)
    ).toEqual(["curl"]);
  });

  it("uses closure/rescue inventory for specialized top-up scenarios without widening standard inventory", () => {
    const pool: Exercise[] = [
      {
        id: "close-grip-bench",
        name: "Close-Grip Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 4,
        lengthPositionScore: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Triceps"],
        secondaryMuscles: ["Chest"],
        stimulusProfile: {
          triceps: 1,
          chest: 0.35,
        },
      },
    ];

    expect(filterPoolForInventory(pool, "body_part", "standard", ["Chest"])).toEqual([]);
    expect(
      filterPoolForInventory(pool, "body_part", "closure", ["Chest"]).map((exercise) => exercise.id)
    ).toEqual(["close-grip-bench"]);
    expect(
      filterPoolForInventory(pool, "body_part", "rescue", ["Chest"]).map((exercise) => exercise.id)
    ).toEqual(["close-grip-bench"]);
  });
});
