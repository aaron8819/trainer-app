import { describe, expect, it } from "vitest";
import {
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  buildV2BasePlanCompare,
  buildV2BasePlanShadowConsumptionTrial,
  buildV2BasePlanValidation,
  buildV2ExerciseMaterializationPlan,
  buildV2PlannerMesocyclePolicy,
} from "./index";
import type {
  V2BasePlanComparePlanView,
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

function blockerReasons(validation: V2BasePlanValidation): string[] {
  return validation.blockers.map((blocker) => blocker.reason);
}

function replaceLaneExercise(input: {
  plan: V2ExerciseMaterializationPlan;
  slotId: string;
  laneId: string;
  exerciseId: string;
}): V2ExerciseMaterializationPlan {
  return {
    ...input.plan,
    slots: input.plan.slots.map((slot) =>
      slot.slotId === input.slotId
        ? {
            ...slot,
            exercises: slot.exercises.map((exerciseRow) =>
              exerciseRow.laneIds.includes(input.laneId)
                ? { ...exerciseRow, exerciseId: input.exerciseId }
                : exerciseRow,
            ),
          }
        : slot,
    ),
  };
}

function removeLaneExercise(input: {
  plan: V2ExerciseMaterializationPlan;
  slotId: string;
  laneId: string;
}): V2ExerciseMaterializationPlan {
  return {
    ...input.plan,
    slots: input.plan.slots.map((slot) =>
      slot.slotId === input.slotId
        ? {
            ...slot,
            exercises: slot.exercises.filter(
              (exerciseRow) => !exerciseRow.laneIds.includes(input.laneId),
            ),
          }
        : slot,
    ),
  };
}

function setLaneSetCount(input: {
  plan: V2ExerciseMaterializationPlan;
  slotId: string;
  laneId: string;
  setCount: number;
}): V2ExerciseMaterializationPlan {
  return {
    ...input.plan,
    slots: input.plan.slots.map((slot) =>
      slot.slotId === input.slotId
        ? {
            ...slot,
            exercises: slot.exercises.map((exerciseRow) =>
              exerciseRow.laneIds.includes(input.laneId)
                ? { ...exerciseRow, setCount: input.setCount }
                : exerciseRow,
            ),
          }
        : slot,
    ),
  };
}

function materializedPlanView(
  planId: V2BasePlanComparePlanView["planId"],
  materializedPlan: V2ExerciseMaterializationPlan,
): V2BasePlanComparePlanView {
  const inventoryById = new Map(
    representativeV2Inventory.map((inventoryExercise) => [
      inventoryExercise.exerciseId,
      inventoryExercise,
    ]),
  );
  return {
    planId,
    available: true,
    slots: materializedPlan.slots.map((slot) => ({
      slotId: slot.slotId,
      exercises: slot.exercises.map((exerciseRow) => {
        const inventoryExercise = inventoryById.get(exerciseRow.exerciseId);
        return {
          exerciseId: exerciseRow.exerciseId,
          exerciseName: inventoryExercise?.name ?? exerciseRow.exerciseId,
          setCount: exerciseRow.setCount,
          role: exerciseRow.role,
          laneIds: exerciseRow.laneIds,
          classIds: [],
          primaryMuscles: inventoryExercise?.primaryMuscles ?? [],
          movementPatterns: inventoryExercise?.movementPatterns ?? [],
          effectiveStimulusByMuscle:
            inventoryExercise?.stimulusByMusclePerSet ?? {},
        };
      }),
    })),
  };
}

function representativeNoRepairPlan(): V2BasePlanComparePlanView {
  return {
    planId: "planner_only_no_repair",
    available: true,
    slots: [
      {
        slotId: "upper_a",
        exercises: [
          {
            exerciseId: "machine-chest-press",
            exerciseName: "Machine Chest Press",
            setCount: 5,
            classIds: ["distinct_chest_press_or_fly"],
            primaryMuscles: ["Chest"],
          },
          {
            exerciseId: "chest-supported-row",
            exerciseName: "Chest Supported Row",
            setCount: 5,
            classIds: ["horizontal_pull_support"],
            primaryMuscles: ["Upper Back", "Lats"],
          },
        ],
      },
      {
        slotId: "lower_a",
        exercises: [
          {
            exerciseId: "hack-squat",
            exerciseName: "Hack Squat",
            setCount: 5,
            classIds: ["squat_pattern"],
            primaryMuscles: ["Quads"],
          },
        ],
      },
      {
        slotId: "upper_b",
        exercises: [
          {
            exerciseId: "assisted-pull-up",
            exerciseName: "Assisted Pull Up",
            setCount: 5,
            classIds: ["vertical_pull"],
            primaryMuscles: ["Lats"],
          },
        ],
      },
      {
        slotId: "lower_b",
        exercises: [
          {
            exerciseId: "romanian-deadlift",
            exerciseName: "Romanian Deadlift",
            setCount: 5,
            classIds: ["hinge_compound"],
            primaryMuscles: ["Hamstrings", "Glutes"],
          },
        ],
      },
    ],
  };
}

function representativeRepairedPlan(
  materializedPlan: V2ExerciseMaterializationPlan,
): V2BasePlanComparePlanView {
  return {
    ...materializedPlanView("repaired_projection", materializedPlan),
    repairEvidence: [
      {
        repairMechanism: "support_floor_closure",
        action: "added",
        materiality: "major",
        slotId: "upper_b",
        muscle: "Side Delts",
        exerciseName: "Cable Lateral Raise",
        changedExerciseIdentity: true,
        evidence: ["support_floor:Side Delts"],
      },
      {
        repairMechanism: "weekly_obligation_closure",
        action: "added",
        materiality: "major",
        slotId: "lower_a",
        muscle: "Calves",
        exerciseName: "Standing Calf Raise",
        changedExerciseIdentity: true,
        evidence: ["weekly_obligation:Calves"],
      },
      {
        repairMechanism: "late_set_bump",
        action: "set_bumped",
        materiality: "moderate",
        slotId: "upper_a",
        muscle: "Chest",
        exerciseName: "Machine Chest Press",
        evidence: ["set_bumped:4->5"],
      },
      {
        repairMechanism: "cap_trim",
        action: "set_trimmed",
        materiality: "minor",
        slotId: "upper_a",
        muscle: "Chest",
        exerciseName: "Machine Chest Press",
        evidence: ["cap_trim"],
      },
      {
        repairMechanism: "forbidden_cleanup",
        action: "removed",
        materiality: "major",
        slotId: "lower_b",
        muscle: "Chest",
        exerciseName: "Cable Crossover",
        evidence: ["forbidden:lower_b:Chest"],
      },
      {
        repairMechanism: "duplicate_cleanup",
        action: "removed",
        materiality: "minor",
        slotId: "lower_b",
        muscle: "Calves",
        exerciseName: "Standing Calf Raise",
        evidence: ["duplicate:calves"],
      },
      {
        repairMechanism: "dirty_collateral",
        action: "diagnostic_only",
        materiality: "none",
        slotId: "lower_b",
        muscle: "Lower Back",
        exerciseName: "Back Extension",
        evidence: ["dirty_collateral:lower_back"],
      },
    ],
  };
}

describe("buildV2BasePlanValidation", () => {
  it("detects full dry-run materialized coverage without treating materialized as production behavior", () => {
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
        exerciseCount: 21,
        totalSets: 64,
        blockerCount: 0,
        warningCount: 1,
        materializerStatus: "materialized",
      },
    });
    expect(validation.blockers).toEqual([]);
    expect(warningReasons(validation)).toEqual([
      "flat_allocation_pattern:many_lanes_at_four_sets_while_support_muscles_remain_below_preferred",
    ]);
  });

  it("checks muscle coverage against balanced demand and direct floors", () => {
    const { validation } = buildFixture();
    const coverage = validation.checks.muscleCoverage;

    expect(coverage.belowFloorMuscles).toEqual([]);
    expect(coverage.aboveMaxMuscles).toEqual([]);
    expect(coverage.coveredMuscles).toEqual(
      expect.arrayContaining(["Chest", "Upper Back", "Quads"]),
    );
    expect(coverage.abovePreferredMuscles).toEqual(
      expect.arrayContaining(["Lats"]),
    );
    expect(coverage.belowPreferredMuscles).toEqual(
      expect.arrayContaining([
        "Biceps",
        "Calves",
        "Triceps",
      ]),
    );
    expect(coverage.directSupportFloors.missed).toEqual([]);
    expect(coverage.directSupportFloors.met).toEqual(
      expect.arrayContaining([
        "upper_a:side_delt_isolation:Side Delts",
        "upper_b:side_delt_isolation:Side Delts",
        "upper_a:rear_delt:Rear Delts",
        "upper_a:triceps:Triceps",
        "upper_b:biceps:Biceps",
      ]),
    );
  });

  it("enforces standalone one-set exercises as disallowed base hypertrophy work", () => {
    const { validation, materializedPlan, policy } = buildFixture();

    expect(validation.checks.setCountQuality.standaloneOneSetExercises).toEqual([]);
    expect(warningReasons(validation)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("standalone_one_set")]),
    );

    const oneSetCalfPlan: V2ExerciseMaterializationPlan = {
      ...materializedPlan,
      slots: materializedPlan.slots.map((slot) =>
        slot.slotId === "lower_a"
          ? {
              ...slot,
              exercises: slot.exercises.map((exerciseRow) =>
                exerciseRow.laneIds.includes("calves")
                  ? { ...exerciseRow, setCount: 1 }
                  : exerciseRow,
              ),
            }
          : slot,
      ),
    };
    const oneSetValidation = buildV2BasePlanValidation({
      plannerPolicy: policy,
      materializedPlan: oneSetCalfPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });

    expect(oneSetValidation.status).toBe("fail");
    expect(oneSetValidation.blockers.map((blocker) => blocker.reason)).toContain(
      "standalone_one_set_hypertrophy_exercise_disallowed:lower_a:calves:Standing Calf Raise",
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

  it("blocks fly-only chest anchors even when a materialized plan claims the lane", () => {
    const { materializedPlan, policy } = buildFixture();
    const flyAnchorPlan = replaceLaneExercise({
      plan: materializedPlan,
      slotId: "upper_a",
      laneId: "chest_anchor",
      exerciseId: "cable-fly",
    });
    const validation = buildV2BasePlanValidation({
      plannerPolicy: policy,
      materializedPlan: flyAnchorPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });

    expect(validation.status).toBe("fail");
    expect(blockerReasons(validation)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "anchor_ineligible_exercise_selected:upper_a:chest_anchor:Cable Fly:chest_fly_only",
        ),
      ]),
    );
  });

  it("blocks fallback anchor choices when better loadable alternatives exist", () => {
    const { materializedPlan, policy } = buildFixture();
    const degradedPlan = replaceLaneExercise({
      plan: replaceLaneExercise({
        plan: replaceLaneExercise({
          plan: materializedPlan,
          slotId: "lower_a",
          laneId: "squat_anchor",
          exerciseId: "goblet-squat",
        }),
        slotId: "lower_b",
        laneId: "hinge_anchor",
        exerciseId: "cable-pull-through",
      }),
      slotId: "upper_b",
      laneId: "row_support",
      exerciseId: "inverted-row",
    });
    const validation = buildV2BasePlanValidation({
      plannerPolicy: policy,
      materializedPlan: degradedPlan,
      inventory: [
        ...representativeV2Inventory,
        exercise({
          exerciseId: "goblet-squat",
          name: "Goblet Squat",
          primaryMuscles: ["Quads"],
          movementPatterns: ["squat"],
          isCompound: true,
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "cable-pull-through",
          name: "Cable Pull-Through",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: {
            Hamstrings: 0.8,
            Glutes: 0.8,
            "Lower Back": 0.1,
          },
          isCompound: true,
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "inverted-row",
          name: "Inverted Row",
          primaryMuscles: ["Upper Back", "Lats"],
          movementPatterns: ["row"],
          isCompound: true,
          fatigueCost: 1,
        }),
      ],
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });

    expect(validation.status).toBe("fail");
    expect(blockerReasons(validation)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "squat_anchor_support_only_selected_while_loadable_alternative_exists:lower_a:Goblet Squat",
        ),
        expect.stringContaining(
          "hinge_anchor_accessory_selected_while_true_hinge_exists:lower_b:Cable Pull-Through",
        ),
        expect.stringContaining(
          "row_anchor_lacks_loadability_while_loadable_row_exists:upper_b:row_support:Inverted Row",
        ),
      ]),
    );
  });

  it("warns rather than blocks when a fallback anchor is the only visible option", () => {
    const { materializedPlan, policy } = buildFixture();
    const gobletPlan = replaceLaneExercise({
      plan: materializedPlan,
      slotId: "lower_a",
      laneId: "squat_anchor",
      exerciseId: "goblet-squat",
    });
    const validation = buildV2BasePlanValidation({
      plannerPolicy: policy,
      materializedPlan: gobletPlan,
      inventory: [
        ...representativeV2Inventory.filter(
          (row) => row.exerciseId !== "hack-squat" && row.exerciseId !== "leg-press",
        ),
        exercise({
          exerciseId: "goblet-squat",
          name: "Goblet Squat",
          primaryMuscles: ["Quads"],
          movementPatterns: ["squat"],
          isCompound: true,
          fatigueCost: 1,
        }),
      ],
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });

    expect(validation.status).toBe("pass_with_warnings");
    expect(validation.blockers).toEqual([]);
    expect(warningReasons(validation)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "anchor_fallback_selected_no_ideal_alternative:lower_a:squat_anchor:Goblet Squat",
        ),
      ]),
    );
  });

  it("checks side and rear delt directness", () => {
    const { validation } = buildFixture();

    expect(
      validation.checks.exerciseClassCoverage.sideDeltDirectLateralRaiseClass,
    ).toBe(true);
    expect(validation.checks.exerciseClassCoverage.sideDeltDirectExposureCount)
      .toBe(2);
    expect(validation.checks.exerciseClassCoverage.sideDeltSecondDirectExposure)
      .toBe(true);
    expect(validation.checks.exerciseClassCoverage.rearDeltDirectSupportClass)
      .toBe(true);
    expect(warningReasons(validation)).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("side_delt"),
        expect.stringContaining("rear_delt"),
      ]),
    );
  });

  it("diagnoses missing second direct side-delt exposure", () => {
    const { materializedPlan, policy } = buildFixture();
    const oneExposurePlan = removeLaneExercise({
      plan: materializedPlan,
      slotId: "upper_a",
      laneId: "side_delt_isolation",
    });
    const validation = buildV2BasePlanValidation({
      plannerPolicy: policy,
      materializedPlan: oneExposurePlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });

    expect(validation.checks.exerciseClassCoverage.sideDeltDirectExposureCount)
      .toBe(1);
    expect(validation.checks.exerciseClassCoverage.sideDeltSecondDirectExposure)
      .toBe(false);
    expect(warningReasons(validation)).toContain(
      "side_delt_direct_exposure_count_below_base_floor:1/2",
    );
    expect(blockerReasons(validation)).toContain(
      "direct_floor_missed:missing:side_delt_isolation:Side Delts",
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
    expect(warningReasons(validation)).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("Biceps:direct_or_support_sets_below"),
        expect.stringContaining("Triceps:direct_or_support_sets_below"),
      ]),
    );
  });

  it("checks hamstrings hinge plus knee-flexion curl", () => {
    const { validation } = buildFixture();

    expect(validation.checks.exerciseClassCoverage.hamstringsHingeAndCurl)
      .toBe(true);
    expect(validation.checks.exerciseClassCoverage.hamstringsDirectSetFloorMet)
      .toBe(true);
    expect(validation.checks.exerciseClassCoverage.hamstringsDirectSets).toBe(8);
  });

  it("warns when direct hamstring volume falls below the base floor", () => {
    const { materializedPlan, policy } = buildFixture();
    const underbuiltHamstrings = setLaneSetCount({
      plan: materializedPlan,
      slotId: "lower_b",
      laneId: "knee_flexion_curl",
      setCount: 2,
    });
    const validation = buildV2BasePlanValidation({
      plannerPolicy: policy,
      materializedPlan: underbuiltHamstrings,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });

    expect(validation.checks.exerciseClassCoverage.hamstringsDirectSets).toBe(7);
    expect(validation.checks.exerciseClassCoverage.hamstringsDirectSetFloorMet)
      .toBe(false);
    expect(warningReasons(validation)).toContain(
      "hamstrings_direct_sets_below_base_floor:7/8",
    );
  });

  it("warns when Lower B quad support falls back while loadable options exist", () => {
    const { materializedPlan, policy } = buildFixture();
    const gobletQuadSupport = replaceLaneExercise({
      plan: materializedPlan,
      slotId: "lower_b",
      laneId: "quad_support",
      exerciseId: "goblet-squat",
    });
    const validation = buildV2BasePlanValidation({
      plannerPolicy: policy,
      materializedPlan: gobletQuadSupport,
      inventory: [
        ...representativeV2Inventory,
        exercise({
          exerciseId: "goblet-squat",
          name: "Goblet Squat",
          primaryMuscles: ["Quads"],
          movementPatterns: ["squat"],
          isCompound: true,
          fatigueCost: 1,
        }),
      ],
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });

    expect(validation.checks.exerciseClassCoverage.lowerBLoadableQuadSupport)
      .toBe(false);
    expect(warningReasons(validation)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "lower_b_quad_support_fallback_selected_while_loadable_option_exists",
        ),
        "lower_b_quad_support_not_loadable_quad_support_pattern",
      ]),
    );
  });

  it("checks calf duplicate and variant policy", () => {
    const { validation } = buildFixture();

    expect(validation.checks.exerciseClassCoverage.calvesDirectLowerSlotWork)
      .toBe(true);
    expect(validation.checks.duplicateDistinctness.duplicateExerciseIds).toEqual([
      "cable-lateral-raise",
      "rope-pressdown",
      "standing-calf-raise",
    ]);
    expect(validation.checks.duplicateDistinctness.calfDuplicatePolicy).toBe(
      "same_exercise_reuse_accepted_by_policy",
    );
    expect(warningReasons(validation)).not.toContain(
      "calf_same_exercise_reused_across_lower_slots_variant_policy_needed",
    );
  });

  it("warns on duplicate calf reuse only when a clean variant exists", () => {
    const policy = buildV2PlannerMesocyclePolicy();
    const inventoryWithCalfVariant = [
      ...representativeV2Inventory,
      exercise({
        exerciseId: "seated-calf-raise",
        name: "Seated Calf Raise",
        primaryMuscles: ["Calves"],
        movementPatterns: ["isolation"],
        fatigueCost: 1,
      }),
    ];
    const materializedPlan = buildV2ExerciseMaterializationPlan({
      exerciseSelectionPlan: policy.exerciseSelectionPlan,
      inventory: inventoryWithCalfVariant,
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
      inventory: inventoryWithCalfVariant,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });

    expect(validation.checks.duplicateDistinctness.calfDuplicatePolicy).toBe(
      "variant_diversity_preferred",
    );
    expect(warningReasons(validation)).toContain(
      "calf_same_exercise_reused_across_lower_slots_variant_policy_needed",
    );
  });

  it("surfaces planner-owned vertical press support", () => {
    const { validation } = buildFixture();

    expect(validation.checks.verticalPressDecision).toMatchObject({
      targetSkeletonLaneRequired: true,
      selectionRequirement: "required",
      classLaneKind: "support_class_lane",
      materialized: true,
      decision: "owned_required_lane",
      targetSpecAlignmentIssue: false,
    });
    expect(
      validation.checks.exerciseClassCoverage
        .verticalPressOrHighInclineShoulderPress,
    ).toBe(true);
    expect(warningReasons(validation)).not.toContain(
      "target_skeleton_marks_vertical_press_required_but_current_policy_omits_it_as_managed_collateral",
    );
  });

  it("verifies optional lanes are omitted unless activated and managed collateral lanes are not materialized", () => {
    const { validation } = buildFixture();

    expect(
      validation.checks.exerciseClassCoverage.optionalLanesOmittedUnlessActivated,
    ).toBe(true);
    expect(
      validation.checks.exerciseClassCoverage
        .managedCollateralLanesNotMaterializedAsDirectDemand,
    ).toBe(true);
    expect(validation.checks.slotShape.optionalLaneMaterializedCount).toBe(1);
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
    const { validation, materializedPlan, policy } = buildFixture();

    expect(validation.checks.setCountQuality.fourSetLaneCount).toBe(6);
    expect(validation.checks.setCountQuality.flatAllocationWarning).toBe(true);
    expect(warningReasons(validation)).toContain(
      "flat_allocation_pattern:many_lanes_at_four_sets_while_support_muscles_remain_below_preferred",
    );

    const oldFlatPatternPlan: V2ExerciseMaterializationPlan = {
      ...materializedPlan,
      slots: materializedPlan.slots.map((slot) => ({
        ...slot,
        exercises: slot.exercises.map((exerciseRow) =>
          (slot.slotId === "upper_a" && exerciseRow.laneIds.includes("row_anchor")) ||
          (slot.slotId === "upper_b" &&
            exerciseRow.laneIds.includes("vertical_pull_anchor"))
            ? { ...exerciseRow, setCount: 4 }
            : exerciseRow,
        ),
      })),
    };
    const oldFlatPatternValidation = buildV2BasePlanValidation({
      plannerPolicy: policy,
      materializedPlan: oldFlatPatternPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });

    expect(oldFlatPatternValidation.checks.setCountQuality.fourSetLaneCount)
      .toBeGreaterThanOrEqual(6);
    expect(oldFlatPatternValidation.checks.setCountQuality.flatAllocationWarning)
      .toBe(true);
    expect(warningReasons(oldFlatPatternValidation)).toContain(
      "flat_allocation_pattern:many_lanes_at_four_sets_while_support_muscles_remain_below_preferred",
    );
  });

  it("checks glute managed-collateral policy without standalone direct glute work", () => {
    const { validation, materializedPlan } = buildFixture();

    expect(
      materializedPlan.slots.flatMap((slot) =>
        slot.exercises.map((exerciseRow) => exerciseRow.exerciseId),
      ),
    ).not.toContain("barbell-hip-thrust");
    expect(validation.checks.muscleCoverage.managedCollateralWarnings).toEqual([]);
    expect(warningReasons(validation)).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("managed_collateral_direct_work_ambiguity"),
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
      status: "compatible",
    });
    expect(validation.checks.deloadCompatibility.oneSetReductionLimitations)
      .toEqual([]);
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

  it("compares clean V2 base plan against no-repair and repaired projection without making repaired output the target", () => {
    const { validation, materializedPlan } = buildFixture();
    const compare = buildV2BasePlanCompare({
      v2BasePlanValidation: validation,
      v2MaterializedPlan: materializedPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      plannerOnlyNoRepairPlan: representativeNoRepairPlan(),
      repairedPlan: representativeRepairedPlan(materializedPlan),
    });

    expect(compare).toMatchObject({
      version: 1,
      source: "v2_base_plan_compare",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "available",
      comparedPlans: {
        v2BasePlanAvailable: true,
        plannerOnlyNoRepairAvailable: true,
        repairedPlanAvailable: true,
      },
      interpretationRules: {
        v2BasePlanIsCandidateStaticNorthStar: true,
        repairedPlanIsEvidenceNotTarget: true,
        noRepairOutputShowsCurrentPlannerBeforeRepair: true,
        differencesDoNotImplyV2WrongBecauseItDiffersFromRepairedPlan: true,
      },
      guardrails: {
        doesNotTreatRepairedPlanAsTargetPolicy: true,
        doesNotFeedProductionProjection: true,
        doesNotAffectGeneration: true,
        doesNotAffectSelectionV2: true,
        doesNotAffectRepair: true,
        doesNotAffectSeedSerialization: true,
        doesNotAffectRuntimeReplay: true,
        doesNotAffectReceipts: true,
        consumedByDemandOrMaterializer: false,
      },
    });
    expect(compare.summary).toMatchObject({
      v2BaseValidationStatus: "pass_with_warnings",
      v2TotalSets: 64,
      noRepairTotalSets: 25,
      repairedTotalSets: 64,
      repairDependencyCount: 9,
    });
    expect(compare.nextSafeAction).toBe("add_shadow_consumption_trial");
  });

  it("classifies differences as improvement, preservation, regression, unclear, or not comparable", () => {
    const { validation, materializedPlan } = buildFixture();
    const compare = buildV2BasePlanCompare({
      v2BasePlanValidation: validation,
      v2MaterializedPlan: materializedPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      plannerOnlyNoRepairPlan: representativeNoRepairPlan(),
      repairedPlan: representativeRepairedPlan(materializedPlan),
    });
    const classifications = JSON.stringify(compare.comparisons);

    expect(classifications).toContain("v2_improves");
    expect(classifications).toContain("v2_preserves");
    expect(classifications).toContain("unclear");
    expect(classifications).not.toContain("v2_regresses");

    const limitedCompare = buildV2BasePlanCompare({
      v2BasePlanValidation: validation,
      v2MaterializedPlan: materializedPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    });
    expect(JSON.stringify(limitedCompare.comparisons)).toContain(
      "not_comparable",
    );
    expect(limitedCompare.status).toBe("available_with_limitations");
  });

  it("reports V2 slot shape totals, class coverage, repair dependencies, and deload readiness", () => {
    const { validation, materializedPlan } = buildFixture();
    const compare = buildV2BasePlanCompare({
      v2BasePlanValidation: validation,
      v2MaterializedPlan: materializedPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      plannerOnlyNoRepairPlan: representativeNoRepairPlan(),
      repairedPlan: representativeRepairedPlan(materializedPlan),
    });

    expect(compare.comparisons.slotShape.v2Base).toMatchObject({
      slotCount: 4,
      exerciseCount: 21,
      totalSets: 64,
      maxSlotSets: 20,
      optionalLaneMaterializationCount: 1,
      standaloneOneSetExerciseCount: 0,
      fiveSetStackCount: 0,
    });
    expect(compare.comparisons.slotShape.v2Base.setsBySlot).toEqual([
      { slotId: "upper_a", exerciseCount: 6, setCount: 20 },
      { slotId: "lower_a", exerciseCount: 4, setCount: 12 },
      { slotId: "upper_b", exerciseCount: 7, setCount: 20 },
      { slotId: "lower_b", exerciseCount: 4, setCount: 12 },
    ]);
    expect(compare.comparisons.exerciseClassCoverage.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "chest_distinct_exposure",
          v2Base: true,
        }),
        expect.objectContaining({
          item: "side_delt_direct_class",
          v2Base: true,
        }),
        expect.objectContaining({
          item: "rear_delt_direct_support_class",
          v2Base: true,
        }),
        expect.objectContaining({
          item: "hamstrings_hinge_plus_curl",
          v2Base: true,
        }),
        expect.objectContaining({
          item: "calves_direct_work",
          v2Base: true,
        }),
      ]),
    );
    expect(compare.comparisons.repairDependency.responsibilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "support-floor closure as planner author",
          classification: "v2_improves",
          dependencyCount: 1,
        }),
        expect.objectContaining({
          item: "late set bumping",
          classification: "v2_improves",
          dependencyCount: 1,
        }),
        expect.objectContaining({
          item: "forbidden cleanup",
          classification: "v2_improves",
          dependencyCount: 1,
        }),
      ]),
    );
    expect(compare.comparisons.deloadReadiness.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "preserved_identities",
          classification: "v2_preserves",
        }),
        expect.objectContaining({
          item: "reduced_sets",
          classification: "v2_preserves",
        }),
        expect.objectContaining({
          item: "high_rir",
          classification: "v2_preserves",
        }),
        expect.objectContaining({
          item: "no_new_movements",
          classification: "v2_preserves",
        }),
      ]),
    );
  });

  it("does not feed production projection, seed, runtime, receipts, or materializer behavior", () => {
    const { validation, materializedPlan } = buildFixture();
    const beforeMaterializedPlan = JSON.stringify(materializedPlan);
    const noRepairPlan = representativeNoRepairPlan();
    const beforeNoRepair = JSON.stringify(noRepairPlan);

    const compare = buildV2BasePlanCompare({
      v2BasePlanValidation: validation,
      v2MaterializedPlan: materializedPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      plannerOnlyNoRepairPlan: noRepairPlan,
      repairedPlan: representativeRepairedPlan(materializedPlan),
    });

    expect(JSON.stringify(materializedPlan)).toBe(beforeMaterializedPlan);
    expect(JSON.stringify(noRepairPlan)).toBe(beforeNoRepair);
    expect(JSON.stringify(compare)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|acceptedPlannerIntent|runtimeReplay/,
    );
    expect(compare.guardrails).toMatchObject({
      doesNotFeedProductionProjection: true,
      doesNotAffectSeedSerialization: true,
      doesNotAffectRuntimeReplay: true,
      doesNotAffectReceipts: true,
    });
  });

  it("builds a read-only shadow consumption trial without treating repaired projection as target", () => {
    const { validation, materializedPlan } = buildFixture();
    const noRepairPlan = representativeNoRepairPlan();
    const repairedPlan = representativeRepairedPlan(materializedPlan);
    const beforeNoRepair = JSON.stringify(noRepairPlan);
    const beforeRepaired = JSON.stringify(repairedPlan);

    const trial = buildV2BasePlanShadowConsumptionTrial({
      v2BasePlanValidation: validation,
      v2MaterializedPlan: materializedPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      plannerOnlyNoRepairPlan: noRepairPlan,
      repairedPlan,
    });

    expect(trial).toMatchObject({
      version: 1,
      source: "v2_base_plan_shadow_consumption_trial",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "available",
      consumedByProduction: false,
      shadowAdapter: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        sourcePlan: "v2_base_plan",
        adapter: "v2_base_plan_to_projection_plan_view",
        productionProjectionRerun: false,
        writesSeed: false,
        writesRuntime: false,
        writesReceipts: false,
      },
      comparedPlans: {
        v2BasePlanAvailable: true,
        shadowConsumedPlanAvailable: true,
        plannerOnlyNoRepairAvailable: true,
        repairedPlanAvailable: true,
      },
      interpretationRules: {
        shadowConsumptionIsDiagnosticOnly: true,
        repairedPlanIsEvidenceNotTarget: true,
        differencesFromRepairedPlanDoNotImplyV2Wrong: true,
      },
      guardrails: {
        doesNotTreatRepairedPlanAsTargetPolicy: true,
        doesNotFeedProductionProjection: true,
        doesNotAffectGeneration: true,
        doesNotAffectSelectionV2: true,
        doesNotAffectRepair: true,
        doesNotAffectSeedSerialization: true,
        doesNotAffectRuntimeReplay: true,
        doesNotAffectReceipts: true,
        doesNotPersistV2Output: true,
        consumedByProduction: false,
        consumedByDemandOrMaterializer: false,
      },
    });
    expect(trial.summary).toMatchObject({
      shadowTotalSets: 64,
      v2BaseTotalSets: 64,
      noRepairTotalSets: 25,
      repairedTotalSets: 64,
      currentRepairDependencyCount: 9,
      shadowRemainingRepairDependencyCount: 1,
      repairDependencyDelta: -8,
      regressionCount: 0,
    });
    expect(trial.changes.repairDependency).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      diagnosticDelta: -8,
    });
    expect(trial.nextSafeAction).toBe("inspect_shadow_consumption");
    expect(JSON.stringify(noRepairPlan)).toBe(beforeNoRepair);
    expect(JSON.stringify(repairedPlan)).toBe(beforeRepaired);
    expect(JSON.stringify(trial)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|acceptedPlannerIntent|runtimeReplay/,
    );
  });

  it("categorizes shadow identity and materializer differences to reduce unclear buckets", () => {
    const { validation, materializedPlan } = buildFixture();
    const noRepairPlan = representativeNoRepairPlan();

    const trial = buildV2BasePlanShadowConsumptionTrial({
      v2BasePlanValidation: validation,
      v2MaterializedPlan: materializedPlan,
      inventory: representativeV2Inventory,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      plannerOnlyNoRepairPlan: noRepairPlan,
    });

    expect(trial.summary.categorizedIdentityDifferenceCount).toBeGreaterThan(0);
    expect(trial.changes.exerciseIdentity.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: "upper_a",
          relationship: "same_class_family",
          classification: "v2_preserves",
        }),
        expect.objectContaining({
          slotId: "lower_a",
          relationship: "same_class_family",
          classification: "v2_preserves",
        }),
        expect.objectContaining({
          slotId: "upper_b",
          relationship: "same_class_family",
          classification: "v2_preserves",
        }),
        expect.objectContaining({
          slotId: "lower_b",
          relationship: "same_class_family",
          classification: "v2_preserves",
        }),
      ]),
    );
    expect(trial.changes.exerciseIdentity.materializerDifferenceCategories).toEqual(
      expect.arrayContaining([
        "lower_a:same_class_family",
        "upper_a:same_class_family",
      ]),
    );
  });
});
