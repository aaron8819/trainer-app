import { describe, expect, it } from "vitest";
import {
  buildV2PlannerMesocyclePolicy,
  buildV2StrategyHypothesisPreShadowCandidateFilter,
  type V2MesocycleStrategyInput,
  type V2StrategyHypothesisShadowProjectionEvidence,
} from "@/lib/engine/planning/v2";
import { buildV2LaneSelectionIntentAudit } from "@/lib/engine/planning/v2/lane-selection-intent-audit";
import { AUDIT_RECONSTRUCTION_GUARDRAIL } from "./constants";
import {
  buildWorkoutAuditArtifact,
  createWorkoutAuditArtifactOutput,
  serializeWorkoutAuditArtifact,
} from "./serializer";
import type { WorkoutAuditRun } from "./types";

const baseRun: WorkoutAuditRun = {
  context: {
    mode: "future-week",
    requestedMode: "future-week",
    userId: "user-1",
    ownerEmail: "owner@test.local",
    plannerDiagnosticsMode: "standard",
    generationInput: { intent: "push" },
  },
  generatedAt: "2026-03-04T00:00:00.000Z",
  generationResult: {
    workout: {
      id: "workout-1",
      scheduledDate: "2026-03-04",
      warmup: [],
      mainLifts: [],
      accessories: [],
      estimatedMinutes: 45,
    },
    selectionMode: "INTENT",
    sessionIntent: "push",
    selection: {
      selectedExerciseIds: [],
      mainLiftIds: [],
      accessoryIds: [],
      perExerciseSetTargets: {},
      rationale: {},
      volumePlanByMuscle: {},
    },
    sraWarnings: [],
    substitutions: [],
    volumePlanByMuscle: {},
  },
};

function expectSuccessfulGeneration(
  artifact: ReturnType<typeof buildWorkoutAuditArtifact>,
) {
  const generation = artifact.generation;
  if (!generation || "error" in generation) {
    throw new Error("expected successful generation artifact");
  }
  return generation;
}

function makePromotionDiffStrategyInput(): V2MesocycleStrategyInput {
  return {
    version: 1,
    userProfile: {
      trainingGoal: "hypertrophy",
      trainingAge: "intermediate",
      availableTrainingDays: 4,
      confidence: "medium",
    },
    currentTrainingContext: {
      split: "upper_lower",
      currentPhase: "AWAITING_HANDOFF",
      currentMesocycleStatus: "COMPLETED",
      weekCount: 5,
      slotSequence: ["upper_a", "lower_a", "upper_b", "lower_b"],
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
    },
    historicalMesocycles: [
      {
        mesocycleId: "history-a",
        sourcePlanner: "legacy_projection",
        status: "COMPLETED",
      },
      {
        mesocycleId: "history-b",
        sourcePlanner: "legacy_projection",
        status: "COMPLETED",
      },
    ],
    blockResponseSignals: [
      {
        mesocycleId: "history-a",
        sourcePlanner: "legacy_projection",
        adherence: {
          completedSessions: 14,
          skippedSetCount: 1,
          skippedSetTrend: "stable",
        },
        effortProgression: {
          averageRpeByWeek: [{ week: 4, averageRpe: 8.1 }],
          hardWeekEffortReached: true,
          deloadExecuted: true,
        },
        muscleDistribution: {
          recurringUnderHitMuscles: ["Side Delts"],
          belowMevFlags: ["Side Delts:below_target_or_mev_evidence"],
        },
        fatigueDistribution: {
          systemicFatigueFlag: false,
          likelyFatigueDrivers: [],
          evidence: ["hard_week_effort_reached"],
        },
        strategyImplications: ["protect_lagging_muscles_earlier"],
        confidence: "medium",
      },
      {
        mesocycleId: "history-b",
        sourcePlanner: "legacy_projection",
        adherence: {
          completedSessions: 13,
          skippedSetCount: 6,
          skippedSetTrend: "rising",
        },
        effortProgression: {
          averageRpeByWeek: [{ week: 4, averageRpe: 8.8 }],
          hardWeekEffortReached: true,
          deloadExecuted: true,
        },
        muscleDistribution: {
          recurringUnderHitMuscles: ["Side Delts", "Calves"],
          belowMevFlags: [
            "Side Delts:below_target_or_mev_evidence",
            "Calves:below_target_or_mev_evidence",
          ],
        },
        fatigueDistribution: {
          systemicFatigueFlag: true,
          likelyFatigueDrivers: ["Glutes"],
          evidence: ["late_block_skipped_sets_rising"],
        },
        strategyImplications: [
          "protect_lagging_muscles_earlier",
          "cap_late_block_volume",
        ],
        confidence: "medium",
      },
    ],
    exerciseResponseSignals: [],
    readinessAndRecoverySignals: {
      available: ["subjective_readiness"],
      missing: [],
    },
    evidenceLimitations: [
      "historical_mesocycles_are_validation_data_not_policy_targets",
    ],
  };
}

function makePromotionDiffShadowProjectionEvidence(): V2StrategyHypothesisShadowProjectionEvidence {
  return {
    version: 1,
    source: "v2_strategy_hypothesis_shadow_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    projectionMode: "shadow_projection",
    candidateHypotheses: [
      "protect_lagging_muscles_earlier",
      "cap_late_block_volume",
    ],
    baselineProjection: "planner_only_no_repair",
    candidateProjection: "combined_strategy_shadow_planner_only_no_repair",
    candidateStrategy: {
      candidateProtectedMuscles: ["Calves", "Side Delts"],
      candidateDonorMuscles: ["Glutes"],
      preferRedistributionBeforeNetNewVolume: true,
    },
    before: {
      priorityCoverage: {
        coveredCount: 1,
        belowMinimumCount: 1,
        aboveMaximumCount: 0,
        unknownCount: 0,
        totalCount: 2,
        examples: ["Side Delts:below_minimum:1_sets"],
      },
      laggingMuscleCoverage: [
        { muscle: "Calves", status: "covered", sets: 4 },
        { muscle: "Side Delts", status: "below_minimum", sets: 1 },
      ],
      sessionSize: {
        totalSetsBySlot: {
          lower_a: 14,
          lower_b: 14,
          upper_a: 15,
          upper_b: 18,
        },
      },
      concentration: { count: 2, summary: ["high_concentration_count:2"] },
      repairPressure: {
        materialRepairCount: 2,
        majorRepairCount: 1,
        suspiciousRepairCount: 1,
      },
      dirtyCollateral: { count: 0, summary: ["dirty_collateral_count:0"] },
      forbiddenSlotRisk: {
        count: 0,
        summary: ["forbidden_primary_violation_count:0"],
      },
      lateBlockFatigueRisk: {
        count: 2,
        totalSets: 61,
        maxSlotSets: 18,
        summary: ["high_concentration_count:2"],
      },
    },
    after: {
      priorityCoverage: {
        coveredCount: 2,
        belowMinimumCount: 0,
        aboveMaximumCount: 0,
        unknownCount: 0,
        totalCount: 2,
        examples: ["Side Delts:covered:3_sets"],
      },
      laggingMuscleCoverage: [
        { muscle: "Calves", status: "covered", sets: 4 },
        { muscle: "Side Delts", status: "covered", sets: 3 },
      ],
      sessionSize: {
        totalSetsBySlot: {
          lower_a: 14,
          lower_b: 13,
          upper_a: 17,
          upper_b: 17,
        },
      },
      concentration: { count: 1, summary: ["high_concentration_count:1"] },
      repairPressure: {
        materialRepairCount: 1,
        majorRepairCount: 1,
        suspiciousRepairCount: 1,
      },
      dirtyCollateral: { count: 0, summary: ["dirty_collateral_count:0"] },
      forbiddenSlotRisk: {
        count: 0,
        summary: ["forbidden_primary_violation_count:0"],
      },
      lateBlockFatigueRisk: {
        count: 1,
        totalSets: 61,
        maxSlotSets: 17,
        summary: ["high_concentration_count:1"],
      },
    },
    limitations: [
      "shadow_projection_is_planner_only_no_repair",
      "repaired_projection_excluded_from_projection_target",
      "old_prescribed_plan_shape_excluded_from_projection_target",
    ],
  };
}

function makePromotionDiffPreShadowCandidateFilter() {
  return buildV2StrategyHypothesisPreShadowCandidateFilter({
    evaluatesCombinedPair: true,
    candidateProtectedMuscles: ["Calves", "Side Delts"],
    candidateDonorMuscles: ["Glutes", "Hamstrings"],
    baseCoverageRows: [
      {
        muscle: "Glutes",
        status: "covered",
        sets: 12,
        minSets: 6,
        priority: "support",
        targetTier: "B_SUPPORT",
      },
      {
        muscle: "Hamstrings",
        status: "covered",
        sets: 6.2,
        minSets: 6,
        priority: "primary",
        targetTier: "A_PRIMARY",
      },
    ],
    donorSlotOwners: {
      Glutes: ["lower_a", "lower_b"],
      Hamstrings: ["lower_a"],
    },
    protectedSlotOwners: {
      Calves: ["lower_a", "lower_b"],
      "Side Delts": ["upper_a", "upper_b"],
    },
    slotSetCountBySlot: {
      lower_a: 14,
      lower_b: 14,
      upper_a: 15,
      upper_b: 18,
    },
    slotMaxSetCountBySlot: {
      lower_a: 18,
      lower_b: 16,
      upper_a: 20,
      upper_b: 21,
    },
    clearlyOverConcentratedMuscles: ["Glutes"],
  });
}

function makePlannerOwnedAccumulationProjection() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    weeks: ([2, 3, 4] as const).map((week) => ({
      week,
      phase:
        week === 4
          ? ("peak_overreach_lite" as const)
          : week === 3
            ? ("hard_accumulation" as const)
            : ("accumulation" as const),
      volumeMultiplier: week === 4 ? 1.125 : week === 3 ? 1.075 : 1,
      projectionStatus: "planner_owned_read_only" as const,
      safeForBehaviorPromotion: false as const,
      slots: [],
      validation: {
        unresolvedDemand: [],
        concentrationWarnings: [],
        duplicateWarnings: [],
        missingInputs: [],
      },
    })),
  };
}

function makeV2ExerciseSelectionPlanDiagnostic() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    status: "projected_with_limitations" as const,
    identityBasis: "week_1_selected_identities" as const,
    projectionBasis:
      "planner_owned_accumulation_projection_plus_week_1_identity_continuity" as const,
    summary: {
      weeksEvaluated: 4,
      lanesEvaluated: 1,
      preservedIdentityCount: 0,
      candidateAvailableCount: 0,
      missingCandidateCount: 1,
      classMismatchCount: 0,
      duplicateRequiresJustificationCount: 0,
      concentrationWarningCount: 0,
      blockedLaneCount: 0,
    },
    weeks: [
      {
        week: 1 as const,
        slots: [
          {
            slotId: "upper_a",
            lanes: [
              {
                laneId: "chest_anchor",
                plannedClass: ["horizontal_press"],
                primaryMuscles: ["Chest"],
                identityStatus: "missing_candidate" as const,
                laneClassStatus: "not_evaluated" as const,
                setBudgetStatus: "within_budget" as const,
                duplicateStatus: "pass" as const,
                concentrationStatus: "pass" as const,
                fatigueStatus: "not_evaluated" as const,
                inventoryStatus: "not_evaluated" as const,
                capacityStatus: "not_evaluated" as const,
                cleanAlternatives: [],
                unresolvedDemand: ["v2TargetVsNoRepairDiff:capacity_gap"],
                evidenceRefs: ["target_status:missing"],
                limitations: [
                  "week_1_selected_identity_basis",
                  "generic_per_lane_candidate_inventory_not_available",
                ],
              },
            ],
          },
        ],
      },
    ],
    blockers: [],
    warnings: ["week_1:upper_a:chest_anchor:inventory_not_evaluated"],
    missingInputs: [],
    safeForBehaviorPromotion: false as const,
  };
}

function makeV2SupportLaneProjectionDiagnostic() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    status: "projected_with_limitations" as const,
    summary: {
      supportMusclesEvaluated: 4,
      directFloorsMet: 1,
      directFloorsBelow: 3,
      optionalActivations: 1,
      expansionRecommendations: 3,
      unrecoverableExpansions: 0,
      supportPolicyMissCount: 0,
      setBudgetAuthoredCount: 1,
      authoredDroppedCount: 1,
      selectionPreservedCount: 0,
      highRiskDroppedCount: 1,
      diagnosticOnlyWarnings: 4,
    },
    laneBoundaryRows: [
      {
        muscle: "Triceps" as const,
        slotId: "upper_b",
        laneId: "optional_triceps_if_under_target",
        laneKind: "optional_top_up" as const,
        supportPolicyAuthored: true,
        setDistributionBudgeted: true,
        setBudget: { min: 2, preferred: 2, max: 2 },
        exerciseSelectionPreserved: false,
        exerciseSelectionStatus: "missing_candidate" as const,
        weeklyTargetStatus: "below" as const,
        projectedEffectiveSets: 5,
        mevFloor: 6,
        likelyOwnerSeam: "materializer_exercise_selection_capacity" as const,
        status: "authored_support_lane_dropped" as const,
        severity: "high_risk" as const,
        mustFixBeforeWeek1: true,
        evidence: [
          "supportPolicyAuthored:yes",
          "setDistributionBudgeted:yes",
          "exerciseSelectionPreserved:no",
        ],
        limitations: [
          "authored_budget_not_preserved_after_exercise_selection",
        ],
      },
    ],
    muscles: [
      {
        muscle: "Triceps" as const,
        ownerSlots: ["upper_a", "upper_b"],
        directFloor: 2,
        preferredDirectSets: 3,
        currentDirectSets: 2,
        collateralCreditUsed: 1,
        collateralCreditLimit: 2,
        weeklyTargetStatus: "below" as const,
        directFloorStatus: "met" as const,
        optionalActivationStatus: "triggered_diagnostic_only" as const,
        expansionStatus: "recoverable" as const,
        rationale: ["direct_floor_satisfaction_uses_direct_lane_sets_only"],
        limitations: ["optional_activation_does_not_create_hard_floor"],
      },
    ],
    blockers: [],
    warnings: ["Triceps:optional_activation_triggered_diagnostic_only"],
    missingInputs: [],
    safeForBehaviorPromotion: false as const,
  };
}

function makeV2SelectionCapacityPlanDiagnostic() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    status: "projected_with_limitations" as const,
    summary: {
      weeksEvaluated: 1,
      slotsEvaluated: 1,
      lanesEvaluated: 1,
      targetMetNoActionCount: 0,
      capacityPressureCount: 1,
      capAwareExpansionNeededCount: 0,
      optionalSuppressedCount: 0,
      blockerCount: 0,
      laneInspectionCategoryCounts: {
        must_preserve: 1,
        floor_critical: 0,
        productive_support: 0,
        optional_stretch: 0,
        redundant_duplicate: 0,
        high_fatigue_trim_candidate: 0,
        unknown: 0,
      },
    },
    weeks: [
      {
        week: 1,
        slots: [
          {
            slotId: "upper_a",
            exerciseCount: 6,
            maxExerciseCount: 6,
            setCount: 18,
            targetSessionSets: { min: 12, preferred: 16, max: 18 },
            lanes: [
              {
                laneId: "row_anchor",
                classification: "capacity_pressure" as const,
                inspectionCategory: "must_preserve" as const,
                selectedExercise: "Chest-Supported Row",
                selectedSets: 4,
                setBudget: { min: 3, preferred: 4, max: 4 },
                perExerciseCap: 5,
                weeklyTargetStatus: "within" as const,
                slotHeadroom: 0,
                setHeadroom: 0,
                cleanAlternativeCount: null,
                optionalEligibility: "not_applicable" as const,
                evidence: ["capacityPressure:upper_pull_distribution"],
                limitations: [
                  "slot_at_exercise_capacity_no_clean_additional_headroom",
                ],
              },
            ],
          },
        ],
      },
    ],
    blockers: [],
    warnings: ["week_1:upper_a:row_anchor:capacity_pressure"],
    missingInputs: [],
    capacityPolicyTrialDesign: {
      version: 1 as const,
      source: "v2_selection_capacity_plan_diagnostic" as const,
      readOnly: true as const,
      affectsScoringOrGeneration: false as const,
      consumedByDemandOrMaterializer: false as const,
      status: "design_only" as const,
      trialId: "upper_a_max_exercise_count_plus_one_projection_only",
      scope: "read_only_projection_only" as const,
      candidateChange: {
        kind: "slot_max_exercise_count_delta" as const,
        slotId: "upper_a",
        delta: 1 as const,
        reason: "zero_headroom_capacity_pressure_or_floor_critical_lanes",
      },
      targetSlots: ["upper_a"],
      basis: {
        targetSlotId: "upper_a",
        targetSlotWeek: 1,
        targetSlotExerciseCount: 6,
        targetSlotMaxExerciseCount: 6,
        targetSlotSetCount: 18,
        targetSlotMaxSets: 18,
        targetSlotFloorCriticalLaneCount: 0,
        targetSlotCapacityPressureLaneCount: 1,
        targetSlotMustPreserveLaneCount: 1,
        targetSlotProductiveSupportLaneCount: 0,
        totalFloorCriticalLaneCount: 0,
        totalCapacityPressureLaneCount: 1,
        totalOptionalStretchLaneCount: 0,
        totalHighFatigueTrimCandidateLaneCount: 0,
        totalRedundantDuplicateLaneCount: 0,
      },
      gates: ([
        "hard_floors",
        "over_mav",
        "session_size",
        "five_set_stacking",
        "lane_survival",
        "duplicates",
        "materializer_validity",
        "acceptance_result",
      ] as const).map((gateId) => ({
        gateId,
        status: "requires_projection" as const,
        ownerSeam: "diagnostic_projection",
        requiredEvidence: ["read_only_projection"],
        currentEvidence: ["not_run"],
        failureMeaning: "do_not_promote_behavior",
      })),
      blockersBeforeBehavior: [
        "read_only_capacity_projection_not_run",
        "materializer_validity_not_measured",
        "acceptance_gate_not_rerun",
        "candidate_impact_not_measured",
      ],
      nextSafeAction: "run_read_only_capacity_behavior_projection" as const,
      limitations: ["design_only_not_a_simulation"],
      safeForBehaviorPromotion: false as const,
    },
    capacityBehaviorProjection: {
      version: 1 as const,
      source: "v2_selection_capacity_plan_diagnostic" as const,
      readOnly: true as const,
      affectsScoringOrGeneration: false as const,
      consumedByDemandOrMaterializer: false as const,
      status: "projected_with_limitations" as const,
      projectionMode: "slot_cap_delta_existing_evidence_only" as const,
      trialId: "upper_a_max_exercise_count_plus_one_projection_only",
      candidateImpact: {
        selectedIdentityDelta: 0 as const,
        weeklyVolumeDelta: 0 as const,
        capacityPressureRowsBefore: 1,
        capacityPressureRowsAfter: 0,
        capacityPressureRowsRelieved: 1,
        floorCriticalRowsBefore: 0,
        floorCriticalRowsAfter: 0,
        optionalStretchRowsActivated: 0 as const,
        regressionCount: 0,
        regressions: [],
        improvements: ["capacity_pressure_rows_relieved:1"],
      },
      projectedSlots: [
        {
          week: 1,
          slotId: "upper_a",
          exerciseCount: 6,
          maxExerciseCountBefore: 6,
          maxExerciseCountAfter: 7,
          slotHeadroomBefore: 0,
          slotHeadroomAfter: 1,
          setCount: 18,
          targetSessionMaxSets: 18,
          setHeadroom: 0,
          capacityPressureRowsBefore: 1,
          capacityPressureRowsAfter: 0,
          floorCriticalRowsBefore: 0,
          floorCriticalRowsAfter: 0,
          mustPreserveRows: 1,
          productiveSupportRows: 0,
          sessionSizeStatus: "within_limits" as const,
        },
      ],
      gates: ([
        ["hard_floors", "pass"],
        ["over_mav", "pass"],
        ["session_size", "pass"],
        ["five_set_stacking", "pass"],
        ["lane_survival", "pass"],
        ["duplicates", "pass"],
        ["materializer_validity", "unknown"],
        ["acceptance_result", "unknown"],
      ] as const).map(([gateId, status]) => ({
        gateId,
        status,
        measured: status !== "unknown",
        ownerSeam: "diagnostic_projection",
        evidence: ["read_only_projection"],
        regressions: [],
        requiredNextEvidence:
          status === "unknown" ? ["stronger_projection_evidence"] : [],
      })),
      blockersBeforeBehavior: [
        "materializer_validity_not_measured",
        "acceptance_gate_not_rerun",
        "candidate_identity_impact_not_measured",
      ],
      nextSafeAction: "run_read_only_materializer_capacity_projection" as const,
      limitations: ["cap_delta_only_existing_evidence_projection"],
      safeForBehaviorPromotion: false as const,
    },
    safeForBehaviorPromotion: false as const,
  };
}

