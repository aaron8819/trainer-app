/**
 * Program dashboard data loader.
 * Shared by the API route and the server-component page to avoid HTTP round-trips.
 */

import { WorkoutSessionIntent, WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getDefaultSraHours } from "@/lib/engine/muscle-policy";
import { finishMesocycleEarly } from "@/lib/api/mesocycle-lifecycle";
import {
  getExposedVolumeLandmarkEntries,
  getMuscleTargetSemantics,
  type MuscleDashboardGroup,
  type MuscleTargetTier,
  type MuscleTargetWarningSeverity,
  type VolumeSoftTargetRange,
  type VolumeTargetKind,
} from "@/lib/engine/volume-landmarks";
import { getLatestReadinessSignal } from "./readiness";
import {
  getCurrentMesoWeek,
  getRirTarget,
  getWeeklyVolumeTarget,
} from "./mesocycle-lifecycle-math";
import { buildAdvancingPerformedSlots, loadNextWorkoutContext } from "./next-session";
import {
  findRelevantWeekCloseForUser,
  type WeekCloseDeficitState,
  type WeekCloseWorkflowState,
} from "./mesocycle-week-close";
import {
  loadMesocycleWeekMuscleVolume,
  type WeeklyMuscleExerciseContribution,
  type WeeklyMuscleVolumeRow,
} from "./weekly-volume";
import { loadRecentMuscleStimulus } from "./recent-muscle-stimulus";
import { computeMuscleOpportunity, type OpportunityState } from "./opportunity";
import { resolvePhaseBlockProfile } from "./generation-phase-block-context";
import {
  buildRemainingRuntimeSlotsFromPerformed,
  readRuntimeSlotSequence,
} from "./mesocycle-slot-runtime";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import {
  isCloseoutSession,
  isDismissedCloseoutSession,
} from "@/lib/session-semantics/closeout-classifier";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  formatWeeklyMuscleStatusLabel,
  getWeeklyMuscleDashboardGroup,
  getWeeklyMuscleDisplayGroup,
  getWeeklyMuscleStatus,
  type WeeklyMuscleStatus,
  type WeeklyMuscleDisplayGroup,
} from "@/lib/ui/weekly-muscle-status";
import {
  buildVolumeLandmarkContext,
  computeMesoWeekStartDate as computeMesoWeekStart,
  formatSetCount,
  formatTargetDeltaLabel,
  formatTargetDisplayLabel,
  formatWeightedSetsLabel,
  type VolumeReadModelLandmarkContext,
} from "./volume-read-model-helpers";
import { formatSessionIdentityLabel } from "@/lib/ui/session-identity";

export type ProgramMesoBlock = {
  blockType: string;
  startWeek: number;
  durationWeeks: number;
};

export type ProgramMesoSummary = {
  mesoNumber: number;
  focus: string;
  durationWeeks: number;
  completedSessions: number;
  volumeTarget: string;
  currentBlockType: string | null;
  blocks: ProgramMesoBlock[];
};

export type ProgramVolumeRow = {
  muscle: string;
  targetKind?: VolumeTargetKind;
  targetRange?: VolumeSoftTargetRange | null;
  displayGroup?: WeeklyMuscleDisplayGroup;
  targetTier?: MuscleTargetTier | null;
  warningSeverity?: MuscleTargetWarningSeverity;
  dashboardGroup?: MuscleDashboardGroup | null;
  effectiveSets: number;
  directSets: number;
  indirectSets: number;
  target: number;
  mev: number;
  mav: number;
  mrv: number;
  weightedSetsLabel: string;
  targetLabel: string;
  statusLabel: string;
  statusDescription: string;
  deltaLabel: string;
  landmarkContext?: ProgramVolumeLandmarkContext;
  badges: ProgramVolumeDisplayBadge[];
  opportunityScore: number;
  opportunityState: OpportunityState;
  opportunityRationale: string;
  breakdown?: ProgramMuscleContributionBreakdown;
};

export type ProgramVolumeDisplayBadge = {
  status: string;
  label: string;
  count?: number;
  activeDescription?: string;
};

export type ProgramVolumeLandmarkContext = VolumeReadModelLandmarkContext;

export type ProgramMuscleContribution = WeeklyMuscleExerciseContribution;

export type ProgramMuscleContributionBreakdown = {
  muscle: string;
  effectiveSets: number;
  targetSets: number;
  contributions: ProgramMuscleContribution[];
};

export type DeloadReadiness = {
  shouldDeload: boolean;
  urgency: "scheduled" | "recommended" | "urgent";
  reason: string;
};

export type NextSessionData = {
  intent: string | null;
  slotId: string | null;
  slotSequenceIndex: number | null;
  slotSequenceLength: number | null;
  slotSource: "mesocycle_slot_sequence" | "legacy_weekly_schedule" | null;
  weekInMeso: number | null;
  sessionInWeek: number | null;
  workoutId: string | null;
  isExisting: boolean;
};

export type HomeActiveWeekSessionStatus =
  | "completed"
  | "next"
  | "upcoming"
  | "in_progress"
  | "skipped";

export type HomeActiveWeekSessionRow = {
  slotId: string;
  label: string;
  status: HomeActiveWeekSessionStatus;
  statusLabel: string;
  href: string | null;
  workoutId: string | null;
  sequenceIndex: number;
};

export type HomeActiveWeekPlan = {
  week: number;
  source: "mesocycle_slot_sequence" | "legacy_weekly_schedule";
  sessions: HomeActiveWeekSessionRow[];
};

export type ProgramDashboardData = {
  activeMeso: ProgramMesoSummary | null;
  currentWeek: number;
  viewedWeek: number;
  viewedBlockType: string | null;
  sessionsUntilDeload: number;
  volumeThisWeek: ProgramVolumeRow[];
  deloadReadiness: DeloadReadiness | null;
  rirTarget: { min: number; max: number } | null;
  coachingCue: string;
};

export type HomeProgramSupportData = {
  nextSession: NextSessionData;
  activeWeek: number | null;
  activeWeekPlan: HomeActiveWeekPlan | null;
  completedAdvancingSessionsThisWeek: number;
  totalAdvancingSessionsThisWeek: number;
  lastSessionSkipped: boolean;
  latestIncomplete: { id: string; status: string } | null;
  gapFill: GapFillSupportData;
  closeout: CloseoutSupportData;
};

export type GapFillDeficitRow = {
  muscle: string;
  target: number;
  actual: number;
  deficit: number;
};

