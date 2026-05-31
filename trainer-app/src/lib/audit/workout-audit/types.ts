import type { SessionIntent } from "@/lib/engine/session-types";
import type {
  V2BasePlanCompare,
  V2BasePlanShadowConsumptionTrial,
  V2MesocycleStrategyDiagnostic,
  V2SetDistributionIntent,
  V2StrategyToDemandProjection,
  V2SupportLanePolicy,
} from "@/lib/engine/planning/v2";
import type { V2LaneSelectionIntentAudit } from "@/lib/engine/planning/v2/lane-selection-intent-audit";
import type {
  PlannerDiagnosticsMode,
  SessionCompositionSource,
  SessionSlotSnapshot,
} from "@/lib/evidence/types";
import type { NextWorkoutContext } from "@/lib/api/next-session";
import type {
  ProjectedWeekVolumeMuscleRow,
  ProjectedWeekVolumeSessionSummary,
} from "@/lib/api/projected-week-volume";
import type { RuntimeDoseAdjustmentDiagnostic } from "@/lib/api/runtime-dose-guidance";
import type { PlannerOnlyPolicyOverride } from "@/lib/api/planner-only-policy-override";
import type {
  PlannerOwnedAccumulationProjection,
  V2ExerciseSelectionPlanDiagnostic,
  V2SelectionCapacityPlanDiagnostic,
  V2SupportLaneProjectionDiagnostic,
} from "@/lib/api/planning-reality";
import type { V2CapacityMaterializerProjection } from "./v2-materialization-live-context-dry-run";
import type { SlotPlanPlanningRealityDiagnostic } from "@/lib/api/mesocycle-handoff-slot-plan-projection.diagnostics";
import type { V2AcceptedSeedPreparationCompareResult } from "@/lib/api/mesocycle-handoff";
import type { SlotPreselectionDemandDiagnostic } from "@/lib/api/mesocycle-handoff-slot-plan-projection";
import type { SessionGenerationResult } from "@/lib/api/template-session/types";
import type {
  ProgressionDecisionTrace,
  SessionAuditMutationSummary,
  SessionAuditSnapshot,
} from "@/lib/evidence/session-audit-types";
import type { AuditSessionGenerationResult } from "./exposed-muscles";
import {
  ACTIVE_MESOCYCLE_SLOT_RESEED_AUDIT_PAYLOAD_VERSION,
  HISTORICAL_WEEK_AUDIT_PAYLOAD_VERSION,
  MESOCYCLE_EXPLAIN_AUDIT_PAYLOAD_VERSION,
  NEXT_MESOCYCLE_ACCEPTANCE_GATE_AUDIT_PAYLOAD_VERSION,
  NEXT_MESOCYCLE_HANDOFF_DRY_RUN_AUDIT_PAYLOAD_VERSION,
  NEXT_MESOCYCLE_POST_ACCEPT_VERIFICATION_AUDIT_PAYLOAD_VERSION,
  PROJECTED_WEEK_VOLUME_AUDIT_PAYLOAD_VERSION,
  REPLACE_EMPTY_MESOCYCLE_WITH_V2_AUDIT_PAYLOAD_VERSION,
  PROGRESSION_ANCHOR_AUDIT_PAYLOAD_VERSION,
  V2_ACCEPTED_SEED_PREPARE_COMPARE_AUDIT_PAYLOAD_VERSION,
  WEEKLY_RETRO_AUDIT_PAYLOAD_VERSION,
  WORKOUT_AUDIT_ARTIFACT_VERSION,
} from "./constants";
import type { ReplaceEmptyMesocycleWithV2Result } from "@/lib/api/replace-empty-mesocycle-with-v2";
import type {
  WorkoutAuditCanonicalMode,
  WorkoutAuditRequestMode,
} from "./constants";
import type { AcceptedMesocycleSeedProvenanceConsistency } from "@/lib/api/accepted-mesocycle-seed-provenance";

export type AuditBasisDescriptor = {
  sourceModule: string;
  sourceFunction: string;
  runtimeRule: string;
};

export type AuditConclusionBlock = {
  next_session_basis: AuditBasisDescriptor;
  weekly_volume_basis: AuditBasisDescriptor;
  recovery_basis: AuditBasisDescriptor;
  progression_basis: AuditBasisDescriptor;
  week_close_basis: AuditBasisDescriptor;
  sequencing_basis: AuditBasisDescriptor;
  advances_split_basis: AuditBasisDescriptor;
};

export type AuditWarningSummary = {
  blockingErrors: string[];
  semanticWarnings: string[];
  backgroundWarnings: string[];
  counts: {
    blockingErrors: number;
    semanticWarnings: number;
    backgroundWarnings: number;
  };
};

export type WorkoutAuditIdentity = {
  userId: string;
  ownerEmail?: string;
};

export type WorkoutAuditRequest = {
  mode: WorkoutAuditRequestMode;
  userId?: string;
  ownerEmail?: string;
  intent?: SessionIntent;
  targetMuscles?: string[];
  week?: number;
  mesocycleId?: string;
  sourceMesocycleId?: string;
  retrospectiveMesocycleId?: string;
  workoutId?: string;
  exerciseId?: string;
  projectionArtifactPath?: string;
  plannerDiagnosticsMode?: PlannerDiagnosticsMode;
  plannerOnlyDryRun?: boolean;
  plannerOnlyNoRepair?: boolean;
  v2DebugArtifact?: boolean;
  compareRepaired?: boolean;
  sanitizationLevel?: "none" | "pii-safe";
};

export type WorkoutAuditContext = {
  mode: WorkoutAuditCanonicalMode;
  requestedMode?: WorkoutAuditRequestMode;
  userId: string;
  ownerEmail?: string;
  plannerDiagnosticsMode: PlannerDiagnosticsMode;
  generationInput?: {
    intent: SessionIntent;
    targetMuscles?: string[];
    source?: "derived-next-session" | "explicit-intent" | "forced-deload";
  };
  nextSession?: NextWorkoutContext;
  historicalWeek?: {
    week: number;
    mesocycleId?: string;
  };
  weeklyRetro?: {
    week: number;
    mesocycleId: string;
    projectionArtifactPath?: string;
  };
  projectedWeekVolume?: {
    enabled: true;
  };
  preSessionReadiness?: {
    enabled: true;
    requestedMesocycleId?: string;
  };
  activeMesocycleSlotReseed?: {
    enabled: true;
  };
  replaceEmptyMesocycleWithV2?: {
    mesocycleId: string;
  };
  v2AcceptedSeedPrepareCompare?: {
    mesocycleId?: string;
    requestedIdSource?: "mesocycle_id" | "source_mesocycle_id";
  };
  nextMesocycleHandoffDryRun?: {
    sourceMesocycleId: string;
  };
  nextMesocycleAcceptanceGate?: {
    sourceMesocycleId: string;
  };
  nextMesocyclePostAcceptVerification?: {
    sourceMesocycleId: string;
    successorMesocycleId?: string;
  };
  progressionAnchor?: {
    workoutId?: string;
    exerciseId: string;
  };
  mesocycleExplain?: {
    sourceMesocycleId?: string;
    retrospectiveMesocycleId?: string;
    plannerOnlyDryRun?: {
      enabled: true;
      compareRepaired: true;
      plannerOnlyPolicyOverride: PlannerOnlyPolicyOverride;
    };
    plannerOnlyNoRepair?: {
      enabled: true;
      compareRepaired: boolean;
      v2DebugArtifact?: boolean;
    };
  };
};

export type WorkoutAuditGenerationPath = {
  requestedMode: WorkoutAuditRequestMode;
  executionMode:
    | "standard_generation"
    | "explicit_deload_preview"
    | "active_deload_reroute"
    | "blocked_closeout_required";
  generator:
    | "generateSessionFromIntent"
    | "generateDeloadSessionFromIntent"
    | "none";
  reason:
    | "standard_future_week_or_preview"
    | "explicit_deload_mode"
    | "active_mesocycle_state_active_deload"
    | "final_accumulation_week_close_pending";
};

export type WorkoutAuditGenerationProvenanceSummary = {
  receiptProvenance: {
    mesocycleId: string | null;
    compositionSource: SessionCompositionSource | null;
  };
  auditOnly: {
    generationPath: WorkoutAuditGenerationPath | null;
  };
  seed?: {
    provenanceConsistency: AcceptedMesocycleSeedProvenanceConsistency;
  };
};

export type AuditCanonicalSemantics = {
  sourceLayer: "saved" | "generated" | "none";
  phase: string | null;
  isDeload: boolean;
  countsTowardProgressionHistory: boolean;
  countsTowardPerformanceHistory: boolean;
  updatesProgressionAnchor: boolean;
};

export type HistoricalWeekAuditSession = {
  workoutId: string;
  scheduledDate: string;
  status: string;
  selectionMode?: string;
  sessionIntent?: string;
  snapshotSource: "persisted" | "reconstructed_saved_only";
  sessionSnapshot: SessionAuditSnapshot;
  canonicalSemantics: AuditCanonicalSemantics;
  progressionEvidence: {
    countsTowardProgressionHistory: boolean;
    countsTowardPerformanceHistory: boolean;
    updatesProgressionAnchor: boolean;
    reasonCodes: string[];
  };
  weekClose?: {
    relevant: boolean;
    relation: Array<
      "target_week" | "linked_selection_metadata" | "linked_optional_workout"
    >;
    weekCloseId: string;
    targetWeek: number;
    targetPhase: string;
    status: string;
    resolution: string | null;
    workflowState: string;
    deficitState: string;
    remainingDeficitSets: number;
    optionalWorkoutId?: string;
    deficitSnapshotSummary?: {
      totalDeficitSets: number;
      qualifyingMuscleCount: number;
      topTargetMuscles: string[];
    };
  };
  reconciliation: SessionAuditMutationSummary;
};