function makeV2DeloadProjectionDiagnostic() {
  return {
    version: 1 as const,
    source: "v2_deload_projection_diagnostic" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    status: "projected_with_limitations" as const,
    identityBasis: "week_1_selected_identities" as const,
    projectionBasis: "v2_deload_transform_read_only" as const,
    slots: [
      {
        slotId: "upper_a",
        lanes: [
          {
            laneId: "chest_anchor",
            status: "projected_with_limitations" as const,
            limitations: ["diagnostic_only_not_runtime_consumed"],
            exercises: [
              {
                preservedIdentity: {
                  exerciseId: "bench",
                  exerciseName: "Bench Press",
                  sourceWeek: 1 as const,
                },
                week1Sets: 4,
                deloadProjectedSets: 2,
                setReductionPercent: 50,
                targetRir: "4-5",
                introducesNewMovement: false as const,
                status: "projected" as const,
                limitations: [
                  "diagnostic_only_not_runtime_consumed",
                  "preserves_week_1_identity",
                ],
              },
            ],
          },
        ],
      },
    ],
    summary: {
      identitiesPreservedCount: 1,
      movementsIntroducedCount: 0,
      totalWeek1Sets: 4,
      totalDeloadProjectedSets: 2,
      volumeReductionPercent: 50,
      blockedLaneCount: 0,
      warningCount: 0,
    },
    blockers: [],
    warnings: [],
    missingInputs: [],
    safeForBehaviorPromotion: false as const,
  };
}

