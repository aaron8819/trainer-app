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
      intentDeviation: { flagged: false },
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

  it("detects repeated 2-of-3 high-load low-rep intent drift", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: [
        { reps: 6, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 },
        { reps: 6, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 },
        { reps: 7, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 },
      ],
      repRange: [6, 10],
      equipment: "barbell",
      workingSetLoad: 155,
      historySessions: [
        historySession([
          { reps: 6, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 },
          { reps: 6, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 },
          { reps: 7, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 },
        ]),
        historySession([
          { reps: 8, rpe: 8, load: 145, targetLoad: 145, targetReps: 8 },
          { reps: 8, rpe: 8, load: 145, targetLoad: 145, targetReps: 8 },
          { reps: 8, rpe: 8, load: 145, targetLoad: 145, targetReps: 8 },
        ]),
        historySession([
          { reps: 6, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 },
          { reps: 6, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 },
          { reps: 7, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 },
        ]),
      ],
    });

    expect(input.context.intentDeviation).toEqual({
      flagged: true,
      targetLoadCeiling: 145,
    });
    expect(input.decisionOptions.intentDeviation).toEqual(input.context.intentDeviation);
  });

  it("does not flag one-off deviation", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: [{ reps: 6, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 }],
      repRange: [6, 10],
      equipment: "barbell",
      historySessions: [
        historySession([{ reps: 6, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 }]),
        historySession([{ reps: 8, rpe: 8, load: 145, targetLoad: 145, targetReps: 8 }]),
        historySession([{ reps: 8, rpe: 8, load: 145, targetLoad: 145, targetReps: 8 }]),
      ],
    });

    expect(input.context.intentDeviation.flagged).toBe(false);
  });

  it("does not flag missing targetLoad", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: [{ reps: 6, rpe: 8, load: 155, targetReps: 8 }],
      repRange: [6, 10],
      equipment: "barbell",
      historySessions: [
        historySession([{ reps: 6, rpe: 8, load: 155, targetReps: 8 }]),
        historySession([{ reps: 6, rpe: 8, load: 155, targetReps: 8 }]),
      ],
    });

    expect(input.context.intentDeviation.flagged).toBe(false);
  });

  it("does not flag low reps without material load overshoot", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: [{ reps: 6, rpe: 8, load: 145, targetLoad: 145, targetReps: 8 }],
      repRange: [6, 10],
      equipment: "barbell",
      historySessions: [
        historySession([{ reps: 6, rpe: 8, load: 145, targetLoad: 145, targetReps: 8 }]),
        historySession([{ reps: 6, rpe: 8, load: 145, targetLoad: 145, targetReps: 8 }]),
      ],
    });

    expect(input.context.intentDeviation.flagged).toBe(false);
  });

  it("does not falsely trigger on slight under-range performance", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: [{ reps: 7, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 }],
      repRange: [6, 10],
      equipment: "barbell",
      historySessions: [
        historySession([{ reps: 7, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 }]),
        historySession([{ reps: 7, rpe: 8, load: 155, targetLoad: 145, targetReps: 8 }]),
      ],
    });

    expect(input.context.intentDeviation.flagged).toBe(false);
  });
});

function historySession(
  sets: Array<{
    reps: number;
    rpe: number;
    load: number;
    targetLoad?: number;
    targetReps?: number;
  }>
) {
  return {
    confidence: 1,
    selectionMode: "INTENT" as const,
    confidenceNotes: [],
    sets,
  };
}
