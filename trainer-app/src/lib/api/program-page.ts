import type { WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import { formatSessionIdentityLabel } from "@/lib/ui/session-identity";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  buildAdvancingPerformedSlots,
  loadNextWorkoutContext,
  type AdvancingPerformedSlot,
  type NextWorkoutContext,
} from "./next-session";
import {
  buildRemainingRuntimeSlotsFromPerformed,
  readRuntimeSlotSequence,
} from "./mesocycle-slot-runtime";
import {
  buildCurrentWeekCloseoutSupport,
  computeMesoWeekStart,
  isCloseoutWeekInScope,
  loadProgramDashboardData,
  type CloseoutSupportData,
  type DeloadReadiness,
  type ProgramDashboardData,
  type ProgramMesoBlock,
} from "./program";
import { findRelevantWeekCloseForUser } from "./mesocycle-week-close";
import {
  classifyMuscleOutcome,
  type MuscleOutcomeStatus,
} from "./muscle-outcome-review";
import { loadProjectedWeekVolumeReport } from "./projected-week-volume";
import { isCloseoutSession } from "@/lib/session-semantics/closeout-classifier";
import { getUiAuditFixtureForServer } from "@/lib/ui-audit-fixtures/server";

type ActiveProgramPageMesocycle = {
  id: string;
  startWeek: number;
  durationWeeks: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
  slotSequenceJson: unknown;
  macroCycle: {
    startDate: Date;
  };
};

type CurrentWeekWorkoutRow = {
  id: string;
  status: WorkoutStatus;
  scheduledDate: Date;
  sessionIntent: string | null;
  selectionMode: string | null;
  selectionMetadata: unknown;
  advancesSplit: boolean | null;
};

export type ProgramPageOverview = {
  mesoNumber: number;
  focus: string;
  currentBlockType: string | null;
  durationWeeks: number;
  currentWeek: number;
  percentComplete: number;
  blocks: ProgramMesoBlock[];
  rirTarget: { min: number; max: number } | null;
  sessionsUntilDeload: number;
  deloadReadiness: DeloadReadiness | null;
  coachingCue: string;
};

export type ProgramOutcomeSummary = {
  meaningfullyLow: number;
  slightlyLow: number;
  onTarget: number;
  slightlyHigh: number;
  meaningfullyHigh: number;
};

export type ProgramSlotImpact = {
  topMuscles: Array<{
    muscle: string;
    projectedEffectiveSets: number;
  }>;
  hiddenMuscleCount: number;
  summaryLabel: string;
};

export type ProgramCurrentWeekPlanRow = {
  slotId: string;
  label: string;
  sessionInWeek: number;
  state: "completed" | "next" | "remaining";
  linkedWorkoutId: string | null;
  linkedWorkoutStatus: string | null;
  impact: ProgramSlotImpact | null;
};

export type ProgramCurrentWeekPlan = {
  week: number;
  slots: ProgramCurrentWeekPlanRow[];
};

export type ProgramCloseoutSummary = {
  title: string;
  workoutId: string | null;
  status: string;
  statusLabel: string;
  detail: string;
  actionHref: string;
  actionLabel: string;
  dismissActionHref: string | null;
  dismissActionLabel: string | null;
  targetWeek: number | null;
  isPriorWeek: boolean;
};

function formatCloseoutTitle(
  closeout: Pick<CloseoutSupportData, "isPriorWeek" | "targetWeek">
): string {
  return closeout.isPriorWeek && closeout.targetWeek != null
    ? `Week ${closeout.targetWeek} Closeout (Optional)`
    : "Closeout";
}

export type ProgramWeekCompletionOutlook = {
  assumptionLabel: string;
  summary: ProgramOutcomeSummary;
  rows: Array<{
    muscle: string;
    status: MuscleOutcomeStatus;
    projectedFullWeekEffectiveSets: number;
    targetSets: number;
    delta: number;
  }>;
  defaultRows: Array<{
    muscle: string;
    status: MuscleOutcomeStatus;
    projectedFullWeekEffectiveSets: number;
    targetSets: number;
    delta: number;
  }>;
};

