import { describe, expect, it } from "vitest";
import {
  buildV2LiveContextMaterializationDryRunHarness,
  normalizeLiveInventoryForV2Materialization,
} from "@/lib/audit/workout-audit/v2-materialization-live-context-dry-run";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
import { buildV2PlannerMesocyclePolicy } from "../mesocycle-policy";
import { buildV2MaterializationDryRunReport } from "./dry-run-report";
import { buildV2ExerciseMaterializationPlan } from "./materializer";
import { buildV2MaterializationPromotionReadiness } from "./promotion-readiness";
import { DEFAULT_V2_EXERCISE_CLASS_TAXONOMY } from "./taxonomy";
import type { V2ExerciseSelectionPlan } from "../types";
import type {
  V2ExerciseClassTaxonomy,
  V2ExerciseMaterializationPlan,
  V2ExerciseMaterializationInput,
  V2MaterializationProductionWriteGates,
  V2MaterializationRequiredLaneCoverage,
  V2MaterializationExercise,
} from "./types";

type PlanLane =
  V2ExerciseSelectionPlan["weeks"][number]["slots"][number]["lanes"][number];
type PlanSlot = V2ExerciseSelectionPlan["weeks"][number]["slots"][number];

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

function lane(input: Partial<PlanLane> & Pick<PlanLane, "laneId" | "role" | "primaryMuscles" | "acceptableExerciseClasses">): PlanLane {
  return {
    requirement: "required",
    classLaneKind: input.role === "optional"
      ? "optional_recoverable_lane"
      : "owned_class_lane",
    supportMuscles: [],
    optionalMuscles: input.role === "optional" ? [...input.primaryMuscles] : [],
    managedCollateralMuscles: [],
    ownershipKinds: input.role === "optional"
      ? ["optional_if_needed"]
      : ["primary_exposure"],
    preferredExerciseClasses: [...input.acceptableExerciseClasses],
    setBudget: { min: 2, preferred: 3, max: 3 },
    setBudgetBasis: input.role === "optional"
      ? "optional_activation_required"
      : "class_ownership_allocation",
    duplicatePolicy: {
      scope: "same_slot",
      classDistinctness: "preferred",
      sameExerciseAllowedOnlyWithJustification: true,
    },
    cleanAlternativePolicy: {
      requiredBeforeDuplicate: false,
      evaluationTiming: "future_inventory_selection",
    },
    perExerciseCap: {
      maxSetsWithoutJustification: 4,
      maxDirectExercises: 1,
      allowAboveFiveSetsOnlyWithJustification: true,
    },
    continuityPolicy: {
      preserve: "lane_class",
      exactIdentityPolicy: "not_planned_until_inventory_selection",
      crossWeekVariation: "stable_class_preferred",
    },
    ...input,
  };
}

function plan(lanes: PlanLane[], maxExerciseCount = 6): V2ExerciseSelectionPlan {
  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    selectionTiming: "before_inventory_selection",
    weeks: [
      {
        week: 1,
        phase: "entry_calibration",
        slots: [
          {
            slotId: "upper_a",
            slotIndex: 0,
            maxExerciseCount,
            targetSessionSets: { min: 8, preferred: 12, max: 16 },
            lanes,
          },
        ],
      },
    ],
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
  };
}

function multiSlotPlan(
  slots: Array<{
    slotId: PlanSlot["slotId"];
    slotIndex: number;
    lanes: PlanLane[];
    maxExerciseCount?: number;
  }>,
): V2ExerciseSelectionPlan {
  return {
    version: 1,
    source: "v2_planner_policy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    selectionTiming: "before_inventory_selection",
    weeks: [
      {
        week: 1,
        phase: "entry_calibration",
        slots: slots.map((slot) => ({
          slotId: slot.slotId,
          slotIndex: slot.slotIndex,
          maxExerciseCount: slot.maxExerciseCount ?? 6,
          targetSessionSets: { min: 8, preferred: 12, max: 16 },
          lanes: slot.lanes,
        })),
      },
    ],
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
  };
}

function materialize(input: {
  plan: V2ExerciseSelectionPlan;
  inventory: V2MaterializationExercise[];
  taxonomy?: V2ExerciseClassTaxonomy;
  avoidExerciseIds?: string[];
  favoriteExerciseIds?: string[];
  painConflictExerciseIds?: string[];
  continuity?: V2ExerciseMaterializationInput["continuity"];
}) {
  return buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: input.plan,
    inventory: input.inventory,
    taxonomy: input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    constraints: {
      avoidExerciseIds: input.avoidExerciseIds ?? [],
      favoriteExerciseIds: input.favoriteExerciseIds ?? [],
      painConflictExerciseIds: input.painConflictExerciseIds ?? [],
    },
    ...(input.continuity ? { continuity: input.continuity } : {}),
  });
}

function laneSelectionIntent(
  input: NonNullable<PlanLane["laneSelectionIntent"]>,
): NonNullable<PlanLane["laneSelectionIntent"]> {
  return input;
}

const verticalPullAnchorIntent = laneSelectionIntent({
  version: 0,
  source: "v2_planner_policy",
  contract: "laneSelectionIntent",
  readOnly: true,
  affectsScoringOrGeneration: false,
  consumedByMaterializer: true,
  laneJob: "anchor_overload",
  requiredMovementPattern: "vertical_pull",
  allowedExerciseClasses: ["vertical_pull"],
  disallowedExerciseClasses: ["row", "pullover", "straight_arm_pulldown"],
  directnessRequirement: "direct_only",
  minimumTargetStimulus: {
    muscle: "Lats",
    minimumPerSetStimulus: 0.75,
  },
  loadabilityPreference: "high",
  capacityPriority: "floor_critical",
  fallbackPolicy: "block_if_no_true_vertical_pull",
  identityPreservationMode: "preserve_lane_job",
});

const chestBiasedPressSupportIntent = laneSelectionIntent({
  version: 0,
  source: "v2_planner_policy",
  contract: "laneSelectionIntent",
  readOnly: true,
  affectsScoringOrGeneration: false,
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
  stabilityPreference: "stable_preferred",
  fatiguePreference: "moderate_or_low",
  duplicatePolicy: "prefer_variation_if_clean",
  capacityPriority: "high",
  fallbackPolicy: "allow_labeled_fallback",
  identityPreservationMode: "variation_allowed_within_lane_job",
});

const hamstringCurlIntent = laneSelectionIntent({
  version: 0,
  source: "v2_planner_policy",
  contract: "laneSelectionIntent",
  readOnly: true,
  affectsScoringOrGeneration: false,
  consumedByMaterializer: true,
  laneJob: "direct_floor",
  requiredMovementPattern: "knee_flexion",
  allowedExerciseClasses: ["hamstring_curl"],
  disallowedExerciseClasses: ["hinge", "back_extension", "hip_thrust"],
  directnessRequirement: "direct_only",
  fatiguePreference: "low_axial",
  capacityPriority: "floor_critical",
  fallbackPolicy: "block_if_floor_critical",
  identityPreservationMode: "variation_allowed_within_lane_job",
});

function makeMaterializedPlan(
  overrides: Partial<V2ExerciseMaterializationPlan> = {},
): V2ExerciseMaterializationPlan {
  return {
    version: 1,
    source: "v2_exercise_materialization",
    dryRunOnly: true,
    status: "materialized",
    slots: [
      {
        slotId: "upper_a",
        exercises: [
          {
            exerciseId: "bench",
            role: "CORE_COMPOUND",
            setCount: 4,
            laneIds: ["chest_anchor"],
          },
          {
            exerciseId: "row",
            role: "ACCESSORY",
            setCount: 3,
            laneIds: ["row_anchor"],
          },
        ],
      },
    ],
    blockers: [],
    omissions: [],
    ...overrides,
  };
}

function plannerPolicyWithEmptySelectionPlan() {
  return {
    ...buildV2PlannerMesocyclePolicy(),
    exerciseSelectionPlan: plan([]),
  };
}

const allProductionWriteGatesDesigned: V2MaterializationProductionWriteGates = {
  acceptancePathDesigned: true,
  slotPlanSeedJsonWriteGateDesigned: true,
  receiptContractDesigned: true,
  runtimeReplayContractVerified: true,
  auditSerializationContractDesigned: true,
  rollbackStrategyDefined: true,
};

const fullRequiredLaneCoverage: V2MaterializationRequiredLaneCoverage[] = [
  {
    slotId: "upper_a",
    requiredLaneCount: 2,
    materializedRequiredLaneCount: 2,
    blockedRequiredLaneCount: 0,
    missingRequiredLaneIds: [],
  },
];

const fixtureInventory = [
  exercise({
    exerciseId: "bench",
    name: "Machine Chest Press",
    primaryMuscles: ["Chest"],
    movementPatterns: ["press"],
    isCompound: true,
    fatigueCost: 2,
  }),
  exercise({
    exerciseId: "row",
    name: "Chest Supported Row",
    primaryMuscles: ["Upper Back", "Lats"],
    movementPatterns: ["row"],
    isCompound: true,
    fatigueCost: 2,
  }),
  exercise({
    exerciseId: "pressdown",
    name: "Rope Pressdown",
    primaryMuscles: ["Triceps"],
    fatigueCost: 1,
  }),
  exercise({
    exerciseId: "curl",
    name: "Cable Curl",
    primaryMuscles: ["Biceps"],
    fatigueCost: 1,
  }),
];

