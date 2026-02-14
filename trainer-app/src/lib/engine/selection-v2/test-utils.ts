/**
 * Shared test utilities for selection-v2 tests
 */

import type { Exercise } from "../types";
import type { SelectionObjective, SelectionCandidate } from "./types";

/**
 * Create a mock exercise with all required fields
 */
export function createMockExercise(
  id: string,
  primaryMuscles: string[] = [],
  secondaryMuscles: string[] = [],
  overrides?: Partial<Exercise>
): Exercise {
  return {
    id,
    // CRITICAL: Keep name same as id for test simplicity
    // (RotationContext is keyed by name, so tests can use id as lookup key)
    name: id,
    primaryMuscles,
    secondaryMuscles,
    equipment: ["barbell"],
    repRangeMin: 5,
    repRangeMax: 8,
    timePerSetSec: 60,
    fatigueCost: 3,
    sfrScore: 4,
    lengthPositionScore: 3,
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "medium",
    isMainLiftEligible: false,
    ...overrides,
  };
}

/**
 * Create a mock selection objective
 */
export function createMockObjective(
  weeklyTarget: Map<string, number>,
  timeBudget: number = 60,
  overrides?: Partial<SelectionObjective>
): SelectionObjective {
  return {
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map(
        Array.from(weeklyTarget.entries()).map(([muscle, target]) => [
          muscle,
          target * 1.5, // MRV = 1.5 × MEV
        ])
      ),
      timeBudget,
      equipment: new Set(["barbell", "dumbbell"]),
      contraindications: new Set(),
      minExercises: 1,
      maxExercises: 8,
      minMainLifts: 1, // Default to requiring at least 1 main lift
      maxMainLifts: 3, // Prevent over-fatigue
      minAccessories: 2, // Ensure variety
    },
    weights: {
      volumeDeficitFill: 0.4,
      rotationNovelty: 0.25,
      sfrEfficiency: 0.15,
      movementDiversity: 0.05,
      lengthenedBias: 0.1,
      sraReadiness: 0.03,
      userPreference: 0.02,
    },
    volumeContext: {
      weeklyTarget,
      weeklyActual: new Map(),
      effectiveActual: new Map(),
    },
    rotationContext: new Map(),
    sraContext: new Map(),
    preferences: {
      favoriteExerciseIds: new Set(),
      avoidExerciseIds: new Set(),
    },
    blockContext: undefined,
    ...overrides,
  };
}
