import type { V2BasePlanValidation } from "./base-plan-validation";
import type {
  V2ExerciseClassTaxonomy,
  V2ExerciseMaterializationPlan,
  V2MaterializationExercise,
} from "./types";
import { matchV2ExerciseClasses } from "./taxonomy";

export type V2BasePlanComparePlanId =
  | "v2_base_plan"
  | "planner_only_no_repair"
  | "repaired_projection";

export type V2BasePlanCompareClassification =
  | "v2_improves"
  | "v2_preserves"
  | "v2_regresses"
  | "unclear"
  | "not_comparable";

export type V2BasePlanCompareNextSafeAction =
  | "inspect_compare"
  | "fix_v2_base_plan"
  | "add_shadow_consumption_trial"
  | "add_guarded_behavior_trial"
  | "do_not_promote";

export type V2BasePlanCompareExercise = {
  exerciseId?: string | null;
  exerciseName: string;
  setCount: number;
  role?: string | null;
  laneIds?: string[];
  classIds?: string[];
  primaryMuscles?: string[];
  movementPatterns?: string[];
  effectiveStimulusByMuscle?: Record<string, number>;
};

export type V2BasePlanCompareSlot = {
  slotId: string;
  intent?: string | null;
  exercises: V2BasePlanCompareExercise[];
};

export type V2BasePlanCompareRepairEvidence = {
  repairMechanism: string;
  action: string;
  materiality?: string | null;
  slotId?: string | null;
  muscle?: string | null;
  exerciseName?: string | null;
  changedExerciseIdentity?: boolean;
  changedSlotShapeMaterially?: boolean;
  evidence?: string[];
};

export type V2BasePlanComparePlanView = {
  planId: V2BasePlanComparePlanId;
  available: boolean;
  source?: string;
  slots: V2BasePlanCompareSlot[];
  repairEvidence?: V2BasePlanCompareRepairEvidence[];
};

export type V2BasePlanCompareInput = {
  v2BasePlanValidation?: V2BasePlanValidation | null;
  v2MaterializedPlan?: V2ExerciseMaterializationPlan | null;
  inventory?: V2MaterializationExercise[] | null;
  taxonomy?: V2ExerciseClassTaxonomy | null;
  plannerOnlyNoRepairPlan?: V2BasePlanComparePlanView | null;
  repairedPlan?: V2BasePlanComparePlanView | null;
};

type SlotMetrics = {
  slotCount: number;
  exerciseCount: number;
  totalSets: number;
  maxSlotSets: number;
  optionalLaneMaterializationCount: number;
  standaloneOneSetExerciseCount: number;
  fiveSetStackCount: number;
  setsBySlot: Array<{
    slotId: string;
    exerciseCount: number;
    setCount: number;
  }>;
};

type ComparisonRow = {
  item: string;
  classification: V2BasePlanCompareClassification;
  evidence: string[];
};

type ExerciseIdentitySlotRow = {
  slotId: string;
  classification: V2BasePlanCompareClassification;
  v2BaseIdentities: string[];
  plannerOnlyNoRepairIdentities: string[];
  repairedPlanIdentities: string[];
  evidence: string[];
};

export type V2BasePlanCompare = {
  version: 1;
  source: "v2_base_plan_compare";
  readOnly: true;
  affectsScoringOrGeneration: false;
  status: "available" | "available_with_limitations" | "not_available";
  comparedPlans: {
    v2BasePlanAvailable: boolean;
    plannerOnlyNoRepairAvailable: boolean;
    repairedPlanAvailable: boolean;
  };
  interpretationRules: {
    v2BasePlanIsCandidateStaticNorthStar: true;
    repairedPlanIsEvidenceNotTarget: true;
    noRepairOutputShowsCurrentPlannerBeforeRepair: true;
    differencesDoNotImplyV2WrongBecauseItDiffersFromRepairedPlan: true;
  };
  summary: {
    v2BaseValidationStatus: string;
    v2TotalSets?: number;
    noRepairTotalSets?: number;
    repairedTotalSets?: number;
    repairDependencyCount?: number;
    v2ImprovementCount: number;
    v2RegressionCount: number;
    unclearCount: number;
  };
  comparisons: {
    slotShape: {
      classification: V2BasePlanCompareClassification;
      v2Base: SlotMetrics;
      plannerOnlyNoRepair?: SlotMetrics;
      repairedPlan?: SlotMetrics;
      rows: ComparisonRow[];
    };
    muscleCoverage: {
      classification: V2BasePlanCompareClassification;
      underHitMuscles: string[];
      overConcentratedMuscles: string[];
      managedCollateralExposure: string[];
      rows: ComparisonRow[];
    };
    exerciseClassCoverage: {
      classification: V2BasePlanCompareClassification;
      rows: Array<
        ComparisonRow & {
          v2Base: boolean;
          plannerOnlyNoRepair: boolean | null;
          repairedPlan: boolean | null;
        }
      >;
    };
    repairDependency: {
      classification: V2BasePlanCompareClassification;
      dependencyCount: number;
      responsibilities: Array<
        ComparisonRow & {
          dependencyCount: number;
        }
      >;
    };
    exerciseIdentity: {
      classification: V2BasePlanCompareClassification;
      duplicateExactExercises: {
        v2Base: string[];
        plannerOnlyNoRepair: string[];
        repairedPlan: string[];
      };
      duplicateClassFamilies: {
        v2Base: string[];
        plannerOnlyNoRepair: string[];
        repairedPlan: string[];
      };
      slots: ExerciseIdentitySlotRow[];
      materializerDifferences: string[];
    };
    deloadReadiness: {
      classification: V2BasePlanCompareClassification;
      rows: ComparisonRow[];
    };
  };
  blockersBeforeBehaviorPromotion: string[];
  nextSafeAction: V2BasePlanCompareNextSafeAction;
  guardrails: {
    doesNotUseHistoricalStrategyRecommendations: true;
    doesNotTreatRepairedPlanAsTargetPolicy: true;
    doesNotFeedProductionProjection: true;
    doesNotAffectGeneration: true;
    doesNotAffectSelectionV2: true;
    doesNotAffectRepair: true;
    doesNotAffectSeedSerialization: true;
    doesNotAffectRuntimeReplay: true;
    doesNotAffectReceipts: true;
    consumedByDemandOrMaterializer: false;
  };
};

