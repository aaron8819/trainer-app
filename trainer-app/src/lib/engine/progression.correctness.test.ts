import { describe, expect, it } from "vitest";
import { computeDoubleProgressionDecision, PROGRESSION_CONFIG, shouldDeload } from "./progression";

describe("progression correctness", () => {
  it("never increments load from a 0-load bodyweight baseline (Dips and Pull-Ups)", () => {
    const bodyweightCases = [
      { name: "Dips", repRange: [6, 12] as [number, number] },
      { name: "Pull-Ups", repRange: [6, 12] as [number, number] },
    ];

    for (const testCase of bodyweightCases) {
      const decision = computeDoubleProgressionDecision(
        [
          { reps: 12, rpe: 7, load: 0 },
          { reps: 12, rpe: 7.5, load: 0 },
          { reps: 12, rpe: 8, load: 0 },
        ],
        testCase.repRange,
        "other"
      );

      expect(decision, testCase.name).toBeDefined();
      expect(decision?.nextLoad, testCase.name).toBe(0);
      expect(decision?.decisionLog.join(" | "), testCase.name).toContain(
        "bodyweight exercise — rep progression only"
      );
    }
  });

  it("holds bodyweight load at 0 and targets more reps when below top of range", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 8, rpe: 7, load: 0 },
        { reps: 8, rpe: 7.5, load: 0 },
        { reps: 9, rpe: 8, load: 0 },
      ],
      [6, 12],
      "other"
    );

    expect(decision).toBeDefined();
    expect(decision?.nextLoad).toBe(0);
    expect(decision?.path).toBe("fallback_hold");
    expect(decision?.decisionLog.join(" | ")).toContain(
      "Below top of rep range for bodyweight load. Hold load at 0 and target more reps."
    );
  });

  it("scales progression increment by 0.8 when only one prior session exists", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 10, rpe: 7, load: 100 },
        { reps: 10, rpe: 7, load: 100 },
        { reps: 10, rpe: 7, load: 100 },
      ],
      [8, 10],
      "barbell",
      { priorSessionCount: 1 }
    );

    expect(decision?.path).toBe("path_2");
    expect(decision?.nextLoad).toBe(105);
    expect(decision?.decisionLog.join(" | ")).toContain("Progression confidence scale=0.80");
    expect(decision?.trace.outcome.action).toBe("increase");
    expect(decision?.trace.outcome.reasonCodes).toContain("top_of_range_reached");
  });

  it("applies full increment with three or more prior sessions", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 10, rpe: 7, load: 100 },
        { reps: 10, rpe: 7, load: 100 },
        { reps: 10, rpe: 7, load: 100 },
      ],
      [8, 10],
      "barbell",
      { priorSessionCount: 3 }
    );

    expect(decision?.path).toBe("path_2");
    expect(decision?.nextLoad).toBe(105);
    expect(decision?.decisionLog.join(" | ")).toContain("Progression confidence scale=1.00");
  });

  it("keeps the week-4 pull main-lift hold gate unchanged when median reps stay below the top of the band", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 6, rpe: 8, load: 120 },
        { reps: 7, rpe: 8, load: 115 },
        { reps: 7, rpe: 8.5, load: 115 },
        { reps: 7, rpe: 8.5, load: 115 },
        { reps: 7, rpe: 8.5, load: 115 },
      ],
      [6, 10],
      "barbell",
      { workingSetLoad: 120, priorSessionCount: 3 }
    );

    expect(decision?.path).toBe("fallback_hold");
    expect(decision?.nextLoad).toBe(120);
    expect(decision?.decisionLog.join(" | ")).toContain("median reps=7.0, rep-range top=10");
    expect(decision?.trace.outcome.action).toBe("hold");
    expect(decision?.trace.outcome.reasonCodes).toContain("progression_conditions_not_met");
    expect(decision?.trace.outcome.reasonCodes).toContain("working_set_anchor_applied");
  });

  it("holds load even after overshooting prescription when fatigue is already high", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 10, rpe: 9, load: 105, targetLoad: 100 },
        { reps: 10, rpe: 9, load: 105, targetLoad: 100 },
        { reps: 9, rpe: 9.5, load: 105, targetLoad: 100 },
      ],
      [8, 10],
      "barbell",
      { priorSessionCount: 3 }
    );

    expect(decision?.path).toBe("path_1");
    expect(decision?.nextLoad).toBe(105);
    expect(decision?.trace.outcome.action).toBe("hold");
    expect(decision?.trace.outcome.reasonCodes).toContain("high_fatigue_hold");
  });

  it("earns an increase when most working sets materially beat the written load at manageable effort", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 8, rpe: 7.5, load: 145, targetLoad: 135 },
        { reps: 8, rpe: 8, load: 145, targetLoad: 135 },
        { reps: 7, rpe: 8, load: 140, targetLoad: 135 },
      ],
      [6, 10],
      "barbell",
      { workingSetLoad: 145, priorSessionCount: 3 }
    );

    expect(decision?.path).toBe("path_5_overshoot");
    expect(decision?.nextLoad).toBe(150);
    expect(decision?.decisionLog.join(" | ")).toContain("Path 5 fired");
    expect(decision?.decisionLog.join(" | ")).toContain("performed load beat prescription");
  });

  it("uses the bounded catch-up lane when exact same-exercise overshoot is broad and clearly under-translated", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 8, rpe: 7.5, load: 155, targetLoad: 145 },
        { reps: 8, rpe: 7.5, load: 155, targetLoad: 145 },
        { reps: 7, rpe: 8, load: 155, targetLoad: 145 },
        { reps: 7, rpe: 8, load: 155, targetLoad: 145 },
      ],
      [6, 10],
      "barbell",
      { workingSetLoad: 155, priorSessionCount: 3 }
    );

    expect(decision?.path).toBe("path_5_overshoot");
    expect(decision?.nextLoad).toBe(165);
    expect(decision?.decisionLog.join(" | ")).toContain("Catch-up lane fired");
    expect(decision?.trace.outcome.reasonCodes).toContain("same_exercise_catch_up_progression");
  });

  it("keeps Tier 1 overshoot behavior unchanged when promotion policy stays at full confidence", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 8, rpe: 7.5, load: 145, targetLoad: 135 },
        { reps: 8, rpe: 8, load: 145, targetLoad: 135 },
        { reps: 7, rpe: 8, load: 140, targetLoad: 135 },
      ],
      [6, 10],
      "barbell",
      {
        workingSetLoad: 145,
        priorSessionCount: 3,
        promotionPolicy: {
          allowCatchUp: true,
          overshootConfidenceScale: 1,
        },
      }
    );

    expect(decision?.path).toBe("path_5_overshoot");
    expect(decision?.nextLoad).toBe(150);
  });

  it("mildly down-weights Tier 2 overshoot evidence without changing non-overshoot paths", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 10, rpe: 8, load: 65, targetLoad: 62.5 },
        { reps: 10, rpe: 8, load: 65, targetLoad: 62.5 },
      ],
      [8, 12],
      "other",
      {
        workingSetLoad: 65,
        priorSessionCount: 3,
        promotionPolicy: {
          allowCatchUp: true,
          overshootConfidenceScale: 0.9,
        },
      }
    );

    expect(decision?.path).toBe("path_4");
    expect(decision?.nextLoad).toBe(65);
    expect(decision?.decisionLog.join(" | ")).toContain("weighted confidence only counted as 1.80");
    expect(decision?.trace.outcome.reasonCodes).toContain("overshoot_blocked_by_coverage");
  });

  it("disables Tier 3 catch-up before evaluation while keeping the base overshoot lane", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 8, rpe: 7.5, load: 155, targetLoad: 145 },
        { reps: 8, rpe: 7.5, load: 155, targetLoad: 145 },
        { reps: 7, rpe: 8, load: 155, targetLoad: 145 },
        { reps: 7, rpe: 8, load: 155, targetLoad: 145 },
      ],
      [6, 10],
      "cable",
      {
        workingSetLoad: 155,
        priorSessionCount: 3,
        promotionPolicy: {
          allowCatchUp: false,
          overshootConfidenceScale: 0.6,
        },
      }
    );

    expect(decision?.path).toBe("path_5_overshoot");
    expect(decision?.nextLoad).toBe(157.5);
    expect(decision?.decisionLog.join(" | ")).toContain("Catch-up lane skipped");
    expect(decision?.trace.outcome.reasonCodes).not.toContain("same_exercise_catch_up_progression");
  });

  it("clamps repeated intent deviation to the prescribed target ceiling without changing the rep range", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 6, rpe: 8, load: 165, targetLoad: 145, targetRepRange: { min: 8, max: 12 } },
        { reps: 6, rpe: 8, load: 165, targetLoad: 145, targetRepRange: { min: 8, max: 12 } },
        { reps: 7, rpe: 8, load: 165, targetLoad: 145, targetRepRange: { min: 8, max: 12 } },
      ],
      [8, 12],
      "barbell",
      {
        workingSetLoad: 165,
        priorSessionCount: 3,
        intentDeviation: { detected: true, severity: "moderate" },
        intentDeviationTargetLoadCeiling: 145,
      }
    );

    expect(decision?.nextLoad).toBe(145);
    expect(decision?.trace.outcome.action).toBe("decrease");
    expect(decision?.trace.repRange).toEqual({ min: 8, max: 12 });
    expect(decision?.decisionLog.join(" | ")).toContain(
      "rep-range restoration bias suppressed upward promotion"
    );
    expect(decision?.trace.outcome.reasonCodes).toContain("intent_drift_detected");
    expect(decision?.trace.outcome.reasonCodes).toContain("rep_range_restoration_bias");
  });

  it("suppresses overshoot and catch-up promotion when intent deviation is detected", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 6, rpe: 7.5, load: 165, targetLoad: 145, targetRepRange: { min: 8, max: 12 } },
        { reps: 6, rpe: 7.5, load: 165, targetLoad: 145, targetRepRange: { min: 8, max: 12 } },
        { reps: 6, rpe: 8, load: 165, targetLoad: 145, targetRepRange: { min: 8, max: 12 } },
        { reps: 6, rpe: 8, load: 165, targetLoad: 145, targetRepRange: { min: 8, max: 12 } },
      ],
      [8, 12],
      "barbell",
      {
        workingSetLoad: 165,
        priorSessionCount: 3,
        intentDeviation: { detected: true, severity: "strong" },
        intentDeviationTargetLoadCeiling: 145,
      }
    );

    expect(decision?.path).not.toBe("path_5_overshoot");
    expect(decision?.nextLoad).toBe(145);
    expect(decision?.decisionLog.join(" | ")).not.toContain("Catch-up lane fired");
    expect(decision?.trace.outcome.reasonCodes).not.toContain("same_exercise_catch_up_progression");
  });

  it("earns an increase at RPE 8.5 when overshoot coverage is broad and load execution stays stable", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 6, rpe: 8.5, load: 145, targetLoad: 135 },
        { reps: 7, rpe: 8.5, load: 135, targetLoad: 120 },
        { reps: 7, rpe: 8.5, load: 135, targetLoad: 120 },
        { reps: 7, rpe: 8.5, load: 135, targetLoad: 120 },
        { reps: 7, rpe: 8.5, load: 135, targetLoad: 120 },
      ],
      [6, 10],
      "barbell",
      { workingSetLoad: 145, priorSessionCount: 3 }
    );

    expect(decision?.path).toBe("path_5_overshoot");
    expect(decision?.nextLoad).toBe(150);
    expect(decision?.decisionLog.join(" | ")).toContain("broader coverage justified progression even at RPE 8.5");
    expect(decision?.trace.outcome.reasonCodes).toContain("controlled_hard_overshoot_progression");
  });

  it("still treats Tier 3 8.5-RPE overshoot as an evidence failure rather than a hard effort block", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 6, rpe: 8.5, load: 145, targetLoad: 135 },
        { reps: 7, rpe: 8.5, load: 145, targetLoad: 135 },
        { reps: 7, rpe: 8.5, load: 145, targetLoad: 135 },
        { reps: 7, rpe: 8.5, load: 145, targetLoad: 135 },
      ],
      [6, 10],
      "cable",
      {
        workingSetLoad: 145,
        priorSessionCount: 3,
        promotionPolicy: {
          allowCatchUp: false,
          overshootConfidenceScale: 0.6,
        },
      }
    );

    expect(decision?.path).toBe("fallback_hold");
    expect(decision?.nextLoad).toBe(145);
    expect(decision?.decisionLog.join(" | ")).toContain("Overshoot confidence=0.60");
    expect(decision?.trace.outcome.reasonCodes).toContain("overshoot_blocked_by_coverage");
    expect(decision?.trace.outcome.reasonCodes).not.toContain("overshoot_blocked_by_effort");
  });

  it("does not promote a one-off overshoot without session-level evidence", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 8, rpe: 7.5, load: 145, targetLoad: 135 },
        { reps: 7, rpe: 8, load: 135, targetLoad: 135 },
        { reps: 7, rpe: 8, load: 135, targetLoad: 135 },
      ],
      [6, 10],
      "barbell",
      { workingSetLoad: 145, priorSessionCount: 3 }
    );

    expect(decision?.path).toBe("path_4");
    expect(decision?.nextLoad).toBe(145);
    expect(decision?.decisionLog.join(" | ")).toContain("Overshoot gate:");
    expect(decision?.trace.outcome.reasonCodes).toContain("overshoot_blocked_by_coverage");
  });

  it("holds at RPE 8.5 when overshoot evidence is too narrow for the relaxed lane", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 6, rpe: 8.5, load: 145, targetLoad: 135 },
        { reps: 7, rpe: 8.5, load: 145, targetLoad: 135 },
        { reps: 7, rpe: 8.5, load: 135, targetLoad: 120 },
        { reps: 7, rpe: 8.5, load: 120, targetLoad: 120 },
        { reps: 7, rpe: 8.5, load: 120, targetLoad: 120 },
      ],
      [6, 10],
      "barbell",
      { workingSetLoad: 145, priorSessionCount: 3 }
    );

    expect(decision?.path).toBe("fallback_hold");
    expect(decision?.nextLoad).toBe(145);
    expect(decision?.decisionLog.join(" | ")).toContain(
      "3/5 target-bearing sets beat prescription, but weighted confidence only counted as 3.00 toward the 4 required"
    );
    expect(decision?.trace.outcome.reasonCodes).toContain("overshoot_blocked_by_coverage");
  });

  it("holds at RPE 8.5 when overshoot evidence exists but load execution is too variable", () => {
    const decision = computeDoubleProgressionDecision(
      [
        { reps: 15, rpe: 8.5, load: 90, targetLoad: 90 },
        { reps: 12, rpe: 8.5, load: 130, targetLoad: 90 },
        { reps: 12, rpe: 8.5, load: 130, targetLoad: 90 },
        { reps: 12, rpe: 8.5, load: 130, targetLoad: 90 },
      ],
      [10, 15],
      "barbell",
      { priorSessionCount: 3 }
    );

    expect(decision?.path).toBe("fallback_hold");
    expect(decision?.nextLoad).toBe(130);
    expect(decision?.decisionLog.join(" | ")).toContain("variance trimming");
    expect(decision?.trace.outcome.reasonCodes).toContain("overshoot_blocked_by_variance");
  });

  it("uses PROGRESSION_CONFIG thresholds instead of inline magic numbers", () => {
    expect(PROGRESSION_CONFIG.highVarianceThreshold).toBe(0.2);
    expect(PROGRESSION_CONFIG.outlierTrimRange).toBe(0.15);
    expect(PROGRESSION_CONFIG.minSessionsForFullConfidence).toBe(3);
    expect(PROGRESSION_CONFIG.singleSessionConfidenceScale).toBe(0.8);
    expect(PROGRESSION_CONFIG.minSessionsForPlateauEvidence).toBe(3);
    expect(PROGRESSION_CONFIG.plateauImprovementEpsilon).toBe(0.01);
    expect(PROGRESSION_CONFIG.overshootStandardRpeCeiling).toBe(8);
    expect(PROGRESSION_CONFIG.overshootControlledRpeCeiling).toBe(8.5);
    expect(PROGRESSION_CONFIG.minOvershootSetCount).toBe(2);
    expect(PROGRESSION_CONFIG.overshootControlledCoverageRatio).toBe(0.75);
    expect(PROGRESSION_CONFIG.overshootControlledMinSetCount).toBe(3);
    expect(PROGRESSION_CONFIG.catchUpRpeCeiling).toBe(8);
    expect(PROGRESSION_CONFIG.catchUpMinSetCount).toBe(4);
    expect(PROGRESSION_CONFIG.catchUpMedianGapMultiplier).toBe(2);
  });

  it("triggers deload on a sustained low-readiness streak", () => {
    const history = [
      { date: "2026-02-01T00:00:00.000Z", status: "COMPLETED", readinessScore: 2, exercises: [] },
      { date: "2026-02-03T00:00:00.000Z", status: "COMPLETED", readinessScore: 2, exercises: [] },
      { date: "2026-02-05T00:00:00.000Z", status: "COMPLETED", readinessScore: 1, exercises: [] },
      { date: "2026-02-07T00:00:00.000Z", status: "COMPLETED", readinessScore: 2, exercises: [] },
    ];

    expect(shouldDeload(history as never)).toBe(true);
  });

  it("does not trigger deload from flat total session reps without main-lift plateau evidence", () => {
    const history = Array.from({ length: 5 }, (_, index) => ({
      date: `2026-02-0${index + 1}T00:00:00.000Z`,
      status: "COMPLETED",
      readinessScore: 3,
      exercises: [
        {
          exerciseId: `exercise-${index}`,
          sets: [{ setIndex: 1, reps: 10, load: 100, rpe: 8 }],
        },
      ],
    }));

    expect(shouldDeload(history as never, new Set(["bench"]))).toBe(false);
  });

  it("triggers deload when tracked main lifts show no meaningful e1rm improvement across repeated sessions", () => {
    const history = [100, 100, 100.5, 100, 100.2].map((load, index) => ({
      date: `2026-02-0${index + 1}T00:00:00.000Z`,
      status: "COMPLETED",
      readinessScore: 3,
      exercises: [
        {
          exerciseId: "bench",
          sets: [{ setIndex: 1, reps: 5, load, rpe: 8 }],
        },
      ],
    }));

    expect(shouldDeload(history as never, new Set(["bench"]))).toBe(true);
  });
});
