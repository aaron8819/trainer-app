import type { WorkoutSessionIntent } from "@prisma/client";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { isExerciseEligibleForSessionInventory } from "@/lib/planning/session-opportunities";
import {
  getMuscleTargetSemantics,
  normalizeExposedMuscle,
  VOLUME_LANDMARKS,
  type MuscleTargetTier,
  type VolumeSoftTargetRange,
  type VolumeTargetKind,
} from "@/lib/engine/volume-landmarks";
import {
  getProjectionPreferredSupportMuscles,
  getProjectionRepairCompatibleMuscles,
  getProjectionSoftPreferredSupportMuscles,
  getProtectedWeekOneCoverageObligations,
  resolveSessionSlotPolicy,
  type ProtectedWeekOneCoverageMuscle,
} from "@/lib/planning/session-slot-profile";
import type { WorkoutExercise } from "@/lib/engine/types";
import { getWeeklyVolumeTarget } from "./mesocycle-lifecycle";
import type { MesocycleSlotSequence } from "./mesocycle-slot-contract";
import {
  buildSlotSequenceEntries,
  computeProjectedWeeklyContributionByMuscle,
  getWorkoutExercises,
  roundToTenth,
  toSessionIntent,
  type ProjectedSlotWorkout,
  type ProtectedWeekOneCoverageEvaluation,
  type SupportFloorRepairReason,
} from "./mesocycle-handoff-slot-plan-projection.coverage-evaluation";
import type {
  ProgramQualityDiagnostic,
  ProgramQualityEvaluation,
} from "./mesocycle-handoff-slot-plan-projection.program-quality";
import {
  MAX_SAME_PATTERN_PER_SESSION,
  MAX_SINGLE_EXERCISE_MUSCLE_SHARE,
  MAX_SINGLE_PATTERN_MUSCLE_SHARE,
  SOFT_ACCESSORY_SET_CAP,
  SOFT_MAIN_LIFT_SET_CAP,
} from "./mesocycle-handoff-slot-plan-projection.program-quality";
import {
  MAX_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
  MAX_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE,
  MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
  MIN_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE,
  type DistributionGuardAction,
  type ForbiddenCleanupRerouteDiagnostic,
} from "./mesocycle-handoff-slot-plan-projection.repair-engine";
import {
  getSlotWeeklyObligations,
  HARD_WEEKLY_OBLIGATION_MUSCLES,
  type DuplicateExerciseReuseDiagnostic,
  type SlotObligationEvaluation,
  type WeeklyMuscleObligationPlan,
} from "./mesocycle-handoff-slot-plan-projection.weekly-obligations";
import { SESSION_CAPS } from "./template-session/selection-adapter";
import { getWeekOneSupportFloor } from "./template-session/role-budgeting";
import type { MappedGenerationContext } from "./template-session/types";

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
        affects: {
          volumeProgression: boolean;
          exerciseContinuity: boolean;
          setDistribution: boolean;
          fatigueManagement: boolean;
          deloadPreservation: boolean;
          runtimeAdaptation: boolean;
        };
        evidence: string[];
        limitations: string[];
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

type ActiveMesocycleForDiagnostics = NonNullable<MappedGenerationContext["activeMesocycle"]>;

type SlotSequenceEntry = {
  slotId: string;
  intent: WorkoutSessionIntent;
  authoredSemantics?: MesocycleSlotSequence["slots"][number]["authoredSemantics"];
};

type ExerciseRow = {
  slotId: string;
  intent: string;
  exercise: WorkoutExercise;
  role: "main" | "accessory";
  setCount: number;
  contributionByMuscle: Record<string, number>;
};

type PreselectionDemandDiagnosticLike = {
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

function normalizeMuscle(muscle: string): string {
  return normalizeExposedMuscle(muscle);
}

function toRoundedRecord(map: ReadonlyMap<string, number>): Record<string, number> {
  const record: Record<string, number> = {};
  for (const [rawMuscle, rawValue] of map) {
    const muscle = normalizeMuscle(rawMuscle);
    record[muscle] = roundToTenth((record[muscle] ?? 0) + rawValue);
  }
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function mergeContributionRecords(records: ReadonlyArray<Record<string, number>>): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const record of records) {
    for (const [muscle, value] of Object.entries(record)) {
      merged[muscle] = roundToTenth((merged[muscle] ?? 0) + value);
    }
  }
  return Object.fromEntries(
    Object.entries(merged)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function isHardObligationMuscle(muscle: string): muscle is (typeof HARD_WEEKLY_OBLIGATION_MUSCLES)[number] {
  return HARD_WEEKLY_OBLIGATION_MUSCLES.includes(
    muscle as (typeof HARD_WEEKLY_OBLIGATION_MUSCLES)[number]
  );
}

function getWeeklyObligationEntry(
  plan: WeeklyMuscleObligationPlan,
  muscle: string
) {
  return isHardObligationMuscle(muscle) ? plan.muscles[muscle] : null;
}

function getTargetForMuscle(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  muscle: string;
}): {
  targetStatus: WeeklyMuscleDemandDiagnostic["targetStatus"];
  targetRange: VolumeSoftTargetRange | null;
  preferredTarget: number | null;
  explicitUpstream: boolean;
  inferredDownstream: boolean;
  source: string[];
} {
  const targetSemantics = getMuscleTargetSemantics(input.muscle);
  const weeklyObligation = getWeeklyObligationEntry(input.weeklyObligationPlan, input.muscle);
  const supportFloor = getWeekOneSupportFloor(input.muscle as ProtectedWeekOneCoverageMuscle);
  const explicitUpstream = Boolean(
    weeklyObligation && (weeklyObligation.targetSets > 0 || weeklyObligation.allocatedSlots.length > 0)
  );
  const inferredDownstream = !explicitUpstream && (
    supportFloor != null ||
    targetSemantics.targetTier === "B_SUPPORT" ||
    targetSemantics.targetKind === "soft"
  );
  const preferredTarget =
    explicitUpstream && weeklyObligation
      ? weeklyObligation.targetSets
      : supportFloor != null
        ? supportFloor
        : targetSemantics.softTargetRange
          ? roundToTenth((targetSemantics.softTargetRange.min + targetSemantics.softTargetRange.max) / 2)
          : VOLUME_LANDMARKS[input.muscle]
            ? getWeeklyVolumeTarget(input.activeMesocycle, input.muscle, 1)
            : null;
  const source = [
    ...(explicitUpstream ? ["weekly_obligation_plan:getWeeklyVolumeTarget(week=1)"] : []),
    ...(supportFloor != null ? ["week_one_support_floor"] : []),
    ...(targetSemantics.softTargetRange ? ["volume_landmarks:soft_target_range"] : []),
    ...(targetSemantics.targetTier ? [`volume_landmarks:target_tier:${targetSemantics.targetTier}`] : []),
  ];

  return {
    targetStatus: explicitUpstream
      ? "hard"
      : inferredDownstream
        ? "soft"
        : "diagnostic",
    targetRange: targetSemantics.softTargetRange,
    preferredTarget,
    explicitUpstream,
    inferredDownstream,
    source: source.length > 0 ? source : ["projected_stimulus_observed"],
  };
}

function buildExerciseRows(slots: ReadonlyArray<ProjectedSlotWorkout>): ExerciseRow[] {
  return slots.flatMap((slot) =>
    getWorkoutExercises(slot.workout).map((exercise) => ({
      slotId: slot.slotPlan.slotId,
      intent: slot.slotPlan.intent,
      exercise,
      role: exercise.isMainLift || exercise.role === "main" ? "main" : "accessory",
      setCount: exercise.sets.length,
      contributionByMuscle: toRoundedRecord(
        getEffectiveStimulusByMuscle(exercise.exercise, exercise.sets.length, {
          logFallback: false,
        })
      ),
    }))
  );
}

function getExerciseKey(slotId: string, exerciseId: string): string {
  return `${slotId}:${exerciseId}`;
}

function buildExerciseRowMap(rows: ReadonlyArray<ExerciseRow>): Map<string, ExerciseRow> {
  return new Map(rows.map((row) => [getExerciseKey(row.slotId, row.exercise.exercise.id), row]));
}

function collectRelevantMuscles(input: {
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  protectedCoverage: ProtectedWeekOneCoverageEvaluation;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
}): string[] {
  const muscles = new Set<string>();
  const add = (muscle: string | null | undefined) => {
    if (muscle && muscle.trim().length > 0) {
      muscles.add(normalizeMuscle(muscle));
    }
  };

  for (const muscle of HARD_WEEKLY_OBLIGATION_MUSCLES) {
    const obligation = input.weeklyObligationPlan.muscles[muscle];
    if (obligation.targetSets > 0 || obligation.allocatedSlots.length > 0) {
      add(muscle);
    }
  }
  for (const row of input.protectedCoverage.muscles) {
    add(row.muscle);
  }
  for (const muscle of Object.keys(input.supportFloorRepairReasons)) {
    add(muscle);
  }
  for (const diagnostic of input.programQualityAppliedDiagnostics) {
    add(diagnostic.muscle);
  }
  for (const slot of [...input.initialProjectedSlots, ...input.finalProjectedSlots]) {
    for (const [muscle, value] of slot.projectedContributionByMuscle) {
      if (value > 0) {
        add(muscle);
      }
    }
  }
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);
  for (const slot of input.slotSequence) {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: { slots: slotSequenceEntries },
    }).currentSession;
    for (const muscle of getProtectedWeekOneCoverageObligations(slotPolicy)) {
      add(muscle);
    }
    for (const muscle of getProjectionPreferredSupportMuscles(slotPolicy)) {
      add(muscle);
    }
    for (const muscle of slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []) {
      add(muscle);
    }
  }

  return Array.from(muscles).sort((left, right) => left.localeCompare(right));
}

function buildWeeklyMuscleDemand(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  protectedCoverage: ProtectedWeekOneCoverageEvaluation;
  relevantMuscles: string[];
}): WeeklyMuscleDemandDiagnostic[] {
  const protectedMuscles = new Set(input.protectedCoverage.muscles.map((row) => normalizeMuscle(row.muscle)));

  return input.relevantMuscles.map((muscle) => {
    const targetSemantics = getMuscleTargetSemantics(muscle);
    const target = getTargetForMuscle({
      activeMesocycle: input.activeMesocycle,
      weeklyObligationPlan: input.weeklyObligationPlan,
      muscle,
    });
    const landmark = VOLUME_LANDMARKS[muscle] ?? null;
    const source = Array.from(
      new Set([
        ...target.source,
        ...(protectedMuscles.has(muscle) ? ["protected_week_one_coverage_evaluation"] : []),
      ])
    );

    return {
      muscle,
      targetTier: targetSemantics.targetTier,
      targetKind: targetSemantics.targetKind,
      targetStatus: target.targetStatus,
      targetRange: target.targetRange,
      preferredTarget: target.preferredTarget,
      mev: landmark?.mev ?? null,
      mav: landmark?.mav ?? null,
      explicitUpstream: target.explicitUpstream,
      inferredDownstream: target.inferredDownstream || protectedMuscles.has(muscle),
      source,
    };
  });
}

function appendSlotObligation(
  obligations: SlotDemandAllocationDiagnostic["expectedMuscleObligations"],
  obligation: SlotDemandAllocationDiagnostic["expectedMuscleObligations"][number]
): void {
  const existing = obligations.find(
    (entry) => entry.muscle === obligation.muscle && entry.source === obligation.source
  );
  if (!existing) {
    obligations.push(obligation);
  }
}

function getNormalizedTargetTier(muscle: string): MuscleTargetTier {
  return getMuscleTargetSemantics(muscle).targetTier ?? "IMPLICIT";
}

function getShadowDemandTargets(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  muscle: string;
}): Pick<
  ShadowWeeklyMuscleDemand,
  "targetTier" | "targetStatus" | "minEffectiveSets" | "preferredEffectiveSets" | "maxEffectiveSets" | "priority"
> & { source: string[]; rationale: string[] } {
  const targetTier = getNormalizedTargetTier(input.muscle);
  const targetSemantics = getMuscleTargetSemantics(input.muscle);
  const landmark = VOLUME_LANDMARKS[input.muscle] ?? null;
  const weeklyObligation = getWeeklyObligationEntry(input.weeklyObligationPlan, input.muscle);
  const supportFloor = getWeekOneSupportFloor(input.muscle);
  const source = [`volume_landmarks:target_tier:${targetTier}`];
  const rationale: string[] = [];

  if (weeklyObligation && (weeklyObligation.targetSets > 0 || weeklyObligation.allocatedSlots.length > 0)) {
    source.push("weekly_obligation_plan:getWeeklyVolumeTarget(week=1)");
    rationale.push("A primary driver has an explicit Week 1 weekly obligation before slot composition.");
    return {
      targetTier,
      targetStatus: "hard",
      minEffectiveSets: landmark?.mev ?? weeklyObligation.targetSets,
      preferredEffectiveSets: weeklyObligation.targetSets,
      maxEffectiveSets: landmark?.mav ?? null,
      priority: "primary",
      source,
      rationale,
    };
  }

  if (targetTier === "B_SUPPORT") {
    if (supportFloor != null) {
      source.push("week_one_support_floor");
    }
    rationale.push("Support-tier muscle should be visible upstream as protected or preferred support, not only late repair.");
    return {
      targetTier,
      targetStatus: supportFloor != null ? "soft" : "diagnostic",
      minEffectiveSets: supportFloor ?? null,
      preferredEffectiveSets: supportFloor ?? null,
      maxEffectiveSets: landmark?.mav ?? null,
      priority: "support",
      source,
      rationale,
    };
  }

  if (targetTier === "C_SECONDARY") {
    if (targetSemantics.softTargetRange) {
      source.push("volume_landmarks:soft_target_range");
    }
    rationale.push("Secondary muscle remains a diagnostic/readout unless an authored slot explicitly owns it.");
    return {
      targetTier,
      targetStatus: "diagnostic",
      minEffectiveSets: targetSemantics.softTargetRange?.min ?? null,
      preferredEffectiveSets: targetSemantics.softTargetRange
        ? roundToTenth((targetSemantics.softTargetRange.min + targetSemantics.softTargetRange.max) / 2)
        : null,
      maxEffectiveSets: targetSemantics.softTargetRange?.max ?? landmark?.mav ?? null,
      priority: "secondary",
      source,
      rationale,
    };
  }

  rationale.push("Implicit muscle is fatigue/readout context unless explicitly targeted by a slot.");
  return {
    targetTier,
    targetStatus: "diagnostic",
    minEffectiveSets: null,
    preferredEffectiveSets: null,
    maxEffectiveSets: null,
    priority: "implicit",
    source,
    rationale,
  };
}

function getAllocationFatigueBudget(slotArchetype: string | null | undefined): ShadowSlotDemandAllocation["fatigueBudget"] {
  switch (slotArchetype) {
    case "lower_hinge_dominant":
      return { systemic: "high", axial: "high" };
    case "lower_squat_dominant":
      return { systemic: "high", axial: "moderate" };
    case "upper_horizontal_balanced":
    case "upper_vertical_balanced":
      return { systemic: "moderate", axial: "low" };
    default:
      return { systemic: "moderate", axial: "moderate" };
  }
}

function appendAllocatedMuscle(
  allocatedMuscles: ShadowSlotDemandAllocation["allocatedMuscles"],
  allocation: ShadowSlotDemandAllocation["allocatedMuscles"][number]
): void {
  const existing = allocatedMuscles.find((row) => row.muscle === allocation.muscle);
  if (!existing) {
    allocatedMuscles.push(allocation);
    return;
  }

  const roleOrder: Record<ShadowSlotDemandAllocation["allocatedMuscles"][number]["role"], number> = {
    primary: 0,
    support: 1,
    secondary: 2,
    implicit: 3,
  };
  const statusOrder: Record<ShadowSlotDemandAllocation["allocatedMuscles"][number]["targetStatus"], number> = {
    hard: 0,
    soft: 1,
    diagnostic: 2,
  };

  existing.role = roleOrder[allocation.role] < roleOrder[existing.role] ? allocation.role : existing.role;
  existing.targetStatus =
    statusOrder[allocation.targetStatus] < statusOrder[existing.targetStatus]
      ? allocation.targetStatus
      : existing.targetStatus;
  existing.minEffectiveSets =
    existing.minEffectiveSets == null
      ? allocation.minEffectiveSets
      : allocation.minEffectiveSets == null
        ? existing.minEffectiveSets
        : Math.max(existing.minEffectiveSets, allocation.minEffectiveSets);
  existing.preferredEffectiveSets =
    existing.preferredEffectiveSets == null
      ? allocation.preferredEffectiveSets
      : allocation.preferredEffectiveSets == null
        ? existing.preferredEffectiveSets
        : Math.max(existing.preferredEffectiveSets, allocation.preferredEffectiveSets);
  existing.maxEffectiveSets =
    existing.maxEffectiveSets == null
      ? allocation.maxEffectiveSets
      : allocation.maxEffectiveSets == null
        ? existing.maxEffectiveSets
        : Math.min(existing.maxEffectiveSets, allocation.maxEffectiveSets);
  existing.allocationReason = Array.from(
    new Set([...existing.allocationReason, ...allocation.allocationReason])
  );
}

function getCompatibleShadowSupportSlots(input: {
  muscle: string;
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  slotSequenceEntries: ReturnType<typeof buildSlotSequenceEntries>;
}): string[] {
  return input.slotSequence.flatMap((slot) => {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: { slots: input.slotSequenceEntries },
    }).currentSession;
    return getProjectionRepairCompatibleMuscles(slotPolicy, [input.muscle]).includes(
      input.muscle as ProtectedWeekOneCoverageMuscle
    )
      ? [slot.slotId]
      : [];
  });
}

function buildShadowSlotDemandAllocation(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  relevantMuscles: string[];
}): ShadowSlotDemandAllocation[] {
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);
  const supportMuscles = Array.from(
    new Set([
      ...input.relevantMuscles.filter((muscle) => getNormalizedTargetTier(muscle) === "B_SUPPORT"),
      ...Object.keys(VOLUME_LANDMARKS).filter(
        (muscle) => getNormalizedTargetTier(muscle) === "B_SUPPORT" && getWeekOneSupportFloor(muscle) != null
      ),
    ])
  );
  const compatibleSupportSlotIdsByMuscle = new Map(
    supportMuscles.map((muscle) => [
      muscle,
      getCompatibleShadowSupportSlots({
        muscle,
        slotSequence: input.slotSequence,
        slotSequenceEntries,
      }),
    ])
  );

  return input.slotSequence.map((slot, slotIndex) => {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: { slots: slotSequenceEntries },
    }).currentSession;
    const allocatedMuscles: ShadowSlotDemandAllocation["allocatedMuscles"] = [];

    for (const obligation of getSlotWeeklyObligations({
      plan: input.weeklyObligationPlan,
      slotId: slot.slotId,
    })) {
      const demand = getShadowDemandTargets({
        activeMesocycle: input.activeMesocycle,
        weeklyObligationPlan: input.weeklyObligationPlan,
        muscle: obligation.muscle,
      });
      appendAllocatedMuscle(allocatedMuscles, {
        muscle: obligation.muscle,
        role: obligation.priority === "primary" ? "primary" : "support",
        targetStatus: "hard",
        minEffectiveSets: obligation.minEffectiveSets,
        preferredEffectiveSets: obligation.minEffectiveSets,
        maxEffectiveSets: demand.maxEffectiveSets,
        allocationReason: [
          "weekly_obligation_allocated_to_compatible_slot",
          `weekly_priority:${obligation.priority}`,
        ],
      });
    }

    for (const muscle of getProtectedWeekOneCoverageObligations(slotPolicy)) {
      const demand = getShadowDemandTargets({
        activeMesocycle: input.activeMesocycle,
        weeklyObligationPlan: input.weeklyObligationPlan,
        muscle,
      });
      appendAllocatedMuscle(allocatedMuscles, {
        muscle,
        role: demand.priority === "primary" ? "primary" : "support",
        targetStatus: demand.targetStatus === "hard" ? "hard" : "soft",
        minEffectiveSets: demand.targetStatus === "hard" ? null : demand.minEffectiveSets,
        preferredEffectiveSets: demand.targetStatus === "hard" ? null : demand.preferredEffectiveSets,
        maxEffectiveSets: demand.maxEffectiveSets,
        allocationReason: ["authored_protected_week_one_coverage"],
      });
    }

    for (const muscle of slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []) {
      const normalizedMuscle = normalizeMuscle(muscle);
      const demand = getShadowDemandTargets({
        activeMesocycle: input.activeMesocycle,
        weeklyObligationPlan: input.weeklyObligationPlan,
        muscle: normalizedMuscle,
      });
      appendAllocatedMuscle(allocatedMuscles, {
        muscle: normalizedMuscle,
        role: demand.priority === "primary" ? "primary" : "secondary",
        targetStatus: demand.targetStatus,
        minEffectiveSets: null,
        preferredEffectiveSets: demand.targetStatus === "hard" ? null : demand.preferredEffectiveSets,
        maxEffectiveSets: demand.maxEffectiveSets,
        allocationReason: ["authored_primary_lane_preferred_muscle"],
      });
    }

    for (const muscle of getProjectionPreferredSupportMuscles(slotPolicy)) {
      const normalizedMuscle = normalizeMuscle(muscle);
      const demand = getShadowDemandTargets({
        activeMesocycle: input.activeMesocycle,
        weeklyObligationPlan: input.weeklyObligationPlan,
        muscle: normalizedMuscle,
      });
      appendAllocatedMuscle(allocatedMuscles, {
        muscle: normalizedMuscle,
        role: demand.priority === "primary" ? "primary" : "support",
        targetStatus: demand.targetStatus === "hard" ? "hard" : "soft",
        minEffectiveSets: demand.targetStatus === "hard" ? null : demand.minEffectiveSets,
        preferredEffectiveSets: demand.targetStatus === "hard" ? null : demand.preferredEffectiveSets,
        maxEffectiveSets: demand.maxEffectiveSets,
        allocationReason: ["authored_preferred_support_muscle"],
      });
    }

    for (const muscle of supportMuscles) {
      const compatibleSlotIds = compatibleSupportSlotIdsByMuscle.get(muscle) ?? [];
      if (!compatibleSlotIds.includes(slot.slotId)) {
        continue;
      }
      const supportFloor = getWeekOneSupportFloor(muscle);
      const perSlotPreferred =
        supportFloor != null && compatibleSlotIds.length > 0
          ? roundToTenth(supportFloor / compatibleSlotIds.length)
          : null;
      const demand = getShadowDemandTargets({
        activeMesocycle: input.activeMesocycle,
        weeklyObligationPlan: input.weeklyObligationPlan,
        muscle,
      });
      appendAllocatedMuscle(allocatedMuscles, {
        muscle,
        role: "support",
        targetStatus: demand.targetStatus === "diagnostic" ? "diagnostic" : "soft",
        minEffectiveSets: null,
        preferredEffectiveSets: perSlotPreferred,
        maxEffectiveSets: demand.maxEffectiveSets,
        allocationReason: ["slot_profile_support_compatible", "support_floor_distributed_across_compatible_slots"],
      });
    }

    return {
      slotId: slot.slotId,
      slotIndex,
      slotArchetype: slotPolicy?.slotArchetype ?? "unresolved",
      intent: toSessionIntent(slot.intent),
      allocatedMuscles: allocatedMuscles.sort((left, right) => {
        const roleOrder: Record<typeof left.role, number> = {
          primary: 0,
          support: 1,
          secondary: 2,
          implicit: 3,
        };
        return roleOrder[left.role] - roleOrder[right.role] || left.muscle.localeCompare(right.muscle);
      }),
      fatigueBudget: getAllocationFatigueBudget(slotPolicy?.slotArchetype),
    };
  });
}

function buildShadowWeeklyDemand(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  relevantMuscles: string[];
  shadowSlotDemandAllocation: ShadowSlotDemandAllocation[];
}): ShadowWeeklyMuscleDemand[] {
  const allocatedMuscles = new Set(
    input.shadowSlotDemandAllocation.flatMap((slot) =>
      slot.allocatedMuscles.map((allocation) => allocation.muscle)
    )
  );
  const muscles = Array.from(
    new Set([
      ...input.relevantMuscles,
      ...allocatedMuscles,
      ...Object.keys(VOLUME_LANDMARKS).filter(
        (muscle) => getNormalizedTargetTier(muscle) === "B_SUPPORT" && getWeekOneSupportFloor(muscle) != null
      ),
    ])
  ).sort((left, right) => left.localeCompare(right));

  return muscles.map((muscle) => {
    const demand = getShadowDemandTargets({
      activeMesocycle: input.activeMesocycle,
      weeklyObligationPlan: input.weeklyObligationPlan,
      muscle,
    });
    const desiredExposureCount = input.shadowSlotDemandAllocation.filter((slot) =>
      slot.allocatedMuscles.some((allocation) => allocation.muscle === muscle)
    ).length;

    return {
      muscle,
      targetTier: demand.targetTier,
      targetStatus: demand.targetStatus,
      minEffectiveSets: demand.minEffectiveSets,
      preferredEffectiveSets: demand.preferredEffectiveSets,
      maxEffectiveSets: demand.maxEffectiveSets,
      desiredExposureCount: desiredExposureCount > 0 ? desiredExposureCount : null,
      priority: demand.priority,
      source: Array.from(
        new Set([
          ...demand.source,
          ...(desiredExposureCount > 0 ? ["shadow_slot_demand_allocation"] : []),
        ])
      ),
      rationale:
        desiredExposureCount > 0
          ? [...demand.rationale, "At least one authored slot can own this demand before exercise selection."]
          : demand.rationale,
    };
  });
}

function buildSlotCompositionSnapshots(input: {
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  projectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
}): SlotCompositionSnapshotDiagnostic[] {
  const projectedSlotById = new Map(
    input.projectedSlots.map((slot) => [slot.slotPlan.slotId, slot])
  );

  return input.slotSequence.map((slot, slotIndex) => {
    const projectedSlot = projectedSlotById.get(slot.slotId);
    const exerciseRows = projectedSlot ? buildExerciseRows([projectedSlot]) : [];
    return {
      slotId: slot.slotId,
      slotIndex,
      intent: toSessionIntent(slot.intent),
      exerciseCount: exerciseRows.length,
      totalSets: exerciseRows.reduce((sum, row) => sum + row.setCount, 0),
      projectedEffectiveStimulusByMuscle: toRoundedRecord(
        projectedSlot?.projectedContributionByMuscle ?? new Map()
      ),
      exercises: exerciseRows.map((row) => ({
        exerciseId: row.exercise.exercise.id,
        exerciseName: row.exercise.exercise.name,
        role: row.role,
        setCount: row.setCount,
        primaryMuscles: [...(row.exercise.exercise.primaryMuscles ?? [])].map(normalizeMuscle),
        movementPatterns: sortPrescriptionStrings(
          row.exercise.exercise.movementPatterns ?? [],
        ),
        effectiveStimulusByMuscle: row.contributionByMuscle,
      })),
    };
  });
}

function classifyResponsibilityLoad(
  allocation: ShadowSlotDemandAllocation | undefined
): AllocationVsCompositionDelta["responsibilityLoad"] {
  if (!allocation || allocation.allocatedMuscles.length === 0) {
    return "unclear";
  }
  const actionable = allocation.allocatedMuscles.filter(
    (row) => row.targetStatus === "hard" || row.targetStatus === "soft"
  );
  const hard = allocation.allocatedMuscles.filter((row) => row.targetStatus === "hard");
  return actionable.length > 6 || hard.length > 3 ? "overloaded" : "clear";
}

function buildAllocationDeltas(input: {
  shadowSlotDemandAllocation: ShadowSlotDemandAllocation[];
  composition: SlotCompositionSnapshotDiagnostic[];
  comparison: AllocationVsCompositionDelta["comparison"];
}): AllocationVsCompositionDelta[] {
  const allocationBySlotId = new Map(
    input.shadowSlotDemandAllocation.map((slot) => [slot.slotId, slot])
  );

  return input.composition.map((slot) => {
    const allocation = allocationBySlotId.get(slot.slotId);
    const allocatedByMuscle = new Map(
      (allocation?.allocatedMuscles ?? []).map((row) => [row.muscle, row])
    );
    const underAllocatedMuscles = (allocation?.allocatedMuscles ?? [])
      .flatMap((row) => {
        const expected = row.targetStatus === "hard"
          ? row.minEffectiveSets
          : row.preferredEffectiveSets;
        const actual = roundToTenth(slot.projectedEffectiveStimulusByMuscle[row.muscle] ?? 0);
        if (expected == null || actual + 1e-9 >= expected) {
          return [];
        }
        return [{
          muscle: row.muscle,
          role: row.role,
          targetStatus: row.targetStatus,
          expectedEffectiveSets: expected,
          actualEffectiveSets: actual,
          shortfall: roundToTenth(expected - actual),
        }];
      })
      .sort((left, right) => (right.shortfall ?? 0) - (left.shortfall ?? 0) || left.muscle.localeCompare(right.muscle));
    const unallocatedStimulusMuscles = Object.entries(slot.projectedEffectiveStimulusByMuscle)
      .filter(([muscle, effectiveSets]) => !allocatedByMuscle.has(muscle) && effectiveSets >= 2)
      .map(([muscle, actualEffectiveSets]) => ({ muscle, actualEffectiveSets }))
      .sort((left, right) => right.actualEffectiveSets - left.actualEffectiveSets || left.muscle.localeCompare(right.muscle));
    const responsibilityLoad = classifyResponsibilityLoad(allocation);
    const notes = [
      ...(responsibilityLoad === "unclear" ? ["no_shadow_slot_allocation"] : []),
      ...(responsibilityLoad === "overloaded" ? ["shadow_slot_has_many_actionable_responsibilities"] : []),
      ...(underAllocatedMuscles.length > 0 ? ["allocated_muscles_under_initial_or_final_composition"] : []),
      ...(unallocatedStimulusMuscles.length > 0 ? ["composition_serves_muscles_not_owned_by_shadow_slot"] : []),
    ];

    return {
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      comparison: input.comparison,
      responsibilityLoad,
      underAllocatedMuscles,
      unallocatedStimulusMuscles,
      notes,
    };
  });
}

function buildShadowRepairMateriality(input: {
  repairMateriality: RepairMaterialityDiagnostic[];
  shadowWeeklyDemand: ShadowWeeklyMuscleDemand[];
  shadowSlotDemandAllocation: ShadowSlotDemandAllocation[];
}): ShadowRepairMaterialityDiagnostic[] {
  const demandByMuscle = new Map(input.shadowWeeklyDemand.map((row) => [row.muscle, row]));
  const allocationBySlotId = new Map(
    input.shadowSlotDemandAllocation.map((slot) => [slot.slotId, slot])
  );
  const allocatedMuscles = new Set(
    input.shadowSlotDemandAllocation.flatMap((slot) =>
      slot.allocatedMuscles.map((allocation) => allocation.muscle)
    )
  );

  return input.repairMateriality.map((row) => {
    const demand = row.muscle ? demandByMuscle.get(row.muscle) : undefined;
    const slotAllocation = row.slotId ? allocationBySlotId.get(row.slotId) : undefined;
    const sameSlotAllocation = slotAllocation?.allocatedMuscles.find(
      (allocation) => allocation.muscle === row.muscle
    );
    const materialRepair = row.materiality === "major" || row.materiality === "moderate";
    const likelyAvoidableWithShadowAllocation = Boolean(
      materialRepair &&
        row.muscle &&
        sameSlotAllocation &&
        (row.action === "added" || row.action === "set_bumped") &&
        sameSlotAllocation.targetStatus !== "diagnostic"
    );
    const shadowAllocationBasis: ShadowRepairMaterialityDiagnostic["shadowAllocationBasis"] =
      sameSlotAllocation
        ? "slot_owned_muscle_before_selection"
        : row.muscle && allocatedMuscles.has(row.muscle)
          ? "weekly_demand_owned_elsewhere"
          : row.materiality === "none" || row.action === "set_trimmed" || row.action === "removed"
            ? "diagnostic_or_cap_cleanup"
            : "not_shadow_allocated";

    return {
      ...row,
      likelyAvoidableWithShadowAllocation,
      shadowAllocationBasis,
      shadowRationale: [
        ...(sameSlotAllocation
          ? [`shadow_slot_allocation:${sameSlotAllocation.role}:${sameSlotAllocation.targetStatus}`]
          : []),
        ...(demand ? [`shadow_weekly_demand:${demand.priority}:${demand.targetStatus}`] : []),
        ...(likelyAvoidableWithShadowAllocation
          ? ["repair likely represents demand that should move upstream before exercise selection"]
          : ["repair remains cap cleanup, unowned stimulus, or unresolved by current shadow allocation"]),
      ],
    };
  });
}

function isMaterialRepair(row: Pick<RepairMaterialityDiagnostic, "materiality">): boolean {
  return row.materiality === "major" || row.materiality === "moderate";
}

function toSortedCountRecord(entries: string[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }
  return Object.fromEntries(
    Array.from(counts.entries()).sort(
      ([leftMuscle, leftCount], [rightMuscle, rightCount]) =>
        rightCount - leftCount || leftMuscle.localeCompare(rightMuscle)
    )
  );
}

function buildShadowRepairSummary(
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>
): ShadowRepairSummary {
  const materialRows = repairRows.filter(isMaterialRepair);
  const majorRows = repairRows.filter((row) => row.materiality === "major");
  const likelyAvoidableMaterialRows = materialRows.filter(
    (row) => row.likelyAvoidableWithShadowAllocation
  );
  const remainingMaterialRows = materialRows.filter(
    (row) => !row.likelyAvoidableWithShadowAllocation
  );
  const likelyAvoidableMajorRows = majorRows.filter(
    (row) => row.likelyAvoidableWithShadowAllocation
  );

  return {
    materialRepairCount: materialRows.length,
    majorRepairCount: majorRows.length,
    likelyAvoidableMaterialRepairCount: likelyAvoidableMaterialRows.length,
    remainingMaterialRepairCount: remainingMaterialRows.length,
    likelyAvoidableMajorRepairCount: likelyAvoidableMajorRows.length,
    remainingMajorRepairCount: majorRows.length - likelyAvoidableMajorRows.length,
    likelyAvoidableByMuscle: toSortedCountRecord(
      likelyAvoidableMaterialRows.flatMap((row) => (row.muscle ? [row.muscle] : []))
    ),
    remainingByMuscle: toSortedCountRecord(
      remainingMaterialRows.flatMap((row) => (row.muscle ? [row.muscle] : []))
    ),
  };
}

const UPPER_BODY_PROMOTION_MUSCLES = new Set([
  "Biceps",
  "Chest",
  "Front Delts",
  "Lats",
  "Rear Delts",
  "Side Delts",
  "Triceps",
  "Upper Back",
]);

const LOWER_BODY_PROMOTION_MUSCLES = new Set([
  "Abductors",
  "Adductors",
  "Calves",
  "Glutes",
  "Hamstrings",
  "Quads",
]);

function getSlotRegion(slot: ShadowSlotDemandAllocation | undefined): "upper" | "lower" | "other" {
  const slotArchetype = slot?.slotArchetype ?? "";
  const intent = slot?.intent ?? "";
  const slotId = slot?.slotId ?? "";
  if (
    slotArchetype.startsWith("upper_") ||
    intent.toLowerCase() === "upper" ||
    slotId.toLowerCase().startsWith("upper")
  ) {
    return "upper";
  }
  if (
    slotArchetype.startsWith("lower_") ||
    intent.toLowerCase() === "lower" ||
    slotId.toLowerCase().startsWith("lower")
  ) {
    return "lower";
  }
  return "other";
}

function buildSuspiciousRepairReasons(input: {
  row: ShadowRepairMaterialityDiagnostic;
  slotAllocation: ShadowSlotDemandAllocation | undefined;
}): string[] {
  const row = input.row;
  const reasons: string[] = [];
  const materialRepair = isMaterialRepair(row);
  const positiveRepair = row.action === "added" || row.action === "set_bumped";
  const muscle = row.muscle ?? "";
  const slotRegion = getSlotRegion(input.slotAllocation);

  if (
    materialRepair &&
    positiveRepair &&
    row.shadowAllocationBasis === "weekly_demand_owned_elsewhere"
  ) {
    reasons.push("shadow allocation marks this muscle as weekly_demand_owned_elsewhere");
  }
  if (
    materialRepair &&
    positiveRepair &&
    slotRegion === "lower" &&
    UPPER_BODY_PROMOTION_MUSCLES.has(muscle)
  ) {
    reasons.push("upper-body primary/support muscle was materially repaired into a lower-body slot");
  }
  if (
    materialRepair &&
    positiveRepair &&
    slotRegion === "upper" &&
    LOWER_BODY_PROMOTION_MUSCLES.has(muscle)
  ) {
    reasons.push("lower-body primary/support muscle was materially repaired into an upper-body slot");
  }
  if (
    materialRepair &&
    row.changedExerciseIdentity &&
    row.shadowAllocationBasis !== "slot_owned_muscle_before_selection"
  ) {
    reasons.push("repair added exercise identity in a slot that does not shadow-own the muscle");
  }
  if (
    materialRepair &&
    (row.action === "removed" ||
      row.action === "set_trimmed" ||
      row.shadowAllocationBasis === "diagnostic_or_cap_cleanup")
  ) {
    reasons.push("repair is cap cleanup, removal, or diagnostic collateral rather than promote-ready demand");
  }

  return Array.from(new Set(reasons));
}

