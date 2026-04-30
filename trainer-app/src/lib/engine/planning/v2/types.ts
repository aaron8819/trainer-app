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

export type V2PlannerSetRange = {
  min: number;
  preferred: number;
  max: number;
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
    evidencePolicy: "volume_landmarks_and_target_tiers";
    allocationTiming: "before_exercise_selection";
  };
  muscles: Array<{
    muscle: string;
    targetTier: MuscleTargetTier | null;
    role: V2PlannerDemandRole;
    targetStatus: V2PlannerTargetStatus;
    landmark: {
      mv: number;
      mev: number;
      mav: number;
      mrv: number;
    } | null;
    baselineSetRange: V2PlannerSetRange;
    exposureCount: number;
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
          allocationBasis:
            | "target_lane"
            | "slot_role_policy"
            | "weekly_demand_curve"
            | "deload_transform";
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
        primaryMuscles: string[];
        requiredExerciseClasses: string[];
        preferredExerciseClasses: string[];
        setBudget: V2PlannerSetRange;
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
        primaryMuscles: string[];
        acceptableExerciseClasses: string[];
        preferredExerciseClasses: string[];
        setBudget: V2PlannerSetRange;
        directFloor?: {
          muscle: string;
          minDirectSets: number;
          collateralCanSatisfy: false;
        };
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
