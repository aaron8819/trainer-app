import type { MuscleTargetTier } from "@/lib/engine/volume-landmarks";
import type { V2SetDistributionIntent } from "./set-distribution-intent";
import type { V2SupportLanePolicy } from "./support-lane-policy";

export type V2PlannerSlotId = "upper_a" | "lower_a" | "upper_b" | "lower_b";

export type V2PlannerSplit = "upper_lower_4x";

export type V2PlannerPhase =
  | "entry_calibration"
  | "accumulation"
  | "hard_accumulation"
  | "peak_overreach_lite"
  | "deload";

export type V2PlannerLaneRole = "anchor" | "support" | "accessory" | "optional";

export type V2PlannerProgressionIntent =
  | "establish_anchors"
  | "productive_volume"
  | "push_stimulus"
  | "peak_effort"
  | "reduce_fatigue";

export type V2PlannerLaneDefinition = {
  laneId: string;
  targetLaneId?: string;
  required: boolean;
  role: V2PlannerLaneRole;
  primaryMuscles: string[];
  preferredExerciseClasses: string[];
  targetSets: {
    min: number;
    preferred: number;
    max: number;
  };
};

export type V2PlannerSlotDefinition = {
  slotId: V2PlannerSlotId;
  intent: string;
  targetSessionSets: {
    min: number;
    max: number;
  };
  lanes: V2PlannerLaneDefinition[];
};

export type V2TargetSkeleton = {
  split: V2PlannerSplit;
  weeks: 5;
  slotSequence: V2PlannerSlotId[];
  slots: V2PlannerSlotDefinition[];
};

export type V2WeeklyProgressionWeek = {
  week: number;
  phase: V2PlannerPhase;
  volumeMultiplier: number | null;
  rirTarget: string;
  progressionIntent: V2PlannerProgressionIntent;
  limitations: string[];
};

export type V2WeeklyProgressionModel = {
  weeks: V2WeeklyProgressionWeek[];
};

export type V2DeloadTransformPolicy = {
  preserveExerciseIdentities: boolean;
  targetVolumeReductionPercent: {
    min: number;
    max: number;
  };
  targetRir: string;
  removeRedundantAccessories: boolean;
  introduceNewMovements: false;
  projectionStatus: "modeled" | "partially_modeled" | "not_yet_projected";
  limitations: string[];
};

export type V2PlannerMesocyclePolicy = {
  mesocycleStrategyDiagnostic: V2MesocycleStrategyDiagnostic;
  targetSkeleton: V2TargetSkeleton;
  weeklyProgressionModel: V2WeeklyProgressionModel;
  deloadTransform: V2DeloadTransformPolicy;
  mesocycleDemand: V2MesocycleDemand;
  weeklyDemandCurve: V2WeeklyDemandCurve;
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
  exerciseClassDistributionBySlot: V2ExerciseClassDistributionBySlot;
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2SupportLanePolicy: V2SupportLanePolicy;
  selectionCapacityPlan: V2SelectionCapacityPlan;
  exerciseSelectionPlan: V2ExerciseSelectionPlan;
};

export type V2MesocycleStrategyPhase =
  | "balanced_hypertrophy"
  | "accumulation"
  | "specialization"
  | "maintenance"
  | "resensitization"
  | "recovery_biased"
  | "strength_biased_hypertrophy"
  | "return_to_training"
  | "unknown";

export type V2MesocycleStrategyConfidence = "low" | "medium" | "high";

export type V2MesocycleStrategyEvidenceStatus =
  | "not_available"
  | "available_with_limitations"
  | "available";

export type V2MesocycleStrategyRecommendationHypothesisId =
  | "protect_lagging_muscles_earlier"
  | "cap_late_block_volume"
  | "reduce_overlap_fatigue"
  | "preserve_successful_progression"
  | "improve_deload_execution"
  | "rotate_low_confidence_or_stale_accessories"
  | "maintain_balanced_hypertrophy"
  | "unknown";

export type V2MesocycleStrategyRecommendationInfluenceTarget =
  | "MesocycleStrategy"
  | "MesocycleDemand"
  | "WeeklyDemandCurve"
  | "SlotDemandAllocation"
  | "ExerciseClassDistribution"
  | "SetDistributionIntent"
  | "ExerciseSelectionStrategy"
  | "MaterializerRanking"
  | "DeloadPlan"
  | "RuntimeUX";

export type V2MesocycleStrategyRecommendationMustNotYetInfluence =
  | "generation"
  | "selection"
  | "repair"
  | "seed"
  | "runtime"
  | "receipts";

export type V2MesocycleStrategyRecommendation = {
  version: 1;
  source: "v2_mesocycle_strategy_recommendation";
  readOnly: true;
  affectsScoringOrGeneration: false;
  status: V2MesocycleStrategyEvidenceStatus;
  recommendedPhase: V2MesocycleStrategyPhase;
  confidence: V2MesocycleStrategyConfidence;
  hypotheses: Array<{
    id: V2MesocycleStrategyRecommendationHypothesisId;
    readOnly: true;
    affectsScoringOrGeneration: false;
    priority: "P0" | "P1" | "P2";
    confidence: V2MesocycleStrategyConfidence;
    evidence: string[];
    wouldEventuallyInfluence: V2MesocycleStrategyRecommendationInfluenceTarget[];
    mustNotYetInfluence: V2MesocycleStrategyRecommendationMustNotYetInfluence[];
    promotionBlockers: string[];
  }>;
  limitations: string[];
};

export type V2StrategyHypothesisPromotionReadinessStatus =
  | "not_ready"
  | "partially_ready"
  | "ready_for_bounded_trial";

