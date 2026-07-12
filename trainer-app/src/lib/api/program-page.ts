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
  type CycleAnchorAction,
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
import { parseSlotPlanSeedJson, type SlotPlanSeedRole } from "./slot-plan-seed-parser";
import { getUiAuditFixtureForServer } from "@/lib/ui-audit-fixtures/server";
import type { CanonicalUiState } from "@/lib/ui-state-contract";
import {
  formatWeeklyMuscleStatusLabel,
  getWeeklyMuscleDisplayGroup,
  getWeeklyMuscleStatus,
  type WeeklyMuscleStatus,
  type WeeklyMuscleDisplayGroup,
} from "@/lib/ui/weekly-muscle-status";
import type {
  MuscleDashboardGroup,
  MuscleTargetTier,
  MuscleTargetWarningSeverity,
  VolumeSoftTargetRange,
  VolumeTargetKind,
} from "@/lib/engine/volume-landmarks";
import {
  buildVolumeLandmarkContext,
  formatSetCount,
  formatTargetDeltaLabel,
  formatTargetDisplayLabel,
  formatWeightedSetsLabel,
  type VolumeReadModelLandmarkContext,
} from "./volume-read-model-helpers";

type ActiveProgramPageMesocycle = {
  id: string;
  startWeek: number;
  durationWeeks: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
  slotSequenceJson: unknown;
  slotPlanSeedJson: unknown;
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
  exercises?: CurrentWeekWorkoutExerciseRow[];
};

