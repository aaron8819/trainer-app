import { describe, it, expect } from "vitest";
import {
  analyzeTemplate,
  scoreMuscleCoverage,
  scorePushPullBalance,
  scoreCompoundIsolation,
  scoreMovementDiversity,
  scoreToLabel,
  type AnalysisExerciseInput,
} from "./template-analysis";
import { exampleExerciseLibrary } from "./sample-data";
import type { Exercise } from "./types";

// --- Helper: convert engine Exercise to AnalysisExerciseInput ---

function toAnalysisInput(ex: Exercise): AnalysisExerciseInput {
  const muscles: { name: string; role: "primary" | "secondary" }[] = [];
  for (const m of ex.primaryMuscles ?? []) {
    muscles.push({ name: m, role: "primary" });
  }
  for (const m of ex.secondaryMuscles ?? []) {
    muscles.push({ name: m, role: "secondary" });
  }
  return {
    isCompound: ex.isCompound ?? false,
    movementPatternsV2: ex.movementPatternsV2,
    muscles,
  };
}

function findExercise(id: string): Exercise {
  const ex = exampleExerciseLibrary.find((e) => e.id === id);
  if (!ex) throw new Error(`Exercise ${id} not found in sample data`);
  return ex;
}

// --- Fixtures ---

const BENCH = toAnalysisInput({ ...findExercise("bench"), isCompound: true });
const ROW = toAnalysisInput({ ...findExercise("row"), isCompound: true });
const SQUAT = toAnalysisInput({ ...findExercise("squat"), isCompound: true });
const RDL = toAnalysisInput({ ...findExercise("rdl"), isCompound: true });
const LAT_PULL = toAnalysisInput({ ...findExercise("lat-pull"), isCompound: true });
const SPLIT_SQUAT = toAnalysisInput({
  ...findExercise("split-squat"),
  isCompound: true,
});
const LATERAL_RAISE = toAnalysisInput({
  ...findExercise("lateral-raise"),
  isCompound: false,
});
const FACE_PULL = toAnalysisInput({
  ...findExercise("face-pull"),
  isCompound: false,
});
const PLANK = toAnalysisInput({ ...findExercise("plank"), isCompound: false });
const FARMERS_CARRY = toAnalysisInput({
  ...findExercise("farmers-carry"),
  isCompound: false,
});

const BALANCED_TEMPLATE: AnalysisExerciseInput[] = [
  BENCH,
  ROW,
  SQUAT,
  RDL,
  LAT_PULL,
  LATERAL_RAISE,
  FACE_PULL,
  SPLIT_SQUAT,
  PLANK,
  FARMERS_CARRY,
];

// --- scoreToLabel ---

describe("scoreToLabel", () => {
  it("returns Excellent for scores >= 85", () => {
    expect(scoreToLabel(85)).toBe("Excellent");
    expect(scoreToLabel(100)).toBe("Excellent");
  });

  it("returns Good for scores 70-84", () => {
    expect(scoreToLabel(70)).toBe("Good");
    expect(scoreToLabel(84)).toBe("Good");
  });

  it("returns Fair for scores 55-69", () => {
    expect(scoreToLabel(55)).toBe("Fair");
    expect(scoreToLabel(69)).toBe("Fair");
  });

  it("returns Needs Work for scores 40-54", () => {
    expect(scoreToLabel(40)).toBe("Needs Work");
    expect(scoreToLabel(54)).toBe("Needs Work");
  });

  it("returns Poor for scores < 40", () => {
    expect(scoreToLabel(0)).toBe("Poor");
    expect(scoreToLabel(39)).toBe("Poor");
  });
});

// --- scoreMuscleCoverage ---

