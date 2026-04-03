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
});
