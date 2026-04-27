import type { WorkoutSessionIntent } from "@prisma/client";
import type {
  MuscleTargetTier,
  VolumeSoftTargetRange,
  VolumeTargetKind,
} from "@/lib/engine/volume-landmarks";
import type { WorkoutExercise } from "@/lib/engine/types";
import type { MesocycleSlotSequence } from "../mesocycle-slot-contract";
import type {
  DistributionGuardAction,
  ForbiddenCleanupRerouteDiagnostic,
} from "../mesocycle-handoff-slot-plan-projection.repair-engine";
import type { MappedGenerationContext } from "../template-session/types";
export type RepairMateriality = "none" | "minor" | "moderate" | "major";

export type ProgramShapeWarningCode =
  | "REPAIR_CREATED_MATERIAL_SUPPORT_COVERAGE"
  | "REPAIR_ADDED_EXERCISE_IDENTITY"
  | "EXERCISE_CONCENTRATION_HIGH"
  | "SLOT_ALLOCATION_NOT_EXPLICIT"
  | "PRIMARY_MUSCLE_BELOW_TARGET_BEFORE_REPAIR"
  | "SUPPORT_FLOOR_CLOSED_LATE"
  | "FINAL_CAP_TRIM_REQUIRED"
  | "REAR_DELT_COLLATERAL_UPPER_BACK_INCREASE"
  | "REAR_DELT_COLLATERAL_PULL_CONCENTRATION"
  | "REAR_DELT_COLLATERAL_CAP_TRIM"
  | "REAR_DELT_COLLATERAL_SUSPICIOUS_REPAIR_INCREASE"
  | "REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE";

export type WeeklyMuscleDemandDiagnostic = {
  muscle: string;
  targetTier: MuscleTargetTier | null;
  targetKind: VolumeTargetKind;
  targetStatus: "hard" | "soft" | "diagnostic";
  targetRange: VolumeSoftTargetRange | null;
  preferredTarget: number | null;
  mev: number | null;
  mav: number | null;
  explicitUpstream: boolean;
  inferredDownstream: boolean;
  source: string[];
};

export type ShadowWeeklyMuscleDemand = {
  muscle: string;
  targetTier: MuscleTargetTier;
  targetStatus: "hard" | "soft" | "diagnostic";
  minEffectiveSets: number | null;
  preferredEffectiveSets: number | null;
  maxEffectiveSets: number | null;
  desiredExposureCount: number | null;
  priority: "primary" | "support" | "secondary" | "implicit";
  source: string[];
  rationale: string[];
};

export type ShadowSlotDemandAllocation = {
  slotId: string;
  slotIndex: number;
  slotArchetype: string;
  intent: string;
  allocatedMuscles: Array<{
    muscle: string;
    role: "primary" | "support" | "secondary" | "implicit";
    targetStatus: "hard" | "soft" | "diagnostic";
    minEffectiveSets: number | null;
    preferredEffectiveSets: number | null;
    maxEffectiveSets: number | null;
    allocationReason: string[];
  }>;
  fatigueBudget?: {
    systemic?: "low" | "moderate" | "high";
    axial?: "low" | "moderate" | "high";
  };
};

export type SlotCompositionSnapshotDiagnostic = {
  slotId: string;
  slotIndex: number;
  intent: string;
  exerciseCount: number;
  totalSets: number;
  projectedEffectiveStimulusByMuscle: Record<string, number>;
  exercises: Array<{
    exerciseId: string;
    exerciseName: string;
    role: "main" | "accessory";
    setCount: number;
    primaryMuscles: string[];
    movementPatterns: string[];
    effectiveStimulusByMuscle: Record<string, number>;
  }>;
};

export type AllocationVsCompositionDelta = {
  slotId: string;
  slotIndex: number;
  comparison: "allocation_vs_initial" | "allocation_vs_final";
  responsibilityLoad: "clear" | "overloaded" | "unclear";
  underAllocatedMuscles: Array<{
    muscle: string;
    role: ShadowSlotDemandAllocation["allocatedMuscles"][number]["role"];
    targetStatus: ShadowSlotDemandAllocation["allocatedMuscles"][number]["targetStatus"];
    expectedEffectiveSets: number | null;
    actualEffectiveSets: number;
    shortfall: number | null;
  }>;
  unallocatedStimulusMuscles: Array<{
    muscle: string;
    actualEffectiveSets: number;
  }>;
  notes: string[];
};

export type ShadowRepairMaterialityDiagnostic = RepairMaterialityDiagnostic & {
  likelyAvoidableWithShadowAllocation: boolean;
  shadowAllocationBasis:
    | "slot_owned_muscle_before_selection"
    | "weekly_demand_owned_elsewhere"
    | "not_shadow_allocated"
    | "diagnostic_or_cap_cleanup";
  shadowRationale: string[];
};

export type ShadowRepairSummary = {
  materialRepairCount: number;
  majorRepairCount: number;
  likelyAvoidableMaterialRepairCount: number;
  remainingMaterialRepairCount: number;
  likelyAvoidableMajorRepairCount: number;
  remainingMajorRepairCount: number;
  likelyAvoidableByMuscle: Record<string, number>;
  remainingByMuscle: Record<string, number>;
};

export type SuspiciousRepairNotEligibleForPromotion = {
  slotId: string;
  muscle: string;
  exerciseName: string | null;
  repairMechanism: string;
  reason: string;
  recommendation: string;
};

