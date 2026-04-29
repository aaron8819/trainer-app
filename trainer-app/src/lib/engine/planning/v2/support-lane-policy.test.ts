import { describe, expect, it } from "vitest";
import {
  buildV2PlannerMesocyclePolicy,
  buildV2SupportLanePolicy,
  evaluateV2SupportLaneOptionalActivation,
  resolveV2TierAwareConcentrationPolicy,
  type V2SupportLanePolicyRationaleLabel,
} from "./index";
import { buildV2TargetSkeleton } from "./target-skeleton";

function policyByMuscle(
  muscle: "Triceps" | "Side Delts" | "Rear Delts" | "Biceps",
) {
  const policy = buildV2SupportLanePolicy({
    targetSkeleton: buildV2TargetSkeleton(),
  });
  const row = policy.supportLanes.find((lane) => lane.muscle === muscle);
  if (!row) {
    throw new Error(`Missing support policy for ${muscle}`);
  }
  return row;
}

describe("buildV2SupportLanePolicy", () => {
  it("derives support policy from the V2 skeleton and target tier evidence only", () => {
    const policy = buildV2SupportLanePolicy({
      targetSkeleton: buildV2TargetSkeleton(),
    });

    expect(policy).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      designBasis: {
        targetSkeleton: "upper_lower_4x_v2",
        evidencePolicy: "volume_landmarks_and_target_tiers",
        allocationTiming: "before_exercise_selection",
      },
      summary: {
        policyCount: 4,
        requiredDirectFloorCount: 4,
        optionalConditionalLaneCount: 1,
      },
    });
    expect(JSON.stringify(policy)).not.toMatch(
      /planningReality|noRepair|repairedProjection|slotPlanSeedJson|runtimeReplay/,
    );
    const requiredLabels: V2SupportLanePolicyRationaleLabel[] = [
      "hypertrophy_training_principle",
      "v2_target_spec",
      "app_architecture",
      "diagnostic_only",
    ];
    expect(
      policy.supportLanes.every((lane) =>
        requiredLabels.every((label) => lane.rationaleLabels.includes(label)),
      ),
    ).toBe(true);
  });

  it("keeps Triceps pressing collateral from satisfying the Upper A direct floor", () => {
    const triceps = policyByMuscle("Triceps");

    expect(triceps).toMatchObject({
      owningSlotId: "upper_a",
      owningLaneId: "triceps",
      directFloor: {
        minDirectSets: 2,
        requiredExerciseClasses: ["triceps_isolation", "pressdown"],
        collateralCanSatisfyDirectFloor: false,
      },
      preferredDirectSets: { min: 2, preferred: 3, max: 3 },
      collateralMaySupplement: true,
      collateralCanSatisfyDirectFloor: false,
    });
    expect(triceps.collateralCreditLimit.collateralSources).toEqual(
      expect.arrayContaining(["horizontal_press", "vertical_press"]),
    );
  });

  it("prioritizes Side Delts direct lateral raise work over OHP collateral", () => {
    const sideDelts = policyByMuscle("Side Delts");

    expect(sideDelts).toMatchObject({
      owningSlotId: "upper_b",
      owningLaneId: "side_delt_isolation",
      directFloor: {
        minDirectSets: 3,
        requiredExerciseClasses: ["lateral_raise", "low_collateral_side_delt"],
      },
      preferredDirectSets: { min: 3, preferred: 4, max: 4 },
    });
    expect(sideDelts.expansionPolicy.firstChoice).toContain("lateral_raise");
    expect(sideDelts.expansionPolicy.supplementalOnly).toContain(
      "ohp_vertical_press_collateral",
    );
    expect(sideDelts.expansionPolicy.avoidAsPrimarySolution).toContain(
      "vertical_press_collateral_as_side_delt_solution",
    );
  });

  it("prioritizes Rear Delts direct isolation over row collateral", () => {
    const rearDelts = policyByMuscle("Rear Delts");

    expect(rearDelts).toMatchObject({
      owningSlotId: "upper_a",
      owningLaneId: "rear_delt",
      directFloor: {
        minDirectSets: 2,
        requiredExerciseClasses: ["rear_delt_isolation"],
      },
      preferredDirectSets: { min: 2, preferred: 3, max: 3 },
    });
    expect(rearDelts.expansionPolicy.firstChoice).toBe(
      "upper_a_rear_delt_isolation",
    );
    expect(rearDelts.expansionPolicy.avoidAsPrimarySolution).toContain(
      "generic_row_collateral_as_rear_delt_floor",
    );
    expect(rearDelts.limitations).toContain(
      "second_exposure_provisional_diagnostic_only",
    );
  });

  it("keeps the Biceps direct curl floor Upper B only", () => {
    const biceps = policyByMuscle("Biceps");

    expect(biceps).toMatchObject({
      owningSlotId: "upper_b",
      owningLaneId: "biceps",
      directFloor: {
        slotId: "upper_b",
        laneId: "biceps",
        minDirectSets: 2,
        requiredExerciseClasses: ["biceps_isolation"],
      },
      preferredDirectSets: { min: 2, preferred: 3, max: 3 },
    });
    expect(biceps.expansionPolicy.provisionalOrDiagnosticOnly).toContain(
      "upper_a_biceps_not_a_hard_floor",
    );
  });

  it("activates optional Upper B Triceps only under explicit under-floor logic", () => {
    const triceps = policyByMuscle("Triceps");

    expect(
      evaluateV2SupportLaneOptionalActivation({
        policy: triceps,
        candidateSlotId: "upper_b",
        directSetsInOwningSlot: 2,
        reasonableCollateralEffectiveSets: 1,
        recoverable: true,
      }),
    ).toMatchObject({
      active: true,
      reason: "still_under_support_floor_after_direct_floor_and_collateral",
      countedTowardDirectFloor: 0,
    });
    expect(
      evaluateV2SupportLaneOptionalActivation({
        policy: triceps,
        candidateSlotId: "upper_b",
        directSetsInOwningSlot: 2,
        reasonableCollateralEffectiveSets: 2,
        recoverable: true,
      }).active,
    ).toBe(false);
    expect(
      evaluateV2SupportLaneOptionalActivation({
        policy: triceps,
        candidateSlotId: "upper_b",
        directSetsInOwningSlot: 1,
        reasonableCollateralEffectiveSets: 0,
        recoverable: true,
      }).reason,
    ).toBe("direct_floor_not_attempted");
  });

  it("keeps primary target concentration stricter than B_SUPPORT direct isolation", () => {
    const primary = resolveV2TierAwareConcentrationPolicy({
      targetTier: "A_PRIMARY",
      laneKind: "primary_target",
    });
    const support = resolveV2TierAwareConcentrationPolicy({
      targetTier: "B_SUPPORT",
      laneKind: "support_direct_isolation",
    });

    expect(primary.warningShare).toBeLessThan(support.warningShare);
    expect(primary.blockerShare).toBeLessThan(support.blockerShare);
  });

  it("is included in the aggregate V2 planner mesocycle policy as read-only metadata", () => {
    const policy = buildV2PlannerMesocyclePolicy();

    expect(policy.v2SupportLanePolicy).toMatchObject({
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        policyCount: 4,
      },
    });
  });
});
