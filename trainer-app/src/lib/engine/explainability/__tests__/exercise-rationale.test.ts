/**
 * Exercise Rationale Tests
 *
 * Phase 4.3: Per-exercise selection explanation with KB citations and alternatives
 */

import { describe, it, expect } from "vitest";
import type { Exercise, Muscle } from "../../types";
import type { SelectionCandidate, SelectionObjective } from "../../selection-v2/types";
import {
  explainExerciseRationale,
  buildSelectionFactorBreakdown,
  suggestAlternatives,
} from "../exercise-rationale";

// ============================================================================
// Test Fixtures
// ============================================================================

const createExercise = (overrides?: Partial<Exercise>): Exercise => ({
  id: "ex1",
  name: "Bench Press",
  primaryMuscles: ["Chest" as Muscle],
  secondaryMuscles: ["Front Delts" as Muscle, "Triceps" as Muscle],
  equipment: ["barbell"],
  movementPatterns: ["horizontal_push"],
  fatigueCost: 4,
  timePerSetSec: 180,
  sfrScore: 4,
  lengthPositionScore: 3,
  isCompound: true,
  isMainLiftEligible: true,
  difficulty: "intermediate",
  splitTags: ["push"],
  jointStress: "medium",
  isUnilateral: false,
  repRangeMin: 5,
  repRangeMax: 12,
  ...overrides,
});

const createCandidate = (
  exercise: Exercise,
  scores?: Partial<SelectionCandidate["scores"]>
): SelectionCandidate => {
  const volumeContribution = new Map<
    Muscle,
    { direct: number; indirect: number }
  >();
  volumeContribution.set("Chest" as Muscle, { direct: 3, indirect: 0 });
  volumeContribution.set("Front Delts" as Muscle, { direct: 0, indirect: 0.9 });
  volumeContribution.set("Triceps" as Muscle, { direct: 0, indirect: 0.6 });

  return {
    exercise,
    proposedSets: 3,
    volumeContribution,
    timeContribution: 9,
    scores: {
      deficitFill: 0.8,
      rotationNovelty: 0.9,
      sfrScore: 0.8,
      lengthenedScore: 0.6,
      sraAlignment: 0.7,
      userPreference: 0.5,
      movementNovelty: 0.6,
      ...scores,
    },
    totalScore: 0.75,
  };
};

const createObjective = (): SelectionObjective => {
  const weeklyTarget = new Map<Muscle, number>();
  weeklyTarget.set("Chest" as Muscle, 9);
  weeklyTarget.set("Triceps" as Muscle, 6);

  const weeklyActual = new Map<Muscle, number>();
  weeklyActual.set("Chest" as Muscle, 3);
  weeklyActual.set("Triceps" as Muscle, 2);

  const effectiveActual = new Map<Muscle, number>();
  effectiveActual.set("Chest" as Muscle, 3);
  effectiveActual.set("Triceps" as Muscle, 2);

  return {
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map(),
      painConflicts: new Set(),
      userAvoids: new Set(),
      minExercises: 3,
      maxExercises: 8,
    },
    weights: {
      volumeDeficitFill: 0.4,
      rotationNovelty: 0.25,
      sfrEfficiency: 0.15,
      lengthenedBias: 0.1,
      movementDiversity: 0.05,
      sraReadiness: 0.03,
      userPreference: 0.02,
    },
    volumeContext: {
      weeklyTarget,
      weeklyActual,
      effectiveActual,
    },
    rotationContext: new Map(),
    sraContext: new Map(),
    preferences: {
      favoriteExerciseIds: new Set(),
      avoidExerciseIds: new Set(),
    },
  };
};

// ============================================================================
// explainExerciseRationale() Tests
// ============================================================================

