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
      targetSessionSets: { min: 15, preferred: 20, max: 20 },
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
    expect(slot(1, "upper_b")).toMatchObject({
      maxExerciseCount: 7,
    });
    expect(lane(1, "upper_b", "optional_triceps_if_under_target")).toMatchObject({
      requirement: "conditional_optional",
      role: "optional",
      classLaneKind: "optional_recoverable_lane",
      optionalMuscles: ["Triceps"],
      setBudget: { min: 2, preferred: 2, max: 2 },
      setBudgetBasis: "optional_activation_required",
      optionalActivation: {
        type: "activate_only_if_weekly_target_below_range",
      },
      duplicatePolicy: {
        scope: "same_week",
        sameExerciseAllowedOnlyWithJustification: true,
      },
      cleanAlternativePolicy: {
        requiredBeforeDuplicate: true,
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
        minDirectSets: 3,
        collateralCanSatisfy: false,
        requiredExerciseClasses: ["triceps_isolation", "pressdown"],
      },
    });
    expect(lane(1, "upper_b", "side_delt_isolation")).toMatchObject({
      directFloor: {
        muscle: "Side Delts",
        minDirectSets: 4,
        collateralCanSatisfy: false,
        requiredExerciseClasses: ["lateral_raise", "low_collateral_side_delt"],
      },
    });
  });

  it("turns vertical press into required chest-biased press support while keeping hinge collateral managed", () => {
    expect(lane(2, "upper_b", "vertical_press")).toMatchObject({
      requirement: "required",
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Chest", "Front Delts"],
      managedCollateralMuscles: [],
      ownershipKinds: ["support_exposure"],
      acceptableExerciseClasses: [
        "distinct_chest_press_or_fly",
        "machine_press",
        "cable_press",
        "vertical_press",
      ],
      setBudget: { min: 2, preferred: 3, max: 3 },
      setBudgetBasis: "class_ownership_allocation",
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
      setBudget: { min: 2, preferred: 3, max: 3 },
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
        requiredBeforeDuplicate: false,
        evaluationTiming: "future_inventory_selection",
      },
    });
    expect(lane(1, "upper_b", "side_delt_isolation")).toMatchObject({
      duplicatePolicy: {
        scope: "same_week",
        classDistinctness: "required_if_clean_alternative_exists",
      },
      cleanAlternativePolicy: {
        requiredBeforeDuplicate: false,
      },
    });
    expect(lane(1, "lower_b", "calves")).toMatchObject({
      duplicatePolicy: {
        scope: "same_week",
        classDistinctness: "required_if_clean_alternative_exists",
      },
      cleanAlternativePolicy: {
        requiredBeforeDuplicate: false,
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

  it("attaches planner-owned laneSelectionIntent v0 to high-risk lanes without seed identities", () => {
    expect(lane(2, "upper_b", "vertical_press")).toMatchObject({
      laneSelectionIntent: {
        version: 0,
        contract: "laneSelectionIntent",
        source: "v2_planner_policy",
        consumedByMaterializer: true,
        laneJob: "support_coverage",
        requiredMovementPattern: "chest_press",
        allowedExerciseClasses: ["chest_press", "chest_biased_press_support"],
        disallowedExerciseClasses: ["shoulder_biased_press"],
        directnessRequirement: "high_directness",
        minimumTargetStimulus: {
          muscle: "Chest",
          minimumPerSetStimulus: 0.75,
        },
      },
    });
    expect(lane(2, "lower_a", "hamstring_curl")).toMatchObject({
      laneSelectionIntent: {
        laneJob: "direct_floor",
        requiredMovementPattern: "knee_flexion",
        allowedExerciseClasses: ["hamstring_curl"],
        disallowedExerciseClasses: ["hinge", "back_extension", "hip_thrust"],
        directnessRequirement: "direct_only",
        consumedByMaterializer: true,
      },
    });
    expect(lane(1, "lower_a", "quad_isolation")).toMatchObject({
      laneSelectionIntent: {
        laneJob: "direct_floor",
        requiredMovementPattern: "knee_extension",
        allowedExerciseClasses: ["quad_isolation"],
        disallowedExerciseClasses: ["squat_pattern", "lunge", "leg_press"],
        directnessRequirement: "direct_only",
        consumedByMaterializer: true,
      },
    });
    expect(lane(1, "lower_a", "calves")).toMatchObject({
      laneSelectionIntent: {
        laneJob: "direct_floor",
        requiredMovementPattern: "calf_raise",
        allowedExerciseClasses: ["calf_isolation"],
        duplicatePolicy: "prefer_variation_if_clean",
        consumedByMaterializer: true,
      },
    });
    expect(lane(1, "upper_b", "side_delt_isolation")).toMatchObject({
      laneSelectionIntent: {
        laneJob: "direct_floor",
        requiredMovementPattern: "shoulder_abduction",
        allowedExerciseClasses: ["lateral_raise"],
        disallowedExerciseClasses: ["vertical_press"],
        consumedByMaterializer: true,
      },
    });
    expect(lane(1, "upper_a", "triceps")).toMatchObject({
      laneSelectionIntent: {
        laneJob: "direct_floor",
        requiredMovementPattern: "elbow_extension",
        allowedExerciseClasses: ["triceps_isolation"],
        disallowedExerciseClasses: ["chest_press", "vertical_press"],
        consumedByMaterializer: true,
      },
    });
    expect(lane(1, "upper_a", "rear_delt")).toMatchObject({
      laneSelectionIntent: {
        laneJob: "direct_floor",
        requiredMovementPattern: "rear_delt_fly",
        allowedExerciseClasses: ["rear_delt_isolation"],
        disallowedExerciseClasses: ["row_only"],
        consumedByMaterializer: true,
      },
    });
    expect(lane(1, "upper_b", "chest_second_exposure")).toMatchObject({
      laneSelectionIntent: {
        laneJob: "support_coverage",
        requiredMovementPattern: "chest_press_or_fly",
        preferredMovementPatterns: ["chest_press"],
        allowedExerciseClasses: ["chest_press", "chest_fly"],
        directnessRequirement: "high_directness",
        minimumTargetStimulus: {
          muscle: "Chest",
          minimumPerSetStimulus: 0.75,
        },
        consumedByMaterializer: false,
      },
    });
    expect(lane(1, "upper_b", "row_support")).toMatchObject({
      laneSelectionIntent: {
        laneJob: "support_coverage",
        requiredMovementPattern: "horizontal_pull",
        allowedExerciseClasses: ["row"],
        disallowedExerciseClasses: ["shrug", "vertical_pull", "pullover"],
        consumedByMaterializer: true,
      },
    });
    expect(lane(1, "lower_b", "hinge_anchor")).toMatchObject({
      laneSelectionIntent: {
        laneJob: "support_coverage",
        requiredMovementPattern: "low_axial_hip_extension",
        preferredMovementPatterns: ["low_axial_hip_extension"],
        allowedExerciseClasses: ["low_axial_hip_extension_anchor"],
        disallowedExerciseClasses: [
          "hinge",
          "hamstring_curl",
          "back_extension",
        ],
        directnessRequirement: "direct_or_high_support",
        minimumTargetStimulus: {
          muscle: "Glutes",
          minimumPerSetStimulus: 0.75,
        },
        fatiguePreference: "low_axial",
        loadabilityPreference: "moderate_or_high",
        consumedByMaterializer: true,
      },
    });
    expect(JSON.stringify(lane(2, "upper_b", "vertical_press").laneSelectionIntent)).not.toMatch(
      /exerciseId|exerciseName|slotPlanSeedJson|runtimeReplay/,
    );
  });

  it("keeps laneSelectionIntent v0 pure and JSON-serializable", () => {
    const intent = lane(1, "lower_b", "calves").laneSelectionIntent;

    expect(intent).toMatchObject({
      laneJob: "direct_floor",
      requiredMovementPattern: "calf_raise",
      allowedExerciseClasses: ["calf_isolation"],
      duplicatePolicy: "prefer_variation_if_clean",
      fallbackPolicy: "allow_duplicate_if_only_clean_option",
    });
    expect(JSON.parse(JSON.stringify(intent))).toEqual(intent);
  });

  it("is included in the aggregate V2 planner mesocycle policy", () => {
    const policy = buildV2PlannerMesocyclePolicy();

    expect(policy.exerciseSelectionPlan).toEqual(buildPlan());
    expect(policy.exerciseSelectionPlan.selectionTiming).toBe(
      "before_inventory_selection",
    );
  });
});