const GUARDRAILS: V2BasePlanCompare["guardrails"] = {
  doesNotUseHistoricalStrategyRecommendations: true,
  doesNotTreatRepairedPlanAsTargetPolicy: true,
  doesNotFeedProductionProjection: true,
  doesNotAffectGeneration: true,
  doesNotAffectSelectionV2: true,
  doesNotAffectRepair: true,
  doesNotAffectSeedSerialization: true,
  doesNotAffectRuntimeReplay: true,
  doesNotAffectReceipts: true,
  consumedByDemandOrMaterializer: false,
};

const REPAIR_RESPONSIBILITY_PATTERNS: Array<{
  key: string;
  label: string;
  patterns: string[];
}> = [
  {
    key: "support_floor_closure",
    label: "support-floor closure as planner author",
    patterns: ["support_floor", "support-floor", "direct_floor"],
  },
  {
    key: "weekly_obligation_closure",
    label: "weekly obligation closure",
    patterns: ["weekly_obligation", "weekly obligation", "below_minimum"],
  },
  {
    key: "late_set_bumping",
    label: "late set bumping",
    patterns: ["set_bumped", "set bump", "set-bump"],
  },
  {
    key: "cap_trim",
    label: "cap trim",
    patterns: ["cap_trim", "set_trimmed", "cap cleanup", "trim"],
  },
  {
    key: "forbidden_cleanup",
    label: "forbidden cleanup",
    patterns: ["forbidden", "do_not_train_here"],
  },
  {
    key: "repair_added_exercises",
    label: "repair-added exercises",
    patterns: ["added", "repair_added", "added_exercise"],
  },
  {
    key: "duplicate_cleanup",
    label: "duplicate cleanup",
    patterns: ["duplicate"],
  },
  {
    key: "dirty_collateral",
    label: "dirty collateral",
    patterns: ["dirty", "collateral", "lower_back", "glutes"],
  },
];

export function buildV2BasePlanCompare(
  input: V2BasePlanCompareInput,
): V2BasePlanCompare {
  const v2BasePlan = buildV2PlanView({
    materializedPlan: input.v2MaterializedPlan,
    validation: input.v2BasePlanValidation,
    inventory: input.inventory ?? [],
    taxonomy: input.taxonomy ?? undefined,
  });
  const noRepair = input.plannerOnlyNoRepairPlan;
  const repaired = input.repairedPlan;
  const comparedPlans = {
    v2BasePlanAvailable:
      Boolean(input.v2BasePlanValidation) && v2BasePlan.available,
    plannerOnlyNoRepairAvailable: noRepair?.available === true,
    repairedPlanAvailable: repaired?.available === true,
  };

  const slotShape = buildSlotShapeCompare({ v2BasePlan, noRepair, repaired });
  const muscleCoverage = buildMuscleCoverageCompare({
    validation: input.v2BasePlanValidation,
    v2BasePlan,
    noRepair,
    repaired,
  });
  const exerciseClassCoverage = buildExerciseClassCoverageCompare({
    validation: input.v2BasePlanValidation,
    v2BasePlan,
    noRepair,
    repaired,
  });
  const repairDependency = buildRepairDependencyCompare({
    validation: input.v2BasePlanValidation,
    v2BasePlan,
    repaired,
  });
  const exerciseIdentity = buildExerciseIdentityCompare({
    v2BasePlan,
    noRepair,
    repaired,
  });
  const deloadReadiness = buildDeloadReadinessCompare({
    validation: input.v2BasePlanValidation,
  });
  const allClassifications = [
    slotShape.classification,
    ...slotShape.rows.map((row) => row.classification),
    muscleCoverage.classification,
    ...muscleCoverage.rows.map((row) => row.classification),
    exerciseClassCoverage.classification,
    ...exerciseClassCoverage.rows.map((row) => row.classification),
    repairDependency.classification,
    ...repairDependency.responsibilities.map((row) => row.classification),
    exerciseIdentity.classification,
    ...exerciseIdentity.slots.map((row) => row.classification),
    deloadReadiness.classification,
    ...deloadReadiness.rows.map((row) => row.classification),
  ];
  const v2RegressionCount = allClassifications.filter(
    (classification) => classification === "v2_regresses",
  ).length;
  const unclearCount = allClassifications.filter(
    (classification) => classification === "unclear",
  ).length;
  const v2ImprovementCount = allClassifications.filter(
    (classification) => classification === "v2_improves",
  ).length;
  const status = compareStatus({
    comparedPlans,
    validation: input.v2BasePlanValidation,
  });
  const blockersBeforeBehaviorPromotion = buildPromotionBlockers({
    comparedPlans,
    validation: input.v2BasePlanValidation,
    v2RegressionCount,
    unclearCount,
  });

  return {
    version: 1,
    source: "v2_base_plan_compare",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status,
    comparedPlans,
    interpretationRules: {
      v2BasePlanIsCandidateStaticNorthStar: true,
      repairedPlanIsEvidenceNotTarget: true,
      noRepairOutputShowsCurrentPlannerBeforeRepair: true,
      differencesDoNotImplyV2WrongBecauseItDiffersFromRepairedPlan: true,
    },
    summary: {
      v2BaseValidationStatus: input.v2BasePlanValidation?.status ?? "not_available",
      ...(comparedPlans.v2BasePlanAvailable
        ? { v2TotalSets: slotShape.v2Base.totalSets }
        : {}),
      ...(noRepair?.available
        ? { noRepairTotalSets: computeSlotMetrics(noRepair).totalSets }
        : {}),
      ...(repaired?.available
        ? { repairedTotalSets: computeSlotMetrics(repaired).totalSets }
        : {}),
      repairDependencyCount: repairDependency.dependencyCount,
      v2ImprovementCount,
      v2RegressionCount,
      unclearCount,
    },
    comparisons: {
      slotShape,
      muscleCoverage,
      exerciseClassCoverage,
      repairDependency,
      exerciseIdentity,
      deloadReadiness,
    },
    blockersBeforeBehaviorPromotion,
    nextSafeAction: nextSafeAction({
      comparedPlans,
      validation: input.v2BasePlanValidation,
      v2RegressionCount,
      unclearCount,
    }),
    guardrails: GUARDRAILS,
  };
}