const representativeV2Inventory = [
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

function representativeRequiredLaneIds(plan: V2ExerciseSelectionPlan): string[] {
  const seenSlots = new Set<string>();
  const baseWeeks = plan.weeks.filter((week) =>
    ["accumulation", "hard_accumulation", "peak_overreach_lite"].includes(
      week.phase,
    ),
  );
  return (baseWeeks.length ? baseWeeks : plan.weeks)
    .flatMap((week) =>
      week.slots.flatMap((slot) => {
        if (seenSlots.has(slot.slotId)) {
          return [];
        }
        seenSlots.add(slot.slotId);
        return slot.lanes
          .filter((row) => row.requirement === "required")
          .map((row) => `${slot.slotId}:${row.laneId}`);
      }),
    )
    .sort();
}

function exerciseForLane(
  result: V2ExerciseMaterializationPlan,
  slotId: string,
  laneId: string,
) {
  const found = result.slots
    .find((slotRow) => slotRow.slotId === slotId)
    ?.exercises.find((exerciseRow) => exerciseRow.laneIds.includes(laneId));
  if (!found) {
    throw new Error(`Missing materialized lane ${slotId}:${laneId}`);
  }
  return found;
}

function weightedChestSets(input: {
  result: V2ExerciseMaterializationPlan;
  inventory: V2MaterializationExercise[];
}): number {
  const exerciseById = new Map(
    input.inventory.map((exerciseRow) => [exerciseRow.exerciseId, exerciseRow]),
  );
  const total = input.result.slots
    .flatMap((slot) => slot.exercises)
    .reduce((sum, materializedExercise) => {
      const inventoryExercise = exerciseById.get(materializedExercise.exerciseId);
      if (!inventoryExercise) {
        return sum;
      }
      return (
        sum +
        (getEffectiveStimulusByMuscle(
          {
            id: inventoryExercise.exerciseId,
            name: inventoryExercise.name,
            aliases: inventoryExercise.aliases,
            primaryMuscles: inventoryExercise.primaryMuscles,
            secondaryMuscles: inventoryExercise.secondaryMuscles,
            stimulusProfile: {},
          },
          materializedExercise.setCount,
          { logFallback: false },
        ).get("Chest") ?? 0)
      );
    }, 0);
  return Math.round(total * 10) / 10;
}

describe("buildV2ExerciseMaterializationPlan", () => {
  it("preserves prior materializer behavior when laneSelectionIntent is missing", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "vertical_press",
          role: "support",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["vertical_press"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "landmine-press",
          name: "Landmine Press",
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Front Delts", "Triceps"],
          movementPatterns: ["vertical_press"],
          stimulusByMusclePerSet: {
            Chest: 0.35,
            "Front Delts": 1,
            Triceps: 0.35,
          },
          isCompound: true,
          fatigueCost: 2,
        }),
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "upper_a", "vertical_press")).toMatchObject({
      exerciseId: "landmine-press",
      role: "ACCESSORY",
    });
  });

  it("materializes all required lanes from fixture inventory", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "chest_anchor",
          role: "anchor",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["horizontal_press"],
          setBudget: { min: 3, preferred: 4, max: 4 },
        }),
        lane({
          laneId: "row_anchor",
          role: "anchor",
          primaryMuscles: ["Upper Back", "Lats"],
          acceptableExerciseClasses: ["horizontal_pull_support"],
        }),
        lane({
          laneId: "triceps",
          role: "accessory",
          primaryMuscles: ["Triceps"],
          acceptableExerciseClasses: ["triceps_isolation"],
          directFloor: {
            muscle: "Triceps",
            minDirectSets: 2,
            collateralCanSatisfy: false,
            requiredExerciseClasses: ["triceps_isolation"],
          },
        }),
        lane({
          laneId: "biceps",
          role: "accessory",
          primaryMuscles: ["Biceps"],
          acceptableExerciseClasses: ["biceps_isolation"],
        }),
      ]),
      inventory: fixtureInventory,
    });

    expect(result).toEqual({
      version: 1,
      source: "v2_exercise_materialization",
      dryRunOnly: true,
      status: "materialized",
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            {
              exerciseId: "bench",
              role: "CORE_COMPOUND",
              setCount: 4,
              laneIds: ["chest_anchor"],
            },
            {
              exerciseId: "row",
              role: "CORE_COMPOUND",
              setCount: 3,
              laneIds: ["row_anchor"],
            },
            {
              exerciseId: "pressdown",
              role: "ACCESSORY",
              setCount: 3,
              laneIds: ["triceps"],
            },
            {
              exerciseId: "curl",
              role: "ACCESSORY",
              setCount: 3,
              laneIds: ["biceps"],
            },
          ],
        },
      ],
      blockers: [],
      omissions: [],
    });
  });

  it("blocks when a required class is missing", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "row_anchor",
          role: "anchor",
          primaryMuscles: ["Upper Back", "Lats"],
          acceptableExerciseClasses: ["horizontal_pull_support"],
        }),
      ]),
      inventory: [fixtureInventory[0]],
    });

    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "row_anchor",
        reason: "no_class_match",
      },
    ]);
  });

  it("omits an optional lane when its class is missing", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "optional_biceps",
          requirement: "optional",
          role: "optional",
          primaryMuscles: ["Biceps"],
          acceptableExerciseClasses: ["biceps_isolation"],
        }),
      ]),
      inventory: [fixtureInventory[0]],
    });

    expect(result.status).toBe("materialized");
    expect(result.blockers).toEqual([]);
    expect(result.omissions).toEqual([
      {
        slotId: "upper_a",
        laneId: "optional_biceps",
        reason: "optional_no_match",
      },
    ]);
  });

  it("blocks direct floors when only collateral class evidence matches", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "triceps",
          role: "accessory",
          primaryMuscles: ["Triceps"],
          acceptableExerciseClasses: ["horizontal_press", "triceps_isolation"],
          directFloor: {
            muscle: "Triceps",
            minDirectSets: 2,
            collateralCanSatisfy: false,
            requiredExerciseClasses: ["triceps_isolation"],
          },
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "close-grip",
          name: "Close Grip Bench Press",
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Triceps"],
          movementPatterns: ["press"],
          isCompound: true,
        }),
      ],
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "triceps",
        reason: "direct_floor_unmaterialized",
      },
    ]);
  });

  it("does not let OHP collateral satisfy the side-delt direct floor", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "side_delt_isolation",
          role: "accessory",
          primaryMuscles: ["Side Delts"],
          acceptableExerciseClasses: ["vertical_press", "lateral_raise"],
          directFloor: {
            muscle: "Side Delts",
            minDirectSets: 3,
            collateralCanSatisfy: false,
            requiredExerciseClasses: ["lateral_raise", "low_collateral_side_delt"],
          },
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "shoulder-press",
          name: "Machine Shoulder Press",
          aliases: ["OHP"],
          primaryMuscles: ["Front Delts", "Side Delts"],
          movementPatterns: ["vertical_press"],
          isCompound: true,
        }),
      ],
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "side_delt_isolation",
        reason: "direct_floor_unmaterialized",
      },
    ]);
  });

  it("does not let row collateral satisfy the rear-delt direct floor", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "rear_delt",
          role: "accessory",
          primaryMuscles: ["Rear Delts"],
          acceptableExerciseClasses: [
            "horizontal_pull_support",
            "rear_delt_isolation",
          ],
          directFloor: {
            muscle: "Rear Delts",
            minDirectSets: 2,
            collateralCanSatisfy: false,
            requiredExerciseClasses: ["rear_delt_isolation"],
          },
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "supported-row",
          name: "Chest Supported Row",
          primaryMuscles: ["Upper Back", "Lats"],
          movementPatterns: ["row"],
          isCompound: true,
        }),
      ],
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "rear_delt",
        reason: "direct_floor_unmaterialized",
      },
    ]);
  });

  it("blocks rows and pullovers from direct vertical-pull lanes", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "vertical_pull_anchor",
          role: "anchor",
          primaryMuscles: ["Lats"],
          acceptableExerciseClasses: ["vertical_pull"],
          laneSelectionIntent: verticalPullAnchorIntent,
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "cable-pullover",
          name: "Cable Pullover",
          primaryMuscles: ["Lats"],
          movementPatterns: ["vertical_pull"],
          isCompound: false,
        }),
        exercise({
          exerciseId: "straight-arm-pulldown",
          name: "Straight-Arm Pulldown",
          primaryMuscles: ["Lats"],
          movementPatterns: ["vertical_pull"],
          isCompound: false,
        }),
        exercise({
          exerciseId: "t-bar-row",
          name: "Chest-Supported T-Bar Row",
          primaryMuscles: ["Upper Back", "Lats"],
          movementPatterns: ["row"],
          isCompound: true,
        }),
      ],
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "vertical_pull_anchor",
        reason: "no_class_match",
      },
    ]);
  });

  it("materializer consumes laneSelectionIntent for vertical_pull_anchor", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "vertical_pull_anchor",
          role: "anchor",
          primaryMuscles: ["Lats"],
          acceptableExerciseClasses: [
            "vertical_pull",
            "horizontal_pull_support",
          ],
          laneSelectionIntent: verticalPullAnchorIntent,
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "t-bar-row",
          name: "Chest-Supported T-Bar Row",
          primaryMuscles: ["Upper Back", "Lats"],
          movementPatterns: ["row"],
          isCompound: true,
        }),
        exercise({
          exerciseId: "lat-pulldown",
          name: "Lat Pulldown",
          primaryMuscles: ["Lats"],
          movementPatterns: ["vertical_pull"],
          stimulusByMusclePerSet: { Lats: 1 },
          isCompound: true,
          equipment: ["cable"],
        }),
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "upper_a", "vertical_pull_anchor")).toMatchObject({
      exerciseId: "lat-pulldown",
      role: "CORE_COMPOUND",
    });
  });

  it("vertical_pull_anchor allows true pulldown, pull-up, and chin-up patterns", () => {
    for (const [exerciseId, name] of [
      ["lat-pulldown", "Lat Pulldown"],
      ["pull-up", "Pull-Up"],
      ["chin-up", "Chin-Up"],
    ] as const) {
      const result = materialize({
        plan: plan([
          lane({
            laneId: "vertical_pull_anchor",
            role: "anchor",
            primaryMuscles: ["Lats"],
            acceptableExerciseClasses: ["vertical_pull"],
            laneSelectionIntent: verticalPullAnchorIntent,
          }),
        ]),
        inventory: [
          exercise({
            exerciseId,
            name,
            primaryMuscles: ["Lats"],
            movementPatterns: ["vertical_pull"],
            stimulusByMusclePerSet: { Lats: 1 },
            isCompound: true,
          }),
        ],
      });

      expect(result.blockers).toEqual([]);
      expect(exerciseForLane(result, "upper_a", "vertical_pull_anchor").exerciseId)
        .toBe(exerciseId);
    }
  });

  it("materializes added machine variants into compatible V2 lanes", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "vertical_pull_anchor",
          role: "anchor",
          primaryMuscles: ["Lats"],
          acceptableExerciseClasses: ["vertical_pull"],
        }),
        lane({
          laneId: "row_anchor",
          role: "anchor",
          primaryMuscles: ["Upper Back", "Lats"],
          acceptableExerciseClasses: ["horizontal_pull_support"],
        }),
        lane({
          laneId: "chest_anchor",
          role: "anchor",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["horizontal_press"],
          setBudget: { min: 3, preferred: 4, max: 4 },
        }),
        lane({
          laneId: "hinge_anchor",
          role: "anchor",
          primaryMuscles: ["Glutes"],
          acceptableExerciseClasses: ["low_axial_hip_extension_anchor"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "iso-front-pulldown",
          name: "Iso-Lateral Front Lat Pulldown",
          primaryMuscles: ["Lats"],
          movementPatterns: ["vertical_pull"],
          isCompound: true,
          equipment: ["machine"],
          fatigueCost: 2,
        }),
        exercise({
          exerciseId: "iso-high-row",
          name: "Iso-Lateral High Row",
          primaryMuscles: ["Upper Back", "Lats"],
          movementPatterns: ["horizontal_pull"],
          isCompound: true,
          equipment: ["machine"],
          fatigueCost: 2,
        }),
        exercise({
          exerciseId: "iso-incline-press",
          name: "Iso-Lateral Incline Press",
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Front Delts", "Triceps"],
          movementPatterns: ["horizontal_push"],
          isCompound: true,
          equipment: ["machine"],
          fatigueCost: 2,
        }),
        exercise({
          exerciseId: "machine-hip-thrust",
          name: "Machine Hip Thrust",
          primaryMuscles: ["Glutes"],
          secondaryMuscles: ["Hamstrings"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: { Glutes: 1, Hamstrings: 0.2 },
          isCompound: true,
          equipment: ["machine"],
          fatigueCost: 2,
        }),
      ],
    });

    expect(result.status).toBe("materialized");
    expect(exerciseForLane(result, "upper_a", "vertical_pull_anchor").exerciseId).toBe(
      "iso-front-pulldown",
    );
    expect(exerciseForLane(result, "upper_a", "row_anchor").exerciseId).toBe(
      "iso-high-row",
    );
    expect(exerciseForLane(result, "upper_a", "chest_anchor").exerciseId).toBe(
      "iso-incline-press",
    );
    expect(exerciseForLane(result, "upper_a", "hinge_anchor").exerciseId).toBe(
      "machine-hip-thrust",
    );
  });

  it("keeps added accessories out of incompatible V2 lanes", () => {
    const hamstringCurlResult = materialize({
      plan: plan([
        lane({
          laneId: "hamstring_curl",
          role: "accessory",
          primaryMuscles: ["Hamstrings"],
          acceptableExerciseClasses: ["knee_flexion_curl"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "hamstring-back-extension",
          name: "45-Degree Back Extension, Hamstring Bias",
          primaryMuscles: ["Hamstrings", "Glutes"],
          secondaryMuscles: ["Lower Back"],
          movementPatterns: ["extension"],
          stimulusByMusclePerSet: {
            Hamstrings: 0.75,
            Glutes: 0.65,
            "Lower Back": 0.35,
          },
          isCompound: true,
          equipment: ["machine"],
        }),
      ],
    });
    const rowResult = materialize({
      plan: plan([
        lane({
          laneId: "row_anchor",
          role: "anchor",
          primaryMuscles: ["Upper Back", "Lats"],
          acceptableExerciseClasses: ["horizontal_pull_support"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "machine-shrug",
          name: "Seated Machine Shrug",
          primaryMuscles: ["Upper Back"],
          movementPatterns: ["isolation"],
          equipment: ["machine"],
        }),
      ],
    });
    const chestResult = materialize({
      plan: plan([
        lane({
          laneId: "chest_anchor",
          role: "anchor",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["horizontal_press"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "seated-dip",
          name: "Seated Dip Machine",
          primaryMuscles: ["Triceps"],
          secondaryMuscles: ["Chest", "Front Delts"],
          movementPatterns: ["vertical_push"],
          isCompound: true,
          equipment: ["machine"],
        }),
      ],
    });

    expect(hamstringCurlResult.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "hamstring_curl",
        reason: "no_class_match",
      },
    ]);
    expect(rowResult.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "row_anchor",
        reason: "no_class_match",
      },
    ]);
    expect(chestResult.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "chest_anchor",
        reason: "no_class_match",
      },
    ]);
  });

  it("materializer consumes laneSelectionIntent for hamstring_curl", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "hamstring_curl",
          role: "accessory",
          primaryMuscles: ["Hamstrings"],
          acceptableExerciseClasses: [
            "knee_flexion_curl",
            "hinge_compound",
            "low_axial_hip_extension_anchor",
          ],
          laneSelectionIntent: hamstringCurlIntent,
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "romanian-deadlift",
          name: "Romanian Deadlift",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: {
            Hamstrings: 1,
            Glutes: 0.75,
            "Lower Back": 0.65,
          },
          isCompound: true,
          fatigueCost: 4,
        }),
        exercise({
          exerciseId: "machine-hip-thrust",
          name: "Machine Hip Thrust",
          primaryMuscles: ["Glutes", "Hamstrings"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: {
            Hamstrings: 0.3,
            Glutes: 1,
            "Lower Back": 0.1,
          },
          isCompound: true,
          equipment: ["machine"],
          fatigueCost: 2,
        }),
        exercise({
          exerciseId: "seated-leg-curl",
          name: "Seated Leg Curl",
          primaryMuscles: ["Hamstrings"],
          movementPatterns: ["knee_flexion", "isolation"],
          stimulusByMusclePerSet: { Hamstrings: 1 },
          equipment: ["machine"],
          fatigueCost: 1,
        }),
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "upper_a", "hamstring_curl")).toMatchObject({
      exerciseId: "seated-leg-curl",
      role: "ACCESSORY",
    });
  });

  it("hamstring_curl rejects back extension, hinge, and hip thrust patterns", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "hamstring_curl",
          role: "accessory",
          primaryMuscles: ["Hamstrings"],
          acceptableExerciseClasses: [
            "knee_flexion_curl",
            "hinge_compound",
            "low_axial_hip_extension_anchor",
          ],
          laneSelectionIntent: hamstringCurlIntent,
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "hamstring-back-extension",
          name: "45-Degree Back Extension, Hamstring Bias",
          primaryMuscles: ["Hamstrings", "Glutes"],
          secondaryMuscles: ["Lower Back"],
          movementPatterns: ["extension"],
          stimulusByMusclePerSet: {
            Hamstrings: 0.75,
            Glutes: 0.65,
            "Lower Back": 0.35,
          },
          isCompound: true,
          equipment: ["machine"],
        }),
        exercise({
          exerciseId: "romanian-deadlift",
          name: "Romanian Deadlift",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: {
            Hamstrings: 1,
            Glutes: 0.75,
            "Lower Back": 0.65,
          },
          isCompound: true,
        }),
        exercise({
          exerciseId: "machine-hip-thrust",
          name: "Machine Hip Thrust",
          primaryMuscles: ["Glutes", "Hamstrings"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: {
            Hamstrings: 0.3,
            Glutes: 1,
            "Lower Back": 0.1,
          },
          isCompound: true,
          equipment: ["machine"],
        }),
      ],
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "hamstring_curl",
        reason: "no_class_match",
      },
    ]);
  });

  it("hamstring_curl selects seated, lying, and Nordic-style curl patterns", () => {
    for (const [exerciseId, name] of [
      ["seated-leg-curl", "Seated Leg Curl"],
      ["lying-leg-curl", "Lying Leg Curl"],
      ["nordic-curl", "Nordic Hamstring Curl"],
    ] as const) {
      const result = materialize({
        plan: plan([
          lane({
            laneId: "hamstring_curl",
            role: "accessory",
            primaryMuscles: ["Hamstrings"],
            acceptableExerciseClasses: ["knee_flexion_curl"],
            laneSelectionIntent: hamstringCurlIntent,
          }),
        ]),
        inventory: [
          exercise({
            exerciseId,
            name,
            primaryMuscles: ["Hamstrings"],
            movementPatterns: ["knee_flexion", "isolation"],
            stimulusByMusclePerSet: { Hamstrings: 1 },
            fatigueCost: exerciseId === "nordic-curl" ? 2 : 1,
          }),
        ],
      });

      expect(result.blockers).toEqual([]);
      expect(exerciseForLane(result, "upper_a", "hamstring_curl").exerciseId)
        .toBe(exerciseId);
    }
  });

  it("blocks goblet squat from quad-isolation and leg-extension lanes", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "quad_isolation",
          role: "support",
          primaryMuscles: ["Quads"],
          acceptableExerciseClasses: ["leg_extension", "quad_isolation"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "goblet-squat",
          name: "Goblet Squat",
          primaryMuscles: ["Quads"],
          movementPatterns: ["squat"],
          isCompound: true,
        }),
      ],
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "quad_isolation",
        reason: "no_class_match",
      },
    ]);
  });

  it("blocks Cable Fly from a fresh chest anchor even when it is favorited", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "chest_anchor",
          role: "anchor",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["horizontal_press", "fly"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "cable-fly",
          name: "Cable Fly",
          primaryMuscles: ["Chest"],
          movementPatterns: ["fly"],
          fatigueCost: 1,
        }),
      ],
      favoriteExerciseIds: ["cable-fly"],
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "chest_anchor",
        reason: "no_class_match",
      },
    ]);
  });

  it("allows Cable Fly to satisfy a chest second-exposure fly lane", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "chest_second_exposure",
          role: "support",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["fly", "distinct_chest_press_or_fly"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "cable-fly",
          name: "Cable Fly",
          primaryMuscles: ["Chest"],
          movementPatterns: ["fly"],
          fatigueCost: 1,
        }),
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "upper_a", "chest_second_exposure"))
      .toMatchObject({
        exerciseId: "cable-fly",
        role: "ACCESSORY",
      });
  });

  it("allows pec deck and cable crossover to satisfy chest fly lanes", () => {
    for (const row of [
      exercise({
        exerciseId: "pec-deck",
        name: "Pec Deck Machine",
        primaryMuscles: ["Chest"],
        movementPatterns: ["horizontal_push"],
        equipment: ["machine"],
        fatigueCost: 2,
      }),
      exercise({
        exerciseId: "cable-crossover",
        name: "Cable Crossover",
        primaryMuscles: ["Chest"],
        movementPatterns: ["horizontal_push"],
        equipment: ["cable"],
        fatigueCost: 2,
      }),
    ]) {
      const result = materialize({
        plan: plan([
          lane({
            laneId: "chest_second_exposure",
            role: "support",
            primaryMuscles: ["Chest"],
            acceptableExerciseClasses: ["fly", "distinct_chest_press_or_fly"],
          }),
        ]),
        inventory: [row],
      });

      expect(result.blockers).toEqual([]);
      expect(exerciseForLane(result, "upper_a", "chest_second_exposure"))
        .toMatchObject({
          exerciseId: row.exerciseId,
          role: "ACCESSORY",
        });
    }
  });

  it("allows loadable press variants to satisfy a fresh chest anchor", () => {
    const pressVariants = [
      ["machine-press", "Machine Chest Press"],
      ["db-press", "DB Bench Press"],
      ["barbell-press", "Barbell Bench Press"],
      ["smith-press", "Smith Machine Bench Press"],
      ["incline-press", "Incline Machine Press"],
    ] as const;

    for (const [exerciseId, name] of pressVariants) {
      const result = materialize({
        plan: plan([
          lane({
            laneId: "chest_anchor",
            role: "anchor",
            primaryMuscles: ["Chest"],
            acceptableExerciseClasses: ["horizontal_press"],
          }),
        ]),
        inventory: [
          exercise({
            exerciseId,
            name,
            primaryMuscles: ["Chest"],
            movementPatterns: ["horizontal_press"],
            isCompound: true,
            fatigueCost: 1,
          }),
        ],
      });

      expect(exerciseForLane(result, "upper_a", "chest_anchor").exerciseId)
        .toBe(exerciseId);
    }
  });

  it("keeps Goblet Squat behind loadable squat-anchor alternatives", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "squat_anchor",
          role: "anchor",
          primaryMuscles: ["Quads"],
          acceptableExerciseClasses: ["squat_pattern"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "goblet-squat",
          name: "Goblet Squat",
          primaryMuscles: ["Quads"],
          movementPatterns: ["squat"],
          isCompound: true,
          fatigueCost: 1,
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
          exerciseId: "hack-squat",
          name: "Hack Squat",
          primaryMuscles: ["Quads"],
          movementPatterns: ["squat"],
          isCompound: true,
          fatigueCost: 2,
        }),
      ],
      favoriteExerciseIds: ["goblet-squat"],
    });

    expect(exerciseForLane(result, "upper_a", "squat_anchor").exerciseId)
      .toBe("hack-squat");
  });

  it("allows Goblet Squat as a fallback squat anchor when no loadable alternative exists", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "squat_anchor",
          role: "anchor",
          primaryMuscles: ["Quads"],
          acceptableExerciseClasses: ["squat_pattern"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "goblet-squat",
          name: "Goblet Squat",
          primaryMuscles: ["Quads"],
          movementPatterns: ["squat"],
          isCompound: true,
          fatigueCost: 1,
        }),
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "upper_a", "squat_anchor").exerciseId)
      .toBe("goblet-squat");
  });

  it("keeps Goblet Squat behind loadable Lower B quad-support options", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "quad_support",
          role: "support",
          primaryMuscles: ["Quads"],
          acceptableExerciseClasses: [
            "leg_press",
            "squat_pattern",
            "quad_isolation",
            "lunge",
          ],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "goblet-squat",
          name: "Goblet Squat",
          primaryMuscles: ["Quads"],
          movementPatterns: ["squat"],
          isCompound: true,
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "leg-press",
          name: "Leg Press",
          primaryMuscles: ["Quads"],
          movementPatterns: ["leg_press"],
          isCompound: true,
          fatigueCost: 2,
        }),
      ],
      favoriteExerciseIds: ["goblet-squat"],
    });

    expect(exerciseForLane(result, "upper_a", "quad_support").exerciseId)
      .toBe("leg-press");
  });

  it("keeps generic lunge fallback behind leg press for Lower B quad support", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "quad_support",
          role: "support",
          primaryMuscles: ["Quads"],
          acceptableExerciseClasses: [
            "leg_press",
            "squat_pattern",
            "quad_isolation",
            "lunge",
          ],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "reverse-lunge",
          name: "Reverse Lunge",
          primaryMuscles: ["Quads"],
          movementPatterns: ["lunge"],
          equipment: ["dumbbell"],
          isCompound: true,
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "leg-press",
          name: "Leg Press",
          primaryMuscles: ["Quads"],
          movementPatterns: ["leg_press"],
          isCompound: true,
          fatigueCost: 2,
        }),
      ],
      favoriteExerciseIds: ["reverse-lunge"],
    });

    expect(exerciseForLane(result, "upper_a", "quad_support").exerciseId)
      .toBe("leg-press");
  });

  it("keeps Cable Pull-Through behind true hinge anchors", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "hinge_anchor",
          role: "anchor",
          primaryMuscles: ["Hamstrings", "Glutes"],
          acceptableExerciseClasses: [
            "hinge_compound",
            "low_axial_hip_extension_anchor",
          ],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "cable-pull-through",
          name: "Cable Pull-Through",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: { Hamstrings: 0.8, Glutes: 0.8, "Lower Back": 0.1 },
          isCompound: true,
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "romanian-deadlift",
          name: "Romanian Deadlift",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: { Hamstrings: 1, Glutes: 0.8, "Lower Back": 0.25 },
          isCompound: true,
          isMainLiftEligible: true,
          fatigueCost: 2,
        }),
      ],
      favoriteExerciseIds: ["cable-pull-through"],
    });

    expect(exerciseForLane(result, "upper_a", "hinge_anchor").exerciseId)
      .toBe("romanian-deadlift");
  });

  it("allows Cable Pull-Through as a diagnostic fallback when true hinges are absent", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "hinge_anchor",
          role: "anchor",
          primaryMuscles: ["Hamstrings", "Glutes"],
          acceptableExerciseClasses: [
            "hinge_compound",
            "low_axial_hip_extension_anchor",
          ],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "cable-pull-through",
          name: "Cable Pull-Through",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: { Hamstrings: 0.8, Glutes: 0.8, "Lower Back": 0.1 },
          isCompound: true,
          fatigueCost: 1,
        }),
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "upper_a", "hinge_anchor").exerciseId)
      .toBe("cable-pull-through");
  });

  it("keeps RDL and SLDL valid as hinge anchors", () => {
    const hingeVariants = [
      ["rdl", "Romanian Deadlift"],
      ["sldl", "Stiff-Legged Deadlift"],
    ] as const;

    for (const [exerciseId, name] of hingeVariants) {
      const result = materialize({
        plan: plan([
          lane({
            laneId: "hinge_anchor",
            role: "anchor",
            primaryMuscles: ["Hamstrings", "Glutes"],
            acceptableExerciseClasses: ["hinge_compound"],
          }),
        ]),
        inventory: [
          exercise({
            exerciseId,
            name,
            primaryMuscles: ["Hamstrings", "Glutes"],
            movementPatterns: ["hinge"],
            stimulusByMusclePerSet: { Hamstrings: 1, Glutes: 0.8 },
            isCompound: true,
            isMainLiftEligible: true,
            fatigueCost: 2,
          }),
        ],
      });

      expect(exerciseForLane(result, "upper_a", "hinge_anchor").exerciseId)
        .toBe(exerciseId);
    }
  });

  it("prefers loadable rows over Inverted Row for fresh row support", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "row_support",
          role: "support",
          primaryMuscles: ["Upper Back", "Lats"],
          acceptableExerciseClasses: ["horizontal_pull_support"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "inverted-row",
          name: "Inverted Row",
          primaryMuscles: ["Upper Back", "Lats"],
          movementPatterns: ["row"],
          isCompound: true,
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "seated-cable-row",
          name: "Seated Cable Row",
          primaryMuscles: ["Upper Back", "Lats"],
          movementPatterns: ["horizontal_pull"],
          isCompound: true,
          fatigueCost: 2,
        }),
      ],
      favoriteExerciseIds: ["inverted-row"],
    });

    expect(exerciseForLane(result, "upper_a", "row_support").exerciseId)
      .toBe("seated-cable-row");
  });

  it("prefers a clean alternative over a duplicate", () => {
    const chestPlan = plan([
      lane({
        laneId: "chest_anchor",
        role: "anchor",
        primaryMuscles: ["Chest"],
        acceptableExerciseClasses: ["horizontal_press"],
      }),
      lane({
        laneId: "chest_secondary",
        role: "support",
        primaryMuscles: ["Chest"],
        acceptableExerciseClasses: ["horizontal_press", "fly"],
        duplicatePolicy: {
          scope: "same_slot",
          classDistinctness: "required_if_clean_alternative_exists",
          sameExerciseAllowedOnlyWithJustification: true,
        },
        cleanAlternativePolicy: {
          requiredBeforeDuplicate: true,
          evaluationTiming: "future_inventory_selection",
        },
      }),
    ]);

    const result = materialize({
      plan: chestPlan,
      inventory: [
        fixtureInventory[0],
        exercise({
          exerciseId: "fly",
          name: "Cable Fly",
          primaryMuscles: ["Chest"],
          movementPatterns: ["fly"],
          fatigueCost: 3,
        }),
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(result.slots[0]?.exercises.map((row) => row.exerciseId)).toEqual([
      "bench",
      "fly",
    ]);
  });

  it("varies calf isolation across lower slots when a clean alternate exists", () => {
    const calfLane = () =>
      lane({
        laneId: "calves",
        role: "accessory",
        primaryMuscles: ["Calves"],
        acceptableExerciseClasses: ["calf_isolation"],
        setBudget: { min: 3, preferred: 4, max: 4 },
        duplicatePolicy: {
          scope: "same_week",
          classDistinctness: "required_if_clean_alternative_exists",
          sameExerciseAllowedOnlyWithJustification: true,
        },
        cleanAlternativePolicy: {
          requiredBeforeDuplicate: false,
          evaluationTiming: "future_inventory_selection",
        },
        continuityPolicy: {
          preserve: "lane_class",
          exactIdentityPolicy: "not_planned_until_inventory_selection",
          crossWeekVariation: "variation_allowed_within_class",
        },
      });
    const result = materialize({
      plan: multiSlotPlan([
        { slotId: "lower_a", slotIndex: 0, lanes: [calfLane()] },
        { slotId: "lower_b", slotIndex: 1, lanes: [calfLane()] },
      ]),
      inventory: [
        exercise({
          exerciseId: "seated-calf-raise",
          name: "Seated Calf Raise",
          primaryMuscles: ["Calves"],
          movementPatterns: ["isolation"],
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "leg-press-calf-raise",
          name: "Leg Press Calf Raise",
          primaryMuscles: ["Calves"],
          movementPatterns: ["isolation"],
          fatigueCost: 2,
        }),
        exercise({
          exerciseId: "standing-calf-raise",
          name: "Standing Calf Raise",
          primaryMuscles: ["Calves"],
          movementPatterns: ["isolation"],
          fatigueCost: 2,
        }),
      ],
    });

    const selected = result.slots.flatMap((slot) => slot.exercises);

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "lower_a", "calves")).toMatchObject({
      exerciseId: "seated-calf-raise",
      setCount: 4,
    });
    expect(exerciseForLane(result, "lower_b", "calves")).toMatchObject({
      exerciseId: "leg-press-calf-raise",
      setCount: 4,
    });
    expect(new Set(selected.map((row) => row.exerciseId)).size).toBe(2);
    expect(selected.reduce((sum, row) => sum + row.setCount, 0)).toBeGreaterThanOrEqual(8);
    expect(selected.filter((row) => row.setCount >= 5)).toEqual([]);
  });

  it("keeps calf floor coverage by reusing the same calf exercise when no clean alternate exists", () => {
    const result = materialize({
      plan: multiSlotPlan([
        {
          slotId: "lower_a",
          slotIndex: 0,
          lanes: [
            lane({
              laneId: "calves",
              role: "accessory",
              primaryMuscles: ["Calves"],
              acceptableExerciseClasses: ["calf_isolation"],
              setBudget: { min: 3, preferred: 4, max: 4 },
              duplicatePolicy: {
                scope: "same_week",
                classDistinctness: "required_if_clean_alternative_exists",
                sameExerciseAllowedOnlyWithJustification: true,
              },
              cleanAlternativePolicy: {
                requiredBeforeDuplicate: false,
                evaluationTiming: "future_inventory_selection",
              },
            }),
          ],
        },
        {
          slotId: "lower_b",
          slotIndex: 1,
          lanes: [
            lane({
              laneId: "calves",
              role: "accessory",
              primaryMuscles: ["Calves"],
              acceptableExerciseClasses: ["calf_isolation"],
              setBudget: { min: 3, preferred: 4, max: 4 },
              duplicatePolicy: {
                scope: "same_week",
                classDistinctness: "required_if_clean_alternative_exists",
                sameExerciseAllowedOnlyWithJustification: true,
              },
              cleanAlternativePolicy: {
                requiredBeforeDuplicate: false,
                evaluationTiming: "future_inventory_selection",
              },
            }),
          ],
        },
      ]),
      inventory: [
        exercise({
          exerciseId: "seated-calf-raise",
          name: "Seated Calf Raise",
          primaryMuscles: ["Calves"],
          movementPatterns: ["isolation"],
          fatigueCost: 1,
        }),
      ],
    });

    const selected = result.slots.flatMap((slot) => slot.exercises);

    expect(result.blockers).toEqual([]);
    expect(selected.map((row) => row.exerciseId)).toEqual([
      "seated-calf-raise",
      "seated-calf-raise",
    ]);
    expect(selected.reduce((sum, row) => sum + row.setCount, 0)).toBeGreaterThanOrEqual(8);
  });

  it("varies direct lateral raises across upper slots when a clean alternate exists", () => {
    const lateralLane = () =>
      lane({
        laneId: "side_delt_isolation",
        role: "accessory",
        primaryMuscles: ["Side Delts"],
        acceptableExerciseClasses: ["lateral_raise", "low_collateral_side_delt"],
        setBudget: { min: 4, preferred: 4, max: 4 },
        directFloor: {
          muscle: "Side Delts",
          minDirectSets: 4,
          collateralCanSatisfy: false,
          requiredExerciseClasses: ["lateral_raise", "low_collateral_side_delt"],
        },
        duplicatePolicy: {
          scope: "same_week",
          classDistinctness: "required_if_clean_alternative_exists",
          sameExerciseAllowedOnlyWithJustification: true,
        },
        cleanAlternativePolicy: {
          requiredBeforeDuplicate: false,
          evaluationTiming: "future_inventory_selection",
        },
      });
    const result = materialize({
      plan: multiSlotPlan([
        { slotId: "upper_a", slotIndex: 0, lanes: [lateralLane()] },
        { slotId: "upper_b", slotIndex: 1, lanes: [lateralLane()] },
      ]),
      inventory: [
        exercise({
          exerciseId: "machine-lateral-raise",
          name: "Machine Lateral Raise",
          primaryMuscles: ["Side Delts"],
          movementPatterns: ["isolation"],
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "cable-lateral-raise",
          name: "Cable Lateral Raise",
          primaryMuscles: ["Side Delts"],
          movementPatterns: ["isolation"],
          fatigueCost: 2,
        }),
        exercise({
          exerciseId: "dumbbell-lateral-raise",
          name: "Dumbbell Lateral Raise",
          primaryMuscles: ["Side Delts"],
          movementPatterns: ["isolation"],
          fatigueCost: 2,
        }),
      ],
    });

    const selected = result.slots.flatMap((slot) => slot.exercises);

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "upper_a", "side_delt_isolation"))
      .toMatchObject({
        exerciseId: "machine-lateral-raise",
        setCount: 4,
      });
    expect(exerciseForLane(result, "upper_b", "side_delt_isolation"))
      .toMatchObject({
        exerciseId: "cable-lateral-raise",
        setCount: 4,
      });
    expect(new Set(selected.map((row) => row.exerciseId)).size).toBe(2);
    expect(selected.reduce((sum, row) => sum + row.setCount, 0)).toBeGreaterThanOrEqual(8);
    expect(selected.filter((row) => row.setCount >= 5)).toEqual([]);
  });

  it("prefers a distinct chest class family over same-press novelty", () => {
    const chestPlan = plan([
      lane({
        laneId: "chest_anchor",
        role: "anchor",
        primaryMuscles: ["Chest"],
        acceptableExerciseClasses: ["horizontal_press"],
      }),
      lane({
        laneId: "chest_second_exposure",
        role: "support",
        primaryMuscles: ["Chest"],
        acceptableExerciseClasses: ["horizontal_press", "fly"],
        duplicatePolicy: {
          scope: "same_slot",
          classDistinctness: "required_if_clean_alternative_exists",
          sameExerciseAllowedOnlyWithJustification: true,
        },
        cleanAlternativePolicy: {
          requiredBeforeDuplicate: true,
          evaluationTiming: "future_inventory_selection",
        },
      }),
    ]);

    const result = materialize({
      plan: chestPlan,
      inventory: [
        exercise({
          exerciseId: "machine-press",
          name: "Machine Chest Press",
          primaryMuscles: ["Chest"],
          movementPatterns: ["horizontal_press"],
          isCompound: true,
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "selectorized-press",
          name: "Selectorized Chest Press",
          primaryMuscles: ["Chest"],
          movementPatterns: ["horizontal_press"],
          isCompound: true,
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "fly",
          name: "Cable Fly",
          primaryMuscles: ["Chest"],
          movementPatterns: ["fly"],
          fatigueCost: 3,
        }),
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(result.slots[0]?.exercises.map((row) => row.exerciseId)).toEqual([
      "machine-press",
      "fly",
    ]);
  });

  it("prefers high-Chest press over Landmine Press for chest-biased support", () => {
    const chestPlan = plan([
      lane({
        laneId: "chest_anchor",
        role: "anchor",
        primaryMuscles: ["Chest"],
        acceptableExerciseClasses: ["horizontal_press", "slight_incline_press"],
        setBudget: { min: 3, preferred: 4, max: 4 },
      }),
      lane({
        laneId: "vertical_press",
        role: "support",
        primaryMuscles: ["Chest", "Front Delts"],
        acceptableExerciseClasses: [
          "distinct_chest_press_or_fly",
          "machine_press",
          "cable_press",
          "vertical_press",
        ],
        setBudget: { min: 2, preferred: 3, max: 3 },
      }),
      lane({
        laneId: "chest_second_exposure",
        role: "support",
        primaryMuscles: ["Chest"],
        acceptableExerciseClasses: [
          "distinct_chest_press_or_fly",
          "fly",
          "machine_press",
          "cable_press",
        ],
        setBudget: { min: 2, preferred: 3, max: 3 },
        duplicatePolicy: {
          scope: "same_slot",
          classDistinctness: "required_if_clean_alternative_exists",
          sameExerciseAllowedOnlyWithJustification: true,
        },
        cleanAlternativePolicy: {
          requiredBeforeDuplicate: true,
          evaluationTiming: "future_inventory_selection",
        },
      }),
    ]);
    const inventory = [
      exercise({
        exerciseId: "incline-machine-press",
        name: "Incline Machine Press",
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Front Delts", "Triceps"],
        movementPatterns: ["horizontal_press"],
        isCompound: true,
        fatigueCost: 2,
      }),
      exercise({
        exerciseId: "landmine-press",
        name: "Landmine Press",
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Front Delts", "Triceps"],
        movementPatterns: ["vertical_press"],
        stimulusByMusclePerSet: {
          Chest: 0.35,
          "Front Delts": 1,
          Triceps: 0.35,
        },
        isCompound: true,
        fatigueCost: 2,
      }),
      exercise({
        exerciseId: "machine-chest-press",
        name: "Machine Chest Press",
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Front Delts", "Triceps"],
        movementPatterns: ["horizontal_press"],
        stimulusByMusclePerSet: {
          Chest: 1,
          "Front Delts": 0.3,
          Triceps: 0.45,
        },
        isCompound: true,
        fatigueCost: 2,
      }),
      exercise({
        exerciseId: "cable-fly",
        name: "Cable Fly",
        primaryMuscles: ["Chest"],
        movementPatterns: ["fly"],
        stimulusByMusclePerSet: { Chest: 1 },
        fatigueCost: 2,
      }),
    ];

    const result = materialize({ plan: chestPlan, inventory });
    const seedRows = result.slots.flatMap((slot) => slot.exercises);
    const chestSets = weightedChestSets({ result, inventory });

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "upper_a", "vertical_press")).toMatchObject({
      exerciseId: "machine-chest-press",
      setCount: 3,
    });
    expect(exerciseForLane(result, "upper_a", "chest_second_exposure"))
      .toMatchObject({
        exerciseId: "cable-fly",
        setCount: 3,
      });
    expect(chestSets).toBeGreaterThanOrEqual(VOLUME_LANDMARKS.Chest.mev);
    expect(chestSets).toBeLessThanOrEqual(VOLUME_LANDMARKS.Chest.mav);
    expect(Math.max(...seedRows.map((row) => row.setCount))).toBeLessThanOrEqual(4);
    expect(seedRows).toHaveLength(3);
  });

  it("blocks Landmine Press as a low-Chest-stimulus chest anchor", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "chest_anchor",
          role: "anchor",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["horizontal_press", "vertical_press"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "landmine-press",
          name: "Landmine Press",
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Front Delts", "Triceps"],
          movementPatterns: ["vertical_press"],
          stimulusByMusclePerSet: {
            Chest: 0.35,
            "Front Delts": 1,
            Triceps: 0.35,
          },
          isCompound: true,
          fatigueCost: 2,
        }),
      ],
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "chest_anchor",
        reason: "no_class_match",
      },
    ]);
  });

  it("materializer consumes laneSelectionIntent for chest_biased_press_support", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "vertical_press",
          role: "support",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: [
            "vertical_press",
            "distinct_chest_press_or_fly",
          ],
          laneSelectionIntent: chestBiasedPressSupportIntent,
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "landmine-press",
          name: "Landmine Press",
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Front Delts", "Triceps"],
          movementPatterns: ["vertical_press"],
          stimulusByMusclePerSet: {
            Chest: 0.35,
            "Front Delts": 1,
            Triceps: 0.35,
          },
          isCompound: true,
          fatigueCost: 2,
        }),
        exercise({
          exerciseId: "machine-chest-press",
          name: "Machine Chest Press",
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Front Delts", "Triceps"],
          movementPatterns: ["horizontal_press"],
          stimulusByMusclePerSet: {
            Chest: 1,
            "Front Delts": 0.3,
            Triceps: 0.45,
          },
          isCompound: true,
          equipment: ["machine"],
          fatigueCost: 2,
        }),
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "upper_a", "vertical_press")).toMatchObject({
      exerciseId: "machine-chest-press",
      role: "ACCESSORY",
    });
  });

  it("chest_biased_press_support rejects low-chest Landmine Press without a true chest press", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "vertical_press",
          role: "support",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: [
            "vertical_press",
            "distinct_chest_press_or_fly",
          ],
          laneSelectionIntent: chestBiasedPressSupportIntent,
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "landmine-press",
          name: "Landmine Press",
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Front Delts", "Triceps"],
          movementPatterns: ["vertical_press"],
          stimulusByMusclePerSet: {
            Chest: 0.35,
            "Front Delts": 1,
            Triceps: 0.35,
          },
          isCompound: true,
          fatigueCost: 2,
        }),
      ],
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "vertical_press",
        reason: "no_class_match",
      },
    ]);
  });

  it("chest_biased_press_support selects high-chest stable press variants", () => {
    for (const [exerciseId, name] of [
      ["machine-chest-press", "Machine Chest Press"],
      ["iso-incline-press", "Iso-Lateral Incline Press"],
      ["iso-decline-press", "Iso-Lateral Decline Press"],
    ] as const) {
      const result = materialize({
        plan: plan([
          lane({
            laneId: "vertical_press",
            role: "support",
            primaryMuscles: ["Chest"],
            acceptableExerciseClasses: ["distinct_chest_press_or_fly"],
            laneSelectionIntent: chestBiasedPressSupportIntent,
          }),
        ]),
        inventory: [
          exercise({
            exerciseId,
            name,
            primaryMuscles: ["Chest"],
            secondaryMuscles: ["Front Delts", "Triceps"],
            movementPatterns: ["horizontal_press"],
            stimulusByMusclePerSet: {
              Chest: 1,
              "Front Delts": 0.3,
              Triceps: 0.45,
            },
            isCompound: true,
            equipment: ["machine"],
            fatigueCost: 2,
          }),
        ],
      });

      expect(result.blockers).toEqual([]);
      expect(exerciseForLane(result, "upper_a", "vertical_press").exerciseId)
        .toBe(exerciseId);
    }
  });

  it("keeps Landmine Press available for non-chest-biased vertical press lanes", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "vertical_press",
          role: "support",
          primaryMuscles: ["Front Delts"],
          acceptableExerciseClasses: ["vertical_press"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "landmine-press",
          name: "Landmine Press",
          primaryMuscles: ["Chest"],
          secondaryMuscles: ["Front Delts", "Triceps"],
          movementPatterns: ["vertical_press"],
          stimulusByMusclePerSet: {
            Chest: 0.35,
            "Front Delts": 1,
            Triceps: 0.35,
          },
          isCompound: true,
          fatigueCost: 2,
        }),
      ],
    });

    expect(result.blockers).toEqual([]);
    expect(exerciseForLane(result, "upper_a", "vertical_press")).toMatchObject({
      exerciseId: "landmine-press",
      role: "ACCESSORY",
    });
  });

  it("omits managed collateral lanes even when a class match exists", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "vertical_press",
          requirement: "optional",
          role: "optional",
          classLaneKind: "managed_collateral_marker",
          primaryMuscles: [],
          managedCollateralMuscles: ["Front Delts"],
          ownershipKinds: ["managed_collateral"],
          acceptableExerciseClasses: ["vertical_press"],
          setBudget: { min: 0, preferred: 0, max: 0 },
          setBudgetBasis: "managed_collateral_budget",
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "shoulder-press",
          name: "Machine Shoulder Press",
          aliases: ["OHP"],
          primaryMuscles: ["Front Delts", "Side Delts"],
          movementPatterns: ["vertical_press"],
          isCompound: true,
        }),
      ],
    });

    expect(result.status).toBe("materialized");
    expect(result.slots[0]?.exercises).toEqual([]);
    expect(result.omissions).toEqual([
      {
        slotId: "upper_a",
        laneId: "vertical_press",
        reason: "optional_not_activated",
      },
    ]);
  });

  it("blocks a strict duplicate when clean alternative policy requires one", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "chest_anchor",
          role: "anchor",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["horizontal_press"],
        }),
        lane({
          laneId: "chest_secondary",
          role: "support",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["horizontal_press"],
          duplicatePolicy: {
            scope: "same_slot",
            classDistinctness: "required_if_clean_alternative_exists",
            sameExerciseAllowedOnlyWithJustification: true,
          },
          cleanAlternativePolicy: {
            requiredBeforeDuplicate: true,
            evaluationTiming: "future_inventory_selection",
          },
        }),
      ]),
      inventory: [fixtureInventory[0]],
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "chest_secondary",
        reason: "duplicate_requires_clean_alternative",
      },
    ]);
  });

  it("blocks when slot capacity is exhausted", () => {
    const result = materialize({
      plan: plan(
        [
          lane({
            laneId: "chest_anchor",
            role: "anchor",
            primaryMuscles: ["Chest"],
            acceptableExerciseClasses: ["horizontal_press"],
          }),
          lane({
            laneId: "row_anchor",
            role: "anchor",
            primaryMuscles: ["Upper Back", "Lats"],
            acceptableExerciseClasses: ["horizontal_pull_support"],
          }),
        ],
        1,
      ),
      inventory: fixtureInventory,
    });

    expect(result.blockers).toEqual([
      {
        slotId: "upper_a",
        laneId: "row_anchor",
        reason: "capacity_exhausted",
      },
    ]);
  });

  it("still drops budgeted support-floor optional lanes under an explicit stronger slot cap", () => {
    const policy = buildV2PlannerMesocyclePolicy();
    const explicitCapPlan: V2ExerciseSelectionPlan = {
      ...policy.exerciseSelectionPlan,
      weeks: policy.exerciseSelectionPlan.weeks.map((week) => ({
        ...week,
        slots: week.slots.map((slotRow) => ({
          ...slotRow,
          maxExerciseCount:
            slotRow.slotId === "upper_b" ? 6 : slotRow.maxExerciseCount,
          lanes: slotRow.lanes.map((laneRow) => ({ ...laneRow })),
        })),
      })),
    };

    const result = materialize({
      plan: explicitCapPlan,
      inventory: representativeV2Inventory,
    });

    expect(result.status).toBe("materialized");
    expect(result.blockers).toEqual([]);
    expect(
      result.slots.find((slotRow) => slotRow.slotId === "upper_b")?.exercises,
    ).toHaveLength(6);
    expect(
      result.omissions.find(
        (row) =>
          row.slotId === "upper_b" &&
          row.laneId === "optional_triceps_if_under_target",
      ),
    ).toMatchObject({
      reason: "optional_capacity_exhausted",
    });
  });

  it("produces exactly equal output on repeated calls", () => {
    const input = {
      plan: plan([
        lane({
          laneId: "biceps",
          role: "accessory",
          primaryMuscles: ["Biceps"],
          acceptableExerciseClasses: ["biceps_isolation"],
        }),
      ]),
      inventory: [...fixtureInventory].reverse(),
    };

    expect(materialize(input)).toEqual(materialize(input));
  });

  it("keeps favorite barbell bench behind a stronger fresh chest-anchor candidate", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "chest_anchor",
          role: "anchor",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["horizontal_press"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "barbell-bench",
          name: "Barbell Bench Press",
          primaryMuscles: ["Chest"],
          movementPatterns: ["horizontal_press"],
          stimulusByMusclePerSet: { Chest: 1 },
          isCompound: true,
          isMainLiftEligible: true,
          fatigueCost: 5,
        }),
        exercise({
          exerciseId: "machine-chest-press",
          name: "Machine Chest Press",
          primaryMuscles: ["Chest"],
          movementPatterns: ["horizontal_press"],
          stimulusByMusclePerSet: { Chest: 1 },
          isCompound: true,
          fatigueCost: 1,
        }),
      ],
      favoriteExerciseIds: ["barbell-bench"],
    });

    expect(exerciseForLane(result, "upper_a", "chest_anchor").exerciseId)
      .toBe("machine-chest-press");
  });

  it("keeps favorite back squat behind a lower-fatigue quad-biased anchor", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "squat_anchor",
          role: "anchor",
          primaryMuscles: ["Quads"],
          acceptableExerciseClasses: ["squat_pattern"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "barbell-back-squat",
          name: "Barbell Back Squat",
          primaryMuscles: ["Quads", "Glutes"],
          movementPatterns: ["squat"],
          stimulusByMusclePerSet: { Quads: 0.9, "Lower Back": 0.6 },
          isCompound: true,
          isMainLiftEligible: true,
          fatigueCost: 5,
        }),
        exercise({
          exerciseId: "hack-squat",
          name: "Hack Squat",
          primaryMuscles: ["Quads"],
          movementPatterns: ["squat"],
          stimulusByMusclePerSet: { Quads: 1 },
          isCompound: true,
          fatigueCost: 1,
        }),
      ],
      favoriteExerciseIds: ["barbell-back-squat"],
    });

    expect(exerciseForLane(result, "upper_a", "squat_anchor").exerciseId)
      .toBe("hack-squat");
  });

  it("keeps favorite conventional deadlift behind a hamstring-biased hypertrophy hinge", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "hinge_anchor",
          role: "anchor",
          primaryMuscles: ["Hamstrings", "Glutes"],
          acceptableExerciseClasses: ["hinge_compound"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "conventional-deadlift",
          name: "Conventional Deadlift",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: {
            Hamstrings: 0.75,
            Glutes: 0.75,
            "Lower Back": 0.9,
          },
          isCompound: true,
          isMainLiftEligible: true,
          fatigueCost: 5,
        }),
        exercise({
          exerciseId: "romanian-deadlift",
          name: "Romanian Deadlift",
          primaryMuscles: ["Hamstrings", "Glutes"],
          movementPatterns: ["hinge"],
          stimulusByMusclePerSet: {
            Hamstrings: 1,
            Glutes: 0.8,
            "Lower Back": 0.25,
          },
          isCompound: true,
          isMainLiftEligible: true,
          fatigueCost: 2,
        }),
      ],
      favoriteExerciseIds: ["conventional-deadlift"],
    });

    expect(exerciseForLane(result, "upper_a", "hinge_anchor").exerciseId)
      .toBe("romanian-deadlift");
  });

  it("lets favorites win only among otherwise equivalent candidates", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "biceps",
          role: "accessory",
          primaryMuscles: ["Biceps"],
          acceptableExerciseClasses: ["biceps_isolation"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "alpha-curl",
          name: "Alpha Cable Curl",
          primaryMuscles: ["Biceps"],
          stimulusByMusclePerSet: { Biceps: 1 },
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "zeta-curl",
          name: "Zeta Cable Curl",
          primaryMuscles: ["Biceps"],
          stimulusByMusclePerSet: { Biceps: 1 },
          fatigueCost: 1,
        }),
      ],
      favoriteExerciseIds: ["zeta-curl"],
    });

    expect(exerciseForLane(result, "upper_a", "biceps").exerciseId)
      .toBe("zeta-curl");
  });

  it("uses name and id as the deterministic fallback after intent scoring ties", () => {
    const input = {
      plan: plan([
        lane({
          laneId: "biceps",
          role: "accessory",
          primaryMuscles: ["Biceps"],
          acceptableExerciseClasses: ["biceps_isolation"],
        }),
      ]),
      inventory: [
        exercise({
          exerciseId: "zeta-curl",
          name: "Zeta Cable Curl",
          primaryMuscles: ["Biceps"],
          stimulusByMusclePerSet: { Biceps: 1 },
          fatigueCost: 1,
        }),
        exercise({
          exerciseId: "alpha-curl",
          name: "Alpha Cable Curl",
          primaryMuscles: ["Biceps"],
          stimulusByMusclePerSet: { Biceps: 1 },
          fatigueCost: 1,
        }),
      ],
    };

    expect(exerciseForLane(materialize(input), "upper_a", "biceps").exerciseId)
      .toBe("alpha-curl");
    expect(materialize(input)).toEqual(materialize(input));
  });

  it("does not let carry-forward continuity beat fresh lane intent unless explicitly opted in", () => {
    const continuityPlan = plan([
      lane({
        laneId: "chest_anchor",
        role: "anchor",
        primaryMuscles: ["Chest"],
        acceptableExerciseClasses: ["horizontal_press"],
      }),
    ]);
    const inventory = [
      exercise({
        exerciseId: "barbell-bench",
        name: "Barbell Bench Press",
        primaryMuscles: ["Chest"],
        movementPatterns: ["horizontal_press"],
        stimulusByMusclePerSet: { Chest: 1 },
        isCompound: true,
        isMainLiftEligible: true,
        fatigueCost: 5,
      }),
      exercise({
        exerciseId: "machine-chest-press",
        name: "Machine Chest Press",
        primaryMuscles: ["Chest"],
        movementPatterns: ["horizontal_press"],
        stimulusByMusclePerSet: { Chest: 1 },
        isCompound: true,
        fatigueCost: 1,
      }),
    ];

    const fresh = materialize({
      plan: continuityPlan,
      inventory,
      continuity: {
        carryForwardExerciseIdsByLane: {
          "upper_a:chest_anchor": ["barbell-bench"],
        },
      },
    });
    const preserveIdentity = materialize({
      plan: continuityPlan,
      inventory,
      continuity: {
        identityPreservationMode: "preserve_exact_lane_identity",
        carryForwardExerciseIdsByLane: {
          "upper_a:chest_anchor": ["barbell-bench"],
        },
      },
    });

    expect(exerciseForLane(fresh, "upper_a", "chest_anchor").exerciseId)
      .toBe("machine-chest-press");
    expect(
      exerciseForLane(preserveIdentity, "upper_a", "chest_anchor").exerciseId,
    ).toBe("barbell-bench");
  });

  it("dry-run materializes the full required V2 representative skeleton", () => {
    const policy = buildV2PlannerMesocyclePolicy();
    const input = {
      plan: policy.exerciseSelectionPlan,
      inventory: representativeV2Inventory,
    };

    const result = materialize(input);
    const requiredLaneIds = representativeRequiredLaneIds(
      policy.exerciseSelectionPlan,
    );
    const materializedLaneIds = result.slots
      .flatMap((slot) =>
        slot.exercises.flatMap((row) =>
          row.laneIds.map((laneId) => `${slot.slotId}:${laneId}`),
        ),
      )
      .sort();

    expect(result.dryRunOnly).toBe(true);
    expect(result.status).toBe("materialized");
    expect(result.blockers).toEqual([]);
    expect(materializedLaneIds).toEqual(
      [...requiredLaneIds, "upper_b:optional_triceps_if_under_target"].sort(),
    );
    expect(exerciseForLane(result, "upper_a", "chest_anchor")).toMatchObject({
      exerciseId: "machine-chest-press",
      setCount: 4,
    });
    expect(exerciseForLane(result, "upper_b", "chest_second_exposure"))
      .toMatchObject({
        exerciseId: "cable-fly",
        setCount: 3,
      });
    expect(exerciseForLane(result, "upper_a", "row_anchor")).toMatchObject({
      exerciseId: "chest-supported-row",
      setCount: 3,
    });
    expect(exerciseForLane(result, "upper_b", "vertical_pull_anchor"))
      .toMatchObject({
        exerciseId: "assisted-pull-up",
        setCount: 3,
      });
    expect(exerciseForLane(result, "upper_b", "row_support")).toMatchObject({
      exerciseId: "cable-row",
      setCount: 3,
    });
    expect(exerciseForLane(result, "upper_b", "side_delt_isolation"))
      .toMatchObject({
        exerciseId: "cable-lateral-raise",
        setCount: 4,
      });
    expect(exerciseForLane(result, "upper_a", "side_delt_isolation"))
      .toMatchObject({
        exerciseId: "cable-lateral-raise",
        setCount: 4,
      });
    expect(exerciseForLane(result, "upper_b", "vertical_press"))
      .toMatchObject({
        exerciseId: "incline-machine-press",
        setCount: 3,
      });
    expect(exerciseForLane(result, "upper_b", "optional_triceps_if_under_target"))
      .toMatchObject({
        exerciseId: "rope-pressdown",
        setCount: 2,
      });
    expect(
      result.slots.find((slotRow) => slotRow.slotId === "upper_b")?.exercises,
    ).toHaveLength(7);
    expect(exerciseForLane(result, "upper_a", "rear_delt")).toMatchObject({
      exerciseId: "rear-delt-fly",
      setCount: 4,
    });
    expect(exerciseForLane(result, "lower_b", "hinge_anchor")).toMatchObject({
      exerciseId: "romanian-deadlift",
      setCount: 3,
    });
    expect(exerciseForLane(result, "lower_b", "knee_flexion_curl"))
      .toMatchObject({
        exerciseId: "lying-leg-curl",
        setCount: 3,
      });
    expect(exerciseForLane(result, "lower_b", "quad_support"))
      .toMatchObject({
        exerciseId: "leg-press",
        setCount: 3,
      });
    expect(exerciseForLane(result, "lower_a", "calves")).toMatchObject({
      exerciseId: "standing-calf-raise",
      setCount: 4,
    });
    expect(exerciseForLane(result, "lower_b", "calves")).toMatchObject({
      exerciseId: "standing-calf-raise",
      setCount: 4,
    });
    expect(
      ["upper_a", "upper_b"].reduce(
        (sum, slotId) =>
          sum +
          result.slots
            .find((slotRow) => slotRow.slotId === slotId)!
            .exercises.filter((exerciseRow) =>
              ["chest_anchor", "chest_second_exposure", "vertical_press"]
                .some((laneId) => exerciseRow.laneIds.includes(laneId)),
            )
            .reduce((slotSum, exerciseRow) => slotSum + exerciseRow.setCount, 0),
        0,
      ),
    ).toBeGreaterThanOrEqual(10);
    expect(
      ["lower_a", "lower_b"].reduce(
        (sum, slotId) =>
          sum +
          exerciseForLane(result, slotId, "calves").setCount,
        0,
      ),
    ).toBeGreaterThanOrEqual(8);
    expect(
      result.slots.flatMap((slotRow) =>
        slotRow.exercises.filter((exerciseRow) => exerciseRow.setCount >= 5),
      ),
    ).toEqual([]);
    expect(
      result.omissions.find(
        (row) =>
          row.slotId === "lower_a" &&
          row.laneId === "secondary_hinge" &&
          row.reason === "optional_not_activated",
      ),
    ).toBeDefined();
    expect(
      result.omissions.find(
        (row) =>
          row.slotId === "lower_b" &&
          row.laneId === "optional_glute_core_if_recoverable",
      ),
    ).toBeDefined();
    expect(result).toEqual(materialize(input));
  });

  it("keeps exercise output seed-shaped", () => {
    const result = materialize({
      plan: plan([
        lane({
          laneId: "biceps",
          role: "accessory",
          primaryMuscles: ["Biceps"],
          acceptableExerciseClasses: ["biceps_isolation"],
        }),
      ]),
      inventory: fixtureInventory,
    });

    expect(Object.keys(result.slots[0]?.exercises[0] ?? {}).sort()).toEqual([
      "exerciseId",
      "laneIds",
      "role",
      "setCount",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /name|exerciseName|planningReality|slotPlanSeedJson|laneSelectionIntent/,
    );
  });

  it("reports dry-run materialization readiness as read-only diagnostic evidence", () => {
    const policy = buildV2PlannerMesocyclePolicy();
    const report = buildV2MaterializationDryRunReport({
      plannerPolicy: policy,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: representativeV2Inventory,
      slotIntentById: {
        upper_a: "UPPER",
        lower_a: "LOWER",
        upper_b: "UPPER",
        lower_b: "LOWER",
      },
    });

    expect(report).toMatchObject({
      version: 1,
      source: "v2_exercise_materialization",
      readOnly: true,
      affectsScoringOrGeneration: false,
      dryRunOnly: true,
      status: "materialized",
      plannerPolicyAvailable: true,
      exerciseSelectionPlanAvailable: true,
      taxonomyAvailable: true,
      inventoryAvailable: true,
      materializer: {
        status: "materialized",
        blockerCount: 0,
      },
      readiness: {
        safeToPromoteToProductionWrite: false,
      },
    });
    expect(report.seedShapeCompatibility.compatible).toBe(true);
    expect(report.executableSeedPreview.length).toBe(4);
    expect(report.readiness.missingBeforePromotion).toEqual(
      expect.arrayContaining([
        "live_inventory_wiring",
        "production_acceptance_write_path",
        "slotPlanSeedJson_write_gate",
        "runtime_replay_consumption",
      ]),
    );
  });

  it("does not produce a compatible seed preview for blocked materializer output", () => {
    const report = buildV2MaterializationDryRunReport({
      exerciseSelectionPlan: plan([
        lane({
          laneId: "row_anchor",
          role: "anchor",
          primaryMuscles: ["Upper Back", "Lats"],
          acceptableExerciseClasses: ["horizontal_pull_support"],
        }),
      ]),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: [fixtureInventory[0]],
    });

    expect(report.status).toBe("blocked");
    expect(report.materializer).toMatchObject({
      status: "blocked",
      blockerCount: 1,
    });
    expect(report.seedShapeCompatibility.compatible).toBe(false);
    expect(report.executableSeedPreview).toEqual([]);
    expect(report.blockers).toContainEqual({
      slotId: "upper_a",
      laneId: "row_anchor",
      reason: "no_class_match",
    });
  });

  it("strips and labels non-executable materializer metadata before previewing seed shape", () => {
    const report = buildV2MaterializationDryRunReport({
      exerciseSelectionPlan: plan([
        lane({
          laneId: "chest_anchor",
          role: "anchor",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["horizontal_press"],
          setBudget: { min: 3, preferred: 4, max: 4 },
        }),
      ]),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: fixtureInventory,
    });
    const serializedPreview = JSON.stringify(report.executableSeedPreview);

    expect(report.strippedMaterializerFields).toEqual([
      "laneIds",
      "dryRunOnly",
      "status",
      "blockers",
      "omissions",
      "source",
      "version",
    ]);
    expect(serializedPreview).not.toMatch(
      /laneIds|blockers|omissions|dryRunOnly|status|v2_exercise_materialization/,
    );
    expect(report.executableSeedPreview[0]?.exercises[0]).toEqual({
      exerciseId: "bench",
      name: "Machine Chest Press",
      role: "CORE_COMPOUND",
      setCount: 4,
    });
    expect(report.candidateIdentitySummary).toEqual({
      available: true,
      rowCount: 1,
      detailLevel: "selected_identity",
      rankingDetailAvailability: {
        topAlternatives: "not_available",
        scoreTuple: "not_available",
        selectedReason: "not_available",
        reason: "materializer_does_not_emit_candidate_ranking",
      },
      rows: [
        {
          slotId: "upper_a",
          laneId: "chest_anchor",
          laneRole: "anchor",
          seedRole: "CORE_COMPOUND",
          selectedExercise: {
            exerciseId: "bench",
            name: "Machine Chest Press",
          },
          setCount: 4,
          topAlternatives: [],
        },
      ],
    });
  });

  it("surfaces duplicate exercise IDs within a slot as promotion blockers", () => {
    const report = buildV2MaterializationDryRunReport({
      exerciseSelectionPlan: plan([]),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: fixtureInventory,
      materializedPlan: makeMaterializedPlan({
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              {
                exerciseId: "bench",
                role: "CORE_COMPOUND",
                setCount: 4,
                laneIds: ["chest_anchor"],
              },
              {
                exerciseId: "bench",
                role: "ACCESSORY",
                setCount: 3,
                laneIds: ["secondary_chest"],
              },
            ],
          },
        ],
      }),
    });

    expect(report.status).toBe("partial");
    expect(report.seedShapeCompatibility).toMatchObject({
      compatible: false,
      duplicateExerciseIdWithinSlotCount: 1,
    });
    expect(report.blockers).toContainEqual({
      slotId: "upper_a",
      laneId: "secondary_chest",
      reason: "duplicate_exercise_id_within_slot",
    });
    expect(report.readiness.missingBeforePromotion).toContain(
      "seed_shape_compatibility",
    );
  });

  it("reports missing taxonomy classes as blockers or omissions without repair", () => {
    const taxonomyWithoutAliases: V2ExerciseClassTaxonomy = {
      ...DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      classAliases: {},
    };
    const report = buildV2MaterializationDryRunReport({
      exerciseSelectionPlan: plan([
        lane({
          laneId: "required_unknown",
          role: "anchor",
          primaryMuscles: ["Chest"],
          acceptableExerciseClasses: ["unknown_required_class"],
        }),
        lane({
          laneId: "optional_unknown",
          requirement: "optional",
          role: "optional",
          primaryMuscles: ["Biceps"],
          acceptableExerciseClasses: ["unknown_optional_class"],
        }),
      ]),
      taxonomy: taxonomyWithoutAliases,
      inventory: fixtureInventory,
    });

    expect(report.seedShapeCompatibility.unsupportedClassCount).toBe(2);
    expect(report.blockers).toContainEqual({
      slotId: "upper_a",
      laneId: "required_unknown",
      reason: "unsupported_exercise_class",
    });
    expect(report.omissions).toContainEqual({
      slotId: "upper_a",
      laneId: "optional_unknown",
      reason: "optional_unsupported_exercise_class",
    });
    expect(report.executableSeedPreview).toEqual([]);
  });

  it("keeps executable seed preview limited to seed-relevant fields", () => {
    const report = buildV2MaterializationDryRunReport({
      exerciseSelectionPlan: plan([]),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: fixtureInventory,
      materializedPlan: makeMaterializedPlan(),
      slotIntentById: { upper_a: "UPPER" },
    });
    const serializedPreview = JSON.stringify(report.executableSeedPreview);

    expect(report.seedShapeCompatibility.compatible).toBe(true);
    expect(report.executableSeedPreview).toEqual([
      {
        slotId: "upper_a",
        intent: "UPPER",
        exercises: [
          {
            exerciseId: "bench",
            name: "Machine Chest Press",
            role: "CORE_COMPOUND",
            setCount: 4,
          },
          {
            exerciseId: "row",
            name: "Chest Supported Row",
            role: "ACCESSORY",
            setCount: 3,
          },
        ],
      },
    ]);
    expect(serializedPreview).not.toMatch(
      /laneIds|blockers|omissions|dryRunOnly|status/,
    );
    expect(report.candidateIdentitySummary.rows.map((row) => row.laneId)).toEqual([
      "chest_anchor",
      "row_anchor",
    ]);
    expect(report.candidateIdentitySummary.rows.map((row) => row.setCount)).toEqual([
      4,
      3,
    ]);
  });

  it("builds a compact live-context dry-run harness result from normalized inventory", () => {
    const result = buildV2LiveContextMaterializationDryRunHarness({
      ownerContext: { userId: "user-1", ownerEmail: "owner@test.local" },
      mesocycleContext: {
        id: "meso-1",
        state: "ACTIVE_ACCUMULATION",
        splitType: "UPPER_LOWER",
        slotSequenceJson: {
          version: 1,
          source: "handoff_draft",
          sequenceMode: "ordered_flexible",
          slots: [
            { slotId: "upper_a", intent: "UPPER" },
            { slotId: "lower_a", intent: "LOWER" },
            { slotId: "upper_b", intent: "UPPER" },
            { slotId: "lower_b", intent: "LOWER" },
          ],
        },
      },
      inventory: representativeV2Inventory,
      inventorySource: "live_normalized_inventory",
    });

    expect(result).toMatchObject({
      version: 1,
      source: "v2_live_context_materialization_dry_run",
      readOnly: true,
      affectsScoringOrGeneration: false,
      dryRunOnly: true,
      context: {
        ownerLoaded: true,
        mesocycleLoaded: true,
        userId: "user-1",
        ownerEmail: "owner@test.local",
        mesocycleId: "meso-1",
        slotSequenceSource: "mesocycle_slot_sequence",
        slotSequenceSlotCount: 4,
      },
      inventorySource: "live_normalized_inventory",
      inventoryExerciseCount: representativeV2Inventory.length,
      materializerStatus: "materialized",
      safeToPromoteToProductionWrite: false,
    });
    expect(result.unsupportedClassCount).toBeGreaterThan(0);
    expect(result.seedShapeCompatibility.compatible).toBe(true);
    expect(result.executablePreviewCountBySlot).toEqual([
      { slotId: "upper_a", exerciseCount: 6 },
      { slotId: "lower_a", exerciseCount: 4 },
      { slotId: "upper_b", exerciseCount: 7 },
      { slotId: "lower_b", exerciseCount: 4 },
    ]);
    expect(result.requiredLaneCoverageBySlot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: "upper_a",
          requiredLaneCount: 6,
          materializedRequiredLaneCount: 6,
          blockedRequiredLaneCount: 0,
          missingRequiredLaneIds: [],
        }),
      ]),
    );
    expect(result.blockersBeforePromotion).toEqual(
      expect.arrayContaining([
        "production_acceptance_write_path",
        "slotPlanSeedJson_write_gate",
        "runtime_replay_consumption",
      ]),
    );
  });

  it("normalizes live exercise rows into materializer inventory without seed fields", () => {
    const inventory = normalizeLiveInventoryForV2Materialization([
      {
        id: "machine-chest-press",
        name: "Machine Chest Press",
        aliases: [{ alias: "Selectorized Chest Press" }],
        movementPatterns: ["HORIZONTAL_PRESS"],
        isCompound: true,
        isMainLiftEligible: false,
        fatigueCost: 2,
        exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Chest" } },
          { role: "SECONDARY", muscle: { name: "Triceps" } },
        ],
      },
    ]);

    expect(inventory).toEqual([
      expect.objectContaining({
        exerciseId: "machine-chest-press",
        name: "Machine Chest Press",
        aliases: ["Selectorized Chest Press"],
        movementPatterns: ["horizontal_press"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
        equipment: ["machine"],
        isCompound: true,
        isMainLiftEligible: false,
        fatigueCost: 2,
      }),
    ]);
    expect(inventory[0]?.stimulusByMusclePerSet).toMatchObject({
      Chest: 1,
      Triceps: 0.45,
    });
    expect(JSON.stringify(inventory)).not.toMatch(
      /slotPlanSeedJson|laneIds|dryRunOnly|sessionDecisionReceipt/,
    );
  });

  it("surfaces missing live inventory as a blocker instead of fixture fallback", () => {
    const result = buildV2LiveContextMaterializationDryRunHarness({
      ownerContext: { userId: "user-1", ownerEmail: "owner@test.local" },
      mesocycleContext: { id: "meso-1", state: "ACTIVE_ACCUMULATION" },
      inventory: null,
      inventorySource: "unavailable",
    });

    expect(result.inventorySource).toBe("unavailable");
    expect(result.inventoryExerciseCount).toBe(0);
    expect(result.materializerStatus).toBe("blocked");
    expect(result.seedShapeCompatibility.compatible).toBe(false);
    expect(result.blockersBeforePromotion).toEqual(
      expect.arrayContaining([
        "inventory_source_unavailable",
        "inventory_unavailable",
        "inventory_bridge_or_snapshot",
      ]),
    );
    expect(result.executablePreviewCountBySlot).toEqual([]);
    expect(result.safeToPromoteToProductionWrite).toBe(false);
  });

  it("surfaces unsupported taxonomy classes as blockers and omissions in the harness", () => {
    const result = buildV2LiveContextMaterializationDryRunHarness({
      ownerContext: { userId: "user-1" },
      mesocycleContext: { id: "meso-1" },
      inventory: fixtureInventory,
      inventorySource: "live_normalized_inventory",
      plannerPolicy: {
        ...buildV2PlannerMesocyclePolicy(),
        exerciseSelectionPlan: plan([
          lane({
            laneId: "required_unknown",
            role: "anchor",
            primaryMuscles: ["Chest"],
            acceptableExerciseClasses: ["unknown_required_class"],
          }),
          lane({
            laneId: "optional_unknown",
            requirement: "optional",
            role: "optional",
            primaryMuscles: ["Biceps"],
            acceptableExerciseClasses: ["unknown_optional_class"],
          }),
        ]),
      },
      taxonomy: {
        ...DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
        classAliases: {},
      },
    });

    expect(result.unsupportedClassCount).toBe(2);
    expect(result.seedShapeCompatibility.compatible).toBe(false);
    expect(result.requiredLaneCoverageBySlot).toEqual([
      {
        slotId: "upper_a",
        requiredLaneCount: 1,
        materializedRequiredLaneCount: 0,
        blockedRequiredLaneCount: 1,
        missingRequiredLaneIds: ["required_unknown"],
      },
    ]);
    expect(result.blockersBeforePromotion).toEqual(
      expect.arrayContaining([
        "upper_a:required_unknown:unsupported_exercise_class",
        "seed_shape_compatibility",
      ]),
    );
  });

  it("keeps a materialized seed-compatible dry run blocked until production write gates are explicit", () => {
    const report = buildV2MaterializationDryRunReport({
      plannerPolicy: plannerPolicyWithEmptySelectionPlan(),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: fixtureInventory,
      materializedPlan: makeMaterializedPlan(),
    });
    const readiness = buildV2MaterializationPromotionReadiness({
      dryRunReport: report,
      requiredLaneCoverageBySlot: fullRequiredLaneCoverage,
      expectedSlotCount: 1,
    });

    expect(readiness).toMatchObject({
      version: 1,
      source: "v2_materialization_promotion_readiness",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "not_ready",
      safeToPromoteToProductionWrite: false,
      requiredMaterialization: {
        status: "passed",
        requiredLaneCoveragePassed: true,
        materializerStatus: "materialized",
        requiredBlockerCount: 0,
      },
      seedShape: {
        compatible: true,
        slotCountMatches: true,
        noDuplicateExerciseIdsWithinSlot: true,
        rolesValid: true,
        setCountsValid: true,
        namesAvailable: true,
      },
      productionWriteGates: {
        acceptancePathDesigned: false,
        slotPlanSeedJsonWriteGateDesigned: false,
        receiptContractDesigned: false,
        runtimeReplayContractVerified: false,
        auditSerializationContractDesigned: false,
        rollbackStrategyDefined: false,
      },
    });
    expect(readiness.blockers.map((blocker) => blocker.category)).toEqual([
      "production_write_gate",
      "production_write_gate",
      "receipt_contract",
      "runtime_replay",
      "audit_contract",
      "rollback",
    ]);
  });

  it("allows optional omissions without blocking guarded-write eligibility by themselves", () => {
    const report = buildV2MaterializationDryRunReport({
      plannerPolicy: plannerPolicyWithEmptySelectionPlan(),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: fixtureInventory,
      materializedPlan: makeMaterializedPlan({
        omissions: [
          {
            slotId: "upper_a",
            laneId: "optional_biceps",
            reason: "optional_not_activated",
          },
        ],
      }),
    });
    const readiness = buildV2MaterializationPromotionReadiness({
      dryRunReport: report,
      requiredLaneCoverageBySlot: fullRequiredLaneCoverage,
      expectedSlotCount: 1,
      productionWriteGates: allProductionWriteGatesDesigned,
    });

    expect(readiness.status).toBe("eligible_for_guarded_write");
    expect(readiness.safeToPromoteToProductionWrite).toBe(true);
    expect(readiness.optionalOmissions).toEqual({
      count: 1,
      affectsPromotion: false,
      reasons: ["optional_not_activated"],
    });
    expect(readiness.nonBlockingOmissions).toEqual([
      {
        slotId: "upper_a",
        laneId: "optional_biceps",
        reason: "optional_not_activated",
      },
    ]);
    expect(readiness.blockers).toEqual([]);
  });

  it("blocks promotion on required lane coverage failures", () => {
    const report = buildV2MaterializationDryRunReport({
      plannerPolicy: plannerPolicyWithEmptySelectionPlan(),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: fixtureInventory,
      materializedPlan: makeMaterializedPlan(),
    });
    const readiness = buildV2MaterializationPromotionReadiness({
      dryRunReport: report,
      requiredLaneCoverageBySlot: [
        {
          slotId: "upper_a",
          requiredLaneCount: 2,
          materializedRequiredLaneCount: 1,
          blockedRequiredLaneCount: 1,
          missingRequiredLaneIds: ["row_anchor"],
        },
      ],
      expectedSlotCount: 1,
      productionWriteGates: allProductionWriteGatesDesigned,
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.requiredMaterialization).toMatchObject({
      status: "blocked",
      requiredLaneCoveragePassed: false,
      requiredBlockerCount: 2,
    });
    expect(readiness.blockers).toEqual(
      expect.arrayContaining([
        {
          category: "required_materialization",
          reason: "upper_a:required_lane_coverage_incomplete",
        },
        {
          category: "required_materialization",
          reason: "upper_a:row_anchor:required_lane_not_materialized",
        },
      ]),
    );
  });

  it("separates seed-shape incompatibility from required materialization blockers", () => {
    const report = buildV2MaterializationDryRunReport({
      plannerPolicy: plannerPolicyWithEmptySelectionPlan(),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: fixtureInventory,
      materializedPlan: makeMaterializedPlan({
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              {
                exerciseId: "bench",
                role: "CORE_COMPOUND",
                setCount: 0,
                laneIds: ["chest_anchor"],
              },
            ],
          },
        ],
      }),
    });
    const readiness = buildV2MaterializationPromotionReadiness({
      dryRunReport: report,
      requiredLaneCoverageBySlot: fullRequiredLaneCoverage,
      expectedSlotCount: 1,
      productionWriteGates: allProductionWriteGatesDesigned,
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.requiredMaterialization.requiredBlockerCount).toBe(0);
    expect(readiness.seedShape).toMatchObject({
      compatible: false,
      setCountsValid: false,
    });
    expect(readiness.blockers).toContainEqual({
      category: "seed_shape",
      reason: "invalid_seed_set_count",
    });
  });

  it("blocks duplicate exercise IDs within a slot as seed shape, not materialization policy", () => {
    const report = buildV2MaterializationDryRunReport({
      plannerPolicy: plannerPolicyWithEmptySelectionPlan(),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: fixtureInventory,
      materializedPlan: makeMaterializedPlan({
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              {
                exerciseId: "bench",
                role: "CORE_COMPOUND",
                setCount: 4,
                laneIds: ["chest_anchor"],
              },
              {
                exerciseId: "bench",
                role: "ACCESSORY",
                setCount: 3,
                laneIds: ["secondary_chest"],
              },
            ],
          },
        ],
      }),
    });
    const readiness = buildV2MaterializationPromotionReadiness({
      dryRunReport: report,
      requiredLaneCoverageBySlot: fullRequiredLaneCoverage,
      expectedSlotCount: 1,
      productionWriteGates: allProductionWriteGatesDesigned,
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.seedShape.noDuplicateExerciseIdsWithinSlot).toBe(false);
    expect(readiness.blockers).toContainEqual({
      category: "seed_shape",
      reason: "duplicate_exercise_id_within_slot",
    });
  });

  it("blocks missing names only when the seed serializer contract requires them", () => {
    const report = buildV2MaterializationDryRunReport({
      plannerPolicy: plannerPolicyWithEmptySelectionPlan(),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: fixtureInventory,
      materializedPlan: makeMaterializedPlan({
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              {
                exerciseId: "not-in-inventory",
                role: "CORE_COMPOUND",
                setCount: 4,
                laneIds: ["chest_anchor"],
              },
            ],
          },
        ],
      }),
    });
    const requiredNames = buildV2MaterializationPromotionReadiness({
      dryRunReport: report,
      requiredLaneCoverageBySlot: fullRequiredLaneCoverage,
      expectedSlotCount: 1,
      productionWriteGates: allProductionWriteGatesDesigned,
    });
    const namesNotRequired = buildV2MaterializationPromotionReadiness({
      dryRunReport: report,
      requiredLaneCoverageBySlot: fullRequiredLaneCoverage,
      expectedSlotCount: 1,
      seedSerializerRequiresExerciseNames: false,
      productionWriteGates: allProductionWriteGatesDesigned,
    });

    expect(requiredNames.status).toBe("blocked");
    expect(requiredNames.seedShape.namesAvailable).toBe(false);
    expect(requiredNames.blockers).toContainEqual({
      category: "seed_shape",
      reason: "missing_exercise_name",
    });
    expect(namesNotRequired.status).toBe("eligible_for_guarded_write");
    expect(namesNotRequired.seedShape.namesAvailable).toBe(true);
    expect(namesNotRequired.blockers).toEqual([]);
  });

  it("does not allow accidental eligibility without explicit lane coverage evidence", () => {
    const report = buildV2MaterializationDryRunReport({
      plannerPolicy: plannerPolicyWithEmptySelectionPlan(),
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: fixtureInventory,
      materializedPlan: makeMaterializedPlan(),
    });
    const readiness = buildV2MaterializationPromotionReadiness({
      dryRunReport: report,
      expectedSlotCount: 1,
      productionWriteGates: allProductionWriteGatesDesigned,
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.safeToPromoteToProductionWrite).toBe(false);
    expect(readiness.blockers).toContainEqual({
      category: "required_materialization",
      reason: "required_lane_coverage_evidence_missing",
    });
  });
});