export type GapFillPolicy = {
  requiredSessionsPerWeek: number;
  maxOptionalGapFillSessionsPerWeek: number;
  maxGeneratedHardSets: number;
  maxGeneratedExercises: number;
};

export type GapFillSupportData = {
  eligible: boolean;
  visible: boolean;
  reason: string | null;
  weekCloseId: string | null;
  anchorWeek: number | null;
  targetWeek: number | null;
  targetPhase: "ACCUMULATION" | "DELOAD" | null;
  resolution: "NO_GAP_FILL_NEEDED" | "GAP_FILL_COMPLETED" | "GAP_FILL_DISMISSED" | "AUTO_DISMISSED" | null;
  workflowState: WeekCloseWorkflowState | null;
  deficitState: WeekCloseDeficitState | null;
  remainingDeficitSets: number;
  targetMuscles: string[];
  deficitSummary: GapFillDeficitRow[];
  alreadyUsedThisWeek: boolean;
  suppressedByStartedNextWeek: boolean;
  linkedWorkout: { id: string; status: string } | null;
  policy: GapFillPolicy;
  detail: string;
  actionLabel: string | null;
  actionMethod: "link" | "post" | null;
  actionHref: string | null;
  canDismiss: boolean;
};

export type CloseoutSupportData = {
  visible: boolean;
  workoutId: string | null;
  workoutRevision?: number | null;
  weekCloseId: string | null;
  status: string | null;
  targetWeek: number | null;
  isIncomplete: boolean;
  isPriorWeek: boolean;
  canCreate: boolean;
};

export type CapabilityFlags = {
  whoopConnected: boolean;
  readinessEnabled: boolean;
};

export async function loadCapabilityFlags(userId: string): Promise<CapabilityFlags> {
  const whoopIntegration = await prisma.userIntegration.findFirst({
    where: { userId, provider: "whoop", isActive: true },
    select: { id: true },
  });

  return {
    whoopConnected: Boolean(whoopIntegration),
    readinessEnabled: process.env.ENABLE_READINESS_CHECKINS !== "0",
  };
}

// Advisory dashboard framing only. This does not replace canonical
// generation/progression decisions.
export function computeAdvisoryDeloadReadiness(
  currentWeek: number,
  durationWeeks: number,
  volumeRows: ProgramVolumeRow[]
): DeloadReadiness {
  const isScheduled = currentWeek >= durationWeeks;

  const saturatedMuscles = volumeRows.filter(
    (row) => row.mav > 0 && row.effectiveSets >= row.mrv * 0.85
  );
  const isVolumeSaturated = saturatedMuscles.length >= 2;

  if (isScheduled && isVolumeSaturated) {
    return {
      shouldDeload: true,
      urgency: "urgent",
      reason: `${saturatedMuscles.map((row) => row.muscle).join(", ")} are at or near MRV in the scheduled deload window. Program timing and current fatigue signals both point toward keeping the next week recovery-focused.`,
    };
  }

  if (isScheduled) {
    return {
      shouldDeload: true,
      urgency: "scheduled",
      reason: "Deload week in the plan. Expect lighter loads, reduced volume, and technique focus.",
    };
  }

  if (isVolumeSaturated) {
    const names = saturatedMuscles.map((row) => row.muscle).join(", ");
    return {
      shouldDeload: true,
      urgency: "recommended",
      reason: `${names} ${saturatedMuscles.length === 1 ? "is" : "are"} near upper volume bounds. Program-level recovery timing suggests a deload week may be worth considering.`,
    };
  }

  return { shouldDeload: false, urgency: "scheduled", reason: "" };
}

export type ActiveBlockPhase = {
  blockType: string | null;
  weekInMeso: number;
  mesoDurationWeeks: number;
  sessionsUntilDeload: number;
  coachingCue: string;
};

type ProgramBlockRecord = { blockType: string; startWeek: number; durationWeeks: number };

function normalizeMesoBlocks(input: {
  mesoStartWeek: number;
  durationWeeks: number;
  blocks: ProgramBlockRecord[];
}): ProgramBlockRecord[] {
  const { mesoStartWeek, durationWeeks, blocks } = input;
  if (durationWeeks <= 0) return [];

  const mesoEndWeek = mesoStartWeek + durationWeeks;
  const weekTypes: Array<string | null> = Array.from({ length: durationWeeks }, () => null);

  for (const block of blocks) {
    const blockStart = Math.max(mesoStartWeek, block.startWeek);
    const rawBlockEnd = block.startWeek + Math.max(0, block.durationWeeks);
    const blockEnd = Math.min(mesoEndWeek, rawBlockEnd);
    if (blockEnd <= blockStart) continue;

    for (let absoluteWeek = blockStart; absoluteWeek < blockEnd; absoluteWeek += 1) {
      const weekIndex = absoluteWeek - mesoStartWeek;
      if (weekTypes[weekIndex] == null) {
        weekTypes[weekIndex] = block.blockType.toLowerCase();
      }
    }
  }

  for (let weekIndex = 0; weekIndex < weekTypes.length; weekIndex += 1) {
    if (weekTypes[weekIndex] != null) continue;
    weekTypes[weekIndex] = weekIndex === weekTypes.length - 1 ? "deload" : "accumulation";
  }

  const normalized: ProgramBlockRecord[] = [];
  let segmentStart = 0;
  while (segmentStart < weekTypes.length) {
    const blockType = weekTypes[segmentStart] ?? "accumulation";
    let segmentEnd = segmentStart + 1;
    while (segmentEnd < weekTypes.length && weekTypes[segmentEnd] === blockType) {
      segmentEnd += 1;
    }
    normalized.push({
      blockType,
      startWeek: mesoStartWeek + segmentStart,
      durationWeeks: segmentEnd - segmentStart,
    });
    segmentStart = segmentEnd;
  }

  return normalized;
}

function resolveBlockTypeForWeek(input: {
  mesoStartWeek: number;
  weekInMeso: number;
  mesoState: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
  blocks: ProgramBlockRecord[];
}): string | null {
  const absoluteWeek = input.mesoStartWeek + input.weekInMeso - 1;
  const block = input.blocks.find(
    (candidate) =>
      absoluteWeek >= candidate.startWeek &&
      absoluteWeek < candidate.startWeek + candidate.durationWeeks
  );
  const normalizedBlockType = block?.blockType?.toLowerCase() ?? null;
  if (normalizedBlockType) {
    return normalizedBlockType;
  }
  if (input.mesoState === "ACTIVE_DELOAD" || input.mesoState === "AWAITING_HANDOFF") {
    return "deload";
  }
  return null;
}

