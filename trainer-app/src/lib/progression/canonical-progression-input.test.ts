import { describe, expect, it } from "vitest";
import { buildCanonicalProgressionEvaluationInput } from "./canonical-progression-input";
import type { ProgressionSet } from "../engine/progression";

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

  it("passes current target reps and RPE through to progression decision options", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: [{ reps: 6, rpe: 8.5, load: 135, targetLoad: 105 }],
      repRange: [6, 10],
      equipment: "barbell",
      currentTarget: {
        reps: 10,
        rpe: 6.5,
      },
    });

    expect(input.currentTarget).toEqual({ reps: 10, rpe: 6.5 });
    expect(input.context.currentTarget).toEqual({ reps: 10, rpe: 6.5 });
    expect(input.decisionOptions.currentTarget).toEqual({ reps: 10, rpe: 6.5 });
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

  it.each([6, 8, 9])("passes raw bound evidence without interpreting RPE $actualRpe", (actualRpe) => {
    const sets = prescriptionSets({ actualRpe });
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: sets,
      repRange: [8, 10],
      equipment: "barbell",
      currentTarget: { reps: 10, rpe: 8 },
      historySessions: [{ ...historySession(sets), exposureId: "workout-1", date: "2026-07-20" }],
      workingSetLoad: 100,
      loadIncrement: 5,
    });

    expect(input.context.loadIncrement).toBe(5);
    expect(input.context.selectedExposure).toMatchObject({
      exposureId: "workout-1",
      representativeLoad: 100,
      sets,
    });
    expect(input.decisionOptions.progressionExposures?.[0]).toEqual(
      input.context.selectedExposure
    );
    expect(input.context.selectedExposure).not.toHaveProperty("clearEasy");
    expect(input.context.selectedExposure).not.toHaveProperty("clearHard");
  });

  it("preserves recurrence exposure order without authoring repeated-success outcomes", () => {
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: prescriptionSets({ actualRpe: 8 }),
      repRange: [8, 10],
      equipment: "barbell",
      historySessions: [
        historySession(prescriptionSets({ actualRpe: 8 })),
        historySession(prescriptionSets({ actualRpe: 9.5, actualReps: 9 })),
        historySession(prescriptionSets({ actualRpe: 8 })),
      ],
    });

    expect(input.decisionOptions.progressionExposures?.map((item) => item.sets[0]?.rpe)).toEqual([
      8,
      9.5,
      8,
    ]);
    expect(input.decisionOptions.progressionExposures?.[0]).not.toHaveProperty("repeatedSuccess");
  });

  it("preserves missing actual RPE as raw evidence for the decision owner", () => {
    const sets = prescriptionSets({ actualRpe: undefined });
    const input = buildCanonicalProgressionEvaluationInput({
      lastSets: sets,
      repRange: [8, 10],
      equipment: "barbell",
      historySessions: [historySession(sets)],
    });

    expect(input.context.selectedExposure?.sets[0]?.rpe).toBeUndefined();
    expect(input.context.selectedExposure).not.toHaveProperty("prescriptionEvidenceIncomplete");
  });
});

function prescriptionSets(input: { actualRpe?: number; actualReps?: number }) {
  return [1, 2, 3].map((setIndex) => ({
    setIndex,
    reps: input.actualReps ?? 10,
    ...(input.actualRpe == null ? {} : { rpe: input.actualRpe }),
    load: 100,
    targetLoad: 100,
    targetReps: 10,
    targetRepMin: 8,
    targetRepMax: 10,
    targetRpe: 8,
  }));
}

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

function historySession(sets: ProgressionSet[]) {
  return {
    confidence: 1,
    selectionMode: "INTENT" as const,
    confidenceNotes: [],
    sets,
  };
}
