import { describe, expect, it } from "vitest";
import {
  buildV2ExerciseSelectionPlan,
  buildV2PlannerMesocyclePolicy,
} from "./index";

function buildPlan() {
  const policy = buildV2PlannerMesocyclePolicy();
  return buildV2ExerciseSelectionPlan({
    exerciseClassDistributionBySlot: policy.exerciseClassDistributionBySlot,
    v2SetDistributionIntent: policy.v2SetDistributionIntent,
    v2SupportLanePolicy: policy.v2SupportLanePolicy,
    selectionCapacityPlan: policy.selectionCapacityPlan,
  });
}

function lane(week: number, slotId: string, laneId: string) {
  const found = buildPlan()
    .weeks.find((row) => row.week === week)
    ?.slots.find((slot) => slot.slotId === slotId)
    ?.lanes.find((row) => row.laneId === laneId);
  if (!found) {
    throw new Error(`Missing exercise-selection lane ${week}:${slotId}:${laneId}`);
  }
  return found;
}

function slot(week: number, slotId: string) {
  const found = buildPlan()
    .weeks.find((row) => row.week === week)
    ?.slots.find((row) => row.slotId === slotId);
  if (!found) {
    throw new Error(`Missing exercise-selection slot ${week}:${slotId}`);
  }
  return found;
}

function collectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys);
  }
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...collectKeys(nested),
  ]);
}

