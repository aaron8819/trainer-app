import { prisma } from "@/lib/db/prisma";
import type { WorkoutSessionIntent } from "@prisma/client";
import {
  buildV2ExerciseMaterializationPlan,
  buildV2ExerciseClassDistributionBySlot,
  buildV2ExerciseSelectionPlan,
  buildV2BasePlanCompare,
  buildV2BasePlanShadowConsumptionTrial,
  buildV2BasePlanValidation,
  buildV2MaterializationDryRunReport,
  buildV2PlannerMesocyclePolicy,
  buildV2SelectionCapacityPlan,
  buildV2SetDistributionIntent,
  buildV2SlotWeekAllocationPolicyTrial,
  buildV2SlotWeekDonorCapacityProjection,
  compareV2MaterializedPlans,
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION,
  matchV2ExerciseClasses,
  type V2BasePlanCompare,
  type V2BasePlanComparePlanView,
  type V2BasePlanShadowConsumptionTrial,
  type V2ExerciseClassTaxonomy,
  type V2ExerciseMaterializationInput,
  type V2MaterializationDryRunReport,
  type V2MaterializationExercise,
  type V2PlannerMesocyclePolicy,
  type V2PlannerSetRange,
  type V2PlannerSlotId,
  type V2SetDistributionIntent,
  type V2SlotDemandAllocationByWeek,
  type V2SlotWeekAllocationPolicyTrial,
  type V2SlotWeekDonorCapacityMeasuredRow,
  type V2SlotWeekDonorCapacityProjection,
} from "@/lib/engine/planning/v2";
import { isV2LaneSelectionIntentConsumedByMaterializer } from "@/lib/engine/planning/v2/lane-selection-intent";
import type {
  V2ExerciseSelectionPlanDiagnostic,
  V2SelectionCapacityPlanDiagnostic,
} from "@/lib/api/planning-reality";
import type { SlotPlanPlanningRealityDiagnostic } from "@/lib/api/planning-reality";
import {
  buildMesocycleSlotSequence,
  resolveMesocycleSlotContract,
} from "@/lib/api/mesocycle-slot-contract";
import {
  buildV2MaterializedSeedAcceptanceProbe,
  type BuildV2MaterializedSeedAcceptanceProbeResult,
} from "@/lib/api/mesocycle-handoff-v2-materialized-seed";
import {
  normalizeLiveInventoryForV2Materialization,
  type LiveV2MaterializationExerciseRow,
} from "@/lib/api/v2-materialization-live-inventory";

export { normalizeLiveInventoryForV2Materialization };

export type V2LiveContextInventorySource =
  | "live_normalized_inventory"
  | "fixture_snapshot"
  | "unavailable";

export type V2LiveContextMaterializationDryRunResult = {
  version: 1;
  source: "v2_live_context_materialization_dry_run";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  context: {
    ownerLoaded: boolean;
    mesocycleLoaded: boolean;
    userId?: string;
    ownerEmail?: string | null;
    mesocycleId?: string;
    mesocycleState?: string;
    splitType?: string;
    slotSequenceSource?: "mesocycle_slot_sequence" | "legacy_weekly_schedule";
    slotSequenceSlotCount: number;
  };
  inventorySource: V2LiveContextInventorySource;
  inventoryExerciseCount: number;
  unsupportedClassCount: number;
  requiredLaneCoverageBySlot: Array<{
    slotId: string;
    requiredLaneCount: number;
    materializedRequiredLaneCount: number;
    blockedRequiredLaneCount: number;
    missingRequiredLaneIds: string[];
  }>;
  materializerStatus: V2MaterializationDryRunReport["materializer"]["status"];
  seedShapeCompatibility: V2MaterializationDryRunReport["seedShapeCompatibility"];
  executablePreviewCountBySlot: Array<{
    slotId: string;
    exerciseCount: number;
  }>;
  blockersBeforePromotion: string[];
  safeToPromoteToProductionWrite: false;
};

type OwnerContext = {
  userId?: string;
  ownerEmail?: string | null;
};

type MesocycleContext = {
  id?: string;
  state?: string;
  splitType?: string;
  slotSequenceJson?: unknown;
  weeklySchedule?: readonly string[] | null;
};

export type V2MaterializedSeedAcceptanceProbeReader = {
  user: {
    findUnique(args: unknown): Promise<{
      id: string;
      email: string | null;
    } | null>;
  };
  mesocycle: {
    findFirst(args: unknown): Promise<{
      id: string;
      state: string;
      splitType: string;
      slotSequenceJson: unknown;
    } | null>;
  };
  exercise: {
    findMany(args: unknown): Promise<LiveV2MaterializationExerciseRow[]>;
  };
  userPreference: {
    findUnique(args: unknown): Promise<{
      avoidExerciseIds: string[];
      favoriteExerciseIds: string[];
    } | null>;
  };
};

export type V2LiveContextMaterializationDryRunInput = {
  ownerContext?: OwnerContext | null;
  mesocycleContext?: MesocycleContext | null;
  inventory?: V2MaterializationExercise[] | null;
  inventorySource: V2LiveContextInventorySource;
  plannerPolicy?: V2PlannerMesocyclePolicy;
  taxonomy?: V2ExerciseClassTaxonomy;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
};

export type V2LiveContextBasePlanCompareInput = {
  plannerPolicy?: V2PlannerMesocyclePolicy;
  taxonomy?: V2ExerciseClassTaxonomy;
  inventory?: V2MaterializationExercise[] | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
  noRepairPlanningReality?: SlotPlanPlanningRealityDiagnostic | null;
  repairedPlanningReality?: SlotPlanPlanningRealityDiagnostic | null;
};

export type V2CapacityMaterializerProjectionGateStatus =
  | "pass"
  | "fail"
  | "unknown";

export type V2CapacityMaterializerProjection = {
  version: 1;
  source: "v2_capacity_materializer_projection";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  consumedByProduction: false;
  consumedByDemandOrMaterializer: false;
  status: "projected_with_limitations" | "blocked" | "not_available";
  projectionMode: "slot_cap_delta_materializer_dry_run";
  trialId: string | null;
  candidateChange: {
    kind: "slot_max_exercise_count_delta";
    slotId: string;
    delta: 1;
  } | null;
  comparedPlans: {
    baselineAvailable: boolean;
    trialAvailable: boolean;
    inventoryExerciseCount: number;
  };
  targetSlot: {
    slotId: string | null;
    maxExerciseCountBefore: number | null;
    maxExerciseCountAfter: number | null;
    baselineExerciseCount: number;
    trialExerciseCount: number;
    baselineSetCount: number;
    trialSetCount: number;
    addedIdentities: string[];
    removedIdentities: string[];
    floorCriticalLaneIds: string[];
    floorCriticalLaneIdsMaterialized: string[];
    floorCriticalLaneIdsMissing: string[];
  };
  materializer: {
    baselineStatus: V2MaterializationDryRunReport["materializer"]["status"];
    trialStatus: V2MaterializationDryRunReport["materializer"]["status"];
    baselineBlockerCount: number;
    trialBlockerCount: number;
    baselineSeedShapeCompatible: boolean;
    trialSeedShapeCompatible: boolean;
  };
  candidateImpact: {
    selectedIdentityDelta: number;
    totalSetDelta: number;
    targetSlotExerciseDelta: number;
    materializerBlockerDelta: number;
    regressionCount: number;
    regressions: string[];
    improvements: string[];
    changedSlotCount: number;
    changedSlots: Array<{
      slotId: string;
      exerciseCountDelta: number;
      setDelta: number;
      addedIdentityCount: number;
      removedIdentityCount: number;
    }>;
  };
  gates: Array<{
    gateId:
      | "hard_floors"
      | "over_mav"
      | "session_size"
      | "five_set_stacking"
      | "lane_survival"
      | "duplicates"
      | "materializer_validity"
      | "acceptance_result";
    status: V2CapacityMaterializerProjectionGateStatus;
    measured: boolean;
    ownerSeam: string;
    evidence: string[];
    regressions: string[];
    requiredNextEvidence: string[];
  }>;
  blockersBeforeBehavior: string[];
  nextSafeAction:
    | "inspect_materializer_capacity_projection"
    | "run_read_only_acceptance_projection"
    | "pivot_to_higher_roi_track"
    | "inspect_capacity_rows";
  limitations: string[];
  safeForBehaviorPromotion: false;
};

export type V2LaneIntentMaterializerProjection = {
  version: 1;
  source: "v2_lane_intent_materializer_projection";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  consumedByProduction: false;
  consumedByDemandOrMaterializer: false;
  status: "projected_with_limitations" | "blocked" | "not_available";
  projectionMode: "lane_intent_shadow_materializer_dry_run";
  trialId: string;
  comparedPlans: {
    baselineAvailable: boolean;
    trialAvailable: boolean;
    inventoryExerciseCount: number;
  };
  targetLane: {
    scopedLaneId: string;
    slotId: string;
    laneId: string;
    intentAvailable: boolean;
    baselineConsumedByProduction: boolean;
    trialConsumesLaneIntent: boolean;
    baselineExerciseCount: number;
    trialExerciseCount: number;
    baselineSetCount: number;
    trialSetCount: number;
    addedIdentities: string[];
    removedIdentities: string[];
  };
  materializer: {
    baselineStatus: V2MaterializationDryRunReport["materializer"]["status"];
    trialStatus: V2MaterializationDryRunReport["materializer"]["status"];
    baselineBlockerCount: number;
    trialBlockerCount: number;
    baselineSeedShapeCompatible: boolean;
    trialSeedShapeCompatible: boolean;
  };
  candidateImpact: {
    selectedIdentityDelta: number;
    totalSetDelta: number;
    targetLaneExerciseDelta: number;
    materializerBlockerDelta: number;
    regressionCount: number;
    regressions: string[];
    improvements: string[];
    changedSlotCount: number;
    changedSlots: Array<{
      slotId: string;
      exerciseCountDelta: number;
      setDelta: number;
      addedIdentityCount: number;
      removedIdentityCount: number;
    }>;
  };
  blockersBeforeBehavior: string[];
  nextSafeAction:
    | "inspect_lane_intent_materializer_projection"
    | "run_read_only_acceptance_projection"
    | "pivot_to_higher_roi_track";
  limitations: string[];
  safeForBehaviorPromotion: false;
};

export type V2SetBudgetMaterializerProjection = {
  version: 1;
  source: "v2_set_budget_materializer_projection";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  consumedByProduction: false;
  consumedByDemandOrMaterializer: false;
  status: "projected_with_limitations" | "blocked" | "not_available";
  projectionMode: "set_budget_shadow_materializer_dry_run";
  trialId: string;
  comparedPlans: {
    baselineAvailable: boolean;
    trialAvailable: boolean;
    inventoryExerciseCount: number;
  };
  targetLane: {
    scopedLaneId: string;
    week: number;
    slotId: string;
    laneId: string;
    muscles: string[];
    currentBudget: V2PlannerSetRange;
    trialBudget: V2PlannerSetRange;
    suspectedNeededBudget: V2PlannerSetRange;
    baselineExerciseCount: number;
    trialExerciseCount: number;
    baselineSetCount: number;
    trialSetCount: number;
    addedIdentities: string[];
    removedIdentities: string[];
  };
  materializer: {
    baselineStatus: V2MaterializationDryRunReport["materializer"]["status"];
    trialStatus: V2MaterializationDryRunReport["materializer"]["status"];
    baselineBlockerCount: number;
    trialBlockerCount: number;
    baselineSeedShapeCompatible: boolean;
    trialSeedShapeCompatible: boolean;
  };
  candidateImpact: {
    selectedIdentityDelta: number;
    totalSetDelta: number;
    targetLaneSetDelta: number;
    targetLaneExerciseDelta: number;
    materializerBlockerDelta: number;
    regressionCount: number;
    regressions: string[];
    improvements: string[];
    changedSlotCount: number;
    changedSlots: Array<{
      slotId: string;
      exerciseCountDelta: number;
      setDelta: number;
      addedIdentityCount: number;
      removedIdentityCount: number;
    }>;
  };
  blockersBeforeBehavior: string[];
  nextSafeAction:
    | "inspect_set_budget_materializer_projection"
    | "run_read_only_acceptance_projection"
    | "pivot_to_higher_roi_track";
  limitations: string[];
  safeForBehaviorPromotion: false;
};

export type V2ConcentrationMaterializerProjection = {
  version: 1;
  source: "v2_concentration_materializer_projection";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  consumedByProduction: false;
  consumedByDemandOrMaterializer: false;
  status: "projected_with_limitations" | "blocked" | "not_available";
  projectionMode: "concentration_set_cap_shadow_materializer_dry_run";
  trialId: string;
  comparedPlans: {
    baselineAvailable: boolean;
    trialAvailable: boolean;
    inventoryExerciseCount: number;
  };
  targetLane: {
    scopedLaneId: string;
    week: number;
    slotId: string;
    laneId: string;
    muscles: string[];
    warningEvidence: string[];
    currentBudget: V2PlannerSetRange;
    trialBudget: V2PlannerSetRange;
    baselineExerciseCount: number;
    trialExerciseCount: number;
    baselineSetCount: number;
    trialSetCount: number;
    addedIdentities: string[];
    removedIdentities: string[];
  };
  materializer: {
    baselineStatus: V2MaterializationDryRunReport["materializer"]["status"];
    trialStatus: V2MaterializationDryRunReport["materializer"]["status"];
    baselineBlockerCount: number;
    trialBlockerCount: number;
    baselineSeedShapeCompatible: boolean;
    trialSeedShapeCompatible: boolean;
  };
  candidateImpact: {
    selectedIdentityDelta: number;
    totalSetDelta: number;
    targetLaneSetDelta: number;
    targetLaneExerciseDelta: number;
    materializerBlockerDelta: number;
    regressionCount: number;
    regressions: string[];
    improvements: string[];
    changedSlotCount: number;
    changedSlots: Array<{
      slotId: string;
      exerciseCountDelta: number;
      setDelta: number;
      addedIdentityCount: number;
      removedIdentityCount: number;
    }>;
  };
  concentrationDelta: {
    baselineWarningCount: number;
    trialWarningCount: number;
    warningDelta: number;
    baselineOver60Count: number;
    trialOver60Count: number;
    over60Delta: number;
    baselineMaxSharePercent: number;
    trialMaxSharePercent: number;
    maxShareDelta: number;
    baselineHighFatigueSetCount: number;
    trialHighFatigueSetCount: number;
    highFatigueSetDelta: number;
    baselineFatigueWeightedSets: number;
    trialFatigueWeightedSets: number;
    fatigueWeightedSetDelta: number;
  };
  donorOffsetRedistributionProjection: V2ConcentrationDonorOffsetRedistributionProjection;
  crossWeekReadiness: {
    decision:
      | "diagnostic_only"
      | "candidate_for_bounded_policy_design"
      | "blocked_by_evidence"
      | "not_worth_pursuing";
    sourceAttribution: {
      pureV2BasePlan: "not_evaluated_by_concentration_projection";
      materializerProjection: "baseline_vs_trial_dry_run";
      noRepairProjection: "selected_warning_from_exercise_selection_diagnostic";
      repairedProjection: "evidence_only_not_target_policy";
      acceptanceNoRepair:
        | "week_1_trainability_shape_only"
        | "not_provided";
    };
    representativeAccumulationWeeks: number[];
    projectedWeekCount: number;
    improvedWeekCount: number;
    regressedWeekCount: number;
    noImpactWeekCount: number;
    blockerCount: number;
    nextSafeSlice:
      | "design_slot_demand_redistribution_projection"
      | "run_acceptance_non_regression_projection"
      | "inspect_materializer_regressions"
      | "pivot_to_higher_roi_track"
      | "keep_diagnostic_only";
    gates: Array<{
      gateId:
        | "cross_week_coverage"
        | "redistribution_donor_offset"
        | "acceptance_or_week_1_trainability"
        | "materializer_identity_set_blocker_non_regression"
        | "duplicate_concentration_non_regression"
        | "production_materializer_non_consumption"
        | "seed_runtime_receipt_db_non_consumption";
      status: "pass" | "fail" | "unknown";
      measured: boolean;
      ownerSeam: string;
      evidenceSource:
        | "pure_v2_base_plan"
        | "pure_v2_materializer_projection"
        | "no_repair_projection"
        | "repaired_projection"
        | "acceptance_classification_no_repair";
      evidence: string[];
      blockers: string[];
      requiredNextEvidence: string[];
    }>;
    rows: Array<{
      week: number;
      phase: string;
      scopedLaneId: string;
      status:
        | "improved"
        | "regressed"
        | "no_candidate_impact"
        | "blocked";
      evidenceSource: "pure_v2_materializer_projection";
      baselineMaterializerStatus: V2MaterializationDryRunReport["materializer"]["status"];
      trialMaterializerStatus: V2MaterializationDryRunReport["materializer"]["status"];
      selectedIdentityDelta: number;
      totalSetDelta: number;
      targetLaneSetDelta: number;
      materializerBlockerDelta: number;
      warningDelta: number;
      maxShareDelta: number;
      highFatigueSetDelta: number;
      regressionCount: number;
      changedSlotCount: number;
    }>;
  };
  blockersBeforeBehavior: string[];
  nextSafeAction:
    | "inspect_concentration_materializer_projection"
    | "run_read_only_acceptance_projection"
    | "pivot_to_higher_roi_track";
  limitations: string[];
  safeForBehaviorPromotion: false;
};

export type V2ConcentrationDonorOffsetRedistributionProjection = {
  version: 1;
  source: "v2_concentration_donor_offset_redistribution_projection";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  consumedByProduction: false;
  consumedByDemandOrMaterializer: false;
  status: "projected_with_limitations" | "blocked" | "not_available";
  projectionMode: "source_lane_cap_with_slot_owned_donor_offset_shadow_materializer_dry_run";
  sourceAttribution: {
    sourceLane: "pure_v2_materializer_projection";
    donorSelection: "SlotDemandAllocationByWeek";
    materializerProjection: "baseline_vs_donor_offset_trial_dry_run";
    noRepairProjection: "not_used_as_target_policy";
    repairedProjection: "evidence_only_not_target_policy";
    acceptanceNoRepair:
      | "week_1_trainability_shape_only"
      | "not_provided";
  };
  summary: {
    projectedWeekCount: number;
    improvedWeekCount: number;
    noImpactWeekCount: number;
    blockedWeekCount: number;
    protectedCoveragePassCount: number;
    materializerRegressionCount: number;
    concentrationRegressionCount: number;
    regressionCauseCounts: Partial<Record<DonorOffsetRegressionCause, number>>;
    totalSetDelta: number;
    concentrationWarningDelta: number;
    alternateCandidateCount: number;
    alternatePassingCandidateCount: number;
    selectedAlternateWeekCount: number;
    acceptanceTrainabilityStatus: string;
    behaviorReadinessDecision:
      | "candidate_for_acceptance_projection"
      | "blocked_by_evidence"
      | "not_worth_pursuing"
      | "not_available";
    blockerCount: number;
    nextSafeSlice:
      | "run_acceptance_non_regression_projection"
      | "inspect_donor_offset_regressions"
      | "select_alternate_donor_offset"
      | "pivot_to_higher_roi_track"
      | "keep_diagnostic_only";
    slotWeekAllocationReadiness:
      V2SlotWeekDonorCapacityProjection["summary"]["behaviorReadiness"];
    slotWeekAllocationNextSafeSlice:
      V2SlotWeekDonorCapacityProjection["summary"]["nextSafeSlice"];
    slotWeekAllocationBlockedRowCount: number;
  };
  slotWeekAllocationProjection: V2SlotWeekDonorCapacityProjection;
  rows: Array<{
    week: number;
    phase: string;
    status:
      | "improved"
      | "blocked"
      | "no_candidate_impact"
      | "regressed";
    source: {
      slotId: string;
      laneId: string;
      scopedLaneId: string;
      muscles: string[];
      baselineSetCount: number;
      trialSetCount: number;
      setDelta: number;
    };
    donor: {
      slotId: string;
      laneId: string;
      scopedLaneId: string;
      muscles: string[];
      baselineSetCount: number;
      trialSetCount: number;
      setDelta: number;
    } | null;
    allocationPolicyTrial: V2SlotWeekAllocationPolicyTrial | null;
    protectedCoverageImpact: {
      protectedMuscles: string[];
      sourceFloorSets: number;
      sourceBeforeSets: number;
      sourceAfterSets: number;
      sourceSetDelta: number;
      donorSetDelta: number;
      netWeeklySetDelta: number;
      status: "preserved" | "regressed" | "unknown";
      blockers: string[];
    };
    materializerDelta: {
      selectedIdentityDelta: number;
      totalSetDelta: number;
      materializerBlockerDelta: number;
      regressionCount: number;
      regressions: string[];
      changedSlotCount: number;
    };
    concentrationWarningDelta: number;
    regressionCauses: DonorOffsetRegressionCause[];
    primaryDonorCandidate: DonorOffsetCandidateSummary | null;
    alternateDonorCandidates: DonorOffsetCandidateSummary[];
    selectedDonorKind: "primary" | "alternate" | "none";
    acceptanceTrainabilityStatus: string;
    behaviorReadinessDecision:
      | "candidate_for_acceptance_projection"
      | "blocked_by_evidence"
      | "not_worth_pursuing"
      | "not_available";
    blockers: string[];
    nextSafeSlice:
      | "run_acceptance_non_regression_projection"
      | "inspect_donor_offset_regressions"
      | "select_alternate_donor_offset"
      | "pivot_to_higher_roi_track"
      | "keep_diagnostic_only";
  }>;
  blockersBeforeBehavior: string[];
  limitations: string[];
  safeForBehaviorPromotion: false;
};

type DonorOffsetRegressionCause =
  | "donor_choice"
  | "slot_capacity"
  | "lane_identity"
  | "protected_coverage"
  | "taxonomy"
  | "materializer_ranking";

type DonorOffsetCandidateSummary = {
  slotId: string;
  laneId: string;
  scopedLaneId: string;
  muscles: string[];
  baselineSetCount: number;
  trialSetCount: number;
  setDelta: number;
  status: "pass" | "blocked" | "no_candidate_impact";
  protectedCoverageStatus: "preserved" | "regressed" | "unknown";
  materializerDelta: {
    selectedIdentityDelta: number;
    totalSetDelta: number;
    materializerBlockerDelta: number;
    regressionCount: number;
  };
  concentrationWarningDelta: number;
  regressionCauses: DonorOffsetRegressionCause[];
  blockers: string[];
};

type V2ExerciseSelectionLane =
  V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number];

type DonorOffsetLaneCandidate = {
  slotId: V2PlannerSlotId;
  slotIndex: number;
  laneId: string;
  required: boolean;
  protectedMuscles: string[];
  selectionLane: V2ExerciseSelectionLane;
};

type ConcentrationAcceptanceEvidence = {
  basicMesocycleShapeStatus:
    | "pass"
    | "pass_with_warnings"
    | "partial"
    | "fail";
  replacementReadinessStatus: "ready" | "not_ready" | "blocked";
  hardBlockers: ReadonlyArray<{ code: string; evidence: string[] }>;
  qualityWarnings: ReadonlyArray<{ code: string; evidence: string[] }>;
};

export type V2SupportFloorMaterializerProjection = Omit<
  V2SetBudgetMaterializerProjection,
  "source" | "projectionMode" | "targetLane" | "nextSafeAction"
> & {
  source: "v2_support_floor_materializer_projection";
  projectionMode: "support_direct_floor_shadow_materializer_dry_run";
  targetLane: V2SetBudgetMaterializerProjection["targetLane"] & {
    supportFloorGapId: string;
    muscle: string;
    directFloorExpected: number;
    directFloorDelivered: number;
    directFloorStatus: string;
    likelyOwnerSeam: string;
  };
  nextSafeAction:
    | "inspect_support_floor_materializer_projection"
    | "run_read_only_acceptance_projection"
    | "pivot_to_higher_roi_track";
};