function buildSuspiciousRepairs(input: {
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  shadowSlotDemandAllocation: ReadonlyArray<ShadowSlotDemandAllocation>;
}): SuspiciousRepairNotEligibleForPromotion[] {
  const allocationBySlotId = new Map(
    input.shadowSlotDemandAllocation.map((slot) => [slot.slotId, slot])
  );

  return input.repairRows
    .flatMap((row) => {
      if (!row.slotId || !row.muscle) {
        return [];
      }
      const reasons = buildSuspiciousRepairReasons({
        row,
        slotAllocation: allocationBySlotId.get(row.slotId),
      });
      if (reasons.length === 0) {
        return [];
      }
      return [{
        slotId: row.slotId,
        muscle: row.muscle,
        exerciseName: row.exerciseName,
        repairMechanism: row.repairMechanism,
        reason: reasons.join("; "),
        recommendation:
          "Do not promote this repair upstream; inspect slot ownership, compatibility, or cleanup cause first.",
      }];
    })
    .sort((left, right) =>
      left.slotId.localeCompare(right.slotId) ||
      left.muscle.localeCompare(right.muscle) ||
      (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "")
    );
}

function getPromotionSuggestion(
  row: ShadowRepairMaterialityDiagnostic,
  allocation: ShadowSlotDemandAllocation["allocatedMuscles"][number]
): PromotionCandidate["suggestedPromotion"] {
  if (allocation.role === "primary" && allocation.targetStatus === "hard") {
    return "slot_preselection_demand";
  }
  if (row.action === "set_bumped") {
    return "set_distribution_hint";
  }
  return row.changedExerciseIdentity ? "selection_scoring_hint" : "set_distribution_hint";
}

function buildPromotionCandidates(input: {
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  shadowWeeklyDemand: ReadonlyArray<ShadowWeeklyMuscleDemand>;
  shadowSlotDemandAllocation: ReadonlyArray<ShadowSlotDemandAllocation>;
  suspiciousRepairs: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
}): PromotionCandidate[] {
  const demandByMuscle = new Map(input.shadowWeeklyDemand.map((row) => [row.muscle, row]));
  const allocationBySlotId = new Map(
    input.shadowSlotDemandAllocation.map((slot) => [slot.slotId, slot])
  );
  const suspiciousKeys = new Set(
    input.suspiciousRepairs.map((row) =>
      `${row.slotId}:${row.muscle}:${row.exerciseName ?? ""}:${row.repairMechanism}`
    )
  );

  const candidates = input.repairRows
    .flatMap((row) => {
      if (!row.slotId || !row.muscle || !row.likelyAvoidableWithShadowAllocation) {
        return [];
      }
      const suspiciousKey = `${row.slotId}:${row.muscle}:${row.exerciseName ?? ""}:${row.repairMechanism}`;
      if (suspiciousKeys.has(suspiciousKey)) {
        return [];
      }
      const demand = demandByMuscle.get(row.muscle);
      if (!demand || demand.priority === "secondary" || demand.priority === "implicit") {
        return [];
      }
      const allocation = allocationBySlotId
        .get(row.slotId)
        ?.allocatedMuscles.find((entry) => entry.muscle === row.muscle);
      if (
        !allocation ||
        (allocation.role !== "primary" && allocation.role !== "support") ||
        allocation.targetStatus === "diagnostic"
      ) {
        return [];
      }
      const role = allocation.role;
      const targetStatus = allocation.targetStatus;
      return [{
        slotId: row.slotId,
        muscle: row.muscle,
        role,
        targetStatus,
        evidence: Array.from(
          new Set([
            `repair:${row.action}:${row.materiality}`,
            `mechanism:${row.repairMechanism}`,
            `shadow_allocation:${row.shadowAllocationBasis}`,
            ...row.shadowRationale,
          ])
        ),
        suggestedPromotion: getPromotionSuggestion(row, allocation),
      }];
    });
  const deduped = new Map<string, PromotionCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.slotId}:${candidate.muscle}:${candidate.role}:${candidate.targetStatus}:${candidate.suggestedPromotion}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }
    existing.evidence = Array.from(
      new Set([...existing.evidence, ...candidate.evidence])
    ).sort((left, right) => left.localeCompare(right));
  }

  return Array.from(deduped.values()).sort((left, right) =>
    left.slotId.localeCompare(right.slotId) ||
    left.muscle.localeCompare(right.muscle) ||
    left.suggestedPromotion.localeCompare(right.suggestedPromotion)
  );
}

function buildWeakPreselectionConsumption(input: {
  preselectionDemands: ReadonlyArray<PreselectionDemandDiagnosticLike>;
}): WeakPreselectionConsumptionDiagnostic[] {
  return input.preselectionDemands
    .filter((demand) => demand.consumedBySelection && !demand.targetMet)
    .map((demand) => ({
      slotId: demand.slotId,
      muscle: demand.muscle,
      role: demand.role ?? "support",
      targetStatus: demand.targetStatus ?? "soft",
      selectedEffectiveSets: demand.selectedEffectiveSets,
      preferredEffectiveSets: demand.preferredEffectiveSets ?? null,
      minEffectiveSets: demand.minEffectiveSets ?? null,
      targetMet: demand.targetMet,
      consumedBySelection: demand.consumedBySelection,
      reason: "consumed_but_target_not_met" as const,
    }))
    .sort((left, right) =>
      left.slotId.localeCompare(right.slotId) ||
      left.muscle.localeCompare(right.muscle) ||
      left.reason.localeCompare(right.reason)
    );
}

type MusclePrescription = SlotPrescriptionIntent["musclePrescriptions"][number];
type MovementLanePrescription = SlotPrescriptionIntent["movementLanePrescriptions"][number];

const DIAGNOSTIC_COLLATERAL_MUSCLES = [
  "Front Delts",
  "Upper Back",
  "Lower Back",
  "Glutes",
  "Forearms",
  "Core",
  "Adductors",
  "Abductors",
] as const;

const UPPER_SLOT_FORBIDDEN_MUSCLES = ["Quads", "Hamstrings", "Calves"] as const;
const LOWER_SLOT_FORBIDDEN_MUSCLES = [
  "Chest",
  "Lats",
  "Side Delts",
  "Rear Delts",
  "Triceps",
  "Biceps",
] as const;

function sortPrescriptionStrings(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function getSlotRegionFromIntent(input: {
  slotId: string;
  intent: string;
  slotArchetype: string | null | undefined;
}): "upper" | "lower" | "other" {
  const slotId = input.slotId.toLowerCase();
  const intent = input.intent.toLowerCase();
  const slotArchetype = input.slotArchetype ?? "";
  if (slotArchetype.startsWith("upper_") || ["upper", "push", "pull"].includes(intent) || slotId.startsWith("upper")) {
    return "upper";
  }
  if (slotArchetype.startsWith("lower_") || ["lower", "legs"].includes(intent) || slotId.startsWith("lower")) {
    return "lower";
  }
  return "other";
}

function getMusclePrescriptionTemplate(input: {
  muscle: string;
  slotRegion: "upper" | "lower" | "other";
  slotArchetype: string | null | undefined;
}): Pick<
  MusclePrescription,
  | "allowedPatterns"
  | "allowedExerciseClasses"
  | "forbiddenPatterns"
  | "forbiddenExerciseClasses"
  | "collateralLimits"
  | "reasons"
> {
  switch (input.muscle) {
    case "Chest":
      return input.slotRegion === "lower"
        ? {
            allowedPatterns: [],
            allowedExerciseClasses: [],
            forbiddenPatterns: ["horizontal_push", "vertical_push", "isolation"],
            forbiddenExerciseClasses: ["chest_fly", "chest_isolation", "press"],
            collateralLimits: [],
            reasons: ["lower_slot_does_not_own_chest", "blocked_repairs_should_not_become_valid_prescription"],
          }
        : {
            allowedPatterns: ["horizontal_push", "vertical_push", "isolation"],
            allowedExerciseClasses: ["chest_fly", "chest_isolation", "press"],
            forbiddenPatterns: [],
            forbiddenExerciseClasses: [],
            collateralLimits: [
              { muscle: "Front Delts", maxAddedEffectiveSets: 2 },
              { muscle: "Triceps", maxAddedEffectiveSets: 3 },
            ],
            reasons: ["upper_press_or_fly_slot_can_own_chest", "use_stimulus_profile_effective_sets"],
          };
    case "Lats":
      return {
        allowedPatterns: ["vertical_pull", "horizontal_pull"],
        allowedExerciseClasses: ["lat_pull", "row_with_lat_stimulus"],
        forbiddenPatterns: input.slotRegion === "lower" ? ["hinge", "squat", "lunge"] : [],
        forbiddenExerciseClasses: input.slotRegion === "lower" ? ["lower_body_compound"] : [],
        collateralLimits: [{ muscle: "Upper Back", maxAddedEffectiveSets: 3 }],
        reasons: [
          "upper_pull_lane_owned",
          "generic_upper_back_collateral_is_not_clean_lats_closure_without_stimulus_profile_support",
        ],
      };
    case "Side Delts":
      return {
        allowedPatterns: ["vertical_push", "isolation"],
        allowedExerciseClasses: ["lateral_raise", "vertical_press_overlap"],
        forbiddenPatterns: input.slotRegion === "lower" ? ["squat", "hinge", "lunge"] : [],
        forbiddenExerciseClasses: input.slotRegion === "lower" ? ["lower_body_compound"] : [],
        collateralLimits: [{ muscle: "Front Delts", maxAddedEffectiveSets: 2 }],
        reasons: [
          "compatible_upper_support",
          "direct_lateral_raise_and_vertical_press_overlap_allowed",
          "cap_duplicate_lateral_raise_identities_and_set_stacking",
        ],
      };
    case "Rear Delts":
      return {
        allowedPatterns: ["horizontal_pull", "vertical_pull", "isolation"],
        allowedExerciseClasses: ["rear_delt_isolation_when_slot_owned", "pull_overlap_with_direct_rear_delt_stimulus"],
        forbiddenPatterns: input.slotRegion === "lower" ? ["squat", "hinge", "lunge"] : [],
        forbiddenExerciseClasses: input.slotRegion === "lower" ? ["lower_body_compound"] : [],
        collateralLimits: [
          { muscle: "Upper Back", maxAddedEffectiveSets: 2 },
          { muscle: "Lats", maxAddedEffectiveSets: 2 },
        ],
        reasons: [
          "support_but_collateral_sensitive",
          "generic_rows_or_pulls_do_not_count_as_clean_direct_rear_delt_closure",
          "pull_pattern_pressure_must_remain_capped",
        ],
      };
    case "Triceps":
      return {
        allowedPatterns: ["horizontal_push", "vertical_push", "isolation"],
        allowedExerciseClasses: ["press_overlap", "triceps_isolation_if_under_floor"],
        forbiddenPatterns: [],
        forbiddenExerciseClasses: [],
        collateralLimits: [{ muscle: "Front Delts", maxAddedEffectiveSets: 2 }],
        reasons: ["prefer_pressing_overlap", "direct_isolation_only_if_below_support_floor", "do_not_replace_pull_biceps_or_slot_balance_work_for_triceps_closure"],
      };
    case "Biceps":
      return {
        allowedPatterns: ["vertical_pull", "horizontal_pull", "isolation"],
        allowedExerciseClasses: ["pull_overlap", "biceps_isolation_if_under_floor"],
        forbiddenPatterns: [],
        forbiddenExerciseClasses: [],
        collateralLimits: [
          { muscle: "Forearms", maxAddedEffectiveSets: 2 },
          { muscle: "Upper Back", maxAddedEffectiveSets: 2 },
        ],
        reasons: ["prefer_pulling_overlap", "direct_isolation_only_if_below_support_floor", "cap_forearm_collateral_and_pulling_redundancy"],
      };
    case "Quads":
      return {
        allowedPatterns: ["squat", "lunge", "isolation"],
        allowedExerciseClasses: ["squat", "lunge", "leg_extension"],
        forbiddenPatterns: input.slotRegion === "upper" ? ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"] : [],
        forbiddenExerciseClasses: input.slotRegion === "upper" ? ["upper_body_compound"] : [],
        collateralLimits: [
          { muscle: "Glutes", maxAddedEffectiveSets: 3 },
          { muscle: "Adductors", maxAddedEffectiveSets: 2 },
        ],
        reasons: ["hard_lower_primary", "protect_lower_slot_identity"],
      };
    case "Hamstrings":
      return {
        allowedPatterns: ["hinge", "isolation"],
        allowedExerciseClasses: ["hinge_compound", "knee_flexion_curl"],
        forbiddenPatterns: input.slotRegion === "upper" ? ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"] : [],
        forbiddenExerciseClasses: input.slotRegion === "upper" ? ["upper_body_compound"] : [],
        collateralLimits: [
          { muscle: "Lower Back", maxAddedEffectiveSets: 2 },
          { muscle: "Glutes", maxAddedEffectiveSets: 3 },
        ],
        reasons: ["hard_lower_primary", "hinge_stimulus_and_knee_flexion_curl_stimulus_are_distinct", "hinge_is_not_equivalent_to_curl"],
      };
    case "Calves":
      return {
        allowedPatterns: ["isolation"],
        allowedExerciseClasses: ["calf_raise"],
        forbiddenPatterns: input.slotRegion === "upper" ? ["horizontal_push", "vertical_push", "horizontal_pull", "vertical_pull"] : [],
        forbiddenExerciseClasses: input.slotRegion === "upper" ? ["upper_body_compound"] : [],
        collateralLimits: [],
        reasons: ["low_fatigue_direct_support", "distribute_across_lower_slots", "avoid_duplicate_calf_variants_unless_specialization_is_explicit"],
      };
    default:
      return {
        allowedPatterns: [],
        allowedExerciseClasses: [],
        forbiddenPatterns: [],
        forbiddenExerciseClasses: [],
        collateralLimits: [],
        reasons: ["diagnostic_collateral_only_unless_explicitly_slot_owned"],
      };
  }
}

function chooseDemandType(input: {
  muscle: string;
  role: ShadowSlotDemandAllocation["allocatedMuscles"][number]["role"];
  targetStatus: ShadowSlotDemandAllocation["allocatedMuscles"][number]["targetStatus"] | "forbidden";
  actualEffectiveSets: number;
  minEffectiveSets: number | null;
}): MusclePrescription["demandType"] {
  if (input.targetStatus === "forbidden") {
    return "do_not_train_here";
  }
  if (input.targetStatus === "diagnostic" || input.role === "implicit" || input.role === "secondary") {
    return "diagnostic_only";
  }
  if (input.muscle === "Triceps" || input.muscle === "Biceps") {
    return input.minEffectiveSets != null && input.actualEffectiveSets < input.minEffectiveSets
      ? "direct_if_under_floor"
      : "overlap_preferred";
  }
  if (input.muscle === "Side Delts") {
    return "soft_direct_allowed";
  }
  if (input.muscle === "Rear Delts" || input.muscle === "Calves") {
    return input.minEffectiveSets != null && input.actualEffectiveSets < input.minEffectiveSets
      ? "direct_if_under_floor"
      : "soft_direct_allowed";
  }
  return input.targetStatus === "hard" && input.role === "primary"
    ? "direct_required"
    : input.targetStatus === "hard"
      ? "overlap_preferred"
      : "soft_direct_allowed";
}

function buildOwnedMusclePrescription(input: {
  allocation: ShadowSlotDemandAllocation["allocatedMuscles"][number];
  projectedEffectiveStimulusByMuscle: Record<string, number>;
  slotRegion: "upper" | "lower" | "other";
  slotArchetype: string | null | undefined;
}): MusclePrescription {
  const actualEffectiveSets = input.projectedEffectiveStimulusByMuscle[input.allocation.muscle] ?? 0;
  const template = getMusclePrescriptionTemplate({
    muscle: input.allocation.muscle,
    slotRegion: input.slotRegion,
    slotArchetype: input.slotArchetype,
  });
  const demandType = chooseDemandType({
    muscle: input.allocation.muscle,
    role: input.allocation.role,
    targetStatus: input.allocation.targetStatus,
    actualEffectiveSets,
    minEffectiveSets: input.allocation.minEffectiveSets,
  });

  return {
    muscle: input.allocation.muscle,
    role: input.allocation.role,
    targetStatus: input.allocation.targetStatus,
    demandType,
    desiredEffectiveSets: input.allocation.preferredEffectiveSets,
    minEffectiveSets: input.allocation.minEffectiveSets,
    maxEffectiveSets: input.allocation.maxEffectiveSets,
    allowedPatterns: sortPrescriptionStrings(template.allowedPatterns),
    allowedExerciseClasses: sortPrescriptionStrings(template.allowedExerciseClasses),
    forbiddenPatterns: sortPrescriptionStrings(template.forbiddenPatterns),
    forbiddenExerciseClasses: sortPrescriptionStrings(template.forbiddenExerciseClasses),
    collateralLimits: template.collateralLimits,
    reasons: sortPrescriptionStrings([
      ...template.reasons,
      ...input.allocation.allocationReason,
      `current_projected_effective_sets:${roundToTenth(actualEffectiveSets)}`,
      `program_quality_soft_caps:main_${SOFT_MAIN_LIFT_SET_CAP}:accessory_${SOFT_ACCESSORY_SET_CAP}`,
      demandType,
    ]),
  };
}

function buildForbiddenMusclePrescription(input: {
  muscle: string;
  slotRegion: "upper" | "lower" | "other";
  slotArchetype: string | null | undefined;
}): MusclePrescription {
  const template = getMusclePrescriptionTemplate({
    muscle: input.muscle,
    slotRegion: input.slotRegion,
    slotArchetype: input.slotArchetype,
  });
  return {
    muscle: input.muscle,
    role: "collateral",
    targetStatus: "forbidden",
    demandType: "do_not_train_here",
    desiredEffectiveSets: null,
    minEffectiveSets: null,
    maxEffectiveSets: 0,
    allowedPatterns: [],
    allowedExerciseClasses: [],
    forbiddenPatterns: sortPrescriptionStrings(template.forbiddenPatterns),
    forbiddenExerciseClasses: sortPrescriptionStrings(template.forbiddenExerciseClasses),
    collateralLimits: [],
    reasons: sortPrescriptionStrings([
      ...template.reasons,
      "forbidden_cross_slot_target_chasing",
    ]),
  };
}

function buildCollateralPrescription(muscle: string): MusclePrescription {
  return {
    muscle,
    role: "collateral",
    targetStatus: "diagnostic",
    demandType: "diagnostic_only",
    desiredEffectiveSets: null,
    minEffectiveSets: null,
    maxEffectiveSets: null,
    allowedPatterns: [],
    allowedExerciseClasses: [],
    forbiddenPatterns: [],
    forbiddenExerciseClasses: [],
    collateralLimits: [{ muscle, maxAddedEffectiveSets: 2 }],
    reasons: [
      "diagnostic_collateral_only_unless_explicitly_slot_owned",
      "do_not_target_chase_from_planning_reality",
    ],
  };
}

function dedupeMusclePrescriptions(prescriptions: MusclePrescription[]): MusclePrescription[] {
  const order: Record<MusclePrescription["targetStatus"], number> = {
    hard: 0,
    soft: 1,
    forbidden: 2,
    diagnostic: 3,
  };
  const byMuscle = new Map<string, MusclePrescription>();
  for (const prescription of prescriptions) {
    const existing = byMuscle.get(prescription.muscle);
    if (!existing || order[prescription.targetStatus] < order[existing.targetStatus]) {
      byMuscle.set(prescription.muscle, prescription);
    }
  }
  return Array.from(byMuscle.values()).sort((left, right) => {
    const statusDelta = order[left.targetStatus] - order[right.targetStatus];
    return statusDelta || left.muscle.localeCompare(right.muscle);
  });
}

function toLaneFromPattern(pattern: string): MovementLanePrescription["lane"] | null {
  if (pattern === "horizontal_push" || pattern === "vertical_push") {
    return "press";
  }
  if (pattern === "horizontal_pull" || pattern === "vertical_pull") {
    return "pull";
  }
  if (pattern === "squat" || pattern === "lunge") {
    return "squat";
  }
  if (pattern === "hinge") {
    return "hinge";
  }
  if (pattern === "isolation") {
    return "isolation";
  }
  return null;
}

function appendLane(
  lanes: MovementLanePrescription[],
  lane: MovementLanePrescription
): void {
  const existing = lanes.find((entry) => entry.lane === lane.lane);
  if (!existing) {
    lanes.push(lane);
    return;
  }
  existing.required = existing.required || lane.required;
  existing.preferredPatterns = sortPrescriptionStrings([
    ...existing.preferredPatterns,
    ...lane.preferredPatterns,
  ]);
  existing.fallbackPatterns = sortPrescriptionStrings([
    ...existing.fallbackPatterns,
    ...lane.fallbackPatterns,
  ]);
  existing.maxSamePatternCount =
    existing.maxSamePatternCount == null
      ? lane.maxSamePatternCount
      : lane.maxSamePatternCount == null
        ? existing.maxSamePatternCount
        : Math.min(existing.maxSamePatternCount, lane.maxSamePatternCount);
}

function buildMovementLanePrescriptions(input: {
  slot: SlotSequenceEntry;
  musclePrescriptions: ReadonlyArray<MusclePrescription>;
  slotSequenceEntries: ReturnType<typeof buildSlotSequenceEntries>;
}): MovementLanePrescription[] {
  const slotPolicy = resolveSessionSlotPolicy({
    sessionIntent: toSessionIntent(input.slot.intent),
    slotId: input.slot.slotId,
    slotSequence: { slots: input.slotSequenceEntries },
  }).currentSession;
  const lanes: MovementLanePrescription[] = [];

  for (const lane of slotPolicy?.compoundControl?.lanes ?? []) {
    const resolvedLane: MovementLanePrescription["lane"] =
      lane.key === "press"
        ? "press"
        : lane.key === "pull"
          ? "pull"
          : slotPolicy?.slotArchetype === "lower_hinge_dominant"
            ? "hinge"
            : "squat";
    appendLane(lanes, {
      lane: resolvedLane,
      required: true,
      preferredPatterns: [...lane.preferredMovementPatterns],
      fallbackPatterns: [...lane.fallbackOnlyMovementPatterns],
      maxSamePatternCount: MAX_SAME_PATTERN_PER_SESSION,
    });
  }

  for (const pattern of slotPolicy?.sessionShape?.requiredMovementPatterns ?? []) {
    const lane = toLaneFromPattern(pattern);
    if (!lane) {
      continue;
    }
    appendLane(lanes, {
      lane,
      required: true,
      preferredPatterns: [pattern],
      fallbackPatterns: [],
      maxSamePatternCount: MAX_SAME_PATTERN_PER_SESSION,
    });
  }

  if (input.musclePrescriptions.some((prescription) => prescription.muscle === "Hamstrings" && prescription.targetStatus !== "forbidden")) {
    appendLane(lanes, {
      lane: "knee_flexion",
      required: false,
      preferredPatterns: ["isolation"],
      fallbackPatterns: ["hinge"],
      maxSamePatternCount: MAX_SAME_PATTERN_PER_SESSION,
    });
  }
  if (input.musclePrescriptions.some((prescription) => prescription.muscle === "Calves" && prescription.targetStatus !== "forbidden")) {
    appendLane(lanes, {
      lane: "calf",
      required: false,
      preferredPatterns: ["isolation"],
      fallbackPatterns: [],
      maxSamePatternCount: MAX_SAME_PATTERN_PER_SESSION,
    });
  }
  if (input.musclePrescriptions.some((prescription) =>
    ["soft_direct_allowed", "direct_if_under_floor"].includes(prescription.demandType)
  )) {
    appendLane(lanes, {
      lane: "isolation",
      required: false,
      preferredPatterns: ["isolation"],
      fallbackPatterns: [],
      maxSamePatternCount: MAX_SAME_PATTERN_PER_SESSION,
    });
  }

  return lanes.sort((left, right) => left.lane.localeCompare(right.lane));
}

function buildCollateralMaxByMuscle(input: {
  slotRegion: "upper" | "lower" | "other";
  musclePrescriptions: ReadonlyArray<MusclePrescription>;
}): Record<string, number> {
  const limits = new Map<string, number>();
  const seed =
    input.slotRegion === "lower"
      ? { "Lower Back": 2, Glutes: 4, Adductors: 2, Abductors: 2, Core: 2 }
      : input.slotRegion === "upper"
        ? { "Front Delts": 2, "Upper Back": 3, Forearms: 2, Core: 2 }
        : { Core: 2 };

  for (const [muscle, max] of Object.entries(seed)) {
    limits.set(muscle, max);
  }
  for (const prescription of input.musclePrescriptions) {
    for (const limit of prescription.collateralLimits) {
      limits.set(
        limit.muscle,
        Math.min(limits.get(limit.muscle) ?? limit.maxAddedEffectiveSets, limit.maxAddedEffectiveSets)
      );
    }
  }

  return Object.fromEntries(
    Array.from(limits.entries()).sort(([left], [right]) => left.localeCompare(right))
  );
}

function buildSlotDiagnosticRepairStrings(input: {
  slotId: string;
  musclePrescriptions: ReadonlyArray<MusclePrescription>;
  promotionCandidates: ReadonlyArray<PromotionCandidate>;
  suspiciousRepairs: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
}): SlotPrescriptionIntent["diagnostic"] {
  const blockedRepairs = input.suspiciousRepairs
    .filter((row) => row.slotId === input.slotId)
    .map((row) => {
      const prescription = input.musclePrescriptions.find(
        (entry) => entry.muscle === row.muscle
      );
      const reason = prescription?.targetStatus === "forbidden"
        ? "blocked_do_not_train_here"
        : "blocked_suspicious_not_promoted";
      return `${row.slotId}:${row.muscle}:${row.exerciseName ?? row.repairMechanism}:${reason}`;
    });
  const priorRepairsPrevented = input.promotionCandidates
    .filter((row) => row.slotId === input.slotId)
    .map((row) =>
      `${row.slotId}:${row.muscle}:${row.targetStatus === "hard" ? "direct_required" : "soft_direct_allowed"}:${row.suggestedPromotion}`
    );
  const priorRepairsStillRepairOwned = input.repairRows
    .filter((row) => row.slotId === input.slotId)
    .filter((row) => !row.likelyAvoidableWithShadowAllocation || row.action === "removed" || row.action === "set_trimmed")
    .map((row) => {
      const muscle = row.muscle ?? "week";
      const reason =
        row.action === "removed" || row.action === "set_trimmed" ||
        row.shadowAllocationBasis === "diagnostic_or_cap_cleanup"
          ? "cap_cleanup"
          : row.muscle === "Rear Delts" || row.muscle === "Upper Back"
            ? "pull_collateral"
            : row.shadowAllocationBasis === "weekly_demand_owned_elsewhere"
              ? "non_owned_stimulus"
              : "repair_cleanup";
      return `${row.slotId}:${muscle}:still_repair_owned_${reason}`;
    });

  return {
    priorRepairsPrevented: sortPrescriptionStrings(priorRepairsPrevented),
    priorRepairsStillRepairOwned: sortPrescriptionStrings(priorRepairsStillRepairOwned),
    blockedRepairs: sortPrescriptionStrings(blockedRepairs),
  };
}

function buildSlotPrescriptionIntents(input: {
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  slotDemandAllocation: ReadonlyArray<SlotDemandAllocationDiagnostic>;
  shadowSlotDemandAllocation: ReadonlyArray<ShadowSlotDemandAllocation>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRepairsNotEligibleForPromotion: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  promotionCandidates: ReadonlyArray<PromotionCandidate>;
}): SlotPrescriptionIntent[] {
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);
  const allocationBySlotId = new Map(
    input.shadowSlotDemandAllocation.map((slot) => [slot.slotId, slot])
  );
  const slotDemandBySlotId = new Map(
    input.slotDemandAllocation.map((slot) => [slot.slotId, slot])
  );
  const finalSlotBySlotId = new Map(input.finalSlotPlan.map((slot) => [slot.slotId, slot]));

  return input.slotSequence.map((slot, slotIndex) => {
    const shadowAllocation = allocationBySlotId.get(slot.slotId);
    const slotDemand = slotDemandBySlotId.get(slot.slotId);
    const slotRegion = getSlotRegionFromIntent({
      slotId: slot.slotId,
      intent: toSessionIntent(slot.intent),
      slotArchetype: shadowAllocation?.slotArchetype ?? slotDemand?.slotProfile.slotArchetype,
    });
    const ownedPrescriptions = (shadowAllocation?.allocatedMuscles ?? []).map((allocation) =>
      buildOwnedMusclePrescription({
        allocation,
        projectedEffectiveStimulusByMuscle: slotDemand?.projectedEffectiveStimulusByMuscle ?? {},
        slotRegion,
        slotArchetype: shadowAllocation?.slotArchetype ?? slotDemand?.slotProfile.slotArchetype,
      })
    );
    const ownedMuscles = new Set(ownedPrescriptions.map((prescription) => prescription.muscle));
    const forbiddenMuscles =
      slotRegion === "lower"
        ? LOWER_SLOT_FORBIDDEN_MUSCLES
        : slotRegion === "upper"
          ? UPPER_SLOT_FORBIDDEN_MUSCLES
          : [];
    const forbiddenPrescriptions = forbiddenMuscles
      .filter((muscle) => !ownedMuscles.has(muscle))
      .map((muscle) =>
        buildForbiddenMusclePrescription({
          muscle,
          slotRegion,
          slotArchetype: shadowAllocation?.slotArchetype ?? slotDemand?.slotProfile.slotArchetype,
        })
      );
    const collateralPrescriptions = DIAGNOSTIC_COLLATERAL_MUSCLES
      .filter((muscle) => !ownedMuscles.has(muscle))
      .map(buildCollateralPrescription);
    const musclePrescriptions = dedupeMusclePrescriptions([
      ...ownedPrescriptions,
      ...forbiddenPrescriptions,
      ...collateralPrescriptions,
    ]);
    const finalSlot = finalSlotBySlotId.get(slot.slotId);
    const fatigueBudget = shadowAllocation?.fatigueBudget ??
      getAllocationFatigueBudget(shadowAllocation?.slotArchetype ?? slotDemand?.slotProfile.slotArchetype);

    return {
      version: 1,
      slotId: slot.slotId,
      slotIndex,
      intent: toSessionIntent(slot.intent),
      slotArchetype: shadowAllocation?.slotArchetype ?? slotDemand?.slotProfile.slotArchetype ?? null,
      musclePrescriptions,
      movementLanePrescriptions: buildMovementLanePrescriptions({
        slot,
        musclePrescriptions,
        slotSequenceEntries,
      }),
      setBudget: {
        minTotalSets:
          MIN_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE +
          (SESSION_CAPS.minExercises - 1) * MIN_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
        preferredTotalSets: finalSlot?.totalSets ?? 0,
        maxTotalSets:
          MAX_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE +
          (SESSION_CAPS.maxExercises - 1) * MAX_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
        maxSetsPerMain: MAX_PROJECTED_MAIN_LIFT_SETS_PER_EXERCISE,
        maxSetsPerAccessory: MAX_PROJECTED_ACCESSORY_SETS_PER_EXERCISE,
        maxDirectIsolationExercises: 2,
      },
      diversityBudget: {
        maxExerciseShareByMuscle: MAX_SINGLE_EXERCISE_MUSCLE_SHARE,
        maxPatternShareByMuscle: MAX_SINGLE_PATTERN_MUSCLE_SHARE,
        maxDuplicateIsolationVariantsByMuscle: 1,
        maxDuplicateResistanceProfiles: 1,
      },
      fatigueBudget: {
        systemic: fatigueBudget?.systemic ?? "moderate",
        axial: fatigueBudget?.axial ?? "moderate",
        collateralMaxByMuscle: buildCollateralMaxByMuscle({
          slotRegion,
          musclePrescriptions,
        }),
      },
      diagnostic: buildSlotDiagnosticRepairStrings({
        slotId: slot.slotId,
        musclePrescriptions,
        promotionCandidates: input.promotionCandidates,
        suspiciousRepairs: input.suspiciousRepairsNotEligibleForPromotion,
        repairRows: input.repairMaterialityAfterShadowAllocation,
      }),
    };
  });
}

type SetDistributionMusclePolicy = SetDistributionIntent["musclePolicies"][number];

const SET_DISTRIBUTION_MAX_MAIN_LIFTS = 2;

function countDirectExercisesForMuscle(
  slot: SlotCompositionSnapshotDiagnostic | undefined,
  muscle: string
): number {
  return (
    slot?.exercises.filter((exercise) =>
      exercise.primaryMuscles.map(normalizeMuscle).includes(muscle)
    ).length ?? 0
  );
}

function getPreferredDistribution(input: {
  prescription: MusclePrescription;
  finalSlot: SlotCompositionSnapshotDiagnostic | undefined;
}): SetDistributionMusclePolicy["preferredDistribution"] {
  const muscle = input.prescription.muscle;
  if (input.prescription.targetStatus === "forbidden") {
    return "forbidden";
  }
  if (
    input.prescription.targetStatus === "diagnostic" ||
    input.prescription.demandType === "diagnostic_only"
  ) {
    return "diagnostic_only";
  }
  if (muscle === "Chest" || muscle === "Lats" || muscle === "Quads" || muscle === "Hamstrings") {
    return "two_exercise_split";
  }
  if (muscle === "Side Delts") {
    return countDirectExercisesForMuscle(input.finalSlot, muscle) > 1
      ? "two_exercise_split"
      : "overlap_first";
  }
  if (muscle === "Rear Delts" || muscle === "Calves") {
    return "direct_isolation_only_if_needed";
  }
  if (muscle === "Triceps" || muscle === "Biceps") {
    return "overlap_first";
  }
  return input.prescription.role === "primary"
    ? "single_anchor_plus_accessory"
    : "direct_isolation_only_if_needed";
}

function getWhenAtLimit(
  prescription: MusclePrescription
): SetDistributionMusclePolicy["whenAtLimit"] {
  const muscle = prescription.muscle;
  if (prescription.targetStatus === "forbidden") {
    return "do_not_bump";
  }
  if (
    prescription.targetStatus === "diagnostic" ||
    prescription.demandType === "diagnostic_only"
  ) {
    return "leave_unresolved";
  }
  if (muscle === "Triceps" || muscle === "Biceps") {
    return prescription.demandType === "direct_if_under_floor"
      ? "allow_if_no_clean_alternative"
      : "do_not_bump";
  }
  if (muscle === "Calves") {
    return "allow_if_no_clean_alternative";
  }
  return "prefer_alternative";
}

function getMaxDirectExercises(
  prescription: MusclePrescription
): number | null {
  if (prescription.targetStatus === "forbidden") {
    return 0;
  }
  if (prescription.targetStatus === "diagnostic") {
    return null;
  }
  if (
    prescription.muscle === "Chest" ||
    prescription.muscle === "Lats" ||
    prescription.muscle === "Quads" ||
    prescription.muscle === "Hamstrings"
  ) {
    return 2;
  }
  return 1;
}

function getMaxSetsPerExercise(input: {
  prescription: MusclePrescription;
  slotIntent: SlotPrescriptionIntent;
}): number | null {
  if (input.prescription.targetStatus === "forbidden") {
    return 0;
  }
  if (input.prescription.targetStatus === "diagnostic") {
    return null;
  }
  return input.prescription.role === "primary"
    ? input.slotIntent.setBudget.maxSetsPerMain
    : input.slotIntent.setBudget.maxSetsPerAccessory;
}

function formatConcentrationEvidenceRow(
  row: ExerciseConcentrationDiagnostic
): string[] {
  const highShareRows = Object.entries(row.percentageOfWeeklyProjectedStimulusByMuscle)
    .filter(([, percent]) => percent >= 50)
    .sort(([leftMuscle], [rightMuscle]) => leftMuscle.localeCompare(rightMuscle))
    .map(
      ([muscle, percent]) =>
        `${row.slotId}:${row.exerciseName}:${muscle}:${roundToTenth(percent)}%`
    );

  if (highShareRows.length > 0) {
    return highShareRows;
  }
  if (
    row.flags.includes("COMPOUND_GT_5_SETS") ||
    row.flags.includes("ISOLATION_GT_5_SETS")
  ) {
    return [`${row.slotId}:${row.exerciseName}:sets:${row.setCount}`];
  }
  return [];
}

