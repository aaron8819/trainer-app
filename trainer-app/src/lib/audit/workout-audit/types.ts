import type { SessionIntent } from "@/lib/engine/session-types";
import type { PlannerDiagnosticsMode } from "@/lib/evidence/types";
import type { NextWorkoutContext } from "@/lib/api/next-session";
import type { SessionGenerationResult } from "@/lib/api/template-session/types";
import type {
  ProgressionDecisionTrace,
  SessionAuditMutationSummary,
  SessionAuditSnapshot,
} from "@/lib/evidence/session-audit-types";
import {
  HISTORICAL_WEEK_AUDIT_PAYLOAD_VERSION,
  PROGRESSION_ANCHOR_AUDIT_PAYLOAD_VERSION,
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
    source?: "next-session" | "intent-preview" | "forced-deload";
  };
  nextSession?: NextWorkoutContext;
  historicalWeek?: {
    week: number;
    mesocycleId?: string;
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

export type WorkoutAuditRun = {
  context: WorkoutAuditContext;
  generatedAt: string;
  generationResult?: SessionGenerationResult;
  sessionSnapshot?: SessionAuditSnapshot;
  generationPath?: WorkoutAuditGenerationPath;
  historicalWeek?: HistoricalWeekAuditPayload;
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
  generation?: SessionGenerationResult;
  sessionSnapshot?: SessionAuditSnapshot;
  canonicalSemantics?: AuditCanonicalSemantics;
  generationPath?: WorkoutAuditGenerationPath;
  historicalWeek?: HistoricalWeekAuditPayload;
  progressionAnchor?: ProgressionAnchorAuditPayload;
  warningSummary: AuditWarningSummary;
};
