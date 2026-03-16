import { describe, expect, it } from "vitest";

import { isProgressionEligibleWorkout } from "./progression-eligibility";

describe("isProgressionEligibleWorkout", () => {
  it("excludes scheduled deload sessions from progression anchors", () => {
    expect(
      isProgressionEligibleWorkout({
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 5,
              weekInBlock: 1,
              phase: "deload",
              blockType: "deload",
              isDeload: true,
              source: "computed",
            },
            lifecycleVolume: {
              source: "unknown",
            },
            sorenessSuppressedMuscles: [],
            deloadDecision: {
              mode: "scheduled",
              reason: ["Scheduled deload week."],
              reductionPercent: 50,
              appliedTo: "volume",
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
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
      })
    ).toBe(false);
  });

  it("excludes strict supplemental deficit sessions from progression anchors", () => {
    expect(
      isProgressionEligibleWorkout({
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 4,
              weekInBlock: 4,
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
            exceptions: [
              {
                code: "supplemental_deficit_session",
                message: "Marked as supplemental deficit session.",
              },
            ],
          },
        },
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
      })
    ).toBe(false);
  });

  it("leaves optional gap-fill progression eligibility unchanged in this patch", () => {
    expect(
      isProgressionEligibleWorkout({
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 4,
              weekInBlock: 4,
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
            exceptions: [
              {
                code: "optional_gap_fill",
                message: "Marked as optional gap-fill session.",
              },
            ],
          },
        },
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
      })
    ).toBe(true);
  });
});
