import type { V2MesocycleStrategyDiagnostic } from "./types";

export function buildV2MesocycleStrategyDiagnostic(): V2MesocycleStrategyDiagnostic {
  return {
    version: 1,
    source: "v2_mesocycle_strategy",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status: "available_with_limitations",
    userTrainingProfileInputs: {
      available: [
        "constraints:split_frequency_and_weekly_schedule",
        "handoff_recommended_design:focus_volume_intensity_duration",
        "v2_target_skeleton:upper_lower_4x_slot_architecture",
        "volume_landmarks_and_muscle_target_tiers",
        "v2_weekly_progression_and_deload_policy",
        "carry_forward_recommendations:partial_continuity_signal",
      ],
      missing: [
        "pure_v2_user_training_profile_input",
        "explicit_macrocycle_phase_strategy",
        "training_age_and_experience_level",
        "pain_or_tolerance_history_by_exercise_and_pattern",
        "strategy_ready_performance_response_by_muscle_and_exercise",
        "strategy_ready_adherence_and_session_duration_trends",
      ],
      limitations: [
        "pure_strategy_diagnostic_does_not_receive_live_api_read_model_context_yet",
        "available_inputs_are_current_app_sources_not_yet_strategy_inputs_to_mesocycle_demand",
        "profile_focus_exists_but_is_not_a_full_user_training_profile",
      ],
    },
    phaseStrategy: {
      proposedPhase: "unknown",
      rationale: [
        "no_authoritative_macrocycle_or_phase_strategy_is_wired_above_v2_mesocycle_demand",
        "weekly_progression_policy_models_accumulation_and_deload_shape_but_does_not_choose_the_next_block_strategy",
        "without performed_history_response_and_recovery_trends_confidence_must_remain_low",
      ],
      confidence: "low",
    },
    mesocycleObjective: {
      objective: "diagnostic_only_identify_strategy_inputs_before_demand",
      specializationTargets: [],
      maintenanceTargets: [],
      recoveryBiases: [],
      rationale: [
        "current_v2_demand_is_derived_from_fixed_upper_lower_skeleton_lanes",
        "strategy_specific_specialization_maintenance_or_recovery_biases_are_not_inferred",
        "future_strategy_should_explain_why_muscle_demand_increases_holds_reduces_or_specializes",
      ],
    },
    performedHistorySignals: {
      available: [
        "performed_workouts_and_logged_sets_exist_in_runtime_history",
        "progression_history_and_mesocycle_review_read_models_exist",
        "handoff_carry_forward_signal_quality_exists_partially",
        "latest_readiness_signal_exists_partially",
      ],
      missing: [
        "performed_history_is_not_primary_input_to_pure_v2_strategy",
        "muscle_level_response_trends_are_not_strategy_normalized",
        "exercise_staleness_tolerance_sfr_and_pain_history_are_not_strategy_ranked",
        "post_mesocycle_learning_loop_is_not_yet_v2_strategy_owner",
      ],
      candidateFutureSignals: [
        "target_achievement_by_muscle_across_prior_block",
        "load_or_rep_progression_response_by_exercise",
        "skipped_sets_partial_sessions_and_adherence_by_slot",
        "pain_tolerance_and_fatigue_notes_by_pattern",
        "exercise_staleness_and_swap_frequency",
        "session_duration_pressure",
      ],
    },
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
