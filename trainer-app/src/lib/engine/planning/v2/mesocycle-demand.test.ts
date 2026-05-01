import { describe, expect, it } from "vitest";
import { buildV2DeloadTransformPolicy } from "./deload-transform";
import { buildV2MesocycleDemand } from "./mesocycle-demand";
import { buildV2TargetSkeleton } from "./target-skeleton";
import type { V2PlannerSetRange, V2TargetSkeleton } from "./types";

function buildDemand() {
  return buildV2MesocycleDemand({
    targetSkeleton: buildV2TargetSkeleton(),
  });
}

function demandFor(muscle: string) {
  const demand = buildDemand().muscles.find((row) => row.muscle === muscle);
  if (!demand) {
    throw new Error(`Missing demand row for ${muscle}`);
  }
  return demand;
}

function laneFor(
  skeleton: V2TargetSkeleton,
  slotId: string,
  laneId: string,
) {
  const lane = skeleton.slots
    .find((slot) => slot.slotId === slotId)
    ?.lanes.find((row) => row.laneId === laneId);
  if (!lane) {
    throw new Error(`Missing lane ${slotId}:${laneId}`);
  }
  return lane;
}

function rawLaneSummedRange(
  skeleton: V2TargetSkeleton,
  muscle: string,
): V2PlannerSetRange & { laneCount: number } {
  return skeleton.slots
    .flatMap((slot) => slot.lanes)
    .filter((lane) => lane.primaryMuscles.includes(muscle))
    .reduce(
      (total, lane) => ({
        min: total.min + lane.targetSets.min,
        preferred: total.preferred + lane.targetSets.preferred,
        max: total.max + lane.targetSets.max,
        laneCount: total.laneCount + 1,
      }),
      { min: 0, preferred: 0, max: 0, laneCount: 0 },
    );
}