function formatCapCleanupRow(row: ShadowRepairMaterialityDiagnostic): string {
  const slotId = row.slotId ?? "week";
  const exercise = row.exerciseName ?? row.exerciseId ?? "unknown exercise";
  const delta = row.rawSetDelta !== 0 ? row.rawSetDelta : row.action;
  return `${slotId}:${exercise}:${delta}`;
}

function formatStillRepairOwnedRow(row: ShadowRepairMaterialityDiagnostic): string | null {
  if (!row.muscle && !row.exerciseName && !row.exerciseId) {
    return null;
  }
  const slotId = row.slotId ?? "week";
  const exercise = row.exerciseName ?? row.exerciseId ?? "unknown exercise";
  const muscle = row.muscle ?? "unknown muscle";
  return `${slotId}:${exercise}:${muscle}:${row.shadowAllocationBasis}`;
}

function buildSetDistributionIntents(input: {
  slotPrescriptionIntents: ReadonlyArray<SlotPrescriptionIntent>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
}): SetDistributionIntent[] {
  const finalSlotById = new Map(input.finalSlotPlan.map((slot) => [slot.slotId, slot]));
  const concentrationRowsBySlotId = new Map<string, string[]>();
  for (const row of input.exerciseConcentration) {
    for (const evidence of formatConcentrationEvidenceRow(row)) {
      concentrationRowsBySlotId.set(row.slotId, [
        ...(concentrationRowsBySlotId.get(row.slotId) ?? []),
        evidence,
      ]);
    }
  }
  const capCleanupRowsBySlotId = new Map<string, string[]>();
  const stillRepairRowsBySlotId = new Map<string, string[]>();
  for (const row of input.repairMaterialityAfterShadowAllocation) {
    if (!row.slotId) {
      continue;
    }
    if (row.action === "set_trimmed" || row.action === "removed") {
      capCleanupRowsBySlotId.set(row.slotId, [
        ...(capCleanupRowsBySlotId.get(row.slotId) ?? []),
        formatCapCleanupRow(row),
      ]);
    }
    if (
      !row.likelyAvoidableWithShadowAllocation ||
      row.action === "set_trimmed" ||
      row.action === "removed"
    ) {
      const evidence = formatStillRepairOwnedRow(row);
      if (!evidence) {
        continue;
      }
      stillRepairRowsBySlotId.set(row.slotId, [
        ...(stillRepairRowsBySlotId.get(row.slotId) ?? []),
        evidence,
      ]);
    }
  }

  return input.slotPrescriptionIntents.map((slotIntent) => {
    const finalSlot = finalSlotById.get(slotIntent.slotId);
    return {
      version: 1,
      slotId: slotIntent.slotId,
      slotIndex: slotIntent.slotIndex,
      intent: slotIntent.intent,
      slotArchetype: slotIntent.slotArchetype,
      musclePolicies: slotIntent.musclePrescriptions.map((prescription) => ({
        muscle: prescription.muscle,
        role: prescription.role,
        targetStatus: prescription.targetStatus,
        demandType: prescription.demandType,
        preferredEffectiveSets: prescription.desiredEffectiveSets,
        minEffectiveSets: prescription.minEffectiveSets,
        maxEffectiveSets: prescription.maxEffectiveSets,
        maxSingleExerciseShare:
          prescription.targetStatus === "diagnostic"
            ? null
            : slotIntent.diversityBudget.maxExerciseShareByMuscle,
        maxSinglePatternShare:
          prescription.targetStatus === "diagnostic"
            ? null
            : slotIntent.diversityBudget.maxPatternShareByMuscle,
        maxSetsPerExercise: getMaxSetsPerExercise({ prescription, slotIntent }),
        maxDirectExercises: getMaxDirectExercises(prescription),
        maxDuplicateExerciseClasses:
          prescription.targetStatus === "diagnostic"
            ? null
            : prescription.targetStatus === "forbidden"
              ? 0
              : slotIntent.diversityBudget.maxDuplicateIsolationVariantsByMuscle,
        preferredDistribution: getPreferredDistribution({ prescription, finalSlot }),
        whenAtLimit: getWhenAtLimit(prescription),
      })),
      slotBudget: {
        preferredTotalSets: slotIntent.setBudget.preferredTotalSets,
        maxTotalSets: slotIntent.setBudget.maxTotalSets,
        maxMainLifts: Math.min(SET_DISTRIBUTION_MAX_MAIN_LIFTS, SESSION_CAPS.maxExercises),
        maxAccessories: Math.max(0, SESSION_CAPS.maxExercises - 1),
        maxDirectIsolationExercises: slotIntent.setBudget.maxDirectIsolationExercises ?? 0,
      },
      evidence: {
        concentrationRows: sortPrescriptionStrings(
          concentrationRowsBySlotId.get(slotIntent.slotId) ?? []
        ),
        capCleanupRows: sortPrescriptionStrings(
          capCleanupRowsBySlotId.get(slotIntent.slotId) ?? []
        ),
        repairRowsStillRepairOwned: sortPrescriptionStrings(
          stillRepairRowsBySlotId.get(slotIntent.slotId) ?? []
        ),
      },
      readOnly: true,
      affectsScoringOrGeneration: false,
    };
  });
}

type DistributionPolicyWeek =
  PreselectionDistributionPolicyByWeek["weeks"][number];
type DistributionPolicySlot = DistributionPolicyWeek["slots"][number];
type DistributionPolicyMuscle =
  DistributionPolicySlot["muscleDistributions"][number];
type SlotMusclePrescription =
  SlotPrescriptionIntent["musclePrescriptions"][number];
type SetDistributionPolicy = SetDistributionIntent["musclePolicies"][number];

function getDiagnosticMesocycleId(
  activeMesocycle: ActiveMesocycleForDiagnostics,
): string | null {
  const value = (activeMesocycle as { id?: unknown }).id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getDiagnosticDurationWeeks(
  activeMesocycle: ActiveMesocycleForDiagnostics,
): number {
  const value = (activeMesocycle as { durationWeeks?: unknown }).durationWeeks;
  return typeof value === "number" && Number.isFinite(value) && value >= 2
    ? Math.floor(value)
    : 5;
}

function toPolicyRole(
  role: SlotMusclePrescription["role"],
): DistributionPolicyMuscle["role"] {
  return role === "primary" || role === "support" ? role : "collateral";
}

function toPreferredSetSplit(
  preferredDistribution: SetDistributionPolicy["preferredDistribution"],
): DistributionPolicyMuscle["preferredSetSplit"] {
  switch (preferredDistribution) {
    case "single_anchor_plus_accessory":
      return "anchor_plus_isolation";
    case "two_exercise_split":
      return "two_distinct_exercises";
    case "overlap_first":
    case "direct_isolation_only_if_needed":
      return "overlap_first_then_isolation";
    case "diagnostic_only":
      return "diagnostic_only";
    case "forbidden":
      return "forbidden";
  }
}

function uniqueSorted(values: ReadonlyArray<string>): string[] {
  return Array.from(
    new Set(values.filter((value) => value.trim().length > 0)),
  ).sort((left, right) => left.localeCompare(right));
}

function exerciseMatchesMuscle(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number],
  muscle: string,
): boolean {
  return exercise.primaryMuscles.map(normalizeMuscle).includes(muscle);
}

function findDuplicateRowsForMuscle(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  policy: SetDistributionPolicy;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): DuplicateExerciseReuseDiagnostic[] {
  if (!input.slot) {
    return [];
  }
  const exerciseIds = new Set(
    input.slot.exercises
      .filter((exercise) => exerciseMatchesMuscle(exercise, input.policy.muscle))
      .flatMap((exercise) => [exercise.exerciseId, exercise.exerciseName]),
  );
  return input.duplicateExerciseReuse.filter(
    (row) =>
      row.repeatedInSlotId === input.slot?.slotId &&
      (exerciseIds.has(row.exerciseId) || exerciseIds.has(row.name)),
  );
}