describe("explainExerciseRationale", () => {
  it("should return complete ExerciseRationale structure", () => {
    const exercise = createExercise();
    const candidate = createCandidate(exercise);
    const objective = createObjective();
    const library = [exercise];

    const rationale = explainExerciseRationale(candidate, objective, library);

    expect(rationale).toMatchObject({
      exerciseName: "Bench Press",
      primaryReasons: expect.any(Array),
      selectionFactors: expect.any(Object),
      citations: expect.any(Array),
      alternatives: expect.any(Array),
      volumeContribution: expect.any(String),
    });
  });

  it("should extract top 2-3 primary reasons (score > 0.6)", () => {
    const exercise = createExercise();
    const candidate = createCandidate(exercise, {
      deficitFill: 0.9, // Top
      rotationNovelty: 0.8, // Second
      sfrScore: 0.7, // Third
      lengthenedScore: 0.5, // Below threshold
      sraAlignment: 0.4, // Below threshold
    });
    const objective = createObjective();

    const rationale = explainExerciseRationale(candidate, objective, [exercise]);

    expect(rationale.primaryReasons).toHaveLength(3);
    expect(rationale.primaryReasons[0]).toContain("deficit"); // Top reason
    expect(rationale.primaryReasons[1]).toContain("week"); // Rotation novelty
    expect(rationale.primaryReasons[2]).toContain("stimulus-to-fatigue"); // SFR
  });

  it("should extract only 1 primary reason if others are below threshold", () => {
    const exercise = createExercise();
    const candidate = createCandidate(exercise, {
      deficitFill: 0.8,
      rotationNovelty: 0.5,
      sfrScore: 0.4,
      lengthenedScore: 0.3,
      sraAlignment: 0.5,
      userPreference: 0.4,
      movementNovelty: 0.3,
    });
    const objective = createObjective();

    const rationale = explainExerciseRationale(candidate, objective, [exercise]);

    expect(rationale.primaryReasons).toHaveLength(1);
    expect(rationale.primaryReasons[0]).toContain("deficit");
  });

  it("should get KB citations for lengthened exercises", () => {
    const exercise = createExercise({
      name: "Overhead Triceps Extension",
      lengthPositionScore: 5,
    });
    const candidate = createCandidate(exercise);
    const objective = createObjective();

    const rationale = explainExerciseRationale(candidate, objective, [exercise]);

    expect(rationale.citations.length).toBeGreaterThan(0);
    expect(rationale.citations[0]).toMatchObject({
      id: expect.any(String),
      authors: expect.any(String),
      year: expect.any(Number),
      finding: expect.any(String),
    });
  });

  it("should build volume contribution summary", () => {
    const exercise = createExercise();
    const candidate = createCandidate(exercise);
    const objective = createObjective();

    const rationale = explainExerciseRationale(candidate, objective, [exercise]);

    expect(rationale.volumeContribution).toContain("3 sets chest");
    expect(rationale.volumeContribution).toContain("0.9 indirect front delts");
    expect(rationale.volumeContribution).toContain("0.6 indirect triceps");
  });

  it("should suggest alternatives from library", () => {
    const exercise = createExercise({ id: "ex1", name: "Bench Press" });
    const candidate = createCandidate(exercise);
    const objective = createObjective();

    const library = [
      exercise,
      createExercise({ id: "ex2", name: "Dumbbell Bench Press" }),
      createExercise({ id: "ex3", name: "Incline Bench Press" }),
    ];

    const rationale = explainExerciseRationale(candidate, objective, library);

    expect(rationale.alternatives.length).toBeGreaterThan(0);
    expect(rationale.alternatives.length).toBeLessThanOrEqual(3);
  });
});

// ============================================================================
// buildSelectionFactorBreakdown() Tests
// ============================================================================

