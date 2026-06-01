import { WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import {
  deriveCurrentMesocycleSession,
  getAccumulationWeeks,
} from "./mesocycle-lifecycle-math";
import { loadPendingMesocycleHandoff } from "./mesocycle-handoff";
import {
  buildRemainingRuntimeSlotsFromPerformed,
  deriveNextRuntimeSlotSession,
  readRuntimeSlotSequence,
} from "./mesocycle-slot-runtime";
import { resolveMesocycleSlotContract } from "./mesocycle-slot-contract";
import {
  readSessionDecisionReceipt,
  readSessionSlotSnapshot,
} from "@/lib/evidence/session-decision-receipt";
import type { SessionSlotSnapshot } from "@/lib/evidence/types";
import { parseSlotPlanSeedJson } from "./slot-plan-seed-parser";

type MesoSessionInput = {
  id?: string;
  durationWeeks: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  state: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD" | "AWAITING_HANDOFF" | "COMPLETED";
  slotSequenceJson?: unknown;
  slotPlanSeedJson?: unknown;
};

export type FinalAccumulationWeekClosePendingBlocker = {
  code: "FINAL_ACCUMULATION_WEEK_CLOSE_PENDING";
  severity: "hard_blocker";
  message: string;
  mesocycleId: string | null;
  weekCloseId: string | null;
  targetWeek: number | null;
};

export const FINAL_ACCUMULATION_WEEK_CLOSE_PENDING_MESSAGE =
  "Final accumulation closeout is pending. Resolve or dismiss the optional gap-fill before generating the deload. Standard accumulation generation is blocked to prevent an unintended extra accumulation session.";

export type NextWorkoutSource =
  | "existing_incomplete"
  | "rotation"
  | "handoff_pending"
  | "final_week_close_pending";

export type IncompleteWorkoutReadinessClassification =
  | "matching_next_planned_workout"
  | "stale_or_mismatched_incomplete_workout"
  | "in_progress_workout";

export type IncompleteWorkoutReadiness = {
  classification: IncompleteWorkoutReadinessClassification;
  safeToTrain: boolean;
  action: "start_logging" | "resume_logging" | "block_or_cleanup";
  reason: string;
};

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
  selectedIncompleteReadiness?: IncompleteWorkoutReadiness | null;
  lifecycleBlocker?: FinalAccumulationWeekClosePendingBlocker | null;
};

type IncompleteWorkoutCandidate = {
  id: string;
  status: string;
  scheduledDate: Date;
  sessionIntent: string | null;
  mesocycleId?: string | null;
  mesocycleWeekSnapshot?: number | null;
  mesoSessionSnapshot?: number | null;
  performedSetLogCount?: number;
  totalSetLogCount?: number;
  plannedExercises?: PlannedIncompleteExercise[];
  selectionMetadata?: unknown;
};

type PlannedIncompleteExercise = {
  exerciseId: string;
  setCount: number;
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

type PendingWeekCloseForNextSession = {
  id: string;
  targetWeek: number;
  status: string;
} | null;

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
  return [...workouts]
    .filter(
      (workout) =>
        !deriveSessionSemantics({
          selectionMetadata: workout.selectionMetadata,
          sessionIntent: workout.sessionIntent,
        }).isCloseout
    )
    .sort((left, right) => {
    const leftPriority = STATUS_PRIORITY[left.status] ?? 3;
    const rightPriority = STATUS_PRIORITY[right.status] ?? 3;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return left.scheduledDate.getTime() - right.scheduledDate.getTime();
    })[0] ?? null;
}

function sameNormalizedIntent(
  left: string | null | undefined,
  right: string | null | undefined
): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function readSeedSlotExercisePlan(input: {
  slotPlanSeedJson: unknown;
  slotId?: string | null;
}): PlannedIncompleteExercise[] | null {
  if (!input.slotId) {
    return null;
  }

  const seed = parseSlotPlanSeedJson(input.slotPlanSeedJson);
  const slot = seed?.slots.find((candidate) => candidate.slotId === input.slotId);
  if (!slot || slot.exercises.length === 0) {
    return null;
  }

  const exercises = slot.exercises.map((exercise) => {
    if (exercise.setCount == null) {
      return null;
    }

    return {
      exerciseId: exercise.exerciseId,
      setCount: exercise.setCount,
    };
  });

  if (exercises.some((exercise) => exercise == null)) {
    return null;
  }

  return exercises as PlannedIncompleteExercise[];
}