describe("buildV2ExerciseSelectionPlan", () => {
  it("returns deterministic V2 lane-level selection requirements", () => {
    const first = buildPlan();
    const second = buildPlan();

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      selectionTiming: "before_inventory_selection",
      guardrails: {
        doesNotUseSelectedIdentities: true,
        doesNotUseExerciseInventory: true,
        doesNotUseNoRepairOutput: true,
        doesNotUseRepairedProjection: true,
        doesNotAffectSelection: true,
        doesNotAffectRepair: true,
        doesNotAffectSeedSerialization: true,
        doesNotAffectRuntimeReplay: true,
      },
    });
    expect(first.weeks.map((week) => week.week)).toEqual([1, 2, 3, 4, 5]);
  });

  it("contains no selected identities, candidate inventory, exercise ids, or exercise names", () => {
    const keys = collectKeys(buildPlan());
    const serialized = JSON.stringify(buildPlan());

    expect(keys).not.toEqual(
      expect.arrayContaining([
        "exerciseId",
        "exerciseName",
        "selectedIdentity",
        "selectedExercise",
        "candidateInventory",
        "inventoryEvidence",
        "slotPlans",
        "weeklyMuscleTotals",
        "planningReality",
        "repairMateriality",
        "v2TargetVsNoRepairDiff",
        "v2ExerciseSelectionPlanDiagnostic",
        "blockers",
        "warnings",
        "safeForBehaviorPromotion",
      ]),
    );
    expect(serialized).not.toMatch(
      /exerciseId|exerciseName|selectedIdentity|candidateInventory|planningReality|noRepair|repairedProjection|slotPlanSeedJson|runtimeReplay/,
    );
  });

  it("represents required lanes and capacity sourced from SelectionCapacityPlan", () => {
    expect(slot(2, "upper_a")).toMatchObject({
      maxExerciseCount: 6,
      targetSessionSets: { min: 15, preferred: 16, max: 17 },
    });
    expect(lane(2, "upper_a", "chest_anchor")).toMatchObject({
      requirement: "required",
      role: "anchor",
      classLaneKind: "owned_class_lane",
      ownershipKinds: ["primary_exposure"],
      primaryMuscles: ["Chest"],
      acceptableExerciseClasses: ["horizontal_press", "slight_incline_press"],
      preferredExerciseClasses: ["horizontal_press", "slight_incline_press"],
      setBudget: { min: 3, preferred: 4, max: 4 },
      setBudgetBasis: "class_ownership_allocation",
      perExerciseCap: {
        maxSetsWithoutJustification: 4,
        maxDirectExercises: 2,
        allowAboveFiveSetsOnlyWithJustification: true,
      },
    });
  });

  it("represents optional and conditional optional lanes without evaluating them", () => {
    expect(lane(1, "upper_b", "optional_triceps_if_under_target")).toMatchObject({
      requirement: "conditional_optional",
      role: "optional",
      classLaneKind: "optional_recoverable_lane",
      optionalMuscles: ["Triceps"],
      setBudget: { min: 0, preferred: 0, max: 0 },
      setBudgetBasis: "optional_activation_required",
      optionalActivation: {
        type: "activate_only_if_weekly_target_below_range",
      },
      cleanAlternativePolicy: {
        evaluationTiming: "future_inventory_selection",
      },
    });
    expect(lane(1, "lower_b", "optional_glute_core_if_recoverable")).toMatchObject(
      {
        requirement: "optional",
        role: "optional",
        classLaneKind: "optional_recoverable_lane",
        optionalMuscles: ["Core", "Glutes"],
        setBudget: { min: 0, preferred: 0, max: 0 },
        continuityPolicy: {
          preserve: "lane_role",
        },
      },
    );
  });

  it("represents direct support floors with collateralCanSatisfy false", () => {
    expect(lane(1, "upper_a", "triceps")).toMatchObject({
      directFloor: {
        muscle: "Triceps",
        minDirectSets: 2,
        collateralCanSatisfy: false,
        requiredExerciseClasses: ["triceps_isolation", "pressdown"],
      },
    });
    expect(lane(1, "upper_b", "side_delt_isolation")).toMatchObject({
      directFloor: {
        muscle: "Side Delts",
        minDirectSets: 3,
        collateralCanSatisfy: false,
        requiredExerciseClasses: ["lateral_raise", "low_collateral_side_delt"],
      },
    });
  });

  it("preserves ownership markers for managed collateral without making them selected demand", () => {
    expect(lane(2, "upper_b", "vertical_press")).toMatchObject({
      requirement: "optional",
      classLaneKind: "managed_collateral_marker",
      primaryMuscles: [],
      managedCollateralMuscles: ["Front Delts"],
      ownershipKinds: ["managed_collateral"],
      acceptableExerciseClasses: ["vertical_press"],
      setBudget: { min: 0, preferred: 0, max: 0 },
      setBudgetBasis: "managed_collateral_budget",
    });
    expect(lane(2, "lower_b", "hinge_anchor")).toMatchObject({
      classLaneKind: "owned_class_lane",
      primaryMuscles: ["Hamstrings"],
      managedCollateralMuscles: ["Glutes", "Lower Back"],
      ownershipKinds: ["managed_collateral", "primary_exposure"],
      setBudget: { min: 3, preferred: 3, max: 4 },
    });
  });

  it("uses SetDistributionIntent budgets instead of skeleton lane defaults", () => {
    expect(lane(2, "lower_a", "hamstring_curl")).toMatchObject({
      setBudget: { min: 2, preferred: 2, max: 2 },
      setBudgetBasis: "class_ownership_allocation",
    });
    expect(lane(2, "lower_a", "secondary_hinge")).toMatchObject({
      requirement: "optional",
      role: "optional",
      classLaneKind: "optional_recoverable_lane",
      primaryMuscles: [],
      optionalMuscles: ["Hamstrings"],
      managedCollateralMuscles: ["Glutes", "Lower Back"],
      setBudget: { min: 0, preferred: 0, max: 0 },
      setBudgetBasis: "optional_activation_required",
    });
    expect(lane(2, "lower_b", "knee_flexion_curl")).toMatchObject({
      setBudget: { min: 2, preferred: 2, max: 2 },
      acceptableExerciseClasses: ["hamstring_curl"],
    });
  });

  it("represents duplicate and class-distinctness policy as future inventory policy", () => {
    expect(lane(1, "upper_a", "rear_delt")).toMatchObject({
      duplicatePolicy: {
        scope: "same_slot",
        classDistinctness: "required_if_clean_alternative_exists",
        sameExerciseAllowedOnlyWithJustification: true,
      },
      cleanAlternativePolicy: {
        requiredBeforeDuplicate: true,
        evaluationTiming: "future_inventory_selection",
      },
    });
    expect(lane(1, "upper_a", "chest_anchor")).toMatchObject({
      duplicatePolicy: {
        scope: "across_accumulation",
        classDistinctness: "preferred",
      },
    });
  });

  it("represents cross-week continuity policy without planning exact identities", () => {
    expect(lane(3, "upper_a", "row_anchor")).toMatchObject({
      continuityPolicy: {
        preserve: "lane_class",
        exactIdentityPolicy: "not_planned_until_inventory_selection",
        crossWeekVariation: "stable_class_preferred",
      },
    });
    expect(lane(3, "upper_a", "vertical_pull_support")).toMatchObject({
      continuityPolicy: {
        preserve: "lane_class",
        exactIdentityPolicy: "not_planned_until_inventory_selection",
        crossWeekVariation: "variation_allowed_within_class",
      },
    });
  });

  it("is included in the aggregate V2 planner mesocycle policy", () => {
    const policy = buildV2PlannerMesocyclePolicy();

    expect(policy.exerciseSelectionPlan).toEqual(buildPlan());
    expect(policy.exerciseSelectionPlan.selectionTiming).toBe(
      "before_inventory_selection",
    );
  });
});
