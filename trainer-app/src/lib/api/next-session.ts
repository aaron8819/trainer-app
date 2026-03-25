import { WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { deriveCurrentMesocycleSession } from "./mesocycle-lifecycle-math";
import { loadPendingMesocycleHandoff } from "./mesocycle-handoff";
import {
  buildRemainingRuntimeSlotsFromPerformed,
  deriveNextRuntimeSlotSession,
  readRuntimeSlotSequence,
} from "./mesocycle-slot-runtime";
import { resolveMesocycleSlotContract } from "./mesocycle-slot-contract";
import { readSessionSlotSnapshot } from "@/lib/evidence/session-decision-receipt";
import type { SessionSlotSnapshot } from "@/lib/evidence/types";

type MesoSessionInput = {
  id?: string;
  durationWeeks: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
  slotSequenceJson?: unknown;
};

export type NextWorkoutSource = "existing_incomplete" | "rotation" | "handoff_pending";

export type NextWorkoutContext = {
  intent: string | null;
  slotId: string | null;
  slotSequenceIndex: number | null;
  slotSequenceLength: number | null;
  slotSource: "mesocycle_slot_sequence" | "legacy_weekly_schedule" | null;
  existingWorkoutId: string | null;
  isExisting: boolean;
  source: NextWorkoutSource;
  weekInMeso: number | null;
  sessionInWeek: number | null;
  derivationTrace: string[];
  selectedIncompleteStatus: string | null;
};

type IncompleteWorkoutCandidate = {
  id: string;
  status: string;
  scheduledDate: Date;
  sessionIntent: string | null;
  selectionMetadata?: unknown;
};

export type PerformedAdvancingWorkoutCandidate = {
  advancesSplit: boolean | null;
  selectionMetadata?: unknown;
  selectionMode: string | null;
  sessionIntent: string | null;
};

export type AdvancingPerformedSlot = {
  slotId?: string | null;
  intent?: string | null;
};

const INCOMPLETE_STATUSES: WorkoutStatus[] = [
  "IN_PROGRESS",
  "PARTIAL",
  "PLANNED",
];
const STATUS_PRIORITY: Record<string, number> = {
  IN_PROGRESS: 0,
  PARTIAL: 1,
  PLANNED: 2,
};

function pickTopIncompleteWorkout(
  workouts: IncompleteWorkoutCandidate[]
): IncompleteWorkoutCandidate | null {
  return [...workouts].sort((left, right) => {
    const leftPriority = STATUS_PRIORITY[left.status] ?? 3;
    const rightPriority = STATUS_PRIORITY[right.status] ?? 3;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.scheduledDate.getTime() - right.scheduledDate.getTime();
  })[0] ?? null;
}

export function buildAdvancingPerformedSlots(
  workouts: PerformedAdvancingWorkoutCandidate[]
): AdvancingPerformedSlot[] {
  return workouts
    .filter((workout) =>
      deriveSessionSemantics({
        advancesSplit: workout.advancesSplit,
        selectionMetadata: workout.selectionMetadata,
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
      }).consumesWeeklyScheduleIntent
    )
    .map((workout) => ({
      slotId: readSessionSlotSnapshot(workout.selectionMetadata)?.slotId ?? null,
      intent: workout.sessionIntent?.toLowerCase() ?? null,
    }));
}

function toSessionSlotSnapshot(input: {
  slotId: string;
  intent: string;
  sequenceIndex: number;
  sequenceLength?: number;
  source: "mesocycle_slot_sequence" | "legacy_weekly_schedule";
}): SessionSlotSnapshot {
  return {
    slotId: input.slotId,
    intent: input.intent,
    sequenceIndex: input.sequenceIndex,
    sequenceLength: input.sequenceLength,
    source: input.source,
  };
}

export function resolveRequestedAdvancingSlotSnapshot(input: {
  nextWorkoutSource: NextWorkoutSource;
  requestedIntent: string;
  explicitSlotId?: string;
  slotSequenceJson?: unknown;
  weeklySchedule: string[];
  performedAdvancingSlotsThisWeek?: AdvancingPerformedSlot[];
}): SessionSlotSnapshot | undefined {
  const requestedIntent = input.requestedIntent.trim().toLowerCase();
  if (!requestedIntent) {
    return undefined;
  }

  const slotSequence = readRuntimeSlotSequence({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  const sequenceLength = slotSequence.slots.length > 0 ? slotSequence.slots.length : undefined;
  const explicitSlotId = input.explicitSlotId?.trim();

  if (explicitSlotId) {
    const explicitMatch = slotSequence.slots.find(
      (slot) => slot.slotId === explicitSlotId && slot.intent === requestedIntent
    );
    return explicitMatch
      ? toSessionSlotSnapshot({
          slotId: explicitMatch.slotId,
          intent: explicitMatch.intent,
          sequenceIndex: explicitMatch.sequenceIndex,
          sequenceLength,
          source: slotSequence.source,
        })
      : undefined;
  }

  if (input.nextWorkoutSource !== "rotation") {
    return undefined;
  }

  const remainingSlots = buildRemainingRuntimeSlotsFromPerformed({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
    performedAdvancingSlotsThisWeek: input.performedAdvancingSlotsThisWeek,
  });
  const matchedSlot = remainingSlots.find((slot) => slot.intent === requestedIntent);

  return matchedSlot
    ? toSessionSlotSnapshot({
        slotId: matchedSlot.slotId,
        intent: matchedSlot.intent,
        sequenceIndex: matchedSlot.sequenceIndex,
        sequenceLength,
        source: slotSequence.source,
      })
    : undefined;
}

export function resolveNextWorkoutContext(input: {
  mesocycle: MesoSessionInput | null;
  weeklySchedule: string[];
  incompleteWorkouts: IncompleteWorkoutCandidate[];
  performedAdvancingIntentsThisWeek?: string[];
  performedAdvancingSlotIdsThisWeek?: string[];
}): NextWorkoutContext {
  const slotContract = resolveMesocycleSlotContract({
    slotSequenceJson: input.mesocycle?.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  const normalizedSchedule = slotContract.slots.map((slot) => slot.intent);
  const topIncomplete = pickTopIncompleteWorkout(input.incompleteWorkouts);
  const trace: string[] = [
    `normalized_schedule_count=${normalizedSchedule.length}`,
    `slot_contract_source=${slotContract.source}`,
    `incomplete_candidates=${input.incompleteWorkouts.length}`,
    `performed_advancing_intents_this_week=${input.performedAdvancingIntentsThisWeek?.length ?? 0}`,
    `performed_advancing_slot_ids_this_week=${input.performedAdvancingSlotIdsThisWeek?.length ?? 0}`,
  ];

  const derived = input.mesocycle
    ? deriveNextRuntimeSlotSession({
        mesocycle: input.mesocycle,
        slotSequenceJson: input.mesocycle.slotSequenceJson,
        weeklySchedule: normalizedSchedule,
        performedAdvancingSlotIdsThisWeek: input.performedAdvancingSlotIdsThisWeek,
        performedAdvancingIntentsThisWeek: input.performedAdvancingIntentsThisWeek,
      })
    : null;
  if (derived) {
    trace.push(
      `derived_rotation intent=${derived.intent ?? "null"} slot=${derived.slotId ?? "null"} week=${derived.week} session=${derived.session}`
    );
  } else {
    trace.push("no_active_mesocycle");
  }

  if (topIncomplete) {
    const incompleteSlot = readSessionSlotSnapshot(topIncomplete.selectionMetadata);
    trace.push(`selected_incomplete id=${topIncomplete.id} status=${topIncomplete.status}`);
    return {
      intent: topIncomplete.sessionIntent?.toLowerCase() ?? null,
      slotId: incompleteSlot?.slotId ?? null,
      slotSequenceIndex: incompleteSlot?.sequenceIndex ?? null,
      slotSequenceLength: incompleteSlot?.sequenceLength ?? null,
      slotSource: incompleteSlot?.source ?? null,
      existingWorkoutId: topIncomplete.id,
      isExisting: true,
      source: "existing_incomplete",
      weekInMeso: null,
      sessionInWeek: null,
      derivationTrace: trace,
      selectedIncompleteStatus: topIncomplete.status.toLowerCase(),
    };
  }

  const fallbackIntent = derived?.intent ?? normalizedSchedule[0] ?? null;
  trace.push(
    derived
      ? `selected_rotation_intent=${fallbackIntent ?? "null"}`
      : `selected_schedule_fallback_intent=${fallbackIntent ?? "null"}`
  );
  return {
    intent: fallbackIntent,
    slotId: derived?.slotId ?? null,
    slotSequenceIndex: derived?.slotSequenceIndex ?? null,
    slotSequenceLength: slotContract.slots.length > 0 ? slotContract.slots.length : null,
    slotSource: derived?.slotSource ?? null,
    existingWorkoutId: null,
    isExisting: false,
    source: "rotation",
    weekInMeso: derived?.week ?? null,
    sessionInWeek: derived?.session ?? null,
    derivationTrace: trace,
    selectedIncompleteStatus: null,
  };
}

export async function loadNextWorkoutContext(
  userId: string
): Promise<NextWorkoutContext> {
  const pendingHandoff = await loadPendingMesocycleHandoff(userId);
  if (pendingHandoff) {
    return {
      intent: null,
      slotId: null,
      slotSequenceIndex: null,
      slotSequenceLength: null,
      slotSource: null,
      existingWorkoutId: null,
      isExisting: false,
      source: "handoff_pending",
      weekInMeso: null,
      sessionInWeek: null,
      derivationTrace: [`pending_handoff mesocycle=${pendingHandoff.mesocycleId}`],
      selectedIncompleteStatus: null,
    };
  }

  const [mesocycle, constraints] = await Promise.all([
    prisma.mesocycle.findFirst({
      where: { macroCycle: { userId }, isActive: true },
      select: {
        id: true,
        durationWeeks: true,
        accumulationSessionsCompleted: true,
        deloadSessionsCompleted: true,
        sessionsPerWeek: true,
        state: true,
        slotSequenceJson: true,
      },
    }),
    prisma.constraints.findUnique({
      where: { userId },
      select: { weeklySchedule: true },
    }),
  ]);
  const rawIncomplete = await prisma.workout.findMany({
    where: {
      userId,
      status: { in: INCOMPLETE_STATUSES },
      OR: [{ mesocycleId: null }, { mesocycle: { isActive: true } }],
    },
    orderBy: { scheduledDate: "asc" },
    take: 20,
    select: {
      id: true,
      sessionIntent: true,
      status: true,
      scheduledDate: true,
      selectionMetadata: true,
    },
  });

  const weeklySchedule = (constraints?.weeklySchedule ?? []).map((intent) => intent as string);
  const currentSession = mesocycle ? deriveCurrentMesocycleSession(mesocycle) : null;
  const rawPerformedAdvancingThisWeek =
    mesocycle && currentSession
      ? await prisma.workout.findMany({
          where: {
            userId,
            mesocycleId: mesocycle.id,
            mesocycleWeekSnapshot: currentSession.week,
            status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
            sessionIntent: { not: null },
          },
          orderBy: [{ mesoSessionSnapshot: "asc" }, { scheduledDate: "asc" }],
          select: {
            advancesSplit: true,
            selectionMetadata: true,
            selectionMode: true,
            sessionIntent: true,
          },
        })
      : [];
  const performedAdvancingSlotsThisWeek = buildAdvancingPerformedSlots(rawPerformedAdvancingThisWeek);
  const runtimeSlotSequence = readRuntimeSlotSequence({
    slotSequenceJson: mesocycle?.slotSequenceJson,
    weeklySchedule,
  });

  return resolveNextWorkoutContext({
    mesocycle,
    weeklySchedule,
    incompleteWorkouts: rawIncomplete.map((workout) => ({
      id: workout.id,
      status: workout.status,
      scheduledDate: workout.scheduledDate,
      sessionIntent: workout.sessionIntent?.toLowerCase() ?? null,
      selectionMetadata: workout.selectionMetadata,
    })),
    performedAdvancingSlotIdsThisWeek: performedAdvancingSlotsThisWeek
      .map((workout) => workout.slotId ?? null)
      .filter(
        (slotId): slotId is string =>
          Boolean(slotId) && runtimeSlotSequence.slots.some((slot) => slot.slotId === slotId)
      ),
    performedAdvancingIntentsThisWeek: performedAdvancingSlotsThisWeek
      .map((workout) => workout.intent ?? null)
      .filter((intent): intent is string => Boolean(intent)),
  });
}

export async function loadRequestedAdvancingSlotSnapshot(input: {
  userId: string;
  requestedIntent: string;
  explicitSlotId?: string;
  nextWorkoutContext?: Pick<NextWorkoutContext, "source">;
}): Promise<SessionSlotSnapshot | undefined> {
  const nextWorkoutContext =
    input.nextWorkoutContext ?? (await loadNextWorkoutContext(input.userId));
  const [mesocycle, constraints] = await Promise.all([
    prisma.mesocycle.findFirst({
      where: { macroCycle: { userId: input.userId }, isActive: true },
      select: {
        id: true,
        durationWeeks: true,
        accumulationSessionsCompleted: true,
        deloadSessionsCompleted: true,
        sessionsPerWeek: true,
        state: true,
        slotSequenceJson: true,
      },
    }),
    prisma.constraints.findUnique({
      where: { userId: input.userId },
      select: { weeklySchedule: true },
    }),
  ]);
  const weeklySchedule = (constraints?.weeklySchedule ?? []).map((intent) => intent as string);
  const currentSession = mesocycle ? deriveCurrentMesocycleSession(mesocycle) : null;
  const rawPerformedAdvancingThisWeek =
    mesocycle && currentSession
      ? await prisma.workout.findMany({
          where: {
            userId: input.userId,
            mesocycleId: mesocycle.id,
            mesocycleWeekSnapshot: currentSession.week,
            status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
            sessionIntent: { not: null },
          },
          orderBy: [{ mesoSessionSnapshot: "asc" }, { scheduledDate: "asc" }],
          select: {
            advancesSplit: true,
            selectionMetadata: true,
            selectionMode: true,
            sessionIntent: true,
          },
        })
      : [];

  return resolveRequestedAdvancingSlotSnapshot({
    nextWorkoutSource: nextWorkoutContext.source,
    requestedIntent: input.requestedIntent,
    explicitSlotId: input.explicitSlotId,
    slotSequenceJson: mesocycle?.slotSequenceJson,
    weeklySchedule,
    performedAdvancingSlotsThisWeek: buildAdvancingPerformedSlots(rawPerformedAdvancingThisWeek),
  });
}
