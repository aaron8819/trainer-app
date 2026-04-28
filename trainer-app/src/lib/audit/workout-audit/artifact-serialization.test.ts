import { describe, expect, it } from "vitest";
import {
  buildArtifactDiffSummary,
  buildSerializedTopLevelSizeBreakdown,
  compactWorkoutAuditArtifactForSerialization,
  getSerializedJsonSizeBytes,
  serializeStableJson,
} from "./artifact-serialization";
import { WORKOUT_AUDIT_SIZE_LIMIT_BYTES } from "./constants";
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
        laneCounts: {
          target: 1,
          partial: 1,
          missing: 0,
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
        kind: "v2_planner_no_repair_debug",
        created: false,
        enableWith: "--v2-debug-artifact",
      },
    });
    expect(noRepair).not.toHaveProperty("v2MesocyclePlan");
    expect(noRepair).not.toHaveProperty("v2TargetVsNoRepairDiff");
    expect(noRepair).not.toHaveProperty("v2SetDistributionIntent");
    expect(noRepair).not.toHaveProperty("plannerOwnedAccumulationProjection");
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
        contains: expect.arrayContaining([
          "v2MesocyclePlan",
          "v2SetDistributionIntent",
          "plannerOwnedAccumulationProjection",
          "v2TargetVsNoRepairDiff",
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
        fileName: "parent-v2-no-repair-debug.json",
        relativePath: "artifacts/audits/parent-v2-no-repair-debug.json",
        sizeBytes: 1234,
        sha256: "abc123",
      },
    });
    const serialized = serializeStableJson(compact);
    const reparsed = JSON.parse(serialized) as WorkoutAuditArtifact;
    const noRepair = reparsed.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;

    expect(noRepair.debugArtifact).toMatchObject({
      kind: "v2_planner_no_repair_debug",
      created: true,
      fileName: "parent-v2-no-repair-debug.json",
      relativePath: "artifacts/audits/parent-v2-no-repair-debug.json",
      sizeBytes: 1234,
      sha256: "abc123",
      contains: expect.arrayContaining([
        "v2MesocyclePlan",
        "v2SetDistributionIntent",
        "plannerOwnedAccumulationProjection",
        "v2TargetVsNoRepairDiff",
      ]),
    });
    expect(noRepair.debugArtifact).not.toHaveProperty("enableWith");
    expect(serialized).not.toContain("concentration:chest_primary");
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
