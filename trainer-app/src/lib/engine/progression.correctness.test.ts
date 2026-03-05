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
    expect(PROGRESSION_CONFIG.minSessionsForPlateauEvidence).toBe(3);
    expect(PROGRESSION_CONFIG.plateauImprovementEpsilon).toBe(0.01);
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