export type PromotionCandidate = {
  slotId: string;
  muscle: string;
  role: "primary" | "support";
  targetStatus: "hard" | "soft";
  evidence: string[];
  suggestedPromotion:
    | "slot_preselection_demand"
    | "set_distribution_hint"
    | "selection_scoring_hint";
};

export type RearDeltCollateralSummary = {
  directRearDeltStimulusBefore: number;
  directRearDeltStimulusAfter: number;
  rearDeltPreselectionConsumed: boolean;
  upperBackCollateralDelta: number;
  pullPatternConcentrationDelta: number | null;
  suspiciousRepairDelta: number | null;
  capTrimOrRemovalDelta: number | null;
  verdict:
    | "clean_improvement"
    | "mixed_collateral"
    | "worse_collateral"
    | "not_applicable";
  reasons: string[];
};

export type CleanPreselectionCandidateInventory = {
  exerciseId: string;
  exerciseName: string;
  candidateClass:
    | "knee_flexion_curl"
    | "hinge_compound"
    | "dirty_extension"
    | "unknown";
  primaryMuscles: string[];
  secondaryMuscles: string[];
  movementPatterns: string[];
  hamstringsStimulusPerSet: number | null;
  glutesStimulusPerSet: number | null;
  lowerBackStimulusPerSet: number | null;
  lowerSlotCompatible: boolean;
  lowerBCompatible: boolean;
  alreadySelectedInWeek: boolean;
  alreadySelectedSlotIds: string[];
  selectedInLowerBInitial: boolean;
  selectedInLowerBFinal: boolean;
  availability:
    | "clean_available"
    | "available_but_already_used_elsewhere"
    | "available_but_capacity_blocked"
    | "available_but_duplicate_blocked"
    | "available_but_role_budget_blocked"
    | "available_but_classification_mismatch"
    | "dirty_not_clean_candidate"
    | "unknown_blocker";
  reasons: string[];
};

export type CleanPreselectionFeasibility = {
  slotId: string;
  muscle: string;
  role: "primary" | "support";
  targetStatus: "hard" | "soft";
  demandType: string;
  candidateStatus:
    | "clean_candidate"
    | "dirty_candidate"
    | "not_feasible"
    | "needs_more_inventory_detail";
  targetEffectiveSets: number | null;
  currentInitialEffectiveSets: number | null;
  currentFinalEffectiveSets: number | null;
  shortfallBeforeRepair: number | null;
  preferredCleanPath: Array<{
    exerciseClass:
      | "knee_flexion_curl"
      | "hinge_compound"
      | "existing_anchor_plus_curl";
    available: boolean;
    evidence: string[];
  }>;
  dirtyClosureSignals: Array<{
    signal:
      | "back_extension_closure"
      | "lower_back_collateral"
      | "glute_collateral"
      | "sldl_concentration"
      | "cap_cleanup"
      | "suspicious_repair"
      | "weak_preselection_risk";
    evidence: string[];
  }>;
  collateralEstimate: {
    glutesDelta: number | null;
    lowerBackDelta: number | null;
  };
  candidateInventory: CleanPreselectionCandidateInventory[];
  recommendation:
    | "safe_to_trial_preselection"
    | "do_not_promote_yet"
    | "requires_distribution_policy_first"
    | "requires_inventory_or_exercise_class_fix";
  reasons: string[];
  readOnly: true;
  affectsScoringOrGeneration: false;
};

export type WeakPreselectionConsumptionDiagnostic = {
  slotId: string;
  muscle: string;
  role: "primary" | "support";
  targetStatus: "hard" | "soft";
  selectedEffectiveSets: number;
  preferredEffectiveSets: number | null;
  minEffectiveSets: number | null;
  targetMet: boolean;
  consumedBySelection: boolean;
  reason:
    | "consumed_but_target_not_met"
    | "incidental_overlap_only"
    | "no_metric_improvement";
};

export type SlotDemandAllocationDiagnostic = {
  slotId: string;
  slotIndex: number;
  slotLabel: string;
  intent: string;
  authoredSlotRole: string | null;
  slotProfile: {
    slotArchetype: string | null;
    continuityScope: string | null;
    requiredMovementPatterns: string[];
    preferredPrimaryMuscles: string[];
    preferredSupportMuscles: string[];
    protectedCoverageMuscles: string[];
  };
  expectedMuscleObligations: Array<{
    muscle: string;
    source:
      | "weekly_obligation"
      | "authored_protected_coverage"
      | "authored_primary_lane"
      | "authored_support_preference";
    targetStatus: "hard" | "soft" | "diagnostic";
    explicitUpstream: boolean;
    minEffectiveSets: number | null;
    priority: "primary" | "secondary" | "support" | "lane" | null;
  }>;
  projectedEffectiveStimulusByMuscle: Record<string, number>;
  meaningfullyServedMuscles: string[];
  allocationBasis:
    | "explicit_weekly_demand"
    | "authored_slot_semantics"
    | "local_movement_or_lane_semantics"
    | "unclear";
  satisfiesKnownWeeklyDemand: boolean;
};

