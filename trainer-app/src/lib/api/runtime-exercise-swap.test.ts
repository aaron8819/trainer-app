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
      "machine-lateral-raise",
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

  it("labels hip/back extension as fallback instead of exact knee-flexion curl equivalents", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: {
        id: "seated-leg-curl",
        name: "Seated Leg Curl",
        fatigueCost: 1,
        jointStress: "low",
        isCompound: false,
        movementPatterns: ["flexion", "isolation"],
        primaryMuscles: ["hamstrings"],
        equipment: ["machine"],
        sourceLane: {
          slotId: "lower_b",
          seedRole: "ACCESSORY",
          laneId: "knee_flexion_curl",
          laneRole: "support",
          primaryMuscles: ["Hamstrings"],
          acceptableExerciseClasses: ["hamstring_curl"],
          preferredExerciseClasses: ["hamstring_curl"],
        },
      },
      candidates: [
        {
          id: "lying-leg-curl",
          name: "Lying Leg Curl",
          fatigueCost: 1,
          jointStress: "low",
          isCompound: false,
          movementPatterns: ["flexion", "isolation"],
          primaryMuscles: ["hamstrings"],
          equipment: ["machine"],
        },
        {
          id: "back-extension",
          name: "Back Extension (45 Degree)",
          fatigueCost: 1,
          jointStress: "low",
          isCompound: true,
          movementPatterns: ["extension"],
          primaryMuscles: ["hamstrings", "glutes"],
          secondaryMuscles: ["lower back"],
          equipment: ["machine"],
        },
        {
          id: "reverse-hyper",
          name: "Reverse Hyperextension",
          fatigueCost: 1,
          jointStress: "low",
          isCompound: true,
          movementPatterns: ["extension"],
          primaryMuscles: ["hamstrings", "glutes"],
          secondaryMuscles: ["lower back"],
          equipment: ["machine"],
        },
      ],
    });

    expect(candidates.map((entry) => entry.exerciseId)).toEqual([
      "lying-leg-curl",
      "back-extension",
      "reverse-hyper",
    ]);
    expect(candidates[0]).toMatchObject({
      exerciseId: "lying-leg-curl",
      swapFallbackTier: "exact_lane_equivalent",
      sourceV2Class: "knee_flexion_curl",
    });
    expect(
      candidates
        .filter((entry) => entry.exerciseId !== "lying-leg-curl")
        .map((entry) => entry.swapFallbackTier),
    ).toEqual(["broad_same_muscle_fallback", "broad_same_muscle_fallback"]);
  });

  it("ranks loadable lower-b quad-support swaps above support-only squat fallbacks", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: {
        id: "bulgarian-split-squat",
        name: "Bulgarian Split Squat",
        fatigueCost: 3,
        jointStress: "medium",
        isCompound: true,
        movementPatterns: ["lunge"],
        primaryMuscles: ["quads", "glutes"],
        equipment: ["dumbbell"],
        sourceLane: {
          slotId: "lower_b",
          seedRole: "ACCESSORY",
          laneId: "quad_support",
          laneRole: "support",
          primaryMuscles: ["Quads"],
          acceptableExerciseClasses: [
            "leg_press",
            "squat_pattern",
            "quad_isolation",
            "lunge",
          ],
          preferredExerciseClasses: [
            "leg_press",
            "squat_pattern",
            "quad_isolation",
            "lunge",
          ],
        },
      },
      candidates: [
        {
          id: "reverse-lunge",
          name: "Reverse Lunge",
          fatigueCost: 2,
          jointStress: "medium",
          isCompound: true,
          movementPatterns: ["lunge"],
          primaryMuscles: ["quads", "glutes"],
          equipment: ["dumbbell"],
        },
        {
          id: "walking-lunge",
          name: "Walking Lunge",
          fatigueCost: 2,
          jointStress: "medium",
          isCompound: true,
          movementPatterns: ["lunge"],
          primaryMuscles: ["quads", "glutes"],
          equipment: ["dumbbell"],
        },
        {
          id: "goblet-squat",
          name: "Goblet Squat",
          fatigueCost: 1,
          jointStress: "low",
          isCompound: true,
          movementPatterns: ["squat"],
          primaryMuscles: ["quads", "glutes"],
          equipment: ["dumbbell"],
        },
        {
          id: "belt-squat",
          name: "Belt Squat",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: true,
          movementPatterns: ["squat"],
          primaryMuscles: ["quads", "glutes"],
          equipment: ["machine"],
        },
        {
          id: "leg-press",
          name: "Leg Press",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: true,
          movementPatterns: ["squat"],
          primaryMuscles: ["quads", "glutes"],
          equipment: ["machine"],
        },
        {
          id: "hack-squat",
          name: "Hack Squat",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: true,
          movementPatterns: ["squat"],
          primaryMuscles: ["quads"],
          equipment: ["machine"],
        },
      ],
      limit: 6,
    });

    const order = candidates.map((entry) => entry.exerciseId);
    for (const loadable of ["belt-squat", "hack-squat", "leg-press"]) {
      expect(order.indexOf(loadable)).toBeGreaterThanOrEqual(0);
      expect(order.indexOf(loadable)).toBeLessThan(order.indexOf("goblet-squat"));
      expect(order.indexOf(loadable)).toBeLessThan(order.indexOf("reverse-lunge"));
      expect(order.indexOf(loadable)).toBeLessThan(order.indexOf("walking-lunge"));
    }
    expect(
      candidates.filter((entry) =>
        ["belt-squat", "hack-squat", "leg-press"].includes(entry.exerciseId),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ swapFallbackTier: "exact_lane_equivalent" }),
      ]),
    );
    expect(candidates.find((entry) => entry.exerciseId === "goblet-squat")).toMatchObject({
      swapFallbackTier: "useful_fallback_warning",
    });
  });

  it("allows equivalent calf-isolation swaps as warning-tier candidates despite small fatigue delta", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: {
        id: "seated-calf-raise",
        name: "Seated Calf Raise",
        fatigueCost: 1,
        jointStress: "low",
        isCompound: false,
        movementPatterns: ["calf_raise_flexed", "isolation"],
        primaryMuscles: ["calves"],
        equipment: ["machine"],
        sourceLane: {
          slotId: "lower_b",
          seedRole: "ACCESSORY",
          laneId: "calves",
          laneRole: "accessory",
          primaryMuscles: ["Calves"],
          acceptableExerciseClasses: ["calf_isolation"],
          preferredExerciseClasses: ["calf_isolation"],
        },
      },
      candidates: [
        {
          id: "standing-calf-raise",
          name: "Standing Calf Raise",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: false,
          movementPatterns: ["calf_raise_extended", "isolation"],
          primaryMuscles: ["calves"],
          equipment: ["machine"],
        },
        {
          id: "leg-press-calf-raise",
          name: "Leg Press Calf Raise",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: false,
          movementPatterns: ["calf_raise_extended", "isolation"],
          primaryMuscles: ["calves"],
          equipment: ["machine"],
        },
      ],
    });

    expect(candidates.map((entry) => entry.exerciseId)).toEqual([
      "leg-press-calf-raise",
      "standing-calf-raise",
    ]);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          swapFallbackTier: "useful_fallback_warning",
          sourceV2Class: "calf_isolation",
          fatigueDelta: 1,
        }),
      ]),
    );
  });

  it("allows machine lateral raises to surface cable lateral raises as same-target safe swaps", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: {
        id: "machine-lateral-raise",
        name: "Machine Lateral Raise",
        fatigueCost: 1,
        jointStress: "low",
        isCompound: false,
        isMainLift: false,
        isMainLiftEligible: false,
        movementPatterns: ["abduction"],
        primaryMuscles: ["side delts"],
        equipment: ["machine"],
        sourceLane: {
          slotId: "upper_b",
          seedRole: "ACCESSORY",
          laneId: "side_delts",
          laneRole: "accessory",
          primaryMuscles: ["Side Delts"],
          acceptableExerciseClasses: ["lateral_raise"],
          preferredExerciseClasses: ["lateral_raise"],
        },
      },
      candidates: [
        {
          id: "cable-lateral-raise",
          name: "Cable Lateral Raise",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: false,
          isMainLiftEligible: false,
          movementPatterns: ["abduction"],
          primaryMuscles: ["side delts"],
          equipment: ["cable"],
        },
      ],
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        exerciseId: "cable-lateral-raise",
        exerciseName: "Cable Lateral Raise",
        sourceV2Class: "lateral_raise",
        swapFallbackTier: "useful_fallback_warning",
        fatigueDelta: 1,
      }),
    ]);
  });

  it("surfaces chin-ups as warning-tier vertical-pull swaps for close-grip lat pulldowns", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: {
        id: "close-grip-lat-pulldown",
        name: "Close-Grip Lat Pulldown",
        fatigueCost: 2,
        jointStress: "low",
        isCompound: true,
        isMainLift: false,
        isMainLiftEligible: false,
        movementPatterns: ["vertical_pull"],
        primaryMuscles: ["lats"],
        secondaryMuscles: ["biceps", "upper back"],
        equipment: ["cable", "machine"],
        sourceLane: {
          slotId: "upper_a",
          seedRole: "ACCESSORY",
          laneId: "vertical_pull_anchor",
          laneRole: "anchor",
          primaryMuscles: ["Lats"],
          acceptableExerciseClasses: ["vertical_pull"],
          preferredExerciseClasses: ["vertical_pull"],
        },
      },
      candidates: [
        {
          id: "chin-up",
          name: "Chin-Up",
          fatigueCost: 3,
          jointStress: "medium",
          isCompound: true,
          isMainLiftEligible: true,
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["lats", "biceps"],
          secondaryMuscles: ["upper back", "forearms"],
          equipment: ["bodyweight"],
        },
        {
          id: "cable-pullover",
          name: "Cable Pullover",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: false,
          isMainLiftEligible: false,
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["lats"],
          equipment: ["cable"],
        },
        {
          id: "straight-arm-pulldown",
          name: "Straight-Arm Pulldown",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: false,
          isMainLiftEligible: false,
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["lats"],
          equipment: ["cable"],
        },
      ],
    });

    expect(candidates[0]).toEqual(
      expect.objectContaining({
        exerciseId: "chin-up",
        exerciseName: "Chin-Up",
        sourceV2Class: "vertical_pull",
        swapFallbackTier: "useful_fallback_warning",
        movementPatternMatch: "exact",
        fatigueDelta: 1,
        jointStressDelta: 1,
      }),
    );
    expect(
      candidates
        .filter((candidate) => candidate.exerciseId !== "chin-up")
        .map((candidate) => candidate.swapFallbackTier),
    ).toEqual(["broad_same_muscle_fallback", "broad_same_muscle_fallback"]);
  });
});
