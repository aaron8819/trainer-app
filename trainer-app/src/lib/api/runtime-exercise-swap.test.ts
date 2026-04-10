import { describe, expect, it } from "vitest";

import {
  buildRuntimeExerciseSwapCandidates,
  evaluateRuntimeExerciseSwapEligibility,
  isSwapEligible,
  type RuntimeExerciseSwapProfile,
} from "./runtime-exercise-swap";

const currentAccessory: RuntimeExerciseSwapProfile = {
  id: "db-lateral-raise",
  name: "Dumbbell Lateral Raise",
  fatigueCost: 1,
  jointStress: "low",
  isMainLift: false,
  isMainLiftEligible: false,
  isCompound: false,
  movementPatterns: ["abduction"],
  primaryMuscles: ["side delts"],
  equipment: ["dumbbell"],
};

const currentMainLift: RuntimeExerciseSwapProfile = {
  id: "barbell-bench-press",
  name: "Barbell Bench Press",
  fatigueCost: 4,
  jointStress: "high",
  isMainLift: true,
  isMainLiftEligible: true,
  isCompound: true,
  movementPatterns: ["horizontal_push"],
  primaryMuscles: ["chest", "triceps"],
  equipment: ["barbell", "bench", "rack"],
};

describe("runtime exercise swap constraints", () => {
  it("marks open unlogged exercises with sufficient metadata as swap eligible", () => {
    expect(
      isSwapEligible(currentAccessory, {
        status: "IN_PROGRESS",
        loggedSetCount: 0,
        totalSetCount: 3,
        isRuntimeAdded: false,
        isAlreadySwapped: false,
      }),
    ).toEqual({ eligible: true });
  });

  it("allows runtime-added source exercises when they are still unlogged", () => {
    expect(
      isSwapEligible(currentAccessory, {
        status: "IN_PROGRESS",
        loggedSetCount: 0,
        totalSetCount: 3,
        isRuntimeAdded: true,
        isAlreadySwapped: false,
      }),
    ).toEqual({ eligible: true });
  });

  it("returns strict reason codes for logged source exercises", () => {
    expect(
      isSwapEligible(currentAccessory, {
        status: "IN_PROGRESS",
        loggedSetCount: 1,
        totalSetCount: 3,
        isRuntimeAdded: false,
        isAlreadySwapped: false,
      }),
    ).toEqual({
      eligible: false,
      reasonCode: "PARTIALLY_LOGGED_EXERCISE_BLOCKED",
    });

    expect(
      isSwapEligible(currentAccessory, {
        status: "IN_PROGRESS",
        loggedSetCount: 3,
        totalSetCount: 3,
        isRuntimeAdded: false,
        isAlreadySwapped: false,
      }),
    ).toEqual({ eligible: false, reasonCode: "FULLY_LOGGED_EXERCISE_BLOCKED" });
  });

  it("filters accessory candidates by primary muscle, movement compatibility, joint stress, and fatigue", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: currentAccessory,
      candidates: [
        {
          id: "cable-lateral-raise",
          name: "Cable Lateral Raise",
          fatigueCost: 1,
          jointStress: "low",
          movementPatterns: ["abduction"],
          primaryMuscles: ["side delts"],
          equipment: ["cable"],
        },
        {
          id: "machine-lateral-raise",
          name: "Machine Lateral Raise",
          fatigueCost: 2,
          jointStress: "low",
          movementPatterns: ["abduction"],
          primaryMuscles: ["side delts"],
          equipment: ["machine"],
        },
        {
          id: "cable-curl",
          name: "Cable Curl",
          fatigueCost: 1,
          jointStress: "low",
          movementPatterns: ["flexion"],
          primaryMuscles: ["biceps"],
          equipment: ["cable"],
        },
        {
          id: "upright-row",
          name: "Upright Row",
          fatigueCost: 1,
          jointStress: "medium",
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["side delts"],
          equipment: ["barbell"],
        },
      ],
    });

    expect(candidates.map((entry) => entry.exerciseId)).toEqual([
      "cable-lateral-raise",
    ]);
  });

  it("allows main-lift swaps only to main-lift eligible non-isolation candidates in the same movement family", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: currentMainLift,
      candidates: [
        {
          id: "dumbbell-bench-press",
          name: "Dumbbell Bench Press",
          fatigueCost: 3,
          jointStress: "medium",
          isMainLiftEligible: true,
          isCompound: true,
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["chest", "triceps"],
          equipment: ["dumbbell", "bench"],
        },
        {
          id: "pec-deck",
          name: "Pec Deck",
          fatigueCost: 1,
          jointStress: "low",
          isMainLiftEligible: false,
          isCompound: false,
          movementPatterns: ["isolation"],
          primaryMuscles: ["chest"],
          equipment: ["machine"],
        },
        {
          id: "barbell-back-squat",
          name: "Barbell Back Squat",
          fatigueCost: 4,
          jointStress: "high",
          isMainLiftEligible: true,
          isCompound: true,
          movementPatterns: ["squat"],
          primaryMuscles: ["quads", "glutes"],
          equipment: ["barbell", "rack"],
        },
      ],
    });

    expect(candidates.map((entry) => entry.exerciseId)).toEqual([
      "dumbbell-bench-press",
    ]);
  });

  it("excludes exercises already present in the workout", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: currentAccessory,
      excludedExerciseIds: new Set(["cable-lateral-raise"]),
      candidates: [
        {
          id: "cable-lateral-raise",
          name: "Cable Lateral Raise",
          fatigueCost: 1,
          jointStress: "low",
          movementPatterns: ["abduction"],
          primaryMuscles: ["side delts"],
          equipment: ["cable"],
        },
      ],
    });

    expect(candidates).toEqual([]);
  });

  it("ranks deterministically by movement, muscles, role, equipment, stress, fatigue, history, then name", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: currentMainLift,
      candidates: [
        {
          id: "incline-db-press",
          name: "Incline Dumbbell Press",
          fatigueCost: 2,
          jointStress: "medium",
          isMainLiftEligible: true,
          isCompound: true,
          hasRecentHistory: true,
          movementPatterns: ["vertical_push"],
          primaryMuscles: ["chest"],
          equipment: ["dumbbell"],
        },
        {
          id: "flat-db-press",
          name: "Flat Dumbbell Press",
          fatigueCost: 3,
          jointStress: "medium",
          isMainLiftEligible: true,
          isCompound: true,
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["chest"],
          equipment: ["dumbbell"],
        },
      ],
    });

    expect(candidates.map((entry) => entry.exerciseId)).toEqual([
      "flat-db-press",
      "incline-db-press",
    ]);
  });

  it("returns null when no compatible candidate exists", () => {
    expect(
      evaluateRuntimeExerciseSwapEligibility({
        current: currentAccessory,
        candidate: {
          id: "leg-extension",
          name: "Leg Extension",
          fatigueCost: 1,
          jointStress: "low",
          movementPatterns: ["extension"],
          primaryMuscles: ["quads"],
          equipment: ["machine"],
        },
      }),
    ).toBeNull();
  });
});