export type HistoricalWeekAuditPayload = {
  version: typeof HISTORICAL_WEEK_AUDIT_PAYLOAD_VERSION;
  week: number;
  mesocycleId?: string;
  sessions: HistoricalWeekAuditSession[];
  summary: {
    sessionCount: number;
    advancingCount: number;
    gapFillCount: number;
    supplementalCount: number;
    deloadCount: number;
    progressionEligibleCount: number;
    progressionExcludedCount: number;
    weekCloseRelevantCount: number;
    persistedSnapshotCount: number;
    reconstructedSnapshotCount: number;
    mutationDriftCount: number;
    statusCounts: Record<string, number>;
    intentCounts: Record<string, number>;
  };
  comparabilityCoverage: {
    comparableSessionCount: number;
    missingGeneratedSnapshotCount: number;
    persistedSnapshotCount: number;
    reconstructedSnapshotCount: number;
    generatedLayerCoverage: "full" | "partial" | "none";
    limitations: string[];
  };
};

export type ProgressionAnchorAuditPayload = {
  version: typeof PROGRESSION_ANCHOR_AUDIT_PAYLOAD_VERSION;
  workoutId: string;
  exerciseId: string;
  exerciseName: string;
  scheduledDate: string;
  selectionMode?: string;
  sessionIntent?: string;
  sessionSnapshotSource?: "persisted" | "reconstructed_saved_only";
  sessionSnapshot?: SessionAuditSnapshot;
  canonicalSemantics?: AuditCanonicalSemantics;
  trace: ProgressionDecisionTrace;
};

export type WeeklyRetroAuditVolumeRow = {
  muscle: string;
  actualEffectiveSets: number;
  weeklyTarget: number;
  mev: number;
  mav: number;
  deltaToTarget: number;
  deltaToMev: number;
  deltaToMav: number;
  status:
    | "below_mev"
    | "under_target_only"
    | "within_target_band"
    | "over_target_only"
    | "over_mav";
  topContributors: Array<{
    exerciseId?: string;
    exerciseName: string;
    effectiveSets: number;
    performedSets: number;
  }>;
};

export type RuntimeEditIntent =
  | "final_weekly_opportunity_mev_closure"
  | "target_gap_closure"
  | "user_preference"
  | "substitution"
  | "fatigue_adjustment"
  | "pain_avoidance"
  | "opportunistic_extra"
  | "unclassified";

export type RuntimeEditConfidence = "high" | "medium" | "low";

export type RuntimeEditInterpretation = {
  opKind: string;
  intent: RuntimeEditIntent;
  confidence: RuntimeEditConfidence;
  source: "persisted_op" | "audit_inferred" | "legacy_reconstructed";
  setDelta: number;
  exerciseId?: string;
  workoutExerciseId?: string;
  muscles: string[];
  timing?:
    | "early_session"
    | "mid_session"
    | "end_session"
    | "post_session"
    | "unknown";
  evidence: string[];
};

export type WeeklyRetroPlanAdherence = {
  plannedWorkCompletedPercent: number;
  plannedWorkMissedSets: number;
  plannedWorkTotalSets: number;
  plannedWorkCompletedSets: number;
  explainedAdditions: {
    totalSets: number;
    byIntent: Partial<Record<RuntimeEditIntent, number>>;
  };
  substitutions: number;
  painFatigueDeviations: number;
  unclassifiedDrift: number;
  engineConfidenceImpact: "none" | "low" | "medium" | "high";
  interpretations: RuntimeEditInterpretation[];
};

export type ProjectionDeliveryDriftPayload = {
  status: "comparable" | "limited" | "not_available";
  baseline: {
    generatedAt: string;
    projectedSessionCount: number;
  };
  summary: {
    direction: "aligned" | "underdelivery" | "overdelivery" | "mixed";
    materialUnderdeliveryCount: number;
    materialOverdeliveryCount: number;
    netEffectiveSetDelta: number;
  };
  muscles: Array<{
    muscle: string;
    projectedEffectiveSets: number;
    actualEffectiveSets: number;
    delta: number;
    percentDelta: number | null;
    classification: "aligned" | "underdelivered" | "overdelivered";
    actualTargetStatus: string;
  }>;
  limitations: string[];
};

export type WeeklyRetroExerciseLoadCalibrationClassification =
  | "clean"
  | "target_too_low"
  | "target_too_high"
  | "recalibrated_hold"
  | "insufficient_evidence"
  | "runtime_added"
  | "skipped_or_low_coverage";

export type WeeklyRetroExerciseLoadCalibrationRow = {
  week: number;
  workoutId: string;
  slotId?: string;
  sessionLabel: string;
  exerciseId: string;
  exerciseName: string;
  plannedSetCount: number;
  savedSetCount: number;
  performedSetCount: number;
  skippedSetCount: number;
  addedSetCount: number;
  targetLoad?: number;
  targetRepRange?: {
    min: number;
    max: number;
  };
  targetRpe?: number;
  performedLoadSummary: {
    anchorLoad?: number;
    medianLoad?: number;
    medianReps?: number;
    modalRpe?: number;
    loadDeltaPct?: number;
  };
  classification: WeeklyRetroExerciseLoadCalibrationClassification;
  reasonCodes: string[];
  notes: string[];
};

export type WeeklyRetroAuditSessionExecutionRow = {
  workoutId: string;
  scheduledDate: string;
  status: string;
  selectionMode?: string;
  sessionIntent?: string;
  snapshotSource: HistoricalWeekAuditSession["snapshotSource"];
  semanticKind?:
    | "advancing"
    | "gap_fill"
    | "supplemental"
    | "non_advancing_generic";
  consumesWeeklyScheduleIntent: boolean;
  isCloseout: boolean;
  isDeload: boolean;
  slot?: SessionSlotSnapshot;
  mesocycleSnapshot?: NonNullable<
    HistoricalWeekAuditSession["sessionSnapshot"]["saved"]
  >["mesocycleSnapshot"];
  cycleContext?: NonNullable<
    HistoricalWeekAuditSession["sessionSnapshot"]["generated"]
  >["cycleContext"];
  canonicalSemantics: HistoricalWeekAuditSession["canonicalSemantics"];
  progressionEvidence: HistoricalWeekAuditSession["progressionEvidence"];
  weekClose?: HistoricalWeekAuditSession["weekClose"];
  reconciliation: HistoricalWeekAuditSession["reconciliation"];
};

export type WeeklyRetroAuditPayload = {
  version: typeof WEEKLY_RETRO_AUDIT_PAYLOAD_VERSION;
  week: number;
  mesocycleId: string;
  executiveSummary: {
    status: "stable" | "attention_required";
    generatedLayerCoverage: HistoricalWeekAuditPayload["comparabilityCoverage"]["generatedLayerCoverage"];
    sessionCount: number;
    advancingSessionCount: number;
    progressionEligibleCount: number;
    progressionExcludedCount: number;
    driftSessionCount: number;
    belowMevCount: number;
    underTargetCount: number;
    overMavCount: number;
    slotIdentityIssueCount: number;
    highlights: string[];
  };
  loadCalibration: {
    status: "aligned" | "limited_by_legacy_coverage" | "attention_required";
    comparableSessionCount: number;
    driftSessionCount: number;
    prescriptionChangeCount: number;
    selectionDriftCount: number;
    legacyLimitedSessionCount: number;
    highlightedSessions: Array<{
      workoutId: string;
      changedFields: string[];
    }>;
  };
  sessionExecution: {
    summary: HistoricalWeekAuditPayload["summary"];
    sessions: WeeklyRetroAuditSessionExecutionRow[];
  };
  slotBalance: {
    status: "balanced" | "attention_required";
    advancingSessionCount: number;
    identifiedSlotCount: number;
    missingSlotIdentityCount: number;
    duplicateSlotCount: number;
    intentMismatchCount: number;
    missingSlotIdentityWorkoutIds: string[];
    duplicateSlots: Array<{
      slotId: string;
      workoutIds: string[];
    }>;
    intentMismatches: Array<{
      workoutId: string;
      sessionIntent?: string;
      slotIntent: string;
      slotId: string;
    }>;
  };
  volumeTargeting: {
    status: "within_expected_band" | "attention_required";
    belowMev: string[];
    underTargetOnly: string[];
    overMav: string[];
    overTargetOnly: string[];
    muscles: WeeklyRetroAuditVolumeRow[];
  };
  planAdherence: WeeklyRetroPlanAdherence;
  exerciseLoadCalibrationRows?: WeeklyRetroExerciseLoadCalibrationRow[];
  projectionDeliveryDrift?: ProjectionDeliveryDriftPayload;
  interventions: Array<{
    priority: "high" | "medium" | "low";
    kind:
      | "slot_identity"
      | "mutation_drift"
      | "legacy_coverage"
      | "volume_deficit"
      | "volume_overshoot"
      | "missed_planned_work"
      | "unclassified_runtime_drift";
    summary: string;
    evidence: string[];
  }>;
  rootCauses: Array<{
    code:
      | "slot_identity_gap"
      | "slot_identity_duplicate"
      | "slot_identity_intent_mismatch"
      | "mutation_drift"
      | "missed_planned_work"
      | "unclassified_runtime_drift"
      | "legacy_coverage_gap"
      | "below_mev"
      | "over_mav";
    summary: string;
    evidence: string[];
  }>;
  recommendedPriorities: string[];
};

export type ProjectedWeekVolumeAuditPayload = {
  version: typeof PROJECTED_WEEK_VOLUME_AUDIT_PAYLOAD_VERSION;
  currentWeek: {
    mesocycleId: string;
    week: number;
    phase: string;
    blockType: string | null;
  };
  projectionNotes: string[];
  completedVolumeByMuscle: Record<
    string,
    {
      directSets: number;
      indirectSets: number;
      effectiveSets: number;
    }
  >;
  projectedSessions: ProjectedWeekVolumeSessionSummary[];
  fullWeekByMuscle: ProjectedWeekVolumeMuscleRow[];
  currentWeekAudit?: CurrentWeekAuditEvaluation;
  interventionHints?: CurrentWeekAuditInterventionHint[];
  sessionRisks?: CurrentWeekAuditSessionRisk[];
  runtimeDoseAdjustmentDiagnostics?: RuntimeDoseAdjustmentDiagnostic[];
};