function buildV2PlanView(input: {
  materializedPlan?: V2ExerciseMaterializationPlan | null;
  validation?: V2BasePlanValidation | null;
  inventory: V2MaterializationExercise[];
  taxonomy?: V2ExerciseClassTaxonomy;
}): V2BasePlanComparePlanView {
  const inventoryById = new Map(
    input.inventory.map((exercise) => [exercise.exerciseId, exercise]),
  );
  return {
    planId: "v2_base_plan",
    available:
      input.materializedPlan?.status === "materialized" &&
      input.validation?.status !== "fail",
    source: "v2_exercise_materialization",
    slots:
      input.materializedPlan?.slots.map((slot) => ({
        slotId: slot.slotId,
        exercises: slot.exercises.map((exercise) => {
          const inventoryExercise = inventoryById.get(exercise.exerciseId);
          return {
            exerciseId: exercise.exerciseId,
            exerciseName:
              inventoryExercise?.name ?? exercise.exerciseId ?? "unknown",
            setCount: exercise.setCount,
            role: exercise.role,
            laneIds: exercise.laneIds,
            classIds:
              inventoryExercise && input.taxonomy
                ? matchV2ExerciseClasses(inventoryExercise, input.taxonomy).map(
                    (match) => match.classId,
                  )
                : [],
            primaryMuscles: inventoryExercise?.primaryMuscles ?? [],
            movementPatterns: inventoryExercise?.movementPatterns ?? [],
            effectiveStimulusByMuscle:
              inventoryExercise?.stimulusByMusclePerSet
                ? Object.fromEntries(
                    Object.entries(inventoryExercise.stimulusByMusclePerSet).map(
                      ([muscle, stimulus]) => [
                        muscle,
                        roundOne(stimulus * exercise.setCount),
                      ],
                    ),
                  )
                : {},
          };
        }),
      })) ?? [],
  };
}

function computeSlotMetrics(plan?: V2BasePlanComparePlanView | null): SlotMetrics {
  const slots = plan?.available ? plan.slots : [];
  const setsBySlot = slots.map((slot) => ({
    slotId: slot.slotId,
    exerciseCount: slot.exercises.length,
    setCount: slot.exercises.reduce(
      (sum, exercise) => sum + exercise.setCount,
      0,
    ),
  }));
  return {
    slotCount: slots.length,
    exerciseCount: slots.reduce((sum, slot) => sum + slot.exercises.length, 0),
    totalSets: setsBySlot.reduce((sum, slot) => sum + slot.setCount, 0),
    maxSlotSets: Math.max(0, ...setsBySlot.map((slot) => slot.setCount)),
    optionalLaneMaterializationCount: slots.reduce(
      (sum, slot) =>
        sum +
        slot.exercises.filter((exercise) =>
          (exercise.laneIds ?? []).some((laneId) => laneId.includes("optional")),
        ).length,
      0,
    ),
    standaloneOneSetExerciseCount: slots.reduce(
      (sum, slot) =>
        sum + slot.exercises.filter((exercise) => exercise.setCount === 1).length,
      0,
    ),
    fiveSetStackCount: slots.reduce(
      (sum, slot) =>
        sum + slot.exercises.filter((exercise) => exercise.setCount >= 5).length,
      0,
    ),
    setsBySlot,
  };
}