describe("buildSelectionFactorBreakdown", () => {
  it("should return all 7 selection factors", () => {
    const exercise = createExercise();
    const candidate = createCandidate(exercise);
    const objective = createObjective();

    const breakdown = buildSelectionFactorBreakdown(candidate, objective);

    expect(breakdown).toHaveProperty("deficitFill");
    expect(breakdown).toHaveProperty("rotationNovelty");
    expect(breakdown).toHaveProperty("sfrEfficiency");
    expect(breakdown).toHaveProperty("lengthenedPosition");
    expect(breakdown).toHaveProperty("sraAlignment");
    expect(breakdown).toHaveProperty("userPreference");
    expect(breakdown).toHaveProperty("movementNovelty");
  });

  it("should include score and explanation for each factor", () => {
    const exercise = createExercise();
    const candidate = createCandidate(exercise);
    const objective = createObjective();

    const breakdown = buildSelectionFactorBreakdown(candidate, objective);

    expect(breakdown.deficitFill).toMatchObject({
      score: expect.any(Number),
      explanation: expect.any(String),
    });
    expect(breakdown.deficitFill.score).toBeGreaterThanOrEqual(0);
    expect(breakdown.deficitFill.score).toBeLessThanOrEqual(1);
    expect(breakdown.deficitFill.explanation.length).toBeGreaterThan(0);
  });

  it("should explain high deficit fill correctly", () => {
    const exercise = createExercise();
    const candidate = createCandidate(exercise, { deficitFill: 0.9 });
    const objective = createObjective();

    const breakdown = buildSelectionFactorBreakdown(candidate, objective);

    expect(breakdown.deficitFill.explanation).toContain("50%"); // 3/6 = 50% fill
    expect(breakdown.deficitFill.explanation).toContain("chest");
  });

  it("should explain low deficit fill correctly", () => {
    const exercise = createExercise();
    const candidate = createCandidate(exercise, { deficitFill: 0.1 });
    const objective = createObjective();

    const breakdown = buildSelectionFactorBreakdown(candidate, objective);

    expect(breakdown.deficitFill.explanation).toContain("Minimal");
  });

  it("should explain rotation novelty ranges", () => {
    const exercise = createExercise();
    const objective = createObjective();

    // Never used
    let candidate = createCandidate(exercise, { rotationNovelty: 1.0 });
    let breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.rotationNovelty.explanation).toContain("Never used");

    // Used 1 week ago
    candidate = createCandidate(exercise, { rotationNovelty: 0.7 });
    breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.rotationNovelty.explanation).toContain("week");

    // Used recently
    candidate = createCandidate(exercise, { rotationNovelty: 0.3 });
    breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.rotationNovelty.explanation).toContain("recently");
  });

  it("should explain SFR efficiency ranges", () => {
    const objective = createObjective();

    // High SFR
    let exercise = createExercise({ sfrScore: 5 });
    let candidate = createCandidate(exercise, { sfrScore: 1.0 });
    let breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.sfrEfficiency.explanation).toContain("High stimulus-to-fatigue");
    expect(breakdown.sfrEfficiency.explanation).toContain("5/5");

    // Moderate SFR
    exercise = createExercise({ sfrScore: 3 });
    candidate = createCandidate(exercise, { sfrScore: 0.6 });
    breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.sfrEfficiency.explanation).toContain("Moderate");

    // Low SFR
    exercise = createExercise({ sfrScore: 1 });
    candidate = createCandidate(exercise, { sfrScore: 0.2 });
    breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.sfrEfficiency.explanation).toContain("Lower");
  });

  it("should explain lengthened position ranges", () => {
    const objective = createObjective();

    // High lengthened
    let exercise = createExercise({ lengthPositionScore: 5 });
    let candidate = createCandidate(exercise, { lengthenedScore: 1.0 });
    let breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.lengthenedPosition.explanation).toContain("long length");
    expect(breakdown.lengthenedPosition.explanation).toContain("5/5");

    // Moderate lengthened
    exercise = createExercise({ lengthPositionScore: 3 });
    candidate = createCandidate(exercise, { lengthenedScore: 0.6 });
    breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.lengthenedPosition.explanation).toContain("Moderate");
  });

  it("should explain SRA alignment ranges", () => {
    const exercise = createExercise();
    const objective = createObjective();

    // Fully recovered
    let candidate = createCandidate(exercise, { sraAlignment: 0.9 });
    let breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.sraAlignment.explanation).toContain("fully recovered");

    // Not recovered
    candidate = createCandidate(exercise, { sraAlignment: 0.3 });
    breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.sraAlignment.explanation).toContain("not fully recovered");
  });

  it("should explain user preference ranges", () => {
    const exercise = createExercise();
    const objective = createObjective();

    // Favorite
    let candidate = createCandidate(exercise, { userPreference: 1.0 });
    let breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.userPreference.explanation).toContain("favorite");

    // Neutral
    candidate = createCandidate(exercise, { userPreference: 0.5 });
    breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.userPreference.explanation).toContain("Neutral");

    // Avoid
    candidate = createCandidate(exercise, { userPreference: 0.1 });
    breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.userPreference.explanation).toContain("avoid");
  });

  it("should explain movement novelty ranges", () => {
    const exercise = createExercise();
    const objective = createObjective();

    // Novel movement
    let candidate = createCandidate(exercise, { movementNovelty: 0.9 });
    let breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.movementNovelty.explanation).toContain("Novel");

    // Similar movement
    candidate = createCandidate(exercise, { movementNovelty: 0.3 });
    breakdown = buildSelectionFactorBreakdown(candidate, objective);
    expect(breakdown.movementNovelty.explanation).toContain("Similar");
  });
});

// ============================================================================
// suggestAlternatives() Tests
// ============================================================================