export type PreSessionReadinessAuditPayload = {
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByProduction: false;
  wouldWriteTransaction: false;
  activeMesocycle: {
    mesocycleId: string | null;
    state: string | null;
    completedAccumulationSessions: number | null;
    deloadSessionsCompleted: number | null;
    deloadSessionsExpected: number | null;
    deloadSessionPosition: {
      current: number;
      total: number;
    } | null;
    currentWeek: number | null;
    currentSession: number | null;
    requestedMesocycleId?: string;
    mesocycleIdMatchesRequest?: boolean;
  };
};

export type CurrentWeekAuditEvaluation = {
  belowMEV: string[];
  overMAV: string[];
  underTargetClusters: Array<{
    muscle: string;
    deficit: number;
  }>;
  belowPreferred: Array<{
    muscle: string;
    deficit: number;
    status: "below_preferred" | "stretch_miss";
  }>;
  fatigueRisks: string[];
};

export type CurrentWeekAuditInterventionHint = {
  muscle: string;
  suggestedSets: number;
  reason: string;
};

export type CurrentWeekAuditSessionRisk = {
  slotId: string;
  issue: string;
};

export type ActiveMesocycleSlotReseedRecommendation =
  | "safe_to_accept_upgrade"
  | "safe_to_apply_bounded_reseed"
  | "not_safe_to_apply"
  | "needs_projection_fix_first";

export type ActiveMesocycleSlotReseedExerciseSeedRow = {
  exerciseId: string;
  exerciseName: string;
  role: "CORE_COMPOUND" | "ACCESSORY";
};

export type ActiveMesocycleSlotReseedSessionExerciseRow = {
  exerciseId: string;
  exerciseName: string;
  role: "CORE_COMPOUND" | "ACCESSORY";
  setCount: number;
  movementPatterns: string[];
  primaryMuscles: string[];
};

export type ActiveMesocycleSlotReseedMuscleDiffRow = {
  muscle: string;
  before: number;
  after: number;
  delta: number;
};

export type ActiveMesocycleSlotReseedSetDiffRow = {
  exerciseId: string;
  exerciseName: string;
  beforeSetCount: number;
  afterSetCount: number;
  delta: number;
};

export type ActiveMesocycleSlotReseedIdentityCharacterization = {
  slotArchetype: string | null;
  continuityScope: string | null;
  requiredMovementPatterns: string[];
  preferredAccessoryPrimaryMuscles: string[];
  protectedCoverageMuscles: string[];
  preservesSlotIdentity: boolean;
  hasCompoundRow: boolean;
  hasCompoundVerticalPull: boolean;
};

export type ActiveMesocycleSlotReseedSlotDiff = {
  slotId: string;
  intent: string;
  sequenceIndex: number;
  persistedSeedExercises: ActiveMesocycleSlotReseedExerciseSeedRow[];
  candidateSeedExercises: ActiveMesocycleSlotReseedExerciseSeedRow[];
  exerciseDiff: {
    added: ActiveMesocycleSlotReseedExerciseSeedRow[];
    removed: ActiveMesocycleSlotReseedExerciseSeedRow[];
    retained: ActiveMesocycleSlotReseedExerciseSeedRow[];
  };
  persistedSession: {
    exerciseCount: number;
    totalSets: number;
    estimatedMinutes: number | null;
    exercises: ActiveMesocycleSlotReseedSessionExerciseRow[];
    muscleContributionByMuscle: Record<string, number>;
    characterization: ActiveMesocycleSlotReseedIdentityCharacterization;
  };
  candidateSession: {
    exerciseCount: number;
    totalSets: number;
    estimatedMinutes: number | null;
    exercises: ActiveMesocycleSlotReseedSessionExerciseRow[];
    muscleContributionByMuscle: Record<string, number>;
    characterization: ActiveMesocycleSlotReseedIdentityCharacterization;
  };
  setDiffByExercise: ActiveMesocycleSlotReseedSetDiffRow[];
  muscleContributionDiff: ActiveMesocycleSlotReseedMuscleDiffRow[];
  estimatedMinutesDiff: {
    before: number | null;
    after: number | null;
    delta: number | null;
  };
  flags: {
    improvesChestSupport: boolean;
    improvesTricepsSupport: boolean;
    preservesRowAndVerticalPullWhereAppropriate: boolean;
    avoidsNewObviousOvershoot: boolean;
  };
  warnings: string[];
};

export type ActiveMesocycleSlotReseedAuditPayload = {
  version: typeof ACTIVE_MESOCYCLE_SLOT_RESEED_AUDIT_PAYLOAD_VERSION;
  activeMesocycle: {
    mesocycleId: string;
    mesoNumber: number;
    state: string;
    week: number;
    splitType: string;
    targetSlotIds: string[];
  };
  executiveSummary: string[];
  persistedSeedResolution: AuditBasisDescriptor;
  freshReprojection: AuditBasisDescriptor;
  candidateSessionEvaluation: AuditBasisDescriptor;
  diffArtifactDescription: string;
  slotDiffs: ActiveMesocycleSlotReseedSlotDiff[];
  aggregateMuscleDiff: ActiveMesocycleSlotReseedMuscleDiffRow[];
  flags: {
    improvesChestSupport: boolean;
    improvesTricepsSupport: boolean;
    improvesSideDeltSupport: boolean;
    improvesRearDeltSupport: boolean;
    improvesTierBSupport: boolean;
    reducesStackingPressure: boolean;
    reducesLowerFatigue: boolean;
    reducesUpperSessionDuration: boolean;
    preservesRowAndVerticalPullWhereAppropriate: boolean;
    avoidsNewObviousOvershoot: boolean;
    preservesSlotIdentity: boolean;
    materiallyChangesExerciseSelection: boolean;
  };
  recommendation: {
    verdict: ActiveMesocycleSlotReseedRecommendation;
    reasons: string[];
  };
};

export type ReplaceEmptyMesocycleWithV2AuditPayload =
  ReplaceEmptyMesocycleWithV2Result & {
    version: typeof REPLACE_EMPTY_MESOCYCLE_WITH_V2_AUDIT_PAYLOAD_VERSION;
    readOnly: true;
    affectsScoringOrGeneration: false;
    consumedByProduction: false;
    wouldWriteTransaction: false;
  };

export type V2AcceptedSeedPrepareCompareAuditPayload = {
  version: typeof V2_ACCEPTED_SEED_PREPARE_COMPARE_AUDIT_PAYLOAD_VERSION;
  source: "v2_accepted_seed_prepare_compare_audit";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByProduction: false;
  wouldWriteTransaction: false;
  compareStatus:
    | "available"
    | "blocked"
    | "not_comparable"
    | "no_handoff_candidate";
  handoffCandidate: {
    found: boolean;
    resolvedBy:
      | "explicit_mesocycle_id"
      | "explicit_source_mesocycle_id"
      | "latest_pending_handoff"
      | "not_found";
    mesocycleId?: string;
    state?: string;
    missingReason?: "no_pending_handoff_candidate";
  };
  boundaryFacts: {
    readOnly: true;
    noWrite: true;
    consumedByProduction: false;
    v2PreviewAvailable: boolean;
    v2ProductionWriteEligible: boolean;
    seedSerializer: "buildMesocycleSlotPlanSeed";
    legacyProjectionCalledByV2Path: false;
    repairCalledByV2Path: false;
    transactionStatus: "no_write";
  };
  availability: {
    handoffCandidateFound: boolean;
    legacyPreparationAvailable: boolean;
    v2PreparationPreviewAvailable: boolean;
    v2BlockedFailClosed: boolean;
    missingEvidence: string[];
  };
  seedShapeComparison: Pick<
    V2AcceptedSeedPreparationCompareResult["seedShapeComparison"],
    | "classification"
    | "slotIdsInOrder"
    | "exerciseCountBySlot"
    | "setCountBySlot"
    | "totalSetCount"
    | "executableFieldShape"
    | "seedSerializerIdentity"
  >;
  identityCoverageComparison: {
    identitySummary: {
      sameExercise: number;
      v2Added: number;
      v2Removed: number;
      cleanAlternative: number;
      classEquivalentDifference: number;
      unclear: number;
      notComparable: number;
    };
    identityRows: Array<{
      slotId: string;
      relationship: V2AcceptedSeedPreparationCompareResult["exerciseIdentityComparison"]["rows"][number]["relationship"];
      classification: V2AcceptedSeedPreparationCompareResult["exerciseIdentityComparison"]["rows"][number]["classification"];
      sameExerciseIds: string[];
      v2AddedExerciseIds: string[];
      v2RemovedExerciseIds: string[];
      evidence: string[];
      omittedEvidenceCount?: number;
    }>;
    coverageRows: Array<{
      item: V2AcceptedSeedPreparationCompareResult["classLaneCoverageComparison"]["rows"][number]["item"];
      legacy: boolean | null;
      v2: boolean | null;
      classification: V2AcceptedSeedPreparationCompareResult["classLaneCoverageComparison"]["rows"][number]["classification"];
      evidence: string[];
      omittedEvidenceCount?: number;
    }>;
  };
  provenance: {
    legacySourceLabel: string;
    v2SourceLabel: "v2_disabled";
    baseValidationStatus: V2AcceptedSeedPreparationCompareResult["provenanceNoWriteBoundary"]["baseValidationStatus"];
    materializerStatus: V2AcceptedSeedPreparationCompareResult["provenanceNoWriteBoundary"]["materializerStatus"];
    seedShapeCompatibility: V2AcceptedSeedPreparationCompareResult["provenanceNoWriteBoundary"]["seedShapeCompatibility"];
    promotionReadinessStatus: V2AcceptedSeedPreparationCompareResult["provenanceNoWriteBoundary"]["promotionReadinessStatus"];
    productionGates: V2AcceptedSeedPreparationCompareResult["provenanceNoWriteBoundary"]["productionGates"];
    fallbackPolicy: V2AcceptedSeedPreparationCompareResult["provenanceNoWriteBoundary"]["fallbackPolicy"];
    transactionStatus: "no_write";
  };
  guardrails: V2AcceptedSeedPreparationCompareResult["guardrails"];
  summary: V2AcceptedSeedPreparationCompareResult["summary"];
};