function chooseDuplicatePolicy(input: {
  policy: SetDistributionPolicy;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): DistributionPolicyMuscle["duplicatePolicy"] {
  if (input.policy.targetStatus === "forbidden") {
    return "block_duplicate_if_alternative_exists";
  }
  if (
    input.duplicateRows.some(
      (row) => row.hasCompatibleAlternative && row.role === "main",
    )
  ) {
    return "block_duplicate_if_alternative_exists";
  }
  if (
    input.duplicateRows.length > 0 ||
    input.policy.muscle === "Calves" ||
    input.policy.muscle === "Side Delts"
  ) {
    return "discourage_if_alternative_exists";
  }
  return "allow_continuity";
}

function buildDistributionEvidence(input: {
  slotId: string;
  policy: SetDistributionPolicy;
  prescription?: SlotMusclePrescription;
  setDistributionIntent: SetDistributionIntent;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  warnings: SlotPlanPlanningRealityDiagnostic["warnings"];
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): string[] {
  const delivery = input.projectedDelivery.find(
    (row) => row.muscle === input.policy.muscle,
  );
  const warningEvidence = input.warnings.flatMap((warning) => {
    const evidence = warning.evidence.filter((entry) =>
      entry.includes(input.policy.muscle),
    );
    return evidence.map((entry) => `${warning.code}:${entry}`);
  });
  const distributionEvidence = [
    ...input.setDistributionIntent.evidence.concentrationRows.filter((row) =>
      row.includes(input.policy.muscle),
    ),
    ...input.setDistributionIntent.evidence.repairRowsStillRepairOwned.filter(
      (row) => row.includes(input.policy.muscle),
    ),
  ];
  const duplicateEvidence = input.duplicateRows.map(
    (row) =>
      `duplicate:${row.name}:role=${row.role}:previous=${row.previousSlotIds.join("+")}:alternative=${row.hasCompatibleAlternative}`,
  );

  return uniqueSorted([
    `${input.slotId}:${input.policy.muscle}:${input.policy.targetStatus}:${input.policy.demandType}`,
    ...(delivery
      ? [
          `projectedDelivery:${input.policy.muscle}:initial=${formatNullableNumber(delivery.projectedEffectiveStimulusAfterInitialSlotComposition)}:final=${delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping}:target=${formatNullableNumber(delivery.preferredTarget)}`,
        ]
      : []),
    ...(input.prescription?.reasons ?? []),
    ...distributionEvidence,
    ...warningEvidence,
    ...duplicateEvidence,
  ]);
}

function formatNullableNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "null";
}

function buildWeekOnePolicySlots(input: {
  slotPrescriptionIntents: ReadonlyArray<SlotPrescriptionIntent>;
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  warnings: SlotPlanPlanningRealityDiagnostic["warnings"];
}): DistributionPolicySlot[] {
  const prescriptionBySlotId = new Map(
    input.slotPrescriptionIntents.map((slot) => [slot.slotId, slot]),
  );
  const finalSlotById = new Map(
    input.finalSlotPlan.map((slot) => [slot.slotId, slot]),
  );

  return input.setDistributionIntents.map((intent) => {
    const slotPrescription = prescriptionBySlotId.get(intent.slotId);
    const finalSlot = finalSlotById.get(intent.slotId);
    return {
      slotId: intent.slotId,
      slotArchetype: intent.slotArchetype ?? "unknown",
      muscleDistributions: intent.musclePolicies.map((policy) => {
        const prescription = slotPrescription?.musclePrescriptions.find(
          (row) => row.muscle === policy.muscle,
        );
        const duplicateRows = findDuplicateRowsForMuscle({
          slot: finalSlot,
          policy,
          duplicateExerciseReuse: input.duplicateExerciseReuse,
        });
        const requiredExerciseClasses =
          policy.targetStatus === "hard" &&
          policy.demandType === "direct_required"
            ? (prescription?.allowedExerciseClasses ?? [])
            : [];
        const preferredExerciseClasses =
          requiredExerciseClasses.length === 0
            ? (prescription?.allowedExerciseClasses ?? [])
            : [];
        const forbiddenExerciseClasses =
          prescription?.forbiddenExerciseClasses ?? [];

        return {
          muscle: policy.muscle,
          targetStatus: policy.targetStatus,
          role: toPolicyRole(policy.role),
          demandType: policy.demandType,
          targetEffectiveSets: policy.preferredEffectiveSets,
          minEffectiveSets: policy.minEffectiveSets,
          maxEffectiveSets: policy.maxEffectiveSets,
          ...(requiredExerciseClasses.length > 0
            ? { requiredExerciseClasses }
            : {}),
          ...(preferredExerciseClasses.length > 0
            ? { preferredExerciseClasses }
            : {}),
          ...(forbiddenExerciseClasses.length > 0
            ? { forbiddenExerciseClasses }
            : {}),
          maxSingleExerciseShare: policy.maxSingleExerciseShare,
          maxSinglePatternShare: policy.maxSinglePatternShare,
          preferredSetSplit: toPreferredSetSplit(policy.preferredDistribution),
          duplicatePolicy: chooseDuplicatePolicy({ policy, duplicateRows }),
          unresolvedBehavior:
            policy.whenAtLimit === "leave_unresolved" ||
            policy.targetStatus === "forbidden"
              ? "leave_unresolved"
              : "allow_repair_safety_net",
          affects: {
            volumeProgression: policy.targetStatus === "hard",
            exerciseContinuity:
              duplicateRows.length > 0 || policy.targetStatus !== "diagnostic",
            setDistribution:
              policy.targetStatus === "hard" || policy.targetStatus === "soft",
            fatigueManagement:
              duplicateRows.length > 0 ||
              policy.muscle === "Hamstrings" ||
              policy.muscle === "Lower Back" ||
              policy.muscle === "Glutes",
            deloadPreservation:
              policy.targetStatus === "hard" ||
              duplicateRows.some((row) => row.role === "main"),
            runtimeAdaptation: false,
          },
          evidence: buildDistributionEvidence({
            slotId: intent.slotId,
            policy,
            prescription,
            setDistributionIntent: intent,
            projectedDelivery: input.projectedDelivery,
            warnings: input.warnings,
            duplicateRows,
          }),
          limitations: [
            "week_1_evidence_only",
            "diagnostic_shadow_policy_not_behavior",
            "does_not_affect_scoring_generation_repair_seed_or_runtime",
          ],
        };
      }),
    };
  });
}

function buildWeekOnePolicyWarnings(input: {
  warnings: SlotPlanPlanningRealityDiagnostic["warnings"];
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
}): string[] {
  const calfExerciseKeys = new Set(
    input.finalSlotPlan.flatMap((slot) =>
      slot.exercises
        .filter((exercise) => exerciseMatchesMuscle(exercise, "Calves"))
        .flatMap((exercise) => [
          `${slot.slotId}:${exercise.exerciseId}`,
          `${slot.slotId}:${exercise.exerciseName}`,
        ]),
    ),
  );
  const duplicateWarnings = input.duplicateExerciseReuse.flatMap((row) => {
    const base =
      row.role === "main"
        ? [
            `duplicate_main_lift_pressure:${row.name}:${row.previousSlotIds.join("+")}->${row.repeatedInSlotId}`,
          ]
        : [];
    const calfDuplicate = calfExerciseKeys.has(`${row.repeatedInSlotId}:${row.exerciseId}`) ||
      calfExerciseKeys.has(`${row.repeatedInSlotId}:${row.name}`)
        ? [
            `calf_duplicate_isolation_pressure:${row.name}:${row.previousSlotIds.join("+")}->${row.repeatedInSlotId}`,
          ]
        : [];
    return [...base, ...calfDuplicate];
  });
  const shapeWarnings = input.warnings.flatMap((warning) =>
    warning.evidence.length > 0
      ? warning.evidence.map((entry) => `${warning.code}:${entry}`)
      : [warning.code],
  );
  return uniqueSorted([...shapeWarnings, ...duplicateWarnings]);
}

function buildUnprojectedWeek(input: {
  week: number;
  phase: DistributionPolicyWeek["phase"];
  projectionStatus: DistributionPolicyWeek["projectionStatus"];
  weekScope: DistributionPolicyWeek["weekScope"];
  warnings: string[];
}): DistributionPolicyWeek {
  return {
    week: input.week,
    phase: input.phase,
    projectionStatus: input.projectionStatus,
    weekScope: input.weekScope,
    slots: [],
    weekLevelWarnings: input.warnings,
  };
}

function buildCandidateBehaviorSlices(): PreselectionDistributionPolicyByWeek["candidateBehaviorSlices"] {
  return [
    {
      candidate: "chest_upper_slot_distinct_exercise_distribution",
      weekScope: "accumulation_weeks",
      expectedBenefit:
        "Chest is a hard primary target, is currently under target, direct Chest evidence is concentrated in repeated Incline DB Bench exposure, and lower-slot Chest repair is blocked; a projected week-by-week distinct upper-slot press/fly distribution is the safest future behavior slice.",
      risk:
        "Implementing it before weekly projection would optimize Week 1 evidence while pretending to solve the whole mesocycle.",
      prereqs: [
        "inventory/class visibility for distinct chest press/fly options",
        "week-by-week Chest demand",
        "duplicate continuity justification",
      ],
      recommendation: "best_future_behavior",
    },
    {
      candidate: "hamstrings_weekly_overdelivery_control",
      weekScope: "accumulation_weeks",
      expectedBenefit:
        "Could cap weekly Hamstrings overdelivery once demand curves and carryover exist.",
      risk:
        "Hamstrings are already high and lower_b recently improved through a clean curl route; starting here risks breaking the hinge/curl distinction or broadening Hamstrings demand.",
      prereqs: [
        "week-by-week Hamstrings demand",
        "hinge versus knee-flexion preservation checks",
        "fatigue carryover model",
      ],
      recommendation: "not_first",
    },
    {
      candidate: "side_delt_second_slot_support",
      weekScope: "accumulation_weeks",
      expectedBenefit:
        "Can make the successful upper_b Side Delts support path visible across the block without relying on late support-floor repair.",
      risk:
        "Side Delts remain low, but behavior needs an OHP/lateral-raise spam guard before promotion.",
      prereqs: [
        "per-week Side Delts support demand",
        "duplicate lateral-raise pressure visibility",
        "press-overlap versus isolation split policy",
      ],
      recommendation: "diagnostic_only",
    },
    {
      candidate: "duplicate_main_lift_suppression",
      weekScope: "whole_mesocycle",
      expectedBenefit:
        "Would reduce repeated anchor fatigue across accumulation weeks and improve exercise diversity.",
      risk:
        "High leverage but high blast radius; needs a persisted duplicate-continuity justification model before it can safely alter selection.",
      prereqs: [
        "persisted duplicate justification model",
        "week-by-week anchor continuity policy",
        "deload identity preservation expectations",
      ],
      recommendation: "not_first",
    },
    {
      candidate: "calf_duplicate_suppression",
      weekScope: "accumulation_weeks",
      expectedBenefit:
        "Would reduce duplicate calf-isolation noise once larger distribution policy is in place.",
      risk:
        "Low architecture leverage compared with hard primary distribution and duplicate main-lift fatigue.",
      prereqs: [
        "per-week Calves support demand",
        "duplicate isolation variant visibility",
        "slot capacity after hard primary floors",
      ],
      recommendation: "later_cleanup",
    },
  ];
}

function getDiagnosticStringField(
  activeMesocycle: ActiveMesocycleForDiagnostics,
  field: "intensityBias" | "focus" | "volumeTarget" | "splitType",
): string | null {
  const value = (activeMesocycle as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getDiagnosticNumberField(
  activeMesocycle: ActiveMesocycleForDiagnostics,
  field: "sessionsPerWeek",
): number | null {
  const value = (activeMesocycle as Record<string, unknown>)[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toWeeklyDemandRole(
  priority: ShadowWeeklyMuscleDemand["priority"],
): WeeklyDemandCurve["weeks"][number]["muscles"][number]["role"] {
  return priority === "primary" ||
    priority === "support" ||
    priority === "secondary"
    ? priority
    : "implicit";
}

function getWeeklyDemandCurvePhase(input: {
  week: number;
  durationWeeks: number;
}): WeeklyDemandCurve["weeks"][number]["phase"] {
  if (input.week === 1) {
    return "entry";
  }
  if (input.week === input.durationWeeks) {
    return "deload";
  }
  if (input.week === input.durationWeeks - 1) {
    return "peak";
  }
  if (input.week > 1 && input.week < input.durationWeeks) {
    return "accumulation";
  }
  return "unknown";
}

function getWeeklyDemandCurveProgressionIntent(input: {
  phase: WeeklyDemandCurve["weeks"][number]["phase"];
  targetStatus: ShadowWeeklyMuscleDemand["targetStatus"];
}): WeeklyDemandCurve["weeks"][number]["muscles"][number]["progressionIntent"] {
  if (input.targetStatus === "diagnostic") {
    return "diagnostic_only";
  }
  switch (input.phase) {
    case "entry":
      return "hold";
    case "accumulation":
      return "increase";
    case "peak":
      return "peak";
    case "deload":
      return "deload";
    case "unknown":
      return "diagnostic_only";
  }
}

function getWeekLevelLimitations(
  phase: WeeklyDemandCurve["weeks"][number]["phase"],
): string[] {
  if (phase === "entry") {
    return [
      "week_1_current_projection_evidence_only",
      "does_not_affect_scoring_generation_repair_seed_or_runtime",
    ];
  }
  if (phase === "deload") {
    return [
      "missing_deload_demand_curve",
      "missing_deload_identity_preservation_policy",
      "missing_deload_set_reduction_projection",
      "does_not_affect_scoring_generation_repair_seed_or_runtime",
    ];
  }
  return [
    "partially_projected_from_week_1",
    "missing_per_week_slot_distribution",
    "missing_fatigue_carryover_model",
    "missing_cross_week_exercise_continuity_policy",
    "does_not_affect_scoring_generation_repair_seed_or_runtime",
  ];
}

function getWeeklyDemandCurveProjectionStatus(
  phase: WeeklyDemandCurve["weeks"][number]["phase"],
): WeeklyDemandCurve["weeks"][number]["projectionStatus"] {
  if (phase === "deload") {
    return "not_projected_missing_policy";
  }
  return "partially_projected_from_week_1";
}

function getPolicyTargetForCurve(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  demand: ShadowWeeklyMuscleDemand;
  week: number;
  phase: WeeklyDemandCurve["weeks"][number]["phase"];
}): {
  minEffectiveSets: number | null;
  preferredEffectiveSets: number | null;
  maxEffectiveSets: number | null;
  source: string[];
  limitations: string[];
} {
  const source = [...input.demand.source];
  const limitations: string[] = [];

  if (input.phase === "deload") {
    return {
      minEffectiveSets: null,
      preferredEffectiveSets: null,
      maxEffectiveSets: null,
      source: uniqueSorted([...source, "deload_week_present_but_demand_curve_unprojected"]),
      limitations: [
        "missing_deload_demand_curve",
        "missing_deload_identity_preservation_policy",
        "missing_deload_set_reduction_projection",
      ],
    };
  }

  if (input.demand.targetStatus === "hard") {
    source.push(`getWeeklyVolumeTarget(week=${input.week})`);
    limitations.push(
      "volume_target_policy_visible_but_slot_distribution_policy_missing",
    );
    return {
      minEffectiveSets: input.demand.minEffectiveSets,
      preferredEffectiveSets: roundToTenth(
        getWeeklyVolumeTarget(
          input.activeMesocycle,
          input.demand.muscle,
          input.week,
        ),
      ),
      maxEffectiveSets: input.demand.maxEffectiveSets,
      source: uniqueSorted(source),
      limitations,
    };
  }

  if (input.demand.targetStatus === "soft") {
    limitations.push(
      "support_floor_not_scaled_by_week",
      "missing_per_week_support_demand_policy",
    );
  } else {
    limitations.push(
      "diagnostic_collateral_readout_only_not_hard_demand",
    );
  }

  return {
    minEffectiveSets: input.demand.minEffectiveSets,
    preferredEffectiveSets: input.demand.preferredEffectiveSets,
    maxEffectiveSets: input.demand.maxEffectiveSets,
    source: uniqueSorted(source),
    limitations,
  };
}

function formatCurveEvidenceForDelivery(
  delivery: ProjectedDeliveryDiagnostic | undefined,
): string[] {
  if (!delivery) {
    return [];
  }
  const target =
    delivery.preferredTarget == null ? "null" : String(delivery.preferredTarget);
  return [
    `week1_final=${delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping}:preferred=${target}`,
    ...delivery.majorContributingExercises
      .slice(0, 2)
      .map(
        (row) =>
          `week1_contributor=${row.slotId}:${row.exerciseName}:${row.effectiveStimulus}`,
      ),
  ];
}

function addWeeklyDemandCurveWarning(
  warnings: WeeklyDemandCurve["crossWeekWarnings"],
  warning: WeeklyDemandCurve["crossWeekWarnings"][number],
): void {
  const key = `${warning.code}:${warning.muscle ?? ""}`;
  if (
    warnings.some(
      (existing) => `${existing.code}:${existing.muscle ?? ""}` === key,
    )
  ) {
    return;
  }
  warnings.push(warning);
}

function buildWeeklyDemandCurveWarnings(input: {
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): WeeklyDemandCurve["crossWeekWarnings"] {
  const warnings: WeeklyDemandCurve["crossWeekWarnings"] = [];
  const deliveryByMuscle = new Map(
    input.projectedDelivery.map((row) => [row.muscle, row]),
  );

  for (const delivery of input.projectedDelivery) {
    if (delivery.preferredTarget == null) {
      continue;
    }
    const evidence = formatCurveEvidenceForDelivery(delivery);
    if (
      delivery.targetStatus === "hard" &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
        delivery.preferredTarget
    ) {
      addWeeklyDemandCurveWarning(warnings, {
        code: "PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION",
        muscle: delivery.muscle,
        evidence: [
          ...evidence,
          "if_week_1_distribution_repeats_accumulation_shortfall_persists",
        ],
        severity: "warning",
      });
    }
    if (
      delivery.targetStatus === "hard" &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping >
        delivery.preferredTarget + 1e-9
    ) {
      addWeeklyDemandCurveWarning(warnings, {
        code: "MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION",
        muscle: delivery.muscle,
        evidence: [
          ...evidence,
          "if_week_1_distribution_repeats_accumulation_overdelivery_persists",
        ],
        severity:
          delivery.muscle === "Hamstrings" ? "warning" : "info",
      });
    }
    if (
      delivery.targetStatus === "soft" &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
        delivery.preferredTarget
    ) {
      addWeeklyDemandCurveWarning(warnings, {
        code: "SUPPORT_UNDER_TARGET_ACROSS_ACCUMULATION",
        muscle: delivery.muscle,
        evidence: [
          ...evidence,
          "support_floor_still_under_target_if_week_1_repeats",
        ],
        severity:
          delivery.muscle === "Side Delts" ? "warning" : "info",
      });
    }
  }

  const fatigueConcentrationRows = input.exerciseConcentration.filter((row) =>
    row.flags.some(
      (flag) =>
        flag === "COMPOUND_GT_5_SETS" ||
        flag === "ISOLATION_GT_5_SETS" ||
        flag.includes("EXERCISE_SUPPLIES_OVER"),
    ),
  );
  if (fatigueConcentrationRows.length > 0) {
    addWeeklyDemandCurveWarning(warnings, {
      code: "DUPLICATE_EXERCISE_FATIGUE_RISK",
      evidence: fatigueConcentrationRows
        .slice(0, 6)
        .map(
          (row) =>
            `${row.slotId}:${row.exerciseName}:${row.setCount} sets:${row.flags.join("+")}`,
        ),
      severity: "warning",
    });
  }

  for (const muscle of ["Glutes", "Front Delts", "Lower Back", "Upper Back"]) {
    const delivery = deliveryByMuscle.get(muscle);
    if (
      delivery &&
      delivery.targetStatus === "diagnostic" &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping > 0
    ) {
      addWeeklyDemandCurveWarning(warnings, {
        code: "MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION",
        muscle,
        evidence: [
          ...formatCurveEvidenceForDelivery(delivery),
          "diagnostic_collateral_risk_only_not_hard_demand",
        ],
        severity: "info",
      });
    }
  }

  addWeeklyDemandCurveWarning(warnings, {
    code: "DELOAD_PRESERVATION_UNPROJECTED",
    evidence: [
      "missing_deload_demand_curve",
      "missing_deload_identity_preservation_policy",
      "missing_deload_set_reduction_projection",
    ],
    severity: "warning",
  });
  addWeeklyDemandCurveWarning(warnings, {
    code: "WEEKLY_DEMAND_POLICY_MISSING",
    evidence: [
      "weeks_2_to_4_have_volume_target_visibility_but_missing_per_week_slot_distribution",
      "missing_fatigue_carryover_model",
      "missing_cross_week_exercise_continuity_policy",
    ],
    severity: "info",
  });

  return warnings.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.muscle ?? "").localeCompare(right.muscle ?? ""),
  );
}

function buildWeeklyDemandCurve(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  shadowWeeklyDemand: ReadonlyArray<ShadowWeeklyMuscleDemand>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): WeeklyDemandCurve {
  const durationWeeks = getDiagnosticDurationWeeks(input.activeMesocycle);
  const deliveryByMuscle = new Map(
    input.projectedDelivery.map((row) => [row.muscle, row]),
  );
  const warnings = buildWeeklyDemandCurveWarnings({
    projectedDelivery: input.projectedDelivery,
    exerciseConcentration: input.exerciseConcentration,
  });

  return {
    mesocycleId: getDiagnosticMesocycleId(input.activeMesocycle),
    source: "diagnostic_shadow_planner",
    readOnly: true,
    affectsScoringOrGeneration: false,
    designBasis: {
      durationWeeks,
      intensityBias: getDiagnosticStringField(input.activeMesocycle, "intensityBias"),
      focus: getDiagnosticStringField(input.activeMesocycle, "focus"),
      volumeTarget: getDiagnosticStringField(input.activeMesocycle, "volumeTarget"),
      splitType: getDiagnosticStringField(input.activeMesocycle, "splitType"),
      sessionsPerWeek: getDiagnosticNumberField(input.activeMesocycle, "sessionsPerWeek"),
    },
    weeks: Array.from({ length: durationWeeks }, (_, index) => {
      const week = index + 1;
      const phase = getWeeklyDemandCurvePhase({ week, durationWeeks });
      const weekLevelLimitations = getWeekLevelLimitations(phase);
      return {
        week,
        phase,
        projectionStatus: getWeeklyDemandCurveProjectionStatus(phase),
        muscles: input.shadowWeeklyDemand.map((demand) => {
          const target = getPolicyTargetForCurve({
            activeMesocycle: input.activeMesocycle,
            demand,
            week,
            phase,
          });
          const delivery = deliveryByMuscle.get(demand.muscle);
          return {
            muscle: demand.muscle,
            targetTier: demand.targetTier ?? "IMPLICIT",
            targetStatus: demand.targetStatus,
            role: toWeeklyDemandRole(demand.priority),
            minEffectiveSets: target.minEffectiveSets,
            preferredEffectiveSets: target.preferredEffectiveSets,
            maxEffectiveSets: target.maxEffectiveSets,
            currentEvidenceEffectiveSets:
              week === 1
                ? (delivery?.projectedEffectiveStimulusAfterRepairAndFinalShaping ?? null)
                : null,
            desiredExposureCount: demand.desiredExposureCount,
            progressionIntent: getWeeklyDemandCurveProgressionIntent({
              phase,
              targetStatus: demand.targetStatus,
            }),
            source: uniqueSorted([
              ...target.source,
              ...(week === 1 ? formatCurveEvidenceForDelivery(delivery) : []),
            ]),
            limitations: uniqueSorted([
              ...target.limitations,
              ...weekLevelLimitations,
            ]),
          };
        }),
        weekLevelLimitations,
      };
    }),
    crossWeekWarnings: warnings,
    candidateBehaviorGate: {
      status: "blocked_until_weekly_curve_is_visible",
      likelyBestFutureBehavior: "chest_upper_slot_distinct_exercise_distribution",
      requiredQuestions: [
        "would_this_improve_weeks_1_to_4_not_just_week_1",
        "would_this_preserve_deload_quality",
        "would_this_increase_fatigue_concentration",
      ],
      evidence: [
        "chest_upper_slot_distinct_exercise_distribution_is_likely_best_future_behavior",
        "behavior_must_remain_blocked_until_weekly_curve_answers_cross_week_questions",
        ...warnings
          .filter((warning) =>
            [
              "PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION",
              "DUPLICATE_EXERCISE_FATIGUE_RISK",
              "DELOAD_PRESERVATION_UNPROJECTED",
            ].includes(warning.code),
          )
          .flatMap((warning) => warning.evidence)
          .slice(0, 8),
      ],
    },
  };
}

type SlotDemandAllocationWeek = SlotDemandAllocationByWeek["weeks"][number];
type SlotDemandAllocationWeekSlot =
  SlotDemandAllocationWeek["slots"][number];
type SlotDemandAllocationWeekMuscle =
  SlotDemandAllocationWeekSlot["allocatedMuscles"][number];

function toSlotDemandAllocationRole(
  role: ShadowSlotDemandAllocation["allocatedMuscles"][number]["role"],
): SlotDemandAllocationWeekMuscle["role"] {
  return role === "implicit" ? "collateral" : role;
}

function getAllocationConfidence(
  allocation: ShadowSlotDemandAllocation["allocatedMuscles"][number],
): SlotDemandAllocationWeekMuscle["allocationConfidence"] {
  if (
    allocation.targetStatus === "hard" &&
    allocation.allocationReason.some((reason) =>
      reason.includes("weekly_obligation"),
    )
  ) {
    return "high";
  }
  if (
    allocation.allocationReason.some(
      (reason) =>
        reason.includes("authored_protected") ||
        reason.includes("authored_preferred") ||
        reason.includes("authored_primary"),
    )
  ) {
    return allocation.targetStatus === "diagnostic" ? "low" : "medium";
  }
  if (allocation.targetStatus === "diagnostic") {
    return "low";
  }
  return "medium";
}

function getDeliveryLimitations(
  delivery: ProjectedDeliveryDiagnostic | undefined,
): string[] {
  if (!delivery) {
    return ["week_1_delivery_evidence_missing"];
  }
  const limitations: string[] = [];
  if (
    delivery.preferredTarget != null &&
    delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
      delivery.preferredTarget
  ) {
    limitations.push("week_1_under_preferred_target");
  }
  if (
    delivery.preferredTarget != null &&
    delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping >
      delivery.preferredTarget + 1e-9
  ) {
    limitations.push("week_1_over_preferred_target");
  }
  if (delivery.targetStatus === "diagnostic") {
    limitations.push("diagnostic_collateral_readout_only_not_hard_demand");
  }
  return limitations;
}

function getSlotMuscleDuplicateEvidence(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  muscle: string;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): string[] {
  if (!input.slot) {
    return [];
  }
  const exerciseKeys = new Set(
    input.slot.exercises
      .filter((exercise) => exerciseMatchesMuscle(exercise, input.muscle))
      .flatMap((exercise) => [exercise.exerciseId, exercise.exerciseName]),
  );
  return input.duplicateExerciseReuse
    .filter(
      (row) =>
        row.repeatedInSlotId === input.slot?.slotId &&
        (exerciseKeys.has(row.exerciseId) || exerciseKeys.has(row.name)),
    )
    .map(
      (row) =>
        `duplicate:${row.name}:previous=${row.previousSlotIds.join("+")}:alternative=${row.hasCompatibleAlternative}`,
    );
}

function getSlotMuscleConcentrationEvidence(input: {
  slotId: string;
  muscle: string;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): string[] {
  return input.exerciseConcentration
    .filter(
      (row) =>
        row.slotId === input.slotId &&
        Object.prototype.hasOwnProperty.call(
          row.percentageOfWeeklyProjectedStimulusByMuscle,
          input.muscle,
        ) &&
        row.flags.some(
          (flag) =>
            flag === "COMPOUND_GT_5_SETS" ||
            flag === "ISOLATION_GT_5_SETS" ||
            flag.includes("EXERCISE_SUPPLIES_OVER"),
        ),
    )
    .map(
      (row) =>
        `concentration:${row.exerciseName}:${input.muscle}:${row.percentageOfWeeklyProjectedStimulusByMuscle[input.muscle]}%`,
    );
}

function buildWeekOneSlotDemandAllocationSlots(input: {
  shadowSlotDemandAllocation: ReadonlyArray<ShadowSlotDemandAllocation>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): SlotDemandAllocationWeekSlot[] {
  const finalSlotById = new Map(
    input.finalSlotPlan.map((slot) => [slot.slotId, slot]),
  );
  const deliveryByMuscle = new Map(
    input.projectedDelivery.map((row) => [row.muscle, row]),
  );

  return input.shadowSlotDemandAllocation.map((slot) => {
    const finalSlot = finalSlotById.get(slot.slotId);
    const allocatedMuscles: SlotDemandAllocationWeekMuscle[] =
      slot.allocatedMuscles.map((allocation) => {
      const delivery = deliveryByMuscle.get(allocation.muscle);
      const duplicateEvidence = getSlotMuscleDuplicateEvidence({
        slot: finalSlot,
        muscle: allocation.muscle,
        duplicateExerciseReuse: input.duplicateExerciseReuse,
      });
      const concentrationEvidence = getSlotMuscleConcentrationEvidence({
        slotId: slot.slotId,
        muscle: allocation.muscle,
        exerciseConcentration: input.exerciseConcentration,
      });
      const limitations = uniqueSorted([
        "week_1_current_projection_evidence_only",
        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
        ...getDeliveryLimitations(delivery),
        ...(duplicateEvidence.length > 0
          ? ["duplicate_exercise_variant_pressure_visible"]
          : []),
        ...(concentrationEvidence.length > 0
          ? ["exercise_concentration_visible"]
          : []),
      ]);

      return {
        muscle: allocation.muscle,
        role: toSlotDemandAllocationRole(allocation.role),
        targetStatus: allocation.targetStatus,
        minEffectiveSets: allocation.minEffectiveSets,
        preferredEffectiveSets: allocation.preferredEffectiveSets,
        maxEffectiveSets: allocation.maxEffectiveSets,
        weekScope: "week_1_only",
        allocationConfidence: getAllocationConfidence(allocation),
        allocationReason: uniqueSorted([
          ...allocation.allocationReason,
          ...(delivery
            ? [
                `week1_total=${delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping}:preferred=${formatNullableNumber(delivery.preferredTarget)}`,
              ]
            : []),
          ...duplicateEvidence,
          ...concentrationEvidence,
        ]),
        limitations,
      };
    });

    const slotLevelWarnings = uniqueSorted(
      allocatedMuscles.flatMap((allocation) =>
        allocation.limitations
          .filter(
            (limitation) =>
              limitation === "week_1_under_preferred_target" ||
              limitation === "week_1_over_preferred_target" ||
              limitation === "duplicate_exercise_variant_pressure_visible" ||
              limitation === "exercise_concentration_visible",
          )
          .map((limitation) => `${allocation.muscle}:${limitation}`),
      ),
    );

    return {
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      slotArchetype: slot.slotArchetype,
      intent: slot.intent,
      allocatedMuscles,
      slotLevelWarnings,
    };
  });
}

function buildFutureSlotAllocationWeek(
  week: WeeklyDemandCurve["weeks"][number],
): SlotDemandAllocationWeek {
  const isDeload = week.phase === "deload";
  const missingWeeklyProjectionWarnings = [
    "not_allocated_missing_weekly_projection",
    "missing_per_week_slot_composition",
    "missing_fatigue_carryover_model",
    "missing_progression_adjusted_set_targets",
    "missing_cross_week_duplicate_justification",
    "missing_weekly_exercise_identity_policy",
  ];
  const deloadWarnings = [
    "deload_slot_allocation_unprojected",
    "missing_deload_identity_preservation",
    "missing_deload_set_reduction_projection",
    "missing_deload_hard_support_target_adjustment",
  ];
  const canPartiallyReadWeeklyCurve =
    !isDeload &&
    week.projectionStatus === "projected_from_policy" &&
    !week.weekLevelLimitations.includes("missing_per_week_slot_distribution");

  return {
    week: week.week,
    phase: week.phase,
    projectionStatus: isDeload
      ? "not_allocated_missing_deload_policy"
      : canPartiallyReadWeeklyCurve
        ? "partially_allocated_from_weekly_demand_curve"
        : "not_allocated_missing_weekly_projection",
    slots: [],
    weekLevelWarnings: isDeload
      ? deloadWarnings
      : uniqueSorted([
          ...missingWeeklyProjectionWarnings,
          ...week.weekLevelLimitations,
        ]),
  };
}

function mapWeeklyDemandCurveWarningToSlotAllocationWarning(
  warning: WeeklyDemandCurve["crossWeekWarnings"][number],
): SlotDemandAllocationByWeek["crossWeekAllocationWarnings"][number] | null {
  switch (warning.code) {
    case "PRIMARY_UNDER_TARGET_ACROSS_ACCUMULATION":
    case "SUPPORT_UNDER_TARGET_ACROSS_ACCUMULATION":
      return {
        code: "MUSCLE_UNDER_ALLOCATED_ACROSS_ACCUMULATION",
        muscle: warning.muscle,
        evidence: warning.evidence,
        severity: warning.severity,
      };
    case "MUSCLE_OVERDELIVERED_ACROSS_ACCUMULATION":
      return {
        code: "MUSCLE_OVER_ALLOCATED_ACROSS_ACCUMULATION",
        muscle: warning.muscle,
        evidence: warning.evidence,
        severity: warning.severity,
      };
    case "DUPLICATE_EXERCISE_FATIGUE_RISK":
      return {
        code: "DUPLICATE_SLOT_OWNERSHIP_RISK",
        evidence: warning.evidence,
        severity: warning.severity,
      };
    case "DELOAD_PRESERVATION_UNPROJECTED":
      return {
        code: "DELOAD_SLOT_ALLOCATION_UNPROJECTED",
        evidence: warning.evidence,
        severity: warning.severity,
      };
    case "WEEKLY_DEMAND_POLICY_MISSING":
      return {
        code: "WEEKLY_SLOT_ALLOCATION_POLICY_MISSING",
        evidence: warning.evidence,
        severity: warning.severity,
      };
  }
  return null;
}

function buildSlotDemandAllocationByWeek(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyDemandCurve: WeeklyDemandCurve;
  shadowSlotDemandAllocation: ReadonlyArray<ShadowSlotDemandAllocation>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): SlotDemandAllocationByWeek {
  const weeks = input.weeklyDemandCurve.weeks.map((week) => {
    if (week.week === 1) {
      return {
        week: week.week,
        phase: week.phase,
        projectionStatus: "allocated_from_current_week_evidence" as const,
        slots: buildWeekOneSlotDemandAllocationSlots({
          shadowSlotDemandAllocation: input.shadowSlotDemandAllocation,
          finalSlotPlan: input.finalSlotPlan,
          projectedDelivery: input.projectedDelivery,
          duplicateExerciseReuse: input.duplicateExerciseReuse,
          exerciseConcentration: input.exerciseConcentration,
        }),
        weekLevelWarnings: uniqueSorted([
          "week_1_current_projection_evidence_only",
          "later_week_slot_allocation_not_inferred_from_week_1",
          "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
        ]),
      };
    }
    return buildFutureSlotAllocationWeek(week);
  });

  const crossWeekAllocationWarnings = input.weeklyDemandCurve.crossWeekWarnings
    .map(mapWeeklyDemandCurveWarningToSlotAllocationWarning)
    .filter(
      (
        warning,
      ): warning is SlotDemandAllocationByWeek["crossWeekAllocationWarnings"][number] =>
        warning != null,
    )
    .filter(
      (warning, index, rows) =>
        rows.findIndex(
          (candidate) =>
            candidate.code === warning.code &&
            candidate.muscle === warning.muscle,
        ) === index,
    )
    .sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        (left.muscle ?? "").localeCompare(right.muscle ?? ""),
    );

  return {
    mesocycleId: getDiagnosticMesocycleId(input.activeMesocycle),
    source: "diagnostic_shadow_planner",
    readOnly: true,
    affectsScoringOrGeneration: false,
    weeks,
    crossWeekAllocationWarnings,
  };
}

type ExerciseClassDistributionMuscle =
  ExerciseClassDistributionBySlot["muscleDemands"][number];

const DUPLICATE_JUSTIFICATION_EXERCISE_NAMES = [
  "Incline DB Bench",
  "Lat Pulldown",
  "SLDL",
  "Stiff-Legged Deadlift",
  "Barbell Back Squat",
] as const;

const EXERCISE_CLASS_DIAGNOSTIC_MUSCLES = new Set([
  "Chest",
  "Hamstrings",
  "Side Delts",
  "Rear Delts",
  "Triceps",
  "Calves",
  "Lats",
  "Quads",
]);

function shouldIncludeExerciseClassDemand(input: {
  prescription: MusclePrescription;
  slotId: string;
}): boolean {
  if (!EXERCISE_CLASS_DIAGNOSTIC_MUSCLES.has(input.prescription.muscle)) {
    return false;
  }
  if (input.prescription.targetStatus === "diagnostic") {
    return false;
  }
  if (input.prescription.targetStatus === "forbidden") {
    return input.prescription.muscle === "Chest";
  }
  return true;
}

function toExerciseClassProjectionStatus(
  status: SlotDemandAllocationByWeek["weeks"][number]["projectionStatus"],
): ExerciseClassDistributionBySlot["projectionStatus"] {
  switch (status) {
    case "allocated_from_current_week_evidence":
      return "projected_from_current_evidence";
    case "partially_allocated_from_weekly_demand_curve":
      return "partially_projected_missing_policy";
    case "not_allocated_missing_weekly_projection":
    case "not_allocated_missing_deload_policy":
      return "not_projected_missing_policy";
  }
}

function toExerciseClassSetSplit(input: {
  prescription: MusclePrescription;
  policy: SetDistributionPolicy | undefined;
  slotId: string;
}): ExerciseClassDistributionMuscle["preferredSetSplit"] {
  if (input.prescription.targetStatus === "forbidden") {
    return "forbidden";
  }
  if (
    input.prescription.targetStatus === "diagnostic" ||
    input.prescription.demandType === "diagnostic_only"
  ) {
    return "diagnostic_only";
  }
  if (input.prescription.muscle === "Hamstrings" && input.slotId === "lower_b") {
    return "anchor_plus_isolation";
  }
  switch (input.policy?.preferredDistribution) {
    case "single_anchor_plus_accessory":
      return "anchor_plus_isolation";
    case "two_exercise_split":
      return "two_distinct_exercises";
    case "overlap_first":
    case "direct_isolation_only_if_needed":
      return "overlap_first_then_isolation";
    case "diagnostic_only":
      return "diagnostic_only";
    case "forbidden":
      return "forbidden";
    case undefined:
      return input.prescription.role === "primary"
        ? "single_anchor"
        : "overlap_first_then_isolation";
  }
}

function getExerciseClassPreferredClasses(
  prescription: MusclePrescription,
): string[] {
  switch (prescription.muscle) {
    case "Chest":
      return prescription.targetStatus === "forbidden"
        ? []
        : [
            "press",
            "horizontal_press",
            "incline_press",
            "machine_press",
            "chest_fly",
            "cable_fly",
            "chest_isolation",
          ];
    case "Hamstrings":
      return prescription.targetStatus === "forbidden"
        ? []
        : [
            "hinge_compound",
            "stiff_leg_deadlift",
            "romanian_deadlift",
            "knee_flexion_curl",
            "leg_curl",
            "nordic_curl",
          ];
    case "Side Delts":
      return prescription.targetStatus === "forbidden"
        ? []
        : [
            "lateral_raise",
            "cable_lateral_raise",
            "machine_lateral_raise",
            "vertical_press_overlap",
          ];
    case "Rear Delts":
      return prescription.targetStatus === "forbidden"
        ? []
        : [
            "rear_delt_isolation",
            "reverse_fly",
            "face_pull",
            "pull_overlap_with_direct_rear_delt_stimulus",
          ];
    case "Triceps":
      return prescription.targetStatus === "forbidden"
        ? []
        : ["press_overlap", "triceps_isolation_if_under_floor"];
    case "Calves":
      return prescription.targetStatus === "forbidden"
        ? []
        : ["calf_raise", "standing_calf_raise", "seated_calf_raise"];
    default:
      return prescription.allowedExerciseClasses;
  }
}

function getExerciseClassRequiredClasses(input: {
  prescription: MusclePrescription;
  slotId: string;
}): string[] {
  if (input.prescription.targetStatus !== "hard") {
    return [];
  }
  if (input.prescription.muscle === "Hamstrings" && input.slotId === "lower_b") {
    return ["hinge_compound", "knee_flexion_curl"];
  }
  if (
    input.prescription.muscle === "Chest" &&
    input.prescription.demandType === "direct_required"
  ) {
    return ["press"];
  }
  return input.prescription.demandType === "direct_required"
    ? input.prescription.allowedExerciseClasses
    : [];
}

function getExerciseClassForbiddenClasses(
  prescription: MusclePrescription,
): string[] {
  const base = [...prescription.forbiddenExerciseClasses];
  switch (prescription.muscle) {
    case "Chest":
      return prescription.targetStatus === "forbidden"
        ? uniqueSorted([
            ...base,
            "press",
            "horizontal_press",
            "incline_press",
            "machine_press",
            "chest_fly",
            "cable_fly",
            "chest_isolation",
          ])
        : base;
    case "Hamstrings":
      return uniqueSorted([...base, "back_extension", "dirty_extension"]);
    case "Side Delts":
      return uniqueSorted([
        ...base,
        "high_collateral_overhead_press",
        "duplicate_lateral_raise_variant",
      ]);
    case "Rear Delts":
      return uniqueSorted([
        ...base,
        "generic_upper_back_row_as_clean_rear_delt_closure",
      ]);
    case "Calves":
      return uniqueSorted([
        ...base,
        "same_session_duplicate_calf_isolation",
      ]);
    default:
      return base;
  }
}

function getExerciseClassPreferredPatterns(
  prescription: MusclePrescription,
): string[] {
  switch (prescription.muscle) {
    case "Hamstrings":
      return prescription.targetStatus === "forbidden"
        ? []
        : uniqueSorted([...prescription.allowedPatterns, "knee_flexion"]);
    case "Side Delts":
      return prescription.targetStatus === "forbidden"
        ? []
        : uniqueSorted([...prescription.allowedPatterns, "low_collateral_isolation"]);
    default:
      return prescription.allowedPatterns;
  }
}

function getExerciseClassForbiddenPatterns(
  prescription: MusclePrescription,
): string[] {
  if (prescription.muscle === "Hamstrings") {
    return uniqueSorted([...prescription.forbiddenPatterns, "extension"]);
  }
  if (prescription.muscle === "Side Delts") {
    return uniqueSorted([
      ...prescription.forbiddenPatterns,
      "high_collateral_vertical_push_overconcentration",
    ]);
  }
  return prescription.forbiddenPatterns;
}

function exerciseClassMatchesMuscle(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number],
  muscle: string,
): boolean {
  const effectiveStimulus =
    exercise.effectiveStimulusByMuscle ?? {};
  return (
    (exercise.primaryMuscles ?? []).map(normalizeMuscle).includes(muscle) ||
    Object.prototype.hasOwnProperty.call(
      effectiveStimulus,
      muscle,
    )
  );
}

function findSelectedExerciseClassEvidence(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  muscle: string;
}): string[] {
  if (!input.slot) {
    return [];
  }
  return input.slot.exercises
    .filter((exercise) => exerciseClassMatchesMuscle(exercise, input.muscle))
    .map((exercise) => {
      const movementPatterns =
        (exercise as { movementPatterns?: string[] }).movementPatterns ?? [];
      const patterns = movementPatterns.length > 0
        ? movementPatterns.join("+")
        : "unknown";
      return `selected:${exercise.exerciseName}:patterns=${patterns}:sets=${exercise.setCount}`;
    });
}

function findRepeatedExerciseEvidence(
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
): Map<string, string[]> {
  const byExercise = new Map<
    string,
    { name: string; slotIds: Set<string>; role: "main" | "accessory" }
  >();
  for (const slot of finalSlotPlan) {
    for (const exercise of slot.exercises) {
      if (
        !DUPLICATE_JUSTIFICATION_EXERCISE_NAMES.some(
          (name) => exercise.exerciseName === name,
        )
      ) {
        continue;
      }
      const existing =
        byExercise.get(exercise.exerciseId) ??
        {
          name: exercise.exerciseName,
          slotIds: new Set<string>(),
          role: exercise.role,
        };
      existing.slotIds.add(slot.slotId);
      if (exercise.role === "main") {
        existing.role = "main";
      }
      byExercise.set(exercise.exerciseId, existing);
    }
  }

  const evidenceBySlot = new Map<string, string[]>();
  for (const row of byExercise.values()) {
    if (row.slotIds.size <= 1) {
      continue;
    }
    const slots = Array.from(row.slotIds).sort((left, right) =>
      left.localeCompare(right),
    );
    for (const slotId of slots) {
      evidenceBySlot.set(slotId, [
        ...(evidenceBySlot.get(slotId) ?? []),
        `duplicate_class:${row.name}:slots=${slots.join("+")}:role=${row.role}:requires_explicit_justification`,
      ]);
    }
  }
  return evidenceBySlot;
}

function getExerciseClassDuplicateJustifications(input: {
  prescription: MusclePrescription;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  selectedExerciseEvidence: ReadonlyArray<string>;
  slotId: string;
}): ExerciseClassDistributionMuscle["duplicateJustifications"] {
  const justifications = new Set<
    ExerciseClassDistributionMuscle["duplicateJustifications"][number]
  >();
  if (
    input.prescription.muscle === "Chest" &&
    input.slotId === "upper_a" &&
    input.selectedExerciseEvidence.some(
      (row) =>
        row.includes("Incline") &&
        (row.includes("Bench") || row.includes("Press")),
    )
  ) {
    justifications.add("continuity_anchor");
  }
  for (const row of input.duplicateRows) {
    if (!row.hasCompatibleAlternative) {
      justifications.add("no_clean_alternative");
      justifications.add("limited_inventory");
    }
    if (row.reason.includes("exact_demand")) {
      justifications.add("exact_demand_fit");
    }
    if (row.reason.includes("preference")) {
      justifications.add("user_preference");
    }
    if (row.reason.includes("deload")) {
      justifications.add("deload_skill_preservation");
    }
    if (row.reason.includes("continuity")) {
      justifications.add("continuity_anchor");
    }
  }
  return Array.from(justifications).sort((left, right) =>
    left.localeCompare(right),
  );
}

function getExerciseClassDuplicatePolicy(input: {
  prescription: MusclePrescription;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  repeatedExerciseEvidence: ReadonlyArray<string>;
}): ExerciseClassDistributionMuscle["duplicatePolicy"] {
  if (input.prescription.targetStatus === "forbidden") {
    return "block_if_clean_alternative_exists";
  }
  if (
    input.duplicateRows.some((row) => row.hasCompatibleAlternative) ||
    input.repeatedExerciseEvidence.length > 0
  ) {
    return "block_if_clean_alternative_exists";
  }
  if (
    input.prescription.muscle === "Chest" ||
    input.prescription.muscle === "Side Delts" ||
    input.prescription.muscle === "Calves"
  ) {
    return "discourage_if_alternative_exists";
  }
  return "allow_with_justification";
}

function buildExerciseClassInventoryEvidence(input: {
  slotId: string;
  muscle: string;
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  preselectionFeasibility: ReadonlyArray<CleanPreselectionFeasibility>;
  selectedExerciseEvidence: ReadonlyArray<string>;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  repeatedExerciseEvidence: ReadonlyArray<string>;
}): string[] {
  const hamstringsInventory = input.preselectionFeasibility
    .filter(
      (row) => row.slotId === input.slotId && row.muscle === input.muscle,
    )
    .flatMap((row) =>
      row.candidateInventory.map(
        (candidate) =>
          `inventory:${candidate.exerciseName}:class=${candidate.candidateClass}:availability=${candidate.availability}`,
      ),
    );
  const duplicateEvidence = input.duplicateRows.map(
    (row) =>
      `duplicate:${row.name}:role=${row.role}:previous=${row.previousSlotIds.join("+")}:alternative=${row.hasCompatibleAlternative}`,
  );
  return uniqueSorted([
    ...input.selectedExerciseEvidence,
    ...hamstringsInventory,
    ...duplicateEvidence,
    ...input.repeatedExerciseEvidence,
    ...(input.slot
      ? [`slot_exercise_count:${input.slot.exerciseCount}`]
      : ["slot_final_plan_missing"]),
  ]);
}

function buildExerciseClassRepairEvidence(input: {
  slotId: string;
  muscle: string;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  concentrationRows: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  preselectionFeasibility: ReadonlyArray<CleanPreselectionFeasibility>;
}): string[] {
  const repairEvidence = input.repairRows
    .filter((row) => row.slotId === input.slotId && row.muscle === input.muscle)
    .map(
      (row) =>
        `repair:${row.exerciseName ?? row.exerciseId ?? "unknown"}:${row.action}:${row.shadowAllocationBasis}`,
    );
  const concentrationEvidence = input.concentrationRows
    .filter(
      (row) =>
        row.slotId === input.slotId &&
        Object.prototype.hasOwnProperty.call(
          row.percentageOfWeeklyProjectedStimulusByMuscle,
          input.muscle,
        ),
    )
    .map(
      (row) =>
        `concentration:${row.exerciseName}:${input.muscle}:${roundToTenth(row.percentageOfWeeklyProjectedStimulusByMuscle[input.muscle])}%`,
    );
  const weakConsumptionEvidence = input.weakPreselectionConsumption
    .filter((row) => row.slotId === input.slotId && row.muscle === input.muscle)
    .map(
      (row) =>
        `weak_preselection_consumption:selected=${roundToTenth(row.selectedEffectiveSets)}:targetMet=${row.targetMet}`,
    );
  const feasibilityEvidence = input.preselectionFeasibility
    .filter((row) => row.slotId === input.slotId && row.muscle === input.muscle)
    .flatMap((row) => [
      `feasibility:${row.candidateStatus}:${row.recommendation}`,
      ...row.dirtyClosureSignals.map((signal) => `dirty:${signal.signal}`),
    ]);
  return uniqueSorted([
    ...repairEvidence,
    ...concentrationEvidence,
    ...weakConsumptionEvidence,
    ...feasibilityEvidence,
  ]);
}

function getExerciseClassLimitations(input: {
  prescription: MusclePrescription;
  slotId: string;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  repeatedExerciseEvidence: ReadonlyArray<string>;
  projectionStatus: ExerciseClassDistributionBySlot["projectionStatus"];
}): string[] {
  const limitations = [
    "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
  ];
  if (input.projectionStatus !== "projected_from_current_evidence") {
    limitations.push("missing_per_week_exercise_class_policy");
  }
  if (input.prescription.targetStatus === "forbidden") {
    limitations.push("do_not_train_this_muscle_in_this_slot");
  }
  if (input.prescription.muscle === "Chest") {
    if (input.slotId.startsWith("lower")) {
      limitations.push("lower_slots_forbid_chest_targeting");
    } else {
      limitations.push("upper_chest_slots_should_use_distinct_class_intent_when_inventory_supports_it");
      limitations.push("duplicate_incline_press_requires_explicit_justification");
    }
  }
  if (input.prescription.muscle === "Hamstrings" && input.slotId === "lower_b") {
    limitations.push("back_extension_is_not_clean_hamstrings_closure");
    limitations.push("hinge_anchor_should_pair_with_knee_flexion_curl_when_clean_inventory_exists");
  }
  if (input.prescription.muscle === "Side Delts") {
    limitations.push("prefer_low_collateral_direct_or_vertical_press_overlap");
    limitations.push("avoid_ohp_overconcentration");
    limitations.push("avoid_duplicate_lateral_raise_spam");
  }
  if (input.prescription.muscle === "Rear Delts") {
    limitations.push("direct_rear_delt_isolation_useful_but_pull_and_upper_back_collateral_constrained");
  }
  if (input.prescription.muscle === "Triceps") {
    limitations.push("press_overlap_first_isolation_only_if_under_floor");
    limitations.push("consumed_but_unmet_is_weak_evidence");
  }
  if (input.prescription.muscle === "Calves") {
    limitations.push("one_calf_isolation_per_lower_slot_unless_specialization");
    limitations.push("avoid_same_session_duplicate_calf_variants");
  }
  if (
    input.duplicateRows.length > 0 ||
    input.repeatedExerciseEvidence.length > 0
  ) {
    limitations.push("duplicate_exercise_class_reuse_requires_explicit_justification");
  }
  return uniqueSorted(limitations);
}

function buildExerciseClassDistributionBySlot(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  slotPrescriptionIntents: ReadonlyArray<SlotPrescriptionIntent>;
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>;
  slotDemandAllocationByWeek: SlotDemandAllocationByWeek;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  preselectionFeasibility: ReadonlyArray<CleanPreselectionFeasibility>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): ExerciseClassDistributionBySlot[] {
  const prescriptionBySlotId = new Map(
    input.slotPrescriptionIntents.map((slot) => [slot.slotId, slot]),
  );
  const setDistributionBySlotId = new Map(
    input.setDistributionIntents.map((slot) => [slot.slotId, slot]),
  );
  const finalSlotById = new Map(
    input.finalSlotPlan.map((slot) => [slot.slotId, slot]),
  );
  const repeatedEvidenceBySlotId = findRepeatedExerciseEvidence(input.finalSlotPlan);

  return input.slotDemandAllocationByWeek.weeks.flatMap((week) => {
    const slots = week.slots.map((slot) => ({
      slotId: slot.slotId,
      slotIndex: slot.slotIndex,
      slotArchetype: slot.slotArchetype,
      intent: slot.intent,
    }));
    const projectionStatus = toExerciseClassProjectionStatus(
      week.projectionStatus,
    );

    return slots.map((slot) => {
      const slotPrescription = prescriptionBySlotId.get(slot.slotId);
      const setDistribution = setDistributionBySlotId.get(slot.slotId);
      const finalSlot = finalSlotById.get(slot.slotId);
      const repeatedExerciseEvidence =
        repeatedEvidenceBySlotId.get(slot.slotId) ?? [];
      const muscleDemands: ExerciseClassDistributionMuscle[] =
        projectionStatus === "projected_from_current_evidence"
          ? (slotPrescription?.musclePrescriptions ?? [])
              .filter((prescription) =>
                shouldIncludeExerciseClassDemand({
                  prescription,
                  slotId: slot.slotId,
                }),
              )
              .map((prescription) => {
              const policy = setDistribution?.musclePolicies.find(
                (row) => row.muscle === prescription.muscle,
              );
              const duplicateRows = findDuplicateRowsForMuscle({
                slot: finalSlot,
                policy: policy ?? {
                  muscle: prescription.muscle,
                  role: prescription.role,
                  targetStatus: prescription.targetStatus,
                  demandType: prescription.demandType,
                  preferredEffectiveSets: prescription.desiredEffectiveSets,
                  minEffectiveSets: prescription.minEffectiveSets,
                  maxEffectiveSets: prescription.maxEffectiveSets,
                  maxSingleExerciseShare: null,
                  maxSinglePatternShare: null,
                  maxSetsPerExercise: null,
                  maxDirectExercises: null,
                  maxDuplicateExerciseClasses: null,
                  preferredDistribution: "diagnostic_only",
                  whenAtLimit: "leave_unresolved",
                },
                duplicateExerciseReuse: input.duplicateExerciseReuse,
              });
              const selectedExerciseEvidence = findSelectedExerciseClassEvidence({
                slot: finalSlot,
                muscle: prescription.muscle,
              });
              const muscleRepeatedEvidence = repeatedExerciseEvidence.filter((row) =>
                selectedExerciseEvidence.some((selected) => {
                  const exerciseName = selected.split(":")[1] ?? "";
                  return row.includes(exerciseName);
                }),
              );
              const duplicateJustifications =
                getExerciseClassDuplicateJustifications({
                  prescription,
                  duplicateRows,
                  selectedExerciseEvidence,
                  slotId: slot.slotId,
                });

              return {
                muscle: prescription.muscle,
                role: prescription.role,
                targetStatus: prescription.targetStatus,
                demandType: prescription.demandType,
                desiredEffectiveSets: prescription.desiredEffectiveSets,
                minEffectiveSets: prescription.minEffectiveSets,
                maxEffectiveSets: prescription.maxEffectiveSets,
                preferredExerciseClasses: getExerciseClassPreferredClasses(
                  prescription,
                ),
                requiredExerciseClasses: getExerciseClassRequiredClasses({
                  prescription,
                  slotId: slot.slotId,
                }),
                forbiddenExerciseClasses:
                  getExerciseClassForbiddenClasses(prescription),
                preferredMovementPatterns:
                  getExerciseClassPreferredPatterns(prescription),
                forbiddenMovementPatterns:
                  getExerciseClassForbiddenPatterns(prescription),
                preferredSetSplit: toExerciseClassSetSplit({
                  prescription,
                  policy,
                  slotId: slot.slotId,
                }),
                duplicatePolicy: getExerciseClassDuplicatePolicy({
                  prescription,
                  duplicateRows,
                  repeatedExerciseEvidence: muscleRepeatedEvidence,
                }),
                duplicateJustifications,
                unresolvedBehavior:
                  prescription.targetStatus === "hard" ||
                  prescription.demandType === "direct_if_under_floor"
                    ? ("repair_safety_net" as const)
                    : ("leave_unresolved" as const),
                collateralLimits: prescription.collateralLimits,
                inventoryEvidence: buildExerciseClassInventoryEvidence({
                  slotId: slot.slotId,
                  muscle: prescription.muscle,
                  slot: finalSlot,
                  preselectionFeasibility: input.preselectionFeasibility,
                  selectedExerciseEvidence,
                  duplicateRows,
                  repeatedExerciseEvidence: muscleRepeatedEvidence,
                }),
                repairEvidence: buildExerciseClassRepairEvidence({
                  slotId: slot.slotId,
                  muscle: prescription.muscle,
                  repairRows: input.repairMaterialityAfterShadowAllocation,
                  concentrationRows: input.exerciseConcentration,
                  weakPreselectionConsumption: input.weakPreselectionConsumption,
                  preselectionFeasibility: input.preselectionFeasibility,
                }),
                limitations: getExerciseClassLimitations({
                  prescription,
                  slotId: slot.slotId,
                  duplicateRows,
                  repeatedExerciseEvidence: muscleRepeatedEvidence,
                  projectionStatus,
                }),
              };
            })
          : [];

      return {
        version: 1,
        source: "diagnostic_shadow_planner",
        mesocycleId: getDiagnosticMesocycleId(input.activeMesocycle),
        week: week.week,
        phase: week.phase,
        projectionStatus,
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        slotArchetype: slot.slotArchetype,
        intent: slot.intent,
        muscleDemands,
        readOnly: true,
        affectsScoringOrGeneration: false,
      };
    });
  });
}

type ExerciseClassAlignmentSlot = ExerciseClassAlignment["slots"][number];
type ExerciseClassAlignmentMuscle =
  ExerciseClassAlignmentSlot["muscleAlignments"][number];
type InitialExerciseClassSelection =
  ExerciseClassAlignmentMuscle["initialSelectedClasses"][number];
type FinalExerciseClassSelection =
  ExerciseClassAlignmentMuscle["finalSelectedClasses"][number];
type ExerciseClassAlignmentStatus =
  ExerciseClassAlignmentMuscle["initialAlignment"];

function compactDiagnosticStrings(
  values: ReadonlyArray<string>,
  limit = 10,
): string[] {
  const unique = uniqueSorted(values).filter((value) => value.length > 0);
  if (unique.length <= limit) {
    return unique;
  }
  return [...unique.slice(0, limit), `+${unique.length - limit} more`];
}

function classifySelectedExerciseClass(input: {
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number];
  muscle: string;
}): string {
  const name = input.exercise.exerciseName.toLowerCase();
  if (name.includes("back extension")) {
    return "dirty_extension";
  }
  if (name.includes("nordic")) {
    return "nordic_curl";
  }
  if (name.includes("leg curl") || name.includes("hamstring curl")) {
    return "leg_curl";
  }
  if (
    name.includes("stiff-legged") ||
    name.includes("stiff leg") ||
    name === "sldl" ||
    name.includes("romanian deadlift") ||
    name.includes("rdl")
  ) {
    return "stiff_leg_deadlift";
  }
  if (name.includes("deadlift") || name.includes("hinge")) {
    return "hinge_compound";
  }
  if (name.includes("incline") && (name.includes("bench") || name.includes("press"))) {
    return "incline_press";
  }
  if (name.includes("machine") && name.includes("press") && input.muscle === "Chest") {
    return "machine_press";
  }
  if (name.includes("fly") || name.includes("pec deck")) {
    return name.includes("cable") ? "cable_fly" : "chest_fly";
  }
  if (name.includes("bench") || name.includes("chest press")) {
    return "horizontal_press";
  }
  if (name.includes("overhead press") || name.includes("ohp") || name.includes("shoulder press")) {
    return "vertical_press_overlap";
  }
  if (name.includes("lateral raise")) {
    if (name.includes("cable")) {
      return "cable_lateral_raise";
    }
    if (name.includes("machine")) {
      return "machine_lateral_raise";
    }
    return "lateral_raise";
  }
  if (name.includes("reverse fly")) {
    return "reverse_fly";
  }
  if (name.includes("face pull")) {
    return "face_pull";
  }
  if (name.includes("rear delt")) {
    return "rear_delt_isolation";
  }
  if (name.includes("triceps") || name.includes("pushdown") || name.includes("skullcrusher")) {
    return "triceps_isolation_if_under_floor";
  }
  if (name.includes("pulldown")) {
    return "vertical_pull";
  }
  if (name.includes("row")) {
    return "horizontal_pull";
  }
  if (name.includes("back squat") || name.includes("squat")) {
    return "squat_compound";
  }
  if (name.includes("standing calf")) {
    return "standing_calf_raise";
  }
  if (name.includes("seated calf")) {
    return "seated_calf_raise";
  }
  if (name.includes("calf raise")) {
    return "calf_raise";
  }
  if (input.exercise.role === "main") {
    return "compound_overlap";
  }
  return "unclassified";
}

function classSatisfiesIntent(
  exerciseClass: string,
  intendedClass: string,
): boolean {
  if (exerciseClass === intendedClass) {
    return true;
  }
  const aliases: Record<string, string[]> = {
    press: ["horizontal_press", "incline_press", "machine_press", "vertical_press_overlap"],
    horizontal_press: ["incline_press", "machine_press"],
    hinge_compound: ["stiff_leg_deadlift", "romanian_deadlift"],
    knee_flexion_curl: ["leg_curl", "nordic_curl"],
    lateral_raise: ["cable_lateral_raise", "machine_lateral_raise"],
    rear_delt_isolation: ["reverse_fly", "face_pull"],
    pull_overlap_with_direct_rear_delt_stimulus: [
      "horizontal_pull",
      "vertical_pull",
      "face_pull",
    ],
    press_overlap: [
      "horizontal_press",
      "incline_press",
      "machine_press",
      "vertical_press_overlap",
    ],
    calf_raise: ["standing_calf_raise", "seated_calf_raise"],
  };
  return aliases[intendedClass]?.includes(exerciseClass) ?? false;
}

function selectedExerciseClassMatchesAny(
  exerciseClass: string,
  intendedClasses: ReadonlyArray<string>,
): boolean {
  return intendedClasses.some((intendedClass) =>
    classSatisfiesIntent(exerciseClass, intendedClass),
  );
}

function toDuplicatePolicyClass(exerciseClass: string): string {
  if (["standing_calf_raise", "seated_calf_raise"].includes(exerciseClass)) {
    return "calf_raise";
  }
  if (["leg_curl", "nordic_curl"].includes(exerciseClass)) {
    return "knee_flexion_curl";
  }
  if (["stiff_leg_deadlift", "romanian_deadlift"].includes(exerciseClass)) {
    return "hinge_compound";
  }
  if (["cable_lateral_raise", "machine_lateral_raise"].includes(exerciseClass)) {
    return "lateral_raise";
  }
  return exerciseClass;
}

function buildSelectedExerciseClasses(input: {
  slot: SlotCompositionSnapshotDiagnostic | undefined;
  muscle: string;
}): InitialExerciseClassSelection[] {
  if (!input.slot) {
    return [];
  }
  return input.slot.exercises
    .filter((exercise) => exerciseClassMatchesMuscle(exercise, input.muscle))
    .map((exercise) => ({
      exerciseName: exercise.exerciseName,
      exerciseClass: classifySelectedExerciseClass({
        exercise,
        muscle: input.muscle,
      }),
      setCount: exercise.setCount,
      effectiveSets:
        typeof exercise.effectiveStimulusByMuscle[input.muscle] === "number"
          ? roundToTenth(exercise.effectiveStimulusByMuscle[input.muscle])
          : null,
    }))
    .sort(
      (left, right) =>
        left.exerciseName.localeCompare(right.exerciseName) ||
        left.exerciseClass.localeCompare(right.exerciseClass),
    );
}

function hasProducedOrIncreasedRepair(input: {
  slotId: string;
  muscle: string;
  exerciseName: string;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  concentrationRows: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): boolean {
  return (
    input.repairRows.some(
      (row) =>
        row.slotId === input.slotId &&
        row.muscle === input.muscle &&
        row.exerciseName === input.exerciseName &&
        (row.action === "added" || row.action === "set_bumped") &&
        row.effectiveStimulusDelta > 0,
    ) ||
    input.concentrationRows.some(
      (row) =>
        row.slotId === input.slotId &&
        row.exerciseName === input.exerciseName &&
        row.producedOrIncreasedByRepair,
    )
  );
}

function withFinalRepairFlags(input: {
  slotId: string;
  muscle: string;
  selected: ReadonlyArray<InitialExerciseClassSelection>;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  concentrationRows: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): FinalExerciseClassSelection[] {
  return input.selected.map((selection) => ({
    ...selection,
    producedOrIncreasedByRepair: hasProducedOrIncreasedRepair({
      slotId: input.slotId,
      muscle: input.muscle,
      exerciseName: selection.exerciseName,
      repairRows: input.repairRows,
      concentrationRows: input.concentrationRows,
    }),
  }));
}

function hasDirectSideDeltClass(
  selected: ReadonlyArray<InitialExerciseClassSelection>,
): boolean {
  return selected.some((row) =>
    ["lateral_raise", "cable_lateral_raise", "machine_lateral_raise"].includes(
      row.exerciseClass,
    ),
  );
}

function hasDirectRearDeltClass(
  selected: ReadonlyArray<InitialExerciseClassSelection>,
): boolean {
  return selected.some((row) =>
    ["rear_delt_isolation", "reverse_fly", "face_pull"].includes(
      row.exerciseClass,
    ),
  );
}

function evaluateExerciseClassAlignment(input: {
  muscle: string;
  targetStatus: ExerciseClassAlignmentMuscle["targetStatus"];
  requiredClasses: ReadonlyArray<string>;
  intendedClasses: ReadonlyArray<string>;
  forbiddenClasses: ReadonlyArray<string>;
  duplicatePolicyFailure: boolean;
  selected: ReadonlyArray<InitialExerciseClassSelection>;
}): ExerciseClassAlignmentStatus {
  if (input.targetStatus === "diagnostic") {
    return "not_applicable";
  }
  if (input.targetStatus === "forbidden") {
    return input.selected.length > 0 ? "violated" : "not_applicable";
  }
  if (input.intendedClasses.length === 0) {
    return "not_applicable";
  }
  if (
    input.selected.some((row) =>
      selectedExerciseClassMatchesAny(row.exerciseClass, input.forbiddenClasses),
    )
  ) {
    return "violated";
  }
  if (input.selected.length === 0) {
    return "missing";
  }

  if (input.requiredClasses.length > 0) {
    const satisfiedCount = input.requiredClasses.filter((requiredClass) =>
      input.selected.some((row) =>
        classSatisfiesIntent(row.exerciseClass, requiredClass),
      ),
    ).length;
    if (satisfiedCount === input.requiredClasses.length) {
      return input.duplicatePolicyFailure ? "partial" : "satisfied";
    }
    return satisfiedCount > 0 ? "partial" : "missing";
  }

  if (input.muscle === "Side Delts") {
    if (hasDirectSideDeltClass(input.selected)) {
      return input.duplicatePolicyFailure ? "partial" : "satisfied";
    }
    return input.selected.some((row) => row.exerciseClass === "vertical_press_overlap")
      ? "partial"
      : "missing";
  }

  if (input.muscle === "Rear Delts") {
    if (hasDirectRearDeltClass(input.selected)) {
      return input.duplicatePolicyFailure ? "partial" : "satisfied";
    }
    return input.selected.some((row) =>
      ["horizontal_pull", "vertical_pull"].includes(row.exerciseClass),
    )
      ? "partial"
      : "missing";
  }

  if (input.muscle === "Triceps") {
    return input.selected.some((row) =>
      selectedExerciseClassMatchesAny(row.exerciseClass, input.intendedClasses),
    )
      ? input.duplicatePolicyFailure
        ? "partial"
        : "satisfied"
      : "missing";
  }

  const hasAnyIntendedClass = input.selected.some((row) =>
    selectedExerciseClassMatchesAny(row.exerciseClass, input.intendedClasses),
  );
  return hasAnyIntendedClass
    ? input.duplicatePolicyFailure
      ? "partial"
      : "satisfied"
    : "missing";
}

function alignmentRank(status: ExerciseClassAlignmentStatus): number | null {
  switch (status) {
    case "satisfied":
      return 3;
    case "partial":
      return 2;
    case "missing":
      return 1;
    case "violated":
      return 0;
    case "not_applicable":
      return null;
  }
}

function hasIdentityChurn(input: {
  slotId: string;
  muscle: string;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
}): boolean {
  return input.repairRows.some(
    (row) =>
      row.slotId === input.slotId &&
      row.muscle === input.muscle &&
      row.changedExerciseIdentity,
  );
}

function classifyRepairEffect(input: {
  initialAlignment: ExerciseClassAlignmentStatus;
  finalAlignment: ExerciseClassAlignmentStatus;
  identityChurn: boolean;
  hasRepairEvidence: boolean;
}): ExerciseClassAlignmentMuscle["repairEffect"] {
  const initialRank = alignmentRank(input.initialAlignment);
  const finalRank = alignmentRank(input.finalAlignment);
  if (initialRank == null || finalRank == null) {
    return input.identityChurn ? "created_identity_churn" : "not_applicable";
  }
  if (finalRank > initialRank) {
    return "improved_alignment";
  }
  if (finalRank < initialRank) {
    return "worsened_alignment";
  }
  if (input.identityChurn) {
    return "created_identity_churn";
  }
  return input.hasRepairEvidence ? "unchanged" : "not_applicable";
}

function findDuplicatePolicyWarnings(input: {
  muscle: string;
  demand: ExerciseClassDistributionMuscle;
  finalSelected: ReadonlyArray<InitialExerciseClassSelection>;
}): string[] {
  const warnings: string[] = [];
  const duplicateEvidence = [
    ...input.demand.inventoryEvidence,
    ...input.demand.repairEvidence,
  ].filter(
    (row) =>
      row.includes("duplicate:") ||
      row.includes("duplicate_class:") ||
      row.includes("duplicate_exercise_class"),
  );
  warnings.push(...duplicateEvidence);

  const byClass = new Map<string, string[]>();
  for (const selection of input.finalSelected) {
    const classKey = toDuplicatePolicyClass(selection.exerciseClass);
    byClass.set(classKey, [
      ...(byClass.get(classKey) ?? []),
      selection.exerciseName,
    ]);
  }
  for (const [classKey, names] of byClass.entries()) {
    const distinctNames = uniqueSorted(names);
    if (distinctNames.length <= 1) {
      continue;
    }
    if (input.muscle === "Calves" || input.demand.duplicatePolicy !== "allow_with_justification") {
      warnings.push(
        `same_session_duplicate_class:${input.muscle}:${classKey}:${distinctNames.join("+")}`,
      );
    }
  }
  return compactDiagnosticStrings(warnings, 8);
}

type ExerciseClassUnresolvedOwningCause =
  ExerciseClassUnresolvedCause["owningCause"];

function mapExerciseClassCauseOwner(
  owningCause: ExerciseClassUnresolvedOwningCause,
): ExerciseClassUnresolvedCause["recommendedOwner"] {
  switch (owningCause) {
    case "selection_blind_spot":
      return "selection_objective";
    case "inventory_classification_gap":
      return "exercise_inventory_classification";
    case "slot_capacity_issue":
      return "slot_capacity_policy";
    case "duplicate_continuity_conflict":
      return "duplicate_continuity_policy";
    case "support_floor_late_repair":
      return "support_demand_planner";
    case "cap_cleanup_or_final_shaping":
      return "program_quality_cleanup";
    case "repair_identity_churn":
      return "repair_safety_net";
    case "true_unresolved_demand":
    case "diagnostic_only_not_actionable":
      return "leave_unresolved";
  }
}

function mapExerciseClassBehaviorReadiness(input: {
  owningCause: ExerciseClassUnresolvedOwningCause;
  hasBlockingRepairOrSuspiciousEvidence: boolean;
}): ExerciseClassUnresolvedCause["behaviorReadiness"] {
  if (
    input.owningCause === "selection_blind_spot" &&
    !input.hasBlockingRepairOrSuspiciousEvidence
  ) {
    return "ready_for_bounded_trial";
  }
  switch (input.owningCause) {
    case "inventory_classification_gap":
      return "needs_inventory_fix";
    case "duplicate_continuity_conflict":
      return "needs_duplicate_policy";
    case "slot_capacity_issue":
      return "needs_capacity_policy";
    case "support_floor_late_repair":
      return "needs_planner_ownership";
    case "selection_blind_spot":
    case "cap_cleanup_or_final_shaping":
    case "repair_identity_churn":
    case "true_unresolved_demand":
    case "diagnostic_only_not_actionable":
      return "do_not_act";
  }
}

function parseSlotExerciseCount(evidence: ReadonlyArray<string>): number | null {
  for (const row of evidence) {
    const match = /^slot_exercise_count:(\d+)$/.exec(row);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

function hasVisibleCompatibleClassCandidate(input: {
  demand: ExerciseClassDistributionMuscle;
  intendedClasses: ReadonlyArray<string>;
  initialSelectedClasses: ReadonlyArray<InitialExerciseClassSelection>;
  finalSelectedClasses: ReadonlyArray<FinalExerciseClassSelection>;
}): boolean {
  const selectedClasses = [
    ...input.initialSelectedClasses,
    ...input.finalSelectedClasses,
  ];
  const unsatisfiedRequiredClasses = input.demand.requiredExerciseClasses.filter(
    (requiredClass) =>
      !selectedClasses.some((row) =>
        classSatisfiesIntent(row.exerciseClass, requiredClass),
      ),
  );
  const candidateTargetClasses =
    unsatisfiedRequiredClasses.length > 0
      ? unsatisfiedRequiredClasses
      : input.intendedClasses;
  const selectedCandidateVisible = [
    ...input.initialSelectedClasses,
    ...input.finalSelectedClasses,
  ].some((row) =>
    selectedExerciseClassMatchesAny(row.exerciseClass, candidateTargetClasses),
  );
  if (selectedCandidateVisible) {
    return true;
  }

  return input.demand.inventoryEvidence.some((row) => {
    if (!row.startsWith("inventory:")) {
      return false;
    }
    const classMatch = /:class=([^:]+)/.exec(row);
    const availabilityMatch = /:availability=([^:]+)/.exec(row);
    const candidateClass = classMatch?.[1] ?? "";
    const availability = availabilityMatch?.[1] ?? "";
    const classCompatible = candidateTargetClasses.some((intendedClass) =>
      classSatisfiesIntent(candidateClass, intendedClass),
    );
    const availabilityCompatible =
      availability === "clean_available" ||
      availability === "available_but_already_used_elsewhere";
    return classCompatible && availabilityCompatible;
  });
}

function hasInventoryClassificationGapEvidence(input: {
  demand: ExerciseClassDistributionMuscle;
  intendedClasses: ReadonlyArray<string>;
  compatibleCandidateVisible: boolean;
}): boolean {
  if (input.compatibleCandidateVisible) {
    return false;
  }
  const inventoryEvidence = input.demand.inventoryEvidence;
  if (inventoryEvidence.length === 0) {
    return true;
  }
  return inventoryEvidence.some(
    (row) =>
      row.includes("classification_mismatch") ||
      row.includes("available_but_classification_mismatch") ||
      row.includes("dirty_not_clean_candidate") ||
      (row.startsWith("inventory:") &&
        !input.intendedClasses.some((intendedClass) => {
          const classMatch = /:class=([^:]+)/.exec(row);
          return classSatisfiesIntent(classMatch?.[1] ?? "", intendedClass);
        })),
  );
}

function hasSlotCapacityIssueEvidence(
  demand: ExerciseClassDistributionMuscle,
): boolean {
  if (
    demand.inventoryEvidence.some((row) =>
      row.includes("available_but_capacity_blocked"),
    )
  ) {
    return true;
  }
  const slotExerciseCount = parseSlotExerciseCount(demand.inventoryEvidence);
  return slotExerciseCount != null && slotExerciseCount >= SESSION_CAPS.maxExercises;
}

function hasSupportFloorLateRepairEvidence(input: {
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  demand: ExerciseClassDistributionMuscle;
}): boolean {
  return (
    input.repairRows.some((row) =>
      row.repairMechanism.toLowerCase().includes("support_floor"),
    ) ||
    input.demand.repairEvidence.some((row) =>
      row.toLowerCase().includes("support_floor"),
    )
  );
}

function hasCapCleanupOrFinalShapingEvidence(input: {
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  guardRows: ReadonlyArray<DistributionGuardAction>;
  concentrationRows: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  demand: ExerciseClassDistributionMuscle;
}): boolean {
  return (
    input.repairRows.some(
      (row) =>
        row.action === "set_trimmed" ||
        row.action === "removed" ||
        row.shadowAllocationBasis === "diagnostic_or_cap_cleanup" ||
        row.repairMechanism.toLowerCase().includes("cap") ||
        row.repairMechanism.toLowerCase().includes("program_quality"),
    ) ||
    input.guardRows.length > 0 ||
    input.concentrationRows.some((row) => row.producedOrIncreasedByRepair) ||
    input.demand.repairEvidence.some(
      (row) =>
        row.includes("distribution_guard") ||
        row.toLowerCase().includes("cap_cleanup"),
    )
  );
}

function hasRepairIdentityChurnEvidence(input: {
  alignment: ExerciseClassAlignmentMuscle;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
}): boolean {
  return (
    input.alignment.repairEffect === "created_identity_churn" ||
    input.repairRows.some(
      (row) =>
        row.changedExerciseIdentity &&
        (row.action === "added" || row.action === "removed"),
    ) ||
    input.alignment.finalSelectedClasses.some(
      (row) => row.producedOrIncreasedByRepair,
    )
  );
}

function hasBlockingRepairOrSuspiciousEvidence(input: {
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRows: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
}): boolean {
  return (
    input.suspiciousRows.length > 0 ||
    input.repairRows.some(
      (row) => row.materiality === "moderate" || row.materiality === "major",
    )
  );
}

function shouldEmitExerciseClassCause(input: {
  alignment: ExerciseClassAlignmentMuscle;
  duplicateWarnings: ReadonlyArray<string>;
  owningCause: ExerciseClassUnresolvedOwningCause;
  hasSupportFloorLateRepair: boolean;
  hasRepairIdentityChurn: boolean;
  hasCapCleanupOrFinalShaping: boolean;
}): boolean {
  if (
    input.alignment.finalAlignment === "missing" ||
    input.alignment.finalAlignment === "partial" ||
    input.alignment.finalAlignment === "violated"
  ) {
    return true;
  }
  if (input.owningCause === "diagnostic_only_not_actionable") {
    return true;
  }
  return (
    input.duplicateWarnings.length > 0 ||
    input.hasSupportFloorLateRepair ||
    input.hasRepairIdentityChurn ||
    input.hasCapCleanupOrFinalShaping
  );
}

function classifyExerciseClassUnresolvedCause(input: {
  slotId: string;
  demand: ExerciseClassDistributionMuscle;
  alignment: ExerciseClassAlignmentMuscle;
  duplicateWarnings: ReadonlyArray<string>;
  repairRows: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRows: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  globalBlockingRepairOrSuspiciousEvidence: boolean;
  guardRows: ReadonlyArray<DistributionGuardAction>;
  concentrationRows: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): ExerciseClassUnresolvedCause | null {
  const compatibleCandidateVisible = hasVisibleCompatibleClassCandidate({
    demand: input.demand,
    intendedClasses: input.alignment.intendedClasses,
    initialSelectedClasses: input.alignment.initialSelectedClasses,
    finalSelectedClasses: input.alignment.finalSelectedClasses,
  });
  const slotCapacityIssue = hasSlotCapacityIssueEvidence(input.demand);
  const supportFloorLateRepair = hasSupportFloorLateRepairEvidence({
    repairRows: input.repairRows,
    demand: input.demand,
  });
  const capCleanupOrFinalShaping = hasCapCleanupOrFinalShapingEvidence({
    repairRows: input.repairRows,
    guardRows: input.guardRows,
    concentrationRows: input.concentrationRows,
    demand: input.demand,
  });
  const repairIdentityChurn = hasRepairIdentityChurnEvidence({
    alignment: input.alignment,
    repairRows: input.repairRows,
  });
  const inventoryClassificationGap = hasInventoryClassificationGapEvidence({
    demand: input.demand,
    intendedClasses: input.alignment.intendedClasses,
    compatibleCandidateVisible,
  });
  const duplicateConflict =
    input.duplicateWarnings.length > 0 ||
    input.demand.duplicatePolicy === "block_if_clean_alternative_exists";
  const initialMissesClass =
    input.alignment.initialAlignment === "missing" ||
    input.alignment.initialAlignment === "partial";
  const finalStillUnresolved =
    input.alignment.finalAlignment === "missing" ||
    input.alignment.finalAlignment === "partial" ||
    input.alignment.finalAlignment === "violated";
  const hasBlockingEvidence = hasBlockingRepairOrSuspiciousEvidence({
    repairRows: input.repairRows,
    suspiciousRows: input.suspiciousRows,
  }) || input.globalBlockingRepairOrSuspiciousEvidence;

  let owningCause: ExerciseClassUnresolvedOwningCause;
  if (
    input.alignment.targetStatus === "diagnostic" ||
    input.alignment.demandType === "diagnostic_only" ||
    (input.alignment.targetStatus === "forbidden" &&
      input.alignment.finalAlignment !== "violated")
  ) {
    owningCause = "diagnostic_only_not_actionable";
  } else if (supportFloorLateRepair) {
    owningCause = "support_floor_late_repair";
  } else if (duplicateConflict) {
    owningCause = "duplicate_continuity_conflict";
  } else if (repairIdentityChurn) {
    owningCause = "repair_identity_churn";
  } else if (capCleanupOrFinalShaping) {
    owningCause = "cap_cleanup_or_final_shaping";
  } else if (slotCapacityIssue) {
    owningCause = "slot_capacity_issue";
  } else if (
    compatibleCandidateVisible &&
    !slotCapacityIssue &&
    initialMissesClass &&
    (finalStillUnresolved ||
      input.alignment.repairEffect === "improved_alignment")
  ) {
    owningCause = "selection_blind_spot";
  } else if (inventoryClassificationGap) {
    owningCause = "inventory_classification_gap";
  } else {
    owningCause = "true_unresolved_demand";
  }

  if (
    !shouldEmitExerciseClassCause({
      alignment: input.alignment,
      duplicateWarnings: input.duplicateWarnings,
      owningCause,
      hasSupportFloorLateRepair: supportFloorLateRepair,
      hasRepairIdentityChurn: repairIdentityChurn,
      hasCapCleanupOrFinalShaping: capCleanupOrFinalShaping,
    })
  ) {
    return null;
  }

  const evidence = compactDiagnosticStrings(
    [
      `initial_alignment:${input.alignment.initialAlignment}`,
      `final_alignment:${input.alignment.finalAlignment}`,
      compatibleCandidateVisible
        ? "compatible_candidate_visible"
        : "compatible_candidate_not_visible",
      slotCapacityIssue ? "slot_capacity_blocked" : "slot_capacity_available",
      ...input.duplicateWarnings,
      ...input.repairRows.map(
        (row) =>
          `repair:${row.exerciseName ?? row.exerciseId ?? "unknown"}:${row.action}:${row.repairMechanism}`,
      ),
      ...input.suspiciousRows.map(
        (row) =>
          `suspicious_repair:${row.exerciseName ?? "unknown"}:${row.repairMechanism}`,
      ),
      ...input.guardRows.map(
        (row) =>
          `distribution_guard:${row.exerciseName}:${row.attemptedAction}:${row.decision}`,
      ),
      ...input.demand.inventoryEvidence.filter(
        (row) =>
          row.startsWith("inventory:") ||
          row.startsWith("duplicate:") ||
          row.startsWith("slot_exercise_count:"),
      ),
    ],
    3,
  );
  const limitations = compactDiagnosticStrings(
    [
      ...(hasBlockingEvidence
        ? ["repair_materiality_or_suspicious_repairs_block_behavior_readiness"]
        : []),
      "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
      "uses_existing_planningReality_rows_only",
      "does_not_replay_candidate_ranking_or_selection_trials",
    ],
    2,
  );

  return {
    slotId: input.slotId,
    muscle: input.alignment.muscle,
    targetStatus: input.alignment.targetStatus,
    demandType: input.alignment.demandType,
    initialAlignment: input.alignment.initialAlignment,
    finalAlignment: input.alignment.finalAlignment,
    owningCause,
    recommendedOwner: mapExerciseClassCauseOwner(owningCause),
    behaviorReadiness: mapExerciseClassBehaviorReadiness({
      owningCause,
      hasBlockingRepairOrSuspiciousEvidence: hasBlockingEvidence,
    }),
    evidence,
    limitations,
  };
}

function buildExerciseClassAlignment(input: {
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot>;
  initialSlotComposition: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRepairsNotEligibleForPromotion: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  distributionGuardActions: ReadonlyArray<DistributionGuardAction>;
}): {
  alignment: ExerciseClassAlignment;
  unresolvedCauses: ExerciseClassUnresolvedCause[];
} {
  const initialSlotById = new Map(
    input.initialSlotComposition.map((slot) => [slot.slotId, slot]),
  );
  const finalSlotById = new Map(
    input.finalSlotPlan.map((slot) => [slot.slotId, slot]),
  );
  const weekOneClassDistributions = input.exerciseClassDistributionBySlot.filter(
    (slot) =>
      slot.week === 1 &&
      slot.projectionStatus === "projected_from_current_evidence",
  );
  const globalBlockingRepairOrSuspiciousEvidence =
    input.suspiciousRepairsNotEligibleForPromotion.length > 0 ||
    input.repairMaterialityAfterShadowAllocation.some(
      (row) => row.materiality === "moderate" || row.materiality === "major",
    );
  const unresolvedCauses: ExerciseClassUnresolvedCause[] = [];

  const slots: ExerciseClassAlignmentSlot[] = weekOneClassDistributions.map(
    (slot) => {
      const initialSlot = initialSlotById.get(slot.slotId);
      const finalSlot = finalSlotById.get(slot.slotId);
      const slotWarnings: string[] = [];
      const muscleAlignments = slot.muscleDemands.map((demand) => {
        const intendedClasses =
          demand.requiredExerciseClasses.length > 0
            ? demand.requiredExerciseClasses
            : demand.preferredExerciseClasses;
        const initialSelectedClasses = buildSelectedExerciseClasses({
          slot: initialSlot,
          muscle: demand.muscle,
        });
        const finalSelectedBase = buildSelectedExerciseClasses({
          slot: finalSlot,
          muscle: demand.muscle,
        });
        const finalSelectedClasses = withFinalRepairFlags({
          slotId: slot.slotId,
          muscle: demand.muscle,
          selected: finalSelectedBase,
          repairRows: input.repairMaterialityAfterShadowAllocation,
          concentrationRows: input.exerciseConcentration,
        });
        const duplicateWarnings = findDuplicatePolicyWarnings({
          muscle: demand.muscle,
          demand,
          finalSelected: finalSelectedBase,
        });
        slotWarnings.push(...duplicateWarnings);
        const duplicatePolicyFailure =
          demand.muscle === "Chest" &&
          demand.duplicatePolicy === "block_if_clean_alternative_exists" &&
          duplicateWarnings.length > 0;
        const initialAlignment = evaluateExerciseClassAlignment({
          muscle: demand.muscle,
          targetStatus: demand.targetStatus,
          requiredClasses: demand.requiredExerciseClasses,
          intendedClasses,
          forbiddenClasses: demand.forbiddenExerciseClasses,
          duplicatePolicyFailure,
          selected: initialSelectedClasses,
        });
        const finalAlignment = evaluateExerciseClassAlignment({
          muscle: demand.muscle,
          targetStatus: demand.targetStatus,
          requiredClasses: demand.requiredExerciseClasses,
          intendedClasses,
          forbiddenClasses: demand.forbiddenExerciseClasses,
          duplicatePolicyFailure,
          selected: finalSelectedBase,
        });
        const identityChurn = hasIdentityChurn({
          slotId: slot.slotId,
          muscle: demand.muscle,
          repairRows: input.repairMaterialityAfterShadowAllocation,
        });
        const matchingRepairRows = input.repairMaterialityAfterShadowAllocation
          .filter((row) => row.slotId === slot.slotId && row.muscle === demand.muscle);
        const matchingSuspiciousRows =
          input.suspiciousRepairsNotEligibleForPromotion.filter(
            (row) => row.slotId === slot.slotId && row.muscle === demand.muscle,
          );
        const matchingGuardRows = input.distributionGuardActions.filter(
          (row) => row.slotId === slot.slotId && row.muscle === demand.muscle,
        );
        const matchingConcentrationRows = input.exerciseConcentration.filter(
          (row) =>
            row.slotId === slot.slotId &&
            Object.prototype.hasOwnProperty.call(
              row.percentageOfWeeklyProjectedStimulusByMuscle,
              demand.muscle,
            ),
        );
        const repairEvidence = matchingRepairRows
          .map(
            (row) =>
              `repair:${row.exerciseName ?? row.exerciseId ?? "unknown"}:${row.action}:${row.effectiveStimulusDelta}`,
          );
        const weakConsumptionEvidence = input.weakPreselectionConsumption
          .filter((row) => row.slotId === slot.slotId && row.muscle === demand.muscle)
          .map(
            (row) =>
              `weak_preselection_consumption:selected=${roundToTenth(row.selectedEffectiveSets)}:targetMet=${row.targetMet}`,
          );
        const guardEvidence = input.distributionGuardActions
          .filter((row) => row.slotId === slot.slotId && row.muscle === demand.muscle)
          .map(
            (row) =>
              `distribution_guard:${row.exerciseName}:${row.attemptedAction}:${row.decision}`,
          );
        const evidence = compactDiagnosticStrings([
          `initial_alignment:${initialAlignment}`,
          `final_alignment:${finalAlignment}`,
          ...initialSelectedClasses.map(
            (row) =>
              `initial:${row.exerciseName}:${row.exerciseClass}:${row.setCount} sets`,
          ),
          ...finalSelectedClasses.map(
            (row) =>
              `final:${row.exerciseName}:${row.exerciseClass}:${row.setCount} sets:repair=${row.producedOrIncreasedByRepair}`,
          ),
          ...duplicateWarnings,
          ...repairEvidence,
          ...weakConsumptionEvidence,
          ...guardEvidence,
        ]);
        const limitations = compactDiagnosticStrings([
          "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
          "exercise_class_is_inferred_from_existing_projection_rows",
          "does_not_replay_candidate_ranking_or_selection_trials",
          ...demand.limitations,
        ], 8);

        const alignment: ExerciseClassAlignmentMuscle = {
          muscle: demand.muscle,
          targetStatus: demand.targetStatus,
          demandType: demand.demandType,
          intendedClasses: uniqueSorted(intendedClasses),
          forbiddenClasses: demand.forbiddenExerciseClasses,
          initialSelectedClasses,
          finalSelectedClasses,
          initialAlignment,
          finalAlignment,
          repairEffect: classifyRepairEffect({
            initialAlignment,
            finalAlignment,
            identityChurn,
            hasRepairEvidence: repairEvidence.length > 0,
          }),
          evidence,
          limitations,
        };
        const unresolvedCause = classifyExerciseClassUnresolvedCause({
          slotId: slot.slotId,
          demand,
          alignment,
          duplicateWarnings,
          repairRows: matchingRepairRows,
          suspiciousRows: matchingSuspiciousRows,
          globalBlockingRepairOrSuspiciousEvidence,
          guardRows: matchingGuardRows,
          concentrationRows: matchingConcentrationRows,
        });
        if (unresolvedCause) {
          unresolvedCauses.push(unresolvedCause);
        }
        return alignment;
      });

      return {
        slotId: slot.slotId,
        slotIndex: slot.slotIndex,
        slotArchetype: slot.slotArchetype,
        muscleAlignments,
        slotWarnings: compactDiagnosticStrings(slotWarnings, 8),
      };
    },
  );

  const allAlignments = slots.flatMap((slot) => slot.muscleAlignments);
  return {
    alignment: {
      version: 1,
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      slots,
      summary: {
        initiallySatisfied: allAlignments.filter(
          (row) => row.initialAlignment === "satisfied",
        ).length,
        finallySatisfied: allAlignments.filter(
          (row) => row.finalAlignment === "satisfied",
        ).length,
        improvedByRepair: allAlignments.filter(
          (row) => row.repairEffect === "improved_alignment",
        ).length,
        worsenedByRepair: allAlignments.filter(
          (row) => row.repairEffect === "worsened_alignment",
        ).length,
        identityChurnCount: allAlignments.filter((row) =>
          input.repairMaterialityAfterShadowAllocation.some(
            (repair) =>
              repair.slotId ===
                slots.find((slot) => slot.muscleAlignments.includes(row))?.slotId &&
              repair.muscle === row.muscle &&
              repair.changedExerciseIdentity,
          ),
        ).length,
        unresolvedClassIntentCount: allAlignments.filter(
          (row) =>
            row.finalAlignment === "missing" ||
            row.finalAlignment === "partial" ||
            row.finalAlignment === "violated",
        ).length,
      },
    },
    unresolvedCauses: unresolvedCauses.sort(
      (left, right) =>
        left.slotId.localeCompare(right.slotId) ||
        left.muscle.localeCompare(right.muscle) ||
        left.owningCause.localeCompare(right.owningCause),
    ),
  };
}

type DuplicateContinuityRow =
  DuplicateContinuityJustification["duplicates"][number];

type DuplicateContinuityCandidate = {
  duplicateType: DuplicateContinuityRow["duplicateType"];
  exerciseId: string;
  exerciseName: string;
  duplicatedInSlots: string[];
  roleBySlot: Record<string, string>;
  setCountBySlot: Record<string, number>;
  primaryMuscles: string[];
  movementPatterns: string[];
  exerciseClass: string | null;
};

function getSnapshotExerciseClass(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number],
): string | null {
  const muscle = exercise.primaryMuscles[0] ?? Object.keys(exercise.effectiveStimulusByMuscle)[0];
  return muscle
    ? classifySelectedExerciseClass({ exercise, muscle })
    : null;
}

function toDuplicateClassFamily(exerciseClass: string | null): string | null {
  return exerciseClass ? toDuplicatePolicyClass(exerciseClass) : null;
}

function buildCrossSlotDuplicateCandidates(
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
): DuplicateContinuityCandidate[] {
  const byExercise = new Map<
    string,
    {
      exerciseId: string;
      exerciseName: string;
      slots: Set<string>;
      roleBySlot: Record<string, string>;
      setCountBySlot: Record<string, number>;
      primaryMuscles: Set<string>;
      movementPatterns: Set<string>;
      exerciseClasses: Set<string>;
    }
  >();

  for (const slot of finalSlotPlan) {
    for (const exercise of slot.exercises) {
      const key = exercise.exerciseId || exercise.exerciseName;
      const existing =
        byExercise.get(key) ?? {
          exerciseId: exercise.exerciseId,
          exerciseName: exercise.exerciseName,
          slots: new Set<string>(),
          roleBySlot: {},
          setCountBySlot: {},
          primaryMuscles: new Set<string>(),
          movementPatterns: new Set<string>(),
          exerciseClasses: new Set<string>(),
        };
      existing.slots.add(slot.slotId);
      existing.roleBySlot[slot.slotId] = exercise.role;
      existing.setCountBySlot[slot.slotId] =
        (existing.setCountBySlot[slot.slotId] ?? 0) + exercise.setCount;
      for (const muscle of exercise.primaryMuscles) {
        existing.primaryMuscles.add(muscle);
      }
      for (const pattern of exercise.movementPatterns) {
        existing.movementPatterns.add(pattern);
      }
      const exerciseClass = getSnapshotExerciseClass(exercise);
      if (exerciseClass) {
        existing.exerciseClasses.add(exerciseClass);
      }
      byExercise.set(key, existing);
    }
  }

  return Array.from(byExercise.values())
    .filter((row) => row.slots.size > 1)
    .map((row) => ({
      duplicateType: "same_exercise_cross_slot" as const,
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      duplicatedInSlots: Array.from(row.slots).sort((left, right) =>
        left.localeCompare(right),
      ),
      roleBySlot: Object.fromEntries(
        Object.entries(row.roleBySlot).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      setCountBySlot: Object.fromEntries(
        Object.entries(row.setCountBySlot).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      primaryMuscles: Array.from(row.primaryMuscles).sort((left, right) =>
        left.localeCompare(right),
      ),
      movementPatterns: Array.from(row.movementPatterns).sort((left, right) =>
        left.localeCompare(right),
      ),
      exerciseClass:
        Array.from(row.exerciseClasses).sort((left, right) =>
          left.localeCompare(right),
        )[0] ?? null,
    }));
}

function buildSameSessionVariantCandidates(
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
): DuplicateContinuityCandidate[] {
  return finalSlotPlan.flatMap((slot) => {
    const calfExercises = slot.exercises.filter((exercise) => {
      const exerciseClass = toDuplicateClassFamily(getSnapshotExerciseClass(exercise));
      return (
        exerciseClass === "calf_raise" &&
        exercise.primaryMuscles.includes("Calves")
      );
    });
    if (calfExercises.length <= 1) {
      return [];
    }
    const exerciseClasses = uniqueSorted(
      calfExercises
        .map((exercise) => getSnapshotExerciseClass(exercise))
        .filter((value): value is string => value != null),
    );
    const exerciseName = calfExercises
      .map((exercise) => exercise.exerciseName)
      .sort((left, right) => left.localeCompare(right))
      .join(" + ");
    return [{
      duplicateType: "same_session_variant" as const,
      exerciseId: calfExercises
        .map((exercise) => exercise.exerciseId)
        .sort((left, right) => left.localeCompare(right))
        .join("+"),
      exerciseName,
      duplicatedInSlots: [slot.slotId],
      roleBySlot: {
        [slot.slotId]: uniqueSorted(calfExercises.map((exercise) => exercise.role)).join("+"),
      },
      setCountBySlot: {
        [slot.slotId]: calfExercises.reduce(
          (sum, exercise) => sum + exercise.setCount,
          0,
        ),
      },
      primaryMuscles: ["Calves"],
      movementPatterns: uniqueSorted(
        calfExercises.flatMap((exercise) => exercise.movementPatterns),
      ),
      exerciseClass: exerciseClasses.length === 1 ? exerciseClasses[0] : "calf_raise",
    }];
  });
}

function classifyDiagnosticExerciseForDuplicate(input: {
  exercise: DiagnosticExercise;
  muscle: string;
}): string | null {
  const snapshotExercise: SlotCompositionSnapshotDiagnostic["exercises"][number] = {
    exerciseId: input.exercise.id,
    exerciseName: input.exercise.name,
    role: input.exercise.isMainLiftEligible ? "main" : "accessory",
    setCount: 1,
    primaryMuscles: normalizeExerciseMuscles(input.exercise.primaryMuscles),
    movementPatterns: sortPrescriptionStrings(input.exercise.movementPatterns ?? []),
    effectiveStimulusByMuscle: {},
  };
  return classifySelectedExerciseClass({
    exercise: snapshotExercise,
    muscle: input.muscle,
  });
}

function buildCompatibleDuplicateAlternatives(input: {
  duplicate: DuplicateContinuityCandidate;
  exerciseLibrary: ReadonlyArray<DiagnosticExercise> | undefined;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  preselectionFeasibility: ReadonlyArray<CleanPreselectionFeasibility>;
}): DuplicateContinuityRow["compatibleAlternatives"] {
  const selectedIds = new Set(
    input.finalSlotPlan.flatMap((slot) =>
      slot.exercises.map((exercise) => exercise.exerciseId),
    ),
  );
  const primaryMuscles = new Set(input.duplicate.primaryMuscles);
  const duplicateClassFamily = toDuplicateClassFamily(input.duplicate.exerciseClass);
  const roleRequiresMain = Object.values(input.duplicate.roleBySlot).some((role) =>
    role.includes("main"),
  );
  const fromLibrary = (input.exerciseLibrary ?? [])
    .filter((exercise) => exercise.id !== input.duplicate.exerciseId)
    .filter((exercise) =>
      normalizeExerciseMuscles(exercise.primaryMuscles).some((muscle) =>
        primaryMuscles.has(muscle),
      ),
    )
    .filter((exercise) =>
      roleRequiresMain
        ? Boolean(exercise.isMainLiftEligible)
        : !Boolean(exercise.isMainLiftEligible),
    )
    .filter((exercise) => !selectedIds.has(exercise.id))
    .map((exercise) => {
      const primary = normalizeExerciseMuscles(exercise.primaryMuscles);
      const muscle = primary.find((value) => primaryMuscles.has(value)) ?? primary[0] ?? "";
      const exerciseClass = muscle
        ? classifyDiagnosticExerciseForDuplicate({ exercise, muscle })
        : null;
      const classFamily = toDuplicateClassFamily(exerciseClass);
      return {
        exerciseName: exercise.name,
        exerciseClass,
        primaryMuscles: primary,
        reasonAvailableOrBlocked: uniqueSorted([
          "primary_muscle_overlap",
          roleRequiresMain ? "main_lift_role_compatible" : "accessory_role_compatible",
          classFamily && classFamily === duplicateClassFamily
            ? "same_class_available"
            : "distinct_class_available",
        ]),
      };
    });

  const fromCandidateInventory = input.preselectionFeasibility
    .filter((row) =>
      input.duplicate.duplicatedInSlots.includes(row.slotId) &&
      primaryMuscles.has(row.muscle),
    )
    .flatMap((row) =>
      row.candidateInventory
        .filter((candidate) =>
          candidate.availability === "clean_available" ||
          candidate.availability === "available_but_already_used_elsewhere",
        )
        .filter((candidate) => candidate.exerciseId !== input.duplicate.exerciseId)
        .map((candidate) => ({
          exerciseName: candidate.exerciseName,
          exerciseClass: candidate.candidateClass,
          primaryMuscles: candidate.primaryMuscles,
          reasonAvailableOrBlocked: uniqueSorted([
            `candidate_inventory:${candidate.availability}`,
            ...candidate.reasons.slice(0, 2),
          ]),
        })),
    );

  const byName = new Map<string, DuplicateContinuityRow["compatibleAlternatives"][number]>();
  for (const alternative of [...fromLibrary, ...fromCandidateInventory]) {
    if (!byName.has(alternative.exerciseName)) {
      byName.set(alternative.exerciseName, alternative);
    }
  }
  return Array.from(byName.values())
    .sort((left, right) => left.exerciseName.localeCompare(right.exerciseName))
    .slice(0, 5);
}

function matchingDuplicateRows(input: {
  duplicate: DuplicateContinuityCandidate;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): DuplicateExerciseReuseDiagnostic[] {
  return input.duplicateExerciseReuse.filter(
    (row) =>
      row.exerciseId === input.duplicate.exerciseId ||
      row.name === input.duplicate.exerciseName,
  );
}

function matchingClassDemands(input: {
  duplicate: DuplicateContinuityCandidate;
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot>;
}): ExerciseClassDistributionMuscle[] {
  const muscles = new Set(input.duplicate.primaryMuscles);
  return input.exerciseClassDistributionBySlot
    .filter(
      (slot) =>
        slot.week === 1 &&
        input.duplicate.duplicatedInSlots.includes(slot.slotId),
    )
    .flatMap((slot) =>
      slot.muscleDemands.filter((demand) => muscles.has(demand.muscle)),
    );
}

function chooseDuplicateJustification(input: {
  duplicate: DuplicateContinuityCandidate;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  classDemands: ReadonlyArray<ExerciseClassDistributionMuscle>;
  compatibleAlternativeExists: boolean | null;
}): DuplicateContinuityRow["justification"] {
  const demandJustifications = input.classDemands.flatMap(
    (demand) => demand.duplicateJustifications,
  );
  if (demandJustifications.includes("deload_skill_preservation")) {
    return "deload_skill_preservation";
  }
  if (demandJustifications.includes("user_preference")) {
    return "user_preference";
  }
  if (
    demandJustifications.includes("no_clean_alternative") ||
    input.duplicateRows.some(
      (row) => !row.hasCompatibleAlternative && row.reason !== "limited_inventory",
    )
  ) {
    return "no_clean_alternative";
  }
  if (
    demandJustifications.includes("limited_inventory") ||
    input.duplicateRows.some((row) => row.reason === "limited_inventory")
  ) {
    return "limited_inventory";
  }
  if (
    demandJustifications.includes("continuity_anchor") ||
    input.duplicateRows.some((row) => row.reason === "main_lift_continuity_allowed")
  ) {
    return "continuity_anchor";
  }
  if (
    demandJustifications.includes("exact_demand_fit") ||
    (input.duplicate.exerciseClass === "stiff_leg_deadlift" &&
      input.duplicate.duplicatedInSlots.includes("lower_b"))
  ) {
    return "exact_demand_fit";
  }
  if (input.duplicate.duplicateType === "same_session_variant") {
    return "unjustified";
  }
  return input.compatibleAlternativeExists === true ? "unjustified" : "unknown";
}

function chooseDuplicatePolicyRecommendation(input: {
  duplicate: DuplicateContinuityCandidate;
  justification: DuplicateContinuityRow["justification"];
  compatibleAlternativeExists: boolean | null;
}): DuplicateContinuityRow["policyRecommendation"] {
  if (
    input.justification === "limited_inventory" ||
    input.justification === "no_clean_alternative" ||
    input.justification === "deload_skill_preservation"
  ) {
    return input.compatibleAlternativeExists === true
      ? "requires_planner_decision"
      : "allow_duplicate";
  }
  if (input.duplicate.duplicateType === "same_session_variant") {
    return "discourage_duplicate";
  }
  if (
    input.compatibleAlternativeExists === true &&
    input.duplicate.exerciseName.toLowerCase().includes("incline")
  ) {
    return "block_if_clean_alternative_exists";
  }
  if (
    input.compatibleAlternativeExists === true &&
    input.duplicate.exerciseName.toLowerCase().includes("sldl")
  ) {
    return "requires_planner_decision";
  }
  if (
    input.duplicate.exerciseName.toLowerCase().includes("lat pulldown") ||
    input.duplicate.exerciseName.toLowerCase().includes("back squat")
  ) {
    return "discourage_duplicate";
  }
  return input.compatibleAlternativeExists === true
    ? "requires_planner_decision"
    : "discourage_duplicate";
}

function chooseDuplicateRisk(input: {
  duplicate: DuplicateContinuityCandidate;
  compatibleAlternativeExists: boolean | null;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
}): DuplicateContinuityRow["risk"] {
  const name = input.duplicate.exerciseName.toLowerCase();
  const projectedMuscles = input.projectedDelivery.filter((row) =>
    input.duplicate.primaryMuscles.includes(row.muscle),
  );
  const underTarget = projectedMuscles.some(
    (row) =>
      row.preferredTarget != null &&
      row.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
        row.preferredTarget,
  );
  const overTarget = projectedMuscles.some(
    (row) =>
      row.preferredTarget != null &&
      row.projectedEffectiveStimulusAfterRepairAndFinalShaping >
        row.preferredTarget + 1e-9,
  );
  if (
    name.includes("incline") &&
    (underTarget || input.compatibleAlternativeExists === true)
  ) {
    return "high";
  }
  if (name.includes("sldl") && overTarget) {
    return "high";
  }
  if (input.duplicate.duplicateType === "same_session_variant") {
    return input.compatibleAlternativeExists === true ? "moderate" : "low";
  }
  return Object.values(input.duplicate.roleBySlot).some((role) => role.includes("main")) ||
    input.compatibleAlternativeExists === true
    ? "moderate"
    : "low";
}

function buildDuplicateEvidence(input: {
  duplicate: DuplicateContinuityCandidate;
  duplicateRows: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  classDemands: ReadonlyArray<ExerciseClassDistributionMuscle>;
  unresolvedCauses: ReadonlyArray<ExerciseClassUnresolvedCause>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  accumulationWeekProjection: AccumulationWeekProjection | null;
}): string[] {
  const muscles = new Set(input.duplicate.primaryMuscles);
  const deliveryEvidence = input.projectedDelivery
    .filter((row) => muscles.has(row.muscle))
    .map(
      (row) =>
        `${row.muscle}:final=${row.projectedEffectiveStimulusAfterRepairAndFinalShaping}:preferred=${formatNullableNumber(row.preferredTarget)}`,
    );
  const accumulationEvidence = (input.accumulationWeekProjection?.crossWeekWarnings ?? [])
    .filter((warning) =>
      warning.code.includes("DUPLICATE") ||
      (warning.muscle != null && muscles.has(warning.muscle)),
    )
    .flatMap((warning) => warning.evidence.map((row) => `${warning.code}:${row}`));
  return compactDiagnosticStrings(
    [
      `duplicate_type:${input.duplicate.duplicateType}`,
      `slots:${input.duplicate.duplicatedInSlots.join("+")}`,
      ...input.duplicateRows.map(
        (row) =>
          `duplicate_reuse:${row.name}:${row.reason}:alternative=${row.hasCompatibleAlternative}`,
      ),
      ...input.classDemands.flatMap((demand) => [
        `${demand.muscle}:duplicate_policy=${demand.duplicatePolicy}`,
        ...demand.inventoryEvidence.filter((row) => row.startsWith("duplicate:")),
        ...demand.limitations.filter((row) => row.includes("duplicate")),
      ]),
      ...input.unresolvedCauses
        .filter((cause) => muscles.has(cause.muscle))
        .map((cause) => `${cause.muscle}:${cause.owningCause}`),
      ...deliveryEvidence,
      ...accumulationEvidence,
    ],
    8,
  );
}

function buildDuplicateContinuityJustification(input: {
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  exerciseLibrary?: ReadonlyArray<DiagnosticExercise>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  exerciseClassDistributionBySlot: ReadonlyArray<ExerciseClassDistributionBySlot>;
  exerciseClassUnresolvedCauses: ReadonlyArray<ExerciseClassUnresolvedCause>;
  preselectionFeasibility: ReadonlyArray<CleanPreselectionFeasibility>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  accumulationWeekProjection: AccumulationWeekProjection | null;
}): DuplicateContinuityJustification {
  const candidates = [
    ...buildCrossSlotDuplicateCandidates(input.finalSlotPlan),
    ...buildSameSessionVariantCandidates(input.finalSlotPlan),
  ];
  const duplicates = candidates.map((duplicate) => {
    const duplicateRows = matchingDuplicateRows({
      duplicate,
      duplicateExerciseReuse: input.duplicateExerciseReuse,
    });
    const classDemands = matchingClassDemands({
      duplicate,
      exerciseClassDistributionBySlot: input.exerciseClassDistributionBySlot,
    });
    const compatibleAlternatives = buildCompatibleDuplicateAlternatives({
      duplicate,
      exerciseLibrary: input.exerciseLibrary,
      finalSlotPlan: input.finalSlotPlan,
      preselectionFeasibility: input.preselectionFeasibility,
    });
    const compatibleAlternativeExists =
      duplicateRows.some((row) => row.hasCompatibleAlternative) ||
      compatibleAlternatives.length > 0
        ? true
        : duplicateRows.some((row) => !row.hasCompatibleAlternative)
          ? false
          : input.exerciseLibrary
            ? false
            : null;
    const justification = chooseDuplicateJustification({
      duplicate,
      duplicateRows,
      classDemands,
      compatibleAlternativeExists,
    });
    const policyRecommendation = chooseDuplicatePolicyRecommendation({
      duplicate,
      justification,
      compatibleAlternativeExists,
    });
    const risk = chooseDuplicateRisk({
      duplicate,
      compatibleAlternativeExists,
      projectedDelivery: input.projectedDelivery,
    });

    return {
      ...duplicate,
      justification,
      compatibleAlternativeExists,
      compatibleAlternatives,
      policyRecommendation,
      risk,
      evidence: buildDuplicateEvidence({
        duplicate,
        duplicateRows,
        classDemands,
        unresolvedCauses: input.exerciseClassUnresolvedCauses,
        projectedDelivery: input.projectedDelivery,
        accumulationWeekProjection: input.accumulationWeekProjection,
      }),
      limitations: [
        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
        "uses_existing_planningReality_rows_only",
        "does_not_replay_candidate_ranking_or_selection_trials",
        "compatible_alternatives_are_compact_visibility_not_full_inventory",
      ],
    };
  }).sort(
    (left, right) =>
      left.risk.localeCompare(right.risk) ||
      left.exerciseName.localeCompare(right.exerciseName),
  );

  return {
    version: 1,
    source: "diagnostic_shadow_planner",
    readOnly: true,
    affectsScoringOrGeneration: false,
    duplicates,
    summary: {
      totalDuplicates: duplicates.length,
      justifiedDuplicates: duplicates.filter(
        (row) => row.justification !== "unjustified" && row.justification !== "unknown",
      ).length,
      unjustifiedOrUnknown: duplicates.filter(
        (row) => row.justification === "unjustified" || row.justification === "unknown",
      ).length,
      cleanAlternativeAvailable: duplicates.filter(
        (row) => row.compatibleAlternativeExists === true,
      ).length,
      highRiskDuplicates: duplicates.filter((row) => row.risk === "high").length,
    },
  };
}

type AccumulationProjectionWeek = AccumulationWeekProjection["weeks"][number];
type AccumulationProjectedMuscle =
  AccumulationProjectionWeek["projectedMuscles"][number];
type AccumulationProjectedSlotRisk =
  AccumulationProjectionWeek["projectedSlotRisks"][number];

function toAccumulationProjectionPhase(
  phase: WeeklyDemandCurve["weeks"][number]["phase"],
): AccumulationProjectionWeek["phase"] {
  if (phase === "accumulation") {
    return "accumulation";
  }
  if (phase === "peak") {
    return "peak";
  }
  return "unknown";
}

function getAccumulationProjectionStatus(
  phase: WeeklyDemandCurve["weeks"][number]["phase"],
): AccumulationProjectionWeek["projectionStatus"] {
  return phase === "accumulation" || phase === "peak"
    ? "partially_projected_missing_progression"
    : "not_projected_missing_policy";
}

function getProjectedMuscleStatus(input: {
  targetStatus: AccumulationProjectedMuscle["targetStatus"];
  projectedEffectiveSets: number | null;
  preferredEffectiveSets: number | null;
}): AccumulationProjectedMuscle["status"] {
  if (input.targetStatus === "diagnostic") {
    return "diagnostic_only";
  }
  if (
    input.projectedEffectiveSets == null ||
    input.preferredEffectiveSets == null
  ) {
    return "unknown";
  }
  if (input.projectedEffectiveSets + 1e-9 < input.preferredEffectiveSets) {
    return "below";
  }
  if (input.projectedEffectiveSets > input.preferredEffectiveSets + 1e-9) {
    return "above";
  }
  return "within";
}

function getProjectedMuscleTrend(
  status: AccumulationProjectedMuscle["status"],
): AccumulationProjectedMuscle["trend"] {
  switch (status) {
    case "below":
      return "persistent_under_target";
    case "above":
      return "persistent_over_target";
    case "within":
      return "stable";
    case "diagnostic_only":
    case "unknown":
      return "unknown";
  }
}

function buildRepeatedExerciseEvidence(
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
): string[] {
  const byExercise = new Map<
    string,
    { name: string; slotIds: Set<string>; isMain: boolean }
  >();

  for (const slot of finalSlotPlan) {
    for (const exercise of slot.exercises) {
      const key = exercise.exerciseId || exercise.exerciseName;
      const existing =
        byExercise.get(key) ??
        {
          name: exercise.exerciseName,
          slotIds: new Set<string>(),
          isMain: false,
        };
      existing.slotIds.add(slot.slotId);
      if (exercise.role === "main") {
        existing.isMain = true;
      }
      byExercise.set(key, existing);
    }
  }

  return Array.from(byExercise.values())
    .filter((row) => row.slotIds.size > 1)
    .map(
      (row) =>
        `duplicate:${row.name}:slots=${Array.from(row.slotIds)
          .sort((left, right) => left.localeCompare(right))
          .join("+")}:role=${row.isMain ? "main" : "accessory"}`,
    )
    .sort((left, right) => left.localeCompare(right));
}

function buildDuplicateProjectionEvidence(input: {
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): string[] {
  return uniqueSorted([
    ...input.duplicateExerciseReuse.map(
      (row) =>
        `duplicate:${row.name}:slot=${row.repeatedInSlotId}:previous=${row.previousSlotIds.join(
          "+",
        )}:role=${row.role}:alternative=${row.hasCompatibleAlternative}`,
    ),
    ...buildRepeatedExerciseEvidence(input.finalSlotPlan),
  ]);
}

function buildAccumulationProjectionMuscles(input: {
  week: WeeklyDemandCurve["weeks"][number];
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
}): AccumulationProjectedMuscle[] {
  const deliveryByMuscle = new Map(
    input.projectedDelivery.map((row) => [row.muscle, row]),
  );

  return input.week.muscles.map((muscle) => {
    const delivery = deliveryByMuscle.get(muscle.muscle);
    const projectedEffectiveSets =
      delivery?.projectedEffectiveStimulusAfterRepairAndFinalShaping ?? null;
    const preferredEffectiveSets =
      delivery?.preferredTarget ?? muscle.preferredEffectiveSets;
    const status = getProjectedMuscleStatus({
      targetStatus: muscle.targetStatus,
      projectedEffectiveSets,
      preferredEffectiveSets,
    });
    const evidence = uniqueSorted([
      ...(delivery ? formatCurveEvidenceForDelivery(delivery) : []),
      `week_${input.week.week}_uses_repeated_week_1_final_shape`,
      ...(status === "below" ? ["repeated_week_1_shape_stays_below_target"] : []),
      ...(status === "above" ? ["repeated_week_1_shape_stays_above_target"] : []),
    ]);

    return {
      muscle: muscle.muscle,
      targetStatus: muscle.targetStatus,
      projectedEffectiveSets,
      preferredEffectiveSets,
      minEffectiveSets: muscle.minEffectiveSets,
      maxEffectiveSets: muscle.maxEffectiveSets,
      status,
      trend: getProjectedMuscleTrend(status),
      evidence,
      limitations: uniqueSorted([
        "repeated_week_1_final_shape_only",
        "not_true_week_progression",
        "missing_per_week_slot_distribution",
        "missing_fatigue_carryover_model",
        "does_not_affect_scoring_generation_repair_seed_or_runtime",
        ...muscle.limitations,
      ]),
    };
  });
}

function firstContributorSlot(
  delivery: ProjectedDeliveryDiagnostic | undefined,
): string {
  return delivery?.majorContributingExercises[0]?.slotId ?? "week";
}

function buildRepeatedShapeSlotRisks(input: {
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): AccumulationProjectedSlotRisk[] {
  const risks: AccumulationProjectedSlotRisk[] = [];
  const addRisk = (risk: AccumulationProjectedSlotRisk) => {
    const key = `${risk.slotId}:${risk.risk}:${risk.evidence.join("|")}`;
    if (
      risks.some(
        (existing) =>
          `${existing.slotId}:${existing.risk}:${existing.evidence.join("|")}` ===
          key,
      )
    ) {
      return;
    }
    risks.push(risk);
  };

  for (const row of input.duplicateExerciseReuse) {
    addRisk({
      slotId: row.repeatedInSlotId,
      risk: "duplicate_exercise_reuse",
      severity: row.role === "main" ? "warning" : "info",
      evidence: [
        `${row.name}:previous=${row.previousSlotIds.join("+")}:reason=${row.reason}`,
      ],
    });
  }

  for (const row of input.exerciseConcentration) {
    const concentrationFlags = row.flags.filter(
      (flag) =>
        flag === "COMPOUND_GT_5_SETS" ||
        flag === "ISOLATION_GT_5_SETS" ||
        flag.includes("EXERCISE_SUPPLIES_OVER"),
    );
    if (concentrationFlags.length === 0) {
      continue;
    }
    addRisk({
      slotId: row.slotId,
      risk: "single_exercise_concentration",
      severity: "warning",
      evidence: [`${row.exerciseName}:${row.setCount} sets:${concentrationFlags.join("+")}`],
    });
  }

  for (const delivery of input.projectedDelivery) {
    if (
      ["Front Delts", "Glutes", "Lower Back", "Upper Back"].includes(
        delivery.muscle,
      ) &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping > 0
    ) {
      addRisk({
        slotId: firstContributorSlot(delivery),
        risk: "collateral_fatigue",
        severity: "info",
        evidence: formatCurveEvidenceForDelivery(delivery),
      });
    }
    if (
      delivery.targetStatus === "hard" &&
      delivery.preferredTarget != null &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
        delivery.preferredTarget
    ) {
      addRisk({
        slotId: firstContributorSlot(delivery),
        risk: "under_allocated_primary",
        severity: "warning",
        evidence: formatCurveEvidenceForDelivery(delivery),
      });
    }
    if (
      delivery.targetStatus === "hard" &&
      delivery.preferredTarget != null &&
      delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping >
        delivery.preferredTarget + 1e-9
    ) {
      addRisk({
        slotId: firstContributorSlot(delivery),
        risk: "over_allocated_primary",
        severity: delivery.muscle === "Hamstrings" ? "warning" : "info",
        evidence: formatCurveEvidenceForDelivery(delivery),
      });
    }
  }

  return risks.sort(
    (left, right) =>
      left.slotId.localeCompare(right.slotId) ||
      left.risk.localeCompare(right.risk),
  );
}

function findProjectionDelivery(
  rows: ReadonlyArray<ProjectedDeliveryDiagnostic>,
  muscle: string,
): ProjectedDeliveryDiagnostic | undefined {
  return rows.find((row) => row.muscle === muscle);
}

function isUnderPreferred(
  delivery: ProjectedDeliveryDiagnostic | undefined,
): boolean {
  return (
    delivery?.preferredTarget != null &&
    delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping + 1e-9 <
      delivery.preferredTarget
  );
}

function isOverPreferred(
  delivery: ProjectedDeliveryDiagnostic | undefined,
): boolean {
  return (
    delivery?.preferredTarget != null &&
    delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping >
      delivery.preferredTarget + 1e-9
  );
}

function buildAccumulationProjectionWarnings(input: {
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateEvidence: ReadonlyArray<string>;
}): AccumulationWeekProjection["crossWeekWarnings"] {
  const warnings: AccumulationWeekProjection["crossWeekWarnings"] = [];
  const add = (
    warning: AccumulationWeekProjection["crossWeekWarnings"][number],
  ) => {
    if (
      warnings.some(
        (existing) =>
          existing.code === warning.code && existing.muscle === warning.muscle,
      )
    ) {
      return;
    }
    warnings.push(warning);
  };

  const chest = findProjectionDelivery(input.projectedDelivery, "Chest");
  if (isUnderPreferred(chest)) {
    add({
      code: "CHEST_UNDER_TARGET_ACROSS_ACCUMULATION",
      muscle: "Chest",
      evidence: [
        ...formatCurveEvidenceForDelivery(chest),
        "repeated_week_1_final_shape_projects_chest_shortfall_across_accumulation",
      ],
      severity: "warning",
    });
  }

  const hamstrings = findProjectionDelivery(input.projectedDelivery, "Hamstrings");
  if (isOverPreferred(hamstrings)) {
    add({
      code: "HAMSTRINGS_OVERDELIVERED_ACROSS_ACCUMULATION",
      muscle: "Hamstrings",
      evidence: [
        ...formatCurveEvidenceForDelivery(hamstrings),
        "repeated_week_1_final_shape_projects_hamstrings_overdelivery_across_accumulation",
      ],
      severity: "warning",
    });
  }

  const sideDelts = findProjectionDelivery(input.projectedDelivery, "Side Delts");
  if (isUnderPreferred(sideDelts)) {
    add({
      code: "SIDE_DELTS_UNDER_TARGET_ACROSS_ACCUMULATION",
      muscle: "Side Delts",
      evidence: [
        ...formatCurveEvidenceForDelivery(sideDelts),
        "repeated_week_1_final_shape_projects_side_delts_shortfall_across_accumulation",
      ],
      severity: "warning",
    });
  }

  if (input.duplicateEvidence.length > 0) {
    add({
      code: "DUPLICATE_MAIN_LIFT_REUSE_ACROSS_ACCUMULATION",
      evidence: [
        ...input.duplicateEvidence.slice(0, 8),
        "repeated_week_1_final_shape_would_repeat_duplicate_identity_pressure",
      ],
      severity: "warning",
    });
  }

  const collateralEvidence = ["Front Delts", "Glutes", "Lower Back", "Upper Back"]
    .flatMap((muscle) => {
      const delivery = findProjectionDelivery(input.projectedDelivery, muscle);
      return delivery &&
        delivery.projectedEffectiveStimulusAfterRepairAndFinalShaping > 0
        ? formatCurveEvidenceForDelivery(delivery)
        : [];
    })
    .slice(0, 8);
  if (collateralEvidence.length > 0) {
    add({
      code: "COLLATERAL_FATIGUE_RISK_ACROSS_ACCUMULATION",
      evidence: [
        ...collateralEvidence,
        "repeated_week_1_final_shape_keeps_collateral_readouts_visible",
      ],
      severity: "info",
    });
  }

  add({
    code: "DELOAD_PRESERVATION_STILL_UNPROJECTED",
    evidence: [
      "missing_deload_identity_preservation_policy",
      "missing_deload_set_reduction_projection",
      "accumulation_projection_does_not_project_deload",
    ],
    severity: "warning",
  });

  return warnings.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.muscle ?? "").localeCompare(right.muscle ?? ""),
  );
}

function buildCandidateBehaviorReadiness(input: {
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateEvidence: ReadonlyArray<string>;
  crossWeekWarnings: AccumulationWeekProjection["crossWeekWarnings"];
}): AccumulationWeekProjection["candidateBehaviorReadiness"] {
  const hasWarning = (
    code: AccumulationWeekProjection["crossWeekWarnings"][number]["code"],
  ) => input.crossWeekWarnings.some((warning) => warning.code === code);
  const chestConcentrationEvidence = [
    ...input.duplicateEvidence,
    ...formatCurveEvidenceForDelivery(
      findProjectionDelivery(input.projectedDelivery, "Chest"),
    ),
  ].some((entry) => /incline|bench|contributor/i.test(entry));
  const chestReady =
    hasWarning("CHEST_UNDER_TARGET_ACROSS_ACCUMULATION") &&
    chestConcentrationEvidence;

  return [
    {
      candidate: "chest_upper_slot_distinct_exercise_distribution",
      readiness: chestReady
        ? "ready_for_bounded_trial"
        : "needs_more_projection",
      reason: chestReady
        ? "Repeated Week 1 shape keeps Chest under target and keeps Chest exercise concentration/duplicate evidence visible across accumulation."
        : "Needs accumulation projection evidence that Chest remains under target and concentrated in one repeated pressing identity.",
      requiredGuardrails: [
        "bounded_to_upper_chest_distribution_only",
        "preserve_upper_slot_pull_identity",
        "do_not_change_seed_schema_or_runtime_replay",
        "do_not_increase_front_delt_or_triceps_collateral_without_diagnostic_evidence",
      ],
    },
    {
      candidate: "hamstrings_weekly_overdelivery_control",
      readiness: "not_first",
      reason:
        "Hamstrings overdelivery is visible, but lower_b was recently improved and the fix requires whole-week control rather than a local repair tweak.",
      requiredGuardrails: [
        "preserve_lower_b_hinge_identity",
        "keep_clean_knee_flexion_route_visible",
        "avoid_glutes_lower_back_collateral_increase",
      ],
    },
    {
      candidate: "side_delt_second_slot_support",
      readiness: "diagnostic_only",
      reason:
        "Side Delts under-target remains visible, but support should stay diagnostic until projection proves it avoids OHP/lateral-raise overconcentration.",
      requiredGuardrails: [
        "preserve_upper_b_preselection_success",
        "cap_duplicate_lateral_raise_identities",
        "avoid_pressing_collateral_as_fake_side_delt_support",
      ],
    },
    {
      candidate: "duplicate_main_lift_suppression",
      readiness: "needs_more_projection",
      reason:
        "Duplicate reuse is visible, but broad duplicate suppression has high blast radius and needs per-week identity and fatigue policy first.",
      requiredGuardrails: [
        "persist_duplicate_justification",
        "preserve_required_slot_anchors",
        "prove_no_target_regression_across_weeks_1_to_4",
      ],
    },
    {
      candidate: "calf_duplicate_suppression",
      readiness: "not_first",
      reason:
        "Calf cleanup is lower leverage than Chest distribution and whole-week Hamstrings control.",
      requiredGuardrails: [
        "keep_calf_support_floor_visible",
        "avoid_bumping_past_single_exercise_share_limits",
      ],
    },
  ];
}

function buildAccumulationWeekProjection(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyDemandCurve: WeeklyDemandCurve;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): AccumulationWeekProjection {
  const duplicateEvidence = buildDuplicateProjectionEvidence({
    finalSlotPlan: input.finalSlotPlan,
    duplicateExerciseReuse: input.duplicateExerciseReuse,
  });
  const crossWeekWarnings = buildAccumulationProjectionWarnings({
    projectedDelivery: input.projectedDelivery,
    duplicateEvidence,
  });
  const projectedSlotRisks = buildRepeatedShapeSlotRisks({
    projectedDelivery: input.projectedDelivery,
    duplicateExerciseReuse: input.duplicateExerciseReuse,
    exerciseConcentration: input.exerciseConcentration,
  });
  const weeks = input.weeklyDemandCurve.weeks
    .filter((week) => week.week > 1 && week.phase !== "deload")
    .map((week) => ({
      week: week.week,
      phase: toAccumulationProjectionPhase(week.phase),
      projectionStatus: getAccumulationProjectionStatus(week.phase),
      projectedMuscles: buildAccumulationProjectionMuscles({
        week,
        projectedDelivery: input.projectedDelivery,
      }),
      projectedSlotRisks,
      weekLevelWarnings: uniqueSorted([
        "repeated_week_1_final_shape_only",
        "missing_true_accumulation_progression_policy",
        "missing_per_week_slot_distribution",
        "missing_fatigue_carryover_model",
        "deload_not_projected_here",
        "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
        ...week.weekLevelLimitations,
      ]),
    }));

  return {
    mesocycleId: getDiagnosticMesocycleId(input.activeMesocycle),
    source: "diagnostic_shadow_planner",
    readOnly: true,
    affectsScoringOrGeneration: false,
    projectionBasis: {
      sourceWeek: 1,
      method: "repeat_week_1_final_shape",
      limitations: [
        "repeats_week_1_final_slot_plan_shape_for_accumulation_diagnostics_only",
        "does_not_apply_true_progression_policy",
        "does_not_allocate_new_week_2_to_4_slot_distribution",
        "does_not_model_fatigue_carryover_or_exercise_staleness_adaptation",
        "does_not_project_deload_identity_or_set_reduction",
        "does_not_affect_scoring_generation_repair_seed_or_runtime",
      ],
    },
    weeks,
    crossWeekWarnings,
    candidateBehaviorReadiness: buildCandidateBehaviorReadiness({
      projectedDelivery: input.projectedDelivery,
      duplicateEvidence,
      crossWeekWarnings,
    }),
  };
}

function buildPreselectionDistributionPolicyByWeek(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  slotPrescriptionIntents: ReadonlyArray<SlotPrescriptionIntent>;
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  projectedDelivery: ReadonlyArray<ProjectedDeliveryDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  warnings: SlotPlanPlanningRealityDiagnostic["warnings"];
}): PreselectionDistributionPolicyByWeek {
  const durationWeeks = getDiagnosticDurationWeeks(input.activeMesocycle);
  const accumulationWeeks = Math.max(1, durationWeeks - 1);
  const weekOneWarnings = buildWeekOnePolicyWarnings({
    warnings: input.warnings,
    duplicateExerciseReuse: input.duplicateExerciseReuse,
    finalSlotPlan: input.finalSlotPlan,
  });
  const futureAccumulationWarnings = [
    "weeks_2_to_4_unprojected",
    "missing_weekly_demand_curve",
    "missing_accumulation_progression_policy",
    "missing_per_week_slot_distribution",
    "missing_fatigue_carryover_model",
  ];
  const deloadWarnings = [
    "deload_distribution_not_projected",
    "missing_deload_identity_preservation_policy",
    "missing_deload_set_reduction_projection",
  ];

  const weeks: DistributionPolicyWeek[] = [
    {
      week: 1,
      phase: "accumulation",
      projectionStatus: "projected_from_current_week_evidence",
      weekScope: "week_1_only",
      slots: buildWeekOnePolicySlots(input),
      weekLevelWarnings: weekOneWarnings,
    },
  ];

  for (let week = 2; week <= accumulationWeeks; week += 1) {
    weeks.push(
      buildUnprojectedWeek({
        week,
        phase: "accumulation",
        projectionStatus:
          week === 2
            ? "not_projected_missing_weekly_demand_curve"
            : "not_projected_missing_accumulation_policy",
        weekScope: "accumulation_weeks",
        warnings: futureAccumulationWarnings,
      }),
    );
  }

  weeks.push(
    buildUnprojectedWeek({
      week: durationWeeks,
      phase: "deload",
      projectionStatus: "not_projected_missing_deload_policy",
      weekScope: "deload_week",
      warnings: deloadWarnings,
    }),
  );

  return {
    mesocycleId: getDiagnosticMesocycleId(input.activeMesocycle),
    source: "diagnostic_shadow_planner",
    readOnly: true,
    affectsScoringOrGeneration: false,
    limitations: [
      "diagnostic_read_only_no_generation_scoring_repair_seed_or_runtime_effect",
      "week_1_supported_by_current_projection_evidence_only",
      "weeks_2_to_4_unprojected",
      "missing_weekly_demand_curve",
      "missing_accumulation_progression_policy",
      "missing_per_week_slot_distribution",
      "missing_fatigue_carryover_model",
      "deload_distribution_not_projected",
      "missing_deload_identity_preservation_policy",
      "missing_deload_set_reduction_projection",
    ],
    weeks,
    candidateBehaviorSlices: buildCandidateBehaviorSlices(),
    recommendedNextStep: "add_weekly_demand_curve_diagnostic",
  };
}

function buildSlotDemandAllocation(input: {
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
}): SlotDemandAllocationDiagnostic[] {
  const slotSequenceEntries = buildSlotSequenceEntries(input.slotSequence);
  const projectedSlotById = new Map(
    input.finalProjectedSlots.map((slot) => [slot.slotPlan.slotId, slot])
  );

  return input.slotSequence.map((slot, index) => {
    const slotPolicy = resolveSessionSlotPolicy({
      sessionIntent: toSessionIntent(slot.intent),
      slotId: slot.slotId,
      slotSequence: { slots: slotSequenceEntries },
    }).currentSession;
    const projectedSlot = projectedSlotById.get(slot.slotId);
    const projectedStimulus = toRoundedRecord(projectedSlot?.projectedContributionByMuscle ?? new Map());
    const expectedMuscleObligations: SlotDemandAllocationDiagnostic["expectedMuscleObligations"] = [];

    for (const obligation of getSlotWeeklyObligations({
      plan: input.weeklyObligationPlan,
      slotId: slot.slotId,
    })) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle: obligation.muscle,
        source: "weekly_obligation",
        targetStatus: "hard",
        explicitUpstream: true,
        minEffectiveSets: obligation.minEffectiveSets,
        priority: obligation.priority,
      });
    }

    for (const muscle of getProtectedWeekOneCoverageObligations(slotPolicy)) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle,
        source: "authored_protected_coverage",
        targetStatus: isHardObligationMuscle(muscle) ? "hard" : "soft",
        explicitUpstream: false,
        minEffectiveSets: getWeekOneSupportFloor(muscle) ?? 2,
        priority: "support",
      });
    }

    for (const muscle of slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle: normalizeMuscle(muscle),
        source: "authored_primary_lane",
        targetStatus: isHardObligationMuscle(muscle) ? "hard" : "diagnostic",
        explicitUpstream: false,
        minEffectiveSets: null,
        priority: "lane",
      });
    }

    for (const muscle of getProjectionSoftPreferredSupportMuscles({
      slot: slotPolicy,
      protectedMuscles: getProtectedWeekOneCoverageObligations(slotPolicy),
    })) {
      appendSlotObligation(expectedMuscleObligations, {
        muscle: normalizeMuscle(muscle),
        source: "authored_support_preference",
        targetStatus: "soft",
        explicitUpstream: false,
        minEffectiveSets: getWeekOneSupportFloor(muscle as ProtectedWeekOneCoverageMuscle) ?? null,
        priority: "support",
      });
    }

    const hardObligations = expectedMuscleObligations.filter(
      (obligation) => obligation.source === "weekly_obligation"
    );
    const authoredObligations = expectedMuscleObligations.filter(
      (obligation) => obligation.source !== "weekly_obligation"
    );
    const meaningfullyServedMuscles = Object.entries(projectedStimulus)
      .filter(([muscle, value]) => {
        const obligation = expectedMuscleObligations.find((entry) => entry.muscle === muscle);
        const floor = obligation?.minEffectiveSets ?? 2;
        return value >= Math.min(2, floor) || (obligation != null && value > 0);
      })
      .map(([muscle]) => muscle)
      .sort((left, right) => left.localeCompare(right));
    const satisfiesKnownWeeklyDemand = hardObligations.some((obligation) => {
      const projected = projectedStimulus[obligation.muscle] ?? 0;
      return projected + 1e-9 >= (obligation.minEffectiveSets ?? 0);
    });
    const allocationBasis =
      hardObligations.length > 0
        ? "explicit_weekly_demand"
        : authoredObligations.length > 0
          ? "authored_slot_semantics"
          : Object.keys(projectedStimulus).length > 0
            ? "local_movement_or_lane_semantics"
            : "unclear";

    return {
      slotId: slot.slotId,
      slotIndex: index,
      slotLabel: `${slot.intent}@${slot.slotId}`,
      intent: toSessionIntent(slot.intent),
      authoredSlotRole: slotPolicy?.slotArchetype ?? null,
      slotProfile: {
        slotArchetype: slotPolicy?.slotArchetype ?? null,
        continuityScope: slotPolicy?.continuityScope ?? null,
        requiredMovementPatterns: [...(slotPolicy?.sessionShape?.requiredMovementPatterns ?? [])],
        preferredPrimaryMuscles: [
          ...(slotPolicy?.compoundBias?.preferredPrimaryMuscles ?? []),
          ...(slotPolicy?.compoundControl?.lanes.flatMap((lane) => lane.preferredPrimaryMuscles ?? []) ?? []),
        ],
        preferredSupportMuscles: getProjectionPreferredSupportMuscles(slotPolicy),
        protectedCoverageMuscles: getProtectedWeekOneCoverageObligations(slotPolicy),
      },
      expectedMuscleObligations,
      projectedEffectiveStimulusByMuscle: projectedStimulus,
      meaningfullyServedMuscles,
      allocationBasis,
      satisfiesKnownWeeklyDemand,
    };
  });
}

