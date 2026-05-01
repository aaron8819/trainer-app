import { getMuscleTargetSemantics } from "@/lib/engine/volume-landmarks";
import { V2_TARGET_SLOT_SKELETON } from "./target-skeleton";
import type {
  V2BlockStrategyImplication,
  V2DonorSurplusCandidateReason,
  V2DonorSurplusEligibilityReason,
  V2DonorSurplusEvidence,
  V2ExerciseResponseSignalType,
  V2MesocycleStrategyDiagnostic,
  V2MesocycleStrategyEvidenceStatus,
  V2MesocycleStrategyInput,
  V2MesocycleStrategyConfidence,
  V2MesocycleStrategyInputGroup,
  V2MesocycleStrategyRecommendation,
  V2MesocycleStrategyRecommendationHypothesisId,
  V2MesocycleStrategyRecommendationInfluenceTarget,
  V2MesocycleStrategyRecommendationMustNotYetInfluence,
  V2StrategyHypothesisPromotionDiff,
  V2StrategyHypothesisPromotionDiffHypothesisId,
  V2SlotOwnedDemandAdjustmentDonorEligibilityReason,
  V2SlotOwnedDemandAdjustmentPlan,
  V2SlotOwnedDemandAdjustmentProtectedStatus,
  V2SlotOwnedDemandAdjustmentRequiredOwner,
  V2StrategyHypothesisConflictAwareConflict,
  V2StrategyHypothesisConflictAwareRefinement,
  V2StrategyHypothesisPreShadowCandidateFilter,
  V2StrategyHypothesisPreShadowDonorReason,
  V2StrategyHypothesisPreShadowProtectedReason,
  V2StrategyHypothesisProjectionCoverageRow,
  V2StrategyHypothesisProjectionDeltaStatus,
  V2StrategyHypothesisProjectionDiff,
  V2StrategyHypothesisProjectionGateStatus,
  V2StrategyHypothesisShadowProjectionEvidence,
  V2StrategyHypothesisPromotionReadiness,
  V2StrategyHypothesisPromotionReadinessLevel,
  V2StrategyHypothesisPromotionReadinessNextSafeAction,
  V2StrategyHypothesisPromotionReadinessOwner,
} from "./types";

export type V2MesocycleStrategyDiagnosticInput = {
  strategyInput?: V2MesocycleStrategyInput;
  strategyShadowProjection?: V2StrategyHypothesisShadowProjectionEvidence;
  preShadowCandidateFilter?: V2StrategyHypothesisPreShadowCandidateFilter;
};

export type V2DonorSurplusEvidenceInput = {
  evaluatesCombinedPair: boolean;
  candidateDonorMuscles: readonly string[];
  candidateProtectedMuscles: readonly string[];
  blockSignals?: V2MesocycleStrategyInput["blockResponseSignals"];
  baseCoverageRows?: readonly V2StrategyHypothesisProjectionCoverageRow[];
  preShadowCandidateFilter?: V2StrategyHypothesisPreShadowCandidateFilter;
  donorSlotOwners?: Record<string, readonly string[]>;
  clearlyOverConcentratedMuscles?: readonly string[];
  concentrationRiskMuscles?: readonly string[];
  fatigueRegressionRiskMuscles?: readonly string[];
  floorMarginSets?: number;
  targetTierFloorMarginSets?: number;
};

const STRATEGY_INPUT_GROUPS: V2MesocycleStrategyInputGroup[] = [
  "userProfile",
  "currentTrainingContext",
  "historicalMesocycles",
  "readinessAndRecoverySignals",
];

const STRATEGY_EVIDENCE_CATEGORIES = [
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
] as const;

const BLOCK_STRATEGY_IMPLICATIONS: V2BlockStrategyImplication[] = [
  "protect_lagging_muscles_earlier",
  "cap_late_block_volume",
  "reduce_axial_or_overlap_fatigue",
  "preserve_successful_progression",
  "improve_deload_execution",
  "unknown",
];

const EXERCISE_RESPONSE_SIGNAL_TYPES: V2ExerciseResponseSignalType[] = [
  "progressed",
  "stalled",
  "regressed",
  "skipped_often",
  "swapped_out",
  "pain_or_tolerance_issue",
  "high_fatigue_cost",
  "low_confidence",
  "unknown",
];

const STRATEGY_CONFIDENCE_LEVELS: V2MesocycleStrategyConfidence[] = [
  "low",
  "medium",
  "high",
];

const RECOMMENDATION_MUST_NOT_YET_INFLUENCE: V2MesocycleStrategyRecommendationMustNotYetInfluence[] =
  ["generation", "selection", "repair", "seed", "runtime", "receipts"];

const PROMOTION_DIFF_HYPOTHESIS_IDS: V2StrategyHypothesisPromotionDiffHypothesisId[] =
  ["protect_lagging_muscles_earlier", "cap_late_block_volume"];

const RECOMMENDATION_INFLUENCE_TARGETS: Record<
  V2MesocycleStrategyRecommendationHypothesisId,
  V2MesocycleStrategyRecommendationInfluenceTarget[]
> = {
  protect_lagging_muscles_earlier: [
    "MesocycleStrategy",
    "MesocycleDemand",
    "WeeklyDemandCurve",
    "SlotDemandAllocation",
    "SetDistributionIntent",
  ],
  cap_late_block_volume: [
    "MesocycleStrategy",
    "WeeklyDemandCurve",
    "SetDistributionIntent",
    "DeloadPlan",
  ],
  reduce_overlap_fatigue: [
    "MesocycleStrategy",
    "SlotDemandAllocation",
    "ExerciseClassDistribution",
    "SetDistributionIntent",
    "ExerciseSelectionStrategy",
    "MaterializerRanking",
  ],
  preserve_successful_progression: [
    "MesocycleStrategy",
    "ExerciseSelectionStrategy",
    "MaterializerRanking",
  ],
  improve_deload_execution: ["MesocycleStrategy", "DeloadPlan", "RuntimeUX"],
  rotate_low_confidence_or_stale_accessories: [
    "MesocycleStrategy",
    "ExerciseSelectionStrategy",
    "MaterializerRanking",
  ],
  maintain_balanced_hypertrophy: ["MesocycleStrategy", "MesocycleDemand"],
  unknown: ["MesocycleStrategy"],
};

type StrategyPromotionBlueprint = {
  proposedOwner: V2StrategyHypothesisPromotionReadinessOwner;
  boundedBehaviorScope: string;
  requiredEvidence: string[];
  requiredNonRegressionGates: string[];
  knownRisks: string[];
  rollbackCriteria: string[];
};

const PROMOTION_READINESS_BLUEPRINTS: Record<
  V2MesocycleStrategyRecommendationHypothesisId,
  StrategyPromotionBlueprint
> = {
  improve_deload_execution: {
    proposedOwner: "RuntimeUX",
    boundedBehaviorScope:
      "Read-only comparison of DeloadPlan versus RuntimeUX adherence interventions; no muscle-demand changes.",
    requiredEvidence: [
      "skipped_deload_execution_evidence",
      "owner_decision_between_plan_design_runtime_ux_reminders_and_logging_semantics",
      "next_block_readiness_impact_after_skipped_deload",
      "deload_design_choice_shorter_easier_optional_or_better_explained",
    ],
    requiredNonRegressionGates: [
      "deload_sessions_remain_progression_excluded",
      "scheduled_deload_runtime_replay_still_preserves_seed_identities_and_set_reduction_contract",
      "no_accumulation_generation_selection_repair_seed_runtime_or_receipt_change_without_explicit_trial",
      "audit_compares_deload_execution_and_next_block_readiness_before_and_after_trial",
    ],
    knownRisks: [
      "skipped_deload_may_be_product_adherence_not_hypertrophy_demand_problem",
      "shortening_or_relaxing_deload_could_reduce_recovery_if fatigue harm is real",
      "forcing deload adherence could reduce user trust if explanation is poor",
    ],
    rollbackCriteria: [
      "next_block_readiness_or_adherence_worsens",
      "deload_sessions_start_counting_toward_progression_history",
      "runtime_deload_output_drifts_from_accepted_seed_replay_contract",
    ],
  },
  protect_lagging_muscles_earlier: {
    proposedOwner: "MesocycleDemand",
    boundedBehaviorScope:
      "Read-only diff for protected target-tier set ownership before slot allocation; no demand consumption yet.",
    requiredEvidence: [
      "recurring_target_tier_under_hit_evidence",
      "slot_owner_for_protected_sets",
      "session_size_effect_estimate",
      "over_concentration_non_worsening_evidence",
      "repair_materiality_non_regression_evidence",
      "dirty_collateral_non_regression_evidence",
      "late_block_bloat_non_regression_evidence",
    ],
    requiredNonRegressionGates: [
      "priority_target_coverage_preserved_or_improved",
      "no_session_exceeds_size_or_set_budget_caps",
      "no_over_concentration_increase",
      "no_material_or_major_repair_increase",
      "no_dirty_collateral_or_forbidden_slot_workaround",
      "no_excessive_late_block_volume_bloat",
    ],
    knownRisks: [
      "under_hit_evidence_can_reflect adherence or capacity rather than low demand",
      "protected sets can crowd out other priority targets",
      "late-block protection can increase fatigue and skipped work",
    ],
    rollbackCriteria: [
      "target-tier under-hit count does not improve in read-only diff",
      "session size, concentration, material repair, or dirty collateral worsens",
      "lagging-muscle protection creates new late-block bloat",
    ],
  },
  cap_late_block_volume: {
    proposedOwner: "WeeklyDemandCurve",
    boundedBehaviorScope:
      "Read-only Week 3-4 volume-cap diff with priority target coverage preserved.",
    requiredEvidence: [
      "skipped_set_spike_threshold",
      "hard_week_rpe_volume_skipped_work_relationship",
      "priority_target_coverage_preservation",
      "lagging_muscles_not_underdosed_further",
      "deload_recovery_interaction_understood",
    ],
    requiredNonRegressionGates: [
      "priority_target_coverage_preserved",
      "lagging_target_tier_muscles_not_reduced_below_floor",
      "late_block_skipped_sets_or_hard_week_fatigue_improves",
      "deload_projection_remains_recovery_biased",
      "no_material_or_major_repair_increase",
    ],
    knownRisks: [
      "volume caps can hide demand gaps instead of fixing allocation",
      "cutting late-block volume can underdose muscles already lagging",
      "skipped sets may be caused by UX or schedule constraints rather than volume",
    ],
    rollbackCriteria: [
      "priority target coverage regresses",
      "lagging target-tier muscles are further underdosed",
      "skipped work or hard-week fatigue does not improve",
    ],
  },
  reduce_overlap_fatigue: {
    proposedOwner: "SlotDemandAllocation",
    boundedBehaviorScope:
      "Read-only fatigue-overlap attribution and cleaner slot/class allocation diff.",
    requiredEvidence: [
      "overlap_fatigue_driver_attribution",
      "muscle_or_class_collateral_source_identified",
      "hamstring_glute_back_stimulus_preserved",
      "repair_non_regression_evidence",
      "no_forbidden_slot_workaround",
    ],
    requiredNonRegressionGates: [
      "required_hamstring_glute_back_stimulus_preserved",
      "no_suspicious_repair_increase",
      "no_forbidden_slot_primary_solution",
      "no_material_or_major_repair_increase",
      "selection_class_distribution_still_satisfies_required_lanes",
    ],
    knownRisks: [
      "fatigue attribution can be wrong without class-level evidence",
      "reducing overlap can accidentally remove required posterior-chain stimulus",
      "forbidden-slot workarounds can look cleaner while becoming less valid",
    ],
    rollbackCriteria: [
      "required hamstring, glute, or back stimulus drops below target",
      "suspicious repair or forbidden-slot cleanup increases",
      "material repair increases in the compared artifact",
    ],
  },
  preserve_successful_progression: {
    proposedOwner: "ExerciseSelectionStrategy",
    boundedBehaviorScope:
      "Read-only continuity/materializer ranking diff for productive performed exercises only.",
    requiredEvidence: [
      "productive_continuity_classification",
      "sufficient_completed_exposures",
      "no_pain_or_tolerance_issue",
      "no_duplicate_or_class_conflict",
      "no_excessive_staleness",
    ],
    requiredNonRegressionGates: [
      "productive_anchor_preserved_without_forcing_every_old_prescribed_exercise",
      "duplicate_policy_and_class_distinctness_preserved",
      "pain_or_tolerance_flags_block_preservation",
      "materializer_ranking_diff_does_not_reduce_required_lane_coverage",
    ],
    knownRisks: [
      "continuity can become stale if exact identities are over-preserved",
      "preserving one exercise can create duplicate or class conflicts",
      "old prescribed exercises must not be treated as productive without performed evidence",
    ],
    rollbackCriteria: [
      "productive exercise preservation reduces required lane coverage",
      "duplicate or class conflicts increase",
      "pain, tolerance, or staleness evidence appears for preserved identities",
    ],
  },
  rotate_low_confidence_or_stale_accessories: {
    proposedOwner: "ExerciseSelectionStrategy",
    boundedBehaviorScope:
      "Read-only accessory rotation candidate diff only when stale/skipped/swapped evidence and clean alternatives exist.",
    requiredEvidence: [
      "clear_stale_skipped_stalled_or_swapped_evidence",
      "clean_alternative_inventory_exists",
      "rotation_preserves_lane_and_class_intent",
      "no_loss_of_progression_anchor",
      "no_random_novelty_policy",
    ],
    requiredNonRegressionGates: [
      "rotation_preserves_required_lane_class_and_set_intent",
      "productive_anchor_not_removed",
      "clean_alternative_available_before_duplicate_or_rotation",
      "no_random_novelty_without_evidence",
      "materializer_ranking_diff_does_not_increase_omissions_or_blocking_rows",
    ],
    knownRisks: [
      "stale accessory evidence can be thin or caused by schedule adherence",
      "random novelty can replace useful low-risk accessories",
      "rotation can remove a quiet progression anchor",
    ],
    rollbackCriteria: [
      "rotation increases omissions, blocking rows, or material repair",
      "progression anchor is lost without clear stale or tolerance evidence",
      "replacement is novel but not cleaner for the lane/class intent",
    ],
  },
  maintain_balanced_hypertrophy: {
    proposedOwner: "MesocycleStrategy",
    boundedBehaviorScope:
      "Read-only balanced-phase hold decision after absence of lag, fatigue, adherence, and recovery risks is proven.",
    requiredEvidence: [
      "absence_of_meaningful_lagging_target_tier_muscles",
      "absence_of_late_block_fatigue_or_skipped_set_spike",
      "productive_progression_or_stable_performance_evidence",
      "readiness_and_adherence_stable",
    ],
    requiredNonRegressionGates: [
      "balanced_hold_does_not_preserve_known_under_hit_or_over_fatigue_pattern",
      "target_tier_coverage_remains_within_expected_band",
      "no_material_or_major_repair_increase",
    ],
    knownRisks: [
      "balanced hold can become generic repetition if evidence gaps are ignored",
      "absence of signals is not proof when history quality is low",
    ],
    rollbackCriteria: [
      "new under-hit or over-fatigue pattern appears",
      "balanced hold fails target-tier coverage",
    ],
  },
  unknown: {
    proposedOwner: "unknown",
    boundedBehaviorScope:
      "No behavior scope; unmapped evidence must be classified before promotion.",
    requiredEvidence: [
      "specific_strategy_hypothesis_classification",
      "planner_owner_identified",
      "bounded_behavior_scope_defined",
      "non_regression_gate_set_defined",
    ],
    requiredNonRegressionGates: [
      "do_not_promote_unknown_strategy_evidence",
      "classification_added_before_any_behavior_trial",
    ],
    knownRisks: [
      "unknown evidence can become arbitrary planner policy",
      "owner ambiguity can scatter logic across demand, selection, repair, and runtime",
    ],
    rollbackCriteria: [
      "unknown hypothesis reaches any behavior-consuming seam",
      "classification remains ambiguous after read-only diff",
    ],
  },
};

const RECOMMENDATION_PROMOTION_BLOCKERS: Record<
  V2MesocycleStrategyRecommendationHypothesisId,
  string[]
