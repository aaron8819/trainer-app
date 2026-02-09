import { describe, expect, it } from "vitest";
import { pickAccessoriesBySlot } from "./pick-accessories-by-slot";
import type { Exercise } from "./types";

const pushMainLifts: Exercise[] = [
  {
    id: "bench",
    name: "Barbell Bench Press",
    movementPatterns: ["horizontal_push"],
    splitTags: ["push"],
    jointStress: "high",
    isMainLiftEligible: true,
    isCompound: true,
    fatigueCost: 4,
    equipment: ["barbell"],
    primaryMuscles: ["Chest", "Triceps"],
  },
  {
    id: "ohp",
    name: "Overhead Press",
    movementPatterns: ["vertical_push"],
    splitTags: ["push"],
    jointStress: "high",
    isMainLiftEligible: true,
    isCompound: true,
    fatigueCost: 4,
    equipment: ["barbell"],
    primaryMuscles: ["Front Delts", "Triceps"],
  },
];

describe("pickAccessoriesBySlot", () => {
  it("selects push day slot accessories in order", () => {
    const accessoryPool: Exercise[] = [
      {
        id: "cable-fly",
        name: "Cable Fly",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        stimulusBias: ["stretch"],
        equipment: ["cable"],
        primaryMuscles: ["Chest"],
      },
      {
        id: "lateral-raise",
        name: "Lateral Raise",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        stimulusBias: ["metabolic"],
        equipment: ["dumbbell"],
        primaryMuscles: ["Side Delts"],
      },
      {
        id: "pushdown",
        name: "Triceps Pushdown",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        stimulusBias: ["metabolic"],
        equipment: ["cable"],
        primaryMuscles: ["Triceps"],
      },
    ];

    const picks = pickAccessoriesBySlot({
      dayTag: "push",
      accessoryPool,
      mainLifts: pushMainLifts,
      maxAccessories: 3,
    });

    expect(picks.map((item) => item.name)).toEqual([
      "Cable Fly",
      "Lateral Raise",
      "Triceps Pushdown",
    ]);
  });

  it("uses fill slots to prioritize uncovered muscles", () => {
    const mainLifts: Exercise[] = [
      {
        id: "squat",
        name: "Back Squat",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "high",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
        primaryMuscles: ["Quads", "Glutes"],
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
        equipment: ["barbell"],
        primaryMuscles: ["Hamstrings", "Glutes"],
      },
    ];

    const accessoryPool: Exercise[] = [
      {
        id: "leg-extension",
        name: "Leg Extension",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Quads"],
      },
      {
        id: "leg-curl",
        name: "Leg Curl",
        movementPatterns: ["hinge"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Hamstrings"],
      },
      {
        id: "hip-thrust",
        name: "Hip Thrust",
        movementPatterns: ["hinge"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: false,
        isCompound: true,
        fatigueCost: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Glutes"],
      },
      {
        id: "calf-raise",
        name: "Standing Calf Raise",
        movementPatterns: ["carry"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Calves"],
      },
      {
        id: "adductor",
        name: "Adductor Machine",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Adductors"],
      },
    ];

    const picks = pickAccessoriesBySlot({
      dayTag: "legs",
      accessoryPool,
      mainLifts,
      maxAccessories: 5,
    });

    expect(picks).toHaveLength(5);
    expect(picks[picks.length - 1].name).toBe("Adductor Machine");
    expect(new Set(picks.map((item) => item.id)).size).toBe(picks.length);
  });

  it("deprioritizes recently used accessories with a seeded RNG", () => {
    const accessoryPool: Exercise[] = [
      {
        id: "cable-fly",
        name: "Cable Fly",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        stimulusBias: ["stretch"],
        equipment: ["cable"],
        primaryMuscles: ["Chest"],
      },
      {
        id: "pec-deck",
        name: "Pec Deck",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        stimulusBias: ["stretch"],
        equipment: ["machine"],
        primaryMuscles: ["Chest"],
      },
    ];

    const history = [
      {
        date: new Date("2026-02-04T10:00:00Z").toISOString(),
        completed: true,
        exercises: [
          {
            exerciseId: "cable-fly",
            movementPattern: "push",
            sets: [{ exerciseId: "cable-fly", setIndex: 1, reps: 12 }],
          },
        ],
      },
    ];

    const picks = pickAccessoriesBySlot({
      dayTag: "push",
      accessoryPool,
      mainLifts: pushMainLifts,
      maxAccessories: 1,
      history,
      randomSeed: 1,
    });

    expect(picks[0].name).toBe("Pec Deck");
  });

  it("prefers non-compound exercises for isolation slots with compound fallback", () => {
    const legsMainLifts: Exercise[] = [
      {
        id: "squat",
        name: "Back Squat",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "high",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
        primaryMuscles: ["Quads", "Glutes"],
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
        equipment: ["barbell"],
        primaryMuscles: ["Hamstrings", "Glutes"],
      },
    ];

    const accessoryPool: Exercise[] = [
      {
        id: "leg-press",
        name: "Leg Press",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: false,
        isCompound: true,
        fatigueCost: 3,
        equipment: ["machine"],
        primaryMuscles: ["Quads"],
      },
      {
        id: "leg-extension",
        name: "Leg Extension",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Quads"],
      },
      {
        id: "leg-curl",
        name: "Leg Curl",
        movementPatterns: ["hinge"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Hamstrings"],
      },
      {
        id: "hip-thrust",
        name: "Hip Thrust",
        movementPatterns: ["hinge"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: false,
        isCompound: true,
        fatigueCost: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Glutes"],
      },
      {
        id: "calf-raise",
        name: "Standing Calf Raise",
        movementPatterns: ["carry"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Calves"],
      },
    ];

    const picks = pickAccessoriesBySlot({
      dayTag: "legs",
      accessoryPool,
      mainLifts: legsMainLifts,
      maxAccessories: 4,
      randomSeed: 42,
    });

    // quad_isolation slot should prefer Leg Extension (non-compound) over Leg Press (compound)
    const quadPick = picks.find((p) => p.primaryMuscles?.includes("Quads"));
    expect(quadPick?.name).toBe("Leg Extension");

    // hamstring_isolation slot should pick Leg Curl (non-compound)
    const hamPick = picks.find((p) => p.primaryMuscles?.includes("Hamstrings"));
    expect(hamPick?.name).toBe("Leg Curl");
  });

  it("deprioritizes candidates that would exceed volume caps", () => {
    const accessoryPool: Exercise[] = [
      {
        id: "cable-fly",
        name: "Cable Fly",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        stimulusBias: ["stretch"],
        equipment: ["cable"],
        primaryMuscles: ["Chest"],
      },
      {
        id: "lateral-raise",
        name: "Lateral Raise",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        stimulusBias: ["metabolic"],
        equipment: ["dumbbell"],
        primaryMuscles: ["Side Delts"],
      },
      {
        id: "pushdown",
        name: "Triceps Pushdown",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        stimulusBias: ["metabolic"],
        equipment: ["cable"],
        primaryMuscles: ["Triceps"],
      },
      {
        id: "reverse-fly",
        name: "Reverse Fly",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        stimulusBias: ["metabolic"],
        equipment: ["dumbbell"],
        primaryMuscles: ["Rear Delts", "Upper Back"],
      },
      {
        id: "dumbbell-curl",
        name: "Dumbbell Curl",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["dumbbell"],
        primaryMuscles: ["Biceps"],
      },
    ];

    const picks = pickAccessoriesBySlot({
      dayTag: "push",
      accessoryPool,
      mainLifts: pushMainLifts,
      maxAccessories: 4,
      randomSeed: 42,
      volumeContext: {
        recent: {
          "Rear Delts": 4,
          "Upper Back": 4,
        },
        previous: {
          "Rear Delts": 4,
          "Upper Back": 4,
        },
      },
      mainLiftSetCount: 4,
      accessorySetCount: 3,
    });

    expect(picks[picks.length - 1].name).toBe("Dumbbell Curl");
  });
});
