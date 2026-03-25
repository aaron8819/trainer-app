import { prisma } from "@/lib/db/prisma";
import {
  buildWorkoutListSurfaceSummary,
  formatWorkoutListIntentLabel,
  getWorkoutListPrimaryLabel,
  getWorkoutListSecondaryLabel,
  type WorkoutListSurfaceSummary,
  workoutListItemSelect,
} from "@/lib/ui/workout-list-items";
import {
  formatSessionIdentityDescription,
  formatSessionIdentityLabel,
} from "@/lib/ui/session-identity";
import {
  loadHomeProgramSupport,
  loadProgramDashboardData,
  type HomeProgramSupportData,
  type ProgramDashboardData,
} from "./program";
import { loadPendingMesocycleHandoff } from "./mesocycle-handoff";

export type HomeDecisionSummary = {
  nextSessionLabel: string | null;
  nextSessionDescription: string | null;
  nextSessionReasonLabel: string;
  nextSessionReason: string;
  activeWeekLabel: string | null;
};

export type HomeContinuitySummary = {
  summary: string | null;
  lastCompleted: WorkoutListSurfaceSummary | null;
  lastCompletedDescriptor: string | null;
  nextDueLabel: string | null;
  nextDueDescriptor: string | null;
};

export type HomePageData = {
  pendingHandoff: Awaited<ReturnType<typeof loadPendingMesocycleHandoff>>;
  programData: ProgramDashboardData | null;
  homeProgram: HomeProgramSupportData | null;
  decision: HomeDecisionSummary | null;
  continuity: HomeContinuitySummary | null;
  headerContext: string;
  recentActivity: WorkoutListSurfaceSummary[];
};

