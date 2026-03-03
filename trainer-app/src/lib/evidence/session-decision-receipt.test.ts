import { describe, expect, it } from "vitest";

import { readSessionDecisionReceipt } from "./session-decision-receipt";

describe("readSessionDecisionReceipt", () => {
  it("prefers the canonical persisted receipt over legacy top-level mirrors", () => {
    const receipt = readSessionDecisionReceipt({
      cycleContext: {
        weekInMeso: 99,
        weekInBlock: 99,
        phase: "deload",
        blockType: "deload",
        isDeload: true,
        source: "fallback",
      },
      lifecycleRirTarget: { min: 0, max: 0 },
      lifecycleVolumeTargets: { Chest: 99 },
      sorenessSuppressedMuscles: ["Chest"],
      deloadDecision: {
        mode: "reactive",
        reason: ["legacy"],
        reductionPercent: 60,
        appliedTo: "both",
      },
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 4,
          weekInBlock: 2,
          mesocycleLength: 6,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        lifecycleRirTarget: { min: 2, max: 3 },
        lifecycleVolume: {
          targets: { Chest: 16 },
          source: "lifecycle",
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
    });

    expect(receipt?.cycleContext.weekInMeso).toBe(4);
    expect(receipt?.lifecycleRirTarget).toEqual({ min: 2, max: 3 });
    expect(receipt?.lifecycleVolume.targets).toEqual({ Chest: 16 });
    expect(receipt?.sorenessSuppressedMuscles).toEqual([]);
    expect(receipt?.deloadDecision.mode).toBe("none");
  });

  it("returns undefined when no canonical persisted receipt exists", () => {
    const receipt = readSessionDecisionReceipt({
      cycleContext: {
        weekInMeso: 3,
        weekInBlock: 3,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      deloadDecision: {
        mode: "scheduled",
        reason: ["legacy deload"],
        reductionPercent: 50,
        appliedTo: "both",
      },
    });

    expect(receipt).toBeUndefined();
  });
});
