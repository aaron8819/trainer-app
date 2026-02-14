/**
 * Tests for rationale.ts - Explainability generation
 */

import { describe, it, expect } from "vitest";
import { generateRationale } from "./rationale";
import type { Exercise, Muscle } from "../types";
import type { SelectionObjective, SelectionCandidate, RejectedExercise } from "./types";

describe("generateRationale", () => {
  const createMockCandidate = (
    id: string,
    scores: Partial<SelectionCandidate["scores"]> = {}
  ): SelectionCandidate => ({
    exercise: {
      id,
      name: id.replace("_", " "),
      primaryMuscles: ["Chest" as Muscle],
      secondaryMuscles: [],
      equipment: ["barbell"],
      repRangeMin: 5,
      repRangeMax: 8,
      timePerSetSec: 60,
      fatigueCost: 3,
      sfrScore: 4,
      lengthPositionScore: 3,
    },
    proposedSets: 3,
    volumeContribution: new Map(),
    timeContribution: 10,
    scores: {
      deficitFill: scores.deficitFill ?? 0.8,
      rotationNovelty: scores.rotationNovelty ?? 0.5,
      sfrScore: scores.sfrScore ?? 0.8,
      lengthenedScore: scores.lengthenedScore ?? 0.6,
      movementNovelty: scores.movementNovelty ?? 1.0,
      sraAlignment: scores.sraAlignment ?? 0.9,
      userPreference: scores.userPreference ?? 0.5,
    },
    totalScore: 0.7,
  });

  const mockObjective: SelectionObjective = {
    constraints: {
      volumeFloor: new Map(),
      volumeCeiling: new Map(),
      timeBudget: 60,
      equipment: new Set(["barbell"]),
      contraindications: new Set(),
      minExercises: 1,
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
      weeklyTarget: new Map([["Chest" as Muscle, 12]]),
      weeklyActual: new Map(),
      effectiveActual: new Map(),
    },
    rotationContext: new Map(),
    sraContext: new Map(),
    preferences: {
      favoriteExerciseIds: new Set(),
      avoidExerciseIds: new Set(),
    },
  };

  it("should generate overall strategy", () => {
    const selected = [
      createMockCandidate("bench_press"),
      createMockCandidate("incline_press"),
    ];

    const rejected: RejectedExercise[] = [];

    const rationale = generateRationale(selected, rejected, mockObjective);

    expect(typeof rationale.overallStrategy).toBe("string");
    expect(rationale.overallStrategy.length).toBeGreaterThan(0);
  });

  it("should generate per-exercise rationale for all selected", () => {
    const selected = [
      createMockCandidate("bench_press", { deficitFill: 0.9, rotationNovelty: 0.8 }),
      createMockCandidate("incline_press", { deficitFill: 0.7, sfrScore: 1.0 }),
    ];

    const rejected: RejectedExercise[] = [];

    const rationale = generateRationale(selected, rejected, mockObjective);

    expect(rationale.perExercise.size).toBe(2);
    expect(rationale.perExercise.has("bench_press")).toBe(true);
    expect(rationale.perExercise.has("incline_press")).toBe(true);

    // Each rationale should be non-empty
    const benchRationale = rationale.perExercise.get("bench_press");
    expect(typeof benchRationale).toBe("string");
    expect(benchRationale!.length).toBeGreaterThan(0);

    const inclineRationale = rationale.perExercise.get("incline_press");
    expect(typeof inclineRationale).toBe("string");
    expect(inclineRationale!.length).toBeGreaterThan(0);
  });

  it("should generate non-empty rationale for high deficit fill score", () => {
    const selected = [
      createMockCandidate("bench_press", { deficitFill: 0.95 }),
    ];

    const rejected: RejectedExercise[] = [];

    const rationale = generateRationale(selected, rejected, mockObjective);

    const benchRationale = rationale.perExercise.get("bench_press");
    expect(benchRationale).toBeDefined();
    expect(benchRationale!.length).toBeGreaterThan(0);
  });

  it("should generate non-empty rationale for high rotation novelty score", () => {
    const selected = [
      createMockCandidate("bench_press", { rotationNovelty: 1.0 }),
    ];

    const rejected: RejectedExercise[] = [];

    const rationale = generateRationale(selected, rejected, mockObjective);

    const benchRationale = rationale.perExercise.get("bench_press");
    expect(benchRationale).toBeDefined();
    expect(benchRationale!.length).toBeGreaterThan(0);
  });

  it("should generate non-empty rationale for high SFR score", () => {
    const selected = [
      createMockCandidate("bench_press", { sfrScore: 1.0 }),
    ];

    const rejected: RejectedExercise[] = [];

    const rationale = generateRationale(selected, rejected, mockObjective);

    const benchRationale = rationale.perExercise.get("bench_press");
    expect(benchRationale).toBeDefined();
    expect(benchRationale!.length).toBeGreaterThan(0);
  });

  it("should generate non-empty rationale for high lengthened score", () => {
    const selected = [
      createMockCandidate("bench_press", { lengthenedScore: 1.0 }),
    ];

    const rejected: RejectedExercise[] = [];

    const rationale = generateRationale(selected, rejected, mockObjective);

    const benchRationale = rationale.perExercise.get("bench_press");
    expect(benchRationale).toBeDefined();
    expect(benchRationale!.length).toBeGreaterThan(0);
  });

  it("should handle empty selection", () => {
    const selected: SelectionCandidate[] = [];
    const rejected: RejectedExercise[] = [];

    const rationale = generateRationale(selected, rejected, mockObjective);

    expect(rationale.overallStrategy).toBeDefined();
    expect(rationale.perExercise.size).toBe(0);
  });

  it("should not include alternativesConsidered by default", () => {
    const selected = [createMockCandidate("bench_press")];
    const rejected: RejectedExercise[] = [];

    const rationale = generateRationale(selected, rejected, mockObjective);

    expect(rationale.alternativesConsidered).toBeUndefined();
  });

  it("should generate concise rationale strings", () => {
    const selected = [
      createMockCandidate("bench_press", { deficitFill: 0.9, rotationNovelty: 0.8 }),
    ];

    const rejected: RejectedExercise[] = [];

    const rationale = generateRationale(selected, rejected, mockObjective);

    const benchRationale = rationale.perExercise.get("bench_press");
    expect(benchRationale).toBeDefined();

    // Should be 1-3 sentences (roughly < 300 chars)
    expect(benchRationale!.length).toBeLessThan(300);
  });
});
