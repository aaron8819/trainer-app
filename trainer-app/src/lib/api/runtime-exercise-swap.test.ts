import { describe, expect, it } from "vitest";

import {
  buildRuntimeExerciseSwapCandidates,
  evaluateRuntimeExerciseSwapEligibility,
  isSupportedRuntimeExerciseSwapPattern,
} from "./runtime-exercise-swap";

const currentExercise = {
  id: "t-bar-row",
  name: "T-Bar Row",
  fatigueCost: 3,
  movementPatterns: ["horizontal_pull"],
  primaryMuscles: ["lats", "upper back"],
  equipment: ["barbell"],
};

describe("runtime exercise swap constraints", () => {
  it("keeps only narrow pull replacements that preserve pattern, muscles, and non-escalating demand", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: currentExercise,
      candidates: [
        {
          id: "chest-supported-db-row",
          name: "Chest-Supported Dumbbell Row",
          fatigueCost: 2,
          movementPatterns: ["horizontal_pull"],
          primaryMuscles: ["lats", "upper back"],
          equipment: ["dumbbell"],
        },
        {
          id: "lat-pulldown",
          name: "Lat Pulldown",
          fatigueCost: 2,
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["lats"],
          equipment: ["cable"],
        },
        {
          id: "barbell-row",
          name: "Barbell Row",
          fatigueCost: 4,
          movementPatterns: ["horizontal_pull"],
          primaryMuscles: ["lats", "upper back"],
          equipment: ["barbell"],
        },
      ],
    });

    expect(candidates.map((entry) => entry.exerciseId)).toEqual(["chest-supported-db-row"]);
  });

  it("rejects candidates that raise equipment demand above the original", () => {
    expect(
      evaluateRuntimeExerciseSwapEligibility({
        current: {
          id: "machine-row",
          name: "Machine Row",
          fatigueCost: 2,
          movementPatterns: ["horizontal_pull"],
          primaryMuscles: ["lats", "upper back"],
          equipment: ["machine"],
        },
        candidate: {
          id: "one-arm-db-row",
          name: "One-Arm Dumbbell Row",
          fatigueCost: 2,
          movementPatterns: ["horizontal_pull"],
          primaryMuscles: ["lats", "upper back"],
          equipment: ["dumbbell"],
        },
      })
    ).toBeNull();
  });

  it("recognizes the currently supported runtime swap pull patterns only", () => {
    expect(isSupportedRuntimeExerciseSwapPattern(["HORIZONTAL_PULL"])).toBe(true);
    expect(isSupportedRuntimeExerciseSwapPattern(["VERTICAL_PULL"])).toBe(true);
    expect(isSupportedRuntimeExerciseSwapPattern(["ISOLATION"])).toBe(false);
  });
});