export type ProjectedDeliveryDiagnostic = {
  muscle: string;
  targetStatus: WeeklyMuscleDemandDiagnostic["targetStatus"];
  targetRange: VolumeSoftTargetRange | null;
  preferredTarget: number | null;
  projectedEffectiveStimulusAfterInitialSlotComposition: number | null;
  projectedEffectiveStimulusAfterRepairAndFinalShaping: number;
  deltaFromPreferredTarget: number | null;
  exposureCount: number;
  majorContributingExercises: Array<{
    slotId: string;
    exerciseId: string;
    exerciseName: string;
    effectiveStimulus: number;
    percentOfWeeklyStimulus: number;
  }>;
};

export type RepairMaterialityDiagnostic = {
  repairMechanism: string;
  materiality: RepairMateriality;
  muscle: string | null;
  slotId: string | null;
  exerciseId: string | null;
  exerciseName: string | null;
  action:
    | "added"
    | "removed"
    | "set_bumped"
    | "set_trimmed"
    | "diagnostic_only";
  effectiveStimulusAdded: number;
  effectiveStimulusDelta: number;
  rawSetsAdded: number;
  rawSetDelta: number;
  changedExerciseIdentity: boolean;
  changedSlotShapeMaterially: boolean;
  behaviorClass: "minor_safety_net" | "program_shaping";
  source: string;
  rationale: string;
};

export type ExerciseConcentrationDiagnostic = {
  slotId: string;
  intent: string;
  exerciseId: string;
  exerciseName: string;
  setCount: number;
  role: "main" | "accessory";
  isCompound: boolean;
  primaryMuscles: string[];
  effectiveStimulusContributionByMuscle: Record<string, number>;
  percentageOfWeeklyProjectedStimulusByMuscle: Record<string, number>;
  producedOrIncreasedByRepair: boolean;
  flags: Array<
    | "COMPOUND_GT_5_SETS"
    | "ISOLATION_GT_5_SETS"
    | "EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS"
    | "EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS"
    | "EXERCISE_ADDED_BY_REPAIR"
    | "SET_COUNT_INCREASED_BY_REPAIR"
  >;
};

export type SlotPrescriptionIntent = {
  version: 1;
  slotId: string;
  slotIndex: number;
  intent: string;
  slotArchetype: string | null;
  musclePrescriptions: Array<{
    muscle: string;
    role: "primary" | "support" | "secondary" | "implicit" | "collateral";
    targetStatus: "hard" | "soft" | "diagnostic" | "forbidden";
    demandType:
      | "direct_required"
      | "overlap_preferred"
      | "direct_if_under_floor"
      | "soft_direct_allowed"
      | "diagnostic_only"
      | "do_not_train_here";
    desiredEffectiveSets: number | null;
    minEffectiveSets: number | null;
    maxEffectiveSets: number | null;
    allowedPatterns: string[];
    allowedExerciseClasses: string[];
    forbiddenPatterns: string[];
    forbiddenExerciseClasses: string[];
    collateralLimits: Array<{
      muscle: string;
      maxAddedEffectiveSets: number;
    }>;
    reasons: string[];
  }>;
  movementLanePrescriptions: Array<{
    lane: "press" | "pull" | "squat" | "hinge" | "knee_flexion" | "calf" | "isolation";
    required: boolean;
    preferredPatterns: string[];
    fallbackPatterns: string[];
    maxSamePatternCount: number | null;
  }>;
  setBudget: {
    minTotalSets: number;
    preferredTotalSets: number;
    maxTotalSets: number;
    maxSetsPerMain: number;
    maxSetsPerAccessory: number;
    maxDirectIsolationExercises: number | null;
  };
  diversityBudget: {
    maxExerciseShareByMuscle: number;
    maxPatternShareByMuscle: number;
    maxDuplicateIsolationVariantsByMuscle: number;
    maxDuplicateResistanceProfiles: number;
  };
  fatigueBudget: {
    systemic: "low" | "moderate" | "high";
    axial: "low" | "moderate" | "high";
    collateralMaxByMuscle: Record<string, number>;
  };
  diagnostic: {
    priorRepairsPrevented: string[];
    priorRepairsStillRepairOwned: string[];
    blockedRepairs: string[];
  };
};

export type SetDistributionIntent = {
  version: 1;
  slotId: string;
  slotIndex: number;
  intent: string;
  slotArchetype: string | null;
  musclePolicies: Array<{
    muscle: string;
    role: "primary" | "support" | "secondary" | "implicit" | "collateral";
    targetStatus: "hard" | "soft" | "diagnostic" | "forbidden";
    demandType:
      | "direct_required"
      | "overlap_preferred"
      | "direct_if_under_floor"
      | "soft_direct_allowed"
      | "diagnostic_only"
      | "do_not_train_here";
    preferredEffectiveSets: number | null;
    minEffectiveSets: number | null;
    maxEffectiveSets: number | null;
    maxSingleExerciseShare: number | null;
    maxSinglePatternShare: number | null;
    maxSetsPerExercise: number | null;
    maxDirectExercises: number | null;
    maxDuplicateExerciseClasses: number | null;
    preferredDistribution:
      | "single_anchor_plus_accessory"
      | "two_exercise_split"
      | "overlap_first"
      | "direct_isolation_only_if_needed"
      | "diagnostic_only"
      | "forbidden";
    whenAtLimit:
      | "prefer_alternative"
      | "do_not_bump"
      | "leave_unresolved"
      | "allow_if_no_clean_alternative";
  }>;
  slotBudget: {
    preferredTotalSets: number;
    maxTotalSets: number;
    maxMainLifts: number;
    maxAccessories: number;
    maxDirectIsolationExercises: number;
  };
  evidence: {
    concentrationRows: string[];
    capCleanupRows: string[];
    repairRowsStillRepairOwned: string[];
  };
  readOnly: true;
  affectsScoringOrGeneration: false;
};

