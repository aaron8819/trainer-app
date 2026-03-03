import type { SessionContext } from "@/lib/engine/explainability";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";

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
};

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function formatIntent(sessionIntent?: string | null): string {
  if (!sessionIntent) {
    return "Training";
  }
  return toTitleCase(sessionIntent);
}

function formatWeekTag(context: SessionContext): string {
  const blockType = toTitleCase(context.blockPhase.blockType);
  return `${blockType} week ${context.blockPhase.weekInBlock}`;
}

function formatEffortTarget(receipt?: SessionDecisionReceipt): string {
  if (receipt?.lifecycleRirTarget) {
    return `Leave ${receipt.lifecycleRirTarget.min}-${receipt.lifecycleRirTarget.max} reps in reserve on work sets.`;
  }

  return "Use the written targets and stop before grindy reps.";
}

function formatDeloadValue(receipt?: SessionDecisionReceipt): SessionSummaryItem | null {
  const deload = receipt?.deloadDecision;
  if (!deload || deload.mode === "none") {
    return null;
  }

  const reductionTarget =
    deload.appliedTo === "both"
      ? "load and volume"
      : deload.appliedTo === "load"
      ? "load"
      : deload.appliedTo === "volume"
      ? "volume"
      : "work";
  const reason = deload.reason[0]?.trim();

  return {
    label: "Deload",
    value: reason
      ? `${toTitleCase(deload.mode)} deload. ${deload.reductionPercent}% less ${reductionTarget}. ${reason}`
      : `${toTitleCase(deload.mode)} deload. ${deload.reductionPercent}% less ${reductionTarget}.`,
    tone: "caution",
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
      value: "No fresh check-in today, so the plan stays closer to your normal targets.",
    };
  }

  if (context.readinessStatus.availability === "missing") {
    return {
      label: "Readiness",
      value: "No readiness check-in was available, so this session uses the standard plan.",
    };
  }

  return {
    label: "Readiness",
    value: "Readiness looked normal enough to keep the planned targets in place.",
    tone: "positive",
  };
}

function buildSummaryText(input: {
  context: SessionContext;
  receipt?: SessionDecisionReceipt;
  sessionIntent?: string | null;
}): string {
  const { context, receipt, sessionIntent } = input;
  const intent = formatIntent(sessionIntent).toLowerCase();
  const deload = receipt?.deloadDecision;
  const soreness = receipt?.sorenessSuppressedMuscles ?? [];
  const readinessScaling = receipt?.readiness.intensityScaling;

  if (deload && deload.mode !== "none") {
    return `This ${intent} session is lighter on purpose so you can recover and keep training momentum.`;
  }

  if (readinessScaling?.applied) {
    return `This ${intent} session keeps the day moving, with effort scaled to match today's readiness.`;
  }

  if (soreness.length > 0) {
    return `This ${intent} session keeps the main goal intact while holding back work where soreness is still high.`;
  }

  if (context.progressionContext.volumeProgression === "building") {
    return `This ${intent} session is set up to build workload without pushing to failure.`;
  }

  if (context.progressionContext.volumeProgression === "maintaining") {
    return `This ${intent} session holds your current workload steady and repeatable.`;
  }

  return `This ${intent} session keeps effort controlled while you move through the current block.`;
}

export function buildSessionSummaryModel(input: {
  context: SessionContext;
  receipt?: SessionDecisionReceipt;
  sessionIntent?: string | null;
  estimatedMinutes?: number | null;
}): SessionSummaryModel {
  const { context, receipt, sessionIntent, estimatedMinutes } = input;
  const items: SessionSummaryItem[] = [
    {
      label: "Today's goal",
      value:
        context.progressionContext.volumeProgression === "building"
          ? `Build ${formatIntent(sessionIntent).toLowerCase()} work this week.`
          : context.progressionContext.volumeProgression === "maintaining"
          ? `Hold ${formatIntent(sessionIntent).toLowerCase()} work steady this week.`
          : "Keep the session lighter while recovery catches up.",
    },
    {
      label: "Target effort",
      value: formatEffortTarget(receipt),
    },
    formatReadinessValue(context, receipt),
  ];

  const deloadItem = formatDeloadValue(receipt);
  if (deloadItem) {
    items.push(deloadItem);
  }

  const sorenessItem = formatSorenessValue(receipt);
  if (sorenessItem) {
    items.push(sorenessItem);
  }

  const tags = [formatIntent(sessionIntent), formatWeekTag(context)];
  if (estimatedMinutes != null) {
    tags.push(`${estimatedMinutes} min`);
  }

  return {
    title: "Why today looks like this",
    summary: buildSummaryText({ context, receipt, sessionIntent }),
    tags,
    items,
  };
}