export type NextMesocycleHandoffDryRunPayload = {
  version: typeof NEXT_MESOCYCLE_HANDOFF_DRY_RUN_AUDIT_PAYLOAD_VERSION;
  source: "next_mesocycle_handoff_dry_run_audit";
  ownerEmail?: string;
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByProduction: false;
  wouldWriteTransaction: false;
  summary: {
    writes: "no";
    sourceMesocycleId: string;
    sourceState: string | null;
    candidateAvailable: boolean;
    handoffReady: boolean;
    blockingReason: string | null;
    preparationPath:
      | "prepareMesocycleHandoffAcceptance"
      | "not_called_source_not_awaiting_handoff";
    transactionStatus: "not_started";
  };
  wouldPrepareWriteSummary: {
    successorSource: "prepared_handoff_projection";
    slotSequence: string;
    seedShape: string;
    slotPlanSeedSource: string | null;
    trainingBlocksCount: number;
    carriedRolesCount: number;
    constraintsAction: "would_upsert_constraints";
    sourceCompletionAction: "would_mark_source_completed";
    transactionBoundary: string;
    noDbWritesOccur: true;
  } | null;
  persistedDraftTruth: {
    status: "available" | "not_available";
    source: string | null;
    refreshedAt?: string;
    seedShape: string;
    slotCount: number;
    exerciseCount: number;
    minimalExecutableRowsOnly: boolean;
    parserCompatible: boolean;
  };
  candidateIdentity: {
    status: "available" | "not_available_until_handoff";
    rows: Array<{
      slotId: string;
      laneOrRole: string;
      exerciseId: string;
      exerciseName: string;
      setCount: number;
      source:
        | "persisted_nextSeedDraftJson.acceptedSeedDraft"
        | "prepared_slotPlanSeedJson";
    }>;
  };
  seedShapeSummary: {
    slotPlanSeedJson:
      | "persisted_draft_available"
      | "would_be_built"
      | "not_available";
    truthBasis: "persisted_draft" | "prepared_acceptance_seed" | "none";
    wouldBeBuilt: boolean;
    minimalExecutableRowsOnly: boolean;
    executableFields: Array<"exerciseId" | "role" | "setCount">;
    serializerPath: "buildMesocycleSlotPlanSeed";
    slotCount: number;
    exerciseCount: number;
    seedSource: string | null;
    parserCompatible?: boolean;
  };
  weeklyVolumeFloorCapSummary: {
    status: "available" | "not_available";
    basis: string;
    rows: Array<{
      muscle: string;
      projectedSets: number;
      mev: number | null;
      mav: number | null;
      status: string;
    }>;
  };
  acceptanceGatePayloadSummary: {
    checks: Array<{
      check:
        | "candidate identity gate"
        | "seed/runtime contract gate"
        | "volume floors/caps"
        | "slot/lane balance"
        | "Week 1 trainability";
      enoughData: boolean;
      basis: string;
    }>;
  };
  weekOneRuntimeReplayPreview: {
    status: "seed_order_preview_only" | "not_available";
    runtimeReplayInstantiated: false;
    rows: Array<{
      slotId: string;
      exerciseName: string;
      role: string;
      setCount: number;
    }>;
    limitation: string;
  };
  modeComparison: Array<{
    mode:
      | "mesocycle-explain"
      | "v2-accepted-seed-prepare-compare"
      | "next-mesocycle-acceptance-gate";
    distinction: string;
  }>;
  safety: {
    writes: "no";
    dbMutated: false;
    mesocycleCreated: false;
    workoutLogSessionCreated: false;
    seedRuntimeBehaviorChanged: false;
    plannerMaterializerBehaviorChanged: false;
    transactionExecuted: false;
  };
};

export type NextMesocycleAcceptanceGateDecision =
  | "not_runnable"
  | "rejected"
  | "accepted_with_watch_items"
  | "accepted";

export type NextMesocycleAcceptanceGateStatus =
  | "pass"
  | "warning"
  | "fail"
  | "unknown";

export type NextMesocycleAcceptanceGateSeverity =
  | "blocker"
  | "high_risk"
  | "warning"
  | "info"
  | "pass";

export type NextMesocycleAcceptanceGateOwnerSeam =
  | "candidate identity"
  | "lifecycle/handoff"
  | "seed/runtime contract"
  | "volume floors"
  | "target semantics"
  | "slot allocation"
  | "planner policy"
  | "materializer policy"
  | "materializer/exercise-selection capacity"
  | "exercise identity"
  | "prescription/readout"
  | "audit/readout";

export type NextMesocycleAcceptanceGateRemediation = {
  finding: string;
  severity: NextMesocycleAcceptanceGateSeverity;
  ownerSeam: NextMesocycleAcceptanceGateOwnerSeam;
  smallestSafeFix: string;
  mustFixBeforeWeek1: boolean;
  evidence: string;
};

export type NextMesocycleAcceptanceGatePayload = {
  version: typeof NEXT_MESOCYCLE_ACCEPTANCE_GATE_AUDIT_PAYLOAD_VERSION;
  source: "next_mesocycle_acceptance_gate_audit";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByProduction: false;
  wouldWriteTransaction: false;
  gateResult: NextMesocycleAcceptanceGateDecision;
  candidateFound: boolean;
  why: string[];
  recommendation: string;
  decisionSummary: {
    trainability: "pass" | "warning" | "fail";
    plannerMaterializerQuality: "pass" | "warning" | "fail";
    repairBurden: "none" | "low" | "medium" | "high";
    repairBurdenEvidence: string;
    repairBurdenSource:
      | "planning_reality_shadow_repair_summary"
      | "planning_reality_summary"
      | "missing_planning_reality";
    repairBurdenClassification:
      | "candidate_truth"
      | "legacy_diagnostic_context"
      | "architecture_debt"
      | "noisy_watch_item";
    shadowConsumptionClassification:
      | "not_available"
      | "diagnostic_positive_needs_inspection"
      | "diagnostic_limited_needs_inspection"
      | "blocked_for_promotion"
      | "guardrail_violation";
    shadowConsumptionNextSafeAction:
      | "inspect_shadow_consumption"
      | "fix_v2_base_plan"
      | "fix_shadow_adapter"
      | "add_guarded_behavior_trial"
      | "do_not_promote"
      | "not_available";
    shadowConsumptionEvidence: string;
    materializerGuardrailClassification:
      | "not_available"
      | "no_material_guardrail_issue"
      | "exercise_metadata_gap"
      | "selection_ranking_gap"
      | "capacity_policy_gap"
      | "diagnostic_or_legacy_context"
      | "guardrail_violation";
    materializerGuardrailNextSafeAction:
      | "inspect_exercise_metadata"
      | "inspect_selection_ranking"
      | "inspect_capacity_policy"
      | "keep_diagnostic_only"
      | "no_action"
      | "not_available"
      | "stop_guardrail_violation";
    materializerGuardrailEvidence: string;
  };
  candidateIdentity: {
    ownerEmail?: string;
    sourceMesocycleId: string;
    sourceState: string | null;
    candidateKind: "accepted" | "draft" | "absent" | "diagnostic_preview_only";
    candidateSeedSource?: string | null;
    candidateMesocycleId?: string;
    candidateDraftAvailable: boolean;
    persistedHandoffCandidateFound: boolean;
    writeNeededToInspect: false;
  };
  gates: Array<{
    gate: string;
    status: NextMesocycleAcceptanceGateStatus;
    severity: NextMesocycleAcceptanceGateSeverity;
    evidence: string;
    notes: string;
    ownerSeam: NextMesocycleAcceptanceGateOwnerSeam;
    smallestSafeFix: string;
    mustFixBeforeWeek1: boolean;
  }>;
  weeklyMuscleTable: Array<{
    muscle: string;
    projectedSets: number;
    mev: number;
    productiveTarget: number | null;
    mav: number;
    status:
      | "below_mev_fail"
      | "above_mev_below_target_not_failure"
      | "productive_zone"
      | "target_near_mav_stretch_cap"
      | "over_mav_fail_or_warning"
      | "unknown";
    severity: NextMesocycleAcceptanceGateSeverity;
    notes: string;
  }>;
  priorBlockRecurringRisks: Array<{
    risk: string;
    status: NextMesocycleAcceptanceGateStatus;
    severity: NextMesocycleAcceptanceGateSeverity;
    evidence: string;
    notes: string;
  }>;
  completedBlockEvidence: Array<{
    risk: string;
    evidence: string;
    hypothesis: string;
    acceptanceImplication: string;
    requiredFix: string;
    severity: NextMesocycleAcceptanceGateSeverity;
    ownerSeam: NextMesocycleAcceptanceGateOwnerSeam;
    smallestSafeFix: string;
    mustFixBeforeWeek1: boolean;
  }>;
  watchItems: Array<{
    risk: string;
    whyItMatters: string;
    monitoringPlan: string;
  }>;
  findings: NextMesocycleAcceptanceGateRemediation[];
  doNotFixNotes: Array<{
    item: string;
    reason: string;
  }>;
  diagnosticPreview: {
    available: boolean;
    label: "diagnostic_preview_not_candidate" | "not_available";
    canBeAccepted: false;
    planningShape?: string;
    notes: string[];
  };
  blockers: string[];
  supportingEvidence: {
    v2PrepareCompareStatus?: V2AcceptedSeedPrepareCompareAuditPayload["compareStatus"];
    v2ProductionWriteEligible?: boolean;
    mesocycleExplainPreviewAvailable: boolean;
  };
};

export type NextMesocyclePostAcceptVerificationStatus =
  | "pass"
  | "warning"
  | "fail"
  | "unknown";

