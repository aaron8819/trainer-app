import { describe, expect, it } from "vitest";

import { buildCanonicalSelectionMetadata, sanitizeSelectionMetadataForSave } from "./selection-metadata";

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

  it("drops receipt-shaped objects that do not parse as canonical receipts", () => {
    const result = sanitizeSelectionMetadataForSave({
      sessionDecisionReceipt: {
        cycleContext: {
          weekInMeso: 2,
        },
      },
      selectedExerciseIds: ["bench"],
    });

    expect(result).toEqual({
      selectedExerciseIds: ["bench"],
    });
  });
});

describe("buildCanonicalSelectionMetadata", () => {
  it("stores generation readiness context only inside sessionDecisionReceipt", () => {
    const result = buildCanonicalSelectionMetadata(
      {
        selectedExerciseIds: ["bench"],
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
      },
      {
        original: {
          id: "w1",
          scheduledDate: "2026-03-03T00:00:00.000Z",
          warmup: [],
          mainLifts: [],
          accessories: [],
          estimatedMinutes: 45,
        },
        adjusted: {
          id: "w1",
          scheduledDate: "2026-03-03T00:00:00.000Z",
          warmup: [],
          mainLifts: [],
          accessories: [],
          estimatedMinutes: 45,
        },
        modifications: [],
        fatigueScore: null,
        rationale: "Scaled session from recent readiness (signal 3.0h old)",
        wasAutoregulated: false,
        applied: false,
        reason: "Scaled session from recent readiness (signal 3.0h old)",
        signalAgeHours: 3,
      }
    );

    expect(result.sessionDecisionReceipt?.readiness).toEqual({
      wasAutoregulated: false,
      signalAgeHours: 3,
      fatigueScoreOverall: null,
      intensityScaling: {
        applied: false,
        exerciseIds: [],
        scaledUpCount: 0,
        scaledDownCount: 0,
      },
      rationale: "Scaled session from recent readiness (signal 3.0h old)",
    });
    expect((result as Record<string, unknown>).autoregulation).toBeUndefined();
  });
});
