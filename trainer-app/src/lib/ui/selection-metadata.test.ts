import { describe, expect, it } from "vitest";

import { sanitizeSelectionMetadataForSave } from "./selection-metadata";

describe("sanitizeSelectionMetadataForSave", () => {
  it("keeps only canonical save-safe selection metadata fields", () => {
    const result = sanitizeSelectionMetadataForSave({
      rationale: {
        bench: {
          score: 0.9,
        },
      },
      selectedExerciseIds: ["bench"],
      perExerciseSetTargets: { bench: 3 },
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 2,
          weekInBlock: 2,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        lifecycleVolume: {
          source: "unknown",
        },
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: "none",
          reason: [],
          reductionPercent: 0,
          appliedTo: "none",
        },
        readiness: {
          wasAutoregulated: false,
          signalAgeHours: null,
          fatigueScoreOverall: null,
          intensityScaling: {
            applied: false,
            exerciseIds: [],
            scaledUpCount: 0,
            scaledDownCount: 0,
          },
        },
        exceptions: [],
      },
      cycleContext: {
        weekInMeso: 99,
      },
      deloadDecision: {
        mode: "reactive",
      },
      sorenessSuppressedMuscles: ["Chest"],
      lifecycleRirTarget: { min: 9, max: 9 },
      lifecycleVolumeTargets: { Chest: 99 },
      adaptiveDeloadApplied: true,
      periodizationWeek: 8,
    });

    expect(result).toEqual({
      rationale: {
        bench: {
          score: 0.9,
        },
      },
      selectedExerciseIds: ["bench"],
      perExerciseSetTargets: { bench: 3 },
      sessionDecisionReceipt: expect.objectContaining({
        version: 1,
      }),
    });
  });
});
