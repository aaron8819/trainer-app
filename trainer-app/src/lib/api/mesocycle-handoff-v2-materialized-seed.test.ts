import { describe, expect, it, vi } from "vitest";

import {
  buildV2PlannerMesocyclePolicy,
  buildV2MaterializationDryRunReport,
  buildV2MaterializationPromotionReadiness,
  type V2ExerciseMaterializationPlan,
  type V2ExerciseSelectionPlan,
  type V2MaterializationExercise,
  type V2MaterializationDryRunReport,
  type V2MaterializationPromotionReadiness,
  type V2MaterializationRequiredLaneCoverage,
} from "@/lib/engine/planning/v2";
import { DEFAULT_V2_EXERCISE_CLASS_TAXONOMY } from "@/lib/engine/planning/v2";
import { buildMesocycleSlotPlanSeed } from "./mesocycle-handoff-slot-plan-projection.seed-serialization";
import { buildMesocycleSlotSequence } from "./mesocycle-slot-contract";
import { buildV2MaterializedSeedForAcceptance } from "./mesocycle-handoff-v2-materialized-seed";

function makeSlotSequence() {
  return buildMesocycleSlotSequence([
    { slotId: "upper_a", intent: "UPPER" },
    { slotId: "lower_a", intent: "LOWER" },
  ]);
}

function makeExerciseSelectionPlan(): V2ExerciseSelectionPlan {
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
            maxExerciseCount: 6,
            targetSessionSets: { min: 8, preferred: 12, max: 16 },
            lanes: [],
          },
          {
            slotId: "lower_a",
            slotIndex: 1,
            maxExerciseCount: 6,
            targetSessionSets: { min: 8, preferred: 12, max: 16 },
            lanes: [],
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
      {
        slotId: "lower_a",
        exercises: [
          {
            exerciseId: "leg-press",
            role: "CORE_COMPOUND",
            setCount: 5,
            laneIds: ["quad_anchor"],
          },
        ],
      },
    ],
    blockers: [],
    omissions: [],
    ...overrides,
  };
}

const requiredLaneCoverage: V2MaterializationRequiredLaneCoverage[] = [
  {
    slotId: "upper_a",
    requiredLaneCount: 2,
    materializedRequiredLaneCount: 2,
    blockedRequiredLaneCount: 0,
    missingRequiredLaneIds: [],
  },
  {
    slotId: "lower_a",
    requiredLaneCount: 1,
    materializedRequiredLaneCount: 1,
    blockedRequiredLaneCount: 0,
    missingRequiredLaneIds: [],
  },
];

const allProductionWriteGatesDesigned = {
  acceptancePathDesigned: true,
  slotPlanSeedJsonWriteGateDesigned: true,
  receiptContractDesigned: true,
  runtimeReplayContractVerified: true,
  auditSerializationContractDesigned: true,
  rollbackStrategyDefined: true,
};

const exerciseNameById = {
  bench: "Bench Press",
  row: "Chest Supported Row",
  "leg-press": "Leg Press",
};

const inventory: V2MaterializationExercise[] = [
  {
    exerciseId: "bench",
    name: "Bench Press",
    aliases: [],
    movementPatterns: ["horizontal_press"],
    primaryMuscles: ["Chest"],
    secondaryMuscles: ["Triceps"],
    equipment: ["barbell"],
    isCompound: true,
    isMainLiftEligible: true,
    fatigueCost: 2,
    stimulusByMusclePerSet: { Chest: 1, Triceps: 0.45 },
  },
  {
    exerciseId: "row",
    name: "Chest Supported Row",
    aliases: [],
    movementPatterns: ["horizontal_pull"],
    primaryMuscles: ["Upper Back", "Lats"],
    secondaryMuscles: [],
    equipment: ["machine"],
    isCompound: true,
    isMainLiftEligible: false,
    fatigueCost: 2,
    stimulusByMusclePerSet: { "Upper Back": 1, Lats: 0.8 },
  },
  {
    exerciseId: "leg-press",
    name: "Leg Press",
    aliases: [],
    movementPatterns: ["squat"],
    primaryMuscles: ["Quads"],
    secondaryMuscles: ["Glutes"],
    equipment: ["machine"],
    isCompound: true,
    isMainLiftEligible: false,
    fatigueCost: 2,
    stimulusByMusclePerSet: { Quads: 1, Glutes: 0.4 },
  },
];

function makeEligibleInput(
  materializedPlan: V2ExerciseMaterializationPlan = makeMaterializedPlan(),
) {
  return {
    enableV2MaterializedSeedWrite: true,
    slotSequence: makeSlotSequence(),
    plannerPolicy: buildV2PlannerMesocyclePolicy(),
    exerciseSelectionPlan: makeExerciseSelectionPlan(),
    taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    inventory,
    materializedPlan,
    exerciseNameById,
    requiredLaneCoverageBySlot: requiredLaneCoverage,
    productionWriteGates: allProductionWriteGatesDesigned,
  };
}

function makeDryRunReport(): V2MaterializationDryRunReport {
  return buildV2MaterializationDryRunReport({
    plannerPolicy: buildV2PlannerMesocyclePolicy(),
    exerciseSelectionPlan: makeExerciseSelectionPlan(),
    taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
    inventory,
    materializedPlan: makeMaterializedPlan(),
    exerciseNameById,
  });
}

