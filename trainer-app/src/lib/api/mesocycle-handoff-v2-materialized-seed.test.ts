import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildV2AcceptedPlannerIntentDto,
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
import { runV2MaterializedSeedAcceptanceProbe } from "@/lib/audit/workout-audit/v2-materialization-live-context-dry-run";
import { buildMesocycleSlotPlanSeed } from "./mesocycle-handoff-slot-plan-projection.seed-serialization";
import { buildMesocycleSlotSequence } from "./mesocycle-slot-contract";
import {
  buildAcceptedSeedPersistenceProvenance,
  buildV2MaterializedSeedAcceptanceProbe,
  buildV2MaterializedSeedForAcceptance,
  completeAcceptedSeedPersistenceProvenance,
} from "./mesocycle-handoff-v2-materialized-seed";

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

const passingBasePlanValidation = {
  source: "v2_base_plan_validation",
  status: "pass",
  blockerCount: 0,
  warningCount: 0,
  nextSafeAction: "ready_for_base_plan_compare",
} as const;

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

function listSourceTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listSourceTypeScriptFiles(entryPath);
    }
    return (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
      ? [entryPath]
      : [];
  });
}

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

    expect(result).toMatchObject({
      status: "disabled",
      provenance: {
        source: "v2_disabled",
        readOnly: true,
        dryRunOnly: true,
        seedSerializer: "buildMesocycleSlotPlanSeed",
        dbWriteOccurred: false,
        runtimeReplayContractExpectedUnchanged: true,
        executableSeedTruth: {
          source: "slotPlanSeedJson",
          runtimeConsumedFields: ["exerciseId", "role", "setCount"],
          runtimeIgnoresPlannerMetadata: true,
        },
      },
    });
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
      provenance: {
        source: "v2_blocked_fail_closed",
        readOnly: true,
        dryRunOnly: true,
        dryRunReportVersion: 1,
        promotionReadinessVersion: 1,
        blockerCategories: ["required_materialization"],
        productionGates: {
          acceptancePath: true,
          seedWriteGate: true,
          receiptContract: true,
          runtimeReplayContract: true,
          auditObservabilityContract: true,
          rollbackStrategy: true,
        },
      },
    });
    expect(buildDryRunReport).toHaveBeenCalledOnce();
    expect(buildPromotionReadiness).toHaveBeenCalledOnce();
    expect(buildSlotPlanSeed).not.toHaveBeenCalled();
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
    expect(buildSlotPlanSeed).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "v2_materialized_seed",
      }),
    );
    expect(result).toMatchObject({
      slotPlanSeedJson: {
        source: "v2_materialized_seed",
      },
      provenance: {
        source: "v2_materialized_seed",
        dryRunReportVersion: 1,
        promotionReadinessVersion: 1,
        readOnly: false,
        dryRunOnly: false,
        seedSerializer: "buildMesocycleSlotPlanSeed",
        dbWriteOccurred: false,
        runtimeReplayContractExpectedUnchanged: true,
        executableSeedTruth: {
          source: "slotPlanSeedJson",
          runtimeConsumedFields: ["exerciseId", "role", "setCount"],
          runtimeIgnoresPlannerMetadata: true,
        },
      },
    });
  });

  it("uses materializer-provided required lane coverage when caller evidence is omitted", () => {
    const result = buildV2MaterializedSeedForAcceptance({
      ...makeEligibleInput(),
      requiredLaneCoverageBySlot: undefined,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready result");
    }
    expect(result.slotPlanSeedJson.source).toBe("v2_materialized_seed");
  });

  it("keeps acceptance provenance compact and out of executable seed truth", () => {
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
          blockers: [],
        }),
      ),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready result");
    }
    expect(JSON.stringify(result.provenance)).not.toMatch(
      /laneIds|"blockers"|"omissions"|"inventory"|executableSeedPreview|"dryRunReport"|materializedPlan|optional_biceps|Bench Press|Chest Supported Row|Leg Press/,
    );
    expect(JSON.stringify(result.slotPlanSeedJson)).not.toMatch(
      /laneIds|blockers|omissions|inventory|executableSeedPreview|dryRunReport|materializedPlan|optional_biceps/,
    );
  });

  it("serializes only sanitized accepted planner metadata when explicitly provided", () => {
    const acceptedPlannerIntent = buildV2AcceptedPlannerIntentDto();
    const result = buildV2MaterializedSeedForAcceptance({
      ...makeEligibleInput(),
      acceptedPlannerIntent: {
        ...acceptedPlannerIntent,
        laneIds: ["not-seed-truth"],
        blockers: [{ reason: "debug" }],
        omissions: [{ reason: "debug" }],
        inventoryEvidence: [{ exerciseId: "debug" }],
        debugArtifact: { path: "debug.json" },
        weekPolicies: acceptedPlannerIntent.weekPolicies.map((week, weekIndex) =>
          weekIndex === 0
            ? {
                ...week,
                slots: week.slots.map((slot, slotIndex) =>
                  slotIndex === 0
                    ? {
                        ...slot,
                        lanes: slot.lanes.map((lane, laneIndex) =>
                          laneIndex === 0
                            ? {
                                ...lane,
                                selectedExercise: { exerciseId: "debug" },
                                evidence: ["debug"],
                              }
                            : lane,
                        ),
                      }
                    : slot,
                ),
              }
            : week,
        ),
      } as typeof acceptedPlannerIntent,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("expected ready result");
    }
    expect(result.slotPlanSeedJson.acceptedPlannerIntent).toEqual(
      acceptedPlannerIntent,
    );
    expect(result.slotPlanSeedJson.source).toBe("v2_materialized_seed");
    expect(JSON.stringify(result.slotPlanSeedJson.acceptedPlannerIntent)).not.toMatch(
      /laneIds|blockers|omissions|inventoryEvidence|debugArtifact|selectedExercise|debug/,
    );
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
    expect(result.slotPlanSeedJson.source).toBe("v2_materialized_seed");
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

describe("AcceptedSeedPersistenceProvenance", () => {
  it("keeps transaction provenance distinct from helper preparation provenance", () => {
    const helperResult = buildV2MaterializedSeedForAcceptance(makeEligibleInput());
    const transactionProvenance = buildAcceptedSeedPersistenceProvenance({
      source: "v2_materialized_seed",
    });

    expect(helperResult.status).toBe("ready");
    if (helperResult.status !== "ready") {
      throw new Error("expected ready result");
    }
    expect(helperResult.provenance).toMatchObject({
      source: "v2_materialized_seed",
      dbWriteOccurred: false,
      readOnly: false,
      dryRunOnly: false,
    });
    expect(transactionProvenance).toMatchObject({
      source: "v2_materialized_seed",
      dbWriteOccurred: false,
      seedSourceSelectedBeforeTransaction: true,
      persistedInsideExistingAcceptanceTransaction: false,
      fallback: { occurred: false },
      executableSeedTruth: {
        source: "slotPlanSeedJson",
        runtimeConsumedFields: ["exerciseId", "role", "setCount"],
      },
    });
    expect(transactionProvenance).not.toHaveProperty("dryRunReportVersion");
    expect(transactionProvenance).not.toHaveProperty("productionGates");
  });

  it("marks dbWriteOccurred only when transaction success is reported", () => {
    const prepared = buildAcceptedSeedPersistenceProvenance({
      source: "v2_materialized_seed",
    });
    const failedOrUnrun = completeAcceptedSeedPersistenceProvenance({
      provenance: prepared,
      persistedMesocycleId: "meso-2",
      dbWriteOccurred: false,
    });
    const persisted = completeAcceptedSeedPersistenceProvenance({
      provenance: prepared,
      persistedMesocycleId: "meso-2",
      dbWriteOccurred: true,
    });

    expect(failedOrUnrun).toMatchObject({
      source: "v2_materialized_seed",
      dbWriteOccurred: false,
      persistedInsideExistingAcceptanceTransaction: false,
      persistedMesocycleId: "meso-2",
    });
    expect(persisted).toMatchObject({
      source: "v2_materialized_seed",
      dbWriteOccurred: true,
      persistedInsideExistingAcceptanceTransaction: true,
      persistedMesocycleId: "meso-2",
    });
  });

  it("never labels fallback projection as V2 success", () => {
    const provenance = buildAcceptedSeedPersistenceProvenance({
      source: "legacy_projection_seed",
      fallback: {
        occurred: true,
        source: "fallback_existing_projection",
        reason: "future_explicit_fallback_example",
      },
    });

    expect(provenance).toMatchObject({
      source: "legacy_projection_seed",
      dbWriteOccurred: false,
      fallback: {
        occurred: true,
        source: "fallback_existing_projection",
      },
    });
    expect(provenance.source).not.toBe("v2_materialized_seed");
  });
});

describe("buildV2MaterializedSeedAcceptanceProbe", () => {
  it("keeps the helper disabled while using the seed serializer for read-only preview validation", () => {
    const buildSlotPlanSeed = vi.fn(buildMesocycleSlotPlanSeed);
    const probeInput = makeEligibleInput();

    const result = buildV2MaterializedSeedAcceptanceProbe({
      ...probeInput,
      basePlanValidation: passingBasePlanValidation,
      dependencies: { buildSlotPlanSeed },
      ownerLoaded: true,
      mesocycleLoaded: true,
      liveNormalizedInventoryAvailable: true,
    });

    expect(result.helperResultWithOptInDisabled).toMatchObject({
      status: "disabled",
      provenance: { source: "v2_disabled" },
    });
    expect(result.provenance).toMatchObject({
      source: "v2_disabled",
      readOnly: true,
      dryRunOnly: true,
      dryRunReportVersion: 1,
      promotionReadinessVersion: 1,
      seedSerializer: "buildMesocycleSlotPlanSeed",
      dbWriteOccurred: false,
      executableSeedTruth: {
        source: "slotPlanSeedJson",
        runtimeConsumedFields: ["exerciseId", "role", "setCount"],
        runtimeIgnoresPlannerMetadata: true,
      },
    });
    expect(result.safeToPromoteToProductionWrite).toBe(false);
    expect(result.promotionReadiness.safeToPromoteToProductionWrite).toBe(false);
    expect(result).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      wouldWriteTransaction: false,
      wouldCallLegacyProjection: false,
      wouldCallLegacyRepair: false,
      seedSerializer: "buildMesocycleSlotPlanSeed",
      gates: {
        basePlanValidation: {
          status: "pass",
          passed: true,
          blockerCount: 0,
          warningCount: 0,
        },
        materializerStatus: { status: "materialized", passed: true },
        seedShapeCompatibility: { passed: true, compatible: true },
        requiredLaneCoverage: { passed: true },
        noRequiredBlockersRemain: { passed: true },
        provenance: {
          available: true,
          source: "v2_disabled",
          dbWriteOccurred: false,
        },
        runtimeReplayContract: {
          unchanged: true,
          runtimeConsumedFields: ["exerciseId", "role", "setCount"],
        },
        fallbackPolicy: {
          explicit: true,
          v2BlockedFailsClosed: true,
          silentlyFallsBackToLegacyProjection: false,
          allowedFallbackLabels: [
            "legacy_projection_seed",
            "fallback_existing_projection",
          ],
        },
      },
      projectionRepairBoundary: {
        legacyProjectionCalled: false,
        legacyRepairEngineCalled: false,
        supportFloorClosureCalled: false,
        weeklyObligationClosureCalled: false,
        lateSetBumpingCalled: false,
        capTrimCalled: false,
        repairAddedExercisesIntroduced: false,
        duplicateCleanupMutatedV2Output: false,
        dirtyCollateralCleanupMutatedV2Output: false,
      },
      seedSerializationBoundary: {
        serializer: "buildMesocycleSlotPlanSeed",
        handcraftedSlotPlanSeedJson: false,
        executableRowFields: ["exerciseId", "role", "setCount"],
        acceptedPlannerIntentRuntimeInert: true,
        runtimeConsumesPlannerMetadata: false,
        previewExposedAsSlotPlanSeedJson: false,
        serializerProbe: {
          attempted: true,
          status: "passed",
          slotCount: 2,
          exerciseCount: 3,
          blockers: [],
        },
      },
      acceptancePreparation: {
        helperOptIn: "disabled",
        helperStatus: "disabled",
        wouldWriteTransaction: false,
        persistenceProvenanceIsSeparate: true,
        dbWriteOccurred: false,
      },
    });
    expect(buildSlotPlanSeed).toHaveBeenCalledOnce();
    expect(result).not.toHaveProperty("slotPlanSeedJson");
  });

  it("does not expose dry-run bulk evidence through probe provenance", () => {
    const result = buildV2MaterializedSeedAcceptanceProbe({
      ...makeEligibleInput(
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
      ownerLoaded: true,
      mesocycleLoaded: true,
      liveNormalizedInventoryAvailable: true,
    });

    expect(JSON.stringify(result.provenance)).not.toMatch(
      /laneIds|"blockers"|"omissions"|"inventory"|executableSeedPreview|"dryRunReport"|materializedPlan|optional_biceps|Bench Press|Chest Supported Row|Leg Press/,
    );
  });

  it("reports missing caller-owned evidence as blockers", () => {
    const result = buildV2MaterializedSeedAcceptanceProbe({
      slotSequence: makeSlotSequence(),
      plannerPolicy: null,
      exerciseSelectionPlan: null,
      taxonomy: null,
      inventory: null,
      ownerLoaded: false,
      mesocycleLoaded: false,
      liveNormalizedInventoryAvailable: false,
    });

    expect(result.evidence.callerOwnedEvidence).toEqual(
      expect.arrayContaining([
        {
          key: "planner_policy",
          provided: false,
          futureCallerMustProvide: true,
        },
        { key: "inventory", provided: false, futureCallerMustProvide: true },
        { key: "taxonomy", provided: false, futureCallerMustProvide: true },
        {
          key: "lane_coverage",
          provided: false,
          futureCallerMustProvide: true,
        },
        {
          key: "production_gates",
          provided: false,
          futureCallerMustProvide: true,
        },
      ]),
    );
    expect(result.blockersByCategory).toEqual(
      expect.arrayContaining([
        {
          category: "required_materialization",
          reasons: expect.arrayContaining([
            "exercise_selection_plan_unavailable",
            "inventory_unavailable",
            "mesocycle_not_loaded",
            "owner_not_loaded",
            "planner_policy_unavailable",
            "required_lane_coverage_evidence_missing",
            "taxonomy_unavailable",
          ]),
        },
      ]),
    );
    expect(result.gates.basePlanValidation).toMatchObject({
      status: "missing",
      passed: false,
      missingReason: "base_plan_validation_not_provided",
    });
    expect(result.seedSerializationBoundary.serializerProbe).toMatchObject({
      attempted: false,
      status: "not_attempted",
      blockers: ["slot_count_mismatch"],
    });
  });

  it("separates optional omissions from blockers", () => {
    const result = buildV2MaterializedSeedAcceptanceProbe({
      ...makeEligibleInput(
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
      ownerLoaded: true,
      mesocycleLoaded: true,
      liveNormalizedInventoryAvailable: true,
    });

    expect(result.optionalOmissions).toEqual([
      {
        slotId: "upper_a",
        laneId: "optional_biceps",
        reason: "optional_not_activated",
      },
    ]);
    expect(JSON.stringify(result.blockersByCategory)).not.toContain(
      "optional_not_activated",
    );
  });

  it("can report simulated materialized readiness without promoting it to write success", () => {
    const probeInput = {
      ...makeEligibleInput(),
      productionWriteGates: undefined,
    };

    const result = buildV2MaterializedSeedAcceptanceProbe({
      ...probeInput,
      ownerLoaded: true,
      mesocycleLoaded: true,
      liveNormalizedInventoryAvailable: true,
    });

    expect(result.dryRunReport.status).toBe("materialized");
    expect(result.dryRunReport.seedShapeCompatibility.compatible).toBe(true);
    expect(result.promotionReadiness.status).toBe("not_ready");
    expect(result.gates.productionGates).toMatchObject({
      explicit: false,
      allProvided: false,
      missing: [
        "acceptancePathDesigned",
        "auditSerializationContractDesigned",
        "receiptContractDesigned",
        "rollbackStrategyDefined",
        "runtimeReplayContractVerified",
        "slotPlanSeedJsonWriteGateDesigned",
      ],
    });
    expect(result.simulated_opt_in_readiness).toMatchObject({
      label: "simulated_opt_in_readiness",
      status: "ready",
      promotionReadinessStatus: "eligible_for_guarded_write",
      readinessWouldBeEligibleForGuardedWrite: true,
      safeToPromoteToProductionWrite: false,
      blockersByCategory: [],
    });
    expect(result.safeToPromoteToProductionWrite).toBe(false);
    expect(result.seedPreviewCountsBySlot).toEqual([
      { slotId: "upper_a", exerciseCount: 2 },
      { slotId: "lower_a", exerciseCount: 1 },
    ]);
  });

  it("runs the live acceptance probe through read-only DB methods", async () => {
    const update = vi.fn();
    const create = vi.fn();
    const reader = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: "user-1",
          email: "owner@test.local",
        }),
      },
      mesocycle: {
        findFirst: vi.fn().mockResolvedValue({
          id: "meso-1",
          state: "AWAITING_HANDOFF",
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
        }),
        update,
        create,
      },
      exercise: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "bench",
            name: "Bench Press",
            aliases: [],
            movementPatterns: ["HORIZONTAL_PRESS"],
            isCompound: true,
            isMainLiftEligible: true,
            fatigueCost: 2,
            exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
            exerciseMuscles: [
              { role: "PRIMARY", muscle: { name: "Chest" } },
              { role: "SECONDARY", muscle: { name: "Triceps" } },
            ],
          },
        ]),
      },
      userPreference: {
        findUnique: vi.fn().mockResolvedValue({
          avoidExerciseIds: [],
          favoriteExerciseIds: [],
        }),
      },
    };

    const result = await runV2MaterializedSeedAcceptanceProbe({
      ownerEmail: "owner@test.local",
      reader: reader as never,
    });

    expect(result.context.ownerLoaded).toBe(true);
    expect(result.context.mesocycleLoaded).toBe(true);
    expect(result.context.slotSequence).toMatchObject({
      source: "live_mesocycle_slot_sequence",
      slots: [
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "lower_a", intent: "LOWER" },
        { slotId: "upper_b", intent: "UPPER" },
        { slotId: "lower_b", intent: "LOWER" },
      ],
    });
    expect(result.gates.basePlanValidation.status).not.toBe("missing");
    expect(result.helperResultWithOptInDisabled).toMatchObject({
      status: "disabled",
      provenance: { source: "v2_disabled" },
    });
    expect(reader.user.findUnique).toHaveBeenCalledOnce();
    expect(reader.mesocycle.findFirst).toHaveBeenCalledOnce();
    expect(reader.exercise.findMany).toHaveBeenCalledOnce();
    expect(reader.userPreference.findUnique).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("slotPlanSeedJson");
  });

  it("keeps live production callers except guarded explicit write paths from enabling V2 materialized seed writes", () => {
    const sourceDir = path.join(process.cwd(), "src");
    const allowedOperatorWritePath = path.join(
      sourceDir,
      "lib",
      "api",
      "replace-empty-mesocycle-with-v2.ts",
    );
    const allowedHandoffDraftRefreshPath = path.join(
      sourceDir,
      "lib",
      "api",
      "mesocycle-handoff.ts",
    );
    const violations = listSourceTypeScriptFiles(sourceDir).flatMap((file) => {
      if (file === allowedOperatorWritePath) {
        const text = fs.readFileSync(file, "utf8");
        expect(text).toContain("replaceEmptyActiveMesocycleWithV2");
        expect(text).toContain("confirmEmptyMesocycleReplacement");
        return [];
      }
      if (file === allowedHandoffDraftRefreshPath) {
        const text = fs.readFileSync(file, "utf8");
        expect(text).toContain("refreshMesocycleHandoffNextSeedDraftFromV2");
        expect(text).toContain("MESOCYCLE_HANDOFF_V2_DRAFT_REFRESH_BLOCKED");
        return [];
      }
      const text = fs.readFileSync(file, "utf8");
      return /enableV2MaterializedSeedWrite\s*:\s*true/.test(text)
        ? [path.relative(process.cwd(), file)]
        : [];
    });

    expect(violations).toEqual([]);
  });
});