export type PreselectionDistributionPolicyByWeek = {
  mesocycleId: string | null;
  source: "diagnostic_shadow_planner";
  readOnly: true;
  affectsScoringOrGeneration: false;
  limitations: string[];
  limitationCatalog: Record<string, string>;
  evidenceCatalog: Record<string, string>;
  affectsCatalog: Record<
    string,
    {
      volumeProgression: boolean;
      exerciseContinuity: boolean;
      setDistribution: boolean;
      fatigueManagement: boolean;
      deloadPreservation: boolean;
      runtimeAdaptation: boolean;
    }
  >;
  weeks: Array<{
    week: number;
    phase: "accumulation" | "peak" | "deload" | "unknown";
    projectionStatus:
      | "projected_from_current_week_evidence"
      | "not_projected_missing_weekly_demand_curve"
      | "not_projected_missing_accumulation_policy"
      | "not_projected_missing_deload_policy";
    weekScope:
      | "week_1_only"
      | "accumulation_weeks"
      | "peak_week"
      | "deload_week"
      | "whole_mesocycle";
    slots: Array<{
      slotId: string;
      slotArchetype: string;
      muscleDistributions: Array<{
        muscle: string;
        targetStatus: "hard" | "soft" | "diagnostic" | "forbidden";
        role: "primary" | "support" | "collateral";
        demandType:
          | "direct_required"
          | "overlap_preferred"
          | "direct_if_under_floor"
          | "soft_direct_allowed"
          | "diagnostic_only"
          | "do_not_train_here";
        targetEffectiveSets: number | null;
        minEffectiveSets: number | null;
        maxEffectiveSets: number | null;
        requiredExerciseClasses?: string[];
        preferredExerciseClasses?: string[];
        forbiddenExerciseClasses?: string[];
        maxSingleExerciseShare: number | null;
        maxSinglePatternShare: number | null;
        preferredSetSplit:
          | "anchor_plus_isolation"
          | "two_distinct_exercises"
          | "overlap_first_then_isolation"
          | "single_anchor_allowed"
          | "diagnostic_only"
          | "forbidden";
        duplicatePolicy:
          | "allow_continuity"
          | "discourage_if_alternative_exists"
          | "block_duplicate_if_alternative_exists";
        unresolvedBehavior: "leave_unresolved" | "allow_repair_safety_net";
        affectsRef: string;
        evidenceRefs: string[];
        limitationRefs: string[];
      }>;
    }>;
    weekLevelWarnings: string[];
  }>;
  candidateBehaviorSlices: Array<{
    candidate:
      | "chest_upper_slot_distinct_exercise_distribution"
      | "hamstrings_weekly_overdelivery_control"
      | "side_delt_second_slot_support"
      | "duplicate_main_lift_suppression"
      | "calf_duplicate_suppression";
    weekScope:
      | "week_1_only"
      | "accumulation_weeks"
      | "whole_mesocycle"
      | "deload_week";
    expectedBenefit: string;
    risk: string;
    prereqs: string[];
    recommendation:
      | "best_future_behavior"
      | "diagnostic_only"
      | "not_first"
      | "later_cleanup";
  }>;
  recommendedNextStep:
    | "add_behavior_after_weekly_projection"
    | "add_weekly_demand_curve_diagnostic"
    | "keep_diagnostic_only";
};

export type WeeklyDemandCurve = {
  mesocycleId: string | null;
  source: "diagnostic_shadow_planner";
  readOnly: true;
  affectsScoringOrGeneration: false;
  designBasis: {
    durationWeeks: number;
    intensityBias: string | null;
    focus: string | null;
    volumeTarget: string | null;
    splitType: string | null;
    sessionsPerWeek: number | null;
  };
  weeks: Array<{
    week: number;
    phase: "entry" | "accumulation" | "peak" | "deload" | "unknown";
    projectionStatus:
      | "projected_from_policy"
      | "partially_projected_from_week_1"
      | "not_projected_missing_policy";
    muscles: Array<{
      muscle: string;
      targetTier: MuscleTargetTier | "IMPLICIT";
      targetStatus: "hard" | "soft" | "diagnostic";
      role: "primary" | "support" | "secondary" | "implicit";
      minEffectiveSets: number | null;
      preferredEffectiveSets: number | null;
      maxEffectiveSets: number | null;
      currentEvidenceEffectiveSets: number | null;
      desiredExposureCount: number | null;
      progressionIntent:
        | "hold"
        | "increase"
        | "peak"
        | "reduce"
        | "deload"
        | "diagnostic_only";
      source: string[];
      limitations: string[];
    }>;
    weekLevelLimitations: string[];
  }>;
  crossWeekWarnings: Array<{
    code:
      | "PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION"
      | "MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION"
      | "SUPPORT_UNDER_TARGET_ACROSS_ACCUMULATION"
      | "DUPLICATE_EXERCISE_FATIGUE_RISK"
      | "DELOAD_PRESERVATION_UNPROJECTED"
      | "WEEKLY_DEMAND_POLICY_MISSING";
    muscle?: string;
    evidence: string[];
    severity: "info" | "warning";
  }>;
  candidateBehaviorGate: {
    status: "blocked_until_weekly_curve_is_visible";
    likelyBestFutureBehavior: "chest_upper_slot_distinct_exercise_distribution";
    requiredQuestions: Array<
      | "would_this_improve_weeks_1_to_4_not_just_week_1"
      | "would_this_preserve_deload_quality"
      | "would_this_increase_fatigue_concentration"
    >;
    evidence: string[];
  };
};

