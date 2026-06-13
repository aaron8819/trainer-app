import { describe, expect, it } from "vitest";
import { buildV2MesocycleStrategyDiagnostic } from "@/lib/engine/planning/v2";
import {
  buildArtifactDiffSummary,
  buildSerializedTopLevelSizeBreakdown,
  compactWorkoutAuditArtifactForSerialization,
  getSerializedJsonSizeBytes,
  serializeStableJson,
} from "./artifact-serialization";
import { WORKOUT_AUDIT_SIZE_LIMIT_BYTES } from "./constants";
import type { WorkoutAuditArtifact } from "./types";

function makeV2BasePlanCompareFixture() {
  return {
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
    summary: {
      v2BaseValidationStatus: "pass",
      v2TotalSets: 55,
      noRepairTotalSets: 25,
      repairedTotalSets: 55,
      repairDependencyCount: 9,
      v2ImprovementCount: 12,
      v2RegressionCount: 0,
      unclearCount: 2,
    },
    comparisons: {
      slotShape: {
        classification: "v2_improves",
        v2Base: {
          slotCount: 4,
          exerciseCount: 18,
          totalSets: 55,
          maxSlotSets: 17,
          optionalLaneMaterializationCount: 0,
          standaloneOneSetExerciseCount: 0,
          fiveSetStackCount: 0,
          setsBySlot: [{ slotId: "upper_a", exerciseCount: 5, setCount: 15 }],
        },
        rows: [
          {
            item: "total_weekly_sets",
            classification: "v2_improves",
            evidence: ["v2:55", "noRepair:25", "repaired:55"],
          },
        ],
      },
      muscleCoverage: {
        classification: "v2_improves",
        underHitMuscles: [],
        overConcentratedMuscles: [],
        managedCollateralExposure: [],
        rows: [],
      },
      exerciseClassCoverage: {
        classification: "v2_improves",
        rows: [],
      },
      repairDependency: {
        classification: "v2_improves",
        dependencyCount: 9,
        responsibilities: [],
      },
      exerciseIdentity: {
        classification: "unclear",
        duplicateExactExercises: {
          v2Base: [],
          plannerOnlyNoRepair: ["Cable Crossover"],
          repairedPlan: [],
        },
        duplicateClassFamilies: {
          v2Base: [],
          plannerOnlyNoRepair: ["chest_isolation"],
          repairedPlan: [],
        },
        slots: [],
        materializerDifferences: [
          "upper_a:identity_differs_from_projection_evidence",
        ],
      },
      deloadReadiness: {
        classification: "v2_preserves",
        rows: [],
      },
    },
    blockersBeforeBehaviorPromotion: [
      "shadow_consumption_trial_not_run",
      "guarded_behavior_trial_not_run",
    ],
    nextSafeAction: "add_shadow_consumption_trial",
    guardrails: {
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
    },
  };
}

