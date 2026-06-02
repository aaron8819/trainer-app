import type { AcceptedMesocycleSeedProvenanceConsistency } from "@/lib/api/accepted-mesocycle-seed-provenance";
import type { NextWorkoutContext } from "@/lib/api/next-session";
import type { ProjectedWeekVolumeReport } from "@/lib/api/projected-week-volume";
import type { RuntimeDoseAdjustmentDiagnostic } from "@/lib/api/runtime-dose-guidance";
import type { SessionGenerationResult } from "@/lib/api/template-session/types";
import type { SessionAuditSnapshot } from "@/lib/evidence/session-audit-types";
import type { PreSessionReadinessContract } from "./pre-session-readiness-contract";

export type PreSessionReadinessActiveMesocycleEvidence = {
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

export type PreSessionReadinessBoundaryEvidence = {
  readOnly: true;
  affectsScoringOrGeneration: false;
  consumedByProduction: false;
  wouldWriteTransaction: false;
};

export type PreSessionReadinessEvidence = PreSessionReadinessBoundaryEvidence & {
  activeMesocycle: PreSessionReadinessActiveMesocycleEvidence;
};

export type PreSessionReadinessCurrentWeekAuditEvidence = {
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

export type PreSessionReadinessInterventionHintEvidence = {
  muscle: string;
  suggestedSets: number;
  reason: string;
};

export type PreSessionReadinessSessionRiskEvidence = {
  slotId: string;
  issue: string;
};

export type PreSessionReadinessProjectedWeekEvidence =
  ProjectedWeekVolumeReport & {
    version: 1;
    currentWeekAudit?: PreSessionReadinessCurrentWeekAuditEvidence;
    interventionHints?: PreSessionReadinessInterventionHintEvidence[];
    sessionRisks?: PreSessionReadinessSessionRiskEvidence[];
    runtimeDoseAdjustmentDiagnostics?: RuntimeDoseAdjustmentDiagnostic[];
  };

export type PreSessionReadinessGenerationPathEvidence = {
  requestedMode: string;
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

export type PreSessionReadinessWeeklyRetroEvidence = {
  volumeTargeting: {
    overMav: string[];
    overTargetOnly: string[];
  };
};

export type PreSessionReadinessContractBuildInput = {
  userId: string;
  ownerEmail?: string;
  evidence: PreSessionReadinessEvidence;
  nextSession?: NextWorkoutContext;
  generation?: SessionGenerationResult;
  sessionSnapshot?: SessionAuditSnapshot;
  generationPath?: PreSessionReadinessGenerationPathEvidence;
  seedConsistency?: AcceptedMesocycleSeedProvenanceConsistency;
  projectedWeek?: PreSessionReadinessProjectedWeekEvidence;
  weeklyRetro?: PreSessionReadinessWeeklyRetroEvidence;
  contractSource?: PreSessionReadinessContract["scope"]["source"];
  auditOnly?: boolean;
  boundaryNotes?: string[];
};