> = {
  protect_lagging_muscles_earlier: [
    "requires_strategy_to_demand_promotion_before_volume_changes",
    "requires_week_by_week_demand_projection_and_recovery_validation",
    "must_not_automatically_add_volume_from_under_hit_evidence",
  ],
  cap_late_block_volume: [
    "requires_weekly_demand_curve_and_fatigue_carryover_policy",
    "requires_no_regression_audit_before_any_late_block_volume_cap",
    "must_not_automatically_reduce_planned_volume_from_skips",
  ],
  reduce_overlap_fatigue: [
    "requires_overlap_fatigue_policy_and_slot_allocation_trial",
    "requires_explicit_pain_evidence_before_pain_claims",
    "must_not_change_exercise_choices_from_overlap_evidence",
  ],
  preserve_successful_progression: [
    "requires_exercise_selection_strategy_or_materializer_ranking_promotion",
    "must_not_preserve_every_old_prescribed_exercise",
    "requires_recent_performed_progression_to_remain_visible",
  ],
  improve_deload_execution: [
    "requires_deload_plan_promotion_and_runtime_replay_integration",
    "must_not_treat_skipped_deload_as_hypertrophy_stimulus",
  ],
  rotate_low_confidence_or_stale_accessories: [
    "requires_explicit_accessory_or_support_lane_classification",
    "requires_clean_alternative_inventory_before_rotation_policy",
    "must_not_rotate_all_accessories",
  ],
  maintain_balanced_hypertrophy: [
    "requires_absence_of_meaningful_lag_fatigue_and_adherence_flags",
    "requires_explicit_phase_strategy_before_balanced_phase_claim",
  ],
  unknown: [
    "requires_more_normalized_performed_response_evidence",
    "must_not_infer_strategy_from_old_prescribed_plan_shape",
  ],
};

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function emptyCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function countValues<T extends string>(
  keys: readonly T[],
  values: readonly T[],
): Record<T, number> {
  const counts = emptyCounts(keys);
  for (const value of values) {
    counts[value] += 1;
  }
  return counts;
}