export type NextMesocyclePostAcceptVerificationPayload = {
  version: typeof NEXT_MESOCYCLE_POST_ACCEPT_VERIFICATION_AUDIT_PAYLOAD_VERSION;
  source: "next_mesocycle_post_accept_verification_audit";
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByProduction: false;
  wouldWriteTransaction: false;
  verificationResult: "safe_to_train" | "blocked" | "watch_items" | "not_runnable";
  recommendation: string;
  sourceMesocycle: {
    id: string;
    state: string | null;
    isActive: boolean | null;
    macroCycleId: string | null;
    mesoNumber: number | null;
  };
  successorMesocycle: {
    id: string | null;
    requestedId?: string;
    state: string | null;
    isActive: boolean | null;
    macroCycleId: string | null;
    mesoNumber: number | null;
    activeMesocycleId: string | null;
  };
  seedContract: {
    slotPlanSeedJson: "available" | "missing" | "invalid";
    source: string | null;
    slotCount: number;
    exerciseCount: number;
    minimalExecutableRowsOnly: boolean;
    executableFields: Array<"exerciseId" | "role" | "setCount">;
    missingSetCount: number;
    extraExecutableRowFieldCount: number;
  };
  slotSequence: {
    available: boolean;
    hasPersistedSequence: boolean;
    orderStable: boolean;
    slotOrder: string[];
    seedSlotOrder: string[];
  };
  futureWeekReplay: {
    status: "available" | "generation_error" | "not_available";
    compositionSource: string | null;
    generationPath: "standard_generation" | "active_deload_reroute" | "explicit_deload_preview" | "blocked_closeout_required" | "not_run";
    nextSlotId: string | null;
    generatedExerciseOrder: string[];
    seedExerciseOrder: string[];
    exerciseOrderMatchesSeed: boolean;
    generatedExerciseCount: number;
    progressionTraceCount: number;
    cautionCount: number;
  };
  projectedWeekVolume: {
    status: "available" | "generation_error" | "not_available";
    currentWeek: number | null;
    mesocycleId: string | null;
    projectedSessionCount: number;
    allProjectedSessionsSeedBacked: boolean;
    mismatchedSlots: string[];
  };
  readModels: {
    homeNextSessionSlotSource: string | null;
    programExerciseSources: string[];
    allProgramRowsSeedBacked: boolean;
  };
  provenance: {
    status: "valid" | "suspicious" | "invalid" | "not_available";
    warningCodes: string[];
    receiptCompositionSource: string | null;
  };
  checks: Array<{
    check: string;
    status: NextMesocyclePostAcceptVerificationStatus;
    evidence: string;
    ownerSeam: string;
    mustFixBeforeWeek1: boolean;
  }>;
  safety: {
    writes: "no";
    dbMutated: false;
    mesocycleCreated: false;
    workoutLogSessionCreated: false;
    seedRuntimeBehaviorChanged: false;
    plannerMaterializerBehaviorChanged: false;
    transactionExecuted: false;
  };
};

export type MesocycleExplainReasonSource =
  | "persisted"
  | "reconstructed"
  | "unavailable";

export type MesocycleExplainExerciseRow = {
  exerciseId: string;
  exerciseName: string;
  role: string | null;
  setCount?: number;
};

export type MesocycleExplainSlotRow = {
  slotId: string;
  slotIndex: number;
  intent: string;
  exercises: MesocycleExplainExerciseRow[];
};

export type MesocycleExplainExerciseRationale = {
  exerciseId: string;
  exerciseName: string;
  slotId: string | null;
  slotIndex: number | null;
  intent: string | null;
  role: string | null;
  reasonSource: MesocycleExplainReasonSource;
  slotObligation: string[];
  constraints: string[];
  continuity: string[];
  ranking: null;
};

export type MesocycleExplainPreviewProjectedSession = {
  sessionIndex: number;
  slotId: string;
  slotIndex: number;
  intent: string;
  exerciseCount: number;
  totalSets: number;
  exerciseIds: string[];
};

export type MesocycleExplainRealityWorkout = {
  workoutId: string;
  scheduledDate: string;
  status: string;
  selectionMode?: string;
  sessionIntent?: string;
  slotId: string | null;
  slotIndex: number | null;
  generatedVsSaved: SessionAuditMutationSummary;
  seedDrift: {
    comparable: boolean;
    comparisonBasis: "slot_id" | "slot_sequence_index" | "none";
    addedExerciseIds: string[];
    removedExerciseIds: string[];
    notes: string[];
  };
  runtimeInterpretations: RuntimeEditInterpretation[];
  runtimeDriftLabels: string[];
};

export type MesocycleExplainComparisonSlotDiff = {
  comparisonKey: string;
  previewSlotId: string | null;
  retrospectiveSlotId: string | null;
  previewIntent: string | null;
  retrospectiveIntent: string | null;
  previewOnlyExerciseIds: string[];
  retrospectiveOnlyExerciseIds: string[];
  sharedExerciseIds: string[];
  orderedExerciseIdsMatch: boolean;
  roleMismatches: Array<{
    exerciseId: string;
    previewRole: string | null;
    retrospectiveRole: string | null;
  }>;
  setCountMismatches: Array<{
    exerciseId: string;
    previewSetCount: number | null;
    retrospectiveSetCount: number | null;
  }>;
  exactMatch: boolean;
  comparable: boolean;
};

export type MesocycleExplainProjectionDiagnosticCategory =
  | "set_stacking_pressure"
  | "duplicate_exercise_pressure"
  | "diversity_penalty"
  | "hinge_squat_balance"
  | "isolation_injection_trigger"
  | "soft_cap_overridden_by_p0"
  | "other_projection_quality";

export type MesocycleExplainProjectionDiagnosticRow = {
  label: "projection diagnostics";
  category: MesocycleExplainProjectionDiagnosticCategory;
  priority: string;
  constraint: string;
  reason: string;
  blockReason?: string;
  why: string;
  source:
    | "program_quality_evaluation"
    | "program_quality_application"
    | "duplicate_reuse"
    | "weekly_obligation";
  slotId?: string;
  exerciseId?: string;
  exerciseName?: string;
  muscle?: string;
  pattern?: string;
  penalty?: number;
  details?: Record<string, number | string | boolean | string[]>;
};

export type MesocycleExplainProjectionDiagnostics = {
  label: "projection diagnostics";
  readOnly: true;
  affectsScoringOrGeneration: false;
  summary: {
    setStackingPressure: number;
    duplicateExercisePressure: number;
    diversityPenalties: number;
    hingeSquatBalance: number;
    isolationInjectionTriggers: number;
    softCapsOverriddenByP0: number;
  };
  constraintsTriggered: MesocycleExplainProjectionDiagnosticRow[];
  tradeoffs: MesocycleExplainProjectionDiagnosticRow[];
  softCapOverridesByP0: MesocycleExplainProjectionDiagnosticRow[];
  preselectionDemands?: SlotPreselectionDemandDiagnostic[];
  planningReality?: SlotPlanPlanningRealityDiagnostic;
};

export type MesocycleExplainProjectionComparisonSnapshot = {
  slotExercisesBySlot: Record<string, string[]>;
  weeklyMuscleTotals: Record<string, number>;
  materialRepairCount: number;
  majorRepairCount: number;
  suspiciousRepairCount: number;
  highExerciseConcentrationCount: number;
  weakPreselectionConsumptionCount: number;
  forbiddenFinalPrimaryViolationCount: number;
  supportFloorClosureRowCount: number;
  setBumpRowCount: number;
  capTrimRowCount: number;
  duplicateRowCount: number;
  keyAcceptance: {
    pass: number;
    fail: number;
    partial: number;
    unknown: number;
  };
};

export type MesocycleExplainProjectionMetricDelta = {
  materialRepairCount: number;
  majorRepairCount: number;
  suspiciousRepairCount: number;
  highExerciseConcentrationCount: number;
  weakPreselectionConsumptionCount: number;
  forbiddenFinalPrimaryViolationCount: number;
  supportFloorClosureRowCount: number;
  setBumpRowCount: number;
  capTrimRowCount: number;
  duplicateRowCount: number;
  keyAcceptanceFailCount: number;
};

