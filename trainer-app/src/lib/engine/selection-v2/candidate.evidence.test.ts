import { describe, expect, it } from "vitest";

import { buildCandidate, computeProposedSets } from "./candidate";
import { scoreSessionShapeAlignment } from "./scoring";
import type { SelectionObjective } from "./types";
import type { Exercise } from "../types";
import type { SessionSlotShape } from "@/lib/planning/session-slot-profile";

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
          continuityScope: "slot",
          sessionShape: {
            id: "upper_horizontal_balanced",
            preferredAccessoryPrimaryMuscles: ["Chest", "Upper Back", "Rear Delts"],
            requiredMovementPatterns: ["vertical_pull", "horizontal_pull"],
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

  it("soft-penalizes support-pattern overages after the preferred support budget is filled", () => {
    const verticalPressAccessory: Exercise = {
      id: "machine-shoulder-press",
      name: "Machine Shoulder Press",
      movementPatterns: ["vertical_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
      sfrScore: 4,
      lengthPositionScore: 3,
      equipment: ["machine"],
      primaryMuscles: ["Front Delts", "Side Delts"],
      secondaryMuscles: ["Triceps"],
    };
    const existingVerticalPress: Exercise = {
      id: "incline-db-press",
      name: "Incline Dumbbell Press",
      movementPatterns: ["vertical_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: true,
      isCompound: true,
      fatigueCost: 3,
      sfrScore: 4,
      lengthPositionScore: 3,
      equipment: ["dumbbell"],
      primaryMuscles: ["Chest", "Front Delts"],
      secondaryMuscles: ["Triceps"],
    };
    const existingHorizontalPull: Exercise = {
      id: "chest-supported-row",
      name: "Chest Supported Row",
      movementPatterns: ["horizontal_pull"],
      splitTags: ["pull"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
      sfrScore: 4,
      lengthPositionScore: 3,
      equipment: ["machine"],
      primaryMuscles: ["Upper Back"],
      secondaryMuscles: ["Biceps"],
    };

    const objective = buildObjective();
    const sessionShape: SessionSlotShape = {
      id: "upper_vertical_balanced",
      preferredAccessoryPrimaryMuscles: ["Lats", "Front Delts", "Side Delts"],
      requiredMovementPatterns: ["horizontal_pull"],
      avoidDuplicatePatterns: ["vertical_pull"],
      supportPenaltyPatterns: ["vertical_push"],
      maxPreferredSupportPerPattern: 1,
    };

    const baselineScore = scoreSessionShapeAlignment(
      verticalPressAccessory,
      sessionShape,
      objective
    );
    const penalizedScore = scoreSessionShapeAlignment(
      verticalPressAccessory,
      sessionShape,
      objective,
      [existingVerticalPress, existingHorizontalPull]
    );

    expect(baselineScore).toBeCloseTo(0.75, 6);
    expect(penalizedScore).toBeCloseTo(0.55, 6);
    expect(penalizedScore).toBeLessThan(baselineScore);
  });

  it("penalizes redundant hinge support on lower_a after one hinge is already selected", () => {
    const hingeAccessory: Exercise = {
      id: "back-extension",
      name: "Back Extension",
      movementPatterns: ["hinge"],
      splitTags: ["legs"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
      sfrScore: 4,
      lengthPositionScore: 3,
      equipment: ["machine"],
      primaryMuscles: ["Hamstrings"],
      secondaryMuscles: ["Glutes"],
    };
    const existingHingeAccessory: Exercise = {
      ...hingeAccessory,
      id: "good-morning",
      name: "Good Morning",
      isCompound: true,
    };
    const objective = buildObjective({ sessionIntent: "lower" });
    const sessionShape: SessionSlotShape = {
      id: "lower_squat_dominant",
      preferredAccessoryPrimaryMuscles: ["Quads"],
      requiredMovementPatterns: ["hinge"],
      avoidDuplicatePatterns: ["squat"],
      supportPenaltyPatterns: ["hinge"],
      maxPreferredSupportPerPattern: 1,
    };

    const baselineScore = scoreSessionShapeAlignment(hingeAccessory, sessionShape, objective);
    const penalizedScore = scoreSessionShapeAlignment(
      hingeAccessory,
      sessionShape,
      objective,
      [existingHingeAccessory]
    );

    expect(baselineScore).toBeCloseTo(0.75, 6);
    expect(penalizedScore).toBeCloseTo(0.3, 6);
    expect(penalizedScore).toBeLessThan(baselineScore);
  });

  it("lightly penalizes extra quad-pattern support on lower_b after one squat already exists", () => {
    const squatAccessory: Exercise = {
      id: "leg-press",
      name: "Leg Press",
      movementPatterns: ["squat"],
      splitTags: ["legs"],
      jointStress: "medium",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
      sfrScore: 4,
      lengthPositionScore: 3,
      equipment: ["machine"],
      primaryMuscles: ["Quads", "Glutes"],
      secondaryMuscles: [],
    };
    const existingSquatAccessory: Exercise = {
      ...squatAccessory,
      id: "hack-squat",
      name: "Hack Squat",
    };
    const objective = buildObjective({ sessionIntent: "lower" });
    const sessionShape: SessionSlotShape = {
      id: "lower_hinge_dominant",
      preferredAccessoryPrimaryMuscles: ["Hamstrings", "Glutes"],
      requiredMovementPatterns: ["squat"],
      avoidDuplicatePatterns: ["hinge"],
      supportPenaltyPatterns: ["squat"],
      maxPreferredSupportPerPattern: 1,
    };

    const baselineScore = scoreSessionShapeAlignment(squatAccessory, sessionShape, objective);
    const penalizedScore = scoreSessionShapeAlignment(
      squatAccessory,
      sessionShape,
      objective,
      [existingSquatAccessory]
    );

    expect(baselineScore).toBeCloseTo(0.875, 6);
    expect(penalizedScore).toBeCloseTo(0.425, 6);
    expect(penalizedScore).toBeLessThan(baselineScore);
  });

  it("still favors the first hinge support on lower_a before required coverage is satisfied", () => {
    const hingeAccessory: Exercise = {
      id: "back-extension",
      name: "Back Extension",
      movementPatterns: ["hinge"],
      splitTags: ["legs"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
      sfrScore: 4,
      lengthPositionScore: 3,
      equipment: ["machine"],
      primaryMuscles: ["Hamstrings"],
      secondaryMuscles: ["Glutes"],
    };
    const kneeFlexionAccessory: Exercise = {
      id: "leg-curl",
      name: "Leg Curl",
      movementPatterns: ["flexion"],
      splitTags: ["legs"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 1,
      sfrScore: 4,
      lengthPositionScore: 4,
      equipment: ["machine"],
      primaryMuscles: ["Hamstrings"],
      secondaryMuscles: [],
    };
    const objective = buildObjective({ sessionIntent: "lower" });
    const sessionShape: SessionSlotShape = {
      id: "lower_squat_dominant",
      preferredAccessoryPrimaryMuscles: ["Quads"],
      requiredMovementPatterns: ["hinge"],
      avoidDuplicatePatterns: ["squat"],
      supportPenaltyPatterns: ["hinge"],
      maxPreferredSupportPerPattern: 1,
    };

    const hingeScore = scoreSessionShapeAlignment(hingeAccessory, sessionShape, objective);
    const kneeFlexionScore = scoreSessionShapeAlignment(
      kneeFlexionAccessory,
      sessionShape,
      objective
    );

    expect(hingeScore).toBeCloseTo(0.75, 6);
    expect(kneeFlexionScore).toBeCloseTo(0.5, 6);
    expect(hingeScore).toBeGreaterThan(kneeFlexionScore);
  });

  it("keeps fallback behavior soft instead of hard-blocking over-budget support", () => {
    const verticalPressAccessory: Exercise = {
      id: "machine-shoulder-press",
      name: "Machine Shoulder Press",
      movementPatterns: ["vertical_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
      sfrScore: 4,
      lengthPositionScore: 3,
      equipment: ["machine"],
      primaryMuscles: ["Front Delts", "Side Delts"],
      secondaryMuscles: ["Triceps"],
    };
    const existingVerticalPress: Exercise = {
      id: "incline-db-press",
      name: "Incline Dumbbell Press",
      movementPatterns: ["vertical_push"],
      splitTags: ["push"],
      jointStress: "medium",
      isMainLiftEligible: true,
      isCompound: true,
      fatigueCost: 3,
      sfrScore: 4,
      lengthPositionScore: 3,
      equipment: ["dumbbell"],
      primaryMuscles: ["Chest", "Front Delts"],
      secondaryMuscles: ["Triceps"],
    };
    const existingHorizontalPull: Exercise = {
      id: "chest-supported-row",
      name: "Chest Supported Row",
      movementPatterns: ["horizontal_pull"],
      splitTags: ["pull"],
      jointStress: "low",
      isMainLiftEligible: false,
      isCompound: false,
      fatigueCost: 2,
      sfrScore: 4,
      lengthPositionScore: 3,
      equipment: ["machine"],
      primaryMuscles: ["Upper Back"],
      secondaryMuscles: ["Biceps"],
    };
    const objective = buildObjective();
    const sessionShape: SessionSlotShape = {
      id: "upper_vertical_balanced",
      preferredAccessoryPrimaryMuscles: ["Lats", "Front Delts", "Side Delts"],
      requiredMovementPatterns: ["horizontal_pull"],
      avoidDuplicatePatterns: ["vertical_pull"],
      supportPenaltyPatterns: ["vertical_push"],
      maxPreferredSupportPerPattern: 1,
    };

    const penalizedScore = scoreSessionShapeAlignment(
      verticalPressAccessory,
      sessionShape,
      objective,
      [existingVerticalPress, existingHorizontalPull]
    );

    expect(penalizedScore).toBeGreaterThan(0);
    expect(penalizedScore).toBeCloseTo(0.55, 6);
  });
});
