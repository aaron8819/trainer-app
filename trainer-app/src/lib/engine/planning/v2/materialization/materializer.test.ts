import { describe, expect, it } from "vitest";
import {
  buildV2LiveContextMaterializationDryRunHarness,
  normalizeLiveInventoryForV2Materialization,
} from "@/lib/audit/workout-audit/v2-materialization-live-context-dry-run";
import { buildV2PlannerMesocyclePolicy } from "../mesocycle-policy";
import { buildV2MaterializationDryRunReport } from "./dry-run-report";
import { buildV2ExerciseMaterializationPlan } from "./materializer";
import { DEFAULT_V2_EXERCISE_CLASS_TAXONOMY } from "./taxonomy";
import type { V2ExerciseSelectionPlan } from "../types";
import type {
  V2ExerciseClassTaxonomy,
  V2ExerciseMaterializationPlan,
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
  taxonomy?: V2ExerciseClassTaxonomy;
  avoidExerciseIds?: string[];
  favoriteExerciseIds?: string[];
  painConflictExerciseIds?: string[];
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
      { slotId: "lower_a", exerciseCount: 5 },
      { slotId: "upper_b", exerciseCount: 6 },
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
});