describe("scoreMuscleCoverage", () => {
  it("returns 0 for empty exercises", () => {
    const result = scoreMuscleCoverage([]);
    expect(result.score).toBe(0);
    expect(result.missedCritical.length).toBeGreaterThan(0);
  });

  it("gives full credit for primary muscle hits", () => {
    const result = scoreMuscleCoverage(BALANCED_TEMPLATE);
    expect(result.score).toBeGreaterThan(50);
    expect(result.hitMuscles.length).toBeGreaterThan(5);
  });

  it("gives partial credit for secondary-only muscles", () => {
    // Biceps is only secondary from ROW and LAT_PULL
    const rowOnly = scoreMuscleCoverage([ROW]);
    expect(rowOnly.hitMuscles).toContain("Biceps");
    // Biceps should not be in missedCritical since it's hit as secondary
    expect(rowOnly.missedCritical).not.toContain("Biceps");
  });

  it("lists missed critical muscles", () => {
    const result = scoreMuscleCoverage([BENCH]);
    // With only bench, we miss many critical muscles
    expect(result.missedCritical.length).toBeGreaterThan(3);
  });
});

// --- scorePushPullBalance ---

describe("scorePushPullBalance", () => {
  it("returns perfect score for 1:1 push/pull ratio", () => {
    const result = scorePushPullBalance([BENCH, ROW]);
    expect(result.score).toBe(100);
    expect(result.pushCount).toBe(1);
    expect(result.pullCount).toBe(1);
  });

  it("penalizes imbalanced ratios", () => {
    const result = scorePushPullBalance([BENCH, BENCH, BENCH, ROW]);
    expect(result.score).toBeLessThan(100);
    expect(result.pushCount).toBe(3);
    expect(result.pullCount).toBe(1);
  });

  it("returns 75 for all-legs template", () => {
    const result = scorePushPullBalance([SQUAT, RDL, SPLIT_SQUAT]);
    expect(result.score).toBe(75);
    expect(result.pushCount).toBe(0);
    expect(result.pullCount).toBe(0);
  });

  it("returns 0 for empty exercises", () => {
    const result = scorePushPullBalance([]);
    expect(result.score).toBe(0);
  });

  it("counts exercises with both push and pull muscles", () => {
    // An exercise with both push and pull primary muscles should count for both
    const hybrid: AnalysisExerciseInput = {
      isCompound: true,
      movementPatternsV2: ["horizontal_push"],
      muscles: [
        { name: "Chest", role: "primary" },
        { name: "Back", role: "primary" },
      ],
    };
    const result = scorePushPullBalance([hybrid]);
    expect(result.pushCount).toBe(1);
    expect(result.pullCount).toBe(1);
  });
});

// --- scoreCompoundIsolation ---

describe("scoreCompoundIsolation", () => {
  it("returns 0 for empty exercises", () => {
    const result = scoreCompoundIsolation([]);
    expect(result.score).toBe(0);
    expect(result.compoundCount).toBe(0);
  });

  it("returns 100 for 50% compound ratio", () => {
    const result = scoreCompoundIsolation([BENCH, LATERAL_RAISE]);
    expect(result.score).toBe(100);
    expect(result.compoundPercent).toBe(50);
  });

  it("returns 100 for 40% compound", () => {
    // 2 compound, 3 isolation = 40%
    const exercises = [BENCH, ROW, LATERAL_RAISE, FACE_PULL, PLANK];
    const result = scoreCompoundIsolation(exercises);
    expect(result.compoundPercent).toBe(40);
    expect(result.score).toBe(100);
  });

  it("returns 100 for 60% compound", () => {
    // 3 compound, 2 isolation = 60%
    const exercises = [BENCH, ROW, SQUAT, LATERAL_RAISE, FACE_PULL];
    const result = scoreCompoundIsolation(exercises);
    expect(result.compoundPercent).toBe(60);
    expect(result.score).toBe(100);
  });

  it("penalizes all-compound templates", () => {
    const result = scoreCompoundIsolation([BENCH, ROW, SQUAT]);
    expect(result.compoundPercent).toBe(100);
    expect(result.score).toBe(0);
  });

  it("penalizes all-isolation templates", () => {
    const result = scoreCompoundIsolation([LATERAL_RAISE, FACE_PULL, PLANK]);
    expect(result.compoundPercent).toBe(0);
    expect(result.score).toBe(0);
  });
});