function countStrings(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function repeatedExamples(values: string[], minimumCount = 2): string[] {
  return Array.from(countStrings(values).entries())
    .filter(([, count]) => count >= minimumCount)
    .sort(
      ([leftName, leftCount], [rightName, rightCount]) =>
        rightCount - leftCount || leftName.localeCompare(rightName),
    )
    .slice(0, 8)
    .map(([value]) => value);
}

function confidenceRank(confidence: V2MesocycleStrategyConfidence): number {
  if (confidence === "high") {
    return 3;
  }
  if (confidence === "medium") {
    return 2;
  }
  return 1;
}

function maxConfidence(
  values: V2MesocycleStrategyConfidence[],
): V2MesocycleStrategyConfidence {
  return values.sort(
    (left, right) => confidenceRank(right) - confidenceRank(left),
  )[0] ?? "low";
}

function resolveHypothesisConfidence(input: {
  evidenceCount: number;
  contributingSignalConfidences: V2MesocycleStrategyConfidence[];
}): V2MesocycleStrategyConfidence {
  const highCount = input.contributingSignalConfidences.filter(
    (confidence) => confidence === "high",
  ).length;
  const mediumOrHighCount = input.contributingSignalConfidences.filter(
    (confidence) => confidence !== "low",
  ).length;
  if (highCount >= 3 && input.evidenceCount >= 3) {
    return "high";
  }
  if (mediumOrHighCount >= 2 || input.evidenceCount >= 2) {
    return "medium";
  }
  return "low";
}

function muscleNameFromFlag(flag: string): string {
  return flag.split(":")[0]?.trim() ?? flag;
}

function isTargetTierMuscle(muscle: string): boolean {
  const targetTier = getMuscleTargetSemantics(muscle).targetTier;
  return targetTier === "A_PRIMARY" || targetTier === "B_SUPPORT";
}

function isPromotionDiffHypothesisId(
  id: V2MesocycleStrategyRecommendationHypothesisId,
): id is V2StrategyHypothesisPromotionDiffHypothesisId {
  return PROMOTION_DIFF_HYPOTHESIS_IDS.includes(
    id as V2StrategyHypothesisPromotionDiffHypothesisId,
  );
}

function targetTierRank(muscle: string): number {
  const tier = getMuscleTargetSemantics(muscle).targetTier;
  if (tier === "A_PRIMARY") {
    return 0;
  }
  if (tier === "B_SUPPORT") {
    return 1;
  }
  return 2;
}

function isAccessoryLikeExerciseSignal(
  signal: V2MesocycleStrategyInput["exerciseResponseSignals"][number],
): boolean {
  if (
    signal.evidence.notes?.some((note) =>
      /accessory|support|stale/i.test(note),
    )
  ) {
    return true;
  }
  const targetTiers = (signal.muscleTargets ?? [])
    .map((muscle) => getMuscleTargetSemantics(muscle).targetTier)
    .filter(Boolean);
  return (
    targetTiers.length > 0 &&
    targetTiers.every((tier) => tier !== "A_PRIMARY")
  );
}

type MuscleEvidenceEntry = {
  muscle: string;
  count: number;
  mesocycleIds: string[];
  confidences: V2MesocycleStrategyConfidence[];
};

function collectMuscleEvidence(
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"],
  getMuscles: (
    signal: V2MesocycleStrategyInput["blockResponseSignals"][number],
  ) => string[],
): MuscleEvidenceEntry[] {
  const byMuscle = new Map<string, MuscleEvidenceEntry>();
  for (const signal of blockSignals) {
    const muscles = unique(getMuscles(signal).filter(Boolean));
    for (const muscle of muscles) {
      const existing = byMuscle.get(muscle) ?? {
        muscle,
        count: 0,
        mesocycleIds: [],
        confidences: [],
      };
      existing.count += 1;
      existing.mesocycleIds.push(signal.mesocycleId);
      existing.confidences.push(signal.confidence);
      byMuscle.set(muscle, existing);
    }
  }
  return Array.from(byMuscle.values()).sort(
    (left, right) =>
      right.count - left.count || left.muscle.localeCompare(right.muscle),
  );
}

function hasBlockResponseEvidence(
  signal: V2MesocycleStrategyInput["blockResponseSignals"][number],
): boolean {
  return (
    signal.strategyImplications.some((implication) => implication !== "unknown") ||
    (signal.fatigueDistribution.evidence.length ?? 0) > 0 ||
    (signal.muscleDistribution.recurringUnderHitMuscles?.length ?? 0) > 0 ||
    (signal.muscleDistribution.recurringOverConcentratedMuscles?.length ?? 0) > 0
  );
}

function hasExerciseResponseEvidence(
  signal: V2MesocycleStrategyInput["exerciseResponseSignals"][number],
): boolean {
  return signal.signal !== "unknown" && signal.signal !== "low_confidence";
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

function buildHistoricalSourcePlannerCounts(
  strategyInput: V2MesocycleStrategyInput | undefined,
): V2MesocycleStrategyDiagnostic["strategyInputSummary"]["historicalSourcePlannerCounts"] {
  const counts = {
    legacy_projection: 0,
    v2: 0,
    unknown: 0,
  };
  for (const mesocycle of strategyInput?.historicalMesocycles ?? []) {
    counts[mesocycle.sourcePlanner] += 1;
  }
  return counts;
}

function collectEvidenceCategories(
  strategyInput: V2MesocycleStrategyInput,
): string[] {
  return unique([
    ...strategyInput.historicalMesocycles.flatMap((mesocycle) => [
      mesocycle.adherenceSummary ? "adherence" : "",
      (mesocycle.performedVolumeSummary?.length ?? 0) > 0
        ? "performed_volume"
        : "",
      (mesocycle.performanceSignals?.length ?? 0) > 0
        ? "performance_signals"
        : "",
    ]),
    strategyInput.blockResponseSignals.some(hasBlockResponseEvidence)
      ? "block_response"
      : "",
    strategyInput.exerciseResponseSignals.some(hasExerciseResponseEvidence)
      ? "exercise_response"
      : "",
    strategyInput.blockResponseSignals.some(
      (signal) => signal.fatigueDistribution.evidence.length > 0,
    )
      ? "fatigue_distribution"
      : "",
    strategyInput.readinessAndRecoverySignals.available.length > 0
      ? "readiness"
      : "",
    (strategyInput.readinessAndRecoverySignals.fatigueFlags?.length ?? 0) > 0
      ? "fatigue_flags"
      : "",
    (strategyInput.readinessAndRecoverySignals.painFlags?.length ?? 0) > 0
      ? "pain_or_tolerance"
      : "",
    (strategyInput.readinessAndRecoverySignals.adherenceFlags?.length ?? 0) > 0
      ? "historical_adherence_flags"
      : "",
  ].filter(Boolean));
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
      historicalSourcePlannerCounts: buildHistoricalSourcePlannerCounts(undefined),
      blockResponseSignalCount: 0,
      exerciseResponseSignalCount: 0,
      evidenceCategoriesAvailable: [],
      evidenceCategoriesMissing: [...STRATEGY_EVIDENCE_CATEGORIES],
      performedHistoryEvidenceLoaded: false,
      prescribedPlanShapeExcludedFromStrategyPolicy: true,
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
  ) ||
    strategyInput.blockResponseSignals.some(hasBlockResponseEvidence) ||
    strategyInput.exerciseResponseSignals.some(hasExerciseResponseEvidence);
  const evidenceCategoriesAvailable = collectEvidenceCategories(strategyInput);
  const evidenceCategoriesMissing = STRATEGY_EVIDENCE_CATEGORIES.filter(
    (category) => !evidenceCategoriesAvailable.includes(category),
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
    historicalSourcePlannerCounts:
      buildHistoricalSourcePlannerCounts(strategyInput),
    blockResponseSignalCount: strategyInput.blockResponseSignals.length,
    exerciseResponseSignalCount: strategyInput.exerciseResponseSignals.length,
    evidenceCategoriesAvailable,
    evidenceCategoriesMissing,
    performedHistoryEvidenceLoaded: hasHistoricalResponseEvidence,
    prescribedPlanShapeExcludedFromStrategyPolicy: true,
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
  const hasBlockResponse = summary.blockResponseSignalCount > 0;
  const hasExerciseResponse = summary.exerciseResponseSignalCount > 0;
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
      ...(summary.performedHistoryEvidenceLoaded
        ? ["strategy_input:performed_history_evidence_loaded"]
        : []),
      ...(hasBlockResponse
        ? [`strategy_input:block_response_signals:${summary.blockResponseSignalCount}`]
        : []),
      ...(hasExerciseResponse
        ? [
            `strategy_input:exercise_response_signals:${summary.exerciseResponseSignalCount}`,
          ]
        : []),
      ...(summary.prescribedPlanShapeExcludedFromStrategyPolicy
        ? ["historical_prescribed_plan_shape_excluded_from_strategy_policy"]
        : []),
    ]),
    missing: unique([
      ...(hasHistoricalInput
        ? []
        : ["performed_history_is_not_primary_input_to_pure_v2_strategy"]),
      ...(summary.performedHistoryEvidenceLoaded
        ? []
        : ["strategy_ready_performed_history_evidence_not_loaded"]),
      ...(hasBlockResponse
        ? []
        : ["muscle_level_response_trends_are_not_strategy_normalized"]),
      ...(hasExerciseResponse
        ? []
        : [
            "exercise_staleness_tolerance_sfr_and_pain_history_are_not_strategy_ranked",
          ]),
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

function resolveEvidenceStatus(input: {
  availableCount: number;
  lowConfidenceCount: number;
  limitationCount: number;
}): V2MesocycleStrategyEvidenceStatus {
  if (input.availableCount <= 0) {
    return "not_available";
  }
  return input.lowConfidenceCount > 0 || input.limitationCount > 0
    ? "available_with_limitations"
    : "available";
}

function buildResponseEvidenceSummary(
  strategyInput: V2MesocycleStrategyInput | undefined,
  summary: V2MesocycleStrategyDiagnostic["strategyInputSummary"],
): V2MesocycleStrategyDiagnostic["responseEvidenceSummary"] {
  const blockSignals = strategyInput?.blockResponseSignals ?? [];
  const exerciseSignals = strategyInput?.exerciseResponseSignals ?? [];
  const implicationCounts = countValues(
    BLOCK_STRATEGY_IMPLICATIONS,
    blockSignals.flatMap((signal) => signal.strategyImplications),
  );
  const exerciseSignalsByType = countValues(
    EXERCISE_RESPONSE_SIGNAL_TYPES,
    exerciseSignals.map((signal) => signal.signal),
  );
  const confidenceDistribution = countValues(STRATEGY_CONFIDENCE_LEVELS, [
    ...blockSignals.map((signal) => signal.confidence),
    ...exerciseSignals.map((signal) => signal.confidence),
  ]);
  const recurringUnderHitMuscleExamples = repeatedExamples(
    blockSignals.flatMap(
      (signal) => signal.muscleDistribution.recurringUnderHitMuscles ?? [],
    ),
  );
  const recurringOverConcentrationExamples = repeatedExamples(
    blockSignals.flatMap(
      (signal) =>
        signal.muscleDistribution.recurringOverConcentratedMuscles ?? [],
    ),
  );

  return {
    blockResponseSignalCount: blockSignals.length,
    strategyImplicationCounts: implicationCounts,
    recurringUnderHitMuscleExamples,
    recurringOverConcentrationExamples,
    exerciseResponseSignalCount: exerciseSignals.length,
    exerciseSignalsByType,
    confidenceDistribution,
    evidenceLimitations: summary.evidenceLimitations,
    usableForFutureContinuityVariation: exerciseSignals.some(
      (signal) =>
        signal.signal !== "unknown" &&
        signal.signal !== "low_confidence" &&
        signal.confidence !== "low",
    ),
    usableForFutureMaterializerRanking: exerciseSignals.some(
      (signal) =>
        [
          "progressed",
          "stalled",
          "regressed",
          "skipped_often",
          "swapped_out",
          "pain_or_tolerance_issue",
          "high_fatigue_cost",
        ].includes(signal.signal) && signal.confidence !== "low",
    ),
    usableForFutureVolumeFatigueStrategy: blockSignals.some((signal) =>
      signal.strategyImplications.some((implication) => implication !== "unknown"),
    ),
  };
}

function buildContinuityVariationEvidence(
  strategyInput: V2MesocycleStrategyInput | undefined,
): V2MesocycleStrategyDiagnostic["continuityVariationEvidence"] {
  const exerciseSignals = strategyInput?.exerciseResponseSignals ?? [];
  const keepCandidateCount = exerciseSignals.filter(
    (signal) => signal.signal === "progressed" && signal.confidence !== "low",
  ).length;
  const rotateCandidateCount = exerciseSignals.filter((signal) =>
    ["stalled", "regressed", "skipped_often", "swapped_out"].includes(
      signal.signal,
    ),
  ).length;
  const avoidCandidateCount = exerciseSignals.filter((signal) =>
    ["pain_or_tolerance_issue", "high_fatigue_cost"].includes(signal.signal),
  ).length;
  const lowConfidenceCount = exerciseSignals.filter(
    (signal) =>
      signal.confidence === "low" ||
      signal.signal === "low_confidence" ||
      signal.signal === "unknown",
  ).length;
  const limitations = unique([
    "continuity_variation_evidence_is_read_only",
    "continuity_variation_evidence_not_consumed_by_selection_or_materializer",
    exerciseSignals.some((signal) => signal.signal === "swapped_out")
      ? null
      : "swapped_out_only_available_when_explicitly_detectable",
    exerciseSignals.some((signal) => signal.signal === "pain_or_tolerance_issue")
      ? null
      : "pain_or_tolerance_requires_explicit_evidence",
  ].filter(Boolean) as string[]);

  return {
    status: resolveEvidenceStatus({
      availableCount:
        keepCandidateCount + rotateCandidateCount + avoidCandidateCount,
      lowConfidenceCount,
      limitationCount: limitations.length,
    }),
    keepCandidateCount,
    rotateCandidateCount,
    avoidCandidateCount,
    lowConfidenceCount,
    limitations,
  };
}

function buildVolumeFatigueStrategyEvidence(
  strategyInput: V2MesocycleStrategyInput | undefined,
): V2MesocycleStrategyDiagnostic["volumeFatigueStrategyEvidence"] {
  const blockSignals = strategyInput?.blockResponseSignals ?? [];
  const protectLaggingMuscleSignals = repeatedExamples(
    blockSignals.flatMap(
      (signal) => signal.muscleDistribution.recurringUnderHitMuscles ?? [],
    ),
  );
  const overConcentrationSignals = repeatedExamples(
    blockSignals.flatMap(
      (signal) =>
        signal.muscleDistribution.recurringOverConcentratedMuscles ?? [],
    ),
  );
  const lateBlockFatigueSignals = blockSignals.flatMap((signal) =>
    signal.adherence.skippedSetTrend === "rising" ||
    signal.strategyImplications.includes("cap_late_block_volume")
      ? [`${signal.mesocycleId}:late_block_skipped_sets_rising`]
      : [],
  );
  const deloadExecutionSignals = blockSignals.flatMap((signal) =>
    signal.effortProgression.deloadExecuted === false
      ? [`${signal.mesocycleId}:deload_not_executed`]
      : [],
  );
  const lowConfidenceCount = blockSignals.filter(
    (signal) => signal.confidence === "low",
  ).length;
  const limitations = unique([
    "volume_fatigue_strategy_evidence_is_read_only",
    "volume_fatigue_strategy_evidence_not_consumed_by_mesocycle_demand",
    protectLaggingMuscleSignals.length > 0
      ? null
      : "recurring_lagging_muscle_evidence_not_available",
    overConcentrationSignals.length > 0
      ? null
      : "recurring_over_concentration_evidence_not_available",
  ].filter(Boolean) as string[]);

  return {
    status: resolveEvidenceStatus({
      availableCount:
        protectLaggingMuscleSignals.length +
        overConcentrationSignals.length +
        lateBlockFatigueSignals.length +
        deloadExecutionSignals.length,
      lowConfidenceCount,
      limitationCount: limitations.length,
    }),
    protectLaggingMuscleSignals,
    overConcentrationSignals,
    lateBlockFatigueSignals,
    deloadExecutionSignals,
    limitations,
  };
}

function buildRecommendationHypothesis(input: {
  id: V2MesocycleStrategyRecommendationHypothesisId;
  priority: "P0" | "P1" | "P2";
  confidence: V2MesocycleStrategyConfidence;
  evidence: string[];
  extraPromotionBlockers?: string[];
}): V2MesocycleStrategyRecommendation["hypotheses"][number] {
  return {
    id: input.id,
    readOnly: true,
    affectsScoringOrGeneration: false,
    priority: input.priority,
    confidence: input.confidence,
    evidence: unique(input.evidence).slice(0, 8),
    wouldEventuallyInfluence: RECOMMENDATION_INFLUENCE_TARGETS[input.id],
    mustNotYetInfluence: RECOMMENDATION_MUST_NOT_YET_INFLUENCE,
    promotionBlockers: unique([
      "recommendation_is_evidence_backed_hypothesis_not_planner_instruction",
      "recommendation_not_consumed_by_mesocycle_demand_or_materializer",
      "requires_explicit_promotion_slice_with_no_drift_verification",
      "old_prescribed_plan_shape_excluded_from_recommendation_policy",
      ...(RECOMMENDATION_PROMOTION_BLOCKERS[input.id] ?? []),
      ...(input.extraPromotionBlockers ?? []),
    ]),
  };
}

function buildProtectLaggingMusclesHypothesis(
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"],
): V2MesocycleStrategyRecommendation["hypotheses"][number] | null {
  const entries = collectMuscleEvidence(blockSignals, (signal) =>
    [
      ...(signal.muscleDistribution.recurringUnderHitMuscles ?? []),
      ...(signal.muscleDistribution.belowMevFlags ?? []).map(muscleNameFromFlag),
    ].filter(isTargetTierMuscle),
  );
  if (entries.length === 0) {
    return null;
  }
  const evidence = entries.flatMap((entry) => [
    `${entry.muscle}:under_hit_in_${entry.count}_performed_block_response`,
    ...entry.mesocycleIds
      .slice(0, 2)
      .map((mesocycleId) => `${mesocycleId}:under_hit:${entry.muscle}`),
  ]);
  return buildRecommendationHypothesis({
    id: "protect_lagging_muscles_earlier",
    priority: "P1",
    confidence: resolveHypothesisConfidence({
      evidenceCount: entries.reduce((sum, entry) => sum + entry.count, 0),
      contributingSignalConfidences: entries.flatMap(
        (entry) => entry.confidences,
      ),
    }),
    evidence,
  });
}

function buildCapLateBlockVolumeHypothesis(
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"],
): V2MesocycleStrategyRecommendation["hypotheses"][number] | null {
  const contributingSignals = blockSignals.filter(
    (signal) =>
      signal.adherence.skippedSetTrend === "rising" ||
      signal.strategyImplications.includes("cap_late_block_volume"),
  );
  if (contributingSignals.length === 0) {
    return null;
  }
  const evidence = contributingSignals.flatMap((signal) => {
    const hardWeekRpe = Math.max(
      0,
      ...(signal.effortProgression.averageRpeByWeek ?? [])
        .filter((row) => row.week >= 3)
        .map((row) => row.averageRpe),
    );
    return [
      signal.adherence.skippedSetTrend === "rising"
        ? `${signal.mesocycleId}:skipped_set_trend_rising`
        : "",
      typeof signal.adherence.skippedSetCount === "number"
        ? `${signal.mesocycleId}:skipped_sets:${signal.adherence.skippedSetCount}`
        : "",
      hardWeekRpe >= 8
        ? `${signal.mesocycleId}:hard_week_average_rpe:${hardWeekRpe}`
        : "",
      ...signal.fatigueDistribution.evidence.filter((row) =>
        /late_block|hard_week|skipped/i.test(row),
      ),
    ].filter(Boolean);
  });
  return buildRecommendationHypothesis({
    id: "cap_late_block_volume",
    priority: "P1",
    confidence: resolveHypothesisConfidence({
      evidenceCount: evidence.length,
      contributingSignalConfidences: contributingSignals.map(
        (signal) => signal.confidence,
      ),
    }),
    evidence,
  });
}

function buildReduceOverlapFatigueHypothesis(
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"],
): V2MesocycleStrategyRecommendation["hypotheses"][number] | null {
  const entries = collectMuscleEvidence(blockSignals, (signal) => [
    ...(signal.muscleDistribution.recurringOverConcentratedMuscles ?? []),
    ...(signal.muscleDistribution.overMavFlags ?? []).map(muscleNameFromFlag),
    ...(signal.fatigueDistribution.likelyFatigueDrivers ?? []),
    ...signal.fatigueDistribution.evidence
      .filter((row) => row.startsWith("overlap_fatigue_driver:"))
      .map((row) => row.replace("overlap_fatigue_driver:", "")),
  ]);
  const supportedEntries = entries.filter((entry) => entry.count > 0);
  if (supportedEntries.length === 0) {
    return null;
  }
  const evidence = supportedEntries.flatMap((entry) => [
    `${entry.muscle}:overlap_or_concentration_in_${entry.count}_performed_block_response`,
    ...entry.mesocycleIds
      .slice(0, 2)
      .map((mesocycleId) => `${mesocycleId}:fatigue_driver:${entry.muscle}`),
  ]);
  return buildRecommendationHypothesis({
    id: "reduce_overlap_fatigue",
    priority: "P1",
    confidence: resolveHypothesisConfidence({
      evidenceCount: supportedEntries.reduce(
        (sum, entry) => sum + entry.count,
        0,
      ),
      contributingSignalConfidences: supportedEntries.flatMap(
        (entry) => entry.confidences,
      ),
    }),
    evidence,
    extraPromotionBlockers: [
      "overlap_fatigue_evidence_does_not_imply_pain_without_explicit_signal",
    ],
  });
}

function buildPreserveProgressionHypothesis(
  exerciseSignals: V2MesocycleStrategyInput["exerciseResponseSignals"],
): V2MesocycleStrategyRecommendation["hypotheses"][number] | null {
  const progressedSignals = exerciseSignals.filter(
    (signal) => signal.signal === "progressed",
  );
  if (progressedSignals.length === 0) {
    return null;
  }
  const evidence = progressedSignals.map((signal) => {
    const name = signal.exerciseName ?? signal.exerciseId ?? "unknown_exercise";
    const mesocycleCount = signal.evidence.mesocycleIds.length;
    const completed = signal.evidence.completedExposureCount ?? 0;
    const trends = [
      signal.evidence.loadTrend === "rising" ? "load_rising" : "",
      signal.evidence.repTrend === "rising" ? "rep_rising" : "",
      signal.evidence.rpeTrend === "stable" ? "rpe_stable" : "",
    ].filter(Boolean);
    return `${name}:progressed:mesocycles=${mesocycleCount}:completed_exposures=${completed}${trends.length > 0 ? `:${trends.join("+")}` : ""}`;
  });
  return buildRecommendationHypothesis({
    id: "preserve_successful_progression",
    priority: "P2",
    confidence: resolveHypothesisConfidence({
      evidenceCount: progressedSignals.reduce(
        (sum, signal) =>
          sum +
          Math.max(
            1,
            signal.evidence.mesocycleIds.length,
            (signal.evidence.completedExposureCount ?? 0) >= 2 ? 2 : 0,
          ),
        0,
      ),
      contributingSignalConfidences: progressedSignals.map(
        (signal) => signal.confidence,
      ),
    }),
    evidence,
  });
}

function buildImproveDeloadExecutionHypothesis(
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"],
): V2MesocycleStrategyRecommendation["hypotheses"][number] | null {
  const skippedDeloadSignals = blockSignals.filter(
    (signal) => signal.effortProgression.deloadExecuted === false,
  );
  if (skippedDeloadSignals.length === 0) {
    return null;
  }
  return buildRecommendationHypothesis({
    id: "improve_deload_execution",
    priority: "P0",
    confidence: resolveHypothesisConfidence({
      evidenceCount: skippedDeloadSignals.length,
      contributingSignalConfidences: skippedDeloadSignals.map(
        (signal) => signal.confidence,
      ),
    }),
    evidence: skippedDeloadSignals.map(
      (signal) => `${signal.mesocycleId}:deload_not_executed`,
    ),
  });
}

function buildRotateAccessoryHypothesis(
  exerciseSignals: V2MesocycleStrategyInput["exerciseResponseSignals"],
): V2MesocycleStrategyRecommendation["hypotheses"][number] | null {
  const rotateSignals = exerciseSignals.filter(
    (signal) =>
      [
        "stalled",
        "regressed",
        "skipped_often",
        "swapped_out",
        "low_confidence",
      ].includes(signal.signal) && isAccessoryLikeExerciseSignal(signal),
  );
  if (rotateSignals.length === 0) {
    return null;
  }
  const evidence = rotateSignals.map((signal) => {
    const name = signal.exerciseName ?? signal.exerciseId ?? "unknown_exercise";
    return `${name}:${signal.signal}:completed=${signal.evidence.completedExposureCount ?? 0}:skipped=${signal.evidence.skippedExposureCount ?? 0}:swapped=${signal.evidence.swappedExposureCount ?? 0}`;
  });
  return buildRecommendationHypothesis({
    id: "rotate_low_confidence_or_stale_accessories",
    priority: "P2",
    confidence: resolveHypothesisConfidence({
      evidenceCount: rotateSignals.reduce(
        (sum, signal) =>
          sum +
          Math.max(
            1,
            signal.evidence.skippedExposureCount ?? 0,
            signal.evidence.swappedExposureCount ?? 0,
          ),
        0,
      ),
      contributingSignalConfidences: rotateSignals.map(
        (signal) => signal.confidence,
      ),
    }),
    evidence,
  });
}

function buildUnknownRecommendationHypothesis(input: {
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"];
  exerciseSignals: V2MesocycleStrategyInput["exerciseResponseSignals"];
}): V2MesocycleStrategyRecommendation["hypotheses"][number] {
  return buildRecommendationHypothesis({
    id: "unknown",
    priority: "P2",
    confidence: maxConfidence([
      ...input.blockSignals.map((signal) => signal.confidence),
      ...input.exerciseSignals.map((signal) => signal.confidence),
      "low",
    ]),
    evidence: [
      `block_response_signals:${input.blockSignals.length}`,
      `exercise_response_signals:${input.exerciseSignals.length}`,
      "normalized_performed_response_evidence_did_not_map_to_specific_strategy_hypothesis",
    ],
  });
}

function buildStrategyRecommendation(
  strategyInput: V2MesocycleStrategyInput | undefined,
  summary: V2MesocycleStrategyDiagnostic["strategyInputSummary"],
): V2MesocycleStrategyRecommendation {
  const blockSignals = strategyInput?.blockResponseSignals ?? [];
  const exerciseSignals = strategyInput?.exerciseResponseSignals ?? [];
  const hasPerformedEvidence =
    summary.performedHistoryEvidenceLoaded ||
    blockSignals.some(hasBlockResponseEvidence) ||
    exerciseSignals.some(hasExerciseResponseEvidence);
  const hypotheses = [
    buildImproveDeloadExecutionHypothesis(blockSignals),
    buildProtectLaggingMusclesHypothesis(blockSignals),
    buildCapLateBlockVolumeHypothesis(blockSignals),
    buildReduceOverlapFatigueHypothesis(blockSignals),
    buildPreserveProgressionHypothesis(exerciseSignals),
    buildRotateAccessoryHypothesis(exerciseSignals),
  ].filter(
    (
      hypothesis,
    ): hypothesis is V2MesocycleStrategyRecommendation["hypotheses"][number] =>
      Boolean(hypothesis),
  );
  const finalHypotheses =
    hasPerformedEvidence && hypotheses.length === 0
      ? [
          buildUnknownRecommendationHypothesis({
            blockSignals,
            exerciseSignals,
          }),
        ]
      : hypotheses;

  const limitations = unique([
    "strategy_recommendation_is_read_only_and_non_binding",
    "strategy_recommendation_not_consumed_by_mesocycle_demand",
    "strategy_recommendation_not_consumed_by_materializer_ranking",
    "strategy_recommendation_not_consumed_by_generation_selection_repair_seed_runtime_or_receipts",
    "recommended_phase_remains_unknown_until_macrocycle_phase_strategy_exists",
    "old_prescribed_plan_shape_excluded_from_recommendation_policy",
    ...(hasPerformedEvidence
      ? []
      : ["normalized_performed_response_evidence_not_available"]),
    ...(summary.historicalMesocycleCount >= 2
      ? []
      : ["fewer_than_two_historical_mesocycles_keeps_confidence_low"]),
    ...(summary.missingGroups.length === 0
      ? []
      : ["missing_strategy_input_groups_keep_recommendation_limited"]),
    ...summary.evidenceLimitations,
  ]);

  return {
    version: 1,
    source: "v2_mesocycle_strategy_recommendation",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status: !hasPerformedEvidence
      ? "not_available"
      : limitations.length > 0 ||
          finalHypotheses.some((hypothesis) => hypothesis.confidence === "low")
        ? "available_with_limitations"
        : "available",
    recommendedPhase: "unknown",
    confidence: "low",
    hypotheses: finalHypotheses,
    limitations,
  };
}

function evidenceContains(
  hypothesis: V2MesocycleStrategyRecommendation["hypotheses"][number],
  pattern: RegExp,
): boolean {
  return hypothesis.evidence.some((entry) => pattern.test(entry));
}

function hasSufficientCompletedExposureEvidence(
  hypothesis: V2MesocycleStrategyRecommendation["hypotheses"][number],
): boolean {
  return hypothesis.evidence.some((entry) => {
    const match = /completed_exposures=(\d+)/.exec(entry);
    return match ? Number(match[1]) >= 2 : false;
  });
}

function collectAvailablePromotionEvidence(input: {
  hypothesis: V2MesocycleStrategyRecommendation["hypotheses"][number];
  continuityVariationEvidence: V2MesocycleStrategyDiagnostic["continuityVariationEvidence"];
  volumeFatigueStrategyEvidence: V2MesocycleStrategyDiagnostic["volumeFatigueStrategyEvidence"];
}): string[] {
  const { hypothesis } = input;
  const available: string[] = [];

  if (
    hypothesis.id === "improve_deload_execution" &&
    input.volumeFatigueStrategyEvidence.deloadExecutionSignals.length > 0
  ) {
    available.push("skipped_deload_execution_evidence");
  }

  if (
    hypothesis.id === "protect_lagging_muscles_earlier" &&
    input.volumeFatigueStrategyEvidence.protectLaggingMuscleSignals.length > 0
  ) {
    available.push("recurring_target_tier_under_hit_evidence");
  }

  if (hypothesis.id === "cap_late_block_volume") {
    if (evidenceContains(hypothesis, /skipped_set_trend_rising|skipped_sets:/)) {
      available.push("skipped_set_spike_threshold");
    }
    if (
      evidenceContains(hypothesis, /hard_week_average_rpe:/) &&
      evidenceContains(hypothesis, /skipped_set_trend_rising|skipped_sets:/)
    ) {
      available.push("hard_week_rpe_volume_skipped_work_relationship");
    }
  }

  if (hypothesis.id === "reduce_overlap_fatigue") {
    if (evidenceContains(hypothesis, /fatigue_driver|overlap_or_concentration/)) {
      available.push("overlap_fatigue_driver_attribution");
      available.push("muscle_or_class_collateral_source_identified");
    }
  }

  if (hypothesis.id === "preserve_successful_progression") {
    if (input.continuityVariationEvidence.keepCandidateCount > 0) {
      available.push("productive_continuity_classification");
    }
    if (hasSufficientCompletedExposureEvidence(hypothesis)) {
      available.push("sufficient_completed_exposures");
    }
  }

  if (hypothesis.id === "rotate_low_confidence_or_stale_accessories") {
    if (
      evidenceContains(
        hypothesis,
        /stalled|regressed|skipped_often|swapped_out|low_confidence/,
      )
    ) {
      available.push("clear_stale_skipped_stalled_or_swapped_evidence");
    }
  }

  return unique(available);
}

function resolvePromotionReadinessLevel(input: {
  hypothesis: V2MesocycleStrategyRecommendation["hypotheses"][number];
  missingEvidence: string[];
  availableEvidence: string[];
}): V2StrategyHypothesisPromotionReadinessLevel {
  const { hypothesis, missingEvidence, availableEvidence } = input;
  if (hypothesis.id === "unknown") {
    return "not_ready";
  }
  if (hypothesis.id === "improve_deload_execution") {
    return availableEvidence.includes("skipped_deload_execution_evidence")
      ? "needs_owner"
      : "needs_more_evidence";
  }
  if (hypothesis.id === "rotate_low_confidence_or_stale_accessories") {
    return "needs_more_evidence";
  }
  if (hypothesis.confidence === "low" || availableEvidence.length === 0) {
    return "needs_more_evidence";
  }
  if (missingEvidence.length === 0) {
    return "needs_non_regression_gates";
  }
  return "ready_for_read_only_diff";
}

function nextSafeActionForReadiness(
  readiness: V2StrategyHypothesisPromotionReadinessLevel,
): V2StrategyHypothesisPromotionReadinessNextSafeAction {
  if (readiness === "ready_for_bounded_trial") {
    return "run_bounded_trial";
  }
  if (readiness === "needs_non_regression_gates") {
    return "add_audit_gate";
  }
  if (readiness === "ready_for_read_only_diff" || readiness === "needs_owner") {
    return "add_read_only_diff";
  }
  if (readiness === "not_ready") {
    return "do_not_promote";
  }
  return "collect_more_evidence";
}

function buildStrategyHypothesisPromotionReadiness(input: {
  strategyRecommendation: V2MesocycleStrategyRecommendation;
  strategyInputSummary: V2MesocycleStrategyDiagnostic["strategyInputSummary"];
  continuityVariationEvidence: V2MesocycleStrategyDiagnostic["continuityVariationEvidence"];
  volumeFatigueStrategyEvidence: V2MesocycleStrategyDiagnostic["volumeFatigueStrategyEvidence"];
}): V2StrategyHypothesisPromotionReadiness {
  const hypothesisReadiness = input.strategyRecommendation.hypotheses.map(
    (hypothesis) => {
      const blueprint = PROMOTION_READINESS_BLUEPRINTS[hypothesis.id];
      const availableEvidence = collectAvailablePromotionEvidence({
        hypothesis,
        continuityVariationEvidence: input.continuityVariationEvidence,
        volumeFatigueStrategyEvidence: input.volumeFatigueStrategyEvidence,
      });
      const missingEvidence = blueprint.requiredEvidence.filter(
        (required) => !availableEvidence.includes(required),
      );
      const readiness = resolvePromotionReadinessLevel({
        hypothesis,
        missingEvidence,
        availableEvidence,
      });

      return {
        hypothesisId: hypothesis.id,
        readiness,
        proposedOwner: blueprint.proposedOwner,
        boundedBehaviorScope: blueprint.boundedBehaviorScope,
        requiredEvidence: blueprint.requiredEvidence,
        missingEvidence,
        requiredNonRegressionGates: blueprint.requiredNonRegressionGates,
        knownRisks: blueprint.knownRisks,
        rollbackCriteria: blueprint.rollbackCriteria,
        nextSafeAction: nextSafeActionForReadiness(readiness),
      };
    },
  );
  const anyBoundedTrial = hypothesisReadiness.some(
    (row) => row.readiness === "ready_for_bounded_trial",
  );
  const anyReadOnlyDiff = hypothesisReadiness.some(
    (row) =>
      row.readiness === "ready_for_read_only_diff" ||
      row.readiness === "needs_owner" ||
      row.readiness === "needs_non_regression_gates",
  );

  return {
    version: 1,
    source: "v2_strategy_hypothesis_promotion_readiness",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status: anyBoundedTrial
      ? "ready_for_bounded_trial"
      : anyReadOnlyDiff
        ? "partially_ready"
        : "not_ready",
    hypothesisReadiness,
    globalBlockers: unique([
      "promotion_readiness_is_diagnostic_only",
      "strategy_hypotheses_are_not_planner_instructions",
      "readiness_not_consumed_by_mesocycle_demand_or_materializer",
      "readiness_must_not_influence_generation_selection_repair_seed_runtime_or_receipts",
      "bounded_trials_require_explicit_follow_up_slice",
      "non_regression_gates_not_yet_satisfied",
      "audit_comparison_path_required_before_behavior",
      ...(hypothesisReadiness.length > 0 ? [] : ["no_strategy_hypotheses_available"]),
    ]),
    limitations: unique([
      "readiness_defines_requirements_but_does_not_satisfy_them",
      "readiness_does_not_run_read_only_diffs_or_audit_gates_itself",
      "readiness_is_owner_agnostic_and_must_not_hard_code_owner_specific_policy",
      "old_prescribed_plan_shape_excluded_from_promotion_targets",
      ...(input.strategyInputSummary.historicalMesocycleCount >= 2
        ? []
        : ["limited_by_fewer_than_two_historical_mesocycles"]),
      ...(input.strategyInputSummary.missingGroups.length === 0
        ? []
        : ["limited_by_missing_strategy_input_groups"]),
      ...input.strategyRecommendation.limitations,
    ]),
  };
}

type PromotionReadinessRow =
  V2StrategyHypothesisPromotionReadiness["hypothesisReadiness"][number];

function readyPromotionDiffRows(
  readiness: V2StrategyHypothesisPromotionReadiness,
): PromotionReadinessRow[] {
  return readiness.hypothesisReadiness.filter(
    (row) =>
      row.readiness === "ready_for_read_only_diff" &&
      isPromotionDiffHypothesisId(row.hypothesisId),
  );
}

function emptyNonRegressionGates(): V2StrategyHypothesisPromotionDiff["nonRegressionGates"] {
  return {
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
  };
}

function collectTargetTierUnderHitEntries(
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"],
): MuscleEvidenceEntry[] {
  return collectMuscleEvidence(blockSignals, (signal) =>
    [
      ...(signal.muscleDistribution.recurringUnderHitMuscles ?? []),
      ...(signal.muscleDistribution.belowMevFlags ?? []).map(muscleNameFromFlag),
    ].filter(isTargetTierMuscle),
  );
}

function fatigueDriverMuscleFromEvidence(entry: string): string | null {
  const match = entry.match(
    /(?:overlap_fatigue_driver|fatigue_driver|over_concentrated):([^:]+)/i,
  );
  return match?.[1]?.trim() || null;
}

function collectRedistributionDonorEntries(
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"],
): MuscleEvidenceEntry[] {
  return collectMuscleEvidence(blockSignals, (signal) =>
    [
      ...(signal.muscleDistribution.recurringOverConcentratedMuscles ?? []),
      ...(signal.muscleDistribution.overMavFlags ?? []).map(muscleNameFromFlag),
      ...(signal.fatigueDistribution.likelyFatigueDrivers ?? []),
      ...signal.fatigueDistribution.evidence
        .map(fatigueDriverMuscleFromEvidence)
        .filter((muscle): muscle is string => Boolean(muscle)),
    ].filter(Boolean),
  );
}

function sortedEvidenceMuscles(entries: MuscleEvidenceEntry[]): string[] {
  return entries
    .map((entry) => entry.muscle)
    .sort(
      (left, right) =>
        targetTierRank(left) - targetTierRank(right) ||
        left.localeCompare(right),
    );
}

function proposedProjectionProtectionMechanism(input: {
  protectedMuscles: readonly string[];
  donorMuscles: readonly string[];
}): V2StrategyHypothesisProjectionDiff["candidateStrategy"]["laggingMuscleProtection"]["proposedMechanism"] {
  if (input.protectedMuscles.length === 0) {
    return "unknown";
  }
  if (input.donorMuscles.length > 0) {
    return "redistribute_sets";
  }
  if (
    input.protectedMuscles.some(
      (muscle) => getMuscleTargetSemantics(muscle).targetTier === "B_SUPPORT",
    )
  ) {
    return "early_slot_owned_support";
  }
  if (
    input.protectedMuscles.some(
      (muscle) => getMuscleTargetSemantics(muscle).targetTier === "A_PRIMARY",
    )
  ) {
    return "direct_floor_protection";
  }
  return "unknown";
}

function proposedProjectionCapMechanism(input: {
  hardWeekSkippedSetSignal: boolean;
  skippedSetExamples: readonly string[];
}): V2StrategyHypothesisProjectionDiff["candidateStrategy"]["lateBlockVolumeCap"]["proposedMechanism"] {
  if (!input.hardWeekSkippedSetSignal) {
    return "unknown";
  }
  if (
    input.skippedSetExamples.some((example) =>
      /hard_week|late_block/i.test(example),
    )
  ) {
    return "hard_week_expansion_cap";
  }
  return "session_size_cap";
}

function gateFromProjectedDelta(input: {
  status: V2StrategyHypothesisProjectionDeltaStatus;
  measured: boolean;
}): V2StrategyHypothesisProjectionGateStatus {
  if (input.status === "worsens") {
    return "fail";
  }
  if (!input.measured) {
    return "unknown";
  }
  if (input.status === "improves" || input.status === "preserved") {
    return "pass";
  }
  return "unknown";
}

function gateFromMeasuredNumericDelta(
  delta: number | undefined,
): V2StrategyHypothesisProjectionGateStatus {
  if (typeof delta !== "number") {
    return "unknown";
  }
  return delta <= 0 ? "pass" : "fail";
}

function isMeasuredDelta(value: {
  status: V2StrategyHypothesisProjectionDeltaStatus;
}): boolean {
  return value.status !== "unknown";
}

function compareCoverageSummary(
  before:
    | V2StrategyHypothesisShadowProjectionEvidence["before"]["priorityCoverage"]
    | undefined,
  after:
    | V2StrategyHypothesisShadowProjectionEvidence["after"]["priorityCoverage"]
    | undefined,
): V2StrategyHypothesisProjectionDeltaStatus {
  if (!before || !after) {
    return "unknown";
  }
  if (
    after.belowMinimumCount > before.belowMinimumCount ||
    after.coveredCount < before.coveredCount ||
    after.unknownCount > before.unknownCount
  ) {
    return "worsens";
  }
  if (
    after.belowMinimumCount < before.belowMinimumCount ||
    after.coveredCount > before.coveredCount ||
    after.unknownCount < before.unknownCount
  ) {
    return "improves";
  }
  return "preserved";
}

function coverageRank(
  row: NonNullable<
    V2StrategyHypothesisShadowProjectionEvidence["before"]["laggingMuscleCoverage"]
  >[number],
): number | null {
  if (row.status === "covered" || row.status === "above_maximum") {
    return 2;
  }
  if (row.status === "below_minimum") {
    return 0;
  }
  return null;
}

function compareLaggingCoverage(
  before:
    | V2StrategyHypothesisShadowProjectionEvidence["before"]["laggingMuscleCoverage"]
    | undefined,
  after:
    | V2StrategyHypothesisShadowProjectionEvidence["after"]["laggingMuscleCoverage"]
    | undefined,
): V2StrategyHypothesisProjectionDeltaStatus {
  if (!before || !after || before.length === 0 || after.length === 0) {
    return "unknown";
  }
  const afterByMuscle = new Map(after.map((row) => [row.muscle, row]));
  let improves = false;
  for (const beforeRow of before) {
    const afterRow = afterByMuscle.get(beforeRow.muscle);
    if (!afterRow) {
      return "unknown";
    }
    const beforeRank = coverageRank(beforeRow);
    const afterRank = coverageRank(afterRow);
    if (beforeRank == null || afterRank == null) {
      return "unknown";
    }
    if (
      afterRank < beforeRank ||
      (typeof beforeRow.sets === "number" &&
        typeof afterRow.sets === "number" &&
        afterRow.sets < beforeRow.sets)
    ) {
      return "worsens";
    }
    if (
      afterRank > beforeRank ||
      (typeof beforeRow.sets === "number" &&
        typeof afterRow.sets === "number" &&
        afterRow.sets > beforeRow.sets)
    ) {
      improves = true;
    }
  }
  return improves ? "improves" : "preserved";
}

function sumSlotSets(slots: Record<string, number> | undefined): number | null {
  if (!slots) {
    return null;
  }
  return Object.values(slots).reduce((sum, value) => sum + value, 0);
}

function compareSessionSize(input: {
  before?: Record<string, number>;
  after?: Record<string, number>;
}): V2StrategyHypothesisProjectionDeltaStatus {
  if (!input.before || !input.after) {
    return "unknown";
  }
  const slotIds = unique([
    ...Object.keys(input.before),
    ...Object.keys(input.after),
  ]);
  if (
    slotIds.some((slotId) => (input.after?.[slotId] ?? 0) > (input.before?.[slotId] ?? 0))
  ) {
    return "worsens";
  }
  const beforeTotal = sumSlotSets(input.before);
  const afterTotal = sumSlotSets(input.after);
  if (beforeTotal == null || afterTotal == null) {
    return "unknown";
  }
  if (afterTotal < beforeTotal) {
    return "improves";
  }
  return "preserved";
}

function compareMetricCount(input: {
  before?: { count: number };
  after?: { count: number };
}): V2StrategyHypothesisProjectionDeltaStatus {
  if (!input.before || !input.after) {
    return "unknown";
  }
  if (input.after.count > input.before.count) {
    return "worsens";
  }
  if (input.after.count < input.before.count) {
    return "improves";
  }
  return "preserved";
}

function compareRepairPressure(
  before:
    | V2StrategyHypothesisShadowProjectionEvidence["before"]["repairPressure"]
    | undefined,
  after:
    | V2StrategyHypothesisShadowProjectionEvidence["after"]["repairPressure"]
    | undefined,
): V2StrategyHypothesisProjectionDeltaStatus {
  if (!before || !after) {
    return "unknown";
  }
  const deltas = [
    after.materialRepairCount - before.materialRepairCount,
    after.majorRepairCount - before.majorRepairCount,
    after.suspiciousRepairCount - before.suspiciousRepairCount,
  ];
  if (deltas.some((delta) => delta > 0)) {
    return "worsens";
  }
  if (deltas.some((delta) => delta < 0)) {
    return "improves";
  }
  return "preserved";
}

function compareLateBlockFatigueRisk(input: {
  before?: { count: number; totalSets?: number; maxSlotSets?: number };
  after?: { count: number; totalSets?: number; maxSlotSets?: number };
}): V2StrategyHypothesisProjectionDeltaStatus {
  if (!input.before || !input.after) {
    return "unknown";
  }
  const beforeValues = [
    input.before.count,
    input.before.totalSets,
    input.before.maxSlotSets,
  ];
  const afterValues = [
    input.after.count,
    input.after.totalSets,
    input.after.maxSlotSets,
  ];
  let improves = false;
  for (let index = 0; index < beforeValues.length; index += 1) {
    const before = beforeValues[index];
    const after = afterValues[index];
    if (typeof before !== "number" || typeof after !== "number") {
      continue;
    }
    if (after > before) {
      return "worsens";
    }
    if (after < before) {
      improves = true;
    }
  }
  return improves ? "improves" : "preserved";
}

function buildMeasuredProjectedDeltas(
  shadowProjection: V2StrategyHypothesisShadowProjectionEvidence,
): V2StrategyHypothesisProjectionDiff["projectedDeltas"] {
  const beforeRepair = shadowProjection.before.repairPressure;
  const afterRepair = shadowProjection.after.repairPressure;
  const beforeSessionSize = shadowProjection.before.sessionSize?.totalSetsBySlot;
  const afterSessionSize = shadowProjection.after.sessionSize?.totalSetsBySlot;

  return {
    priorityCoverage: {
      before: shadowProjection.before.priorityCoverage,
      after: shadowProjection.after.priorityCoverage,
      status: compareCoverageSummary(
        shadowProjection.before.priorityCoverage,
        shadowProjection.after.priorityCoverage,
      ),
      notes: [
        "measured_by_read_only_shadow_projection",
        "priority_coverage_compares_target_tier_shadow_weekly_demand_rows",
      ],
    },
    laggingMuscleCoverage: {
      before: shadowProjection.before.laggingMuscleCoverage,
      after: shadowProjection.after.laggingMuscleCoverage,
      status: compareLaggingCoverage(
        shadowProjection.before.laggingMuscleCoverage,
        shadowProjection.after.laggingMuscleCoverage,
      ),
      examples:
        shadowProjection.after.laggingMuscleCoverage?.map(
          (row) => `${row.muscle}:${row.status}:${row.sets ?? "unknown"}`,
        ) ?? [],
    },
    sessionSize: {
      beforeTotalSetsBySlot: beforeSessionSize,
      afterTotalSetsBySlot: afterSessionSize,
      status: compareSessionSize({
        before: beforeSessionSize,
        after: afterSessionSize,
      }),
      notes: [
        "measured_by_read_only_shadow_projection",
        "session_size_compares_before_after_total_sets_by_slot",
      ],
    },
    concentration: {
      before: shadowProjection.before.concentration,
      after: shadowProjection.after.concentration,
      status: compareMetricCount({
        before: shadowProjection.before.concentration,
        after: shadowProjection.after.concentration,
      }),
      notes: [
        "measured_by_read_only_shadow_projection",
        "concentration_compares_high_concentration_count",
      ],
    },
    repairPressure: {
      beforeMaterialRepairCount: beforeRepair?.materialRepairCount,
      afterMaterialRepairCount: afterRepair?.materialRepairCount,
      materialRepairDelta:
        beforeRepair && afterRepair
          ? afterRepair.materialRepairCount - beforeRepair.materialRepairCount
          : undefined,
      beforeMajorRepairCount: beforeRepair?.majorRepairCount,
      afterMajorRepairCount: afterRepair?.majorRepairCount,
      majorRepairDelta:
        beforeRepair && afterRepair
          ? afterRepair.majorRepairCount - beforeRepair.majorRepairCount
          : undefined,
      beforeSuspiciousRepairCount: beforeRepair?.suspiciousRepairCount,
      afterSuspiciousRepairCount: afterRepair?.suspiciousRepairCount,
      suspiciousRepairDelta:
        beforeRepair && afterRepair
          ? afterRepair.suspiciousRepairCount -
            beforeRepair.suspiciousRepairCount
          : undefined,
      status: compareRepairPressure(beforeRepair, afterRepair),
      notes: [
        "measured_by_read_only_shadow_projection",
        "repair_pressure_compares_material_major_and_suspicious_counters",
      ],
    },
    dirtyCollateral: {
      before: shadowProjection.before.dirtyCollateral,
      after: shadowProjection.after.dirtyCollateral,
      status: compareMetricCount({
        before: shadowProjection.before.dirtyCollateral,
        after: shadowProjection.after.dirtyCollateral,
      }),
      notes: [
        "measured_by_read_only_shadow_projection_when_dirty_collateral_rows_exist",
      ],
    },
    forbiddenSlotRisk: {
      before: shadowProjection.before.forbiddenSlotRisk,
      after: shadowProjection.after.forbiddenSlotRisk,
      status: compareMetricCount({
        before: shadowProjection.before.forbiddenSlotRisk,
        after: shadowProjection.after.forbiddenSlotRisk,
      }),
      notes: [
        "measured_by_read_only_shadow_projection",
        "forbidden_slot_risk_counts_primary_work_in_forbidden_slots",
      ],
    },
    lateBlockFatigueRisk: {
      before: shadowProjection.before.lateBlockFatigueRisk,
      after: shadowProjection.after.lateBlockFatigueRisk,
      status: compareLateBlockFatigueRisk({
        before: shadowProjection.before.lateBlockFatigueRisk,
        after: shadowProjection.after.lateBlockFatigueRisk,
      }),
      notes: [
        "measured_by_read_only_shadow_projection",
        "late_block_fatigue_risk_compares_concentration_and_session_size_pressure",
      ],
    },
  };
}

const CONFLICT_AWARE_CONFLICT_TYPES: V2StrategyHypothesisConflictAwareConflict["type"][] =
  [
    "protected_donor_overlap",
    "floor_preservation_conflict",
    "slot_owner_missing",
    "session_size_cap_conflict",
    "net_new_volume_blocked",
    "unknown",
  ];

function sortedUnique(values: readonly string[]): string[] {
  return unique([...values]).sort((left, right) => left.localeCompare(right));
}

const DEFAULT_PRE_SHADOW_FLOOR_MARGIN_SETS = 0.5;
const DEFAULT_PRE_SHADOW_TARGET_TIER_FLOOR_MARGIN_SETS = 1;

export type V2StrategyHypothesisPreShadowCandidateFilterInput = {
  evaluatesCombinedPair: boolean;
  candidateProtectedMuscles: readonly string[];
  candidateDonorMuscles: readonly string[];
  baseCoverageRows?: readonly V2StrategyHypothesisProjectionCoverageRow[];
  protectedSlotOwners?: Record<string, readonly string[]>;
  donorSlotOwners?: Record<string, readonly string[]>;
  slotSetCountBySlot?: Record<string, number>;
  slotMaxSetCountBySlot?: Record<string, number>;
  clearlyOverConcentratedMuscles?: readonly string[];
  concentrationRiskMuscles?: readonly string[];
  floorMarginSets?: number;
  targetTierFloorMarginSets?: number;
};

function baseCoverageStatus(input: {
  sets?: number;
  floor?: number;
  marginRequired: number;
}): "below" | "covered" | "surplus" | "unknown" {
  if (typeof input.sets !== "number" || typeof input.floor !== "number") {
    return "unknown";
  }
  const margin = input.sets - input.floor;
  if (margin < 0) {
    return "below";
  }
  if (margin >= input.marginRequired) {
    return "surplus";
  }
  return "covered";
}

function preShadowBaseCoverage(input: {
  row: V2StrategyHypothesisProjectionCoverageRow | undefined;
  marginRequired: number;
}):
  | V2StrategyHypothesisPreShadowCandidateFilter["donorEligibility"][number]["baseCoverage"]
  | undefined {
  if (!input.row) {
    return { status: "unknown" };
  }
  const floor = input.row.minSets;
  const sets = input.row.sets;
  return {
    ...(typeof sets === "number" ? { sets } : {}),
    ...(typeof floor === "number" ? { floor } : {}),
    ...(typeof sets === "number" && typeof floor === "number"
      ? { margin: Number((sets - floor).toFixed(2)) }
      : {}),
    status: baseCoverageStatus({
      sets,
      floor,
      marginRequired: input.marginRequired,
    }),
  };
}

function isTargetTierFromCoverage(
  muscle: string,
  row: V2StrategyHypothesisProjectionCoverageRow | undefined,
): boolean {
  const tier = row?.targetTier ?? getMuscleTargetSemantics(muscle).targetTier;
  return tier === "A_PRIMARY" || tier === "B_SUPPORT";
}

function hasCompatibleSlotOwner(input: {
  muscle: string;
  ownersByMuscle: Record<string, readonly string[]> | undefined;
}): boolean {
  return (input.ownersByMuscle?.[input.muscle]?.length ?? 0) > 0;
}

function hasNonOverloadedSlotOwner(input: {
  muscle: string;
  ownersByMuscle: Record<string, readonly string[]> | undefined;
  slotSetCountBySlot: Record<string, number> | undefined;
  slotMaxSetCountBySlot: Record<string, number> | undefined;
}): boolean {
  const owners = input.ownersByMuscle?.[input.muscle] ?? [];
  if (owners.length === 0) {
    return false;
  }
  return owners.some((slotId) => {
    const currentSets = input.slotSetCountBySlot?.[slotId];
    const maxSets = input.slotMaxSetCountBySlot?.[slotId];
    if (typeof currentSets !== "number" || typeof maxSets !== "number") {
      return true;
    }
    return currentSets < maxSets;
  });
}

function donorReasonByMuscle(
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"] | undefined,
): Map<string, V2DonorSurplusCandidateReason> {
  const overConcentration = new Set(
    collectRedistributionDonorEntries(
      (blockSignals ?? []).map((signal) => ({
        ...signal,
        fatigueDistribution: {
          systemicFatigueFlag: signal.fatigueDistribution.systemicFatigueFlag,
          likelyFatigueDrivers: [],
          evidence: [],
        },
      })),
    ).map((entry) => entry.muscle),
  );
  const fatigueDrivers = new Set(
    collectRedistributionDonorEntries(
      (blockSignals ?? []).map((signal) => ({
        ...signal,
        muscleDistribution: {
          recurringUnderHitMuscles: [],
          recurringOverConcentratedMuscles: [],
          belowMevFlags: [],
          overMavFlags: [],
        },
      })),
    ).map((entry) => entry.muscle),
  );
  const muscles = sortedUnique([
    ...Array.from(overConcentration),
    ...Array.from(fatigueDrivers),
  ]);
  return new Map(
    muscles.map((muscle) => [
      muscle,
      overConcentration.has(muscle) && fatigueDrivers.has(muscle)
        ? "both"
        : overConcentration.has(muscle)
          ? "over_concentration"
          : "fatigue_driver",
    ]),
  );
}

function donorCoverageFromSources(input: {
  muscle: string;
  baseCoverageRows: readonly V2StrategyHypothesisProjectionCoverageRow[] | undefined;
  preShadowCandidateFilter:
    | V2StrategyHypothesisPreShadowCandidateFilter
    | undefined;
}): V2DonorSurplusEvidence["donorEvidence"][number]["baselineCoverage"] {
  const row = input.baseCoverageRows?.find(
    (candidate) => candidate.muscle === input.muscle,
  );
  const preShadowRow = input.preShadowCandidateFilter?.donorEligibility.find(
    (candidate) => candidate.muscle === input.muscle,
  );
  const effectiveSets = row?.sets ?? preShadowRow?.baseCoverage?.sets;
  const floorSets = row?.minSets ?? preShadowRow?.baseCoverage?.floor;
  const preferredSets = row?.preferredSets;
  const measured =
    typeof effectiveSets === "number" && typeof floorSets === "number";
  const surplusAboveFloor = measured
    ? Number((effectiveSets - floorSets).toFixed(2))
    : undefined;
  const measuredSurplusAboveFloor =
    typeof surplusAboveFloor === "number" ? surplusAboveFloor : null;
  const status: V2DonorSurplusEvidence["donorEvidence"][number]["baselineCoverage"]["status"] =
    !measured
      ? "unknown"
      : measuredSurplusAboveFloor !== null && measuredSurplusAboveFloor < 0
        ? "below_floor"
        : measuredSurplusAboveFloor === 0
          ? "at_floor"
          : "surplus";

  return {
    measured,
    ...(typeof effectiveSets === "number" ? { effectiveSets } : {}),
    ...(typeof floorSets === "number" ? { floorSets } : {}),
    ...(typeof preferredSets === "number" ? { preferredSets } : {}),
    ...(typeof surplusAboveFloor === "number" ? { surplusAboveFloor } : {}),
    status,
  };
}

function resolveDonorSlotOwnership(input: {
  muscle: string;
  donorSlotOwners: Record<string, readonly string[]> | undefined;
  preShadowRow:
    | V2StrategyHypothesisPreShadowCandidateFilter["donorEligibility"][number]
    | undefined;
}): V2DonorSurplusEvidence["donorEvidence"][number]["slotOwnership"] {
  const owners =
    input.donorSlotOwners?.[input.muscle] ??
    candidateSlotOwnersForMuscle(input.muscle);
  const limitations = unique([
    ...(owners.length === 0 ? ["no_candidate_slot_owner"] : []),
    ...(input.preShadowRow?.reason === "slot_incompatible"
      ? ["slot_owner_evidence_incompatible"]
      : []),
  ]);
  return {
    candidateSlotOwners: [...owners],
    compatible: owners.length > 0 && limitations.length === 0,
    limitations,
  };
}

function resolveDonorEligibility(input: {
  targetTier?: string;
  baselineCoverage: V2DonorSurplusEvidence["donorEvidence"][number]["baselineCoverage"];
  protectedConflict: V2DonorSurplusEvidence["donorEvidence"][number]["protectedConflict"];
  slotOwnership: V2DonorSurplusEvidence["donorEvidence"][number]["slotOwnership"];
  preShadowRow:
    | V2StrategyHypothesisPreShadowCandidateFilter["donorEligibility"][number]
    | undefined;
  concentrationRisk: boolean;
  fatigueRegressionRisk: boolean;
  floorMarginSets: number;
  targetTierFloorMarginSets: number;
}): V2DonorSurplusEvidence["donorEvidence"][number]["eligibility"] {
  const targetTierDonor =
    input.targetTier === "A_PRIMARY" || input.targetTier === "B_SUPPORT";
  const requiredMargin = targetTierDonor
    ? input.targetTierFloorMarginSets
    : input.floorMarginSets;
  const margin = input.baselineCoverage.surplusAboveFloor;
  const safeSurplus = typeof margin === "number" && margin >= requiredMargin;
  let reason: V2DonorSurplusEligibilityReason = "safe_surplus_margin";
  let eligible = true;

  if (input.protectedConflict.isProtectedMuscle && !safeSurplus) {
    eligible = false;
    reason = "protected_overlap";
  } else if (!input.baselineCoverage.measured) {
    eligible = false;
    reason = "unknown_margin";
  } else if (input.baselineCoverage.status === "below_floor") {
    eligible = false;
    reason = "below_floor";
  } else if (input.baselineCoverage.status === "at_floor") {
    eligible = false;
    reason = "at_floor";
  } else if (!safeSurplus) {
    eligible = false;
    reason = "insufficient_margin";
  } else if (!input.slotOwnership.compatible) {
    eligible = false;
    reason = "slot_incompatible";
  } else if (
    input.preShadowRow?.reason === "concentration_risk" ||
    input.concentrationRisk
  ) {
    eligible = false;
    reason = "concentration_risk";
  } else if (input.fatigueRegressionRisk) {
    eligible = false;
    reason = "fatigue_regression_risk";
  }

  return {
    eligible,
    reason,
    confidence:
      eligible && input.baselineCoverage.measured
        ? "high"
        : input.baselineCoverage.measured
          ? "medium"
          : "low",
  };
}

export function buildV2DonorSurplusEvidence(
  input: V2DonorSurplusEvidenceInput,
): V2DonorSurplusEvidence {
  const floorMarginSets =
    input.floorMarginSets ?? DEFAULT_PRE_SHADOW_FLOOR_MARGIN_SETS;
  const targetTierFloorMarginSets =
    input.targetTierFloorMarginSets ??
    DEFAULT_PRE_SHADOW_TARGET_TIER_FLOOR_MARGIN_SETS;
  const candidateDonors = sortedUnique(input.candidateDonorMuscles);
  const candidateProtected = new Set(sortedUnique(input.candidateProtectedMuscles));
  const reasonByMuscle = donorReasonByMuscle(input.blockSignals);
  const coverageByMuscleName = new Map(
    (input.baseCoverageRows ?? []).map((row) => [row.muscle, row]),
  );
  const preShadowDonorByMuscle = new Map(
    (input.preShadowCandidateFilter?.donorEligibility ?? []).map((row) => [
      row.muscle,
      row,
    ]),
  );
  const clearlyOverConcentrated = new Set(
    input.clearlyOverConcentratedMuscles ?? [],
  );
  const concentrationRisk = new Set(input.concentrationRiskMuscles ?? []);
  const fatigueRegressionRisk = new Set(
    input.fatigueRegressionRiskMuscles ?? [],
  );

  const donorEvidence = candidateDonors.map((muscle) => {
    const coverageRow = coverageByMuscleName.get(muscle);
    const preShadowRow = preShadowDonorByMuscle.get(muscle);
    const targetTier =
      coverageRow?.targetTier ??
      getMuscleTargetSemantics(muscle).targetTier ??
      undefined;
    const baselineCoverage = donorCoverageFromSources({
      muscle,
      baseCoverageRows: input.baseCoverageRows,
      preShadowCandidateFilter: input.preShadowCandidateFilter,
    });
    const protectedConflict = {
      isProtectedMuscle: candidateProtected.has(muscle),
      requiresSurplusProof: candidateProtected.has(muscle),
    };
    const slotOwnership = resolveDonorSlotOwnership({
      muscle,
      donorSlotOwners: input.donorSlotOwners,
      preShadowRow,
    });
    const eligibility = resolveDonorEligibility({
      targetTier,
      baselineCoverage,
      protectedConflict,
      slotOwnership,
      preShadowRow,
      concentrationRisk:
        concentrationRisk.has(muscle) ||
        preShadowRow?.reason === "concentration_risk" ||
        (input.clearlyOverConcentratedMuscles !== undefined &&
          (targetTier === "A_PRIMARY" || targetTier === "B_SUPPORT") &&
          coverageRow?.status !== "above_maximum" &&
          !clearlyOverConcentrated.has(muscle)),
      fatigueRegressionRisk: fatigueRegressionRisk.has(muscle),
      floorMarginSets,
      targetTierFloorMarginSets,
    });

    return {
      muscle,
      ...(targetTier ? { targetTier } : {}),
      candidateReason: reasonByMuscle.get(muscle) ?? "unknown",
      baselineCoverage,
      protectedConflict,
      slotOwnership,
      eligibility,
    };
  });

  const summary: V2DonorSurplusEvidence["summary"] = {
    candidateCount: donorEvidence.length,
    eligibleCount: donorEvidence.filter((row) => row.eligibility.eligible)
      .length,
    ineligibleCount: donorEvidence.filter((row) => !row.eligibility.eligible)
      .length,
    unknownMarginCount: donorEvidence.filter(
      (row) => row.eligibility.reason === "unknown_margin",
    ).length,
    protectedOverlapCount: donorEvidence.filter(
      (row) => row.eligibility.reason === "protected_overlap",
    ).length,
    slotIncompatibleCount: donorEvidence.filter(
      (row) => row.eligibility.reason === "slot_incompatible",
    ).length,
  };
  const status: V2DonorSurplusEvidence["status"] =
    !input.evaluatesCombinedPair || donorEvidence.length === 0
      ? "not_available"
      : summary.eligibleCount === donorEvidence.length
        ? "available"
        : "available_with_limitations";

  return {
    version: 1,
    source: "v2_donor_surplus_evidence",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    status,
    donorEvidence,
    summary,
    limitations: unique([
      ...(!input.evaluatesCombinedPair
        ? ["combined_strategy_hypotheses_not_available"]
        : []),
      ...(candidateDonors.length === 0 ? ["no_candidate_donor_evidence"] : []),
      ...(candidateDonors.length > 0 && summary.eligibleCount === 0
        ? ["no_safe_donor_with_measurable_surplus_margin"]
        : []),
      ...(summary.unknownMarginCount > 0
        ? ["donor_floor_surplus_margin"]
        : []),
      ...(summary.protectedOverlapCount > 0
        ? ["protected_donor_overlap_requires_surplus_proof"]
        : []),
      ...(summary.slotIncompatibleCount > 0
        ? ["slot_ownership_compatibility_missing"]
        : []),
      "donor_surplus_evidence_is_read_only_and_non_binding",
      "old_prescribed_plan_shape_excluded_from_donor_surplus_evidence",
      "repaired_projection_excluded_from_donor_surplus_target",
      "donor_surplus_evidence_is_not_consumed_by_demand_weekly_curve_slot_allocation_materializer_generation_selection_repair_seed_runtime_or_receipts",
    ]),
  };
}

function emptyPreShadowCandidateFilter(
  status: V2StrategyHypothesisPreShadowCandidateFilter["status"],
): V2StrategyHypothesisPreShadowCandidateFilter {
  return {
    enabled: true,
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    status,
    configuration: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      floorMarginSets: DEFAULT_PRE_SHADOW_FLOOR_MARGIN_SETS,
      targetTierFloorMarginSets:
        DEFAULT_PRE_SHADOW_TARGET_TIER_FLOOR_MARGIN_SETS,
      netNewVolumeAllowed: false,
      maxSlotIncreaseAllowed: 0,
      redistributionRequired: true,
    },
    donorEligibility: [],
    protectedEligibility: [],
    overrideConstruction: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      excludedDonors: [],
      retainedDonors: [],
      excludedProtectedMuscles: [],
      retainedProtectedMuscles: [],
      netNewVolumeAllowed: false,
      maxSlotIncreaseAllowed: 0,
      redistributionRequired: true,
    },
  };
}

export function buildV2StrategyHypothesisPreShadowCandidateFilter(
  input: V2StrategyHypothesisPreShadowCandidateFilterInput,
): V2StrategyHypothesisPreShadowCandidateFilter {
  const floorMarginSets =
    input.floorMarginSets ?? DEFAULT_PRE_SHADOW_FLOOR_MARGIN_SETS;
  const targetTierFloorMarginSets =
    input.targetTierFloorMarginSets ??
    DEFAULT_PRE_SHADOW_TARGET_TIER_FLOOR_MARGIN_SETS;
  const candidateDonors = sortedUnique(input.candidateDonorMuscles);
  const candidateProtected = sortedUnique(input.candidateProtectedMuscles);
  const coverageByMuscleName = new Map(
    (input.baseCoverageRows ?? []).map((row) => [row.muscle, row]),
  );
  if (!input.evaluatesCombinedPair || !input.baseCoverageRows) {
    return {
      ...emptyPreShadowCandidateFilter("not_available"),
      configuration: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        floorMarginSets,
        targetTierFloorMarginSets,
        netNewVolumeAllowed: false,
        maxSlotIncreaseAllowed: 0,
        redistributionRequired: true,
      },
    };
  }

  const protectedSet = new Set(candidateProtected);
  const clearlyOverConcentrated = new Set(
    input.clearlyOverConcentratedMuscles ?? [],
  );
  const concentrationRisk = new Set(input.concentrationRiskMuscles ?? []);

  const donorEligibility = candidateDonors.map((muscle) => {
    const row = coverageByMuscleName.get(muscle);
    const targetTier = isTargetTierFromCoverage(muscle, row);
    const marginRequired = targetTier
      ? targetTierFloorMarginSets
      : floorMarginSets;
    const baseCoverage = preShadowBaseCoverage({ row, marginRequired });
    const margin = baseCoverage?.margin;
    const safeSurplus =
      typeof margin === "number" && margin >= marginRequired;
    let reason: V2StrategyHypothesisPreShadowDonorReason =
      "safe_surplus_margin";
    let eligible = true;

    if (protectedSet.has(muscle) && !safeSurplus) {
      eligible = false;
      reason = "protected_overlap";
    } else if (baseCoverage?.status === "unknown") {
      eligible = false;
      reason = "unknown_floor_margin";
    } else if (baseCoverage?.status === "below") {
      eligible = false;
      reason = "below_floor";
    } else if (!safeSurplus) {
      eligible = false;
      reason = "insufficient_margin";
    } else if (
      targetTier &&
      row?.status !== "above_maximum" &&
      !clearlyOverConcentrated.has(muscle)
    ) {
      eligible = false;
      reason = "concentration_risk";
    } else if (
      !hasCompatibleSlotOwner({
        muscle,
        ownersByMuscle: input.donorSlotOwners,
      })
    ) {
      eligible = false;
      reason = "slot_incompatible";
    } else if (concentrationRisk.has(muscle)) {
      eligible = false;
      reason = "concentration_risk";
    }

    return {
      muscle,
      eligible,
      reason,
      ...(baseCoverage ? { baseCoverage } : {}),
    };
  });
  const retainedDonors = donorEligibility
    .filter((row) => row.eligible)
    .map((row) => row.muscle);
  const excludedDonors = donorEligibility
    .filter((row) => !row.eligible)
    .map((row) => row.muscle);

  const protectedEligibility = candidateProtected.map((muscle) => {
    let eligible = true;
    let reason: V2StrategyHypothesisPreShadowProtectedReason =
      "target_tier_under_hit";
    if (
      !hasNonOverloadedSlotOwner({
        muscle,
        ownersByMuscle: input.protectedSlotOwners,
        slotSetCountBySlot: input.slotSetCountBySlot,
        slotMaxSetCountBySlot: input.slotMaxSetCountBySlot,
      })
    ) {
      eligible = false;
      reason = "slot_owner_missing";
    } else if (retainedDonors.length === 0) {
      eligible = false;
      reason = "would_require_net_new_volume";
    }
    return { muscle, eligible, reason };
  });
  const retainedProtectedMuscles = protectedEligibility
    .filter((row) => row.eligible)
    .map((row) => row.muscle);
  const excludedProtectedMuscles = protectedEligibility
    .filter((row) => !row.eligible)
    .map((row) => row.muscle);
  const hasLimitations =
    excludedDonors.length > 0 ||
    excludedProtectedMuscles.length > 0 ||
    retainedDonors.length === 0 ||
    retainedProtectedMuscles.length === 0;

  return {
    enabled: true,
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    status: hasLimitations ? "available_with_limitations" : "available",
    configuration: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      floorMarginSets,
      targetTierFloorMarginSets,
      netNewVolumeAllowed: false,
      maxSlotIncreaseAllowed: 0,
      redistributionRequired: true,
    },
    donorEligibility,
    protectedEligibility,
    overrideConstruction: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      excludedDonors,
      retainedDonors,
      excludedProtectedMuscles,
      retainedProtectedMuscles,
      netNewVolumeAllowed: false,
      maxSlotIncreaseAllowed: 0,
      redistributionRequired: true,
    },
  };
}