export type ProgramPageData = {
  overview: ProgramPageOverview | null;
  currentWeekPlan: ProgramCurrentWeekPlan | null;
  closeout: ProgramCloseoutSummary | null;
  weekCompletionOutlook: ProgramWeekCompletionOutlook | null;
  volumeDetails: {
    dashboard: ProgramDashboardData;
  };
  advancedActions: {
    availableActions: Array<"deload" | "extend_phase" | "reset">;
  };
};

const LINKED_WORKOUT_PRIORITY: Record<WorkoutStatus, number> = {
  IN_PROGRESS: 0,
  PARTIAL: 1,
  PLANNED: 2,
  COMPLETED: 3,
  SKIPPED: 4,
};
const IMPACT_VISIBLE_MUSCLE_COUNT = 3;
const IMPACT_NEAR_TIE_TOLERANCE = 0.1;
const IMPACT_COMPARISON_EPSILON = 1e-9;

function isPerformedWorkoutStatus(status: WorkoutStatus): boolean {
  return (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(status);
}

function buildProgramPageOverview(
  dashboard: ProgramDashboardData
): ProgramPageOverview | null {
  if (!dashboard.activeMeso) {
    return null;
  }

  return {
    mesoNumber: dashboard.activeMeso.mesoNumber,
    focus: dashboard.activeMeso.focus,
    currentBlockType: dashboard.activeMeso.currentBlockType,
    durationWeeks: dashboard.activeMeso.durationWeeks,
    currentWeek: dashboard.currentWeek,
    percentComplete: Math.round((dashboard.currentWeek / dashboard.activeMeso.durationWeeks) * 100),
    blocks: dashboard.activeMeso.blocks,
    rirTarget: dashboard.rirTarget,
    sessionsUntilDeload: dashboard.sessionsUntilDeload,
    deloadReadiness: dashboard.deloadReadiness,
    coachingCue: dashboard.coachingCue,
  };
}

function buildOutcomeSummary(
  rows: Array<{ status: MuscleOutcomeStatus }>
): ProgramOutcomeSummary {
  return rows.reduce<ProgramOutcomeSummary>(
    (summary, row) => {
      switch (row.status) {
        case "meaningfully_low":
          summary.meaningfullyLow += 1;
          break;
        case "slightly_low":
          summary.slightlyLow += 1;
          break;
        case "on_target":
          summary.onTarget += 1;
          break;
        case "slightly_high":
          summary.slightlyHigh += 1;
          break;
        case "meaningfully_high":
          summary.meaningfullyHigh += 1;
          break;
      }

      return summary;
    },
    {
      meaningfullyLow: 0,
      slightlyLow: 0,
      onTarget: 0,
      slightlyHigh: 0,
      meaningfullyHigh: 0,
    }
  );
}

function buildWeekCompletionOutlook(input: {
  report: Awaited<ReturnType<typeof loadProjectedWeekVolumeReport>>;
}): ProgramWeekCompletionOutlook | null {
  if (input.report.projectedSessions.length === 0 || input.report.fullWeekByMuscle.length === 0) {
    return null;
  }

  const rankedStatuses: Record<MuscleOutcomeStatus, number> = {
    meaningfully_low: 0,
    meaningfully_high: 1,
    slightly_low: 2,
    slightly_high: 3,
    on_target: 4,
  };

  const classifiedRows = input.report.fullWeekByMuscle.map((row) => {
    const outcome = classifyMuscleOutcome(row.weeklyTarget, row.projectedFullWeekEffectiveSets);

    return {
      muscle: row.muscle,
      status: outcome.status,
      projectedFullWeekEffectiveSets: row.projectedFullWeekEffectiveSets,
      targetSets: row.weeklyTarget,
      delta: outcome.delta,
      percentDelta: outcome.percentDelta,
    };
  });

  const rows = classifiedRows
    .sort((left, right) => {
      const rankDelta = rankedStatuses[left.status] - rankedStatuses[right.status];
      if (rankDelta !== 0) {
        return rankDelta;
      }

      const magnitudeDelta = Math.abs(right.percentDelta) - Math.abs(left.percentDelta);
      if (magnitudeDelta !== 0) {
        return magnitudeDelta;
      }

      return left.muscle.localeCompare(right.muscle);
    });
  const rowsWithoutPercentDelta = rows.map((row) => ({
    muscle: row.muscle,
    status: row.status,
    projectedFullWeekEffectiveSets: row.projectedFullWeekEffectiveSets,
    targetSets: row.targetSets,
    delta: row.delta,
  }));

  const defaultRows = rowsWithoutPercentDelta
    .filter((row) => row.status !== "on_target")
    .slice(0, 4);

  return {
    assumptionLabel: "If you complete the remaining planned sessions this week, you will likely land here.",
    summary: buildOutcomeSummary(rows),
    rows: rowsWithoutPercentDelta,
    defaultRows,
  };
}

function buildProgramSlotImpact(input: {
  projectedContributionByMuscle: Record<string, number>;
}): ProgramSlotImpact | null {
  const rankedMuscles = Object.entries(input.projectedContributionByMuscle)
    .filter((entry) => entry[1] > 0)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0]);
    });

  if (rankedMuscles.length === 0) {
    return null;
  }

  const baseVisibleCount = Math.min(IMPACT_VISIBLE_MUSCLE_COUNT, rankedMuscles.length);
  const cutoff = rankedMuscles[baseVisibleCount - 1]?.[1] ?? 0;
  const visibleEntries = rankedMuscles.filter(
    ([, projectedEffectiveSets], index) =>
      index < baseVisibleCount ||
      projectedEffectiveSets >= cutoff - IMPACT_NEAR_TIE_TOLERANCE - IMPACT_COMPARISON_EPSILON
  );
  const topMuscles = visibleEntries.map(([muscle, projectedEffectiveSets]) => ({
    muscle,
    projectedEffectiveSets,
  }));
  const hiddenMuscleCount = rankedMuscles.length - topMuscles.length;
  const overflowLabel = hiddenMuscleCount > 0 ? ` +${hiddenMuscleCount} more` : "";

  return {
    topMuscles,
    hiddenMuscleCount,
    summaryLabel: `This session will increase ${topMuscles
      .map((muscle) => muscle.muscle)
      .join(", ")}${overflowLabel}`,
  };
}

