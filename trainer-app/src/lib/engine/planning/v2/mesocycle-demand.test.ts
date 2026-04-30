import { describe, expect, it } from "vitest";
import { buildV2MesocycleDemand } from "./mesocycle-demand";
import { buildV2TargetSkeleton } from "./target-skeleton";

describe("buildV2MesocycleDemand", () => {
  it("creates a first-class pure MesocycleDemand object from skeleton and target tiers", () => {
    const demand = buildV2MesocycleDemand({
      targetSkeleton: buildV2TargetSkeleton(),
    });
    const chest = demand.muscles.find((muscle) => muscle.muscle === "Chest");
    const sideDelts = demand.muscles.find(
      (muscle) => muscle.muscle === "Side Delts",
    );
    const frontDelts = demand.muscles.find(
      (muscle) => muscle.muscle === "Front Delts",
    );

    expect(demand).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      designBasis: {
        evidencePolicy: "volume_landmarks_and_target_tiers",
        allocationTiming: "before_exercise_selection",
      },
    });
    expect(chest).toMatchObject({
      targetTier: "A_PRIMARY",
      role: "primary",
      targetStatus: "hard",
      landmark: expect.objectContaining({ mev: 10, mav: 16 }),
      baselineSetRange: { min: 8, preferred: 11, max: 11 },
      exposureCount: 3,
    });
    expect(sideDelts).toMatchObject({
      targetTier: "B_SUPPORT",
      role: "primary",
      targetStatus: "soft",
    });
    expect(frontDelts).toMatchObject({
      targetTier: "IMPLICIT",
      role: "primary",
      targetStatus: "diagnostic",
    });
    expect(demand.guardrails).toEqual({
      doesNotUsePlanningReality: true,
      doesNotUseNoRepairOutput: true,
      doesNotUseRepairedProjection: true,
      doesNotUseAcceptedSeed: true,
      doesNotUseRuntimeReplay: true,
    });
    expect(JSON.stringify(demand)).not.toContain(
      "strategyHypothesisPromotionDiff",
    );
    expect(JSON.stringify(demand)).not.toContain("promotion_diff");
  });
});