// --- scoreMovementDiversity ---

describe("scoreMovementDiversity", () => {
  it("returns 0 for empty exercises", () => {
    const result = scoreMovementDiversity([]);
    expect(result.score).toBe(0);
    expect(result.missingPatterns.length).toBe(8);
  });

  it("scores based on core pattern coverage", () => {
    // bench = horizontal_push, row = horizontal_pull
    const result = scoreMovementDiversity([BENCH, ROW]);
    expect(result.coveredPatterns).toContain("horizontal_push");
    expect(result.coveredPatterns).toContain("horizontal_pull");
    expect(result.score).toBe(25); // 2/8 = 25%
  });

  it("awards bonus points for rotation/anti-rotation", () => {
    // plank has anti_rotation
    const withoutPlank = scoreMovementDiversity([BENCH]);
    const withPlank = scoreMovementDiversity([BENCH, PLANK]);
    expect(withPlank.score).toBeGreaterThan(withoutPlank.score);
    expect(withPlank.coveredPatterns).toContain("anti_rotation");
  });

  it("caps score at 100", () => {
    // Even with bonus patterns, score should not exceed 100
    const allPatterns: AnalysisExerciseInput = {
      isCompound: true,
      movementPatternsV2: [
        "horizontal_push",
        "vertical_push",
        "horizontal_pull",
        "vertical_pull",
        "squat",
        "hinge",
        "lunge",
        "carry",
        "rotation",
        "anti_rotation",
      ],
      muscles: [],
    };
    const result = scoreMovementDiversity([allPatterns]);
    expect(result.score).toBe(100);
  });

  it("identifies missing patterns", () => {
    const result = scoreMovementDiversity([BENCH]);
    expect(result.missingPatterns).toContain("vertical_push");
    expect(result.missingPatterns).toContain("squat");
    expect(result.missingPatterns).toContain("hinge");
  });
});

// --- analyzeTemplate (integration) ---

describe("analyzeTemplate", () => {
  it("returns complete analysis for a balanced template", () => {
    const result = analyzeTemplate(BALANCED_TEMPLATE);

    expect(result.exerciseCount).toBe(10);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(["Excellent", "Good", "Fair", "Needs Work", "Poor"]).toContain(
      result.overallLabel
    );

    // Sub-scores should all be present
    expect(result.muscleCoverage.score).toBeGreaterThanOrEqual(0);
    expect(result.pushPullBalance.score).toBeGreaterThanOrEqual(0);
    expect(result.compoundIsolationRatio.score).toBeGreaterThanOrEqual(0);
    expect(result.movementPatternDiversity.score).toBeGreaterThanOrEqual(0);
  });

  it("handles empty template", () => {
    const result = analyzeTemplate([]);
    expect(result.exerciseCount).toBe(0);
    expect(result.overallScore).toBe(0);
    expect(result.overallLabel).toBe("Poor");
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("handles single exercise", () => {
    const result = analyzeTemplate([BENCH]);
    expect(result.exerciseCount).toBe(1);
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.overallScore).toBeLessThan(50);
  });

  it("generates suggestions for deficiencies", () => {
    // All push, no pull
    const allPush = [BENCH, LATERAL_RAISE];
    const result = analyzeTemplate(allPush);
    // Should get suggestions about imbalance or missing muscles
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("limits suggestions to 3", () => {
    const result = analyzeTemplate([BENCH]);
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("overall score is weighted average of sub-scores", () => {
    const result = analyzeTemplate(BALANCED_TEMPLATE);
    const expected = Math.round(
      result.muscleCoverage.score * 0.4 +
        result.pushPullBalance.score * 0.2 +
        result.compoundIsolationRatio.score * 0.2 +
        result.movementPatternDiversity.score * 0.2
    );
    expect(result.overallScore).toBe(expected);
  });

  it("all-legs template gets neutral push/pull score", () => {
    const allLegs = [SQUAT, RDL, SPLIT_SQUAT];
    const result = analyzeTemplate(allLegs);
    expect(result.pushPullBalance.score).toBe(75);
  });
});
