import { afterEach, describe, expect, it, vi } from "vitest";

import type { Exercise } from "../types";
import type { SelectionObjective } from "./types";

function buildObjective(overrides?: Partial<SelectionObjective>): SelectionObjective {
  return {
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map([["Triceps", 20]]),
      painConflicts: new Set(),
      userAvoids: new Set(),
      minExercises: 1,
      maxExercises: 3,
      minMainLifts: 0,
      maxMainLifts: 1,
      minAccessories: 0,
    },
    weights: {
      volumeDeficitFill: 0.33,
      rotationNovelty: 0.22,
      sfrEfficiency: 0.12,
      lengthenedBias: 0.2,
      movementDiversity: 0.07,
      sraReadiness: 0.05,
      userPreference: 0.01,
    },
    volumeContext: {
      weeklyTarget: new Map([["Triceps", 10]]),
      weeklyActual: new Map(),
      effectiveActual: new Map(),
    },
    rotationContext: new Map(),
    sraContext: new Map(),
    preferences: {
      favoriteExerciseIds: new Set(),
      avoidExerciseIds: new Set(),
    },
    goals: { primary: "hypertrophy", secondary: "none", isStrengthFocused: false, isHypertrophyFocused: true },
    trainingAge: "intermediate",
    sessionIntent: "push",
    ...overrides,
  };
}

describe("selection optimizer evidence guardrails", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("keeps the optimizer beam result instead of post-hoc stretch swapping", async () => {
    const beamSearch = vi.fn((candidates: Array<{ exercise: Exercise; proposedSets: number; timeContribution: number }>) => {
      const selected = candidates.find((candidate) => candidate.exercise.id === "skull-crusher");
      const betterAlternative = candidates.find((candidate) => candidate.exercise.id === "oh-tri-ext");
      if (!selected || !betterAlternative) {
        throw new Error("Expected mocked candidates were not built");
      }

      return {
        selected: [selected],
        rejected: [{ exercise: betterAlternative.exercise, reason: "dominated_by_better_option" as const }],
        volumeFilled: new Map([["Triceps", selected.proposedSets]]),
        volumeDeficit: new Map(),
        timeUsed: selected.timeContribution,
        constraintsSatisfied: true,
        rationale: {
          overallStrategy: "mocked beam result",
          perExercise: new Map([[selected.exercise.id, "mocked selection"]]),
        },
      };
    });

    vi.doMock("./beam-search", () => ({ beamSearch }));
    const { selectExercisesOptimized } = await import("./optimizer");

    const pool: Exercise[] = [
      {
        id: "skull-crusher",
        name: "EZ-Bar Skull Crusher",
        movementPatterns: ["extension", "isolation"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        sfrScore: 4,
        lengthPositionScore: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Triceps"],
        secondaryMuscles: [],
      },
      {
        id: "oh-tri-ext",
        name: "Overhead Cable Triceps Extension",
        movementPatterns: ["extension", "isolation"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        sfrScore: 5,
        lengthPositionScore: 5,
        equipment: ["cable"],
        primaryMuscles: ["Triceps"],
        secondaryMuscles: [],
      },
    ];

    const result = selectExercisesOptimized(pool, buildObjective());

    expect(beamSearch).toHaveBeenCalledOnce();
    expect(
      result.selected.map((candidate: { exercise: Exercise }) => candidate.exercise.id)
    ).toEqual(["skull-crusher"]);
    expect(
      result.rejected.some((entry: { exercise: Exercise }) => entry.exercise.id === "oh-tri-ext")
    ).toBe(true);
  });

  it("enforces resolved compound-lane satisfaction before accepting fallback compounds", async () => {
    vi.doUnmock("./beam-search");
    const { selectExercisesOptimized } = await import("./optimizer");

    const pool: Exercise[] = [
      {
        id: "bench",
        name: "Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 5,
        lengthPositionScore: 4,
        equipment: ["barbell"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
      },
      {
        id: "ohp",
        name: "Overhead Press",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 3,
        lengthPositionScore: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Front Delts", "Chest"],
        secondaryMuscles: ["Triceps"],
      },
      {
        id: "lateral",
        name: "Lateral Raise",
        movementPatterns: ["isolation"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 1,
        sfrScore: 4,
        lengthPositionScore: 3,
        equipment: ["cable"],
        primaryMuscles: ["Side Delts"],
        secondaryMuscles: [],
      },
    ];

    const result = selectExercisesOptimized(
      pool,
      buildObjective({
        constraints: {
          ...buildObjective().constraints,
          minExercises: 2,
          maxExercises: 2,
          minMainLifts: 1,
          maxMainLifts: 2,
          minAccessories: 0,
        },
        volumeContext: {
          weeklyTarget: new Map([
            ["Chest", 10],
            ["Front Delts", 10],
          ]),
          weeklyActual: new Map(),
          effectiveActual: new Map(),
        },
        resolvedCompoundControl: {
          lanes: [
            {
              key: "press",
              preferredMovementPatterns: ["vertical_push"],
              compatibleMovementPatterns: [],
              fallbackOnlyMovementPatterns: ["horizontal_push"],
              activeTier: "preferred",
              viableCandidateCountByTier: {
                preferred: 1,
                compatible: 0,
                fallback_only: 1,
              },
            },
          ],
        },
      })
    );

    expect(result.selected.map((candidate) => candidate.exercise.id)).toContain("ohp");
    expect(result.constraintsSatisfied).toBe(true);
  });
});