export type V2StrategyHypothesisPromotionReadinessLevel =
  | "not_ready"
  | "needs_more_evidence"
  | "needs_owner"
  | "needs_non_regression_gates"
  | "ready_for_read_only_diff"
  | "ready_for_bounded_trial";

export type V2StrategyHypothesisPromotionReadinessOwner =
  | V2MesocycleStrategyRecommendationInfluenceTarget
  | "unknown";

export type V2StrategyHypothesisPromotionReadinessNextSafeAction =
  | "collect_more_evidence"
  | "add_read_only_diff"
  | "add_audit_gate"
  | "run_bounded_trial"
  | "do_not_promote";

export type V2StrategyHypothesisPromotionReadiness = {
  version: 1;
  source: "v2_strategy_hypothesis_promotion_readiness";
  readOnly: true;
  affectsScoringOrGeneration: false;
  status: V2StrategyHypothesisPromotionReadinessStatus;
  hypothesisReadiness: Array<{
    hypothesisId: V2MesocycleStrategyRecommendationHypothesisId;
    readiness: V2StrategyHypothesisPromotionReadinessLevel;
    proposedOwner: V2StrategyHypothesisPromotionReadinessOwner;
    boundedBehaviorScope?: string;
    requiredEvidence: string[];
    missingEvidence: string[];
    requiredNonRegressionGates: string[];
    knownRisks: string[];
    rollbackCriteria: string[];
    nextSafeAction: V2StrategyHypothesisPromotionReadinessNextSafeAction;
  }>;
  globalBlockers: string[];
  limitations: string[];
};

export type V2StrategyHypothesisPromotionDiffStatus =
  | "not_available"
  | "available_with_limitations"
  | "available";

export type V2StrategyHypothesisPromotionDiffRowStatus =
  | "not_evaluated"
  | "available_with_limitations"
  | "available";

export type V2StrategyHypothesisPromotionDiffHypothesisId =
  | "protect_lagging_muscles_earlier"
  | "cap_late_block_volume";

export type V2StrategyHypothesisProjectionDeltaStatus =
  | "improves"
  | "preserved"
  | "worsens"
  | "unknown";

export type V2StrategyHypothesisProjectionGateStatus =
  | "pass"
  | "fail"
  | "unknown";

export type V2StrategyHypothesisProjectionCoverageRow = {
  muscle: string;
  status: "covered" | "below_minimum" | "above_maximum" | "unknown";
  sets?: number;
  minSets?: number;
  preferredSets?: number;
  maxSets?: number;
  priority?: "primary" | "support" | "secondary" | "implicit";
  targetTier?: string;
};

export type V2StrategyHypothesisProjectionCoverageSummary = {
  coveredCount: number;
  belowMinimumCount: number;
  aboveMaximumCount: number;
  unknownCount: number;
  totalCount: number;
  examples: string[];
};

export type V2StrategyHypothesisProjectionMetricSummary = {
  count: number;
  summary: string[];
  totalSets?: number;
  maxSlotSets?: number;
};

export type V2StrategyHypothesisPreShadowCandidateFilterStatus =
  | "not_available"
  | "available_with_limitations"
  | "available";

export type V2StrategyHypothesisPreShadowDonorReason =
  | "safe_surplus_margin"
  | "protected_overlap"
  | "below_floor"
  | "at_floor"
  | "insufficient_margin"
  | "unknown_floor_margin"
  | "slot_incompatible"
  | "concentration_risk"
  | "unknown";

export type V2StrategyHypothesisPreShadowProtectedReason =
  | "target_tier_under_hit"
  | "slot_owner_missing"
  | "would_require_net_new_volume"
  | "unknown";

export type V2StrategyHypothesisPreShadowCandidateFilter = {
  enabled: true;
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  status: V2StrategyHypothesisPreShadowCandidateFilterStatus;
  configuration: {
    readOnly: true;
    affectsScoringOrGeneration: false;
    floorMarginSets: number;
    targetTierFloorMarginSets: number;
    netNewVolumeAllowed: false;
    maxSlotIncreaseAllowed: 0;
    redistributionRequired: true;
  };
  donorEligibility: Array<{
    muscle: string;
    eligible: boolean;
    reason: V2StrategyHypothesisPreShadowDonorReason;
    baseCoverage?: {
      sets?: number;
      floor?: number;
      margin?: number;
      status?: "below" | "covered" | "surplus" | "unknown";
    };
  }>;
  protectedEligibility: Array<{
    muscle: string;
    eligible: boolean;
    reason: V2StrategyHypothesisPreShadowProtectedReason;
  }>;
  overrideConstruction: {
    readOnly: true;
    affectsScoringOrGeneration: false;
    consumedByDemandOrMaterializer: false;
    excludedDonors: string[];
    retainedDonors: string[];
    excludedProtectedMuscles: string[];
    retainedProtectedMuscles: string[];
    netNewVolumeAllowed: false;
    maxSlotIncreaseAllowed: 0;
    redistributionRequired: true;
  };
};

export type V2DonorSurplusEvidenceStatus =
  | "not_available"
  | "available_with_limitations"
  | "available";

export type V2DonorSurplusCandidateReason =
  | "over_concentration"
  | "fatigue_driver"
  | "both"
  | "unknown";

export type V2DonorSurplusBaselineCoverageStatus =
  | "below_floor"
  | "at_floor"
  | "surplus"
  | "unknown";

export type V2DonorSurplusEligibilityReason =
  | "safe_surplus_margin"
  | "protected_overlap"
  | "below_floor"
  | "at_floor"
  | "insufficient_margin"
  | "unknown_margin"
  | "slot_incompatible"
  | "concentration_risk"
  | "fatigue_regression_risk"
  | "unknown";

