import { prisma } from "@/lib/db/prisma";
import {
  buildWorkoutListSurfaceSummary,
  formatWorkoutListIntentLabel,
  getWorkoutListStatusLabel,
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
import { getUiAuditFixtureForServer } from "@/lib/ui-audit-fixtures/server";
import type { CanonicalUiState } from "@/lib/ui-state-contract";
import { getWorkoutWorkflowState } from "@/lib/workout-workflow";

export type HomeDecisionSummary = {
  nextSessionLabel: string | null;
  nextSessionDescription: string | null;
  nextSessionReasonLabel: string;
  nextSessionReason: string;
  activeWeekLabel: string | null;
  completedAdvancingSessionsThisWeek: number;
  totalAdvancingSessionsThisWeek: number;
};

export type HomeContinuitySummary = {
  summary: string | null;
  lastCompleted: WorkoutListSurfaceSummary | null;
  lastCompletedDescriptor: string | null;
  nextDueLabel: string | null;
  nextDueDescriptor: string | null;
};

export type HomeCloseoutSummary = {
  title: string;
  workoutId: string | null;
  status: string;
  statusLabel: string;
  detail: string;
  actionHref: string;
  actionLabel: string;
  actionMethod?: "link" | "post";
  dismissActionHref: string | null;
  dismissActionLabel: string | null;
};

export type HomePrimaryAction =
  | {
      state: Extract<CanonicalUiState, "active">;
      label: "Resume workout";
      href: string;
      reasonLabel?: string;
      reason?: string;
    }
  | {
      state: Extract<CanonicalUiState, "planned">;
      mode: "existing" | "generate";
      label: "Start workout";
      href?: string;
      action?: "generate-required-workout";
      initialIntent?: string;
      initialSlotId?: string;
      reasonLabel?: string;
      reason?: string;
    }
  | {
      state: Extract<CanonicalUiState, "completed">;
      label: "Week complete";
      description: string;
      href?: string;
    }
  | {
      state: Extract<CanonicalUiState, "optional">;
      label: "Create optional session";
      action: "post-closeout";
      description: string;
      href: string;
    }
  | {
      state: Extract<CanonicalUiState, "blocked">;
      label: string;
      reason: string;
      href?: string;
    };

function formatCloseoutTitle(
  closeout: Pick<HomeProgramSupportData["closeout"], "isPriorWeek" | "targetWeek">
): string {
  return closeout.isPriorWeek && closeout.targetWeek != null
    ? `Week ${closeout.targetWeek} optional session`
    : "Custom session";
}

export type HomePageData = {
  pendingHandoff: Awaited<ReturnType<typeof loadPendingMesocycleHandoff>>;
  programData: ProgramDashboardData | null;
  homeProgram: HomeProgramSupportData | null;
  primaryAction: HomePrimaryAction | null;
  decision: HomeDecisionSummary | null;
  continuity: HomeContinuitySummary | null;
  closeout: HomeCloseoutSummary | null;
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

function formatWeekProgressLabel(completed: number, total: number): string {
  return `${completed} of ${total} session${total === 1 ? "" : "s"} complete`;
}

function buildActiveWeekLabel(homeProgram: HomeProgramSupportData): string | null {
  const { nextSession } = homeProgram;
  const parts: string[] = [];
  const week = homeProgram.activeWeek ?? nextSession.weekInMeso;

  if (week != null) {
    parts.push(`Week ${week}`);
  }

  if (
    Number.isFinite(homeProgram.completedAdvancingSessionsThisWeek) &&
    homeProgram.totalAdvancingSessionsThisWeek > 0
  ) {
    parts.push(
      formatWeekProgressLabel(
        homeProgram.completedAdvancingSessionsThisWeek,
        homeProgram.totalAdvancingSessionsThisWeek
      )
    );
  } else if (
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
    | "isCloseout"
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

  if (session.isCloseout) {
    return "Optional manual session";
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
    activeWeekLabel: buildActiveWeekLabel(homeProgram),
    completedAdvancingSessionsThisWeek: homeProgram.completedAdvancingSessionsThisWeek,
    totalAdvancingSessionsThisWeek: homeProgram.totalAdvancingSessionsThisWeek,
  };
}

function buildContinuitySummary(input: {
  lastCompleted: WorkoutListSurfaceSummary | null;
  decision: HomeDecisionSummary | null;
  homeProgram: HomeProgramSupportData | null;
}): HomeContinuitySummary {
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

function buildHomeCloseoutSummary(
  homeProgram: HomeProgramSupportData | null
): HomeCloseoutSummary | null {
  const closeout = homeProgram?.closeout;
  if (!closeout?.visible || !closeout.workoutId || !closeout.status) {
    if (!closeout?.visible || !closeout?.canCreate || !closeout.weekCloseId || closeout.targetWeek == null) {
      return null;
    }

    const title = formatCloseoutTitle(closeout);
    const nextWeekLabel =
      closeout.isPriorWeek ? `Week ${closeout.targetWeek + 1}` : "your next week";

    return {
      title,
      workoutId: null,
      status: "available",
      statusLabel: "Available",
      detail: closeout.isPriorWeek
        ? `A Week ${closeout.targetWeek} optional session is still available after rollover. It remains optional and does not change ${nextWeekLabel} continuity.`
        : "An optional manual session is still available for this week. It does not replace your required next session.",
      actionHref: `/api/mesocycles/week-close/${closeout.weekCloseId}/closeout`,
      actionLabel: "Create optional session",
      actionMethod: "post",
      dismissActionHref: null,
      dismissActionLabel: null,
    };
  }

  const normalizedStatus = closeout.status.trim().toUpperCase();
  const statusLabel = getWorkoutListStatusLabel(normalizedStatus);
  const title = formatCloseoutTitle(closeout);

  if (normalizedStatus === "COMPLETED") {
    return {
      title,
      workoutId: closeout.workoutId,
      status: closeout.status,
      statusLabel,
      detail:
        closeout.isPriorWeek && closeout.targetWeek != null
          ? `Completed Week ${closeout.targetWeek} optional session counts toward that week's actual volume without changing your current next-session plan.`
          : "Completed optional session counts toward this week's actual volume without changing the next-session plan.",
      actionHref: `/workout/${closeout.workoutId}`,
      actionLabel: "Review custom session",
      dismissActionHref: null,
      dismissActionLabel: null,
    };
  }

  if (normalizedStatus === "SKIPPED") {
    return {
      title,
      workoutId: closeout.workoutId,
      status: closeout.status,
      statusLabel,
      detail:
        closeout.isPriorWeek && closeout.targetWeek != null
          ? `Skipped Week ${closeout.targetWeek} optional session stays separate from your current week and does not change continuity.`
          : "Skipped optional session stays visible for this week, but it does not change continuity or the weekly slot plan.",
      actionHref: `/workout/${closeout.workoutId}`,
      actionLabel: "Review custom session",
      dismissActionHref: null,
      dismissActionLabel: null,
    };
  }

  return {
    title,
    workoutId: closeout.workoutId,
    status: closeout.status,
    statusLabel,
    detail:
      closeout.isPriorWeek && closeout.targetWeek != null
        ? `Optional manual session for Week ${closeout.targetWeek}. It can add actual volume to that week without becoming part of your current slot plan.`
        : "Optional manual session for this week. It can add actual weekly volume without becoming required work.",
    actionHref: `/log/${closeout.workoutId}`,
    actionLabel: "Open custom session",
    dismissActionHref:
      normalizedStatus === "PLANNED"
        ? `/api/workouts/${closeout.workoutId}/dismiss-closeout`
        : null,
    dismissActionLabel: normalizedStatus === "PLANNED" ? "Dismiss optional session" : null,
  };
}

function buildHomePrimaryAction(input: {
  homeProgram: HomeProgramSupportData;
  decision: HomeDecisionSummary;
  closeout: HomeCloseoutSummary | null;
}): HomePrimaryAction {
  const { homeProgram, decision, closeout } = input;
  const latestIncomplete = homeProgram.latestIncomplete;
  const workoutId = homeProgram.nextSession.workoutId ?? latestIncomplete?.id ?? null;
  const workflow = getWorkoutWorkflowState(latestIncomplete?.status ?? null);

  if (
    workoutId &&
    latestIncomplete &&
    (workflow.kind === "in_progress" || workflow.kind === "partial")
  ) {
    return {
      state: "active",
      label: "Resume workout",
      href: `/log/${workoutId}`,
      reasonLabel: decision.nextSessionReasonLabel,
      reason: decision.nextSessionReason,
    };
  }

  if (workoutId && latestIncomplete && workflow.kind === "planned") {
    return {
      state: "planned",
      mode: "existing",
      label: "Start workout",
      href: `/log/${workoutId}`,
      reasonLabel: decision.nextSessionReasonLabel,
      reason: decision.nextSessionReason,
    };
  }

  const requiredWeekComplete =
    decision.totalAdvancingSessionsThisWeek > 0 &&
    decision.completedAdvancingSessionsThisWeek >= decision.totalAdvancingSessionsThisWeek;
  if (requiredWeekComplete) {
    return {
      state: "completed",
      label: "Week complete",
      description: "Required sessions are done for this week. Optional sessions stay separate below.",
      href: "/program",
    };
  }

  if (homeProgram.nextSession.intent) {
    return {
      state: "planned",
      mode: "generate",
      label: "Start workout",
      action: "generate-required-workout",
      initialIntent: homeProgram.nextSession.intent,
      initialSlotId: homeProgram.nextSession.slotId ?? undefined,
      reasonLabel: decision.nextSessionReasonLabel,
      reason: decision.nextSessionReason,
    };
  }

  if (closeout?.actionMethod === "post") {
    return {
      state: "optional",
      label: "Create optional session",
      action: "post-closeout",
      description: closeout.detail,
      href: closeout.actionHref,
    };
  }

  return {
    state: "blocked",
    label: "No required workout available",
    reason: "Required workout creation is unavailable until the program has a next session.",
    href: "/program",
  };
}

export async function loadHomePageData(userId: string): Promise<HomePageData> {
  const fixture = await getUiAuditFixtureForServer();
  if (fixture?.home) {
    return fixture.home;
  }

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
      take: 10,
      select: workoutListItemSelect,
    }),
  ]);

  const lastCompleted = latestCompletedRow
    ? buildWorkoutListSurfaceSummary(latestCompletedRow)
    : null;
  const recentActivity = recentActivityRows
    .map(buildWorkoutListSurfaceSummary)
    .filter((workout) => !workout.isCloseoutDismissed)
    .slice(0, 3);

  if (pendingHandoff) {
    return {
      pendingHandoff,
      programData: null,
      homeProgram: null,
      primaryAction: {
        state: "blocked",
        label: "Review handoff",
        reason: "Training is paused until you accept the next cycle.",
        href: `/mesocycles/${pendingHandoff.mesocycleId}/review`,
      },
      decision: null,
      continuity: buildContinuitySummary({
        lastCompleted,
        decision: null,
        homeProgram: null,
      }),
      closeout: null,
      headerContext: "Training is paused until you accept the next cycle.",
      recentActivity,
    };
  }

  const [programData, homeProgram] = await Promise.all([
    loadProgramDashboardData(userId),
    loadHomeProgramSupport(userId),
  ]);
  const decision = buildDecisionSummary(homeProgram);
  const closeout = buildHomeCloseoutSummary(homeProgram);

  return {
    pendingHandoff: null,
    programData,
    homeProgram,
    primaryAction: buildHomePrimaryAction({
      homeProgram,
      decision,
      closeout,
    }),
    decision,
    continuity: buildContinuitySummary({
      lastCompleted,
      decision,
      homeProgram,
    }),
    closeout,
    headerContext: buildHeaderContext(programData),
    recentActivity,
  };
}