describe("buildV2MesocycleDemand", () => {
  it("creates a first-class pure MesocycleDemand object from balanced base policy and target tiers", () => {
    const demand = buildDemand();
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
        evidencePolicy: "balanced_static_block_policy_and_volume_landmarks",
        allocationTiming: "before_exercise_selection",
        demandTiming: "before_slot_allocation",
      },
    });
    expect(chest).toMatchObject({
      targetTier: "A_PRIMARY",
      role: "primary",
      targetStatus: "hard",
      targetMode: "default",
      landmark: expect.objectContaining({ mev: 10, mav: 16 }),
      baselineSetRange: { min: 8, preferred: 9, max: 11 },
      exposureCount: 2,
      directness: expect.objectContaining({
        directSetFloor: 6,
        collateralCanSatisfyFloor: false,
        requiredClassIntents: expect.arrayContaining([
          "horizontal_press_or_slight_incline",
          "distinct_second_chest_press_or_fly",
        ]),
      }),
      source: expect.arrayContaining(["balanced_static_block_target_policy"]),
    });
    expect(sideDelts).toMatchObject({
      targetTier: "B_SUPPORT",
      role: "support",
      targetStatus: "soft",
      directness: expect.objectContaining({
        directSetFloor: 3,
        collateralCanSatisfyFloor: false,
      }),
    });
    expect(frontDelts).toMatchObject({
      targetTier: "IMPLICIT",
      role: "implicit",
      targetStatus: "diagnostic",
      targetMode: "managed_collateral",
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
    expect(JSON.stringify(demand)).not.toContain(
      "strategyHypothesisProjectionDiff",
    );
    expect(JSON.stringify(demand)).not.toContain(
      "v2_strategy_hypothesis_shadow_projection",
    );
    expect(JSON.stringify(demand)).not.toContain("promotion_diff");
    expect(JSON.stringify(demand)).not.toContain("projection_diff");
    expect(JSON.stringify(demand)).not.toContain("conflictAwareRefinement");
    expect(JSON.stringify(demand)).not.toContain("preShadowCandidateFilter");
    expect(JSON.stringify(demand)).not.toContain(
      "slotOwnedDemandAdjustmentPlan",
    );
    expect(JSON.stringify(demand)).not.toContain(
      "v2_slot_owned_demand_adjustment_plan",
    );
    expect(JSON.stringify(demand)).not.toContain("V2DonorSurplusEvidence");
    expect(JSON.stringify(demand)).not.toContain("donorSurplusEvidence");
    expect(JSON.stringify(demand)).not.toContain(
      "v2_donor_surplus_evidence",
    );
  });

  it("derives base demand from policy ranges instead of raw skeleton lane summing", () => {
    const skeleton = buildV2TargetSkeleton();
    const hamstrings = demandFor("Hamstrings");
    const chest = demandFor("Chest");
    const rawHamstrings = rawLaneSummedRange(skeleton, "Hamstrings");
    const rawChest = rawLaneSummedRange(skeleton, "Chest");

    expect(rawHamstrings).toMatchObject({
      preferred: 11,
      laneCount: 4,
    });
    expect(hamstrings).toMatchObject({
      baselineSetRange: { min: 4, preferred: 6, max: 8 },
      exposureCount: 2,
      directness: expect.objectContaining({
        requiredClassIntents: ["hinge_compound", "knee_flexion_curl"],
      }),
      limitations: expect.arrayContaining([
        "skeleton_lane_count_not_used_as_demand_count",
      ]),
    });
    expect(hamstrings.baselineSetRange.preferred).toBeLessThan(
      rawHamstrings.preferred,
    );
    expect(rawChest.laneCount).toBe(3);
    expect(chest.exposureCount).toBe(2);
  });

  it("keeps major target muscles in sane min/preferred/max ranges", () => {
    const expectedRanges = new Map<string, V2PlannerSetRange>([
      ["Chest", { min: 8, preferred: 9, max: 11 }],
      ["Lats", { min: 7, preferred: 9, max: 12 }],
      ["Upper Back", { min: 5, preferred: 7, max: 10 }],
      ["Quads", { min: 7, preferred: 9, max: 12 }],
      ["Hamstrings", { min: 4, preferred: 6, max: 8 }],
    ]);

    for (const [muscle, range] of expectedRanges) {
      const demand = demandFor(muscle);
      expect(demand.baselineSetRange).toEqual(range);
      expect(range.min).toBeLessThanOrEqual(range.preferred);
      expect(range.preferred).toBeLessThanOrEqual(range.max);
      expect(demand.targetStatus).toBe("hard");
      expect(demand.targetMode).toBe("default");
    }
  });

  it("gives Side Delts and Calves intentional direct support floors", () => {
    expect(demandFor("Side Delts")).toMatchObject({
      role: "support",
      targetStatus: "soft",
      baselineSetRange: { min: 4, preferred: 6, max: 8 },
      directness: {
        directSetFloor: 3,
        preferredDirectSets: 4,
        collateralCreditLimit: 2,
        collateralCanSatisfyFloor: false,
        requiredClassIntents: ["lateral_raise", "low_collateral_side_delt"],
      },
      cautions: expect.arrayContaining([
        "vertical_press_collateral_does_not_satisfy_direct_floor",
      ]),
    });
    expect(demandFor("Calves")).toMatchObject({
      role: "support",
      targetStatus: "soft",
      baselineSetRange: { min: 6, preferred: 8, max: 10 },
      exposureCount: 2,
      directness: {
        directSetFloor: 6,
        preferredDirectSets: 8,
        collateralCreditLimit: 0,
        collateralCanSatisfyFloor: false,
        requiredClassIntents: ["calf_isolation"],
      },
    });
  });

  it("treats Front Delts, Glutes, and Lower Back as managed collateral fatigue drivers", () => {
    for (const muscle of ["Front Delts", "Glutes", "Lower Back"]) {
      const demand = demandFor(muscle);
      expect(demand).toMatchObject({
        role: "implicit",
        targetStatus: "diagnostic",
        targetMode: "managed_collateral",
        exposureCount: 0,
        directness: expect.objectContaining({
          directSetFloor: 0,
          collateralCanSatisfyFloor: true,
        }),
        limitations: expect.arrayContaining([
          "managed_collateral_not_primary_target_demand",
        ]),
      });
      expect(demand.baselineSetRange.preferred).toBeLessThanOrEqual(2);
    }
  });

  it("keeps target class coverage explicit for the static upper/lower base plan", () => {
    const skeleton = buildV2TargetSkeleton();

    expect(demandFor("Chest")).toMatchObject({
      exposureCount: 2,
      directness: expect.objectContaining({
        requiredClassIntents: [
          "horizontal_press_or_slight_incline",
          "distinct_second_chest_press_or_fly",
        ],
      }),
    });
    expect(laneFor(skeleton, "upper_a", "chest_anchor")).toMatchObject({
      preferredExerciseClasses: ["horizontal_press", "slight_incline_press"],
    });
    expect(laneFor(skeleton, "upper_b", "chest_second_exposure")).toMatchObject({
      preferredExerciseClasses: ["distinct_chest_press_or_fly"],
    });
    expect(laneFor(skeleton, "upper_a", "row_anchor")).toMatchObject({
      preferredExerciseClasses: ["chest_supported_row", "cable_row", "t_bar_row"],
    });
    expect(laneFor(skeleton, "upper_b", "vertical_pull_anchor")).toMatchObject({
      preferredExerciseClasses: ["vertical_pull"],
    });
    expect(laneFor(skeleton, "lower_a", "squat_anchor")).toMatchObject({
      preferredExerciseClasses: ["squat_pattern"],
    });
    expect(laneFor(skeleton, "lower_b", "quad_support")).toMatchObject({
      preferredExerciseClasses: ["squat", "leg_press", "lunge", "quad_isolation"],
    });
    expect(laneFor(skeleton, "lower_b", "hinge_anchor")).toMatchObject({
      preferredExerciseClasses: [
        "hinge_compound",
        "low_axial_hip_extension_anchor",
      ],
    });
    expect(laneFor(skeleton, "lower_b", "knee_flexion_curl")).toMatchObject({
      preferredExerciseClasses: ["hamstring_curl"],
    });
  });

  it("keeps deload policy identity-preserving and recovery-biased", () => {
    expect(buildV2DeloadTransformPolicy()).toMatchObject({
      preserveExerciseIdentities: true,
      targetVolumeReductionPercent: { min: 40, max: 60 },
      targetRir: "4-5",
      introduceNewMovements: false,
      limitations: expect.arrayContaining([
        "not_applied_to_slotPlanSeedJson",
        "not_used_by_runtime_replay",
      ]),
    });
  });
});