type CurrentWeekWorkoutExerciseRow = {
  exerciseId: string;
  orderIndex: number;
  isMainLift: boolean;
  exercise: {
    id: string;
    name: string;
  };
  sets: Array<{ id: string }>;
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

export type ProgramSoftTargetSummary = {
  belowSoftRange: number;
  withinSoftRange: number;
  aboveSoftRange: number;
};

export type ProgramSlotImpact = {
  topMuscles: Array<{
    muscle: string;
    projectedEffectiveSets: number;
  }>;
  hiddenMuscleCount: number;
  summaryLabel: string;
};

export type ProgramSlotExercise = {
  exerciseId?: string;
  name: string;
  setCount: number;
  role?: "primary" | "accessory";
};

export type ProgramSlotExerciseSource =
  | "persisted_slot_plan_seed"
  | "linked_workout_structure"
  | "projected_week_volume"
  | "unavailable";

export type ProgramCurrentWeekPlanRow = {
  slotId: string;
  label: string;
  sessionInWeek: number;
  uiState: Extract<CanonicalUiState, "planned" | "active" | "completed" | "projected" | "blocked">;
  statusLabel: string;
  statusDescription: string;
  volumeBasis: "actual_completed" | "projected_next" | "projected_remaining" | "optional";
  linkedWorkoutId: string | null;
  linkedWorkoutStatus: string | null;
  exercises?: ProgramSlotExercise[];
  exerciseSource: ProgramSlotExerciseSource;
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
  actionMethod?: "link" | "post";
  dismissActionHref: string | null;
  dismissActionLabel: string | null;
  targetWeek: number | null;
  isPriorWeek: boolean;
  canDismiss: boolean;
};

function formatCloseoutTitle(
  closeout: Pick<CloseoutSupportData, "isPriorWeek" | "targetWeek">
): string {
  return closeout.isPriorWeek && closeout.targetWeek != null
    ? `Week ${closeout.targetWeek} optional session`
    : "Custom session";
}

export type ProgramWeekCompletionOutlook = {
  assumptionLabel: string;
  summary: ProgramOutcomeSummary;
  secondarySummary?: ProgramSoftTargetSummary;
  badges: ProgramVolumeDisplayBadge[];
  secondaryBadges?: ProgramVolumeDisplayBadge[];
  rows: ProgramVolumeDisplayRow[];
  primaryRows?: ProgramVolumeDisplayRow[];
  supportRows?: ProgramVolumeDisplayRow[];
  secondaryRows?: ProgramVolumeDisplayRow[];
  defaultRows: ProgramVolumeDisplayRow[];
};

export type ProgramVolumeDisplayBadge = {
  status: string;
  label: string;
  count?: number;
  activeDescription?: string;
};

export type ProgramVolumeDisplayRow = {
  muscle: string;
  status: MuscleOutcomeStatus;
  targetKind?: VolumeTargetKind;
  targetRange?: VolumeSoftTargetRange | null;
  displayGroup?: WeeklyMuscleDisplayGroup;
  targetTier?: MuscleTargetTier | null;
  warningSeverity?: MuscleTargetWarningSeverity;
  dashboardGroup?: MuscleDashboardGroup | null;
  weightedSetsLabel: string;
  targetLabel: string;
  statusLabel: string;
  statusDescription: string;
  deltaLabel: string;
  comparisonLabel: string;
  landmarkContext?: ProgramVolumeLandmarkContext;
  badges: ProgramVolumeDisplayBadge[];
};

export type ProgramVolumeLandmarkContext = VolumeReadModelLandmarkContext;

export type ProgramPageData = {
  overview: ProgramPageOverview | null;
  currentWeekPlan: ProgramCurrentWeekPlan | null;
  closeout: ProgramCloseoutSummary | null;
  weekCompletionOutlook: ProgramWeekCompletionOutlook | null;
  volumeDetails: {
    dashboard: ProgramDashboardData;
  };
  advancedActions: {
    availableActions: CycleAnchorAction[];
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

type LinkedSlotWorkout = {
  id: string;
  status: string;
  exercises: ProgramSlotExercise[];
};

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

function formatSignedCompactSets(value: number): string {
  return `+${formatSetCount(value)}`;
}

// Compact comparison copy intentionally differs from dashboard display labels.
function formatTargetLabel(input: {
  targetSets: number;
  targetKind?: VolumeTargetKind;
  targetRange?: VolumeSoftTargetRange | null;
}): string {
  if (input.targetKind === "soft" && input.targetRange) {
    return `${formatSetCount(input.targetRange.min)}-${formatSetCount(
      input.targetRange.max
    )} preferred range`;
  }

  return `${formatSetCount(input.targetSets)} preferred target`;
}

function formatProjectedHardStatusLabel(input: {
  weeklyStatus: WeeklyMuscleStatus;
  projectedSets: number;
  mev: number;
}): string {
  switch (input.weeklyStatus) {
    case "below_mev":
      return "Below MEV";
    case "in_range":
      return input.projectedSets === input.mev ? "At MEV" : "Productive zone";
    case "near_target":
      return "Below preferred target";
    case "on_target":
      return "Preferred target reached";
    case "near_mrv":
      return "Near cap";
    case "at_mrv":
      return "Over cap";
  }
}

function formatProjectedHardStatusDescription(input: {
  weeklyStatus: WeeklyMuscleStatus;
  projectedLabel: string;
  targetLabel: string;
  completedLabel: string;
}): string {
  switch (input.weeklyStatus) {
    case "below_mev":
      return `${input.projectedLabel} is still below the MEV floor after the planned week.`;
    case "in_range":
    case "near_target":
      return `${input.projectedLabel} reaches the productive floor; below the ${input.targetLabel} only. ${input.completedLabel} so far.`;
    case "on_target":
      return `${input.projectedLabel} reaches the preferred target inside the productive zone; ${input.completedLabel} so far.`;
    case "near_mrv":
      return `${input.projectedLabel} is near the cap; ${input.completedLabel} so far.`;
    case "at_mrv":
      return `${input.projectedLabel} is over the cap; ${input.completedLabel} so far.`;
  }
}

function buildOutlookBadges(summary: ProgramOutcomeSummary): ProgramVolumeDisplayBadge[] {
  return [
    {
      status: "meaningfully_low",
      label: "below MEV",
      count: summary.meaningfullyLow,
      activeDescription: "Showing projected muscles below the MEV floor.",
    },
    {
      status: "slightly_low",
      label: "below preferred",
      count: summary.slightlyLow,
      activeDescription:
        "Showing projected muscles with the productive floor reached but below the preferred target.",
    },
    {
      status: "on_target",
      label: "productive zone",
      count: summary.onTarget,
      activeDescription: "Showing projected muscles inside the productive zone.",
    },
    {
      status: "slightly_high",
      label: "above preferred",
      count: summary.slightlyHigh,
      activeDescription: "Showing projected muscles above the preferred target.",
    },
    {
      status: "meaningfully_high",
      label: "watch high",
      count: summary.meaningfullyHigh,
      activeDescription: "Showing projected muscles with high projected volume.",
    },
  ];
}

function buildSoftTargetSummary(rows: ProgramVolumeDisplayRow[]): ProgramSoftTargetSummary {
  return rows.reduce<ProgramSoftTargetSummary>(
    (summary, row) => {
      const status = row.badges[0]?.status;
      if (status === "below_mev") {
        summary.belowSoftRange += 1;
      } else if (status === "near_mrv" || status === "at_mrv") {
        summary.aboveSoftRange += 1;
      } else {
        summary.withinSoftRange += 1;
      }
      return summary;
    },
    {
      belowSoftRange: 0,
      withinSoftRange: 0,
      aboveSoftRange: 0,
    }
  );
}

function buildSoftTargetBadges(summary: ProgramSoftTargetSummary): ProgramVolumeDisplayBadge[] {
  return [
    {
      status: "below_soft_range",
      label: "below soft range",
      count: summary.belowSoftRange,
    },
    {
      status: "within_soft_range",
      label: "within soft range",
      count: summary.withinSoftRange,
    },
    {
      status: "above_soft_range",
      label: "above soft range",
      count: summary.aboveSoftRange,
    },
  ];
}

function getProjectedOutlookRank(row: {
  weeklyStatus: WeeklyMuscleStatus;
  status: MuscleOutcomeStatus;
}): number {
  if (row.weeklyStatus === "below_mev") {
    return 0;
  }
  if (row.weeklyStatus === "at_mrv" || row.weeklyStatus === "near_mrv") {
    return 1;
  }
  if (row.status === "meaningfully_low") {
    return 2;
  }
  if (row.status === "slightly_low") {
    return 3;
  }
  if (row.status === "slightly_high" || row.status === "meaningfully_high") {
    return 4;
  }
  return 5;
}

function buildProgramVolumeDisplayRow(input: {
  muscle: string;
  status: MuscleOutcomeStatus;
  targetKind: VolumeTargetKind;
  targetRange: VolumeSoftTargetRange | null;
  displayGroup: WeeklyMuscleDisplayGroup;
  targetTier?: MuscleTargetTier | null;
  warningSeverity?: MuscleTargetWarningSeverity;
  dashboardGroup?: MuscleDashboardGroup | null;
  projectedFullWeekEffectiveSets: number;
  targetSets: number;
  delta: number;
  mev: number;
  mav: number;
  mrv: number;
  completedEffectiveSets: number;
  projectedNextSessionEffectiveSets: number;
  projectedRemainingWeekEffectiveSets: number;
}): ProgramVolumeDisplayRow {
  const weeklyStatus = getWeeklyMuscleStatus({
    effectiveSets: input.projectedFullWeekEffectiveSets,
    target: input.targetSets,
    mev: input.mev,
    mrv: input.mrv,
    targetKind: input.targetKind,
    softTargetRange: input.targetRange,
  });
  const weeklyStatusLabel = formatWeeklyMuscleStatusLabel(weeklyStatus, {
    targetKind: input.targetKind,
  });
  const isSoftTarget = input.targetKind === "soft";
  const statusLabel =
    isSoftTarget
      ? weeklyStatusLabel
      : formatProjectedHardStatusLabel({
          weeklyStatus,
          projectedSets: input.projectedFullWeekEffectiveSets,
          mev: input.mev,
        });
  const projectedLabel = `${formatSetCount(input.projectedFullWeekEffectiveSets)} projected`;
  const targetLabel = formatTargetLabel({
    targetSets: input.targetSets,
    targetKind: input.targetKind,
    targetRange: input.targetRange,
  });
  const completedLabel = `${formatSetCount(input.completedEffectiveSets)} completed`;

  return {
    muscle: input.muscle,
    status: input.status,
    targetKind: input.targetKind,
    targetRange: input.targetRange,
    displayGroup: input.displayGroup,
    targetTier: input.targetTier,
    warningSeverity: input.warningSeverity,
    dashboardGroup: input.dashboardGroup,
    weightedSetsLabel: formatWeightedSetsLabel(input.projectedFullWeekEffectiveSets),
    targetLabel: formatTargetDisplayLabel({
      targetSets: input.targetSets,
      targetKind: input.targetKind,
      targetRange: input.targetRange,
    }),
    statusLabel,
    statusDescription:
      isSoftTarget
        ? `${projectedLabel} vs ${targetLabel}; ${completedLabel} so far. Non-blocking.`
        : formatProjectedHardStatusDescription({
            weeklyStatus,
            projectedLabel,
            targetLabel,
            completedLabel,
          }),
    deltaLabel: formatTargetDeltaLabel({
      effectiveSets: input.projectedFullWeekEffectiveSets,
      targetSets: input.targetSets,
      targetKind: input.targetKind,
      targetRange: input.targetRange,
    }),
    comparisonLabel: `${projectedLabel} vs ${targetLabel}`,
    landmarkContext: isSoftTarget
      ? undefined
      : buildVolumeLandmarkContext({
          effectiveSets: input.projectedFullWeekEffectiveSets,
          mev: input.mev,
          mav: input.mav,
          mrv: input.mrv,
        }),
    badges: [
      {
        status: weeklyStatus,
        label: weeklyStatusLabel,
      },
      {
        status: "actual_completed",
        label: "Actual completed",
        count: input.completedEffectiveSets,
      },
      {
        status: "projected_next",
        label: "Projected next",
        count: input.projectedNextSessionEffectiveSets,
      },
      {
        status: "projected_remaining",
        label: "Projected remaining",
        count: input.projectedRemainingWeekEffectiveSets,
      },
    ],
  };
}

function buildWeekCompletionOutlook(input: {
  report: Awaited<ReturnType<typeof loadProjectedWeekVolumeReport>>;
}): ProgramWeekCompletionOutlook | null {
  if (input.report.projectedSessions.length === 0 || input.report.fullWeekByMuscle.length === 0) {
    return null;
  }

  const classifiedRows = input.report.fullWeekByMuscle.map((row) => {
    const targetKind = row.targetKind ?? "hard";
    const targetRange = row.targetRange ?? null;
    const displayGroup = row.displayGroup ?? getWeeklyMuscleDisplayGroup(targetKind);
    const dashboardGroup =
      row.dashboardGroup ??
      (displayGroup === "secondary" ? "secondary" : "primary_driver");
    const outcome = classifyMuscleOutcome(row.weeklyTarget, row.projectedFullWeekEffectiveSets, {
      targetKind,
      targetRange,
    });
    const weeklyStatus = getWeeklyMuscleStatus({
      effectiveSets: row.projectedFullWeekEffectiveSets,
      target: row.weeklyTarget,
      mev: row.mev,
      mrv: row.mrv ?? row.mav,
      targetKind,
      softTargetRange: targetRange,
    });

    return {
      muscle: row.muscle,
      status: outcome.status,
      weeklyStatus,
      projectedFullWeekEffectiveSets: row.projectedFullWeekEffectiveSets,
      targetSets: row.weeklyTarget,
      targetKind,
      targetRange,
      displayGroup,
      targetTier: row.targetTier,
      warningSeverity: row.warningSeverity,
      dashboardGroup,
      delta: outcome.delta,
      percentDelta: outcome.percentDelta,
      mev: row.mev,
      mav: row.mav,
      mrv: row.mrv ?? row.mav,
      completedEffectiveSets: row.completedEffectiveSets,
      projectedNextSessionEffectiveSets: row.projectedNextSessionEffectiveSets,
      projectedRemainingWeekEffectiveSets: row.projectedRemainingWeekEffectiveSets,
    };
  });

  const rows = classifiedRows
    .sort((left, right) => {
      const rankDelta = getProjectedOutlookRank(left) - getProjectedOutlookRank(right);
      if (rankDelta !== 0) {
        return rankDelta;
      }

      const magnitudeDelta = Math.abs(right.percentDelta) - Math.abs(left.percentDelta);
      if (magnitudeDelta !== 0) {
        return magnitudeDelta;
      }

      return left.muscle.localeCompare(right.muscle);
    });
  const displayRows = rows.map((row) =>
    buildProgramVolumeDisplayRow({
      muscle: row.muscle,
      status: row.status,
      targetKind: row.targetKind,
      targetRange: row.targetRange,
      displayGroup: row.displayGroup,
      targetTier: row.targetTier,
      warningSeverity: row.warningSeverity,
      dashboardGroup: row.dashboardGroup,
      projectedFullWeekEffectiveSets: row.projectedFullWeekEffectiveSets,
      targetSets: row.targetSets,
      delta: row.delta,
      mev: row.mev,
      mav: row.mav,
      mrv: row.mrv,
      completedEffectiveSets: row.completedEffectiveSets,
      projectedNextSessionEffectiveSets: row.projectedNextSessionEffectiveSets,
      projectedRemainingWeekEffectiveSets: row.projectedRemainingWeekEffectiveSets,
    })
  );
  const primaryDriverRows = displayRows.filter(
    (row) => (row.dashboardGroup ?? row.displayGroup) === "primary_driver"
  );
  const supportRows = displayRows.filter((row) => row.dashboardGroup === "support_driver");
  const secondaryRows = displayRows.filter(
    (row) => (row.dashboardGroup ?? row.displayGroup) === "secondary"
  );
  const summary = buildOutcomeSummary(
    rows.filter((row) => (row.dashboardGroup ?? row.displayGroup) === "primary_driver")
  );
  const secondarySummary = buildSoftTargetSummary(secondaryRows);

  const defaultRows = primaryDriverRows
    .filter((row) => {
      const weeklyStatus = row.badges[0]?.status;
      return (
        weeklyStatus === "below_mev" ||
        weeklyStatus === "near_mrv" ||
        weeklyStatus === "at_mrv" ||
        row.status === "meaningfully_low" ||
        row.status === "slightly_low"
      );
    })
    .slice(0, 4);

  return {
    assumptionLabel: "If you complete the remaining planned sessions this week, you will likely land here.",
    summary,
    secondarySummary,
    badges: buildOutlookBadges(summary),
    secondaryBadges: buildSoftTargetBadges(secondarySummary),
    rows: displayRows,
    primaryRows: primaryDriverRows,
    supportRows,
    secondaryRows,
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

  const visibleEntries = rankedMuscles.slice(0, IMPACT_VISIBLE_MUSCLE_COUNT);
  const topMuscles = visibleEntries.map(([muscle, projectedEffectiveSets]) => ({
    muscle,
    projectedEffectiveSets,
  }));
  const hiddenMuscleCount = rankedMuscles.length - topMuscles.length;
  const overflowLabel = hiddenMuscleCount > 0 ? ` \u00b7 +${hiddenMuscleCount} more` : "";

  return {
    topMuscles,
    hiddenMuscleCount,
    summaryLabel: `${topMuscles
      .map((muscle) => `${muscle.muscle} ${formatSignedCompactSets(muscle.projectedEffectiveSets)}`)
      .join(" \u00b7 ")}${overflowLabel}`,
  };
}

function mapSeedRole(role: SlotPlanSeedRole): ProgramSlotExercise["role"] {
  return role === "CORE_COMPOUND" ? "primary" : "accessory";
}

function mapWorkoutExercisesToProgramSlotExercises(
  exercises: readonly CurrentWeekWorkoutExerciseRow[] | undefined
): ProgramSlotExercise[] {
  return [...(exercises ?? [])]
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.exercise.name,
      setCount: exercise.sets.length,
      role: exercise.isMainLift ? "primary" : "accessory",
    }));
}

function collectSeedExerciseIds(slotPlanSeedJson: unknown): string[] {
  const seed = parseSlotPlanSeedJson(slotPlanSeedJson);
  if (!seed) {
    return [];
  }

  return Array.from(
    new Set(
      seed.slots.flatMap((slot) => slot.exercises.map((exercise) => exercise.exerciseId))
    )
  );
}

type SeededSlotExerciseResolution = {
  exercises: ProgramSlotExercise[];
  source?: ProgramSlotExerciseSource;
  blocksFallback: boolean;
};

function resolveFallbackExerciseSource(input: {
  linkedExerciseCount: number;
  projectedExerciseCount?: number;
}): ProgramSlotExerciseSource {
  if (input.linkedExerciseCount > 0) {
    return "linked_workout_structure";
  }

  if ((input.projectedExerciseCount ?? 0) > 0) {
    return "projected_week_volume";
  }

  return "unavailable";
}

function resolveSeededSlotExercises(input: {
  slotPlanSeedJson?: unknown;
  slotId: string;
  exerciseNameById?: Record<string, string>;
}): SeededSlotExerciseResolution {
  const seed = parseSlotPlanSeedJson(input.slotPlanSeedJson);
  const seedSlot = seed?.slots.find((slot) => slot.slotId === input.slotId) ?? null;
  if (!seedSlot) {
    return { exercises: [], blocksFallback: false };
  }

  const hasExecutableSetCounts =
    seedSlot.exercises.length > 0 &&
    seedSlot.exercises.every(
      (exercise) => exercise.hasExplicitSetCount && typeof exercise.setCount === "number"
    );

  if (!hasExecutableSetCounts) {
    return { exercises: [], blocksFallback: false };
  }

  const exercises = seedSlot.exercises.flatMap((seedExercise) => {
    const name = input.exerciseNameById
      ? input.exerciseNameById[seedExercise.exerciseId] ?? null
      : seedExercise.name ?? null;
    const setCount = seedExercise.setCount ?? null;

    if (!name || typeof setCount !== "number") {
      return [];
    }

    return [{
      exerciseId: seedExercise.exerciseId,
      name,
      setCount,
      role: mapSeedRole(seedExercise.role),
    } satisfies ProgramSlotExercise];
  });

  return {
    exercises: exercises.length === seedSlot.exercises.length ? exercises : [],
    source: "persisted_slot_plan_seed",
    blocksFallback: true,
  };
}

function attachProjectedSlotDetails(input: {
  currentWeekPlan: ProgramCurrentWeekPlan;
  report: Awaited<ReturnType<typeof loadProjectedWeekVolumeReport>>;
  slotPlanSeedJson?: unknown;
  seedExerciseNameById?: Record<string, string>;
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
      const projectedExercises =
        (projectedSession?.exercises ?? []).map((exercise) => ({
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          setCount: exercise.setCount,
          role: exercise.role,
        } satisfies ProgramSlotExercise)) ?? [];
      const seededExercises = resolveSeededSlotExercises({
        slotPlanSeedJson: input.slotPlanSeedJson,
        slotId: slot.slotId,
        exerciseNameById: input.seedExerciseNameById,
      });
      const resolvedExercises =
        seededExercises.exercises.length > 0
          ? seededExercises.exercises
          : seededExercises.blocksFallback
            ? []
            : (slot.exercises ?? []).length > 0
              ? slot.exercises
              : projectedExercises;
      const exerciseSource =
        seededExercises.source ??
        resolveFallbackExerciseSource({
          linkedExerciseCount: slot.exercises?.length ?? 0,
          projectedExerciseCount: projectedExercises.length,
        });

      return {
        ...slot,
        exercises: resolvedExercises,
        exerciseSource,
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
): Map<string, LinkedSlotWorkout> {
  const bySlotId = new Map<string, LinkedSlotWorkout & { priority: number }>();

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
        exercises: mapWorkoutExercisesToProgramSlotExercises(workout.exercises),
        priority,
      });
    }
  }

  return new Map(
    Array.from(bySlotId.entries()).map(([slotId, workout]) => [
      slotId,
      { id: workout.id, status: workout.status, exercises: workout.exercises },
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
        ? `A Week ${closeout.targetWeek} optional session is still available after rollover. It stays separate from ${currentWeekLabel} and does not become a slot.`
        : "Optional manual session is available for this week. It stays separate from the weekly slot plan.",
      actionHref: `/api/mesocycles/week-close/${closeout.weekCloseId}/closeout`,
      actionLabel: "Create optional session",
      actionMethod: "post",
      dismissActionHref: null,
      dismissActionLabel: null,
      targetWeek: closeout.targetWeek,
      isPriorWeek: closeout.isPriorWeek,
      canDismiss: true,
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
          ? `Completed Week ${closeout.targetWeek} optional session is part of that week's actual landing, but it does not extend your current slot plan.`
          : "Completed optional session is part of this week's actual landing, but it does not extend the remaining weekly slot plan.",
      actionHref: `/workout/${closeout.workoutId}`,
      actionLabel: "Review custom session",
      dismissActionHref: null,
      dismissActionLabel: null,
      targetWeek: closeout.targetWeek,
      isPriorWeek: closeout.isPriorWeek,
      canDismiss: true,
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
          ? `Skipped Week ${closeout.targetWeek} optional session stays separate from your current slot map and leaves continuity unchanged.`
          : "Skipped optional session stays separate from the slot map and leaves next-session continuity unchanged.",
      actionHref: `/workout/${closeout.workoutId}`,
      actionLabel: "Review custom session",
      dismissActionHref: null,
      dismissActionLabel: null,
      targetWeek: closeout.targetWeek,
      isPriorWeek: closeout.isPriorWeek,
      canDismiss: true,
    };
  }

  return {
    title,
    workoutId: closeout.workoutId,
    status: closeout.status,
    statusLabel,
    detail:
      closeout.isPriorWeek && closeout.targetWeek != null
        ? `Optional manual session for Week ${closeout.targetWeek}. It counts toward that week's actual volume once performed, but it is not part of your current slot map.`
        : "Optional manual session. It counts toward actual weekly volume once performed, but it is not a remaining slot.",
    actionHref: `/log/${closeout.workoutId}`,
    actionLabel: "Open custom session",
    dismissActionHref:
      normalizedStatus === "PLANNED"
        ? `/api/workouts/${closeout.workoutId}/dismiss-closeout`
        : null,
    dismissActionLabel: normalizedStatus === "PLANNED" ? "Dismiss optional session" : null,
    targetWeek: closeout.targetWeek,
    isPriorWeek: closeout.isPriorWeek,
    canDismiss: true,
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

function resolvePlanRowPresentation(input: {
  slot: { sequenceIndex: number };
  isCompletedSlot: boolean;
  isNextSlot: boolean;
  linkedWorkoutStatus: string | null;
}): Pick<
  ProgramCurrentWeekPlanRow,
  "uiState" | "statusLabel" | "statusDescription" | "volumeBasis"
> {
  const sessionLabel = `Session ${input.slot.sequenceIndex + 1}`;
  const linkedStatus = input.linkedWorkoutStatus?.trim().toLowerCase() ?? null;

  if (linkedStatus === "in_progress" || linkedStatus === "partial") {
    return {
      uiState: "active",
      statusLabel: "Active",
      statusDescription: `${sessionLabel} has started and remains editable.`,
      volumeBasis: "projected_next",
    };
  }

  if (input.isCompletedSlot) {
    return {
      uiState: "completed",
      statusLabel: "Completed",
      statusDescription: `${sessionLabel} is counted from actual completed volume.`,
      volumeBasis: "actual_completed",
    };
  }

  if (linkedStatus === "planned") {
    return {
      uiState: "planned",
      statusLabel: input.isNextSlot ? "Planned next" : "Planned",
      statusDescription: `${sessionLabel} already has a planned workout ready to log.`,
      volumeBasis: input.isNextSlot ? "projected_next" : "projected_remaining",
    };
  }

  if (input.isNextSlot) {
    return {
      uiState: "planned",
      statusLabel: "Planned next",
      statusDescription: `${sessionLabel} is the next required slot; its volume is projected from the next-session plan.`,
      volumeBasis: "projected_next",
    };
  }

  return {
    uiState: "projected",
    statusLabel: "Projected",
    statusDescription: `${sessionLabel} is unresolved; its volume is projected as remaining work.`,
    volumeBasis: "projected_remaining",
  };
}

export function buildProgramCurrentWeekPlan(input: {
  week: number;
  slotSequenceJson?: unknown;
  slotPlanSeedJson?: unknown;
  seedExerciseNameById?: Record<string, string>;
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
  const workoutById = new Map(
    input.currentWeekWorkouts.map((workout) => [
      workout.id,
      {
        id: workout.id,
        status: workout.status.toLowerCase(),
        exercises: mapWorkoutExercisesToProgramSlotExercises(workout.exercises),
      } satisfies LinkedSlotWorkout,
    ])
  );
  const existingNextWorkout =
    input.nextWorkoutContext.existingWorkoutId && input.nextWorkoutContext.selectedIncompleteStatus
      ? workoutById.get(input.nextWorkoutContext.existingWorkoutId) ?? {
          id: input.nextWorkoutContext.existingWorkoutId,
          status: input.nextWorkoutContext.selectedIncompleteStatus,
          exercises: [],
        }
      : null;

  return {
    week: input.week,
    slots: slotSequence.slots.map((slot) => {
      const isCompletedSlot = !remainingSlotIds.has(slot.slotId);
      const isNextSlot = slot.slotId === nextSlotId;
      const linkedWorkout =
        slotWorkoutLookup.get(slot.slotId) ??
        (isNextSlot ? existingNextWorkout : null);
      const linkedExercises = linkedWorkout?.exercises ?? [];
      const seededExercises = resolveSeededSlotExercises({
        slotPlanSeedJson: input.slotPlanSeedJson,
        slotId: slot.slotId,
        exerciseNameById: input.seedExerciseNameById,
      });
      const presentation = resolvePlanRowPresentation({
        slot,
        isCompletedSlot,
        isNextSlot,
        linkedWorkoutStatus: linkedWorkout?.status ?? null,
      });

      return {
        slotId: slot.slotId,
        label: formatSessionIdentityLabel({
          intent: slot.intent,
          slotId: slot.slotId,
        }),
        sessionInWeek: slot.sequenceIndex + 1,
        ...presentation,
        linkedWorkoutId: linkedWorkout?.id ?? null,
        linkedWorkoutStatus: linkedWorkout?.status ?? null,
        exercises:
          seededExercises.exercises.length > 0
            ? seededExercises.exercises
            : seededExercises.blocksFallback
              ? []
              : linkedExercises,
        exerciseSource:
          seededExercises.source ??
          resolveFallbackExerciseSource({
            linkedExerciseCount: linkedExercises.length,
          }),
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
      exercises: {
        orderBy: { orderIndex: "asc" },
        select: {
          exerciseId: true,
          orderIndex: true,
          isMainLift: true,
          exercise: {
            select: {
              id: true,
              name: true,
            },
          },
          sets: {
            select: {
              id: true,
            },
          },
        },
      },
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
  seedExerciseNameById: Record<string, string>;
}> {
  const mesoStart = new Date(input.activeMesocycle.macroCycle.startDate);
  mesoStart.setDate(mesoStart.getDate() + input.activeMesocycle.startWeek * 7);
  const currentWeekStart = computeMesoWeekStart(mesoStart, input.currentWeek);
  const closeoutTargetWeek = input.closeoutTargetWeek ?? input.currentWeek;
  const closeoutWeekStart =
    closeoutTargetWeek === input.currentWeek
      ? currentWeekStart
      : computeMesoWeekStart(mesoStart, closeoutTargetWeek);

  const seedExerciseIds = collectSeedExerciseIds(input.activeMesocycle.slotPlanSeedJson);
  const [constraints, currentWeekWorkouts, closeoutWeekWorkouts, seedExercises] = await Promise.all([
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
    seedExerciseIds.length > 0
      ? prisma.exercise.findMany({
          where: { id: { in: seedExerciseIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const seedExerciseNameById = Object.fromEntries(
    seedExercises.map((exercise) => [exercise.id, exercise.name])
  );

  return {
    plan: buildProgramCurrentWeekPlan({
      week: input.currentWeek,
      slotSequenceJson: input.activeMesocycle.slotSequenceJson,
      slotPlanSeedJson: input.activeMesocycle.slotPlanSeedJson,
      seedExerciseNameById,
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
    seedExerciseNameById,
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
        slotPlanSeedJson: true,
        macroCycle: {
          select: { startDate: true },
        },
      },
    }),
    loadNextWorkoutContext(userId),
  ]);

  const overview = buildProgramPageOverview(dashboard);
  const rawRelevantWeekClose = activeMesocycle
    ? await findRelevantWeekCloseForUser({
        userId,
        mesocycleId: activeMesocycle.id,
      })
    : null;
  const relevantWeekClose =
    rawRelevantWeekClose?.resolution === "AUTO_DISMISSED"
      ? null
      : rawRelevantWeekClose;
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
      ? attachProjectedSlotDetails({
          report: projectedWeekReport,
          currentWeekPlan,
          slotPlanSeedJson: activeMesocycle?.slotPlanSeedJson,
          seedExerciseNameById: currentWeekSurface?.seedExerciseNameById,
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
      availableActions: [
        "deload",
        "extend_phase",
        "reset",
        ...(activeMesocycle?.state === "ACTIVE_ACCUMULATION"
          ? (["end_early"] satisfies CycleAnchorAction[])
          : []),
      ],
    },
  };
}