function buildSlotShapeCompare(input: {
  v2BasePlan: V2BasePlanComparePlanView;
  noRepair?: V2BasePlanComparePlanView | null;
  repaired?: V2BasePlanComparePlanView | null;
}): V2BasePlanCompare["comparisons"]["slotShape"] {
  const v2Base = computeSlotMetrics(input.v2BasePlan);
  const noRepair = input.noRepair?.available
    ? computeSlotMetrics(input.noRepair)
    : undefined;
  const repaired = input.repaired?.available
    ? computeSlotMetrics(input.repaired)
    : undefined;
  const rows: ComparisonRow[] = [
    {
      item: "slot_count",
      classification: compareNumberToViews(v2Base.slotCount, [
        noRepair?.slotCount,
        repaired?.slotCount,
      ]),
      evidence: [
        `v2:${v2Base.slotCount}`,
        `noRepair:${noRepair?.slotCount ?? "unavailable"}`,
        `repaired:${repaired?.slotCount ?? "unavailable"}`,
      ],
    },
    {
      item: "total_weekly_sets",
      classification: classifyTotalSets({
        v2Sets: v2Base.totalSets,
        noRepairSets: noRepair?.totalSets,
        repairedSets: repaired?.totalSets,
      }),
      evidence: [
        `v2:${v2Base.totalSets}`,
        `noRepair:${noRepair?.totalSets ?? "unavailable"}`,
        `repaired:${repaired?.totalSets ?? "unavailable"}`,
      ],
    },
    {
      item: "max_slot_sets",
      classification:
        repaired && v2Base.maxSlotSets < repaired.maxSlotSets
          ? "v2_improves"
          : repaired && v2Base.maxSlotSets === repaired.maxSlotSets
            ? "v2_preserves"
            : repaired
              ? "unclear"
              : "not_comparable",
      evidence: [
        `v2:${v2Base.maxSlotSets}`,
        `repaired:${repaired?.maxSlotSets ?? "unavailable"}`,
      ],
    },
    {
      item: "optional_lane_materialization",
      classification:
        v2Base.optionalLaneMaterializationCount === 0
          ? "v2_improves"
          : "v2_regresses",
      evidence: [`v2_optional:${v2Base.optionalLaneMaterializationCount}`],
    },
    {
      item: "standalone_one_set_exercises",
      classification:
        v2Base.standaloneOneSetExerciseCount === 0
          ? "v2_improves"
          : "v2_regresses",
      evidence: [`v2_one_set:${v2Base.standaloneOneSetExerciseCount}`],
    },
    {
      item: "five_set_stacking",
      classification:
        v2Base.fiveSetStackCount === 0 ? "v2_improves" : "v2_regresses",
      evidence: [`v2_five_set:${v2Base.fiveSetStackCount}`],
    },
  ];

  return {
    classification: aggregateClassifications(rows.map((row) => row.classification)),
    v2Base,
    ...(noRepair ? { plannerOnlyNoRepair: noRepair } : {}),
    ...(repaired ? { repairedPlan: repaired } : {}),
    rows,
  };
}

function buildMuscleCoverageCompare(input: {
  validation?: V2BasePlanValidation | null;
  v2BasePlan: V2BasePlanComparePlanView;
  noRepair?: V2BasePlanComparePlanView | null;
  repaired?: V2BasePlanComparePlanView | null;
}): V2BasePlanCompare["comparisons"]["muscleCoverage"] {
  const coverage = input.validation?.checks.muscleCoverage;
  const rows: ComparisonRow[] = [
    {
      item: "target_tier_coverage",
      classification: coverage?.belowFloorMuscles.length
        ? "v2_regresses"
        : coverage
          ? "v2_improves"
          : "not_comparable",
      evidence: [
        `below_floor:${coverage?.belowFloorMuscles.join(",") || "none"}`,
      ],
    },
    {
      item: "support_direct_floor_coverage",
      classification: coverage?.directSupportFloors.missed.length
        ? "v2_regresses"
        : coverage
          ? "v2_improves"
          : "not_comparable",
      evidence: [
        `missed:${coverage?.directSupportFloors.missed.join(",") || "none"}`,
        `met:${coverage?.directSupportFloors.met.length ?? 0}`,
      ],
    },
    {
      item: "over_concentrated_muscles",
      classification: coverage?.aboveMaxMuscles.length
        ? "v2_regresses"
        : coverage
          ? "v2_preserves"
          : "not_comparable",
      evidence: [`above_max:${coverage?.aboveMaxMuscles.join(",") || "none"}`],
    },
    {
      item: "managed_collateral_fatigue_driver_exposure",
      classification: coverage?.managedCollateralWarnings.length
        ? "v2_regresses"
        : coverage
          ? "v2_improves"
          : "not_comparable",
      evidence: [
        `managed_collateral:${coverage?.managedCollateralWarnings.join(",") || "none"}`,
      ],
    },
  ];
  return {
    classification: aggregateClassifications(rows.map((row) => row.classification)),
    underHitMuscles: coverage?.belowFloorMuscles ?? [],
    overConcentratedMuscles: coverage?.aboveMaxMuscles ?? [],
    managedCollateralExposure: coverage?.managedCollateralWarnings ?? [],
    rows,
  };
}

