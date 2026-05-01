import { describe, expect, it } from "vitest";
import {
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  buildV2BasePlanValidation,
  buildV2ExerciseMaterializationPlan,
  buildV2PlannerMesocyclePolicy,
} from "./index";
import type {
  V2BasePlanValidation,
  V2ExerciseMaterializationPlan,
  V2MaterializationExercise,
  V2PlannerMesocyclePolicy,
} from "./index";

function exercise(
  input: Partial<V2MaterializationExercise> & {
    exerciseId: string;
    name: string;
    primaryMuscles: string[];
  },
): V2MaterializationExercise {
  return {
    aliases: [],
    movementPatterns: [],
    secondaryMuscles: [],
    equipment: [],
    isCompound: false,
    isMainLiftEligible: false,
    fatigueCost: 1,
    stimulusByMusclePerSet: {},
    ...input,
  };
}

const representativeV2Inventory: V2MaterializationExercise[] = [
  exercise({
    exerciseId: "machine-chest-press",
    name: "Machine Chest Press",
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Front Delts", "Triceps"],
    movementPatterns: ["horizontal_press"],
    isCompound: true,
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "cable-fly",
    name: "Cable Fly",
    primaryMuscles: ["Chest"],
    movementPatterns: ["fly"],
    fatigueCost: 2,
  }),
  exercise({
    exerciseId: "incline-machine-press",
    name: "Slight Incline Machine Press",
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Front Delts", "Triceps"],
    movementPatterns: ["horizontal_press"],
    isCompound: true,
    fatigueCost: 2,
  }),
  exercise({
    exerciseId: "chest-supported-row",
    name: "Chest Supported Row",
    primaryMuscles: ["Upper Back", "Lats"],
    movementPatterns: ["row"],
    isCompound: true,
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "cable-row",
    name: "Cable Row",
    primaryMuscles: ["Upper Back", "Lats"],
    movementPatterns: ["horizontal_pull"],
    isCompound: true,
    fatigueCost: 2,
  }),
  exercise({
    exerciseId: "lat-pulldown",
    name: "Neutral Grip Pulldown",
    primaryMuscles: ["Lats"],
    movementPatterns: ["vertical_pull"],
    isCompound: true,
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "assisted-pull-up",
    name: "Assisted Pull Up",
    primaryMuscles: ["Lats"],
    movementPatterns: ["vertical_pull"],
    isCompound: true,
    fatigueCost: 2,
  }),
  exercise({
    exerciseId: "rear-delt-fly",
    name: "Rear Delt Reverse Fly",
    primaryMuscles: ["Rear Delts"],
    movementPatterns: ["isolation"],
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "rope-pressdown",
    name: "Rope Pressdown",
    primaryMuscles: ["Triceps"],
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "machine-shoulder-press",
    name: "Machine Shoulder Press",
    aliases: ["OHP"],
    primaryMuscles: ["Front Delts", "Side Delts"],
    movementPatterns: ["vertical_press"],
    isCompound: true,
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "cable-lateral-raise",
    name: "Cable Lateral Raise",
    primaryMuscles: ["Side Delts"],
    movementPatterns: ["isolation"],
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "cable-curl",
    name: "Cable Curl",
    primaryMuscles: ["Biceps"],
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "hack-squat",
    name: "Hack Squat",
    primaryMuscles: ["Quads"],
    movementPatterns: ["squat"],
    isCompound: true,
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "leg-extension",
    name: "Leg Extension",
    primaryMuscles: ["Quads"],
    movementPatterns: ["isolation"],
    fatigueCost: 2,
  }),
  exercise({
    exerciseId: "leg-press",
    name: "Leg Press",
    primaryMuscles: ["Quads"],
    movementPatterns: ["leg_press"],
    isCompound: true,
    fatigueCost: 2,
  }),
  exercise({
    exerciseId: "seated-leg-curl",
    name: "Seated Leg Curl",
    primaryMuscles: ["Hamstrings"],
    movementPatterns: ["flexion", "isolation"],
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "lying-leg-curl",
    name: "Lying Leg Curl",
    primaryMuscles: ["Hamstrings"],
    movementPatterns: ["flexion", "isolation"],
    fatigueCost: 2,
  }),
  exercise({
    exerciseId: "barbell-hip-thrust",
    name: "Barbell Hip Thrust",
    primaryMuscles: ["Glutes", "Hamstrings"],
    stimulusByMusclePerSet: { "Lower Back": 0.25 },
    isCompound: true,
    fatigueCost: 2,
  }),
  exercise({
    exerciseId: "romanian-deadlift",
    name: "Romanian Deadlift",
    primaryMuscles: ["Hamstrings", "Glutes"],
    movementPatterns: ["hinge"],
    isCompound: true,
    isMainLiftEligible: true,
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "standing-calf-raise",
    name: "Standing Calf Raise",
    primaryMuscles: ["Calves"],
    movementPatterns: ["isolation"],
    fatigueCost: 1,
  }),
];

