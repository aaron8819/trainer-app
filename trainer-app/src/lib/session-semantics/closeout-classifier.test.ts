import { describe, expect, it } from "vitest";

import { isCloseoutSession } from "./closeout-classifier";

describe("closeout-classifier", () => {
  it("detects the canonical closeout receipt marker", () => {
    expect(
      isCloseoutSession({
        weekCloseId: "week-close-1",
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
              code: "closeout_session",
              message: "Marked as closeout session.",
            },
          ],
        },
      })
    ).toBe(true);
  });

  it("fails closed when the closeout marker is absent", () => {
    expect(
      isCloseoutSession({
        weekCloseId: "week-close-1",
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
          exceptions: [],
        },
      })
    ).toBe(false);
  });
});
