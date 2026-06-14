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

const currentRowAnchorMainLift: RuntimeExerciseSwapProfile = {
  id: "close-grip-seated-cable-row",
  name: "Close-Grip Seated Cable Row",
  fatigueCost: 2,
  jointStress: "low",
  isMainLift: true,
  isMainLiftEligible: false,
  isCompound: true,
  movementPatterns: ["horizontal_pull"],
  primaryMuscles: ["lats", "upper back"],
  secondaryMuscles: ["biceps", "rear delts"],
  equipment: ["cable", "machine"],
  sourceLane: {
    slotId: "upper_a",
    seedRole: "CORE_COMPOUND",
    laneId: "row_anchor",
    laneRole: "anchor",
    primaryMuscles: ["Upper Back", "Lats"],
    acceptableExerciseClasses: ["horizontal_pull_support"],
    preferredExerciseClasses: ["horizontal_pull_support"],
  },
};

const chestSupportedDumbbellRow: RuntimeExerciseSwapProfile = {
  id: "chest-supported-db-row",
  name: "Chest-Supported Dumbbell Row",
  fatigueCost: 2,
  jointStress: "low",
  isMainLiftEligible: false,
  isCompound: true,
  movementPatterns: ["horizontal_pull"],
  primaryMuscles: ["upper back", "lats"],
  secondaryMuscles: ["biceps", "rear delts"],
  equipment: ["dumbbell", "bench"],
};

