import type { SessionContext } from "@/lib/engine/explainability";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";
import {
  getCanonicalDeloadContractText,
  getCanonicalDeloadEffortText,
  getCanonicalDeloadGoalText,
  getCanonicalDeloadStructureText,
  getCanonicalDeloadSummaryText,
  isCanonicalDeloadReceipt,
} from "@/lib/deload/semantics";
import type { WorkoutStructureState } from "./selection-metadata";
import {
  formatGapFillMuscleList,
  isGapFillWorkout,
  resolveGapFillTargetMuscles,
} from "./gap-fill";
import {
  formatSessionIdentityDescription,
  formatSessionIdentityLabel,
} from "./session-identity";

export type SessionSummaryTone = "neutral" | "positive" | "caution";

export type SessionSummaryItem = {
  label: string;
  value: string;
  tone?: SessionSummaryTone;
};

export type SessionSummaryModel = {
  title: string;
  summary: string;
  tags: string[];
  items: SessionSummaryItem[];
  truthNote?: SessionSummaryItem;
};

function hasCanonicalDeloadSignal(receipt?: SessionDecisionReceipt): boolean {
  return isCanonicalDeloadReceipt(receipt);
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function formatIntent(sessionIntent?: string | null): string {
  if (!sessionIntent) {
    return "Training";
  }
  return toTitleCase(sessionIntent);
}

function formatWeekTag(input: {
  context: SessionContext;
  receipt?: SessionDecisionReceipt;
  displayWeek?: number | null;
}): string {
  const receiptCycleContext = input.receipt?.cycleContext;
  const blockType = toTitleCase(receiptCycleContext?.blockType ?? input.context.blockPhase.blockType);
  const week =
    receiptCycleContext?.weekInBlock ??
    input.displayWeek ??
    input.context.progressionContext.weekInMesocycle;
  return `${blockType} week ${week}`;
}

function formatEffortTarget(receipt?: SessionDecisionReceipt): string {
  if (hasCanonicalDeloadSignal(receipt)) {
    return getCanonicalDeloadEffortText({
      lifecycleRirTarget: receipt?.lifecycleRirTarget,
    });
  }

  if (receipt?.lifecycleRirTarget) {
    return `Leave ${receipt.lifecycleRirTarget.min}-${receipt.lifecycleRirTarget.max} reps in reserve on work sets.`;
  }

  return "Use the written targets and stop before grindy reps.";
}

function formatDescriptiveDeloadValue(receipt?: SessionDecisionReceipt): SessionSummaryItem | null {
  const deload = receipt?.deloadDecision;
  if (!deload || deload.mode === "none") {
    return null;
  }

  const reason = deload.reason[0]?.trim();
  const contract = getCanonicalDeloadContractText();

  return {
    label: "Deload",
    value: reason ? `${contract} ${reason}` : contract,
    tone: "neutral",
  };
}

function formatDescriptiveDeloadReassurance(
  receipt?: SessionDecisionReceipt
): SessionSummaryItem | null {
  if (!hasCanonicalDeloadSignal(receipt)) {
    return null;
  }

  return {
    label: "Progression history",
    value:
      "Does not count toward progression history. Next block re-anchors from accumulation work, not this deload.",
    tone: "positive",
  };
}

function formatSorenessValue(receipt?: SessionDecisionReceipt): SessionSummaryItem | null {
  const muscles = receipt?.sorenessSuppressedMuscles ?? [];
  if (muscles.length === 0) {
    return null;
  }

  return {
    label: "Volume held",
    value: `Volume is held back for ${muscles.join(", ").toLowerCase()} until soreness settles.`,
    tone: "caution",
  };
}

function formatReadinessValue(context: SessionContext, receipt?: SessionDecisionReceipt): SessionSummaryItem {
  const scaling = receipt?.readiness.intensityScaling;
  if (scaling?.applied) {
    const directions: string[] = [];
    if (scaling.scaledDownCount > 0) {
      directions.push(`${scaling.scaledDownCount} scaled down`);
    }
    if (scaling.scaledUpCount > 0) {
      directions.push(`${scaling.scaledUpCount} scaled up`);
    }

    const directionText =
      directions.length > 0 ? directions.join(", ") : `${scaling.exerciseIds.length} kept in range`;

    return {
      label: "Readiness",
      value: `Today's check-in adjusted ${directionText} exercise${scaling.exerciseIds.length === 1 ? "" : "s"} to match readiness.`,
      tone: "caution",
    };
  }

  if (context.readinessStatus.availability === "stale") {
    return {
      label: "Readiness",
      value: "No same-day check-in was available, so the plan stayed near your default targets.",
    };
  }

  if (context.readinessStatus.availability === "missing") {
    return {
      label: "Readiness",
      value: "No readiness check-in was recorded, so this session uses the standard plan.",
    };
  }

  return {
    label: "Readiness",
    value: "A recent readiness signal was available, and it did not require changes to the planned targets.",
    tone: "positive",
  };
}

function buildSummaryText(input: {
  context: SessionContext;
  receipt?: SessionDecisionReceipt;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  targetMuscles?: string[];
}): string {
  const { context, receipt, selectionMode, sessionIntent, targetMuscles } = input;
  // This card is descriptive framing for the current plan context. Canonical
  // decisions still live in the saved workout + receipt payload.
  const isDeload =
    context.blockPhase.blockType === "deload" || hasCanonicalDeloadSignal(receipt);
  const isGapFill = isGapFillWorkout({
    selectionMetadata: { sessionDecisionReceipt: receipt },
    selectionMode,
    sessionIntent,
  });
  const gapFillMuscles = resolveGapFillTargetMuscles({
    selectionMetadata: { targetMuscles, sessionDecisionReceipt: receipt },
    persistedTargetMuscles: targetMuscles,
  });
  const musclesLabel = formatGapFillMuscleList(gapFillMuscles).toLowerCase();
  const sessionIdentity = formatSessionIdentityLabel({
    intent: sessionIntent,
    slotId: receipt?.sessionSlot?.slotId,
  }).toLowerCase();
  const deload = receipt?.deloadDecision;
  const soreness = receipt?.sorenessSuppressedMuscles ?? [];
  const readinessScaling = receipt?.readiness.intensityScaling;

  if (isDeload || (deload && deload.mode !== "none")) {
    return getCanonicalDeloadSummaryText();
  }

  if (readinessScaling?.applied) {
    return `This ${sessionIdentity} session keeps the day moving, with effort scaled to match today's readiness.`;
  }

  if (soreness.length > 0) {
    return `This ${sessionIdentity} session keeps the main goal intact while holding back work where soreness is still high.`;
  }
  if (isGapFill) {
    return musclesLabel.length > 0
      ? `This gap-fill session targets ${musclesLabel} while keeping effort controlled.`
      : "This gap-fill session targets under-dosed muscles while keeping effort controlled.";
  }

  if (context.progressionContext.volumeProgression === "building") {
    return `This ${sessionIdentity} session is set up to build workload without pushing to failure.`;
  }

  if (context.progressionContext.volumeProgression === "maintaining") {
    return `This ${sessionIdentity} session holds your current workload steady and repeatable.`;
  }

  return `This ${sessionIdentity} session keeps effort controlled while you move through the current block.`;
}

export function buildSessionSummaryModel(input: {
  context: SessionContext;
  receipt?: SessionDecisionReceipt;
  selectionMode?: string | null;
  sessionIntent?: string | null;
  displayWeek?: number | null;
  targetMuscles?: string[];
  estimatedMinutes?: number | null;
  workoutStructureState?: WorkoutStructureState;
}): SessionSummaryModel {
  const {
    context,
    receipt,
    selectionMode,
    sessionIntent,
    displayWeek,
    targetMuscles,
    estimatedMinutes,
    workoutStructureState,
  } = input;
  const isDeload =
    context.blockPhase.blockType === "deload" || hasCanonicalDeloadSignal(receipt);
  const hasStructureDrift = workoutStructureState?.reconciliation.hasDrift === true;
  const isGapFill = isGapFillWorkout({
    selectionMetadata: { sessionDecisionReceipt: receipt },
    selectionMode,
    sessionIntent,
  });
  const gapFillTargetMuscles = resolveGapFillTargetMuscles({
    selectionMetadata: { targetMuscles, sessionDecisionReceipt: receipt },
    persistedTargetMuscles: targetMuscles,
  });
  const sessionIdentityLabel = formatSessionIdentityLabel({
    intent: sessionIntent,
    slotId: receipt?.sessionSlot?.slotId,
  });
  const sessionLabel = isGapFill ? "Gap Fill" : sessionIdentityLabel;
  const items: SessionSummaryItem[] = [
    {
      label: "Today's goal",
      value:
        isDeload
          ? getCanonicalDeloadGoalText()
          : context.progressionContext.volumeProgression === "building"
          ? isGapFill
            ? gapFillTargetMuscles.length > 0
              ? `Close gaps for ${formatGapFillMuscleList(gapFillTargetMuscles).toLowerCase()} this week.`
              : "Close unresolved weekly volume gaps this week."
            : `Build ${formatIntent(sessionIntent).toLowerCase()} work this week.`
          : context.progressionContext.volumeProgression === "maintaining"
          ? `Hold ${formatIntent(sessionIntent).toLowerCase()} work steady this week.`
          : "Keep the session lighter while recovery catches up.",
    },
    ...(isGapFill || !receipt?.sessionSlot
      ? []
      : [
          {
            label: "Session identity",
            value:
              formatSessionIdentityDescription({
                intent: sessionIntent,
                slotId: receipt.sessionSlot.slotId,
              }) ?? `${sessionIdentityLabel} session in your current weekly order.`,
          } satisfies SessionSummaryItem,
        ]),
    {
      label: "Target effort",
      value: formatEffortTarget(receipt),
    },
    formatReadinessValue(context, receipt),
  ];

  const deloadItem = formatDescriptiveDeloadValue(receipt);
  if (deloadItem) {
    items.push({
      label: "Structure",
      value: getCanonicalDeloadStructureText(),
    });
  }

  if (deloadItem) {
    items.push(deloadItem);
  }

  const sorenessItem = formatSorenessValue(receipt);
  if (sorenessItem) {
    items.push(sorenessItem);
  }

  const deloadReassurance = formatDescriptiveDeloadReassurance(receipt);
  if (deloadReassurance) {
    items.push(deloadReassurance);
  }

  const tags = [sessionLabel, formatWeekTag({ context, receipt, displayWeek })];
  if (hasStructureDrift) {
    tags.splice(1, 0, "Modified");
  }
  if (isDeload) {
    tags.splice(1, 0, "Deload");
  }
  if (estimatedMinutes != null) {
    tags.push(`${estimatedMinutes} min`);
  }

  return {
    title: hasStructureDrift ? "Original plan context" : "Why today looks like this",
    summary: buildSummaryText({ context, receipt, selectionMode, sessionIntent, targetMuscles }),
    tags,
    items,
    truthNote: hasStructureDrift
      ? {
          label: "Current structure",
          value:
            "Workout structure changed after generation. The exercise list on this page is the canonical saved workout; this card describes the original generated plan.",
          tone: "caution",
        }
      : undefined,
  };
}
