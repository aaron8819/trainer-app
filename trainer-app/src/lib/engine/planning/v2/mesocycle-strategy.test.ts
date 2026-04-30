import { describe, expect, it } from "vitest";
import {
  buildV2MesocycleDemand,
  buildV2MesocycleStrategyDiagnostic,
  buildV2PlannerMesocyclePolicy,
  buildV2TargetSkeleton,
  type V2MesocycleStrategyInput,
  type V2StrategyHypothesisShadowProjectionEvidence,
} from "./index";

function buildStrategyInput(): V2MesocycleStrategyInput {
  return {
    version: 1,
    userProfile: {
      trainingGoal: "hypertrophy",
      trainingAge: "intermediate",
      availableTrainingDays: 4,
      equipmentProfile: ["barbell", "cable", "dumbbell"],
      constraints: ["split:upper_lower", "sessions_per_week:4"],
      preferences: ["favorite_exercise_count:2"],
      painOrToleranceFlags: ["shoulder_history"],
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
        mesocycleId: "meso-any-1",
        sourcePlanner: "legacy_projection",
        status: "COMPLETED",
        adherenceSummary: {
          plannedSessions: 16,
          completedSessions: 14,
          partialSessions: 1,
          skippedSessions: 1,
        },
        performedVolumeSummary: [
          {
            muscle: "Chest",
            plannedSets: 40,
            performedSets: 36,
            targetRange: "target:40",
            status: "within",
          },
        ],
        performanceSignals: [
          {
            exerciseId: "incline-db-press",
            exerciseName: "Incline Dumbbell Press",
            signal: "progressed",
            confidence: "medium",
          },
        ],
      },
      {
        mesocycleId: "meso-any-2",
        sourcePlanner: "legacy_projection",
        status: "COMPLETED",
        adherenceSummary: {
          plannedSessions: 16,
          completedSessions: 13,
          partialSessions: 2,
          skippedSessions: 1,
        },
      },
    ],
    blockResponseSignals: [
      {
        mesocycleId: "meso-any-1",
        sourcePlanner: "legacy_projection",
        adherence: {
          completedSessions: 14,
          partialSessions: 1,
          skippedSessions: 1,
          skippedSetCount: 2,
          skippedSetTrend: "stable",
        },
        effortProgression: {
          averageRpeByWeek: [
            { week: 1, averageRpe: 7 },
            { week: 4, averageRpe: 8.3 },
          ],
          hardWeekEffortReached: true,
          deloadExecuted: true,
        },
        muscleDistribution: {
          recurringUnderHitMuscles: ["Side Delts"],
          recurringOverConcentratedMuscles: ["Glutes"],
          belowMevFlags: ["Side Delts:below_target_or_mev_evidence"],
          overMavFlags: ["Glutes:over_target_or_mav_evidence"],
        },
        fatigueDistribution: {
          systemicFatigueFlag: false,
          likelyFatigueDrivers: ["Glutes"],
          evidence: ["hard_week_effort_reached", "overlap_fatigue_driver:Glutes"],
        },
        strategyImplications: [
          "preserve_successful_progression",
          "protect_lagging_muscles_earlier",
          "reduce_axial_or_overlap_fatigue",
        ],
        confidence: "medium",
      },
      {
        mesocycleId: "meso-any-2",
        sourcePlanner: "legacy_projection",
        adherence: {
          completedSessions: 13,
          partialSessions: 2,
          skippedSessions: 1,
          skippedSetCount: 6,
          skippedSetTrend: "rising",
        },
        effortProgression: {
          averageRpeByWeek: [
            { week: 2, averageRpe: 7.4 },
            { week: 4, averageRpe: 8.8 },
          ],
          hardWeekEffortReached: true,
          deloadExecuted: false,
        },
        muscleDistribution: {
          recurringUnderHitMuscles: ["Side Delts", "Calves"],
          recurringOverConcentratedMuscles: ["Glutes", "Front Delts"],
          belowMevFlags: [
            "Side Delts:below_target_or_mev_evidence",
            "Calves:below_target_or_mev_evidence",
          ],
          overMavFlags: [
            "Glutes:over_target_or_mav_evidence",
            "Front Delts:over_target_or_mav_evidence",
          ],
        },
        fatigueDistribution: {
          systemicFatigueFlag: true,
          likelyFatigueDrivers: ["Glutes", "Front Delts"],
          evidence: [
            "late_block_skipped_sets_rising",
            "hard_week_effort_reached",
            "overlap_fatigue_driver:Glutes",
          ],
        },
        strategyImplications: [
          "cap_late_block_volume",
          "protect_lagging_muscles_earlier",
          "reduce_axial_or_overlap_fatigue",
          "improve_deload_execution",
        ],
        confidence: "medium",
      },
    ],
    exerciseResponseSignals: [
      {
        exerciseId: "incline-db-press",
        exerciseName: "Incline Dumbbell Press",
        muscleTargets: ["Chest"],
        signal: "progressed",
        evidence: {
          mesocycleIds: ["meso-any-1", "meso-any-2"],
          completedExposureCount: 6,
          skippedExposureCount: 0,
          loadTrend: "rising",
          repTrend: "stable",
          rpeTrend: "stable",
          notes: ["derived_from_performed_logs_not_prescribed_plan_shape"],
        },
        confidence: "high",
      },
      {
        exerciseId: "standing-calf-raise",
        exerciseName: "Standing Calf Raise",
        muscleTargets: ["Calves"],
        signal: "skipped_often",
        evidence: {
          mesocycleIds: ["meso-any-1", "meso-any-2"],
          completedExposureCount: 1,
          skippedExposureCount: 3,
          loadTrend: "unknown",
          repTrend: "unknown",
          rpeTrend: "unknown",
          notes: ["derived_from_performed_logs_not_prescribed_plan_shape"],
        },
        confidence: "medium",
      },
    ],
    readinessAndRecoverySignals: {
      available: ["subjective_readiness", "performance_compliance"],
      missing: ["wearable_recovery_signal"],
      fatigueFlags: ["performance_stalls:1"],
      painFlags: ["soreness:shoulder:2"],
      adherenceFlags: ["historical_adherence_below_80_percent:meso-any-2"],
    },
    evidenceLimitations: [
      "historical_mesocycles_are_validation_data_not_policy_targets",
      "strategy_input_does_not_feed_mesocycle_demand",
    ],
  };
}