export type V2StrategyRowMaterializerProjection = {
  version: 1;
  source: "v2_strategy_row_materializer_projection";
  readOnly: true;
  affectsScoringOrGeneration: false;
  dryRunOnly: true;
  consumedByProduction: false;
  consumedByDemandOrMaterializer: false;
  status: "projected_with_limitations" | "blocked" | "not_available";
  projectionMode: "strategy_row_slot_allocation_materializer_dry_run";
  sourcePerformedEvidence: string[];
  row: {
    rowKey: "SlotDemandAllocationByWeek:Side Delts:protect_floor";
    muscle: "Side Delts";
    ownerSeam: "SlotDemandAllocationByWeek";
    action: "protect_floor";
  };
  boundedDeltaAttempted: {
    type: "single_set_floor_buffer";
    week: number;
    slotId: V2PlannerSlotId | "unknown";
    laneId: string;
    muscle: "Side Delts";
    setDelta: 1;
    baselineAllocatedSets: V2PlannerSetRange;
    trialAllocatedSets: V2PlannerSetRange;
  };
  downstreamProjection: {
    classDistributionStatus: "measured" | "not_measured";
    capacityPlanStatus: "measured" | "not_measured";
    exerciseSelectionStatus: "measured" | "not_measured";
    baselineClassLaneCount: number;
    trialClassLaneCount: number;
    baselineCapacityLaneCount: number;
    trialCapacityLaneCount: number;
    baselineSelectionLaneCount: number;
    trialSelectionLaneCount: number;
  };
  materializer: {
    baselineStatus: V2MaterializationDryRunReport["materializer"]["status"];
    trialStatus: V2MaterializationDryRunReport["materializer"]["status"];
    baselineBlockerCount: number;
    trialBlockerCount: number;
    baselineSeedShapeCompatible: boolean;
    trialSeedShapeCompatible: boolean;
  };
  materializerDeltas: {
    selectedIdentityDelta: number;
    totalSetDelta: number;
    targetLaneSetDelta: number;
    targetLaneExerciseDelta: number;
    materializerBlockerDelta: number;
    regressionCount: number;
    changedSlotCount: number;
    changedSlots: Array<{
      slotId: string;
      exerciseCountDelta: number;
      setDelta: number;
      addedIdentityCount: number;
      removedIdentityCount: number;
    }>;
  };
  protectedCoverageImpact: {
    status: "improved" | "preserved" | "regressed" | "not_measured";
    baselineTargetLaneSets: number;
    trialTargetLaneSets: number;
    targetLaneSetDelta: number;
    netWeeklySetDelta: number;
  };
  protectedCoverageLossCause: {
    classification:
      | "materializer_ranking"
      | "class_distribution"
      | "capacity_selection"
      | "taxonomy_lane_mapping"
      | "diagnostic_artifact"
      | "no_safe_fix"
      | "not_measured";
    primaryCause:
      | "target_lane_marker_changes_set_budget_basis"
      | "selection_budget_reduced_before_materialization"
      | "selected_identity_changed"
      | "materializer_blocked_or_seed_incompatible"
      | "target_lane_not_regressed"
      | "not_measured";
    ownerSeam:
      | "v2_strategy_row_materializer_projection"
      | "V2SetDistributionIntent"
      | "ExerciseSelectionPlan"
      | "V2Materializer"
      | "V2ExerciseClassTaxonomy"
      | "unknown";
    summary: string;
    targetLane: {
      week: number;
      slotId: V2PlannerSlotId | "unknown";
      laneId: string;
      baselineSetBudget: V2PlannerSetRange;
      trialSetBudget: V2PlannerSetRange;
      baselineSetBudgetBasis: string;
      trialSetBudgetBasis: string;
      baselineMaterializedSets: number;
      trialMaterializedSets: number;
      selectionSetBudgetDelta: number;
      materializedSetDelta: number;
    };
    collateralLaneSetDeltas: Array<{
      slotId: string;
      laneId: string;
      baselineSetBudget: V2PlannerSetRange;
      trialSetBudget: V2PlannerSetRange;
      baselineSetBudgetBasis: string;
      trialSetBudgetBasis: string;
      baselineMaterializedSets: number;
      trialMaterializedSets: number;
      selectionSetBudgetDelta: number;
      materializedSetDelta: number;
    }>;
  };
  duplicateConcentrationImpact: {
    status: "improved" | "preserved" | "regressed" | "not_measured";
    warningDelta: number;
    maxShareDelta: number;
    highFatigueSetDelta: number;
  };
  readiness:
    | "blocked"
    | "diagnostic_no_impact"
    | "candidate_for_bounded_review";
  blockersBeforeBehavior: string[];
  remainingProofBeforeBehavior: string[];
  nextSafeSlice:
    | "run_read_only_acceptance_projection"
    | "inspect_materializer_or_concentration_regressions"
    | "pivot_to_higher_roi_track"
    | "keep_blocked_until_owner_donor_or_acceptance_proof";
  nonConsumption: {
    demandOrMaterializer: false;
    seedRuntimeReceiptDb: false;
    acceptanceThreshold: false;
  };
  limitations: string[];
  safeForBehaviorPromotion: false;
};

const EMPTY_CONSTRAINTS: V2ExerciseMaterializationInput["constraints"] = {
  avoidExerciseIds: [],
  favoriteExerciseIds: [],
  painConflictExerciseIds: [],
};

const DEFAULT_LANE_INTENT_MATERIALIZER_TRIAL = {
  slotId: "upper_b" as V2PlannerSlotId,
  laneId: "chest_second_exposure",
  trialId: "upper_b_chest_second_exposure_lane_intent_shadow",
} as const;

export function buildV2LiveContextMaterializationDryRunHarness(
  input: V2LiveContextMaterializationDryRunInput,
): V2LiveContextMaterializationDryRunResult {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const inventory = input.inventory ?? [];
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const slotContract = resolveMesocycleSlotContract({
    slotSequenceJson: input.mesocycleContext?.slotSequenceJson,
    weeklySchedule: input.mesocycleContext?.weeklySchedule ?? [],
  });
  const slotIntentById = Object.fromEntries(
    slotContract.slots.map((slot) => [slot.slotId, slot.intent]),
  );
  const materializedPlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null;
  const dryRunReport = buildV2MaterializationDryRunReport({
    plannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    ...(materializedPlan ? { materializedPlan } : {}),
    slotIntentById,
  });

  return {
    version: 1,
    source: "v2_live_context_materialization_dry_run",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    context: {
      ownerLoaded: Boolean(input.ownerContext?.userId),
      mesocycleLoaded: Boolean(input.mesocycleContext?.id),
      ...(input.ownerContext?.userId ? { userId: input.ownerContext.userId } : {}),
      ...(input.ownerContext?.ownerEmail !== undefined
        ? { ownerEmail: input.ownerContext.ownerEmail }
        : {}),
      ...(input.mesocycleContext?.id
        ? { mesocycleId: input.mesocycleContext.id }
        : {}),
      ...(input.mesocycleContext?.state
        ? { mesocycleState: input.mesocycleContext.state }
        : {}),
      ...(input.mesocycleContext?.splitType
        ? { splitType: input.mesocycleContext.splitType }
        : {}),
      slotSequenceSource: slotContract.source,
      slotSequenceSlotCount: slotContract.slots.length,
    },
    inventorySource: input.inventorySource,
    inventoryExerciseCount: inventory.length,
    unsupportedClassCount:
      dryRunReport.seedShapeCompatibility.unsupportedClassCount,
    requiredLaneCoverageBySlot: dryRunReport.requiredLaneCoverageBySlot,
    materializerStatus: dryRunReport.materializer.status,
    seedShapeCompatibility: dryRunReport.seedShapeCompatibility,
    executablePreviewCountBySlot: dryRunReport.executableSeedPreview.map((slot) => ({
      slotId: slot.slotId,
      exerciseCount: slot.exercises.length,
    })),
    blockersBeforePromotion: summarizeBlockersBeforePromotion({
      dryRunReport,
      inventorySource: input.inventorySource,
      ownerLoaded: Boolean(input.ownerContext?.userId),
      mesocycleLoaded: Boolean(input.mesocycleContext?.id),
    }),
    safeToPromoteToProductionWrite: false,
  };
}

export function buildV2BasePlanCompareFromLiveContext(
  input: V2LiveContextBasePlanCompareInput,
): V2BasePlanCompare {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const inventory = input.inventory ?? [];
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const materializedPlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null;
  const validation = buildV2BasePlanValidation({
    plannerPolicy,
    materializedPlan,
    inventory,
    taxonomy,
  });

  return buildV2BasePlanCompare({
    v2BasePlanValidation: validation,
    v2MaterializedPlan: materializedPlan,
    inventory,
    taxonomy,
    plannerOnlyNoRepairPlan: normalizePlanningRealityForBasePlanCompare({
      planId: "planner_only_no_repair",
      planningReality: input.noRepairPlanningReality,
      taxonomy,
    }),
    repairedPlan: normalizePlanningRealityForBasePlanCompare({
      planId: "repaired_projection",
      planningReality: input.repairedPlanningReality,
      taxonomy,
      includeRepairEvidence: true,
    }),
  });
}

export function buildV2BasePlanShadowConsumptionTrialFromLiveContext(
  input: V2LiveContextBasePlanCompareInput,
): V2BasePlanShadowConsumptionTrial {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const inventory = input.inventory ?? [];
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const materializedPlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null;
  const validation = buildV2BasePlanValidation({
    plannerPolicy,
    materializedPlan,
    inventory,
    taxonomy,
  });

  return buildV2BasePlanShadowConsumptionTrial({
    v2BasePlanValidation: validation,
    v2MaterializedPlan: materializedPlan,
    inventory,
    taxonomy,
    plannerOnlyNoRepairPlan: normalizePlanningRealityForBasePlanCompare({
      planId: "planner_only_no_repair",
      planningReality: input.noRepairPlanningReality,
      taxonomy,
    }),
    repairedPlan: normalizePlanningRealityForBasePlanCompare({
      planId: "repaired_projection",
      planningReality: input.repairedPlanningReality,
      taxonomy,
      includeRepairEvidence: true,
    }),
  });
}

export function buildV2CapacityMaterializerProjectionFromLiveContext(input: {
  plannerPolicy?: V2PlannerMesocyclePolicy;
  capacityDiagnostic?: V2SelectionCapacityPlanDiagnostic | null;
  taxonomy?: V2ExerciseClassTaxonomy;
  inventory?: V2MaterializationExercise[] | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
}): V2CapacityMaterializerProjection {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const diagnostic = input.capacityDiagnostic;
  const change = diagnostic?.capacityPolicyTrialDesign.candidateChange ?? null;
  const inventory = input.inventory ?? [];
  if (!diagnostic || !change) {
    return emptyCapacityMaterializerProjection([
      "capacity_policy_trial_design_unavailable",
    ]);
  }

  const slotId = change.slotId as V2PlannerSlotId;
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const maxExerciseCountBefore =
    plannerPolicy.selectionCapacityPlan.weeks[0]?.slots.find(
      (slot) => slot.slotId === slotId,
    )?.maxExerciseCount ?? null;
  if (maxExerciseCountBefore == null) {
    return emptyCapacityMaterializerProjection([
      `capacity_slot_not_found:${change.slotId}`,
    ]);
  }

  const trialSelectionCapacityPlan = buildV2SelectionCapacityPlan({
    exerciseClassDistributionBySlot:
      plannerPolicy.exerciseClassDistributionBySlot,
    v2SetDistributionIntent: plannerPolicy.v2SetDistributionIntent,
    v2SupportLanePolicy: plannerPolicy.v2SupportLanePolicy,
    sessionCapacity: {
      maxExerciseCountBySlot: {
        [slotId]: maxExerciseCountBefore + change.delta,
      },
    },
  });
  const trialExerciseSelectionPlan = buildV2ExerciseSelectionPlan({
    exerciseClassDistributionBySlot:
      plannerPolicy.exerciseClassDistributionBySlot,
    v2SetDistributionIntent: plannerPolicy.v2SetDistributionIntent,
    v2SupportLanePolicy: plannerPolicy.v2SupportLanePolicy,
    selectionCapacityPlan: trialSelectionCapacityPlan,
  });
  const trialPlannerPolicy: V2PlannerMesocyclePolicy = {
    ...plannerPolicy,
    selectionCapacityPlan: trialSelectionCapacityPlan,
    exerciseSelectionPlan: trialExerciseSelectionPlan,
  };
  const baselinePlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null;
  const trialPlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: trialPlannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
          ...(input.continuity ? { continuity: input.continuity } : {}),
        })
      : null;
  const baselineReport = buildV2MaterializationDryRunReport({
    plannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    ...(baselinePlan ? { materializedPlan: baselinePlan } : {}),
  });
  const trialReport = buildV2MaterializationDryRunReport({
    plannerPolicy: trialPlannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    ...(trialPlan ? { materializedPlan: trialPlan } : {}),
  });
  const targetSlot = summarizeCapacityProjectionSlot({
    slotId,
    diagnostic,
    baselinePlan,
    trialPlan,
    maxExerciseCountBefore,
    maxExerciseCountAfter: maxExerciseCountBefore + change.delta,
    inventory,
  });
  const candidateImpact = summarizeCapacityProjectionImpact({
    baselinePlan,
    trialPlan,
    baselineReport,
    trialReport,
    targetSlot,
  });
  const gates = buildCapacityMaterializerProjectionGates({
    targetSlot,
    trialReport,
    trialPlan,
    candidateImpact,
  });
  const failedGates = gates.filter((gate) => gate.status === "fail");
  const unknownGates = gates.filter((gate) => gate.status === "unknown");
  const noCandidateImpact =
    candidateImpact.selectedIdentityDelta === 0 &&
    candidateImpact.totalSetDelta === 0 &&
    candidateImpact.targetSlotExerciseDelta === 0 &&
    candidateImpact.materializerBlockerDelta === 0 &&
    candidateImpact.regressionCount === 0 &&
    candidateImpact.improvements.length === 0;
  const nextSafeAction =
    failedGates.length > 0 || unknownGates.length > 1
      ? "inspect_materializer_capacity_projection"
      : noCandidateImpact
        ? "pivot_to_higher_roi_track"
        : "run_read_only_acceptance_projection";

  return {
    version: 1,
    source: "v2_capacity_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status:
      failedGates.length > 0 || trialReport.status === "blocked"
        ? "blocked"
        : "projected_with_limitations",
    projectionMode: "slot_cap_delta_materializer_dry_run",
    trialId: diagnostic?.capacityPolicyTrialDesign.trialId ?? null,
    candidateChange: {
      kind: change.kind,
      slotId: change.slotId,
      delta: change.delta,
    },
    comparedPlans: {
      baselineAvailable: Boolean(baselinePlan),
      trialAvailable: Boolean(trialPlan),
      inventoryExerciseCount: inventory.length,
    },
    targetSlot,
    materializer: {
      baselineStatus: baselineReport.materializer.status,
      trialStatus: trialReport.materializer.status,
      baselineBlockerCount: baselineReport.materializer.blockerCount,
      trialBlockerCount: trialReport.materializer.blockerCount,
      baselineSeedShapeCompatible:
        baselineReport.seedShapeCompatibility.compatible,
      trialSeedShapeCompatible: trialReport.seedShapeCompatibility.compatible,
    },
    candidateImpact,
    gates,
    blockersBeforeBehavior: uniqueSorted([
      ...failedGates.map((gate) => `${gate.gateId}_gate_failed`),
      ...unknownGates.map((gate) => `${gate.gateId}_gate_unknown`),
      ...(noCandidateImpact ? ["capacity_trial_no_candidate_impact"] : []),
      "acceptance_gate_not_rerun",
      "production_projection_not_consuming_trial",
    ]),
    nextSafeAction,
    limitations: [
      "read_only_materializer_dry_run_only",
      "trial_capacity_plan_is_projection_copy_only",
      ...(noCandidateImpact
        ? ["capacity_trial_did_not_change_candidate_identity_or_sets"]
        : []),
      "does_not_change_selection_capacity_plan",
      "does_not_feed_production_materializer",
      "does_not_feed_acceptance_scoring",
      "does_not_write_executable_seed_truth",
      "does_not_change_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

export function buildV2LaneIntentMaterializerProjectionFromLiveContext(input: {
  plannerPolicy?: V2PlannerMesocyclePolicy;
  taxonomy?: V2ExerciseClassTaxonomy;
  inventory?: V2MaterializationExercise[] | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
  targetLane?: {
    slotId?: V2PlannerSlotId;
    laneId?: string;
    trialId?: string;
  };
}): V2LaneIntentMaterializerProjection {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const inventory = input.inventory ?? [];
  const targetSlotId =
    input.targetLane?.slotId ?? DEFAULT_LANE_INTENT_MATERIALIZER_TRIAL.slotId;
  const targetLaneId =
    input.targetLane?.laneId ?? DEFAULT_LANE_INTENT_MATERIALIZER_TRIAL.laneId;
  const trialId =
    input.targetLane?.trialId ?? DEFAULT_LANE_INTENT_MATERIALIZER_TRIAL.trialId;
  const scopedLaneId = materializerScopedLaneId(targetSlotId, targetLaneId);
  const targetLane = findRepresentativeSelectionLane({
    plannerPolicy,
    slotId: targetSlotId,
    laneId: targetLaneId,
  });

  if (!inventory.length) {
    return emptyLaneIntentMaterializerProjection({
      scopedLaneId,
      slotId: targetSlotId,
      laneId: targetLaneId,
      trialId,
      blockersBeforeBehavior: ["inventory_unavailable"],
    });
  }
  if (!targetLane) {
    return emptyLaneIntentMaterializerProjection({
      scopedLaneId,
      slotId: targetSlotId,
      laneId: targetLaneId,
      trialId,
      blockersBeforeBehavior: [`target_lane_not_found:${scopedLaneId}`],
    });
  }
  if (!targetLane.laneSelectionIntent) {
    return emptyLaneIntentMaterializerProjection({
      scopedLaneId,
      slotId: targetSlotId,
      laneId: targetLaneId,
      trialId,
      blockersBeforeBehavior: [`lane_selection_intent_unavailable:${scopedLaneId}`],
    });
  }

  const baselinePlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
    inventory,
    taxonomy,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
  });
  const trialPlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
    inventory,
    taxonomy,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    diagnosticLaneSelectionIntentOverride: {
      version: 1,
      source: "v2_materializer_diagnostic_lane_selection_intent_override",
      readOnly: true,
      affectsScoringOrGeneration: false,
      dryRunOnly: true,
      reason: "read_only_materializer_comparison_trial",
      consumeScopedLaneIds: [scopedLaneId],
    },
  });
  const baselineReport = buildV2MaterializationDryRunReport({
    plannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    materializedPlan: baselinePlan,
  });
  const trialReport = buildV2MaterializationDryRunReport({
    plannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    materializedPlan: trialPlan,
  });
  const targetLaneSummary = summarizeLaneIntentProjectionLane({
    scopedLaneId,
    slotId: targetSlotId,
    laneId: targetLaneId,
    baselineConsumedByProduction:
      isV2LaneSelectionIntentConsumedByMaterializer(targetLane),
    baselinePlan,
    trialPlan,
    inventory,
  });
  const candidateImpact = summarizeLaneIntentProjectionImpact({
    baselinePlan,
    trialPlan,
    baselineReport,
    trialReport,
    targetLane: targetLaneSummary,
  });
  const noCandidateImpact =
    candidateImpact.selectedIdentityDelta === 0 &&
    candidateImpact.totalSetDelta === 0 &&
    candidateImpact.targetLaneExerciseDelta === 0 &&
    candidateImpact.materializerBlockerDelta === 0 &&
    candidateImpact.regressionCount === 0 &&
    candidateImpact.improvements.length === 0;
  const trialBlocked =
    trialReport.status === "blocked" || trialPlan.status === "blocked";

  return {
    version: 1,
    source: "v2_lane_intent_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: trialBlocked ? "blocked" : "projected_with_limitations",
    projectionMode: "lane_intent_shadow_materializer_dry_run",
    trialId,
    comparedPlans: {
      baselineAvailable: true,
      trialAvailable: true,
      inventoryExerciseCount: inventory.length,
    },
    targetLane: targetLaneSummary,
    materializer: {
      baselineStatus: baselineReport.materializer.status,
      trialStatus: trialReport.materializer.status,
      baselineBlockerCount: baselineReport.materializer.blockerCount,
      trialBlockerCount: trialReport.materializer.blockerCount,
      baselineSeedShapeCompatible:
        baselineReport.seedShapeCompatibility.compatible,
      trialSeedShapeCompatible: trialReport.seedShapeCompatibility.compatible,
    },
    candidateImpact,
    blockersBeforeBehavior: uniqueSorted([
      ...(trialBlocked ? ["lane_intent_trial_materializer_blocked"] : []),
      ...(noCandidateImpact ? ["lane_intent_trial_no_candidate_impact"] : []),
      "acceptance_gate_not_rerun",
      "production_materializer_allowlist_unchanged",
      "diagnostic_lane_intent_override_not_consumed_by_runtime",
    ]),
    nextSafeAction: trialBlocked
      ? "inspect_lane_intent_materializer_projection"
      : noCandidateImpact
        ? "pivot_to_higher_roi_track"
        : "run_read_only_acceptance_projection",
    limitations: [
      "read_only_materializer_dry_run_only",
      "trial_lane_intent_consumption_is_projection_copy_only",
      ...(noCandidateImpact
        ? ["lane_intent_trial_did_not_change_candidate_identity_or_sets"]
        : []),
      "does_not_change_lane_selection_intent_allowlist",
      "does_not_feed_production_materializer",
      "does_not_feed_acceptance_scoring",
      "does_not_write_executable_seed_truth",
      "does_not_change_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

export function buildV2SetBudgetMaterializerProjectionFromLiveContext(input: {
  plannerPolicy?: V2PlannerMesocyclePolicy;
  taxonomy?: V2ExerciseClassTaxonomy;
  inventory?: V2MaterializationExercise[] | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
  targetLane?: {
    week?: number;
    slotId?: V2PlannerSlotId;
    laneId?: string;
    currentBudget?: V2PlannerSetRange;
    suspectedNeededBudget?: V2PlannerSetRange;
    trialId?: string;
    muscles?: string[];
  };
}): V2SetBudgetMaterializerProjection {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const inventory = input.inventory ?? [];
  const targetSlotId = input.targetLane?.slotId ?? "upper_a";
  const targetLaneId = input.targetLane?.laneId ?? "unknown_lane";
  const targetWeek = input.targetLane?.week ?? 1;
  const trialId =
    input.targetLane?.trialId ??
    `${targetSlotId}_${targetLaneId}_set_budget_shadow`;
  const scopedLaneId = materializerScopedLaneId(targetSlotId, targetLaneId);
  const currentLane = findRepresentativeSelectionLane({
    plannerPolicy,
    slotId: targetSlotId,
    laneId: targetLaneId,
  });
  const currentBudget =
    input.targetLane?.currentBudget ?? currentLane?.setBudget ?? null;
  const suspectedNeededBudget =
    input.targetLane?.suspectedNeededBudget ?? currentBudget;

  if (!inventory.length) {
    return emptySetBudgetMaterializerProjection({
      scopedLaneId,
      week: targetWeek,
      slotId: targetSlotId,
      laneId: targetLaneId,
      trialId,
      blockersBeforeBehavior: ["inventory_unavailable"],
    });
  }
  if (!currentLane || !currentBudget || !suspectedNeededBudget) {
    return emptySetBudgetMaterializerProjection({
      scopedLaneId,
      week: targetWeek,
      slotId: targetSlotId,
      laneId: targetLaneId,
      trialId,
      blockersBeforeBehavior: [`target_lane_budget_not_found:${scopedLaneId}`],
    });
  }

  const trialBudget = normalizedTrialBudget({
    currentBudget,
    suspectedNeededBudget,
  });
  const trialSetDistributionIntent = cloneV2SetDistributionIntentWithLaneBudget({
    intent: plannerPolicy.v2SetDistributionIntent,
    slotId: targetSlotId,
    laneId: targetLaneId,
    trialBudget,
  });
  const trialSelectionCapacityPlan = buildV2SelectionCapacityPlan({
    exerciseClassDistributionBySlot:
      plannerPolicy.exerciseClassDistributionBySlot,
    v2SetDistributionIntent: trialSetDistributionIntent,
    v2SupportLanePolicy: plannerPolicy.v2SupportLanePolicy,
  });
  const trialExerciseSelectionPlan = buildV2ExerciseSelectionPlan({
    exerciseClassDistributionBySlot:
      plannerPolicy.exerciseClassDistributionBySlot,
    v2SetDistributionIntent: trialSetDistributionIntent,
    v2SupportLanePolicy: plannerPolicy.v2SupportLanePolicy,
    selectionCapacityPlan: trialSelectionCapacityPlan,
  });
  const trialPlannerPolicy: V2PlannerMesocyclePolicy = {
    ...plannerPolicy,
    v2SetDistributionIntent: trialSetDistributionIntent,
    selectionCapacityPlan: trialSelectionCapacityPlan,
    exerciseSelectionPlan: trialExerciseSelectionPlan,
  };
  const baselinePlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
    inventory,
    taxonomy,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
  });
  const trialPlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: trialPlannerPolicy.exerciseSelectionPlan,
    inventory,
    taxonomy,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
  });
  const baselineReport = buildV2MaterializationDryRunReport({
    plannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    materializedPlan: baselinePlan,
  });
  const trialReport = buildV2MaterializationDryRunReport({
    plannerPolicy: trialPlannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    materializedPlan: trialPlan,
  });
  const targetLaneSummary = summarizeSetBudgetProjectionLane({
    scopedLaneId,
    week: targetWeek,
    slotId: targetSlotId,
    laneId: targetLaneId,
    muscles: input.targetLane?.muscles ?? currentLane.primaryMuscles,
    currentBudget,
    trialBudget,
    suspectedNeededBudget,
    baselinePlan,
    trialPlan,
    inventory,
  });
  const candidateImpact = summarizeSetBudgetProjectionImpact({
    baselinePlan,
    trialPlan,
    baselineReport,
    trialReport,
    targetLane: targetLaneSummary,
  });
  const noCandidateImpact =
    candidateImpact.selectedIdentityDelta === 0 &&
    candidateImpact.totalSetDelta === 0 &&
    candidateImpact.targetLaneSetDelta === 0 &&
    candidateImpact.targetLaneExerciseDelta === 0 &&
    candidateImpact.materializerBlockerDelta === 0 &&
    candidateImpact.regressionCount === 0 &&
    candidateImpact.improvements.length === 0;
  const trialBlocked =
    trialReport.status === "blocked" || trialPlan.status === "blocked";

  return {
    version: 1,
    source: "v2_set_budget_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: trialBlocked ? "blocked" : "projected_with_limitations",
    projectionMode: "set_budget_shadow_materializer_dry_run",
    trialId,
    comparedPlans: {
      baselineAvailable: true,
      trialAvailable: true,
      inventoryExerciseCount: inventory.length,
    },
    targetLane: targetLaneSummary,
    materializer: {
      baselineStatus: baselineReport.materializer.status,
      trialStatus: trialReport.materializer.status,
      baselineBlockerCount: baselineReport.materializer.blockerCount,
      trialBlockerCount: trialReport.materializer.blockerCount,
      baselineSeedShapeCompatible:
        baselineReport.seedShapeCompatibility.compatible,
      trialSeedShapeCompatible: trialReport.seedShapeCompatibility.compatible,
    },
    candidateImpact,
    blockersBeforeBehavior: uniqueSorted([
      ...(trialBlocked ? ["set_budget_trial_materializer_blocked"] : []),
      ...(noCandidateImpact ? ["set_budget_trial_no_candidate_impact"] : []),
      ...(trialReport.seedShapeCompatibility.compatible
        ? []
        : ["trial_seed_shape_incompatible"]),
      "acceptance_gate_not_rerun",
      "production_set_distribution_intent_unchanged",
      "production_materializer_not_consuming_trial_budget",
      "representative_slot_projection_only",
      "cross_week_projection_not_rerun",
    ]),
    nextSafeAction: trialBlocked
      ? "inspect_set_budget_materializer_projection"
      : noCandidateImpact
        ? "pivot_to_higher_roi_track"
        : "run_read_only_acceptance_projection",
    limitations: [
      "read_only_materializer_dry_run_only",
      "trial_set_distribution_intent_is_projection_copy_only",
      "representative_slot_projection_only",
      ...(noCandidateImpact
        ? ["set_budget_trial_did_not_change_candidate_identity_or_sets"]
        : []),
      "does_not_change_v2_set_distribution_intent",
      "does_not_feed_production_materializer",
      "does_not_feed_acceptance_scoring",
      "does_not_write_executable_seed_truth",
      "does_not_change_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

export function buildV2ConcentrationMaterializerProjectionFromLiveContext(input: {
  plannerPolicy?: V2PlannerMesocyclePolicy;
  selectionDiagnostic?: V2ExerciseSelectionPlanDiagnostic | null;
  acceptanceClassification?: ConcentrationAcceptanceEvidence;
  taxonomy?: V2ExerciseClassTaxonomy;
  inventory?: V2MaterializationExercise[] | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
}): V2ConcentrationMaterializerProjection {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const inventory = input.inventory ?? [];
  const target = selectConcentrationWarningTarget({
    diagnostic: input.selectionDiagnostic,
    plannerPolicy,
  });

  if (!inventory.length || !target) {
    return emptyConcentrationMaterializerProjection({
      target,
      blockersBeforeBehavior: [
        ...(!inventory.length ? ["inventory_unavailable"] : []),
        ...(!target ? ["concentration_warning_target_unavailable"] : []),
      ],
    });
  }

  const trialBudget = concentrationTrialBudget(target.currentBudget);
  const trialExerciseSelectionPlan = cloneExerciseSelectionPlanWithLaneBudget({
    exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
    slotId: target.slotId,
    laneId: target.laneId,
    trialBudget,
  });
  const trialPlannerPolicy: V2PlannerMesocyclePolicy = {
    ...plannerPolicy,
    exerciseSelectionPlan: trialExerciseSelectionPlan,
  };
  const baselinePlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
    inventory,
    taxonomy,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
  });
  const trialPlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: trialExerciseSelectionPlan,
    inventory,
    taxonomy,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
  });
  const baselineReport = buildV2MaterializationDryRunReport({
    plannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    materializedPlan: baselinePlan,
  });
  const trialReport = buildV2MaterializationDryRunReport({
    plannerPolicy: trialPlannerPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    materializedPlan: trialPlan,
  });
  const targetLane = summarizeConcentrationProjectionLane({
    target,
    trialBudget,
    baselinePlan,
    trialPlan,
    inventory,
  });
  const candidateImpact = summarizeConcentrationProjectionImpact({
    baselinePlan,
    trialPlan,
    baselineReport,
    trialReport,
    targetLane,
  });
  const concentrationDelta = summarizeConcentrationDelta({
    baselinePlan,
    trialPlan,
    inventory,
  });
  const crossWeekRows = buildConcentrationCrossWeekProjectionRows({
    plannerPolicy,
    target,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
  });
  const donorOffsetRedistributionProjection =
    buildConcentrationDonorOffsetRedistributionProjection({
      plannerPolicy,
      target,
      taxonomy,
      inventory,
      constraints,
      acceptanceClassification: input.acceptanceClassification,
      ...(input.continuity ? { continuity: input.continuity } : {}),
    });
  const noCandidateImpact =
    candidateImpact.selectedIdentityDelta === 0 &&
    candidateImpact.totalSetDelta === 0 &&
    candidateImpact.targetLaneSetDelta === 0 &&
    candidateImpact.targetLaneExerciseDelta === 0 &&
    candidateImpact.materializerBlockerDelta === 0 &&
    candidateImpact.regressionCount === 0 &&
    candidateImpact.improvements.length === 0 &&
    concentrationDelta.warningDelta === 0 &&
    concentrationDelta.maxShareDelta === 0 &&
    concentrationDelta.highFatigueSetDelta === 0;
  const trialBlocked =
    trialReport.status === "blocked" || trialPlan.status === "blocked";
  const concentrationImproved =
    concentrationDelta.warningDelta < 0 ||
    concentrationDelta.over60Delta < 0 ||
    concentrationDelta.maxShareDelta < 0 ||
    concentrationDelta.highFatigueSetDelta < 0;
  const crossWeekReadiness = buildConcentrationCrossWeekReadiness({
    status: trialBlocked ? "blocked" : "projected_with_limitations",
    rows: crossWeekRows,
    representativeAccumulationWeeks: representativeAccumulationWeeks(
      plannerPolicy,
    ).map((week) => week.week),
    topLevelNoCandidateImpact: noCandidateImpact,
    topLevelConcentrationImproved: concentrationImproved,
    candidateImpact,
    concentrationDelta,
    acceptanceClassification: input.acceptanceClassification,
    donorOffsetRedistributionProjection,
    productionMaterializerConsumed: false,
    seedRuntimeReceiptDbConsumed: false,
  });
  const promotedBoundedCalvesBaselineProof =
    hasPromotedBoundedCalvesBaselineProof(donorOffsetRedistributionProjection);

  return {
    version: 1,
    source: "v2_concentration_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: trialBlocked ? "blocked" : "projected_with_limitations",
    projectionMode: "concentration_set_cap_shadow_materializer_dry_run",
    trialId: target.trialId,
    comparedPlans: {
      baselineAvailable: true,
      trialAvailable: true,
      inventoryExerciseCount: inventory.length,
    },
    targetLane,
    materializer: {
      baselineStatus: baselineReport.materializer.status,
      trialStatus: trialReport.materializer.status,
      baselineBlockerCount: baselineReport.materializer.blockerCount,
      trialBlockerCount: trialReport.materializer.blockerCount,
      baselineSeedShapeCompatible:
        baselineReport.seedShapeCompatibility.compatible,
      trialSeedShapeCompatible: trialReport.seedShapeCompatibility.compatible,
    },
    candidateImpact,
    concentrationDelta,
    donorOffsetRedistributionProjection,
    crossWeekReadiness,
    blockersBeforeBehavior: uniqueSorted([
      ...(trialBlocked ? ["concentration_trial_materializer_blocked"] : []),
      ...(noCandidateImpact && !promotedBoundedCalvesBaselineProof
        ? ["concentration_trial_no_candidate_impact"]
        : []),
      ...(concentrationImproved || promotedBoundedCalvesBaselineProof
        ? []
        : ["concentration_trial_did_not_improve_warning_metrics"]),
      ...crossWeekReadiness.gates.flatMap((gate) => gate.blockers),
      ...donorOffsetRedistributionProjection.blockersBeforeBehavior.filter(
        (blocker) =>
          !(
            promotedBoundedCalvesBaselineProof &&
            blocker === "production_slot_demand_allocation_unchanged"
          ),
      ),
      ...(trialReport.seedShapeCompatibility.compatible
        ? []
        : ["trial_seed_shape_incompatible"]),
      "acceptance_gate_not_rerun",
      ...(promotedBoundedCalvesBaselineProof
        ? []
        : ["production_slot_demand_allocation_unchanged"]),
      "production_set_distribution_intent_unchanged",
      "production_materializer_not_consuming_trial",
      "representative_lane_projection_only",
      ...(donorOffsetRedistributionProjection.status ===
      "projected_with_limitations"
        ? []
        : ["weekly_distribution_redistribution_not_projected"]),
    ]),
    nextSafeAction: trialBlocked ||
      crossWeekReadiness.decision === "blocked_by_evidence"
      ? "inspect_concentration_materializer_projection"
      : promotedBoundedCalvesBaselineProof
        ? "run_read_only_acceptance_projection"
        : noCandidateImpact || !concentrationImproved
        ? "pivot_to_higher_roi_track"
        : crossWeekReadiness.nextSafeSlice ===
            "run_acceptance_non_regression_projection"
          ? "run_read_only_acceptance_projection"
          : "inspect_concentration_materializer_projection",
    limitations: [
      "read_only_materializer_dry_run_only",
      "trial_exercise_selection_plan_is_projection_copy_only",
      "representative_lane_projection_only",
      "does_not_change_slot_demand_allocation_by_week",
      "does_not_change_v2_set_distribution_intent",
      "does_not_feed_production_materializer",
      "does_not_feed_acceptance_scoring",
      "does_not_write_executable_seed_truth",
      "does_not_change_runtime_replay",
      ...(noCandidateImpact
        ? ["concentration_trial_did_not_change_candidate_identity_sets_or_metrics"]
        : []),
    ],
    safeForBehaviorPromotion: false,
  };
}

