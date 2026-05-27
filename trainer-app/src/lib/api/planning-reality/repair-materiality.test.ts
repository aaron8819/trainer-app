import { describe, expect, it } from "vitest";
import { buildWarnings } from "./repair-materiality";

describe("planning reality repair materiality target semantics", () => {
  it("labels hard target gaps as preferred-target evidence, not floor failure", () => {
    const warnings = buildWarnings({
      weeklyMuscleDemand: [],
      slotDemandAllocation: [],
      repairMateriality: [],
      exerciseConcentration: [],
      projectedDelivery: [
        {
          muscle: "Chest",
          targetStatus: "hard",
          targetRange: null,
          preferredTarget: 10,
          projectedEffectiveStimulusAfterInitialSlotComposition: 8,
          projectedEffectiveStimulusAfterRepairAndFinalShaping: 11,
          deltaFromPreferredTarget: 1,
          exposureCount: 1,
          majorContributingExercises: [],
        },
      ],
    });

    expect(warnings).toEqual([
      {
        code: "PRIMARY_MUSCLE_BELOW_TARGET_BEFORE_REPAIR",
        severity: "warning",
        message:
          "A hard weekly-demand muscle was below its preferred target before final repair/shaping; this is target-gap evidence, not a floor failure by itself.",
        evidence: ["Chest:8/10"],
      },
    ]);
  });
});