export type MesocycleExplainPlannerOnlyDryRun = {
  enabled: true;
  compareRepaired: boolean;
  readOnly: true;
  affectsScoringOrGeneration: false;
  policyOverride?: {
    id: PlannerOnlyPolicyOverride["id"];
    readOnly: true;
    appliesOnlyTo: PlannerOnlyPolicyOverride["appliesOnlyTo"];
    status: "inactive_noop" | "active";
    affectsScoringOrGeneration: false;
  };
  projectionComparisons?: {
    baselineRepaired: MesocycleExplainProjectionComparisonSnapshot;
    plannerOnlyBase: MesocycleExplainProjectionComparisonSnapshot;
    plannerOnlyWithOverride: MesocycleExplainProjectionComparisonSnapshot;
    deltas: {
      overrideVsBaselineRepaired: MesocycleExplainProjectionMetricDelta;
      overrideVsPlannerOnlyBase: MesocycleExplainProjectionMetricDelta;
    };
  };
  canReplaceRepairedProjection: boolean;
  summary: {
    status: "pass" | "partial" | "fail";
    acceptancePassed: number;
    acceptanceFailed: number;
    unresolvedDemandCount: number;
    disabledRepairDependencyCount: number;
  };
  slotComparisons: Array<{
    slotId: string;
    repairedExercises: string[];
    plannerOnlyExercises: string[];
    laneStatus: "matched" | "partial" | "missing" | "failed";
    unresolvedDemand: string[];
    duplicateViolations: string[];
    setDistributionViolations: string[];
  }>;
  weeklyMuscleComparison: Array<{
    muscle: string;
    repairedEffectiveSets: number | null;
    plannerOnlyEffectiveSets: number | null;
    targetStatus: "below" | "within" | "above" | "unknown";
    evidence: string[];
  }>;
  acceptanceChecks: Array<{
    check: string;
    status: "pass" | "fail" | "partial" | "unknown";
    evidence: string[];
  }>;
  repairDependencies: Array<{
    path: string;
    wouldHaveActed: boolean;
    consequenceWithoutRepair: string;
    plannerOwnerRequired: string;
  }>;
  calvesFourFourCandidate?: {
    status: "pass" | "fail" | "blocked" | "ambiguous";
    readOnly: true;
    affectsScoringOrGeneration: false;
    lowerAProjectedCalfSets: number | null;
    lowerBProjectedCalfSets: number | null;
    weeklyProjectedCalfEffectiveSets: number | null;
    currentLowerAShape: Array<{
      exerciseName: string;
      sets: number;
      effectiveCalfSets: number;
    }>;
    currentLowerBShape: Array<{
      exerciseName: string;
      sets: number;
      effectiveCalfSets: number;
    }>;
    proposedLowerAShape: Array<{
      exerciseClass: "calf_raise";
      proposedSets: number;
      reason: string;
    }>;
    proposedLowerBShape: Array<{
      exerciseClass: "calf_raise";
      proposedSets: number;
      reason: string;
    }>;
    wouldRemoveLowerBSameSessionCalfDuplicate: boolean | null;
    wouldReduceSupportFloorClosureRows: boolean | null;
    wouldReduceSetBumps: boolean | null;
    wouldIncreaseCapTrimRows: boolean | null;
    wouldChangeMaterialRepairCount:
      | "decrease"
      | "flat"
      | "increase"
      | "unknown";
    wouldChangeMajorRepairCount: "decrease" | "flat" | "increase" | "unknown";
    wouldChangeSuspiciousRepairCount:
      | "decrease"
      | "flat"
      | "increase"
      | "unknown";
    preservesLowerBHingeCurlRoute: boolean | null;
    lowerASafety: {
      status: "pass" | "fail" | "unknown";
      currentTotalSets: number | null;
      projectedTotalSets: number | null;
      slotSetCap: number | null;
      wouldExceedSlotCap: boolean | null;
      wouldDisplaceHardPrimary: boolean | null;
      affectedExercises: string[];
      evidence: string[];
    };
    materialityEstimate: {
      status: "improves" | "flat" | "worsens" | "partial" | "unknown";
      expectedMaterialRepairDelta: number | null;
      expectedMajorRepairDelta: number | null;
      expectedSuspiciousRepairDelta: number | null;
      wouldReduceSupportFloorClosureRows: boolean | null;
      wouldReduceSetBumps: boolean | null;
      wouldIncreaseCapTrimRows: boolean | null;
      removableRows: Array<{
        category:
          | "support_floor_closure"
          | "set_bump"
          | "duplicate_variant"
          | "cap_trim"
          | "material_repair"
          | "major_repair"
          | "suspicious_repair";
        slotId: string;
        muscle: string;
        exerciseName: string | null;
        reason: string;
      }>;
      potentialNewRows: Array<{
        category:
          | "cap_trim"
          | "material_repair"
          | "major_repair"
          | "suspicious_repair"
          | "hard_primary_regression";
        slotId: string;
        muscle: string;
        exerciseName: string | null;
        risk: "low" | "moderate" | "high" | "unknown";
        reason: string;
      }>;
      stillUnknown: Array<
        | "exact_repair_reclassification_requires_full_generation"
        | "weeks_2_to_4_unprojected"
        | "cross_week_progression_unknown"
        | "deload_preservation_unknown"
      >;
      evidence: string[];
    };
    policyReadiness: {
      behaviorReadiness:
        | "safe_to_trial_behavior"
        | "needs_more_projection"
        | "blocked_by_lower_a_safety"
        | "blocked_by_materiality_risk"
        | "blocked_by_accumulation_projection";
      remainingBlockers: string[];
    };
    blockedReasons: Array<
      | "weeks_2_to_4_unprojected"
      | "requires_specialization_cap_override"
      | "would_mutate_lower_a_without_policy"
      | "would_risk_lower_b_hamstrings_route"
      | "cap_trim_risk_unknown"
      | "materiality_delta_unknown"
      | "insufficient_candidate_evidence"
    >;
    recommendation:
      | "safe_to_trial_behavior"
      | "do_not_trial_behavior"
      | "needs_more_projection";
  };
};

