import { describe, expect, it } from "vitest";
import { buildCanonicalProgressionEvaluationInput } from "./canonical-progression-input";

describe("buildCanonicalProgressionEvaluationInput", () => {
  it("defaults to single-session full confidence when no history sessions are provided", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: [{ reps: 12, rpe: 7, load: 40 }],
      repRange: [8, 12],
      equipment: "cable",
      workingSetLoad: 40,
    });

    expect(input.decisionOptions).toEqual({
      workingSetLoad: 40,
      priorSessionCount: 1,
      historyConfidenceScale: 1,
      confidenceReasons: [],
      intentDeviation: { detected: false, severity: "none" },
    });
  });

  it("preserves discounted mixed-history confidence and deduped notes", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: [{ reps: 12, rpe: 7, load: 40 }],
      repRange: [8, 12],
      equipment: "cable",
      workingSetLoad: 40,
      historySessions: [
        {
          selectionMode: "MANUAL",
          confidence: 0.3,
          confidenceNotes: [
            "MANUAL history was heavily discounted because it looked unreliable: every set reported the same RPE.",
          ],
        },
        {
          selectionMode: "MANUAL",
          confidence: 0.3,
          confidenceNotes: [
            "MANUAL history was heavily discounted because it looked unreliable: every set reported the same RPE.",
          ],
        },
        {
          selectionMode: "MANUAL",
          confidence: 0.3,
          confidenceNotes: [
            "MANUAL history was heavily discounted because it looked unreliable: every set reported the same RPE.",
          ],
        },
        {
          selectionMode: "INTENT",
          confidence: 1,
          confidenceNotes: ["Previous INTENT history kept full progression confidence."],
        },
      ],
    });

    expect(input.context.priorSessionCount).toBe(4);
    expect(input.context.workingSetLoad).toBe(40);
    expect(input.context.historyConfidenceScale).toBe(0.47);
    expect(input.context.confidenceReasons).toEqual([
      "MANUAL history was heavily discounted because it looked unreliable: every set reported the same RPE.",
      "Previous INTENT history kept full progression confidence.",
    ]);
  });

  it("combines calibration confidence with history confidence and appends the reason", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: [{ reps: 15, rpe: 7, load: 40 }],
      repRange: [10, 15],
      equipment: "cable",
      workingSetLoad: 40,
      historySessions: [
        {
          selectionMode: "INTENT",
          confidence: 1,
          confidenceNotes: ["Previous INTENT history kept full progression confidence."],
        },
      ],
      calibrationConfidenceScale: 0.85,
      calibrationConfidenceReason: "low load-reliability equipment scaled during early exposure.",
    });

    expect(input.context.historyConfidenceScale).toBe(0.85);
    expect(input.context.confidenceReasons).toEqual([
      "Previous INTENT history kept full progression confidence.",
      "low load-reliability equipment scaled during early exposure.",
    ]);
  });

  it("does not detect a one-off under-range session", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: deviatingSets(165),
      repRange: [8, 12],
      equipment: "barbell",
      historySessions: [
        historySession(deviatingSets(165)),
        historySession(nonDeviatingSets()),
        historySession(nonDeviatingSets()),
      ],
    });

    expect(input.context.intentDeviation).toEqual({
      detected: false,
      severity: "none",
    });
    expect(input.context.intentDeviationTargetLoadCeiling).toBeUndefined();
  });

  it("does not detect when load is only slightly above prescription", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: deviatingSets(155),
      repRange: [8, 12],
      equipment: "barbell",
      historySessions: [
        historySession(deviatingSets(155)),
        historySession(deviatingSets(155)),
        historySession(nonDeviatingSets()),
      ],
    });

    expect(input.context.intentDeviation).toEqual({
      detected: false,
      severity: "none",
    });
  });

  it("detects moderate severity when exactly 2 of the last 3 valid exposures deviate", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: deviatingSets(165),
      repRange: [8, 12],
      equipment: "barbell",
      workingSetLoad: 165,
      historySessions: [
        historySession(deviatingSets(165)),
        historySession(nonDeviatingSets()),
        historySession(deviatingSets(165)),
      ],
    });

    expect(input.context.intentDeviation).toEqual({
      detected: true,
      severity: "moderate",
    });
    expect(input.context.intentDeviationTargetLoadCeiling).toBe(145);
    expect(input.decisionOptions.intentDeviation).toEqual(input.context.intentDeviation);
    expect(input.decisionOptions.intentDeviationTargetLoadCeiling).toBe(145);
  });

  it("detects strong severity when all 3 valid exposures deviate", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: deviatingSets(165),
      repRange: [8, 12],
      equipment: "barbell",
      historySessions: [
        historySession(deviatingSets(165)),
        historySession(deviatingSets(165)),
        historySession(deviatingSets(165)),
      ],
    });

    expect(input.context.intentDeviation).toEqual({
      detected: true,
      severity: "strong",
    });
    expect(input.context.intentDeviationTargetLoadCeiling).toBe(145);
  });
});

function deviatingSets(load: number) {
  return [
    {
      reps: 7,
      rpe: 8,
      load,
      targetLoad: 145,
      targetRepRange: { min: 8, max: 12 },
    },
    {
      reps: 7,
      rpe: 8,
      load,
      targetLoad: 145,
      targetRepRange: { min: 8, max: 12 },
    },
    {
      reps: 8,
      rpe: 8,
      load,
      targetLoad: 145,
      targetRepRange: { min: 8, max: 12 },
    },
    {
      reps: 7,
      rpe: 8,
      load,
      targetLoad: 145,
      targetRepRange: { min: 8, max: 12 },
    },
    {
      reps: 8,
      rpe: 8,
      load,
      targetLoad: 145,
      targetRepRange: { min: 8, max: 12 },
    },
  ];
}

function nonDeviatingSets() {
  return [
    {
      reps: 8,
      rpe: 8,
      load: 145,
      targetLoad: 145,
      targetRepRange: { min: 8, max: 12 },
    },
    {
      reps: 8,
      rpe: 8,
      load: 145,
      targetLoad: 145,
      targetRepRange: { min: 8, max: 12 },
    },
    {
      reps: 9,
      rpe: 8,
      load: 145,
      targetLoad: 145,
      targetRepRange: { min: 8, max: 12 },
    },
  ];
}

function historySession(sets: ReturnType<typeof deviatingSets>) {
  return {
    confidence: 1,
    selectionMode: "INTENT" as const,
    confidenceNotes: [],
    sets,
  };
}