function buildShadowProjectionEvidence(
  overrides: Partial<V2StrategyHypothesisShadowProjectionEvidence> = {},
): V2StrategyHypothesisShadowProjectionEvidence {
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
      protectedSlotOwners: {
        Calves: ["lower_a", "lower_b"],
        "Side Delts": ["upper_a", "upper_b"],
      },
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
        {
          muscle: "Calves",
          status: "covered",
          sets: 4,
          minSets: 4,
          priority: "support",
          targetTier: "B_SUPPORT",
        },
        {
          muscle: "Side Delts",
          status: "below_minimum",
          sets: 1,
          minSets: 3,
          priority: "support",
          targetTier: "B_SUPPORT",
        },
      ],
      donorMuscleCoverage: [
        {
          muscle: "Glutes",
          status: "covered",
          sets: 12,
          minSets: 4,
          priority: "support",
          targetTier: "B_SUPPORT",
        },
      ],
      sessionSize: {
        totalSetsBySlot: {
          lower_a: 14,
          lower_b: 14,
          upper_a: 15,
          upper_b: 18,
        },
      },
      concentration: {
        count: 2,
        summary: ["high_concentration_count:2"],
      },
      repairPressure: {
        materialRepairCount: 2,
        majorRepairCount: 1,
        suspiciousRepairCount: 1,
      },
      forbiddenSlotRisk: {
        count: 0,
        summary: ["forbidden_primary_violation_count:0"],
      },
      lateBlockFatigueRisk: {
        count: 2,
        totalSets: 61,
        maxSlotSets: 18,
        summary: ["high_concentration_count:2", "max_slot_sets:18"],
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
        {
          muscle: "Calves",
          status: "covered",
          sets: 4,
          minSets: 4,
          priority: "support",
          targetTier: "B_SUPPORT",
        },
        {
          muscle: "Side Delts",
          status: "covered",
          sets: 3,
          minSets: 3,
          priority: "support",
          targetTier: "B_SUPPORT",
        },
      ],
      donorMuscleCoverage: [
        {
          muscle: "Glutes",
          status: "covered",
          sets: 11,
          minSets: 4,
          priority: "support",
          targetTier: "B_SUPPORT",
        },
      ],
      sessionSize: {
        totalSetsBySlot: {
          lower_a: 14,
          lower_b: 13,
          upper_a: 17,
          upper_b: 17,
        },
      },
      concentration: {
        count: 1,
        summary: ["high_concentration_count:1"],
      },
      repairPressure: {
        materialRepairCount: 1,
        majorRepairCount: 1,
        suspiciousRepairCount: 1,
      },
      forbiddenSlotRisk: {
        count: 0,
        summary: ["forbidden_primary_violation_count:0"],
      },
      lateBlockFatigueRisk: {
        count: 1,
        totalSets: 61,
        maxSlotSets: 17,
        summary: ["high_concentration_count:1", "max_slot_sets:17"],
      },
    },
    limitations: [
      "shadow_projection_is_planner_only_no_repair",
      "repaired_projection_excluded_from_projection_target",
      "old_prescribed_plan_shape_excluded_from_projection_target",
    ],
    ...overrides,
  };
}

