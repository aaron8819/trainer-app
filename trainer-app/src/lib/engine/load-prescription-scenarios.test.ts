import { describe, expect, it } from "vitest";
import { getLoadRecommendation } from "../progression/load-coaching";
import { LOAD_PRESCRIPTION_SCENARIOS } from "./load-prescription-scenarios.fixture";

describe("load prescription scenario matrix", () => {
  it("contains every canonical A-P scenario exactly once", () => {
    expect(LOAD_PRESCRIPTION_SCENARIOS.map((scenario) => scenario.id)).toEqual(
      "ABCDEFGHIJKLMNOP".split("")
    );
  });

  it.each(LOAD_PRESCRIPTION_SCENARIOS)("scenario $id: $description", (scenario) => {
    if (scenario.id === "H") {
      expect(scenario.isDeload).toBe(true);
      expect(scenario.expected.targetLoad).toBe(scenario.prior.performedLoad * 0.7);
      return;
    }

    if (scenario.id === "K" || scenario.id === "L") {
      const targetRir = 10 - scenario.prior.prescribedRpe;
      const recommendation = getLoadRecommendation({
        reps: scenario.prior.performedReps,
        rir:
          scenario.prior.actualRpe == null ? null : 10 - scenario.prior.actualRpe,
        actualLoad: scenario.prior.performedLoad,
        targetLoad: scenario.prior.prescribedLoad,
        repRange: {
          min: scenario.prior.prescribedRepMin ?? scenario.prior.prescribedReps,
          max: scenario.prior.prescribedReps,
        },
        targetRir,
        loadIncrement: scenario.increment,
      });
      expect(recommendation?.action).toBe(scenario.expected.direction);
      expect(recommendation?.suggestedLoad).toBe(scenario.expected.targetLoad);
      return;
    }

    if (scenario.id === "N") {
      expect(scenario.completedWorkingSetCount).toBe(0);
      return;
    }

    if (scenario.id === "D" || scenario.id === "E") {
      expect(scenario.expected.review).toBe("successful_autoregulation");
    }
    if (scenario.id === "P") {
      expect(scenario.expected.review).toBe("watch");
      expect(scenario.history?.filter((exposure) => exposure.successful)).toHaveLength(1);
    }

    const targetLoad = scenario.expected.targetLoad;
    if (targetLoad != null) {
      expect(Math.abs(targetLoad - scenario.prior.performedLoad)).toBeLessThanOrEqual(
        scenario.increment
      );
    }
  });
});
