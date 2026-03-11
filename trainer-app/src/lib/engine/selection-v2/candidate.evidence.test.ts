import { describe, expect, it } from "vitest";

import { computeProposedSets } from "./candidate";
import type { SelectionObjective } from "./types";
import type { Exercise } from "../types";

function buildObjective(overrides?: Partial<SelectionObjective>): SelectionObjective {
  return {
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map(),
      painConflicts: new Set(),
      userAvoids: new Set(),
      minExercises: 1,
      maxExercises: 6,
      minMainLifts: 0,
      maxMainLifts: 2,
      minAccessories: 0,
      ...overrides?.constraints,
    },
    weights: {
      volumeDeficitFill: 0.33,
      rotationNovelty: 0.22,
      sfrEfficiency: 0.12,
      lengthenedBias: 0.2,
      movementDiversity: 0.07,
      sraReadiness: 0.05,
      userPreference: 0.01,
      ...overrides?.weights,
    },
    volumeContext: {
      weeklyTarget: new Map([["Triceps", 16]]),
      weeklyActual: new Map(),
      effectiveActual: new Map([["Triceps", 4]]),
      ...overrides?.volumeContext,
    },
    rotationContext: new Map(),
    sraContext: new Map(),
    preferences: {
      favoriteExerciseIds: new Set(),
      avoidExerciseIds: new Set(),
    },
    goals: {
      primary: "hypertrophy",
      secondary: "none",
      isStrengthFocused: false,
      isHypertrophyFocused: true,
    },
    trainingAge: "advanced",
    sessionIntent: "push",
    ...overrides,
  };
}

describe("candidate evidence guardrails", () => {
  it("caps advanced accessory at 4 sets regardless of deficit size", () => {
    // Deficit = 12 sets (target 16, actual 4). Old behavior returned 6.
    // New behavior: accessories are capped at 4 for intermediate/advanced so the beam
    // search fills remaining volume by selecting a second movement rather than
    // piling all sets onto a single accessory exercise.
    const exercise: Exercise = {
      id: "oh-tri-ext",
      name: "Overhead Cable Triceps Extension",
      movementPatterns: ["extension", "isolation"],
      splitTags: ["push"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
      sfrScore: 5,
      lengthPositionScore: 5,
      equipment: ["cable"],
      primaryMuscles: ["Triceps"],
      secondaryMuscles: [],
    };

    const proposedSets = computeProposedSets(exercise, buildObjective());

    expect(proposedSets).toBe(4);
  });

  it("main lifts still reach 6 sets for advanced training age with large deficit", () => {
    // Main lift cap is unchanged: beginner=4, intermediate=5, advanced=6.
    const exercise: Exercise = {
      id: "bench-press",
      name: "Barbell Bench Press",
      movementPatterns: ["horizontal_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: true,
      isCompound: true,
      fatigueCost: 3,
      sfrScore: 4,
      lengthPositionScore: 3,
      equipment: ["barbell"],
      primaryMuscles: ["Chest"],
      secondaryMuscles: ["Front Delts", "Triceps"],
    };

    const proposedSets = computeProposedSets(exercise, buildObjective({
      volumeContext: {
        weeklyTarget: new Map([["Chest", 16]]),
        weeklyActual: new Map(),
        effectiveActual: new Map([["Chest", 4]]),
      },
    }));

    expect(proposedSets).toBe(6);
  });

  it("caps beginner accessory at 3 sets", () => {
    const exercise: Exercise = {
      id: "cable-lat-raise",
      name: "Cable Lateral Raise",
      movementPatterns: ["isolation"],
      splitTags: ["push"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
      sfrScore: 5,
      lengthPositionScore: 4,
      equipment: ["cable"],
      primaryMuscles: ["Side Delts"],
      secondaryMuscles: [],
    };

    const proposedSets = computeProposedSets(
      exercise,
      buildObjective({ trainingAge: "beginner" })
    );

    expect(proposedSets).toBe(3);
  });
});