describe("buildV2MesocycleStrategyDiagnostic", () => {
  it("returns a read-only strategy diagnostic without generation authority", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic();

    expect(diagnostic).toMatchObject({
      version: 1,
      source: "v2_mesocycle_strategy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "available_with_limitations",
    });
    expect(diagnostic.phaseStrategy).toMatchObject({
      proposedPhase: "unknown",
      classificationStatus: "unknown",
      confidence: "low",
    });
    expect(diagnostic.strategyInputSummary).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      inputContractVersion: null,
      presentGroups: [],
      missingGroups: [
        "userProfile",
        "currentTrainingContext",
        "historicalMesocycles",
        "readinessAndRecoverySignals",
      ],
      ownerAgnostic: true,
    });
    expect(diagnostic.strategyRecommendation).toMatchObject({
      version: 1,
      source: "v2_mesocycle_strategy_recommendation",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "not_available",
      recommendedPhase: "unknown",
      confidence: "low",
      hypotheses: [],
    });
    expect(diagnostic.strategyHypothesisPromotionReadiness).toMatchObject({
      version: 1,
      source: "v2_strategy_hypothesis_promotion_readiness",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "not_ready",
      hypothesisReadiness: [],
    });
    expect(diagnostic.strategyHypothesisPromotionDiff).toMatchObject({
      version: 1,
      source: "v2_strategy_hypothesis_promotion_diff",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      status: "not_available",
      evaluatedHypotheses: [],
      projectionDiff: {
        version: 1,
        source: "v2_strategy_hypothesis_projection_diff",
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByDemandOrMaterializer: false,
        status: "not_available",
        evaluatedHypotheses: [],
        projectionMode: "not_projected",
        readiness: "not_ready",
      },
      nextSafeAction: "do_not_promote",
    });
  });

  it("represents missing inputs and partial performed-history support honestly", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic();

    expect(diagnostic.userTrainingProfileInputs.available).toContain(
      "v2_target_skeleton:upper_lower_4x_slot_architecture",
    );
    expect(diagnostic.userTrainingProfileInputs.missing).toEqual(
      expect.arrayContaining([
        "pure_v2_user_training_profile_input",
        "explicit_macrocycle_phase_strategy",
        "pain_or_tolerance_history_by_exercise_and_pattern",
      ]),
    );
    expect(diagnostic.performedHistorySignals.available).toContain(
      "progression_history_and_mesocycle_review_read_models_exist",
    );
    expect(diagnostic.performedHistorySignals.missing).toContain(
      "performed_history_is_not_primary_input_to_pure_v2_strategy",
    );
    expect(diagnostic.continuityVariationPolicy.currentSupport).toBe("partial");
  });

  it("reports current demand as fixed skeleton lane-derived and separates north-star gaps", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic();

    expect(diagnostic.demandDerivationPlan).toMatchObject({
      currentDemandSource: "fixed_skeleton_lanes",
      targetDemandSource: "mesocycle_strategy",
    });
    expect(diagnostic.currentStateVsNorthStarGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gap: expect.stringContaining("MesocycleDemand currently derives"),
          targetOwner: "MesocycleStrategy -> MesocycleDemand",
          priority: "P0",
        }),
        expect.objectContaining({
          gap: expect.stringContaining("Legacy repair/projection remains"),
          priority: "P0",
        }),
      ]),
    );
  });

  it("consumes strategy input as read-only evidence without claiming phase or objective classification", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
    });

    expect(diagnostic).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "available_with_limitations",
      phaseStrategy: {
        proposedPhase: "unknown",
        classificationStatus: "unknown",
        confidence: "medium",
      },
      mesocycleObjective: {
        classificationStatus: "unknown",
        specializationTargets: [],
        maintenanceTargets: [],
        recoveryBiases: [],
      },
      demandDerivationPlan: {
        currentDemandSource: "fixed_skeleton_lanes",
        targetDemandSource: "mesocycle_strategy",
      },
      strategyInputSummary: {
        inputContractVersion: 1,
        presentGroups: [
          "userProfile",
          "currentTrainingContext",
          "historicalMesocycles",
          "readinessAndRecoverySignals",
        ],
        missingGroups: [],
        historicalMesocycleCount: 2,
        blockResponseSignalCount: 2,
        exerciseResponseSignalCount: 2,
        historicalSourcePlanners: ["legacy_projection"],
        historicalSourcePlannerCounts: {
          legacy_projection: 2,
          v2: 0,
          unknown: 0,
        },
        evidenceCategoriesAvailable: expect.arrayContaining([
          "adherence",
          "performed_volume",
          "performance_signals",
          "block_response",
          "exercise_response",
          "fatigue_distribution",
          "readiness",
          "fatigue_flags",
          "pain_or_tolerance",
          "historical_adherence_flags",
        ]),
        performedHistoryEvidenceLoaded: true,
        prescribedPlanShapeExcludedFromStrategyPolicy: true,
        confidenceChange: "eligible_for_medium_evidence",
        ownerAgnostic: true,
      },
    });
    expect(diagnostic.performedHistorySignals.available).toEqual(
      expect.arrayContaining([
        "strategy_input:performed_history_evidence_loaded",
        "historical_prescribed_plan_shape_excluded_from_strategy_policy",
      ]),
    );
    expect(diagnostic.userTrainingProfileInputs.missing).not.toContain(
      "pure_v2_user_training_profile_input",
    );
  });

  it("summarizes normalized block and exercise response evidence without changing policy", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
    });

    expect(diagnostic.responseEvidenceSummary).toMatchObject({
      blockResponseSignalCount: 2,
      exerciseResponseSignalCount: 2,
      recurringUnderHitMuscleExamples: ["Side Delts"],
      recurringOverConcentrationExamples: ["Glutes"],
      usableForFutureContinuityVariation: true,
      usableForFutureMaterializerRanking: true,
      usableForFutureVolumeFatigueStrategy: true,
    });
    expect(
      diagnostic.responseEvidenceSummary.strategyImplicationCounts,
    ).toMatchObject({
      protect_lagging_muscles_earlier: 2,
      cap_late_block_volume: 1,
      reduce_axial_or_overlap_fatigue: 2,
      preserve_successful_progression: 1,
      improve_deload_execution: 1,
      unknown: 0,
    });
    expect(diagnostic.responseEvidenceSummary.exerciseSignalsByType).toMatchObject({
      progressed: 1,
      skipped_often: 1,
      pain_or_tolerance_issue: 0,
      unknown: 0,
    });
    expect(diagnostic.continuityVariationEvidence).toMatchObject({
      status: "available_with_limitations",
      keepCandidateCount: 1,
      rotateCandidateCount: 1,
      avoidCandidateCount: 0,
      lowConfidenceCount: 0,
    });
    expect(diagnostic.volumeFatigueStrategyEvidence).toMatchObject({
      status: "available_with_limitations",
      protectLaggingMuscleSignals: ["Side Delts"],
      overConcentrationSignals: ["Glutes"],
      lateBlockFatigueSignals: ["meso-any-2:late_block_skipped_sets_rising"],
      deloadExecutionSignals: ["meso-any-2:deload_not_executed"],
    });
    expect(diagnostic.strategyRecommendation).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "available_with_limitations",
      recommendedPhase: "unknown",
      confidence: "low",
      hypotheses: [
        expect.objectContaining({
          id: "improve_deload_execution",
          readOnly: true,
          affectsScoringOrGeneration: false,
          priority: "P0",
          evidence: expect.arrayContaining(["meso-any-2:deload_not_executed"]),
          mustNotYetInfluence: [
            "generation",
            "selection",
            "repair",
            "seed",
            "runtime",
            "receipts",
          ],
        }),
        expect.objectContaining({
          id: "protect_lagging_muscles_earlier",
          priority: "P1",
          confidence: "medium",
          evidence: expect.arrayContaining([
            "Side Delts:under_hit_in_2_performed_block_response",
          ]),
        }),
        expect.objectContaining({
          id: "cap_late_block_volume",
          priority: "P1",
          evidence: expect.arrayContaining([
            "meso-any-2:skipped_set_trend_rising",
          ]),
        }),
        expect.objectContaining({
          id: "reduce_overlap_fatigue",
          priority: "P1",
          evidence: expect.arrayContaining([
            "Glutes:overlap_or_concentration_in_2_performed_block_response",
          ]),
        }),
        expect.objectContaining({
          id: "preserve_successful_progression",
          priority: "P2",
          evidence: expect.arrayContaining([
            expect.stringContaining("Incline Dumbbell Press:progressed"),
          ]),
        }),
        expect.objectContaining({
          id: "rotate_low_confidence_or_stale_accessories",
          priority: "P2",
          evidence: expect.arrayContaining([
            expect.stringContaining("Standing Calf Raise:skipped_often"),
          ]),
        }),
      ],
      limitations: expect.arrayContaining([
        "strategy_recommendation_is_read_only_and_non_binding",
        "strategy_recommendation_not_consumed_by_mesocycle_demand",
        "strategy_recommendation_not_consumed_by_materializer_ranking",
        "old_prescribed_plan_shape_excluded_from_recommendation_policy",
      ]),
    });
    expect(
      diagnostic.strategyRecommendation.hypotheses.every(
        (hypothesis) =>
          hypothesis.readOnly === true &&
          hypothesis.affectsScoringOrGeneration === false &&
          hypothesis.promotionBlockers.includes(
            "recommendation_is_evidence_backed_hypothesis_not_planner_instruction",
          ),
      ),
    ).toBe(true);
    expect(diagnostic.demandDerivationPlan.currentDemandSource).toBe(
      "fixed_skeleton_lanes",
    );
  });

  it("derives promotion readiness from strategy hypotheses and evidence quality without promoting behavior", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
    });
    const readiness = diagnostic.strategyHypothesisPromotionReadiness;
    const rowById = Object.fromEntries(
      readiness.hypothesisReadiness.map((row) => [row.hypothesisId, row]),
    );

    expect(readiness).toMatchObject({
      version: 1,
      source: "v2_strategy_hypothesis_promotion_readiness",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "partially_ready",
      globalBlockers: expect.arrayContaining([
        "readiness_not_consumed_by_mesocycle_demand_or_materializer",
        "readiness_must_not_influence_generation_selection_repair_seed_runtime_or_receipts",
        "non_regression_gates_not_yet_satisfied",
      ]),
      limitations: expect.arrayContaining([
        "readiness_defines_requirements_but_does_not_satisfy_them",
        "old_prescribed_plan_shape_excluded_from_promotion_targets",
      ]),
    });
    expect(readiness.hypothesisReadiness).toHaveLength(
      diagnostic.strategyRecommendation.hypotheses.length,
    );
    expect(
      readiness.hypothesisReadiness.some(
        (row) => row.readiness === "ready_for_bounded_trial",
      ),
    ).toBe(false);
    expect(
      readiness.hypothesisReadiness.every(
        (row) =>
          row.missingEvidence.length > 0 &&
          row.nextSafeAction !== "run_bounded_trial",
      ),
    ).toBe(true);
    expect(rowById.protect_lagging_muscles_earlier).toMatchObject({
      readiness: "ready_for_read_only_diff",
      proposedOwner: "MesocycleDemand",
      nextSafeAction: "add_read_only_diff",
      requiredEvidence: expect.arrayContaining([
        "recurring_target_tier_under_hit_evidence",
        "slot_owner_for_protected_sets",
      ]),
      missingEvidence: expect.arrayContaining([
        "slot_owner_for_protected_sets",
        "repair_materiality_non_regression_evidence",
      ]),
      requiredNonRegressionGates: expect.arrayContaining([
        "priority_target_coverage_preserved_or_improved",
        "no_material_or_major_repair_increase",
      ]),
    });
  });

  it("adds a read-only promotion diff only for the first two ready read-only hypotheses", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
    });
    const diff = diagnostic.strategyHypothesisPromotionDiff;

    expect(diff).toMatchObject({
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
      nextSafeAction: "run_read_only_shadow_trial",
    });
    expect(diff.evaluatedHypotheses).not.toContain("reduce_overlap_fatigue");
    expect(diff.evaluatedHypotheses).not.toContain(
      "preserve_successful_progression",
    );
    expect(diff.protectLaggingMusclesEarlier).toMatchObject({
      status: "available_with_limitations",
      targetTierMuscles: expect.arrayContaining(["Side Delts", "Calves"]),
      recurringUnderHitMuscles: ["Side Delts"],
      proposedProtectionType: "slot_owned_support_floor",
      requiredGuards: expect.arrayContaining([
        "protected_sets_must_have_slot_owner",
        "protected_sets_must_not_create_late_block_bloat",
        "protected_sets_must_not_rely_on_dirty_collateral",
        "protected_sets_must_not_use_forbidden_slots",
      ]),
    });
    expect(diff.capLateBlockVolume).toMatchObject({
      status: "available_with_limitations",
      skippedSetEvidence: {
        hardWeekSkippedSetSignal: true,
        examples: expect.arrayContaining([
          "meso-any-2:skipped_set_trend_rising",
          "meso-any-2:hard_week_average_rpe:8.8",
        ]),
      },
      proposedCapType: "late_block_expansion_cap",
      requiredGuards: expect.arrayContaining([
        "cap_must_preserve_priority_target_coverage",
        "cap_must_distinguish_plan_bloat_from_user_non_adherence",
      ]),
    });
    expect(diff.projectionDiff).toMatchObject({
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
      readiness: "ready_for_read_only_shadow_trial",
      candidateStrategy: {
        laggingMuscleProtection: {
          muscles: expect.arrayContaining(["Side Delts", "Calves"]),
          proposedMechanism: "redistribute_sets",
        },
        lateBlockVolumeCap: {
          proposedMechanism: "hard_week_expansion_cap",
        },
        redistributionPreference: {
          preferRedistributionBeforeNetNewVolume: true,
          candidateDonorMuscles: expect.arrayContaining([
            "Glutes",
            "Front Delts",
          ]),
          candidateProtectedMuscles: expect.arrayContaining([
            "Side Delts",
            "Calves",
          ]),
        },
      },
    });
  });

  it("uses target-tier under-hit examples for lagging-muscle protection instead of secondary noise", () => {
    const input = buildStrategyInput();
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: {
        ...input,
        blockResponseSignals: input.blockResponseSignals.map((signal) => ({
          ...signal,
          muscleDistribution: {
            ...signal.muscleDistribution,
            recurringUnderHitMuscles: [
              ...(signal.muscleDistribution.recurringUnderHitMuscles ?? []),
              "Core",
              "Forearms",
            ],
            belowMevFlags: [
              ...(signal.muscleDistribution.belowMevFlags ?? []),
              "Core:secondary_soft_target_noise",
              "Forearms:secondary_soft_target_noise",
            ],
          },
        })),
      },
    });

    expect(
      diagnostic.strategyHypothesisPromotionDiff.protectLaggingMusclesEarlier
        .targetTierMuscles,
    ).toEqual(expect.arrayContaining(["Side Delts", "Calves"]));
    expect(
      diagnostic.strategyHypothesisPromotionDiff.protectLaggingMusclesEarlier
        .targetTierMuscles,
    ).not.toEqual(expect.arrayContaining(["Core", "Forearms"]));
    expect(
      diagnostic.strategyHypothesisPromotionDiff.protectLaggingMusclesEarlier
        .recurringUnderHitMuscles,
    ).not.toContain("Core");
    expect(
      diagnostic.strategyHypothesisPromotionDiff.projectionDiff.candidateStrategy
        .redistributionPreference.candidateProtectedMuscles,
    ).not.toEqual(expect.arrayContaining(["Core", "Forearms"]));
  });

  it("derives donor candidates only from over-concentration and fatigue evidence", () => {
    const input = buildStrategyInput();
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: {
        ...input,
        blockResponseSignals: input.blockResponseSignals.map((signal) => ({
          ...signal,
          muscleDistribution: {
            ...signal.muscleDistribution,
            recurringUnderHitMuscles: [
              ...(signal.muscleDistribution.recurringUnderHitMuscles ?? []),
              "Biceps",
            ],
          },
          fatigueDistribution: {
            ...signal.fatigueDistribution,
            evidence: [
              ...signal.fatigueDistribution.evidence,
              "soft_target_noise:Core",
              "overlap_fatigue_driver:Lower Back",
            ],
          },
        })),
      },
    });
    const donors =
      diagnostic.strategyHypothesisPromotionDiff.projectionDiff.candidateStrategy
        .redistributionPreference.candidateDonorMuscles;

    expect(donors).toEqual(expect.arrayContaining(["Glutes", "Lower Back"]));
    expect(donors).not.toEqual(expect.arrayContaining(["Biceps", "Core"]));
  });

  it("does not evaluate late-block cap fear without skipped-set and hard-week evidence", () => {
    const input = buildStrategyInput();
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: {
        ...input,
        blockResponseSignals: input.blockResponseSignals.map((signal) => ({
          ...signal,
          adherence: {
            ...signal.adherence,
            skippedSetCount: 0,
            skippedSetTrend: "stable",
          },
          effortProgression: {
            ...signal.effortProgression,
            averageRpeByWeek: [{ week: 4, averageRpe: 7 }],
            hardWeekEffortReached: false,
          },
          fatigueDistribution: {
            ...signal.fatigueDistribution,
            evidence: ["arbitrary_volume_fear_without_skipped_sets"],
          },
          strategyImplications: signal.strategyImplications.includes(
            "cap_late_block_volume",
          )
            ? signal.strategyImplications
            : [...signal.strategyImplications, "cap_late_block_volume"],
        })),
      },
    });

    expect(
      diagnostic.strategyHypothesisPromotionDiff.evaluatedHypotheses,
    ).not.toContain("cap_late_block_volume");
    expect(diagnostic.strategyHypothesisPromotionDiff.capLateBlockVolume).toMatchObject(
      {
        status: "not_evaluated",
        skippedSetEvidence: {
          hardWeekSkippedSetSignal: false,
        },
      },
    );
  });

  it("surfaces interaction risk and reports non-regression gates without enforcing behavior", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
    });
    const diff = diagnostic.strategyHypothesisPromotionDiff;

    expect(diff.interactionRisk).toMatchObject({
      status: "available_with_limitations",
      risks: expect.arrayContaining([
        "lagging_muscle_protection_may_require_more_allocated_work",
        "late_block_volume_cap_may_require_less_total_expansion",
      ]),
      requiredJointGuards: [
        "prefer_redistribution_from_over_concentrated_or_fatigue_driver_muscles_before_adding_net_new_late_block_volume",
      ],
    });
    expect(diff.nonRegressionGates).toEqual({
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
    });
    expect(diff.projectionDiff.computedNonRegressionGates).toEqual({
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
    });
    expect(diff.nextSafeAction).toBe("run_read_only_shadow_trial");
    expect(diff.affectsScoringOrGeneration).toBe(false);
  });

  it("computes projection gates from projected deltas instead of hypothesis presence", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
    });
    const projection =
      diagnostic.strategyHypothesisPromotionDiff.projectionDiff;

    expect(projection.projectedDeltas.laggingMuscleCoverage.status).toBe(
      "improves",
    );
    expect(projection.projectedDeltas.sessionSize.status).toBe("preserved");
    expect(projection.computedNonRegressionGates).toMatchObject({
      preserveOrImproveLaggingMuscleCoverage: "unknown",
      noSessionSizeRegression: "unknown",
    });
    expect(projection.limitations).toEqual(
      expect.arrayContaining([
        "no_shadow_projection_rerun_yet",
        "computed_gates_default_unknown_without_projected_delta_evidence",
        "old_prescribed_plan_shape_excluded_from_projection_target",
        "repaired_projection_excluded_from_projection_target",
      ]),
    );
    expect(JSON.stringify(projection)).not.toContain(
      "old-prescribed-plan-only",
    );
  });

  it("computes measured shadow projection gates only from before and after deltas", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
      strategyShadowProjection: buildShadowProjectionEvidence(),
    });
    const projection =
      diagnostic.strategyHypothesisPromotionDiff.projectionDiff;

    expect(projection).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      projectionMode: "shadow_projection",
      readiness: "needs_better_projection",
      shadowProjection: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByDemandOrMaterializer: false,
        baselineProjection: "planner_only_no_repair",
        candidateProjection: "combined_strategy_shadow_planner_only_no_repair",
      },
    });
    expect(projection.projectedDeltas.priorityCoverage).toMatchObject({
      status: "improves",
      before: {
        belowMinimumCount: 1,
      },
      after: {
        belowMinimumCount: 0,
      },
    });
    expect(projection.projectedDeltas.repairPressure).toMatchObject({
      beforeMaterialRepairCount: 2,
      afterMaterialRepairCount: 1,
      materialRepairDelta: -1,
      beforeMajorRepairCount: 1,
      afterMajorRepairCount: 1,
      majorRepairDelta: 0,
      beforeSuspiciousRepairCount: 1,
      afterSuspiciousRepairCount: 1,
      suspiciousRepairDelta: 0,
      status: "improves",
    });
    expect(projection.projectedDeltas.sessionSize).toMatchObject({
      beforeTotalSetsBySlot: expect.objectContaining({ upper_a: 15 }),
      afterTotalSetsBySlot: expect.objectContaining({ upper_a: 17 }),
      status: "worsens",
    });
    expect(projection.computedNonRegressionGates).toMatchObject({
      preservePriorityCoverage: "pass",
      preserveOrImproveLaggingMuscleCoverage: "pass",
      noMaterialRepairIncrease: "pass",
      noMajorRepairIncrease: "pass",
      noSuspiciousRepairIncrease: "pass",
      noSessionSizeRegression: "fail",
      noDirtyCollateralIncrease: "unknown",
    });
    expect(projection.conflictAwareRefinement).toMatchObject({
      enabled: true,
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "available_with_limitations",
      conflictCountsByType: {
        session_size_cap_conflict: 1,
      },
      volumePolicy: {
        netNewVolumeAllowed: false,
        redistributionRequired: true,
        maxSlotSetIncreaseAllowed: 0,
      },
      donorResolution: {
        excludedDonorMuscles: [],
        retainedDonorMuscles: ["Glutes"],
      },
    });
  });

  it("detects protected donor overlap and excludes unsafe donors before behavior readiness", () => {
    const input = buildStrategyInput();
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: {
        ...input,
        blockResponseSignals: input.blockResponseSignals.map((signal, index) => ({
          ...signal,
          muscleDistribution: {
            ...signal.muscleDistribution,
            recurringUnderHitMuscles:
              index === 0
                ? ["Hamstrings"]
                : signal.muscleDistribution.recurringUnderHitMuscles,
            recurringOverConcentratedMuscles:
              index === 0
                ? ["Hamstrings"]
                : signal.muscleDistribution.recurringOverConcentratedMuscles,
            belowMevFlags:
              index === 0
                ? ["Hamstrings:below_target_or_mev_evidence"]
                : signal.muscleDistribution.belowMevFlags,
            overMavFlags:
              index === 0
                ? ["Hamstrings:over_target_or_mav_evidence"]
                : signal.muscleDistribution.overMavFlags,
          },
          fatigueDistribution: {
            ...signal.fatigueDistribution,
            likelyFatigueDrivers:
              index === 0
                ? ["Hamstrings"]
                : signal.fatigueDistribution.likelyFatigueDrivers,
            evidence:
              index === 0
                ? ["overlap_fatigue_driver:Hamstrings"]
                : signal.fatigueDistribution.evidence,
          },
          strategyImplications: [
            "protect_lagging_muscles_earlier",
            "cap_late_block_volume",
          ],
        })),
      },
    });
    const refinement =
      diagnostic.strategyHypothesisPromotionDiff.projectionDiff
        .conflictAwareRefinement;

    expect(refinement.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "protected_donor_overlap",
          muscle: "Hamstrings",
        }),
      ]),
    );
    expect(refinement.donorResolution).toMatchObject({
      excludedDonorMuscles: expect.arrayContaining(["Hamstrings"]),
    });
    expect(
      diagnostic.strategyHypothesisPromotionDiff.projectionDiff
        .computedNonRegressionGates.preserveOrImproveLaggingMuscleCoverage,
    ).toBe("unknown");
  });

  it("blocks or flags floor, slot-owner, session-size, net-new, and protected-coverage conflicts in measured shadow mode", () => {
    const shadowProjection = buildShadowProjectionEvidence({
      candidateStrategy: {
        candidateProtectedMuscles: ["Hamstrings"],
        candidateDonorMuscles: ["Glutes", "Hamstrings"],
        protectedSlotOwners: {
          Hamstrings: [],
        },
        preferRedistributionBeforeNetNewVolume: true,
      },
      before: {
        priorityCoverage: {
          coveredCount: 1,
          belowMinimumCount: 0,
          aboveMaximumCount: 0,
          unknownCount: 0,
          totalCount: 1,
          examples: ["Hamstrings:covered:6.3_sets"],
        },
        laggingMuscleCoverage: [
          {
            muscle: "Hamstrings",
            status: "covered",
            sets: 6.3,
            minSets: 6,
            priority: "primary",
            targetTier: "A_PRIMARY",
          },
        ],
        donorMuscleCoverage: [
          {
            muscle: "Glutes",
            status: "covered",
            sets: 6,
            minSets: 6,
            priority: "support",
            targetTier: "B_SUPPORT",
          },
          {
            muscle: "Hamstrings",
            status: "covered",
            sets: 6.3,
            minSets: 6,
            priority: "primary",
            targetTier: "A_PRIMARY",
          },
        ],
        sessionSize: {
          totalSetsBySlot: {
            lower_a: 14,
            lower_b: 11,
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
        forbiddenSlotRisk: {
          count: 0,
          summary: ["forbidden_primary_violation_count:0"],
        },
        lateBlockFatigueRisk: {
          count: 2,
          totalSets: 58,
          maxSlotSets: 18,
          summary: ["total_sets:58", "max_slot_sets:18"],
        },
      },
      after: {
        priorityCoverage: {
          coveredCount: 0,
          belowMinimumCount: 1,
          aboveMaximumCount: 0,
          unknownCount: 0,
          totalCount: 1,
          examples: ["Hamstrings:below_minimum:5.1_sets"],
        },
        laggingMuscleCoverage: [
          {
            muscle: "Hamstrings",
            status: "below_minimum",
            sets: 5.1,
            minSets: 6,
            priority: "primary",
            targetTier: "A_PRIMARY",
          },
        ],
        donorMuscleCoverage: [
          {
            muscle: "Glutes",
            status: "below_minimum",
            sets: 5,
            minSets: 6,
            priority: "support",
            targetTier: "B_SUPPORT",
          },
          {
            muscle: "Hamstrings",
            status: "below_minimum",
            sets: 5.1,
            minSets: 6,
            priority: "primary",
            targetTier: "A_PRIMARY",
          },
        ],
        sessionSize: {
          totalSetsBySlot: {
            lower_a: 14,
            lower_b: 11,
            upper_a: 18,
            upper_b: 19,
          },
        },
        concentration: { count: 1, summary: ["high_concentration_count:1"] },
        repairPressure: {
          materialRepairCount: 2,
          majorRepairCount: 1,
          suspiciousRepairCount: 1,
        },
        forbiddenSlotRisk: {
          count: 0,
          summary: ["forbidden_primary_violation_count:0"],
        },
        lateBlockFatigueRisk: {
          count: 1,
          totalSets: 62,
          maxSlotSets: 19,
          summary: ["total_sets:62", "max_slot_sets:19"],
        },
      },
    });
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
      strategyShadowProjection: shadowProjection,
    });
    const projection =
      diagnostic.strategyHypothesisPromotionDiff.projectionDiff;
    const conflicts = projection.conflictAwareRefinement.conflicts;

    expect(conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "protected_donor_overlap",
          muscle: "Hamstrings",
        }),
        expect.objectContaining({
          type: "floor_preservation_conflict",
          muscle: "Glutes",
        }),
        expect.objectContaining({
          type: "floor_preservation_conflict",
          muscle: "Hamstrings",
        }),
        expect.objectContaining({
          type: "slot_owner_missing",
          muscle: "Hamstrings",
        }),
        expect.objectContaining({
          type: "session_size_cap_conflict",
          slotId: "upper_a",
        }),
        expect.objectContaining({
          type: "session_size_cap_conflict",
          slotId: "upper_b",
        }),
        expect.objectContaining({
          type: "net_new_volume_blocked",
        }),
      ]),
    );
    expect(projection.conflictAwareRefinement.donorResolution).toMatchObject({
      excludedDonorMuscles: expect.arrayContaining(["Glutes", "Hamstrings"]),
      retainedDonorMuscles: [],
    });
    expect(projection.conflictAwareRefinement.volumePolicy).toEqual({
      netNewVolumeAllowed: false,
      redistributionRequired: true,
      maxSlotSetIncreaseAllowed: 0,
    });
    expect(projection.projectedDeltas.laggingMuscleCoverage.status).toBe(
      "worsens",
    );
    expect(projection.projectedDeltas.sessionSize.status).toBe("worsens");
    expect(projection.projectedDeltas.lateBlockFatigueRisk.status).toBe(
      "worsens",
    );
    expect(projection.computedNonRegressionGates).toMatchObject({
      preserveOrImproveLaggingMuscleCoverage: "fail",
      noSessionSizeRegression: "fail",
      noLateBlockSkippedSetRiskIncrease: "fail",
      noMaterialRepairIncrease: "pass",
    });
    expect(projection.readiness).toBe("needs_better_projection");
    expect(projection.readOnly).toBe(true);
    expect(projection.affectsScoringOrGeneration).toBe(false);
    expect(projection.consumedByDemandOrMaterializer).toBe(false);
  });

  it("leaves a measured gate unknown when the relevant delta is missing", () => {
    const base = buildShadowProjectionEvidence();
    const beforeWithoutRepair = { ...base.before };
    const afterWithoutRepair = { ...base.after };
    delete beforeWithoutRepair.repairPressure;
    delete afterWithoutRepair.repairPressure;
    const shadowProjection = buildShadowProjectionEvidence({
      before: beforeWithoutRepair,
      after: afterWithoutRepair,
    });
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
      strategyShadowProjection: shadowProjection,
    });
    const projection =
      diagnostic.strategyHypothesisPromotionDiff.projectionDiff;

    expect(projection.projectedDeltas.repairPressure.status).toBe("unknown");
    expect(projection.computedNonRegressionGates).toMatchObject({
      noMaterialRepairIncrease: "unknown",
      noMajorRepairIncrease: "unknown",
      noSuspiciousRepairIncrease: "unknown",
    });
    expect(
      projection.conflictAwareRefinement.conflictCountsByType
        .floor_preservation_conflict,
    ).toBeUndefined();
  });

  it("does not treat repaired projection or old prescribed plan shape as the shadow target", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
      strategyShadowProjection: buildShadowProjectionEvidence(),
    });
    const serialized = JSON.stringify(
      diagnostic.strategyHypothesisPromotionDiff.projectionDiff,
    );

    expect(serialized).toContain("planner_only_no_repair");
    expect(serialized).not.toContain("baselineRepaired");
    expect(serialized).not.toContain("old-prescribed-plan-only");
    expect(
      diagnostic.strategyHypothesisPromotionDiff.projectionDiff.limitations,
    ).toEqual(
      expect.arrayContaining([
        "repaired_projection_excluded_from_projection_target",
        "old_prescribed_plan_shape_excluded_from_projection_target",
      ]),
    );
  });

  it("maps every recommendation hypothesis to the conservative promotion owner and next safe action", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
    });
    const readinessById = new Map(
      diagnostic.strategyHypothesisPromotionReadiness.hypothesisReadiness.map(
        (row) => [row.hypothesisId, row],
      ),
    );

    expect(readinessById.get("improve_deload_execution")).toMatchObject({
      readiness: "needs_owner",
      nextSafeAction: "add_read_only_diff",
      requiredEvidence: expect.arrayContaining([
        "owner_decision_between_plan_design_runtime_ux_reminders_and_logging_semantics",
        "next_block_readiness_impact_after_skipped_deload",
      ]),
    });
    expect(
      ["DeloadPlan", "RuntimeUX"].includes(
        readinessById.get("improve_deload_execution")?.proposedOwner ?? "",
      ),
    ).toBe(true);
    expect(
      readinessById.get("improve_deload_execution")?.proposedOwner,
    ).not.toBe("MesocycleDemand");

    expect(readinessById.get("cap_late_block_volume")).toMatchObject({
      readiness: "ready_for_read_only_diff",
      proposedOwner: "WeeklyDemandCurve",
      requiredEvidence: expect.arrayContaining([
        "priority_target_coverage_preservation",
      ]),
      missingEvidence: expect.arrayContaining([
        "priority_target_coverage_preservation",
      ]),
      requiredNonRegressionGates: expect.arrayContaining([
        "priority_target_coverage_preserved",
        "lagging_target_tier_muscles_not_reduced_below_floor",
      ]),
    });

    expect(readinessById.get("reduce_overlap_fatigue")).toMatchObject({
      readiness: "ready_for_read_only_diff",
      proposedOwner: "SlotDemandAllocation",
      requiredEvidence: expect.arrayContaining([
        "overlap_fatigue_driver_attribution",
        "repair_non_regression_evidence",
      ]),
      requiredNonRegressionGates: expect.arrayContaining([
        "no_suspicious_repair_increase",
        "no_forbidden_slot_primary_solution",
      ]),
    });

    expect(readinessById.get("preserve_successful_progression")).toMatchObject({
      readiness: "ready_for_read_only_diff",
      proposedOwner: "ExerciseSelectionStrategy",
      requiredEvidence: expect.arrayContaining([
        "productive_continuity_classification",
        "sufficient_completed_exposures",
      ]),
      requiredNonRegressionGates: expect.arrayContaining([
        "materializer_ranking_diff_does_not_reduce_required_lane_coverage",
      ]),
    });
    expect(
      readinessById.get("preserve_successful_progression")?.proposedOwner,
    ).not.toBe("MesocycleDemand");

    expect(
      readinessById.get("rotate_low_confidence_or_stale_accessories"),
    ).toMatchObject({
      readiness: "needs_more_evidence",
      proposedOwner: "ExerciseSelectionStrategy",
      missingEvidence: expect.arrayContaining([
        "clean_alternative_inventory_exists",
        "no_random_novelty_policy",
      ]),
      requiredNonRegressionGates: expect.arrayContaining([
        "no_random_novelty_without_evidence",
        "productive_anchor_not_removed",
      ]),
      knownRisks: expect.arrayContaining([
        "random novelty can replace useful low-risk accessories",
      ]),
      nextSafeAction: "collect_more_evidence",
    });
  });

  it("keeps thin recommendation evidence low-confidence and non-binding", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: {
        ...buildStrategyInput(),
        historicalMesocycles: [
          {
            mesocycleId: "thin-history",
            sourcePlanner: "legacy_projection",
          },
        ],
        blockResponseSignals: [
          {
            mesocycleId: "thin-history",
            sourcePlanner: "legacy_projection",
            adherence: {},
            effortProgression: {},
            muscleDistribution: {},
            fatigueDistribution: {
              evidence: ["performed_workout_logs_read_only"],
            },
            strategyImplications: ["unknown"],
            confidence: "low",
          },
        ],
        exerciseResponseSignals: [],
        readinessAndRecoverySignals: {
          available: [],
          missing: ["latest_readiness_signal"],
        },
      },
    });

    expect(diagnostic.strategyRecommendation).toMatchObject({
      status: "available_with_limitations",
      recommendedPhase: "unknown",
      confidence: "low",
      hypotheses: [
        expect.objectContaining({
          id: "unknown",
          confidence: "low",
          mustNotYetInfluence: [
            "generation",
            "selection",
            "repair",
            "seed",
            "runtime",
            "receipts",
          ],
        }),
      ],
      limitations: expect.arrayContaining([
        "fewer_than_two_historical_mesocycles_keeps_confidence_low",
        "missing_strategy_input_groups_keep_recommendation_limited",
      ]),
    });
  });

  it("is attached above MesocycleDemand without changing demand output", () => {
    const policy = buildV2PlannerMesocyclePolicy({
      mesocycleStrategyInput: buildStrategyInput(),
    });
    const standalonePolicy = buildV2PlannerMesocyclePolicy();
    const standaloneDemand = buildV2MesocycleDemand({
      targetSkeleton: buildV2TargetSkeleton(),
    });
    const policyKeys = Object.keys(policy);

    expect(policy.mesocycleStrategyDiagnostic.readOnly).toBe(true);
    expect(policy.mesocycleStrategyDiagnostic.strategyRecommendation).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
    });
    expect(
      policy.mesocycleStrategyDiagnostic.strategyHypothesisPromotionReadiness,
    ).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "partially_ready",
      globalBlockers: expect.arrayContaining([
        "readiness_not_consumed_by_mesocycle_demand_or_materializer",
      ]),
    });
    expect(policy.mesocycleStrategyDiagnostic.strategyHypothesisPromotionDiff).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      status: "available_with_limitations",
    });
    expect(policyKeys.indexOf("mesocycleStrategyDiagnostic")).toBeLessThan(
      policyKeys.indexOf("mesocycleDemand"),
    );
    expect(policy.mesocycleDemand).toEqual(standaloneDemand);
    expect(policy.mesocycleDemand).toEqual(standalonePolicy.mesocycleDemand);
    expect(policy.weeklyDemandCurve).toEqual(standalonePolicy.weeklyDemandCurve);
    expect(policy.slotDemandAllocationByWeek).toEqual(
      standalonePolicy.slotDemandAllocationByWeek,
    );
    expect(policy.exerciseClassDistributionBySlot).toEqual(
      standalonePolicy.exerciseClassDistributionBySlot,
    );
    expect(policy.v2SetDistributionIntent).toEqual(
      standalonePolicy.v2SetDistributionIntent,
    );
    expect(policy.selectionCapacityPlan).toEqual(
      standalonePolicy.selectionCapacityPlan,
    );
    expect(policy.exerciseSelectionPlan).toEqual(
      standalonePolicy.exerciseSelectionPlan,
    );
    expect(JSON.stringify(policy.mesocycleDemand)).not.toContain(
      "promotion_diff",
    );
    expect(JSON.stringify(policy.mesocycleDemand)).not.toContain(
      "projection_diff",
    );
    expect(JSON.stringify(policy.weeklyDemandCurve)).not.toContain(
      "promotion_diff",
    );
    expect(JSON.stringify(policy.weeklyDemandCurve)).not.toContain(
      "projection_diff",
    );
  });
});
