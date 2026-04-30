import type {
  V2MesocycleStrategyDiagnostic,
  V2MesocycleStrategyInput,
  V2MesocycleStrategyInputGroup,
} from "./types";

export type V2MesocycleStrategyDiagnosticInput = {
  strategyInput?: V2MesocycleStrategyInput;
};

const STRATEGY_INPUT_GROUPS: V2MesocycleStrategyInputGroup[] = [
  "userProfile",
  "currentTrainingContext",
  "historicalMesocycles",
  "readinessAndRecoverySignals",
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function hasUserProfileEvidence(input: V2MesocycleStrategyInput): boolean {
  const profile = input.userProfile;
  return (
    Boolean(profile.trainingGoal) ||
    (profile.trainingAge != null && profile.trainingAge !== "unknown") ||
    typeof profile.availableTrainingDays === "number" ||
    (profile.equipmentProfile?.length ?? 0) > 0 ||
    (profile.constraints?.length ?? 0) > 0 ||
    (profile.preferences?.length ?? 0) > 0 ||
    (profile.painOrToleranceFlags?.length ?? 0) > 0 ||
    profile.confidence !== "low"
  );
}

function hasCurrentTrainingContextEvidence(
  input: V2MesocycleStrategyInput,
): boolean {
  const context = input.currentTrainingContext;
  return (
    context.split === "upper_lower" ||
    Boolean(context.currentPhase) ||
    Boolean(context.currentMesocycleStatus) ||
    typeof context.weekCount === "number" ||
    (context.slotSequence?.length ?? 0) > 0 ||
    Boolean(context.volumeTarget) ||
    Boolean(context.intensityBias)
  );
}

function hasReadinessEvidence(input: V2MesocycleStrategyInput): boolean {
  const readiness = input.readinessAndRecoverySignals;
  return (
    readiness.available.length > 0 ||
    (readiness.fatigueFlags?.length ?? 0) > 0 ||
    (readiness.painFlags?.length ?? 0) > 0 ||
    (readiness.adherenceFlags?.length ?? 0) > 0
  );
}

function summarizeStrategyInput(
  strategyInput: V2MesocycleStrategyInput | undefined,
): V2MesocycleStrategyDiagnostic["strategyInputSummary"] {
  if (!strategyInput) {
    return {
      version: 1,
      readOnly: true,
      affectsScoringOrGeneration: false,
      inputContractVersion: null,
      presentGroups: [],
      missingGroups: STRATEGY_INPUT_GROUPS,
      historicalMesocycleCount: 0,
      historicalSourcePlanners: [],
      phaseClassificationStatus: "unknown",
      objectiveClassificationStatus: "unknown",
      confidenceChange: "not_evaluated_no_input",
      evidenceLimitations: ["v2_mesocycle_strategy_input_not_supplied"],
      ownerAgnostic: true,
    };
  }

  const presentGroups = STRATEGY_INPUT_GROUPS.filter((group) => {
    if (group === "userProfile") {
      return hasUserProfileEvidence(strategyInput);
    }
    if (group === "currentTrainingContext") {
      return hasCurrentTrainingContextEvidence(strategyInput);
    }
    if (group === "historicalMesocycles") {
      return strategyInput.historicalMesocycles.length > 0;
    }
    return hasReadinessEvidence(strategyInput);
  });
  const missingGroups = STRATEGY_INPUT_GROUPS.filter(
    (group) => !presentGroups.includes(group),
  );
  const historicalSourcePlanners = Array.from(
    new Set(
      strategyInput.historicalMesocycles.map(
        (mesocycle) => mesocycle.sourcePlanner,
      ),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const hasHistoricalResponseEvidence = strategyInput.historicalMesocycles.some(
    (mesocycle) =>
      Boolean(mesocycle.adherenceSummary) ||
      (mesocycle.performedVolumeSummary?.length ?? 0) > 0 ||
      (mesocycle.performanceSignals?.length ?? 0) > 0,
  );
  const evidenceSupportsMediumConfidence =
    missingGroups.length === 0 &&
    strategyInput.userProfile.confidence !== "low" &&
    strategyInput.historicalMesocycles.length >= 2 &&
    hasHistoricalResponseEvidence;

  return {
    version: 1,
    readOnly: true,
    affectsScoringOrGeneration: false,
    inputContractVersion: strategyInput.version,
    presentGroups,
    missingGroups,
    historicalMesocycleCount: strategyInput.historicalMesocycles.length,
    historicalSourcePlanners,
    phaseClassificationStatus: "unknown",
    objectiveClassificationStatus: "unknown",
    confidenceChange: evidenceSupportsMediumConfidence
      ? "eligible_for_medium_evidence"
      : "stays_low_missing_evidence",
    evidenceLimitations: strategyInput.evidenceLimitations,
    ownerAgnostic: true,
  };
}

function buildUserTrainingProfileInputs(
  summary: V2MesocycleStrategyDiagnostic["strategyInputSummary"],
): V2MesocycleStrategyDiagnostic["userTrainingProfileInputs"] {
  const hasContract = summary.inputContractVersion === 1;
  return {
    available: unique([
      "constraints:split_frequency_and_weekly_schedule",
      "handoff_recommended_design:focus_volume_intensity_duration",
      "v2_target_skeleton:upper_lower_4x_slot_architecture",
      "volume_landmarks_and_muscle_target_tiers",
      "v2_weekly_progression_and_deload_policy",
      "carry_forward_recommendations:partial_continuity_signal",
      ...(hasContract ? ["pure_v2_mesocycle_strategy_input_contract"] : []),
      ...summary.presentGroups.map((group) => `strategy_input:${group}`),
    ]),
    missing: unique([
      ...(hasContract ? [] : ["pure_v2_user_training_profile_input"]),
      ...(hasContract && summary.missingGroups.includes("userProfile")
        ? ["strategy_input:user_profile_evidence"]
        : []),
      "explicit_macrocycle_phase_strategy",
      "training_age_and_experience_level",
      "pain_or_tolerance_history_by_exercise_and_pattern",
      "strategy_ready_performance_response_by_muscle_and_exercise",
      "strategy_ready_adherence_and_session_duration_trends",
    ]),
    limitations: unique([
      ...(hasContract
        ? [
            "strategy_input_is_read_only_and_not_consumed_by_mesocycle_demand",
            "strategy_input_adapter_labels_missing_evidence_instead_of_fabricating_it",
          ]
        : ["pure_strategy_diagnostic_does_not_receive_live_api_read_model_context_yet"]),
      "available_inputs_are_current_app_sources_not_yet_strategy_inputs_to_mesocycle_demand",
      "profile_focus_exists_but_is_not_a_full_user_training_profile",
      ...(hasContract ? summary.evidenceLimitations : []),
    ]),
  };
}

function buildPerformedHistorySignals(
  summary: V2MesocycleStrategyDiagnostic["strategyInputSummary"],
): V2MesocycleStrategyDiagnostic["performedHistorySignals"] {
  const hasHistoricalInput = summary.historicalMesocycleCount > 0;
  return {
    available: unique([
      "performed_workouts_and_logged_sets_exist_in_runtime_history",
      "progression_history_and_mesocycle_review_read_models_exist",
      "handoff_carry_forward_signal_quality_exists_partially",
      "latest_readiness_signal_exists_partially",
      ...(hasHistoricalInput
        ? [
            `strategy_input:historical_mesocycles:${summary.historicalMesocycleCount}`,
          ]
        : []),
    ]),
    missing: unique([
      ...(hasHistoricalInput
        ? []
        : ["performed_history_is_not_primary_input_to_pure_v2_strategy"]),
      "muscle_level_response_trends_are_not_strategy_normalized",
      "exercise_staleness_tolerance_sfr_and_pain_history_are_not_strategy_ranked",
      "post_mesocycle_learning_loop_is_not_yet_v2_strategy_owner",
    ]),
    candidateFutureSignals: [
      "target_achievement_by_muscle_across_prior_block",
      "load_or_rep_progression_response_by_exercise",
      "skipped_sets_partial_sessions_and_adherence_by_slot",
      "pain_tolerance_and_fatigue_notes_by_pattern",
      "exercise_staleness_and_swap_frequency",
      "session_duration_pressure",
    ],
  };
}

function resolvePhaseConfidence(
  summary: V2MesocycleStrategyDiagnostic["strategyInputSummary"],
): V2MesocycleStrategyDiagnostic["phaseStrategy"]["confidence"] {
  return summary.confidenceChange === "eligible_for_medium_evidence"
    ? "medium"
    : "low";
}

export function buildV2MesocycleStrategyDiagnostic(
  input: V2MesocycleStrategyDiagnosticInput = {},
): V2MesocycleStrategyDiagnostic {
  const strategyInputSummary = summarizeStrategyInput(input.strategyInput);
  const phaseConfidence = resolvePhaseConfidence(strategyInputSummary);

  return {
    version: 1,
    source: "v2_mesocycle_strategy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status: "available_with_limitations",
    userTrainingProfileInputs:
      buildUserTrainingProfileInputs(strategyInputSummary),
    phaseStrategy: {
      proposedPhase: "unknown",
      classificationStatus: "unknown",
      rationale: [
        "no_authoritative_macrocycle_or_phase_strategy_is_wired_above_v2_mesocycle_demand",
        "weekly_progression_policy_models_accumulation_and_deload_shape_but_does_not_choose_the_next_block_strategy",
        phaseConfidence === "medium"
          ? "strategy_input_has_profile_context_historical_response_and_readiness_evidence_but_phase_classification_is_still_not_implemented"
          : "without_sufficient_strategy_input_and_performed_history_response_confidence_must_remain_low",
      ],
      confidence: phaseConfidence,
    },
    mesocycleObjective: {
      objective: "diagnostic_only_identify_strategy_inputs_before_demand",
      classificationStatus: "unknown",
      specializationTargets: [],
      maintenanceTargets: [],
      recoveryBiases: [],
      rationale: [
        "current_v2_demand_is_derived_from_fixed_upper_lower_skeleton_lanes",
        "strategy_specific_specialization_maintenance_or_recovery_biases_are_not_inferred",
        "future_strategy_should_explain_why_muscle_demand_increases_holds_reduces_or_specializes",
      ],
    },
    performedHistorySignals: buildPerformedHistorySignals(strategyInputSummary),
    continuityVariationPolicy: {
      currentSupport: "partial",
      keepSignals: [
        "carry_forward_recommendations_with_signal_quality",
        "accepted_seed_identity_continuity",
        "v2_materializer_continuity_hints",
      ],
      rotateSignals: [
        "duplicate_policy_requires_clean_alternative_review",
        "materializer_can_express_class_level_variation_but_not_response_ranked_rotation",
      ],
      missingSignals: [
        "block_level_keep_rotate_replace_classification",
        "staleness_and_tolerance_thresholds",
        "performance_response_and_sfr_ranked_materializer_inputs",
        "strategy_derived_novelty_pressure_by_lane",
      ],
    },
    demandDerivationPlan: {
      currentDemandSource: "fixed_skeleton_lanes",
      targetDemandSource: "mesocycle_strategy",
      gapsBeforeStrategyDerivedDemand: [
        "explicit_user_training_profile_adapter",
        "macrocycle_phase_strategy",
        "mesocycle_objective_with_specialization_maintenance_recovery_bias",
        "performed_history_learning_loop",
        "continuity_variation_policy",
        "demand_builder_that_consumes_strategy_instead_of_only_target_skeleton_lanes",
      ],
    },
    strategyInputSummary,
    currentStateVsNorthStarGaps: [
      {
        gap: "MesocycleDemand currently derives from fixed skeleton lane policy, not an explicit strategy objective.",
        currentOwner: "src/lib/engine/planning/v2/mesocycle-demand.ts",
        targetOwner: "MesocycleStrategy -> MesocycleDemand",
        priority: "P0",
      },
      {
        gap: "Macrocycle or phase strategy is missing as an authoritative planner input.",
        currentOwner: "handoff recommendedDesign and lifecycle weekly progression are partial evidence",
        targetOwner: "V2 MacrocyclePhaseStrategy",
        priority: "P0",
      },
      {
        gap: "Performed-history feedback exists in read models but is not yet the primary V2 strategy input.",
        currentOwner: "mesocycle review, progression history, handoff carry-forward",
        targetOwner: "PostMesocycleLearningLoop -> MesocycleStrategy",
        priority: "P0",
      },
      {
        gap: "Continuity and variation are partial and not yet tied to block-level strategy.",
        currentOwner: "carry-forward recommendations, duplicate policy, materializer continuity hints",
        targetOwner: "ExerciseSelectionStrategy continuity/variation policy",
        priority: "P1",
      },
      {
        gap: "Materializer ranking lacks strategy-ready performance response, staleness, tolerance, and SFR inputs.",
        currentOwner: "src/lib/engine/planning/v2/materialization",
        targetOwner: "strategy-fed materializer ranking inputs",
        priority: "P1",
      },
      {
        gap: "Legacy repair/projection remains the default seed author while V2 live writes stay disabled.",
        currentOwner: "src/lib/api/mesocycle-handoff-slot-plan-projection.ts",
        targetOwner: "V2 authored accepted seed after explicit promotion gates",
        priority: "P0",
      },
    ],
  };
}