function makeV2BasePlanShadowConsumptionTrialFixture() {
  return {
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
      limitations: ["read_only_projection_shape_adapter_only"],
    },
    comparedPlans: {
      v2BasePlanAvailable: true,
      shadowConsumedPlanAvailable: true,
      plannerOnlyNoRepairAvailable: true,
      repairedPlanAvailable: true,
    },
    summary: {
      shadowTotalSets: 55,
      v2BaseTotalSets: 55,
      noRepairTotalSets: 25,
      repairedTotalSets: 55,
      currentRepairDependencyCount: 9,
      shadowRemainingRepairDependencyCount: 1,
      repairDependencyDelta: -8,
      improvementCount: 14,
      preservationCount: 10,
      regressionCount: 0,
      unclearCount: 1,
      notComparableCount: 0,
      categorizedIdentityDifferenceCount: 4,
    },
    changes: {
      repairDependency: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        diagnosticDelta: -8,
        rows: [
          {
            item: "support-floor closure as planner author",
            classification: "v2_improves",
            effect: "reduce",
            currentDependencyCount: 1,
            shadowRemainingDependencyCount: 0,
            diagnosticDelta: -1,
            evidence: ["support_floor:Side Delts"],
          },
        ],
      },
      exerciseIdentity: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        classification: "v2_preserves",
        rows: [
          {
            slotId: "upper_a",
            relationship: "same_class_family",
            classification: "v2_preserves",
            shadowIdentities: ["Machine Chest Press"],
            plannerOnlyNoRepairIdentities: ["Cable Crossover"],
            repairedPlanIdentities: ["Machine Chest Press"],
            evidence: ["same_class_family_as_projection_evidence"],
          },
        ],
        materializerDifferenceCategories: ["upper_a:same_class_family"],
      },
    },
    blockersBeforeBehaviorPromotion: [
      "production_projection_not_consuming_shadow",
      "guarded_behavior_trial_not_run",
    ],
    nextSafeAction: "inspect_shadow_consumption",
    guardrails: {
      doesNotUseHistoricalStrategyRecommendations: true,
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
  };
}

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
          "repeated_week_1_shape_stays_below_preferred_target",
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
                    reason: "Chest remains below its preferred target.",
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

  it("summarizes main planningReality and links the detailed shard when available", () => {
    const artifact = {
      mesocycleExplain: {
        preview: {
          projectionDiagnostics: {
            planningReality: {
              label: "weekly demand / slot allocation diagnostics",
              readOnly: true,
              affectsScoringOrGeneration: false,
              summary: {
                planningShape: "mixed_upstream_plus_repair_shaped",
                materialRepairCount: 3,
                majorRepairCount: 1,
              },
              shadowRepairSummary: {
                materialRepairCount: 3,
                majorRepairCount: 1,
              },
              suspiciousRepairsNotEligibleForPromotion: [],
              promotionCandidates: [
                {
                  slotId: "upper_b",
                  muscle: "Chest",
                  suggestedPromotion: "slot_preselection_demand",
                },
              ],
              weakPreselectionConsumption: [],
              distributionGuardActions: [],
              weeklyMuscleDemand: [
                {
                  muscle: "Chest",
                  evidence: ["keep_this_in_detail_shard"],
                },
              ],
              weeklyDemandCurve: {
                source: "v2_planner_policy",
                readOnly: true,
                affectsScoringOrGeneration: false,
                summary: {
                  weekCount: 5,
                  demandRowCount: 20,
                },
                weeks: [
                  {
                    week: 1,
                    rows: ["large_detail"],
                  },
                ],
              },
              repairMaterialityAfterShadowAllocation: [
                {
                  materiality: "major",
                  action: "set_bumped",
                  source: "program_quality_application",
                },
              ],
              warnings: [],
              limitations: ["diagnostic_only"],
            },
          },
        },
      },
    } as unknown as WorkoutAuditArtifact;

    const compact = compactWorkoutAuditArtifactForSerialization(artifact, {
      planningRealityDebugArtifact: {
        fileName: "parent-v2-planning-reality.json",
        relativePath: "artifacts/audits/parent-v2-planning-reality.json",
        sizeBytes: 4567,
        sha256: "abc123",
        detailLevel: "compact",
      },
    });
    const planningReality = compact.mesocycleExplain?.preview
      .projectionDiagnostics.planningReality as unknown as Record<
      string,
      unknown
    >;

    expect(planningReality).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        planningShape: "mixed_upstream_plus_repair_shaped",
        materialRepairCount: 3,
      },
      detailArtifact: {
        kind: "v2_debug_shard",
        shardId: "planning-reality",
        created: true,
        fileName: "parent-v2-planning-reality.json",
        relativePath: "artifacts/audits/parent-v2-planning-reality.json",
        sizeBytes: 4567,
        sha256: "abc123",
        detailLevel: "compact",
      },
      detailFieldSummaries: {
        weeklyMuscleDemand: {
          kind: "array",
          rowCount: 1,
        },
        weeklyDemandCurve: {
          kind: "object",
          summary: {
            weekCount: 5,
            demandRowCount: 20,
          },
        },
      },
    });
    expect(planningReality).not.toHaveProperty("weeklyMuscleDemand");
    expect(planningReality).not.toHaveProperty("weeklyDemandCurve");
    expect(JSON.stringify(planningReality)).not.toContain(
      "keep_this_in_detail_shard",
    );
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
            lowerASafety: {
              status: "pass",
              currentTotalSets: 12,
              projectedTotalSets: 14,
              slotSetCap: 16,
              wouldExceedSlotCap: false,
              wouldDisplaceHardPrimary: false,
              affectedExercises: ["Standing Calf Raise"],
              evidence: ["lower_a_projected_total_sets:14"],
            },
            materialityEstimate: {
              status: "flat",
              expectedMaterialRepairDelta: 0,
              expectedMajorRepairDelta: 0,
              expectedSuspiciousRepairDelta: 0,
              wouldReduceSupportFloorClosureRows: false,
              wouldReduceSetBumps: false,
              wouldIncreaseCapTrimRows: false,
              removableRows: [],
              potentialNewRows: [],
              stillUnknown: ["weeks_2_to_4_unprojected"],
              evidence: ["current_materialRepairCount:0"],
            },
            policyReadiness: {
              behaviorReadiness: "needs_more_projection",
              remainingBlockers: ["weeks_2_to_4_unprojected"],
            },
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
      lowerASafety: { status: "pass" },
      materialityEstimate: { status: "flat" },
    });
    expect(getSerializedJsonSizeBytes(compact)).toBeLessThan(
      getSerializedJsonSizeBytes(artifact)
    );
  });

  it("keeps planner-only no-repair main artifact to operator summary only", () => {
    const artifact = {
      mode: "mesocycle-explain",
      mesocycleExplain: {
        preview: {
          projectionDiagnostics: {
            planningReality: {},
          },
        },
        plannerOnlyNoRepair: {
          enabled: true,
          readOnly: true,
          affectsScoringOrGeneration: false,
          canReplaceRepairedProjection: false,
          summary: {
            status: "pass_with_warnings",
            targetLanesSatisfied: 1,
            targetLanesMissing: 0,
            unresolvedDemandCount: 0,
            validationFailureCount: 0,
          },
          acceptanceClassification: {
            basicMesocycleShapeStatus: "pass_with_warnings",
            replacementReadinessStatus: "not_ready",
            hardBlockers: [],
            qualityWarnings: [],
            diagnosticOnly: [],
            sessionShaping: [],
            migrationScoreboard: {
              materialRepairCount: 0,
              majorRepairCount: 0,
              suspiciousRepairs: 0,
              canReplaceRepairedProjection: false,
              reason: "not_ready",
            },
          },
          repairPromotionScoreboard: {
            version: 1,
            readOnly: true,
            affectsScoringOrGeneration: false,
            source: "repaired_planning_reality",
            rawRepairEvidence: {
              rawRowCount: 48,
              materialRepairCount: 19,
              majorRepairCount: 8,
              likelyAvoidableMaterialRepairCount: 9,
              remainingMaterialRepairCount: 10,
              suspiciousRepairCount: 6,
            },
            summary: {
              promotionCandidateCount: 0,
              doNotPromoteCount: 48,
              safetyNetCount: 12,
              collateralDiagnosticCount: 17,
              diagnosticOnlyCount: 19,
            },
            interpretation: {
              legacyRepairPressure: {
                rawRowCount: 48,
                materialRepairCount: 19,
                majorRepairCount: 8,
                likelyAvoidableMaterialRepairCount: 9,
                remainingMaterialRepairCount: 10,
                suspiciousRepairCount: 6,
                note: "raw_legacy_repair_evidence_not_behavior_promotion_pressure",
              },
              currentV2PolicyGap: {
                supportDirectFloorBlockerCount: 0,
                setDistributionCapacityGapCount: 4,
                concentrationQualityGapCount: 7,
                optionalDiagnosticLaneCount: 1,
                selectionBlockerCount: 0,
                classTaxonomyMismatchCount: 20,
              },
              safetyNonRegressionRows: {
                count: 12,
                includesSuspiciousRows: true,
              },
              staleRepairedProjectionArtifacts: {
                count: 9,
                reasonCounts: {
                  v2_already_solved_differently: 5,
                  collateral_support_accounting: 4,
                  legacy_repaired_artifact: 5,
                  support_floor_design_needed: 4,
                },
              },
            },
            promotionCandidates: [
              {
                slotId: "upper_b",
                muscle: "Chest",
                exerciseName: "Incline DB Bench",
                action: "set_bumped",
                materiality: "major",
                repairMechanism: "support_floor_closure",
                correctOwner: "SlotDemandAllocationByWeek",
                evidence: ["full_sidecar_only"],
              },
            ],
            doNotPromoteRows: [],
            safetyNetRows: [],
            collateralDiagnosticRows: [],
            diagnosticRows: [],
            rawSuspiciousRows: [],
          },
          v2BasePlanCompare: makeV2BasePlanCompareFixture(),
          v2BasePlanShadowConsumptionTrial:
            makeV2BasePlanShadowConsumptionTrialFixture(),
          crossWeekProjectionGate: {
            readOnly: true,
            affectsScoringOrGeneration: false,
            week1Status: {
              status: "pass_with_warnings",
              basis: ["week_1_no_repair_shape_only"],
            },
            accumulationWeeksStatus: {
              status: "projected_with_limitations",
              weeks: [
                {
                  week: 2,
                  phase: "accumulation",
                  volumeMultiplier: 1,
                  rirTarget: "2-3",
                  projectionBasis: "planner_owned_read_only_projection",
                  limitations: ["planner_owned_week_projection_exists_but_is_diagnostic_only"],
                  safeForBehaviorPromotion: false,
                },
                {
                  week: 3,
                  phase: "hard_accumulation",
                  volumeMultiplier: 1.075,
                  rirTarget: "1-2",
                  projectionBasis: "planner_owned_read_only_projection",
                  limitations: ["planner_owned_week_projection_exists_but_is_diagnostic_only"],
                  safeForBehaviorPromotion: false,
                },
                {
                  week: 4,
                  phase: "peak_overreach_lite",
                  volumeMultiplier: 1.125,
                  rirTarget: "0-1",
                  projectionBasis: "planner_owned_read_only_projection",
                  limitations: ["planner_owned_week_projection_exists_but_is_diagnostic_only"],
                  safeForBehaviorPromotion: false,
                },
              ],
            },
            deloadStatus: {
              status: "diagnostic_projection_only",
              projectionBasis: "v2_deload_transform_read_only",
              preserveIdentities: true,
              targetVolumeReductionPercent: { min: 40, max: 60 },
              targetRir: "4-5",
              limitations: ["runtime_replay_consumption_path_missing"],
              safeForBehaviorPromotion: false,
            },
            replacementReadinessStatus: "not_ready",
            blockers: ["weeks_2_to_4_planner_owned_projection_missing"],
            warnings: ["planner_owned_weeks_2_to_4_projection_is_read_only"],
            missingInputs: [],
            projectedWeekSummaries: [
              {
                week: 1,
                phase: "entry_calibration",
                volumeMultiplier: 0.875,
                totalPlannedSets: 18,
                projectionBasis: "week_1_no_repair_shape",
                limitations: ["week_1_no_repair_shape_only"],
              },
            ],
            deloadSummary: {
              targetVolumeReductionPercent: { min: 40, max: 60 },
              preserveExerciseIdentities: true,
              introducesNewMovements: false,
              projectionBasis: "v2_deload_transform_read_only",
              limitations: ["runtime_replay_consumption_path_missing"],
            },
            safeToPromoteBehavior: false,
          },
          v2MesocycleStrategyDiagnostic:
            buildV2MesocycleStrategyDiagnostic(),
          v2MesocyclePlan: {},
          v2TargetVsNoRepairDiff: {
            version: 1,
            source: "v2_planner_no_repair_experimental",
            readOnly: true,
            affectsScoringOrGeneration: false,
            summary: {
              targetLaneCount: 1,
              satisfiedLaneCount: 0,
              partialLaneCount: 1,
              missingLaneCount: 0,
              blockedLaneCount: 0,
              repairDependentLaneCount: 0,
              migrationCandidateCount: 0,
              suspiciousOrBlockedCount: 0,
            },
            slotDiffs: [
              {
                slotId: "lower_a",
                laneDiffs: [
                  {
                    laneId: "squat_anchor",
                    targetRole: "anchor",
                    targetPrimaryMuscles: ["Quads"],
                    targetExerciseClasses: ["squat_pattern"],
                    targetSets: { min: 3, preferred: 4, max: 4 },
                    currentStatus: "partial",
                    currentEvidence: {
                      selectedExercises: [
                        {
                          name: "Hack Squat",
                          sets: 4,
                          matchedClass: "squat_pattern",
                        },
                      ],
                      relevantDiagnostics: [
                        "setPolicy:quality_warning",
                        "setBudget:within_preferred",
                        "concentration:primary_anchor",
                        "concentration:vertical_press",
                        "concentration:pressing_collateral",
                        "concentration:anchor_expected",
                        "concentration:quality_warning",
                        "justification:squat_anchor",
                        "justification:vertical_press_lane",
                        "justification:direct_side_delt_exposure",
                        "justification:front_delt_collateral_expected",
                        "justification:second_quad_exposure",
                        "justification:weekly_target_met",
                        "concentration:Hack Squat:Quads:50%",
                      ],
                    },
                    gapCause: "concentration_policy_gap",
                    migrationRecommendation: "keep_diagnostic_only",
                    severity: "quality_warning",
                  },
                ],
              },
            ],
            replacementReadinessImpact: {
              canReplaceRepairedProjection: false,
              blockers: ["read_only_non_generative_artifact"],
              nextBestMigrationSlice:
                "row_anchor:needs_set_budget_justification",
            },
          },
          v2SetDistributionIntent: {
            version: 1,
            source: "v2_planner_policy",
            readOnly: true,
            affectsScoringOrGeneration: false,
            summary: {
              weekCount: 1,
              slotCount: 1,
              laneCount: 1,
              plannedTotalSetsByWeek: [
                {
                  week: 1,
                  totalSets: 4,
                  volumeMultiplier: 1,
                  phase: "entry_calibration",
                },
              ],
            },
            weeks: [],
            guardrails: {
              doesNotUseRepairedProjectionAsTarget: true,
              doesNotUseAcceptedSeedAsTarget: true,
              doesNotAffectSelection: true,
              doesNotAffectRepair: true,
              doesNotAffectRuntimeReplay: true,
            },
          },
          slotPlans: [],
          weeklyMuscleTotals: [],
          setAllocationChanges: [],
          weeklyMuscleTotalChanges: [],
          acceptanceChecks: [],
          acceptanceFailures: [],
          qualityWarnings: [],
          diagnosticRows: [],
          ignoredRows: [],
          repairDependenciesDisabled: [],
        },
      },
    } as unknown as WorkoutAuditArtifact;

    const compact = compactWorkoutAuditArtifactForSerialization(artifact);
    const serialized = JSON.stringify(compact);
    const noRepair = compact.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;

    const size = getSerializedJsonSizeBytes(compact);
    expect(size).toBeLessThan(WORKOUT_AUDIT_SIZE_LIMIT_BYTES);
    expect(WORKOUT_AUDIT_SIZE_LIMIT_BYTES - size).toBeGreaterThan(75_000);
    expect(noRepair).toMatchObject({
      enabled: true,
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        status: "pass_with_warnings",
        targetLanesSatisfied: 1,
        targetLanesMissing: 0,
        replacementReadinessStatus: "not_ready",
        basicMesocycleShapeStatus: "pass_with_warnings",
        hardBlockerCount: 0,
        warningCount: 0,
        diagnosticRowCount: 0,
        nextBestMigrationSlice: "row_anchor:needs_set_budget_justification",
      },
      v2Summary: {
        planStatus: undefined,
        split: undefined,
        weekCount: 1,
        slotCount: 1,
        basePlanCompare: {
          status: "available",
          readOnly: true,
          affectsScoringOrGeneration: false,
          comparedPlans: {
            v2BasePlanAvailable: true,
            plannerOnlyNoRepairAvailable: true,
            repairedPlanAvailable: true,
          },
          summary: {
            v2BaseValidationStatus: "pass",
            v2TotalSets: 55,
            noRepairTotalSets: 25,
            repairedTotalSets: 55,
            repairDependencyCount: 9,
            v2ImprovementCount: 12,
            v2RegressionCount: 0,
            unclearCount: 2,
          },
          nextSafeAction: "add_shadow_consumption_trial",
        },
        basePlanShadowConsumptionTrial: {
          status: "available",
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          comparedPlans: {
            v2BasePlanAvailable: true,
            shadowConsumedPlanAvailable: true,
            plannerOnlyNoRepairAvailable: true,
            repairedPlanAvailable: true,
          },
          summary: {
            shadowTotalSets: 55,
            v2BaseTotalSets: 55,
            noRepairTotalSets: 25,
            repairedTotalSets: 55,
            currentRepairDependencyCount: 9,
            shadowRemainingRepairDependencyCount: 1,
            repairDependencyDelta: -8,
            improvementCount: 14,
            preservationCount: 10,
            regressionCount: 0,
            unclearCount: 1,
            notComparableCount: 0,
            categorizedIdentityDifferenceCount: 4,
          },
          nextSafeAction: "inspect_shadow_consumption",
        },
        laneCounts: {
          target: 1,
          partial: 1,
          missing: 0,
        },
        mesocycleStrategyDiagnostic: {
          status: "available_with_limitations",
          readOnly: true,
          affectsScoringOrGeneration: false,
          proposedPhase: "unknown",
          confidence: "low",
          currentDemandSource: "mixed",
          targetDemandSource: "mesocycle_strategy",
          missingInputCount: 6,
          limitationCount: 3,
          strategyInputPresentGroups: [],
          strategyInputMissingGroups: [
            "userProfile",
            "currentTrainingContext",
            "historicalMesocycles",
            "readinessAndRecoverySignals",
          ],
          strategyInputHistoricalMesocycleCount: 0,
          strategyInputConfidenceChange: "not_evaluated_no_input",
          strategyRecommendation: {
            status: "not_available",
            readOnly: true,
            affectsScoringOrGeneration: false,
            recommendedPhase: "unknown",
            confidence: "low",
            hypothesisCount: 0,
            hypothesisIds: [],
            priorityCounts: {},
            topEvidenceExamples: [],
            promotionBlockers: [],
            mustNotYetInfluence: [],
            consumedByDemandOrMaterializer: false,
          },
          strategyHypothesisPromotionReadiness: {
            status: "not_ready",
            readOnly: true,
            affectsScoringOrGeneration: false,
            hypothesisCount: 0,
            hypothesisIds: [],
            readinessCounts: {},
            proposedOwnerCounts: {},
            nextSafeActionCounts: {},
            topMissingEvidenceCategories: [],
            globalBlockers: expect.arrayContaining([
              "readiness_not_consumed_by_mesocycle_demand_or_materializer",
              "no_strategy_hypotheses_available",
            ]),
            consumedByDemandOrMaterializer: false,
          },
          northStarGapCount: 6,
        },
        repairPromotionScoreboard: {
          rawRepairEvidence: {
            rawRowCount: 48,
            materialRepairCount: 19,
            majorRepairCount: 8,
            likelyAvoidableMaterialRepairCount: 9,
            remainingMaterialRepairCount: 10,
            suspiciousRepairCount: 6,
          },
          summary: {
            promotionCandidateCount: 0,
            doNotPromoteCount: 48,
            safetyNetCount: 12,
            collateralDiagnosticCount: 17,
            diagnosticOnlyCount: 19,
          },
          interpretation: {
            legacyRepairPressure: {
              rawRowCount: 48,
              materialRepairCount: 19,
              majorRepairCount: 8,
              likelyAvoidableMaterialRepairCount: 9,
              remainingMaterialRepairCount: 10,
              suspiciousRepairCount: 6,
              note: "raw_legacy_repair_evidence_not_behavior_promotion_pressure",
            },
            currentV2PolicyGap: {
              supportDirectFloorBlockerCount: 0,
              setDistributionCapacityGapCount: 4,
              concentrationQualityGapCount: 7,
              optionalDiagnosticLaneCount: 1,
              selectionBlockerCount: 0,
              classTaxonomyMismatchCount: 20,
            },
            safetyNonRegressionRows: {
              count: 12,
              includesSuspiciousRows: true,
            },
            staleRepairedProjectionArtifacts: {
              count: 9,
              reasonCounts: {
                v2_already_solved_differently: 5,
                collateral_support_accounting: 4,
                legacy_repaired_artifact: 5,
                support_floor_design_needed: 4,
              },
            },
          },
        },
      },
      crossWeekProjectionGate: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        week1Status: { status: "pass_with_warnings", basisCount: 1 },
        accumulationWeeksStatus: {
          status: "projected_with_limitations",
          weekCount: 3,
          projectionBasisCounts: {
            planner_owned_read_only_projection: 3,
          },
        },
        deloadStatus: {
          status: "diagnostic_projection_only",
          projectionBasis: "v2_deload_transform_read_only",
          preserveIdentities: true,
        },
        replacementReadinessStatus: "not_ready",
        safeToPromoteBehavior: false,
        blockerCount: 1,
        warningCount: 1,
        missingInputCount: 0,
        projectedWeekSummaryCount: 1,
      },
      debugArtifact: {
        kind: "v2_debug_index",
        created: false,
        detailLevel: "compact",
        enableWith: "--v2-debug-artifact",
      },
    });
    expect(noRepair).not.toHaveProperty("v2MesocyclePlan");
    expect(serialized).not.toContain("promotionCandidates");
    expect(noRepair).not.toHaveProperty("v2TargetVsNoRepairDiff");
    expect(noRepair).not.toHaveProperty("v2SetDistributionIntent");
    expect(noRepair).not.toHaveProperty("v2BasePlanCompare");
    expect(noRepair).not.toHaveProperty("plannerOwnedAccumulationProjection");
    expect(JSON.stringify(noRepair.v2Summary)).not.toContain("slotShape");
    expect(
      (noRepair.crossWeekProjectionGate as Record<string, unknown>)
        .accumulationWeeksStatus,
    ).not.toHaveProperty("weeks");
    expect(noRepair.crossWeekProjectionGate).not.toHaveProperty(
      "projectedWeekSummaries",
    );
    expect(serialized).not.toContain("concentration:primary_anchor");
  });

  it("summarizes set-budget justification rows without serializing full lane diagnostics", () => {
    const artifact = {
      mode: "mesocycle-explain",
      mesocycleExplain: {
        preview: {
          projectionDiagnostics: {
            planningReality: {},
          },
        },
        plannerOnlyNoRepair: {
          enabled: true,
          readOnly: true,
          affectsScoringOrGeneration: false,
          v2TargetVsNoRepairDiff: {
            version: 1,
            source: "v2_planner_no_repair_experimental",
            readOnly: true,
            affectsScoringOrGeneration: false,
            summary: {
              targetLaneCount: 1,
              satisfiedLaneCount: 0,
              partialLaneCount: 1,
              missingLaneCount: 0,
              blockedLaneCount: 0,
              repairDependentLaneCount: 0,
              migrationCandidateCount: 0,
              suspiciousOrBlockedCount: 0,
            },
            slotDiffs: [
              {
                slotId: "upper_a",
                laneDiffs: [
                  {
                    laneId: "chest_secondary",
                    targetRole: "support",
                    currentStatus: "partial",
                    currentEvidence: {
                      selectedExercises: [
                        {
                          name: "Cable Crossover",
                          sets: 5,
                          matchedClass: "chest_isolation",
                        },
                      ],
                      relevantDiagnostics: [
                        "setPolicy:requires_justification",
                        "setPolicyReason:over_role_cap",
                        "setBudget:requires_justification",
                        "justification:none",
                        "operator_note:trimmed",
                      ],
                    },
                    gapCause: "capacity_gap",
                    migrationRecommendation: "needs_set_budget_justification",
                    severity: "quality_warning",
                  },
                ],
              },
            ],
            replacementReadinessImpact: {
              canReplaceRepairedProjection: false,
              blockers: ["read_only_non_generative_artifact"],
              nextBestMigrationSlice:
                "chest_secondary:needs_set_budget_justification",
            },
          },
        },
      },
    } as unknown as WorkoutAuditArtifact;

    const compact = compactWorkoutAuditArtifactForSerialization(artifact);
    const serialized = serializeStableJson(compact);
    const noRepair = compact.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;

    expect(noRepair.v2Summary).toMatchObject({
      targetVsNoRepairSummary: {
        partialLaneCount: 1,
        missingLaneCount: 0,
      },
    });
    expect(noRepair).not.toHaveProperty("v2TargetVsNoRepairDiff");
    expect(serialized).not.toContain("setBudget:requires_justification");
    expect(serialized).not.toContain("hard_blocker");
  });

  it("keeps explained concentration details out of the main no-repair artifact", () => {
    const artifact = {
      mode: "mesocycle-explain",
      mesocycleExplain: {
        preview: {
          projectionDiagnostics: {
            planningReality: {},
          },
        },
        plannerOnlyNoRepair: {
          enabled: true,
          readOnly: true,
          affectsScoringOrGeneration: false,
          v2TargetVsNoRepairDiff: {
            version: 1,
            source: "v2_planner_no_repair_experimental",
            readOnly: true,
            affectsScoringOrGeneration: false,
            summary: {
              targetLaneCount: 1,
              satisfiedLaneCount: 0,
              partialLaneCount: 1,
              missingLaneCount: 0,
              blockedLaneCount: 0,
              repairDependentLaneCount: 0,
              migrationCandidateCount: 0,
              suspiciousOrBlockedCount: 0,
            },
            slotDiffs: [
              {
                slotId: "upper_a",
                laneDiffs: [
                  {
                    laneId: "triceps",
                    targetRole: "accessory",
                    currentStatus: "partial",
                    currentEvidence: {
                      selectedExercises: [
                        {
                          name: "Cable Triceps Pushdown",
                          sets: 2,
                          matchedClass: "triceps_isolation",
                        },
                      ],
                      relevantDiagnostics: [
                        "setPolicy:quality_warning",
                        "setBudget:within_preferred",
                        "concentration:support_tier",
                        "concentration:small_denominator",
                        "concentration:quality_warning",
                        "concentration:justified_direct_isolation",
                        "justification:low_systemic_fatigue",
                        "justification:small_target_denominator",
                      ],
                    },
                    gapCause: "concentration_policy_gap",
                    migrationRecommendation: "keep_diagnostic_only",
                    severity: "quality_warning",
                  },
                ],
              },
            ],
            replacementReadinessImpact: {
              canReplaceRepairedProjection: false,
              blockers: ["read_only_non_generative_artifact"],
              nextBestMigrationSlice: null,
            },
          },
        },
      },
    } as unknown as WorkoutAuditArtifact;

    const compact = compactWorkoutAuditArtifactForSerialization(artifact);
    const serialized = serializeStableJson(compact);
    const noRepair = compact.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;

    expect(noRepair.v2Summary).toMatchObject({
      targetVsNoRepairSummary: {
        partialLaneCount: 1,
      },
    });
    expect(noRepair).not.toHaveProperty("v2TargetVsNoRepairDiff");
    expect(serialized).not.toContain("concentration:quality_warning");
    expect(serialized).not.toContain("hard_blocker");
  });

  it("compacts flagged planner-only no-repair V2 diagnostics with parseable headroom and blocker evidence", () => {
    const laneIds = [
      "chest_anchor",
      "row_anchor",
      "vertical_pull_support",
      "chest_secondary",
      "rear_delt",
      "triceps",
    ];
    const slots = ["upper_a", "lower_a", "upper_b", "lower_b"];
    const repeatedDiagnostics = [
      "setPolicy:hard_blocker",
      "setPolicyReason:over_60_share",
      "setBudget:within_preferred",
      "justification:none",
      "target_status:blocked",
      "classification:duplicate_continuity_policy:needs_duplicate_policy",
      "program_quality:hard_blocker:forbidden_slot_primary_solution",
      "operator_note:retain_one_clear_reason_per_lane",
    ];
    const setBudget = {
      min: 3,
      preferred: 4,
      max: 4,
      basis: "target_lane",
    };
    const capPolicy = {
      maxSetsPerExerciseWithoutJustification: 5,
      maxDirectExercises: 1,
      basis: "v2_lane_policy",
    };
    const concentrationPolicy = {
      warningShare: 0.5,
      blockerShare: 0.6,
      appliesTo: "primary_target",
    };
    const v2Slots = slots.map((slotId) => ({
      slotId,
      intent: `${slotId} long diagnostic intent`,
      targetSessionSets: { min: 12, max: 20 },
      lanes: laneIds.map((laneId, index) => ({
        laneId,
        required: index < 5,
        role: index === 0 ? "anchor" : "support",
        primaryMuscles: ["Chest", "Lats"],
        preferredExerciseClasses: [
          "horizontal_press",
          "slight_incline_press",
          "cable_row",
        ],
        targetSets: setBudget,
        currentWeek1Status: index === 0 ? "partial" : "satisfied",
      })),
    }));
    const artifact = {
      mode: "mesocycle-explain",
      mesocycleExplain: {
        preview: {
          projectionDiagnostics: {
            planningReality: {},
          },
        },
        plannerOnlyNoRepair: {
          enabled: true,
          readOnly: true,
          affectsScoringOrGeneration: false,
          canReplaceRepairedProjection: false,
          summary: {
            status: "fail",
            targetLanesSatisfied: 12,
            targetLanesMissing: 0,
            unresolvedDemandCount: 4,
            validationFailureCount: 2,
          },
          acceptanceClassification: {
            basicMesocycleShapeStatus: "fail",
            replacementReadinessStatus: "blocked",
            hardBlockers: [
              {
                code: "primary_hard_target_excessive_single_exercise_share_unjustified",
                evidence: ["upper_a:Deficit Push-Up:Chest:64%:over_60_share"],
              },
            ],
            qualityWarnings: [
              {
                code: "support_target_high_single_exercise_share_non_blocking",
                evidence: repeatedDiagnostics,
              },
            ],
            diagnosticOnly: [],
            sessionShaping: [
              {
                code: "planner_owned_set_allocation_changes",
                evidence: ["upper_a:chest_secondary:Cable Crossover:2->3"],
              },
            ],
            migrationScoreboard: {
              materialRepairCount: 1,
              majorRepairCount: 0,
              suspiciousRepairs: 0,
              canReplaceRepairedProjection: false,
              reason: "hard_blockers:1",
            },
          },
          v2MesocyclePlan: {
            version: 1,
            source: "v2_planner_no_repair_experimental",
            readOnly: true,
            affectsScoringOrGeneration: false,
            planStatus: "replacement_not_ready",
            skeleton: {
              split: "upper_lower_4x",
              weeks: 5,
              slotSequence: ["upper_a", "lower_a", "upper_b", "lower_b"],
              slots: v2Slots,
            },
            weeklyProgressionModel: {
              weeks: [1, 2, 3, 4, 5].map((week) => ({
                week,
                phase: week === 5 ? "deload" : "accumulation",
                volumeMultiplier: week === 5 ? 0.5 : 1,
                rirTarget: week === 5 ? "4-5" : "2-3",
                progressionIntent:
                  week === 5 ? "reduce_fatigue" : "productive_volume",
                limitations: [
                  "derived_from_stable_skeleton_not_independent_plan",
                  "does_not_affect_scoring_generation_repair_seed_or_runtime",
                ],
              })),
            },
            deloadTransform: {
              preserveExerciseIdentities: true,
              targetVolumeReductionPercent: { min: 40, max: 60 },
              targetRir: "4-5",
              removeRedundantAccessories: true,
              introduceNewMovements: false,
              projectionStatus: "partially_modeled",
              limitations: ["not_used_by_runtime_replay"],
            },
            validationRules: Array.from({ length: 12 }, (_, index) => ({
              ruleId: `rule_${index}`,
              severity: index < 4 ? "hard_blocker" : "migration_scoreboard",
              description:
                "Long validation description retained in in-memory diagnostics only.",
              week1Status: index === 0 ? "fail" : "pass",
              fullMesocycleStatus: index === 0 ? "fail" : "limited",
            })),
            replacementReadiness: {
              canReplaceRepairedProjection: false,
              reason: [
                "read_only_non_generative_artifact",
                "weeks_2_to_4_derived_not_fully_projected",
              ],
            },
          },
          v2TargetVsNoRepairDiff: {
            version: 1,
            source: "v2_planner_no_repair_experimental",
            readOnly: true,
            affectsScoringOrGeneration: false,
            summary: {
              targetLaneCount: 24,
              satisfiedLaneCount: 12,
              partialLaneCount: 10,
              missingLaneCount: 0,
              blockedLaneCount: 2,
              repairDependentLaneCount: 0,
              migrationCandidateCount: 1,
              suspiciousOrBlockedCount: 2,
            },
            slotDiffs: v2Slots.map((slot) => ({
              slotId: slot.slotId,
              laneDiffs: slot.lanes.map((lane, index) => ({
                laneId: lane.laneId,
                targetRole: lane.role,
                targetPrimaryMuscles: lane.primaryMuscles,
                targetExerciseClasses: lane.preferredExerciseClasses,
                targetSets: lane.targetSets,
                currentStatus: index === 0 ? "blocked" : "partial",
                currentEvidence: {
                  selectedExercises: [
                    {
                      name: "Deficit Push-Up",
                      sets: 6,
                      matchedClass: "horizontal_press",
                      role: "accessory",
                    },
                  ],
                  relevantDiagnostics: repeatedDiagnostics,
                },
                gapCause: "concentration_policy_gap",
                migrationRecommendation: "needs_concentration_justification",
                severity: index === 0 ? "hard_blocker" : "quality_warning",
              })),
            })),
            replacementReadinessImpact: {
              canReplaceRepairedProjection: false,
              blockers: ["read_only_non_generative_artifact"],
              nextBestMigrationSlice:
                "chest_second_exposure:needs_concentration_justification",
            },
          },
          v2SetDistributionIntent: {
            version: 1,
            source: "v2_planner_policy",
            readOnly: true,
            affectsScoringOrGeneration: false,
            summary: {
              weekCount: 5,
              slotCount: 4,
              laneCount: 24,
              plannedTotalSetsByWeek: [1, 2, 3, 4, 5].map((week) => ({
                week,
                totalSets: 80,
                volumeMultiplier: week === 5 ? 0.5 : 1,
                phase: week === 5 ? "deload" : "accumulation",
              })),
            },
            weeks: [1, 2, 3, 4, 5].map((week) => ({
              week,
              phase: week === 5 ? "deload" : "accumulation",
              volumeMultiplier: week === 5 ? 0.5 : 1,
              rirTarget: week === 5 ? "4-5" : "2-3",
              slots: v2Slots.map((slot) => ({
                slotId: slot.slotId,
                slotIntent: slot.intent,
                targetSessionSets: slot.targetSessionSets,
                lanes: slot.lanes.map((lane) => ({
                  laneId: lane.laneId,
                  primaryMuscles: lane.primaryMuscles,
                  preferredExerciseClasses: lane.preferredExerciseClasses,
                  evidenceBasis: repeatedDiagnostics,
                  capPolicy,
                  concentrationPolicy,
                  setBudget,
                })),
              })),
            })),
            guardrails: {
              doesNotUseRepairedProjectionAsTarget: true,
              doesNotUseAcceptedSeedAsTarget: true,
              doesNotAffectSelection: true,
              doesNotAffectRepair: true,
              doesNotAffectRuntimeReplay: true,
            },
          },
          slotPlans: v2Slots.map((slot) => ({
            slotId: slot.slotId,
            exercises: [
              {
                exerciseName: "Deficit Push-Up",
                lane: "chest_anchor",
                exerciseClass: "horizontal_press",
                sets: 6,
              },
            ],
            missingLanes: ["chest_anchor:partial"],
            unresolvedDemand: repeatedDiagnostics,
            validationFailures: repeatedDiagnostics,
          })),
          weeklyMuscleTotals: [],
          setAllocationChanges: [],
          weeklyMuscleTotalChanges: [],
          acceptanceChecks: [
            {
              check: "primary muscles above minimum",
              status: "fail",
              evidence: repeatedDiagnostics,
            },
          ],
          acceptanceFailures: [],
          qualityWarnings: [],
          diagnosticRows: [],
          ignoredRows: [],
          repairDependenciesDisabled: [
            "support-floor closure",
            "cap trim",
            "MAV trim",
          ],
        },
      },
    } as unknown as WorkoutAuditArtifact;

    const compact = compactWorkoutAuditArtifactForSerialization(artifact);
    const originalSize = getSerializedJsonSizeBytes(artifact);
    const compactSize = getSerializedJsonSizeBytes(compact);
    const serialized = serializeStableJson(compact);
    const reparsed = JSON.parse(serialized) as WorkoutAuditArtifact;
    const noRepair = reparsed.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;
    const operatorFindings = noRepair.operatorFindings as Record<string, unknown>;
    const hardBlockers =
      operatorFindings.hardBlockers as Array<Record<string, unknown>>;

    expect(compactSize).toBeLessThan(originalSize);
    expect(originalSize - compactSize).toBeGreaterThanOrEqual(2_000);
    expect(WORKOUT_AUDIT_SIZE_LIMIT_BYTES - compactSize).toBeGreaterThan(
      100_000
    );
    expect(hardBlockers[0]).toMatchObject({
      code: "primary_hard_target_excessive_single_exercise_share_unjustified",
      evidence: ["upper_a:Deficit Push-Up:Chest:64%:over_60_share"],
    });
    expect(noRepair).toMatchObject({
      enabled: true,
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        status: "fail",
        replacementReadinessStatus: "blocked",
        basicMesocycleShapeStatus: "fail",
        hardBlockerCount: 1,
        warningCount: 1,
        diagnosticRowCount: 1,
        nextBestMigrationSlice:
          "chest_second_exposure:needs_concentration_justification",
      },
      replacementReadiness: {
        canReplaceRepairedProjection: false,
        reasons: [
          "read_only_non_generative_artifact",
          "weeks_2_to_4_derived_not_fully_projected",
        ],
        blockers: ["read_only_non_generative_artifact"],
      },
      v2Summary: {
        planStatus: "replacement_not_ready",
        split: "upper_lower_4x",
        weekCount: 5,
        slotCount: 4,
        laneCounts: {
          target: 24,
          satisfied: 12,
          partial: 10,
          missing: 0,
          blocked: 2,
          repairDependent: 0,
          migrationCandidates: 1,
          suspiciousOrBlocked: 2,
        },
        validationRuleSummary: {
          total: 12,
          bySeverity: {
            hard_blocker: 4,
            migration_scoreboard: 8,
          },
        },
      },
      debugArtifact: {
        created: false,
        enableWith: "--v2-debug-artifact",
        detailLevel: "compact",
        contains: expect.arrayContaining([
          "v2-debug-index",
          "v2-strategy",
          "v2-promotion-diffs",
          "v2-cross-week-projection",
        ]),
      },
    });
    expect(noRepair).not.toHaveProperty("v2MesocyclePlan");
    expect(noRepair).not.toHaveProperty("v2TargetVsNoRepairDiff");
    expect(noRepair).not.toHaveProperty("v2SetDistributionIntent");
    expect(noRepair).not.toHaveProperty("plannerOwnedAccumulationProjection");
  });

  it("links planner-only no-repair main artifact to a written sidecar manifest", () => {
    const artifact = {
      mode: "mesocycle-explain",
      mesocycleExplain: {
        preview: {
          projectionDiagnostics: {
            planningReality: {},
          },
        },
        plannerOnlyNoRepair: {
          v2TargetVsNoRepairDiff: {
            version: 1,
            source: "v2_planner_no_repair_experimental",
            readOnly: true,
            affectsScoringOrGeneration: false,
            summary: {},
            slotDiffs: [
              {
                slotId: "upper_b",
                laneDiffs: [
                  {
                    laneId: "chest_second_exposure",
                    targetRole: "support",
                    currentStatus: "partial",
                    severity: "quality_warning",
                    currentEvidence: {
                      selectedExercises: [
                        {
                          name: "Cable Fly",
                          sets: 4,
                          matchedClass: "chest_isolation",
                          role: "accessory",
                        },
                      ],
                      relevantDiagnostics: [
                        "setPolicy:quality_warning",
                        "setBudget:within_preferred",
                        "concentration:chest_primary",
                        "concentration:second_exposure",
                        "concentration:quality_warning",
                        "concentration:class_distinct",
                        "concentration:exercise_distinct",
                        "justification:second_chest_exposure",
                        "justification:weekly_target_met",
                        "justification:upper_slot_distribution",
                      ],
                    },
                    gapCause: "concentration_policy_gap",
                    migrationRecommendation: "keep_diagnostic_only",
                  },
                ],
              },
            ],
            replacementReadinessImpact: {
              canReplaceRepairedProjection: false,
              blockers: [],
              nextBestMigrationSlice: null,
            },
          },
        },
      },
    } as unknown as WorkoutAuditArtifact;

    const compact = compactWorkoutAuditArtifactForSerialization(artifact, {
      plannerOnlyNoRepairDebugArtifact: {
        fileName: "parent-v2-debug-index.json",
        relativePath: "artifacts/audits/parent-v2-debug-index.json",
        sizeBytes: 1234,
        sha256: "abc123",
        detailLevel: "compact",
      },
    });
    const serialized = serializeStableJson(compact);
    const reparsed = JSON.parse(serialized) as WorkoutAuditArtifact;
    const noRepair = reparsed.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;

    expect(noRepair.debugArtifact).toMatchObject({
      kind: "v2_debug_index",
      created: true,
      fileName: "parent-v2-debug-index.json",
      relativePath: "artifacts/audits/parent-v2-debug-index.json",
      sizeBytes: 1234,
      sha256: "abc123",
      detailLevel: "compact",
      contains: expect.arrayContaining([
        "v2-debug-index",
        "v2-strategy",
        "v2-promotion-diffs",
        "v2-cross-week-projection",
      ]),
    });
    expect(noRepair.debugArtifact).not.toHaveProperty("enableWith");
    expect(serialized).not.toContain("concentration:chest_primary");
  });

  it("exposes compact strategy hypothesis promotion readiness without carrying full detail in the main artifact", () => {
    const artifact = {
      mode: "mesocycle-explain",
      mesocycleExplain: {
        preview: {
          projectionDiagnostics: {},
        },
        plannerOnlyNoRepair: {
          enabled: true,
          readOnly: true,
          affectsScoringOrGeneration: false,
          canReplaceRepairedProjection: false,
          summary: {
            status: "pass_with_warnings",
            targetLanesSatisfied: 1,
            targetLanesMissing: 0,
            unresolvedDemandCount: 0,
            validationFailureCount: 0,
          },
          acceptanceClassification: {
            basicMesocycleShapeStatus: "pass_with_warnings",
            replacementReadinessStatus: "not_ready",
            hardBlockers: [],
            qualityWarnings: [],
            diagnosticOnly: [],
            sessionShaping: [],
            migrationScoreboard: {
              canReplaceRepairedProjection: false,
            },
          },
          v2MesocycleStrategyDiagnostic: {
            status: "available_with_limitations",
            readOnly: true,
            affectsScoringOrGeneration: false,
            phaseStrategy: {
              proposedPhase: "unknown",
              confidence: "low",
            },
            demandDerivationPlan: {
              currentDemandSource: "mixed",
              targetDemandSource: "mesocycle_strategy",
            },
            userTrainingProfileInputs: {
              missing: [],
              limitations: [],
            },
            strategyInputSummary: {
              presentGroups: [],
              missingGroups: [],
              historicalMesocycleCount: 2,
              blockResponseSignalCount: 2,
              exerciseResponseSignalCount: 0,
              historicalSourcePlannerCounts: {
                legacy_projection: 2,
                v2: 0,
                unknown: 0,
              },
              evidenceCategoriesAvailable: ["block_response"],
              performedHistoryEvidenceLoaded: true,
              prescribedPlanShapeExcludedFromStrategyPolicy: true,
              confidenceChange: "eligible_for_medium_evidence",
            },
            responseEvidenceSummary: {
              strategyImplicationCounts: {},
              recurringUnderHitMuscleExamples: ["Side Delts"],
              recurringOverConcentrationExamples: [],
              exerciseSignalsByType: {},
              confidenceDistribution: {},
              evidenceLimitations: [],
              usableForFutureContinuityVariation: false,
              usableForFutureMaterializerRanking: false,
              usableForFutureVolumeFatigueStrategy: true,
            },
            continuityVariationEvidence: {
              status: "not_available",
              keepCandidateCount: 0,
              rotateCandidateCount: 0,
              avoidCandidateCount: 0,
              lowConfidenceCount: 0,
              limitations: [],
            },
            volumeFatigueStrategyEvidence: {
              status: "available_with_limitations",
              protectLaggingMuscleSignals: ["Side Delts"],
              overConcentrationSignals: [],
              lateBlockFatigueSignals: ["meso-2:late_block_skipped_sets_rising"],
              deloadExecutionSignals: [],
              limitations: [],
            },
            strategyRecommendation: {
              status: "available_with_limitations",
              readOnly: true,
              affectsScoringOrGeneration: false,
              recommendedPhase: "unknown",
              confidence: "low",
              hypotheses: [
                {
                  id: "protect_lagging_muscles_earlier",
                  priority: "P1",
                  evidence: ["Side Delts:under_hit_in_2_performed_block_response"],
                  promotionBlockers: [
                    "recommendation_is_evidence_backed_hypothesis_not_planner_instruction",
                  ],
                  mustNotYetInfluence: ["generation", "selection"],
                },
                {
                  id: "cap_late_block_volume",
                  priority: "P1",
                  evidence: ["meso-2:skipped_set_trend_rising"],
                  promotionBlockers: [
                    "recommendation_is_evidence_backed_hypothesis_not_planner_instruction",
                  ],
                  mustNotYetInfluence: ["generation", "selection"],
                },
              ],
            },
            strategyHypothesisPromotionReadiness: {
              status: "partially_ready",
              readOnly: true,
              affectsScoringOrGeneration: false,
              globalBlockers: [
                "readiness_not_consumed_by_mesocycle_demand_or_materializer",
              ],
              hypothesisReadiness: [
                {
                  hypothesisId: "protect_lagging_muscles_earlier",
                  readiness: "ready_for_read_only_diff",
                  proposedOwner: "MesocycleDemand",
                  nextSafeAction: "add_read_only_diff",
                  missingEvidence: ["slot_owner_for_protected_sets"],
                },
                {
                  hypothesisId: "cap_late_block_volume",
                  readiness: "ready_for_read_only_diff",
                  proposedOwner: "WeeklyDemandCurve",
                  nextSafeAction: "add_read_only_diff",
                  missingEvidence: [
                    "priority_target_coverage_preservation",
                  ],
                },
              ],
            },
            strategyHypothesisPromotionDiff: {
              version: 1,
              source: "v2_strategy_hypothesis_promotion_diff",
              readOnly: true,
              affectsScoringOrGeneration: false,
              consumedByDemandOrMaterializer: false,
              status: "available_with_limitations",
              evaluatedHypotheses: [
                "protect_lagging_muscles_earlier",
                "cap_late_block_volume",
              ],
              protectLaggingMusclesEarlier: {
                status: "available_with_limitations",
                targetTierMuscles: ["Side Delts"],
                recurringUnderHitMuscles: ["Side Delts"],
                proposedProtectionType: "slot_owned_support_floor",
                requiredGuards: ["protected_sets_must_have_slot_owner"],
                riskSummary: ["protected_sets_can_crowd_out_priority_targets"],
              },
              capLateBlockVolume: {
                status: "available_with_limitations",
                skippedSetEvidence: {
                  hardWeekSkippedSetSignal: true,
                  examples: ["meso-2:skipped_set_trend_rising"],
                },
                proposedCapType: "late_block_expansion_cap",
                requiredGuards: [
                  "cap_must_preserve_priority_target_coverage",
                ],
                riskSummary: [
                  "skipped_sets_may_reflect_schedule_or_adherence_not_plan_bloat",
                ],
              },
              interactionRisk: {
                status: "available_with_limitations",
                risks: [
                  "lagging_muscle_protection_may_require_more_allocated_work",
                ],
                requiredJointGuards: [
                  "prefer_redistribution_from_over_concentrated_or_fatigue_driver_muscles_before_adding_net_new_late_block_volume",
                ],
              },
              projectionDiff: {
                version: 1,
                source: "v2_strategy_hypothesis_projection_diff",
                readOnly: true,
                affectsScoringOrGeneration: false,
                consumedByDemandOrMaterializer: false,
                status: "available_with_limitations",
                evaluatedHypotheses: [
                  "protect_lagging_muscles_earlier",
                  "cap_late_block_volume",
                ],
                projectionMode: "read_only_estimate",
                candidateStrategy: {
                  laggingMuscleProtection: {
                    muscles: ["Side Delts"],
                    proposedMechanism: "redistribute_sets",
                  },
                  lateBlockVolumeCap: {
                    proposedMechanism: "hard_week_expansion_cap",
                  },
                  redistributionPreference: {
                    preferRedistributionBeforeNetNewVolume: true,
                    candidateDonorMuscles: ["Glutes"],
                    candidateProtectedMuscles: ["Side Delts"],
                  },
                },
                projectedDeltas: {
                  priorityCoverage: {
                    status: "unknown",
                    notes: ["no_shadow_projection_quantifies_priority_set_delta"],
                  },
                  laggingMuscleCoverage: {
                    status: "improves",
                    examples: ["Side Delts"],
                  },
                  sessionSize: {
                    status: "preserved",
                    notes: [
                      "redistribution_preferred_before_net_new_late_block_volume",
                    ],
                  },
                  concentration: {
                    status: "improves",
                    notes: ["candidate_donor_muscles_come_from_evidence"],
                  },
                  repairPressure: {
                    status: "unknown",
                    notes: ["repair_pressure_deltas_not_measured"],
                  },
                  dirtyCollateral: {
                    status: "unknown",
                    notes: ["dirty_collateral_delta_not_available"],
                  },
                  lateBlockFatigueRisk: {
                    status: "improves",
                    notes: ["hard_week_skipped_set_signal_supports_cap_pressure_estimate"],
                  },
                },
                computedNonRegressionGates: {
                  preservePriorityCoverage: "unknown",
                  preserveOrImproveLaggingMuscleCoverage: "unknown",
                  noMaterialRepairIncrease: "unknown",
                  noMajorRepairIncrease: "unknown",
                  noSuspiciousRepairIncrease: "unknown",
                  noDirtyCollateralIncrease: "unknown",
                  noForbiddenSlotWorkaround: "unknown",
                  noSessionSizeRegression: "unknown",
                  noConcentrationRegression: "unknown",
                  noLateBlockSkippedSetRiskIncrease: "unknown",
                },
                conflictAwareRefinement: {
                  enabled: true,
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  status: "available_with_limitations",
                  conflicts: [
                    {
                      type: "session_size_cap_conflict",
                      slotId: "upper_a",
                      reason:
                        "candidate projection increased slot set pressure despite max slot set increase allowance of zero",
                    },
                  ],
                  conflictCountsByType: {
                    session_size_cap_conflict: 1,
                  },
                  donorResolution: {
                    excludedDonorMuscles: [],
                    retainedDonorMuscles: ["Glutes"],
                    reasonByMuscle: {
                      Glutes:
                        "retained_as_over_concentration_or_fatigue_driver_candidate_with_no_measured_conflict",
                    },
                  },
                  volumePolicy: {
                    netNewVolumeAllowed: false,
                    redistributionRequired: true,
                    maxSlotSetIncreaseAllowed: 0,
                  },
                },
                preShadowCandidateFilter: {
                  enabled: true,
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  consumedByDemandOrMaterializer: false,
                  status: "available_with_limitations",
                  configuration: {
                    readOnly: true,
                    affectsScoringOrGeneration: false,
                    floorMarginSets: 0.5,
                    targetTierFloorMarginSets: 1,
                    netNewVolumeAllowed: false,
                    maxSlotIncreaseAllowed: 0,
                    redistributionRequired: true,
                  },
                  donorEligibility: [
                    {
                      muscle: "Glutes",
                      eligible: true,
                      reason: "safe_surplus_margin",
                      baseCoverage: {
                        sets: 12,
                        floor: 6,
                        margin: 6,
                        status: "surplus",
                      },
                    },
                    {
                      muscle: "Hamstrings",
                      eligible: false,
                      reason: "insufficient_margin",
                      baseCoverage: {
                        sets: 6.2,
                        floor: 6,
                        margin: 0.2,
                        status: "covered",
                      },
                    },
                  ],
                  protectedEligibility: [
                    {
                      muscle: "Side Delts",
                      eligible: true,
                      reason: "target_tier_under_hit",
                    },
                  ],
                  overrideConstruction: {
                    readOnly: true,
                    affectsScoringOrGeneration: false,
                    consumedByDemandOrMaterializer: false,
                    excludedDonors: ["Hamstrings"],
                    retainedDonors: ["Glutes"],
                    excludedProtectedMuscles: [],
                    retainedProtectedMuscles: ["Side Delts"],
                    netNewVolumeAllowed: false,
                    maxSlotIncreaseAllowed: 0,
                    redistributionRequired: true,
                  },
                },
                readiness: "ready_for_read_only_shadow_trial",
                limitations: [
                  "no_shadow_projection_rerun_yet",
                  "computed_gates_default_unknown_without_projected_delta_evidence",
                ],
              },
              donorSurplusEvidence: {
                version: 1,
                source: "v2_donor_surplus_evidence",
                readOnly: true,
                affectsScoringOrGeneration: false,
                consumedByDemandOrMaterializer: false,
                status: "available_with_limitations",
                donorEvidence: [
                  {
                    muscle: "Glutes",
                    targetTier: "B_SUPPORT",
                    candidateReason: "both",
                    baselineCoverage: {
                      measured: true,
                      effectiveSets: 12,
                      floorSets: 6,
                      surplusAboveFloor: 6,
                      status: "surplus",
                    },
                    protectedConflict: {
                      isProtectedMuscle: false,
                      requiresSurplusProof: false,
                    },
                    slotOwnership: {
                      candidateSlotOwners: ["lower_a", "lower_b"],
                      compatible: true,
                      limitations: [],
                    },
                    eligibility: {
                      eligible: true,
                      reason: "safe_surplus_margin",
                      confidence: "high",
                    },
                  },
                  {
                    muscle: "Hamstrings",
                    targetTier: "A_PRIMARY",
                    candidateReason: "over_concentration",
                    baselineCoverage: {
                      measured: true,
                      effectiveSets: 6.2,
                      floorSets: 6,
                      surplusAboveFloor: 0.2,
                      status: "surplus",
                    },
                    protectedConflict: {
                      isProtectedMuscle: false,
                      requiresSurplusProof: false,
                    },
                    slotOwnership: {
                      candidateSlotOwners: ["lower_a"],
                      compatible: true,
                      limitations: [],
                    },
                    eligibility: {
                      eligible: false,
                      reason: "insufficient_margin",
                      confidence: "medium",
                    },
                  },
                ],
                summary: {
                  candidateCount: 2,
                  eligibleCount: 1,
                  ineligibleCount: 1,
                  unknownMarginCount: 0,
                  protectedOverlapCount: 0,
                  slotIncompatibleCount: 0,
                },
                limitations: [
                  "donor_surplus_evidence_is_read_only_and_non_binding",
                ],
              },
              slotOwnedDemandAdjustmentPlan: {
                version: 1,
                source: "v2_slot_owned_demand_adjustment_plan",
                readOnly: true,
                affectsScoringOrGeneration: false,
                status: "feasible",
                objective: {
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  protectLaggingTargetTierMuscles: true,
                  capLateBlockVolume: true,
                  preferRedistributionBeforeNetNewVolume: true,
                },
                protectedDemand: [
                  {
                    muscle: "Side Delts",
                    reason: "target_tier_under_hit:Side Delts",
                    targetTier: "B_SUPPORT",
                    priority: "P1",
                    requiredOwner: "SlotDemandAllocation",
                    candidateSlotOwners: ["upper_a", "upper_b"],
                    status: "owned",
                  },
                ],
                donorDemand: [
                  {
                    muscle: "Glutes",
                    reason: "over_concentration_or_fatigue:Glutes",
                    eligible: true,
                    eligibilityReason: "safe_surplus_margin",
                    candidateSlotOwners: ["lower_a", "lower_b"],
                  },
                  {
                    muscle: "Hamstrings",
                    reason: "over_concentration_or_fatigue:Hamstrings",
                    eligible: false,
                    eligibilityReason: "insufficient_margin",
                    candidateSlotOwners: ["lower_a"],
                  },
                ],
                slotBudgetPolicy: {
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  netNewVolumeAllowed: false,
                  maxSlotIncreaseAllowed: 0,
                  requireSlotOwnership: true,
                  requireFloorPreservation: true,
                  requirePriorityCoveragePreservation: true,
                },
                feasibility: {
                  readOnly: true,
                  affectsScoringOrGeneration: false,
                  status: "feasible",
                  blockingReasons: [],
                  unresolvedInputs: [],
                  nextRequiredEvidence: [
                    "priority_coverage_preservation_evidence",
                  ],
                },
                nextSafeAction: "add_strategy_to_demand_diff",
              },
              nonRegressionGates: {
                preservePriorityCoverage: false,
                preserveOrImproveLaggingMuscleCoverage: false,
                noMaterialRepairIncrease: false,
                noMajorRepairIncrease: false,
                noSuspiciousRepairIncrease: false,
                noDirtyCollateralIncrease: false,
                noForbiddenSlotWorkaround: false,
                noSessionSizeRegression: false,
                noConcentrationRegression: false,
                noLateBlockSkippedSetRiskIncrease: false,
              },
              nextSafeAction: "run_read_only_shadow_trial",
            },
            currentStateVsNorthStarGaps: [],
          },
          strategyToDemandProjection: {
            version: 1,
            source: "v2_strategy_to_demand_projection",
            readOnly: true,
            affectsScoringOrGeneration: false,
            consumedByDemandOrMaterializer: false,
            projectionMode: "read_only_non_mutating_join",
            status: "available_with_limitations",
            basis: {
              strategyToDemandDiff: true,
              mesocycleDemand: true,
              mesocycleDemandMutation: false,
              weeklyCurveMutation: false,
              slotAllocationMutation: false,
              setDistributionMutation: false,
            },
            rows: [
              {
                zone: "floor",
                scope: "muscle",
                muscle: "Side Delts",
                owner: "MesocycleDemand",
                action: "protect_floor",
                readiness: "read_only_diff",
                baseDemand: {
                  available: true,
                  role: "support",
                  targetStatus: "soft",
                  targetTier: "B_SUPPORT",
                  baselineSetRange: { min: 4, preferred: 6, max: 8 },
                  directSetFloor: 4,
                },
                currentProjection: {
                  rangeMutation: "none",
                  projectedRange: { min: 4, preferred: 6, max: 8 },
                  consumedByDemandOrMaterializer: false,
                },
                measuredCurrentNonRegression: {
                  measurementMode: "current_no_mutation_projection",
                  measured: true,
                  baselineRange: { min: 4, preferred: 6, max: 8 },
                  projectedRange: { min: 4, preferred: 6, max: 8 },
                  rangeDelta: { min: 0, preferred: 0, max: 0 },
                  netNewVolumeDelta: 0,
                  gateStatus: "pass",
                  behaviorProjectionMeasured: false,
                  limitations: [
                    "measures_only_current_no_mutation_projection_against_static_mesocycle_demand",
                  ],
                },
                behaviorPromotion: {
                  readiness: "not_behavior_ready",
                  requiredEvidence: [
                    "measured_week_by_week_demand_projection",
                  ],
                  nonRegressionGates: {
                    currentDemandUnchanged: "pass",
                    baseDemandKnown: "pass",
                    measuredCurrentProjection: "pass",
                    measuredBehaviorProjection: "unknown",
                    floorPreservation: "pass",
                    noNetNewVolume: "pass",
                  },
                },
                evidence: ["Side Delts:under_hit"],
                limitations: [
                  "future_behavior_candidate_projection_not_measured",
                ],
              },
            ],
            summary: {
              rowCount: 1,
              floorProtectionCount: 1,
              productiveMonitorCount: 0,
              stretchMonitorCount: 0,
              capRedistributionCount: 0,
              baseDemandMatchedCount: 1,
              currentNoMutationProjectionCount: 1,
              measuredCurrentProjectionCount: 1,
              measuredCurrentProjectionPassCount: 1,
              blockedCount: 0,
              monitorOnlyCount: 0,
              behaviorProjectionUnknownCount: 1,
            },
            measuredCurrentNonRegressionSummary: {
              measurementMode: "current_no_mutation_projection",
              measuredRowCount: 1,
              passCount: 1,
              unknownCount: 0,
              behaviorProjectionMeasured: false,
              maxAbsoluteRangeDelta: 0,
              totalNetNewVolumeDelta: 0,
            },
            candidateInventory: {
              version: 1,
              source: "v2_strategy_to_demand_candidate_inventory",
              readOnly: true,
              affectsScoringOrGeneration: false,
              consumedByDemandOrMaterializer: false,
              repairProjectionEvidenceUse: "evidence_only_never_target_policy",
              status: "available_with_limitations",
              rows: [
                {
                  evidenceSource: "performed_reality",
                  affected: {
                    muscle: "Side Delts",
                    slotIds: ["upper_a", "upper_b"],
                    laneIds: [],
                    weekNumbers: [],
                  },
                  proposedOwnerSeam: "MesocycleDemand",
                  suggestedFutureActionType: "protect_floor",
                  evidenceClass: "performed_reality",
                  readiness: "candidate_for_read_only_projection",
                  requiredProofBeforeBehavior: [
                    "measured_week_by_week_demand_projection",
                    "seed_runtime_receipt_db_non_consumption_must_remain_proven",
                  ],
                  sourceAttribution: ["Side Delts:under_hit"],
                  nonConsumption: {
                    demandOrMaterializer: false,
                    seedRuntimeReceiptDb: false,
                    acceptanceThreshold: false,
                  },
                },
              ],
              summary: {
                rowCount: 1,
                performedRealityCount: 1,
                benchmarkWatchCount: 0,
                noRepairProjectionCount: 0,
                repairOnlyCount: 0,
                blockedCount: 0,
                diagnosticOnlyCount: 0,
                candidateForReadOnlyProjectionCount: 1,
                ownerCounts: {
                  MesocycleDemand: 1,
                  WeeklyDemandCurve: 0,
                  SlotDemandAllocationByWeek: 0,
                  SetDistributionIntent: 0,
                  unknown: 0,
                },
                topCandidate: {
                  evidenceSource: "performed_reality",
                  muscle: "Side Delts",
                  proposedOwnerSeam: "MesocycleDemand",
                  suggestedFutureActionType: "protect_floor",
                  readiness: "candidate_for_read_only_projection",
                  requiredProofBeforeBehavior: [
                    "measured_week_by_week_demand_projection",
                  ],
                },
              },
              limitations: ["candidate_inventory_is_read_only_and_non_binding"],
            },
            boundedBehaviorTrial: {
              version: 1,
              source: "v2_strategy_to_demand_bounded_behavior_trial",
              readOnly: true,
              affectsScoringOrGeneration: false,
              consumedByDemandOrMaterializer: false,
              trialMode: "row_level_static_demand_delta",
              status: "available_with_limitations",
              redistributionContext: {
                source: "not_provided",
                available: false,
                protectedDemandCount: 0,
                protectedOwnedCount: 0,
                donorDemandCount: 0,
                eligibleDonorCount: 0,
                netNewVolumeAllowed: false,
                maxSlotIncreaseAllowed: 0,
                nextRequiredEvidence: [],
              },
              measuredRedistributionProjection: {
                version: 1,
                source:
                  "v2_strategy_to_demand_measured_redistribution_projection",
                readOnly: true,
                affectsScoringOrGeneration: false,
                consumedByDemandOrMaterializer: false,
                projectionMode: "measured_shadow_projection",
                status: "available_with_limitations",
                rows: [],
                summary: {
                  candidateCount: 1,
                  measuredCandidateCount: 1,
                  readyForBehaviorProjectionTrialCount: 0,
                  blockedByRegressionCount: 0,
                  passGateCount: 3,
                  failGateCount: 1,
                  unknownGateCount: 1,
                  totalNetNewVolumeDelta: 0,
                  materializerRepairDelta: -1,
                  majorRepairDelta: 0,
                  suspiciousRepairDelta: 0,
                  concentrationDelta: -1,
                },
                blockerSummary: {
                  status: "blocked",
                  projectionScope:
                    "combined_strategy_shadow_planner_only_no_repair",
                  independentCandidateProjectionAvailable: false,
                  blockedCandidateCount: 1,
                  floorRegressionMuscles: [],
                  donorOffsetMuscles: ["Glutes"],
                  donorSlotOwners: { Glutes: ["lower_a", "lower_b"] },
                  netNewVolumeRegressionCount: 1,
                  concentrationRegressionCount: 0,
                  materializerRegressionCount: 0,
                  acceptanceRiskCount: 1,
                  unknownEvidenceCount: 1,
                  unmeasuredGateCounts: {
                    downstreamContextAvailable: 0,
                    measuredShadowProjection: 0,
                    donorOffsetMeasured: 0,
                    noNetNewVolume: 0,
                    floorPreservation: 0,
                    concentrationNonRegression: 0,
                    materializerNonRegression: 1,
                    acceptanceRisk: 0,
                  },
                  failedComputedGates: [],
                  nextRequiredEvidence: ["resolve_unknown_measured_gates"],
                },
                alternateCandidateDiagnostic: {
                  status: "blocked",
                  measuredProjectionScope:
                    "combined_strategy_shadow_planner_only_no_repair",
                  currentDonorMuscles: ["Glutes"],
                  currentDonorSlotOwners: {
                    Glutes: ["lower_a", "lower_b"],
                  },
                  alternateEligibleDonorCount: 0,
                  alternateEligibleDonorMuscles: [],
                  excludedDonorMuscles: [],
                  ineligibleDonorCount: 0,
                  ineligibleDonorReasons: [],
                  protectedFloorRegressionMuscles: [],
                  requiredEvidence: ["resolve_unknown_measured_gates"],
                  nextSafeAction: "resolve_donor_pool_before_projection",
                },
                nextSafeAction: "keep_diagnostic_only",
                limitations: [
                  "measured_redistribution_projection_is_diagnostic_only",
                ],
              },
              rows: [],
              summary: {
                rowCount: 1,
                candidateCount: 1,
                blockedCount: 0,
                monitorOnlyCount: 0,
                readyForBehaviorCount: 0,
                netNewVolumeFailCount: 1,
                redistributionContextReadyCount: 0,
                redistributionContextMissingCount: 1,
                downstreamUnknownCount: 1,
                materializerUnknownCount: 1,
              },
              nextSafeAction: "add_slot_owned_redistribution_context",
              limitations: ["bounded_behavior_trial_is_diagnostic_only"],
            },
            nonMutationGates: {
              noMesocycleDemandMutation: "pass",
              noWeeklyCurveMutation: "pass",
              noSlotAllocationMutation: "pass",
              noSetDistributionMutation: "pass",
              noMaterializerRankingMutation: "pass",
              noSeedOrRuntimeImpact: "pass",
              noAcceptanceThresholdImpact: "pass",
            },
            nextSafeAction: "add_slot_owned_redistribution_context",
            limitations: ["read_only_non_mutating_join"],
          },
        },
      },
    } as unknown as WorkoutAuditArtifact;

    const compact = compactWorkoutAuditArtifactForSerialization(artifact);
    const noRepair = compact.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;
    const strategy = ((noRepair.v2Summary as Record<string, unknown>)
      .mesocycleStrategyDiagnostic ?? {}) as Record<string, unknown>;

    expect(strategy.strategyHypothesisPromotionReadiness).toMatchObject({
      status: "partially_ready",
      readOnly: true,
      affectsScoringOrGeneration: false,
      hypothesisCount: 2,
      hypothesisIds: [
        "protect_lagging_muscles_earlier",
        "cap_late_block_volume",
      ],
      readinessCounts: {
        ready_for_read_only_diff: 2,
      },
      proposedOwnerCounts: {
        MesocycleDemand: 1,
        WeeklyDemandCurve: 1,
      },
      nextSafeActionCounts: {
        add_read_only_diff: 2,
      },
      topMissingEvidenceCategories: [
        "slot_owner_for_protected_sets",
        "priority_target_coverage_preservation",
      ],
      globalBlockers: [
        "readiness_not_consumed_by_mesocycle_demand_or_materializer",
      ],
      consumedByDemandOrMaterializer: false,
    });
    expect(strategy.strategyToDemandProjection).toMatchObject({
      status: "available_with_limitations",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      projectionMode: "read_only_non_mutating_join",
      rowCount: 1,
      summary: {
        rowCount: 1,
        baseDemandMatchedCount: 1,
        currentNoMutationProjectionCount: 1,
        measuredCurrentProjectionCount: 1,
        measuredCurrentProjectionPassCount: 1,
        behaviorProjectionUnknownCount: 1,
      },
      measuredCurrentNonRegressionSummary: {
        measuredRowCount: 1,
        passCount: 1,
        unknownCount: 0,
        behaviorProjectionMeasured: false,
        maxAbsoluteRangeDelta: 0,
        totalNetNewVolumeDelta: 0,
      },
      candidateInventory: {
        status: "available_with_limitations",
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByDemandOrMaterializer: false,
        repairProjectionEvidenceUse: "evidence_only_never_target_policy",
        summary: {
          rowCount: 1,
          performedRealityCount: 1,
          candidateForReadOnlyProjectionCount: 1,
          ownerCounts: {
            MesocycleDemand: 1,
          },
          topCandidate: {
            evidenceSource: "performed_reality",
            muscle: "Side Delts",
            proposedOwnerSeam: "MesocycleDemand",
            suggestedFutureActionType: "protect_floor",
            readiness: "candidate_for_read_only_projection",
          },
        },
        limitationCount: 1,
      },
      boundedBehaviorTrial: {
        status: "available_with_limitations",
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByDemandOrMaterializer: false,
        trialMode: "row_level_static_demand_delta",
        summary: {
          rowCount: 1,
          candidateCount: 1,
          readyForBehaviorCount: 0,
          netNewVolumeFailCount: 1,
          redistributionContextReadyCount: 0,
          redistributionContextMissingCount: 1,
          downstreamUnknownCount: 1,
          materializerUnknownCount: 1,
        },
        redistributionContext: {
          source: "not_provided",
          available: false,
          eligibleDonorCount: 0,
        },
        measuredRedistributionProjection: {
          status: "available_with_limitations",
          projectionMode: "measured_shadow_projection",
          summary: {
            candidateCount: 1,
            measuredCandidateCount: 1,
            unknownGateCount: 1,
            materializerRepairDelta: -1,
          },
          blockerSummary: {
            status: "blocked",
            unknownEvidenceCount: 1,
            unmeasuredGateCounts: {
              materializerNonRegression: 1,
            },
            nextRequiredEvidence: ["resolve_unknown_measured_gates"],
          },
          alternateCandidateDiagnostic: {
            status: "blocked",
            currentDonorMuscles: ["Glutes"],
          },
        },
        nextSafeAction: "add_slot_owned_redistribution_context",
      },
      nonMutationGates: {
        noMesocycleDemandMutation: "pass",
        noWeeklyCurveMutation: "pass",
        noSlotAllocationMutation: "pass",
        noSetDistributionMutation: "pass",
        noMaterializerRankingMutation: "pass",
        noSeedOrRuntimeImpact: "pass",
        noAcceptanceThresholdImpact: "pass",
      },
      nextSafeAction: "add_slot_owned_redistribution_context",
    });
    expect(strategy.strategyHypothesisPromotionDiff).toMatchObject({
      status: "available_with_limitations",
      readOnly: true,
      affectsScoringOrGeneration: false,
      evaluatedHypothesisCount: 2,
      interactionRiskStatus: "available_with_limitations",
      nonRegressionGateStatus: {
        reported: false,
        reportedCount: 0,
        totalCount: 10,
        enforcedAsBehavior: false,
      },
      nextSafeAction: "run_read_only_shadow_trial",
      consumedByDemandOrMaterializer: false,
      donorSurplusEvidence: {
        status: "available_with_limitations",
        readOnly: true,
        affectsScoringOrGeneration: false,
        candidateCount: 2,
        eligibleCount: 1,
        unknownMarginCount: 0,
        protectedOverlapCount: 0,
        slotIncompatibleCount: 0,
        consumedByDemandOrMaterializer: false,
      },
      slotOwnedDemandAdjustmentPlan: {
        status: "feasible",
        readOnly: true,
        affectsScoringOrGeneration: false,
        protectedDemandCount: 1,
        donorDemandCount: 2,
        eligibleDonorCount: 1,
        slotBudgetPolicy: {
          netNewVolumeAllowed: false,
          maxSlotIncreaseAllowed: 0,
          requireSlotOwnership: true,
          requireFloorPreservation: true,
          requirePriorityCoveragePreservation: true,
        },
        feasibility: {
          status: "feasible",
          blockingReasonCount: 0,
          unresolvedInputCount: 0,
          nextRequiredEvidenceCount: 1,
        },
        nextSafeAction: "add_strategy_to_demand_diff",
      },
      projectionDiff: {
        status: "available_with_limitations",
        readOnly: true,
        affectsScoringOrGeneration: false,
        projectionMode: "read_only_estimate",
        candidateProtectedMuscleCount: 1,
        candidateDonorMuscleCount: 1,
        computedGateCounts: {
          pass: 0,
          fail: 0,
          unknown: 10,
        },
        conflictAwareRefinement: {
          enabled: true,
          readOnly: true,
          affectsScoringOrGeneration: false,
          status: "available_with_limitations",
          conflictCount: 1,
          conflictCountsByType: {
            session_size_cap_conflict: 1,
          },
          excludedDonorMuscleCount: 0,
          retainedDonorMuscleCount: 1,
          volumePolicy: {
            netNewVolumeAllowed: false,
            redistributionRequired: true,
            maxSlotSetIncreaseAllowed: 0,
          },
        },
        preShadowCandidateFilter: {
          enabled: true,
          readOnly: true,
          affectsScoringOrGeneration: false,
          status: "available_with_limitations",
          eligibleDonorCount: 1,
          excludedDonorCount: 1,
          retainedDonorCount: 1,
          excludedProtectedMuscleCount: 0,
          retainedProtectedMuscleCount: 1,
          consumedByDemandOrMaterializer: false,
        },
        readiness: "ready_for_read_only_shadow_trial",
        topLimitations: [
          "no_shadow_projection_rerun_yet",
          "computed_gates_default_unknown_without_projected_delta_evidence",
        ],
        consumedByDemandOrMaterializer: false,
      },
    });
    expect(JSON.stringify(strategy.strategyHypothesisPromotionDiff)).not.toContain(
      "targetTierMuscles",
    );
    expect(JSON.stringify(strategy.strategyHypothesisPromotionDiff)).not.toContain(
      "skipped_set_trend_rising",
    );
    expect(JSON.stringify(strategy.strategyHypothesisPromotionDiff)).not.toContain(
      "candidateDonorMuscles",
    );
    expect(JSON.stringify(strategy.strategyHypothesisPromotionDiff)).toContain(
      "preShadowCandidateFilter",
    );
    expect(JSON.stringify(strategy.strategyHypothesisPromotionDiff)).not.toContain(
      "donorEligibility",
    );
    expect(JSON.stringify(strategy.strategyHypothesisPromotionDiff)).not.toContain(
      "donorEvidence",
    );
    expect(JSON.stringify(strategy.strategyHypothesisPromotionDiff)).not.toContain(
      "Hamstrings",
    );
    expect(JSON.stringify(strategy.strategyHypothesisPromotionDiff)).not.toContain(
      "target_tier_under_hit",
    );
    expect(JSON.stringify(strategy.strategyHypothesisPromotionDiff)).not.toContain(
      "safe_surplus_margin",
    );
    expect(JSON.stringify(strategy.strategyHypothesisPromotionDiff)).not.toContain(
      "candidate projection increased slot set pressure",
    );
    expect(noRepair).not.toHaveProperty("v2MesocycleStrategyDiagnostic");
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