export type SlotDemandAllocationByWeek = {
  mesocycleId: string | null;
  source: "diagnostic_shadow_planner";
  readOnly: true;
  affectsScoringOrGeneration: false;
  weeks: Array<{
    week: number;
    phase: "entry" | "accumulation" | "peak" | "deload" | "unknown";
    projectionStatus:
      | "allocated_from_current_week_evidence"
      | "partially_allocated_from_weekly_demand_curve"
      | "not_allocated_missing_weekly_projection"
      | "not_allocated_missing_deload_policy";
    slots: Array<{
      slotId: string;
      slotIndex: number;
      slotArchetype: string;
      intent: string;
      allocatedMuscles: Array<{
        muscle: string;
        role: "primary" | "support" | "secondary" | "collateral";
        targetStatus: "hard" | "soft" | "diagnostic" | "forbidden";
        minEffectiveSets: number | null;
        preferredEffectiveSets: number | null;
        maxEffectiveSets: number | null;
        weekScope:
          | "week_1_only"
          | "accumulation_weeks"
          | "peak_week"
          | "deload_week"
          | "whole_mesocycle";
        allocationConfidence: "high" | "medium" | "low" | "unknown";
        allocationReason: string[];
        limitations: string[];
      }>;
      slotLevelWarnings: string[];
    }>;
    weekLevelWarnings: string[];
  }>;
  crossWeekAllocationWarnings: Array<{
    code:
      | "MUSCLE_UNDER_ALLOCATED_ACROSS_ACCUMULATION"
      | "MUSCLE_OVER_ALLOCATED_ACROSS_ACCUMULATION"
      | "DUPLICATE_SLOT_OWNERSHIP_RISK"
      | "DELOAD_SLOT_ALLOCATION_UNPROJECTED"
      | "WEEKLY_SLOT_ALLOCATION_POLICY_MISSING";
    muscle?: string;
    evidence: string[];
    severity: "info" | "warning";
  }>;
};

export type ExerciseClassDistributionBySlot = {
  version: 1;
  source: "diagnostic_shadow_planner" | "accepted_planner_intent";
  mesocycleId: string | null;
  week: number;
  phase: "entry" | "accumulation" | "peak" | "deload" | "unknown";
  projectionStatus:
    | "projected_from_current_evidence"
    | "partially_projected_missing_policy"
    | "not_projected_missing_policy";
  slotId: string;
  slotIndex: number;
  slotArchetype: string | null;
  intent: string;
  muscleDemands: Array<{
    muscle: string;
    role: "primary" | "support" | "secondary" | "implicit" | "collateral";
    targetStatus: "hard" | "soft" | "diagnostic" | "forbidden";
    demandType:
      | "direct_required"
      | "overlap_preferred"
      | "direct_if_under_floor"
      | "soft_direct_allowed"
      | "diagnostic_only"
      | "do_not_train_here";
    desiredEffectiveSets: number | null;
    minEffectiveSets: number | null;
    maxEffectiveSets: number | null;
    preferredExerciseClasses: string[];
    requiredExerciseClasses: string[];
    forbiddenExerciseClasses: string[];
    preferredMovementPatterns: string[];
    forbiddenMovementPatterns: string[];
    preferredSetSplit:
      | "single_anchor"
      | "anchor_plus_isolation"
      | "two_distinct_exercises"
      | "overlap_first_then_isolation"
      | "diagnostic_only"
      | "forbidden";
    duplicatePolicy:
      | "allow_with_justification"
      | "discourage_if_alternative_exists"
      | "block_if_clean_alternative_exists";
    duplicateJustifications: Array<
      | "continuity_anchor"
      | "limited_inventory"
      | "exact_demand_fit"
      | "user_preference"
      | "no_clean_alternative"
      | "deload_skill_preservation"
    >;
    unresolvedBehavior: "leave_unresolved" | "repair_safety_net";
    collateralLimits: Array<{
      muscle: string;
      maxAddedEffectiveSets: number;
    }>;
    inventoryEvidence: string[];
    repairEvidence: string[];
    limitations: string[];
  }>;
  readOnly: true;
  affectsScoringOrGeneration: false;
};

