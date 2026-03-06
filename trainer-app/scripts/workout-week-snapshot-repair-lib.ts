import { WorkoutStatus } from "@prisma/client";
import { isStrictOptionalGapFillSession } from "@/lib/gap-fill/classifier";
import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";

export type RepairConfidence = "high" | "medium" | "low" | "none";
export type RepairSource = "receipt_cycle_context" | "scheduled_date_bucket" | "none";

export type CandidateWorkoutRow = {
  id: string;
  userId: string;
  status: WorkoutStatus;
  selectionMode: string | null;
  sessionIntent: string | null;
  selectionMetadata: unknown;
  scheduledDate: Date;
  completedAt: Date | null;
  mesocycleId: string | null;
  mesocycleWeekSnapshot: number | null;
  mesocyclePhaseSnapshot: string | null;
  mesoSessionSnapshot: number | null;
  advancesSplit: boolean;
  mesocycle: {
    id: string;
    durationWeeks: number;
    sessionsPerWeek: number;
    startWeek: number;
    macroCycle: { startDate: Date };
  } | null;
};

export type WeekInference = {
  inferredCanonicalWeek: number | null;
  source: RepairSource;
  confidence: RepairConfidence;
  reason: string;
  strictGapFill: boolean;
  receiptWeek: number | null;
  scheduledDateWeek: number | null;
};

const PERFORMED_STATUSES = new Set<WorkoutStatus>(["COMPLETED", "PARTIAL"]);

function toValidWeek(value: unknown, durationWeeks: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const integer = Math.trunc(value);
  if (integer < 1) {
    return null;
  }
  if (durationWeeks != null && integer > durationWeeks) {
    return null;
  }
  return integer;
}

function deriveScheduledDateWeek(row: CandidateWorkoutRow): number | null {
  if (!row.mesocycle) {
    return null;
  }
  const mesoStart = new Date(row.mesocycle.macroCycle.startDate);
  mesoStart.setDate(mesoStart.getDate() + row.mesocycle.startWeek * 7);
  const deltaMs = row.scheduledDate.getTime() - mesoStart.getTime();
  const week = Math.floor(deltaMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  return toValidWeek(week, row.mesocycle.durationWeeks);
}

function normalizeReceiptPhase(phase: unknown): string | null {
  return typeof phase === "string" && phase.length > 0 ? phase.toUpperCase() : null;
}

export function inferWorkoutCanonicalWeek(row: CandidateWorkoutRow): WeekInference {
  const receipt = readSessionDecisionReceipt(row.selectionMetadata);
  const strictGapFill = isStrictOptionalGapFillSession({
    selectionMetadata: row.selectionMetadata,
    selectionMode: row.selectionMode,
    sessionIntent: row.sessionIntent,
  });
  const durationWeeks = row.mesocycle?.durationWeeks ?? null;
  const receiptWeek = toValidWeek(receipt?.cycleContext.weekInMeso, durationWeeks);
  const scheduledDateWeek = deriveScheduledDateWeek(row);
  const isPerformed = PERFORMED_STATUSES.has(row.status);
  const receiptPhase = normalizeReceiptPhase(receipt?.cycleContext.phase);

  if (receiptWeek != null) {
    const phaseConflict =
      row.mesocyclePhaseSnapshot != null &&
      receiptPhase != null &&
      row.mesocyclePhaseSnapshot !== receiptPhase;

    if (strictGapFill && isPerformed && !phaseConflict) {
      return {
        inferredCanonicalWeek: receiptWeek,
        source: "receipt_cycle_context",
        confidence: "high",
        reason: "strict_gap_fill_receipt_anchor",
        strictGapFill,
        receiptWeek,
        scheduledDateWeek,
      };
    }

    if (isPerformed && !phaseConflict) {
      return {
        inferredCanonicalWeek: receiptWeek,
        source: "receipt_cycle_context",
        confidence: "medium",
        reason: "receipt_cycle_context_week",
        strictGapFill,
        receiptWeek,
        scheduledDateWeek,
      };
    }

    if (phaseConflict) {
      return {
        inferredCanonicalWeek: receiptWeek,
        source: "receipt_cycle_context",
        confidence: "low",
        reason: "receipt_week_present_but_phase_conflicts_with_snapshot",
        strictGapFill,
        receiptWeek,
        scheduledDateWeek,
      };
    }

    return {
      inferredCanonicalWeek: receiptWeek,
      source: "receipt_cycle_context",
      confidence: "low",
      reason: "receipt_cycle_context_week_non_performed_status",
      strictGapFill,
      receiptWeek,
      scheduledDateWeek,
    };
  }

  if (scheduledDateWeek != null) {
    return {
      inferredCanonicalWeek: scheduledDateWeek,
      source: "scheduled_date_bucket",
      confidence: "low",
      reason: "fallback_scheduled_date_bucket_no_receipt_week",
      strictGapFill,
      receiptWeek,
      scheduledDateWeek,
    };
  }

  return {
    inferredCanonicalWeek: null,
    source: "none",
    confidence: "none",
    reason: "no_canonical_week_source_found",
    strictGapFill,
    receiptWeek,
    scheduledDateWeek,
  };
}