function plannedExercisesMatchSeed(input: {
  plannedExercises?: PlannedIncompleteExercise[];
  slotPlanSeedJson: unknown;
  slotId?: string | null;
}): boolean {
  const seedExercises = readSeedSlotExercisePlan({
    slotPlanSeedJson: input.slotPlanSeedJson,
    slotId: input.slotId,
  });
  const plannedExercises = input.plannedExercises ?? [];

  return Boolean(
    seedExercises &&
      seedExercises.length === plannedExercises.length &&
      seedExercises.every(
        (exercise, index) =>
          exercise.exerciseId === plannedExercises[index]?.exerciseId &&
          exercise.setCount === plannedExercises[index]?.setCount
      )
  );
}

function hasContradictingSnapshot(input: {
  workout: IncompleteWorkoutCandidate;
  derived: ReturnType<typeof deriveNextRuntimeSlotSession> | null;
}): boolean {
  if (!input.derived) {
    return false;
  }

  return (
    (input.workout.mesocycleWeekSnapshot != null &&
      input.workout.mesocycleWeekSnapshot !== input.derived.week) ||
    (input.workout.mesoSessionSnapshot != null &&
      input.workout.mesoSessionSnapshot !== input.derived.session)
  );
}

function classifySelectedIncompleteWorkout(input: {
  workout: IncompleteWorkoutCandidate;
  activeMesocycleId?: string | null;
  activeMesocycleSlotPlanSeedJson?: unknown;
  derived: ReturnType<typeof deriveNextRuntimeSlotSession> | null;
}): IncompleteWorkoutReadiness {
  const normalizedStatus = input.workout.status.toUpperCase();
  if (normalizedStatus === "IN_PROGRESS" || normalizedStatus === "PARTIAL") {
    return {
      classification: "in_progress_workout",
      safeToTrain: true,
      action: "resume_logging",
      reason: "Existing workout is already started; resume it instead of generating another workout.",
    };
  }

  const receipt = readSessionDecisionReceipt(input.workout.selectionMetadata);
  const slot = readSessionSlotSnapshot(input.workout.selectionMetadata);
  const derived = input.derived;
  const sameActiveMesocycle =
    Boolean(input.activeMesocycleId) &&
    input.workout.mesocycleId === input.activeMesocycleId &&
    receipt?.sessionProvenance?.mesocycleId === input.activeMesocycleId;
  const sameWeekSession =
    Boolean(derived) &&
    input.workout.mesocycleWeekSnapshot === derived?.week &&
    input.workout.mesoSessionSnapshot === derived?.session;
  const hasWeekSessionSnapshot =
    input.workout.mesocycleWeekSnapshot != null &&
    input.workout.mesoSessionSnapshot != null;
  const sameSlot =
    Boolean(derived?.slotId && slot?.slotId) &&
    slot?.slotId === derived?.slotId &&
    sameNormalizedIntent(slot?.intent, derived?.intent);
  const seedBacked =
    receipt?.sessionProvenance?.compositionSource === "persisted_slot_plan_seed";
  const matchesSeedPlan = plannedExercisesMatchSeed({
    plannedExercises: input.workout.plannedExercises,
    slotPlanSeedJson: input.activeMesocycleSlotPlanSeedJson,
    slotId: slot?.slotId,
  });
  const hasNoLoggedSets =
    (input.workout.performedSetLogCount ?? 0) === 0 &&
    (input.workout.totalSetLogCount ?? 0) === 0;
  const contradictsDerivedSnapshot = hasContradictingSnapshot({
    workout: input.workout,
    derived,
  });
  const matchesNextPlannedWorkout =
    normalizedStatus === "PLANNED" &&
    sameActiveMesocycle &&
    seedBacked &&
    matchesSeedPlan &&
    hasNoLoggedSets &&
    sameSlot &&
    !contradictsDerivedSnapshot &&
    (!hasWeekSessionSnapshot || sameWeekSession);

  if (matchesNextPlannedWorkout) {
    return {
      classification: "matching_next_planned_workout",
      safeToTrain: true,
      action: "start_logging",
      reason:
        "Planned workout matches the next expected seeded slot, exercise order, and set counts; start or resume logging it.",
    };
  }

  return {
    classification: "stale_or_mismatched_incomplete_workout",
    safeToTrain: false,
    action: "block_or_cleanup",
    reason:
      "Incomplete planned workout does not match the next expected seeded slot, seed exercise plan, mesocycle, or clean planned state.",
  };
}