function getWeeklyTotals(slots: ReadonlyArray<ProjectedSlotWorkout>): Record<string, number> {
  return toRoundedRecord(
    computeProjectedWeeklyContributionByMuscle({
      projectedSlots: slots,
      currentSlotContribution: new Map(),
    })
  );
}

function buildProjectedDelivery(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  relevantMuscles: string[];
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalExerciseRows: ReadonlyArray<ExerciseRow>;
}): ProjectedDeliveryDiagnostic[] {
  const initialTotals = getWeeklyTotals(input.initialProjectedSlots);
  const finalTotals = getWeeklyTotals(input.finalProjectedSlots);
  const exposureCountByMuscle = new Map<string, number>();
  for (const slot of input.finalProjectedSlots) {
    const slotContribution = toRoundedRecord(slot.projectedContributionByMuscle);
    for (const [muscle, value] of Object.entries(slotContribution)) {
      if (value > 0) {
        exposureCountByMuscle.set(muscle, (exposureCountByMuscle.get(muscle) ?? 0) + 1);
      }
    }
  }

  return input.relevantMuscles.map((muscle) => {
    const target = getTargetForMuscle({
      activeMesocycle: input.activeMesocycle,
      weeklyObligationPlan: input.weeklyObligationPlan,
      muscle,
    });
    const finalTotal = finalTotals[muscle] ?? 0;
    const contributors = input.finalExerciseRows
      .map((row) => ({
        slotId: row.slotId,
        exerciseId: row.exercise.exercise.id,
        exerciseName: row.exercise.exercise.name,
        effectiveStimulus: row.contributionByMuscle[muscle] ?? 0,
        percentOfWeeklyStimulus:
          finalTotal > 0
            ? roundToTenth(((row.contributionByMuscle[muscle] ?? 0) / finalTotal) * 100)
            : 0,
      }))
      .filter((row) => row.effectiveStimulus > 0)
      .sort((left, right) => right.effectiveStimulus - left.effectiveStimulus || left.exerciseName.localeCompare(right.exerciseName))
      .slice(0, 4);

    return {
      muscle,
      targetStatus: target.targetStatus,
      targetRange: target.targetRange,
      preferredTarget: target.preferredTarget,
      projectedEffectiveStimulusAfterInitialSlotComposition:
        input.initialProjectedSlots.length > 0 ? roundToTenth(initialTotals[muscle] ?? 0) : null,
      projectedEffectiveStimulusAfterRepairAndFinalShaping: roundToTenth(finalTotal),
      deltaFromPreferredTarget:
        target.preferredTarget == null ? null : roundToTenth(finalTotal - target.preferredTarget),
      exposureCount: exposureCountByMuscle.get(muscle) ?? 0,
      majorContributingExercises: contributors,
    };
  });
}