const chestSupportedTBarRow: RuntimeExerciseSwapProfile = {
  id: "chest-supported-t-bar-row",
  name: "Chest-Supported T-Bar Row",
  fatigueCost: 2,
  jointStress: "low",
  isMainLiftEligible: false,
  isCompound: true,
  movementPatterns: ["horizontal_pull"],
  primaryMuscles: ["upper back", "lats"],
  secondaryMuscles: ["biceps", "rear delts"],
  equipment: ["barbell", "machine"],
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

  it("allows row-anchor core-compound main lifts to use stable loadable row substitutes", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: currentRowAnchorMainLift,
      candidates: [chestSupportedDumbbellRow, chestSupportedTBarRow],
    });

    expect(candidates.map((entry) => entry.exerciseId)).toEqual([
      "chest-supported-t-bar-row",
      "chest-supported-db-row",
    ]);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exerciseId: "chest-supported-db-row",
          sourceV2Class: "horizontal_pull_support",
          swapFallbackTier: "exact_lane_equivalent",
          movementPatternMatch: "exact",
          fatigueDelta: 0,
          jointStressDelta: 0,
        }),
        expect.objectContaining({
          exerciseId: "chest-supported-t-bar-row",
          sourceV2Class: "horizontal_pull_support",
          swapFallbackTier: "exact_lane_equivalent",
          movementPatternMatch: "exact",
          fatigueDelta: 0,
          jointStressDelta: 0,
        }),
      ]),
    );
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

  it("keeps rank-six vertical-pull swaps visible in the default shortlist", () => {
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
          id: "assisted-pull-up-machine",
          name: "Assisted Pull-Up Machine",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: true,
          isMainLiftEligible: false,
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["lats"],
          secondaryMuscles: ["biceps", "upper back"],
          equipment: ["machine"],
        },
        {
          id: "close-neutral-lat-pulldown",
          name: "Close Neutral Lat Pulldown",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: true,
          isMainLiftEligible: false,
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["lats"],
          secondaryMuscles: ["biceps", "upper back"],
          equipment: ["cable", "machine"],
        },
        {
          id: "mag-grip-lat-pulldown",
          name: "MAG-Grip Lat Pulldown",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: true,
          isMainLiftEligible: false,
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["lats"],
          secondaryMuscles: ["biceps", "upper back"],
          equipment: ["cable", "machine"],
        },
        {
          id: "neutral-grip-lat-pulldown",
          name: "Neutral-Grip Lat Pulldown",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: true,
          isMainLiftEligible: false,
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["lats"],
          secondaryMuscles: ["biceps", "upper back"],
          equipment: ["cable", "machine"],
        },
        {
          id: "wide-grip-lat-pulldown",
          name: "Wide-Grip Lat Pulldown",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: true,
          isMainLiftEligible: false,
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["lats"],
          secondaryMuscles: ["biceps", "upper back"],
          equipment: ["cable", "machine"],
        },
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
      ],
    });

    expect(candidates.map((candidate) => candidate.exerciseId)).toContain(
      "chin-up",
    );
    expect(candidates.findIndex((candidate) => candidate.exerciseId === "chin-up")).toBe(
      5,
    );
    expect(candidates[5]).toMatchObject({
      exerciseId: "chin-up",
      swapFallbackTier: "useful_fallback_warning",
      fatigueDelta: 1,
      jointStressDelta: 1,
    });
  });

  it("keeps stress and fatigue increase filters closed for non-exempt swaps", () => {
    expect(
      evaluateRuntimeExerciseSwapEligibility({
        current: {
          id: "incline-machine-press",
          name: "Incline Machine Press",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: true,
          isMainLift: false,
          isMainLiftEligible: false,
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["chest"],
          secondaryMuscles: ["triceps", "front delts"],
          equipment: ["machine"],
        },
        candidate: {
          id: "incline-barbell-bench-press",
          name: "Incline Barbell Bench Press",
          fatigueCost: 3,
          jointStress: "medium",
          isCompound: true,
          isMainLiftEligible: true,
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["chest"],
          secondaryMuscles: ["triceps", "front delts"],
          equipment: ["barbell", "bench", "rack"],
        },
      }),
    ).toBeNull();

    expect(
      evaluateRuntimeExerciseSwapEligibility({
        current: {
          id: "barbell-curl",
          name: "Barbell Curl",
          fatigueCost: 1,
          jointStress: "low",
          isCompound: false,
          isMainLift: false,
          isMainLiftEligible: false,
          movementPatterns: ["flexion", "isolation"],
          primaryMuscles: ["biceps"],
          equipment: ["barbell"],
        },
        candidate: {
          id: "cable-curl",
          name: "Cable Curl",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: false,
          isMainLiftEligible: false,
          movementPatterns: ["flexion", "isolation"],
          primaryMuscles: ["biceps"],
          equipment: ["cable"],
        },
      }),
    ).toBeNull();
  });

  it("surfaces bounded caution-tier replacements only when explicitly requested", () => {
    const inclineMachinePress: RuntimeExerciseSwapProfile = {
      id: "incline-machine-press",
      name: "Incline Machine Press",
      fatigueCost: 2,
      jointStress: "low",
      isCompound: true,
      isMainLift: false,
      isMainLiftEligible: false,
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["chest"],
      secondaryMuscles: ["triceps", "front delts"],
      equipment: ["machine"],
    };
    const inclineBarbellBenchPress: RuntimeExerciseSwapProfile = {
      id: "incline-barbell-bench-press",
      name: "Incline Barbell Bench Press",
      fatigueCost: 3,
      jointStress: "medium",
      isCompound: true,
      isMainLiftEligible: true,
      movementPatterns: ["horizontal_push"],
      primaryMuscles: ["chest"],
      secondaryMuscles: ["triceps", "front delts"],
      equipment: ["barbell", "bench", "rack"],
    };
    const barbellCurl: RuntimeExerciseSwapProfile = {
      id: "barbell-curl",
      name: "Barbell Curl",
      fatigueCost: 1,
      jointStress: "low",
      isCompound: false,
      isMainLift: false,
      isMainLiftEligible: false,
      movementPatterns: ["flexion", "isolation"],
      primaryMuscles: ["biceps"],
      equipment: ["barbell"],
    };
    const cableCurl: RuntimeExerciseSwapProfile = {
      id: "cable-curl",
      name: "Cable Curl",
      fatigueCost: 2,
      jointStress: "low",
      isCompound: false,
      isMainLiftEligible: false,
      movementPatterns: ["flexion", "isolation"],
      primaryMuscles: ["biceps"],
      equipment: ["cable"],
    };

    expect(
      buildRuntimeExerciseSwapCandidates({
        current: inclineMachinePress,
        candidates: [inclineBarbellBenchPress],
      }),
    ).toEqual([]);
    expect(
      buildRuntimeExerciseSwapCandidates({
        current: barbellCurl,
        candidates: [cableCurl],
      }),
    ).toEqual([]);

    expect(
      buildRuntimeExerciseSwapCandidates({
        current: inclineMachinePress,
        candidates: [inclineBarbellBenchPress],
        includeCautionTier: true,
      }),
    ).toEqual([
      expect.objectContaining({
        exerciseId: "incline-barbell-bench-press",
        movementPatternMatch: "exact",
        fatigueDelta: 1,
        jointStressDelta: 1,
        caution: expect.objectContaining({
          level: "caution",
          copy: expect.stringContaining("higher demand"),
        }),
      }),
    ]);
    expect(
      buildRuntimeExerciseSwapCandidates({
        current: barbellCurl,
        candidates: [cableCurl],
        includeCautionTier: true,
      }),
    ).toEqual([
      expect.objectContaining({
        exerciseId: "cable-curl",
        movementPatternMatch: "exact",
        fatigueDelta: 1,
        jointStressDelta: 0,
        caution: expect.objectContaining({
          level: "caution",
          copy: expect.stringContaining("same-pattern replacement"),
        }),
      }),
    ]);
  });

  it("keeps caution-tier blocked for broad fallback and extreme demand", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: {
        id: "leg-extension",
        name: "Leg Extension",
        fatigueCost: 1,
        jointStress: "low",
        isCompound: false,
        isMainLift: false,
        isMainLiftEligible: false,
        movementPatterns: ["extension", "isolation"],
        primaryMuscles: ["quads"],
        equipment: ["machine"],
      },
      candidates: [
        {
          id: "barbell-back-squat",
          name: "Barbell Back Squat",
          fatigueCost: 4,
          jointStress: "high",
          isCompound: true,
          isMainLiftEligible: true,
          movementPatterns: ["squat"],
          primaryMuscles: ["quads", "glutes"],
          equipment: ["barbell", "rack"],
        },
        {
          id: "high-fatigue-leg-extension",
          name: "High Fatigue Leg Extension",
          fatigueCost: 5,
          jointStress: "medium",
          isCompound: false,
          isMainLiftEligible: false,
          movementPatterns: ["extension", "isolation"],
          primaryMuscles: ["quads"],
          equipment: ["machine"],
        },
      ],
      includeCautionTier: true,
    });

    expect(candidates).toEqual([]);
  });

  it("ranks caution-tier matches below strict matches", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: {
        id: "barbell-curl",
        name: "Barbell Curl",
        fatigueCost: 1,
        jointStress: "low",
        isCompound: false,
        isMainLift: false,
        isMainLiftEligible: false,
        movementPatterns: ["flexion", "isolation"],
        primaryMuscles: ["biceps"],
        equipment: ["barbell"],
      },
      candidates: [
        {
          id: "cable-curl",
          name: "Cable Curl",
          fatigueCost: 2,
          jointStress: "low",
          isCompound: false,
          isMainLiftEligible: false,
          movementPatterns: ["flexion", "isolation"],
          primaryMuscles: ["biceps"],
          equipment: ["cable"],
        },
        {
          id: "ez-bar-curl",
          name: "EZ-Bar Curl",
          fatigueCost: 1,
          jointStress: "low",
          isCompound: false,
          isMainLiftEligible: false,
          movementPatterns: ["flexion", "isolation"],
          primaryMuscles: ["biceps"],
          equipment: ["ez_bar"],
        },
      ],
      includeCautionTier: true,
    });

    expect(candidates.map((candidate) => candidate.exerciseId)).toEqual([
      "ez-bar-curl",
      "cable-curl",
    ]);
    expect(candidates[0].caution).toBeUndefined();
    expect(candidates[1].caution).toBeDefined();
  });

  it("preserves top typed-search caution matches without changing default discovery", () => {
    const strictCurlAlternatives = Array.from({ length: 8 }, (_, index) => ({
      id: `strict-curl-${index + 1}`,
      name: `Strict Curl ${index + 1}`,
      fatigueCost: 1,
      jointStress: "low",
      isCompound: false,
      isMainLiftEligible: false,
      movementPatterns: ["flexion"],
      primaryMuscles: ["biceps"],
      equipment: ["ez_bar"],
    }));
    const current = {
      id: "barbell-curl",
      name: "Barbell Curl",
      fatigueCost: 1,
      jointStress: "low",
      isCompound: false,
      isMainLift: false,
      isMainLiftEligible: false,
      movementPatterns: ["flexion"],
      primaryMuscles: ["biceps"],
      equipment: ["barbell"],
    };
    const dumbbellCurl = {
      id: "dumbbell-curl",
      name: "Dumbbell Curl",
      fatigueCost: 2,
      jointStress: "low",
      isCompound: false,
      isMainLiftEligible: false,
      movementPatterns: ["flexion"],
      primaryMuscles: ["biceps"],
      equipment: ["dumbbell"],
    };

    const defaultCandidates = buildRuntimeExerciseSwapCandidates({
      current,
      candidates: [dumbbellCurl, ...strictCurlAlternatives],
      includeCautionTier: true,
      limit: 8,
    });
    expect(defaultCandidates.map((candidate) => candidate.exerciseId)).not.toContain(
      "dumbbell-curl",
    );

    const typedSearchCandidates = buildRuntimeExerciseSwapCandidates({
      current,
      candidates: [dumbbellCurl, ...strictCurlAlternatives],
      includeCautionTier: true,
      preserveTopTextSearchMatches: true,
      limit: 8,
    });

    expect(typedSearchCandidates).toHaveLength(8);
    expect(typedSearchCandidates.map((candidate) => candidate.exerciseId)).toContain(
      "dumbbell-curl",
    );
    expect(typedSearchCandidates.at(-1)).toMatchObject({
      exerciseId: "dumbbell-curl",
      caution: expect.objectContaining({ level: "caution" }),
    });
  });

  it("blocks isolation fly sources from caution-surfacing barbell main-lift presses", () => {
    const candidates = buildRuntimeExerciseSwapCandidates({
      current: {
        id: "cable-fly",
        name: "Cable Fly",
        fatigueCost: 2,
        jointStress: "low",
        isCompound: false,
        isMainLift: false,
        isMainLiftEligible: false,
        movementPatterns: ["horizontal_push"],
        primaryMuscles: ["chest"],
        equipment: ["cable"],
      },
      candidates: [
        {
          id: "barbell-bench-press",
          name: "Barbell Bench Press",
          fatigueCost: 4,
          jointStress: "medium",
          isCompound: true,
          isMainLiftEligible: true,
          movementPatterns: ["horizontal_push"],
          primaryMuscles: ["chest", "triceps"],
          secondaryMuscles: ["front delts"],
          equipment: ["barbell", "bench"],
        },
      ],
      includeCautionTier: true,
      preserveTopTextSearchMatches: true,
    });

    expect(candidates).toEqual([]);
  });

  it("keeps strict blockers closed for leg-extension and leg-curl typed searches", () => {
    expect(
      buildRuntimeExerciseSwapCandidates({
        current: {
          id: "leg-extension",
          name: "Leg Extension",
          fatigueCost: 1,
          jointStress: "low",
          isCompound: false,
          isMainLift: false,
          isMainLiftEligible: false,
          movementPatterns: ["extension", "isolation"],
          primaryMuscles: ["quads"],
          equipment: ["machine"],
        },
        candidates: [
          {
            id: "barbell-back-squat",
            name: "Barbell Back Squat",
            fatigueCost: 4,
            jointStress: "high",
            isCompound: true,
            isMainLiftEligible: true,
            movementPatterns: ["squat"],
            primaryMuscles: ["quads", "glutes"],
            equipment: ["barbell", "rack"],
          },
        ],
        includeCautionTier: true,
        preserveTopTextSearchMatches: true,
      }),
    ).toEqual([]);

    expect(
      buildRuntimeExerciseSwapCandidates({
        current: {
          id: "seated-leg-curl",
          name: "Seated Leg Curl",
          fatigueCost: 1,
          jointStress: "low",
          isCompound: false,
          isMainLift: false,
          isMainLiftEligible: false,
          movementPatterns: ["flexion", "isolation"],
          primaryMuscles: ["hamstrings"],
          equipment: ["machine"],
        },
        candidates: [
          {
            id: "romanian-deadlift",
            name: "Romanian Deadlift",
            fatigueCost: 3,
            jointStress: "medium",
            isCompound: true,
            isMainLiftEligible: true,
            movementPatterns: ["hinge"],
            primaryMuscles: ["hamstrings", "glutes"],
            equipment: ["barbell"],
          },
          {
            id: "stiff-legged-deadlift",
            name: "Stiff-Legged Deadlift",
            fatigueCost: 3,
            jointStress: "medium",
            isCompound: true,
            isMainLiftEligible: true,
            movementPatterns: ["hinge"],
            primaryMuscles: ["hamstrings", "glutes"],
            equipment: ["barbell"],
          },
        ],
        includeCautionTier: true,
        preserveTopTextSearchMatches: true,
      }),
    ).toEqual([]);
  });

  it("keeps row-anchor main-lift exception closed outside strict row-equivalent guardrails", () => {
    expect(
      evaluateRuntimeExerciseSwapEligibility({
        current: {
          id: "seated-cable-row",
          name: "Seated Cable Row",
          fatigueCost: 2,
          jointStress: "low",
          isMainLift: true,
          isMainLiftEligible: false,
          isCompound: true,
          movementPatterns: ["horizontal_pull"],
          primaryMuscles: ["lats", "upper back"],
          equipment: ["cable", "machine"],
          sourceLane: {
            slotId: "upper_a",
            seedRole: "CORE_COMPOUND",
            laneId: "row_anchor",
            laneRole: "anchor",
            primaryMuscles: ["Upper Back", "Lats"],
            acceptableExerciseClasses: ["horizontal_pull_support"],
            preferredExerciseClasses: ["horizontal_pull_support"],
          },
        },
        candidate: {
          id: "barbell-row",
          name: "Barbell Row",
          fatigueCost: 4,
          jointStress: "high",
          isMainLiftEligible: true,
          isCompound: true,
          movementPatterns: ["horizontal_pull"],
          primaryMuscles: ["lats", "upper back"],
          equipment: ["barbell"],
        },
      }),
    ).toBeNull();

    expect(
      evaluateRuntimeExerciseSwapEligibility({
        current: {
          id: "lat-pulldown",
          name: "Lat Pulldown",
          fatigueCost: 2,
          jointStress: "low",
          isMainLift: true,
          isMainLiftEligible: false,
          isCompound: true,
          movementPatterns: ["vertical_pull"],
          primaryMuscles: ["lats"],
          equipment: ["cable", "machine"],
          sourceLane: {
            slotId: "upper_a",
            seedRole: "CORE_COMPOUND",
            laneId: "vertical_pull_anchor",
            laneRole: "anchor",
            primaryMuscles: ["Lats"],
            acceptableExerciseClasses: ["vertical_pull"],
            preferredExerciseClasses: ["vertical_pull"],
          },
        },
        candidate: {
          id: "barbell-row",
          name: "Barbell Row",
          fatigueCost: 4,
          jointStress: "high",
          isMainLiftEligible: true,
          isCompound: true,
          movementPatterns: ["horizontal_pull"],
          primaryMuscles: ["lats", "upper back"],
          equipment: ["barbell"],
        },
      }),
    ).toBeNull();

    expect(
      evaluateRuntimeExerciseSwapEligibility({
        current: {
          id: "machine-shoulder-press",
          name: "Machine Shoulder Press",
          fatigueCost: 2,
          jointStress: "low",
          isMainLift: true,
          isMainLiftEligible: false,
          isCompound: true,
          movementPatterns: ["vertical_push"],
          primaryMuscles: ["front delts", "side delts"],
          equipment: ["machine"],
          sourceLane: {
            slotId: "upper_b",
            seedRole: "CORE_COMPOUND",
            laneId: "vertical_press",
            laneRole: "anchor",
            primaryMuscles: ["Front Delts", "Side Delts"],
            acceptableExerciseClasses: ["vertical_press"],
            preferredExerciseClasses: ["vertical_press"],
          },
        },
        candidate: {
          id: "db-shoulder-press",
          name: "Dumbbell Shoulder Press",
          fatigueCost: 2,
          jointStress: "low",
          isMainLiftEligible: false,
          isCompound: true,
          movementPatterns: ["vertical_push"],
          primaryMuscles: ["front delts", "side delts"],
          equipment: ["dumbbell"],
        },
      }),
    ).toBeNull();
  });
});