export type ExerciseClassUnresolvedCause = {
  slotId: string;
  muscle: string;
  targetStatus: "hard" | "soft" | "diagnostic" | "forbidden";
  demandType: string;
  initialAlignment:
    | "satisfied"
    | "partial"
    | "missing"
    | "violated"
    | "not_applicable";
  finalAlignment:
    | "satisfied"
    | "partial"
    | "missing"
    | "violated"
    | "not_applicable";
  owningCause:
    | "selection_blind_spot"
    | "inventory_classification_gap"
    | "slot_capacity_issue"
    | "duplicate_continuity_conflict"
    | "support_floor_late_repair"
    | "cap_cleanup_or_final_shaping"
    | "repair_identity_churn"
    | "true_unresolved_demand"
    | "diagnostic_only_not_actionable";
  recommendedOwner:
    | "selection_objective"
    | "exercise_inventory_classification"
    | "slot_capacity_policy"
    | "duplicate_continuity_policy"
    | "support_demand_planner"
    | "program_quality_cleanup"
    | "repair_safety_net"
    | "leave_unresolved";
  behaviorReadiness:
    | "ready_for_bounded_trial"
    | "needs_inventory_fix"
    | "needs_duplicate_policy"
    | "needs_capacity_policy"
    | "needs_planner_ownership"
    | "do_not_act";
  evidence: string[];
  limitations: string[];
};

export type ExerciseClassAlignment = {
  version: 1;
  source: "diagnostic_shadow_planner";
  readOnly: true;
  affectsScoringOrGeneration: false;
  slots: Array<{
    slotId: string;
    slotIndex: number;
    slotArchetype: string | null;
    muscleAlignments: Array<{
      muscle: string;
      targetStatus: "hard" | "soft" | "diagnostic" | "forbidden";
      demandType: string;
      intendedClasses: string[];
      forbiddenClasses: string[];
      initialSelectedClasses: Array<{
        exerciseName: string;
        exerciseClass: string;
        setCount: number;
        effectiveSets: number | null;
      }>;
      finalSelectedClasses: Array<{
        exerciseName: string;
        exerciseClass: string;
        setCount: number;
        effectiveSets: number | null;
        producedOrIncreasedByRepair: boolean;
      }>;
      initialAlignment:
        | "satisfied"
        | "partial"
        | "missing"
        | "violated"
        | "not_applicable";
      finalAlignment:
        | "satisfied"
        | "partial"
        | "missing"
        | "violated"
        | "not_applicable";
      repairEffect:
        | "improved_alignment"
        | "worsened_alignment"
        | "unchanged"
        | "created_identity_churn"
        | "not_applicable";
      evidence: string[];
      limitations: string[];
    }>;
    slotWarnings: string[];
  }>;
  summary: {
    initiallySatisfied: number;
    finallySatisfied: number;
    improvedByRepair: number;
    worsenedByRepair: number;
    identityChurnCount: number;
    unresolvedClassIntentCount: number;
  };
};

export type DuplicateContinuityJustification = {
  version: 1;
  source: "diagnostic_shadow_planner";
  readOnly: true;
  affectsScoringOrGeneration: false;
  duplicates: Array<{
    exerciseId: string;
    exerciseName: string;
    duplicatedInSlots: string[];
    roleBySlot: Record<string, string>;
    setCountBySlot: Record<string, number>;
    primaryMuscles: string[];
    movementPatterns: string[];
    exerciseClass: string | null;
    duplicateType:
      | "same_exercise_cross_slot"
      | "same_class_cross_slot"
      | "same_pattern_cross_slot"
      | "same_session_variant";
    justification:
      | "continuity_anchor"
      | "limited_inventory"
      | "exact_demand_fit"
      | "user_preference"
      | "no_clean_alternative"
      | "deload_skill_preservation"
      | "unjustified"
      | "unknown";
    compatibleAlternativeExists: boolean | null;
    compatibleAlternatives: Array<{
      exerciseName: string;
      exerciseClass: string | null;
      primaryMuscles: string[];
      reasonAvailableOrBlocked: string[];
    }>;
    policyRecommendation:
      | "allow_duplicate"
      | "discourage_duplicate"
      | "block_if_clean_alternative_exists"
      | "requires_planner_decision";
    risk: "low" | "moderate" | "high";
    evidence: string[];
    limitations: string[];
  }>;
  summary: {
    totalDuplicates: number;
    justifiedDuplicates: number;
    unjustifiedOrUnknown: number;
    cleanAlternativeAvailable: number;
    highRiskDuplicates: number;
  };
};

export type CleanupCandidateFeasibility = {
  candidate: "lower_b_calf_duplicate_cleanup" | string;
  slotId: string;
  muscle: string;
  currentShape: Array<{
    exerciseName: string;
    setCount: number;
    effectiveSets: number;
    exerciseClass: string | null;
  }>;
  proposedCleanerShape: Array<{
    exerciseName: string;
    proposedSetCount: number;
    projectedEffectiveSets: number;
    reason: string;
  }>;
  target: {
    minEffectiveSets: number | null;
    preferredEffectiveSets: number | null;
    targetStatus: "hard" | "soft" | "diagnostic";
  };
  caps: {
    maxSetsPerExercise: number | null;
    maxDirectExercises: number | null;
    maxTotalSlotSets: number | null;
  };
  feasibility:
    | "feasible"
    | "not_feasible_under_current_caps"
    | "ambiguous_needs_policy_decision";
  blockingReasons: Array<
    | "single_exercise_cannot_meet_floor"
    | "would_exceed_set_cap"
    | "would_reduce_below_support_floor"
    | "would_require_lower_a_mutation"
    | "would_require_specialization_policy"
    | "insufficient_inventory"
  >;
  recommendation:
    | "safe_to_trial"
    | "do_not_trial_behavior"
    | "requires_policy_decision";
  readOnly: true;
  affectsScoringOrGeneration: false;
};

