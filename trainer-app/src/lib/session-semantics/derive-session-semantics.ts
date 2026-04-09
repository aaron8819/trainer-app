import {
  isStrictOptionalGapFillSession,
  resolveEffectiveSelectionMode,
} from "@/lib/gap-fill/classifier";
import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import type {
  SessionAuditSemanticsReason,
  SessionAuditSemanticsTrace,
} from "@/lib/evidence/session-audit-types";
import {
  CANONICAL_DELOAD_HISTORY_POLICY,
  isCanonicalDeloadPhase,
  isCanonicalDeloadReceipt,
} from "@/lib/deload/semantics";
import { isCloseoutSession } from "@/lib/session-semantics/closeout-classifier";
import { isStrictSupplementalDeficitSession } from "@/lib/session-semantics/supplemental-classifier";

export type DerivedSessionKind =
  | "advancing"
  | "gap_fill"
  | "supplemental"
  | "non_advancing_generic";

export type SessionSemanticsInput = {
  advancesSplit?: boolean | null;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  selectionMetadata?: unknown;
  templateId?: string | null;
  mesocyclePhase?: string | null;
};

export type SessionSemantics = {
  kind: DerivedSessionKind;
  effectiveSelectionMode?: string;
  isDeload: boolean;
  isStrictGapFill: boolean;
  isStrictSupplemental: boolean;
  isCloseout: boolean;
  advancesLifecycle: boolean;
  consumesWeeklyScheduleIntent: boolean;
  countsTowardCompliance: boolean;
  countsTowardRecentStimulus: boolean;
  countsTowardWeeklyVolume: boolean;
  countsTowardProgressionHistory: boolean;
  countsTowardPerformanceHistory: boolean;
  updatesProgressionAnchor: boolean;
  eligibleForUniqueIntentSubtraction: boolean;
  reasons: SessionAuditSemanticsReason[];
  trace: SessionAuditSemanticsTrace;
};

function normalizePhase(value: string | null | undefined): string | undefined {
  return typeof value === "string" ? value.trim().toUpperCase() : undefined;
}

function isDeloadSession(input: SessionSemanticsInput): boolean {
  const receipt = readSessionDecisionReceipt(input.selectionMetadata);
  const cycleContext = receipt?.cycleContext;
  const phase = normalizePhase(cycleContext?.phase ?? input.mesocyclePhase);

  return (
    isCanonicalDeloadReceipt(receipt) ||
    isCanonicalDeloadPhase(phase)
  );
}