describe("suggestAlternatives", () => {
  it("should find similar exercises based on muscle overlap", () => {
    const exercise = createExercise({
      id: "ex1",
      name: "Bench Press",
      primaryMuscles: ["Chest" as Muscle],
    });

    const library = [
      exercise,
      createExercise({
        id: "ex2",
        name: "Dumbbell Bench Press",
        primaryMuscles: ["Chest" as Muscle],
      }),
      createExercise({
        id: "ex3",
        name: "Squat",
        primaryMuscles: ["Quads" as Muscle],
      }),
    ];

    const alternatives = suggestAlternatives(exercise, library, 3);

    expect(alternatives.length).toBeGreaterThan(0);
    expect(alternatives[0].exerciseName).toBe("Dumbbell Bench Press");
    expect(alternatives[0].similarity).toBeGreaterThan(0.5);
  });

  it("should rank alternatives by similarity score", () => {
    const exercise = createExercise({
      id: "ex1",
      name: "Bench Press",
      primaryMuscles: ["Chest" as Muscle],
      movementPatterns: ["horizontal_push"],
      equipment: ["barbell"],
    });

    const library = [
      exercise,
      createExercise({
        id: "ex2",
        name: "Dumbbell Bench Press",
        primaryMuscles: ["Chest" as Muscle],
        movementPatterns: ["horizontal_push"],
        equipment: ["dumbbell"],
      }),
      createExercise({
        id: "ex3",
        name: "Cable Fly",
        primaryMuscles: ["Chest" as Muscle],
        movementPatterns: ["isolation"],
        equipment: ["cable"],
      }),
    ];

    const alternatives = suggestAlternatives(exercise, library, 3);

    // Dumbbell bench should be more similar (same movement pattern)
    expect(alternatives[0].similarity).toBeGreaterThanOrEqual(alternatives[1].similarity);
  });

  it("should limit to top N alternatives", () => {
    const exercise = createExercise({
      id: "ex1",
      name: "Bench Press",
      primaryMuscles: ["Chest" as Muscle],
    });

    const library = [
      exercise,
      createExercise({ id: "ex2", name: "Alt 1", primaryMuscles: ["Chest" as Muscle] }),
      createExercise({ id: "ex3", name: "Alt 2", primaryMuscles: ["Chest" as Muscle] }),
      createExercise({ id: "ex4", name: "Alt 3", primaryMuscles: ["Chest" as Muscle] }),
      createExercise({ id: "ex5", name: "Alt 4", primaryMuscles: ["Chest" as Muscle] }),
    ];

    const alternatives = suggestAlternatives(exercise, library, 2);

    expect(alternatives).toHaveLength(2);
  });

  it("should exclude the exercise itself", () => {
    const exercise = createExercise({ id: "ex1", name: "Bench Press" });
    const library = [exercise];

    const alternatives = suggestAlternatives(exercise, library, 3);

    expect(alternatives).toHaveLength(0);
  });

  it("should only include exercises with similarity > 0.3", () => {
    const exercise = createExercise({
      id: "ex1",
      name: "Bench Press",
      primaryMuscles: ["Chest" as Muscle],
      movementPatterns: ["horizontal_push"],
    });

    const library = [
      exercise,
      createExercise({
        id: "ex2",
        name: "Similar Exercise",
        primaryMuscles: ["Chest" as Muscle],
        movementPatterns: ["horizontal_push"],
      }),
      createExercise({
        id: "ex3",
        name: "Very Different Exercise",
        primaryMuscles: ["Calves" as Muscle],
        movementPatterns: ["extension"],
        equipment: ["machine"],
      }),
    ];

    const alternatives = suggestAlternatives(exercise, library, 5);

    // Should only include "Similar Exercise", not "Very Different Exercise"
    expect(alternatives.length).toBe(1);
    expect(alternatives[0].exerciseName).toBe("Similar Exercise");
  });

  it("should provide reason for each alternative", () => {
    const exercise = createExercise({
      id: "ex1",
      name: "Bench Press",
      primaryMuscles: ["Chest" as Muscle],
    });

    const library = [
      exercise,
      createExercise({
        id: "ex2",
        name: "Dumbbell Bench Press",
        primaryMuscles: ["Chest" as Muscle],
      }),
    ];

    const alternatives = suggestAlternatives(exercise, library, 3);

    expect(alternatives[0].reason).toBeTruthy();
    expect(alternatives[0].reason.length).toBeGreaterThan(0);
  });

  it("should reward lower fatigue alternatives in similarity", () => {
    const exercise = createExercise({
      id: "ex1",
      name: "Barbell Bench Press",
      primaryMuscles: ["Chest" as Muscle],
      fatigueCost: 5,
    });

    const library = [
      exercise,
      createExercise({
        id: "ex2",
        name: "Machine Chest Press",
        primaryMuscles: ["Chest" as Muscle],
        fatigueCost: 2, // Lower fatigue
      }),
      createExercise({
        id: "ex3",
        name: "Weighted Dip",
        primaryMuscles: ["Chest" as Muscle],
        fatigueCost: 5, // Same fatigue
      }),
    ];

    const alternatives = suggestAlternatives(exercise, library, 3);

    // Machine press should rank higher due to lower fatigue
    const machinePressAlt = alternatives.find((a) => a.exerciseName === "Machine Chest Press");
    const dipAlt = alternatives.find((a) => a.exerciseName === "Weighted Dip");

    expect(machinePressAlt).toBeDefined();
    expect(machinePressAlt!.similarity).toBeGreaterThan(dipAlt!.similarity);
    expect(machinePressAlt!.reason).toContain("lower fatigue");
  });
});