export type V2DonorSurplusEvidence = {
  version: 1;
  source: "v2_donor_surplus_evidence";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  status: V2DonorSurplusEvidenceStatus;
  donorEvidence: Array<{
    muscle: string;
    targetTier?: string;
    candidateReason: V2DonorSurplusCandidateReason;
    baselineCoverage: {
      measured: boolean;
      effectiveSets?: number;
      floorSets?: number;
      preferredSets?: number;
      surplusAboveFloor?: number;
      safetyMarginRequired?: number;
      status: V2DonorSurplusBaselineCoverageStatus;
    };
    protectedConflict: {
      isProtectedMuscle: boolean;
      requiresSurplusProof: boolean;
    };
    slotOwnership: {
      candidateSlotOwners: string[];
      compatible: boolean;
      limitations: string[];
    };
    eligibility: {
      eligible: boolean;
      reason: V2DonorSurplusEligibilityReason;
      confidence: "low" | "medium" | "high";
    };
  }>;
  summary: {
    candidateCount: number;
    measuredMarginCount: number;
    eligibleCount: number;
    ineligibleCount: number;
    unknownMarginCount: number;
    protectedOverlapCount: number;
    slotIncompatibleCount: number;
    topReasons: Array<{
      reason: V2DonorSurplusEligibilityReason;
      count: number;
    }>;
  };
  limitations: string[];
};

export type V2SlotOwnedDemandAdjustmentPlanStatus =
  | "not_available"
  | "available_with_limitations"
  | "blocked"
  | "feasible";

export type V2SlotOwnedDemandAdjustmentRequiredOwner =
  | "MesocycleDemand"
  | "SlotDemandAllocation"
  | "SetDistributionIntent"
  | "unknown";

export type V2SlotOwnedDemandAdjustmentProtectedStatus =
  | "owned"
  | "missing_slot_owner"
  | "requires_net_new_volume"
  | "blocked";

export type V2SlotOwnedDemandAdjustmentDonorEligibilityReason =
  | "safe_surplus_margin"
  | "protected_overlap"
  | "below_floor"
  | "at_floor"
  | "insufficient_margin"
  | "unknown_margin"
  | "slot_incompatible"
  | "concentration_risk"
  | "fatigue_regression_risk"
  | "not_target_policy";

export type V2SlotOwnedDemandAdjustmentPlan = {
  version: 1;
  source: "v2_slot_owned_demand_adjustment_plan";
  readOnly: true;
  affectsScoringOrGeneration: false;
  status: V2SlotOwnedDemandAdjustmentPlanStatus;
  objective: {
    readOnly: true;
    affectsScoringOrGeneration: false;
    protectLaggingTargetTierMuscles: boolean;
    capLateBlockVolume: boolean;
    preferRedistributionBeforeNetNewVolume: true;
  };
  protectedDemand: Array<{
    muscle: string;
    reason: string;
    targetTier: string;
    priority: "P0" | "P1" | "P2";
    requiredOwner: V2SlotOwnedDemandAdjustmentRequiredOwner;
    candidateSlotOwners: string[];
    status: V2SlotOwnedDemandAdjustmentProtectedStatus;
  }>;
  donorDemand: Array<{
    muscle: string;
    reason: string;
    eligible: boolean;
    eligibilityReason: V2SlotOwnedDemandAdjustmentDonorEligibilityReason;
    candidateSlotOwners: string[];
  }>;
  slotBudgetPolicy: {
    readOnly: true;
    affectsScoringOrGeneration: false;
    netNewVolumeAllowed: false;
    maxSlotIncreaseAllowed: 0;
    requireSlotOwnership: true;
    requireFloorPreservation: true;
    requirePriorityCoveragePreservation: true;
  };
  feasibility: {
    readOnly: true;
    affectsScoringOrGeneration: false;
    status: "feasible" | "blocked" | "unknown";
    blockingReasons: string[];
    unresolvedInputs: string[];
    nextRequiredEvidence: string[];
  };
  nextSafeAction:
    | "collect_more_evidence"
    | "add_strategy_to_demand_diff"
    | "do_not_promote";
};

export type V2StrategyHypothesisConflictAwareRefinementStatus =
  | "not_available"
  | "available_with_limitations"
  | "available";

export type V2StrategyHypothesisConflictAwareConflictType =
  | "protected_donor_overlap"
  | "floor_preservation_conflict"
  | "slot_owner_missing"
  | "session_size_cap_conflict"
  | "net_new_volume_blocked"
  | "unknown";

export type V2StrategyHypothesisConflictAwareConflict = {
  type: V2StrategyHypothesisConflictAwareConflictType;
  muscle?: string;
  slotId?: string;
  reason: string;
};

export type V2StrategyHypothesisConflictAwareRefinement = {
  enabled: true;
  readOnly: true;
  affectsScoringOrGeneration: false;
  status: V2StrategyHypothesisConflictAwareRefinementStatus;
  conflicts: V2StrategyHypothesisConflictAwareConflict[];
  conflictCountsByType: Partial<
    Record<V2StrategyHypothesisConflictAwareConflictType, number>
  >;
  donorResolution: {
    excludedDonorMuscles: string[];
    retainedDonorMuscles: string[];
    reasonByMuscle: Record<string, string>;
  };
  volumePolicy: {
    netNewVolumeAllowed: false;
    redistributionRequired: true;
    maxSlotSetIncreaseAllowed: 0;
  };
};