export type TopDownMesocycleTargetFlow =
  | "MesocycleDemand"
  | "WeeklyDemandByWeek"
  | "SlotDemandAllocationByWeek"
  | "ExerciseClassDistributionBySlot"
  | "SetDistributionIntent"
  | "SelectionObjective"
  | "Prescription"
  | "Validation"
  | "Receipt"
  | "Runtime";

export type TopDownMesocycleLane =
  | "chest_anchor"
  | "chest_secondary"
  | "row_anchor"
  | "vertical_pull"
  | "vertical_press"
  | "side_delt_isolation"
  | "rear_delt"
  | "triceps"
  | "biceps"
  | "squat_anchor"
  | "quad_isolation"
  | "hinge_anchor"
  | "knee_flexion_curl"
  | "calves"
  | "quad_support"
  | "optional_core_adductor_glute";

export type TopDownTargetLaneStatus =
  | "matched"
  | "partial"
  | "missing"
  | "overdelivered"
  | "blocked";

export type TopDownMesocyclePlan = {
  version: 1;
  source: "first_principles_target_spec";
  targetSpecPath: "docs/10_HYPERTROPHY_MESOCYCLE_ENGINE_TARGET_SPEC.md";
  readOnly: true;
  affectsScoringOrGeneration: false;
  planStatus:
    | "diagnostic_only"
    | "partially_modeled"
    | "ready_for_selection_consumption"
    | "blocked_by_repair_shape";
  targetFlow: TopDownMesocycleTargetFlow[];
  slotTargets: Array<{
    slotId: "upper_a" | "lower_a" | "upper_b" | "lower_b" | string;
    targetIntent: string;
    requiredClassLanes: Array<{
      lane: TopDownMesocycleLane;
      preferredClasses: string[];
      targetSets: string;
      currentStatus: TopDownTargetLaneStatus;
      evidenceRefs: string[];
      limitations: string[];
    }>;
    slotStatus: "matched" | "partial" | "repair_shaped" | "blocked";
  }>;
  targetAcceptanceChecks: Array<{
    check:
      | "primary_muscles_above_minimum"
      | "no_forbidden_slot_primary_solution"
      | "no_unjustified_gt_5_sets"
      | "no_material_repair_for_basic_shape"
      | "no_duplicate_main_lift_if_clean_alternative_exists"
      | "no_excessive_axial_fatigue_stacking"
      | "no_single_exercise_over_50_60_percent_without_intent"
      | "slot_demand_allocation_before_selection"
      | "exercise_class_intent_before_selection"
      | "runtime_seed_replay_without_reselection";
    currentStatus: "pass" | "fail" | "partial" | "unknown";
    evidenceRefs: string[];
    blockingReason?: string;
  }>;
  migrationReadiness: Array<{
    candidate:
      | "chest_upper_distinct_class_distribution"
      | "lower_b_hinge_curl_distribution"
      | "side_delt_direct_support"
      | "calf_duplicate_distribution"
      | "duplicate_main_lift_policy"
      | "support_floor_planner_ownership"
      | "repair_path_demotion";
    readiness:
      | "ready_for_bounded_trial"
      | "diagnostic_only"
      | "blocked_by_repair_materiality"
      | "blocked_by_suspicious_repair"
      | "blocked_by_cross_week_uncertainty"
      | "blocked_by_feasibility";
    reason: string;
    evidenceRefs: string[];
    gateMetricsRequired: string[];
  }>;
  summary: {
    matchedTargetLanes: number;
    partialTargetLanes: number;
    missingTargetLanes: number;
    repairShapedTargetLanes: number;
    blockedMigrationCandidates: number;
    readyMigrationCandidates: number;
  };
};

export type AccumulationWeekProjection = {
  mesocycleId: string | null;
  source: "diagnostic_shadow_planner";
  readOnly: true;
  affectsScoringOrGeneration: false;
  projectionBasis: {
    sourceWeek: number;
    method:
      | "repeat_week_1_final_shape"
      | "scale_from_weekly_demand_curve"
      | "limited_missing_progression_policy";
    limitations: string[];
  };
  weeks: Array<{
    week: number;
    phase: "accumulation" | "peak" | "unknown";
    projectionStatus:
      | "projected_from_week_1_shape"
      | "partially_projected_missing_progression"
      | "not_projected_missing_policy";
    projectedMuscles: Array<{
      muscle: string;
      targetStatus: "hard" | "soft" | "diagnostic";
      projectedEffectiveSets: number | null;
      preferredEffectiveSets: number | null;
      minEffectiveSets: number | null;
      maxEffectiveSets: number | null;
      status:
        | "below"
        | "within"
        | "above"
        | "diagnostic_only"
        | "unknown";
      trend:
        | "persistent_under_target"
        | "persistent_over_target"
        | "stable"
        | "unknown";
      evidence: string[];
      limitations: string[];
    }>;
    projectedSlotRisks: Array<{
      slotId: string;
      risk:
        | "duplicate_exercise_reuse"
        | "single_exercise_concentration"
        | "collateral_fatigue"
        | "support_floor_late"
        | "cap_trim_likely"
        | "under_allocated_primary"
        | "over_allocated_primary";
      severity: "info" | "warning";
      evidence: string[];
    }>;
    weekLevelWarnings: string[];
  }>;
  crossWeekWarnings: Array<{
    code:
      | "CHEST_UNDER_TARGET_ACROSS_ACCUMULATION"
      | "HAMSTRINGS_OVERDELIVERED_ACROSS_ACCUMULATION"
      | "SIDE_DELTS_UNDER_TARGET_ACROSS_ACCUMULATION"
      | "DUPLICATE_MAIN_LIFT_REUSE_ACROSS_ACCUMULATION"
      | "COLLATERAL_FATIGUE_RISK_ACROSS_ACCUMULATION"
      | "DELOAD_PRESERVATION_STILL_UNPROJECTED";
    muscle?: string;
    evidence: string[];
    severity: "info" | "warning";
  }>;
  candidateBehaviorReadiness: Array<{
    candidate:
      | "chest_upper_slot_distinct_exercise_distribution"
      | "hamstrings_weekly_overdelivery_control"
      | "side_delt_second_slot_support"
      | "duplicate_main_lift_suppression"
      | "calf_duplicate_suppression";
    readiness:
      | "ready_for_bounded_trial"
      | "needs_more_projection"
      | "not_first"
      | "diagnostic_only";
    reason: string;
    requiredGuardrails: string[];
  }>;
};

