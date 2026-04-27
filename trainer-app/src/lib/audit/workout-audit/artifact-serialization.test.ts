import { describe, expect, it } from "vitest";
import {
  buildArtifactDiffSummary,
  buildSerializedTopLevelSizeBreakdown,
  compactWorkoutAuditArtifactForSerialization,
  getSerializedJsonSizeBytes,
  serializeStableJson,
} from "./artifact-serialization";
import type { WorkoutAuditArtifact } from "./types";

describe("artifact serialization helpers", () => {
  it("sorts object keys without reordering arrays", () => {
    const serialized = serializeStableJson({
      z: 1,
      nested: {
        b: 2,
        a: 1,
      },
      items: [{ b: 2, a: 1 }, { d: 4, c: 3 }],
    });

    expect(serialized).toBe(`{
  "items": [
    {
      "a": 1,
      "b": 2
    },
    {
      "c": 3,
      "d": 4
    }
  ],
  "nested": {
    "a": 1,
    "b": 2
  },
  "z": 1
}`);
  });

  it("reports changed top-level keys for quick artifact diffs", () => {
    const diff = buildArtifactDiffSummary(
      { alpha: 1, beta: 2, unchanged: true },
      { alpha: 1, beta: 3, gamma: 4, unchanged: true }
    );

    expect(diff).toEqual({
      changedTopLevelKeys: ["beta", "gamma"],
    });
  });

  it("computes serialized JSON byte sizes with the stable artifact serializer", () => {
    const value = {
      z: "wide",
      a: [1, 2],
    };

    expect(getSerializedJsonSizeBytes(value)).toBe(
      Buffer.byteLength(serializeStableJson(value), "utf8")
    );
  });

  it("reports top-level section sizes sorted by serialized byte size", () => {
    const value = {
      smallest: true,
      largest: [{ id: "alpha", notes: ["one", "two", "three"] }],
      middle: { label: "compact" },
    };

    const breakdown = buildSerializedTopLevelSizeBreakdown(value);

    expect(breakdown).toEqual([
      {
        field: "largest",
        bytes: getSerializedJsonSizeBytes(value.largest),
      },
      {
        field: "middle",
        bytes: getSerializedJsonSizeBytes(value.middle),
      },
      {
        field: "smallest",
        bytes: getSerializedJsonSizeBytes(value.smallest),
      },
    ]);
  });

  it("compacts mesocycle-explain planningReality without hiding required summaries", () => {
    const repeatedMuscles = [
      {
        muscle: "Chest",
        targetStatus: "hard",
        projectedEffectiveSets: 4,
        preferredEffectiveSets: 10,
        minEffectiveSets: 10,
        maxEffectiveSets: 20,
        status: "below",
        trend: "persistent_under_target",
        evidence: [
          "Chest:final=4:preferred=10",
          "repeated_week_1_shape_stays_below_target",
        ],
        limitations: [
          "repeated_week_1_final_shape_only",
          "missing_fatigue_carryover_model",
          "does_not_affect_scoring_generation_repair_seed_or_runtime",
        ],
      },
      {
        muscle: "Hamstrings",
        targetStatus: "hard",
        projectedEffectiveSets: 18,
        preferredEffectiveSets: 12,
        minEffectiveSets: 10,
        maxEffectiveSets: 16,
        status: "above",
        trend: "persistent_over_target",
        evidence: ["Hamstrings:final=18:preferred=12"],
        limitations: [
          "repeated_week_1_final_shape_only",
          "missing_fatigue_carryover_model",
        ],
      },
    ];
    const repeatedSlotRisks = [
      {
        slotId: "upper_b",
        risk: "single_exercise_concentration",
        severity: "warning",
        evidence: ["Incline Dumbbell Bench Press:4 sets:EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS"],
      },
    ];
    const artifact = {
      mesocycleExplain: {
        preview: {
          projectionDiagnostics: {
            planningReality: {
              summary: {
                planningShape: "mostly_repair_shaped",
                materialRepairCount: 19,
                majorRepairCount: 8,
              },
              shadowRepairSummary: {
                materialRepairCount: 19,
                majorRepairCount: 8,
                likelyAvoidableMaterialRepairCount: 9,
                remainingMaterialRepairCount: 10,
              },
              suspiciousRepairsNotEligibleForPromotion: [
                {
                  slotId: "lower_b",
                  muscle: "Hamstrings",
                  exerciseName: "Stiff-Legged Deadlift",
                },
              ],
              promotionCandidates: [
                {
                  slotId: "upper_b",
                  muscle: "Chest",
                  suggestedPromotion: "slot_preselection_demand",
                },
              ],
              weakPreselectionConsumption: [
                {
                  slotId: "upper_b",
                  muscle: "Side Delts",
                  targetMet: true,
                },
              ],
              distributionGuardActions: [
                {
                  slotId: "upper_a",
                  exerciseName: "Incline Dumbbell Bench Press",
                  muscle: "Chest",
                  decision: "left_unresolved",
                },
              ],
              slotPrescriptionIntents: [
                {
                  slotId: "upper_b",
                  musclePrescriptions: [
                    {
                      muscle: "Chest",
                      allowedPatterns: ["horizontal_push", "vertical_push"],
                      allowedExerciseClasses: ["press", "chest_fly"],
                      forbiddenPatterns: [],
                      forbiddenExerciseClasses: [],
                      collateralLimits: [{ muscle: "Front Delts", maxAddedEffectiveSets: 2 }],
                      reasons: [
                        "upper_press_or_fly_slot_can_own_chest",
                        "does_not_affect_scoring_generation_repair_seed_or_runtime",
                      ],
                    },
                  ],
                  movementLanePrescriptions: [],
                  diagnostic: {
                    priorRepairsPrevented: [],
                    priorRepairsStillRepairOwned: [],
                    blockedRepairs: [],
                  },
                },
              ],
              setDistributionIntents: [],
              preselectionFeasibility: [
                {
                  slotId: "lower_b",
                  muscle: "Hamstrings",
                  candidateStatus: "dirty_candidate",
                  recommendation: "requires_distribution_policy_first",
                  reasons: ["cap_cleanup"],
                  preferredCleanPath: [],
                  dirtyClosureSignals: [],
                  candidateInventory: Array.from({ length: 16 }, (_, index) => ({
                    exerciseId: `candidate-${index}`,
                    exerciseName: `Candidate ${index}`,
                    candidateClass: index === 0 ? "knee_flexion_curl" : "hinge_compound",
                    availability: index === 0 ? "clean_available" : "dirty_not_clean_candidate",
                    reasons: ["inventory_visible"],
                  })),
                },
              ],
              repairMaterialityAfterShadowAllocation: [
                {
                  materiality: "major",
                  action: "set_bumped",
                  shadowAllocationBasis: "slot_owned_muscle_before_selection",
                  source: "program_quality_application",
                  rationale: "support floor was closed late",
                  shadowRationale: ["slot owned before selection"],
                },
              ],
              repairMateriality: [],
              exerciseClassDistributionBySlot: [],
              exerciseClassAlignment: {
                version: 1,
                source: "diagnostic_shadow_planner",
                summary: {
                  initiallySatisfied: 7,
                  finallySatisfied: 8,
                  improvedByRepair: 1,
                  worsenedByRepair: 0,
                  identityChurnCount: 2,
                  unresolvedClassIntentCount: 8,
                },
                slots: [],
              },
              accumulationWeekProjection: {
                source: "diagnostic_shadow_planner",
                readOnly: true,
                affectsScoringOrGeneration: false,
                projectionBasis: {
                  method: "repeat_week_1_final_shape",
                  limitations: [
                    "does_not_affect_scoring_generation_repair_seed_or_runtime",
                    "missing_fatigue_carryover_model",
                  ],
                },
                weeks: [2, 3, 4].map((week) => ({
                  week,
                  phase: "accumulation",
                  projectionStatus: "projected_from_week_1_shape",
                  projectedMuscles: repeatedMuscles,
                  projectedSlotRisks: repeatedSlotRisks,
                  weekLevelWarnings: [
                    "repeated_week_1_final_shape_only",
                    "missing_fatigue_carryover_model",
                  ],
                })),
                crossWeekWarnings: [
                  {
                    code: "CHEST_UNDER_TARGET_ACROSS_ACCUMULATION",
                    muscle: "Chest",
                    evidence: ["Chest:final=4:preferred=10"],
                    severity: "warning",
                  },
                ],
                candidateBehaviorReadiness: [
                  {
                    candidate: "chest_upper_slot_distinct_exercise_distribution",
                    readiness: "ready_for_bounded_trial",
                    reason: "Chest remains under target.",
                    requiredGuardrails: ["preserve_upper_slot_pull_identity"],
                  },
                ],
              },
            },
          },
        },
      },
    } as unknown as WorkoutAuditArtifact;

    const compact = compactWorkoutAuditArtifactForSerialization(artifact);
    const originalPlanningReality =
      artifact.mesocycleExplain?.preview.projectionDiagnostics.planningReality as Record<string, unknown>;
    const compactPlanningReality =
      compact.mesocycleExplain?.preview.projectionDiagnostics.planningReality as Record<string, unknown>;
    const compactAccumulation =
      compactPlanningReality.accumulationWeekProjection as Record<string, unknown>;
    const compactSlotIntents =
      compactPlanningReality.slotPrescriptionIntents as Record<string, unknown>;
    const compactFeasibility =
      (compactPlanningReality.preselectionFeasibility as Array<Record<string, unknown>>)[0];

    expect(compact).not.toBe(artifact);
    expect(getSerializedJsonSizeBytes(compact)).toBeLessThan(
      getSerializedJsonSizeBytes(artifact)
    );
    expect(compactPlanningReality.summary).toEqual(originalPlanningReality.summary);
    expect(compactPlanningReality.shadowRepairSummary).toEqual(
      originalPlanningReality.shadowRepairSummary
    );
    expect(compactPlanningReality.suspiciousRepairsNotEligibleForPromotion).toEqual(
      originalPlanningReality.suspiciousRepairsNotEligibleForPromotion
    );
    expect(compactPlanningReality.distributionGuardActions).toEqual(
      originalPlanningReality.distributionGuardActions
    );
    expect(compactAccumulation.summary).toMatchObject({
      projectedWeeks: [2, 3, 4],
      repeatedShapeBasis: "weeks_share_representative_projected_muscles_and_slot_risks",
    });
    expect(compactAccumulation.representativeProjectedMuscles).toHaveLength(2);
    expect(
      ((compactAccumulation.weeks as Array<Record<string, unknown>>)[1]
        .projectedMusclesRef)
    ).toBe("representativeProjectedMuscles");
    expect(
      (compactSlotIntents.catalogs as Record<string, Record<string, unknown>>).arrays
    ).toBeTruthy();
    expect(compactFeasibility.candidateInventorySummary).toMatchObject({
      totalRows: 16,
      omittedCount: 4,
    });
  });

  it("compacts planner-only dry-run to failures and top unresolved rows", () => {
    const artifact = {
      mesocycleExplain: {
        preview: {
          projectionDiagnostics: {},
        },
        plannerOnlyDryRun: {
          enabled: true,
          compareRepaired: true,
          readOnly: true,
          affectsScoringOrGeneration: false,
          canReplaceRepairedProjection: false,
          summary: {
            status: "fail",
            acceptancePassed: 1,
            acceptanceFailed: 1,
            unresolvedDemandCount: 5,
            disabledRepairDependencyCount: 1,
          },
          slotComparisons: [
            {
              slotId: "upper_b",
              repairedExercises: ["A", "B", "C"],
              plannerOnlyExercises: ["A", "B"],
              laneStatus: "failed",
              unresolvedDemand: ["Chest", "Lats", "Rear Delts", "Side Delts", "Triceps"],
              duplicateViolations: ["Incline"],
              setDistributionViolations: ["v1", "v2", "v3", "v4", "v5"],
            },
          ],
          weeklyMuscleComparison: [
            {
              muscle: "Chest",
              targetStatus: "below",
              evidence: ["Chest:below_min_10"],
            },
            {
              muscle: "Quads",
              targetStatus: "within",
              evidence: ["ok"],
            },
          ],
          acceptanceChecks: [
            {
              check: "primary muscles above minimum",
              status: "fail",
              evidence: ["Chest:below_min_10"],
            },
            {
              check: "slotPlanSeedJson would replay without reselection",
              status: "pass",
              evidence: ["ok"],
            },
          ],
          repairDependencies: [
            {
              path: "support-floor closure",
              wouldHaveActed: true,
              consequenceWithoutRepair: "repair_would_be_needed_here:10_support_rows",
              plannerOwnerRequired: "Support demand must be allocated before selection.",
            },
            {
              path: "unused",
              wouldHaveActed: false,
              consequenceWithoutRepair: "none",
              plannerOwnerRequired: "none",
            },
          ],
          calvesFourFourCandidate: {
            status: "blocked",
            blockedReasons: ["weeks_2_to_4_unprojected"],
            recommendation: "needs_more_projection",
          },
        },
      },
    } as unknown as WorkoutAuditArtifact;

    const compact = compactWorkoutAuditArtifactForSerialization(artifact);
    const dryRun = compact.mesocycleExplain?.plannerOnlyDryRun as unknown as Record<string, unknown>;
    const slot = (dryRun.slotComparisons as Array<Record<string, unknown>>)[0];

    expect(dryRun.compactSummary).toMatchObject({
      slotComparisonCount: 1,
      omittedWithinMuscleCount: 1,
      omittedPassingAcceptanceCheckCount: 1,
      omittedInactiveRepairDependencyCount: 1,
    });
    expect(dryRun.weeklyMuscleComparison).toHaveLength(1);
    expect(dryRun.acceptanceChecks).toHaveLength(1);
    expect(dryRun.repairDependencies).toHaveLength(1);
    expect(slot.unresolvedDemand).toEqual(["Chest", "Lats", "Rear Delts", "Side Delts"]);
    expect(slot.omittedUnresolvedDemandCount).toBe(1);
    expect(dryRun.calvesFourFourCandidate).toMatchObject({
      status: "blocked",
      blockedReasons: ["weeks_2_to_4_unprojected"],
    });
  });

  it("leaves unrelated audit artifacts unchanged", () => {
    const artifact = {
      mode: "future-week",
      warningSummary: {
        counts: {
          blockingErrors: 0,
          semanticWarnings: 0,
          backgroundWarnings: 0,
        },
      },
    } as unknown as WorkoutAuditArtifact;

    expect(compactWorkoutAuditArtifactForSerialization(artifact)).toBe(artifact);
  });
});
