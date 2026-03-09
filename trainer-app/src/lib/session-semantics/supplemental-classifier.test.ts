import { describe, expect, it } from "vitest";

import {
  hasSupplementalDeficitMarker,
  isStrictSupplementalDeficitSession,
} from "./supplemental-classifier";

const metadata = {
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
};

describe("supplemental-classifier", () => {
  it("detects the supplemental deficit receipt marker", () => {
    expect(hasSupplementalDeficitMarker(metadata)).toBe(true);
  });

  it("requires INTENT + BODY_PART for strict supplemental classification", () => {
    expect(
      isStrictSupplementalDeficitSession({
        selectionMetadata: metadata,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
      })
    ).toBe(true);
    expect(
      isStrictSupplementalDeficitSession({
        selectionMetadata: metadata,
        selectionMode: "AUTO",
        sessionIntent: "BODY_PART",
      })
    ).toBe(false);
  });
});