describe("buildWorkoutAuditArtifact", () => {
  it("keeps identity fields in live mode", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        sanitizationLevel: "none",
      },
      baseRun,
    );

    expect(artifact.source).toBe("live");
    expect(artifact.version).toBe(4);
    expect(artifact.mode).toBe("future-week");
    expect(artifact.identity.userId).toBe("user-1");
    expect(artifact.identity.ownerEmail).toBe("owner@test.local");
    expect(artifact.request.userId).toBe("user-1");
    expect(artifact.request.ownerEmail).toBe("owner@test.local");
    expect(artifact.conclusions.next_session_basis.sourceFunction).toBe(
      "loadNextWorkoutContext",
    );
    expect(artifact.warningSummary.blockingErrors).toEqual([]);
    expect(artifact.warningSummary.counts).toEqual({
      blockingErrors: 0,
      semanticWarnings: 0,
      backgroundWarnings: 0,
    });
  });

  it("keeps CLI timing readout out of serialized artifacts", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        ownerEmail: "owner@test.local",
      },
      baseRun,
    );
    const serialized = JSON.parse(serializeWorkoutAuditArtifact(artifact));

    expect(serialized).not.toHaveProperty("timing");
    expect(JSON.stringify(serialized)).not.toContain("workout-audit:timing");
  });

  it("redacts identity fields in pii-safe mode", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        sanitizationLevel: "pii-safe",
      },
      baseRun,
    );

    expect(artifact.source).toBe("pii-safe");
    expect(artifact.identity.userId).toBe("redacted");
    expect(artifact.identity.ownerEmail).toBeUndefined();
    expect(artifact.request.userId).toBeUndefined();
    expect(artifact.request.ownerEmail).toBeUndefined();
  });

  it("normalizes outward-facing muscle scope in rich generation artifacts", () => {
    const baseGenerationResult = baseRun.generationResult;
    if (!baseGenerationResult || "error" in baseGenerationResult) {
      throw new Error("expected successful base generation fixture");
    }

    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        targetMuscles: ["Abs", "Core", "Chest"],
      },
      {
        ...baseRun,
        generationResult: {
          ...baseGenerationResult,
          volumePlanByMuscle: {
            Abs: { target: 0, planned: 2, delta: -2 },
            Core: { target: 0, planned: 1, delta: -1 },
            Chest: { target: 0, planned: 5, delta: -5 },
          },
          selection: {
            ...baseGenerationResult.selection,
            volumePlanByMuscle: {
              Abs: { target: 0, planned: 3, delta: -3 },
              Core: { target: 0, planned: 1, delta: -1 },
            },
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 3,
                weekInBlock: 3,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              targetMuscles: ["Abs", "Core", "Chest"],
              lifecycleVolume: {
                targets: {
                  Abs: 7,
                  Core: 8,
                  Chest: 14,
                },
                source: "lifecycle",
              },
              sorenessSuppressedMuscles: ["Abs", "Core"],
              deloadDecision: {
                mode: "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              plannerDiagnosticsMode: "debug",
              plannerDiagnostics: {
                opportunity: {
                  opportunityKey: "upper",
                  sessionIntent: "upper",
                  sessionCharacter: "upper",
                  planningInventoryKind: "standard",
                  closureInventoryKind: "closure",
                  targetMuscles: ["Abs", "Core"],
                  currentSessionMuscleOpportunity: {
                    Abs: {
                      sessionOpportunityWeight: 1,
                      weeklyTarget: 7,
                      performedEffectiveVolumeBeforeSession: 1,
                      startingDeficit: 6,
                      futureOpportunityUnits: 1,
                      weeklyOpportunityUnits: 2,
                      futureCapacity: 1,
                      requiredNow: 2,
                      urgencyMultiplier: 1.2,
                    },
                    Core: {
                      sessionOpportunityWeight: 2,
                      weeklyTarget: 8,
                      performedEffectiveVolumeBeforeSession: 2,
                      startingDeficit: 6,
                      futureOpportunityUnits: 2,
                      weeklyOpportunityUnits: 3,
                      futureCapacity: 2,
                      requiredNow: 1,
                      urgencyMultiplier: 1.5,
                    },
                  },
                },
                muscles: {
                  Abs: {
                    weeklyTarget: 7,
                    performedEffectiveVolumeBeforeSession: 1,
                    plannedEffectiveVolumeAfterRoleBudgeting: 2,
                    projectedEffectiveVolumeAfterRoleBudgeting: 3,
                    deficitAfterRoleBudgeting: 4,
                    plannedEffectiveVolumeAfterClosure: 4,
                    projectedEffectiveVolumeAfterClosure: 5,
                    finalRemainingDeficit: 2,
                  },
                  Core: {
                    weeklyTarget: 8,
                    performedEffectiveVolumeBeforeSession: 2,
                    plannedEffectiveVolumeAfterRoleBudgeting: 3,
                    projectedEffectiveVolumeAfterRoleBudgeting: 4,
                    deficitAfterRoleBudgeting: 4,
                    plannedEffectiveVolumeAfterClosure: 5,
                    projectedEffectiveVolumeAfterClosure: 6,
                    finalRemainingDeficit: 2,
                  },
                },
                exercises: {
                  crunch: {
                    exerciseId: "crunch",
                    exerciseName: "Cable Crunch",
                    assignedSetCount: 4,
                    stimulusVector: {
                      Abs: 2,
                      Core: 1,
                    },
                    anchorUsed: {
                      kind: "muscle",
                      muscle: "abs",
                    },
                    isRoleFixture: false,
                    isClosureAddition: false,
                    isSetExpandedCarryover: false,
                    closureSetDelta: 0,
                  },
                },
                closure: {
                  actions: [],
                },
                outcome: {
                  layersUsed: ["anchor", "closure"],
                  startingDeficits: {
                    Abs: {
                      weeklyTarget: 7,
                      performedEffectiveVolumeBeforeSession: 1,
                      plannedEffectiveVolume: 0,
                      projectedEffectiveVolume: 1,
                      remainingDeficit: 6,
                    },
                    Core: {
                      weeklyTarget: 8,
                      performedEffectiveVolumeBeforeSession: 2,
                      plannedEffectiveVolume: 0,
                      projectedEffectiveVolume: 2,
                      remainingDeficit: 6,
                    },
                  },
                  deficitsAfterBaseSession: {},
                  deficitsAfterSupplementation: {},
                  deficitsAfterClosure: {
                    Abs: {
                      weeklyTarget: 7,
                      performedEffectiveVolumeBeforeSession: 1,
                      plannedEffectiveVolume: 2,
                      projectedEffectiveVolume: 3,
                      remainingDeficit: 4,
                    },
                    Core: {
                      weeklyTarget: 8,
                      performedEffectiveVolumeBeforeSession: 2,
                      plannedEffectiveVolume: 3,
                      projectedEffectiveVolume: 4,
                      remainingDeficit: 4,
                    },
                  },
                  unresolvedDeficits: ["Abs", "Core"],
                  keyTradeoffs: [
                    {
                      layer: "closure",
                      code: "core_tradeoff",
                      message: "Core work was preserved.",
                      muscle: "Abs",
                    },
                  ],
                },
              },
              readiness: {
                wasAutoregulated: false,
                signalAgeHours: null,
                fatigueScoreOverall: null,
                intensityScaling: {
                  applied: false,
                  exerciseIds: [],
                  scaledUpCount: 0,
                  scaledDownCount: 0,
                },
              },
              exceptions: [],
            },
          },
        },
      },
    );

    const generation = expectSuccessfulGeneration(artifact);

    expect(artifact.request.targetMuscles).toEqual(["Core", "Chest"]);
    expect(generation.volumePlanByMuscle).toEqual({
      Chest: 5,
      Core: 3,
    });
    expect(generation.selection.volumePlanByMuscle).toEqual({
      Core: 4,
    });
    expect(
      generation.selection.sessionDecisionReceipt?.lifecycleVolume.targets,
    ).toEqual({
      Chest: 14,
      Core: 15,
    });
    expect(generation.selection.sessionDecisionReceipt?.targetMuscles).toEqual([
      "Core",
      "Chest",
    ]);
    expect(
      generation.selection.sessionDecisionReceipt?.sorenessSuppressedMuscles,
    ).toEqual(["Core"]);
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics
        ?.opportunity?.currentSessionMuscleOpportunity,
    ).toEqual({
      Core: {
        sessionOpportunityWeight: 3,
        weeklyTarget: 15,
        performedEffectiveVolumeBeforeSession: 3,
        startingDeficit: 12,
        futureOpportunityUnits: 3,
        weeklyOpportunityUnits: 5,
        futureCapacity: 3,
        requiredNow: 3,
        urgencyMultiplier: 1.5,
      },
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.muscles,
    ).toEqual({
      Core: {
        weeklyTarget: 15,
        performedEffectiveVolumeBeforeSession: 3,
        plannedEffectiveVolumeAfterRoleBudgeting: 5,
        projectedEffectiveVolumeAfterRoleBudgeting: 7,
        deficitAfterRoleBudgeting: 8,
        plannedEffectiveVolumeAfterClosure: 9,
        projectedEffectiveVolumeAfterClosure: 11,
        finalRemainingDeficit: 4,
      },
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.exercises
        .crunch.stimulusVector,
    ).toEqual({
      Core: 3,
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.exercises
        .crunch.anchorUsed,
    ).toEqual({
      kind: "muscle",
      muscle: "Core",
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.startingDeficits,
    ).toEqual({
      Core: {
        weeklyTarget: 15,
        performedEffectiveVolumeBeforeSession: 3,
        plannedEffectiveVolume: 0,
        projectedEffectiveVolume: 3,
        remainingDeficit: 12,
      },
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.deficitsAfterClosure,
    ).toEqual({
      Core: {
        weeklyTarget: 15,
        performedEffectiveVolumeBeforeSession: 3,
        plannedEffectiveVolume: 5,
        projectedEffectiveVolume: 7,
        remainingDeficit: 8,
      },
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.unresolvedDeficits,
    ).toEqual(["Core"]);
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.keyTradeoffs,
    ).toEqual([
      {
        layer: "closure",
        code: "core_tradeoff",
        message: "Core work was preserved.",
        muscle: "Core",
      },
    ]);
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.muscles
        .Abs,
    ).toBeUndefined();
  });

  it("classifies generation errors as blocking warnings", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
      },
      {
        ...baseRun,
        generationResult: { error: "generation exploded" },
      },
    );

    expect(artifact.warningSummary.blockingErrors).toEqual([
      "generation exploded",
    ]);
    expect(artifact.warningSummary.semanticWarnings).toEqual([]);
    expect(artifact.warningSummary.counts.blockingErrors).toBe(1);
  });

  it("warns when generated load and target effort imply an unrealistic progression jump", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
      },
      {
        ...baseRun,
        sessionSnapshot: {
          version: 1,
          generated: {
            selectionMode: "INTENT",
            sessionIntent: "lower",
            semantics: {
              kind: "advancing",
              effectiveSelectionMode: "INTENT",
              isDeload: false,
              isStrictGapFill: false,
              isStrictSupplemental: false,
              advancesLifecycle: true,
              consumesWeeklyScheduleIntent: true,
              countsTowardCompliance: true,
              countsTowardRecentStimulus: true,
              countsTowardWeeklyVolume: true,
              countsTowardProgressionHistory: true,
              countsTowardPerformanceHistory: true,
              updatesProgressionAnchor: true,
              eligibleForUniqueIntentSubtraction: true,
              reasons: [],
              trace: {
                advancesSplitInput: true,
              },
            },
            exerciseCount: 1,
            hardSetCount: 3,
            exercises: [
              {
                exerciseId: "sldl",
                exerciseName: "Stiff-Legged Deadlift",
                orderIndex: 0,
                section: "main",
                isMainLift: true,
                prescribedSetCount: 3,
                prescribedSets: [
                  {
                    setIndex: 1,
                    targetReps: 10,
                    targetRpe: 6.5,
                    targetLoad: 140,
                  },
                ],
              },
            ],
            traces: {
              progression: {
                sldl: {
                  version: 1,
                  decisionSource: "double_progression",
                  repRange: { min: 6, max: 10 },
                  equipment: "barbell",
                  anchor: {
                    source: "conservative_modal",
                    workingSetApplied: false,
                    anchorLoad: 135,
                    signalSetCount: 5,
                    effectiveSetCount: 5,
                    trimmedSetCount: 0,
                    highVarianceDetected: false,
                    minSignalLoad: 135,
                    maxSignalLoad: 135,
                    medianSignalLoad: 135,
                  },
                  confidence: {
                    priorSessionCount: 1,
                    sampleScale: 0.8,
                    historyScale: 1,
                    combinedScale: 0.8,
                    reasons: [],
                  },
                  metrics: {
                    medianReps: 6,
                    modalRpe: 8.5,
                    nextLoad: 140,
                    loadDelta: 5,
                  },
                  outcome: {
                    path: "path_5_overshoot",
                    action: "increase",
                    reasonCodes: [
                      "performed_above_prescription",
                      "controlled_hard_overshoot_progression",
                    ],
                  },
                  decisionLog: [
                    "Path 5 fired: performed load beat prescription.",
                  ],
                },
              },
            },
          },
        },
      },
    );

    expect(artifact.warningSummary.semanticWarnings).toContain(
      "target_effort_load_mismatch: Stiff-Legged Deadlift generated 140 lb for 10 reps @ RPE 6.5 after prior anchor 135 lb, median 6 reps @ RPE 8.5; load delta +5 lb while prior reps/effort do not support the easier target.",
    );
    expect(artifact.warningSummary.counts.semanticWarnings).toBe(1);
  });

  it("adds normalized canonical semantics when a session snapshot is available", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
      },
      {
        ...baseRun,
        sessionSnapshot: {
          version: 1,
          generated: {
            selectionMode: "INTENT",
            sessionIntent: "push",
            cycleContext: {
              weekInMeso: 5,
              weekInBlock: 1,
              phase: "deload",
              blockType: "deload",
              isDeload: true,
              source: "computed",
            },
            semantics: {
              kind: "advancing",
              effectiveSelectionMode: "INTENT",
              isDeload: true,
              isStrictGapFill: false,
              isStrictSupplemental: false,
              advancesLifecycle: true,
              consumesWeeklyScheduleIntent: true,
              countsTowardCompliance: true,
              countsTowardRecentStimulus: true,
              countsTowardWeeklyVolume: true,
              countsTowardProgressionHistory: false,
              countsTowardPerformanceHistory: false,
              updatesProgressionAnchor: false,
              eligibleForUniqueIntentSubtraction: true,
              reasons: [],
              trace: {
                advancesSplitInput: true,
              },
            },
            exerciseCount: 0,
            hardSetCount: 0,
            exercises: [],
            traces: {
              progression: {},
            },
          },
        },
      },
    );

    expect(artifact.canonicalSemantics).toEqual({
      sourceLayer: "generated",
      phase: "deload",
      isDeload: true,
      countsTowardProgressionHistory: false,
      countsTowardPerformanceHistory: false,
      updatesProgressionAnchor: false,
    });
  });

  it("persists merged captured warnings and generation path metadata", () => {
    const baseGenerationResult = baseRun.generationResult;
    if (!baseGenerationResult || "error" in baseGenerationResult) {
      throw new Error("expected base generation result");
    }

    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
      },
      {
        ...baseRun,
        context: {
          ...baseRun.context,
          mode: "future-week",
          requestedMode: "future-week",
        },
        generationPath: {
          requestedMode: "future-week",
          executionMode: "active_deload_reroute",
          generator: "generateDeloadSessionFromIntent",
          reason: "active_mesocycle_state_active_deload",
        },
        generationResult: {
          ...baseGenerationResult,
          selection: {
            ...baseGenerationResult.selection,
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 2,
                weekInBlock: 2,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              sessionProvenance: {
                mesocycleId: "meso-1",
                compositionSource: "persisted_slot_plan_seed",
              },
              lifecycleVolume: {
                source: "unknown",
              },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              readiness: {
                wasAutoregulated: false,
                signalAgeHours: null,
                fatigueScoreOverall: null,
                intensityScaling: {
                  applied: false,
                  exerciseIds: [],
                  scaledUpCount: 0,
                  scaledDownCount: 0,
                },
              },
              exceptions: [],
            },
          },
          sraWarnings: [
            {
              muscle: "Chest",
              recoveryPercent: 62,
              lastTrainedHoursAgo: 36,
              sraWindowHours: 72,
            },
          ],
        },
      },
      {
        capturedWarnings: {
          blockingErrors: [],
          semanticWarnings: [
            "[template-session] Section/role mismatch detected for bench",
          ],
          backgroundWarnings: [
            "[stimulus-profile:fallback] Ab Wheel Rollout using centralized fallback mapper.",
          ],
        },
      },
    );

    expect(artifact.generationPath).toEqual({
      requestedMode: "future-week",
      executionMode: "active_deload_reroute",
      generator: "generateDeloadSessionFromIntent",
      reason: "active_mesocycle_state_active_deload",
    });
    expect(artifact.generationProvenance).toEqual({
      receiptProvenance: {
        mesocycleId: "meso-1",
        compositionSource: "persisted_slot_plan_seed",
      },
      auditOnly: {
        generationPath: {
          requestedMode: "future-week",
          executionMode: "active_deload_reroute",
          generator: "generateDeloadSessionFromIntent",
          reason: "active_mesocycle_state_active_deload",
        },
      },
    });
    expect(
      JSON.parse(serializeWorkoutAuditArtifact(artifact)).generationProvenance,
    ).toEqual(artifact.generationProvenance);
    const generation = expectSuccessfulGeneration(artifact);
    expect(
      generation.selection.sessionDecisionReceipt?.sessionProvenance,
    ).toEqual({
      mesocycleId: "meso-1",
      compositionSource: "persisted_slot_plan_seed",
    });
    expect(
      (generation.selection.sessionDecisionReceipt as Record<string, unknown>)
        .generationPath,
    ).toBeUndefined();
    expect(artifact.warningSummary.semanticWarnings).toEqual([
      "Chest: recovery=62% last_trained_hours=36",
      "[template-session] Section/role mismatch detected for bench",
    ]);
    expect(artifact.warningSummary.backgroundWarnings).toEqual([
      "[stimulus-profile:fallback] Ab Wheel Rollout using centralized fallback mapper.",
    ]);
    expect(artifact.warningSummary.counts).toEqual({
      blockingErrors: 0,
      semanticWarnings: 2,
      backgroundWarnings: 1,
    });
  });

  it("summarizes missing legacy receipt provenance safely", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
      },
      {
        ...baseRun,
        generationPath: {
          requestedMode: "future-week",
          executionMode: "standard_generation",
          generator: "generateSessionFromIntent",
          reason: "standard_future_week_or_preview",
        },
      },
    );

    expect(artifact.generationProvenance).toEqual({
      receiptProvenance: {
        mesocycleId: null,
        compositionSource: null,
      },
      auditOnly: {
        generationPath: {
          requestedMode: "future-week",
          executionMode: "standard_generation",
          generator: "generateSessionFromIntent",
          reason: "standard_future_week_or_preview",
        },
      },
    });
    expect(artifact.generationPath).toEqual(
      artifact.generationProvenance?.auditOnly.generationPath,
    );
  });

  it("serializes compact accepted seed provenance consistency in generationProvenance", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
      },
      {
        ...baseRun,
        generationPath: {
          requestedMode: "future-week",
          executionMode: "standard_generation",
          generator: "generateSessionFromIntent",
          reason: "standard_future_week_or_preview",
        },
        acceptedSeedProvenanceConsistency: {
          version: 1,
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          status: "suspicious",
          seed: {
            available: true,
            source: "handoff_slot_plan_projection",
            plannerMetadataSource: "v2_planner_policy",
            targetSkeletonId: "upper_lower_4x_v2",
            executableShape: "set_aware",
          },
          warnings: [
            {
              code: "SEED_SOURCE_LEGACY_WITH_V2_PLANNER_METADATA",
              severity: "warning",
              evidence:
                "mesocycleId=meso-1 seed.source=handoff_slot_plan_projection plannerMetadataSource=v2_planner_policy",
            },
          ],
        },
      },
    );
    const serialized = JSON.parse(serializeWorkoutAuditArtifact(artifact));

    expect(
      serialized.generationProvenance.seed.provenanceConsistency.warnings,
    ).toEqual([
      expect.objectContaining({
        code: "SEED_SOURCE_LEGACY_WITH_V2_PLANNER_METADATA",
        severity: "warning",
      }),
    ]);
    expect(
      JSON.stringify(serialized.generationProvenance.seed.provenanceConsistency),
    ).not.toContain("acceptedPlannerIntent");
  });

  it("adds do-not-reconstruct guardrails for saved-only legacy audit coverage", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "progression-anchor",
        userId: "user-1",
        exerciseId: "exercise-1",
      },
      {
        ...baseRun,
        context: {
          ...baseRun.context,
          mode: "progression-anchor",
          requestedMode: "progression-anchor",
          generationInput: undefined,
        },
        generationResult: undefined,
        progressionAnchor: {
          version: 1,
          workoutId: "workout-1",
          exerciseId: "exercise-1",
          exerciseName: "Bench Press",
          scheduledDate: "2026-03-04T00:00:00.000Z",
          sessionSnapshotSource: "reconstructed_saved_only",
          trace: {
            version: 1,
            decisionSource: "double_progression",
            repRange: {
              min: 8,
              max: 10,
            },
            equipment: "barbell",
            anchor: {
              source: "conservative_modal",
              workingSetApplied: false,
              anchorLoad: 200,
              signalSetCount: 1,
              effectiveSetCount: 1,
              trimmedSetCount: 0,
              highVarianceDetected: false,
              minSignalLoad: 200,
              maxSignalLoad: 200,
              medianSignalLoad: 200,
            },
            confidence: {
              priorSessionCount: 0,
              sampleScale: 1,
              historyScale: 1,
              combinedScale: 1,
              reasons: [],
            },
            metrics: {
              medianReps: 8,
              modalRpe: 8,
              nextLoad: 200,
              loadDelta: 0,
            },
            outcome: {
              path: "fallback_hold",
              action: "hold",
              reasonCodes: ["no_change"],
            },
            decisionLog: [],
          },
        },
      },
    );

    expect(artifact.warningSummary.semanticWarnings).toContain(
      `${AUDIT_RECONSTRUCTION_GUARDRAIL} Progression-anchor coverage is using a saved-only reconstructed snapshot.`,
    );
  });

  it("serializes projected-week-volume payloads without changing unrelated audit fields", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "projected-week-volume",
        userId: "user-1",
      },
      {
        ...baseRun,
        context: {
          mode: "projected-week-volume",
          requestedMode: "projected-week-volume",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          projectedWeekVolume: {
            enabled: true,
          },
        },
        generationResult: undefined,
        projectedWeekVolume: {
          version: 1,
          currentWeek: {
            mesocycleId: "meso-1",
            week: 2,
            phase: "accumulation",
            blockType: "accumulation",
          },
          projectionNotes: [],
          completedVolumeByMuscle: {},
          projectedSessions: [],
          fullWeekByMuscle: [],
        },
      },
    );

    expect(artifact.mode).toBe("projected-week-volume");
    expect(artifact.projectedWeekVolume).toMatchObject({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 2,
      },
    });
    expect(artifact.generation).toBeUndefined();
    expect(artifact.warningSummary.counts).toEqual({
      blockingErrors: 0,
      semanticWarnings: 0,
      backgroundWarnings: 0,
    });
  });

  it("serializes weekly-retro projection delivery drift when present", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "weekly-retro",
        userId: "user-1",
        week: 3,
        mesocycleId: "meso-1",
        projectionArtifactPath: "C:\\artifacts\\projection.json",
      },
      {
        ...baseRun,
        context: {
          mode: "weekly-retro",
          requestedMode: "weekly-retro",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          weeklyRetro: {
            week: 3,
            mesocycleId: "meso-1",
            projectionArtifactPath: "C:\\artifacts\\projection.json",
          },
        },
        generationResult: undefined,
        weeklyRetro: {
          version: 1,
          week: 3,
          mesocycleId: "meso-1",
          executiveSummary: {
            status: "stable",
            generatedLayerCoverage: "full",
            sessionCount: 3,
            advancingSessionCount: 3,
            progressionEligibleCount: 3,
            progressionExcludedCount: 0,
            driftSessionCount: 0,
            belowMevCount: 0,
            underTargetCount: 0,
            overMavCount: 0,
            slotIdentityIssueCount: 0,
            highlights: [],
          },
          loadCalibration: {
            status: "aligned",
            comparableSessionCount: 3,
            driftSessionCount: 0,
            prescriptionChangeCount: 0,
            selectionDriftCount: 0,
            legacyLimitedSessionCount: 0,
            highlightedSessions: [],
          },
          sessionExecution: {
            summary: {
              sessionCount: 3,
              advancingCount: 3,
              gapFillCount: 0,
              supplementalCount: 0,
              deloadCount: 0,
              progressionEligibleCount: 3,
              progressionExcludedCount: 0,
              weekCloseRelevantCount: 0,
              persistedSnapshotCount: 3,
              reconstructedSnapshotCount: 0,
              mutationDriftCount: 0,
              statusCounts: { COMPLETED: 3 },
              intentCounts: { PUSH: 1, PULL: 1, LEGS: 1 },
            },
            sessions: [],
          },
          slotBalance: {
            status: "balanced",
            advancingSessionCount: 3,
            identifiedSlotCount: 3,
            missingSlotIdentityCount: 0,
            duplicateSlotCount: 0,
            intentMismatchCount: 0,
            missingSlotIdentityWorkoutIds: [],
            duplicateSlots: [],
            intentMismatches: [],
          },
          volumeTargeting: {
            status: "within_expected_band",
            belowMev: [],
            underTargetOnly: [],
            overMav: [],
            overTargetOnly: [],
            muscles: [],
          },
          planAdherence: {
            plannedWorkCompletedPercent: 100,
            plannedWorkMissedSets: 0,
            plannedWorkTotalSets: 45,
            plannedWorkCompletedSets: 45,
            explainedAdditions: {
              totalSets: 0,
              byIntent: {},
            },
            substitutions: 0,
            painFatigueDeviations: 0,
            unclassifiedDrift: 0,
            engineConfidenceImpact: "none",
            interpretations: [],
          },
          projectionDeliveryDrift: {
            status: "comparable",
            baseline: {
              generatedAt: "2026-04-01T12:00:00.000Z",
              projectedSessionCount: 2,
            },
            summary: {
              direction: "aligned",
              materialUnderdeliveryCount: 0,
              materialOverdeliveryCount: 0,
              netEffectiveSetDelta: 0,
            },
            muscles: [],
            limitations: [],
          },
          interventions: [],
          rootCauses: [],
          recommendedPriorities: [],
        },
      },
    );

    expect(artifact.mode).toBe("weekly-retro");
    expect(artifact.weeklyRetro?.projectionDeliveryDrift).toEqual({
      status: "comparable",
      baseline: {
        generatedAt: "2026-04-01T12:00:00.000Z",
        projectedSessionCount: 2,
      },
      summary: {
        direction: "aligned",
        materialUnderdeliveryCount: 0,
        materialOverdeliveryCount: 0,
        netEffectiveSetDelta: 0,
      },
      muscles: [],
      limitations: [],
    });
    expect(artifact.projectedWeekVolume).toBeUndefined();
  });

  it("serializes current-week-audit payloads as projected-week output plus guidance fields", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "current-week-audit",
        userId: "user-1",
      },
      {
        ...baseRun,
        context: {
          mode: "current-week-audit",
          requestedMode: "current-week-audit",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          projectedWeekVolume: {
            enabled: true,
          },
        },
        generationResult: undefined,
        projectedWeekVolume: {
          version: 1,
          currentWeek: {
            mesocycleId: "meso-1",
            week: 4,
            phase: "accumulation",
            blockType: "accumulation",
          },
          projectionNotes: [],
          completedVolumeByMuscle: {},
          projectedSessions: [],
          fullWeekByMuscle: [],
          currentWeekAudit: {
            belowMEV: [],
            overMAV: ["Glutes"],
            underTargetClusters: [],
            belowPreferred: [],
            fatigueRisks: ["Glutes projects 2.0 sets over MAV"],
          },
          interventionHints: [],
          sessionRisks: [],
        },
      },
    );

    expect(artifact.mode).toBe("current-week-audit");
    expect(artifact.projectedWeekVolume).toMatchObject({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 4,
      },
      currentWeekAudit: {
        overMAV: ["Glutes"],
      },
      interventionHints: [],
      sessionRisks: [],
    });
    expect(artifact.generation).toBeUndefined();
  });

  it("serializes active-mesocycle-slot-reseed payloads without attaching generation fields", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "active-mesocycle-slot-reseed",
        userId: "user-1",
      },
      {
        ...baseRun,
        context: {
          mode: "active-mesocycle-slot-reseed",
          requestedMode: "active-mesocycle-slot-reseed",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          activeMesocycleSlotReseed: {
            enabled: true,
          },
        },
        generationResult: undefined,
        activeMesocycleSlotReseed: {
          version: 1,
          activeMesocycle: {
            mesocycleId: "meso-1",
            mesoNumber: 3,
            state: "ACTIVE_ACCUMULATION",
            week: 3,
            splitType: "UPPER_LOWER",
            targetSlotIds: ["upper_a", "upper_b"],
          },
          executiveSummary: ["Verdict: safe_to_apply_bounded_reseed."],
          persistedSeedResolution: {
            sourceModule: "slot-plan-seed.ts",
            sourceFunction: "readPersistedSeedSlots",
            runtimeRule: "normalize persisted slot seed",
          },
          freshReprojection: {
            sourceModule: "mesocycle-handoff-slot-plan-projection.ts",
            sourceFunction: "projectSuccessorSlotPlansFromSnapshot",
            runtimeRule: "reproject candidate slot seed",
          },
          candidateSessionEvaluation: {
            sourceModule: "projected-week-volume-shared.ts",
            sourceFunction: "generateProjectedSession",
            runtimeRule: "generate candidate seeded sessions",
          },
          diffArtifactDescription: "upper-slot dry-run diff",
          slotDiffs: [],
          aggregateMuscleDiff: [],
          flags: {
            improvesChestSupport: true,
            improvesTricepsSupport: true,
            improvesSideDeltSupport: false,
            improvesRearDeltSupport: false,
            improvesTierBSupport: false,
            reducesStackingPressure: false,
            reducesLowerFatigue: false,
            reducesUpperSessionDuration: false,
            preservesRowAndVerticalPullWhereAppropriate: true,
            avoidsNewObviousOvershoot: true,
            preservesSlotIdentity: true,
            materiallyChangesExerciseSelection: true,
          },
          recommendation: {
            verdict: "safe_to_apply_bounded_reseed",
            reasons: ["push support improved"],
          },
        },
      },
    );

    expect(artifact.mode).toBe("active-mesocycle-slot-reseed");
    expect(artifact.activeMesocycleSlotReseed).toMatchObject({
      version: 1,
      activeMesocycle: {
        mesocycleId: "meso-1",
        week: 3,
      },
      recommendation: {
        verdict: "safe_to_apply_bounded_reseed",
      },
    });
    expect(artifact.generation).toBeUndefined();
  });

  it("serializes replace-empty V2 candidate identity summaries without making them seed truth", () => {
    const candidateIdentitySummary = {
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
          laneId: "chest_press",
          laneRole: "anchor",
          seedRole: "CORE_COMPOUND",
          selectedExercise: {
            exerciseId: "v2-bench",
            name: "V2 Bench",
          },
          setCount: 3,
          topAlternatives: [],
        },
      ],
    };
    const replaceEmptyMesocycleWithV2 = {
      version: 1,
      source: "replace_empty_mesocycle_with_v2",
      dryRun: true,
      writeRequested: false,
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      owner: { email: "owner@test.local", userId: "user-1" },
      targetMesocycleId: "meso-1",
      replacementSemantics: {
        strategy: "update_existing_empty_mesocycle_in_place",
        preservesMesocycleId: true,
        updates: ["slotPlanSeedJson"],
        preserves: [
          "slotSequenceJson",
          "workouts",
          "workoutSets",
          "setLogs",
          "runtimeReplay",
          "defaultHandoffAcceptance",
        ],
      },
      candidateSafety: {
        checked: true,
        allowed: true,
        blockers: [],
        target: {
          found: true,
          mesocycleId: "meso-1",
          ownerEmail: "owner@test.local",
        },
        evidence: {
          workoutCount: 0,
          completedOrPartialSessionCount: 0,
          workoutExerciseRowCount: 0,
          workoutSetRowCount: 0,
          setLogCount: 0,
          performedSetLogCount: 0,
          runtimeDeviationCount: 0,
          performedRealityEmpty: true,
          replacingWillOrphanPerformedHistory: false,
        },
      },
      v2Preparation: {
        status: "ready",
        blockers: [],
        basePlanValidation: {
          status: "pass",
          passed: true,
          blockerCount: 0,
          warningCount: 0,
        },
        materializerStatus: "materialized",
        promotionReadinessStatus: "eligible_for_guarded_write",
        seedShapeCompatibility: {
          compatible: true,
          slotCount: 1,
          exerciseCount: 1,
          missingNameCount: 0,
          duplicateExerciseIdWithinSlotCount: 0,
          invalidRoleCount: 0,
          invalidSetCount: 0,
          unsupportedClassCount: 0,
        },
        candidateIdentitySummary,
        productionWriteGates: {
          acceptancePathDesigned: true,
          slotPlanSeedJsonWriteGateDesigned: true,
          receiptContractDesigned: true,
          runtimeReplayContractVerified: true,
          auditSerializationContractDesigned: true,
          rollbackStrategyDefined: true,
        },
        helperStatus: "ready",
        helperProvenanceSource: "v2_materialized_seed",
      },
      seedComparison: {
        currentAvailable: true,
        v2Available: true,
        slotIdsInOrder: {
          current: ["upper_a"],
          v2: ["upper_a"],
          sameOrder: true,
        },
        totalSetCount: {
          current: 3,
          v2: 3,
        },
        changedSlotIds: ["upper_a"],
      },
      seedRuntimeBoundary: {
        serializer: "buildMesocycleSlotPlanSeed",
        handcraftedSlotPlanSeedJson: false,
        executableRowFields: ["exerciseId", "role", "setCount"],
        acceptedPlannerIntentRuntimeInert: true,
        runtimeReplayUnchanged: true,
        runtimeConsumesPlannerMetadata: false,
      },
      provenance: {
        source: "v2_materialized_seed",
        operation: "replace_empty_mesocycle",
        owner: "owner@test.local",
        targetMesocycleId: "meso-1",
        noLoggedWorkoutsVerified: true,
        noPerformedSetsVerified: true,
        serializer: "buildMesocycleSlotPlanSeed",
        dbWriteOccurred: false,
        transactionStatus: "not_requested",
        fallbackStatus: "none",
        runtimeReplayUnchanged: true,
      },
      write: {
        requested: false,
        confirmationProvided: false,
        eligible: true,
        dbWriteOccurred: false,
        transactionStatus: "not_requested",
      },
      guardrails: {
        requiresExplicitOwnerEmail: true,
        requiresExplicitMesocycleId: true,
        requiresExplicitReplacementFlag: true,
        writeRequiresExplicitConfirmation: true,
        blocksWhenWorkoutRowsExist: true,
        blocksWhenPerformedSetLogsExist: true,
        doesNotMutateWorkouts: true,
        doesNotMutateRuntimeLogs: true,
        doesNotMutateHistoricalMesocycles: true,
        doesNotChangeDefaultAcceptRoute: true,
        doesNotChangeRuntimeReplay: true,
        v2BlockedFailsClosed: true,
        fallbackCannotBeLabeledV2Success: true,
      },
    } as WorkoutAuditRun["replaceEmptyMesocycleWithV2"];
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "replace-empty-mesocycle-with-v2",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        mesocycleId: "meso-1",
      },
      {
        ...baseRun,
        context: {
          mode: "replace-empty-mesocycle-with-v2",
          requestedMode: "replace-empty-mesocycle-with-v2",
          userId: "user-1",
          ownerEmail: "owner@test.local",
          plannerDiagnosticsMode: "standard",
          replaceEmptyMesocycleWithV2: {
            mesocycleId: "meso-1",
          },
        },
        generationResult: undefined,
        replaceEmptyMesocycleWithV2,
      },
    );
    const serialized = JSON.parse(serializeWorkoutAuditArtifact(artifact));

    expect(serialized.replaceEmptyMesocycleWithV2.v2Preparation).toMatchObject({
      candidateIdentitySummary,
    });
    expect(
      serialized.replaceEmptyMesocycleWithV2.seedRuntimeBoundary.executableRowFields,
    ).toEqual(["exerciseId", "role", "setCount"]);
    expect(serialized.generation).toBeUndefined();
  });

  it("serializes v2 accepted-seed prepare compare payloads without attaching generation fields", () => {
    const v2AcceptedSeedPrepareCompare = {
      version: 1,
      source: "v2_accepted_seed_prepare_compare_audit",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      compareStatus: "available",
      handoffCandidate: {
        found: true,
        resolvedBy: "explicit_mesocycle_id",
        mesocycleId: "meso-1",
        state: "AWAITING_HANDOFF",
      },
      boundaryFacts: {
        readOnly: true,
        noWrite: true,
        consumedByProduction: false,
        v2PreviewAvailable: true,
        v2ProductionWriteEligible: false,
        seedSerializer: "buildMesocycleSlotPlanSeed",
        legacyProjectionCalledByV2Path: false,
        repairCalledByV2Path: false,
        transactionStatus: "no_write",
      },
    } as WorkoutAuditRun["v2AcceptedSeedPrepareCompare"];
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "v2-accepted-seed-prepare-compare",
        userId: "user-1",
        mesocycleId: "meso-1",
      },
      {
        ...baseRun,
        context: {
          mode: "v2-accepted-seed-prepare-compare",
          requestedMode: "v2-accepted-seed-prepare-compare",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          v2AcceptedSeedPrepareCompare: {
            mesocycleId: "meso-1",
            requestedIdSource: "mesocycle_id",
          },
        },
        generationResult: undefined,
        v2AcceptedSeedPrepareCompare,
      },
    );

    expect(artifact.mode).toBe("v2-accepted-seed-prepare-compare");
    expect(artifact.v2AcceptedSeedPrepareCompare).toMatchObject({
      readOnly: true,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      compareStatus: "available",
      boundaryFacts: {
        v2PreviewAvailable: true,
        v2ProductionWriteEligible: false,
        seedSerializer: "buildMesocycleSlotPlanSeed",
        transactionStatus: "no_write",
      },
    });
    expect(artifact.generation).toBeUndefined();
  });

  it("serializes next-mesocycle handoff dry-run payloads without attaching generation fields", () => {
    const nextMesocycleHandoffDryRun = {
      version: 1,
      source: "next_mesocycle_handoff_dry_run_audit",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      summary: {
        writes: "no",
        sourceMesocycleId: "source-1",
        sourceState: "AWAITING_HANDOFF",
        candidateAvailable: true,
        handoffReady: true,
        blockingReason: null,
        preparationPath: "prepareMesocycleHandoffAcceptance",
        transactionStatus: "not_started",
      },
      wouldPrepareWriteSummary: {
        successorSource: "prepared_handoff_projection",
        slotSequence: "upper_a > upper_b",
        seedShape: "version=1 slots=2 exercises=2",
        slotPlanSeedSource: "handoff_slot_plan_projection",
        legacyProjectionUse: "candidate_truth_when_no_v2_draft",
        trainingBlocksCount: 2,
        carriedRolesCount: 1,
        constraintsAction: "would_upsert_constraints",
        sourceCompletionAction: "would_mark_source_completed",
        transactionBoundary: "dry-run stops before transaction",
        noDbWritesOccur: true,
      },
      persistedDraftTruth: {
        status: "not_available",
        source: null,
        seedShape: "not_available",
        slotCount: 0,
        exerciseCount: 0,
        minimalExecutableRowsOnly: false,
        parserCompatible: false,
      },
      candidateIdentity: {
        status: "available",
        rows: [
          {
            slotId: "upper_a",
            laneOrRole: "CORE_COMPOUND",
            exerciseId: "bench",
            exerciseName: "Bench Press",
            setCount: 3,
            source: "prepared_slotPlanSeedJson",
          },
        ],
      },
      seedShapeSummary: {
        slotPlanSeedJson: "would_be_built",
        truthBasis: "prepared_acceptance_seed",
        wouldBeBuilt: true,
        minimalExecutableRowsOnly: true,
        executableFields: ["exerciseId", "role", "setCount"],
        serializerPath: "buildMesocycleSlotPlanSeed",
        slotCount: 2,
        exerciseCount: 2,
        seedSource: "handoff_slot_plan_projection",
        parserCompatible: true,
      },
      weeklyVolumeFloorCapSummary: {
        status: "not_available",
        basis: "prepared seed has no volume rows",
        rows: [],
      },
      acceptanceGatePayloadSummary: {
        checks: [
          {
            check: "candidate identity gate",
            enoughData: true,
            basis: "candidate seed contains exercise identity rows",
          },
        ],
      },
      weekOneRuntimeReplayPreview: {
        status: "seed_order_preview_only",
        runtimeReplayInstantiated: false,
        rows: [
          {
            slotId: "upper_a",
            exerciseName: "Bench Press",
            role: "CORE_COMPOUND",
            setCount: 3,
          },
        ],
        limitation: "successor not persisted",
      },
      modeComparison: [
        {
          mode: "mesocycle-explain",
          distinction: "diagnostic preview only",
        },
      ],
      safety: {
        writes: "no",
        dbMutated: false,
        mesocycleCreated: false,
        workoutLogSessionCreated: false,
        seedRuntimeBehaviorChanged: false,
        plannerMaterializerBehaviorChanged: false,
        transactionExecuted: false,
      },
    } as WorkoutAuditRun["nextMesocycleHandoffDryRun"];
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "next-mesocycle-handoff-dry-run",
        userId: "user-1",
        sourceMesocycleId: "source-1",
      },
      {
        ...baseRun,
        context: {
          mode: "next-mesocycle-handoff-dry-run",
          requestedMode: "next-mesocycle-handoff-dry-run",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          nextMesocycleHandoffDryRun: {
            sourceMesocycleId: "source-1",
          },
        },
        generationResult: undefined,
        nextMesocycleHandoffDryRun,
      },
    );

    expect(artifact.mode).toBe("next-mesocycle-handoff-dry-run");
    expect(artifact.nextMesocycleHandoffDryRun).toMatchObject({
      readOnly: true,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      summary: {
        writes: "no",
        sourceState: "AWAITING_HANDOFF",
        handoffReady: true,
      },
      safety: {
        dbMutated: false,
        mesocycleCreated: false,
        transactionExecuted: false,
      },
    });
    expect(artifact.generation).toBeUndefined();
  });

  it("serializes post-accept successor verification payloads without attaching generation fields", () => {
    const nextMesocyclePostAcceptVerification = {
      version: 1,
      source: "next_mesocycle_post_accept_verification_audit",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      verificationResult: "safe_to_train",
      recommendation: "persisted successor is safe to train from for Week 1",
      sourceMesocycle: {
        id: "source-1",
        state: "COMPLETED",
        isActive: false,
        macroCycleId: "macro-1",
        mesoNumber: 1,
      },
      successorMesocycle: {
        id: "successor-1",
        requestedId: "successor-1",
        state: "ACTIVE_ACCUMULATION",
        isActive: true,
        macroCycleId: "macro-1",
        mesoNumber: 2,
        activeMesocycleId: "successor-1",
      },
      acceptedSeedIdentity: {
        preAcceptPersistedDraftSeedHash: null,
        successorSlotPlanSeedHash: "successor-seed-hash",
        hashesMatch: false,
        source: {
          preAccept: null,
          successor: "handoff_slot_plan_projection",
          matches: false,
        },
        anchorRows: {
          preAccept: [],
          successor: [
            {
              slotId: "upper_a",
              exerciseId: "bench",
              exerciseName: "Bench Press",
              setCount: 4,
            },
          ],
          matches: false,
        },
        rowCount: {
          preAccept: 0,
          successor: 1,
          matches: false,
        },
        slotOrder: {
          preAccept: [],
          successor: ["upper_a"],
          matches: false,
        },
      },
      seedContract: {
        slotPlanSeedJson: "available",
        source: "handoff_slot_plan_projection",
        slotCount: 1,
        exerciseCount: 1,
        minimalExecutableRowsOnly: true,
        executableFields: ["exerciseId", "role", "setCount"],
        missingSetCount: 0,
        extraExecutableRowFieldCount: 0,
      },
      slotSequence: {
        available: true,
        hasPersistedSequence: true,
        orderStable: true,
        slotOrder: ["upper_a"],
        seedSlotOrder: ["upper_a"],
      },
      futureWeekReplay: {
        status: "available",
        compositionSource: "persisted_slot_plan_seed",
        generationPath: "standard_generation",
        nextSlotId: "upper_a",
        generatedExerciseOrder: ["bench"],
        seedExerciseOrder: ["bench"],
        exerciseOrderMatchesSeed: true,
        generatedExerciseCount: 1,
        progressionTraceCount: 1,
        cautionCount: 0,
      },
      prescriptionConfidence: {
        status: "available",
        summary: {
          rowCount: 1,
          lowConfidenceCount: 0,
          cautionCount: 0,
          runtimeOnlyCount: 0,
          classificationCounts: { exact_history: 1 },
        },
        rows: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            classification: "exact_history",
            confidence: "high",
            loadSource: "history",
            cautionLevel: "none",
            cautionReason: null,
            targetLoad: 205,
            ownerSeam: "future-week prescription readout",
            evidence: "loadSource=history confidence=high caution=none",
          },
        ],
      },
      projectedWeekVolume: {
        status: "available",
        currentWeek: 1,
        mesocycleId: "successor-1",
        projectedSessionCount: 1,
        allProjectedSessionsSeedBacked: true,
        mismatchedSlots: [],
      },
      readModels: {
        homeNextSessionSlotSource: "mesocycle_slot_sequence",
        programExerciseSources: ["persisted_slot_plan_seed"],
        allProgramRowsSeedBacked: true,
      },
      provenance: {
        status: "valid",
        warningCodes: [],
        receiptCompositionSource: "persisted_slot_plan_seed",
      },
      checks: [
        {
          check: "Week 1 future-week replays persisted seed",
          status: "pass",
          evidence: "compositionSource=persisted_slot_plan_seed",
          ownerSeam: "template-session seeded runtime replay",
          mustFixBeforeWeek1: true,
        },
      ],
      safety: {
        writes: "no",
        dbMutated: false,
        mesocycleCreated: false,
        workoutLogSessionCreated: false,
        seedRuntimeBehaviorChanged: false,
        plannerMaterializerBehaviorChanged: false,
        transactionExecuted: false,
      },
    } as WorkoutAuditRun["nextMesocyclePostAcceptVerification"];
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "next-mesocycle-post-accept-verification",
        userId: "user-1",
        sourceMesocycleId: "source-1",
        mesocycleId: "successor-1",
      },
      {
        ...baseRun,
        context: {
          mode: "next-mesocycle-post-accept-verification",
          requestedMode: "next-mesocycle-post-accept-verification",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          nextMesocyclePostAcceptVerification: {
            sourceMesocycleId: "source-1",
            successorMesocycleId: "successor-1",
          },
        },
        generationResult: undefined,
        nextMesocyclePostAcceptVerification,
      },
    );

    expect(artifact.mode).toBe("next-mesocycle-post-accept-verification");
    expect(artifact.nextMesocyclePostAcceptVerification).toMatchObject({
      readOnly: true,
      consumedByProduction: false,
      wouldWriteTransaction: false,
      verificationResult: "safe_to_train",
      safety: {
        dbMutated: false,
        mesocycleCreated: false,
        transactionExecuted: false,
      },
    });
    expect(artifact.generation).toBeUndefined();
  });

  it("serializes mesocycle-explain payloads without attaching generation fields", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "mesocycle-explain",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        sourceMesocycleId: "meso-source",
        retrospectiveMesocycleId: "meso-retro",
      },
      {
        ...baseRun,
        context: {
          mode: "mesocycle-explain",
          requestedMode: "mesocycle-explain",
          userId: "user-1",
          ownerEmail: "owner@test.local",
          plannerDiagnosticsMode: "standard",
          mesocycleExplain: {
            sourceMesocycleId: "meso-source",
            retrospectiveMesocycleId: "meso-retro",
          },
        },
        generationResult: undefined,
        mesocycleExplain: {
          version: 1,
          sourceMesocycleId: "meso-source",
          retrospectiveMesocycleId: "meso-retro",
          preview: {
            sourceMesocycleId: "meso-source",
            rationaleBasis: "reconstructed_now",
            designBasis: {
              focus: "hypertrophy",
              splitType: "UPPER_LOWER",
              sessionsPerWeek: 4,
              daysPerWeek: 4,
              durationWeeks: 5,
              volumeTarget: "MEDIUM",
              intensityBias: "MODERATE",
              profileReasonCodes: [],
              structureReasonCodes: [],
              startingPointReasonCodes: [],
            },
            carryForwardReasons: [],
            slotPlans: [],
            projectedSessions: [],
            projectionDiagnostics: {
              label: "projection diagnostics",
              readOnly: true,
              affectsScoringOrGeneration: false,
              summary: {
                setStackingPressure: 0,
                duplicateExercisePressure: 0,
                diversityPenalties: 0,
                hingeSquatBalance: 0,
                isolationInjectionTriggers: 0,
                softCapsOverriddenByP0: 0,
              },
              constraintsTriggered: [],
              tradeoffs: [],
              softCapOverridesByP0: [],
            },
            exerciseRationale: [],
          },
          seed: {
            mesocycleId: "meso-retro",
            available: false,
            slotPlans: [],
            exerciseRationale: [],
          },
          reality: {
            mesocycleId: "meso-retro",
            workoutCount: 0,
            generatedVsSaved: [],
            runtimeDrift: [],
            exerciseRationale: [],
          },
          comparison: {
            previewVsSeed: {
              comparable: false,
              comparisonBasis: "none",
              slotDiffs: [],
            },
            seedVsReality: {
              comparable: false,
              workoutDrift: [],
            },
            previewVsReality: {
              comparable: false,
              comparisonBasis: "none",
              slotDiffs: [],
            },
          },
          limitations: ["historical ranking unavailable"],
        },
      },
    );

    expect(artifact.mode).toBe("mesocycle-explain");
    expect(artifact.generation).toBeUndefined();
    expect(artifact.mesocycleExplain).toMatchObject({
      sourceMesocycleId: "meso-source",
      retrospectiveMesocycleId: "meso-retro",
      limitations: ["historical ranking unavailable"],
    });
  });

  it("keeps full no-repair diagnostics in memory while serializing the main artifact as an operator summary", () => {
    const output = createWorkoutAuditArtifactOutput(
      {
        mode: "mesocycle-explain",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        plannerOnlyNoRepair: true,
        compareRepaired: true,
      },
      {
        ...baseRun,
        context: {
          mode: "mesocycle-explain",
          requestedMode: "mesocycle-explain",
          userId: "user-1",
          ownerEmail: "owner@test.local",
          plannerDiagnosticsMode: "standard",
          mesocycleExplain: {
            plannerOnlyNoRepair: {
              enabled: true,
              compareRepaired: true,
            },
          },
        },
        generationResult: undefined,
        mesocycleExplain: makeMesocycleExplainNoRepairPayload(),
      },
    );

    const fullNoRepair = output.artifact.mesocycleExplain?.plannerOnlyNoRepair;
    const serializedNoRepair = output.serializedArtifact.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;

    expect(fullNoRepair?.v2MesocyclePlan).toBeTruthy();
    expect(fullNoRepair?.v2MesocycleStrategyDiagnostic).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "available_with_limitations",
      demandDerivationPlan: {
        currentDemandSource: "mixed",
        targetDemandSource: "mesocycle_strategy",
      },
    });
    expect(fullNoRepair?.strategyToDemandProjection).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      projectionMode: "read_only_non_mutating_join",
      status: "not_available",
    });
    expect(fullNoRepair?.v2SetDistributionIntent).toBeTruthy();
    expect(fullNoRepair?.v2SupportLanePolicy).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        policyCount: 5,
      },
    });
    expect(fullNoRepair?.v2SupportLaneProjectionDiagnostic).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      safeForBehaviorPromotion: false,
      summary: {
        supportMusclesEvaluated: 4,
      },
    });
    expect(fullNoRepair?.plannerOwnedAccumulationProjection).toBeTruthy();
    expect(fullNoRepair?.v2ExerciseSelectionPlanDiagnostic).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      identityBasis: "week_1_selected_identities",
      safeForBehaviorPromotion: false,
    });
    expect(fullNoRepair?.v2LaneSelectionIntentAudit).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      summary: {
        totalLanes: expect.any(Number),
      },
    });
    expect(fullNoRepair?.lowAxialHipExtensionLimitation).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "acceptable_with_limitations",
      trueHingeExposureCount: 0,
      safeForBehaviorPromotion: false,
    });
    expect(fullNoRepair?.v2DeloadProjectionDiagnostic).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "projected_with_limitations",
      identityBasis: "week_1_selected_identities",
      projectionBasis: "v2_deload_transform_read_only",
      summary: {
        identitiesPreservedCount: 1,
        movementsIntroducedCount: 0,
        volumeReductionPercent: 50,
      },
      safeForBehaviorPromotion: false,
    });
    expect(fullNoRepair?.v2BasePlanCompare).toMatchObject({
      source: "v2_base_plan_compare",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "available",
      comparisons: {
        slotShape: {
          v2Base: {
            totalSets: 55,
            maxSlotSets: 17,
          },
        },
      },
    });
    expect(fullNoRepair?.v2TargetVsNoRepairDiff).toBeTruthy();
    expect(
      fullNoRepair?.crossWeekProjectionGate.accumulationWeeksStatus.weeks,
    ).toHaveLength(3);
    expect(serializedNoRepair).toMatchObject({
      summary: {
        status: "fail",
        replacementReadinessStatus: "blocked",
      },
      v2Summary: {
        split: "upper_lower_4x",
        weekCount: 5,
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
        exerciseSelectionPlanDiagnostic: {
          status: "projected_with_limitations",
          summary: expect.objectContaining({
            preservedIdentityCount: 0,
            missingCandidateCount: 1,
          }),
        },
        laneSelectionIntentAudit: {
          source: "v2_lane_selection_intent_audit",
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByDemandOrMaterializer: false,
          materializerInferenceRequiredCount: expect.any(Number),
        },
        lowAxialHipExtensionLimitation: {
          status: "acceptable_with_limitations",
          trueHingeExposureCount: 0,
          lowAxialHipExtensionAnchorCount: 1,
          hamstringContribution: expect.objectContaining({
            curlEffectiveSets: 2,
            hipExtensionEffectiveSets: 1.1,
            weeklyCurlEffectiveSets: 4,
            weeklyHipExtensionEffectiveSets: 2.3,
          }),
          safeForBehaviorPromotion: false,
        },
        deloadProjectionDiagnostic: {
          status: "projected_with_limitations",
          summary: expect.objectContaining({
            identitiesPreservedCount: 1,
            movementsIntroducedCount: 0,
            volumeReductionPercent: 50,
          }),
          blockerCount: 0,
          warningCount: 0,
        },
        supportLanePolicy: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: {
            policyCount: 5,
          },
        },
        supportLaneProjectionDiagnostic: {
          status: "projected_with_limitations",
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: expect.objectContaining({
            supportMusclesEvaluated: 4,
            optionalActivations: 1,
          }),
          blockerCount: 0,
          warningCount: 1,
          missingInputCount: 0,
        },
      },
      debugArtifact: {
        created: false,
        enableWith: "--v2-debug-artifact",
      },
      crossWeekProjectionGate: {
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
        },
        replacementReadinessStatus: "not_ready",
        safeToPromoteBehavior: false,
        blockerCount: 1,
      },
    });
    expect(serializedNoRepair).not.toHaveProperty("v2MesocyclePlan");
    expect(serializedNoRepair).not.toHaveProperty(
      "v2MesocycleStrategyDiagnostic",
    );
    expect(serializedNoRepair).not.toHaveProperty("v2SetDistributionIntent");
    expect(serializedNoRepair).not.toHaveProperty("v2SupportLanePolicy");
    expect(serializedNoRepair).not.toHaveProperty(
      "v2SupportLaneProjectionDiagnostic",
    );
    expect(serializedNoRepair).not.toHaveProperty(
      "plannerOwnedAccumulationProjection",
    );
    expect(serializedNoRepair).not.toHaveProperty(
      "v2ExerciseSelectionPlanDiagnostic",
    );
    expect(serializedNoRepair).not.toHaveProperty(
      "v2SelectionCapacityPlanDiagnostic",
    );
    expect(serializedNoRepair).not.toHaveProperty(
      "v2DeloadProjectionDiagnostic",
    );
    expect(serializedNoRepair).not.toHaveProperty("v2BasePlanCompare");
    expect(serializedNoRepair).not.toHaveProperty("v2TargetVsNoRepairDiff");
    expect(JSON.stringify(serializedNoRepair.v2Summary)).not.toContain(
      "slotShape",
    );
    expect(
      (serializedNoRepair.crossWeekProjectionGate as Record<string, unknown>)
        .accumulationWeeksStatus,
    ).not.toHaveProperty("weeks");
    expect(output.v2DebugArtifact).toBeUndefined();
  });

  it("returns a linked V2 no-repair debug index and compact shards only when the explicit flag is enabled", () => {
    const mesocycleExplain = makeMesocycleExplainNoRepairPayload();
    (
      mesocycleExplain!.preview.projectionDiagnostics as Record<string, unknown>
    ).planningReality = {
      label: "weekly demand / slot allocation diagnostics",
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        planningShape: "mixed_upstream_plus_repair_shaped",
        explicitWeeklyDemandMuscles: 2,
        inferredDemandMuscles: 1,
        slotsWithExplicitWeeklyDemand: 2,
        slotsWithOnlyLocalOrInferredSemantics: 1,
        materialRepairCount: 2,
        majorRepairCount: 1,
        highExerciseConcentrationCount: 0,
        warningCodes: [],
      },
      weeklyMuscleDemand: [
        {
          muscle: "Chest",
          evidence: ["planning_reality_detail_only"],
        },
      ],
      slotDemandAllocation: [],
      shadowWeeklyDemand: [],
      shadowSlotDemandAllocation: [],
      initialSlotComposition: [],
      finalSlotPlan: [],
      allocationVsInitialDelta: [],
      allocationVsFinalDelta: [],
      repairMaterialityAfterShadowAllocation: [],
      shadowRepairSummary: {
        materialRepairCount: 2,
        majorRepairCount: 1,
      },
      suspiciousRepairsNotEligibleForPromotion: [],
      promotionCandidates: [],
      weakPreselectionConsumption: [],
      slotPrescriptionIntents: [],
      setDistributionIntents: [],
      distributionGuardActions: [],
      preselectionFeasibility: [],
      preselectionDistributionPolicyByWeek: {
        summary: { weekCount: 5 },
        weeks: [],
      },
      weeklyDemandCurve: {
        summary: { weekCount: 5 },
        weeks: [],
      },
      slotDemandAllocationByWeek: {
        summary: { weekCount: 5 },
        weeks: [],
      },
      exerciseClassDistributionBySlot: [],
      exerciseClassAlignment: {
        summary: {},
        slots: [],
      },
      exerciseClassUnresolvedCauses: [],
      duplicateContinuityJustification: {
        duplicates: [],
      },
      cleanupCandidateFeasibility: [],
      accumulationWeekProjection: {
        weeks: [],
      },
      projectedDelivery: [],
      repairMateriality: [],
      exerciseConcentration: [],
      warnings: [],
      limitations: [],
    };
    mesocycleExplain!.plannerOnlyNoRepair!.v2MesocycleStrategyDiagnostic =
      buildV2PlannerMesocyclePolicy({
        mesocycleStrategyInput: makePromotionDiffStrategyInput(),
        preShadowCandidateFilter: makePromotionDiffPreShadowCandidateFilter(),
        strategyShadowProjection: makePromotionDiffShadowProjectionEvidence(),
      }).mesocycleStrategyDiagnostic;
    mesocycleExplain!.plannerOnlyNoRepair!.v2PlanQualityBenchmark = {
      version: 1,
      source: "v2_candidate_quality_benchmark",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      repairedProjectionUsedAs: "evidence_only_not_target_policy",
      status: "warning",
      summary: {
        passCount: 4,
        warningCount: 4,
        failCount: 0,
        missingEvidenceCount: 0,
        mustFixBeforeWeek1Count: 0,
        concentrationReadinessDecision: "candidate_for_bounded_policy_design",
        concentrationNextSafeSlice: "run_acceptance_non_regression_projection",
        concentrationReadinessBlockerCount: 0,
        slotWeekAllocationReadiness: "candidate_for_acceptance_projection",
        slotWeekAllocationBlockedRowCount: 0,
        slotWeekAllocationNextSafeSlice:
          "run_acceptance_non_regression_projection",
        nextSafeAction: "review_warning_gates_before_deprecation",
      },
      candidateQualityLab: {
        version: 1,
        source: "v2_candidate_quality_lab_fixtures",
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByDemandOrMaterializer: false,
        summary: {
          fixtureCount: 7,
          passCount: 7,
          warnCount: 0,
          failCount: 0,
          watchCount: 0,
          lowAxialGoldenCount: 1,
          nonConsumingFixtureCount: 7,
          materializerDeltaScenarioCount: 2,
          materializerDeltaMeasuredCount: 2,
          nextSafeAction: "no_action",
        },
        topAttentionFixture: null,
        scenarioDetailTop: [
          {
            scenarioId: "low_axial_hip_extension_golden",
            label: "Low-axial hip-extension support golden",
            scenarioRole: "golden_reference",
            expectedOutcome: "pass",
            actualOutcome: "pass",
            observedGapKind: "none",
            ownerSeam:
              "V2LaneSelectionIntent -> ExerciseSelectionPlan -> V2 materializer consumption",
            evidenceSource: "v2_lane_selection_intent_benchmark",
            evidenceCount: 8,
            missingEvidenceCount: 0,
            nextSafeAction: "no_action",
            noImpactArchitectureReview: true,
            labConsumedByDemandOrMaterializer: false,
            seedRuntimeBoundaryIssue: false,
            materializerDeltaEvidence: {
              readOnly: true,
              affectsScoringOrGeneration: false,
              consumedByDemandOrMaterializer: false,
              baselineIdentitySummary: ["Stiff-Legged Deadlift:3"],
              trialIdentitySummary: ["Cable Pull-Through:3"],
              selectedIdentityDelta: 2,
              totalSetDelta: 0,
              materializerBlockerDelta: 0,
              protectedCoverageStatus: "improved",
              protectedCoverageSetDelta: 3,
              nextSafeAction: "run_read_only_acceptance_projection",
            },
          },
        ],
        architectureBoundary: {
          noProductionPlannerChange: true,
          noProductionMaterializerRankingChange: true,
          noSeedRuntimeReceiptDbChange: true,
          noAcceptanceThresholdChange: true,
          noRepairBehaviorChange: true,
        },
      },
      slotWeekAllocationAcceptanceProjection: {
        version: 1,
        source:
          "v2_slot_week_allocation_acceptance_non_regression_projection",
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByProduction: false,
        candidateSource: "SlotDemandAllocationByWeek",
        evidenceSource:
          "v2_plan_quality_benchmark_and_donor_offset_materializer_projection",
        representativeAccumulationWeeks: [2, 3, 4],
        decision: "accepted_with_watch_items",
        week1Trainability: {
          status: "pass_with_warnings",
          replacementReadinessStatus: "not_ready",
          hardBlockerCount: 0,
          qualityWarningCount: 4,
        },
        protectedVolumeCoverage: {
          status: "pass",
          projectedWeekCount: 3,
          protectedCoveragePassCount: 3,
          blockedRowCount: 0,
          netWeeklySetDelta: 0,
        },
        materializerNonRegression: {
          status: "pass",
          selectedIdentityDelta: 0,
          totalSetDelta: 0,
          materializerBlockerDelta: 0,
          regressionCount: 0,
        },
        sessionSizeFatigueConcentrationImpact: {
          status: "watch",
          sessionSizeGateStatus: "pass",
          fatigueDistributionGateStatus: "warning",
          concentrationWarningDelta: -3,
        },
        duplicateConcentrationRisk: {
          status: "watch",
          duplicateConcentrationGateStatus: "warning",
          watchItemCount: 2,
        },
        acceptance: {
          decision: "accepted_with_watch_items",
          watchItems: [
            "duplicate_concentration_risk:v2_base_plan_validation.duplicate_distinctness",
            "week_1_trainability:pass_with_warnings",
          ],
          blockers: [],
          itemClassifications: [
            {
              item: "duplicate_concentration_risk:v2_base_plan_validation.duplicate_distinctness",
              gate: "duplicate_concentration_risk",
              status: "watch",
              classification: "bounded_owner_watch",
              evidenceSource: "pure_v2_base_plan",
              affected: {
                weeks: [],
                slots: [],
                lanes: [],
                muscles: [],
              },
              evidence: ["v2DuplicateFamily:calf_isolation"],
              ownerSeam: "v2_base_plan_validation.duplicate_distinctness",
              materiality:
                "bounded distinctness watch; pure V2 has no exact duplicate reuse and no base-plan regression, while class-family reuse remains review evidence",
              mustFixBeforeWeek1: false,
              smallestSafeNextAction:
                "carry class-family reuse as a bounded promotion-review watch; require no exact duplicate reuse, no base regression, and debug-shard row review before any behavior slice",
            },
          ],
          classificationCounts: {
            acceptedWatch: 1,
            boundedOwnerWatch: 1,
            blocker: 0,
            staleOrDiagnosticNoise: 0,
            ownerSpecificNextFix: 0,
          },
          nextSafeSlice: "bounded_behavior_promotion_review",
        },
        nonConsumption: {
          seedRuntimeReceiptDbConsumed: false,
          productionMaterializerConsumed: false,
          acceptanceThresholdChanged: false,
          persistenceChanged: false,
        },
      },
      gates: [],
      deprecationReadiness: {
        status: "ready_for_review",
        evidence: [],
        missingEvidence: [],
      },
      guardrails: {
        seedRuntimeChanged: false,
        productionMaterializerChanged: false,
        acceptanceThresholdChanged: false,
        persistenceChanged: false,
      },
    };
    mesocycleExplain!.plannerOnlyNoRepair!.v2PromotionCandidateEvaluator = {
      version: 1,
      source: "v2_promotion_candidate_evaluator",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
      repairedProjectionUsedAs: "evidence_only_not_target_policy",
      status: "none_ready",
      summary: {
        evaluatedCandidateCount: 2,
        readyCandidateCount: 0,
        stoppedCandidateCount: 1,
        watchCandidateCount: 1,
        topCandidateId: null,
        topRecommendation: "none_ready",
        nextSafeAction: "pivot_to_new_owner_specific_candidate_inventory",
      },
      recommendation: {
        decision: "none_ready",
        candidateId: null,
        label: "none ready",
        ownerSeam: null,
        reason:
          "no candidate has measured owner-specific positive impact with bounded delta, non-regression, acceptance/watch clearance, and seed/runtime/receipt/DB non-consumption",
        nextSafeAction: "pivot_to_new_owner_specific_candidate_inventory",
        score: null,
      },
      candidates: [
        {
          rank: null,
          candidateId: "support_direct_floor",
          label: "Support floor diagnostic",
          ownerSeam: "SetDistributionIntent",
          sourceSurface: "repair_promotion_scoreboard",
          priorProbe: "measured_no_impact",
          status: "stopped",
          stopReasons: ["measured_no_impact"],
          score: {
            total: 10,
            measuredOwnerSpecificPositiveImpact: 0,
            materializerNonRegression: 20,
            protectedCoverage: 0,
            acceptanceWatchStatus: 0,
            seedRuntimeReceiptDbNonConsumption: 20,
            sourceAttributionQuality: 15,
            priorProbeAdjustment: -35,
            implementationScope: 0,
          },
          evidence: ["supportFloorStatus=no_candidate_impact"],
          missingProof: [],
          nextSafeAction: "pivot_to_higher_roi_track",
        },
      ],
      stopReasonCounts: {
        measured_no_impact: 1,
        missing_bounded_delta: 1,
      },
      guardrails: {
        seedRuntimeChanged: false,
        receiptChanged: false,
        persistenceChanged: false,
        productionMaterializerChanged: false,
        acceptanceThresholdChanged: false,
      },
    };
    mesocycleExplain!.plannerOnlyNoRepair?.v2TargetVsNoRepairDiff.slotDiffs[0]?.laneDiffs.push(
      {
        laneId: "biceps",
        targetRole: "accessory",
        targetPrimaryMuscles: ["Biceps"],
        targetExerciseClasses: ["biceps_isolation"],
        targetSets: { min: 2, preferred: 3, max: 3 },
        currentStatus: "partial",
        currentEvidence: {
          selectedExercises: [
            {
              name: "Barbell Curl",
              sets: 2,
              matchedClass: "biceps_curl",
              role: "accessory",
            },
          ],
          relevantDiagnostics: [
            "setPolicy:in_budget",
            "setBudget:within_preferred",
            "target_delivery:below_min",
            "exposure:single_direct_curl",
            "concentration:pulling_collateral",
          ],
        },
        gapCause: "set_distribution_gap",
        migrationRecommendation: "needs_set_distribution_policy",
        severity: "quality_warning",
      },
    );

    const output = createWorkoutAuditArtifactOutput(
      {
        mode: "mesocycle-explain",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        plannerOnlyNoRepair: true,
        compareRepaired: true,
        v2DebugArtifact: true,
      },
      {
        ...baseRun,
        context: {
          mode: "mesocycle-explain",
          requestedMode: "mesocycle-explain",
          userId: "user-1",
          ownerEmail: "owner@test.local",
          plannerDiagnosticsMode: "standard",
          mesocycleExplain: {
            sourceMesocycleId: "meso-source",
            retrospectiveMesocycleId: "meso-retro",
            plannerOnlyNoRepair: {
              enabled: true,
              compareRepaired: true,
              v2DebugArtifact: true,
            },
          },
        },
        generationResult: undefined,
        mesocycleExplain,
      },
      {
        artifactFileName: "parent.json",
        artifactRelativePath: "artifacts/audits/parent.json",
        v2DebugArtifactFileName: "parent-v2-debug-index.json",
        v2DebugArtifactRelativePath:
          "artifacts/audits/parent-v2-debug-index.json",
      },
    );
    const mainNoRepair = output.serializedArtifact.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;
    expect(output.v2DebugArtifact).toMatchObject({
      fileName: "parent-v2-debug-index.json",
      relativePath: "artifacts/audits/parent-v2-debug-index.json",
      sizeBytes: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(mainNoRepair.debugArtifact).toMatchObject({
      kind: "v2_debug_index",
      created: true,
      fileName: "parent-v2-debug-index.json",
      relativePath: "artifacts/audits/parent-v2-debug-index.json",
      sizeBytes: output.v2DebugArtifact?.sizeBytes,
      sha256: output.v2DebugArtifact?.sha256,
      detailLevel: "compact",
    });
    expect(mainNoRepair.debugArtifact).toHaveProperty("contains");
    expect(mainNoRepair.v2Summary).toMatchObject({
      basePlanCompare: {
        status: "available",
        readOnly: true,
        affectsScoringOrGeneration: false,
        summary: {
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
        summary: {
          shadowTotalSets: 55,
          currentRepairDependencyCount: 9,
          shadowRemainingRepairDependencyCount: 1,
          repairDependencyDelta: -8,
          regressionCount: 0,
          unclearCount: 1,
          categorizedIdentityDifferenceCount: 4,
        },
        nextSafeAction: "inspect_shadow_consumption",
      },
      mesocycleStrategyDiagnostic: {
          strategyHypothesisPromotionDiff: {
            status: "available_with_limitations",
            evaluatedHypothesisCount: 2,
            nextSafeAction: "add_read_only_projection_diff",
            consumedByDemandOrMaterializer: false,
            donorSurplusEvidence: {
              status: "available",
              readOnly: true,
              affectsScoringOrGeneration: false,
              candidateCount: 1,
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
              protectedDemandCount: 2,
              donorDemandCount: 1,
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
              projectionMode: "shadow_projection",
              candidateProtectedMuscleCount: 2,
              candidateDonorMuscleCount: 1,
            computedGateCounts: {
              pass: 9,
              fail: 1,
              unknown: 0,
            },
            preShadowCandidateFilter: {
              status: "available_with_limitations",
              eligibleDonorCount: 1,
              excludedDonorCount: 1,
              retainedDonorCount: 1,
              retainedProtectedMuscleCount: 2,
              excludedProtectedMuscleCount: 0,
              consumedByDemandOrMaterializer: false,
            },
            readiness: "needs_better_projection",
            consumedByDemandOrMaterializer: false,
          },
        },
      },
      repairPromotionScoreboard: {
        rawRepairEvidence: {
          materialRepairCount: 2,
          majorRepairCount: 1,
          suspiciousRepairCount: 1,
        },
        summary: {
          promotionCandidateCount: 1,
          safetyNetCount: 1,
          diagnosticOnlyCount: 1,
        },
        interpretation: {
          legacyRepairPressure: expect.objectContaining({
            likelyAvoidableMaterialRepairCount: 1,
            note: "raw_legacy_repair_evidence_not_behavior_promotion_pressure",
          }),
          currentV2PolicyGap: {
            supportDirectFloorBlockerCount: 3,
            setDistributionCapacityGapCount: 1,
            setBudgetPolicyFailureCount: 1,
            selectionFeasibilityCapacityPressureCount: 0,
            staleWeek1ReadoutArtifactCount: 0,
            capAwareExpansionLimitationCount: 0,
            concentrationQualityGapCount: 0,
            optionalDiagnosticLaneCount: 0,
            selectionBlockerCount: 0,
            classTaxonomyMismatchCount: 0,
          },
          safetyNonRegressionRows: {
            count: 1,
            includesSuspiciousRows: true,
          },
          staleRepairedProjectionArtifacts: {
            count: 0,
            reasonCounts: {
              v2_already_solved_differently: 0,
              collateral_support_accounting: 0,
              legacy_repaired_artifact: 0,
              support_floor_design_needed: 0,
            },
          },
          quarantineGroups: {
            upstreamOwnedCandidate: {
              count: 1,
              evidenceQuality: "owner_specific_behavior_candidate",
              ownerCounts: {
                SlotDemandAllocationByWeek: 1,
              },
              requiredProof: [
                "bounded_owner_specific_behavior_trial",
                "measured_projection_non_regression",
                "seed_runtime_non_consumption_verified",
              ],
            },
            safetyRepairOnly: {
              count: 1,
              evidenceQuality: "safety_or_legacy_only",
              topReasons: {
                raw_suspicious_do_not_promote: 1,
              },
              requiredProof: [
                "prove_safety_guard_can_be_owned_upstream_without_regression",
                "keep_repair_as_fallback_until_replaced",
              ],
            },
            collateralAmbiguous: {
              count: 0,
              evidenceQuality: "collateral_or_ambiguous",
              topReasons: {},
              requiredProof: [
                "prove_target_muscle_slot_ownership",
                "separate_collateral_credit_from_direct_floor_satisfaction",
              ],
            },
            staleArtifact: {
              count: 0,
              evidenceQuality: "stale_repaired_projection_artifact",
              topReasons: {},
              requiredProof: [
                "compare_against_current_v2_no_repair_solution",
                "do_not_copy_legacy_repaired_identity_or_set_bump",
              ],
            },
            missingEvidenceOrUnmeasuredGate: {
              count: 1,
              evidenceQuality: "missing_or_unmeasured_gate",
              topReasons: {
                materiality_none_or_diagnostic_denominator_artifact: 1,
              },
              requiredProof: [
                "owner_specific_projection_delta",
                "materializer_non_regression",
                "cross_week_and_deload_projection",
              ],
            },
          },
          missingProofBeforeBehaviorPromotion: [
            {
              gate: "owner_specific_behavior_candidate",
              status: "pass",
              ownerSeam: "SlotDemandAllocationByWeek",
              missingEvidence: [],
              evidence: ["behaviorPromotionCandidateCount=1"],
            },
            {
              gate: "current_v2_policy_gap",
              status: "blocked",
              ownerSeam: "SetDistributionIntent",
              missingEvidence: [
                "resolve_or_measure_current_v2_policy_gaps_before_behavior",
              ],
              evidence: [
                "supportDirectFloorBlockerCount=3",
                "setDistributionCapacityGapCount=1",
                "setBudgetPolicyFailureCount=1",
              ],
            },
            {
              gate: "measured_behavior_projection",
              status: "missing",
              ownerSeam: "read_only_projection_or_materializer_comparison",
              missingEvidence: [
                "measured_projection_delta",
                "materializer_non_regression",
                "cross_week_accumulation_projection",
                "deload_projection",
              ],
              evidence: [
                "repair_scoreboard_is_repaired_projection_evidence_only",
              ],
            },
            {
              gate: "seed_runtime_non_consumption",
              status: "required_before_promotion",
              ownerSeam: "accepted_seed_runtime_replay",
              missingEvidence: [
                "focused_seed_runtime_guard_tests_for_any_future_behavior_promotion",
              ],
              evidence: [
                "diagnostic_readout_does_not_change_slotPlanSeedJson_or_runtime_replay",
              ],
            },
          ],
          gapInventory: [
            {
              rank: 1,
              gapId: "support_direct_floor",
              description:
                "Support muscles still need direct-floor ownership separated from collateral credit.",
              likelyOwnerSeam: "SetDistributionIntent",
              evidenceQuality: "diagnostic_count",
              trainingImportance: "high",
              gapCount: 3,
              currentEvidence: ["supportDirectFloorBlockerCount=3"],
              missingProof: [
                "owner_specific_projection_delta",
                "materializer_non_regression",
                "cross_week_direct_floor_projection",
              ],
              measurableNextStep:
                "measure_support_floor_materializer_projection",
              status: "blocked_by_missing_evidence",
            },
          ],
        },
      },
    });
    expect(JSON.stringify(mainNoRepair.v2Summary)).not.toContain(
      "promotionCandidates",
    );
    expect(output.v2DebugArtifact?.artifact.parent).toMatchObject({
      fileName: "parent.json",
      relativePath: "artifacts/audits/parent.json",
      mode: "mesocycle-explain",
      sourceMesocycleId: "meso-source",
      retrospectiveMesocycleId: "meso-retro",
      requestFlags: [
        "--mode mesocycle-explain",
        "--planner-only-no-repair",
        "--compare-repaired",
        "--v2-debug-artifact",
      ],
    });
    expect(output.v2DebugArtifact?.artifact).toMatchObject({
      kind: "v2_debug_index",
      readOnly: true,
      affectsScoringOrGeneration: false,
      detailLevel: "compact",
      budgets: {
        mainArtifactBudgetBytes: 1_048_576,
        v2IndexBudgetBytes: 131_072,
        defaultShardBudgetBytes: 524_288,
        fullDetailShardBudgetBytes: 1_048_576,
        perArtifactLimitBytes: 1_048_576,
      },
      summary: {
        v2BasePlanCompareStatus: "available",
        v2BasePlanCompareImprovementCount: 12,
        v2BasePlanCompareRegressionCount: 0,
        v2BasePlanShadowConsumptionStatus: "available",
        v2BasePlanShadowConsumptionRepairDependencyDelta: -8,
        v2BasePlanShadowConsumptionRegressionCount: 0,
        v2LaneIntentMaterializerProjectionStatus:
          "projected_with_limitations",
        v2LaneIntentMaterializerProjectionIdentityDelta: 0,
        v2LaneIntentMaterializerProjectionTotalSetDelta: 0,
        v2PlanQualityBenchmarkStatus: "warning",
        v2PlanQualityBenchmarkFailedGates: 0,
        v2PlanQualityBenchmarkMissingEvidenceGates: 0,
        v2CandidateQualityLabFixtureCount: 7,
        v2CandidateQualityLabPassCount: 7,
        v2CandidateQualityLabWarnCount: 0,
        v2CandidateQualityLabFailCount: 0,
        v2CandidateQualityLabWatchCount: 0,
        v2CandidateQualityLabLowAxialGoldenCount: 1,
        v2CandidateQualityLabMaterializerDeltaScenarioCount: 2,
        v2CandidateQualityLabMaterializerDeltaMeasuredCount: 2,
        v2CandidateQualityLabTopAttentionFixture: null,
        v2CandidateQualityLabNextSafeAction: "no_action",
        v2SlotWeekAllocationAcceptanceDecision:
          "accepted_with_watch_items",
        v2SlotWeekAllocationAcceptanceWatchItems: 2,
        v2SlotWeekAllocationAcceptanceBlockers: 0,
        v2SlotWeekAllocationAcceptanceBoundedOwnerWatchCount: 1,
        v2SlotWeekAllocationAcceptanceNextSafeSlice:
          "bounded_behavior_promotion_review",
        writtenShardCount: 8,
        skippedShardCount: 0,
      },
      shards: expect.arrayContaining([
        expect.objectContaining({
          id: "strategy",
          relativePath: "artifacts/audits/parent-v2-strategy.json",
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          bytes: expect.any(Number),
          detailLevel: "compact",
          status: "written",
        }),
        expect.objectContaining({
          id: "promotion-readiness",
          relativePath:
            "artifacts/audits/parent-v2-promotion-readiness.json",
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          bytes: expect.any(Number),
          detailLevel: "compact",
          status: "written",
        }),
        expect.objectContaining({
          id: "promotion-diffs",
          relativePath: "artifacts/audits/parent-v2-promotion-diffs.json",
          status: "written",
        }),
      ]),
      plannerOnlyNoRepair: {
        crossWeekProjectionGate: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          accumulationWeeksStatus: {
            status: "projected_with_limitations",
            weekCount: 3,
          },
          deloadStatus: {
            status: "diagnostic_projection_only",
          },
          safeToPromoteBehavior: false,
        },
        v2ExerciseSelectionPlanDiagnostic: {
          status: "projected_with_limitations",
        },
        v2DeloadProjectionDiagnostic: {
          status: "projected_with_limitations",
        },
        strategyHypothesisPromotionDiff: {
          donorSurplusEvidence: {
            status: "available",
            readOnly: true,
            affectsScoringOrGeneration: false,
            candidateCount: 1,
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
            protectedDemandCount: 2,
            donorDemandCount: 1,
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
        },
        v2BasePlanCompare: {
          status: "available",
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: {
            v2TotalSets: 55,
            noRepairTotalSets: 25,
            repairedTotalSets: 55,
            repairDependencyCount: 9,
          },
          nextSafeAction: "add_shadow_consumption_trial",
        },
        v2BasePlanShadowConsumptionTrial: {
          status: "available",
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          summary: {
            shadowTotalSets: 55,
            repairDependencyDelta: -8,
            regressionCount: 0,
          },
          nextSafeAction: "inspect_shadow_consumption",
        },
        v2CapacityMaterializerProjection: {
          status: "projected_with_limitations",
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          projectionMode: "slot_cap_delta_materializer_dry_run",
          trialId: "upper_a_max_exercise_count_plus_one_projection_only",
          candidateImpact: {
            selectedIdentityDelta: 1,
            totalSetDelta: 2,
            targetSlotExerciseDelta: 1,
            materializerBlockerDelta: 0,
            regressionCount: 0,
          },
          gateStatusCounts: {
            pass: 6,
            unknown: 2,
          },
          nextSafeAction: "inspect_materializer_capacity_projection",
        },
        v2LaneIntentMaterializerProjection: {
          status: "projected_with_limitations",
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          consumedByDemandOrMaterializer: false,
          projectionMode: "lane_intent_shadow_materializer_dry_run",
          trialId: "upper_b_chest_second_exposure_lane_intent_shadow",
          targetLane: {
            scopedLaneId: "upper_b:chest_second_exposure",
            slotId: "upper_b",
            laneId: "chest_second_exposure",
            intentAvailable: true,
            baselineConsumedByProduction: false,
            trialConsumesLaneIntent: true,
          },
          candidateImpact: {
            selectedIdentityDelta: 0,
            totalSetDelta: 0,
            targetLaneExerciseDelta: 0,
            materializerBlockerDelta: 0,
            regressionCount: 0,
          },
          nextSafeAction: "pivot_to_higher_roi_track",
        },
      },
    });
    expect(mainNoRepair.v2PromotionCandidateEvaluator).toMatchObject({
      status: "none_ready",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
      recommendation: {
        decision: "none_ready",
        candidateId: null,
      },
      topCandidates: [
        expect.objectContaining({
          candidateId: "support_direct_floor",
          stopReasons: ["measured_no_impact"],
        }),
      ],
      stopReasonCounts: {
        measured_no_impact: 1,
        missing_bounded_delta: 1,
      },
      guardrails: {
        seedRuntimeChanged: false,
        receiptChanged: false,
        persistenceChanged: false,
        productionMaterializerChanged: false,
        acceptanceThresholdChanged: false,
      },
    });

    const findShard = (id: string) => {
      const shard = output.v2DebugArtifact?.shards.find(
        (entry) => entry.artifact.id === id,
      );
      if (!shard) {
        throw new Error(`missing shard ${id}`);
      }
      return shard;
    };
    const strategyShard = findShard("strategy");
    const promotionReadinessShard = findShard("promotion-readiness");
    const promotionDiffsShard = findShard("promotion-diffs");
    const repairEvidenceShard = findShard("repair-evidence");
    const materializationShard = findShard("materialization");
    const crossWeekShard = findShard("cross-week-projection");
    const selectionShard = findShard("selection-alignment");
    const planningRealityShard = findShard("planning-reality");
    expect(materializationShard.artifact.data).toMatchObject({
      v2PlanQualityBenchmark: {
        candidateQualityLab: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByDemandOrMaterializer: false,
          summary: {
            fixtureCount: 7,
            passCount: 7,
            warnCount: 0,
            failCount: 0,
            watchCount: 0,
            lowAxialGoldenCount: 1,
            nonConsumingFixtureCount: 7,
            materializerDeltaScenarioCount: 2,
            materializerDeltaMeasuredCount: 2,
            nextSafeAction: "no_action",
          },
          topAttentionFixture: null,
        },
        slotWeekAllocationAcceptanceProjection: {
          decision: "accepted_with_watch_items",
          acceptance: {
            watchItems: [
              "duplicate_concentration_risk:v2_base_plan_validation.duplicate_distinctness",
              "week_1_trainability:pass_with_warnings",
            ],
            blockers: [],
            nextSafeSlice: "bounded_behavior_promotion_review",
          },
        },
      },
    });
    expect(
      output.serializedArtifact.mesocycleExplain?.plannerOnlyNoRepair
        ?.v2PlanQualityBenchmark?.candidateQualityLab,
    ).not.toHaveProperty("scenarioDetailTop");

    const mainPlanningReality = output.serializedArtifact.mesocycleExplain
      ?.preview.projectionDiagnostics.planningReality as unknown as Record<
      string,
      unknown
    >;
    expect(mainPlanningReality).toMatchObject({
      summary: {
        planningShape: "mixed_upstream_plus_repair_shaped",
        materialRepairCount: 2,
      },
      detailArtifact: {
        shardId: "planning-reality",
        relativePath: "artifacts/audits/parent-v2-planning-reality.json",
        sizeBytes: planningRealityShard.sizeBytes,
        sha256: planningRealityShard.sha256,
      },
    });
    expect(mainPlanningReality).not.toHaveProperty("weeklyMuscleDemand");
    expect(planningRealityShard.artifact.data).toMatchObject({
      planningReality: {
        summary: {
          planningShape: "mixed_upstream_plus_repair_shaped",
        },
        weeklyMuscleDemand: [
          expect.objectContaining({
            muscle: "Chest",
            evidence: ["planning_reality_detail_only"],
          }),
        ],
      },
    });

    expect(strategyShard.artifact).toMatchObject({
      kind: "v2_debug_shard",
      detailLevel: "compact",
      data: {
        v2MesocycleStrategyDiagnostic: expect.objectContaining({
          status: "available_with_limitations",
          demandDerivationPlan: expect.objectContaining({
            currentDemandSource: "mixed",
          }),
        }),
      },
    });
    expect(promotionReadinessShard.artifact.data).toMatchObject({
      strategyHypothesisPromotionReadiness: expect.objectContaining({
        status: "partially_ready",
        globalBlockers: expect.arrayContaining([
          "readiness_not_consumed_by_mesocycle_demand_or_materializer",
        ]),
      }),
    });
    expect(promotionDiffsShard.artifact.data).toMatchObject({
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
        protectLaggingMusclesEarlier: expect.objectContaining({
          targetTierMuscles: expect.arrayContaining(["Side Delts", "Calves"]),
          recurringUnderHitMuscles: ["Side Delts"],
          requiredGuards: expect.arrayContaining([
            "protected_sets_must_have_slot_owner",
            "protected_sets_must_not_use_forbidden_slots",
          ]),
        }),
        capLateBlockVolume: expect.objectContaining({
          skippedSetEvidence: expect.objectContaining({
            hardWeekSkippedSetSignal: true,
            examples: expect.arrayContaining([
              "history-b:skipped_set_trend_rising",
              "history-b:hard_week_average_rpe:8.8",
            ]),
          }),
        }),
          interactionRisk: expect.objectContaining({
            requiredJointGuards: [
              "prefer_redistribution_from_over_concentrated_or_fatigue_driver_muscles_before_adding_net_new_late_block_volume",
            ],
          }),
          donorSurplusEvidence: expect.objectContaining({
            version: 1,
            source: "v2_donor_surplus_evidence",
            readOnly: true,
            affectsScoringOrGeneration: false,
            consumedByDemandOrMaterializer: false,
            status: "available",
            donorEvidence: [
              expect.objectContaining({
                muscle: "Glutes",
                candidateReason: "fatigue_driver",
                baselineCoverage: expect.objectContaining({
                  measured: true,
                  effectiveSets: 12,
                  floorSets: 6,
                  surplusAboveFloor: 6,
                  status: "surplus",
                }),
                eligibility: expect.objectContaining({
                  eligible: true,
                  reason: "safe_surplus_margin",
                }),
              }),
            ],
            summary: expect.objectContaining({
              candidateCount: 1,
              eligibleCount: 1,
              unknownMarginCount: 0,
            }),
          }),
          slotOwnedDemandAdjustmentPlan: expect.objectContaining({
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
            protectedDemand: expect.arrayContaining([
              expect.objectContaining({
                muscle: "Side Delts",
                candidateSlotOwners: expect.arrayContaining(["upper_b"]),
                status: "owned",
              }),
              expect.objectContaining({
                muscle: "Calves",
                status: "owned",
              }),
            ]),
            donorDemand: [
              expect.objectContaining({
                muscle: "Glutes",
                eligible: true,
                eligibilityReason: "safe_surplus_margin",
              }),
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
          }),
          nonRegressionGates: expect.objectContaining({
            preservePriorityCoverage: false,
            noLateBlockSkippedSetRiskIncrease: false,
          }),
        projectionDiff: expect.objectContaining({
          source: "v2_strategy_hypothesis_projection_diff",
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByDemandOrMaterializer: false,
          status: "available_with_limitations",
          evaluatedHypotheses: [
            "protect_lagging_muscles_earlier",
            "cap_late_block_volume",
          ],
          projectionMode: "shadow_projection",
          candidateStrategy: expect.objectContaining({
            redistributionPreference: expect.objectContaining({
              preferRedistributionBeforeNetNewVolume: true,
              candidateProtectedMuscles: expect.arrayContaining([
                "Side Delts",
                "Calves",
              ]),
              candidateDonorMuscles: ["Glutes"],
            }),
          }),
          computedNonRegressionGates: expect.objectContaining({
            preservePriorityCoverage: "pass",
            noLateBlockSkippedSetRiskIncrease: "pass",
            noSessionSizeRegression: "fail",
          }),
          conflictAwareRefinement: expect.objectContaining({
            enabled: true,
            readOnly: true,
            affectsScoringOrGeneration: false,
            status: "available_with_limitations",
            conflictCountsByType: expect.objectContaining({
              session_size_cap_conflict: 1,
            }),
            volumePolicy: {
              netNewVolumeAllowed: false,
              redistributionRequired: true,
              maxSlotSetIncreaseAllowed: 0,
            },
          }),
          preShadowCandidateFilter: expect.objectContaining({
            enabled: true,
            readOnly: true,
            affectsScoringOrGeneration: false,
            consumedByDemandOrMaterializer: false,
            status: "available_with_limitations",
            donorEligibility: expect.arrayContaining([
              expect.objectContaining({
                muscle: "Hamstrings",
                eligible: false,
                reason: "insufficient_margin",
              }),
              expect.objectContaining({
                muscle: "Glutes",
                eligible: true,
                reason: "safe_surplus_margin",
              }),
            ]),
            overrideConstruction: expect.objectContaining({
              excludedDonors: ["Hamstrings"],
              retainedDonors: ["Glutes"],
              netNewVolumeAllowed: false,
              maxSlotIncreaseAllowed: 0,
            }),
          }),
          projectedDeltas: expect.objectContaining({
            sessionSize: expect.objectContaining({
              beforeTotalSetsBySlot: expect.objectContaining({
                upper_a: 15,
              }),
              afterTotalSetsBySlot: expect.objectContaining({
                upper_a: 17,
              }),
              status: "worsens",
            }),
            repairPressure: expect.objectContaining({
              materialRepairDelta: -1,
              majorRepairDelta: 0,
              suspiciousRepairDelta: 0,
            }),
          }),
          shadowProjection: expect.objectContaining({
            source: "v2_strategy_hypothesis_shadow_projection",
            readOnly: true,
            affectsScoringOrGeneration: false,
            baselineProjection: "planner_only_no_repair",
          }),
          readiness: "needs_better_projection",
        }),
        nextSafeAction: "add_read_only_projection_diff",
      },
      v2TargetVsNoRepairDiff: {
        summary: expect.objectContaining({
          migrationCandidateCount: 1,
        }),
        replacementReadinessImpact: expect.objectContaining({
          nextBestMigrationSlice: "upper_a:chest_anchor",
        }),
        diagnosticCatalogs: expect.objectContaining({
          laneCount: 2,
          laneStatusCounts: expect.objectContaining({
            missing: 1,
            partial: 1,
          }),
        }),
      },
    });
    expect(repairEvidenceShard.artifact.data).toMatchObject({
      repairPromotionScoreboard: expect.objectContaining({
        promotionCandidatesTop: [
          expect.objectContaining({
            slotId: "upper_b",
            muscle: "Chest",
            evidenceRef: "e1",
          }),
        ],
        evidenceCatalogs: expect.objectContaining({
          promotionCandidates: expect.objectContaining({
            e1: expect.arrayContaining([
              "shadowAllocationBasis:slot_owned_muscle_before_selection",
            ]),
          }),
        }),
      }),
    });
    expect(materializationShard.artifact.data).toMatchObject({
      v2BasePlanCompare: {
        source: "v2_base_plan_compare",
        readOnly: true,
        affectsScoringOrGeneration: false,
        comparisons: {
          slotShape: {
            v2Base: {
              totalSets: 55,
              maxSlotSets: 17,
            },
          },
          repairDependency: {
            dependencyCount: 9,
          },
        },
      },
      v2BasePlanShadowConsumptionTrial: {
        source: "v2_base_plan_shadow_consumption_trial",
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByProduction: false,
        summary: {
          shadowTotalSets: 55,
          repairDependencyDelta: -8,
          regressionCount: 0,
          unclearCount: 1,
        },
        changes: {
          repairDependency: {
            readOnly: true,
            affectsScoringOrGeneration: false,
            diagnosticDelta: -8,
          },
          exerciseIdentity: {
            readOnly: true,
            affectsScoringOrGeneration: false,
          },
        },
      },
      v2CapacityMaterializerProjection: {
        source: "v2_capacity_materializer_projection",
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByProduction: false,
        targetSlot: expect.objectContaining({
          slotId: "upper_a",
          maxExerciseCountBefore: 6,
          maxExerciseCountAfter: 7,
        }),
        candidateImpact: expect.objectContaining({
          selectedIdentityDelta: 1,
          totalSetDelta: 2,
        }),
      },
      v2LaneIntentMaterializerProjection: {
        source: "v2_lane_intent_materializer_projection",
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByProduction: false,
        consumedByDemandOrMaterializer: false,
        targetLane: expect.objectContaining({
          scopedLaneId: "upper_b:chest_second_exposure",
          baselineConsumedByProduction: false,
          trialConsumesLaneIntent: true,
        }),
        candidateImpact: expect.objectContaining({
          selectedIdentityDelta: 0,
          totalSetDelta: 0,
          targetLaneExerciseDelta: 0,
        }),
        blockersBeforeBehavior: expect.arrayContaining([
          "diagnostic_lane_intent_override_not_consumed_by_runtime",
          "production_materializer_allowlist_unchanged",
        ]),
      },
    });
    expect(materializationShard.artifact.data).toMatchObject({
      v2PlanQualityBenchmark: {
        candidateQualityLab: {
          scenarioDetailTop: [
            expect.objectContaining({
              scenarioId: "low_axial_hip_extension_golden",
              actualOutcome: "pass",
              labConsumedByDemandOrMaterializer: false,
              materializerDeltaEvidence: expect.objectContaining({
                baselineIdentitySummary: ["Stiff-Legged Deadlift:3"],
                trialIdentitySummary: ["Cable Pull-Through:3"],
                selectedIdentityDelta: 2,
                totalSetDelta: 0,
                materializerBlockerDelta: 0,
                protectedCoverageStatus: "improved",
                protectedCoverageSetDelta: 3,
              }),
            }),
          ],
        },
      },
    });
    expect(crossWeekShard.artifact.data).toMatchObject({
      crossWeekProjectionGate: {
        accumulationWeeksStatus: expect.objectContaining({
          status: "projected_with_limitations",
          weekCount: 3,
        }),
        deloadStatus: expect.objectContaining({
          status: "diagnostic_projection_only",
        }),
      },
      plannerOwnedAccumulationProjection: {
        status: "available",
        weekCount: 3,
      },
    });
    expect(selectionShard.artifact.data).toMatchObject({
      v2ExerciseSelectionPlanDiagnostic: expect.objectContaining({
        status: "projected_with_limitations",
        summary: expect.objectContaining({
          missingCandidateCount: 1,
        }),
      }),
      v2SelectionCapacityPlanDiagnostic: expect.objectContaining({
        summary: expect.objectContaining({
          capacityPressureCount: 1,
          laneInspectionCategoryCounts: expect.objectContaining({
            must_preserve: 1,
          }),
        }),
      }),
      v2SelectionCapacityLaneInspection: expect.objectContaining({
        nonTargetMetRowCount: 1,
        laneInspectionCategoryCounts: expect.objectContaining({
          must_preserve: 1,
        }),
        rows: [
          expect.objectContaining({
            week: 1,
            slotId: "upper_a",
            laneId: "row_anchor",
            classification: "capacity_pressure",
            inspectionCategory: "must_preserve",
            maxExerciseCount: 6,
          }),
        ],
      }),
      v2CapacityPolicyTrialDesign: expect.objectContaining({
        status: "design_only",
        consumedByDemandOrMaterializer: false,
        trialId: "upper_a_max_exercise_count_plus_one_projection_only",
        candidateChange: expect.objectContaining({
          slotId: "upper_a",
          delta: 1,
        }),
        gateStatusCounts: expect.objectContaining({
          requires_projection: 8,
        }),
        nextSafeAction: "run_read_only_capacity_behavior_projection",
        safeForBehaviorPromotion: false,
      }),
      v2CapacityBehaviorProjection: expect.objectContaining({
        status: "projected_with_limitations",
        consumedByDemandOrMaterializer: false,
        projectionMode: "slot_cap_delta_existing_evidence_only",
        trialId: "upper_a_max_exercise_count_plus_one_projection_only",
        candidateImpact: expect.objectContaining({
          capacityPressureRowsBefore: 1,
          capacityPressureRowsAfter: 0,
          capacityPressureRowsRelieved: 1,
          regressionCount: 0,
        }),
        gateStatusCounts: expect.objectContaining({
          pass: 6,
          unknown: 2,
        }),
        nextSafeAction: "run_read_only_materializer_capacity_projection",
        safeForBehaviorPromotion: false,
      }),
    });
    expect(promotionDiffsShard.serialized).not.toContain(
      "concentration:pulling_collateral",
    );
    const mainV2Summary = mainNoRepair.v2Summary as {
      mesocycleStrategyDiagnostic?: {
        strategyHypothesisPromotionDiff?: unknown;
      };
    };
    const compactPromotionDiffSummary =
      mainV2Summary.mesocycleStrategyDiagnostic
        ?.strategyHypothesisPromotionDiff;
    expect(JSON.stringify(compactPromotionDiffSummary)).not.toContain(
      "beforeTotalSetsBySlot",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).not.toContain(
      "shadowProjection",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).not.toContain(
      "targetTierMuscles",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).not.toContain(
      "history-b:skipped_set_trend_rising",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).toContain(
      "conflictAwareRefinement",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).toContain(
      "preShadowCandidateFilter",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).not.toContain(
      "conflicts",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).not.toContain(
      "donorEligibility",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).not.toContain(
      "donorEvidence",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).not.toContain(
      "Hamstrings",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).not.toContain(
      "target_tier_under_hit",
    );
    expect(compactPromotionDiffSummary).toMatchObject({
      donorSurplusEvidence: {
        measuredMarginCount: 1,
        topReasons: [{ reason: "safe_surplus_margin", count: 1 }],
      },
    });
    expect(JSON.stringify(compactPromotionDiffSummary)).toContain(
      "slotOwnedDemandAdjustmentPlan",
    );
    expect(JSON.stringify(compactPromotionDiffSummary)).not.toContain(
      "candidate projection increased slot set pressure",
    );
    expect(strategyShard.sizeBytes).toBeLessThan(524_288);
    expect(promotionReadinessShard.sizeBytes).toBeLessThan(524_288);
    expect(promotionDiffsShard.sizeBytes).toBeLessThan(524_288);
    expect(output.sizeBytes).toBeLessThan(1_048_576);
  });

  it("keeps full V2 debug detail behind an explicit internal detail level", () => {
    const mesocycleExplain = makeMesocycleExplainNoRepairPayload();
    mesocycleExplain!.plannerOnlyNoRepair?.v2TargetVsNoRepairDiff.slotDiffs[0]?.laneDiffs.push(
      {
        laneId: "biceps",
        targetRole: "accessory",
        targetPrimaryMuscles: ["Biceps"],
        targetExerciseClasses: ["biceps_isolation"],
        targetSets: { min: 2, preferred: 3, max: 3 },
        currentStatus: "partial",
        currentEvidence: {
          selectedExercises: [
            {
              name: "Barbell Curl",
              sets: 2,
              matchedClass: "biceps_curl",
              role: "accessory",
            },
          ],
          relevantDiagnostics: [
            "target_delivery:below_min",
            "concentration:pulling_collateral",
          ],
        },
        gapCause: "set_distribution_gap",
        migrationRecommendation: "needs_set_distribution_policy",
        severity: "quality_warning",
      },
    );

    const output = createWorkoutAuditArtifactOutput(
      {
        mode: "mesocycle-explain",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        plannerOnlyNoRepair: true,
        compareRepaired: true,
        v2DebugArtifact: true,
      },
      {
        ...baseRun,
        context: {
          mode: "mesocycle-explain",
          requestedMode: "mesocycle-explain",
          userId: "user-1",
          ownerEmail: "owner@test.local",
          plannerDiagnosticsMode: "standard",
          mesocycleExplain: {
            plannerOnlyNoRepair: {
              enabled: true,
              compareRepaired: true,
              v2DebugArtifact: true,
            },
          },
        },
        generationResult: undefined,
        mesocycleExplain,
      },
      {
        artifactFileName: "parent.json",
        artifactRelativePath: "artifacts/audits/parent.json",
        v2DebugArtifactFileName: "parent-v2-debug-index.json",
        v2DebugArtifactRelativePath:
          "artifacts/audits/parent-v2-debug-index.json",
        v2DebugDetailLevel: "full",
      },
    );
    const promotionDiffsShard = output.v2DebugArtifact?.shards.find(
      (entry) => entry.artifact.id === "promotion-diffs",
    );

    expect(output.v2DebugArtifact?.artifact.detailLevel).toBe("full");
    expect(promotionDiffsShard?.artifact.detailLevel).toBe("full");
    expect(
      JSON.stringify(promotionDiffsShard?.artifact.data),
    ).toContain("concentration:pulling_collateral");
  });
});