function findAppliedProgramQualityDiagnostic(input: {
  diagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  slotId: string;
  exerciseId: string;
  muscle: string;
}): ProgramQualityDiagnostic | undefined {
  return input.diagnostics.find((diagnostic) => {
    if (diagnostic.slotId && diagnostic.slotId !== input.slotId) {
      return false;
    }
    if (diagnostic.exerciseId && diagnostic.exerciseId !== input.exerciseId) {
      return false;
    }
    if (diagnostic.muscle && normalizeMuscle(diagnostic.muscle) !== input.muscle) {
      return false;
    }
    const toExerciseId = diagnostic.details?.toExerciseId;
    return (
      diagnostic.exerciseId === input.exerciseId ||
      toExerciseId === input.exerciseId ||
      !diagnostic.exerciseId
    );
  });
}

function chooseRepairMechanism(input: {
  action: RepairMaterialityDiagnostic["action"];
  slotId: string;
  exerciseId: string;
  muscle: string;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
}): { mechanism: string; source: string; rationale: string } {
  const appliedDiagnostic = findAppliedProgramQualityDiagnostic({
    diagnostics: input.programQualityAppliedDiagnostics,
    slotId: input.slotId,
    exerciseId: input.exerciseId,
    muscle: input.muscle,
  });
  if (appliedDiagnostic) {
    return {
      mechanism:
        appliedDiagnostic.constraint === "isolation_completeness"
          ? "deficit_driven_isolation_insertion"
          : `program_quality:${appliedDiagnostic.constraint}`,
      source: "program_quality_application",
      rationale: appliedDiagnostic.reason,
    };
  }

  const supportReasons =
    input.supportFloorRepairReasons[input.muscle as ProtectedWeekOneCoverageMuscle] ?? [];
  if (supportReasons.includes("support_accessory_replacement") && input.action === "added") {
    return {
      mechanism: "support_floor_closure",
      source: "protected_coverage_support_floor",
      rationale: "support floor repair added or replaced an accessory to close coverage",
    };
  }
  if (supportReasons.includes("existing_accessory_set_bump") && input.action === "set_bumped") {
    return {
      mechanism: "support_floor_set_bump",
      source: "protected_coverage_support_floor",
      rationale: "support floor repair increased an existing exercise set count",
    };
  }

  const weeklyObligation = input.weeklyObligationEvaluations.find(
    (row) => row.slotId === input.slotId && row.muscle === input.muscle
  );
  if (weeklyObligation) {
    return {
      mechanism: "weekly_obligation_closure",
      source: "weekly_obligation_plan",
      rationale: "final shaping adjusted the slot toward an allocated hard weekly obligation",
    };
  }

  if (input.action === "set_trimmed" || input.action === "removed") {
    return {
      mechanism: "final_cap_trim_or_redistribution",
      source: "final_projection_shaping",
      rationale: "final shaping reduced exercise sets or identity after cap/quality passes",
    };
  }

  return {
    mechanism: "final_projection_repair",
    source: "projection_diff",
    rationale: "final slot plan differs from initial slot composition after read-only repair/shaping passes",
  };
}