export function buildAdvancingPerformedSlots(
  workouts: PerformedAdvancingWorkoutCandidate[]
): AdvancingPerformedSlot[] {
  return workouts
    .filter((workout) => {
      const semantics = deriveSessionSemantics({
        advancesSplit: workout.advancesSplit,
        selectionMetadata: workout.selectionMetadata,
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
      });

      return !semantics.isCloseout && semantics.consumesWeeklyScheduleIntent;
    })
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

function buildFinalAccumulationWeekClosePendingBlocker(input: {
  mesocycleId: string | null;
  durationWeeks: number | null;
  pendingWeekClose: PendingWeekCloseForNextSession;
}): FinalAccumulationWeekClosePendingBlocker {
  const closeoutLabel = input.pendingWeekClose?.targetWeek
    ? `Week ${input.pendingWeekClose.targetWeek}`
    : "Final accumulation";
  const deloadLabel = input.durationWeeks ? `Week ${input.durationWeeks}` : "the";
  return {
    code: "FINAL_ACCUMULATION_WEEK_CLOSE_PENDING",
    severity: "hard_blocker",
    message: `${closeoutLabel} closeout is pending. Resolve or dismiss the optional gap-fill before generating the ${deloadLabel} deload. Standard accumulation generation is blocked to prevent an unintended extra accumulation session.`,
    mesocycleId: input.mesocycleId,
    weekCloseId: input.pendingWeekClose?.id ?? null,
    targetWeek: input.pendingWeekClose?.targetWeek ?? null,
  };
}

function isFinalAccumulationWeekClosePending(input: {
  mesocycle: MesoSessionInput | null;
  pendingWeekClose?: PendingWeekCloseForNextSession;
}): boolean {
  const mesocycle = input.mesocycle;
  if (!mesocycle || mesocycle.state !== "ACTIVE_ACCUMULATION") {
    return false;
  }

  const accumulationWeeks = getAccumulationWeeks(mesocycle.durationWeeks);
  const accumulationThreshold =
    accumulationWeeks * Math.max(1, mesocycle.sessionsPerWeek);

  return (
    mesocycle.accumulationSessionsCompleted >= accumulationThreshold &&
    input.pendingWeekClose?.status === "PENDING_OPTIONAL_GAP_FILL" &&
    input.pendingWeekClose.targetWeek === accumulationWeeks
  );
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
  pendingWeekClose?: PendingWeekCloseForNextSession;
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

  if (
    isFinalAccumulationWeekClosePending({
      mesocycle: input.mesocycle,
      pendingWeekClose: input.pendingWeekClose,
    })
  ) {
    const blocker = buildFinalAccumulationWeekClosePendingBlocker({
      mesocycleId: input.mesocycle?.id ?? null,
      durationWeeks: input.mesocycle?.durationWeeks ?? null,
      pendingWeekClose: input.pendingWeekClose ?? null,
    });
    trace.push(
      `final_accumulation_week_close_pending week_close=${blocker.weekCloseId ?? "unknown"} target_week=${blocker.targetWeek ?? "unknown"}`
    );
    return {
      intent: null,
      slotId: null,
      slotSequenceIndex: null,
      slotSequenceLength: slotContract.slots.length > 0 ? slotContract.slots.length : null,
      slotSource: null,
      existingWorkoutId: null,
      isExisting: false,
      source: "final_week_close_pending",
      weekInMeso: null,
      sessionInWeek: null,
      derivationTrace: trace,
      selectedIncompleteStatus: null,
      selectedIncompleteReadiness: null,
      lifecycleBlocker: blocker,
    };
  }

  if (topIncomplete) {
    const incompleteSlot = readSessionSlotSnapshot(topIncomplete.selectionMetadata);
    const readiness = classifySelectedIncompleteWorkout({
      workout: topIncomplete,
      activeMesocycleId: input.mesocycle?.id ?? null,
      activeMesocycleSlotPlanSeedJson: input.mesocycle?.slotPlanSeedJson,
      derived,
    });
    trace.push(`selected_incomplete id=${topIncomplete.id} status=${topIncomplete.status}`);
    trace.push(`selected_incomplete_readiness=${readiness.classification}`);
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
      selectedIncompleteReadiness: readiness,
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
    selectedIncompleteReadiness: null,
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
      selectedIncompleteReadiness: null,
      lifecycleBlocker: null,
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
        slotPlanSeedJson: true,
      },
    }),
    prisma.constraints.findUnique({
      where: { userId },
      select: { weeklySchedule: true },
    }),
  ]);
  const weeklySchedule = (constraints?.weeklySchedule ?? []).map((intent) => intent as string);
  const currentSession = mesocycle ? deriveCurrentMesocycleSession(mesocycle) : null;
  const [rawIncomplete, pendingWeekClose, rawPerformedAdvancingThisWeek] =
    await Promise.all([
      prisma.workout.findMany({
        where: {
          userId,
          status: { in: INCOMPLETE_STATUSES },
          OR: [{ mesocycleId: null }, { mesocycle: { isActive: true } }],
        },
        orderBy: { scheduledDate: "asc" },
        take: 20,
        select: {
          id: true,
          mesocycleId: true,
          mesocycleWeekSnapshot: true,
          mesoSessionSnapshot: true,
          sessionIntent: true,
          status: true,
          scheduledDate: true,
          selectionMetadata: true,
          exercises: {
            orderBy: { orderIndex: "asc" },
            select: {
              exerciseId: true,
              sets: {
                select: {
                  logs: {
                    select: {
                      wasSkipped: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      mesocycle
        ? prisma.mesocycleWeekClose.findFirst({
            where: {
              mesocycleId: mesocycle.id,
              status: "PENDING_OPTIONAL_GAP_FILL",
              targetPhase: "ACCUMULATION",
            },
            orderBy: { targetWeek: "desc" },
            select: {
              id: true,
              targetWeek: true,
              status: true,
            },
          })
        : Promise.resolve(null),
      mesocycle && currentSession
        ? prisma.workout.findMany({
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
        : Promise.resolve([]),
    ]);
  const performedAdvancingSlotsThisWeek = buildAdvancingPerformedSlots(rawPerformedAdvancingThisWeek);
  const runtimeSlotSequence = readRuntimeSlotSequence({
    slotSequenceJson: mesocycle?.slotSequenceJson,
    weeklySchedule,
  });

  return resolveNextWorkoutContext({
    mesocycle,
    weeklySchedule,
    incompleteWorkouts: rawIncomplete.map((workout) => {
      const exercises = workout.exercises ?? [];
      const setLogs = exercises.flatMap((exercise) =>
        exercise.sets.flatMap((set) => set.logs)
      );

      return {
        id: workout.id,
        status: workout.status,
        scheduledDate: workout.scheduledDate,
        sessionIntent: workout.sessionIntent?.toLowerCase() ?? null,
        mesocycleId: workout.mesocycleId,
        mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
        mesoSessionSnapshot: workout.mesoSessionSnapshot,
        performedSetLogCount: setLogs.filter((log) => !log.wasSkipped).length,
        totalSetLogCount: setLogs.length,
        plannedExercises: exercises.map((exercise) => ({
          exerciseId: exercise.exerciseId,
          setCount: exercise.sets.length,
        })),
        selectionMetadata: workout.selectionMetadata,
      };
    }),
    performedAdvancingSlotIdsThisWeek: performedAdvancingSlotsThisWeek
      .map((workout) => workout.slotId ?? null)
      .filter(
        (slotId): slotId is string =>
          Boolean(slotId) && runtimeSlotSequence.slots.some((slot) => slot.slotId === slotId)
      ),
    performedAdvancingIntentsThisWeek: performedAdvancingSlotsThisWeek
      .map((workout) => workout.intent ?? null)
      .filter((intent): intent is string => Boolean(intent)),
    pendingWeekClose,
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
        slotPlanSeedJson: true,
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
