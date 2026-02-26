import { describe, expect, it } from "vitest";
import { computeDoubleProgressionDecision, PROGRESSION_CONFIG } from "./progression";

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
    expect(decision?.nextLoad).toBe(104);
    expect(decision?.decisionLog.join(" | ")).toContain("Progression confidence scale=0.80");
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

  it("uses PROGRESSION_CONFIG thresholds instead of inline magic numbers", () => {
    expect(PROGRESSION_CONFIG.highVarianceThreshold).toBe(0.2);
    expect(PROGRESSION_CONFIG.outlierTrimRange).toBe(0.15);
    expect(PROGRESSION_CONFIG.minSessionsForFullConfidence).toBe(3);
    expect(PROGRESSION_CONFIG.singleSessionConfidenceScale).toBe(0.8);
  });
});
