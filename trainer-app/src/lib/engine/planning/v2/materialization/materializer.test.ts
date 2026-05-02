import { describe, expect, it } from "vitest";
import {
  buildV2LiveContextMaterializationDryRunHarness,
  normalizeLiveInventoryForV2Materialization,
} from "@/lib/audit/workout-audit/v2-materialization-live-context-dry-run";
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

describe("buildV2ExerciseMaterializationPlan", () => {
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
    expect(materializedLaneIds).toEqual(requiredLaneIds);
    expect(exerciseForLane(result, "upper_a", "chest_anchor")).toMatchObject({
      exerciseId: "machine-chest-press",
      setCount: 4,
    });
    expect(exerciseForLane(result, "upper_b", "chest_second_exposure"))
      .toMatchObject({
        exerciseId: "cable-fly",
        setCount: 4,
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
    expect(exerciseForLane(result, "upper_a", "rear_delt")).toMatchObject({
      exerciseId: "rear-delt-fly",
      setCount: 3,
    });
    expect(exerciseForLane(result, "lower_b", "hinge_anchor")).toMatchObject({
      exerciseId: "romanian-deadlift",
      setCount: 3,
    });
    expect(exerciseForLane(result, "lower_b", "knee_flexion_curl"))
      .toMatchObject({
        exerciseId: "lying-leg-curl",
        setCount: 2,
      });
    expect(exerciseForLane(result, "lower_a", "calves")).toMatchObject({
      exerciseId: "standing-calf-raise",
      setCount: 4,
    });
    expect(exerciseForLane(result, "lower_b", "calves")).toMatchObject({
      exerciseId: "standing-calf-raise",
      setCount: 3,
    });
    expect(
      result.slots.flatMap((slotRow) =>
        slotRow.exercises.filter((exerciseRow) => exerciseRow.setCount >= 5),
      ),
    ).toEqual([]);
    expect(materializedLaneIds).not.toContain("upper_b:vertical_press");
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
          row.slotId === "upper_b" &&
          row.laneId === "vertical_press" &&
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
    expect(JSON.stringify(result)).not.toMatch(/name|exerciseName|planningReality|slotPlanSeedJson/);
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
      { slotId: "upper_a", exerciseCount: 5 },
      { slotId: "lower_a", exerciseCount: 4 },
      { slotId: "upper_b", exerciseCount: 5 },
      { slotId: "lower_b", exerciseCount: 4 },
    ]);
    expect(result.requiredLaneCoverageBySlot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slotId: "upper_a",
          requiredLaneCount: 5,
          materializedRequiredLaneCount: 5,
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
