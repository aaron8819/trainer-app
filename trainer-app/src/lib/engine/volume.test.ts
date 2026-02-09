import { describe, expect, it } from "vitest";
import { enforceVolumeCaps } from "./volume";
import type { WorkoutExercise } from "./types";

function makeWorkoutExercise(
  id: string,
  primaryMuscles: string[],
  fatigueCost: number,
  sets: number
): WorkoutExercise {
  return {
    id,
    exercise: {
      id,
      name: id,
      movementPatterns: [],
      splitTags: ["push"],
      jointStress: "low",
      isCompound: false,
      fatigueCost,
      equipment: ["cable"],
      primaryMuscles,
    },
    orderIndex: 0,
    isMainLift: false,
    sets: Array.from({ length: sets }, (_, i) => ({
      setIndex: i + 1,
      targetReps: 10,
    })),
  };
}

describe("enforceVolumeCaps", () => {
  it("removes the lowest-scored accessory, not just the last one", () => {
    const mainLifts: WorkoutExercise[] = [
      makeWorkoutExercise("bench", ["chest", "triceps"], 4, 4),
    ];
    // acc-redundant: targets chest (covered by bench) → uncovered=0, novelty=0
    //   score = fatigueCost(3) + novelty(0) - redundancy(0) = 3
    // acc-unique: targets biceps (NOT covered by bench) → uncovered=1, novelty=2
    //   score = fatigueCost(3) + novelty(2) - redundancy(0) = 5
    // Place redundant FIRST and unique LAST to prove we don't just .pop()
    const accessories: WorkoutExercise[] = [
      makeWorkoutExercise("acc-redundant", ["chest"], 3, 3),
      makeWorkoutExercise("acc-unique", ["biceps"], 3, 3),
    ];

    // recent=3, main adds 4 chest sets, acc-redundant adds 3 → planned chest = 10
    // previous chest = 8 → cap = 8 * 1.2 = 9.6 → 10 > 9.6 → exceeds
    // After removing acc-redundant (score 3 < score 5): planned chest = 3 + 4 = 7 < 9.6 → OK
    const volumeContext = {
      recent: { chest: 3 },
      previous: { chest: 8 },
    };

    const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("acc-unique");
  });

  it("returns accessories unchanged when no cap is exceeded", () => {
    const mainLifts: WorkoutExercise[] = [
      makeWorkoutExercise("bench", ["chest"], 4, 4),
    ];
    const accessories: WorkoutExercise[] = [
      makeWorkoutExercise("fly", ["chest"], 2, 3),
    ];
    const volumeContext = {
      recent: {},
      previous: {},
    };

    const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);
    expect(result).toEqual(accessories);
  });

  it("returns empty array when all accessories exceed cap", () => {
    const mainLifts: WorkoutExercise[] = [
      makeWorkoutExercise("bench", ["chest"], 4, 4),
    ];
    const accessories: WorkoutExercise[] = [
      makeWorkoutExercise("fly", ["chest"], 2, 3),
    ];
    // previous has very low baseline, everything exceeds
    const volumeContext = {
      recent: { chest: 10 },
      previous: { chest: 1 },
    };

    const result = enforceVolumeCaps(accessories, mainLifts, volumeContext);
    expect(result).toHaveLength(0);
  });
});
