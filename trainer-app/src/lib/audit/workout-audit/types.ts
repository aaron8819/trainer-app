import type { SessionIntent } from "@/lib/engine/session-types";
import type { PlannerDiagnosticsMode, SessionSlotSnapshot } from "@/lib/evidence/types";
import type { NextWorkoutContext } from "@/lib/api/next-session";
import type {
  ProjectedWeekVolumeMuscleRow,
  ProjectedWeekVolumeSessionSummary,
} from "@/lib/api/projected-week-volume";
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
  PROJECTED_WEEK_VOLUME_AUDIT_PAYLOAD_VERSION,
  PROGRESSION_ANCHOR_AUDIT_PAYLOAD_VERSION,
  WEEKLY_RETRO_AUDIT_PAYLOAD_VERSION,
  WORKOUT_AUDIT_ARTIFACT_VERSION,
} from "./constants";
import type {
  WorkoutAuditCanonicalMode,
  WorkoutAuditRequestMode,
} from "./constants";

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
  workoutId?: string;
  exerciseId?: string;
  plannerDiagnosticsMode?: PlannerDiagnosticsMode;
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
  };
  projectedWeekVolume?: {
    enabled: true;
  };
  activeMesocycleSlotReseed?: {
    enabled: true;
  };
  progressionAnchor?: {
    workoutId?: string;
    exerciseId: string;
  };
};

export type WorkoutAuditGenerationPath = {
  requestedMode: WorkoutAuditRequestMode;
  executionMode:
    | "standard_generation"
    | "explicit_deload_preview"
    | "active_deload_reroute";
  generator: "generateSessionFromIntent" | "generateDeloadSessionFromIntent";
  reason:
    | "standard_future_week_or_preview"
    | "explicit_deload_mode"
    | "active_mesocycle_state_active_deload";
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
    relation: Array<"target_week" | "linked_selection_metadata" | "linked_optional_workout">;
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

export type WeeklyRetroAuditSessionExecutionRow = {
  workoutId: string;
  scheduledDate: string;
  status: string;
  selectionMode?: string;
  sessionIntent?: string;
  snapshotSource: HistoricalWeekAuditSession["snapshotSource"];
  semanticKind?: "advancing" | "gap_fill" | "supplemental" | "non_advancing_generic";
  consumesWeeklyScheduleIntent: boolean;
  isCloseout: boolean;
  isDeload: boolean;
  slot?: SessionSlotSnapshot;
  mesocycleSnapshot?: NonNullable<HistoricalWeekAuditSession["sessionSnapshot"]["saved"]>["mesocycleSnapshot"];
  cycleContext?: NonNullable<HistoricalWeekAuditSession["sessionSnapshot"]["generated"]>["cycleContext"];
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
  interventions: Array<{
    priority: "high" | "medium" | "low";
    kind:
      | "slot_identity"
      | "mutation_drift"
      | "legacy_coverage"
      | "volume_deficit"
      | "volume_overshoot";
    summary: string;
    evidence: string[];
  }>;
  rootCauses: Array<{
    code:
      | "slot_identity_gap"
      | "slot_identity_duplicate"
      | "slot_identity_intent_mismatch"
      | "mutation_drift"
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
};

export type CurrentWeekAuditEvaluation = {
  belowMEV: string[];
  overMAV: string[];
  underTargetClusters: Array<{
    muscle: string;
    deficit: number;
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

export type WorkoutAuditRun = {
  context: WorkoutAuditContext;
  generatedAt: string;
  generationResult?: SessionGenerationResult;
  sessionSnapshot?: SessionAuditSnapshot;
  generationPath?: WorkoutAuditGenerationPath;
  historicalWeek?: HistoricalWeekAuditPayload;
  weeklyRetro?: WeeklyRetroAuditPayload;
  projectedWeekVolume?: ProjectedWeekVolumeAuditPayload;
  activeMesocycleSlotReseed?: ActiveMesocycleSlotReseedAuditPayload;
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
  historicalWeek?: HistoricalWeekAuditPayload;
  weeklyRetro?: WeeklyRetroAuditPayload;
  projectedWeekVolume?: ProjectedWeekVolumeAuditPayload;
  activeMesocycleSlotReseed?: ActiveMesocycleSlotReseedAuditPayload;
  progressionAnchor?: ProgressionAnchorAuditPayload;
  warningSummary: AuditWarningSummary;
};