function attachProjectedSlotImpacts(input: {
  currentWeekPlan: ProgramCurrentWeekPlan;
  report: Awaited<ReturnType<typeof loadProjectedWeekVolumeReport>>;
}): ProgramCurrentWeekPlan {
  const projectedSessionBySlotId = new Map(
    input.report.projectedSessions
      .filter((session) => typeof session.slotId === "string" && session.slotId.length > 0)
      .map((session) => [session.slotId, session])
  );

  return {
    ...input.currentWeekPlan,
    slots: input.currentWeekPlan.slots.map((slot) => {
      const projectedSession = projectedSessionBySlotId.get(slot.slotId);

      return {
        ...slot,
        impact: projectedSession
          ? buildProgramSlotImpact({
              projectedContributionByMuscle: projectedSession.projectedContributionByMuscle,
            })
          : null,
      };
    }),
  };
}

function buildSlotWorkoutLookup(
  workouts: CurrentWeekWorkoutRow[]
): Map<string, { id: string; status: string }> {
  const bySlotId = new Map<string, { id: string; status: string; priority: number }>();

  for (const workout of workouts) {
    if (isCloseoutSession(workout.selectionMetadata)) {
      continue;
    }

    const slotId = readSessionSlotSnapshot(workout.selectionMetadata)?.slotId ?? null;
    if (!slotId) {
      continue;
    }

    const priority = LINKED_WORKOUT_PRIORITY[workout.status] ?? 99;
    const existing = bySlotId.get(slotId);
    if (!existing || priority < existing.priority) {
      bySlotId.set(slotId, {
        id: workout.id,
        status: workout.status.toLowerCase(),
        priority,
      });
    }
  }

  return new Map(
    Array.from(bySlotId.entries()).map(([slotId, workout]) => [
      slotId,
      { id: workout.id, status: workout.status },
    ])
  );
}

function formatCloseoutStatusLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function buildProgramCloseoutSummary(
  closeout: CloseoutSupportData
): ProgramCloseoutSummary | null {
  if (!closeout.visible) {
    return null;
  }

  const title = formatCloseoutTitle(closeout);

  if (!closeout.workoutId || !closeout.status) {
    if (!closeout.canCreate || !closeout.weekCloseId || closeout.targetWeek == null) {
      return null;
    }

    const currentWeekLabel =
      closeout.isPriorWeek ? `Week ${closeout.targetWeek + 1}` : "this week";

    return {
      title,
      workoutId: null,
      status: "available",
      statusLabel: "Available",
      detail: closeout.isPriorWeek
        ? `Week ${closeout.targetWeek} closeout is still available after rollover. It stays separate from ${currentWeekLabel} and does not become a slot.`
        : "Optional manual closeout work is available for this week. It stays separate from the canonical slot plan.",
      actionHref: `/api/mesocycles/week-close/${closeout.weekCloseId}/closeout`,
      actionLabel:
        closeout.isPriorWeek ? `Create Week ${closeout.targetWeek} closeout` : "Create closeout",
      dismissActionHref: null,
      dismissActionLabel: null,
      targetWeek: closeout.targetWeek,
      isPriorWeek: closeout.isPriorWeek,
    };
  }

  const normalizedStatus = closeout.status.trim().toUpperCase();
  const statusLabel = formatCloseoutStatusLabel(normalizedStatus) ?? "Unknown";

  if (normalizedStatus === "COMPLETED") {
    return {
      title,
      workoutId: closeout.workoutId,
      status: closeout.status,
      statusLabel,
      detail:
        closeout.isPriorWeek && closeout.targetWeek != null
          ? `Completed Week ${closeout.targetWeek} closeout is part of that week's actual landing, but it does not extend your current slot plan.`
          : "Completed closeout is part of this week's actual landing, but it does not extend the remaining canonical slot plan.",
      actionHref: `/workout/${closeout.workoutId}`,
      actionLabel: "Review closeout",
      dismissActionHref: null,
      dismissActionLabel: null,
      targetWeek: closeout.targetWeek,
      isPriorWeek: closeout.isPriorWeek,
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
          ? `Skipped Week ${closeout.targetWeek} closeout stays separate from your current slot map and leaves continuity unchanged.`
          : "Skipped closeout stays separate from the slot map and leaves next-session continuity unchanged.",
      actionHref: `/workout/${closeout.workoutId}`,
      actionLabel: "View closeout",
      dismissActionHref: null,
      dismissActionLabel: null,
      targetWeek: closeout.targetWeek,
      isPriorWeek: closeout.isPriorWeek,
    };
  }

  return {
    title,
    workoutId: closeout.workoutId,
    status: closeout.status,
    statusLabel,
    detail:
      closeout.isPriorWeek && closeout.targetWeek != null
        ? `Optional manual closeout work for Week ${closeout.targetWeek}. It counts toward that week's actual volume once performed, but it is not part of your current slot map.`
        : "Optional manual closeout work. It counts toward actual weekly volume once performed, but it is not a remaining slot.",
    actionHref: `/log/${closeout.workoutId}`,
    actionLabel: "Open closeout",
    dismissActionHref:
      normalizedStatus === "PLANNED"
        ? `/api/workouts/${closeout.workoutId}/dismiss-closeout`
        : null,
    dismissActionLabel: normalizedStatus === "PLANNED" ? "Skip closeout" : null,
    targetWeek: closeout.targetWeek,
    isPriorWeek: closeout.isPriorWeek,
  };
}

function resolveNextSlotId(input: {
  nextWorkoutContext: NextWorkoutContext;
  remainingSlots: ReadonlyArray<{ slotId: string; intent: string }>;
}): string | null {
  if (input.remainingSlots.length === 0) {
    return null;
  }

  if (input.nextWorkoutContext.slotId) {
    const exactMatch = input.remainingSlots.find(
      (slot) => slot.slotId === input.nextWorkoutContext.slotId
    );
    if (exactMatch) {
      return exactMatch.slotId;
    }
  }

  if (input.nextWorkoutContext.intent) {
    const intentMatch = input.remainingSlots.find(
      (slot) => slot.intent === input.nextWorkoutContext.intent
    );
    if (intentMatch) {
      return intentMatch.slotId;
    }
  }

  return input.remainingSlots[0]?.slotId ?? null;
}