function formatRirTarget(rirTarget: { min: number; max: number } | null | undefined): string | null {
  if (!rirTarget) return null;
  return `${rirTarget.min}-${rirTarget.max} RIR`;
}

function formatTargetStatusDescription(input: {
  effectiveSets: number;
  target: number;
  targetKind: VolumeTargetKind;
  targetRange: VolumeSoftTargetRange | null;
  status: WeeklyMuscleStatus;
  statusLabel?: string;
}): string {
  if (input.targetKind === "soft" && input.targetRange) {
    const currentLabel = input.statusLabel
      ? `${input.statusLabel.charAt(0).toLowerCase()}${input.statusLabel.slice(1)}`
      : "within soft range";
    return `Current: ${currentLabel}. Non-blocking.`;
  }

  const effectiveLabel = formatSetCount(input.effectiveSets);
  const targetLabel = formatSetCount(input.target);

  switch (input.status) {
    case "below_mev":
      return `${effectiveLabel} weighted sets; below the MEV floor. Preferred target: ${targetLabel}.`;
    case "in_range":
    case "near_target":
      return `Productive floor reached; below preferred target (${effectiveLabel} of ${targetLabel} weighted sets).`;
    case "on_target":
      return `Productive zone; preferred target reached (${effectiveLabel} of ${targetLabel} weighted sets).`;
    case "near_mrv":
      return `${effectiveLabel} weighted sets near the cap. Hold extra volume unless recovery is clearly strong.`;
    case "at_mrv":
      return `${effectiveLabel} weighted sets over the cap. Avoid adding more volume this week.`;
  }
}

function getDescriptiveCoachingCueForBlockType(
  blockType: string | null,
  rirTarget?: { min: number; max: number } | null
): string {
  const formattedRir = formatRirTarget(rirTarget);
  if (!blockType) {
    return "Phase context unavailable for current week.";
  }
  switch (blockType) {
    case "accumulation":
      return `Accumulation phase - build volume, work within ${formattedRir ?? "2-3 RIR"}.`;
    case "intensification":
      return `Intensification phase - heavier loads, push to ${formattedRir ?? "0-1 RIR"}.`;
    case "realization":
      return formattedRir
        ? `Peak week - express your strength with ${formattedRir}.`
        : "Peak week - express your strength today.";
    case "deload":
      return "Deload week - keep loads light, focus on technique and recovery.";
    default:
      return `Current phase: ${blockType}.`;
  }
}

export async function loadActiveBlockPhase(userId: string): Promise<ActiveBlockPhase | null> {
  const meso = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: {
      durationWeeks: true,
      accumulationSessionsCompleted: true,
      sessionsPerWeek: true,
      state: true,
      startWeek: true,
      blocks: {
        orderBy: { blockNumber: "asc" },
        select: { blockType: true, startWeek: true, durationWeeks: true },
      },
      macroCycle: { select: { startDate: true } },
    },
  });

  if (!meso) {
    return null;
  }

  const weekInMeso = getCurrentMesoWeek(meso);
  const normalizedBlocks = normalizeMesoBlocks({
    mesoStartWeek: meso.startWeek,
    durationWeeks: meso.durationWeeks,
    blocks: meso.blocks,
  });
  const blockType = resolveBlockTypeForWeek({
    mesoStartWeek: meso.startWeek,
    weekInMeso,
    mesoState: meso.state,
    blocks: normalizedBlocks,
  });
  const phaseProfile = resolvePhaseBlockProfile({
    mesocycleStartWeek: meso.startWeek,
    mesocycleLength: meso.durationWeeks,
    mesocycleState: meso.state,
    blocks: normalizedBlocks,
    weekInMeso,
  });
  const rirTarget = getRirTarget(meso, weekInMeso, phaseProfile);
  const sessionsUntilDeload = Math.max(
    0,
    (meso.durationWeeks - 1) * meso.sessionsPerWeek - meso.accumulationSessionsCompleted
  );

  return {
    blockType,
    weekInMeso,
    mesoDurationWeeks: meso.durationWeeks,
    sessionsUntilDeload,
    coachingCue: getDescriptiveCoachingCueForBlockType(blockType, rirTarget),
  };
}

export { computeMesoWeekStart };

async function loadMesoWeekMuscleVolume(
  userId: string,
  mesocycleId: string,
  weekInMeso: number,
  mesoWeekStart: Date
): Promise<Record<string, WeeklyMuscleVolumeRow>> {
  return loadMesocycleWeekMuscleVolume(prisma, {
    userId,
    mesocycleId,
    targetWeek: weekInMeso,
    weekStart: mesoWeekStart,
    includeBreakdowns: true,
  });
}

function isWeekCloseVisibleOnHome(input: {
  activeMesocycleId: string | null;
  activeWeek: number | null;
  relevantWeekClose:
    | {
        mesocycleId: string;
        targetWeek: number;
      }
    | null
    | undefined;
}): boolean {
  if (!input.relevantWeekClose || !input.activeMesocycleId || input.activeWeek == null) {
    return false;
  }

  return (
    input.relevantWeekClose.mesocycleId === input.activeMesocycleId &&
    input.relevantWeekClose.targetWeek === input.activeWeek
  );
}

export function isCloseoutWeekInScope(input: {
  activeWeek: number | null;
  targetWeek: number | null;
}): boolean {
  if (input.activeWeek == null || input.targetWeek == null) {
    return false;
  }

  return input.targetWeek === input.activeWeek || input.targetWeek === input.activeWeek - 1;
}

type CloseoutWorkoutCandidate = {
  id: string;
  revision?: number;
  status: WorkoutStatus;
  scheduledDate: Date;
  selectionMetadata: unknown;
};

type HomeWeekProgressWorkoutCandidate = {
  id: string;
  status: WorkoutStatus;
  scheduledDate: Date;
  advancesSplit: boolean | null;
  selectionMetadata: unknown;
  selectionMode: string | null;
  sessionIntent: string | null;
  mesocyclePhaseSnapshot: string | null;
};

const HOME_WEEK_WORKOUT_STATUSES: WorkoutStatus[] = [
  "COMPLETED",
  "PARTIAL",
  "SKIPPED",
  "IN_PROGRESS",
  "PLANNED",
];

const HOME_SLOT_WORKOUT_PRIORITY: Record<WorkoutStatus, number> = {
  IN_PROGRESS: 0,
  PARTIAL: 1,
  PLANNED: 2,
  COMPLETED: 3,
  SKIPPED: 4,
};