export function deriveSessionSemantics(
  input: SessionSemanticsInput
): SessionSemantics {
  void input.templateId;

  const effectiveSelectionMode = resolveEffectiveSelectionMode({
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
  });

  const isStrictGapFill = isStrictOptionalGapFillSession({
    selectionMetadata: input.selectionMetadata,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
  });

  const isStrictSupplemental = isStrictSupplementalDeficitSession({
    selectionMetadata: input.selectionMetadata,
    selectionMode: input.selectionMode,
    sessionIntent: input.sessionIntent,
  });
  const isCloseout = isCloseoutSession(input.selectionMetadata);
  const isDeload = isDeloadSession(input);

  const advancesLifecycle = !isCloseout && input.advancesSplit !== false;
  const reasons: SessionAuditSemanticsReason[] = [];

  let kind: DerivedSessionKind = "non_advancing_generic";
  if (isStrictSupplemental) {
    kind = "supplemental";
    reasons.push({
      code: "strict_supplemental_marker",
      message:
        "Canonical supplemental marker is present, so the session stays non-advancing and progression-ineligible.",
    });
  } else if (isStrictGapFill) {
    kind = "gap_fill";
    reasons.push({
      code: "strict_gap_fill_marker",
      message:
        "Canonical optional gap-fill marker is present, so the session stays non-advancing without losing progression eligibility.",
    });
  } else if (advancesLifecycle) {
    kind = "advancing";
  }

  if (isCloseout) {
    reasons.push({
      code: "closeout_marker",
      message:
        "Canonical closeout marker is present, so the session stays non-advancing and progression-anchor neutral.",
    });
  }

  reasons.push(
    advancesLifecycle
      ? {
          code: "advances_split_true",
          message:
            "advancesSplit is not false, so the session is treated as lifecycle-advancing.",
        }
      : {
          code: "advances_split_false",
          message:
            isCloseout
              ? "Closeout classification forces non-advancing semantics even when the incoming payload could otherwise advance."
              : "advancesSplit=false keeps the session from consuming an advancing schedule slot.",
        }
  );

  if (isDeload) {
    reasons.push({
      code: "deload_session",
      message:
        "Deload state was detected from canonical cycle context or deload decision, so progression/performance history stays informational only.",
    });
  }

  // Deload remains a real performed session for compliance, recent stimulus,
  // and weekly volume, but it never becomes a progression/performance anchor.
  const countsTowardProgressionHistory =
    !isStrictSupplemental &&
    !isCloseout &&
    (isDeload ? CANONICAL_DELOAD_HISTORY_POLICY.countsTowardProgressionHistory : true);
  const countsTowardPerformanceHistory =
    !isStrictSupplemental &&
    (isDeload ? CANONICAL_DELOAD_HISTORY_POLICY.countsTowardPerformanceHistory : true);
  const updatesProgressionAnchor =
    !isStrictSupplemental &&
    !isCloseout &&
    (isDeload ? CANONICAL_DELOAD_HISTORY_POLICY.updatesProgressionAnchor : true);

  if (!countsTowardProgressionHistory) {
    reasons.push(
      isStrictSupplemental
        ? {
            code: "progression_history_excluded_for_supplemental",
            message:
              "Supplemental sessions stay visible to workload history but are excluded from canonical progression history.",
          }
        : isCloseout
          ? {
              code: "progression_history_excluded_for_closeout",
              message:
                "Closeout sessions count toward weekly volume but are excluded from canonical progression history.",
            }
        : {
            code: "progression_history_excluded_for_deload",
            message:
              "Deload sessions stay visible to workload history but are excluded from canonical progression history.",
          }
    );
  }

  if (!countsTowardPerformanceHistory) {
    reasons.push(
      isStrictSupplemental
        ? {
            code: "performance_history_excluded_for_supplemental",
            message:
              "Supplemental sessions do not contribute to canonical performance-history reads.",
          }
        : {
            code: "performance_history_excluded_for_deload",
            message:
              "Deload sessions do not contribute to canonical performance-history reads.",
          }
    );
  }

  if (!updatesProgressionAnchor) {
    reasons.push(
      isStrictSupplemental
        ? {
            code: "progression_anchor_excluded_for_supplemental",
            message:
              "Supplemental sessions cannot become the canonical progression anchor for the next exposure.",
          }
        : isCloseout
          ? {
              code: "progression_anchor_excluded_for_closeout",
              message:
                "Closeout sessions cannot become the canonical progression anchor for the next exposure.",
            }
        : {
            code: "progression_anchor_excluded_for_deload",
            message:
              "Deload sessions cannot become the canonical progression anchor for the next exposure.",
          }
    );
  }

  const receipt = readSessionDecisionReceipt(input.selectionMetadata);
  const trace: SessionAuditSemanticsTrace = {
    advancesSplitInput:
      typeof input.advancesSplit === "boolean" ? input.advancesSplit : null,
    normalizedPhase: normalizePhase(receipt?.cycleContext.phase ?? input.mesocyclePhase),
    normalizedBlockType: normalizePhase(receipt?.cycleContext.blockType),
    receiptDeloadMode: receipt?.deloadDecision.mode,
  };

  return {
    kind,
    effectiveSelectionMode,
    isDeload,
    isStrictGapFill,
    isStrictSupplemental,
    isCloseout,
    advancesLifecycle,
    consumesWeeklyScheduleIntent: advancesLifecycle,
    countsTowardCompliance: isDeload
      ? CANONICAL_DELOAD_HISTORY_POLICY.countsTowardCompliance
      : true,
    countsTowardRecentStimulus: isDeload
      ? CANONICAL_DELOAD_HISTORY_POLICY.countsTowardRecentStimulus
      : true,
    countsTowardWeeklyVolume: isDeload
      ? CANONICAL_DELOAD_HISTORY_POLICY.countsTowardWeeklyVolume
      : true,
    countsTowardProgressionHistory,
    countsTowardPerformanceHistory,
    updatesProgressionAnchor,
    eligibleForUniqueIntentSubtraction: advancesLifecycle,
    reasons,
    trace,
  };
}