function buildFixture(): {
  policy: V2PlannerMesocyclePolicy;
  materializedPlan: V2ExerciseMaterializationPlan;
  validation: V2BasePlanValidation;
} {
  const policy = buildV2PlannerMesocyclePolicy();
  const materializedPlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: policy.exerciseSelectionPlan,
    inventory: representativeV2Inventory,
    taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    constraints: {
      avoidExerciseIds: [],
      favoriteExerciseIds: [],
      painConflictExerciseIds: [],
    },
  });
  const validation = buildV2BasePlanValidation({
    plannerPolicy: policy,
    materializedPlan,
    inventory: representativeV2Inventory,
    taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  });
  return { policy, materializedPlan, validation };
}

function warningReasons(validation: V2BasePlanValidation): string[] {
  return validation.warnings.map((warning) => warning.reason);
}

describe("buildV2BasePlanValidation", () => {
  it("detects full dry-run materialized coverage without treating materialized as pass", () => {
    const { materializedPlan, validation } = buildFixture();

    expect(materializedPlan.status).toBe("materialized");
    expect(validation).toMatchObject({
      version: 1,
      source: "v2_base_plan_validation",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "pass_with_warnings",
      summary: {
        slotCount: 4,
        exerciseCount: 19,
        totalSets: 58,
        blockerCount: 0,
        warningCount: 11,
        materializerStatus: "materialized",
      },
    });
    expect(validation.blockers).toEqual([]);
    expect(validation.summary.warningCount).toBeGreaterThan(0);
  });

  it("checks muscle coverage against balanced demand and direct floors", () => {
    const { validation } = buildFixture();
    const coverage = validation.checks.muscleCoverage;

    expect(coverage.belowFloorMuscles).toEqual([]);
    expect(coverage.aboveMaxMuscles).toEqual([]);
    expect(coverage.coveredMuscles).toEqual(
      expect.arrayContaining(["Chest", "Upper Back", "Quads", "Calves"]),
    );
    expect(coverage.abovePreferredMuscles).toEqual(
      expect.arrayContaining(["Hamstrings", "Lats"]),
    );
    expect(coverage.belowPreferredMuscles).toEqual(
      expect.arrayContaining(["Side Delts", "Rear Delts", "Biceps", "Triceps"]),
    );
    expect(coverage.directSupportFloors.missed).toEqual([]);
    expect(coverage.directSupportFloors.met).toEqual(
      expect.arrayContaining([
        "upper_b:side_delt_isolation:Side Delts",
        "upper_a:rear_delt:Rear Delts",
        "upper_a:triceps:Triceps",
        "upper_b:biceps:Biceps",
      ]),
    );
  });

  it("flags standalone one-set exercises for design review", () => {
    const { validation } = buildFixture();

    expect(validation.checks.setCountQuality.standaloneOneSetExercises).toEqual([
      "lower_a:secondary_hinge:Barbell Hip Thrust",
    ]);
    expect(warningReasons(validation)).toContain(
      "standalone_one_set_exercise:lower_a:secondary_hinge:Barbell Hip Thrust",
    );
  });

  it("checks chest distinct class exposure", () => {
    const { validation } = buildFixture();

    expect(
      validation.checks.exerciseClassCoverage.chestDistinctUpperExposures,
    ).toBe(true);
    expect(validation.checks.duplicateDistinctness.chestPressFlyDistinction)
      .toBe("passed");
  });

  it("checks side and rear delt directness", () => {
    const { validation } = buildFixture();

    expect(
      validation.checks.exerciseClassCoverage.sideDeltDirectLateralRaiseClass,
    ).toBe(true);
    expect(validation.checks.exerciseClassCoverage.rearDeltDirectSupportClass)
      .toBe(true);
    expect(warningReasons(validation)).toEqual(
      expect.arrayContaining([
        "Side Delts:direct_or_support_sets_below_balanced_base_preferred",
        "Rear Delts:direct_or_support_sets_below_balanced_base_preferred",
      ]),
    );
  });

  it("checks biceps and triceps direct/support coverage", () => {
    const { validation } = buildFixture();

    expect(validation.checks.muscleCoverage.directSupportFloors.met).toEqual(
      expect.arrayContaining([
        "upper_a:triceps:Triceps",
        "upper_b:biceps:Biceps",
      ]),
    );
    expect(warningReasons(validation)).toEqual(
      expect.arrayContaining([
        "Biceps:direct_or_support_sets_below_balanced_base_preferred",
        "Triceps:direct_or_support_sets_below_balanced_base_preferred",
      ]),
    );
  });

  it("checks hamstrings hinge plus knee-flexion curl", () => {
    const { validation } = buildFixture();

    expect(validation.checks.exerciseClassCoverage.hamstringsHingeAndCurl)
      .toBe(true);
    expect(validation.checks.muscleCoverage.abovePreferredMuscles).toContain(
      "Hamstrings",
    );
  });

  it("checks calf duplicate and variant policy", () => {
    const { validation } = buildFixture();

    expect(validation.checks.exerciseClassCoverage.calvesDirectLowerSlotWork)
      .toBe(true);
    expect(validation.checks.duplicateDistinctness.duplicateExerciseIds).toEqual([
      "standing-calf-raise",
    ]);
    expect(validation.checks.duplicateDistinctness.calfDuplicatePolicy).toBe(
      "variant_diversity_preferred",
    );
    expect(warningReasons(validation)).toContain(
      "calf_same_exercise_reused_across_lower_slots_variant_policy_needed",
    );
  });

  it("surfaces vertical press ownership and omission decision", () => {
    const { validation } = buildFixture();

    expect(validation.checks.verticalPressDecision).toMatchObject({
      targetSkeletonLaneRequired: true,
      selectionRequirement: "optional",
      classLaneKind: "managed_collateral_marker",
      materialized: false,
      decision: "managed_collateral_marker",
      targetSpecAlignmentIssue: true,
    });
    expect(warningReasons(validation)).toContain(
      "target_skeleton_marks_vertical_press_required_but_current_policy_omits_it_as_managed_collateral",
    );
  });

  it("verifies optional and managed collateral lanes are not materialized", () => {
    const { validation } = buildFixture();

    expect(
      validation.checks.exerciseClassCoverage.optionalLanesOmittedUnlessActivated,
    ).toBe(true);
    expect(
      validation.checks.exerciseClassCoverage
        .managedCollateralLanesNotMaterializedAsDirectDemand,
    ).toBe(true);
    expect(validation.checks.slotShape.optionalLaneMaterializedCount).toBe(0);
    expect(validation.checks.slotShape.managedCollateralLaneMaterializedCount)
      .toBe(0);
  });

  it("checks no default five-set stacking", () => {
    const { validation } = buildFixture();

    expect(validation.checks.setCountQuality.exercisesAtFiveOrMore).toEqual([]);
    expect(validation.blockers.map((blocker) => blocker.reason)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("default_five_set_stack")]),
    );
  });

  it("checks flat allocation warnings", () => {
    const { validation } = buildFixture();

    expect(validation.checks.setCountQuality.fourSetLaneCount).toBeGreaterThanOrEqual(
      6,
    );
    expect(validation.checks.setCountQuality.flatAllocationWarning).toBe(true);
    expect(warningReasons(validation)).toContain(
      "flat_allocation_pattern:many_lanes_at_four_sets_while_support_muscles_remain_below_preferred",
    );
  });

  it("checks glute direct-vs-collateral ambiguity", () => {
    const { validation } = buildFixture();

    expect(validation.checks.muscleCoverage.managedCollateralWarnings).toEqual(
      expect.arrayContaining([
        "Glutes:lower_a:secondary_hinge:Barbell Hip Thrust",
        "Glutes:lower_b:hinge_anchor:Romanian Deadlift",
      ]),
    );
    expect(warningReasons(validation)).toEqual(
      expect.arrayContaining([
        "managed_collateral_direct_work_ambiguity:Glutes:lower_a:secondary_hinge:Barbell Hip Thrust",
      ]),
    );
  });

  it("checks deload compatibility with same identities, reduced sets, high RIR, and no new movements", () => {
    const { validation } = buildFixture();

    expect(validation.checks.deloadCompatibility).toMatchObject({
      sameIdentitiesSupported: true,
      reducedSetsSupported: true,
      highRirSupported: true,
      noNewMovementsSupported: true,
      status: "compatible_with_limitations",
    });
    expect(validation.checks.deloadCompatibility.oneSetReductionLimitations)
      .toEqual(["lower_a:barbell-hip-thrust"]);
  });

  it("marks the diagnostic read-only and not behavior-consuming", () => {
    const { validation } = buildFixture();

    expect(validation.readOnly).toBe(true);
    expect(validation.affectsScoringOrGeneration).toBe(false);
    expect(validation.guardrails).toMatchObject({
      doesNotUseHistoricalStrategyRecommendations: true,
      doesNotUseRepairedProjection: true,
      doesNotAffectGeneration: true,
      doesNotAffectSelectionV2: true,
      doesNotAffectRepair: true,
      doesNotAffectSeedSerialization: true,
      doesNotAffectRuntimeReplay: true,
      doesNotAffectReceipts: true,
      consumedByDemandOrMaterializer: false,
    });
    expect(JSON.stringify(validation)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|acceptedPlannerIntent/,
    );
  });

  it("does not mutate materialized plan or seed/runtime behavior inputs", () => {
    const policy = buildV2PlannerMesocyclePolicy();
    const materializedPlan = buildV2ExerciseMaterializationPlan({
      exerciseSelectionPlan: policy.exerciseSelectionPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      constraints: {
        avoidExerciseIds: [],
        favoriteExerciseIds: [],
        painConflictExerciseIds: [],
      },
    });
    const before = JSON.stringify(materializedPlan);

    buildV2BasePlanValidation({
      plannerPolicy: policy,
      materializedPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });

    expect(JSON.stringify(materializedPlan)).toBe(before);
  });
});