export type SlotPlanPlanningRealityDiagnostic = {
  label: "weekly demand / slot allocation diagnostics";
  readOnly: true;
  affectsScoringOrGeneration: false;
  summary: {
    planningShape:
      | "mostly_upstream_planned"
      | "mixed_upstream_plus_repair_shaped"
      | "mostly_repair_shaped"
      | "unclear_due_to_missing_instrumentation";
    explicitWeeklyDemandMuscles: number;
    inferredDemandMuscles: number;
    slotsWithExplicitWeeklyDemand: number;
    slotsWithOnlyLocalOrInferredSemantics: number;
    materialRepairCount: number;
    majorRepairCount: number;
    highExerciseConcentrationCount: number;
    warningCodes: ProgramShapeWarningCode[];
  };
  weeklyMuscleDemand: WeeklyMuscleDemandDiagnostic[];
  slotDemandAllocation: SlotDemandAllocationDiagnostic[];
  shadowWeeklyDemand: ShadowWeeklyMuscleDemand[];
  shadowSlotDemandAllocation: ShadowSlotDemandAllocation[];
  initialSlotComposition: SlotCompositionSnapshotDiagnostic[];
  finalSlotPlan: SlotCompositionSnapshotDiagnostic[];
  allocationVsInitialDelta: AllocationVsCompositionDelta[];
  allocationVsFinalDelta: AllocationVsCompositionDelta[];
  repairMaterialityAfterShadowAllocation: ShadowRepairMaterialityDiagnostic[];
  shadowRepairSummary: ShadowRepairSummary;
  suspiciousRepairsNotEligibleForPromotion: SuspiciousRepairNotEligibleForPromotion[];
  promotionCandidates: PromotionCandidate[];
  weakPreselectionConsumption: WeakPreselectionConsumptionDiagnostic[];
  slotPrescriptionIntents: SlotPrescriptionIntent[];
  setDistributionIntents: SetDistributionIntent[];
  distributionGuardActions: DistributionGuardAction[];
  preselectionFeasibility: CleanPreselectionFeasibility[];
  preselectionDistributionPolicyByWeek: PreselectionDistributionPolicyByWeek;
  weeklyDemandCurve: WeeklyDemandCurve;
  slotDemandAllocationByWeek: SlotDemandAllocationByWeek;
  exerciseClassDistributionBySlot: ExerciseClassDistributionBySlot[];
  exerciseClassAlignment: ExerciseClassAlignment;
  exerciseClassUnresolvedCauses: ExerciseClassUnresolvedCause[];
  duplicateContinuityJustification: DuplicateContinuityJustification;
  cleanupCandidateFeasibility: CleanupCandidateFeasibility[];
  topDownMesocyclePlan?: TopDownMesocyclePlan;
  accumulationWeekProjection: AccumulationWeekProjection;
  forbiddenCleanupReroute?: ForbiddenCleanupRerouteDiagnostic;
  rearDeltCollateralSummary?: RearDeltCollateralSummary;
  projectedDelivery: ProjectedDeliveryDiagnostic[];
  repairMateriality: RepairMaterialityDiagnostic[];
  exerciseConcentration: ExerciseConcentrationDiagnostic[];
  warnings: Array<{
    code: ProgramShapeWarningCode;
    severity: "info" | "warning";
    message: string;
    evidence: string[];
  }>;
  limitations: string[];
};

export type ActiveMesocycleForDiagnostics = NonNullable<MappedGenerationContext["activeMesocycle"]>;

export type SlotSequenceEntry = {
  slotId: string;
  intent: WorkoutSessionIntent;
  authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
};

export type ExerciseRow = {
  slotId: string;
  intent: string;
  exercise: WorkoutExercise;
  role: "main" | "accessory";
  setCount: number;
  contributionByMuscle: Record<string, number>;
};

export type PreselectionDemandDiagnosticLike = {
  slotId: string;
  muscle: string;
  role?: "primary" | "support";
  targetStatus?: "hard" | "soft";
  selectedEffectiveSets: number;
  preferredEffectiveSets?: number;
  minEffectiveSets?: number;
  consumedBySelection: boolean;
  targetMet: boolean;
};

export type DiagnosticExerciseLibrary = MappedGenerationContext["exerciseLibrary"];
export type DiagnosticExercise = DiagnosticExerciseLibrary[number];