function buildExerciseClassCoverageCompare(input: {
  validation?: V2BasePlanValidation | null;
  v2BasePlan: V2BasePlanComparePlanView;
  noRepair?: V2BasePlanComparePlanView | null;
  repaired?: V2BasePlanComparePlanView | null;
}): V2BasePlanCompare["comparisons"]["exerciseClassCoverage"] {
  const classCoverage = input.validation?.checks.exerciseClassCoverage;
  const specs: Array<{
    item: string;
    v2Base: boolean;
    detect: (plan?: V2BasePlanComparePlanView | null) => boolean | null;
  }> = [
    {
      item: "chest_distinct_exposure",
      v2Base: classCoverage?.chestDistinctUpperExposures === true,
      detect: hasDistinctChestExposure,
    },
    {
      item: "row_vertical_pull_balance",
      v2Base: classCoverage?.rowAndVerticalPullBalance === true,
      detect: hasRowAndVerticalPullBalance,
    },
    {
      item: "side_delt_direct_class",
      v2Base: classCoverage?.sideDeltDirectLateralRaiseClass === true,
      detect: (plan) => hasClassOrMuscle(plan, "lateral_raise", "Side Delts"),
    },
    {
      item: "rear_delt_direct_support_class",
      v2Base: classCoverage?.rearDeltDirectSupportClass === true,
      detect: (plan) =>
        hasClassOrMuscle(plan, "rear_delt_isolation", "Rear Delts"),
    },
    {
      item: "biceps_direct_support_class",
      v2Base: hasClassOrMuscle(input.v2BasePlan, "biceps_isolation", "Biceps") === true,
      detect: (plan) => hasClassOrMuscle(plan, "biceps_isolation", "Biceps"),
    },
    {
      item: "triceps_direct_support_class",
      v2Base:
        hasClassOrMuscle(input.v2BasePlan, "triceps_isolation", "Triceps") ===
        true,
      detect: (plan) => hasClassOrMuscle(plan, "triceps_isolation", "Triceps"),
    },
    {
      item: "hamstrings_hinge_plus_curl",
      v2Base: classCoverage?.hamstringsHingeAndCurl === true,
      detect: hasHingeAndCurl,
    },
    {
      item: "quads_squat_support",
      v2Base: classCoverage?.quadsSquatPressAndSupport === true,
      detect: (plan) => hasClassOrMuscle(plan, "squat_pattern", "Quads"),
    },
    {
      item: "calves_direct_work",
      v2Base: classCoverage?.calvesDirectLowerSlotWork === true,
      detect: (plan) => hasClassOrMuscle(plan, "calf_isolation", "Calves"),
    },
    {
      item: "optional_collateral_lane_leakage",
      v2Base:
        classCoverage?.optionalLanesOmittedUnlessActivated === true &&
        classCoverage.managedCollateralLanesNotMaterializedAsDirectDemand,
      detect: (plan) =>
        plan?.available
          ? computeSlotMetrics(plan).optionalLaneMaterializationCount === 0
          : null,
    },
  ];
  const rows = specs.map((spec) => {
    const plannerOnlyNoRepair = spec.detect(input.noRepair);
    const repairedPlan = spec.detect(input.repaired);
    const classification = classifyFeaturePresence({
      v2Base: spec.v2Base,
      noRepair: plannerOnlyNoRepair,
      repaired: repairedPlan,
    });
    return {
      item: spec.item,
      classification,
      v2Base: spec.v2Base,
      plannerOnlyNoRepair,
      repairedPlan,
      evidence: [
        `v2:${spec.v2Base}`,
        `noRepair:${plannerOnlyNoRepair ?? "unavailable"}`,
        `repaired:${repairedPlan ?? "unavailable"}`,
      ],
    };
  });
  return {
    classification: aggregateClassifications(rows.map((row) => row.classification)),
    rows,
  };
}

function buildRepairDependencyCompare(input: {
  validation?: V2BasePlanValidation | null;
  v2BasePlan: V2BasePlanComparePlanView;
  repaired?: V2BasePlanComparePlanView | null;
}): V2BasePlanCompare["comparisons"]["repairDependency"] {
  const repairRows = input.repaired?.repairEvidence ?? [];
  const responsibilities = REPAIR_RESPONSIBILITY_PATTERNS.map((pattern) => {
    const matchingRows = repairRows.filter((row) =>
      repairEvidenceText(row).some((text) =>
        pattern.patterns.some((token) =>
          text.toLowerCase().includes(token.toLowerCase()),
        ),
      ),
    );
    return {
      item: pattern.label,
      dependencyCount: matchingRows.length,
      classification: classifyRepairResponsibility({
        key: pattern.key,
        dependencyCount: matchingRows.length,
        validation: input.validation,
        v2BasePlan: input.v2BasePlan,
      }),
      evidence: matchingRows.length
        ? matchingRows
            .slice(0, 5)
            .map((row) =>
              [
                row.slotId ?? "unknown_slot",
                row.muscle ?? "unknown_muscle",
                row.exerciseName ?? "unknown_exercise",
                row.repairMechanism,
                row.action,
              ].join(":"),
            )
        : ["no_matching_repaired_rows"],
    };
  });
  const dependencyCount = responsibilities.reduce(
    (sum, row) => sum + row.dependencyCount,
    0,
  );
  return {
    classification: aggregateClassifications(
      responsibilities.map((row) => row.classification),
    ),
    dependencyCount,
    responsibilities,
  };
}