export type MesocycleExplainPlannerOnlyNoRepair = {
  enabled: true;
  readOnly: true;
  affectsScoringOrGeneration: false;
  canReplaceRepairedProjection: boolean;
  summary: {
    status: "pass" | "pass_with_warnings" | "partial" | "fail";
    targetLanesSatisfied: number;
    targetLanesMissing: number;
    unresolvedDemandCount: number;
    validationFailureCount: number;
  };
  acceptanceClassification: {
    basicMesocycleShapeStatus:
      | "pass"
      | "pass_with_warnings"
      | "partial"
      | "fail";
    replacementReadinessStatus: "ready" | "not_ready" | "blocked";
    hardBlockers: Array<{
      code: string;
      evidence: string[];
    }>;
    qualityWarnings: Array<{
      code: string;
      evidence: string[];
    }>;
    diagnosticOnly: Array<{
      code: string;
      evidence: string[];
    }>;
    sessionShaping: Array<{
      code: string;
      evidence: string[];
    }>;
    migrationScoreboard: {
      materialRepairCount: number | null;
      majorRepairCount: number | null;
      suspiciousRepairs: number | null;
      canReplaceRepairedProjection: boolean;
      reason: string;
    };
  };
  v2MesocycleStrategyDiagnostic: V2MesocycleStrategyDiagnostic;
  strategyToDemandProjection: V2StrategyToDemandProjection;
  v2BasePlanCompare?: V2BasePlanCompare;
  v2BasePlanShadowConsumptionTrial?: V2BasePlanShadowConsumptionTrial;
  v2CapacityMaterializerProjection?: V2CapacityMaterializerProjection;
  repairPromotionScoreboard?: {
    version: 1;
    readOnly: true;
    affectsScoringOrGeneration: false;
    source: "repaired_planning_reality";
    rawRepairEvidence: {
      rawRowCount: number;
      materialRepairCount: number;
      majorRepairCount: number;
      likelyAvoidableMaterialRepairCount: number;
      remainingMaterialRepairCount: number;
      suspiciousRepairCount: number;
    };
    summary: {
      promotionCandidateCount: number;
      doNotPromoteCount: number;
      safetyNetCount: number;
      collateralDiagnosticCount: number;
      diagnosticOnlyCount: number;
    };
    interpretation: {
      legacyRepairPressure: {
        rawRowCount: number;
        materialRepairCount: number;
        majorRepairCount: number;
        likelyAvoidableMaterialRepairCount: number;
        remainingMaterialRepairCount: number;
        suspiciousRepairCount: number;
        note: "raw_legacy_repair_evidence_not_behavior_promotion_pressure";
      };
      currentV2PolicyGap: {
        supportDirectFloorBlockerCount: number;
        setDistributionCapacityGapCount: number;
        setBudgetPolicyFailureCount: number;
        selectionFeasibilityCapacityPressureCount: number;
        staleWeek1ReadoutArtifactCount: number;
        capAwareExpansionLimitationCount: number;
        concentrationQualityGapCount: number;
        optionalDiagnosticLaneCount: number;
        selectionBlockerCount: number;
        classTaxonomyMismatchCount: number;
      };
      safetyNonRegressionRows: {
        count: number;
        includesSuspiciousRows: boolean;
      };
      staleRepairedProjectionArtifacts: {
        count: number;
        reasonCounts: Record<string, number>;
      };
    };
    promotionCandidates: Array<{
      slotId: string;
      muscle: string;
      exerciseName: string | null;
      action: string;
      materiality: string;
      repairMechanism: string;
      correctOwner:
        | "ExerciseClassDistributionBySlot"
        | "ExerciseSelectionPlan"
        | "SetDistributionIntent"
        | "SlotDemandAllocationByWeek";
      evidence: string[];
    }>;
    doNotPromoteRows: Array<{
      slotId: string | null;
      muscle: string | null;
      exerciseName: string | null;
      action: string;
      materiality: string;
      repairMechanism: string;
      reason: string;
      demotionReasons: string[];
      bucket: "safety_net" | "collateral_diagnostic" | "diagnostic_only";
      evidence: string[];
    }>;
    safetyNetRows: Array<{
      slotId: string | null;
      muscle: string | null;
      exerciseName: string | null;
      action: string;
      materiality: string;
      repairMechanism: string;
      reason: string;
      demotionReasons: string[];
      evidence: string[];
    }>;
    collateralDiagnosticRows: Array<{
      slotId: string | null;
      muscle: string | null;
      exerciseName: string | null;
      action: string;
      materiality: string;
      repairMechanism: string;
      reason: string;
      demotionReasons: string[];
      evidence: string[];
    }>;
    diagnosticRows: Array<{
      slotId: string | null;
      muscle: string | null;
      exerciseName: string | null;
      action: string;
      materiality: string;
      repairMechanism: string;
      reason: string;
      demotionReasons: string[];
      evidence: string[];
    }>;
    rawSuspiciousRows: Array<{
      slotId: string;
      muscle: string;
      exerciseName: string | null;
      repairMechanism: string;
      reason: string;
      recommendation: string;
    }>;
  };
  crossWeekProjectionGate: {
    readOnly: true;
    affectsScoringOrGeneration: false;
    week1Status: {
      status: "pass_with_warnings" | "pass" | "fail" | "unknown";
      basis: string[];
    };
    accumulationWeeksStatus: {
      status:
        | "not_projected"
        | "diagnostic_projection_only"
        | "projected_with_limitations"
        | "ready";
      weeks: Array<{
        week: 2 | 3 | 4;
        phase: string;
        volumeMultiplier: number;
        rirTarget: string;
        projectionBasis:
          | "missing"
          | "repeat_week_1_shape"
          | "scaled_v2_set_distribution_intent"
          | "planner_owned_read_only_projection"
          | "planner_owned_week_projection";
        limitations: string[];
        safeForBehaviorPromotion: false;
      }>;
    };
    deloadStatus: {
      status:
        | "not_projected"
        | "diagnostic_projection_only"
        | "projected_with_limitations"
        | "ready";
      projectionBasis:
        | "missing"
        | "v2_deload_transform_read_only"
        | "planner_owned_deload_projection";
      preserveIdentities: boolean;
      targetVolumeReductionPercent?: { min: number; max: number };
      targetRir?: string;
      limitations: string[];
      safeForBehaviorPromotion: false;
    };
    replacementReadinessStatus: "not_ready" | "limited" | "ready";
    blockers: string[];
    warnings: string[];
    missingInputs: string[];
    projectedWeekSummaries: Array<{
      week: number;
      phase: string;
      volumeMultiplier: number;
      totalPlannedSets: number | null;
      projectionBasis: string;
      limitations: string[];
    }>;
    deloadSummary: {
      targetVolumeReductionPercent?: { min: number; max: number };
      preserveExerciseIdentities: boolean;
      introducesNewMovements: false;
      projectionBasis: string;
      limitations: string[];
    };
    safeToPromoteBehavior: false;
  };
  v2DeloadProjectionDiagnostic: {
    version: 1;
    source: "v2_deload_projection_diagnostic";
    readOnly: true;
    affectsScoringOrGeneration: false;
    status: "not_evaluated" | "projected_with_limitations" | "blocked";
    identityBasis: "week_1_selected_identities";
    projectionBasis: "v2_deload_transform_read_only";
    slots: Array<{
      slotId: string;
      lanes: Array<{
        laneId: string;
        status: "not_evaluated" | "projected_with_limitations" | "blocked";
        limitations: string[];
        exercises: Array<{
          preservedIdentity: {
            exerciseId: string | null;
            exerciseName: string;
            sourceWeek: 1;
          };
          week1Sets: number;
          deloadProjectedSets: number;
          setReductionPercent: number;
          targetRir: string;
          introducesNewMovement: false;
          status:
            | "projected"
            | "projected_with_warning"
            | "not_evaluated"
            | "blocked";
          limitations: string[];
        }>;
      }>;
    }>;
    summary: {
      identitiesPreservedCount: number;
      movementsIntroducedCount: number;
      totalWeek1Sets: number;
      totalDeloadProjectedSets: number;
      volumeReductionPercent: number | null;
      blockedLaneCount: number;
      warningCount: number;
    };
    blockers: string[];
    warnings: string[];
    missingInputs: string[];
    safeForBehaviorPromotion: false;
  };
  v2MesocyclePlan: {
    version: 1;
    source: "v2_planner_no_repair_experimental";
    readOnly: true;
    affectsScoringOrGeneration: false;
    planStatus:
      | "experimental"
      | "week_1_shape_valid"
      | "full_mesocycle_limited"
      | "replacement_not_ready";
    skeleton: {
      split: "upper_lower_4x";
      weeks: 5;
      slotSequence: Array<"upper_a" | "lower_a" | "upper_b" | "lower_b">;
      slots: Array<{
        slotId: "upper_a" | "lower_a" | "upper_b" | "lower_b";
        intent: string;
        targetSessionSets: {
          min: number;
          max: number;
        };
        lanes: Array<{
          laneId: string;
          required: boolean;
          role: "anchor" | "support" | "accessory" | "optional";
          primaryMuscles: string[];
          preferredExerciseClasses: string[];
          targetSets: {
            min: number;
            preferred: number;
            max: number;
          };
          currentWeek1Status: "satisfied" | "partial" | "missing" | "warning";
        }>;
      }>;
    };
    weeklyProgressionModel: {
      weeks: Array<{
        week: number;
        phase:
          | "entry_calibration"
          | "accumulation"
          | "hard_accumulation"
          | "peak_overreach_lite"
          | "deload";
        volumeMultiplier: number | null;
        rirTarget: string;
        progressionIntent:
          | "establish_anchors"
          | "productive_volume"
          | "push_stimulus"
          | "peak_effort"
          | "reduce_fatigue";
        limitations: string[];
      }>;
    };
    deloadTransform: {
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
    validationRules: Array<{
      ruleId: string;
      severity:
        | "hard_blocker"
        | "quality_warning"
        | "diagnostic_only"
        | "session_shaping"
        | "migration_scoreboard";
      description: string;
      week1Status:
        | "pass"
        | "pass_with_warning"
        | "fail"
        | "not_applicable"
        | "unknown";
      fullMesocycleStatus: "pass" | "limited" | "fail" | "unknown";
    }>;
    replacementReadiness: {
      canReplaceRepairedProjection: false;
      reason: string[];
    };
  };
  v2TargetVsNoRepairDiff: {
    version: 1;
    source: "v2_planner_no_repair_experimental";
    readOnly: true;
    affectsScoringOrGeneration: false;
    summary: {
      targetLaneCount: number;
      satisfiedLaneCount: number;
      partialLaneCount: number;
      missingLaneCount: number;
      blockedLaneCount: number;
      repairDependentLaneCount: number;
      migrationCandidateCount: number;
      suspiciousOrBlockedCount: number;
    };
    slotDiffs: Array<{
      slotId: "upper_a" | "lower_a" | "upper_b" | "lower_b";
      laneDiffs: Array<{
        laneId: string;
        targetRole: "anchor" | "support" | "accessory" | "optional";
        targetPrimaryMuscles: string[];
        targetExerciseClasses: string[];
        targetSets: { min: number; preferred: number; max: number };
        currentStatus:
          | "satisfied"
          | "partial"
          | "missing"
          | "blocked"
          | "repair_dependent"
          | "unknown";
        currentEvidence: {
          selectedExercises: Array<{
            name: string;
            sets: number;
            matchedClass?: string;
            role?: string;
          }>;
          relevantDiagnostics: string[];
        };
        gapCause:
          | "none"
          | "inventory_gap"
          | "classification_gap"
          | "capacity_gap"
          | "selection_feasibility_pressure"
          | "stale_week1_readout_artifact"
          | "cap_aware_expansion_limitation"
          | "duplicate_policy_gap"
          | "set_distribution_gap"
          | "concentration_policy_gap"
          | "repair_dependency"
          | "unknown";
        migrationRecommendation:
          | "no_action"
          | "promote_to_planner_later"
          | "needs_classification_review"
          | "needs_inventory_review"
          | "needs_set_distribution_policy"
          | "needs_set_budget_justification"
          | "needs_concentration_justification"
          | "keep_diagnostic_only"
          | "blocked_do_not_promote";
        severity:
          | "pass"
          | "quality_warning"
          | "migration_candidate"
          | "hard_blocker"
          | "diagnostic_only";
      }>;
    }>;
    replacementReadinessImpact: {
      canReplaceRepairedProjection: false;
      blockers: string[];
      nextBestMigrationSlice: string | null;
    };
  };
  v2SetDistributionIntent: V2SetDistributionIntent;
  v2SupportLanePolicy?: V2SupportLanePolicy;
  v2SupportLaneProjectionDiagnostic: V2SupportLaneProjectionDiagnostic;
  v2SelectionCapacityPlanDiagnostic: V2SelectionCapacityPlanDiagnostic;
  plannerOwnedAccumulationProjection: PlannerOwnedAccumulationProjection;
  v2ExerciseSelectionPlanDiagnostic: V2ExerciseSelectionPlanDiagnostic;
  v2LaneSelectionIntentAudit: V2LaneSelectionIntentAudit;
  lowAxialHipExtensionLimitation: {
    version: 1;
    source: "v2_planner_no_repair_diagnostic";
    readOnly: true;
    affectsScoringOrGeneration: false;
    slotId: "lower_b";
    status:
      | "acceptable_with_limitations"
      | "not_acceptable"
      | "not_present"
      | "not_evaluated";
    limitationText: string;
    acceptanceCriteria: {
      lowerBKneeFlexionCurlDirectFloor: {
        status: "met" | "below" | "not_evaluated";
        directSets: number;
        floor: number | null;
      };
      weeklyHamstringsTarget: {
        status: "met" | "below" | "unknown";
        projectedEffectiveSets: number | null;
        targetMin: number | null;
        targetPreferred: number | null;
      };
      axialFatigueManagement: {
        status:
          | "favors_low_axial"
          | "not_indicated"
          | "not_evaluated";
        evidence: string[];
      };
    };
    hamstringContribution: {
      lowerBEffectiveSets: number;
      weeklyEffectiveSets: number | null;
      curlEffectiveSets: number;
      hipExtensionEffectiveSets: number;
      trueHingeEffectiveSets: number;
      otherEffectiveSets: number;
      curlShareOfLowerBPercent: number | null;
      hipExtensionShareOfLowerBPercent: number | null;
      trueHingeShareOfLowerBPercent: number | null;
      weeklyCurlEffectiveSets: number;
      weeklyHipExtensionEffectiveSets: number;
      weeklyTrueHingeEffectiveSets: number;
      weeklyOtherEffectiveSets: number;
      curlShareOfWeeklyPercent: number | null;
      hipExtensionShareOfWeeklyPercent: number | null;
      trueHingeShareOfWeeklyPercent: number | null;
    };
    trueHingeExposureCount: number;
    lowAxialHipExtensionAnchorCount: number;
    lowAxialExercises: Array<{
      exerciseName: string;
      sets: number;
      hamstringsEffectiveSets: number;
      glutesEffectiveSets: number;
      lowerBackEffectiveSets: number;
    }>;
    expansionGuidance: string[];
    evidence: string[];
    limitations: string[];
    safeForBehaviorPromotion: false;
  };
  slotPlans: Array<{
    slotId: string;
    exercises: Array<{
      exerciseName: string;
      lane: string;
      exerciseClass: string;
      sets: number;
    }>;
    missingLanes: string[];
    unresolvedDemand: string[];
    validationFailures: string[];
  }>;
  weeklyMuscleTotals: Array<{
    muscle: string;
    projectedEffectiveSets: number;
    targetMin: number | null;
    targetPreferred: number | null;
    status: "below" | "within" | "above" | "diagnostic";
  }>;
  setAllocationChanges: Array<{
    slotId: string;
    lane: string;
    exerciseName: string;
    setsBefore: number;
    setsAfter: number;
    effectiveStimulusDeltaByMuscle: Record<string, number>;
  }>;
  weeklyMuscleTotalChanges: Array<{
    muscle: string;
    beforeEffectiveSets: number;
    afterEffectiveSets: number;
    deltaEffectiveSets: number;
    targetMin: number | null;
    targetPreferred: number | null;
    statusBefore: "below" | "within" | "above" | "diagnostic";
    statusAfter: "below" | "within" | "above" | "diagnostic";
  }>;
  acceptanceChecks: Array<{
    check: string;
    status: "pass" | "fail" | "partial" | "unknown";
    evidence: string[];
  }>;
  acceptanceFailures: MesocycleExplainPlannerOnlyNoRepairConcentrationRow[];
  qualityWarnings: MesocycleExplainPlannerOnlyNoRepairConcentrationRow[];
  diagnosticRows: MesocycleExplainPlannerOnlyNoRepairConcentrationRow[];
  ignoredRows: MesocycleExplainPlannerOnlyNoRepairConcentrationRow[];
  repairDependenciesDisabled: string[];
  comparisonToRepaired?: {
    repairedPasses: boolean;
    noRepairPasses: boolean;
    mainGaps: string[];
  };
  debugArtifact?: MesocycleExplainPlannerOnlyNoRepairDebugArtifactManifest;
};

export type MesocycleExplainPlannerOnlyNoRepairDebugArtifactManifest = {
  kind: "v2_debug_index" | "v2_planner_no_repair_debug";
  created: boolean;
  fileName?: string;
  relativePath?: string;
  sizeBytes?: number;
  sha256?: string;
  detailLevel?: V2DebugDetailLevel;
  enableWith?: "--v2-debug-artifact";
  contains: string[];
};

export type V2DebugDetailLevel = "summary" | "compact" | "full";

export type V2DebugShardStatus = "written" | "skipped" | "not_available";

export type V2DebugShardMetadata = {
  id: string;
  relativePath: string;
  hash: string;
  bytes: number;
  detailLevel: V2DebugDetailLevel;
  status: V2DebugShardStatus;
  budgetBytes?: number;
  budgetStatus?: "within_budget" | "compacted_to_budget" | "exceeded";
};

export type V2DebugArtifactBudgets = {
  mainArtifactBudgetBytes: number;
  v2IndexBudgetBytes: number;
  defaultShardBudgetBytes: number;
  fullDetailShardBudgetBytes: number;
  perArtifactLimitBytes: number;
};

export type MesocycleExplainPlannerOnlyNoRepairDebugShard = {
  version: 1;
  kind: "v2_debug_shard";
  id: string;
  generatedAt: string;
  parent: {
    fileName: string;
    relativePath: string;
    indexFileName: string;
    indexRelativePath: string;
    mode: "mesocycle-explain";
    sourceMesocycleId?: string;
    retrospectiveMesocycleId?: string;
    requestFlags: string[];
  };
  readOnly: true;
  affectsScoringOrGeneration: false;
  detailLevel: V2DebugDetailLevel;
  summary: Record<string, unknown>;
  data: Record<string, unknown>;
};

export type MesocycleExplainPlannerOnlyNoRepairDebugIndex = {
  version: 1;
  kind: "v2_debug_index";
  generatedAt: string;
  parent: {
    fileName: string;
    relativePath: string;
    mode: "mesocycle-explain";
    sourceMesocycleId?: string;
    retrospectiveMesocycleId?: string;
    requestFlags: string[];
  };
  readOnly: true;
  affectsScoringOrGeneration: false;
  detailLevel: V2DebugDetailLevel;
  budgets: V2DebugArtifactBudgets;
  summary: Record<string, unknown>;
  plannerOnlyNoRepair: Record<string, unknown>;
  shards: V2DebugShardMetadata[];
};

export type MesocycleExplainPlannerOnlyNoRepairDebugArtifact =
  MesocycleExplainPlannerOnlyNoRepairDebugIndex;

export type MesocycleExplainPlannerOnlyNoRepairConcentrationSeverity =
  | "acceptance_blocker"
  | "quality_warning"
  | "diagnostic_only"
  | "ignored_for_acceptance";

export type MesocycleExplainPlannerOnlyNoRepairConcentrationRow = {
  severity: MesocycleExplainPlannerOnlyNoRepairConcentrationSeverity;
  slotId: string;
  exerciseName: string;
  muscle: string;
  percentageOfWeeklyStimulus: number;
  weeklyEffectiveSets: number;
  setCount: number;
  producedOrIncreasedByRepair: boolean;
  reason: string;
  evidence: string[];
};

export type MesocycleExplainAuditPayload = {
  version: typeof MESOCYCLE_EXPLAIN_AUDIT_PAYLOAD_VERSION;
  ownerEmail?: string;
  sourceMesocycleId: string;
  retrospectiveMesocycleId: string;
  preview: {
    sourceMesocycleId: string;
    rationaleBasis: "persisted_handoff_summary" | "reconstructed_now";
    designBasis: {
      focus: string;
      splitType: string;
      sessionsPerWeek: number;
      daysPerWeek: number;
      durationWeeks: number;
      volumeTarget: string;
      intensityBias: string;
      profileReasonCodes: string[];
      structureReasonCodes: string[];
      startingPointReasonCodes: string[];
    };
    carryForwardReasons: Array<{
      exerciseId: string;
      exerciseName: string;
      sessionIntent: string;
      role: string;
      recommendation: string;
      signalQuality: string;
      reasonCodes: string[];
    }>;
    slotPlans: MesocycleExplainSlotRow[];
    projectedSessions: MesocycleExplainPreviewProjectedSession[];
    projectionDiagnostics: MesocycleExplainProjectionDiagnostics;
    exerciseRationale: MesocycleExplainExerciseRationale[];
  };
  seed: {
    mesocycleId: string;
    available: boolean;
    provenanceConsistency?: AcceptedMesocycleSeedProvenanceConsistency;
    slotPlans: MesocycleExplainSlotRow[];
    exerciseRationale: MesocycleExplainExerciseRationale[];
  };
  reality: {
    mesocycleId: string;
    workoutCount: number;
    generatedVsSaved: MesocycleExplainRealityWorkout[];
    runtimeDrift: MesocycleExplainRealityWorkout[];
    exerciseRationale: MesocycleExplainExerciseRationale[];
  };
  comparison: {
    previewVsSeed: {
      comparable: boolean;
      comparisonBasis:
        | "fresh_reprojection"
        | "accepted_projection_artifact"
        | "none";
      slotDiffs: MesocycleExplainComparisonSlotDiff[];
    };
    seedVsReality: {
      comparable: boolean;
      workoutDrift: MesocycleExplainRealityWorkout[];
    };
    previewVsReality: {
      comparable: boolean;
      comparisonBasis: "latest_saved_by_slot" | "none";
      slotDiffs: MesocycleExplainComparisonSlotDiff[];
    };
  };
  limitations: string[];
  plannerOnlyDryRun?: MesocycleExplainPlannerOnlyDryRun;
  plannerOnlyNoRepair?: MesocycleExplainPlannerOnlyNoRepair;
};

export type WorkoutAuditRun = {
  context: WorkoutAuditContext;
  generatedAt: string;
  generationResult?: SessionGenerationResult;
  sessionSnapshot?: SessionAuditSnapshot;
  generationPath?: WorkoutAuditGenerationPath;
  acceptedSeedProvenanceConsistency?: AcceptedMesocycleSeedProvenanceConsistency;
  historicalWeek?: HistoricalWeekAuditPayload;
  weeklyRetro?: WeeklyRetroAuditPayload;
  projectedWeekVolume?: ProjectedWeekVolumeAuditPayload;
  preSessionReadiness?: PreSessionReadinessAuditPayload;
  activeMesocycleSlotReseed?: ActiveMesocycleSlotReseedAuditPayload;
  replaceEmptyMesocycleWithV2?: ReplaceEmptyMesocycleWithV2AuditPayload;
  v2AcceptedSeedPrepareCompare?: V2AcceptedSeedPrepareCompareAuditPayload;
  nextMesocycleHandoffDryRun?: NextMesocycleHandoffDryRunPayload;
  nextMesocycleAcceptanceGate?: NextMesocycleAcceptanceGatePayload;
  nextMesocyclePostAcceptVerification?: NextMesocyclePostAcceptVerificationPayload;
  mesocycleExplain?: MesocycleExplainAuditPayload;
  progressionAnchor?: ProgressionAnchorAuditPayload;
};

export type WorkoutAuditArtifact = {
  version: typeof WORKOUT_AUDIT_ARTIFACT_VERSION;
  generatedAt: string;
  mode: WorkoutAuditCanonicalMode;
  requestedMode: WorkoutAuditRequestMode;
  source: "live" | "pii-safe";
  conclusions: AuditConclusionBlock;
  identity: {
    userId: string;
    ownerEmail?: string;
  };
  request: WorkoutAuditRequest;
  nextSession?: NextWorkoutContext;
  generation?: AuditSessionGenerationResult;
  sessionSnapshot?: SessionAuditSnapshot;
  canonicalSemantics?: AuditCanonicalSemantics;
  generationPath?: WorkoutAuditGenerationPath;
  generationProvenance?: WorkoutAuditGenerationProvenanceSummary;
  historicalWeek?: HistoricalWeekAuditPayload;
  weeklyRetro?: WeeklyRetroAuditPayload;
  projectedWeekVolume?: ProjectedWeekVolumeAuditPayload;
  preSessionReadiness?: PreSessionReadinessAuditPayload;
  activeMesocycleSlotReseed?: ActiveMesocycleSlotReseedAuditPayload;
  replaceEmptyMesocycleWithV2?: ReplaceEmptyMesocycleWithV2AuditPayload;
  v2AcceptedSeedPrepareCompare?: V2AcceptedSeedPrepareCompareAuditPayload;
  nextMesocycleHandoffDryRun?: NextMesocycleHandoffDryRunPayload;
  nextMesocycleAcceptanceGate?: NextMesocycleAcceptanceGatePayload;
  nextMesocyclePostAcceptVerification?: NextMesocyclePostAcceptVerificationPayload;
  mesocycleExplain?: MesocycleExplainAuditPayload;
  progressionAnchor?: ProgressionAnchorAuditPayload;
  warningSummary: AuditWarningSummary;
};