export type V2StrategyHypothesisShadowProjectionSnapshot = {
  priorityCoverage?: V2StrategyHypothesisProjectionCoverageSummary;
  laggingMuscleCoverage?: V2StrategyHypothesisProjectionCoverageRow[];
  donorMuscleCoverage?: V2StrategyHypothesisProjectionCoverageRow[];
  sessionSize?: {
    totalSetsBySlot: Record<string, number>;
  };
  concentration?: V2StrategyHypothesisProjectionMetricSummary;
  repairPressure?: {
    materialRepairCount: number;
    majorRepairCount: number;
    suspiciousRepairCount: number;
  };
  dirtyCollateral?: V2StrategyHypothesisProjectionMetricSummary;
  forbiddenSlotRisk?: V2StrategyHypothesisProjectionMetricSummary;
  lateBlockFatigueRisk?: V2StrategyHypothesisProjectionMetricSummary;
};

export type V2StrategyHypothesisShadowProjectionEvidence = {
  version: 1;
  source: "v2_strategy_hypothesis_shadow_projection";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  projectionMode: "shadow_projection";
  candidateHypotheses: V2StrategyHypothesisPromotionDiffHypothesisId[];
  baselineProjection: "planner_only_no_repair";
  candidateProjection: "combined_strategy_shadow_planner_only_no_repair";
  candidateStrategy: {
    candidateProtectedMuscles: string[];
    candidateDonorMuscles: string[];
    protectedSlotOwners?: Record<string, string[]>;
    preferRedistributionBeforeNetNewVolume: true;
  };
  before: V2StrategyHypothesisShadowProjectionSnapshot;
  after: V2StrategyHypothesisShadowProjectionSnapshot;
  limitations: string[];
};

export type V2StrategyHypothesisProjectionDiff = {
  version: 1;
  source: "v2_strategy_hypothesis_projection_diff";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  status: V2StrategyHypothesisPromotionDiffStatus;
  evaluatedHypotheses: V2StrategyHypothesisPromotionDiffHypothesisId[];
  projectionMode: "read_only_estimate" | "shadow_projection" | "not_projected";
  candidateStrategy: {
    laggingMuscleProtection: {
      muscles: string[];
      proposedMechanism:
        | "redistribute_sets"
        | "early_slot_owned_support"
        | "direct_floor_protection"
        | "unknown";
    };
    lateBlockVolumeCap: {
      proposedMechanism:
        | "hard_week_expansion_cap"
        | "session_size_cap"
        | "set_bump_budget_cap"
        | "unknown";
    };
    redistributionPreference: {
      preferRedistributionBeforeNetNewVolume: true;
      candidateDonorMuscles: string[];
      candidateProtectedMuscles: string[];
    };
  };
  projectedDeltas: {
    priorityCoverage: {
      before?: V2StrategyHypothesisProjectionCoverageSummary;
      after?: V2StrategyHypothesisProjectionCoverageSummary;
      status: V2StrategyHypothesisProjectionDeltaStatus;
      notes: string[];
    };
    laggingMuscleCoverage: {
      before?: V2StrategyHypothesisProjectionCoverageRow[];
      after?: V2StrategyHypothesisProjectionCoverageRow[];
      status: V2StrategyHypothesisProjectionDeltaStatus;
      examples: string[];
    };
    sessionSize: {
      beforeTotalSetsBySlot?: Record<string, number>;
      afterTotalSetsBySlot?: Record<string, number>;
      status: V2StrategyHypothesisProjectionDeltaStatus;
      notes: string[];
    };
    concentration: {
      before?: V2StrategyHypothesisProjectionMetricSummary;
      after?: V2StrategyHypothesisProjectionMetricSummary;
      status: V2StrategyHypothesisProjectionDeltaStatus;
      notes: string[];
    };
    repairPressure: {
      beforeMaterialRepairCount?: number;
      afterMaterialRepairCount?: number;
      materialRepairDelta?: number;
      beforeMajorRepairCount?: number;
      afterMajorRepairCount?: number;
      majorRepairDelta?: number;
      beforeSuspiciousRepairCount?: number;
      afterSuspiciousRepairCount?: number;
      suspiciousRepairDelta?: number;
      status: V2StrategyHypothesisProjectionDeltaStatus;
      notes: string[];
    };
    dirtyCollateral: {
      before?: V2StrategyHypothesisProjectionMetricSummary;
      after?: V2StrategyHypothesisProjectionMetricSummary;
      status: V2StrategyHypothesisProjectionDeltaStatus;
      notes: string[];
    };
    forbiddenSlotRisk: {
      before?: V2StrategyHypothesisProjectionMetricSummary;
      after?: V2StrategyHypothesisProjectionMetricSummary;
      status: V2StrategyHypothesisProjectionDeltaStatus;
      notes: string[];
    };
    lateBlockFatigueRisk: {
      before?: V2StrategyHypothesisProjectionMetricSummary;
      after?: V2StrategyHypothesisProjectionMetricSummary;
      status: V2StrategyHypothesisProjectionDeltaStatus;
      notes: string[];
    };
  };
  shadowProjection?: V2StrategyHypothesisShadowProjectionEvidence;
  preShadowCandidateFilter: V2StrategyHypothesisPreShadowCandidateFilter;
  conflictAwareRefinement: V2StrategyHypothesisConflictAwareRefinement;
  computedNonRegressionGates: {
    preservePriorityCoverage: V2StrategyHypothesisProjectionGateStatus;
    preserveOrImproveLaggingMuscleCoverage: V2StrategyHypothesisProjectionGateStatus;
    noMaterialRepairIncrease: V2StrategyHypothesisProjectionGateStatus;
    noMajorRepairIncrease: V2StrategyHypothesisProjectionGateStatus;
    noSuspiciousRepairIncrease: V2StrategyHypothesisProjectionGateStatus;
    noDirtyCollateralIncrease: V2StrategyHypothesisProjectionGateStatus;
    noForbiddenSlotWorkaround: V2StrategyHypothesisProjectionGateStatus;
    noSessionSizeRegression: V2StrategyHypothesisProjectionGateStatus;
    noConcentrationRegression: V2StrategyHypothesisProjectionGateStatus;
    noLateBlockSkippedSetRiskIncrease: V2StrategyHypothesisProjectionGateStatus;
  };
  readiness:
    | "not_ready"
    | "needs_better_projection"
    | "ready_for_read_only_shadow_trial"
    | "ready_for_bounded_behavior_trial";
  limitations: string[];
};