function buildExerciseIdentityCompare(input: {
  v2BasePlan: V2BasePlanComparePlanView;
  noRepair?: V2BasePlanComparePlanView | null;
  repaired?: V2BasePlanComparePlanView | null;
}): V2BasePlanCompare["comparisons"]["exerciseIdentity"] {
  const slotIds = uniqueSorted([
    ...input.v2BasePlan.slots.map((slot) => slot.slotId),
    ...(input.noRepair?.slots ?? []).map((slot) => slot.slotId),
    ...(input.repaired?.slots ?? []).map((slot) => slot.slotId),
  ]);
  const slots = slotIds.map((slotId) => {
    const v2BaseIdentities = exerciseNamesForSlot(input.v2BasePlan, slotId);
    const plannerOnlyNoRepairIdentities = exerciseNamesForSlot(
      input.noRepair,
      slotId,
    );
    const repairedPlanIdentities = exerciseNamesForSlot(
      input.repaired,
      slotId,
    );
    const repairedSameAsV2 =
      repairedPlanIdentities.length > 0 &&
      sameStringSet(v2BaseIdentities, repairedPlanIdentities);
    const noRepairSameAsV2 =
      plannerOnlyNoRepairIdentities.length > 0 &&
      sameStringSet(v2BaseIdentities, plannerOnlyNoRepairIdentities);
    const classification: V2BasePlanCompareClassification =
      repairedSameAsV2 || noRepairSameAsV2
        ? "v2_preserves"
        : repairedPlanIdentities.length || plannerOnlyNoRepairIdentities.length
          ? "unclear"
          : "not_comparable";
    return {
      slotId,
      classification,
      v2BaseIdentities,
      plannerOnlyNoRepairIdentities,
      repairedPlanIdentities,
      evidence: [
        `v2:${v2BaseIdentities.join(",") || "none"}`,
        `noRepair:${plannerOnlyNoRepairIdentities.join(",") || "none"}`,
        `repaired:${repairedPlanIdentities.join(",") || "none"}`,
      ],
    };
  });
  const duplicateExactExercises = {
    v2Base: duplicateExerciseNames(input.v2BasePlan),
    plannerOnlyNoRepair: duplicateExerciseNames(input.noRepair),
    repairedPlan: duplicateExerciseNames(input.repaired),
  };
  const duplicateClassFamilies = {
    v2Base: duplicateClassFamiliesForPlan(input.v2BasePlan),
    plannerOnlyNoRepair: duplicateClassFamiliesForPlan(input.noRepair),
    repairedPlan: duplicateClassFamiliesForPlan(input.repaired),
  };
  const materializerDifferences = slots
    .filter((slot) => slot.classification === "unclear")
    .map((slot) => `${slot.slotId}:identity_differs_from_projection_evidence`);

  return {
    classification:
      duplicateExactExercises.v2Base.length >
        duplicateExactExercises.repairedPlan.length &&
      duplicateExactExercises.repairedPlan.length > 0
        ? "v2_regresses"
        : materializerDifferences.length
          ? "unclear"
          : "v2_preserves",
    duplicateExactExercises,
    duplicateClassFamilies,
    slots,
    materializerDifferences,
  };
}

function buildDeloadReadinessCompare(input: {
  validation?: V2BasePlanValidation | null;
}): V2BasePlanCompare["comparisons"]["deloadReadiness"] {
  const deload = input.validation?.checks.deloadCompatibility;
  const rows: ComparisonRow[] = [
    {
      item: "preserved_identities",
      classification: deload?.sameIdentitiesSupported
        ? "v2_preserves"
        : deload
          ? "v2_regresses"
          : "not_comparable",
      evidence: [`sameIdentitiesSupported:${deload?.sameIdentitiesSupported ?? false}`],
    },
    {
      item: "reduced_sets",
      classification: deload?.reducedSetsSupported
        ? "v2_preserves"
        : deload
          ? "v2_regresses"
          : "not_comparable",
      evidence: [`reducedSetsSupported:${deload?.reducedSetsSupported ?? false}`],
    },
    {
      item: "high_rir",
      classification: deload?.highRirSupported
        ? "v2_preserves"
        : deload
          ? "v2_regresses"
          : "not_comparable",
      evidence: [`highRirSupported:${deload?.highRirSupported ?? false}`],
    },
    {
      item: "no_new_movements",
      classification: deload?.noNewMovementsSupported
        ? "v2_preserves"
        : deload
          ? "v2_regresses"
          : "not_comparable",
      evidence: [`noNewMovementsSupported:${deload?.noNewMovementsSupported ?? false}`],
    },
  ];
  return {
    classification: aggregateClassifications(rows.map((row) => row.classification)),
    rows,
  };
}