export function buildProgramCurrentWeekPlan(input: {
  week: number;
  slotSequenceJson?: unknown;
  weeklySchedule: string[];
  currentWeekWorkouts: CurrentWeekWorkoutRow[];
  nextWorkoutContext: NextWorkoutContext;
}): ProgramCurrentWeekPlan | null {
  const slotSequence = readRuntimeSlotSequence({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  if (slotSequence.slots.length === 0) {
    return null;
  }

  const performedAdvancingSlotsThisWeek: AdvancingPerformedSlot[] = buildAdvancingPerformedSlots(
    input.currentWeekWorkouts.filter((workout) => isPerformedWorkoutStatus(workout.status))
  );

  const remainingSlots = buildRemainingRuntimeSlotsFromPerformed({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
    performedAdvancingSlotsThisWeek,
  });
  const remainingSlotIds = new Set(remainingSlots.map((slot) => slot.slotId));
  const nextSlotId = resolveNextSlotId({
    nextWorkoutContext: input.nextWorkoutContext,
    remainingSlots,
  });
  const slotWorkoutLookup = buildSlotWorkoutLookup(input.currentWeekWorkouts);
  const existingNextWorkout =
    input.nextWorkoutContext.existingWorkoutId && input.nextWorkoutContext.selectedIncompleteStatus
      ? {
          id: input.nextWorkoutContext.existingWorkoutId,
          status: input.nextWorkoutContext.selectedIncompleteStatus,
        }
      : null;

  return {
    week: input.week,
    slots: slotSequence.slots.map((slot) => {
      const state: ProgramCurrentWeekPlanRow["state"] = !remainingSlotIds.has(slot.slotId)
        ? "completed"
        : slot.slotId === nextSlotId
          ? "next"
          : "remaining";
      const linkedWorkout =
        slotWorkoutLookup.get(slot.slotId) ??
        (state === "next" ? existingNextWorkout : null);

      return {
        slotId: slot.slotId,
        label: formatSessionIdentityLabel({
          intent: slot.intent,
          slotId: slot.slotId,
        }),
        sessionInWeek: slot.sequenceIndex + 1,
        state,
        linkedWorkoutId: linkedWorkout?.id ?? null,
        linkedWorkoutStatus: linkedWorkout?.status ?? null,
        impact: null,
      };
    }),
  };
}

async function loadCurrentWeekWorkouts(input: {
  userId: string;
  mesocycleId: string;
  week: number;
  weekStart: Date;
}): Promise<CurrentWeekWorkoutRow[]> {
  const weekEnd = new Date(input.weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  return prisma.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      OR: [
        { mesocycleWeekSnapshot: input.week },
        {
          mesocycleWeekSnapshot: null,
          scheduledDate: { gte: input.weekStart, lt: weekEnd },
        },
      ],
    },
    orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      status: true,
      scheduledDate: true,
      sessionIntent: true,
      selectionMode: true,
      selectionMetadata: true,
      advancesSplit: true,
    },
  });
}

async function loadCurrentWeekPlan(input: {
  userId: string;
  currentWeek: number;
  activeMesocycle: ActiveProgramPageMesocycle;
  nextWorkoutContext: NextWorkoutContext;
  closeoutTargetWeek: number | null;
  weekCloseId: string | null;
  weekCloseStatus: "PENDING_OPTIONAL_GAP_FILL" | "RESOLVED" | null;
}): Promise<{
  plan: ProgramCurrentWeekPlan | null;
  closeout: ProgramCloseoutSummary | null;
}> {
  const mesoStart = new Date(input.activeMesocycle.macroCycle.startDate);
  mesoStart.setDate(mesoStart.getDate() + input.activeMesocycle.startWeek * 7);
  const currentWeekStart = computeMesoWeekStart(mesoStart, input.currentWeek);
  const closeoutTargetWeek = input.closeoutTargetWeek ?? input.currentWeek;
  const closeoutWeekStart =
    closeoutTargetWeek === input.currentWeek
      ? currentWeekStart
      : computeMesoWeekStart(mesoStart, closeoutTargetWeek);

  const [constraints, currentWeekWorkouts, closeoutWeekWorkouts] = await Promise.all([
    prisma.constraints.findUnique({
      where: { userId: input.userId },
      select: { weeklySchedule: true },
    }),
    loadCurrentWeekWorkouts({
      userId: input.userId,
      mesocycleId: input.activeMesocycle.id,
      week: input.currentWeek,
      weekStart: currentWeekStart,
    }),
    closeoutTargetWeek === input.currentWeek
      ? Promise.resolve(null)
      : loadCurrentWeekWorkouts({
          userId: input.userId,
          mesocycleId: input.activeMesocycle.id,
          week: closeoutTargetWeek,
          weekStart: closeoutWeekStart,
        }),
  ]);

  return {
    plan: buildProgramCurrentWeekPlan({
      week: input.currentWeek,
      slotSequenceJson: input.activeMesocycle.slotSequenceJson,
      weeklySchedule: (constraints?.weeklySchedule ?? []).map((intent) => intent.toLowerCase()),
      currentWeekWorkouts,
      nextWorkoutContext: input.nextWorkoutContext,
    }),
    closeout: buildProgramCloseoutSummary(
      buildCurrentWeekCloseoutSupport({
        workouts: closeoutWeekWorkouts ?? currentWeekWorkouts,
        activeWeek: input.currentWeek,
        targetWeek: closeoutTargetWeek,
        weekCloseId: input.weekCloseId,
        weekCloseStatus: input.weekCloseStatus,
      })
    ),
  };
}