export type V2StrategyHypothesisPromotionDiff = {
  version: 1;
  source: "v2_strategy_hypothesis_promotion_diff";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByDemandOrMaterializer: false;
  status: V2StrategyHypothesisPromotionDiffStatus;
  evaluatedHypotheses: V2StrategyHypothesisPromotionDiffHypothesisId[];
  protectLaggingMusclesEarlier: {
    status: V2StrategyHypothesisPromotionDiffRowStatus;
    targetTierMuscles: string[];
    recurringUnderHitMuscles: string[];
    proposedProtectionType:
      | "early_week_direct_sets"
      | "slot_owned_support_floor"
      | "set_redistribution"
      | "unknown";
    requiredGuards: string[];
    riskSummary: string[];
  };
  capLateBlockVolume: {
    status: V2StrategyHypothesisPromotionDiffRowStatus;
    skippedSetEvidence: {
      hardWeekSkippedSetSignal: boolean;
      examples: string[];
    };
    proposedCapType:
      | "hard_week_session_size_cap"
      | "set_bump_budget_cap"
      | "late_block_expansion_cap"
      | "unknown";
    requiredGuards: string[];
    riskSummary: string[];
  };
  interactionRisk: {
    status: V2StrategyHypothesisPromotionDiffRowStatus;
    risks: string[];
    requiredJointGuards: string[];
  };
  projectionDiff: V2StrategyHypothesisProjectionDiff;
  donorSurplusEvidence: V2DonorSurplusEvidence;
  slotOwnedDemandAdjustmentPlan: V2SlotOwnedDemandAdjustmentPlan;
  nonRegressionGates: {
    preservePriorityCoverage: boolean;
    preserveOrImproveLaggingMuscleCoverage: boolean;
    noMaterialRepairIncrease: boolean;
    noMajorRepairIncrease: boolean;
    noSuspiciousRepairIncrease: boolean;
    noDirtyCollateralIncrease: boolean;
    noForbiddenSlotWorkaround: boolean;
    noSessionSizeRegression: boolean;
    noConcentrationRegression: boolean;
    noLateBlockSkippedSetRiskIncrease: boolean;
  };
  nextSafeAction:
    | "add_read_only_projection_diff"
    | "run_read_only_shadow_trial"
    | "collect_more_evidence"
    | "do_not_promote";
};

export type V2ResponseTrend = "stable" | "rising" | "falling" | "unknown";

export type V2BlockStrategyImplication =
  | "protect_lagging_muscles_earlier"
  | "cap_late_block_volume"
  | "reduce_axial_or_overlap_fatigue"
  | "preserve_successful_progression"
  | "improve_deload_execution"
  | "unknown";

export type V2BlockResponseSignal = {
  mesocycleId: string;
  sourcePlanner: "legacy_projection" | "v2" | "unknown";
  adherence: {
    completedSessions?: number;
    partialSessions?: number;
    skippedSessions?: number;
    skippedSetCount?: number;
    skippedSetTrend?: V2ResponseTrend;
  };
  effortProgression: {
    averageRpeByWeek?: Array<{ week: number; averageRpe: number }>;
    hardWeekEffortReached?: boolean;
    deloadExecuted?: boolean;
  };
  muscleDistribution: {
    recurringUnderHitMuscles?: string[];
    recurringOverConcentratedMuscles?: string[];
    belowMevFlags?: string[];
    overMavFlags?: string[];
  };
  fatigueDistribution: {
    systemicFatigueFlag?: boolean;
    likelyFatigueDrivers?: string[];
    evidence: string[];
  };
  strategyImplications: V2BlockStrategyImplication[];
  confidence: V2MesocycleStrategyConfidence;
};

export type V2ExerciseResponseSignalType =
  | "progressed"
  | "stalled"
  | "regressed"
  | "skipped_often"
  | "swapped_out"
  | "pain_or_tolerance_issue"
  | "high_fatigue_cost"
  | "low_confidence"
  | "unknown";

export type V2ExerciseResponseSignal = {
  exerciseId?: string;
  exerciseName?: string;
  muscleTargets?: string[];
  slotIds?: string[];
  signal: V2ExerciseResponseSignalType;
  evidence: {
    mesocycleIds: string[];
    completedExposureCount?: number;
    skippedExposureCount?: number;
    swappedExposureCount?: number;
    loadTrend?: V2ResponseTrend;
    repTrend?: V2ResponseTrend;
    rpeTrend?: V2ResponseTrend;
    notes?: string[];
  };
  confidence: V2MesocycleStrategyConfidence;
};

export type V2MesocycleStrategyInputGroup =
  | "userProfile"
  | "currentTrainingContext"
  | "historicalMesocycles"
  | "readinessAndRecoverySignals";

