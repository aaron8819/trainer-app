import { describe, it, expect } from "vitest";
import {
  analyzeTemplate,
  scoreToLabel,
  scoreSfrEfficiency,
  scoreLengthPosition,
  scoreExerciseOrder,
  type AnalysisExerciseInput,
} from "./template-analysis";
import { exampleExerciseLibrary } from "./sample-data";
import type { Exercise } from "./types";

function findExercise(id: string): Exercise {
  const ex = exampleExerciseLibrary.find((entry) => entry.id === id);
  if (!ex) throw new Error(`Exercise ${id} not found in sample data`);
  return ex;
}

function toAnalysisInput(
  ex: Exercise,
  overrides?: Partial<AnalysisExerciseInput>
): AnalysisExerciseInput {
  return {
    isCompound: ex.isCompound ?? false,
    isMainLiftEligible: ex.isMainLiftEligible,
    movementPatterns: ex.movementPatterns,
    muscles: [
      ...(ex.primaryMuscles ?? []).map((name) => ({ name, role: "primary" as const })),
      ...(ex.secondaryMuscles ?? []).map((name) => ({ name, role: "secondary" as const })),
    ],
    sfrScore: ex.sfrScore,
    lengthPositionScore: ex.lengthPositionScore,
    fatigueCost: ex.fatigueCost,
    ...overrides,
  };
}

const BENCH = toAnalysisInput({ ...findExercise("bench"), isCompound: true });
const ROW = toAnalysisInput({ ...findExercise("row"), isCompound: true });
const SQUAT = toAnalysisInput({ ...findExercise("squat"), isCompound: true });
const RDL = toAnalysisInput({ ...findExercise("rdl"), isCompound: true });
const LAT_PULL = toAnalysisInput({ ...findExercise("lat-pull"), isCompound: true });
const LATERAL_RAISE = toAnalysisInput({
  ...findExercise("lateral-raise"),
  isCompound: false,
});
const FACE_PULL = toAnalysisInput({
  ...findExercise("face-pull"),
  isCompound: false,
});
const PLANK = toAnalysisInput({ ...findExercise("plank"), isCompound: false });

describe("scoreToLabel", () => {
  it("maps score bands correctly", () => {
    expect(scoreToLabel(85)).toBe("Excellent");
    expect(scoreToLabel(70)).toBe("Good");
    expect(scoreToLabel(55)).toBe("Fair");
    expect(scoreToLabel(40)).toBe("Needs Work");
    expect(scoreToLabel(39)).toBe("Poor");
  });
});

describe("analyzeTemplate intent-aware behavior", () => {
  it("does not penalize push-day templates as full-body misses when intent is split-based", () => {
    const pushDay = [BENCH, LATERAL_RAISE];
    const fullBodyResult = analyzeTemplate(pushDay, { intent: "FULL_BODY" });
    const pplResult = analyzeTemplate(pushDay, { intent: "PUSH_PULL_LEGS" });

    expect(pplResult.muscleCoverage.score).toBeGreaterThan(fullBodyResult.muscleCoverage.score);
    expect(pplResult.overallScore).toBeGreaterThan(fullBodyResult.overallScore);
  });

  it("gates push/pull balance for single-direction split intents", () => {
    const pushDay = [BENCH, LATERAL_RAISE];
    const pplResult = analyzeTemplate(pushDay, { intent: "PUSH_PULL_LEGS" });
    const fullBodyResult = analyzeTemplate(pushDay, { intent: "FULL_BODY" });

    expect(pplResult.pushPullBalance.isApplicable).toBe(false);
    expect(fullBodyResult.pushPullBalance.isApplicable).toBe(true);
    expect(fullBodyResult.pushPullBalance.score).toBeLessThan(pplResult.pushPullBalance.score);
  });

  it("uses intent-specific movement expectations", () => {
    const pushPatternsOnly = [BENCH, LATERAL_RAISE];
    const pplResult = analyzeTemplate(pushPatternsOnly, { intent: "PUSH_PULL_LEGS" });
    const fullBodyResult = analyzeTemplate(pushPatternsOnly, { intent: "FULL_BODY" });

    expect(pplResult.movementPatternDiversity.score).toBeGreaterThan(
      fullBodyResult.movementPatternDiversity.score
    );
  });

  it("uses wider compound/isolation ranges for body-part sessions", () => {
    const mostlyIsolation = [LATERAL_RAISE, FACE_PULL, PLANK, BENCH];
    const bodyPartResult = analyzeTemplate(mostlyIsolation, { intent: "BODY_PART" });
    const fullBodyResult = analyzeTemplate(mostlyIsolation, { intent: "FULL_BODY" });

    expect(bodyPartResult.compoundIsolationRatio.score).toBeGreaterThan(
      fullBodyResult.compoundIsolationRatio.score
    );
  });

  it("applies higher exercise-order weight for strength-oriented intents", () => {
    const strengthIntent = analyzeTemplate([BENCH, ROW, LATERAL_RAISE], { intent: "FULL_BODY" });
    const hypertrophyIntent = analyzeTemplate([BENCH, ROW, LATERAL_RAISE], {
      intent: "BODY_PART",
    });

    expect(strengthIntent.exerciseOrderWeight).toBeGreaterThan(
      hypertrophyIntent.exerciseOrderWeight
    );
  });
});