type ShadowProjectionCoverageRow = NonNullable<
  V2StrategyHypothesisShadowProjectionEvidence["before"]["laggingMuscleCoverage"]
>[number];

function coverageByMuscle(
  rows: readonly ShadowProjectionCoverageRow[] | undefined,
): Map<string, ShadowProjectionCoverageRow> {
  return new Map((rows ?? []).map((row) => [row.muscle, row]));
}

function isCoverageRowSafelyAboveFloor(
  row: ShadowProjectionCoverageRow | undefined,
): boolean {
  if (!row) {
    return false;
  }
  if (row.status !== "covered" && row.status !== "above_maximum") {
    return false;
  }
  if (typeof row.minSets === "number" && typeof row.sets === "number") {
    return row.sets >= row.minSets;
  }
  return false;
}

function didCoverageFallBelowFloor(input: {
  before: ShadowProjectionCoverageRow | undefined;
  after: ShadowProjectionCoverageRow | undefined;
}): boolean {
  if (!input.after) {
    return false;
  }
  const afterBelow =
    input.after.status === "below_minimum" ||
    (typeof input.after.minSets === "number" &&
      typeof input.after.sets === "number" &&
      input.after.sets < input.after.minSets);
  if (!afterBelow) {
    return false;
  }
  if (!input.before) {
    return true;
  }
  return !(
    input.before.status === "below_minimum" &&
    typeof input.before.sets === "number" &&
    typeof input.after.sets === "number" &&
    input.after.sets >= input.before.sets
  );
}