function classifyRepairResponsibility(input: {
  key: string;
  dependencyCount: number;
  validation?: V2BasePlanValidation | null;
  v2BasePlan: V2BasePlanComparePlanView;
}): V2BasePlanCompareClassification {
  if (!input.dependencyCount) {
    return "v2_preserves";
  }
  const coverage = input.validation?.checks.muscleCoverage;
  const slotShape = input.validation?.checks.slotShape;
  const setQuality = input.validation?.checks.setCountQuality;
  const classCoverage = input.validation?.checks.exerciseClassCoverage;
  if (!input.validation || !input.v2BasePlan.available) {
    return "not_comparable";
  }
  if (input.validation.status === "fail") {
    return "v2_regresses";
  }
  if (
    input.key === "support_floor_closure" &&
    coverage?.directSupportFloors.missed.length === 0
  ) {
    return "v2_improves";
  }
  if (
    input.key === "weekly_obligation_closure" &&
    coverage?.belowFloorMuscles.length === 0
  ) {
    return "v2_improves";
  }
  if (
    input.key === "late_set_bumping" &&
    setQuality?.exercisesAtFiveOrMore.length === 0
  ) {
    return "v2_improves";
  }
  if (
    input.key === "cap_trim" &&
    setQuality?.exercisesAtFiveOrMore.length === 0 &&
    slotShape?.overloadedSlots.length === 0
  ) {
    return "v2_improves";
  }
  if (
    input.key === "forbidden_cleanup" &&
    classCoverage?.optionalLanesOmittedUnlessActivated &&
    classCoverage.managedCollateralLanesNotMaterializedAsDirectDemand
  ) {
    return "v2_improves";
  }
  if (input.key === "repair_added_exercises") {
    return "v2_improves";
  }
  if (
    input.key === "duplicate_cleanup" &&
    input.validation.checks.duplicateDistinctness.supportReusePolicy ===
      "acceptable"
  ) {
    return "v2_improves";
  }
  if (
    input.key === "dirty_collateral" &&
    coverage?.managedCollateralWarnings.length === 0
  ) {
    return "v2_improves";
  }
  return "unclear";
}

function repairEvidenceText(row: V2BasePlanCompareRepairEvidence): string[] {
  return [
    row.repairMechanism,
    row.action,
    row.materiality ?? "",
    row.slotId ?? "",
    row.muscle ?? "",
    row.exerciseName ?? "",
    ...(row.evidence ?? []),
  ];
}

function compareNumberToViews(
  value: number,
  comparisonValues: Array<number | undefined>,
): V2BasePlanCompareClassification {
  const available = comparisonValues.filter(
    (entry): entry is number => typeof entry === "number",
  );
  if (!available.length) {
    return "not_comparable";
  }
  return available.every((entry) => entry === value) ? "v2_preserves" : "unclear";
}

function classifyTotalSets(input: {
  v2Sets: number;
  noRepairSets?: number;
  repairedSets?: number;
}): V2BasePlanCompareClassification {
  if (input.noRepairSets == null && input.repairedSets == null) {
    return "not_comparable";
  }
  if (
    input.repairedSets != null &&
    input.noRepairSets != null &&
    input.v2Sets > input.noRepairSets &&
    input.v2Sets <= input.repairedSets
  ) {
    return "v2_improves";
  }
  if (input.repairedSets != null && input.v2Sets === input.repairedSets) {
    return "v2_preserves";
  }
  if (input.noRepairSets != null && input.v2Sets === input.noRepairSets) {
    return "v2_preserves";
  }
  return "unclear";
}

function classifyFeaturePresence(input: {
  v2Base: boolean;
  noRepair: boolean | null;
  repaired: boolean | null;
}): V2BasePlanCompareClassification {
  if (!input.v2Base) {
    return input.noRepair || input.repaired ? "v2_regresses" : "unclear";
  }
  if (input.noRepair === false || input.repaired === false) {
    return "v2_improves";
  }
  if (input.noRepair == null && input.repaired == null) {
    return "not_comparable";
  }
  return "v2_preserves";
}

function aggregateClassifications(
  classifications: V2BasePlanCompareClassification[],
): V2BasePlanCompareClassification {
  if (classifications.includes("v2_regresses")) {
    return "v2_regresses";
  }
  if (classifications.includes("v2_improves")) {
    return "v2_improves";
  }
  if (classifications.includes("unclear")) {
    return "unclear";
  }
  if (classifications.includes("v2_preserves")) {
    return "v2_preserves";
  }
  return "not_comparable";
}

function compareStatus(input: {
  comparedPlans: V2BasePlanCompare["comparedPlans"];
  validation?: V2BasePlanValidation | null;
}): V2BasePlanCompare["status"] {
  if (!input.comparedPlans.v2BasePlanAvailable || !input.validation) {
    return "not_available";
  }
  if (
    !input.comparedPlans.plannerOnlyNoRepairAvailable ||
    !input.comparedPlans.repairedPlanAvailable
  ) {
    return "available_with_limitations";
  }
  return "available";
}

function buildPromotionBlockers(input: {
  comparedPlans: V2BasePlanCompare["comparedPlans"];
  validation?: V2BasePlanValidation | null;
  v2RegressionCount: number;
  unclearCount: number;
}): string[] {
  return [
    ...(!input.comparedPlans.v2BasePlanAvailable
      ? ["v2_base_plan_unavailable"]
      : []),
    ...(!input.comparedPlans.plannerOnlyNoRepairAvailable
      ? ["planner_only_no_repair_unavailable"]
      : []),
    ...(!input.comparedPlans.repairedPlanAvailable
      ? ["repaired_projection_unavailable"]
      : []),
    ...(input.validation?.status === "fail" ? ["v2_base_validation_failed"] : []),
    ...(input.v2RegressionCount > 0
      ? [`v2_regression_count:${input.v2RegressionCount}`]
      : []),
    ...(input.unclearCount > 0 ? [`unclear_count:${input.unclearCount}`] : []),
    "shadow_consumption_trial_not_run",
    "guarded_behavior_trial_not_run",
    "accepted_seed_runtime_consumption_gate_not_changed",
  ];
}