export type V2MesocycleStrategyInput = {
  version: 1;
  userProfile: {
    trainingGoal?: string;
    trainingAge?: "unknown" | "beginner" | "intermediate" | "advanced";
    availableTrainingDays?: number;
    equipmentProfile?: string[];
    constraints?: string[];
    preferences?: string[];
    painOrToleranceFlags?: string[];
    confidence: V2MesocycleStrategyConfidence;
  };
  currentTrainingContext: {
    split?: "upper_lower" | "unknown";
    currentPhase?: string;
    currentMesocycleStatus?: string;
    weekCount?: number;
    slotSequence?: string[];
    volumeTarget?: string;
    intensityBias?: string;
  };
  historicalMesocycles: Array<{
    mesocycleId: string;
    sourcePlanner: "legacy_projection" | "v2" | "unknown";
    status?: string;
    startedAt?: string;
    completedAt?: string;
    adherenceSummary?: {
      plannedSessions?: number;
      completedSessions?: number;
      partialSessions?: number;
      skippedSessions?: number;
    };
    performedVolumeSummary?: Array<{
      muscle: string;
      plannedSets?: number;
      performedSets?: number;
      targetRange?: string;
      status?: "under" | "within" | "over" | "unknown";
    }>;
    performanceSignals?: Array<{
      exerciseId?: string;
      exerciseName?: string;
      signal:
        | "progressed"
        | "stalled"
        | "regressed"
        | "skipped_often"
        | "swapped_out"
        | "pain_or_tolerance_issue"
        | "high_fatigue_cost"
        | "low_confidence"
        | "unknown";
      confidence: V2MesocycleStrategyConfidence;
    }>;
  }>;
  blockResponseSignals: V2BlockResponseSignal[];
  exerciseResponseSignals: V2ExerciseResponseSignal[];
  readinessAndRecoverySignals: {
    available: string[];
    missing: string[];
    fatigueFlags?: string[];
    painFlags?: string[];
    adherenceFlags?: string[];
  };
  evidenceLimitations: string[];
};

export type V2MesocycleStrategyDiagnostic = {
  version: 1;
  source: "v2_mesocycle_strategy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  status: "available_with_limitations" | "missing_inputs" | "not_available";
  userTrainingProfileInputs: {
    available: string[];
    missing: string[];
    limitations: string[];
  };
  phaseStrategy: {
    proposedPhase: V2MesocycleStrategyPhase;
    classificationStatus: "unknown";
    rationale: string[];
    confidence: V2MesocycleStrategyConfidence;
  };
  mesocycleObjective: {
    objective: string;
    classificationStatus: "unknown";
    specializationTargets: string[];
    maintenanceTargets: string[];
    recoveryBiases: string[];
    rationale: string[];
  };
  performedHistorySignals: {
    available: string[];
    missing: string[];
    candidateFutureSignals: string[];
  };
  responseEvidenceSummary: {
    blockResponseSignalCount: number;
    strategyImplicationCounts: Record<V2BlockStrategyImplication, number>;
    recurringUnderHitMuscleExamples: string[];
    recurringOverConcentrationExamples: string[];
    exerciseResponseSignalCount: number;
    exerciseSignalsByType: Record<V2ExerciseResponseSignalType, number>;
    confidenceDistribution: Record<V2MesocycleStrategyConfidence, number>;
    evidenceLimitations: string[];
    usableForFutureContinuityVariation: boolean;
    usableForFutureMaterializerRanking: boolean;
    usableForFutureVolumeFatigueStrategy: boolean;
  };
  continuityVariationPolicy: {
    currentSupport: "none" | "partial" | "available_with_limitations";
    keepSignals: string[];
    rotateSignals: string[];
    missingSignals: string[];
  };
  continuityVariationEvidence: {
    status: V2MesocycleStrategyEvidenceStatus;
    keepCandidateCount: number;
    rotateCandidateCount: number;
    avoidCandidateCount: number;
    lowConfidenceCount: number;
    limitations: string[];
  };
  volumeFatigueStrategyEvidence: {
    status: V2MesocycleStrategyEvidenceStatus;
    protectLaggingMuscleSignals: string[];
    overConcentrationSignals: string[];
    lateBlockFatigueSignals: string[];
    deloadExecutionSignals: string[];
    limitations: string[];
  };
  strategyRecommendation: V2MesocycleStrategyRecommendation;
  strategyHypothesisPromotionReadiness: V2StrategyHypothesisPromotionReadiness;
  strategyHypothesisPromotionDiff: V2StrategyHypothesisPromotionDiff;
  demandDerivationPlan: {
    currentDemandSource: "fixed_skeleton_lanes" | "strategy_derived" | "mixed";
    targetDemandSource: "mesocycle_strategy";
    gapsBeforeStrategyDerivedDemand: string[];
  };
  strategyInputSummary: {
    version: 1;
    readOnly: true;
    affectsScoringOrGeneration: false;
    inputContractVersion: 1 | null;
    presentGroups: V2MesocycleStrategyInputGroup[];
    missingGroups: V2MesocycleStrategyInputGroup[];
    historicalMesocycleCount: number;
    historicalSourcePlanners: Array<
      V2MesocycleStrategyInput["historicalMesocycles"][number]["sourcePlanner"]
    >;
    historicalSourcePlannerCounts: Record<
      V2MesocycleStrategyInput["historicalMesocycles"][number]["sourcePlanner"],
      number
    >;
    blockResponseSignalCount: number;
    exerciseResponseSignalCount: number;
    evidenceCategoriesAvailable: string[];
    evidenceCategoriesMissing: string[];
    performedHistoryEvidenceLoaded: boolean;
    prescribedPlanShapeExcludedFromStrategyPolicy: true;
    phaseClassificationStatus: "unknown";
    objectiveClassificationStatus: "unknown";
    confidenceChange:
      | "not_evaluated_no_input"
      | "stays_low_missing_evidence"
      | "eligible_for_medium_evidence";
    evidenceLimitations: string[];
    ownerAgnostic: true;
  };
  currentStateVsNorthStarGaps: Array<{
    gap: string;
    currentOwner?: string;
    targetOwner: string;
    priority: "P0" | "P1" | "P2";
  }>;
};