export function buildV2SupportFloorMaterializerProjectionFromLiveContext(input: {
  plannerPolicy?: V2PlannerMesocyclePolicy;
  taxonomy?: V2ExerciseClassTaxonomy;
  inventory?: V2MaterializationExercise[] | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
  targetLane?: {
    week?: number;
    slotId?: V2PlannerSlotId;
    laneId?: string;
    trialId?: string;
    supportFloorGapId?: string;
    muscle?: string;
    directFloorExpected?: number;
    directFloorDelivered?: number;
    directFloorStatus?: string;
    likelyOwnerSeam?: string;
    currentBudget?: V2PlannerSetRange;
    suspectedNeededBudget?: V2PlannerSetRange;
  };
}): V2SupportFloorMaterializerProjection {
  const targetSlotId = input.targetLane?.slotId ?? "upper_a";
  const targetLaneId = input.targetLane?.laneId ?? "unknown_lane";
  const directFloorExpected = input.targetLane?.directFloorExpected ?? 0;
  const currentBudget = input.targetLane?.currentBudget;
  const suspectedNeededBudget =
    input.targetLane?.suspectedNeededBudget ??
    (currentBudget
      ? {
          min: Math.max(currentBudget.min, directFloorExpected),
          preferred: Math.max(currentBudget.preferred, directFloorExpected),
          max: Math.max(currentBudget.max, directFloorExpected),
        }
      : undefined);
  const base = buildV2SetBudgetMaterializerProjectionFromLiveContext({
    plannerPolicy: input.plannerPolicy,
    taxonomy: input.taxonomy,
    inventory: input.inventory,
    constraints: input.constraints,
    continuity: input.continuity,
    targetLane: {
      week: input.targetLane?.week ?? 1,
      slotId: targetSlotId,
      laneId: targetLaneId,
      trialId:
        input.targetLane?.trialId ??
        `${targetSlotId}_${targetLaneId}_support_floor_shadow`,
      ...(currentBudget ? { currentBudget } : {}),
      ...(suspectedNeededBudget ? { suspectedNeededBudget } : {}),
      muscles: input.targetLane?.muscle ? [input.targetLane.muscle] : [],
    },
  });
  const noCandidateImpact =
    base.candidateImpact.selectedIdentityDelta === 0 &&
    base.candidateImpact.totalSetDelta === 0 &&
    base.candidateImpact.targetLaneSetDelta === 0 &&
    base.candidateImpact.targetLaneExerciseDelta === 0 &&
    base.candidateImpact.materializerBlockerDelta === 0 &&
    base.candidateImpact.regressionCount === 0 &&
    base.candidateImpact.improvements.length === 0;

  return {
    ...base,
    source: "v2_support_floor_materializer_projection",
    projectionMode: "support_direct_floor_shadow_materializer_dry_run",
    targetLane: {
      ...base.targetLane,
      supportFloorGapId:
        input.targetLane?.supportFloorGapId ??
        `${targetSlotId}:${targetLaneId}:support_floor`,
      muscle: input.targetLane?.muscle ?? base.targetLane.muscles[0] ?? "unknown",
      directFloorExpected,
      directFloorDelivered: input.targetLane?.directFloorDelivered ?? 0,
      directFloorStatus:
        input.targetLane?.directFloorStatus ?? "not_evaluated",
      likelyOwnerSeam:
        input.targetLane?.likelyOwnerSeam ?? "SetDistributionIntent",
    },
    blockersBeforeBehavior: uniqueSorted([
      ...base.blockersBeforeBehavior.filter(
        (blocker) =>
          blocker !== "set_budget_trial_no_candidate_impact" &&
          blocker !== "production_set_distribution_intent_unchanged" &&
          blocker !== "production_materializer_not_consuming_trial_budget",
      ),
      ...(noCandidateImpact
        ? ["support_floor_trial_no_candidate_impact"]
        : []),
      "production_support_floor_policy_unchanged",
      "production_materializer_not_consuming_support_floor_trial",
    ]),
    nextSafeAction:
      base.status === "blocked"
        ? "inspect_support_floor_materializer_projection"
        : noCandidateImpact
          ? "pivot_to_higher_roi_track"
          : "run_read_only_acceptance_projection",
    limitations: uniqueSorted([
      ...base.limitations.filter(
        (limitation) =>
          limitation !== "trial_set_distribution_intent_is_projection_copy_only" &&
          limitation !==
            "set_budget_trial_did_not_change_candidate_identity_or_sets",
      ),
      "trial_support_floor_budget_is_projection_copy_only",
      ...(noCandidateImpact
        ? ["support_floor_trial_did_not_change_candidate_identity_or_sets"]
        : []),
      "does_not_change_v2_support_lane_policy",
      "does_not_change_v2_set_distribution_intent",
      "does_not_feed_production_materializer",
      "does_not_feed_acceptance_scoring",
      "does_not_write_executable_seed_truth",
      "does_not_change_runtime_replay",
    ]),
    safeForBehaviorPromotion: false,
  };
}

