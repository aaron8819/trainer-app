import { describe, expect, it } from "vitest";
import {
  HYPERTROPHY_PLAN_HEALTH_ISSUE_CODES,
  HYPERTROPHY_PLAN_HEALTH_ISSUE_POLICY,
  buildHypertrophyPlanHealthAssessment,
  classifyHypertrophyPlanHealthIssue,
  healthRequiresWarningConfirmation,
  type HypertrophyPlanHealth,
} from "./hypertrophy-plan-health";

function rawHealth(overrides?: Partial<HypertrophyPlanHealth>): HypertrophyPlanHealth {
  return {
    blockers: [],
    warnings: [],
    muscles: [],
    sessions: [],
    ...overrides,
  };
}

function assess(health: HypertrophyPlanHealth) {
  return buildHypertrophyPlanHealthAssessment({
    draftId: "draft-1",
    draftRevision: 7,
    evaluatedWeek: 1,
    health,
    catalogExerciseCount: 150,
    equipmentProfile: "FULL_GYM",
    recognizedLimitationCount: 0,
    unrecognizedLimitationsPresent: false,
    sessionNameBySlotId: new Map([["upper-a", "Upper A"]]),
    exerciseNameById: new Map([["bench", "Barbell Bench Press"]]),
  });
}

describe("draft Plan Health classification", () => {
  it("exhaustively classifies every current issue code", () => {
    expect(Object.keys(HYPERTROPHY_PLAN_HEALTH_ISSUE_POLICY).sort()).toEqual(
      [...HYPERTROPHY_PLAN_HEALTH_ISSUE_CODES].sort(),
    );
    expect(
      HYPERTROPHY_PLAN_HEALTH_ISSUE_CODES.map(
        (code) => HYPERTROPHY_PLAN_HEALTH_ISSUE_POLICY[code].tier,
      ),
    ).not.toContain("INFORMATIONAL_ESTIMATE");
  });

  it("preserves unknown blockers and treats unknown advisories as important", () => {
    expect(
      classifyHypertrophyPlanHealthIssue({
        code: "FUTURE_BLOCKER",
        existingBlocking: true,
      }),
    ).toBe("BLOCKING_SAFETY");
    expect(
      classifyHypertrophyPlanHealthIssue({
        code: "FUTURE_ADVISORY",
        existingBlocking: false,
      }),
    ).toBe("IMPORTANT_WARNING");
  });

  it("keeps structural safety blocking and requires acknowledgment only for important warnings", () => {
    const assessment = assess(
      rawHealth({
        blockers: [{ code: "EMPTY_SESSION", message: "Upper A is empty.", slotId: "upper-a" }],
        warnings: [
          { code: "DUPLICATE_EXERCISE", message: "Bench is repeated.", exerciseId: "bench" },
          { code: "THIN_COVERAGE", message: "Chest coverage is thin.", muscleId: "chest" },
        ],
      }),
    );

    expect(assessment.summary).toMatchObject({
      blockingSafety: 1,
      importantWarnings: 1,
      coachingObservations: 1,
    });
    expect(assessment.issues.find((issue) => issue.code === "EMPTY_SESSION")).toMatchObject({
      tier: "BLOCKING_SAFETY",
      blocksFinalization: true,
      requiresAcknowledgment: false,
      affected: { session: "Upper A" },
    });
    expect(healthRequiresWarningConfirmation(assessment)).toBe(true);
  });

  it("classifies thin coverage and missing calves as coaching without approval gates", () => {
    const assessment = assess(
      rawHealth({
        warnings: [
          { code: "THIN_COVERAGE", message: "Chest coverage is thin.", muscleId: "chest" },
          { code: "MISSING_COVERAGE", message: "Calf coverage is missing.", muscleId: "calves" },
        ],
      }),
    );

    expect(assessment.issues.map((issue) => issue.tier)).toEqual([
      "COACHING_OBSERVATION",
      "COACHING_OBSERVATION",
    ]);
    expect(assessment.issues.find((issue) => issue.affected?.muscle === "Calves")).toMatchObject({
      title: "No direct calf work",
      explanation:
        "No direct calf work. That may be intentional because calves are not a stated plan priority.",
      requiresAcknowledgment: false,
    });
    expect(healthRequiresWarningConfirmation(assessment)).toBe(false);
  });

  it("keeps volume neutral and approximate without mutating evaluator output", () => {
    const health = rawHealth({
      muscles: [
        { muscleId: "upper_back", directSets: 24, effectiveSets: 30, frequency: 4 },
      ],
    });
    const before = structuredClone(health);
    const assessment = assess(health);

    expect(assessment.summary.informationalVolumeAvailable).toBe(true);
    expect(assessment.volumeEstimates).toEqual([
      {
        tier: "INFORMATIONAL_ESTIMATE",
        muscle: "Upper Back",
        directSets: 24,
        effectiveSets: 30,
        frequency: 4,
        referenceRange: { min: 6, max: 22 },
      },
    ]);
    expect(assessment.issues).toEqual([]);
    expect(assessment.summary.importantWarnings).toBe(0);
    expect(healthRequiresWarningConfirmation(assessment)).toBe(false);
    expect(health).toEqual(before);
  });

  it("orders issues deterministically within tiers", () => {
    const first = assess(
      rawHealth({
        warnings: [
          { code: "THIN_COVERAGE", message: "Thin triceps.", muscleId: "triceps" },
          { code: "MISSING_COVERAGE", message: "No calves.", muscleId: "calves" },
          { code: "DUPLICATE_EXERCISE", message: "Duplicate bench." },
        ],
      }),
    );
    const second = assess(
      rawHealth({ warnings: [...first.issues].reverse().map((issue) => ({
        code: issue.code,
        message: issue.explanation,
        muscleId:
          issue.affected?.muscle === "Calves"
            ? "calves"
            : issue.affected?.muscle === "Triceps"
              ? "triceps"
              : undefined,
      })) }),
    );

    expect(first.issues.map((issue) => issue.code)).toEqual([
      "DUPLICATE_EXERCISE",
      "MISSING_COVERAGE",
      "THIN_COVERAGE",
    ]);
    expect(second.issues.map((issue) => issue.code)).toEqual(
      first.issues.map((issue) => issue.code),
    );
  });
});
