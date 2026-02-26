export type CyclePhase = "accumulation" | "intensification" | "realization" | "deload";

export type CycleContextSnapshot = {
  weekInMeso: number;
  weekInBlock: number;
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