function totalSetsForSlots(slots: Record<string, number> | undefined): number | null {
  if (!slots) {
    return null;
  }
  return Object.values(slots).reduce((sum, value) => sum + value, 0);
}

function countConflictTypes(
  conflicts: readonly V2StrategyHypothesisConflictAwareConflict[],
): V2StrategyHypothesisConflictAwareRefinement["conflictCountsByType"] {
  const counts: V2StrategyHypothesisConflictAwareRefinement["conflictCountsByType"] =
    {};
  for (const type of CONFLICT_AWARE_CONFLICT_TYPES) {
    const count = conflicts.filter((conflict) => conflict.type === type).length;
    if (count > 0) {
      counts[type] = count;
    }
  }
  return counts;
}

function addConflict(
  conflicts: V2StrategyHypothesisConflictAwareConflict[],
  conflict: V2StrategyHypothesisConflictAwareConflict,
): void {
  const key = `${conflict.type}:${conflict.muscle ?? ""}:${conflict.slotId ?? ""}:${conflict.reason}`;
  if (
    conflicts.some(
      (existing) =>
        `${existing.type}:${existing.muscle ?? ""}:${existing.slotId ?? ""}:${existing.reason}` ===
        key,
    )
  ) {
    return;
  }
  conflicts.push(conflict);
}

