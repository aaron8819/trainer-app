import type {
  CycleContextSnapshot,
  DeloadDecision,
  DeloadDecisionMode,
  SessionDecisionReceipt,
} from "@/lib/evidence/types";

export const CANONICAL_DELOAD_PHASES = ["DELOAD", "ACTIVE_DELOAD"] as const;

export const CANONICAL_DELOAD_RIR_TARGET = {
  min: 5,
  max: 6,
} as const;

export const CANONICAL_DELOAD_SET_TARGETS = {
  main: 2,
  accessory: 1,
} as const;

export const CANONICAL_DELOAD_SET_MULTIPLIER = 0.5;
export const CANONICAL_DELOAD_VOLUME_FRACTION = 0.45;
export const CANONICAL_DELOAD_BACKOFF_MULTIPLIER = 0.75;
export const CANONICAL_DELOAD_INTENSITY_MULTIPLIER = 0.7;
export const CANONICAL_DELOAD_RPE_CAP = 6.0;
export const CANONICAL_DELOAD_DECISION_REDUCTION_PERCENT = 50;

export const CANONICAL_DELOAD_HISTORY_POLICY = {
  countsTowardCompliance: true,
  countsTowardRecentStimulus: true,
  countsTowardWeeklyVolume: true,
  countsTowardProgressionHistory: false,
  countsTowardPerformanceHistory: false,
  updatesProgressionAnchor: false,
  reanchorNextBlockFromAccumulation: true,
} as const;

function normalizeDeloadPhaseValue(value: string | null | undefined): string | undefined {
  return typeof value === "string" ? value.trim().toUpperCase() : undefined;
}

export function isCanonicalDeloadPhase(value: string | null | undefined): boolean {
  const normalized = normalizeDeloadPhaseValue(value);
  return normalized != null && CANONICAL_DELOAD_PHASES.includes(
    normalized as (typeof CANONICAL_DELOAD_PHASES)[number]
  );
}

export function isCanonicalDeloadDecision(
  decision: Pick<DeloadDecision, "mode"> | null | undefined
): boolean {
  return decision != null && decision.mode !== "none";
}

export function isCanonicalDeloadCycleContext(
  cycleContext: Pick<CycleContextSnapshot, "isDeload" | "phase" | "blockType"> | null | undefined
): boolean {
  return (
    cycleContext?.isDeload === true ||
    isCanonicalDeloadPhase(cycleContext?.phase) ||
    isCanonicalDeloadPhase(cycleContext?.blockType)
  );
}

export function isCanonicalDeloadReceipt(
  receipt:
    | Pick<SessionDecisionReceipt, "cycleContext" | "deloadDecision">
    | null
    | undefined
): boolean {
  return (
    isCanonicalDeloadDecision(receipt?.deloadDecision) ||
    isCanonicalDeloadCycleContext(receipt?.cycleContext)
  );
}

export function getCanonicalDeloadTargetRpe(): number {
  const midpoint =
    (CANONICAL_DELOAD_RIR_TARGET.min + CANONICAL_DELOAD_RIR_TARGET.max) / 2;
  return Number((10 - midpoint).toFixed(1));
}

export function resolveCanonicalDeloadSetCount(baselineSetCount: number): number {
  if (baselineSetCount <= 1) {
    return 1;
  }
  if (baselineSetCount === 2) {
    return 1;
  }
  return Math.max(2, Math.ceil(baselineSetCount * CANONICAL_DELOAD_SET_MULTIPLIER));
}

export function buildCanonicalDeloadDecision(
  mode: Exclude<DeloadDecisionMode, "none">,
  reason: string[]
): DeloadDecision {
  return {
    mode,
    reason,
    reductionPercent: CANONICAL_DELOAD_DECISION_REDUCTION_PERCENT,
    appliedTo: "both",
  };
}

export function buildNoDeloadDecision(): DeloadDecision {
  return {
    mode: "none",
    reason: [],
    reductionPercent: 0,
    appliedTo: "none",
  };
}