function makeBlockedReadiness(): V2MaterializationPromotionReadiness {
  return {
    ...buildV2MaterializationPromotionReadiness({
      dryRunReport: makeDryRunReport(),
      requiredLaneCoverageBySlot: [
        {
          slotId: "upper_a",
          requiredLaneCount: 2,
          materializedRequiredLaneCount: 1,
          blockedRequiredLaneCount: 1,
          missingRequiredLaneIds: ["row_anchor"],
        },
      ],
      expectedSlotCount: 2,
      productionWriteGates: allProductionWriteGatesDesigned,
    }),
  };
}

describe("buildV2MaterializedSeedForAcceptance", () => {
  it("returns disabled by default and does not invoke V2 materialization", () => {
    const buildDryRunReport = vi.fn();
    const buildPromotionReadiness = vi.fn();

    const result = buildV2MaterializedSeedForAcceptance({
      slotSequence: makeSlotSequence(),
      dependencies: {
        buildDryRunReport,
        buildPromotionReadiness,
      },
    });

    expect(result).toEqual({ status: "disabled" });
    expect(buildDryRunReport).not.toHaveBeenCalled();
    expect(buildPromotionReadiness).not.toHaveBeenCalled();
  });

  it("cannot trigger V2 when opt-in is omitted even with materialized input present", () => {
    const buildDryRunReport = vi.fn();

    const result = buildV2MaterializedSeedForAcceptance({
      ...makeEligibleInput(),
      enableV2MaterializedSeedWrite: undefined,
      dependencies: { buildDryRunReport },
    });

    expect(result.status).toBe("disabled");
    expect(buildDryRunReport).not.toHaveBeenCalled();
  });

  it("returns blocked for explicit opt-in when readiness is not eligible", () => {
    const buildDryRunReport = vi.fn(() => makeDryRunReport());
    const buildPromotionReadiness = vi.fn(() => makeBlockedReadiness());
    const buildSlotPlanSeed = vi.fn(buildMesocycleSlotPlanSeed);

    const result = buildV2MaterializedSeedForAcceptance({
      ...makeEligibleInput(),
      dependencies: {
        buildDryRunReport,
        buildPromotionReadiness,
        buildSlotPlanSeed,
      },
    });

    expect(result).toMatchObject({
      status: "blocked",
      reason: "upper_a:required_lane_coverage_incomplete",
    });
    expect(buildDryRunReport).toHaveBeenCalledOnce();
    expect(buildPromotionReadiness).toHaveBeenCalledOnce();
    expect(buildSlotPlanSeed).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("provenance");
    expect(result).not.toHaveProperty("slotPlanSeedJson");
  });

  it("calls the existing seed serializer when explicit opt-in is eligible", () => {
    const buildSlotPlanSeed = vi.fn(buildMesocycleSlotPlanSeed);

    const result = buildV2MaterializedSeedForAcceptance({
      ...makeEligibleInput(),
      dependencies: { buildSlotPlanSeed },
    });

    expect(result.status).toBe("ready");
    expect(buildSlotPlanSeed).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      provenance: {
        source: "v2_materialized_seed",
        dryRunReportVersion: 1,
        promotionReadinessVersion: 1,
      },
    });
  });

  it("serializes only executable seed truth from eligible materialized output", () => {
    const result = buildV2MaterializedSeedForAcceptance(
      makeEligibleInput(
        makeMaterializedPlan({
          omissions: [
            {
              slotId: "upper_a",
              laneId: "optional_biceps",
              reason: "optional_not_activated",
            },
          ],
        }),
      ),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready result");
    }
    expect(result.slotPlanSeedJson.slots).toEqual([
      {
        slotId: "upper_a",
        exercises: [
          { exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 },
          { exerciseId: "row", role: "ACCESSORY", setCount: 3 },
        ],
      },
      {
        slotId: "lower_a",
        exercises: [
          { exerciseId: "leg-press", role: "CORE_COMPOUND", setCount: 5 },
        ],
      },
    ]);
    expect(JSON.stringify(result.slotPlanSeedJson)).not.toMatch(
      /laneIds|dryRunOnly|status|blockers|omissions|v2_exercise_materialization|version":1,"source":"v2_exercise_materialization|Bench Press|Chest Supported Row|Leg Press/,
    );
  });

  it("blocks duplicate exercise IDs within a slot before seed serialization", () => {
    const buildSlotPlanSeed = vi.fn(buildMesocycleSlotPlanSeed);
    const result = buildV2MaterializedSeedForAcceptance({
      ...makeEligibleInput(
        makeMaterializedPlan({
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
            makeMaterializedPlan().slots[1]!,
          ],
        }),
      ),
      dependencies: { buildSlotPlanSeed },
    });

    expect(result).toMatchObject({
      status: "blocked",
      blockers: [
        {
          category: "seed_shape",
          reason: "duplicate_exercise_id_within_slot",
        },
      ],
    });
    expect(buildSlotPlanSeed).not.toHaveBeenCalled();
  });

  it("allows optional omissions when required coverage and seed compatibility pass", () => {
    const result = buildV2MaterializedSeedForAcceptance(
      makeEligibleInput(
        makeMaterializedPlan({
          omissions: [
            {
              slotId: "upper_a",
              laneId: "optional_biceps",
              reason: "optional_no_match",
            },
          ],
        }),
      ),
    );

    expect(result.status).toBe("ready");
  });
});
