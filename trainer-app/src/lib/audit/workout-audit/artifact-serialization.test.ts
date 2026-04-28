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

  it("keeps compact planner-only no-repair set-policy diagnostics under the audit artifact limit", () => {
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
                        "setBudget:within_planned_max",
                        "justification:none",
                        "concentration:Hack Squat:Quads:50%",
                      ],
                    },
                    gapCause: "concentration_policy_gap",
                    migrationRecommendation: "needs_concentration_justification",
                    severity: "quality_warning",
                  },
                ],
              },
            ],
            replacementReadinessImpact: {
              canReplaceRepairedProjection: false,
              blockers: ["read_only_non_generative_artifact"],
              nextBestMigrationSlice:
                "squat_anchor:needs_concentration_justification",
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

    expect(getSerializedJsonSizeBytes(compact)).toBeLessThan(
      WORKOUT_AUDIT_SIZE_LIMIT_BYTES
    );
    expect(serialized).toContain("setPolicy:quality_warning");
    expect(serialized).toContain("setBudget:within_planned_max");
    expect(serialized).toContain("justification:none");
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
      "setBudget:hard_blocker",
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
                "chest_anchor:needs_concentration_justification",
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
    const serialized = serializeStableJson(compact);
    const reparsed = JSON.parse(serialized) as WorkoutAuditArtifact;
    const noRepair = reparsed.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;
    const targetDiff = noRepair.v2TargetVsNoRepairDiff as Record<string, unknown>;
    const plan = noRepair.v2MesocyclePlan as Record<string, unknown>;
    const intent = noRepair.v2SetDistributionIntent as Record<string, unknown>;
    const classification = noRepair.acceptanceClassification as Record<string, unknown>;
    const hardBlockers = classification.hardBlockers as Array<Record<string, unknown>>;

    expect(WORKOUT_AUDIT_SIZE_LIMIT_BYTES - getSerializedJsonSizeBytes(compact)).toBeGreaterThan(
      100_000
    );
    expect(serialized).toContain("setPolicyReason:over_60_share");
    expect(hardBlockers[0]).toMatchObject({
      code: "primary_hard_target_excessive_single_exercise_share_unjustified",
      evidence: ["upper_a:Deficit Push-Up:Chest:64%:over_60_share"],
    });
    expect(targetDiff).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      replacementReadinessImpact: {
        nextBestMigrationSlice:
          "chest_anchor:needs_concentration_justification",
      },
    });
    expect(plan).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      skeleton: {
        targetDescriptorSource:
          "plannerOnlyNoRepair.v2SetDistributionIntent.catalogs.slotDefinitions",
      },
    });
    expect(intent).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      catalogs: {
        slotDefinitions: expect.any(Array),
      },
      weekSetBudgetGrid: expect.any(Array),
    });
    expect(noRepair).toHaveProperty("v2MesocyclePlan");
    expect(noRepair).toHaveProperty("v2TargetVsNoRepairDiff");
    expect(noRepair).toHaveProperty("v2SetDistributionIntent");
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