export type V2PlannerTargetStatus = "hard" | "soft" | "diagnostic";

export type V2PlannerDemandRole =
  | "primary"
  | "support"
  | "secondary"
  | "implicit";

export type V2PlannerDemandTargetMode =
  | "default"
  | "specialization"
  | "maintenance"
  | "managed_collateral";

export type V2PlannerSetRange = {
  min: number;
  preferred: number;
  max: number;
};

export type V2PlannerDirectnessPolicy = {
  directSetFloor: number;
  preferredDirectSets: number;
  collateralCreditLimit: number;
  collateralCanSatisfyFloor: boolean;
  requiredClassIntents: string[];
};

export type V2MesocycleDemand = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  split: V2PlannerSplit;
  weekCount: number;
  designBasis: {
    targetSkeleton: "upper_lower_4x_v2";
    evidencePolicy:
      | "volume_landmarks_and_target_tiers"
      | "balanced_static_block_policy_and_volume_landmarks";
    allocationTiming: "before_exercise_selection";
    demandTiming: "before_slot_allocation";
  };
  muscles: Array<{
    muscle: string;
    targetTier: MuscleTargetTier | null;
    role: V2PlannerDemandRole;
    targetStatus: V2PlannerTargetStatus;
    targetMode: V2PlannerDemandTargetMode;
    landmark: {
      mv: number;
      mev: number;
      mav: number;
      mrv: number;
    } | null;
    baselineSetRange: V2PlannerSetRange;
    exposureCount: number;
    directness: V2PlannerDirectnessPolicy;
    cautions: string[];
    source: string[];
    limitations: string[];
  }>;
  guardrails: {
    doesNotUsePlanningReality: true;
    doesNotUseNoRepairOutput: true;
    doesNotUseRepairedProjection: true;
    doesNotUseAcceptedSeed: true;
    doesNotUseRuntimeReplay: true;
  };
};

export type V2WeeklyDemandCurve = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  weeks: Array<{
    week: number;
    phase: V2PlannerPhase;
    volumeMultiplier: number;
    rirTarget: string;
    progressionIntent: V2PlannerProgressionIntent;
    projectionStatus:
      | "projected_from_mesocycle_demand"
      | "projected_from_deload_policy";
    muscles: Array<{
      muscle: string;
      targetTier: MuscleTargetTier | null;
      role: V2PlannerDemandRole;
      targetStatus: V2PlannerTargetStatus;
      targetSetRange: V2PlannerSetRange;
      exposureCount: number;
      source: string[];
      limitations: string[];
    }>;
  }>;
  guardrails: V2MesocycleDemand["guardrails"];
};

export type V2SlotDemandAllocationByWeek = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  allocationTiming: "before_exercise_selection";
  exposureOwnershipPolicy: {
    readOnly: true;
    affectsScoringOrGeneration: false;
    demandSource: "balanced_static_block_policy";
    basis: "static_upper_lower_slot_exposure_ownership";
  };
  weeks: Array<{
    week: number;
    phase: V2PlannerPhase;
    projectionStatus: "allocated_from_v2_policy";
    slots: Array<{
      slotId: V2PlannerSlotId;
      slotIndex: number;
      intent: string;
      targetSessionSets: V2PlannerSetRange;
      lanes: Array<{
        laneId: string;
        required: boolean;
        role: V2PlannerLaneRole;
        primaryMuscles: string[];
        preferredExerciseClasses: string[];
        setBudget: V2PlannerSetRange;
        allocatedMuscles: Array<{
          muscle: string;
          role: V2PlannerDemandRole;
          targetStatus: V2PlannerTargetStatus;
          targetSetRange: V2PlannerSetRange;
          demandShare: number;
          classIntent: string;
          ownershipKind:
            | "primary_exposure"
            | "support_exposure"
            | "direct_support"
            | "managed_collateral"
            | "optional_if_needed";
          allocationBasis:
            | "target_lane"
            | "slot_role_policy"
            | "weekly_demand_curve"
            | "deload_transform"
            | "static_slot_exposure_ownership"
            | "managed_collateral_fatigue_budget"
            | "optional_if_needed";
        }>;
      }>;
    }>;
  }>;
  guardrails: V2MesocycleDemand["guardrails"];
};

export type V2ExerciseClassDistributionBySlot = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  distributionTiming: "before_exercise_selection";
  weeks: Array<{
    week: number;
    phase: V2PlannerPhase;
    slots: Array<{
      slotId: V2PlannerSlotId;
      slotIndex: number;
      intent: string;
      classLanes: Array<{
        laneId: string;
        role: V2PlannerLaneRole;
        classLaneKind:
          | "owned_class_lane"
          | "support_class_lane"
          | "optional_recoverable_lane"
          | "managed_collateral_marker";
        primaryMuscles: string[];
        supportMuscles: string[];
        optionalMuscles: string[];
        managedCollateralMuscles: string[];
        classIntents: string[];
        requiredExerciseClasses: string[];
        preferredExerciseClasses: string[];
        setBudget: V2PlannerSetRange;
        allocatedTargetSetRange: V2PlannerSetRange;
        ownershipRows: Array<{
          owningSlotId: V2PlannerSlotId;
          laneId: string;
          muscle: string;
          role: V2PlannerDemandRole;
          targetStatus: V2PlannerTargetStatus;
          targetSetRange: V2PlannerSetRange;
          demandShare: number;
          classIntent: string;
          ownershipKind:
            | "primary_exposure"
            | "support_exposure"
            | "direct_support"
            | "managed_collateral"
            | "optional_if_needed";
          allocationBasis:
            | "target_lane"
            | "slot_role_policy"
            | "weekly_demand_curve"
            | "deload_transform"
            | "static_slot_exposure_ownership"
            | "managed_collateral_fatigue_budget"
            | "optional_if_needed";
          classLaneKind:
            | "owned_class_lane"
            | "support_class_lane"
            | "optional_recoverable_lane"
            | "managed_collateral_marker";
        }>;
        preferredSetSplit:
          | "single_anchor"
          | "anchor_plus_support"
          | "direct_accessory"
          | "optional_if_recoverable";
        duplicatePolicy:
          | "discourage_if_alternative_exists"
          | "block_if_clean_alternative_exists"
          | "allow_with_justification";
        source: string[];
      }>;
    }>;
  }>;
  guardrails: V2MesocycleDemand["guardrails"];
};