function classifyMateriality(input: {
  action: RepairMaterialityDiagnostic["action"];
  muscle: string | null;
  rawSetDelta: number;
  effectiveStimulusDelta: number;
  initialTotal: number;
  finalTotal: number;
  preferredTarget: number | null;
  targetStatus: WeeklyMuscleDemandDiagnostic["targetStatus"];
}): RepairMateriality {
  if (input.action === "diagnostic_only" || input.rawSetDelta === 0 && input.effectiveStimulusDelta === 0) {
    return "none";
  }
  const closesTarget =
    input.preferredTarget != null &&
    input.initialTotal + 1e-9 < input.preferredTarget &&
    input.finalTotal + 1e-9 >= input.preferredTarget;
  if (
    input.action === "added" ||
    input.action === "removed" ||
    (closesTarget && input.targetStatus !== "diagnostic")
  ) {
    return "major";
  }
  if (Math.abs(input.effectiveStimulusDelta) >= 2 || Math.abs(input.rawSetDelta) >= 2) {
    return "moderate";
  }
  return "minor";
}

function buildRepairRowsForDelta(input: {
  action: RepairMaterialityDiagnostic["action"];
  slotId: string;
  exerciseId: string;
  exerciseName: string;
  setDelta: number;
  contributionDeltaByMuscle: Record<string, number>;
  changedExerciseIdentity: boolean;
  initialTotals: Record<string, number>;
  finalTotals: Record<string, number>;
  activeMesocycle: ActiveMesocycleForDiagnostics;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
}): RepairMaterialityDiagnostic[] {
  const muscles = Object.keys(input.contributionDeltaByMuscle).filter(
    (muscle) => input.contributionDeltaByMuscle[muscle] !== 0
  );
  if (muscles.length === 0) {
    muscles.push(null as never);
  }

  return muscles.map((muscle) => {
    const target = muscle
      ? getTargetForMuscle({
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          muscle,
        })
      : null;
    const effectiveStimulusDelta = muscle ? roundToTenth(input.contributionDeltaByMuscle[muscle] ?? 0) : 0;
    const materiality = classifyMateriality({
      action: input.action,
      muscle,
      rawSetDelta: input.setDelta,
      effectiveStimulusDelta,
      initialTotal: muscle ? input.initialTotals[muscle] ?? 0 : 0,
      finalTotal: muscle ? input.finalTotals[muscle] ?? 0 : 0,
      preferredTarget: target?.preferredTarget ?? null,
      targetStatus: target?.targetStatus ?? "diagnostic",
    });
    const mechanism = muscle
      ? chooseRepairMechanism({
          action: input.action,
          slotId: input.slotId,
          exerciseId: input.exerciseId,
          muscle,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      : {
          mechanism: "final_projection_repair",
          source: "projection_diff",
          rationale: "exercise identity changed without measurable stimulus contribution",
        };

    return {
      repairMechanism: mechanism.mechanism,
      materiality,
      muscle,
      slotId: input.slotId,
      exerciseId: input.exerciseId,
      exerciseName: input.exerciseName,
      action: input.action,
      effectiveStimulusAdded: roundToTenth(Math.max(0, effectiveStimulusDelta)),
      effectiveStimulusDelta,
      rawSetsAdded: Math.max(0, input.setDelta),
      rawSetDelta: input.setDelta,
      changedExerciseIdentity: input.changedExerciseIdentity,
      changedSlotShapeMaterially:
        input.changedExerciseIdentity || Math.abs(input.setDelta) >= 2 || materiality === "major",
      behaviorClass:
        materiality === "major" || materiality === "moderate"
          ? "program_shaping"
          : "minor_safety_net",
      source: mechanism.source,
      rationale: mechanism.rationale,
    };
  });
}

function diffContribution(
  after: Record<string, number>,
  before: Record<string, number>
): Record<string, number> {
  const muscles = Array.from(new Set([...Object.keys(after), ...Object.keys(before)]));
  return Object.fromEntries(
    muscles
      .map((muscle) => [muscle, roundToTenth((after[muscle] ?? 0) - (before[muscle] ?? 0))] as const)
      .filter(([, value]) => value !== 0)
  );
}

function buildRepairMateriality(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  programQualityEvaluation: ProgramQualityEvaluation;
}): RepairMaterialityDiagnostic[] {
  const initialRows = buildExerciseRows(input.initialProjectedSlots);
  const finalRows = buildExerciseRows(input.finalProjectedSlots);
  const beforeByKey = buildExerciseRowMap(initialRows);
  const afterByKey = buildExerciseRowMap(finalRows);
  const initialTotals = getWeeklyTotals(input.initialProjectedSlots);
  const finalTotals = getWeeklyTotals(input.finalProjectedSlots);
  const keys = Array.from(new Set([...beforeByKey.keys(), ...afterByKey.keys()]));
  const rows: RepairMaterialityDiagnostic[] = [];

  for (const key of keys) {
    const before = beforeByKey.get(key);
    const after = afterByKey.get(key);
    const row = after ?? before;
    if (!row) {
      continue;
    }
    const setDelta = (after?.setCount ?? 0) - (before?.setCount ?? 0);
    const contributionDelta = diffContribution(
      after?.contributionByMuscle ?? {},
      before?.contributionByMuscle ?? {}
    );
    if (!after && before) {
      rows.push(
        ...buildRepairRowsForDelta({
          action: "removed",
          slotId: before.slotId,
          exerciseId: before.exercise.exercise.id,
          exerciseName: before.exercise.exercise.name,
          setDelta,
          contributionDeltaByMuscle: contributionDelta,
          changedExerciseIdentity: true,
          initialTotals,
          finalTotals,
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      );
      continue;
    }
    if (after && !before) {
      rows.push(
        ...buildRepairRowsForDelta({
          action: "added",
          slotId: after.slotId,
          exerciseId: after.exercise.exercise.id,
          exerciseName: after.exercise.exercise.name,
          setDelta,
          contributionDeltaByMuscle: contributionDelta,
          changedExerciseIdentity: true,
          initialTotals,
          finalTotals,
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      );
      continue;
    }
    if (setDelta !== 0) {
      rows.push(
        ...buildRepairRowsForDelta({
          action: setDelta > 0 ? "set_bumped" : "set_trimmed",
          slotId: row.slotId,
          exerciseId: row.exercise.exercise.id,
          exerciseName: row.exercise.exercise.name,
          setDelta,
          contributionDeltaByMuscle: contributionDelta,
          changedExerciseIdentity: false,
          initialTotals,
          finalTotals,
          activeMesocycle: input.activeMesocycle,
          weeklyObligationPlan: input.weeklyObligationPlan,
          weeklyObligationEvaluations: input.weeklyObligationEvaluations,
          supportFloorRepairReasons: input.supportFloorRepairReasons,
          programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
        })
      );
    }
  }

  const existingDiagnosticKeys = new Set(
    rows.map((row) => `${row.source}:${row.slotId ?? ""}:${row.exerciseId ?? ""}:${row.muscle ?? ""}`)
  );
  for (const diagnostic of input.programQualityAppliedDiagnostics) {
    const key = `program_quality_application:${diagnostic.slotId ?? ""}:${diagnostic.exerciseId ?? ""}:${diagnostic.muscle ?? ""}`;
    if (existingDiagnosticKeys.has(key)) {
      continue;
    }
    rows.push({
      repairMechanism: `program_quality:${diagnostic.constraint}`,
      materiality: "none",
      muscle: diagnostic.muscle ? normalizeMuscle(diagnostic.muscle) : null,
      slotId: diagnostic.slotId ?? null,
      exerciseId: diagnostic.exerciseId ?? null,
      exerciseName: diagnostic.name ?? null,
      action: "diagnostic_only",
      effectiveStimulusAdded: 0,
      effectiveStimulusDelta: 0,
      rawSetsAdded: 0,
      rawSetDelta: 0,
      changedExerciseIdentity: false,
      changedSlotShapeMaterially: false,
      behaviorClass: "minor_safety_net",
      source: "program_quality_application",
      rationale: diagnostic.reason,
    });
  }

  for (const [muscle, reasons] of Object.entries(input.supportFloorRepairReasons)) {
    for (const reason of reasons ?? []) {
      const hasMaterialRow = rows.some(
        (row) => row.muscle === normalizeMuscle(muscle) && row.source === "protected_coverage_support_floor"
      );
      if (hasMaterialRow) {
        continue;
      }
      rows.push({
        repairMechanism: `support_floor:${reason}`,
        materiality: "none",
        muscle: normalizeMuscle(muscle),
        slotId: null,
        exerciseId: null,
        exerciseName: null,
        action: "diagnostic_only",
        effectiveStimulusAdded: 0,
        effectiveStimulusDelta: 0,
        rawSetsAdded: 0,
        rawSetDelta: 0,
        changedExerciseIdentity: false,
        changedSlotShapeMaterially: false,
        behaviorClass: "minor_safety_net",
        source: "protected_coverage_support_floor",
        rationale: "support-floor repair reason was emitted without a remaining net exercise/set delta",
      });
    }
  }

  for (const diagnostic of input.programQualityEvaluation.diagnostics) {
    if (
      diagnostic.constraint !== "per_exercise_efficiency" ||
      diagnostic.reason !== "soft_cap_exceeded_higher_priority_or_capacity_bound"
    ) {
      continue;
    }
    const exists = rows.some(
      (row) => row.slotId === diagnostic.slotId && row.exerciseId === diagnostic.exerciseId
    );
    if (exists) {
      continue;
    }
    rows.push({
      repairMechanism: "program_quality:soft_cap_override",
      materiality: "none",
      muscle: diagnostic.muscle ? normalizeMuscle(diagnostic.muscle) : null,
      slotId: diagnostic.slotId ?? null,
      exerciseId: diagnostic.exerciseId ?? null,
      exerciseName: diagnostic.name ?? null,
      action: "diagnostic_only",
      effectiveStimulusAdded: 0,
      effectiveStimulusDelta: 0,
      rawSetsAdded: 0,
      rawSetDelta: 0,
      changedExerciseIdentity: false,
      changedSlotShapeMaterially: false,
      behaviorClass: "minor_safety_net",
      source: "program_quality_evaluation",
      rationale: diagnostic.reason,
    });
  }

  return rows.sort((left, right) => {
    const materialityOrder: Record<RepairMateriality, number> = {
      major: 0,
      moderate: 1,
      minor: 2,
      none: 3,
    };
    return (
      materialityOrder[left.materiality] - materialityOrder[right.materiality] ||
      (left.slotId ?? "").localeCompare(right.slotId ?? "") ||
      (left.exerciseName ?? "").localeCompare(right.exerciseName ?? "") ||
      (left.muscle ?? "").localeCompare(right.muscle ?? "")
    );
  });
}

function buildExerciseConcentration(input: {
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
}): ExerciseConcentrationDiagnostic[] {
  const initialRowsByKey = buildExerciseRowMap(buildExerciseRows(input.initialProjectedSlots));
  const finalRows = buildExerciseRows(input.finalProjectedSlots);
  const finalWeeklyTotals = getWeeklyTotals(input.finalProjectedSlots);

  return finalRows.map((row) => {
    const before = initialRowsByKey.get(getExerciseKey(row.slotId, row.exercise.exercise.id));
    const percentages = Object.fromEntries(
      Object.entries(row.contributionByMuscle).map(([muscle, effectiveSets]) => [
        muscle,
        finalWeeklyTotals[muscle] && finalWeeklyTotals[muscle] > 0
          ? roundToTenth((effectiveSets / finalWeeklyTotals[muscle]) * 100)
          : 0,
      ])
    );
    const producedOrIncreasedByRepair = !before || row.setCount > before.setCount;
    const flags: ExerciseConcentrationDiagnostic["flags"] = [];
    if (row.exercise.exercise.isCompound && row.setCount > 5) {
      flags.push("COMPOUND_GT_5_SETS");
    }
    if (!row.exercise.exercise.isCompound && row.setCount > 5) {
      flags.push("ISOLATION_GT_5_SETS");
    }
    if (Object.values(percentages).some((percent) => percent >= 60)) {
      flags.push("EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS");
    } else if (Object.values(percentages).some((percent) => percent >= 50)) {
      flags.push("EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS");
    }
    if (!before) {
      flags.push("EXERCISE_ADDED_BY_REPAIR");
    } else if (row.setCount > before.setCount) {
      flags.push("SET_COUNT_INCREASED_BY_REPAIR");
    }

    return {
      slotId: row.slotId,
      intent: row.intent,
      exerciseId: row.exercise.exercise.id,
      exerciseName: row.exercise.exercise.name,
      setCount: row.setCount,
      role: row.role,
      isCompound: row.exercise.exercise.isCompound ?? false,
      primaryMuscles: [...(row.exercise.exercise.primaryMuscles ?? [])].map(normalizeMuscle),
      effectiveStimulusContributionByMuscle: row.contributionByMuscle,
      percentageOfWeeklyProjectedStimulusByMuscle: percentages,
      producedOrIncreasedByRepair,
      flags,
    };
  });
}

const REAR_DELT_DIRECT_MUSCLE = "Rear Delts";
const UPPER_BACK_COLLATERAL_MUSCLE = "Upper Back";
const MATERIAL_UPPER_BACK_COLLATERAL_DELTA = 1;
const PULL_COLLATERAL_CONCENTRATION_MUSCLES = new Set([
  "Biceps",
  "Forearms",
  "Lats",
  "Upper Back",
]);

function exercisePrimaryMuscles(row: ExerciseRow): string[] {
  return [...(row.exercise.exercise.primaryMuscles ?? [])].map(normalizeMuscle);
}

function sumDirectStimulusForMuscle(
  rows: ReadonlyArray<ExerciseRow>,
  muscle: string
): number {
  return roundToTenth(
    rows
      .filter((row) => exercisePrimaryMuscles(row).includes(muscle))
      .reduce((sum, row) => sum + (row.contributionByMuscle[muscle] ?? 0), 0)
  );
}

function sumEffectiveStimulusForMuscle(
  rows: ReadonlyArray<ExerciseRow>,
  muscle: string
): number {
  return roundToTenth(
    rows.reduce((sum, row) => sum + (row.contributionByMuscle[muscle] ?? 0), 0)
  );
}

function isPullCollateralConcentration(row: ExerciseConcentrationDiagnostic): boolean {
  const muscles = new Set([
    ...row.primaryMuscles.map(normalizeMuscle),
    ...Object.keys(row.effectiveStimulusContributionByMuscle).map(normalizeMuscle),
  ]);
  return (
    row.producedOrIncreasedByRepair &&
    row.flags.some(
      (flag) =>
        flag === "COMPOUND_GT_5_SETS" ||
        flag === "ISOLATION_GT_5_SETS" ||
        flag.includes("EXERCISE_SUPPLIES_OVER")
    ) &&
    Array.from(muscles).some((muscle) => PULL_COLLATERAL_CONCENTRATION_MUSCLES.has(muscle))
  );
}

function buildRearDeltCollateralSummary(input: {
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  preselectionDemands: ReadonlyArray<PreselectionDemandDiagnosticLike>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRepairsNotEligibleForPromotion: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  exerciseConcentration: ReadonlyArray<ExerciseConcentrationDiagnostic>;
}): RearDeltCollateralSummary | null {
  const rearDeltPreselectionDemands = input.preselectionDemands.filter(
    (demand) => normalizeMuscle(demand.muscle) === REAR_DELT_DIRECT_MUSCLE
  );
  if (rearDeltPreselectionDemands.length === 0) {
    return null;
  }

  const initialRows = buildExerciseRows(input.initialProjectedSlots);
  const finalRows = buildExerciseRows(input.finalProjectedSlots);
  const directRearDeltStimulusBefore = sumDirectStimulusForMuscle(
    initialRows,
    REAR_DELT_DIRECT_MUSCLE
  );
  const directRearDeltStimulusAfter = sumDirectStimulusForMuscle(
    finalRows,
    REAR_DELT_DIRECT_MUSCLE
  );
  const upperBackCollateralDelta = roundToTenth(
    sumEffectiveStimulusForMuscle(finalRows, UPPER_BACK_COLLATERAL_MUSCLE) -
      sumEffectiveStimulusForMuscle(initialRows, UPPER_BACK_COLLATERAL_MUSCLE)
  );
  const rearDeltPreselectionConsumed = rearDeltPreselectionDemands.some(
    (demand) => demand.consumedBySelection
  );
  const suspiciousRepairDelta = input.suspiciousRepairsNotEligibleForPromotion.filter(
    (row) => normalizeMuscle(row.muscle) !== REAR_DELT_DIRECT_MUSCLE
  ).length;
  const pullPatternConcentrationDelta = input.exerciseConcentration.filter(
    isPullCollateralConcentration
  ).length;
  const capTrimOrRemovalDelta = input.repairMaterialityAfterShadowAllocation.filter(
    (row) => isMaterialRepair(row) && (row.action === "set_trimmed" || row.action === "removed")
  ).length;
  const directRearDeltImproved =
    directRearDeltStimulusAfter > directRearDeltStimulusBefore;
  const upperBackCollateralMaterial =
    upperBackCollateralDelta >= MATERIAL_UPPER_BACK_COLLATERAL_DELTA;
  const programWorse =
    suspiciousRepairDelta > 0 ||
    pullPatternConcentrationDelta > 0 ||
    capTrimOrRemovalDelta > 0;
  const reasons: string[] = [];

  if (!rearDeltPreselectionConsumed) {
    reasons.push("rear_delt_preselection_not_consumed");
  } else {
    reasons.push("rear_delt_preselection_consumed");
    if (directRearDeltImproved) {
      reasons.push("direct_rear_delt_stimulus_increased");
    } else {
      reasons.push("rear_delt_preselection_consumed_without_direct_closure");
    }
  }
  if (upperBackCollateralMaterial) {
    reasons.push("REAR_DELT_COLLATERAL_UPPER_BACK_INCREASE");
  }
  if (pullPatternConcentrationDelta > 0) {
    reasons.push("REAR_DELT_COLLATERAL_PULL_CONCENTRATION");
  }
  if (capTrimOrRemovalDelta > 0) {
    reasons.push("REAR_DELT_COLLATERAL_CAP_TRIM");
  }
  if (suspiciousRepairDelta > 0) {
    reasons.push("REAR_DELT_COLLATERAL_SUSPICIOUS_REPAIR_INCREASE");
  }
  if (rearDeltPreselectionConsumed && (programWorse || upperBackCollateralMaterial || !directRearDeltImproved)) {
    reasons.push("REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE");
    reasons.push("consumed_preselection_demand_alone_is_not_success");
  }

  const verdict: RearDeltCollateralSummary["verdict"] =
    !rearDeltPreselectionConsumed
      ? "not_applicable"
      : programWorse || !directRearDeltImproved
        ? "worse_collateral"
        : upperBackCollateralMaterial
          ? "mixed_collateral"
          : "clean_improvement";

  return {
    directRearDeltStimulusBefore,
    directRearDeltStimulusAfter,
    rearDeltPreselectionConsumed,
    upperBackCollateralDelta,
    pullPatternConcentrationDelta,
    suspiciousRepairDelta,
    capTrimOrRemovalDelta,
    verdict,
    reasons: Array.from(new Set(reasons)),
  };
}

const CLEAN_PRESELECTION_SLOT_ID = "lower_b";
const CLEAN_PRESELECTION_MUSCLE = "Hamstrings";
const BACK_EXTENSION_NAME_PATTERN = /back extension/i;
const STIFF_LEGGED_DEADLIFT_NAME_PATTERN = /stiff[- ]leg(?:ged)? deadlift/i;
const LEG_CURL_NAME_PATTERN = /\bcurl\b/i;
const HINGE_NAME_PATTERN = /\b(deadlift|rdl|romanian|good morning|hinge)\b/i;
const MATERIAL_COLLATERAL_DELTA = 1;
type DiagnosticExerciseLibrary = MappedGenerationContext["exerciseLibrary"];
type DiagnosticExercise = DiagnosticExerciseLibrary[number];

function findSlotSnapshot(
  slots: ReadonlyArray<SlotCompositionSnapshotDiagnostic>,
  slotId: string
): SlotCompositionSnapshotDiagnostic | undefined {
  return slots.find((slot) => slot.slotId === slotId);
}

function slotStimulus(
  slot: SlotCompositionSnapshotDiagnostic | undefined,
  muscle: string
): number | null {
  return slot ? roundToTenth(slot.projectedEffectiveStimulusByMuscle[muscle] ?? 0) : null;
}

function computeShortfall(target: number | null, actual: number | null): number | null {
  if (target == null || actual == null) {
    return null;
  }
  return roundToTenth(Math.max(0, target - actual));
}

function isHamstringExercise(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number]
): boolean {
  return exercise.primaryMuscles.map(normalizeMuscle).includes(CLEAN_PRESELECTION_MUSCLE);
}

function isKneeFlexionCurl(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number]
): boolean {
  return isHamstringExercise(exercise) && LEG_CURL_NAME_PATTERN.test(exercise.exerciseName);
}

function isHingeCompound(
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number]
): boolean {
  return (
    isHamstringExercise(exercise) &&
    exercise.role === "main" &&
    HINGE_NAME_PATTERN.test(exercise.exerciseName) &&
    !BACK_EXTENSION_NAME_PATTERN.test(exercise.exerciseName)
  );
}

function normalizeExerciseMuscles(values: ReadonlyArray<string> | undefined): string[] {
  return sortPrescriptionStrings((values ?? []).map(normalizeMuscle));
}

function getExerciseStimulusPerSet(
  exercise: DiagnosticExercise,
  muscle: string
): number | null {
  const value = getEffectiveStimulusByMuscle(exercise, 1, {
    logFallback: false,
  }).get(muscle);
  return value == null || value <= 0 ? null : roundToTenth(value);
}

function hasMuscleStimulus(exercise: DiagnosticExercise, muscle: string): boolean {
  return (getExerciseStimulusPerSet(exercise, muscle) ?? 0) > 0;
}

function classifyCleanPreselectionCandidate(
  exercise: DiagnosticExercise
): CleanPreselectionCandidateInventory["candidateClass"] {
  const primaryMuscles = normalizeExerciseMuscles(exercise.primaryMuscles);
  const movementPatterns = exercise.movementPatterns ?? [];
  const isHamstringsPrimary = primaryMuscles.includes(CLEAN_PRESELECTION_MUSCLE);
  if (
    BACK_EXTENSION_NAME_PATTERN.test(exercise.name) ||
    (isHamstringsPrimary &&
      movementPatterns.includes("extension") &&
      primaryMuscles.includes("Lower Back"))
  ) {
    return "dirty_extension";
  }
  if (
    isHamstringsPrimary &&
    (LEG_CURL_NAME_PATTERN.test(exercise.name) || movementPatterns.includes("flexion"))
  ) {
    return "knee_flexion_curl";
  }
  if (
    isHamstringsPrimary &&
    ((exercise.isCompound ?? false) || movementPatterns.includes("hinge")) &&
    (movementPatterns.includes("hinge") || HINGE_NAME_PATTERN.test(exercise.name))
  ) {
    return "hinge_compound";
  }
  return "unknown";
}

function getCandidateClassRank(
  candidateClass: CleanPreselectionCandidateInventory["candidateClass"]
): number {
  switch (candidateClass) {
    case "knee_flexion_curl":
      return 0;
    case "hinge_compound":
      return 1;
    case "dirty_extension":
      return 2;
    case "unknown":
      return 3;
  }
}

function collectSelectedSlotIdsByExercise(input: {
  initialSlotComposition: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
}): Map<string, string[]> {
  const byExercise = new Map<string, Set<string>>();
  const append = (exerciseId: string, slotId: string) => {
    const slots = byExercise.get(exerciseId) ?? new Set<string>();
    slots.add(slotId);
    byExercise.set(exerciseId, slots);
  };

  for (const slot of [...input.initialSlotComposition, ...input.finalSlotPlan]) {
    for (const exercise of slot.exercises) {
      append(exercise.exerciseId, slot.slotId);
    }
  }

  return new Map(
    Array.from(byExercise.entries()).map(([exerciseId, slotIds]) => [
      exerciseId,
      Array.from(slotIds).sort((left, right) => left.localeCompare(right)),
    ])
  );
}

function isExerciseSelectedInSlot(input: {
  slots: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  slotId: string;
  exerciseId: string;
}): boolean {
  return Boolean(
    input.slots
      .find((slot) => slot.slotId === input.slotId)
      ?.exercises.some((exercise) => exercise.exerciseId === input.exerciseId)
  );
}

function isInventoryCandidateRelevant(exercise: DiagnosticExercise): boolean {
  const primaryMuscles = normalizeExerciseMuscles(exercise.primaryMuscles);
  const secondaryMuscles = normalizeExerciseMuscles(exercise.secondaryMuscles);
  return (
    primaryMuscles.includes(CLEAN_PRESELECTION_MUSCLE) ||
    secondaryMuscles.includes(CLEAN_PRESELECTION_MUSCLE) ||
    hasMuscleStimulus(exercise, CLEAN_PRESELECTION_MUSCLE) ||
    LEG_CURL_NAME_PATTERN.test(exercise.name) ||
    BACK_EXTENSION_NAME_PATTERN.test(exercise.name) ||
    STIFF_LEGGED_DEADLIFT_NAME_PATTERN.test(exercise.name)
  );
}

function buildCandidateInventory(input: {
  exerciseLibrary: ReadonlyArray<DiagnosticExercise>;
  prescription: MusclePrescription;
  slotIntent: SlotPrescriptionIntent | undefined;
  initialSlotComposition: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  duplicateExerciseReuse: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): CleanPreselectionCandidateInventory[] {
  const selectedSlotIdsByExercise = collectSelectedSlotIdsByExercise({
    initialSlotComposition: input.initialSlotComposition,
    finalSlotPlan: input.finalSlotPlan,
  });
  const lowerBFinalExerciseCount =
    findSlotSnapshot(input.finalSlotPlan, CLEAN_PRESELECTION_SLOT_ID)?.exerciseCount ?? 0;
  const lowerBCapacityAvailable = lowerBFinalExerciseCount < SESSION_CAPS.maxExercises;

  return input.exerciseLibrary
    .filter(isInventoryCandidateRelevant)
    .map((exercise) => {
      const candidateClass = classifyCleanPreselectionCandidate(exercise);
      const primaryMuscles = normalizeExerciseMuscles(exercise.primaryMuscles);
      const secondaryMuscles = normalizeExerciseMuscles(exercise.secondaryMuscles);
      const movementPatterns = sortPrescriptionStrings(exercise.movementPatterns ?? []);
      const hamstringsStimulusPerSet = getExerciseStimulusPerSet(
        exercise,
        CLEAN_PRESELECTION_MUSCLE
      );
      const glutesStimulusPerSet = getExerciseStimulusPerSet(exercise, "Glutes");
      const lowerBackStimulusPerSet = getExerciseStimulusPerSet(
        exercise,
        "Lower Back"
      );
      const lowerSlotCompatible = isExerciseEligibleForSessionInventory(
        exercise,
        "lower",
        "standard"
      );
      const classAllowed =
        candidateClass !== "unknown" &&
        input.prescription.allowedExerciseClasses.includes(candidateClass);
      const patternAllowed = movementPatterns.some((pattern) =>
        input.prescription.allowedPatterns.includes(pattern)
      );
      const classPatternBridgeMismatch =
        classAllowed && movementPatterns.length > 0 && !patternAllowed;
      const selectedInLowerBInitial = isExerciseSelectedInSlot({
        slots: input.initialSlotComposition,
        slotId: CLEAN_PRESELECTION_SLOT_ID,
        exerciseId: exercise.id,
      });
      const selectedInLowerBFinal = isExerciseSelectedInSlot({
        slots: input.finalSlotPlan,
        slotId: CLEAN_PRESELECTION_SLOT_ID,
        exerciseId: exercise.id,
      });
      const alreadySelectedSlotIds = selectedSlotIdsByExercise.get(exercise.id) ?? [];
      const alreadySelectedInWeek = alreadySelectedSlotIds.length > 0;
      const selectedOutsideLowerB = alreadySelectedSlotIds.some(
        (slotId) => slotId !== CLEAN_PRESELECTION_SLOT_ID
      );
      const duplicateDiagnostic = input.duplicateExerciseReuse.find(
        (row) =>
          row.exerciseId === exercise.id &&
          row.repeatedInSlotId === CLEAN_PRESELECTION_SLOT_ID
      );
      const lowerBCompatible =
        lowerSlotCompatible &&
        input.prescription.targetStatus !== "forbidden" &&
        candidateClass !== "dirty_extension" &&
        candidateClass !== "unknown" &&
        (classAllowed || patternAllowed);
      const reasons = sortPrescriptionStrings([
        `candidate_class:${candidateClass}`,
        `lower_slot_compatible:${lowerSlotCompatible ? "yes" : "no"}`,
        `lower_b_compatible:${lowerBCompatible ? "yes" : "no"}`,
        `lower_b_capacity:${lowerBFinalExerciseCount}/${SESSION_CAPS.maxExercises}`,
        ...(lowerBCapacityAvailable ? ["lower_b_capacity_available"] : ["lower_b_capacity_full"]),
        ...(classAllowed ? [`allowed_exercise_class:${candidateClass}`] : []),
        ...(patternAllowed
          ? movementPatterns
              .filter((pattern) => input.prescription.allowedPatterns.includes(pattern))
              .map((pattern) => `allowed_pattern:${pattern}`)
          : []),
        ...(classPatternBridgeMismatch
          ? [
              `classification_mismatch:movementPatterns_${movementPatterns.join("+")}_not_in_allowedPatterns_${input.prescription.allowedPatterns.join("+") || "none"}_but_class_${candidateClass}_is_allowed`,
            ]
          : []),
        ...(alreadySelectedInWeek
          ? [`already_selected_slots:${alreadySelectedSlotIds.join(",")}`]
          : ["not_selected_in_projected_week"]),
        ...(selectedOutsideLowerB
          ? ["duplicate_week_placement_possible_blocker"]
          : []),
        ...(duplicateDiagnostic
          ? [
              `duplicate_diagnostic:${duplicateDiagnostic.reason}`,
              `duplicate_previous_slots:${duplicateDiagnostic.previousSlotIds.join(",")}`,
              `duplicate_has_compatible_alternative:${duplicateDiagnostic.hasCompatibleAlternative ? "yes" : "no"}`,
            ]
          : ["duplicate_reuse_diagnostic_not_present_for_lower_b"]),
        ...(input.slotIntent
          ? [`slot_prescription_intent:${input.slotIntent.slotArchetype ?? "unknown"}`]
          : ["slot_prescription_intent_missing"]),
        ...(candidateClass === "dirty_extension"
          ? ["not_clean_closure:extension_collateral_sensitive"]
          : []),
        ...(candidateClass === "hinge_compound"
          ? ["not_knee_flexion_curl:hinge_collateral_sensitive"]
          : []),
      ]);

      let availability: CleanPreselectionCandidateInventory["availability"];
      if (candidateClass === "dirty_extension" || candidateClass === "hinge_compound") {
        availability = "dirty_not_clean_candidate";
      } else if (candidateClass === "unknown") {
        availability = "unknown_blocker";
      } else if (!lowerBCompatible && classPatternBridgeMismatch) {
        availability = "available_but_classification_mismatch";
      } else if (!lowerBCompatible) {
        availability = "unknown_blocker";
      } else if (duplicateDiagnostic) {
        availability = "available_but_duplicate_blocked";
      } else if (selectedOutsideLowerB && !selectedInLowerBFinal) {
        availability = "available_but_already_used_elsewhere";
      } else if (!lowerBCapacityAvailable && !selectedInLowerBFinal) {
        availability = "available_but_capacity_blocked";
      } else {
        availability = "clean_available";
      }

      return {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        candidateClass,
        primaryMuscles,
        secondaryMuscles,
        movementPatterns,
        hamstringsStimulusPerSet,
        glutesStimulusPerSet,
        lowerBackStimulusPerSet,
        lowerSlotCompatible,
        lowerBCompatible,
        alreadySelectedInWeek,
        alreadySelectedSlotIds,
        selectedInLowerBInitial,
        selectedInLowerBFinal,
        availability,
        reasons,
      };
    })
    .sort(
      (left, right) =>
        getCandidateClassRank(left.candidateClass) -
          getCandidateClassRank(right.candidateClass) ||
        left.exerciseName.localeCompare(right.exerciseName)
    );
}

function formatExerciseEvidence(
  slotId: string,
  source: "initialSlotComposition" | "finalSlotPlan",
  exercise: SlotCompositionSnapshotDiagnostic["exercises"][number]
): string {
  return `${source}:${slotId}:${exercise.exerciseName}:${exercise.setCount} sets`;
}

function collectCleanPathEvidence(input: {
  initialSlot: SlotCompositionSnapshotDiagnostic | undefined;
  finalSlot: SlotCompositionSnapshotDiagnostic | undefined;
}): CleanPreselectionFeasibility["preferredCleanPath"] {
  const rows = [
    ...(input.initialSlot?.exercises ?? []).map((exercise) => ({
      source: "initialSlotComposition" as const,
      exercise,
    })),
    ...(input.finalSlot?.exercises ?? []).map((exercise) => ({
      source: "finalSlotPlan" as const,
      exercise,
    })),
  ];
  const curlEvidence = rows
    .filter((row) => isKneeFlexionCurl(row.exercise))
    .map((row) => formatExerciseEvidence(CLEAN_PRESELECTION_SLOT_ID, row.source, row.exercise));
  const hingeEvidence = rows
    .filter((row) => isHingeCompound(row.exercise))
    .map((row) => formatExerciseEvidence(CLEAN_PRESELECTION_SLOT_ID, row.source, row.exercise));

  return [
    {
      exerciseClass: "knee_flexion_curl",
      available: curlEvidence.length > 0,
      evidence: sortPrescriptionStrings(curlEvidence),
    },
    {
      exerciseClass: "hinge_compound",
      available: hingeEvidence.length > 0,
      evidence: sortPrescriptionStrings(hingeEvidence),
    },
    {
      exerciseClass: "existing_anchor_plus_curl",
      available: curlEvidence.length > 0 && hingeEvidence.length > 0,
      evidence: sortPrescriptionStrings([...hingeEvidence, ...curlEvidence]),
    },
  ];
}

function appendDirtySignal(
  signals: CleanPreselectionFeasibility["dirtyClosureSignals"],
  signal: CleanPreselectionFeasibility["dirtyClosureSignals"][number]["signal"],
  evidence: ReadonlyArray<string>
): void {
  const normalizedEvidence = sortPrescriptionStrings(evidence);
  if (normalizedEvidence.length === 0) {
    return;
  }
  const existing = signals.find((row) => row.signal === signal);
  if (!existing) {
    signals.push({ signal, evidence: normalizedEvidence });
    return;
  }
  existing.evidence = sortPrescriptionStrings([
    ...existing.evidence,
    ...normalizedEvidence,
  ]);
}

function buildCleanPreselectionFeasibility(input: {
  exerciseLibrary?: ReadonlyArray<DiagnosticExercise>;
  initialSlotComposition: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  finalSlotPlan: ReadonlyArray<SlotCompositionSnapshotDiagnostic>;
  allocationVsInitialDelta: ReadonlyArray<AllocationVsCompositionDelta>;
  repairMaterialityAfterShadowAllocation: ReadonlyArray<ShadowRepairMaterialityDiagnostic>;
  suspiciousRepairsNotEligibleForPromotion: ReadonlyArray<SuspiciousRepairNotEligibleForPromotion>;
  promotionCandidates: ReadonlyArray<PromotionCandidate>;
  weakPreselectionConsumption: ReadonlyArray<WeakPreselectionConsumptionDiagnostic>;
  slotPrescriptionIntents: ReadonlyArray<SlotPrescriptionIntent>;
  setDistributionIntents: ReadonlyArray<SetDistributionIntent>;
  distributionGuardActions: ReadonlyArray<DistributionGuardAction>;
  duplicateExerciseReuse?: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
}): CleanPreselectionFeasibility[] {
  const slotIntent = input.slotPrescriptionIntents.find(
    (intent) => intent.slotId === CLEAN_PRESELECTION_SLOT_ID
  );
  const prescription = slotIntent?.musclePrescriptions.find(
    (row) =>
      row.muscle === CLEAN_PRESELECTION_MUSCLE &&
      row.targetStatus !== "forbidden" &&
      row.demandType === "direct_required"
  );
  if (!prescription) {
    return [];
  }

  const initialSlot = findSlotSnapshot(input.initialSlotComposition, CLEAN_PRESELECTION_SLOT_ID);
  const finalSlot = findSlotSnapshot(input.finalSlotPlan, CLEAN_PRESELECTION_SLOT_ID);
  const targetEffectiveSets =
    prescription.minEffectiveSets ?? prescription.desiredEffectiveSets ?? null;
  const currentInitialEffectiveSets = slotStimulus(initialSlot, CLEAN_PRESELECTION_MUSCLE);
  const currentFinalEffectiveSets = slotStimulus(finalSlot, CLEAN_PRESELECTION_MUSCLE);
  const shortfallBeforeRepair = computeShortfall(
    targetEffectiveSets,
    currentInitialEffectiveSets
  );
  const preferredCleanPath = collectCleanPathEvidence({ initialSlot, finalSlot });
  const candidateInventory = buildCandidateInventory({
    exerciseLibrary: input.exerciseLibrary ?? [],
    prescription,
    slotIntent,
    initialSlotComposition: input.initialSlotComposition,
    finalSlotPlan: input.finalSlotPlan,
    duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
  });
  const glutesDelta = roundToTenth(
    (slotStimulus(finalSlot, "Glutes") ?? 0) - (slotStimulus(initialSlot, "Glutes") ?? 0)
  );
  const lowerBackDelta = roundToTenth(
    (slotStimulus(finalSlot, "Lower Back") ?? 0) -
      (slotStimulus(initialSlot, "Lower Back") ?? 0)
  );
  const dirtyClosureSignals: CleanPreselectionFeasibility["dirtyClosureSignals"] = [];
  const lowerBRepairRows = input.repairMaterialityAfterShadowAllocation.filter(
    (row) => row.slotId === CLEAN_PRESELECTION_SLOT_ID
  );
  const positiveRepairRows = lowerBRepairRows.filter(
    (row) =>
      (row.action === "added" || row.action === "set_bumped") &&
      (row.effectiveStimulusDelta > 0 || row.effectiveStimulusAdded > 0)
  );
  const backExtensionRows = positiveRepairRows.filter(
    (row) =>
      BACK_EXTENSION_NAME_PATTERN.test(row.exerciseName ?? "") &&
      [CLEAN_PRESELECTION_MUSCLE, "Glutes", "Lower Back"].includes(row.muscle ?? "")
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "back_extension_closure",
    backExtensionRows
      .filter((row) => row.muscle === CLEAN_PRESELECTION_MUSCLE)
      .map((row) => `${row.slotId}:${row.exerciseName}:${row.repairMechanism}:${row.action}`)
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "glute_collateral",
    [
      ...backExtensionRows
        .filter((row) => row.muscle === "Glutes")
        .map((row) => `${row.slotId}:${row.exerciseName}:${row.muscle}:${row.effectiveStimulusDelta}`),
      ...(glutesDelta >= MATERIAL_COLLATERAL_DELTA
        ? [`collateralEstimate:Glutes:+${glutesDelta}`]
        : []),
    ]
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "lower_back_collateral",
    [
      ...backExtensionRows
        .filter((row) => row.muscle === "Lower Back")
        .map((row) => `${row.slotId}:${row.exerciseName}:${row.muscle}:${row.effectiveStimulusDelta}`),
      ...(lowerBackDelta >= MATERIAL_COLLATERAL_DELTA
        ? [`collateralEstimate:Lower Back:+${lowerBackDelta}`]
        : []),
    ]
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "suspicious_repair",
    input.suspiciousRepairsNotEligibleForPromotion
      .filter(
        (row) =>
          row.slotId === CLEAN_PRESELECTION_SLOT_ID &&
          [CLEAN_PRESELECTION_MUSCLE, "Glutes", "Lower Back"].includes(row.muscle) &&
          !row.reason.includes("cap cleanup")
      )
      .map((row) => `${row.slotId}:${row.muscle}:${row.exerciseName ?? row.repairMechanism}:${row.reason}`)
  );

  const setDistributionIntent = input.setDistributionIntents.find(
    (intent) => intent.slotId === CLEAN_PRESELECTION_SLOT_ID
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "sldl_concentration",
    [
      ...input.repairMaterialityAfterShadowAllocation
        .filter(
          (row) =>
            row.slotId === CLEAN_PRESELECTION_SLOT_ID &&
            STIFF_LEGGED_DEADLIFT_NAME_PATTERN.test(row.exerciseName ?? "") &&
            row.muscle === CLEAN_PRESELECTION_MUSCLE &&
            row.action !== "set_trimmed" &&
            row.action !== "removed"
        )
        .map((row) => `${row.slotId}:${row.exerciseName}:${row.repairMechanism}:${row.action}`),
      ...(setDistributionIntent?.evidence.concentrationRows ?? []).filter((row) =>
        STIFF_LEGGED_DEADLIFT_NAME_PATTERN.test(row)
      ),
    ]
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "cap_cleanup",
    [
      ...lowerBRepairRows
        .filter(
          (row) =>
            (row.action === "set_trimmed" || row.action === "removed") &&
            (row.muscle === CLEAN_PRESELECTION_MUSCLE ||
              STIFF_LEGGED_DEADLIFT_NAME_PATTERN.test(row.exerciseName ?? ""))
        )
        .map((row) => `${row.slotId}:${row.exerciseName ?? row.exerciseId}:${row.muscle}:${row.action}`),
      ...(setDistributionIntent?.evidence.capCleanupRows ?? []),
      ...input.distributionGuardActions
        .filter(
          (row) =>
            row.slotId === CLEAN_PRESELECTION_SLOT_ID &&
            row.muscle === CLEAN_PRESELECTION_MUSCLE
        )
        .map((row) => `${row.slotId}:${row.exerciseName}:${row.attemptedAction}:${row.decision}:${row.reason ?? "no_reason"}`),
    ]
  );

  const allocationDelta = input.allocationVsInitialDelta.find(
    (row) => row.slotId === CLEAN_PRESELECTION_SLOT_ID
  );
  const initialHamstringShortfall = allocationDelta?.underAllocatedMuscles.find(
    (row) => row.muscle === CLEAN_PRESELECTION_MUSCLE
  );
  appendDirtySignal(
    dirtyClosureSignals,
    "weak_preselection_risk",
    [
      ...input.weakPreselectionConsumption
        .filter(
          (row) =>
            row.slotId === CLEAN_PRESELECTION_SLOT_ID &&
            row.muscle === CLEAN_PRESELECTION_MUSCLE
        )
        .map((row) => `${row.slotId}:${row.muscle}:selected_${row.selectedEffectiveSets}:targetMet_${row.targetMet}`),
      ...(initialHamstringShortfall && (currentInitialEffectiveSets ?? 0) > 0
        ? [
            `${CLEAN_PRESELECTION_SLOT_ID}:${CLEAN_PRESELECTION_MUSCLE}:initial_${currentInitialEffectiveSets}_shortfall_${initialHamstringShortfall.shortfall ?? "unknown"}`,
          ]
        : []),
    ]
  );

  const cleanPathAvailable = preferredCleanPath.some(
    (path) =>
      path.available &&
      (path.exerciseClass === "knee_flexion_curl" ||
        path.exerciseClass === "existing_anchor_plus_curl")
  );
  const targetMet =
    targetEffectiveSets != null &&
    currentFinalEffectiveSets != null &&
    currentFinalEffectiveSets + 1e-9 >= targetEffectiveSets;
  const hasDirtySignals = dirtyClosureSignals.length > 0;
  const hasDistributionOnlyDirtySignals =
    hasDirtySignals &&
    dirtyClosureSignals.every((row) =>
      row.signal === "sldl_concentration" || row.signal === "cap_cleanup"
    );
  const candidateStatus: CleanPreselectionFeasibility["candidateStatus"] =
    hasDirtySignals
      ? "dirty_candidate"
      : cleanPathAvailable && targetMet
        ? "clean_candidate"
        : currentFinalEffectiveSets === 0
          ? "not_feasible"
          : "needs_more_inventory_detail";
  const recommendation: CleanPreselectionFeasibility["recommendation"] =
    candidateStatus === "clean_candidate"
      ? "safe_to_trial_preselection"
      : hasDistributionOnlyDirtySignals
        ? "requires_distribution_policy_first"
        : candidateStatus === "needs_more_inventory_detail" || candidateStatus === "not_feasible"
          ? "requires_inventory_or_exercise_class_fix"
          : "do_not_promote_yet";
  const reasons = sortPrescriptionStrings([
    "read_only_diagnostic_only",
    "candidate_scope:lower_b_Hamstrings",
    "derived_from_planningReality_existing_rows",
    ...(input.promotionCandidates.some(
      (row) =>
        row.slotId === CLEAN_PRESELECTION_SLOT_ID &&
        row.muscle === CLEAN_PRESELECTION_MUSCLE &&
        row.suggestedPromotion === "slot_preselection_demand"
    )
      ? ["existing_promotion_candidate_slot_preselection_demand"]
      : []),
    ...(cleanPathAvailable ? ["clean_knee_flexion_path_evidence_present"] : ["clean_path_evidence_missing_or_incomplete"]),
    ...(candidateInventory.some((candidate) => candidate.candidateClass === "knee_flexion_curl")
      ? ["inventory_clean_knee_flexion_candidates_visible"]
      : ["inventory_clean_knee_flexion_candidates_missing_or_not_passed"]),
    ...(targetMet ? ["final_target_met"] : ["final_target_not_met_or_unknown"]),
    ...dirtyClosureSignals.map((row) => `dirty_signal:${row.signal}`),
  ]);

  return [
    {
      slotId: CLEAN_PRESELECTION_SLOT_ID,
      muscle: CLEAN_PRESELECTION_MUSCLE,
      role: prescription.role === "support" ? "support" : "primary",
      targetStatus: prescription.targetStatus === "soft" ? "soft" : "hard",
      demandType: prescription.demandType,
      candidateStatus,
      targetEffectiveSets,
      currentInitialEffectiveSets,
      currentFinalEffectiveSets,
      shortfallBeforeRepair,
      preferredCleanPath,
      dirtyClosureSignals: dirtyClosureSignals.sort((left, right) =>
        left.signal.localeCompare(right.signal)
      ),
      collateralEstimate: {
        glutesDelta,
        lowerBackDelta,
      },
      candidateInventory,
      recommendation,
      reasons,
      readOnly: true,
      affectsScoringOrGeneration: false,
    },
  ];
}

function buildWarnings(input: {
  weeklyMuscleDemand: WeeklyMuscleDemandDiagnostic[];
  slotDemandAllocation: SlotDemandAllocationDiagnostic[];
  projectedDelivery: ProjectedDeliveryDiagnostic[];
  repairMateriality: RepairMaterialityDiagnostic[];
  exerciseConcentration: ExerciseConcentrationDiagnostic[];
  rearDeltCollateralSummary?: RearDeltCollateralSummary | null;
}): SlotPlanPlanningRealityDiagnostic["warnings"] {
  const warnings: SlotPlanPlanningRealityDiagnostic["warnings"] = [];
  const add = (
    code: ProgramShapeWarningCode,
    severity: "info" | "warning",
    message: string,
    evidence: string[]
  ) => {
    if (!warnings.some((warning) => warning.code === code)) {
      warnings.push({ code, severity, message, evidence });
    }
  };

  const materialSupportRepairs = input.repairMateriality.filter(
    (row) =>
      row.behaviorClass === "program_shaping" &&
      row.materiality !== "none" &&
      (row.repairMechanism.includes("support_floor") ||
        input.weeklyMuscleDemand.find((demand) => demand.muscle === row.muscle)?.targetStatus === "soft")
  );
  if (materialSupportRepairs.length > 0) {
    add(
      "REPAIR_CREATED_MATERIAL_SUPPORT_COVERAGE",
      "warning",
      "Final repair/shaping materially created support coverage.",
      materialSupportRepairs.slice(0, 4).map((row) => `${row.slotId ?? "week"}:${row.muscle}:${row.repairMechanism}`)
    );
  }

  const addedIdentity = input.repairMateriality.filter((row) => row.changedExerciseIdentity && row.action === "added");
  if (addedIdentity.length > 0) {
    add(
      "REPAIR_ADDED_EXERCISE_IDENTITY",
      "warning",
      "Final repair/shaping added exercise identity after initial slot composition.",
      addedIdentity.slice(0, 4).map((row) => `${row.slotId}:${row.exerciseName}`)
    );
  }

  const concentrationFlags = input.exerciseConcentration.filter((row) =>
    row.flags.some((flag) => flag.includes("EXERCISE_SUPPLIES_OVER"))
  );
  if (concentrationFlags.length > 0) {
    add(
      "EXERCISE_CONCENTRATION_HIGH",
      "warning",
      "One exercise supplies a high share of a muscle's projected weekly stimulus.",
      concentrationFlags.slice(0, 4).map((row) => `${row.slotId}:${row.exerciseName}`)
    );
  }

  const localSlots = input.slotDemandAllocation.filter(
    (slot) => slot.allocationBasis === "local_movement_or_lane_semantics" || slot.allocationBasis === "unclear"
  );
  if (localSlots.length > 0) {
    add(
      "SLOT_ALLOCATION_NOT_EXPLICIT",
      "info",
      "One or more slots have no explicit weekly demand allocation and are explained by local slot/movement semantics.",
      localSlots.map((slot) => slot.slotId)
    );
  }

  const primaryBelowBeforeRepair = input.projectedDelivery.filter(
    (row) =>
      row.targetStatus === "hard" &&
      row.preferredTarget != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition < row.preferredTarget
  );
  if (primaryBelowBeforeRepair.length > 0) {
    add(
      "PRIMARY_MUSCLE_BELOW_TARGET_BEFORE_REPAIR",
      "warning",
      "A hard weekly-demand muscle was below target before final repair/shaping.",
      primaryBelowBeforeRepair.slice(0, 4).map((row) => `${row.muscle}:${row.projectedEffectiveStimulusAfterInitialSlotComposition}/${row.preferredTarget}`)
    );
  }

  const supportClosedLate = input.projectedDelivery.filter(
    (row) =>
      row.targetStatus === "soft" &&
      row.preferredTarget != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition != null &&
      row.projectedEffectiveStimulusAfterInitialSlotComposition < row.preferredTarget &&
      row.projectedEffectiveStimulusAfterRepairAndFinalShaping >= row.preferredTarget
  );
  if (supportClosedLate.length > 0) {
    add(
      "SUPPORT_FLOOR_CLOSED_LATE",
      "warning",
      "Support-floor coverage closed only after final repair/shaping.",
      supportClosedLate.slice(0, 4).map((row) => row.muscle)
    );
  }

  const trims = input.repairMateriality.filter(
    (row) => row.action === "set_trimmed" || row.action === "removed"
  );
  if (trims.length > 0) {
    add(
      "FINAL_CAP_TRIM_REQUIRED",
      "info",
      "Final shaping trimmed sets or removed exercise identity after initial slot composition.",
      trims.slice(0, 4).map((row) => `${row.slotId}:${row.exerciseName}:${row.rawSetDelta}`)
    );
  }

  const rearDelt = input.rearDeltCollateralSummary;
  if (rearDelt?.rearDeltPreselectionConsumed) {
    if (rearDelt.upperBackCollateralDelta >= MATERIAL_UPPER_BACK_COLLATERAL_DELTA) {
      add(
        "REAR_DELT_COLLATERAL_UPPER_BACK_INCREASE",
        "warning",
        "Rear Delts preselection was consumed while Upper Back collateral stimulus increased materially.",
        [`Upper Back +${rearDelt.upperBackCollateralDelta}`]
      );
    }
    if ((rearDelt.pullPatternConcentrationDelta ?? 0) > 0) {
      add(
        "REAR_DELT_COLLATERAL_PULL_CONCENTRATION",
        "warning",
        "Rear Delts preselection was consumed while pull-pattern concentration burden increased.",
        [`pullPatternConcentrationDelta:${rearDelt.pullPatternConcentrationDelta}`]
      );
    }
    if ((rearDelt.capTrimOrRemovalDelta ?? 0) > 0) {
      add(
        "REAR_DELT_COLLATERAL_CAP_TRIM",
        "warning",
        "Rear Delts preselection was consumed while final cap trim or removal burden remained.",
        [`capTrimOrRemovalDelta:${rearDelt.capTrimOrRemovalDelta}`]
      );
    }
    if ((rearDelt.suspiciousRepairDelta ?? 0) > 0) {
      add(
        "REAR_DELT_COLLATERAL_SUSPICIOUS_REPAIR_INCREASE",
        "warning",
        "Rear Delts preselection was consumed while suspicious repair burden increased.",
        [`suspiciousRepairDelta:${rearDelt.suspiciousRepairDelta}`]
      );
    }
    if (rearDelt.verdict === "mixed_collateral" || rearDelt.verdict === "worse_collateral") {
      add(
        "REAR_DELT_PRESELECTION_CONSUMED_BUT_PROGRAM_WORSE",
        "warning",
        "Consumed Rear Delts preselection demand alone is not success when total-program collateral worsens.",
        rearDelt.reasons
      );
    }
  }

  return warnings;
}

function classifyPlanningShape(input: {
  weeklyMuscleDemand: WeeklyMuscleDemandDiagnostic[];
  slotDemandAllocation: SlotDemandAllocationDiagnostic[];
  repairMateriality: RepairMaterialityDiagnostic[];
}): SlotPlanPlanningRealityDiagnostic["summary"]["planningShape"] {
  const hardDemandCount = input.weeklyMuscleDemand.filter((row) => row.targetStatus === "hard").length;
  const explicitSlotCount = input.slotDemandAllocation.filter(
    (row) => row.allocationBasis === "explicit_weekly_demand"
  ).length;
  const materialRepairCount = input.repairMateriality.filter(
    (row) => row.materiality === "moderate" || row.materiality === "major"
  ).length;
  const majorRepairCount = input.repairMateriality.filter((row) => row.materiality === "major").length;

  if (hardDemandCount === 0 && explicitSlotCount === 0) {
    return "unclear_due_to_missing_instrumentation";
  }
  if (materialRepairCount === 0 && explicitSlotCount >= Math.max(1, input.slotDemandAllocation.length / 2)) {
    return "mostly_upstream_planned";
  }
  if (majorRepairCount >= Math.max(1, hardDemandCount) || materialRepairCount > explicitSlotCount) {
    return "mostly_repair_shaped";
  }
  return "mixed_upstream_plus_repair_shaped";
}

export function buildWeeklyDemandSlotAllocationDiagnostic(input: {
  activeMesocycle: ActiveMesocycleForDiagnostics;
  slotSequence: ReadonlyArray<SlotSequenceEntry>;
  exerciseLibrary?: ReadonlyArray<DiagnosticExercise>;
  initialProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  finalProjectedSlots: ReadonlyArray<ProjectedSlotWorkout>;
  weeklyObligationPlan: WeeklyMuscleObligationPlan;
  weeklyObligationEvaluations: ReadonlyArray<SlotObligationEvaluation>;
  protectedCoverage: ProtectedWeekOneCoverageEvaluation;
  supportFloorRepairReasons: Partial<Record<ProtectedWeekOneCoverageMuscle, SupportFloorRepairReason[]>>;
  programQualityAppliedDiagnostics: ReadonlyArray<ProgramQualityDiagnostic>;
  programQualityEvaluation: ProgramQualityEvaluation;
  preselectionDemands?: ReadonlyArray<PreselectionDemandDiagnosticLike>;
  duplicateExerciseReuse?: ReadonlyArray<DuplicateExerciseReuseDiagnostic>;
  distributionGuardActions?: ReadonlyArray<DistributionGuardAction>;
  forbiddenCleanupReroute?: ForbiddenCleanupRerouteDiagnostic;
}): SlotPlanPlanningRealityDiagnostic {
  const relevantMuscles = collectRelevantMuscles({
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    weeklyObligationPlan: input.weeklyObligationPlan,
    protectedCoverage: input.protectedCoverage,
    supportFloorRepairReasons: input.supportFloorRepairReasons,
    programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
    slotSequence: input.slotSequence,
  });
  const weeklyMuscleDemand = buildWeeklyMuscleDemand({
    activeMesocycle: input.activeMesocycle,
    weeklyObligationPlan: input.weeklyObligationPlan,
    protectedCoverage: input.protectedCoverage,
    relevantMuscles,
  });
  const slotDemandAllocation = buildSlotDemandAllocation({
    slotSequence: input.slotSequence,
    weeklyObligationPlan: input.weeklyObligationPlan,
    finalProjectedSlots: input.finalProjectedSlots,
  });
  const shadowSlotDemandAllocation = buildShadowSlotDemandAllocation({
    activeMesocycle: input.activeMesocycle,
    slotSequence: input.slotSequence,
    weeklyObligationPlan: input.weeklyObligationPlan,
    relevantMuscles,
  });
  const shadowWeeklyDemand = buildShadowWeeklyDemand({
    activeMesocycle: input.activeMesocycle,
    weeklyObligationPlan: input.weeklyObligationPlan,
    relevantMuscles,
    shadowSlotDemandAllocation,
  });
  const initialSlotComposition = buildSlotCompositionSnapshots({
    slotSequence: input.slotSequence,
    projectedSlots: input.initialProjectedSlots,
  });
  const finalSlotPlan = buildSlotCompositionSnapshots({
    slotSequence: input.slotSequence,
    projectedSlots: input.finalProjectedSlots,
  });
  const allocationVsInitialDelta = buildAllocationDeltas({
    shadowSlotDemandAllocation,
    composition: initialSlotComposition,
    comparison: "allocation_vs_initial",
  });
  const allocationVsFinalDelta = buildAllocationDeltas({
    shadowSlotDemandAllocation,
    composition: finalSlotPlan,
    comparison: "allocation_vs_final",
  });
  const finalExerciseRows = buildExerciseRows(input.finalProjectedSlots);
  const projectedDelivery = buildProjectedDelivery({
    activeMesocycle: input.activeMesocycle,
    weeklyObligationPlan: input.weeklyObligationPlan,
    relevantMuscles,
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    finalExerciseRows,
  });
  const repairMateriality = buildRepairMateriality({
    activeMesocycle: input.activeMesocycle,
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    weeklyObligationPlan: input.weeklyObligationPlan,
    weeklyObligationEvaluations: input.weeklyObligationEvaluations,
    supportFloorRepairReasons: input.supportFloorRepairReasons,
    programQualityAppliedDiagnostics: input.programQualityAppliedDiagnostics,
    programQualityEvaluation: input.programQualityEvaluation,
  });
  const repairMaterialityAfterShadowAllocation = buildShadowRepairMateriality({
    repairMateriality,
    shadowWeeklyDemand,
    shadowSlotDemandAllocation,
  });
  const shadowRepairSummary = buildShadowRepairSummary(repairMaterialityAfterShadowAllocation);
  const suspiciousRepairsNotEligibleForPromotion = buildSuspiciousRepairs({
    repairRows: repairMaterialityAfterShadowAllocation,
    shadowSlotDemandAllocation,
  });
  const promotionCandidates = buildPromotionCandidates({
    repairRows: repairMaterialityAfterShadowAllocation,
    shadowWeeklyDemand,
    shadowSlotDemandAllocation,
    suspiciousRepairs: suspiciousRepairsNotEligibleForPromotion,
  });
  const weakPreselectionConsumption = buildWeakPreselectionConsumption({
    preselectionDemands: input.preselectionDemands ?? [],
  });
  const slotPrescriptionIntents = buildSlotPrescriptionIntents({
    slotSequence: input.slotSequence,
    slotDemandAllocation,
    shadowSlotDemandAllocation,
    finalSlotPlan,
    repairMaterialityAfterShadowAllocation,
    suspiciousRepairsNotEligibleForPromotion,
    promotionCandidates,
  });
  const exerciseConcentration = buildExerciseConcentration({
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
  });
  const setDistributionIntents = buildSetDistributionIntents({
    slotPrescriptionIntents,
    finalSlotPlan,
    exerciseConcentration,
    repairMaterialityAfterShadowAllocation,
  });
  const distributionGuardActions = Array.from(
    new Map(
      (input.distributionGuardActions ?? []).map((action) => [
        [
          action.slotId,
          action.exerciseName,
          action.muscle,
          action.attemptedAction,
          action.decision,
          action.alternativeExerciseName ?? "",
        ].join(":"),
        action,
      ]),
    ).values(),
  ).sort(
    (left, right) =>
      left.slotId.localeCompare(right.slotId) ||
      left.muscle.localeCompare(right.muscle) ||
      left.exerciseName.localeCompare(right.exerciseName),
  );
  const rearDeltCollateralSummary = buildRearDeltCollateralSummary({
    initialProjectedSlots: input.initialProjectedSlots,
    finalProjectedSlots: input.finalProjectedSlots,
    preselectionDemands: input.preselectionDemands ?? [],
    repairMaterialityAfterShadowAllocation,
    suspiciousRepairsNotEligibleForPromotion,
    exerciseConcentration,
  });
  const preselectionFeasibility = buildCleanPreselectionFeasibility({
    exerciseLibrary: input.exerciseLibrary,
    initialSlotComposition,
    finalSlotPlan,
    allocationVsInitialDelta,
    repairMaterialityAfterShadowAllocation,
    suspiciousRepairsNotEligibleForPromotion,
    promotionCandidates,
    weakPreselectionConsumption,
    slotPrescriptionIntents,
    setDistributionIntents,
    distributionGuardActions,
    duplicateExerciseReuse: input.duplicateExerciseReuse,
  });
  const warnings = buildWarnings({
    weeklyMuscleDemand,
    slotDemandAllocation,
    projectedDelivery,
    repairMateriality,
    exerciseConcentration,
    rearDeltCollateralSummary,
  });
  const preselectionDistributionPolicyByWeek =
    buildPreselectionDistributionPolicyByWeek({
      activeMesocycle: input.activeMesocycle,
      slotPrescriptionIntents,
      setDistributionIntents,
      finalSlotPlan,
      projectedDelivery,
      duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
      warnings,
    });
  const weeklyDemandCurve = buildWeeklyDemandCurve({
    activeMesocycle: input.activeMesocycle,
    shadowWeeklyDemand,
    projectedDelivery,
    exerciseConcentration,
  });
  const slotDemandAllocationByWeek = buildSlotDemandAllocationByWeek({
    activeMesocycle: input.activeMesocycle,
    weeklyDemandCurve,
    shadowSlotDemandAllocation,
    finalSlotPlan,
    projectedDelivery,
    duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
    exerciseConcentration,
  });
  const exerciseClassDistributionBySlot = buildExerciseClassDistributionBySlot({
    activeMesocycle: input.activeMesocycle,
    slotPrescriptionIntents,
    setDistributionIntents,
    slotDemandAllocationByWeek,
    finalSlotPlan,
    preselectionFeasibility,
    weakPreselectionConsumption,
    repairMaterialityAfterShadowAllocation,
    exerciseConcentration,
    duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
  });
  const {
    alignment: exerciseClassAlignment,
    unresolvedCauses: exerciseClassUnresolvedCauses,
  } = buildExerciseClassAlignment({
    exerciseClassDistributionBySlot,
    initialSlotComposition,
    finalSlotPlan,
    repairMaterialityAfterShadowAllocation,
    suspiciousRepairsNotEligibleForPromotion,
    exerciseConcentration,
    weakPreselectionConsumption,
    distributionGuardActions,
  });
  const accumulationWeekProjection = buildAccumulationWeekProjection({
    activeMesocycle: input.activeMesocycle,
    weeklyDemandCurve,
    finalSlotPlan,
    projectedDelivery,
    duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
    exerciseConcentration,
  });
  const duplicateContinuityJustification =
    buildDuplicateContinuityJustification({
      finalSlotPlan,
      exerciseLibrary: input.exerciseLibrary,
      duplicateExerciseReuse: input.duplicateExerciseReuse ?? [],
      exerciseClassDistributionBySlot,
      exerciseClassUnresolvedCauses,
      preselectionFeasibility,
      projectedDelivery,
      accumulationWeekProjection,
    });
  const materialRepairCount = repairMateriality.filter(
    (row) => row.materiality === "moderate" || row.materiality === "major"
  ).length;
  const majorRepairCount = repairMateriality.filter((row) => row.materiality === "major").length;
  const highExerciseConcentrationCount = exerciseConcentration.filter((row) =>
    row.flags.some((flag) => flag.includes("EXERCISE_SUPPLIES_OVER"))
  ).length;

  return {
    label: "weekly demand / slot allocation diagnostics",
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: {
      planningShape: classifyPlanningShape({
        weeklyMuscleDemand,
        slotDemandAllocation,
        repairMateriality,
      }),
      explicitWeeklyDemandMuscles: weeklyMuscleDemand.filter((row) => row.explicitUpstream).length,
      inferredDemandMuscles: weeklyMuscleDemand.filter((row) => row.inferredDownstream).length,
      slotsWithExplicitWeeklyDemand: slotDemandAllocation.filter(
        (row) => row.allocationBasis === "explicit_weekly_demand"
      ).length,
      slotsWithOnlyLocalOrInferredSemantics: slotDemandAllocation.filter(
        (row) =>
          row.allocationBasis === "local_movement_or_lane_semantics" ||
          row.allocationBasis === "unclear"
      ).length,
      materialRepairCount,
      majorRepairCount,
      highExerciseConcentrationCount,
      warningCodes: warnings.map((warning) => warning.code),
    },
    weeklyMuscleDemand,
    slotDemandAllocation,
    shadowWeeklyDemand,
    shadowSlotDemandAllocation,
    initialSlotComposition,
    finalSlotPlan,
    allocationVsInitialDelta,
    allocationVsFinalDelta,
    repairMaterialityAfterShadowAllocation,
    shadowRepairSummary,
    suspiciousRepairsNotEligibleForPromotion,
    promotionCandidates,
    weakPreselectionConsumption,
    slotPrescriptionIntents,
    setDistributionIntents,
    distributionGuardActions,
    preselectionFeasibility,
    preselectionDistributionPolicyByWeek,
    weeklyDemandCurve,
    slotDemandAllocationByWeek,
    exerciseClassDistributionBySlot,
    exerciseClassAlignment,
    exerciseClassUnresolvedCauses,
    duplicateContinuityJustification,
    accumulationWeekProjection,
    ...(input.forbiddenCleanupReroute
      ? { forbiddenCleanupReroute: input.forbiddenCleanupReroute }
      : {}),
    ...(rearDeltCollateralSummary ? { rearDeltCollateralSummary } : {}),
    projectedDelivery,
    repairMateriality,
    exerciseConcentration,
    warnings,
    limitations: [
      "Shadow weekly demand and slot demand allocation are upstream-planning diagnostics only; they are not consumed by slot-local selection, repair, scoring, seed serialization, or runtime replay.",
      "Initial slot composition means the selected slot workout after slot-local candidate selection and before final program-quality/support-floor/weekly-obligation shaping.",
      "Repair materiality is inferred from initial-vs-final projection deltas plus existing program-quality and coverage diagnostics; historical candidate ranking internals are not persisted here.",
      "This diagnostic is read-only and does not feed scoring, generation, seed parsing, or runtime replay.",
    ],
  };
}
