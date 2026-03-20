import { describe, expect, it } from "vitest";

import { buildCandidate, computeProposedSets } from "./candidate";
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
  it("does not clip small-muscle accessory set proposals with arbitrary per-muscle caps", () => {
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

    expect(proposedSets).toBe(6);
  });

  it("adds a soft accessory bias from the canonical repeated-slot session shape", () => {
    const chestAccessory: Exercise = {
      id: "cable-fly",
      name: "Cable Fly",
      movementPatterns: ["isolation"],
      splitTags: ["push"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
      sfrScore: 4,
      lengthPositionScore: 4,
      equipment: ["cable"],
      primaryMuscles: ["Chest"],
      secondaryMuscles: [],
    };
    const tricepsAccessory: Exercise = {
      id: "triceps-pressdown",
      name: "Triceps Pressdown",
      movementPatterns: ["extension", "isolation"],
      splitTags: ["push"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
      sfrScore: 4,
      lengthPositionScore: 4,
      equipment: ["cable"],
      primaryMuscles: ["Triceps"],
      secondaryMuscles: [],
    };
    const objective = buildObjective({
      slotPolicy: {
        currentSession: {
          sessionIntent: "upper",
          slotId: "upper_a",
          sequenceIndex: 0,
          sessionShape: {
            id: "upper_horizontal_balanced",
            preferredAccessoryPrimaryMuscles: ["Chest", "Upper Back", "Rear Delts"],
            requiredMovementPatterns: ["vertical_pull"],
            avoidDuplicatePatterns: ["horizontal_pull"],
          },
        },
        futurePlanning: {
          futureSlots: [],
        },
      },
    });

    const chestCandidate = buildCandidate(chestAccessory, objective);
    const tricepsCandidate = buildCandidate(tricepsAccessory, objective);

    expect(chestCandidate.scores.sessionShapeAlignment).toBeCloseTo(2 / 3, 6);
    expect(tricepsCandidate.scores.sessionShapeAlignment).toBeCloseTo(1 / 3, 6);
    expect(chestCandidate.scores.sessionShapeAlignment).toBeGreaterThan(
      tricepsCandidate.scores.sessionShapeAlignment ?? 0
    );
  });
});