export async function loadProgramPageData(userId: string): Promise<ProgramPageData> {
  const fixture = await getUiAuditFixtureForServer();
  if (fixture?.program) {
    return fixture.program;
  }

  const [dashboard, activeMesocycle, nextWorkoutContext] = await Promise.all([
    loadProgramDashboardData(userId),
    prisma.mesocycle.findFirst({
      where: { macroCycle: { userId }, isActive: true },
      select: {
        id: true,
        startWeek: true,
        durationWeeks: true,
        accumulationSessionsCompleted: true,
        deloadSessionsCompleted: true,
        sessionsPerWeek: true,
        state: true,
        slotSequenceJson: true,
        macroCycle: {
          select: { startDate: true },
        },
      },
    }),
    loadNextWorkoutContext(userId),
  ]);

  const overview = buildProgramPageOverview(dashboard);
  const relevantWeekClose = activeMesocycle
    ? await findRelevantWeekCloseForUser({
        userId,
        mesocycleId: activeMesocycle.id,
      })
    : null;
  const closeoutTargetWeek =
    activeMesocycle &&
    isCloseoutWeekInScope({
      activeWeek: dashboard.currentWeek,
      targetWeek:
        relevantWeekClose?.mesocycleId === activeMesocycle.id
          ? relevantWeekClose.targetWeek
          : null,
    })
      ? relevantWeekClose?.targetWeek ?? null
      : dashboard.currentWeek;
  const currentWeekSurface =
    activeMesocycle && dashboard.activeMeso
      ? await loadCurrentWeekPlan({
          userId,
          currentWeek: dashboard.currentWeek,
          activeMesocycle,
          nextWorkoutContext,
          closeoutTargetWeek,
          weekCloseId:
            relevantWeekClose?.targetWeek === closeoutTargetWeek ? relevantWeekClose.id : null,
          weekCloseStatus:
            relevantWeekClose?.targetWeek === closeoutTargetWeek ? relevantWeekClose.status : null,
        })
      : null;
  const currentWeekPlan = currentWeekSurface?.plan ?? null;
  const closeout = currentWeekSurface?.closeout ?? null;
  const projectedWeekReport =
    activeMesocycle && dashboard.activeMeso
      ? await loadProjectedWeekVolumeReport({ userId })
      : null;
  const weekCompletionOutlook = projectedWeekReport
    ? buildWeekCompletionOutlook({
        report: projectedWeekReport,
      })
    : null;
  const currentWeekPlanWithImpacts =
    projectedWeekReport && currentWeekPlan
      ? attachProjectedSlotImpacts({
          report: projectedWeekReport,
          currentWeekPlan,
        })
      : currentWeekPlan;

  return {
    overview,
    currentWeekPlan: currentWeekPlanWithImpacts,
    closeout,
    weekCompletionOutlook,
    volumeDetails: {
      dashboard,
    },
    advancedActions: {
      availableActions: ["deload", "extend_phase", "reset"],
    },
  };
}
