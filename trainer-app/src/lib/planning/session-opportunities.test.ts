import { describe, expect, it } from "vitest";

import type { Exercise } from "@/lib/engine/types";
import {
  SESSION_INTENT_KEYS,
  exerciseMatchesOpportunityRegion,
  filterPoolForSessionInventory,
  getSessionAnchorPolicy,
  getSessionMuscleOpportunityWeight,
  getSessionOpportunityDefinition,
  getTemplateIntentPriorityForSessionIntent,
  inferPrimarySplitIntentFromExercises,
  inferUpperLowerIntentFromTargets,
  isExerciseEligibleForSessionInventory,
  isExerciseAlignedToSessionOpportunity,
} from "./session-opportunities";

function makeExercise(input: Partial<Exercise> & Pick<Exercise, "id" | "name">): Exercise {
  return {
    id: input.id,
    name: input.name,
    movementPatterns: input.movementPatterns ?? ["isolation"],
    splitTags: input.splitTags ?? [],
    jointStress: input.jointStress ?? "medium",
    equipment: input.equipment ?? ["machine"],
    primaryMuscles: input.primaryMuscles ?? [],
    secondaryMuscles: input.secondaryMuscles ?? [],
    isMainLiftEligible: input.isMainLiftEligible ?? true,
    isCompound: input.isCompound ?? true,
    fatigueCost: input.fatigueCost ?? 3,
    sfrScore: input.sfrScore ?? 3,
    lengthPositionScore: input.lengthPositionScore ?? 3,
  };
}

describe("session opportunity definitions", () => {
  it("defines every supported session intent in one centralized registry", () => {
    expect(SESSION_INTENT_KEYS).toEqual([
      "push",
      "pull",
      "legs",
      "upper",
      "lower",
      "full_body",
      "body_part",
    ]);

    for (const intent of SESSION_INTENT_KEYS) {
      expect(getSessionOpportunityDefinition(intent).intent).toBe(intent);
    }
  });

  it("preserves current exercise alignment semantics across session archetypes", () => {
    const bench = makeExercise({
      id: "bench",
      name: "Bench Press",
      splitTags: ["push"],
      primaryMuscles: ["Chest"],
    });
    const squat = makeExercise({
      id: "squat",
      name: "Back Squat",
      splitTags: ["legs"],
      primaryMuscles: ["Quads", "Glutes"],
    });
    const curl = makeExercise({
      id: "curl",
      name: "Cable Curl",
      primaryMuscles: ["Biceps"],
      splitTags: [],
      isCompound: false,
    });

    expect(isExerciseAlignedToSessionOpportunity(bench, "push")).toBe(true);
    expect(isExerciseAlignedToSessionOpportunity(squat, "push")).toBe(false);
    expect(isExerciseAlignedToSessionOpportunity(bench, "upper")).toBe(true);
    expect(isExerciseAlignedToSessionOpportunity(squat, "upper")).toBe(false);
    expect(isExerciseAlignedToSessionOpportunity(squat, "lower")).toBe(true);
    expect(isExerciseAlignedToSessionOpportunity(curl, "full_body")).toBe(true);
    expect(
      isExerciseAlignedToSessionOpportunity(curl, "body_part", ["Biceps"])
    ).toBe(true);
    expect(isExerciseAlignedToSessionOpportunity(curl, "body_part")).toBe(false);
  });

  it("exposes current muscle opportunity weights for selection and remaining-week planning", () => {
    expect(getSessionMuscleOpportunityWeight("push", "Chest")).toBe(1);
    expect(getSessionMuscleOpportunityWeight("upper", "Upper Back")).toBe(0.8);
    expect(getSessionMuscleOpportunityWeight("upper", "Quads")).toBe(0);
    expect(getSessionMuscleOpportunityWeight("full_body", "Chest")).toBe(0.65);
    expect(getSessionMuscleOpportunityWeight("full_body", "Quads")).toBe(0.55);
    expect(
      getSessionMuscleOpportunityWeight("body_part", "Biceps", {
        targetMuscles: ["Biceps"],
      })
    ).toBe(1);
    expect(
      getSessionMuscleOpportunityWeight("body_part", "Chest", {
        targetMuscles: ["Biceps"],
      })
    ).toBe(0);
    expect(
      getSessionMuscleOpportunityWeight("body_part", "Chest", {
        purpose: "future_slot",
      })
    ).toBe(0.35);
  });

  it("keeps auxiliary intent inference aligned with the same session opportunity layer", () => {
    expect(
      inferPrimarySplitIntentFromExercises([
        makeExercise({ id: "bench", name: "Bench", splitTags: ["push"] }),
        makeExercise({ id: "press", name: "Press", splitTags: ["push"] }),
        makeExercise({ id: "row", name: "Row", splitTags: ["pull"] }),
      ])
    ).toBe("push");
    expect(inferUpperLowerIntentFromTargets(["Hamstrings", "Calves"])).toBe("lower");
    expect(inferUpperLowerIntentFromTargets(["Chest", "Biceps"])).toBe("upper");
    expect(getTemplateIntentPriorityForSessionIntent("upper")[0]).toBe("UPPER_LOWER");
  });

  it("distinguishes standard, closure, and rescue inventory for specialized body-part sessions", () => {
    const closeGripBench = makeExercise({
      id: "close-grip-bench",
      name: "Close-Grip Bench Press",
      splitTags: ["push"],
      primaryMuscles: ["Triceps"],
      secondaryMuscles: ["Chest"],
      stimulusProfile: {
        triceps: 1,
        chest: 0.35,
      },
    });

    expect(
      isExerciseEligibleForSessionInventory(
        closeGripBench,
        "body_part",
        "standard",
        ["Chest"]
      )
    ).toBe(false);
    expect(
      isExerciseEligibleForSessionInventory(
        closeGripBench,
        "body_part",
        "closure",
        ["Chest"]
      )
    ).toBe(true);
    expect(
      isExerciseEligibleForSessionInventory(
        closeGripBench,
        "body_part",
        "rescue",
        ["Chest"]
      )
    ).toBe(true);
    expect(
      filterPoolForSessionInventory([closeGripBench], "body_part", "standard", ["Chest"])
    ).toHaveLength(0);
    expect(
      filterPoolForSessionInventory([closeGripBench], "body_part", "closure", ["Chest"])
    ).toHaveLength(1);
  });

  it("classifies session regions consistently for full-body coverage checks", () => {
    const row = makeExercise({
      id: "row",
      name: "Chest Supported Row",
      splitTags: ["pull"],
      primaryMuscles: ["Lats", "Upper Back"],
    });
    const lunge = makeExercise({
      id: "lunge",
      name: "Walking Lunge",
      primaryMuscles: ["Quads", "Glutes"],
    });

    expect(exerciseMatchesOpportunityRegion(row, "upper")).toBe(true);
    expect(exerciseMatchesOpportunityRegion(row, "lower")).toBe(false);
    expect(exerciseMatchesOpportunityRegion(lunge, "lower")).toBe(true);
  });

  it("centralizes anchor policy alongside session opportunity semantics", () => {
    expect(getSessionAnchorPolicy("push")).toEqual({
      coreMinimumSets: 1,
      accessoryMinimumSets: 0,
      coreDeferredDeficitCarryFraction: 0.4,
      accessoryDeferredDeficitCarryFraction: 0.25,
      supplementalInventory: "closure",
    });
  });
});