function buildConflictAwareRefinement(input: {
  evaluatesCombinedPair: boolean;
  protectedMuscles: readonly string[];
  donorMuscles: readonly string[];
  projectedDeltas: V2StrategyHypothesisProjectionDiff["projectedDeltas"];
  shadowProjection?: V2StrategyHypothesisShadowProjectionEvidence;
}): V2StrategyHypothesisConflictAwareRefinement {
  const conflicts: V2StrategyHypothesisConflictAwareConflict[] = [];
  const protectedMuscles = sortedUnique(
    input.shadowProjection?.candidateStrategy.candidateProtectedMuscles ??
      input.protectedMuscles,
  );
  const donorMuscles = sortedUnique(
    input.shadowProjection?.candidateStrategy.candidateDonorMuscles ??
      input.donorMuscles,
  );
  const protectedSet = new Set(protectedMuscles);
  const excludedDonors = new Set<string>();
  const reasonByMuscle: Record<string, string> = {};
  const donorBefore = coverageByMuscle(
    input.shadowProjection?.before.donorMuscleCoverage,
  );
  const donorAfter = coverageByMuscle(
    input.shadowProjection?.after.donorMuscleCoverage,
  );
  const protectedBefore = coverageByMuscle(
    input.shadowProjection?.before.laggingMuscleCoverage,
  );
  const protectedAfter = coverageByMuscle(
    input.shadowProjection?.after.laggingMuscleCoverage,
  );

  for (const donorMuscle of donorMuscles) {
    if (!protectedSet.has(donorMuscle)) {
      continue;
    }
    const after = donorAfter.get(donorMuscle) ?? protectedAfter.get(donorMuscle);
    if (isCoverageRowSafelyAboveFloor(after)) {
      reasonByMuscle[donorMuscle] =
        "retained_overlap_donor_only_because_shadow_projection_proves_floor_preserved";
      continue;
    }
    excludedDonors.add(donorMuscle);
    reasonByMuscle[donorMuscle] =
      "excluded_because_muscle_is_both_protected_and_donor_without_floor_proof";
    addConflict(conflicts, {
      type: "protected_donor_overlap",
      muscle: donorMuscle,
      reason:
        "protected target-tier muscle also appeared as donor; donor reduction is blocked without measured proof that floor remains safe",
    });
  }

  for (const donorMuscle of donorMuscles) {
    const before = donorBefore.get(donorMuscle);
    const after = donorAfter.get(donorMuscle);
    if (!didCoverageFallBelowFloor({ before, after })) {
      continue;
    }
    excludedDonors.add(donorMuscle);
    reasonByMuscle[donorMuscle] =
      "excluded_because_shadow_projection_put_donor_below_floor";
    addConflict(conflicts, {
      type: "floor_preservation_conflict",
      muscle: donorMuscle,
      reason:
        "candidate donor reduction would reduce a target-tier muscle below its measured floor",
    });
  }

  for (const protectedMuscle of protectedMuscles) {
    const before = protectedBefore.get(protectedMuscle);
    const after = protectedAfter.get(protectedMuscle);
    if (didCoverageFallBelowFloor({ before, after })) {
      addConflict(conflicts, {
        type: "floor_preservation_conflict",
        muscle: protectedMuscle,
        reason:
          "candidate projection reduced protected target-tier coverage below floor",
      });
    }
    if (
      typeof before?.sets === "number" &&
      typeof after?.sets === "number" &&
      after.sets < before.sets
    ) {
      addConflict(conflicts, {
        type: "floor_preservation_conflict",
        muscle: protectedMuscle,
        reason:
          "redistribution cannot damage protected target-tier coverage",
      });
    }
    const slotOwners =
      input.shadowProjection?.candidateStrategy.protectedSlotOwners?.[
        protectedMuscle
      ];
    if (input.shadowProjection && (!slotOwners || slotOwners.length === 0)) {
      addConflict(conflicts, {
        type: "slot_owner_missing",
        muscle: protectedMuscle,
        reason:
          "protected work requires a compatible slot owner before it can be treated as a safe redistribution candidate",
      });
    }
  }

  const beforeSlots = input.projectedDeltas.sessionSize.beforeTotalSetsBySlot;
  const afterSlots = input.projectedDeltas.sessionSize.afterTotalSetsBySlot;
  const beforeTotal = totalSetsForSlots(beforeSlots);
  const afterTotal = totalSetsForSlots(afterSlots);
  if (
    typeof beforeTotal === "number" &&
    typeof afterTotal === "number" &&
    afterTotal > beforeTotal
  ) {
    addConflict(conflicts, {
      type: "net_new_volume_blocked",
      reason:
        "conflict-aware shadow refinement blocks net-new volume; redistribution must fit inside the existing session/week budget",
    });
  }
  for (const slotId of sortedUnique([
    ...Object.keys(beforeSlots ?? {}),
    ...Object.keys(afterSlots ?? {}),
  ])) {
    const before = beforeSlots?.[slotId] ?? 0;
    const after = afterSlots?.[slotId] ?? 0;
    if (after > before) {
      addConflict(conflicts, {
        type: "session_size_cap_conflict",
        slotId,
        reason:
          "candidate projection increased slot set pressure despite max slot set increase allowance of zero",
      });
    }
  }

  for (const donorMuscle of donorMuscles) {
    if (reasonByMuscle[donorMuscle]) {
      continue;
    }
    reasonByMuscle[donorMuscle] =
      "retained_as_over_concentration_or_fatigue_driver_candidate_with_no_measured_conflict";
  }

  const retainedDonorMuscles = donorMuscles.filter(
    (muscle) => !excludedDonors.has(muscle),
  );

  return {
    enabled: true,
    readOnly: true,
    affectsScoringOrGeneration: false,
    status: !input.evaluatesCombinedPair
      ? "not_available"
      : conflicts.length > 0 || !input.shadowProjection
        ? "available_with_limitations"
        : "available",
    conflicts,
    conflictCountsByType: countConflictTypes(conflicts),
    donorResolution: {
      excludedDonorMuscles: sortedUnique([...excludedDonors]),
      retainedDonorMuscles,
      reasonByMuscle,
    },
    volumePolicy: {
      netNewVolumeAllowed: false,
      redistributionRequired: true,
      maxSlotSetIncreaseAllowed: 0,
    },
  };
}