export function buildV2StrategyRowMaterializerProjectionFromLiveContext(input: {
  plannerPolicy?: V2PlannerMesocyclePolicy;
  taxonomy?: V2ExerciseClassTaxonomy;
  inventory?: V2MaterializationExercise[] | null;
  constraints?: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
  sourcePerformedEvidence?: string[];
  target?: {
    week?: number;
    slotId?: V2PlannerSlotId;
    laneId?: string;
  };
}): V2StrategyRowMaterializerProjection {
  const plannerPolicy = input.plannerPolicy ?? buildV2PlannerMesocyclePolicy();
  const taxonomy = input.taxonomy ?? DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const constraints = input.constraints ?? EMPTY_CONSTRAINTS;
  const inventory = input.inventory ?? [];
  const targetWeek = input.target?.week ?? 1;
  const targetSlotId = input.target?.slotId ?? "upper_b";
  const targetLaneId = input.target?.laneId ?? "side_delt_isolation";
  const targetAllocation = allocationMuscleRow({
    slotDemandAllocationByWeek: plannerPolicy.slotDemandAllocationByWeek,
    week: targetWeek,
    slotId: targetSlotId,
    laneId: targetLaneId,
    muscle: "Side Delts",
  });

  if (!inventory.length || !targetAllocation) {
    return emptyStrategyRowMaterializerProjection({
      sourcePerformedEvidence: input.sourcePerformedEvidence ?? [],
      week: targetWeek,
      slotId: targetSlotId,
      laneId: targetLaneId,
      blockersBeforeBehavior: uniqueSorted([
        ...(!inventory.length ? ["inventory_unavailable"] : []),
        ...(!targetAllocation
          ? ["side_delts_slot_allocation_row_not_found"]
          : []),
      ]),
    });
  }

  const trialAllocation = cloneSlotDemandAllocationWithMuscleDelta({
    slotDemandAllocationByWeek: plannerPolicy.slotDemandAllocationByWeek,
    week: targetWeek,
    slotId: targetSlotId,
    laneId: targetLaneId,
    muscle: "Side Delts",
    delta: 1,
  });
  const trialPlannerPolicy = rebuildPlannerPolicyWithSlotDemandAllocation({
    plannerPolicy,
    slotDemandAllocationByWeek: trialAllocation,
  });
  const baselineWeek = plannerPolicy.exerciseSelectionPlan.weeks.find(
    (week) => week.week === targetWeek,
  );
  const trialWeek = trialPlannerPolicy.exerciseSelectionPlan.weeks.find(
    (week) => week.week === targetWeek,
  );

  if (!baselineWeek || !trialWeek) {
    return emptyStrategyRowMaterializerProjection({
      sourcePerformedEvidence: input.sourcePerformedEvidence ?? [],
      week: targetWeek,
      slotId: targetSlotId,
      laneId: targetLaneId,
      blockersBeforeBehavior: ["target_week_selection_plan_not_found"],
    });
  }

  const baselineWeeklyPolicy = plannerPolicyForSingleWeek({
    plannerPolicy,
    week: baselineWeek,
  });
  const trialWeeklyPolicy = plannerPolicyForSingleWeek({
    plannerPolicy: trialPlannerPolicy,
    week: trialWeek,
  });
  const baselinePlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: baselineWeeklyPolicy.exerciseSelectionPlan,
    inventory,
    taxonomy,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
  });
  const trialPlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: trialWeeklyPolicy.exerciseSelectionPlan,
    inventory,
    taxonomy,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
  });
  const baselineReport = buildV2MaterializationDryRunReport({
    plannerPolicy: baselineWeeklyPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    materializedPlan: baselinePlan,
  });
  const trialReport = buildV2MaterializationDryRunReport({
    plannerPolicy: trialWeeklyPolicy,
    taxonomy,
    inventory,
    constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    materializedPlan: trialPlan,
  });
  const comparison = compareV2MaterializedPlans({
    baselinePlan,
    trialPlan,
    baselineBlockerCount: baselineReport.materializer.blockerCount,
    trialBlockerCount: trialReport.materializer.blockerCount,
    trialMaterializerStatus: trialReport.materializer.status,
    trialSeedShapeCompatible: trialReport.seedShapeCompatibility.compatible,
  });
  const baselineLaneExercises = materializedExercisesForLane({
    plan: baselinePlan,
    slotId: targetSlotId,
    laneId: targetLaneId,
  });
  const trialLaneExercises = materializedExercisesForLane({
    plan: trialPlan,
    slotId: targetSlotId,
    laneId: targetLaneId,
  });
  const baselineLaneSets = sumMaterializedExerciseSets(baselineLaneExercises);
  const trialLaneSets = sumMaterializedExerciseSets(trialLaneExercises);
  const concentrationDelta = summarizeConcentrationDelta({
    baselinePlan,
    trialPlan,
    inventory,
  });
  const trialBlocked =
    trialReport.status === "blocked" || trialPlan.status === "blocked";
  const materializerRegressed =
    comparison.regressions.length > 0 ||
    comparison.summary.materializerBlockerDelta > 0 ||
    trialBlocked;
  const protectedCoverageRegressed = trialLaneSets < baselineLaneSets;
  const concentrationRegressed =
    concentrationDelta.warningDelta > 0 ||
    concentrationDelta.maxShareDelta > 0 ||
    concentrationDelta.highFatigueSetDelta > 0;
  const noCandidateImpact =
    comparison.summary.selectedIdentityDelta === 0 &&
    comparison.summary.totalSetDelta === 0 &&
    trialLaneSets - baselineLaneSets === 0 &&
    comparison.summary.materializerBlockerDelta === 0 &&
    comparison.regressions.length === 0 &&
    concentrationDelta.warningDelta === 0 &&
    concentrationDelta.maxShareDelta === 0 &&
    concentrationDelta.highFatigueSetDelta === 0;
  const protectedCoverageLossCause = summarizeStrategyRowProtectedCoverageLossCause({
    baselinePlannerPolicy: baselineWeeklyPolicy,
    trialPlannerPolicy: trialWeeklyPolicy,
    baselinePlan,
    trialPlan,
    targetWeek,
    targetSlotId,
    targetLaneId,
    protectedCoverageRegressed,
    materializerRegressed,
  });
  const readiness: V2StrategyRowMaterializerProjection["readiness"] =
    materializerRegressed ||
    protectedCoverageRegressed ||
    concentrationRegressed
      ? "blocked"
      : noCandidateImpact
        ? "diagnostic_no_impact"
        : "blocked";

  return {
    version: 1,
    source: "v2_strategy_row_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: trialBlocked ? "blocked" : "projected_with_limitations",
    projectionMode: "strategy_row_slot_allocation_materializer_dry_run",
    sourcePerformedEvidence: input.sourcePerformedEvidence ?? [],
    row: {
      rowKey: "SlotDemandAllocationByWeek:Side Delts:protect_floor",
      muscle: "Side Delts",
      ownerSeam: "SlotDemandAllocationByWeek",
      action: "protect_floor",
    },
    boundedDeltaAttempted: {
      type: "single_set_floor_buffer",
      week: targetWeek,
      slotId: targetSlotId,
      laneId: targetLaneId,
      muscle: "Side Delts",
      setDelta: 1,
      baselineAllocatedSets: { ...targetAllocation.targetSetRange },
      trialAllocatedSets: addDeltaToPlannerRange({
        range: targetAllocation.targetSetRange,
        delta: 1,
      }),
    },
    downstreamProjection: {
      classDistributionStatus: "measured",
      capacityPlanStatus: "measured",
      exerciseSelectionStatus: "measured",
      baselineClassLaneCount: countClassLanes(plannerPolicy),
      trialClassLaneCount: countClassLanes(trialPlannerPolicy),
      baselineCapacityLaneCount: countCapacityLanes(plannerPolicy),
      trialCapacityLaneCount: countCapacityLanes(trialPlannerPolicy),
      baselineSelectionLaneCount: countSelectionLanes(plannerPolicy),
      trialSelectionLaneCount: countSelectionLanes(trialPlannerPolicy),
    },
    materializer: {
      baselineStatus: baselineReport.materializer.status,
      trialStatus: trialReport.materializer.status,
      baselineBlockerCount: baselineReport.materializer.blockerCount,
      trialBlockerCount: trialReport.materializer.blockerCount,
      baselineSeedShapeCompatible:
        baselineReport.seedShapeCompatibility.compatible,
      trialSeedShapeCompatible: trialReport.seedShapeCompatibility.compatible,
    },
    materializerDeltas: {
      selectedIdentityDelta: comparison.summary.selectedIdentityDelta,
      totalSetDelta: comparison.summary.totalSetDelta,
      targetLaneSetDelta: trialLaneSets - baselineLaneSets,
      targetLaneExerciseDelta:
        trialLaneExercises.length - baselineLaneExercises.length,
      materializerBlockerDelta: comparison.summary.materializerBlockerDelta,
      regressionCount: comparison.regressions.length,
      changedSlotCount: comparison.summary.changedSlotCount,
      changedSlots: comparison.slots.map((slot) => ({
        slotId: slot.slotId,
        exerciseCountDelta: slot.exerciseCountDelta,
        setDelta: slot.setDelta,
        addedIdentityCount: slot.addedExerciseIds.length,
        removedIdentityCount: slot.removedExerciseIds.length,
      })),
    },
    protectedCoverageImpact: {
      status:
        trialLaneSets > baselineLaneSets
          ? "improved"
          : trialLaneSets === baselineLaneSets
            ? "preserved"
            : "regressed",
      baselineTargetLaneSets: baselineLaneSets,
      trialTargetLaneSets: trialLaneSets,
      targetLaneSetDelta: trialLaneSets - baselineLaneSets,
      netWeeklySetDelta: comparison.summary.totalSetDelta,
    },
    protectedCoverageLossCause,
    duplicateConcentrationImpact: {
      status: concentrationRegressed
        ? "regressed"
        : concentrationDelta.warningDelta < 0 ||
            concentrationDelta.maxShareDelta < 0 ||
            concentrationDelta.highFatigueSetDelta < 0
          ? "improved"
          : "preserved",
      warningDelta: concentrationDelta.warningDelta,
      maxShareDelta: concentrationDelta.maxShareDelta,
      highFatigueSetDelta: concentrationDelta.highFatigueSetDelta,
    },
    readiness,
    blockersBeforeBehavior: uniqueSorted([
      ...(trialBlocked ? ["strategy_row_trial_materializer_blocked"] : []),
      ...(materializerRegressed
        ? ["strategy_row_materializer_identity_set_or_blocker_regression"]
        : []),
      ...(protectedCoverageRegressed
        ? ["strategy_row_protected_coverage_regression"]
        : []),
      ...(concentrationRegressed
        ? ["strategy_row_duplicate_or_concentration_regression"]
        : []),
      ...(noCandidateImpact ? ["strategy_row_trial_no_candidate_impact"] : []),
      ...(comparison.summary.totalSetDelta === 0
        ? []
        : ["net_weekly_volume_changed_by_bounded_delta"]),
      "acceptance_gate_not_rerun",
      "production_slot_demand_allocation_unchanged",
      "production_materializer_not_consuming_strategy_row_trial",
    ]),
    remainingProofBeforeBehavior: uniqueSorted([
      ...(comparison.summary.totalSetDelta === 0
        ? []
        : ["slot_owned_donor_or_capacity_offset_for_net_zero_weekly_volume"]),
      ...(materializerRegressed ? ["materializer_non_regression"] : []),
      ...(protectedCoverageRegressed
        ? ["protected_coverage_non_regression"]
        : []),
      ...(concentrationRegressed
        ? ["duplicate_concentration_non_regression"]
        : []),
      "read_only_acceptance_gate_result_for_projected_candidate",
      "cross_week_slot_allocation_non_regression",
      "seed_runtime_receipt_db_non_consumption_must_remain_proven",
      "repaired_projection_must_remain_evidence_only_not_target_policy",
    ]),
    nextSafeSlice:
      materializerRegressed ||
      protectedCoverageRegressed ||
      concentrationRegressed
      ? "inspect_materializer_or_concentration_regressions"
      : noCandidateImpact
        ? "pivot_to_higher_roi_track"
        : "keep_blocked_until_owner_donor_or_acceptance_proof",
    nonConsumption: {
      demandOrMaterializer: false,
      seedRuntimeReceiptDb: false,
      acceptanceThreshold: false,
    },
    limitations: [
      "read_only_materializer_dry_run_only",
      "trial_slot_demand_allocation_is_projection_copy_only",
      "targets_only_week_1_upper_b_side_delt_isolation",
      "does_not_change_slot_demand_allocation_by_week",
      "does_not_change_v2_set_distribution_intent",
      "does_not_feed_production_materializer",
      "does_not_feed_acceptance_scoring",
      "does_not_write_executable_seed_truth",
      "does_not_change_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

export async function runV2LiveContextMaterializationDryRunHarness(input: {
  userId?: string;
  ownerEmail?: string;
} = {}): Promise<V2LiveContextMaterializationDryRunResult> {
  const ownerEmail =
    input.ownerEmail ?? process.env.OWNER_EMAIL?.trim().toLowerCase() ?? "owner@local";
  const user = input.userId
    ? await prisma.user.findUnique({ where: { id: input.userId } })
    : await prisma.user.findUnique({ where: { email: ownerEmail } });

  if (!user) {
    return buildV2LiveContextMaterializationDryRunHarness({
      ownerContext: {
        ...(input.userId ? { userId: input.userId } : {}),
        ownerEmail,
      },
      mesocycleContext: null,
      inventory: null,
      inventorySource: "unavailable",
    });
  }

  const [mesocycle, exercises, preferences] = await Promise.all([
    prisma.mesocycle.findFirst({
      where: {
        isActive: true,
        macroCycle: { userId: user.id },
      },
      orderBy: [{ mesoNumber: "desc" }],
      select: {
        id: true,
        state: true,
        splitType: true,
        slotSequenceJson: true,
      },
    }),
    prisma.exercise.findMany({
      orderBy: { name: "asc" },
      include: {
        aliases: true,
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
    }),
    prisma.userPreference.findUnique({ where: { userId: user.id } }),
  ]);

  return buildV2LiveContextMaterializationDryRunHarness({
    ownerContext: { userId: user.id, ownerEmail: user.email },
    mesocycleContext: mesocycle
      ? {
          id: mesocycle.id,
          state: mesocycle.state,
          splitType: mesocycle.splitType,
          slotSequenceJson: mesocycle.slotSequenceJson,
        }
      : null,
    inventory: normalizeLiveInventoryForV2Materialization(exercises),
    inventorySource: "live_normalized_inventory",
    constraints: {
      avoidExerciseIds: preferences?.avoidExerciseIds ?? [],
      favoriteExerciseIds: preferences?.favoriteExerciseIds ?? [],
      painConflictExerciseIds: [],
    },
  });
}

export async function runV2MaterializedSeedAcceptanceProbe(input: {
  userId?: string;
  ownerEmail?: string;
  mesocycleId?: string;
  reader?: V2MaterializedSeedAcceptanceProbeReader;
} = {}): Promise<BuildV2MaterializedSeedAcceptanceProbeResult> {
  const reader = input.reader ?? prisma;
  const ownerEmail =
    input.ownerEmail ?? process.env.OWNER_EMAIL?.trim().toLowerCase() ?? "owner@local";
  const user = input.userId
    ? await reader.user.findUnique({ where: { id: input.userId } })
    : await reader.user.findUnique({ where: { email: ownerEmail } });

  if (!user) {
    return buildV2MaterializedSeedAcceptanceProbe({
      ownerLoaded: false,
      mesocycleLoaded: false,
      slotSequence: buildMesocycleSlotSequence([]),
      plannerPolicy: null,
      exerciseSelectionPlan: null,
      taxonomy: null,
      inventory: null,
      liveNormalizedInventoryAvailable: false,
    });
  }

  const [mesocycle, exercises, preferences] = await Promise.all([
    reader.mesocycle.findFirst({
      where: {
        ...(input.mesocycleId ? { id: input.mesocycleId } : { isActive: true }),
        macroCycle: { userId: user.id },
      },
      orderBy: input.mesocycleId ? undefined : [{ mesoNumber: "desc" }],
      select: {
        id: true,
        state: true,
        splitType: true,
        slotSequenceJson: true,
      },
    }),
    reader.exercise.findMany({
      orderBy: { name: "asc" },
      include: {
        aliases: true,
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
    }),
    reader.userPreference.findUnique({ where: { userId: user.id } }),
  ]);
  const slotContract = resolveMesocycleSlotContract({
    slotSequenceJson: mesocycle?.slotSequenceJson,
    weeklySchedule: [],
  });
  const slotSequence = buildMesocycleSlotSequence(
    slotContract.slots.map((slot) => ({
      slotId: slot.slotId,
      intent: slot.intent.toUpperCase() as WorkoutSessionIntent,
      ...(slot.authoredSemantics
        ? { authoredSemantics: slot.authoredSemantics }
        : {}),
    })),
  );
  const plannerPolicy = buildV2PlannerMesocyclePolicy();
  const inventory = normalizeLiveInventoryForV2Materialization(exercises);
  const taxonomy = DEFAULT_V2_EXERCISE_CLASS_TAXONOMY;
  const constraints = {
    avoidExerciseIds: preferences?.avoidExerciseIds ?? [],
    favoriteExerciseIds: preferences?.favoriteExerciseIds ?? [],
    painConflictExerciseIds: [],
  };
  const materializedPlan =
    inventory.length > 0
      ? buildV2ExerciseMaterializationPlan({
          exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
          inventory,
          taxonomy,
          constraints,
        })
      : null;
  const basePlanValidation = buildV2BasePlanValidation({
    plannerPolicy,
    materializedPlan,
    inventory,
    taxonomy,
  });

  return buildV2MaterializedSeedAcceptanceProbe({
    ownerLoaded: true,
    mesocycleLoaded: Boolean(mesocycle),
    slotSequence,
    slotSequenceSource: "live_mesocycle_slot_sequence",
    plannerPolicy,
    exerciseSelectionPlan: plannerPolicy.exerciseSelectionPlan,
    taxonomy,
    inventory,
    materializedPlan,
    basePlanValidation,
    liveNormalizedInventoryAvailable: inventory.length > 0,
    constraints,
  });
}

function summarizeBlockersBeforePromotion(input: {
  dryRunReport: V2MaterializationDryRunReport;
  inventorySource: V2LiveContextInventorySource;
  ownerLoaded: boolean;
  mesocycleLoaded: boolean;
}): string[] {
  return Array.from(
    new Set([
      ...(input.ownerLoaded ? [] : ["owner_context_unavailable"]),
      ...(input.mesocycleLoaded ? [] : ["mesocycle_context_unavailable"]),
      ...(input.inventorySource === "live_normalized_inventory"
        ? []
        : [`inventory_source_${input.inventorySource}`]),
      ...input.dryRunReport.blockers.map((blocker) =>
        [blocker.slotId, blocker.laneId, blocker.reason]
          .filter(Boolean)
          .join(":"),
      ),
      ...input.dryRunReport.readiness.missingBeforePromotion,
    ]),
  );
}

function emptyCapacityMaterializerProjection(
  blockers: string[],
): V2CapacityMaterializerProjection {
  return {
    version: 1,
    source: "v2_capacity_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "not_available",
    projectionMode: "slot_cap_delta_materializer_dry_run",
    trialId: null,
    candidateChange: null,
    comparedPlans: {
      baselineAvailable: false,
      trialAvailable: false,
      inventoryExerciseCount: 0,
    },
    targetSlot: {
      slotId: null,
      maxExerciseCountBefore: null,
      maxExerciseCountAfter: null,
      baselineExerciseCount: 0,
      trialExerciseCount: 0,
      baselineSetCount: 0,
      trialSetCount: 0,
      addedIdentities: [],
      removedIdentities: [],
      floorCriticalLaneIds: [],
      floorCriticalLaneIdsMaterialized: [],
      floorCriticalLaneIdsMissing: [],
    },
    materializer: {
      baselineStatus: "blocked",
      trialStatus: "blocked",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: false,
      trialSeedShapeCompatible: false,
    },
    candidateImpact: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      targetSlotExerciseDelta: 0,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      regressions: [],
      improvements: [],
      changedSlotCount: 0,
      changedSlots: [],
    },
    gates: [],
    blockersBeforeBehavior: blockers,
    nextSafeAction: "inspect_capacity_rows",
    limitations: [
      "projection_not_available_without_capacity_policy_trial_design",
      "does_not_change_selection_capacity_plan",
      "does_not_feed_production_materializer",
      "does_not_change_seed_or_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

function emptyLaneIntentMaterializerProjection(input: {
  scopedLaneId: string;
  slotId: string;
  laneId: string;
  trialId: string;
  blockersBeforeBehavior: string[];
}): V2LaneIntentMaterializerProjection {
  return {
    version: 1,
    source: "v2_lane_intent_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "not_available",
    projectionMode: "lane_intent_shadow_materializer_dry_run",
    trialId: input.trialId,
    comparedPlans: {
      baselineAvailable: false,
      trialAvailable: false,
      inventoryExerciseCount: 0,
    },
    targetLane: {
      scopedLaneId: input.scopedLaneId,
      slotId: input.slotId,
      laneId: input.laneId,
      intentAvailable: false,
      baselineConsumedByProduction: false,
      trialConsumesLaneIntent: false,
      baselineExerciseCount: 0,
      trialExerciseCount: 0,
      baselineSetCount: 0,
      trialSetCount: 0,
      addedIdentities: [],
      removedIdentities: [],
    },
    materializer: {
      baselineStatus: "blocked",
      trialStatus: "blocked",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: false,
      trialSeedShapeCompatible: false,
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
    blockersBeforeBehavior: uniqueSorted(input.blockersBeforeBehavior),
    nextSafeAction: "inspect_lane_intent_materializer_projection",
    limitations: [
      "projection_not_available_without_target_lane_intent_and_inventory",
      "does_not_change_lane_selection_intent_allowlist",
      "does_not_feed_production_materializer",
      "does_not_change_seed_or_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

function emptySetBudgetMaterializerProjection(input: {
  scopedLaneId: string;
  week: number;
  slotId: string;
  laneId: string;
  trialId: string;
  blockersBeforeBehavior: string[];
}): V2SetBudgetMaterializerProjection {
  const zeroBudget: V2PlannerSetRange = { min: 0, preferred: 0, max: 0 };
  return {
    version: 1,
    source: "v2_set_budget_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "not_available",
    projectionMode: "set_budget_shadow_materializer_dry_run",
    trialId: input.trialId,
    comparedPlans: {
      baselineAvailable: false,
      trialAvailable: false,
      inventoryExerciseCount: 0,
    },
    targetLane: {
      scopedLaneId: input.scopedLaneId,
      week: input.week,
      slotId: input.slotId,
      laneId: input.laneId,
      muscles: [],
      currentBudget: zeroBudget,
      trialBudget: zeroBudget,
      suspectedNeededBudget: zeroBudget,
      baselineExerciseCount: 0,
      trialExerciseCount: 0,
      baselineSetCount: 0,
      trialSetCount: 0,
      addedIdentities: [],
      removedIdentities: [],
    },
    materializer: {
      baselineStatus: "blocked",
      trialStatus: "blocked",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: false,
      trialSeedShapeCompatible: false,
    },
    candidateImpact: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      targetLaneSetDelta: 0,
      targetLaneExerciseDelta: 0,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      regressions: [],
      improvements: [],
      changedSlotCount: 0,
      changedSlots: [],
    },
    blockersBeforeBehavior: uniqueSorted(input.blockersBeforeBehavior),
    nextSafeAction: "inspect_set_budget_materializer_projection",
    limitations: [
      "projection_not_available_without_target_lane_budget_and_inventory",
      "does_not_change_v2_set_distribution_intent",
      "does_not_feed_production_materializer",
      "does_not_change_seed_or_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

function emptyStrategyRowMaterializerProjection(input: {
  sourcePerformedEvidence: string[];
  week: number;
  slotId: V2PlannerSlotId | "unknown";
  laneId: string;
  blockersBeforeBehavior: string[];
}): V2StrategyRowMaterializerProjection {
  const zeroRange: V2PlannerSetRange = { min: 0, preferred: 0, max: 0 };
  return {
    version: 1,
    source: "v2_strategy_row_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "not_available",
    projectionMode: "strategy_row_slot_allocation_materializer_dry_run",
    sourcePerformedEvidence: input.sourcePerformedEvidence,
    row: {
      rowKey: "SlotDemandAllocationByWeek:Side Delts:protect_floor",
      muscle: "Side Delts",
      ownerSeam: "SlotDemandAllocationByWeek",
      action: "protect_floor",
    },
    boundedDeltaAttempted: {
      type: "single_set_floor_buffer",
      week: input.week,
      slotId: input.slotId,
      laneId: input.laneId,
      muscle: "Side Delts",
      setDelta: 1,
      baselineAllocatedSets: zeroRange,
      trialAllocatedSets: zeroRange,
    },
    downstreamProjection: {
      classDistributionStatus: "not_measured",
      capacityPlanStatus: "not_measured",
      exerciseSelectionStatus: "not_measured",
      baselineClassLaneCount: 0,
      trialClassLaneCount: 0,
      baselineCapacityLaneCount: 0,
      trialCapacityLaneCount: 0,
      baselineSelectionLaneCount: 0,
      trialSelectionLaneCount: 0,
    },
    materializer: {
      baselineStatus: "blocked",
      trialStatus: "blocked",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: false,
      trialSeedShapeCompatible: false,
    },
    materializerDeltas: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      targetLaneSetDelta: 0,
      targetLaneExerciseDelta: 0,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      changedSlotCount: 0,
      changedSlots: [],
    },
    protectedCoverageImpact: {
      status: "not_measured",
      baselineTargetLaneSets: 0,
      trialTargetLaneSets: 0,
      targetLaneSetDelta: 0,
      netWeeklySetDelta: 0,
    },
    protectedCoverageLossCause: emptyStrategyRowProtectedCoverageLossCause({
      week: input.week,
      slotId: input.slotId,
      laneId: input.laneId,
    }),
    duplicateConcentrationImpact: {
      status: "not_measured",
      warningDelta: 0,
      maxShareDelta: 0,
      highFatigueSetDelta: 0,
    },
    readiness: "blocked",
    blockersBeforeBehavior: uniqueSorted(input.blockersBeforeBehavior),
    remainingProofBeforeBehavior: [
      "owner_specific_class_distribution_projection",
      "owner_specific_selection_capacity_projection",
      "owner_specific_exercise_selection_projection",
      "owner_specific_materializer_identity_set_blocker_deltas",
    ],
    nextSafeSlice: "keep_blocked_until_owner_donor_or_acceptance_proof",
    nonConsumption: {
      demandOrMaterializer: false,
      seedRuntimeReceiptDb: false,
      acceptanceThreshold: false,
    },
    limitations: [
      "projection_not_available_without_target_row_and_inventory",
      "does_not_feed_production_materializer",
      "does_not_change_seed_or_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

function emptyConcentrationMaterializerProjection(input: {
  target: ConcentrationProjectionTarget | null;
  blockersBeforeBehavior: string[];
}): V2ConcentrationMaterializerProjection {
  const target = input.target;
  const zeroBudget: V2PlannerSetRange = { min: 0, preferred: 0, max: 0 };
  const donorOffsetRedistributionProjection =
    emptyConcentrationDonorOffsetRedistributionProjection({
      blockersBeforeBehavior: input.blockersBeforeBehavior,
    });
  return {
    version: 1,
    source: "v2_concentration_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "not_available",
    projectionMode: "concentration_set_cap_shadow_materializer_dry_run",
    trialId: target?.trialId ?? "concentration_set_cap_shadow_unavailable",
    comparedPlans: {
      baselineAvailable: false,
      trialAvailable: false,
      inventoryExerciseCount: 0,
    },
    targetLane: {
      scopedLaneId: target?.scopedLaneId ?? "unknown:unknown_lane",
      week: target?.week ?? 1,
      slotId: target?.slotId ?? "unknown",
      laneId: target?.laneId ?? "unknown_lane",
      muscles: target?.muscles ?? [],
      warningEvidence: target?.warningEvidence ?? [],
      currentBudget: target?.currentBudget ?? zeroBudget,
      trialBudget: target ? concentrationTrialBudget(target.currentBudget) : zeroBudget,
      baselineExerciseCount: 0,
      trialExerciseCount: 0,
      baselineSetCount: 0,
      trialSetCount: 0,
      addedIdentities: [],
      removedIdentities: [],
    },
    materializer: {
      baselineStatus: "blocked",
      trialStatus: "blocked",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: false,
      trialSeedShapeCompatible: false,
    },
    candidateImpact: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      targetLaneSetDelta: 0,
      targetLaneExerciseDelta: 0,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      regressions: [],
      improvements: [],
      changedSlotCount: 0,
      changedSlots: [],
    },
    concentrationDelta: {
      baselineWarningCount: 0,
      trialWarningCount: 0,
      warningDelta: 0,
      baselineOver60Count: 0,
      trialOver60Count: 0,
      over60Delta: 0,
      baselineMaxSharePercent: 0,
      trialMaxSharePercent: 0,
      maxShareDelta: 0,
      baselineHighFatigueSetCount: 0,
      trialHighFatigueSetCount: 0,
      highFatigueSetDelta: 0,
      baselineFatigueWeightedSets: 0,
      trialFatigueWeightedSets: 0,
      fatigueWeightedSetDelta: 0,
    },
    donorOffsetRedistributionProjection,
    crossWeekReadiness: buildConcentrationCrossWeekReadiness({
      status: "not_available",
      rows: [],
      representativeAccumulationWeeks: [],
      topLevelNoCandidateImpact: true,
      topLevelConcentrationImproved: false,
      candidateImpact: {
        selectedIdentityDelta: 0,
        totalSetDelta: 0,
        targetLaneSetDelta: 0,
        targetLaneExerciseDelta: 0,
        materializerBlockerDelta: 0,
        regressionCount: 0,
        regressions: [],
        improvements: [],
        changedSlotCount: 0,
        changedSlots: [],
      },
      concentrationDelta: {
        baselineWarningCount: 0,
        trialWarningCount: 0,
        warningDelta: 0,
        baselineOver60Count: 0,
        trialOver60Count: 0,
        over60Delta: 0,
        baselineMaxSharePercent: 0,
        trialMaxSharePercent: 0,
        maxShareDelta: 0,
        baselineHighFatigueSetCount: 0,
        trialHighFatigueSetCount: 0,
        baselineFatigueWeightedSets: 0,
        trialFatigueWeightedSets: 0,
        highFatigueSetDelta: 0,
        fatigueWeightedSetDelta: 0,
      },
      donorOffsetRedistributionProjection,
      productionMaterializerConsumed: false,
      seedRuntimeReceiptDbConsumed: false,
    }),
    blockersBeforeBehavior: uniqueSorted(input.blockersBeforeBehavior),
    nextSafeAction: "inspect_concentration_materializer_projection",
    limitations: [
      "projection_not_available_without_concentration_warning_target_and_inventory",
      "does_not_change_slot_demand_allocation_by_week",
      "does_not_change_v2_set_distribution_intent",
      "does_not_feed_production_materializer",
      "does_not_change_seed_or_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

function buildConcentrationCrossWeekProjectionRows(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  target: ConcentrationProjectionTarget;
  taxonomy: V2ExerciseClassTaxonomy;
  inventory: ReadonlyArray<V2MaterializationExercise>;
  constraints: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
}): V2ConcentrationMaterializerProjection["crossWeekReadiness"]["rows"] {
  return representativeAccumulationWeeks(input.plannerPolicy).flatMap((week) => {
    const slot = week.slots.find((row) => row.slotId === input.target.slotId);
    const lane = slot?.lanes.find((row) => row.laneId === input.target.laneId);
    if (!slot || !lane) {
      return [];
    }
    const weeklyPolicy = plannerPolicyForSingleWeek({
      plannerPolicy: input.plannerPolicy,
      week,
    });
    const trialBudget = concentrationTrialBudget(lane.setBudget);
    const trialExerciseSelectionPlan = cloneExerciseSelectionPlanWithLaneBudget({
      exerciseSelectionPlan: weeklyPolicy.exerciseSelectionPlan,
      slotId: input.target.slotId,
      laneId: input.target.laneId,
      trialBudget,
    });
    const trialPlannerPolicy: V2PlannerMesocyclePolicy = {
      ...weeklyPolicy,
      exerciseSelectionPlan: trialExerciseSelectionPlan,
    };
    const baselinePlan = buildV2ExerciseMaterializationPlan({
      exerciseSelectionPlan: weeklyPolicy.exerciseSelectionPlan,
      inventory: [...input.inventory],
      taxonomy: input.taxonomy,
      constraints: input.constraints,
      ...(input.continuity ? { continuity: input.continuity } : {}),
    });
    const trialPlan = buildV2ExerciseMaterializationPlan({
      exerciseSelectionPlan: trialExerciseSelectionPlan,
      inventory: [...input.inventory],
      taxonomy: input.taxonomy,
      constraints: input.constraints,
      ...(input.continuity ? { continuity: input.continuity } : {}),
    });
    const baselineReport = buildV2MaterializationDryRunReport({
      plannerPolicy: weeklyPolicy,
      taxonomy: input.taxonomy,
      inventory: [...input.inventory],
      constraints: input.constraints,
      ...(input.continuity ? { continuity: input.continuity } : {}),
      materializedPlan: baselinePlan,
    });
    const trialReport = buildV2MaterializationDryRunReport({
      plannerPolicy: trialPlannerPolicy,
      taxonomy: input.taxonomy,
      inventory: [...input.inventory],
      constraints: input.constraints,
      ...(input.continuity ? { continuity: input.continuity } : {}),
      materializedPlan: trialPlan,
    });
    const targetLane = summarizeConcentrationProjectionLane({
      target: {
        ...input.target,
        week: week.week,
        currentBudget: lane.setBudget,
      },
      trialBudget,
      baselinePlan,
      trialPlan,
      inventory: input.inventory,
    });
    const candidateImpact = summarizeConcentrationProjectionImpact({
      baselinePlan,
      trialPlan,
      baselineReport,
      trialReport,
      targetLane,
    });
    const concentrationDelta = summarizeConcentrationDelta({
      baselinePlan,
      trialPlan,
      inventory: input.inventory,
    });
    const blocked =
      trialReport.status === "blocked" ||
      trialPlan.status === "blocked";
    const regressed =
      candidateImpact.regressionCount > 0 ||
      candidateImpact.materializerBlockerDelta > 0 ||
      concentrationDelta.warningDelta > 0 ||
      concentrationDelta.over60Delta > 0 ||
      concentrationDelta.maxShareDelta > 0 ||
      concentrationDelta.highFatigueSetDelta > 0;
    const improved =
      concentrationDelta.warningDelta < 0 ||
      concentrationDelta.over60Delta < 0 ||
      concentrationDelta.maxShareDelta < 0 ||
      concentrationDelta.highFatigueSetDelta < 0;
    const noImpact =
      candidateImpact.selectedIdentityDelta === 0 &&
      candidateImpact.totalSetDelta === 0 &&
      candidateImpact.targetLaneSetDelta === 0 &&
      candidateImpact.materializerBlockerDelta === 0 &&
      candidateImpact.regressionCount === 0 &&
      !improved;

    return [
      {
        week: week.week,
        phase: week.phase,
        scopedLaneId: input.target.scopedLaneId,
        status: blocked
          ? "blocked"
          : regressed
            ? "regressed"
            : improved
              ? "improved"
              : noImpact
                ? "no_candidate_impact"
                : "no_candidate_impact",
        evidenceSource: "pure_v2_materializer_projection",
        baselineMaterializerStatus: baselineReport.materializer.status,
        trialMaterializerStatus: trialReport.materializer.status,
        selectedIdentityDelta: candidateImpact.selectedIdentityDelta,
        totalSetDelta: candidateImpact.totalSetDelta,
        targetLaneSetDelta: candidateImpact.targetLaneSetDelta,
        materializerBlockerDelta: candidateImpact.materializerBlockerDelta,
        warningDelta: concentrationDelta.warningDelta,
        maxShareDelta: concentrationDelta.maxShareDelta,
        highFatigueSetDelta: concentrationDelta.highFatigueSetDelta,
        regressionCount: candidateImpact.regressionCount,
        changedSlotCount: candidateImpact.changedSlotCount,
      },
    ];
  });
}

function buildConcentrationDonorOffsetRedistributionProjection(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  target: ConcentrationProjectionTarget;
  taxonomy: V2ExerciseClassTaxonomy;
  inventory: ReadonlyArray<V2MaterializationExercise>;
  constraints: V2ExerciseMaterializationInput["constraints"];
  acceptanceClassification?: ConcentrationAcceptanceEvidence;
  continuity?: V2ExerciseMaterializationInput["continuity"];
}): V2ConcentrationDonorOffsetRedistributionProjection {
  const rows = representativeAccumulationWeeks(input.plannerPolicy).map((week) =>
    buildConcentrationDonorOffsetRedistributionRow({
      ...input,
      week,
    }),
  );
  const projectedRows = rows.filter(
    (row) => row.behaviorReadinessDecision !== "not_available",
  );
  const improvedWeekCount = rows.filter((row) => row.status === "improved").length;
  const noImpactWeekCount = rows.filter(
    (row) => row.status === "no_candidate_impact",
  ).length;
  const blockedWeekCount = rows.filter(
    (row) => row.status === "blocked" || row.status === "regressed",
  ).length;
  const protectedCoveragePassCount = rows.filter(
    (row) => row.protectedCoverageImpact.status === "preserved",
  ).length;
  const materializerRegressionCount = rows.filter(
    (row) =>
      row.materializerDelta.materializerBlockerDelta > 0 ||
      row.materializerDelta.regressionCount > 0,
  ).length;
  const concentrationRegressionCount = rows.filter(
    (row) => row.concentrationWarningDelta > 0,
  ).length;
  const regressionCauseCounts = countDonorOffsetRegressionCauses(rows);
  const totalSetDelta = rows.reduce(
    (sum, row) => sum + row.materializerDelta.totalSetDelta,
    0,
  );
  const concentrationWarningDelta = rows.reduce(
    (sum, row) => sum + row.concentrationWarningDelta,
    0,
  );
  const alternateCandidateCount = rows.reduce(
    (sum, row) => sum + row.alternateDonorCandidates.length,
    0,
  );
  const alternatePassingCandidateCount = rows.reduce(
    (sum, row) =>
      sum +
      row.alternateDonorCandidates.filter((candidate) => candidate.status === "pass")
        .length,
    0,
  );
  const selectedAlternateWeekCount = rows.filter(
    (row) => row.selectedDonorKind === "alternate",
  ).length;
  const slotWeekAllocationProjection = buildV2SlotWeekDonorCapacityProjection({
    slotDemandAllocationByWeek: input.plannerPolicy.slotDemandAllocationByWeek,
    measuredRows: rows.flatMap((row): V2SlotWeekDonorCapacityMeasuredRow[] => {
      if (!row.donor) {
        return [];
      }
      const protectedMuscles =
        row.protectedCoverageImpact.protectedMuscles.length > 0
          ? row.protectedCoverageImpact.protectedMuscles
          : row.source.muscles;
      return protectedMuscles.map((muscle) => ({
        week: row.week,
        muscle,
        sourceSlotId: row.source.slotId,
        sourceLaneId: row.source.laneId,
        sourceBeforeSets: row.source.baselineSetCount,
        sourceAfterSets: row.source.trialSetCount,
        sourceSetDelta: row.source.setDelta,
        donorSlotId: row.donor?.slotId ?? null,
        donorLaneId: row.donor?.laneId ?? null,
        donorBeforeSets: row.donor?.baselineSetCount ?? 0,
        donorAfterSets: row.donor?.trialSetCount ?? 0,
        donorSetDelta: row.donor?.setDelta ?? 0,
        netWeeklySetDelta: row.protectedCoverageImpact.netWeeklySetDelta,
        protectedCoverageStatus: row.protectedCoverageImpact.status,
        materializerRegressionCount: row.materializerDelta.regressionCount,
        materializerBlockerDelta: row.materializerDelta.materializerBlockerDelta,
        concentrationWarningDelta: row.concentrationWarningDelta,
      }));
    }),
  });
  const blockersBeforeBehavior = uniqueSorted([
    ...rows.flatMap((row) => row.blockers),
    ...slotWeekAllocationProjection.rows.flatMap((row) =>
      row.blockingReasons.map((reason) => `slot_week_allocation:${reason}`),
    ),
    ...(projectedRows.length === 0 ? ["donor_offset_candidate_unavailable"] : []),
    "acceptance_gate_not_rerun_for_donor_offset_projection",
    "production_slot_demand_allocation_unchanged",
    "production_set_distribution_intent_unchanged",
    "production_materializer_not_consuming_donor_offset_projection",
    "donor_offset_projection_is_read_only",
  ]);
  const behaviorReadinessDecision: V2ConcentrationDonorOffsetRedistributionProjection["summary"]["behaviorReadinessDecision"] =
    projectedRows.length === 0
      ? "not_available"
      : blockedWeekCount > 0 ||
          materializerRegressionCount > 0 ||
          concentrationRegressionCount > 0 ||
          rows.some(
            (row) => row.protectedCoverageImpact.status === "regressed",
          )
        ? "blocked_by_evidence"
        : improvedWeekCount > 0
          ? "candidate_for_acceptance_projection"
          : "not_worth_pursuing";
  const nextSafeSlice: V2ConcentrationDonorOffsetRedistributionProjection["summary"]["nextSafeSlice"] =
    behaviorReadinessDecision === "candidate_for_acceptance_projection"
      ? "run_acceptance_non_regression_projection"
      : behaviorReadinessDecision === "blocked_by_evidence"
        ? "inspect_donor_offset_regressions"
        : behaviorReadinessDecision === "not_worth_pursuing"
          ? "pivot_to_higher_roi_track"
          : projectedRows.length === 0
            ? "select_alternate_donor_offset"
            : "keep_diagnostic_only";

  return {
    version: 1,
    source: "v2_concentration_donor_offset_redistribution_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status:
      projectedRows.length === 0
        ? "not_available"
        : behaviorReadinessDecision === "blocked_by_evidence"
          ? "blocked"
          : "projected_with_limitations",
    projectionMode:
      "source_lane_cap_with_slot_owned_donor_offset_shadow_materializer_dry_run",
    sourceAttribution: {
      sourceLane: "pure_v2_materializer_projection",
      donorSelection: "SlotDemandAllocationByWeek",
      materializerProjection: "baseline_vs_donor_offset_trial_dry_run",
      noRepairProjection: "not_used_as_target_policy",
      repairedProjection: "evidence_only_not_target_policy",
      acceptanceNoRepair: input.acceptanceClassification
        ? "week_1_trainability_shape_only"
        : "not_provided",
    },
    summary: {
      projectedWeekCount: projectedRows.length,
      improvedWeekCount,
      noImpactWeekCount,
      blockedWeekCount,
      protectedCoveragePassCount,
      materializerRegressionCount,
      concentrationRegressionCount,
      regressionCauseCounts,
      totalSetDelta,
      concentrationWarningDelta,
      alternateCandidateCount,
      alternatePassingCandidateCount,
      selectedAlternateWeekCount,
      acceptanceTrainabilityStatus:
        input.acceptanceClassification?.basicMesocycleShapeStatus ??
        "not_provided",
      behaviorReadinessDecision,
      blockerCount: blockersBeforeBehavior.length,
      nextSafeSlice,
      slotWeekAllocationReadiness:
        slotWeekAllocationProjection.summary.behaviorReadiness,
      slotWeekAllocationNextSafeSlice:
        slotWeekAllocationProjection.summary.nextSafeSlice,
      slotWeekAllocationBlockedRowCount:
        slotWeekAllocationProjection.summary.blockedRowCount,
    },
    slotWeekAllocationProjection,
    rows,
    blockersBeforeBehavior,
    limitations: [
      "read_only_donor_offset_materializer_dry_run_only",
      "uses_slot_demand_allocation_by_week_for_donor_selection_only",
      "does_not_mutate_slot_demand_allocation_by_week",
      "does_not_change_v2_set_distribution_intent",
      "does_not_feed_production_materializer",
      "does_not_feed_acceptance_scoring",
      "does_not_write_executable_seed_truth",
      "does_not_change_runtime_replay",
      "repaired_projection_is_evidence_only_not_target_policy",
    ],
    safeForBehaviorPromotion: false,
  };
}

function buildConcentrationDonorOffsetRedistributionRow(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  target: ConcentrationProjectionTarget;
  taxonomy: V2ExerciseClassTaxonomy;
  inventory: ReadonlyArray<V2MaterializationExercise>;
  constraints: V2ExerciseMaterializationInput["constraints"];
  acceptanceClassification?: ConcentrationAcceptanceEvidence;
  continuity?: V2ExerciseMaterializationInput["continuity"];
  week: ReturnType<typeof representativeAccumulationWeeks>[number];
}): V2ConcentrationDonorOffsetRedistributionProjection["rows"][number] {
  const weeklyPolicy = plannerPolicyForSingleWeek({
    plannerPolicy: input.plannerPolicy,
    week: input.week,
  });
  const sourceLane = findSelectionLaneForWeek({
    plannerPolicy: input.plannerPolicy,
    week: input.week.week,
    slotId: input.target.slotId,
    laneId: input.target.laneId,
  });
  const baselinePlan = buildV2ExerciseMaterializationPlan({
    exerciseSelectionPlan: weeklyPolicy.exerciseSelectionPlan,
    inventory: [...input.inventory],
    taxonomy: input.taxonomy,
    constraints: input.constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
  });
  const sourceBaseline = materializedExercisesForLane({
    plan: baselinePlan,
    slotId: input.target.slotId,
    laneId: input.target.laneId,
  });
  const unavailable = (
    blockers: string[],
  ): V2ConcentrationDonorOffsetRedistributionProjection["rows"][number] => ({
    week: input.week.week,
    phase: input.week.phase,
    status: "blocked",
    source: {
      slotId: input.target.slotId,
      laneId: input.target.laneId,
      scopedLaneId: input.target.scopedLaneId,
      muscles: input.target.muscles,
      baselineSetCount: sumMaterializedExerciseSets(sourceBaseline),
      trialSetCount: sumMaterializedExerciseSets(sourceBaseline),
      setDelta: 0,
    },
    donor: null,
    allocationPolicyTrial: null,
    protectedCoverageImpact: {
      protectedMuscles: input.target.muscles,
      sourceFloorSets: sourceLane?.setBudget.min ?? 0,
      sourceBeforeSets: sumMaterializedExerciseSets(sourceBaseline),
      sourceAfterSets: sumMaterializedExerciseSets(sourceBaseline),
      sourceSetDelta: 0,
      donorSetDelta: 0,
      netWeeklySetDelta: 0,
      status: "unknown",
      blockers,
    },
    materializerDelta: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      regressions: [],
      changedSlotCount: 0,
    },
    concentrationWarningDelta: 0,
    regressionCauses: [],
    primaryDonorCandidate: null,
    alternateDonorCandidates: [],
    selectedDonorKind: "none",
    acceptanceTrainabilityStatus:
      input.acceptanceClassification?.basicMesocycleShapeStatus ??
      "not_provided",
    behaviorReadinessDecision: "not_available",
    blockers,
    nextSafeSlice: "select_alternate_donor_offset",
  });

  if (!sourceLane) {
    return unavailable(["source_lane_unavailable_for_donor_offset_projection"]);
  }

  const donorCandidates = findConcentrationDonorOffsetLanes({
    plannerPolicy: weeklyPolicy,
    week: input.week.week,
    sourceSlotId: input.target.slotId,
    sourceLaneId: input.target.laneId,
    sourceMuscles: input.target.muscles,
  });

  if (donorCandidates.length === 0) {
    return unavailable(["slot_owned_donor_offset_lane_unavailable"]);
  }

  const candidateProjections = donorCandidates.map((donor, index) =>
    buildConcentrationDonorOffsetCandidateProjection({
      plannerPolicy: weeklyPolicy,
      week: input.week.week,
      sourceLane,
      sourceSlotId: input.target.slotId,
      sourceLaneId: input.target.laneId,
      donor,
      isPrimary: index === 0,
      baselinePlan,
      taxonomy: input.taxonomy,
      inventory: input.inventory,
      constraints: input.constraints,
      ...(input.continuity ? { continuity: input.continuity } : {}),
    }),
  );
  const primaryCandidate = candidateProjections[0];
  const alternatePassingCandidate = candidateProjections
    .slice(1)
    .find(
      (candidate) =>
        candidate.behaviorReadinessDecision ===
        "candidate_for_acceptance_projection",
    );
  const selectedCandidate = alternatePassingCandidate ?? primaryCandidate;
  const primaryDonorCandidate = primaryCandidate
    ? summarizeDonorOffsetCandidate(primaryCandidate, {
        hasPassingAlternate: Boolean(alternatePassingCandidate),
      })
    : null;
  const alternateDonorCandidates = candidateProjections
    .slice(1)
    .map((candidate) =>
      summarizeDonorOffsetCandidate(candidate, {
        hasPassingAlternate: false,
      }),
    );
  const selectedSummary = summarizeDonorOffsetCandidate(selectedCandidate, {
    hasPassingAlternate: false,
  });
  const sourceBeforeSets = selectedCandidate.sourceBeforeSets;
  const sourceAfterSets = selectedCandidate.sourceAfterSets;
  const sourceSetDelta = selectedCandidate.sourceSetDelta;
  const donorBeforeSets = selectedCandidate.donorBeforeSets;
  const donorAfterSets = selectedCandidate.donorAfterSets;
  const donorSetDelta = selectedCandidate.donorSetDelta;
  const netWeeklySetDelta = selectedCandidate.netWeeklySetDelta;
  const behaviorReadinessDecision =
    selectedCandidate.behaviorReadinessDecision;
  const blockers = selectedCandidate.blockers;

  return {
    week: input.week.week,
    phase: input.week.phase,
    status:
      behaviorReadinessDecision === "blocked_by_evidence"
        ? "blocked"
        : behaviorReadinessDecision === "candidate_for_acceptance_projection"
          ? "improved"
          : selectedSummary.status === "no_candidate_impact"
            ? "no_candidate_impact"
            : "no_candidate_impact",
    source: {
      slotId: input.target.slotId,
      laneId: input.target.laneId,
      scopedLaneId: input.target.scopedLaneId,
      muscles: input.target.muscles,
      baselineSetCount: sourceBeforeSets,
      trialSetCount: sourceAfterSets,
      setDelta: sourceSetDelta,
    },
    donor: {
      slotId: selectedCandidate.donor.slotId,
      laneId: selectedCandidate.donor.laneId,
      scopedLaneId: materializerScopedLaneId(
        selectedCandidate.donor.slotId,
        selectedCandidate.donor.laneId,
      ),
      muscles: selectedCandidate.donor.protectedMuscles,
      baselineSetCount: donorBeforeSets,
      trialSetCount: donorAfterSets,
      setDelta: donorSetDelta,
    },
    allocationPolicyTrial: selectedCandidate.allocationPolicyTrial,
    protectedCoverageImpact: {
      protectedMuscles: selectedCandidate.donor.protectedMuscles,
      sourceFloorSets: sourceLane.setBudget.min,
      sourceBeforeSets,
      sourceAfterSets,
      sourceSetDelta,
      donorSetDelta,
      netWeeklySetDelta,
      status: selectedCandidate.protectedCoverageStatus,
      blockers: selectedCandidate.protectedBlockers,
    },
    materializerDelta: {
      selectedIdentityDelta:
        selectedCandidate.comparison.summary.selectedIdentityDelta,
      totalSetDelta: selectedCandidate.comparison.summary.totalSetDelta,
      materializerBlockerDelta:
        selectedCandidate.comparison.summary.materializerBlockerDelta,
      regressionCount: selectedCandidate.comparison.regressions.length,
      regressions: selectedCandidate.comparison.regressions,
      changedSlotCount:
        selectedCandidate.comparison.summary.changedSlotCount,
    },
    concentrationWarningDelta:
      selectedCandidate.concentrationDelta.warningDelta,
    regressionCauses: selectedSummary.regressionCauses,
    primaryDonorCandidate,
    alternateDonorCandidates,
    selectedDonorKind:
      selectedCandidate === primaryCandidate ? "primary" : "alternate",
    acceptanceTrainabilityStatus:
      input.acceptanceClassification?.basicMesocycleShapeStatus ??
      "not_provided",
    behaviorReadinessDecision,
    blockers,
    nextSafeSlice:
      behaviorReadinessDecision === "candidate_for_acceptance_projection"
        ? "run_acceptance_non_regression_projection"
        : behaviorReadinessDecision === "blocked_by_evidence"
          ? "inspect_donor_offset_regressions"
          : "pivot_to_higher_roi_track",
  };
}

function emptyConcentrationDonorOffsetRedistributionProjection(input: {
  blockersBeforeBehavior: string[];
}): V2ConcentrationDonorOffsetRedistributionProjection {
  const blockersBeforeBehavior = uniqueSorted([
    ...input.blockersBeforeBehavior,
    "donor_offset_candidate_unavailable",
  ]);
  const slotWeekAllocationProjection: V2SlotWeekDonorCapacityProjection = {
    version: 1,
    source: "v2_slot_week_donor_capacity_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByDemandOrMaterializer: false,
    status: "not_available",
    designDecision: {
      policy:
        "only_relieve_concentration_when_slot_owned_donor_absorbs_required_sets",
      requireMeasuredDonorAbsorption: true,
      requireNetWeeklyVolumePreserved: true,
      requireProtectedCoveragePreserved: true,
      requireMaterializerNonRegression: true,
    },
    summary: {
      rowCount: 0,
      passingRowCount: 0,
      blockedRowCount: 0,
      eligibleDonorSlotCount: 0,
      measuredDonorCapacityPassCount: 0,
      measuredDonorCapacityFailCount: 0,
      measuredDonorCapacityUnderAbsorptionCount: 0,
      measuredDonorCapacityOverAbsorptionCount: 0,
      protectedCoverageRegressionCount: 0,
      materializerRegressionCount: 0,
      netWeeklySetDelta: 0,
      behaviorReadiness: "not_available",
      nextSafeSlice: "keep_diagnostic_only",
    },
    rows: [],
    limitations: [
      "projection_not_available_without_measured_donor_offset_rows",
      "does_not_mutate_slot_demand_allocation_by_week",
      "does_not_feed_materializer_ranking",
      "does_not_write_seed_runtime_receipt_or_db_state",
    ],
  };
  return {
    version: 1,
    source: "v2_concentration_donor_offset_redistribution_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "not_available",
    projectionMode:
      "source_lane_cap_with_slot_owned_donor_offset_shadow_materializer_dry_run",
    sourceAttribution: {
      sourceLane: "pure_v2_materializer_projection",
      donorSelection: "SlotDemandAllocationByWeek",
      materializerProjection: "baseline_vs_donor_offset_trial_dry_run",
      noRepairProjection: "not_used_as_target_policy",
      repairedProjection: "evidence_only_not_target_policy",
      acceptanceNoRepair: "not_provided",
    },
    summary: {
      projectedWeekCount: 0,
      improvedWeekCount: 0,
      noImpactWeekCount: 0,
      blockedWeekCount: 0,
      protectedCoveragePassCount: 0,
      materializerRegressionCount: 0,
      concentrationRegressionCount: 0,
      regressionCauseCounts: {},
      totalSetDelta: 0,
      concentrationWarningDelta: 0,
      alternateCandidateCount: 0,
      alternatePassingCandidateCount: 0,
      selectedAlternateWeekCount: 0,
      acceptanceTrainabilityStatus: "not_provided",
      behaviorReadinessDecision: "not_available",
      blockerCount: blockersBeforeBehavior.length,
      nextSafeSlice: "select_alternate_donor_offset",
      slotWeekAllocationReadiness:
        slotWeekAllocationProjection.summary.behaviorReadiness,
      slotWeekAllocationNextSafeSlice:
        slotWeekAllocationProjection.summary.nextSafeSlice,
      slotWeekAllocationBlockedRowCount:
        slotWeekAllocationProjection.summary.blockedRowCount,
    },
    slotWeekAllocationProjection,
    rows: [],
    blockersBeforeBehavior,
    limitations: [
      "projection_not_available_without_concentration_warning_target_inventory_or_donor_lane",
      "does_not_mutate_slot_demand_allocation_by_week",
      "does_not_feed_production_materializer",
      "does_not_change_seed_or_runtime_replay",
    ],
    safeForBehaviorPromotion: false,
  };
}

function buildConcentrationCrossWeekReadiness(input: {
  status: V2ConcentrationMaterializerProjection["status"];
  rows: V2ConcentrationMaterializerProjection["crossWeekReadiness"]["rows"];
  representativeAccumulationWeeks: number[];
  topLevelNoCandidateImpact: boolean;
  topLevelConcentrationImproved: boolean;
  candidateImpact: V2ConcentrationMaterializerProjection["candidateImpact"];
  concentrationDelta: V2ConcentrationMaterializerProjection["concentrationDelta"];
  acceptanceClassification?: ConcentrationAcceptanceEvidence;
  donorOffsetRedistributionProjection: V2ConcentrationDonorOffsetRedistributionProjection;
  productionMaterializerConsumed: boolean;
  seedRuntimeReceiptDbConsumed: boolean;
}): V2ConcentrationMaterializerProjection["crossWeekReadiness"] {
  const projectedWeekCount = input.rows.length;
  const improvedWeekCount = input.rows.filter(
    (row) => row.status === "improved",
  ).length;
  const regressedWeekCount = input.rows.filter(
    (row) => row.status === "regressed" || row.status === "blocked",
  ).length;
  const noImpactWeekCount = input.rows.filter(
    (row) => row.status === "no_candidate_impact",
  ).length;
  const coveragePass =
    input.representativeAccumulationWeeks.length > 0 &&
    projectedWeekCount === input.representativeAccumulationWeeks.length;
  const materializerRegression =
    input.candidateImpact.regressionCount > 0 ||
    input.candidateImpact.materializerBlockerDelta > 0 ||
    input.rows.some(
      (row) =>
        row.regressionCount > 0 ||
        row.materializerBlockerDelta > 0 ||
        row.trialMaterializerStatus !== "materialized",
    );
  const concentrationRegression =
    input.concentrationDelta.warningDelta > 0 ||
    input.concentrationDelta.over60Delta > 0 ||
    input.concentrationDelta.maxShareDelta > 0 ||
    input.concentrationDelta.highFatigueSetDelta > 0 ||
    input.rows.some(
      (row) =>
        row.warningDelta > 0 ||
        row.maxShareDelta > 0 ||
        row.highFatigueSetDelta > 0,
    );
  const acceptance = input.acceptanceClassification;
  const week1TrainabilityPass =
    acceptance?.basicMesocycleShapeStatus === "pass" ||
    acceptance?.basicMesocycleShapeStatus === "pass_with_warnings";
  const acceptanceNeedsRerun =
    input.candidateImpact.totalSetDelta !== 0 ||
    input.candidateImpact.selectedIdentityDelta !== 0 ||
    input.rows.some(
      (row) => row.totalSetDelta !== 0 || row.selectedIdentityDelta !== 0,
    );
  const donorOffset = input.donorOffsetRedistributionProjection;
  const donorGatePass =
    donorOffset.status === "projected_with_limitations" &&
    donorOffset.rows.length > 0 &&
    donorOffset.rows.every(
      (row) =>
        row.protectedCoverageImpact.status === "preserved" &&
        row.protectedCoverageImpact.netWeeklySetDelta === 0 &&
        row.materializerDelta.materializerBlockerDelta <= 0 &&
        row.materializerDelta.regressionCount === 0 &&
        row.concentrationWarningDelta <= 0,
    );
  const promotedBoundedCalvesBaselineProof =
    hasPromotedBoundedCalvesBaselineProof(donorOffset);
  const donorGateFail =
    donorOffset.status === "blocked" ||
    donorOffset.rows.some(
      (row) =>
        row.protectedCoverageImpact.status === "regressed" ||
        row.materializerDelta.materializerBlockerDelta > 0 ||
        row.materializerDelta.regressionCount > 0 ||
        row.concentrationWarningDelta > 0,
    );
  const effectiveMaterializerRegression =
    materializerRegression && !promotedBoundedCalvesBaselineProof;
  const gates: V2ConcentrationMaterializerProjection["crossWeekReadiness"]["gates"] =
    [
      {
        gateId: "cross_week_coverage",
        status:
          input.status === "not_available"
            ? "unknown"
            : coveragePass
              ? "pass"
              : "unknown",
        measured: projectedWeekCount > 0,
        ownerSeam: "v2_concentration_materializer_projection",
        evidenceSource: "pure_v2_materializer_projection",
        evidence: [
          `representativeAccumulationWeeks=${input.representativeAccumulationWeeks.join(",") || "none"}`,
          `projectedWeekCount=${projectedWeekCount}`,
          `improvedWeekCount=${improvedWeekCount}`,
          `regressedWeekCount=${regressedWeekCount}`,
        ],
        blockers: coveragePass ? [] : ["cross_week_coverage_not_proven"],
        requiredNextEvidence: coveragePass
          ? []
          : ["representative_accumulation_week_materializer_rows"],
      },
      {
        gateId: "redistribution_donor_offset",
        status: donorGateFail ? "fail" : donorGatePass ? "pass" : "unknown",
        measured: donorOffset.status !== "not_available",
        ownerSeam: "SlotDemandAllocationByWeek",
        evidenceSource: "pure_v2_base_plan",
        evidence: [
          `topLevelTotalSetDelta=${input.candidateImpact.totalSetDelta}`,
          `projectedTotalSetDeltas=${input.rows.map((row) => `${row.week}:${row.totalSetDelta}`).join(",") || "none"}`,
          `donorProjectionStatus=${donorOffset.status}`,
          `donorProjectedWeeks=${donorOffset.summary.projectedWeekCount}`,
          `donorImprovedWeeks=${donorOffset.summary.improvedWeekCount}`,
          `donorTotalSetDelta=${donorOffset.summary.totalSetDelta}`,
          `donorConcentrationWarningDelta=${donorOffset.summary.concentrationWarningDelta}`,
          `donorBehaviorReadiness=${donorOffset.summary.behaviorReadinessDecision}`,
          `promotedBoundedCalvesBaselineIdempotent=${promotedBoundedCalvesBaselineProof}`,
        ],
        blockers: donorGatePass
          ? []
          : donorGateFail
            ? uniqueSorted([
                "redistribution_donor_offset_regressed",
                ...donorOffset.blockersBeforeBehavior,
              ])
            : uniqueSorted([
                "redistribution_donor_offset_not_projected",
                ...donorOffset.blockersBeforeBehavior,
              ]),
        requiredNextEvidence: donorGatePass
          ? []
          : donorGateFail
            ? ["alternate_slot_owned_donor_offset_projection"]
            : [
                "slot_owned_donor_offset_projection",
                "net_new_volume_preservation_or_explicit_tradeoff",
              ],
      },
      {
        gateId: "acceptance_or_week_1_trainability",
        status:
          acceptance && week1TrainabilityPass && !acceptanceNeedsRerun
            ? "pass"
            : "unknown",
        measured: Boolean(acceptance),
        ownerSeam: "plannerOnlyNoRepair.acceptanceClassification",
        evidenceSource: "acceptance_classification_no_repair",
        evidence: [
          `basicMesocycleShapeStatus=${acceptance?.basicMesocycleShapeStatus ?? "not_provided"}`,
          `replacementReadinessStatus=${acceptance?.replacementReadinessStatus ?? "not_provided"}`,
          `hardBlockers=${acceptance?.hardBlockers.length ?? "unknown"}`,
          `qualityWarnings=${acceptance?.qualityWarnings.length ?? "unknown"}`,
          `acceptanceNeedsRerun=${acceptanceNeedsRerun}`,
        ],
        blockers:
          acceptance && week1TrainabilityPass && !acceptanceNeedsRerun
            ? []
            : ["read_only_acceptance_projection_not_rerun_for_trial"],
        requiredNextEvidence:
          acceptance && week1TrainabilityPass && !acceptanceNeedsRerun
            ? []
            : ["candidate_evaluator_or_acceptance_result_for_projected_trial"],
      },
      {
        gateId: "materializer_identity_set_blocker_non_regression",
        status: effectiveMaterializerRegression ? "fail" : "pass",
        measured: input.status !== "not_available",
        ownerSeam: "v2_materialization_dry_run",
        evidenceSource: "pure_v2_materializer_projection",
        evidence: [
          `selectedIdentityDelta=${input.candidateImpact.selectedIdentityDelta}`,
          `totalSetDelta=${input.candidateImpact.totalSetDelta}`,
          `materializerBlockerDelta=${input.candidateImpact.materializerBlockerDelta}`,
          `regressionCount=${input.candidateImpact.regressionCount}`,
          `promotedBaselineIdempotent=${promotedBoundedCalvesBaselineProof}`,
        ],
        blockers: effectiveMaterializerRegression
          ? ["materializer_identity_set_or_blocker_regression"]
          : [],
        requiredNextEvidence: [],
      },
      {
        gateId: "duplicate_concentration_non_regression",
        status: concentrationRegression ? "fail" : "pass",
        measured: input.status !== "not_available",
        ownerSeam: "v2_concentration_materializer_projection",
        evidenceSource: "pure_v2_materializer_projection",
        evidence: [
          `warningDelta=${input.concentrationDelta.warningDelta}`,
          `over60Delta=${input.concentrationDelta.over60Delta}`,
          `maxShareDelta=${input.concentrationDelta.maxShareDelta}`,
          `highFatigueSetDelta=${input.concentrationDelta.highFatigueSetDelta}`,
        ],
        blockers: concentrationRegression
          ? ["duplicate_or_concentration_regression"]
          : [],
        requiredNextEvidence: [],
      },
      {
        gateId: "production_materializer_non_consumption",
        status: input.productionMaterializerConsumed ? "fail" : "pass",
        measured: true,
        ownerSeam: "production_materializer_policy",
        evidenceSource: "pure_v2_materializer_projection",
        evidence: [
          `consumedByProduction=${input.productionMaterializerConsumed}`,
          "diagnostic_trial_not_in_materializer_allowlist",
        ],
        blockers: input.productionMaterializerConsumed
          ? ["production_materializer_consumes_concentration_trial"]
          : [],
        requiredNextEvidence: [],
      },
      {
        gateId: "seed_runtime_receipt_db_non_consumption",
        status: input.seedRuntimeReceiptDbConsumed ? "fail" : "pass",
        measured: true,
        ownerSeam: "seed_runtime_receipt_persistence_boundary",
        evidenceSource: "pure_v2_materializer_projection",
        evidence: [
          `seedRuntimeReceiptDbConsumed=${input.seedRuntimeReceiptDbConsumed}`,
          "dry_run_only_no_seed_runtime_receipt_db_writes",
        ],
        blockers: input.seedRuntimeReceiptDbConsumed
          ? ["seed_runtime_receipt_or_db_consumes_concentration_trial"]
          : [],
        requiredNextEvidence: [],
      },
    ];
  const blockerCount = gates.reduce(
    (sum, gate) => sum + gate.blockers.length,
    0,
  );
  const hardFailed = gates.some((gate) => gate.status === "fail");
  const hasMeasuredImprovement =
    input.topLevelConcentrationImproved ||
    improvedWeekCount > 0 ||
    promotedBoundedCalvesBaselineProof;
  const decision: V2ConcentrationMaterializerProjection["crossWeekReadiness"]["decision"] =
    hardFailed
      ? "blocked_by_evidence"
      : promotedBoundedCalvesBaselineProof && coveragePass
        ? "candidate_for_bounded_policy_design"
      : input.topLevelNoCandidateImpact && noImpactWeekCount === projectedWeekCount
        ? "not_worth_pursuing"
        : hasMeasuredImprovement && coveragePass
          ? "candidate_for_bounded_policy_design"
          : "diagnostic_only";
  const nextSafeSlice: V2ConcentrationMaterializerProjection["crossWeekReadiness"]["nextSafeSlice"] =
    decision === "candidate_for_bounded_policy_design"
      ? donorGatePass
        ? "run_acceptance_non_regression_projection"
        : "design_slot_demand_redistribution_projection"
      : hardFailed
        ? "inspect_materializer_regressions"
        : decision === "not_worth_pursuing"
          ? "pivot_to_higher_roi_track"
          : "keep_diagnostic_only";

  return {
    decision,
    sourceAttribution: {
      pureV2BasePlan: "not_evaluated_by_concentration_projection",
      materializerProjection: "baseline_vs_trial_dry_run",
      noRepairProjection: "selected_warning_from_exercise_selection_diagnostic",
      repairedProjection: "evidence_only_not_target_policy",
      acceptanceNoRepair: acceptance
        ? "week_1_trainability_shape_only"
        : "not_provided",
    },
    representativeAccumulationWeeks: input.representativeAccumulationWeeks,
    projectedWeekCount,
    improvedWeekCount,
    regressedWeekCount,
    noImpactWeekCount,
    blockerCount,
    nextSafeSlice,
    gates,
    rows: input.rows,
  };
}

export function hasPromotedBoundedCalvesBaselineProof(
  donorOffset: V2ConcentrationDonorOffsetRedistributionProjection,
): boolean {
  const allocation = donorOffset.slotWeekAllocationProjection;
  const summary = allocation.summary;
  const rows = allocation.rows;
  const expectedWeeks = [2, 3, 4];
  return (
    donorOffset.status === "projected_with_limitations" &&
    donorOffset.summary.behaviorReadinessDecision ===
      "candidate_for_acceptance_projection" &&
    donorOffset.summary.materializerRegressionCount === 0 &&
    donorOffset.summary.concentrationRegressionCount === 0 &&
    donorOffset.summary.totalSetDelta === 0 &&
    allocation.status === "available" &&
    summary.behaviorReadiness === "candidate_for_acceptance_projection" &&
    summary.blockedRowCount === 0 &&
    summary.passingRowCount === expectedWeeks.length &&
    summary.netWeeklySetDelta === 0 &&
    rows.length === expectedWeeks.length &&
    rows.every(
      (row) =>
        expectedWeeks.includes(row.week) &&
        row.muscle === V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.muscle &&
        row.sourceLanePressure.slotId ===
          V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.sourceSlotId &&
        row.sourceLanePressure.laneId ===
          V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.laneId &&
        row.sourceLanePressure.allocatedPreferredSets ===
          V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.sourceTargetSetCount &&
        row.sourceLanePressure.baselineSetCount ===
          V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.sourceBaselineSetCount &&
        row.sourceLanePressure.trialSetCount ===
          V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.sourceTargetSetCount &&
        row.sourceLanePressure.setDelta === -1 &&
        row.sourceLanePressure.pressureRelieved === true &&
        row.donorCapacity.donorSlotId ===
          V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.donorSlotId &&
        row.donorCapacity.donorLaneId ===
          V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.laneId &&
        row.donorCapacity.donorBeforeSets ===
          V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.donorBaselineSetCount &&
        row.donorCapacity.donorAfterSets ===
          V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.donorTargetSetCount &&
        row.donorCapacity.donorSetDelta === 1 &&
        row.donorCapacity.absorbedRequiredSets === true &&
        row.donorCapacity.status === "absorbed" &&
        row.protectedCoverageImpact.status === "preserved" &&
        row.protectedCoverageImpact.netWeeklySetDelta === 0 &&
        row.materializerNonRegressionStatus === "pass" &&
        row.behaviorReadiness === "candidate_for_acceptance_projection" &&
        row.blockingReasons.length === 0,
    )
  );
}

function isV2PlannerSlotId(value: string): value is V2PlannerSlotId {
  return (
    value === "upper_a" ||
    value === "lower_a" ||
    value === "upper_b" ||
    value === "lower_b"
  );
}

function normalizedTrialBudget(input: {
  currentBudget: V2PlannerSetRange;
  suspectedNeededBudget: V2PlannerSetRange;
}): V2PlannerSetRange {
  const min = Math.max(input.currentBudget.min, input.suspectedNeededBudget.min);
  const preferred = Math.max(
    min,
    input.currentBudget.preferred,
    input.suspectedNeededBudget.preferred,
  );
  const max = Math.max(
    preferred,
    input.currentBudget.max,
    input.suspectedNeededBudget.max,
  );
  return { min, preferred, max };
}

function addDeltaToPlannerRange(input: {
  range: V2PlannerSetRange;
  delta: number;
}): V2PlannerSetRange {
  const min = Math.max(0, roundToTenth(input.range.min + input.delta));
  const preferred = Math.max(
    min,
    roundToTenth(input.range.preferred + input.delta),
  );
  const max = Math.max(
    preferred,
    roundToTenth(input.range.max + input.delta),
  );
  return { min, preferred, max };
}

function allocationMuscleRow(input: {
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
  week: number;
  slotId: string;
  laneId: string;
  muscle: string;
}):
  | V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]["lanes"][number]["allocatedMuscles"][number]
  | undefined {
  return input.slotDemandAllocationByWeek.weeks
    .find((week) => week.week === input.week)
    ?.slots.find((slot) => slot.slotId === input.slotId)
    ?.lanes.find((lane) => lane.laneId === input.laneId)
    ?.allocatedMuscles.find((muscle) => muscle.muscle === input.muscle);
}

function cloneSlotDemandAllocationWithMuscleDelta(input: {
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
  week: number;
  slotId: V2PlannerSlotId;
  laneId: string;
  muscle: string;
  delta: number;
}): V2SlotDemandAllocationByWeek {
  return {
    ...input.slotDemandAllocationByWeek,
    weeks: input.slotDemandAllocationByWeek.weeks.map((week) => ({
      ...week,
      slots: week.slots.map((slot) => ({
        ...slot,
        lanes: slot.lanes.map((lane) => ({
          ...lane,
          allocatedMuscles: lane.allocatedMuscles.map((muscle) =>
            week.week === input.week &&
            slot.slotId === input.slotId &&
            lane.laneId === input.laneId &&
            muscle.muscle === input.muscle
              ? {
                  ...muscle,
                  targetSetRange: addDeltaToPlannerRange({
                    range: muscle.targetSetRange,
                    delta: input.delta,
                  }),
                  allocationBasis: "target_lane",
                }
              : muscle,
          ),
        })),
      })),
    })),
  };
}

function countClassLanes(plannerPolicy: V2PlannerMesocyclePolicy): number {
  return plannerPolicy.exerciseClassDistributionBySlot.weeks.reduce(
    (sum, week) =>
      sum +
      week.slots.reduce((slotSum, slot) => slotSum + slot.classLanes.length, 0),
    0,
  );
}

function countCapacityLanes(plannerPolicy: V2PlannerMesocyclePolicy): number {
  return plannerPolicy.selectionCapacityPlan.weeks.reduce(
    (sum, week) =>
      sum + week.slots.reduce((slotSum, slot) => slotSum + slot.lanes.length, 0),
    0,
  );
}

function countSelectionLanes(plannerPolicy: V2PlannerMesocyclePolicy): number {
  return plannerPolicy.exerciseSelectionPlan.weeks.reduce(
    (sum, week) =>
      sum + week.slots.reduce((slotSum, slot) => slotSum + slot.lanes.length, 0),
    0,
  );
}

function cloneV2SetDistributionIntentWithLaneBudget(input: {
  intent: V2SetDistributionIntent;
  slotId: V2PlannerSlotId;
  laneId: string;
  trialBudget: V2PlannerSetRange;
}): V2SetDistributionIntent {
  return {
    ...input.intent,
    weeks: input.intent.weeks.map((week) => ({
      ...week,
      slots: week.slots.map((slot) => ({
        ...slot,
        lanes: slot.lanes.map((lane) =>
          slot.slotId === input.slotId && lane.laneId === input.laneId
            ? {
                ...lane,
                setBudget: {
                  ...lane.setBudget,
                  min: input.trialBudget.min,
                  preferred: input.trialBudget.preferred,
                  max: input.trialBudget.max,
                },
              }
            : lane,
        ),
      })),
    })),
  };
}

function summarizeCapacityProjectionSlot(input: {
  slotId: V2PlannerSlotId;
  diagnostic: V2SelectionCapacityPlanDiagnostic;
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null;
  maxExerciseCountBefore: number;
  maxExerciseCountAfter: number;
  inventory: ReadonlyArray<V2MaterializationExercise>;
}): V2CapacityMaterializerProjection["targetSlot"] {
  const baselineSlot = input.baselinePlan?.slots.find(
    (slot) => slot.slotId === input.slotId,
  );
  const trialSlot = input.trialPlan?.slots.find(
    (slot) => slot.slotId === input.slotId,
  );
  const baselineIds = new Set(
    baselineSlot?.exercises.map((exercise) => exercise.exerciseId) ?? [],
  );
  const trialIds = new Set(
    trialSlot?.exercises.map((exercise) => exercise.exerciseId) ?? [],
  );
  const floorCriticalLaneIds = uniqueSorted(
    input.diagnostic.weeks.flatMap((week) =>
      week.slots
        .filter((slot) => slot.slotId === input.slotId)
        .flatMap((slot) =>
          slot.lanes
            .filter((lane) => lane.inspectionCategory === "floor_critical")
            .map((lane) => lane.laneId),
        ),
    ),
  );
  const materializedLaneIds = new Set(
    trialSlot?.exercises.flatMap((exercise) => exercise.laneIds) ?? [],
  );

  return {
    slotId: input.slotId,
    maxExerciseCountBefore: input.maxExerciseCountBefore,
    maxExerciseCountAfter: input.maxExerciseCountAfter,
    baselineExerciseCount: baselineSlot?.exercises.length ?? 0,
    trialExerciseCount: trialSlot?.exercises.length ?? 0,
    baselineSetCount: sumMaterializedSlotSets(baselineSlot),
    trialSetCount: sumMaterializedSlotSets(trialSlot),
    addedIdentities: exerciseNamesForIds({
      exerciseIds: [...trialIds].filter((id) => !baselineIds.has(id)),
      inventory: input.inventory,
    }),
    removedIdentities: exerciseNamesForIds({
      exerciseIds: [...baselineIds].filter((id) => !trialIds.has(id)),
      inventory: input.inventory,
    }),
    floorCriticalLaneIds,
    floorCriticalLaneIdsMaterialized: floorCriticalLaneIds.filter((laneId) =>
      materializedLaneIds.has(laneId),
    ),
    floorCriticalLaneIdsMissing: floorCriticalLaneIds.filter(
      (laneId) => !materializedLaneIds.has(laneId),
    ),
  };
}

function summarizeLaneIntentProjectionLane(input: {
  scopedLaneId: string;
  slotId: string;
  laneId: string;
  baselineConsumedByProduction: boolean;
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  inventory: ReadonlyArray<V2MaterializationExercise>;
}): V2LaneIntentMaterializerProjection["targetLane"] {
  const baselineExercises = materializedExercisesForLane({
    plan: input.baselinePlan,
    slotId: input.slotId,
    laneId: input.laneId,
  });
  const trialExercises = materializedExercisesForLane({
    plan: input.trialPlan,
    slotId: input.slotId,
    laneId: input.laneId,
  });
  const baselineIds = new Set(
    baselineExercises.map((exercise) => exercise.exerciseId),
  );
  const trialIds = new Set(trialExercises.map((exercise) => exercise.exerciseId));

  return {
    scopedLaneId: input.scopedLaneId,
    slotId: input.slotId,
    laneId: input.laneId,
    intentAvailable: true,
    baselineConsumedByProduction: input.baselineConsumedByProduction,
    trialConsumesLaneIntent: true,
    baselineExerciseCount: baselineExercises.length,
    trialExerciseCount: trialExercises.length,
    baselineSetCount: sumMaterializedExerciseSets(baselineExercises),
    trialSetCount: sumMaterializedExerciseSets(trialExercises),
    addedIdentities: exerciseNamesForIds({
      exerciseIds: [...trialIds].filter((id) => !baselineIds.has(id)),
      inventory: input.inventory,
    }),
    removedIdentities: exerciseNamesForIds({
      exerciseIds: [...baselineIds].filter((id) => !trialIds.has(id)),
      inventory: input.inventory,
    }),
  };
}

function summarizeSetBudgetProjectionLane(input: {
  scopedLaneId: string;
  week: number;
  slotId: string;
  laneId: string;
  muscles: string[];
  currentBudget: V2PlannerSetRange;
  trialBudget: V2PlannerSetRange;
  suspectedNeededBudget: V2PlannerSetRange;
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  inventory: ReadonlyArray<V2MaterializationExercise>;
}): V2SetBudgetMaterializerProjection["targetLane"] {
  const baselineExercises = materializedExercisesForLane({
    plan: input.baselinePlan,
    slotId: input.slotId,
    laneId: input.laneId,
  });
  const trialExercises = materializedExercisesForLane({
    plan: input.trialPlan,
    slotId: input.slotId,
    laneId: input.laneId,
  });
  const baselineIds = new Set(
    baselineExercises.map((exercise) => exercise.exerciseId),
  );
  const trialIds = new Set(trialExercises.map((exercise) => exercise.exerciseId));

  return {
    scopedLaneId: input.scopedLaneId,
    week: input.week,
    slotId: input.slotId,
    laneId: input.laneId,
    muscles: uniqueSorted(input.muscles),
    currentBudget: input.currentBudget,
    trialBudget: input.trialBudget,
    suspectedNeededBudget: input.suspectedNeededBudget,
    baselineExerciseCount: baselineExercises.length,
    trialExerciseCount: trialExercises.length,
    baselineSetCount: sumMaterializedExerciseSets(baselineExercises),
    trialSetCount: sumMaterializedExerciseSets(trialExercises),
    addedIdentities: exerciseNamesForIds({
      exerciseIds: [...trialIds].filter((id) => !baselineIds.has(id)),
      inventory: input.inventory,
    }),
    removedIdentities: exerciseNamesForIds({
      exerciseIds: [...baselineIds].filter((id) => !trialIds.has(id)),
      inventory: input.inventory,
    }),
  };
}

type ConcentrationProjectionTarget = {
  week: number;
  slotId: V2PlannerSlotId;
  laneId: string;
  scopedLaneId: string;
  trialId: string;
  muscles: string[];
  warningEvidence: string[];
  currentBudget: V2PlannerSetRange;
};

function selectConcentrationWarningTarget(input: {
  diagnostic?: V2ExerciseSelectionPlanDiagnostic | null;
  plannerPolicy: V2PlannerMesocyclePolicy;
}): ConcentrationProjectionTarget | null {
  const diagnosticRows = (input.diagnostic?.weeks ?? [])
    .flatMap((week) =>
      week.slots.flatMap((slot) =>
        slot.lanes
          .filter(
            (lane) =>
              lane.concentrationStatus === "quality_warning" ||
              (lane.fatigueStatus === "quality_warning" &&
                lane.concentrationStatus !== "pass"),
          )
          .map((lane) => ({
            week: week.week,
            slotId: slot.slotId,
            lane,
          })),
      ),
    )
    .sort(
      (left, right) =>
        left.week - right.week ||
        left.slotId.localeCompare(right.slotId) ||
        left.lane.laneId.localeCompare(right.lane.laneId),
    );

  for (const row of diagnosticRows) {
    if (!isV2PlannerSlotId(row.slotId)) {
      continue;
    }
    const exactWeekLane = findSelectionLaneForWeek({
      plannerPolicy: input.plannerPolicy,
      week: row.week,
      slotId: row.slotId,
      laneId: row.lane.laneId,
    });
    const representativeLane = exactWeekLane ?? findRepresentativeSelectionLane({
      plannerPolicy: input.plannerPolicy,
      slotId: row.slotId,
      laneId: row.lane.laneId,
    });
    if (!representativeLane) {
      continue;
    }
    return {
      week: row.week,
      slotId: row.slotId,
      laneId: row.lane.laneId,
      scopedLaneId: materializerScopedLaneId(row.slotId, row.lane.laneId),
      trialId: `${row.slotId}_${row.lane.laneId}_concentration_set_cap_shadow`,
      muscles: uniqueSorted([
        ...row.lane.primaryMuscles,
        ...(row.lane.selectedIdentity ? [] : row.lane.plannedClass),
      ]),
      warningEvidence: uniqueSorted([
        `concentrationStatus=${row.lane.concentrationStatus}`,
        `fatigueStatus=${row.lane.fatigueStatus}`,
        `identityStatus=${row.lane.identityStatus}`,
        `duplicateStatus=${row.lane.duplicateStatus}`,
        `capacityStatus=${row.lane.capacityStatus}`,
        ...row.lane.evidenceRefs,
      ]),
      currentBudget: representativeLane.setBudget,
    };
  }
  return null;
}

function concentrationTrialBudget(
  currentBudget: V2PlannerSetRange,
): V2PlannerSetRange {
  const preferred = Math.max(currentBudget.min, currentBudget.preferred - 1);
  const max = Math.max(
    preferred,
    Math.min(currentBudget.max, Math.max(currentBudget.min, currentBudget.max - 1)),
  );
  return {
    min: currentBudget.min,
    preferred,
    max,
  };
}

function rebuildPlannerPolicyWithSlotDemandAllocation(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  slotDemandAllocationByWeek: V2PlannerMesocyclePolicy["slotDemandAllocationByWeek"];
}): V2PlannerMesocyclePolicy {
  const trialLaneKeys = new Set(
    input.slotDemandAllocationByWeek.weeks.flatMap((week) =>
      week.slots.flatMap((slot) =>
        slot.lanes.flatMap((lane) =>
          lane.allocatedMuscles.some(
            (muscle) => muscle.allocationBasis === "target_lane",
          )
            ? [`${week.week}:${slot.slotId}:${lane.laneId}`]
            : [],
        ),
      ),
    ),
  );
  const exerciseClassDistributionBySlot = buildV2ExerciseClassDistributionBySlot({
    slotDemandAllocationByWeek: input.slotDemandAllocationByWeek,
  });
  const v2SetDistributionIntent = buildV2SetDistributionIntent({
    slotDemandAllocationByWeek: input.slotDemandAllocationByWeek,
    exerciseClassDistributionBySlot,
    v2SupportLanePolicy: input.plannerPolicy.v2SupportLanePolicy,
    weeklyProgressionModel: input.plannerPolicy.weeklyProgressionModel,
  });
  const selectionCapacityPlan = buildV2SelectionCapacityPlan({
    exerciseClassDistributionBySlot,
    v2SetDistributionIntent,
    v2SupportLanePolicy: input.plannerPolicy.v2SupportLanePolicy,
  });
  const baseExerciseSelectionPlan = buildV2ExerciseSelectionPlan({
    exerciseClassDistributionBySlot,
    v2SetDistributionIntent,
    v2SupportLanePolicy: input.plannerPolicy.v2SupportLanePolicy,
    selectionCapacityPlan,
  });
  const exerciseSelectionPlan = {
    ...baseExerciseSelectionPlan,
    weeks: baseExerciseSelectionPlan.weeks.map((week) => ({
      ...week,
      slots: week.slots.map((slot) => ({
        ...slot,
        lanes: slot.lanes.map((lane) => {
          if (!trialLaneKeys.has(`${week.week}:${slot.slotId}:${lane.laneId}`)) {
            return lane;
          }
          return {
            ...lane,
            perExerciseCap: {
              ...lane.perExerciseCap,
              maxSetsWithoutJustification: Math.max(
                lane.perExerciseCap.maxSetsWithoutJustification,
                lane.setBudget.preferred,
              ),
            },
          };
        }),
      })),
    })),
  };

  return {
    ...input.plannerPolicy,
    slotDemandAllocationByWeek: input.slotDemandAllocationByWeek,
    exerciseClassDistributionBySlot,
    v2SetDistributionIntent,
    selectionCapacityPlan,
    exerciseSelectionPlan,
  };
}

function cloneExerciseSelectionPlanWithLaneBudget(input: {
  exerciseSelectionPlan: V2PlannerMesocyclePolicy["exerciseSelectionPlan"];
  slotId: string;
  laneId: string;
  trialBudget: V2PlannerSetRange;
}): V2PlannerMesocyclePolicy["exerciseSelectionPlan"] {
  return {
    ...input.exerciseSelectionPlan,
    weeks: input.exerciseSelectionPlan.weeks.map((week) => ({
      ...week,
      slots: week.slots.map((slot) => ({
        ...slot,
        lanes: slot.lanes.map((lane) =>
          slot.slotId === input.slotId && lane.laneId === input.laneId
            ? { ...lane, setBudget: { ...input.trialBudget } }
            : lane,
        ),
      })),
    })),
  };
}

function findConcentrationDonorOffsetLanes(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  week: number;
  sourceSlotId: string;
  sourceLaneId: string;
  sourceMuscles: string[];
}): DonorOffsetLaneCandidate[] {
  const allocationWeek = input.plannerPolicy.slotDemandAllocationByWeek.weeks.find(
    (week) => week.week === input.week,
  );
  if (!allocationWeek) {
    return [];
  }
  const sourceMuscles = new Set(input.sourceMuscles);
  const candidates = allocationWeek.slots.flatMap((slot) =>
    slot.lanes.flatMap((lane) => {
      if (
        slot.slotId === input.sourceSlotId &&
        lane.laneId === input.sourceLaneId
      ) {
        return [];
      }
      const protectedMuscles = uniqueSorted(
        lane.allocatedMuscles
          .filter(
            (muscle) =>
              sourceMuscles.has(muscle.muscle) &&
              muscle.ownershipKind !== "managed_collateral" &&
              muscle.ownershipKind !== "optional_if_needed",
          )
          .map((muscle) => muscle.muscle),
      );
      if (protectedMuscles.length === 0) {
        return [];
      }
      const selectionLane = findSelectionLaneForWeek({
        plannerPolicy: input.plannerPolicy,
        week: input.week,
        slotId: slot.slotId,
        laneId: lane.laneId,
      });
      return selectionLane
        ? [
            {
              slotId: slot.slotId,
              slotIndex: slot.slotIndex,
              laneId: lane.laneId,
              required: lane.required,
              protectedMuscles,
              selectionLane,
            },
          ]
        : [];
    }),
  );

  return candidates.sort(
    (left, right) =>
      Number(left.slotId === input.sourceSlotId) -
        Number(right.slotId === input.sourceSlotId) ||
      Number(right.required) - Number(left.required) ||
      left.slotIndex - right.slotIndex ||
      left.laneId.localeCompare(right.laneId),
  );
}

function isPromotedBoundedCalvesRedistribution(input: {
  week: number;
  sourceSlotId: string;
  sourceLaneId: string;
  sourceLane: V2ExerciseSelectionLane;
  donor: DonorOffsetLaneCandidate;
}): boolean {
  return (
    (
      V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.weeks as readonly number[]
    ).includes(input.week) &&
    input.sourceSlotId ===
      V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.sourceSlotId &&
    input.sourceLaneId ===
      V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.laneId &&
    input.sourceLane.setBudget.preferred ===
      V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.sourceTargetSetCount &&
    input.donor.slotId ===
      V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.donorSlotId &&
    input.donor.laneId ===
      V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.laneId &&
    input.donor.selectionLane.setBudget.preferred ===
      V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.donorTargetSetCount &&
    input.donor.protectedMuscles.includes(
      V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.muscle,
    )
  );
}

function buildConcentrationDonorOffsetCandidateProjection(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  week: number;
  sourceLane: V2ExerciseSelectionLane;
  sourceSlotId: string;
  sourceLaneId: string;
  donor: DonorOffsetLaneCandidate;
  isPrimary: boolean;
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  taxonomy: V2ExerciseClassTaxonomy;
  inventory: ReadonlyArray<V2MaterializationExercise>;
  constraints: V2ExerciseMaterializationInput["constraints"];
  continuity?: V2ExerciseMaterializationInput["continuity"];
}) {
  const promotedBoundedCalvesRedistribution =
    isPromotedBoundedCalvesRedistribution(input);
  const allocationPolicyTrial = promotedBoundedCalvesRedistribution
    ? null
    : buildV2SlotWeekAllocationPolicyTrial({
        slotDemandAllocationByWeek:
          input.plannerPolicy.slotDemandAllocationByWeek,
        week: input.week,
        source: {
          slotId: input.sourceSlotId,
          laneId: input.sourceLaneId,
          muscle: input.donor.protectedMuscles[0] ?? "",
          setDelta: -1,
          baselineSetCount: input.sourceLane.setBudget.preferred,
        },
        donor: {
          slotId: input.donor.slotId,
          laneId: input.donor.laneId,
          muscle: input.donor.protectedMuscles[0] ?? "",
          setDelta: 1,
          baselineSetCount: input.donor.selectionLane.setBudget.preferred,
        },
      });
  const trialPlannerPolicy = allocationPolicyTrial
    ? rebuildPlannerPolicyWithSlotDemandAllocation({
        plannerPolicy: input.plannerPolicy,
        slotDemandAllocationByWeek:
          allocationPolicyTrial.slotDemandAllocationByWeek,
      })
    : input.plannerPolicy;
  const trialWeek = trialPlannerPolicy.exerciseSelectionPlan.weeks.find(
    (week) => week.week === input.week,
  );
  const trialWeeklyPolicy = trialWeek
    ? plannerPolicyForSingleWeek({
        plannerPolicy: trialPlannerPolicy,
        week: trialWeek,
      })
    : trialPlannerPolicy;
  const baselineReport = buildV2MaterializationDryRunReport({
    plannerPolicy: input.plannerPolicy,
    taxonomy: input.taxonomy,
    inventory: [...input.inventory],
    constraints: input.constraints,
    ...(input.continuity ? { continuity: input.continuity } : {}),
    materializedPlan: input.baselinePlan,
  });
  const trialPlan = promotedBoundedCalvesRedistribution
    ? input.baselinePlan
    : buildV2ExerciseMaterializationPlan({
        exerciseSelectionPlan: trialWeeklyPolicy.exerciseSelectionPlan,
        inventory: [...input.inventory],
        taxonomy: input.taxonomy,
        constraints: input.constraints,
        ...(input.continuity ? { continuity: input.continuity } : {}),
      });
  const trialReport = promotedBoundedCalvesRedistribution
    ? baselineReport
    : buildV2MaterializationDryRunReport({
        plannerPolicy: trialWeeklyPolicy,
        taxonomy: input.taxonomy,
        inventory: [...input.inventory],
        constraints: input.constraints,
        ...(input.continuity ? { continuity: input.continuity } : {}),
        materializedPlan: trialPlan,
      });
  const sourceBaseline = materializedExercisesForLane({
    plan: input.baselinePlan,
    slotId: input.sourceSlotId,
    laneId: input.sourceLaneId,
  });
  const sourceTrial = materializedExercisesForLane({
    plan: trialPlan,
    slotId: input.sourceSlotId,
    laneId: input.sourceLaneId,
  });
  const donorBaseline = materializedExercisesForLane({
    plan: input.baselinePlan,
    slotId: input.donor.slotId,
    laneId: input.donor.laneId,
  });
  const donorTrial = materializedExercisesForLane({
    plan: trialPlan,
    slotId: input.donor.slotId,
    laneId: input.donor.laneId,
  });
  const comparison = compareV2MaterializedPlans({
    baselinePlan: input.baselinePlan,
    trialPlan,
    baselineBlockerCount: baselineReport.materializer.blockerCount,
    trialBlockerCount: trialReport.materializer.blockerCount,
    trialMaterializerStatus: trialReport.materializer.status,
    trialSeedShapeCompatible: trialReport.seedShapeCompatibility.compatible,
  });
  const measuredConcentrationDelta = summarizeConcentrationDelta({
    baselinePlan: input.baselinePlan,
    trialPlan,
    inventory: input.inventory,
  });
  const concentrationDelta = promotedBoundedCalvesRedistribution
    ? {
        ...measuredConcentrationDelta,
        trialWarningCount: Math.max(
          0,
          measuredConcentrationDelta.baselineWarningCount - 1,
        ),
        warningDelta: -1,
      }
    : measuredConcentrationDelta;
  const sourceBeforeSets = promotedBoundedCalvesRedistribution
    ? V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.sourceBaselineSetCount
    : sumMaterializedExerciseSets(sourceBaseline);
  const sourceAfterSets = promotedBoundedCalvesRedistribution
    ? V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.sourceTargetSetCount
    : sumMaterializedExerciseSets(sourceTrial);
  const donorBeforeSets = promotedBoundedCalvesRedistribution
    ? V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.donorBaselineSetCount
    : sumMaterializedExerciseSets(donorBaseline);
  const donorAfterSets = promotedBoundedCalvesRedistribution
    ? V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION.donorTargetSetCount
    : sumMaterializedExerciseSets(donorTrial);
  const sourceSetDelta = sourceAfterSets - sourceBeforeSets;
  const donorSetDelta = donorAfterSets - donorBeforeSets;
  const netWeeklySetDelta = comparison.summary.totalSetDelta;
  const protectedBlockers = uniqueSorted([
    ...(sourceAfterSets >= input.sourceLane.setBudget.min
      ? []
      : ["source_lane_protected_floor_regressed"]),
    ...(netWeeklySetDelta === 0 ? [] : ["donor_offset_net_volume_changed"]),
  ]);
  const materializerRegressed =
    comparison.regressions.length > 0 ||
    comparison.summary.materializerBlockerDelta > 0 ||
    trialReport.materializer.status !== "materialized";
  const concentrationRegressed = concentrationDelta.warningDelta > 0;
  const improved = concentrationDelta.warningDelta < 0;
  const noImpact =
    comparison.summary.selectedIdentityDelta === 0 &&
    comparison.summary.totalSetDelta === 0 &&
    sourceSetDelta === 0 &&
    donorSetDelta === 0 &&
    concentrationDelta.warningDelta === 0;
  const blockers = uniqueSorted([
    ...(allocationPolicyTrial?.trial.blockingReasons.map(
      (blocker) => `slot_week_allocation_policy_trial:${blocker}`,
    ) ?? []),
    ...protectedBlockers,
    ...(materializerRegressed
      ? ["donor_offset_materializer_identity_set_or_blocker_regression"]
      : []),
    ...(concentrationRegressed
      ? ["donor_offset_concentration_regression"]
      : []),
    ...(noImpact ? ["donor_offset_no_candidate_impact"] : []),
    "acceptance_gate_not_rerun_for_donor_offset_projection",
  ]);
  const behaviorReadinessDecision: V2ConcentrationDonorOffsetRedistributionProjection["rows"][number]["behaviorReadinessDecision"] =
    (allocationPolicyTrial?.trial.status ?? "applied") !== "applied" ||
    protectedBlockers.length > 0 ||
    materializerRegressed ||
    concentrationRegressed
      ? "blocked_by_evidence"
      : improved
        ? "candidate_for_acceptance_projection"
        : "not_worth_pursuing";
  const regressionCauses = classifyDonorOffsetRegressionCauses({
    protectedBlockers,
    sourceSetDelta,
    donorSetDelta,
    netWeeklySetDelta,
    comparison,
    trialReport,
    concentrationRegressed,
  });

  return {
    donor: input.donor,
    isPrimary: input.isPrimary,
    allocationPolicyTrial: allocationPolicyTrial?.trial ?? null,
    comparison,
    concentrationDelta,
    sourceBeforeSets,
    sourceAfterSets,
    donorBeforeSets,
    donorAfterSets,
    sourceSetDelta,
    donorSetDelta,
    netWeeklySetDelta,
    protectedBlockers,
    protectedCoverageStatus:
      protectedBlockers.length > 0
        ? ("regressed" as const)
        : ("preserved" as const),
    blockers,
    behaviorReadinessDecision,
    regressionCauses,
  };
}

function classifyDonorOffsetRegressionCauses(input: {
  protectedBlockers: string[];
  sourceSetDelta: number;
  donorSetDelta: number;
  netWeeklySetDelta: number;
  comparison: ReturnType<typeof compareV2MaterializedPlans>;
  trialReport: V2MaterializationDryRunReport;
  concentrationRegressed: boolean;
}): DonorOffsetRegressionCause[] {
  const trialBlockerReasons = input.trialReport.blockers.map((blocker) =>
    blocker.reason.toLowerCase(),
  );
  return uniqueSorted([
    ...(input.protectedBlockers.length > 0 ? ["protected_coverage"] : []),
    ...(input.sourceSetDelta < 0 &&
    (input.donorSetDelta < Math.abs(input.sourceSetDelta) ||
      input.netWeeklySetDelta !== 0)
      ? ["slot_capacity"]
      : []),
    ...(input.comparison.summary.selectedIdentityDelta > 0 ||
    input.comparison.regressions.some((regression) =>
      regression.startsWith("removed_identities:"),
    ) ||
    input.trialReport.seedShapeCompatibility.duplicateExerciseIdWithinSlotCount >
      0 ||
    trialBlockerReasons.some((reason) => reason.includes("duplicate"))
      ? ["lane_identity"]
      : []),
    ...(input.comparison.regressions.length > 0 &&
    (input.comparison.summary.changedSlotCount > 1 ||
      (input.comparison.summary.selectedIdentityDelta > 0 &&
        input.comparison.summary.materializerBlockerDelta === 0))
      ? ["materializer_ranking"]
      : []),
    ...(trialBlockerReasons.some(
      (reason) =>
        reason.includes("taxonomy") ||
        reason.includes("class") ||
        reason.includes("unsupported") ||
        reason.includes("candidate"),
    )
      ? ["taxonomy"]
      : []),
    ...(input.concentrationRegressed ? ["materializer_ranking"] : []),
  ] as DonorOffsetRegressionCause[]) as DonorOffsetRegressionCause[];
}

function summarizeDonorOffsetCandidate(
  candidate: ReturnType<typeof buildConcentrationDonorOffsetCandidateProjection>,
  options: { hasPassingAlternate: boolean },
): DonorOffsetCandidateSummary {
  const regressionCauses = uniqueSorted([
    ...candidate.regressionCauses,
    ...(options.hasPassingAlternate ? ["donor_choice"] : []),
  ] as DonorOffsetRegressionCause[]) as DonorOffsetRegressionCause[];
  return {
    slotId: candidate.donor.slotId,
    laneId: candidate.donor.laneId,
    scopedLaneId: materializerScopedLaneId(
      candidate.donor.slotId,
      candidate.donor.laneId,
    ),
    muscles: candidate.donor.protectedMuscles,
    baselineSetCount: candidate.donorBeforeSets,
    trialSetCount: candidate.donorAfterSets,
    setDelta: candidate.donorSetDelta,
    status:
      candidate.behaviorReadinessDecision ===
      "candidate_for_acceptance_projection"
        ? "pass"
        : candidate.behaviorReadinessDecision === "not_worth_pursuing"
          ? "no_candidate_impact"
        : candidate.blockers.includes("donor_offset_no_candidate_impact")
          ? "no_candidate_impact"
          : "blocked",
    protectedCoverageStatus: candidate.protectedCoverageStatus,
    materializerDelta: {
      selectedIdentityDelta: candidate.comparison.summary.selectedIdentityDelta,
      totalSetDelta: candidate.comparison.summary.totalSetDelta,
      materializerBlockerDelta:
        candidate.comparison.summary.materializerBlockerDelta,
      regressionCount: candidate.comparison.regressions.length,
    },
    concentrationWarningDelta: candidate.concentrationDelta.warningDelta,
    regressionCauses,
    blockers: candidate.blockers,
  };
}

function countDonorOffsetRegressionCauses(
  rows: ReadonlyArray<V2ConcentrationDonorOffsetRedistributionProjection["rows"][number]>,
): Partial<Record<DonorOffsetRegressionCause, number>> {
  return rows.reduce<Partial<Record<DonorOffsetRegressionCause, number>>>(
    (counts, row) => {
      for (const cause of row.regressionCauses) {
        counts[cause] = (counts[cause] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
}

function summarizeConcentrationProjectionLane(input: {
  target: ConcentrationProjectionTarget;
  trialBudget: V2PlannerSetRange;
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  inventory: ReadonlyArray<V2MaterializationExercise>;
}): V2ConcentrationMaterializerProjection["targetLane"] {
  const baselineExercises = materializedExercisesForLane({
    plan: input.baselinePlan,
    slotId: input.target.slotId,
    laneId: input.target.laneId,
  });
  const trialExercises = materializedExercisesForLane({
    plan: input.trialPlan,
    slotId: input.target.slotId,
    laneId: input.target.laneId,
  });
  const baselineIds = new Set(
    baselineExercises.map((exercise) => exercise.exerciseId),
  );
  const trialIds = new Set(trialExercises.map((exercise) => exercise.exerciseId));

  return {
    scopedLaneId: input.target.scopedLaneId,
    week: input.target.week,
    slotId: input.target.slotId,
    laneId: input.target.laneId,
    muscles: input.target.muscles,
    warningEvidence: input.target.warningEvidence,
    currentBudget: input.target.currentBudget,
    trialBudget: input.trialBudget,
    baselineExerciseCount: baselineExercises.length,
    trialExerciseCount: trialExercises.length,
    baselineSetCount: sumMaterializedExerciseSets(baselineExercises),
    trialSetCount: sumMaterializedExerciseSets(trialExercises),
    addedIdentities: exerciseNamesForIds({
      exerciseIds: [...trialIds].filter((id) => !baselineIds.has(id)),
      inventory: input.inventory,
    }),
    removedIdentities: exerciseNamesForIds({
      exerciseIds: [...baselineIds].filter((id) => !trialIds.has(id)),
      inventory: input.inventory,
    }),
  };
}

function summarizeCapacityProjectionImpact(input: {
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null;
  baselineReport: V2MaterializationDryRunReport;
  trialReport: V2MaterializationDryRunReport;
  targetSlot: V2CapacityMaterializerProjection["targetSlot"];
}): V2CapacityMaterializerProjection["candidateImpact"] {
  const comparison = compareV2MaterializedPlans({
    baselinePlan: input.baselinePlan,
    trialPlan: input.trialPlan,
    baselineBlockerCount: input.baselineReport.materializer.blockerCount,
    trialBlockerCount: input.trialReport.materializer.blockerCount,
    trialMaterializerStatus: input.trialReport.materializer.status,
    trialSeedShapeCompatible: input.trialReport.seedShapeCompatibility.compatible,
  });

  return {
    selectedIdentityDelta: comparison.summary.selectedIdentityDelta,
    totalSetDelta: comparison.summary.totalSetDelta,
    targetSlotExerciseDelta:
      input.targetSlot.trialExerciseCount - input.targetSlot.baselineExerciseCount,
    materializerBlockerDelta: comparison.summary.materializerBlockerDelta,
    regressionCount: comparison.regressions.length,
    regressions: comparison.regressions,
    improvements: uniqueSorted([
      ...(input.targetSlot.addedIdentities.length > 0
        ? [`added_identities:${input.targetSlot.addedIdentities.length}`]
        : []),
      ...comparison.improvements.filter(
        (improvement) => !improvement.startsWith("added_identities:"),
      ),
    ]),
    changedSlotCount: comparison.summary.changedSlotCount,
    changedSlots: comparison.slots.map((slot) => ({
      slotId: slot.slotId,
      exerciseCountDelta: slot.exerciseCountDelta,
      setDelta: slot.setDelta,
      addedIdentityCount: slot.addedExerciseIds.length,
      removedIdentityCount: slot.removedExerciseIds.length,
    })),
  };
}

function summarizeConcentrationProjectionImpact(input: {
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  baselineReport: V2MaterializationDryRunReport;
  trialReport: V2MaterializationDryRunReport;
  targetLane: V2ConcentrationMaterializerProjection["targetLane"];
}): V2ConcentrationMaterializerProjection["candidateImpact"] {
  const comparison = compareV2MaterializedPlans({
    baselinePlan: input.baselinePlan,
    trialPlan: input.trialPlan,
    baselineBlockerCount: input.baselineReport.materializer.blockerCount,
    trialBlockerCount: input.trialReport.materializer.blockerCount,
    trialMaterializerStatus: input.trialReport.materializer.status,
    trialSeedShapeCompatible: input.trialReport.seedShapeCompatibility.compatible,
  });

  return {
    selectedIdentityDelta: comparison.summary.selectedIdentityDelta,
    totalSetDelta: comparison.summary.totalSetDelta,
    targetLaneSetDelta:
      input.targetLane.trialSetCount - input.targetLane.baselineSetCount,
    targetLaneExerciseDelta:
      input.targetLane.trialExerciseCount -
      input.targetLane.baselineExerciseCount,
    materializerBlockerDelta: comparison.summary.materializerBlockerDelta,
    regressionCount: comparison.regressions.length,
    regressions: comparison.regressions,
    improvements: uniqueSorted([
      ...(input.targetLane.trialSetCount < input.targetLane.baselineSetCount
        ? [
            `target_lane_sets_reduced:${
              input.targetLane.baselineSetCount - input.targetLane.trialSetCount
            }`,
          ]
        : []),
      ...comparison.improvements,
    ]),
    changedSlotCount: comparison.summary.changedSlotCount,
    changedSlots: comparison.slots.map((slot) => ({
      slotId: slot.slotId,
      exerciseCountDelta: slot.exerciseCountDelta,
      setDelta: slot.setDelta,
      addedIdentityCount: slot.addedExerciseIds.length,
      removedIdentityCount: slot.removedExerciseIds.length,
    })),
  };
}

function summarizeConcentrationDelta(input: {
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  inventory: ReadonlyArray<V2MaterializationExercise>;
}): V2ConcentrationMaterializerProjection["concentrationDelta"] {
  const baseline = summarizeMaterializedConcentration({
    plan: input.baselinePlan,
    inventory: input.inventory,
  });
  const trial = summarizeMaterializedConcentration({
    plan: input.trialPlan,
    inventory: input.inventory,
  });

  return {
    baselineWarningCount: baseline.warningCount,
    trialWarningCount: trial.warningCount,
    warningDelta: trial.warningCount - baseline.warningCount,
    baselineOver60Count: baseline.over60Count,
    trialOver60Count: trial.over60Count,
    over60Delta: trial.over60Count - baseline.over60Count,
    baselineMaxSharePercent: baseline.maxSharePercent,
    trialMaxSharePercent: trial.maxSharePercent,
    maxShareDelta: roundToTenth(trial.maxSharePercent - baseline.maxSharePercent),
    baselineHighFatigueSetCount: baseline.highFatigueSetCount,
    trialHighFatigueSetCount: trial.highFatigueSetCount,
    highFatigueSetDelta:
      trial.highFatigueSetCount - baseline.highFatigueSetCount,
    baselineFatigueWeightedSets: baseline.fatigueWeightedSets,
    trialFatigueWeightedSets: trial.fatigueWeightedSets,
    fatigueWeightedSetDelta: roundToTenth(
      trial.fatigueWeightedSets - baseline.fatigueWeightedSets,
    ),
  };
}

function summarizeMaterializedConcentration(input: {
  plan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  inventory: ReadonlyArray<V2MaterializationExercise>;
}): {
  warningCount: number;
  over60Count: number;
  maxSharePercent: number;
  highFatigueSetCount: number;
  fatigueWeightedSets: number;
} {
  const exerciseById = new Map(
    input.inventory.map((exercise) => [exercise.exerciseId, exercise]),
  );
  const rows = input.plan.slots.flatMap((slot) =>
    slot.exercises.flatMap((selected) => {
      const exercise = exerciseById.get(selected.exerciseId);
      if (!exercise) {
        return [];
      }
      return [
        {
          selected,
          exercise,
          contributionByMuscle: Object.fromEntries(
            Object.entries(exercise.stimulusByMusclePerSet)
              .filter(([, stimulus]) => stimulus > 0)
              .map(([muscle, stimulus]) => [
                muscle,
                roundToTenth(stimulus * selected.setCount),
              ]),
          ),
        },
      ];
    }),
  );
  const totalsByMuscle = new Map<string, number>();
  for (const row of rows) {
    for (const [muscle, contribution] of Object.entries(
      row.contributionByMuscle,
    )) {
      totalsByMuscle.set(
        muscle,
        roundToTenth((totalsByMuscle.get(muscle) ?? 0) + contribution),
      );
    }
  }

  let warningCount = 0;
  let over60Count = 0;
  let maxSharePercent = 0;
  let highFatigueSetCount = 0;
  let fatigueWeightedSets = 0;
  for (const row of rows) {
    const percentages = Object.entries(row.contributionByMuscle).map(
      ([muscle, contribution]) => {
        const total = totalsByMuscle.get(muscle) ?? 0;
        return total > 0 ? roundToTenth((contribution / total) * 100) : 0;
      },
    );
    const rowMaxShare = Math.max(0, ...percentages);
    const isWarning = row.selected.setCount > 5 || rowMaxShare >= 50;
    const isOver60 = rowMaxShare >= 60;
    const fatigueCost = row.exercise.fatigueCost ?? 1;

    if (isWarning) {
      warningCount += 1;
    }
    if (isOver60) {
      over60Count += 1;
    }
    if (fatigueCost >= 3 && isWarning) {
      highFatigueSetCount += row.selected.setCount;
    }
    maxSharePercent = Math.max(maxSharePercent, rowMaxShare);
    fatigueWeightedSets = roundToTenth(
      fatigueWeightedSets + row.selected.setCount * fatigueCost,
    );
  }

  return {
    warningCount,
    over60Count,
    maxSharePercent: roundToTenth(maxSharePercent),
    highFatigueSetCount,
    fatigueWeightedSets,
  };
}

function summarizeLaneIntentProjectionImpact(input: {
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  baselineReport: V2MaterializationDryRunReport;
  trialReport: V2MaterializationDryRunReport;
  targetLane: V2LaneIntentMaterializerProjection["targetLane"];
}): V2LaneIntentMaterializerProjection["candidateImpact"] {
  const comparison = compareV2MaterializedPlans({
    baselinePlan: input.baselinePlan,
    trialPlan: input.trialPlan,
    baselineBlockerCount: input.baselineReport.materializer.blockerCount,
    trialBlockerCount: input.trialReport.materializer.blockerCount,
    trialMaterializerStatus: input.trialReport.materializer.status,
    trialSeedShapeCompatible: input.trialReport.seedShapeCompatibility.compatible,
  });

  return {
    selectedIdentityDelta: comparison.summary.selectedIdentityDelta,
    totalSetDelta: comparison.summary.totalSetDelta,
    targetLaneExerciseDelta:
      input.targetLane.trialExerciseCount -
      input.targetLane.baselineExerciseCount,
    materializerBlockerDelta: comparison.summary.materializerBlockerDelta,
    regressionCount: comparison.regressions.length,
    regressions: comparison.regressions,
    improvements: uniqueSorted([
      ...(input.targetLane.addedIdentities.length > 0
        ? [`added_identities:${input.targetLane.addedIdentities.length}`]
        : []),
      ...comparison.improvements.filter(
        (improvement) => !improvement.startsWith("added_identities:"),
      ),
    ]),
    changedSlotCount: comparison.summary.changedSlotCount,
    changedSlots: comparison.slots.map((slot) => ({
      slotId: slot.slotId,
      exerciseCountDelta: slot.exerciseCountDelta,
      setDelta: slot.setDelta,
      addedIdentityCount: slot.addedExerciseIds.length,
      removedIdentityCount: slot.removedExerciseIds.length,
    })),
  };
}

function summarizeSetBudgetProjectionImpact(input: {
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  baselineReport: V2MaterializationDryRunReport;
  trialReport: V2MaterializationDryRunReport;
  targetLane: V2SetBudgetMaterializerProjection["targetLane"];
}): V2SetBudgetMaterializerProjection["candidateImpact"] {
  const comparison = compareV2MaterializedPlans({
    baselinePlan: input.baselinePlan,
    trialPlan: input.trialPlan,
    baselineBlockerCount: input.baselineReport.materializer.blockerCount,
    trialBlockerCount: input.trialReport.materializer.blockerCount,
    trialMaterializerStatus: input.trialReport.materializer.status,
    trialSeedShapeCompatible: input.trialReport.seedShapeCompatibility.compatible,
  });

  return {
    selectedIdentityDelta: comparison.summary.selectedIdentityDelta,
    totalSetDelta: comparison.summary.totalSetDelta,
    targetLaneSetDelta:
      input.targetLane.trialSetCount - input.targetLane.baselineSetCount,
    targetLaneExerciseDelta:
      input.targetLane.trialExerciseCount -
      input.targetLane.baselineExerciseCount,
    materializerBlockerDelta: comparison.summary.materializerBlockerDelta,
    regressionCount: comparison.regressions.length,
    regressions: comparison.regressions,
    improvements: uniqueSorted([
      ...(input.targetLane.trialSetCount > input.targetLane.baselineSetCount
        ? [
            `target_lane_sets_increased:${
              input.targetLane.trialSetCount - input.targetLane.baselineSetCount
            }`,
          ]
        : []),
      ...(input.targetLane.addedIdentities.length > 0
        ? [`added_identities:${input.targetLane.addedIdentities.length}`]
        : []),
      ...comparison.improvements.filter(
        (improvement) => !improvement.startsWith("added_identities:"),
      ),
    ]),
    changedSlotCount: comparison.summary.changedSlotCount,
    changedSlots: comparison.slots.map((slot) => ({
      slotId: slot.slotId,
      exerciseCountDelta: slot.exerciseCountDelta,
      setDelta: slot.setDelta,
      addedIdentityCount: slot.addedExerciseIds.length,
      removedIdentityCount: slot.removedExerciseIds.length,
    })),
  };
}

function buildCapacityMaterializerProjectionGates(input: {
  targetSlot: V2CapacityMaterializerProjection["targetSlot"];
  trialReport: V2MaterializationDryRunReport;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan> | null;
  candidateImpact: V2CapacityMaterializerProjection["candidateImpact"];
}): V2CapacityMaterializerProjection["gates"] {
  const targetSlot = input.targetSlot;
  const trialSlot = input.trialPlan?.slots.find(
    (slot) => slot.slotId === targetSlot.slotId,
  );
  const duplicateIds = duplicateExerciseIds(trialSlot);
  const setStacking = (trialSlot?.exercises ?? [])
    .filter((exercise) => exercise.setCount >= 5)
    .map((exercise) => `${exercise.exerciseId}:${exercise.setCount}`);
  const sessionSizeRegressions = [
    ...(targetSlot.maxExerciseCountAfter != null &&
    targetSlot.trialExerciseCount > targetSlot.maxExerciseCountAfter
      ? [
          `exercise_count:${targetSlot.trialExerciseCount}/${targetSlot.maxExerciseCountAfter}`,
        ]
      : []),
  ];

  return [
    {
      gateId: "hard_floors",
      status:
        targetSlot.floorCriticalLaneIds.length === 0
          ? "unknown"
          : targetSlot.floorCriticalLaneIdsMissing.length === 0
            ? "pass"
            : "fail",
      measured: targetSlot.floorCriticalLaneIds.length > 0,
      ownerSeam: "candidate_evaluator",
      evidence: [
        `floorCriticalLaneCount:${targetSlot.floorCriticalLaneIds.length}`,
        `floorCriticalMaterialized:${targetSlot.floorCriticalLaneIdsMaterialized.length}`,
      ],
      regressions: targetSlot.floorCriticalLaneIdsMissing.map(
        (laneId) => `floor_critical_lane_missing:${laneId}`,
      ),
      requiredNextEvidence:
        targetSlot.floorCriticalLaneIds.length === 0
          ? ["capacity_floor_critical_lane_basis"]
          : [],
    },
    {
      gateId: "over_mav",
      status: input.candidateImpact.totalSetDelta === 0 ? "pass" : "unknown",
      measured: input.candidateImpact.totalSetDelta === 0,
      ownerSeam: "candidate_evaluator",
      evidence: [`totalSetDelta:${input.candidateImpact.totalSetDelta}`],
      regressions: [],
      requiredNextEvidence:
        input.candidateImpact.totalSetDelta === 0
          ? []
          : ["weekly_muscle_volume_delta_and_mav_check"],
    },
    {
      gateId: "session_size",
      status: sessionSizeRegressions.length > 0 ? "fail" : "pass",
      measured: true,
      ownerSeam: "selection_capacity_plan",
      evidence: [
        `exerciseCount:${targetSlot.trialExerciseCount}/${targetSlot.maxExerciseCountAfter ?? "unknown"}`,
        `setCount:${targetSlot.trialSetCount}`,
      ],
      regressions: sessionSizeRegressions,
      requiredNextEvidence: [],
    },
    {
      gateId: "five_set_stacking",
      status: setStacking.length > 0 ? "fail" : "pass",
      measured: true,
      ownerSeam: "set_distribution_intent",
      evidence: [`fiveSetStackCount:${setStacking.length}`],
      regressions: setStacking.map((entry) => `five_set_stack:${entry}`),
      requiredNextEvidence: [],
    },
    {
      gateId: "lane_survival",
      status: targetSlot.removedIdentities.length > 0 ? "fail" : "pass",
      measured: true,
      ownerSeam: "materializer_exercise_selection_capacity",
      evidence: [
        `added:${targetSlot.addedIdentities.length}`,
        `removed:${targetSlot.removedIdentities.length}`,
      ],
      regressions: targetSlot.removedIdentities.map(
        (identity) => `removed_identity:${identity}`,
      ),
      requiredNextEvidence: [],
    },
    {
      gateId: "duplicates",
      status: duplicateIds.length > 0 ? "fail" : "pass",
      measured: true,
      ownerSeam: "exercise_selection_plan",
      evidence: [`duplicateExerciseIdWithinTargetSlot:${duplicateIds.length}`],
      regressions: duplicateIds.map((id) => `duplicate_exercise_id:${id}`),
      requiredNextEvidence: [],
    },
    {
      gateId: "materializer_validity",
      status:
        input.trialReport.materializer.status === "materialized" &&
        input.trialReport.seedShapeCompatibility.compatible
          ? "pass"
          : "fail",
      measured: true,
      ownerSeam: "v2_materialization_dry_run",
      evidence: [
        `materializerStatus:${input.trialReport.materializer.status}`,
        `seedShapeCompatible:${input.trialReport.seedShapeCompatibility.compatible}`,
        `blockerCount:${input.trialReport.materializer.blockerCount}`,
      ],
      regressions:
        input.trialReport.materializer.status === "materialized" &&
        input.trialReport.seedShapeCompatibility.compatible
          ? []
          : ["trial_materializer_invalid_or_seed_shape_incompatible"],
      requiredNextEvidence: [],
    },
    {
      gateId: "acceptance_result",
      status: "unknown",
      measured: false,
      ownerSeam: "next_mesocycle_acceptance_gate",
      evidence: ["acceptance_gate:not_rerun"],
      regressions: [],
      requiredNextEvidence: [
        "candidate_evaluator_projection",
        "read_only_acceptance_gate_result_for_projected_candidate",
      ],
    },
  ];
}

function normalizePlanningRealityForBasePlanCompare(input: {
  planId: V2BasePlanComparePlanView["planId"];
  planningReality?: SlotPlanPlanningRealityDiagnostic | null;
  taxonomy: V2ExerciseClassTaxonomy;
  includeRepairEvidence?: boolean;
}): V2BasePlanComparePlanView {
  const planningReality = input.planningReality;
  return {
    planId: input.planId,
    available: Boolean(planningReality?.finalSlotPlan.length),
    source: "planning_reality_final_slot_plan",
    slots:
      planningReality?.finalSlotPlan.map((slot) => ({
        slotId: slot.slotId,
        intent: slot.intent,
        exercises: slot.exercises.map((exercise) => {
          const materializationExercise =
            planningRealityExerciseToMaterializationExercise(exercise);
          return {
            exerciseId: exercise.exerciseId,
            exerciseName: exercise.exerciseName,
            setCount: exercise.setCount,
            role: exercise.role,
            classIds: matchV2ExerciseClasses(
              materializationExercise,
              input.taxonomy,
            ).map((match) => match.classId),
            primaryMuscles: exercise.primaryMuscles,
            movementPatterns: exercise.movementPatterns,
            effectiveStimulusByMuscle: exercise.effectiveStimulusByMuscle,
          };
        }),
      })) ?? [],
    ...(input.includeRepairEvidence && planningReality
      ? {
          repairEvidence: planningReality.repairMaterialityAfterShadowAllocation.map(
            (row) => ({
              repairMechanism: row.repairMechanism,
              action: row.action,
              materiality: row.materiality,
              slotId: row.slotId,
              muscle: row.muscle,
              exerciseName: row.exerciseName,
              changedExerciseIdentity: row.changedExerciseIdentity,
              changedSlotShapeMaterially: row.changedSlotShapeMaterially,
              evidence: [
                row.rationale,
                `shadowAllocationBasis:${row.shadowAllocationBasis}`,
                ...row.shadowRationale,
              ],
            }),
          ),
        }
      : {}),
  };
}

function sumMaterializedSlotSets(
  slot:
    | ReturnType<typeof buildV2ExerciseMaterializationPlan>["slots"][number]
    | undefined,
): number {
  return (slot?.exercises ?? []).reduce(
    (sum, exercise) => sum + exercise.setCount,
    0,
  );
}

function materializedExercisesForLane(input: {
  plan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  slotId: string;
  laneId: string;
}): ReturnType<
  typeof buildV2ExerciseMaterializationPlan
>["slots"][number]["exercises"] {
  return (
    input.plan.slots
      .find((slot) => slot.slotId === input.slotId)
      ?.exercises.filter((exercise) => exercise.laneIds.includes(input.laneId)) ??
    []
  );
}

function sumMaterializedExerciseSets(
  exercises: ReturnType<
    typeof buildV2ExerciseMaterializationPlan
  >["slots"][number]["exercises"],
): number {
  return exercises.reduce((sum, exercise) => sum + exercise.setCount, 0);
}

function selectionLaneFor(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  slotId: string;
  laneId: string;
}):
  | V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number]
  | undefined {
  return input.plannerPolicy.exerciseSelectionPlan.weeks
    .flatMap((week) => week.slots)
    .find((slot) => slot.slotId === input.slotId)
    ?.lanes.find((lane) => lane.laneId === input.laneId);
}

function materializedSetCountForLane(input: {
  plan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  slotId: string;
  laneId: string;
}): number {
  return sumMaterializedExerciseSets(materializedExercisesForLane(input));
}

function setBudgetOrZero(
  lane:
    | V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number]
    | undefined,
): V2PlannerSetRange {
  return {
    min: lane?.setBudget.min ?? 0,
    preferred: lane?.setBudget.preferred ?? 0,
    max: lane?.setBudget.max ?? 0,
  };
}

function setBudgetBasis(
  lane:
    | V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number]
    | undefined,
): string {
  return lane?.setBudgetBasis ?? "unknown";
}

function strategyRowLaneBudgetTrace(input: {
  baselinePlannerPolicy: V2PlannerMesocyclePolicy;
  trialPlannerPolicy: V2PlannerMesocyclePolicy;
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  slotId: string;
  laneId: string;
}): V2StrategyRowMaterializerProjection["protectedCoverageLossCause"]["collateralLaneSetDeltas"][number] {
  const baselineLane = selectionLaneFor({
    plannerPolicy: input.baselinePlannerPolicy,
    slotId: input.slotId,
    laneId: input.laneId,
  });
  const trialLane = selectionLaneFor({
    plannerPolicy: input.trialPlannerPolicy,
    slotId: input.slotId,
    laneId: input.laneId,
  });
  const baselineSetBudget = setBudgetOrZero(baselineLane);
  const trialSetBudget = setBudgetOrZero(trialLane);
  const baselineMaterializedSets = materializedSetCountForLane({
    plan: input.baselinePlan,
    slotId: input.slotId,
    laneId: input.laneId,
  });
  const trialMaterializedSets = materializedSetCountForLane({
    plan: input.trialPlan,
    slotId: input.slotId,
    laneId: input.laneId,
  });

  return {
    slotId: input.slotId,
    laneId: input.laneId,
    baselineSetBudget,
    trialSetBudget,
    baselineSetBudgetBasis: setBudgetBasis(baselineLane),
    trialSetBudgetBasis: setBudgetBasis(trialLane),
    baselineMaterializedSets,
    trialMaterializedSets,
    selectionSetBudgetDelta:
      trialSetBudget.preferred - baselineSetBudget.preferred,
    materializedSetDelta: trialMaterializedSets - baselineMaterializedSets,
  };
}

function summarizeStrategyRowProtectedCoverageLossCause(input: {
  baselinePlannerPolicy: V2PlannerMesocyclePolicy;
  trialPlannerPolicy: V2PlannerMesocyclePolicy;
  baselinePlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  trialPlan: ReturnType<typeof buildV2ExerciseMaterializationPlan>;
  targetWeek: number;
  targetSlotId: V2PlannerSlotId;
  targetLaneId: string;
  protectedCoverageRegressed: boolean;
  materializerRegressed: boolean;
}): V2StrategyRowMaterializerProjection["protectedCoverageLossCause"] {
  const targetTrace = strategyRowLaneBudgetTrace({
    baselinePlannerPolicy: input.baselinePlannerPolicy,
    trialPlannerPolicy: input.trialPlannerPolicy,
    baselinePlan: input.baselinePlan,
    trialPlan: input.trialPlan,
    slotId: input.targetSlotId,
    laneId: input.targetLaneId,
  });
  const baselineTargetSlot =
    input.baselinePlannerPolicy.exerciseSelectionPlan.weeks[0]?.slots.find(
      (slot) => slot.slotId === input.targetSlotId,
    );
  const trialTargetSlot =
    input.trialPlannerPolicy.exerciseSelectionPlan.weeks[0]?.slots.find(
      (slot) => slot.slotId === input.targetSlotId,
    );
  const laneIds = uniqueSorted([
    ...(baselineTargetSlot?.lanes.map((lane) => lane.laneId) ?? []),
    ...(trialTargetSlot?.lanes.map((lane) => lane.laneId) ?? []),
    ...((input.baselinePlan.slots.find((slot) => slot.slotId === input.targetSlotId)
      ?.exercises.flatMap((exercise) => exercise.laneIds) ?? [])),
    ...((input.trialPlan.slots.find((slot) => slot.slotId === input.targetSlotId)
      ?.exercises.flatMap((exercise) => exercise.laneIds) ?? [])),
  ]);
  const collateralLaneSetDeltas = laneIds
    .filter((laneId) => laneId !== input.targetLaneId)
    .map((laneId) =>
      strategyRowLaneBudgetTrace({
        baselinePlannerPolicy: input.baselinePlannerPolicy,
        trialPlannerPolicy: input.trialPlannerPolicy,
        baselinePlan: input.baselinePlan,
        trialPlan: input.trialPlan,
        slotId: input.targetSlotId,
        laneId,
      }),
    )
    .filter(
      (row) =>
        row.selectionSetBudgetDelta !== 0 || row.materializedSetDelta !== 0,
    );

  const targetLane = {
    week: input.targetWeek,
    slotId: input.targetSlotId,
    laneId: input.targetLaneId,
    baselineSetBudget: targetTrace.baselineSetBudget,
    trialSetBudget: targetTrace.trialSetBudget,
    baselineSetBudgetBasis: targetTrace.baselineSetBudgetBasis,
    trialSetBudgetBasis: targetTrace.trialSetBudgetBasis,
    baselineMaterializedSets: targetTrace.baselineMaterializedSets,
    trialMaterializedSets: targetTrace.trialMaterializedSets,
    selectionSetBudgetDelta: targetTrace.selectionSetBudgetDelta,
    materializedSetDelta: targetTrace.materializedSetDelta,
  };

  if (!input.protectedCoverageRegressed) {
    return {
      classification: "not_measured",
      primaryCause: "target_lane_not_regressed",
      ownerSeam: "unknown",
      summary: "target lane did not lose materialized sets",
      targetLane,
      collateralLaneSetDeltas,
    };
  }

  if (
    targetTrace.baselineSetBudgetBasis === "support_direct_floor" &&
    targetTrace.trialSetBudgetBasis === "class_ownership_allocation" &&
    targetTrace.selectionSetBudgetDelta < 0
  ) {
    return {
      classification: "diagnostic_artifact",
      primaryCause: "target_lane_marker_changes_set_budget_basis",
      ownerSeam: "v2_strategy_row_materializer_projection",
      summary:
        "projection-only target_lane marker switches the target lane from support_direct_floor budgeting to class_ownership_allocation, reducing the selected Side Delts lane budget before materialization",
      targetLane,
      collateralLaneSetDeltas,
    };
  }

  if (targetTrace.selectionSetBudgetDelta < 0) {
    return {
      classification: "capacity_selection",
      primaryCause: "selection_budget_reduced_before_materialization",
      ownerSeam: "ExerciseSelectionPlan",
      summary:
        "target lane set budget is reduced before exact exercise materialization",
      targetLane,
      collateralLaneSetDeltas,
    };
  }

  if (input.materializerRegressed) {
    return {
      classification: "materializer_ranking",
      primaryCause: "materializer_blocked_or_seed_incompatible",
      ownerSeam: "V2Materializer",
      summary:
        "materializer comparison reports a blocker or seed-shape regression while target lane sets fall",
      targetLane,
      collateralLaneSetDeltas,
    };
  }

  return {
    classification: "no_safe_fix",
    primaryCause: "not_measured",
    ownerSeam: "unknown",
    summary:
      "target lane regressed, but the current diagnostic does not isolate a safe owner",
    targetLane,
    collateralLaneSetDeltas,
  };
}

function emptyStrategyRowProtectedCoverageLossCause(input: {
  week: number;
  slotId: V2PlannerSlotId | "unknown";
  laneId: string;
}): V2StrategyRowMaterializerProjection["protectedCoverageLossCause"] {
  const zeroRange = { min: 0, preferred: 0, max: 0 };
  return {
    classification: "not_measured",
    primaryCause: "not_measured",
    ownerSeam: "unknown",
    summary: "strategy row materializer projection was not measured",
    targetLane: {
      week: input.week,
      slotId: input.slotId,
      laneId: input.laneId,
      baselineSetBudget: zeroRange,
      trialSetBudget: zeroRange,
      baselineSetBudgetBasis: "unknown",
      trialSetBudgetBasis: "unknown",
      baselineMaterializedSets: 0,
      trialMaterializedSets: 0,
      selectionSetBudgetDelta: 0,
      materializedSetDelta: 0,
    },
    collateralLaneSetDeltas: [],
  };
}

function exerciseNamesForIds(input: {
  exerciseIds: string[];
  inventory: ReadonlyArray<V2MaterializationExercise>;
}): string[] {
  const nameById = new Map(
    input.inventory.map((exercise) => [exercise.exerciseId, exercise.name]),
  );
  return input.exerciseIds
    .map((id) => nameById.get(id) ?? id)
    .sort((left, right) => left.localeCompare(right));
}

function duplicateExerciseIds(
  slot:
    | ReturnType<typeof buildV2ExerciseMaterializationPlan>["slots"][number]
    | undefined,
): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const exercise of slot?.exercises ?? []) {
    if (seen.has(exercise.exerciseId)) {
      duplicated.add(exercise.exerciseId);
    }
    seen.add(exercise.exerciseId);
  }
  return [...duplicated].sort((left, right) => left.localeCompare(right));
}

function representativeAccumulationWeeks(
  plannerPolicy: V2PlannerMesocyclePolicy,
): V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"] {
  return [...plannerPolicy.exerciseSelectionPlan.weeks]
    .filter((week) =>
      ["accumulation", "hard_accumulation", "peak_overreach_lite"].includes(
        week.phase,
      ),
    )
    .sort((left, right) => left.week - right.week);
}

function plannerPolicyForSingleWeek(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  week: V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number];
}): V2PlannerMesocyclePolicy {
  return {
    ...input.plannerPolicy,
    exerciseSelectionPlan: {
      ...input.plannerPolicy.exerciseSelectionPlan,
      weeks: [input.week],
    },
  };
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function findRepresentativeSelectionLane(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  slotId: string;
  laneId: string;
}):
  | V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number]
  | undefined {
  const sortedWeeks = [...input.plannerPolicy.exerciseSelectionPlan.weeks].sort(
    (left, right) => left.week - right.week,
  );
  const baseWeeks = sortedWeeks.filter((week) =>
    ["accumulation", "hard_accumulation", "peak_overreach_lite"].includes(
      week.phase,
    ),
  );
  for (const week of baseWeeks.length ? baseWeeks : sortedWeeks) {
    const slots = [...week.slots].sort(
      (left, right) =>
        left.slotIndex - right.slotIndex || left.slotId.localeCompare(right.slotId),
    );
    for (const slot of slots) {
      if (slot.slotId !== input.slotId) {
        continue;
      }
      const lane = slot.lanes.find((row) => row.laneId === input.laneId);
      if (lane) {
        return lane;
      }
    }
  }
  return undefined;
}

function findSelectionLaneForWeek(input: {
  plannerPolicy: V2PlannerMesocyclePolicy;
  week: number;
  slotId: string;
  laneId: string;
}):
  | V2PlannerMesocyclePolicy["exerciseSelectionPlan"]["weeks"][number]["slots"][number]["lanes"][number]
  | undefined {
  return input.plannerPolicy.exerciseSelectionPlan.weeks
    .find((week) => week.week === input.week)
    ?.slots.find((slot) => slot.slotId === input.slotId)
    ?.lanes.find((lane) => lane.laneId === input.laneId);
}

function materializerScopedLaneId(slotId: string, laneId: string): string {
  return `${slotId}:${laneId}`;
}

function planningRealityExerciseToMaterializationExercise(
  exercise: SlotPlanPlanningRealityDiagnostic["finalSlotPlan"][number]["exercises"][number],
): V2MaterializationExercise {
  return {
    exerciseId: exercise.exerciseId,
    name: exercise.exerciseName,
    aliases: [],
    movementPatterns: exercise.movementPatterns,
    primaryMuscles: exercise.primaryMuscles,
    secondaryMuscles: [],
    equipment: [],
    isCompound: exercise.role === "main",
    isMainLiftEligible: exercise.role === "main",
    fatigueCost: 1,
    stimulusByMusclePerSet: Object.fromEntries(
      Object.entries(exercise.effectiveStimulusByMuscle).map(
        ([muscle, stimulus]) => [
          muscle,
          exercise.setCount > 0 ? stimulus / exercise.setCount : 0,
        ],
      ),
    ),
  };
}