function nextSafeAction(input: {
  comparedPlans: V2BasePlanCompare["comparedPlans"];
  validation?: V2BasePlanValidation | null;
  v2RegressionCount: number;
  unclearCount: number;
}): V2BasePlanCompareNextSafeAction {
  if (!input.comparedPlans.v2BasePlanAvailable) {
    return "do_not_promote";
  }
  if (input.validation?.status === "fail" || input.v2RegressionCount > 0) {
    return "fix_v2_base_plan";
  }
  if (
    !input.comparedPlans.plannerOnlyNoRepairAvailable ||
    !input.comparedPlans.repairedPlanAvailable
  ) {
    return "inspect_compare";
  }
  if (input.unclearCount > 8) {
    return "inspect_compare";
  }
  return "add_shadow_consumption_trial";
}

function hasClassOrMuscle(
  plan: V2BasePlanComparePlanView | null | undefined,
  classId: string,
  muscle: string,
): boolean | null {
  if (!plan?.available) {
    return null;
  }
  return plan.slots.some((slot) =>
    slot.exercises.some((exercise) => {
      const classIds = exercise.classIds ?? [];
      return (
        classIds.includes(classId) ||
        (exercise.primaryMuscles ?? []).includes(muscle) ||
        Object.keys(exercise.effectiveStimulusByMuscle ?? {}).includes(muscle)
      );
    }),
  );
}

function hasDistinctChestExposure(
  plan: V2BasePlanComparePlanView | null | undefined,
): boolean | null {
  if (!plan?.available) {
    return null;
  }
  const chestRows = plan.slots.flatMap((slot) =>
    slot.exercises.filter((exercise) => {
      const name = exercise.exerciseName.toLowerCase();
      return (
        (exercise.primaryMuscles ?? []).includes("Chest") ||
        Object.keys(exercise.effectiveStimulusByMuscle ?? {}).includes("Chest") ||
        name.includes("press") ||
        name.includes("fly") ||
        name.includes("bench")
      );
    }),
  );
  return new Set(chestRows.map(exerciseIdentityKey)).size >= 2;
}

function hasRowAndVerticalPullBalance(
  plan: V2BasePlanComparePlanView | null | undefined,
): boolean | null {
  if (!plan?.available) {
    return null;
  }
  const exercises = plan.slots.flatMap((slot) => slot.exercises);
  const hasRow = exercises.some((exercise) => {
    const name = exercise.exerciseName.toLowerCase();
    return (
      (exercise.classIds ?? []).includes("horizontal_pull_support") ||
      (exercise.movementPatterns ?? []).some((pattern) => pattern.includes("row")) ||
      name.includes("row")
    );
  });
  const hasVerticalPull = exercises.some((exercise) => {
    const name = exercise.exerciseName.toLowerCase();
    return (
      (exercise.classIds ?? []).includes("vertical_pull") ||
      (exercise.movementPatterns ?? []).some((pattern) =>
        pattern.includes("vertical_pull"),
      ) ||
      name.includes("pulldown") ||
      name.includes("pull up") ||
      name.includes("pull-up")
    );
  });
  return hasRow && hasVerticalPull;
}

function hasHingeAndCurl(
  plan: V2BasePlanComparePlanView | null | undefined,
): boolean | null {
  if (!plan?.available) {
    return null;
  }
  const exercises = plan.slots.flatMap((slot) => slot.exercises);
  const hasHinge = exercises.some((exercise) => {
    const name = exercise.exerciseName.toLowerCase();
    return (
      (exercise.classIds ?? []).includes("hinge_compound") ||
      (exercise.movementPatterns ?? []).some((pattern) => pattern.includes("hinge")) ||
      name.includes("deadlift") ||
      name.includes("rdl")
    );
  });
  const hasCurl = exercises.some((exercise) => {
    const name = exercise.exerciseName.toLowerCase();
    return (
      (exercise.classIds ?? []).includes("knee_flexion_curl") ||
      name.includes("leg curl")
    );
  });
  return hasHinge && hasCurl;
}

function duplicateExerciseNames(
  plan?: V2BasePlanComparePlanView | null,
): string[] {
  if (!plan?.available) {
    return [];
  }
  return duplicates(
    plan.slots.flatMap((slot) =>
      slot.exercises.map((exercise) => exercise.exerciseName),
    ),
  );
}

function duplicateClassFamiliesForPlan(
  plan?: V2BasePlanComparePlanView | null,
): string[] {
  if (!plan?.available) {
    return [];
  }
  return duplicates(
    plan.slots.flatMap((slot) =>
      slot.exercises.flatMap((exercise) => exercise.classIds ?? []),
    ),
  );
}

function exerciseNamesForSlot(
  plan: V2BasePlanComparePlanView | null | undefined,
  slotId: string,
): string[] {
  return (
    plan?.slots
      .find((slot) => slot.slotId === slotId)
      ?.exercises.map((exercise) => exercise.exerciseName)
      .sort((left, right) => left.localeCompare(right)) ?? []
  );
}

function exerciseIdentityKey(exercise: V2BasePlanCompareExercise): string {
  return exercise.exerciseId ?? exercise.exerciseName;
}

function sameStringSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry) => right.includes(entry))
  );
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicated.add(value);
    }
    seen.add(value);
  }
  return Array.from(duplicated).sort((left, right) => left.localeCompare(right));
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right),
  );
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