function buildStrategyHypothesisProjectionDiff(input: {
  evaluatedHypotheses: V2StrategyHypothesisPromotionDiffHypothesisId[];
  protectLaggingMusclesEarlier: V2StrategyHypothesisPromotionDiff["protectLaggingMusclesEarlier"];
  capLateBlockVolume: V2StrategyHypothesisPromotionDiff["capLateBlockVolume"];
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"];
  strategyShadowProjection?: V2StrategyHypothesisShadowProjectionEvidence;
  preShadowCandidateFilter?: V2StrategyHypothesisPreShadowCandidateFilter;
}): V2StrategyHypothesisProjectionDiff {
  const evaluatesCombinedPair =
    input.evaluatedHypotheses.includes("protect_lagging_muscles_earlier") &&
    input.evaluatedHypotheses.includes("cap_late_block_volume");
  const protectedMuscles = sortedEvidenceMuscles(
    collectTargetTierUnderHitEntries(input.blockSignals),
  );
  const donorMuscles = collectRedistributionDonorEntries(input.blockSignals).map(
    (entry) => entry.muscle,
  );
  const shadowProjection =
    evaluatesCombinedPair &&
    input.strategyShadowProjection?.projectionMode === "shadow_projection" &&
    input.strategyShadowProjection.candidateHypotheses.includes(
      "protect_lagging_muscles_earlier",
    ) &&
    input.strategyShadowProjection.candidateHypotheses.includes(
      "cap_late_block_volume",
    )
      ? input.strategyShadowProjection
      : undefined;
  const projectionMode: V2StrategyHypothesisProjectionDiff["projectionMode"] =
    shadowProjection
      ? "shadow_projection"
      : evaluatesCombinedPair
        ? "read_only_estimate"
        : "not_projected";
  const protectionMechanism = proposedProjectionProtectionMechanism({
    protectedMuscles,
    donorMuscles,
  });
  const capMechanism = proposedProjectionCapMechanism({
    hardWeekSkippedSetSignal:
      input.capLateBlockVolume.skippedSetEvidence.hardWeekSkippedSetSignal,
    skippedSetExamples: input.capLateBlockVolume.skippedSetEvidence.examples,
  });
  const projectedDeltas: V2StrategyHypothesisProjectionDiff["projectedDeltas"] =
    shadowProjection
      ? buildMeasuredProjectedDeltas(shadowProjection)
      : {
          priorityCoverage: {
            status: "unknown",
            notes: [
              "no_shadow_projection_quantifies_priority_set_delta",
              "priority_coverage_cannot_pass_from_hypothesis_presence",
            ],
          },
          laggingMuscleCoverage: {
            status:
              evaluatesCombinedPair && protectedMuscles.length > 0
                ? "improves"
                : "unknown",
            examples: protectedMuscles.slice(0, 8),
          },
          sessionSize: {
            status:
              evaluatesCombinedPair &&
              donorMuscles.length > 0 &&
              input.capLateBlockVolume.skippedSetEvidence
                .hardWeekSkippedSetSignal
                ? "preserved"
                : "unknown",
            notes: [
              donorMuscles.length > 0
                ? "redistribution_preferred_before_net_new_late_block_volume"
                : "no_supported_redistribution_donor_muscles_found",
              "session_size_delta_not_measured_by_shadow_projection",
            ],
          },
          concentration: {
            status:
              evaluatesCombinedPair && donorMuscles.length > 0
                ? "improves"
                : "unknown",
            notes: [
              donorMuscles.length > 0
                ? "candidate_donor_muscles_come_from_over_concentration_or_fatigue_evidence"
                : "concentration_delta_not_estimated_without_donor_evidence",
              "concentration_delta_not_measured_by_shadow_projection",
            ],
          },
          repairPressure: {
            status: "unknown",
            notes: [
              "material_major_and_suspicious_repair_deltas_not_available_without_shadow_projection",
            ],
          },
          dirtyCollateral: {
            status: "unknown",
            notes: [
              "dirty_collateral_delta_not_available_without_shadow_projection",
            ],
          },
          forbiddenSlotRisk: {
            status: "unknown",
            notes: [
              "forbidden_slot_risk_delta_not_available_without_shadow_projection",
            ],
          },
          lateBlockFatigueRisk: {
            status:
              evaluatesCombinedPair &&
              input.capLateBlockVolume.skippedSetEvidence
                .hardWeekSkippedSetSignal
                ? "improves"
                : "unknown",
            notes: [
              input.capLateBlockVolume.skippedSetEvidence
                .hardWeekSkippedSetSignal
                ? "hard_week_skipped_set_signal_supports_cap_pressure_estimate"
                : "late_block_skipped_set_pressure_not_supported",
              "late_block_fatigue_delta_not_measured_by_shadow_projection",
            ],
          },
        };
  const conflictAwareRefinement = buildConflictAwareRefinement({
    evaluatesCombinedPair,
    protectedMuscles,
    donorMuscles,
    projectedDeltas,
    shadowProjection,
  });
  const preShadowCandidateFilter =
    input.preShadowCandidateFilter ??
    emptyPreShadowCandidateFilter("not_available");
  const computedNonRegressionGates: V2StrategyHypothesisProjectionDiff["computedNonRegressionGates"] =
    {
      preservePriorityCoverage: gateFromProjectedDelta({
        status: projectedDeltas.priorityCoverage.status,
        measured:
          Boolean(shadowProjection) &&
          isMeasuredDelta(projectedDeltas.priorityCoverage),
      }),
      preserveOrImproveLaggingMuscleCoverage: gateFromProjectedDelta({
        status: projectedDeltas.laggingMuscleCoverage.status,
        measured:
          Boolean(shadowProjection) &&
          isMeasuredDelta(projectedDeltas.laggingMuscleCoverage),
      }),
      noMaterialRepairIncrease: gateFromMeasuredNumericDelta(
        projectedDeltas.repairPressure.materialRepairDelta,
      ),
      noMajorRepairIncrease: gateFromMeasuredNumericDelta(
        projectedDeltas.repairPressure.majorRepairDelta,
      ),
      noSuspiciousRepairIncrease: gateFromMeasuredNumericDelta(
        projectedDeltas.repairPressure.suspiciousRepairDelta,
      ),
      noDirtyCollateralIncrease: gateFromProjectedDelta({
        status: projectedDeltas.dirtyCollateral.status,
        measured:
          Boolean(shadowProjection) &&
          isMeasuredDelta(projectedDeltas.dirtyCollateral),
      }),
      noForbiddenSlotWorkaround: gateFromProjectedDelta({
        status: projectedDeltas.forbiddenSlotRisk.status,
        measured:
          Boolean(shadowProjection) &&
          isMeasuredDelta(projectedDeltas.forbiddenSlotRisk),
      }),
      noSessionSizeRegression: gateFromProjectedDelta({
        status: projectedDeltas.sessionSize.status,
        measured:
          Boolean(shadowProjection) && isMeasuredDelta(projectedDeltas.sessionSize),
      }),
      noConcentrationRegression: gateFromProjectedDelta({
        status: projectedDeltas.concentration.status,
        measured:
          Boolean(shadowProjection) &&
          isMeasuredDelta(projectedDeltas.concentration),
      }),
      noLateBlockSkippedSetRiskIncrease: gateFromProjectedDelta({
        status: projectedDeltas.lateBlockFatigueRisk.status,
        measured:
          Boolean(shadowProjection) &&
          isMeasuredDelta(projectedDeltas.lateBlockFatigueRisk),
      }),
    };
  const gateValues = Object.values(computedNonRegressionGates);
  const allGatesPass = gateValues.every((gate) => gate === "pass");
  const anyGateFails = gateValues.some((gate) => gate === "fail");
  const hasMeasuredConflict =
    Boolean(shadowProjection) && conflictAwareRefinement.conflicts.length > 0;
  const preShadowFilterBlocksShadow =
    evaluatesCombinedPair &&
    preShadowCandidateFilter.status !== "not_available" &&
    (preShadowCandidateFilter.overrideConstruction.retainedDonors.length === 0 ||
      preShadowCandidateFilter.overrideConstruction.retainedProtectedMuscles
        .length === 0);

  return {
    version: 1,
    source: "v2_strategy_hypothesis_projection_diff",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    status: evaluatesCombinedPair
      ? "available_with_limitations"
      : "not_available",
    evaluatedHypotheses: evaluatesCombinedPair
      ? PROMOTION_DIFF_HYPOTHESIS_IDS
      : input.evaluatedHypotheses,
    projectionMode,
    candidateStrategy: {
      laggingMuscleProtection: {
        muscles: protectedMuscles,
        proposedMechanism: protectionMechanism,
      },
      lateBlockVolumeCap: {
        proposedMechanism: capMechanism,
      },
      redistributionPreference: {
        preferRedistributionBeforeNetNewVolume: true,
        candidateDonorMuscles: donorMuscles,
        candidateProtectedMuscles: protectedMuscles,
      },
    },
    projectedDeltas,
    ...(shadowProjection ? { shadowProjection } : {}),
    preShadowCandidateFilter,
    conflictAwareRefinement,
    computedNonRegressionGates,
    readiness: !evaluatesCombinedPair
      ? "not_ready"
      : shadowProjection
        ? allGatesPass && !hasMeasuredConflict
          ? "ready_for_bounded_behavior_trial"
          : anyGateFails || hasMeasuredConflict
            ? "needs_better_projection"
            : "ready_for_read_only_shadow_trial"
        : preShadowFilterBlocksShadow
          ? "needs_better_projection"
          : "ready_for_read_only_shadow_trial",
    limitations: unique([
      ...(preShadowCandidateFilter.status !== "not_available"
        ? ["pre_shadow_candidate_filter_is_read_only_and_non_binding"]
        : []),
      ...(preShadowCandidateFilter.overrideConstruction.excludedDonors.length > 0
        ? ["pre_shadow_candidate_filter_excluded_unsafe_donors"]
        : []),
      ...(preShadowFilterBlocksShadow
        ? ["pre_shadow_candidate_filter_left_no_safe_override_material"]
        : []),
      ...(conflictAwareRefinement.conflicts.length > 0
        ? ["conflict_aware_refinement_found_unsafe_candidate_interactions"]
        : []),
      shadowProjection
        ? "shadow_projection_rerun_is_read_only_and_non_binding"
        : "read_only_estimate_not_behavior_trial",
      ...(shadowProjection ? [] : ["no_shadow_projection_rerun_yet"]),
      ...(shadowProjection
        ? []
        : ["computed_gates_default_unknown_without_projected_delta_evidence"]),
      ...(projectedDeltas.repairPressure.status === "unknown"
        ? ["repair_pressure_deltas_not_measured"]
        : []),
      ...(projectedDeltas.dirtyCollateral.status === "unknown"
        ? ["dirty_collateral_deltas_not_measured"]
        : []),
      ...(projectedDeltas.sessionSize.status === "unknown"
        ? ["session_size_deltas_are_estimated_not_quantified"]
        : []),
      "repaired_projection_excluded_from_projection_target",
      "old_prescribed_plan_shape_excluded_from_projection_target",
      "candidate_strategy_is_owner_agnostic",
      "projection_diff_is_not_consumed_by_demand_weekly_curve_materializer_generation_selection_repair_seed_runtime_or_receipts",
      ...(input.protectLaggingMusclesEarlier.status === "not_evaluated"
        ? ["lagging_muscle_protection_diff_not_available"]
        : []),
      ...(input.capLateBlockVolume.status === "not_evaluated"
        ? ["late_block_volume_cap_diff_not_available"]
        : []),
    ]),
  };
}

function candidateSlotOwnersForMuscle(muscle: string): string[] {
  return V2_TARGET_SLOT_SKELETON.filter((slot) =>
    slot.lanes.some((lane) => lane.primaryMuscles.includes(muscle)),
  ).map((slot) => slot.slotId);
}

function slotOwnedDemandPriority(muscle: string): "P0" | "P1" | "P2" {
  const tier = getMuscleTargetSemantics(muscle).targetTier;
  if (tier === "A_PRIMARY") {
    return "P0";
  }
  if (tier === "B_SUPPORT") {
    return "P1";
  }
  return "P2";
}

function requiredOwnerForProtectedDemand(
  muscle: string,
): V2SlotOwnedDemandAdjustmentRequiredOwner {
  const tier = getMuscleTargetSemantics(muscle).targetTier;
  if (tier === "A_PRIMARY") {
    return "MesocycleDemand";
  }
  if (tier === "B_SUPPORT") {
    return "SlotDemandAllocation";
  }
  return "unknown";
}

function slotOwnedDemandReason(
  prefix: string,
  entry: MuscleEvidenceEntry,
): string {
  return `${prefix}:${entry.count}_signal${entry.count === 1 ? "" : "s"}`;
}

type PreShadowDonorRow =
  V2StrategyHypothesisPreShadowCandidateFilter["donorEligibility"][number];
type DonorSurplusEvidenceRow =
  V2DonorSurplusEvidence["donorEvidence"][number];

function hasSafeSurplusMargin(row: PreShadowDonorRow | undefined): boolean {
  return (
    row?.eligible === true ||
    row?.reason === "safe_surplus_margin" ||
    row?.baseCoverage?.status === "surplus"
  );
}

function slotOwnedDemandDonorReason(input: {
  entry: MuscleEvidenceEntry;
  donorEvidence: DonorSurplusEvidenceRow | undefined;
}): string {
  const reason = input.donorEvidence?.candidateReason ?? "unknown";
  const prefix =
    reason === "both"
      ? "over_concentration_and_fatigue"
      : reason === "over_concentration"
        ? "over_concentration"
        : reason === "fatigue_driver"
          ? "fatigue_driver"
          : "over_concentration_or_fatigue";
  return slotOwnedDemandReason(prefix, input.entry);
}

function mapDonorSurplusEligibilityReason(
  reason: V2DonorSurplusEligibilityReason,
): V2SlotOwnedDemandAdjustmentDonorEligibilityReason {
  return reason === "unknown" ? "unknown_margin" : reason;
}

function resolveSlotOwnedDonorEligibility(input: {
  muscle: string;
  protectedMuscles: ReadonlySet<string>;
  preShadowRow: PreShadowDonorRow | undefined;
  donorEvidence: DonorSurplusEvidenceRow | undefined;
  candidateSlotOwners: readonly string[];
}): {
  eligible: boolean;
  reason: V2SlotOwnedDemandAdjustmentDonorEligibilityReason;
} {
  if (input.donorEvidence) {
    return {
      eligible: input.donorEvidence.eligibility.eligible,
      reason: mapDonorSurplusEligibilityReason(
        input.donorEvidence.eligibility.reason,
      ),
    };
  }
  const safeSurplus = hasSafeSurplusMargin(input.preShadowRow);
  if (input.protectedMuscles.has(input.muscle) && !safeSurplus) {
    return { eligible: false, reason: "protected_overlap" };
  }
  if (
    input.preShadowRow?.reason === "slot_incompatible" ||
    input.candidateSlotOwners.length === 0
  ) {
    return { eligible: false, reason: "slot_incompatible" };
  }
  if (
    !input.preShadowRow ||
    input.preShadowRow.reason === "unknown_floor_margin" ||
    input.preShadowRow.reason === "unknown" ||
    input.preShadowRow.baseCoverage?.status === "unknown"
  ) {
    return { eligible: false, reason: "unknown_margin" };
  }
  if (input.preShadowRow.reason === "below_floor") {
    return { eligible: false, reason: "below_floor" };
  }
  if (input.preShadowRow.reason === "insufficient_margin") {
    return { eligible: false, reason: "insufficient_margin" };
  }
  if (input.preShadowRow.reason === "concentration_risk") {
    return { eligible: false, reason: "concentration_risk" };
  }
  if (safeSurplus) {
    return { eligible: true, reason: "safe_surplus_margin" };
  }
  return { eligible: false, reason: "unknown_margin" };
}