const CLOSEOUT_STATUS_PRIORITY: Record<WorkoutStatus, number> = {
  IN_PROGRESS: 0,
  PARTIAL: 1,
  PLANNED: 2,
  COMPLETED: 3,
  SKIPPED: 4,
};

export function buildCurrentWeekCloseoutSupport(input: {
  workouts: CloseoutWorkoutCandidate[];
  activeWeek: number | null;
  targetWeek: number | null;
  weekCloseId: string | null;
  weekCloseStatus: "PENDING_OPTIONAL_GAP_FILL" | "RESOLVED" | null;
}): CloseoutSupportData {
  const closeoutRows = [...input.workouts].filter((workout) =>
    isCloseoutSession(workout.selectionMetadata)
  );
  const closeout = closeoutRows
    .filter((workout) => !isDismissedCloseoutSession(workout.selectionMetadata))
    .sort((left, right) => {
      const leftPriority = CLOSEOUT_STATUS_PRIORITY[left.status] ?? 99;
      const rightPriority = CLOSEOUT_STATUS_PRIORITY[right.status] ?? 99;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return left.scheduledDate.getTime() - right.scheduledDate.getTime();
    })[0] ?? null;

  const canCreate =
    !closeout &&
    closeoutRows.length === 0 &&
    input.targetWeek != null &&
    input.weekCloseStatus === "PENDING_OPTIONAL_GAP_FILL" &&
    Boolean(input.weekCloseId);
  const resolvedTargetWeek = closeout || canCreate ? input.targetWeek : null;
  const isPriorWeek =
    input.activeWeek != null &&
    resolvedTargetWeek != null &&
    resolvedTargetWeek < input.activeWeek;

  return {
    visible: Boolean(closeout) || canCreate,
    workoutId: closeout?.id ?? null,
    workoutRevision: closeout?.revision ?? null,
    weekCloseId: input.weekCloseId,
    status: closeout?.status.toLowerCase() ?? null,
    targetWeek: resolvedTargetWeek,
    isIncomplete:
      closeout?.status === "PLANNED" ||
      closeout?.status === "IN_PROGRESS" ||
      closeout?.status === "PARTIAL",
    isPriorWeek,
    canCreate,
  };
}

function countAdvancingSessions(workouts: HomeWeekProgressWorkoutCandidate[]): number {
  return workouts.filter((workout) => {
    const semantics = deriveSessionSemantics({
      advancesSplit: workout.advancesSplit,
      selectionMetadata: workout.selectionMetadata,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      mesocyclePhase: workout.mesocyclePhaseSnapshot,
    });

    return semantics.consumesWeeklyScheduleIntent;
  }).length;
}