export type V2SelectionCapacityPlan = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  capacityTiming: "before_exercise_selection";
  weeks: Array<{
    week: number;
    phase: V2PlannerPhase;
    slots: Array<{
      slotId: V2PlannerSlotId;
      slotIndex: number;
      maxExerciseCount: number;
      targetSessionSets: V2PlannerSetRange;
      lanes: Array<{
        laneId: string;
        role: V2PlannerLaneRole;
        primaryMuscles: string[];
        preferredExerciseClasses: string[];
        targetWeeklySetRange: V2PlannerSetRange;
        setBudget: V2PlannerSetRange;
        perExerciseCap: {
          maxSetsWithoutJustification: number;
          maxDirectExercises: number;
          allowAboveFiveSetsOnlyWithJustification: boolean;
        };
        laneHeadroomPolicy: {
          preferredRequiresHeadroom: boolean;
          cleanAlternativeRequiredForExpansion: boolean;
          capAwareExpansion:
            | "not_needed"
            | "second_direct_exercise_allowed"
            | "limited_by_max_direct_exercises";
        };
        optionalActivation:
          | { type: "not_applicable" }
          | {
              type: "activate_only_if_weekly_target_below_range";
              weeklyFloorSets: number;
              requiresSlotExerciseHeadroom: true;
              requiresCleanAlternative: true;
              requiresRecoverability: true;
            };
      }>;
    }>;
  }>;
  guardrails: {
    doesNotUseSelectedIdentities: true;
    doesNotUseNoRepairOutput: true;
    doesNotUseRepairedProjection: true;
    doesNotAffectSelection: true;
    doesNotAffectRepair: true;
    doesNotAffectRuntimeReplay: true;
  };
};

export type V2ExerciseSelectionPlan = {
  version: 1;
  source: "v2_planner_policy";
  readOnly: true;
  affectsScoringOrGeneration: false;
  selectionTiming: "before_inventory_selection";
  weeks: Array<{
    week: number;
    phase: V2PlannerPhase;
    slots: Array<{
      slotId: V2PlannerSlotId;
      slotIndex: number;
      maxExerciseCount: number;
      targetSessionSets: V2PlannerSetRange;
      lanes: Array<{
        laneId: string;
        requirement: "required" | "conditional_optional" | "optional";
        role: V2PlannerLaneRole;
        classLaneKind: V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number]["classLanes"][number]["classLaneKind"];
        primaryMuscles: string[];
        supportMuscles: string[];
        optionalMuscles: string[];
        managedCollateralMuscles: string[];
        ownershipKinds: V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number]["classLanes"][number]["ownershipRows"][number]["ownershipKind"][];
        acceptableExerciseClasses: string[];
        preferredExerciseClasses: string[];
        setBudget: V2PlannerSetRange;
        setBudgetBasis: V2SetDistributionIntent["weeks"][number]["slots"][number]["lanes"][number]["setBudget"]["basis"];
        directFloor?: {
          muscle: string;
          minDirectSets: number;
          collateralCanSatisfy: false;
          requiredExerciseClasses: string[];
        };
        optionalActivation?: V2SetDistributionIntent["weeks"][number]["slots"][number]["lanes"][number]["optionalActivation"];
        duplicatePolicy: {
          scope: "same_slot" | "same_week" | "across_accumulation";
          classDistinctness:
            | "required_if_clean_alternative_exists"
            | "preferred";
          sameExerciseAllowedOnlyWithJustification: boolean;
        };
        cleanAlternativePolicy: {
          requiredBeforeDuplicate: boolean;
          evaluationTiming: "future_inventory_selection";
        };
        perExerciseCap: {
          maxSetsWithoutJustification: number;
          maxDirectExercises: number;
          allowAboveFiveSetsOnlyWithJustification: boolean;
        };
        continuityPolicy: {
          preserve: "lane_class" | "lane_role";
          exactIdentityPolicy: "not_planned_until_inventory_selection";
          crossWeekVariation:
            | "stable_class_preferred"
            | "variation_allowed_within_class";
        };
      }>;
    }>;
  }>;
  guardrails: {
    doesNotUseSelectedIdentities: true;
    doesNotUseExerciseInventory: true;
    doesNotUseNoRepairOutput: true;
    doesNotUseRepairedProjection: true;
    doesNotAffectSelection: true;
    doesNotAffectRepair: true;
    doesNotAffectSeedSerialization: true;
    doesNotAffectRuntimeReplay: true;
  };
};

export type MesocycleDemand = V2MesocycleDemand;
export type WeeklyDemandCurve = V2WeeklyDemandCurve;
export type SlotDemandAllocationByWeek = V2SlotDemandAllocationByWeek;
export type ExerciseClassDistributionBySlot = V2ExerciseClassDistributionBySlot;
export type SelectionCapacityPlan = V2SelectionCapacityPlan;
export type ExerciseSelectionPlan = V2ExerciseSelectionPlan;