function buildSlotOwnedDemandAdjustmentPlan(input: {
  evaluatedHypotheses: V2StrategyHypothesisPromotionDiffHypothesisId[];
  protectLaggingMusclesEarlier: V2StrategyHypothesisPromotionDiff["protectLaggingMusclesEarlier"];
  capLateBlockVolume: V2StrategyHypothesisPromotionDiff["capLateBlockVolume"];
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"];
  preShadowCandidateFilter?: V2StrategyHypothesisPreShadowCandidateFilter;
  donorSurplusEvidence: V2DonorSurplusEvidence;
}): V2SlotOwnedDemandAdjustmentPlan {
  const evaluatesCombinedPair =
    input.evaluatedHypotheses.includes("protect_lagging_muscles_earlier") &&
    input.evaluatedHypotheses.includes("cap_late_block_volume");
  const protectedEntries = collectTargetTierUnderHitEntries(
    input.blockSignals,
  );
  const donorEntries = collectRedistributionDonorEntries(input.blockSignals);
  const protectedMuscleSet = new Set(
    protectedEntries.map((entry) => entry.muscle),
  );
  const preShadowDonorByMuscle = new Map(
    (input.preShadowCandidateFilter?.donorEligibility ?? []).map((row) => [
      row.muscle,
      row,
    ]),
  );
  const preShadowProtectedByMuscle = new Map(
    (input.preShadowCandidateFilter?.protectedEligibility ?? []).map((row) => [
      row.muscle,
      row,
    ]),
  );
  const donorSurplusByMuscle = new Map(
    input.donorSurplusEvidence.donorEvidence.map((row) => [row.muscle, row]),
  );

  const donorDemand = donorEntries.map((entry) => {
    const donorEvidence = donorSurplusByMuscle.get(entry.muscle);
    const candidateSlotOwners =
      donorEvidence?.slotOwnership.candidateSlotOwners ??
      candidateSlotOwnersForMuscle(entry.muscle);
    const eligibility = resolveSlotOwnedDonorEligibility({
      muscle: entry.muscle,
      protectedMuscles: protectedMuscleSet,
      preShadowRow: preShadowDonorByMuscle.get(entry.muscle),
      donorEvidence,
      candidateSlotOwners,
    });

    return {
      muscle: entry.muscle,
      reason: slotOwnedDemandDonorReason({ entry, donorEvidence }),
      eligible: eligibility.eligible,
      eligibilityReason: eligibility.reason,
      candidateSlotOwners,
    };
  });
  const hasEligibleDonor = donorDemand.some((row) => row.eligible);

  const protectedDemand = protectedEntries.map((entry) => {
    const candidateSlotOwners = candidateSlotOwnersForMuscle(entry.muscle);
    const preShadowProtected = preShadowProtectedByMuscle.get(entry.muscle);
    let status: V2SlotOwnedDemandAdjustmentProtectedStatus = "owned";

    if (
      candidateSlotOwners.length === 0 ||
      preShadowProtected?.reason === "slot_owner_missing"
    ) {
      status = "missing_slot_owner";
    } else if (!hasEligibleDonor) {
      status = "requires_net_new_volume";
    } else if (preShadowProtected && preShadowProtected.eligible === false) {
      status = "blocked";
    }

    return {
      muscle: entry.muscle,
      reason: slotOwnedDemandReason("target_tier_under_hit", entry),
      targetTier: getMuscleTargetSemantics(entry.muscle).targetTier ?? "unknown",
      priority: slotOwnedDemandPriority(entry.muscle),
      requiredOwner: requiredOwnerForProtectedDemand(entry.muscle),
      candidateSlotOwners,
      status,
    };
  });

  const blockingReasons = unique([
    ...(!evaluatesCombinedPair
      ? ["combined_strategy_hypotheses_not_available"]
      : []),
    ...(protectedDemand.length === 0
      ? ["no_target_tier_under_hit_protected_demand"]
      : []),
    ...(donorDemand.length === 0
      ? ["no_over_concentration_or_fatigue_donor_demand"]
      : []),
    ...(donorDemand.length > 0 && !hasEligibleDonor
      ? ["no_safe_donor_with_measurable_surplus_margin"]
      : []),
    ...(protectedDemand.some((row) => row.status === "missing_slot_owner")
      ? ["protected_demand_missing_slot_owner"]
      : []),
    ...(protectedDemand.some((row) => row.status === "requires_net_new_volume")
      ? ["net_new_volume_not_allowed"]
      : []),
    ...(donorDemand.some((row) => row.eligibilityReason === "protected_overlap")
      ? ["protected_donor_overlap_without_safe_surplus"]
      : []),
  ]);
  const unresolvedInputs = unique([
    ...(donorDemand.some((row) => row.eligibilityReason === "unknown_margin")
      ? ["donor_floor_surplus_margin"]
      : []),
    ...(!evaluatesCombinedPair ? ["combined_strategy_hypothesis_evidence"] : []),
    ...(protectedDemand.some((row) => row.status === "missing_slot_owner")
      ? ["protected_slot_owner_budget"]
      : []),
  ]);
  const feasible =
    evaluatesCombinedPair &&
    protectedDemand.length > 0 &&
    donorDemand.length > 0 &&
    hasEligibleDonor &&
    protectedDemand.every((row) => row.status === "owned");
  const status: V2SlotOwnedDemandAdjustmentPlan["status"] =
    !evaluatesCombinedPair ||
    protectedDemand.length === 0 ||
    donorDemand.length === 0
      ? "not_available"
      : feasible
        ? "feasible"
        : "blocked";
  const feasibilityStatus: V2SlotOwnedDemandAdjustmentPlan["feasibility"]["status"] =
    !evaluatesCombinedPair ? "unknown" : feasible ? "feasible" : "blocked";
  const nextSafeAction: V2SlotOwnedDemandAdjustmentPlan["nextSafeAction"] =
    feasible
      ? "add_strategy_to_demand_diff"
      : unresolvedInputs.length > 0 || status === "not_available"
        ? "collect_more_evidence"
        : "do_not_promote";

  return {
    version: 1,
    source: "v2_slot_owned_demand_adjustment_plan",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status,
    objective: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      protectLaggingTargetTierMuscles:
        input.protectLaggingMusclesEarlier.status !== "not_evaluated",
      capLateBlockVolume: input.capLateBlockVolume.status !== "not_evaluated",
      preferRedistributionBeforeNetNewVolume: true,
    },
    protectedDemand,
    donorDemand,
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
      status: feasibilityStatus,
      blockingReasons,
      unresolvedInputs,
      nextRequiredEvidence: unique([
        ...(protectedDemand.length === 0
          ? ["target_tier_lagging_muscle_evidence"]
          : []),
        ...(donorDemand.length === 0
          ? ["over_concentration_or_fatigue_donor_evidence"]
          : []),
        ...(hasEligibleDonor ? [] : ["measurable_safe_donor_surplus_margin"]),
        ...(protectedDemand.some((row) => row.status === "missing_slot_owner")
          ? ["slot_owner_for_protected_target_tier_muscles"]
          : []),
        "priority_coverage_preservation_evidence",
      ]),
    },
    nextSafeAction,
  };
}

function proposedProtectionType(
  muscles: readonly string[],
): V2StrategyHypothesisPromotionDiff["protectLaggingMusclesEarlier"]["proposedProtectionType"] {
  if (muscles.length === 0) {
    return "unknown";
  }
  if (
    muscles.some(
      (muscle) => getMuscleTargetSemantics(muscle).targetTier === "B_SUPPORT",
    )
  ) {
    return "slot_owned_support_floor";
  }
  if (
    muscles.some(
      (muscle) => getMuscleTargetSemantics(muscle).targetTier === "A_PRIMARY",
    )
  ) {
    return "early_week_direct_sets";
  }
  return "set_redistribution";
}

function buildProtectLaggingPromotionDiff(input: {
  row?: PromotionReadinessRow;
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"];
}): V2StrategyHypothesisPromotionDiff["protectLaggingMusclesEarlier"] {
  if (!input.row) {
    return {
      status: "not_evaluated",
      targetTierMuscles: [],
      recurringUnderHitMuscles: [],
      proposedProtectionType: "unknown",
      requiredGuards: [],
      riskSummary: [],
    };
  }

  const entries = collectTargetTierUnderHitEntries(input.blockSignals);
  const targetTierMuscles = entries
    .map((entry) => entry.muscle)
    .sort((left, right) => targetTierRank(left) - targetTierRank(right) || left.localeCompare(right));
  const recurringUnderHitMuscles = entries
    .filter((entry) => entry.count >= 2)
    .map((entry) => entry.muscle)
    .sort((left, right) => targetTierRank(left) - targetTierRank(right) || left.localeCompare(right));

  return {
    status:
      targetTierMuscles.length > 0
        ? "available_with_limitations"
        : "not_evaluated",
    targetTierMuscles,
    recurringUnderHitMuscles,
    proposedProtectionType: proposedProtectionType(recurringUnderHitMuscles),
    requiredGuards: [
      "protected_sets_must_have_slot_owner",
      "protected_sets_must_not_create_late_block_bloat",
      "protected_sets_must_not_worsen_over_concentration",
      "protected_sets_must_not_create_material_or_major_repair_increases",
      "protected_sets_must_not_rely_on_dirty_collateral",
      "protected_sets_must_not_use_forbidden_slots",
    ],
    riskSummary: unique([
      ...input.row.knownRisks,
      "target_tier_under_hit_evidence_can_reflect_adherence_or_capacity",
      "protected_sets_can_crowd_out_other_priority_targets",
      "protection_requires_projection_diff_before_behavior",
    ]).slice(0, 8),
  };
}

function hardWeekRpeForSignal(
  signal: V2MesocycleStrategyInput["blockResponseSignals"][number],
): number {
  return Math.max(
    0,
    ...(signal.effortProgression.averageRpeByWeek ?? [])
      .filter((row) => row.week >= 3)
      .map((row) => row.averageRpe),
  );
}

function hasHardWeekSkippedSetSignal(
  signal: V2MesocycleStrategyInput["blockResponseSignals"][number],
): boolean {
  const skippedSetSignal =
    signal.adherence.skippedSetTrend === "rising" ||
    (signal.adherence.skippedSetCount ?? 0) > 0;
  const hardWeekSignal =
    signal.effortProgression.hardWeekEffortReached === true ||
    hardWeekRpeForSignal(signal) >= 8 ||
    signal.fatigueDistribution.evidence.some((entry) =>
      /hard_week|late_block/i.test(entry),
    );
  return skippedSetSignal && hardWeekSignal;
}

function collectSkippedSetEvidenceExamples(
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"],
): string[] {
  return unique(
    blockSignals.flatMap((signal) => {
      const hardWeekRpe = hardWeekRpeForSignal(signal);
      return [
        signal.adherence.skippedSetTrend === "rising"
          ? `${signal.mesocycleId}:skipped_set_trend_rising`
          : "",
        typeof signal.adherence.skippedSetCount === "number" &&
        signal.adherence.skippedSetCount > 0
          ? `${signal.mesocycleId}:skipped_sets:${signal.adherence.skippedSetCount}`
          : "",
        signal.effortProgression.hardWeekEffortReached === true
          ? `${signal.mesocycleId}:hard_week_effort_reached`
          : "",
        hardWeekRpe >= 8
          ? `${signal.mesocycleId}:hard_week_average_rpe:${hardWeekRpe}`
          : "",
        ...signal.fatigueDistribution.evidence.filter((entry) =>
          /late_block|hard_week|skipped/i.test(entry),
        ),
      ].filter(Boolean);
    }),
  ).slice(0, 8);
}

function buildCapLateBlockPromotionDiff(input: {
  row?: PromotionReadinessRow;
  blockSignals: V2MesocycleStrategyInput["blockResponseSignals"];
}): V2StrategyHypothesisPromotionDiff["capLateBlockVolume"] {
  if (!input.row) {
    return {
      status: "not_evaluated",
      skippedSetEvidence: {
        hardWeekSkippedSetSignal: false,
        examples: [],
      },
      proposedCapType: "unknown",
      requiredGuards: [],
      riskSummary: [],
    };
  }

  const hardWeekSkippedSetSignal = input.blockSignals.some(
    hasHardWeekSkippedSetSignal,
  );
  const examples = collectSkippedSetEvidenceExamples(input.blockSignals);

  return {
    status: hardWeekSkippedSetSignal
      ? "available_with_limitations"
      : "not_evaluated",
    skippedSetEvidence: {
      hardWeekSkippedSetSignal,
      examples,
    },
    proposedCapType: hardWeekSkippedSetSignal
      ? "late_block_expansion_cap"
      : "unknown",
    requiredGuards: [
      "cap_must_preserve_priority_target_coverage",
      "cap_must_not_make_lagging_muscles_worse",
      "cap_must_not_hide_under_delivery_by_suppressing_planned_work",
      "cap_must_distinguish_plan_bloat_from_user_non_adherence",
      "cap_must_preserve_successful_progression_where_possible",
    ],
    riskSummary: unique([
      ...input.row.knownRisks,
      "skipped_sets_may_reflect_schedule_or_adherence_not_plan_bloat",
      "cap_requires_hard_week_effort_and_skipped_set_evidence",
      "cap_requires_projection_diff_before_behavior",
    ]).slice(0, 8),
  };
}

function buildStrategyHypothesisPromotionDiff(input: {
  strategyInput?: V2MesocycleStrategyInput;
  strategyHypothesisPromotionReadiness: V2StrategyHypothesisPromotionReadiness;
  strategyShadowProjection?: V2StrategyHypothesisShadowProjectionEvidence;
  preShadowCandidateFilter?: V2StrategyHypothesisPreShadowCandidateFilter;
}): V2StrategyHypothesisPromotionDiff {
  const blockSignals = input.strategyInput?.blockResponseSignals ?? [];
  const readyRows = readyPromotionDiffRows(
    input.strategyHypothesisPromotionReadiness,
  ).slice(0, 2);
  const rowById = new Map(readyRows.map((row) => [row.hypothesisId, row]));
  const protectLaggingMusclesEarlier = buildProtectLaggingPromotionDiff({
    row: rowById.get("protect_lagging_muscles_earlier"),
    blockSignals,
  });
  const capLateBlockVolume = buildCapLateBlockPromotionDiff({
    row: rowById.get("cap_late_block_volume"),
    blockSignals,
  });
  const evaluatesBoth =
    protectLaggingMusclesEarlier.status !== "not_evaluated" &&
    capLateBlockVolume.status !== "not_evaluated";
  const evaluatedHypotheses =
    readyRows
      .map((row) => row.hypothesisId)
      .filter(
        (hypothesisId) =>
          (hypothesisId === "protect_lagging_muscles_earlier" &&
            protectLaggingMusclesEarlier.status !== "not_evaluated") ||
          (hypothesisId === "cap_late_block_volume" &&
            capLateBlockVolume.status !== "not_evaluated"),
      ) as V2StrategyHypothesisPromotionDiffHypothesisId[];
  const hasTargetedRows =
    input.strategyHypothesisPromotionReadiness.hypothesisReadiness.some(
      (row) => isPromotionDiffHypothesisId(row.hypothesisId),
    );
  const donorSurplusEvidence = buildV2DonorSurplusEvidence({
    evaluatesCombinedPair: evaluatesBoth,
    candidateProtectedMuscles: sortedEvidenceMuscles(
      collectTargetTierUnderHitEntries(blockSignals),
    ),
    candidateDonorMuscles: collectRedistributionDonorEntries(blockSignals).map(
      (entry) => entry.muscle,
    ),
    blockSignals,
    baseCoverageRows: input.strategyShadowProjection?.before.donorMuscleCoverage,
    preShadowCandidateFilter: input.preShadowCandidateFilter,
  });
  const projectionDiff = buildStrategyHypothesisProjectionDiff({
    evaluatedHypotheses,
    protectLaggingMusclesEarlier,
    capLateBlockVolume,
    blockSignals,
    strategyShadowProjection: input.strategyShadowProjection,
    preShadowCandidateFilter: input.preShadowCandidateFilter,
  });
  const slotOwnedDemandAdjustmentPlan = buildSlotOwnedDemandAdjustmentPlan({
    evaluatedHypotheses,
    protectLaggingMusclesEarlier,
    capLateBlockVolume,
    blockSignals,
    preShadowCandidateFilter: input.preShadowCandidateFilter,
    donorSurplusEvidence,
  });

  return {
    version: 1,
    source: "v2_strategy_hypothesis_promotion_diff",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    status:
      evaluatedHypotheses.length > 0
        ? "available_with_limitations"
        : "not_available",
    evaluatedHypotheses,
    protectLaggingMusclesEarlier,
    capLateBlockVolume,
    interactionRisk: {
      status: evaluatesBoth ? "available_with_limitations" : "not_evaluated",
      risks: evaluatesBoth
        ? [
            "lagging_muscle_protection_may_require_more_allocated_work",
            "late_block_volume_cap_may_require_less_total_expansion",
            "both_hypotheses_can_conflict_without_redistribution_policy",
          ]
        : [],
      requiredJointGuards: evaluatesBoth
        ? [
            "prefer_redistribution_from_over_concentrated_or_fatigue_driver_muscles_before_adding_net_new_late_block_volume",
          ]
        : [],
    },
    projectionDiff,
    donorSurplusEvidence,
    slotOwnedDemandAdjustmentPlan,
    nonRegressionGates: emptyNonRegressionGates(),
    nextSafeAction:
      projectionDiff.readiness === "ready_for_read_only_shadow_trial"
        ? "run_read_only_shadow_trial"
        : evaluatedHypotheses.length > 0
          ? "add_read_only_projection_diff"
        : hasTargetedRows
          ? "collect_more_evidence"
          : "do_not_promote",
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
  const responseEvidenceSummary = buildResponseEvidenceSummary(
    input.strategyInput,
    strategyInputSummary,
  );
  const continuityVariationEvidence = buildContinuityVariationEvidence(
    input.strategyInput,
  );
  const volumeFatigueStrategyEvidence = buildVolumeFatigueStrategyEvidence(
    input.strategyInput,
  );
  const strategyRecommendation = buildStrategyRecommendation(
    input.strategyInput,
    strategyInputSummary,
  );
  const strategyHypothesisPromotionReadiness =
    buildStrategyHypothesisPromotionReadiness({
      strategyRecommendation,
      strategyInputSummary,
      continuityVariationEvidence,
      volumeFatigueStrategyEvidence,
    });
  const strategyHypothesisPromotionDiff =
    buildStrategyHypothesisPromotionDiff({
      strategyInput: input.strategyInput,
      strategyHypothesisPromotionReadiness,
      strategyShadowProjection: input.strategyShadowProjection,
      preShadowCandidateFilter: input.preShadowCandidateFilter,
    });
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
    responseEvidenceSummary,
    continuityVariationPolicy: {
      currentSupport:
        continuityVariationEvidence.status === "not_available"
          ? "partial"
          : "available_with_limitations",
      keepSignals: [
        "carry_forward_recommendations_with_signal_quality",
        "accepted_seed_identity_continuity",
        "v2_materializer_continuity_hints",
        ...(continuityVariationEvidence.keepCandidateCount > 0
          ? ["strategy_input:response_ranked_keep_candidates"]
          : []),
      ],
      rotateSignals: [
        "duplicate_policy_requires_clean_alternative_review",
        "materializer_can_express_class_level_variation_but_not_response_ranked_rotation",
        ...(continuityVariationEvidence.rotateCandidateCount > 0
          ? ["strategy_input:response_ranked_rotate_candidates"]
          : []),
      ],
      missingSignals: [
        ...(continuityVariationEvidence.status === "not_available"
          ? ["block_level_keep_rotate_replace_classification"]
          : []),
        "staleness_and_tolerance_thresholds",
        ...(responseEvidenceSummary.usableForFutureMaterializerRanking
          ? []
          : ["performance_response_and_sfr_ranked_materializer_inputs"]),
        "strategy_derived_novelty_pressure_by_lane",
      ],
    },
    continuityVariationEvidence,
    volumeFatigueStrategyEvidence,
    strategyRecommendation,
    strategyHypothesisPromotionReadiness,
    strategyHypothesisPromotionDiff,
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
