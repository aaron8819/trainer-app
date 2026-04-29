import { describe, expect, it } from "vitest";
import { buildV2PlannerMesocyclePolicy } from "../mesocycle-policy";
import { buildV2ExerciseMaterializationPlan } from "./materializer";
import { DEFAULT_V2_EXERCISE_CLASS_TAXONOMY } from "./taxonomy";
import type { V2ExerciseSelectionPlan } from "../types";
import type { V2MaterializationExercise } from "./types";

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
    preferredExerciseClasses: [...input.acceptableExerciseClasses],
    setBudget: { min: 2, preferred: 3, max: 3 },
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
  avoidExerciseIds?: string[];
  favoriteExerciseIds?: string[];
  painConflictExerciseIds?: string[];
}) {
  return buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: input.plan,
    inventory: input.inventory,
    taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    constraints: {
      avoidExerciseIds: input.avoidExerciseIds ?? [],
      favoriteExerciseIds: input.favoriteExerciseIds ?? [],
      painConflictExerciseIds: input.painConflictExerciseIds ?? [],
    },
  });
}

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
  return plan.weeks
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
    expect(materializedLaneIds).toContain("upper_b:vertical_press");
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
});