describe("exercise order scoring", () => {
  it("prefers decreasing fatigue cost order", () => {
    const descending = scoreExerciseOrder([
      { ...BENCH, fatigueCost: 5, orderIndex: 0 },
      { ...ROW, fatigueCost: 3, orderIndex: 1 },
      { ...PLANK, fatigueCost: 1, orderIndex: 2 },
    ]);

    const ascending = scoreExerciseOrder([
      { ...PLANK, fatigueCost: 1, orderIndex: 0 },
      { ...ROW, fatigueCost: 3, orderIndex: 1 },
      { ...BENCH, fatigueCost: 5, orderIndex: 2 },
    ]);

    expect(descending.score).toBeGreaterThan(ascending.score);
    expect(ascending.upwardTransitions).toBeGreaterThan(0);
  });

  it("adds a soft penalty when non-main movements are ordered before main-lift-eligible movements", () => {
    const mainFirst = scoreExerciseOrder([
      { ...BENCH, isMainLiftEligible: true, fatigueCost: 4, orderIndex: 0 },
      { ...ROW, isMainLiftEligible: true, fatigueCost: 3, orderIndex: 1 },
      { ...PLANK, isMainLiftEligible: false, fatigueCost: 2, orderIndex: 2 },
    ]);
    const nonMainFirst = scoreExerciseOrder([
      { ...PLANK, isMainLiftEligible: false, fatigueCost: 2, orderIndex: 0 },
      { ...BENCH, isMainLiftEligible: true, fatigueCost: 4, orderIndex: 1 },
      { ...ROW, isMainLiftEligible: true, fatigueCost: 3, orderIndex: 2 },
    ]);

    expect(nonMainFirst.mainLiftOrderViolations).toBeGreaterThan(0);
    expect(nonMainFirst.mainLiftOrderPenalty).toBeGreaterThan(0);
    expect(mainFirst.mainLiftOrderViolations).toBe(0);
    expect(mainFirst.score).toBeGreaterThan(nonMainFirst.score);
  });
});

describe("length and SFR normalization", () => {
  it("does not inflate length-position score from exercise count alone", () => {
    const four: AnalysisExerciseInput[] = Array.from({ length: 4 }, () => ({
      isCompound: false,
      movementPatterns: [],
      muscles: [],
      lengthPositionScore: 4,
    }));
    const eight: AnalysisExerciseInput[] = Array.from({ length: 8 }, () => ({
      isCompound: false,
      movementPatterns: [],
      muscles: [],
      lengthPositionScore: 4,
    }));

    const score4 = scoreLengthPosition(four).score;
    const score8 = scoreLengthPosition(eight).score;
    expect(Math.abs(score4 - score8)).toBeLessThanOrEqual(2);
  });

  it("does not penalize low-SFR compounds as low-efficiency hits", () => {
    const compounds: AnalysisExerciseInput[] = [
      { ...SQUAT, isCompound: true, sfrScore: 2 },
      { ...RDL, isCompound: true, sfrScore: 2 },
      { ...ROW, isCompound: true, sfrScore: 2 },
    ];
    const score = scoreSfrEfficiency(compounds);

    expect(score.lowSfrCount).toBe(0);
    expect(score.score).toBeGreaterThan(0);
  });
});

describe("analyzeTemplate integration", () => {
  it("returns exercise order score and bounded overall score", () => {
    const result = analyzeTemplate(
      [BENCH, ROW, SQUAT, LAT_PULL, LATERAL_RAISE].map((exercise, index) => ({
        ...exercise,
        orderIndex: index,
      })),
      { intent: "FULL_BODY" }
    );

    expect(result.exerciseOrder.score).toBeGreaterThanOrEqual(0);
    expect(result.exerciseOrder.score).toBeLessThanOrEqual(100);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("handles empty templates", () => {
    const result = analyzeTemplate([], { intent: "CUSTOM" });

    expect(result.exerciseCount).toBe(0);
    expect(result.overallScore).toBe(0);
    expect(result.overallLabel).toBe("Poor");
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});
