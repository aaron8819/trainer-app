import { describe, expect, it } from "vitest";
import {
  buildGapFillSwapCandidates,
  evaluateGapFillSwapEligibility,
} from "./exercise-swap";

const currentExercise = {
  id: "cable-fly",
  name: "Cable Fly",
  isMainLiftEligible: false,
  fatigueCost: 2,
  movementPatterns: ["isolation"],
  primaryMuscles: ["chest"],
  equipment: ["cable"],
};

describe("gap-fill exercise swap constraints", () => {
  it("keeps only candidates that preserve target muscle, pattern, fatigue, and equipment demand", () => {
    const candidates = buildGapFillSwapCandidates({
      current: currentExercise,
      targetMuscles: ["chest"],
      candidates: [
        {
          id: "machine-fly",
          name: "Machine Fly",
          isMainLiftEligible: false,
          fatigueCost: 2,
          movementPatterns: ["isolation"],
          primaryMuscles: ["chest"],
          equipment: ["machine"],
        },
        {
          id: "barbell-bench",
          name: "Barbell Bench Press",
          isMainLiftEligible: true,
          fatigueCost: 4,
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["chest"],
          equipment: ["barbell", "rack"],
        },
        {
          id: "cable-pushdown",
          name: "Cable Pushdown",
          isMainLiftEligible: false,
          fatigueCost: 2,
          movementPatterns: ["isolation"],
          primaryMuscles: ["triceps"],
          equipment: ["cable"],
        },
      ],
    });

    expect(candidates.map((entry) => entry.exerciseId)).toEqual(["machine-fly"]);
  });

  it("rejects candidates that escalate fatigue or equipment demand", () => {
    expect(
      evaluateGapFillSwapEligibility({
        current: currentExercise,
        targetMuscles: ["chest"],
        candidate: {
          id: "dumbbell-fly",
          name: "Dumbbell Fly",
          isMainLiftEligible: false,
          fatigueCost: 3,
          movementPatterns: ["isolation"],
          primaryMuscles: ["chest"],
          equipment: ["dumbbell"],
        },
      })
    ).toBeNull();
  });
});
