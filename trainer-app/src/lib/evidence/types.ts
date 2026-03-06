import type { PlannerDiagnostics } from "@/lib/planner-diagnostics/types";

export type CyclePhase = "accumulation" | "intensification" | "realization" | "deload";

export type CycleContextSnapshot = {
  weekInMeso: number;
  weekInBlock: number;
  mesocycleLength?: number;
  phase: CyclePhase;
  blockType: CyclePhase;
  isDeload: boolean;
  source: "computed" | "fallback";
};

export type DeloadDecisionMode = "none" | "scheduled" | "reactive" | "readiness";

export type DeloadDecisionAppliedTo = "none" | "volume" | "load" | "both";

export type DeloadDecision = {
  mode: DeloadDecisionMode;
  reason: string[];
  reductionPercent: number;
  appliedTo: DeloadDecisionAppliedTo;
};

export type LifecycleRirTarget = {
  min: number;
  max: number;
};

export type SessionDecisionVolumeTargetSource =
  | "lifecycle"
  | "soreness_adjusted_lifecycle"
  | "unknown";

export type SessionDecisionReadinessScaling = {
  applied: boolean;
  exerciseIds: string[];
  scaledUpCount: number;
  scaledDownCount: number;
};

export type SessionDecisionExceptionCode =
  | "soreness_suppression"
  | "deload"
  | "readiness_scale"
  | "optional_gap_fill";

export type SessionDecisionException = {
  code: SessionDecisionExceptionCode;
  message: string;
};

export type PlannerDiagnosticsMode = "standard" | "debug";

export type SessionDecisionReceipt = {
  version: 1;
  cycleContext: CycleContextSnapshot;
  targetMuscles?: string[];
  lifecycleRirTarget?: LifecycleRirTarget;
  lifecycleVolume: {
    targets?: Record<string, number>;
    source: SessionDecisionVolumeTargetSource;
  };
  sorenessSuppressedMuscles: string[];
  deloadDecision: DeloadDecision;
  plannerDiagnosticsMode?: PlannerDiagnosticsMode;
  plannerDiagnostics?: PlannerDiagnostics;
  readiness: {
    wasAutoregulated: boolean;
    signalAgeHours: number | null;
    fatigueScoreOverall: number | null;
    intensityScaling: SessionDecisionReadinessScaling;
    rationale?: string;
  };
  exceptions: SessionDecisionException[];
};

export type ProgressionSetSummary = {
  reps: number | null;
  load: number | null;
  rpe: number | null;
  performedAt?: string | null;
};

export type ProgressionReceiptTrigger =
  | "double_progression"
  | "hold"
  | "deload"
  | "readiness_scale"
  | "insufficient_data";

export type ProgressionReceipt = {
  lastPerformed: ProgressionSetSummary | null;
  todayPrescription: ProgressionSetSummary | null;
  delta: {
    load: number | null;
    loadPercent: number | null;
    reps: number | null;
    rpe: number | null;
  };
  trigger: ProgressionReceiptTrigger;
  decisionLog?: string[];
};