function makeV2BasePlanCompareFixture() {
  const v2SlotMetrics = {
    slotCount: 4,
    exerciseCount: 18,
    totalSets: 55,
    maxSlotSets: 17,
    optionalLaneMaterializationCount: 0,
    standaloneOneSetExerciseCount: 0,
    fiveSetStackCount: 0,
    setsBySlot: [
      { slotId: "upper_a", exerciseCount: 5, setCount: 15 },
      { slotId: "lower_a", exerciseCount: 4, setCount: 12 },
      { slotId: "upper_b", exerciseCount: 5, setCount: 17 },
      { slotId: "lower_b", exerciseCount: 4, setCount: 11 },
    ],
  };

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
        v2Base: v2SlotMetrics,
        plannerOnlyNoRepair: {
          ...v2SlotMetrics,
          exerciseCount: 7,
          totalSets: 25,
          maxSlotSets: 8,
          standaloneOneSetExerciseCount: 2,
          setsBySlot: [{ slotId: "upper_a", exerciseCount: 3, setCount: 8 }],
        },
        repairedPlan: v2SlotMetrics,
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
        rows: [
          {
            item: "target_tier_coverage",
            classification: "v2_improves",
            evidence: ["below_floor:none"],
          },
        ],
      },
      exerciseClassCoverage: {
        classification: "v2_improves",
        rows: [
          {
            item: "chest_distinct_exposure",
            classification: "v2_improves",
            v2Base: true,
            plannerOnlyNoRepair: false,
            repairedPlan: true,
            evidence: ["v2:true", "noRepair:false", "repaired:true"],
          },
          {
            item: "hamstrings_hinge_plus_curl",
            classification: "v2_improves",
            v2Base: true,
            plannerOnlyNoRepair: false,
            repairedPlan: true,
            evidence: ["v2:true", "noRepair:false", "repaired:true"],
          },
        ],
      },
      repairDependency: {
        classification: "v2_improves",
        dependencyCount: 9,
        responsibilities: [
          {
            item: "support-floor closure as planner author",
            classification: "v2_improves",
            dependencyCount: 1,
            evidence: ["upper_a:Chest:Machine Chest Press:support_floor:set_bumped"],
          },
        ],
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
        slots: [
          {
            slotId: "upper_a",
            classification: "unclear",
            v2BaseIdentities: ["Machine Chest Press"],
            plannerOnlyNoRepairIdentities: ["Incline Dumbbell Press"],
            repairedPlanIdentities: ["Machine Chest Press"],
            evidence: [
              "v2:Machine Chest Press",
              "noRepair:Incline Dumbbell Press",
              "repaired:Machine Chest Press",
            ],
          },
        ],
        materializerDifferences: [
          "upper_a:identity_differs_from_projection_evidence",
        ],
      },
      deloadReadiness: {
        classification: "v2_preserves",
        rows: [
          {
            item: "preserved_identities",
            classification: "v2_preserves",
            evidence: ["sameIdentitiesSupported:true"],
          },
        ],
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
    interpretationRules: {
      shadowConsumptionIsDiagnosticOnly: true,
      repairedPlanIsEvidenceNotTarget: true,
      noRepairOutputShowsCurrentPlannerBeforeRepair: true,
      differencesFromRepairedPlanDoNotImplyV2Wrong: true,
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
          setsBySlot: [
            { slotId: "upper_a", exerciseCount: 5, setCount: 15 },
          ],
        },
        rows: [
          {
            item: "total_weekly_sets",
            classification: "v2_improves",
            evidence: ["v2:55"],
          },
        ],
      },
      muscleCoverage: {
        classification: "v2_improves",
        underHitMuscles: [],
        overConcentratedMuscles: [],
        managedCollateralExposure: [],
        rows: [
          {
            item: "target_tier_coverage",
            classification: "v2_improves",
            evidence: ["below_floor:none"],
          },
        ],
      },
      exerciseClassCoverage: {
        classification: "v2_improves",
        rows: [
          {
            item: "chest_distinct_exposure",
            classification: "v2_improves",
            v2Base: true,
            plannerOnlyNoRepair: false,
            repairedPlan: true,
            evidence: ["v2:true"],
          },
        ],
      },
      repairDependency: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        classification: "v2_improves",
        currentDependencyCount: 9,
        shadowRemainingDependencyCount: 1,
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
      deloadReadiness: {
        classification: "v2_preserves",
        rows: [
          {
            item: "preserved_identities",
            classification: "v2_preserves",
            evidence: ["sameIdentitiesSupported:true"],
          },
        ],
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

function makeV2CapacityMaterializerProjectionFixture() {
  return {
    version: 1,
    source: "v2_capacity_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "projected_with_limitations",
    projectionMode: "slot_cap_delta_materializer_dry_run",
    trialId: "upper_a_max_exercise_count_plus_one_projection_only",
    candidateChange: {
      kind: "slot_max_exercise_count_delta",
      slotId: "upper_a",
      delta: 1,
    },
    comparedPlans: {
      baselineAvailable: true,
      trialAvailable: true,
      inventoryExerciseCount: 20,
    },
    targetSlot: {
      slotId: "upper_a",
      maxExerciseCountBefore: 6,
      maxExerciseCountAfter: 7,
      baselineExerciseCount: 6,
      trialExerciseCount: 7,
      baselineSetCount: 15,
      trialSetCount: 17,
      addedIdentities: ["Cable Fly"],
      removedIdentities: [],
      floorCriticalLaneIds: ["chest_anchor"],
      floorCriticalLaneIdsMaterialized: ["chest_anchor"],
      floorCriticalLaneIdsMissing: [],
    },
    materializer: {
      baselineStatus: "materialized",
      trialStatus: "materialized",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: true,
      trialSeedShapeCompatible: true,
    },
    candidateImpact: {
      selectedIdentityDelta: 1,
      totalSetDelta: 2,
      targetSlotExerciseDelta: 1,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      regressions: [],
      improvements: ["added_identities:1"],
      changedSlotCount: 1,
      changedSlots: [
        {
          slotId: "upper_a",
          exerciseCountDelta: 1,
          setDelta: 2,
          addedIdentityCount: 1,
          removedIdentityCount: 0,
        },
      ],
    },
    gates: [
      ["hard_floors", "pass"],
      ["over_mav", "unknown"],
      ["session_size", "pass"],
      ["five_set_stacking", "pass"],
      ["lane_survival", "pass"],
      ["duplicates", "pass"],
      ["materializer_validity", "pass"],
      ["acceptance_result", "unknown"],
    ].map(([gateId, status]) => ({
      gateId,
      status,
      measured: status !== "unknown",
      ownerSeam: "v2_materialization_dry_run",
      evidence: [`${gateId}:${status}`],
      regressions: [],
      requiredNextEvidence: status === "unknown" ? ["next_evidence"] : [],
    })),
    blockersBeforeBehavior: [
      "acceptance_result_gate_unknown",
      "over_mav_gate_unknown",
      "acceptance_gate_not_rerun",
      "production_projection_not_consuming_trial",
    ],
    nextSafeAction: "inspect_materializer_capacity_projection",
    limitations: ["read_only_materializer_dry_run_only"],
    safeForBehaviorPromotion: false,
  };
}

function makeV2LaneIntentMaterializerProjectionFixture() {
  return {
    version: 1,
    source: "v2_lane_intent_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "projected_with_limitations",
    projectionMode: "lane_intent_shadow_materializer_dry_run",
    trialId: "upper_b_chest_second_exposure_lane_intent_shadow",
    comparedPlans: {
      baselineAvailable: true,
      trialAvailable: true,
      inventoryExerciseCount: 20,
    },
    targetLane: {
      scopedLaneId: "upper_b:chest_second_exposure",
      slotId: "upper_b",
      laneId: "chest_second_exposure",
      intentAvailable: true,
      baselineConsumedByProduction: false,
      trialConsumesLaneIntent: true,
      baselineExerciseCount: 1,
      trialExerciseCount: 1,
      baselineSetCount: 2,
      trialSetCount: 2,
      addedIdentities: [],
      removedIdentities: [],
    },
    materializer: {
      baselineStatus: "materialized",
      trialStatus: "materialized",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: true,
      trialSeedShapeCompatible: true,
    },
    candidateImpact: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      targetLaneExerciseDelta: 0,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      regressions: [],
      improvements: [],
      changedSlotCount: 0,
      changedSlots: [],
    },
    contractTrial: {
      appliedContract: "lane_selection_intent_v0",
      exactFutureContractApplied: false,
      representedThrough: "laneSelectionIntent_v0_diagnostic_override",
      futureMovementPattern: null,
      futureExerciseClass: null,
      v0CanExpressFutureMovementAndClass: null,
      v0ProxyAllowedExerciseClasses: ["chest_press", "chest_fly"],
      evidence: ["trial_consumes_existing_laneSelectionIntent_v0"],
    },
    relevantLowerBPosteriorChainLanes: [],
    lowAxialClosureStatus: {
      baseline: "not_closed",
      trial: "not_closed",
      status: "not_measured",
      evidence: ["not_low_axial_trial"],
    },
    protectedCoverage: {
      status: "not_measured",
      protectedMuscles: [],
      baselineLowAxialSets: 0,
      trialLowAxialSets: 0,
      lowAxialSetDelta: 0,
    },
    duplicateConcentrationFatigueImpact: {
      status: "not_measured",
      duplicateExerciseDelta: 0,
      highFatigueSetDelta: 0,
      fatigueWeightedSetDelta: 0,
    },
    exclusionProof: {
      trueHingesExcluded: false,
      hamstringCurlsExcluded: false,
      backExtensionClosureExcluded: false,
      genericGluteAccessoriesExcluded: false,
      selectedExcludedIdentities: [],
      evidence: ["not_low_axial_trial"],
    },
    nonConsumption: {
      productionPlannerMaterializerRanking: false,
      seedRuntimeReceiptDb: false,
      acceptanceThreshold: false,
      repairBehavior: false,
    },
    blockersBeforeBehavior: [
      "acceptance_gate_not_rerun",
      "diagnostic_lane_intent_override_not_consumed_by_runtime",
      "lane_intent_trial_no_candidate_impact",
      "production_materializer_allowlist_unchanged",
    ],
    nextSafeAction: "pivot_to_higher_roi_track",
    limitations: [
      "read_only_materializer_dry_run_only",
      "does_not_change_lane_selection_intent_allowlist",
      "does_not_feed_production_materializer",
      "does_not_write_executable_seed_truth",
      "does_not_change_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

function makeMesocycleExplainNoRepairPayload() {
  const plannerPolicy = buildV2PlannerMesocyclePolicy();

  return {
    version: 1,
    sourceMesocycleId: "meso-source",
    retrospectiveMesocycleId: "meso-retro",
    preview: {
      sourceMesocycleId: "meso-source",
      rationaleBasis: "reconstructed_now",
      designBasis: {
        focus: "hypertrophy",
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        durationWeeks: 5,
        volumeTarget: "MEDIUM",
        intensityBias: "MODERATE",
        profileReasonCodes: [],
        structureReasonCodes: [],
        startingPointReasonCodes: [],
      },
      carryForwardReasons: [],
      slotPlans: [],
      projectedSessions: [],
      projectionDiagnostics: {
        label: "projection diagnostics",
        readOnly: true,
        affectsScoringOrGeneration: false,
        summary: {
          setStackingPressure: 0,
          duplicateExercisePressure: 0,
          diversityPenalties: 0,
          hingeSquatBalance: 0,
          isolationInjectionTriggers: 0,
          softCapsOverriddenByP0: 0,
        },
        constraintsTriggered: [],
        tradeoffs: [],
        softCapOverridesByP0: [],
      },
      exerciseRationale: [],
    },
    seed: {
      mesocycleId: "meso-retro",
      available: false,
      slotPlans: [],
      exerciseRationale: [],
    },
    reality: {
      mesocycleId: "meso-retro",
      workoutCount: 0,
      generatedVsSaved: [],
      runtimeDrift: [],
      exerciseRationale: [],
    },
    comparison: {
      previewVsSeed: {
        comparable: false,
        comparisonBasis: "none",
        slotDiffs: [],
      },
      seedVsReality: {
        comparable: false,
        workoutDrift: [],
      },
      previewVsReality: {
        comparable: false,
        comparisonBasis: "none",
        slotDiffs: [],
      },
    },
    limitations: [],
    plannerOnlyNoRepair: {
      enabled: true,
      readOnly: true,
      affectsScoringOrGeneration: false,
      canReplaceRepairedProjection: false,
      summary: {
        status: "fail",
        targetLanesSatisfied: 0,
        targetLanesMissing: 1,
        unresolvedDemandCount: 1,
        validationFailureCount: 1,
      },
      acceptanceClassification: {
        basicMesocycleShapeStatus: "fail",
        replacementReadinessStatus: "blocked",
        hardBlockers: [
          {
            code: "primary_hard_target_below_minimum",
            evidence: ["upper_a:Chest:below_minimum"],
          },
        ],
        qualityWarnings: [],
        diagnosticOnly: [],
        sessionShaping: [],
        migrationScoreboard: {
          materialRepairCount: 1,
          majorRepairCount: 0,
          suspiciousRepairs: 0,
          canReplaceRepairedProjection: false,
          reason: "blocked",
        },
      },
      repairPromotionScoreboard: {
        version: 1,
        readOnly: true,
        affectsScoringOrGeneration: false,
        source: "repaired_planning_reality",
        rawRepairEvidence: {
          rawRowCount: 3,
          materialRepairCount: 2,
          majorRepairCount: 1,
          likelyAvoidableMaterialRepairCount: 1,
          remainingMaterialRepairCount: 1,
          suspiciousRepairCount: 1,
        },
        summary: {
          promotionCandidateCount: 1,
          doNotPromoteCount: 2,
          safetyNetCount: 1,
          collateralDiagnosticCount: 0,
          diagnosticOnlyCount: 1,
        },
        interpretation: {
          legacyRepairPressure: {
            rawRowCount: 3,
            materialRepairCount: 2,
            majorRepairCount: 1,
            likelyAvoidableMaterialRepairCount: 1,
            remainingMaterialRepairCount: 1,
            suspiciousRepairCount: 1,
            note: "raw_legacy_repair_evidence_not_behavior_promotion_pressure",
          },
          currentV2PolicyGap: {
            supportDirectFloorBlockerCount: 3,
            setDistributionCapacityGapCount: 1,
            setBudgetPolicyFailureCount: 1,
            selectionFeasibilityCapacityPressureCount: 0,
            staleWeek1ReadoutArtifactCount: 0,
            capAwareExpansionLimitationCount: 0,
            concentrationQualityGapCount: 0,
            optionalDiagnosticLaneCount: 0,
            selectionBlockerCount: 0,
            classTaxonomyMismatchCount: 0,
          },
          safetyNonRegressionRows: {
            count: 1,
            includesSuspiciousRows: true,
          },
          staleRepairedProjectionArtifacts: {
            count: 0,
            reasonCounts: {
              v2_already_solved_differently: 0,
              collateral_support_accounting: 0,
              legacy_repaired_artifact: 0,
              support_floor_design_needed: 0,
            },
          },
          quarantineGroups: {
            upstreamOwnedCandidate: {
              count: 1,
              evidenceQuality: "owner_specific_behavior_candidate",
              ownerCounts: {
                SlotDemandAllocationByWeek: 1,
              },
              requiredProof: [
                "bounded_owner_specific_behavior_trial",
                "measured_projection_non_regression",
                "seed_runtime_non_consumption_verified",
              ],
            },
            safetyRepairOnly: {
              count: 1,
              evidenceQuality: "safety_or_legacy_only",
              topReasons: {
                raw_suspicious_do_not_promote: 1,
              },
              requiredProof: [
                "prove_safety_guard_can_be_owned_upstream_without_regression",
                "keep_repair_as_fallback_until_replaced",
              ],
            },
            collateralAmbiguous: {
              count: 0,
              evidenceQuality: "collateral_or_ambiguous",
              topReasons: {},
              requiredProof: [
                "prove_target_muscle_slot_ownership",
                "separate_collateral_credit_from_direct_floor_satisfaction",
              ],
            },
            staleArtifact: {
              count: 0,
              evidenceQuality: "stale_repaired_projection_artifact",
              topReasons: {},
              requiredProof: [
                "compare_against_current_v2_no_repair_solution",
                "do_not_copy_legacy_repaired_identity_or_set_bump",
              ],
            },
            missingEvidenceOrUnmeasuredGate: {
              count: 1,
              evidenceQuality: "missing_or_unmeasured_gate",
              topReasons: {
                materiality_none_or_diagnostic_denominator_artifact: 1,
              },
              requiredProof: [
                "owner_specific_projection_delta",
                "materializer_non_regression",
                "cross_week_and_deload_projection",
              ],
            },
          },
          missingProofBeforeBehaviorPromotion: [
            {
              gate: "owner_specific_behavior_candidate",
              status: "pass",
              ownerSeam: "SlotDemandAllocationByWeek",
              missingEvidence: [],
              evidence: ["behaviorPromotionCandidateCount=1"],
            },
            {
              gate: "current_v2_policy_gap",
              status: "blocked",
              ownerSeam: "SetDistributionIntent",
              missingEvidence: [
                "resolve_or_measure_current_v2_policy_gaps_before_behavior",
              ],
              evidence: [
                "supportDirectFloorBlockerCount=3",
                "setDistributionCapacityGapCount=1",
                "setBudgetPolicyFailureCount=1",
              ],
            },
            {
              gate: "measured_behavior_projection",
              status: "missing",
              ownerSeam: "read_only_projection_or_materializer_comparison",
              missingEvidence: [
                "measured_projection_delta",
                "materializer_non_regression",
                "cross_week_accumulation_projection",
                "deload_projection",
              ],
              evidence: [
                "repair_scoreboard_is_repaired_projection_evidence_only",
              ],
            },
            {
              gate: "seed_runtime_non_consumption",
              status: "required_before_promotion",
              ownerSeam: "accepted_seed_runtime_replay",
              missingEvidence: [
                "focused_seed_runtime_guard_tests_for_any_future_behavior_promotion",
              ],
              evidence: [
                "diagnostic_readout_does_not_change_slotPlanSeedJson_or_runtime_replay",
              ],
            },
          ],
          gapInventory: [
            {
              rank: 1,
              gapId: "support_direct_floor",
              description:
                "Support muscles still need direct-floor ownership separated from collateral credit.",
              likelyOwnerSeam: "SetDistributionIntent",
              evidenceQuality: "diagnostic_count",
              trainingImportance: "high",
              gapCount: 3,
              currentEvidence: ["supportDirectFloorBlockerCount=3"],
              missingProof: [
                "owner_specific_projection_delta",
                "materializer_non_regression",
                "cross_week_direct_floor_projection",
              ],
              measurableNextStep:
                "measure_support_floor_materializer_projection",
              status: "blocked_by_missing_evidence",
            },
          ],
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
            evidence: [
              "shadowAllocationBasis:slot_owned_muscle_before_selection",
            ],
          },
        ],
        doNotPromoteRows: [
          {
            slotId: "upper_a",
            muscle: "Lats",
            exerciseName: "Cable Pullover",
            action: "removed",
            materiality: "major",
            repairMechanism: "forbidden_cleanup",
            reason: "raw_suspicious_do_not_promote",
            demotionReasons: ["raw_suspicious_do_not_promote"],
            bucket: "safety_net",
            evidence: ["action:removed"],
          },
          {
            slotId: null,
            muscle: "Chest",
            exerciseName: null,
            action: "diagnostic_only",
            materiality: "none",
            repairMechanism: "diagnostic_denominator",
            reason: "materiality_none_or_diagnostic_denominator_artifact",
            demotionReasons: [
              "materiality_none_or_diagnostic_denominator_artifact",
            ],
            bucket: "diagnostic_only",
            evidence: ["materiality:none"],
          },
        ],
        safetyNetRows: [
          {
            slotId: "upper_a",
            muscle: "Lats",
            exerciseName: "Cable Pullover",
            action: "removed",
            materiality: "major",
            repairMechanism: "forbidden_cleanup",
            reason: "raw_suspicious_do_not_promote",
            demotionReasons: ["raw_suspicious_do_not_promote"],
            evidence: ["action:removed"],
          },
        ],
        collateralDiagnosticRows: [],
        diagnosticRows: [
          {
            slotId: null,
            muscle: "Chest",
            exerciseName: null,
            action: "diagnostic_only",
            materiality: "none",
            repairMechanism: "diagnostic_denominator",
            reason: "materiality_none_or_diagnostic_denominator_artifact",
            demotionReasons: [
              "materiality_none_or_diagnostic_denominator_artifact",
            ],
            evidence: ["materiality:none"],
          },
        ],
        rawSuspiciousRows: [
          {
            slotId: "upper_a",
            muscle: "Lats",
            exerciseName: "Cable Pullover",
            repairMechanism: "forbidden_cleanup",
            reason: "do_not_promote",
            recommendation: "Do not promote this repair upstream.",
          },
        ],
      },
      v2BasePlanCompare: makeV2BasePlanCompareFixture(),
      v2BasePlanShadowConsumptionTrial:
        makeV2BasePlanShadowConsumptionTrialFixture(),
      v2CapacityMaterializerProjection:
        makeV2CapacityMaterializerProjectionFixture(),
      v2LaneIntentMaterializerProjection:
        makeV2LaneIntentMaterializerProjectionFixture(),
      crossWeekProjectionGate: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        week1Status: {
          status: "fail",
          basis: ["basicMesocycleShapeStatus:fail"],
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
              limitations: [
                "planner_owned_week_projection_exists_but_is_diagnostic_only",
              ],
              safeForBehaviorPromotion: false,
            },
            {
              week: 3,
              phase: "hard_accumulation",
              volumeMultiplier: 1.075,
              rirTarget: "1-2",
              projectionBasis: "planner_owned_read_only_projection",
              limitations: [
                "planner_owned_week_projection_exists_but_is_diagnostic_only",
              ],
              safeForBehaviorPromotion: false,
            },
            {
              week: 4,
              phase: "peak_overreach_lite",
              volumeMultiplier: 1.125,
              rirTarget: "0-1",
              projectionBasis: "planner_owned_read_only_projection",
              limitations: [
                "planner_owned_week_projection_exists_but_is_diagnostic_only",
              ],
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
        blockers: ["required_lane_missing"],
        warnings: ["planner_owned_weeks_2_to_4_projection_is_read_only"],
        missingInputs: [],
        projectedWeekSummaries: [
          {
            week: 1,
            phase: "entry_calibration",
            volumeMultiplier: 1,
            totalPlannedSets: 12,
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
        buildV2PlannerMesocyclePolicy().mesocycleStrategyDiagnostic,
      strategyToDemandProjection: plannerPolicy.strategyToDemandProjection,
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
          slots: [
            {
              slotId: "upper_a",
              intent: "upper",
              targetSessionSets: { min: 12, max: 18 },
              lanes: [
                {
                  laneId: "chest_anchor",
                  required: true,
                  role: "anchor",
                  primaryMuscles: ["Chest"],
                  preferredExerciseClasses: ["horizontal_press"],
                  targetSets: { min: 3, preferred: 4, max: 5 },
                  currentWeek1Status: "missing",
                },
              ],
            },
          ],
        },
        weeklyProgressionModel: {
          weeks: [
            {
              week: 1,
              phase: "entry_calibration",
              volumeMultiplier: 1,
              rirTarget: "3-4",
              progressionIntent: "establish_anchors",
              limitations: [],
            },
          ],
        },
        deloadTransform: {
          preserveExerciseIdentities: true,
          targetVolumeReductionPercent: { min: 40, max: 60 },
          targetRir: "4-5",
          removeRedundantAccessories: true,
          introduceNewMovements: false,
          projectionStatus: "partially_modeled",
          limitations: [],
        },
        validationRules: [
          {
            ruleId: "required_lanes_present",
            severity: "hard_blocker",
            description: "Required lanes must be present.",
            week1Status: "fail",
            fullMesocycleStatus: "fail",
          },
        ],
        replacementReadiness: {
          canReplaceRepairedProjection: false,
          reason: ["hard_blockers_present"],
        },
      },
      v2TargetVsNoRepairDiff: {
        version: 1,
        source: "v2_planner_no_repair_experimental",
        readOnly: true,
        affectsScoringOrGeneration: false,
        summary: {
          targetLaneCount: 1,
          satisfiedLaneCount: 0,
          partialLaneCount: 0,
          missingLaneCount: 1,
          blockedLaneCount: 0,
          repairDependentLaneCount: 0,
          migrationCandidateCount: 1,
          suspiciousOrBlockedCount: 0,
        },
        slotDiffs: [
          {
            slotId: "upper_a",
            laneDiffs: [
              {
                laneId: "chest_anchor",
                targetRole: "anchor",
                targetPrimaryMuscles: ["Chest"],
                targetExerciseClasses: ["horizontal_press"],
                targetSets: { min: 3, preferred: 4, max: 5 },
                currentStatus: "missing",
                currentEvidence: {
                  selectedExercises: [],
                  relevantDiagnostics: ["target_status:missing"],
                },
                gapCause: "capacity_gap",
                migrationRecommendation: "promote_to_planner_later",
                severity: "hard_blocker",
              },
            ],
          },
        ],
        replacementReadinessImpact: {
          canReplaceRepairedProjection: false,
          blockers: ["required_lane_missing"],
          nextBestMigrationSlice: "upper_a:chest_anchor",
        },
      },
      v2SetDistributionIntent: {
        version: 1,
        source: "v2_planner_policy",
        readOnly: true,
        affectsScoringOrGeneration: false,
        summary: {
          weekCount: 5,
          slotCount: 1,
          laneCount: 1,
          plannedTotalSetsByWeek: [
            {
              week: 1,
              totalSets: 12,
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
          doesNotAffectSeedSerialization: true,
          doesNotAffectRuntimeReplay: true,
        },
      },
      v2SupportLanePolicy: plannerPolicy.v2SupportLanePolicy,
      v2SupportLaneProjectionDiagnostic:
        makeV2SupportLaneProjectionDiagnostic(),
      v2SelectionCapacityPlanDiagnostic:
        makeV2SelectionCapacityPlanDiagnostic(),
      plannerOwnedAccumulationProjection:
        makePlannerOwnedAccumulationProjection(),
      v2DeloadProjectionDiagnostic: makeV2DeloadProjectionDiagnostic(),
      v2ExerciseSelectionPlanDiagnostic:
        makeV2ExerciseSelectionPlanDiagnostic(),
      v2LaneSelectionIntentAudit: buildV2LaneSelectionIntentAudit({
        exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
        targetSkeleton: plannerPolicy.targetSkeleton,
      }),
      lowAxialHipExtensionLimitation: {
        version: 1,
        source: "v2_planner_no_repair_diagnostic",
        readOnly: true,
        affectsScoringOrGeneration: false,
        slotId: "lower_b",
        status: "acceptable_with_limitations",
        limitationText:
          "Low-axial hip extension is glute-biased, has lower hamstring-per-set than true hinge compounds, and is not equivalent to hinge_compound; it is acceptable only when the Lower B knee_flexion_curl direct floor and weekly Hamstrings target are met and lower-back/axial fatigue management favors low-axial work.",
        acceptanceCriteria: {
          lowerBKneeFlexionCurlDirectFloor: {
            status: "met",
            directSets: 2,
            floor: 2,
          },
          weeklyHamstringsTarget: {
            status: "met",
            projectedEffectiveSets: 6.3,
            targetMin: 6,
            targetPreferred: 6,
          },
          axialFatigueManagement: {
            status: "favors_low_axial",
            evidence: ["low_axial_lower_back_effective_sets:0"],
          },
        },
        hamstringContribution: {
          lowerBEffectiveSets: 3.1,
          weeklyEffectiveSets: 6.3,
          curlEffectiveSets: 2,
          hipExtensionEffectiveSets: 1.1,
          trueHingeEffectiveSets: 0,
          otherEffectiveSets: 0,
          curlShareOfLowerBPercent: 64.5,
          hipExtensionShareOfLowerBPercent: 35.5,
          trueHingeShareOfLowerBPercent: 0,
          weeklyCurlEffectiveSets: 4,
          weeklyHipExtensionEffectiveSets: 2.3,
          weeklyTrueHingeEffectiveSets: 0,
          weeklyOtherEffectiveSets: 0,
          curlShareOfWeeklyPercent: 63.5,
          hipExtensionShareOfWeeklyPercent: 36.5,
          trueHingeShareOfWeeklyPercent: 0,
        },
        trueHingeExposureCount: 0,
        lowAxialHipExtensionAnchorCount: 1,
        lowAxialExercises: [
          {
            exerciseName: "Glute Bridge",
            sets: 3,
            hamstringsEffectiveSets: 1.1,
            glutesEffectiveSets: 3,
            lowerBackEffectiveSets: 0,
          },
        ],
        expansionGuidance: [
          "weeks_3_to_4_guidance:prefer_curl_expansion_first_if_hamstrings_need_more",
          "weeks_3_to_4_guidance:consider_true_hinge_exposure_only_if_curl_capacity_monotony_or_hamstring_target_pressure_demands_it_and_fatigue_budget_allows",
          "weeks_3_to_4_guidance:do_not_add_glute_bridge_sets_for_hamstring_delivery_alone",
        ],
        evidence: [
          "true_hinge_exposure_count:0",
          "curl_share_of_lower_b_hamstrings:64.5%",
        ],
        limitations: [
          "low_axial_hip_extension_anchor_is_not_equivalent_to_hinge_compound",
          "valid_only_when_curl_floor_and_weekly_hamstrings_target_are_met",
        ],
        safeForBehaviorPromotion: false,
      },
      slotPlans: [
        {
          slotId: "upper_a",
          exercises: [],
          missingLanes: ["chest_anchor"],
          unresolvedDemand: ["Chest below minimum"],
          validationFailures: ["required lane missing"],
        },
      ],
      weeklyMuscleTotals: [],
      setAllocationChanges: [],
      weeklyMuscleTotalChanges: [],
      acceptanceChecks: [
        {
          check: "required lanes present",
          status: "fail",
          evidence: ["upper_a:chest_anchor:missing"],
        },
      ],
      acceptanceFailures: [],
      qualityWarnings: [],
      diagnosticRows: [],
      ignoredRows: [],
      repairDependenciesDisabled: ["support-floor closure"],
      comparisonToRepaired: {
        repairedPasses: true,
        noRepairPasses: false,
        mainGaps: ["required_lane_missing"],
      },
    },
  } as WorkoutAuditRun["mesocycleExplain"];
}