function isPerformedWorkoutStatus(status: WorkoutStatus): boolean {
  return (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(status);
}

function resolveHomeNextSlotId(input: {
  nextSession: NextSessionData;
  remainingSlots: ReadonlyArray<{ slotId: string; intent: string }>;
}): string | null {
  if (input.remainingSlots.length === 0) {
    return null;
  }

  if (input.nextSession.isExisting && input.nextSession.slotId) {
    const exact = input.remainingSlots.find((slot) => slot.slotId === input.nextSession.slotId);
    if (exact) {
      return exact.slotId;
    }
  }

  if (input.nextSession.isExisting && input.nextSession.intent) {
    const intentMatch = input.remainingSlots.find(
      (slot) => slot.intent === input.nextSession.intent
    );
    if (intentMatch) {
      return intentMatch.slotId;
    }
  }

  return input.remainingSlots[0]?.slotId ?? null;
}

function buildHomeSlotWorkoutLookup(
  workouts: HomeWeekProgressWorkoutCandidate[]
): Map<string, { id: string; status: WorkoutStatus }> {
  const bySlotId = new Map<string, { id: string; status: WorkoutStatus; priority: number }>();

  for (const workout of workouts) {
    const semantics = deriveSessionSemantics({
      advancesSplit: workout.advancesSplit,
      selectionMetadata: workout.selectionMetadata,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      mesocyclePhase: workout.mesocyclePhaseSnapshot,
    });
    if (semantics.isCloseout || !semantics.consumesWeeklyScheduleIntent) {
      continue;
    }

    const slotId = readSessionSlotSnapshot(workout.selectionMetadata)?.slotId ?? null;
    if (!slotId) {
      continue;
    }

    const priority = HOME_SLOT_WORKOUT_PRIORITY[workout.status] ?? 99;
    const existing = bySlotId.get(slotId);
    if (!existing || priority < existing.priority) {
      bySlotId.set(slotId, {
        id: workout.id,
        status: workout.status,
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

function buildHomeActiveWeekPlan(input: {
  activeWeek: number | null;
  slotSequenceJson?: unknown;
  weeklySchedule: string[];
  workouts: HomeWeekProgressWorkoutCandidate[];
  nextSession: NextSessionData;
  latestIncomplete: { id: string; status: string } | null;
}): HomeActiveWeekPlan | null {
  if (input.activeWeek == null) {
    return null;
  }

  const slotSequence = readRuntimeSlotSequence({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  if (slotSequence.slots.length === 0) {
    return null;
  }

  const performedAdvancingSlotsThisWeek = buildAdvancingPerformedSlots(
    input.workouts.filter((workout) => isPerformedWorkoutStatus(workout.status))
  );
  const remainingSlots = buildRemainingRuntimeSlotsFromPerformed({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
    performedAdvancingSlotsThisWeek,
  });
  const remainingSlotIds = new Set(remainingSlots.map((slot) => slot.slotId));
  const nextSlotId = resolveHomeNextSlotId({
    nextSession: input.nextSession,
    remainingSlots,
  });
  const slotWorkoutLookup = buildHomeSlotWorkoutLookup(input.workouts);
  const existingNextWorkout =
    input.nextSession.workoutId && input.latestIncomplete
      ? {
          id: input.nextSession.workoutId,
          status: input.latestIncomplete.status.toUpperCase() as WorkoutStatus,
        }
      : null;

  return {
    week: input.activeWeek,
    source: slotSequence.source,
    sessions: slotSequence.slots.map((slot) => {
      const isNextSlot = slot.slotId === nextSlotId;
      const linkedWorkout =
        slotWorkoutLookup.get(slot.slotId) ?? (isNextSlot ? existingNextWorkout : null);
      const linkedStatus = linkedWorkout?.status ?? null;
      const isCompletedSlot = !remainingSlotIds.has(slot.slotId);
      const status = (() => {
        if (linkedStatus === "IN_PROGRESS" || linkedStatus === "PARTIAL") {
          return "in_progress" as const;
        }
        if (linkedStatus === "SKIPPED") {
          return "skipped" as const;
        }
        if (isCompletedSlot) {
          return "completed" as const;
        }
        if (isNextSlot) {
          return "next" as const;
        }
        return "upcoming" as const;
      })();
      const statusLabel =
        status === "in_progress"
          ? "In progress"
          : status.charAt(0).toUpperCase() + status.slice(1);
      const href =
        status === "completed" || status === "skipped"
          ? linkedWorkout
            ? `/workout/${linkedWorkout.id}`
            : null
          : status === "in_progress"
            ? linkedWorkout
              ? `/log/${linkedWorkout.id}`
              : null
            : status === "next"
              ? linkedWorkout
                ? `/log/${linkedWorkout.id}`
                : "#generate-workout"
              : null;

      return {
        slotId: slot.slotId,
        label: formatSessionIdentityLabel({
          intent: slot.intent,
          slotId: slot.slotId,
        }),
        status,
        statusLabel,
        href,
        workoutId: linkedWorkout?.id ?? null,
        sequenceIndex: slot.sequenceIndex,
      };
    }),
  };
}

async function loadHomeWeekProgress(input: {
  userId: string;
  activeMesocycle: {
    id: string;
    startWeek: number;
    sessionsPerWeek: number;
    slotSequenceJson?: unknown;
    macroCycle: { startDate: Date };
  } | null;
  activeWeek: number | null;
  weeklySchedule: string[];
  nextSession: NextSessionData;
  latestIncomplete: { id: string; status: string } | null;
}): Promise<{
  activeWeekPlan: HomeActiveWeekPlan | null;
  completedAdvancingSessionsThisWeek: number;
  totalAdvancingSessionsThisWeek: number;
}> {
  if (!input.activeMesocycle || input.activeWeek == null) {
    return {
      activeWeekPlan: null,
      completedAdvancingSessionsThisWeek: 0,
      totalAdvancingSessionsThisWeek: 0,
    };
  }

  const mesoStart = new Date(input.activeMesocycle.macroCycle.startDate);
  mesoStart.setDate(mesoStart.getDate() + input.activeMesocycle.startWeek * 7);
  const weekStart = computeMesoWeekStart(mesoStart, input.activeWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const workouts = await prisma.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.activeMesocycle.id,
      status: { in: HOME_WEEK_WORKOUT_STATUSES },
      sessionIntent: { not: null },
      OR: [
        { mesocycleWeekSnapshot: input.activeWeek },
        {
          mesocycleWeekSnapshot: null,
          scheduledDate: { gte: weekStart, lt: weekEnd },
        },
      ],
    },
    select: {
      id: true,
      revision: true,
      status: true,
      scheduledDate: true,
      advancesSplit: true,
      selectionMetadata: true,
      selectionMode: true,
      sessionIntent: true,
      mesocyclePhaseSnapshot: true,
    },
  });
  const performedWorkouts = workouts.filter((workout) =>
    isPerformedWorkoutStatus(workout.status)
  );
  const activeWeekPlan = buildHomeActiveWeekPlan({
    activeWeek: input.activeWeek,
    slotSequenceJson: input.activeMesocycle.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
    workouts,
    nextSession: input.nextSession,
    latestIncomplete: input.latestIncomplete,
  });

  return {
    activeWeekPlan,
    completedAdvancingSessionsThisWeek: countAdvancingSessions(performedWorkouts),
    totalAdvancingSessionsThisWeek: Math.max(
      1,
      activeWeekPlan?.sessions.length ??
        input.nextSession.slotSequenceLength ??
        input.activeMesocycle.sessionsPerWeek
    ),
  };
}

export async function loadHomeProgramSupport(userId: string): Promise<HomeProgramSupportData> {
  const [nextWorkoutContext, activeMesocycle, constraints] = await Promise.all([
    loadNextWorkoutContext(userId),
    prisma.mesocycle.findFirst({
      where: { macroCycle: { userId }, isActive: true },
      select: {
        id: true,
        startWeek: true,
        durationWeeks: true,
        sessionsPerWeek: true,
        accumulationSessionsCompleted: true,
        deloadSessionsCompleted: true,
        volumeTarget: true,
        state: true,
        slotSequenceJson: true,
        macroCycle: {
          select: {
            startDate: true,
          },
        },
      },
    }),
    prisma.constraints.findUnique({
      where: { userId },
      select: { weeklySchedule: true },
    }),
  ]);
  const activeWeek = activeMesocycle ? getCurrentMesoWeek(activeMesocycle) : null;
  const nextSession: NextSessionData = {
    intent: nextWorkoutContext.intent,
    slotId: nextWorkoutContext.slotId,
    slotSequenceIndex: nextWorkoutContext.slotSequenceIndex,
    slotSequenceLength: nextWorkoutContext.slotSequenceLength,
    slotSource: nextWorkoutContext.slotSource,
    weekInMeso: nextWorkoutContext.weekInMeso,
    sessionInWeek: nextWorkoutContext.sessionInWeek,
    workoutId: nextWorkoutContext.existingWorkoutId,
    isExisting: nextWorkoutContext.isExisting,
  };
  const latestIncomplete = nextWorkoutContext.existingWorkoutId
    ? {
        id: nextWorkoutContext.existingWorkoutId,
        status: nextWorkoutContext.selectedIncompleteStatus ?? "planned",
      }
    : null;

  let lastSessionSkipped = false;
  if (!nextSession.isExisting && nextSession.intent) {
    const intentEnum = nextSession.intent.toUpperCase() as WorkoutSessionIntent;
    const latestForIntent = await prisma.workout.findFirst({
      where: { userId, sessionIntent: intentEnum },
      orderBy: { scheduledDate: "desc" },
      select: { status: true },
    });
    lastSessionSkipped = latestForIntent?.status === "SKIPPED";
  }

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
      activeWeek,
      targetWeek:
        relevantWeekClose?.mesocycleId === activeMesocycle.id
          ? relevantWeekClose.targetWeek
          : null,
    })
      ? relevantWeekClose?.targetWeek ?? null
      : activeWeek;
  const currentWeekCloseoutRows =
    activeMesocycle && closeoutTargetWeek != null
      ? await (() => {
          const mesoStart = new Date(activeMesocycle.macroCycle.startDate);
          mesoStart.setDate(mesoStart.getDate() + activeMesocycle.startWeek * 7);
          const weekStart = computeMesoWeekStart(mesoStart, closeoutTargetWeek);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 7);

          return prisma.workout.findMany({
            where: {
              userId,
              mesocycleId: activeMesocycle.id,
              OR: [
                { mesocycleWeekSnapshot: closeoutTargetWeek },
                {
                  mesocycleWeekSnapshot: null,
                  scheduledDate: { gte: weekStart, lt: weekEnd },
                },
              ],
            },
            orderBy: [{ scheduledDate: "asc" }, { id: "asc" }],
            select: {
              id: true,
              revision: true,
              status: true,
              scheduledDate: true,
              selectionMetadata: true,
            },
          });
        })()
      : [];
  const deficitSnapshot = relevantWeekClose?.deficitSnapshot;
  const weekCloseState = relevantWeekClose?.weekCloseState;
  const policy: GapFillPolicy = {
    requiredSessionsPerWeek: Math.max(
      1,
      deficitSnapshot?.policy.requiredSessionsPerWeek ?? activeMesocycle?.sessionsPerWeek ?? 3
    ),
    maxOptionalGapFillSessionsPerWeek:
      deficitSnapshot?.policy.maxOptionalGapFillSessionsPerWeek ?? 1,
    maxGeneratedHardSets: deficitSnapshot?.policy.maxGeneratedHardSets ?? 12,
    maxGeneratedExercises: deficitSnapshot?.policy.maxGeneratedExercises ?? 4,
  };
  const deficitSummary: GapFillDeficitRow[] =
    (weekCloseState?.remainingMuscles ?? deficitSnapshot?.muscles ?? []).slice(0, 3).map((row) => ({
      muscle: row.muscle,
      target: row.target,
      actual: row.actual,
      deficit: row.deficit,
    }));
  const targetMuscles =
    weekCloseState?.remainingTopTargetMuscles?.filter(Boolean) ??
    deficitSnapshot?.summary.topTargetMuscles?.filter(Boolean) ??
    deficitSummary.map((row) => row.muscle);
  const linkedWorkout = relevantWeekClose?.optionalWorkout
    ? {
        id: relevantWeekClose.optionalWorkout.id,
        status: relevantWeekClose.optionalWorkout.status,
      }
    : null;
  const linkedWorkoutWasSkipped = linkedWorkout?.status === "SKIPPED";
  const isRelevantToActiveHomeWeek = isWeekCloseVisibleOnHome({
    activeMesocycleId: activeMesocycle?.id ?? null,
    activeWeek,
    relevantWeekClose,
  });
  const canGenerateGapFill =
    isRelevantToActiveHomeWeek &&
    relevantWeekClose?.status === "PENDING_OPTIONAL_GAP_FILL" &&
    !linkedWorkoutWasSkipped &&
    targetMuscles.length > 0;
  const linkedWorkoutStatus = linkedWorkout?.status.trim().toUpperCase() ?? null;
  const gapFillActionHref = linkedWorkout
    ? linkedWorkoutStatus === "COMPLETED" || linkedWorkoutStatus === "SKIPPED"
      ? `/workout/${linkedWorkout.id}`
      : `/log/${linkedWorkout.id}`
    : canGenerateGapFill
      ? "/api/workouts/generate-from-intent"
      : null;

  const gapFill: GapFillSupportData = {
    eligible: canGenerateGapFill,
    visible:
      isRelevantToActiveHomeWeek &&
      Boolean(relevantWeekClose?.id && (weekCloseState?.deficitState ?? null) !== "CLOSED"),
    reason:
      !relevantWeekClose
        ? "no_pending_week_close"
        : !isRelevantToActiveHomeWeek
          ? "out_of_scope_for_active_week"
        : (weekCloseState?.deficitState ?? null) === "CLOSED"
          ? null
        : targetMuscles.length === 0
          ? "missing_deficit_snapshot"
          : null,
    weekCloseId: relevantWeekClose?.id ?? null,
    anchorWeek: relevantWeekClose?.targetWeek ?? null,
    targetWeek: relevantWeekClose?.targetWeek ?? null,
    targetPhase: relevantWeekClose?.targetPhase ?? null,
    resolution: relevantWeekClose?.resolution ?? null,
    workflowState: weekCloseState?.workflowState ?? null,
    deficitState: weekCloseState?.deficitState ?? null,
    remainingDeficitSets: weekCloseState?.remainingDeficitSets ?? 0,
    targetMuscles,
    deficitSummary,
    alreadyUsedThisWeek: false,
    suppressedByStartedNextWeek: false,
    linkedWorkout,
    policy,
    detail:
      (weekCloseState?.workflowState ?? null) === "COMPLETED"
        ? "The recommended workflow is complete. Current deficit state may still show remaining work."
        : (weekCloseState?.deficitState ?? null) === "PARTIAL"
          ? "Current week data still shows partial remaining deficits."
          : (weekCloseState?.deficitState ?? null) === "OPEN"
            ? "Targets the remaining deficits from current week data."
            : "Uses current week data to guide the optional session.",
    actionLabel: linkedWorkout
      ? linkedWorkoutStatus === "COMPLETED" || linkedWorkoutStatus === "SKIPPED"
        ? "Review recommended session"
        : "Open recommended session"
      : canGenerateGapFill
        ? "Generate recommended session"
        : null,
    actionMethod: linkedWorkout ? "link" : canGenerateGapFill ? "post" : null,
    actionHref: gapFillActionHref,
    canDismiss: Boolean(
      (weekCloseState?.workflowState ?? null) === "PENDING_OPTIONAL_GAP_FILL" &&
        relevantWeekClose?.id
    ),
  };
  const closeout = buildCurrentWeekCloseoutSupport({
    workouts: currentWeekCloseoutRows,
    activeWeek,
    targetWeek: closeoutTargetWeek ?? null,
    weekCloseId:
      relevantWeekClose?.targetWeek === closeoutTargetWeek ? relevantWeekClose.id : null,
    weekCloseStatus:
      relevantWeekClose?.targetWeek === closeoutTargetWeek ? relevantWeekClose.status : null,
  });
  const weekProgress = await loadHomeWeekProgress({
    userId,
    activeMesocycle,
    activeWeek,
    weeklySchedule: (constraints?.weeklySchedule ?? []).map((intent) =>
      intent.toLowerCase()
    ),
    nextSession,
    latestIncomplete,
  });

  return {
    nextSession,
    activeWeek,
    ...weekProgress,
    lastSessionSkipped,
    latestIncomplete,
    gapFill,
    closeout,
  };
}

function buildProgramVolumeRows(input: {
  mesoRecord: {
    durationWeeks: number;
    sessionsPerWeek: number;
    volumeTarget: string;
    accumulationSessionsCompleted: number;
    id: string;
    blocks?: Array<{
      blockType: string;
      startWeek: number;
      durationWeeks: number;
      volumeTarget: string;
      intensityBias: string;
    }>;
  } | null;
  week: number;
  weekMuscles: Record<string, WeeklyMuscleVolumeRow>;
}): ProgramVolumeRow[] {
  const { mesoRecord, week, weekMuscles } = input;
  return getExposedVolumeLandmarkEntries()
    .map(([muscle, landmarks]) => {
      const data = weekMuscles[muscle] ?? { directSets: 0, indirectSets: 0, effectiveSets: 0 };
      const target = mesoRecord ? getWeeklyVolumeTarget(mesoRecord, muscle, week) : landmarks.mev;
      const targetSemantics = getMuscleTargetSemantics(muscle);
      const displayGroup = getWeeklyMuscleDisplayGroup(targetSemantics.targetKind);
      const dashboardGroup = getWeeklyMuscleDashboardGroup({
        dashboardGroup: targetSemantics.dashboardGroup,
        targetKind: targetSemantics.targetKind,
      });
      const weeklyStatus = getWeeklyMuscleStatus({
        effectiveSets: data.effectiveSets,
        target,
        mev: landmarks.mev,
        mrv: landmarks.mrv,
        targetKind: targetSemantics.targetKind,
        softTargetRange: targetSemantics.softTargetRange,
      });
      const statusLabel = formatWeeklyMuscleStatusLabel(weeklyStatus, {
        targetKind: targetSemantics.targetKind,
      });
      return {
        muscle,
        targetKind: targetSemantics.targetKind,
        targetRange: targetSemantics.softTargetRange,
        displayGroup,
        targetTier: targetSemantics.targetTier,
        warningSeverity: targetSemantics.warningSeverity,
        dashboardGroup,
        effectiveSets: data.effectiveSets,
        directSets: data.directSets,
        indirectSets: data.indirectSets,
        target,
        mev: landmarks.mev,
        mav: landmarks.mav,
        mrv: landmarks.mrv,
        weightedSetsLabel: formatWeightedSetsLabel(data.effectiveSets),
        targetLabel: formatTargetDisplayLabel({
          targetSets: target,
          targetKind: targetSemantics.targetKind,
          targetRange: targetSemantics.softTargetRange,
        }),
        statusLabel,
        statusDescription: formatTargetStatusDescription({
          effectiveSets: data.effectiveSets,
          target,
          targetKind: targetSemantics.targetKind,
          targetRange: targetSemantics.softTargetRange,
          status: weeklyStatus,
          statusLabel,
        }),
        deltaLabel: formatTargetDeltaLabel({
          effectiveSets: data.effectiveSets,
          targetSets: target,
          targetKind: targetSemantics.targetKind,
          targetRange: targetSemantics.softTargetRange,
        }),
        landmarkContext:
          displayGroup === "primary"
            ? buildVolumeLandmarkContext({
                effectiveSets: data.effectiveSets,
                mev: landmarks.mev,
                mav: landmarks.mav,
                mrv: landmarks.mrv,
              })
            : undefined,
        badges: [
          {
            status: weeklyStatus,
            label: statusLabel,
          },
        ],
        opportunityScore: 0,
        opportunityState: "covered" as OpportunityState,
        opportunityRationale:
          "Preferred target is already covered; no need to prioritize more work today.",
        ...(data.contributions && data.contributions.length > 0
          ? {
              breakdown: {
                muscle,
                effectiveSets: data.effectiveSets,
                targetSets: target,
                contributions: data.contributions,
              },
            }
          : {}),
      };
    })
    .filter(
      (row) => {
        if (row.dashboardGroup === "implicit") {
          return row.effectiveSets > 0 || row.directSets > 0 || row.indirectSets > 0;
        }

        return (
          row.mav > 0 &&
          (row.target > 0 || row.effectiveSets > 0 || row.targetKind === "soft")
        );
      }
    )
    .sort((left, right) => {
      const leftRatio = left.target === 0 ? 0 : left.effectiveSets / left.target;
      const rightRatio = right.target === 0 ? 0 : right.effectiveSets / right.target;
      return leftRatio - rightRatio;
    });
}

async function attachOpportunityToVolumeRows(
  userId: string,
  rows: ProgramVolumeRow[]
): Promise<ProgramVolumeRow[]> {
  if (rows.length === 0) {
    return rows;
  }

  const targetByMuscle = Object.fromEntries(rows.map((row) => [row.muscle, row.target]));
  const [recentStimulus, readinessSignal] = await Promise.all([
    loadRecentMuscleStimulus(prisma, {
      userId,
      targetByMuscle,
    }),
    getLatestReadinessSignal(userId),
  ]);

  return rows.map((row) => {
    const recent = recentStimulus[row.muscle] ?? {
      muscle: row.muscle,
      lastStimulatedAt: null,
      hoursSinceStimulus: null,
      recentEffectiveSets: 0,
      recentStimulusRatio: 0,
      sraHours: getDefaultSraHours(row.muscle),
    };
    const opportunity = computeMuscleOpportunity({
      muscle: row.muscle,
      targetEffectiveSets: row.target,
      weeklyEffectiveSets: row.effectiveSets,
      recentStimulus: recent,
      readinessSignal,
    });

    return {
      ...row,
      opportunityScore: opportunity.score,
      opportunityState: opportunity.state,
      opportunityRationale: opportunity.rationale,
    };
  });
}

export async function loadProgramDashboardData(
  userId: string,
  viewWeek?: number
): Promise<ProgramDashboardData> {
  const mesoRecord = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: {
      id: true,
      mesoNumber: true,
      focus: true,
      durationWeeks: true,
      accumulationSessionsCompleted: true,
      deloadSessionsCompleted: true,
      sessionsPerWeek: true,
      volumeTarget: true,
      startWeek: true,
      state: true,
      blocks: {
        orderBy: { blockNumber: "asc" },
        select: {
          blockType: true,
          startWeek: true,
          durationWeeks: true,
          volumeTarget: true,
          intensityBias: true,
        },
      },
      macroCycle: { select: { startDate: true } },
    },
  });

  let currentWeek = 1;
  if (mesoRecord) {
    currentWeek = getCurrentMesoWeek(mesoRecord);
  }

  const effectiveViewWeek = mesoRecord
    ? Math.max(1, Math.min(viewWeek ?? currentWeek, mesoRecord.durationWeeks))
    : 1;

  const normalizedBlocks = mesoRecord
    ? normalizeMesoBlocks({
        mesoStartWeek: mesoRecord.startWeek,
        durationWeeks: mesoRecord.durationWeeks,
        blocks: mesoRecord.blocks,
      })
    : [];

  const currentBlockType = mesoRecord
    ? resolveBlockTypeForWeek({
        mesoStartWeek: mesoRecord.startWeek,
        weekInMeso: currentWeek,
        mesoState: mesoRecord.state,
        blocks: normalizedBlocks,
      })
    : null;
  const viewedBlockType = mesoRecord
    ? resolveBlockTypeForWeek({
        mesoStartWeek: mesoRecord.startWeek,
        weekInMeso: effectiveViewWeek,
        mesoState: mesoRecord.state,
        blocks: normalizedBlocks,
      })
    : null;
  const viewedPhaseProfile = mesoRecord
    ? resolvePhaseBlockProfile({
        mesocycleStartWeek: mesoRecord.startWeek,
        mesocycleLength: mesoRecord.durationWeeks,
        mesocycleState: mesoRecord.state,
        blocks: normalizedBlocks,
        weekInMeso: effectiveViewWeek,
      })
    : null;

  const sessionsUntilDeload = mesoRecord
    ? Math.max(
        0,
        (mesoRecord.durationWeeks - 1) * mesoRecord.sessionsPerWeek - mesoRecord.accumulationSessionsCompleted
      )
    : 0;

  let viewedWeekMuscles: Record<string, WeeklyMuscleVolumeRow> = {};
  let currentWeekMuscles: Record<string, WeeklyMuscleVolumeRow> = {};
  if (mesoRecord) {
    const mesoStart = new Date(mesoRecord.macroCycle.startDate);
    mesoStart.setDate(mesoStart.getDate() + mesoRecord.startWeek * 7);

    viewedWeekMuscles = await loadMesoWeekMuscleVolume(
      userId,
      mesoRecord.id,
      effectiveViewWeek,
      computeMesoWeekStart(mesoStart, effectiveViewWeek)
    );
    currentWeekMuscles =
      effectiveViewWeek === currentWeek
        ? viewedWeekMuscles
        : await loadMesoWeekMuscleVolume(
            userId,
            mesoRecord.id,
            currentWeek,
            computeMesoWeekStart(mesoStart, currentWeek)
          );
  }

  const baseViewedWeekVolume = buildProgramVolumeRows({
    mesoRecord,
    week: effectiveViewWeek,
    weekMuscles: viewedWeekMuscles,
  });
  const baseCurrentWeekVolume = buildProgramVolumeRows({
    mesoRecord,
    week: currentWeek,
    weekMuscles: currentWeekMuscles,
  });
  const [volumeThisWeek, liveCurrentWeekVolume] = await Promise.all([
    attachOpportunityToVolumeRows(userId, baseViewedWeekVolume),
    effectiveViewWeek === currentWeek
      ? Promise.resolve(baseViewedWeekVolume)
      : attachOpportunityToVolumeRows(userId, baseCurrentWeekVolume),
  ]);
  const rirTarget =
    mesoRecord && viewedPhaseProfile
      ? getRirTarget(mesoRecord, effectiveViewWeek, viewedPhaseProfile)
      : null;
  const deloadReadiness = mesoRecord
    ? computeAdvisoryDeloadReadiness(
        currentWeek,
        mesoRecord.durationWeeks,
        liveCurrentWeekVolume
      )
    : null;

  const mesoBlocks: ProgramMesoBlock[] = mesoRecord ? normalizedBlocks.map((block) => ({
    blockType: block.blockType.toLowerCase(),
    startWeek: block.startWeek - mesoRecord.startWeek + 1,
    durationWeeks: block.durationWeeks,
  })) : [];

  return {
    activeMeso: mesoRecord
      ? {
          mesoNumber: mesoRecord.mesoNumber,
          focus: mesoRecord.focus,
          durationWeeks: mesoRecord.durationWeeks,
          completedSessions: mesoRecord.accumulationSessionsCompleted,
          volumeTarget: mesoRecord.volumeTarget.toLowerCase(),
          currentBlockType,
          blocks: mesoBlocks,
        }
      : null,
    currentWeek,
    viewedWeek: effectiveViewWeek,
    viewedBlockType,
    sessionsUntilDeload,
    volumeThisWeek,
    deloadReadiness,
    rirTarget,
    coachingCue: getDescriptiveCoachingCueForBlockType(viewedBlockType, rirTarget),
  };
}

export type CycleAnchorAction = "deload" | "extend_phase" | "reset" | "end_early";

export async function applyCycleAnchor(userId: string, action: CycleAnchorAction): Promise<void> {
  const meso = await prisma.mesocycle.findFirst({
    where: { macroCycle: { userId }, isActive: true },
    select: { id: true, accumulationSessionsCompleted: true, durationWeeks: true },
  });

  if (!meso) {
    throw new Error("No active mesocycle found");
  }

  const constraints = await prisma.constraints.findUnique({
    where: { userId },
    select: { daysPerWeek: true },
  });
  const daysPerWeek = Math.max(1, constraints?.daysPerWeek ?? 3);

  switch (action) {
    case "deload": {
      const deloadThreshold = (meso.durationWeeks - 1) * daysPerWeek;
      const nextAccumulationSessionsCompleted = Math.max(
        meso.accumulationSessionsCompleted,
        deloadThreshold
      );
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: {
          completedSessions: nextAccumulationSessionsCompleted,
          accumulationSessionsCompleted: nextAccumulationSessionsCompleted,
        },
      });
      break;
    }
    case "extend_phase": {
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: { durationWeeks: meso.durationWeeks + 1 },
      });
      break;
    }
    case "reset": {
      await prisma.mesocycle.update({
        where: { id: meso.id },
        data: { completedSessions: 0, accumulationSessionsCompleted: 0, deloadSessionsCompleted: 0 },
      });
      break;
    }
    case "end_early": {
      await finishMesocycleEarly({ userId, mesocycleId: meso.id });
      break;
    }
  }
}
