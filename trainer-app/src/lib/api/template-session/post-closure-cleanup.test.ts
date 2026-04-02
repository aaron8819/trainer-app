import { describe, expect, it } from "vitest";
import type { Exercise } from "@/lib/engine/types";
import type { SelectionOutput } from "@/lib/engine/session-types";
import { applyPostClosureCleanup } from "./post-closure-cleanup";
import type { SelectionObjective } from "./selection-helpers";

function makeExercise(input: {
  id: string;
  name: string;
  movementPatterns: Exercise["movementPatterns"];
  primaryMuscles: string[];
  secondaryMuscles?: string[];
  isMainLiftEligible?: boolean;
  isCompound?: boolean;
  fatigueCost?: number;
  stimulusProfile?: Exercise["stimulusProfile"];
}): Exercise {
  return {
    id: input.id,
    name: input.name,
    movementPatterns: input.movementPatterns,
    splitTags: ["legs"],
    jointStress: "low",
    isMainLiftEligible: input.isMainLiftEligible ?? false,
    isCompound: input.isCompound ?? false,
    fatigueCost: input.fatigueCost ?? 2,
    equipment: ["machine"],
    primaryMuscles: input.primaryMuscles,
    secondaryMuscles: input.secondaryMuscles ?? [],
    stimulusProfile: input.stimulusProfile,
    sfrScore: 4,
    lengthPositionScore: 3,
  };
}

function buildSelection(): SelectionOutput {
  return {
    selectedExerciseIds: ["hack-squat", "seated-leg-curl", "leg-extension"],
    mainLiftIds: ["hack-squat"],
    accessoryIds: ["seated-leg-curl", "leg-extension"],
    perExerciseSetTargets: {
      "hack-squat": 3,
      "seated-leg-curl": 6,
      "leg-extension": 3,
    },
    rationale: {
      "hack-squat": {
        score: 1,
        components: {},
        hardFilterPass: true,
        selectedStep: "main_pick",
        reason: "test",
      },
      "seated-leg-curl": {
        score: 0.8,
        components: {},
        hardFilterPass: true,
        selectedStep: "accessory_pick",
        reason: "closure repair",
      },
      "leg-extension": {
        score: 0.7,
        components: {},
        hardFilterPass: true,
        selectedStep: "accessory_pick",
        reason: "test",
      },
    },
    volumePlanByMuscle: {},
    intentDiagnostics: {
      intent: "lower",
      targetMuscles: [],
      alignedRatio: 1,
      minAlignedRatio: 0,
      selectedCount: 3,
    },
  };
}

function buildObjective(): SelectionObjective {
  return {
    constraints: {
      maxExercises: 6,
      minExercises: 3,
      minMainLifts: 0,
      minAccessories: 0,
      demotedFromMainLift: new Set<string>(),
      painConflicts: new Set<string>(),
      userAvoids: new Set<string>(),
    },
    volumeContext: {
      weeklyTarget: new Map([
        ["Hamstrings", 12],
        ["Quads", 4],
      ]),
      effectiveActual: new Map([
        ["Hamstrings", 3],
        ["Quads", 4],
      ]),
    },
  } as unknown as SelectionObjective;
}

describe("applyPostClosureCleanup", () => {
  const exercises = [
    makeExercise({
      id: "hack-squat",
      name: "Hack Squat",
      movementPatterns: ["squat"],
      primaryMuscles: ["Quads"],
      secondaryMuscles: ["Glutes"],
      isMainLiftEligible: true,
      isCompound: true,
      fatigueCost: 4,
    }),
    makeExercise({
      id: "seated-leg-curl",
      name: "Seated Leg Curl",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Hamstrings"],
      stimulusProfile: {
        hamstrings: 1,
      },
    }),
    makeExercise({
      id: "lying-leg-curl",
      name: "Machine Leg Curl",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Hamstrings"],
      fatigueCost: 1,
      stimulusProfile: {
        hamstrings: 1,
      },
    }),
    makeExercise({
      id: "leg-extension",
      name: "Leg Extension",
      movementPatterns: ["isolation"],
      primaryMuscles: ["Quads"],
      stimulusProfile: {
        quads: 1,
      },
    }),
  ];
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  it("preserves a protected closure repair accessory while the deficit is still unresolved", () => {
    const result = applyPostClosureCleanup({
      selection: buildSelection(),
      objective: buildObjective(),
      exerciseById,
      candidatePool: exercises,
      pinnedExerciseIds: new Set<string>(),
      protectedExerciseIds: new Set(["seated-leg-curl"]),
      sessionIntent: "lower",
    });

    expect(result.selection.selectedExerciseIds).not.toContain("lying-leg-curl");
    expect(result.selection.perExerciseSetTargets["seated-leg-curl"]).toBe(6);
    expect(
      result.tradeoffs.some((tradeoff) => tradeoff.code === "accessory_sibling_split_rebalanced")
    ).toBe(false);
  });

  it("still performs normal sibling cleanup when no protected repair is present", () => {
    const result = applyPostClosureCleanup({
      selection: buildSelection(),
      objective: buildObjective(),
      exerciseById,
      candidatePool: exercises,
      pinnedExerciseIds: new Set<string>(),
      sessionIntent: "lower",
    });

    expect(result.selection.selectedExerciseIds).toContain("lying-leg-curl");
    expect(result.selection.perExerciseSetTargets["seated-leg-curl"]).toBeLessThanOrEqual(4);
    expect(
      result.tradeoffs.some((tradeoff) => tradeoff.code === "accessory_sibling_split_rebalanced")
    ).toBe(true);
  });
});