function formatPhaseLabel(blockType: string | null | undefined): string | null {
  const normalized = blockType?.trim();
  if (!normalized) {
    return null;
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildHeaderContext(programData: ProgramDashboardData | null): string {
  if (!programData?.activeMeso) {
    return "Generate your first session.";
  }

  const phaseLabel = formatPhaseLabel(programData.activeMeso.currentBlockType);
  return `Week ${programData.currentWeek} - ${phaseLabel ?? "Program"}`;
}

function buildActiveWeekLabel(nextSession: HomeProgramSupportData["nextSession"]): string | null {
  const parts: string[] = [];

  if (nextSession.weekInMeso != null) {
    parts.push(`Week ${nextSession.weekInMeso}`);
  }

  if (
    nextSession.slotSequenceIndex != null &&
    nextSession.slotSequenceLength != null &&
    nextSession.slotSequenceLength > 0
  ) {
    parts.push(`Session ${nextSession.slotSequenceIndex + 1} of ${nextSession.slotSequenceLength}`);
  } else if (nextSession.sessionInWeek != null) {
    parts.push(`Session ${nextSession.sessionInWeek}`);
  }

  return parts.length > 0 ? parts.join(" - ") : null;
}

function simplifyHomeSessionDescription(description: string | null): string | null {
  if (!description) {
    return null;
  }

  return description
    .replace(" in your current weekly order.", " this week.")
    .replace(/\.$/, "");
}

function formatNextSessionLabel(nextSession: HomeProgramSupportData["nextSession"]): string | null {
  return nextSession.intent
    ? formatSessionIdentityLabel({
        intent: nextSession.intent,
        slotId: nextSession.slotId,
      })
    : null;
}

function buildDecisionReason(homeProgram: HomeProgramSupportData): {
  label: string;
  detail: string;
} {
  const latestIncompleteStatus = homeProgram.latestIncomplete?.status ?? null;
  const nextSessionLabel = formatNextSessionLabel(homeProgram.nextSession);

  // IMPORTANT:
  // Reason labels must remain:
  // - <= 3 words
  // - from the canonical set only
  // - non-overlapping in meaning
  // Do not introduce new labels without collapsing an existing one.
  if (latestIncompleteStatus === "partial" || latestIncompleteStatus === "in_progress") {
    return {
      label: "Resume session",
      detail: "You already started this workout, so finish it before generating another.",
    };
  }

  if (latestIncompleteStatus === "planned") {
    return {
      label: "Up next",
      detail: "A planned workout already exists, so you can start logging right away.",
    };
  }

  if (homeProgram.lastSessionSkipped && homeProgram.nextSession.intent) {
    return {
      label: "Still due",
      detail: `You skipped ${nextSessionLabel ?? "this session"}, so it stays next.`,
    };
  }

  if (homeProgram.nextSession.slotSource === "mesocycle_slot_sequence") {
    return {
      label: "Next in sequence",
      detail: nextSessionLabel
        ? `Nothing earlier is still open, so ${nextSessionLabel} is next this week.`
        : "Nothing earlier is still open in this week.",
    };
  }

  if (homeProgram.nextSession.slotSource === "legacy_weekly_schedule") {
    return {
      label: "Up next",
      detail: "Nothing earlier is still open in your saved weekly schedule.",
    };
  }

  return {
    label: "Up next",
    detail: "No queued session is blocking it right now.",
  };
}

function buildSessionDescriptor(
  session: Pick<
    WorkoutListSurfaceSummary,
    | "isGapFill"
    | "gapFillTargetMuscles"
    | "isSupplementalDeficitSession"
    | "isDeload"
    | "sessionIntent"
    | "sessionSlotId"
  >
): string | null {
  if (session.isGapFill) {
    const muscles = getWorkoutListSecondaryLabel(session);
    return muscles ? `Optional gap-fill session for ${muscles}` : "Optional gap-fill session";
  }

  if (session.isSupplementalDeficitSession) {
    return "Supplemental deficit session";
  }

  if (session.isDeload) {
    return "Deload recovery session";
  }

  const identityDescription = formatSessionIdentityDescription({
    intent: session.sessionIntent,
    slotId: session.sessionSlotId,
  });
  if (identityDescription) {
    return simplifyHomeSessionDescription(identityDescription);
  }

  const intentLabel = formatWorkoutListIntentLabel(session.sessionIntent);
  return intentLabel === "Workout" ? null : `${intentLabel} session`;
}

function buildNextSessionDescriptor(nextSession: HomeProgramSupportData["nextSession"]): string | null {
  const identityDescription = formatSessionIdentityDescription({
    intent: nextSession.intent,
    slotId: nextSession.slotId,
  });
  if (identityDescription) {
    return simplifyHomeSessionDescription(identityDescription);
  }

  const intentLabel = formatWorkoutListIntentLabel(nextSession.intent);
  return intentLabel === "Workout" ? null : `${intentLabel} session`;
}

function buildDecisionSummary(
  homeProgram: HomeProgramSupportData
): HomeDecisionSummary {
  const reason = buildDecisionReason(homeProgram);

  return {
    nextSessionLabel: formatNextSessionLabel(homeProgram.nextSession),
    nextSessionDescription: buildNextSessionDescriptor(homeProgram.nextSession),
    nextSessionReasonLabel: reason.label,
    nextSessionReason: reason.detail,
    activeWeekLabel: buildActiveWeekLabel(homeProgram.nextSession),
  };
}

function buildContinuitySummary(input: {
  lastCompleted: WorkoutListSurfaceSummary | null;
  decision: HomeDecisionSummary | null;
  homeProgram: HomeProgramSupportData | null;
}): HomeContinuitySummary {
  const lastCompletedLabel = input.lastCompleted
    ? getWorkoutListPrimaryLabel(input.lastCompleted)
    : null;
  const lastCompletedDescriptor = input.lastCompleted
    ? buildSessionDescriptor(input.lastCompleted)
    : null;
  const nextDueLabel = input.decision?.nextSessionLabel ?? null;
  const nextDueDescriptor = input.homeProgram
    ? buildNextSessionDescriptor(input.homeProgram.nextSession)
    : null;

  return {
    summary: null,
    lastCompleted: input.lastCompleted,
    lastCompletedDescriptor,
    nextDueLabel,
    nextDueDescriptor,
  };
}

export async function loadHomePageData(userId: string): Promise<HomePageData> {
  const [pendingHandoff, latestCompletedRow, recentActivityRows] = await Promise.all([
    loadPendingMesocycleHandoff(userId),
    prisma.workout.findFirst({
      where: { userId, status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      select: workoutListItemSelect,
    }),
    prisma.workout.findMany({
      where: { userId },
      orderBy: { scheduledDate: "desc" },
      take: 3,
      select: workoutListItemSelect,
    }),
  ]);

  const lastCompleted = latestCompletedRow
    ? buildWorkoutListSurfaceSummary(latestCompletedRow)
    : null;
  const recentActivity = recentActivityRows.map(buildWorkoutListSurfaceSummary);

  if (pendingHandoff) {
    return {
      pendingHandoff,
      programData: null,
      homeProgram: null,
      decision: null,
      continuity: buildContinuitySummary({
        lastCompleted,
        decision: null,
        homeProgram: null,
      }),
      headerContext: "Training is paused until you accept the next cycle.",
      recentActivity,
    };
  }

  const [programData, homeProgram] = await Promise.all([
    loadProgramDashboardData(userId),
    loadHomeProgramSupport(userId),
  ]);
  const decision = buildDecisionSummary(homeProgram);

  return {
    pendingHandoff: null,
    programData,
    homeProgram,
    decision,
    continuity: buildContinuitySummary({
      lastCompleted,
      decision,
      homeProgram,
    }),
    headerContext: buildHeaderContext(programData),
    recentActivity,
  };
}
