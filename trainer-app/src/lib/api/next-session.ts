import { WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import {
  deriveCurrentMesocycleSession,
  getAccumulationWeeks,
} from "./mesocycle-lifecycle-math";
import { resolveActivePlanContext } from "./active-plan-context";
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
import {
  parseAcceptedSeedPayload,
  parseSlotPlanSeedJson,
  resolveAcceptedSeedPayloadForWeek,
} from "./slot-plan-seed-parser";
import { normalizeAcceptedSeedPayload } from "./mesocycle-seed-revision";
import {
  resolveV4ScheduleAuthority,
  resolveV4ScheduledSlots,
  type V4ScheduleAuthority,
} from "./v4-scheduled-slot-resolution";

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

export type V4ScheduleResolutionBlocker = {
  code: "V4_SCHEDULE_RESOLUTION_BLOCKED";
  severity: "hard_blocker";
  message: string;
  mesocycleId: string | null;
  reason: string;
};

export const FINAL_ACCUMULATION_WEEK_CLOSE_PENDING_MESSAGE =
  "Final accumulation closeout is pending. Resolve or dismiss the optional gap-fill before generating the deload. Standard accumulation generation is blocked to prevent an unintended extra accumulation session.";

export type NextWorkoutSource =
  | "existing_incomplete"
  | "rotation"
  | "handoff_pending"
  | "final_week_close_pending"
  | "schedule_resolution_blocked"
  | "active_plan_unavailable";

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
  activeMesocycleId?: string | null;
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
  lifecycleBlocker?:
    | FinalAccumulationWeekClosePendingBlocker
    | V4ScheduleResolutionBlocker
    | null;
  eligibleSlotSnapshots?: SessionSlotSnapshot[];
};

type IncompleteWorkoutCandidate = {
  id: string;
  status: string;
  scheduledDate: Date;
  sessionIntent: string | null;
  mesocycleId?: string | null;
  mesocycleWeekSnapshot?: number | null;
  mesoSessionSnapshot?: number | null;
  seedRevisionId?: string | null;
  seedRevisionNumber?: number | null;
  seedPayloadHash?: string | null;
  seedRevision?: {
    id: string;
    mesocycleId: string;
    revision: number;
    seedPayload: unknown;
    payloadHash: string | null;
    hashAlgorithm: string | null;
    provenanceStatus: string;
  } | null;
  performedSetLogCount?: number;
  totalSetLogCount?: number;
  plannedExercises?: PlannedIncompleteExercise[];
  selectionMetadata?: unknown;
};

type PlannedIncompleteExercise = {
  exerciseId: string;
  setCount: number;
};

export type MaterializedSessionIdentity = {
  weekInMeso: number;
  sessionInWeek: number;
  slotId: string;
  sessionIntent: string;
  slotSequenceIndex: number;
  slotSequenceLength: number | null;
  slotSource: "mesocycle_slot_sequence" | "legacy_weekly_schedule";
  provenance: "exact" | "legacy_derived";
};

export type MaterializedSessionIdentityResolution =
  | { status: "available"; identity: MaterializedSessionIdentity }
  | { status: "unavailable"; reason: string };

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

function unavailableMaterializedIdentity(
  reason: string
): MaterializedSessionIdentityResolution {
  return { status: "unavailable", reason };
}

function isPositiveInteger(value: number | null | undefined): value is number {
  return Number.isInteger(value) && (value ?? 0) > 0;
}

export function resolveMaterializedSessionIdentity(input: {
  workout: IncompleteWorkoutCandidate;
  mesocycle: MesoSessionInput | null;
  weeklySchedule: string[];
}): MaterializedSessionIdentityResolution {
  const { workout, mesocycle } = input;
  if (!mesocycle?.id || workout.mesocycleId !== mesocycle.id) {
    return unavailableMaterializedIdentity("workout_mesocycle_mismatch");
  }

  const receipt = readSessionDecisionReceipt(workout.selectionMetadata);
  const receiptMesocycleId = receipt?.sessionProvenance?.mesocycleId;
  if (receiptMesocycleId != null && receiptMesocycleId !== mesocycle.id) {
    return unavailableMaterializedIdentity("receipt_mesocycle_mismatch");
  }

  const receiptWeek = receipt?.cycleContext.weekInMeso;
  if (
    workout.mesocycleWeekSnapshot != null &&
    receiptWeek != null &&
    workout.mesocycleWeekSnapshot !== receiptWeek
  ) {
    return unavailableMaterializedIdentity("week_snapshot_receipt_mismatch");
  }
  const weekInMeso = workout.mesocycleWeekSnapshot ?? receiptWeek;
  if (
    !isPositiveInteger(weekInMeso) ||
    weekInMeso > mesocycle.durationWeeks ||
    (receipt?.cycleContext.mesocycleLength != null &&
      receipt.cycleContext.mesocycleLength !== mesocycle.durationWeeks)
  ) {
    return unavailableMaterializedIdentity("week_identity_invalid");
  }

  const slotContract = resolveMesocycleSlotContract({
    slotSequenceJson: mesocycle.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  const receiptSlot = receipt?.sessionSlot;
  const receiptSession = receiptSlot ? receiptSlot.sequenceIndex + 1 : null;
  if (
    workout.mesoSessionSnapshot != null &&
    receiptSession != null &&
    workout.mesoSessionSnapshot !== receiptSession
  ) {
    return unavailableMaterializedIdentity("session_snapshot_receipt_mismatch");
  }
  const sessionInWeek = workout.mesoSessionSnapshot ?? receiptSession;
  if (
    !isPositiveInteger(sessionInWeek) ||
    sessionInWeek > mesocycle.sessionsPerWeek ||
    sessionInWeek > slotContract.slots.length
  ) {
    return unavailableMaterializedIdentity("session_identity_invalid");
  }

  const contractSlot = slotContract.slots[sessionInWeek - 1];
  if (!contractSlot) {
    return unavailableMaterializedIdentity("slot_identity_unavailable");
  }
  if (
    receiptSlot &&
    (receiptSlot.slotId !== contractSlot.slotId ||
      receiptSlot.sequenceIndex !== contractSlot.sequenceIndex ||
      (receiptSlot.sequenceLength != null &&
        receiptSlot.sequenceLength !== slotContract.slots.length) ||
      !sameNormalizedIntent(receiptSlot.intent, contractSlot.intent))
  ) {
    return unavailableMaterializedIdentity("receipt_slot_contract_mismatch");
  }

  const sessionIntent = workout.sessionIntent?.trim().toLowerCase() ?? null;
  const resolvedSlot = receiptSlot ?? contractSlot;
  if (!sessionIntent || !sameNormalizedIntent(sessionIntent, resolvedSlot.intent)) {
    return unavailableMaterializedIdentity("session_intent_slot_mismatch");
  }

  const receiptSeed = receipt?.sessionProvenance?.seedProvenance;
  const hasAnyWorkoutSeedEvidence = Boolean(
    workout.seedRevisionId ||
      workout.seedRevisionNumber != null ||
      workout.seedPayloadHash
  );
  const hasCompleteWorkoutSeedEvidence = Boolean(
    workout.seedRevisionId &&
      workout.seedRevisionNumber != null &&
      workout.seedPayloadHash
  );
  if (hasAnyWorkoutSeedEvidence !== hasCompleteWorkoutSeedEvidence) {
    return unavailableMaterializedIdentity("workout_seed_provenance_incomplete");
  }

  const usesAcceptedSeed =
    receipt?.sessionProvenance?.compositionSource === "persisted_slot_plan_seed" ||
    receipt?.sessionProvenance?.compositionSource === "deload_seed_replay";
  let exactSeedEvidence = false;
  if (hasCompleteWorkoutSeedEvidence || receiptSeed) {
    const revision = workout.seedRevision;
    if (
      !hasCompleteWorkoutSeedEvidence ||
      !receiptSeed ||
      !revision ||
      revision.id !== workout.seedRevisionId ||
      revision.mesocycleId !== mesocycle.id ||
      revision.revision !== workout.seedRevisionNumber ||
      revision.payloadHash !== workout.seedPayloadHash ||
      revision.hashAlgorithm !== "sha256" ||
      revision.provenanceStatus !== "exact" ||
      receiptSeed.revisionId !== workout.seedRevisionId ||
      receiptSeed.revision !== workout.seedRevisionNumber ||
      receiptSeed.hash !== workout.seedPayloadHash
    ) {
      return unavailableMaterializedIdentity("seed_provenance_mismatch");
    }
    let acceptedSeed: ReturnType<typeof parseAcceptedSeedPayload>;
    try {
      const normalizedSeed = normalizeAcceptedSeedPayload(revision.seedPayload);
      if (normalizedSeed.hash !== workout.seedPayloadHash) {
        return unavailableMaterializedIdentity("seed_payload_hash_mismatch");
      }
      acceptedSeed = parseAcceptedSeedPayload(revision.seedPayload);
    } catch {
      return unavailableMaterializedIdentity("seed_payload_invalid");
    }
    if (!acceptedSeed.slots.some((slot) => slot.slotId === resolvedSlot.slotId)) {
      return unavailableMaterializedIdentity("seed_slot_missing");
    }
    exactSeedEvidence = true;
  } else if (usesAcceptedSeed) {
    const legacySeed = parseSlotPlanSeedJson(mesocycle.slotPlanSeedJson);
    if (!legacySeed?.slots.some((slot) => slot.slotId === resolvedSlot.slotId)) {
      return unavailableMaterializedIdentity("legacy_seed_slot_missing");
    }
  }

  const exactSchedulingEvidence = Boolean(
    workout.mesocycleWeekSnapshot != null &&
      workout.mesoSessionSnapshot != null &&
      receipt &&
      receiptMesocycleId === mesocycle.id &&
      receiptSlot
  );
  if (usesAcceptedSeed && !exactSeedEvidence && hasAnyWorkoutSeedEvidence) {
    return unavailableMaterializedIdentity("exact_seed_evidence_unavailable");
  }

  return {
    status: "available",
    identity: {
      weekInMeso,
      sessionInWeek,
      slotId: resolvedSlot.slotId,
      sessionIntent,
      slotSequenceIndex: resolvedSlot.sequenceIndex,
      slotSequenceLength:
        receiptSlot?.sequenceLength ??
        (slotContract.slots.length > 0 ? slotContract.slots.length : null),
      slotSource: receiptSlot?.source ?? slotContract.source,
      provenance:
        exactSchedulingEvidence && (!usesAcceptedSeed || exactSeedEvidence)
          ? "exact"
          : "legacy_derived",
    },
  };
}

function readSeedSlotExercisePlan(input: {
  slotPlanSeedJson: unknown;
  slotId?: string | null;
  week?: number | null;
}): PlannedIncompleteExercise[] | null {
  if (!input.slotId) {
    return null;
  }

  let seed;
  try {
    seed = input.week != null &&
      input.slotPlanSeedJson != null &&
      typeof input.slotPlanSeedJson === "object" &&
      !Array.isArray(input.slotPlanSeedJson) &&
      (input.slotPlanSeedJson as { version?: unknown }).version === 4
      ? resolveAcceptedSeedPayloadForWeek(input.slotPlanSeedJson, input.week)
      : parseSlotPlanSeedJson(input.slotPlanSeedJson);
  } catch {
    return null;
  }
  const slot = seed?.slots.find((candidate) => candidate.slotId === input.slotId);
  if (!slot || slot.exercises.length === 0) {
    return null;
  }

  const exercises = slot.exercises.map((exercise) => {
    if (exercise.setCount == null) {
      return null;
    }

    return {
      activeMesocycleId: null,
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
  week?: number | null;
}): boolean {
  const seedExercises = readSeedSlotExercisePlan({
    slotPlanSeedJson: input.slotPlanSeedJson,
    slotId: input.slotId,
    week: input.week,
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
    week: input.workout.mesocycleWeekSnapshot ?? derived?.week,
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
  const eligibleSlots = listEligibleAdvancingSlotSnapshots(input);
  const requestedIntent = input.requestedIntent.trim().toLowerCase();
  if (!requestedIntent) {
    return undefined;
  }

  const explicitSlotId = input.explicitSlotId?.trim();

  if (explicitSlotId) {
    return eligibleSlots.find(
      (slot) => slot.slotId === explicitSlotId && slot.intent === requestedIntent
    );
  }

  return eligibleSlots.find((slot) => slot.intent === requestedIntent);
}

export function listEligibleAdvancingSlotSnapshots(input: {
  nextWorkoutSource: NextWorkoutSource;
  slotSequenceJson?: unknown;
  weeklySchedule: string[];
  performedAdvancingSlotsThisWeek?: AdvancingPerformedSlot[];
}): SessionSlotSnapshot[] {
  if (input.nextWorkoutSource !== "rotation") {
    return [];
  }

  const slotSequence = readRuntimeSlotSequence({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
  });
  const sequenceLength = slotSequence.slots.length > 0 ? slotSequence.slots.length : undefined;
  const remainingSlots = buildRemainingRuntimeSlotsFromPerformed({
    slotSequenceJson: input.slotSequenceJson,
    weeklySchedule: input.weeklySchedule,
    performedAdvancingSlotsThisWeek: input.performedAdvancingSlotsThisWeek,
  });

  return remainingSlots.map((slot) =>
    toSessionSlotSnapshot({
      slotId: slot.slotId,
      intent: slot.intent,
      sequenceIndex: slot.sequenceIndex,
      sequenceLength,
      source: slotSequence.source,
    })
  );
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
    const materializedIdentity = resolveMaterializedSessionIdentity({
      workout: topIncomplete,
      mesocycle: input.mesocycle,
      weeklySchedule: normalizedSchedule,
    });
    const receiptSlot = readSessionSlotSnapshot(topIncomplete.selectionMetadata);
    const readiness = classifySelectedIncompleteWorkout({
      workout: topIncomplete,
      activeMesocycleId: input.mesocycle?.id ?? null,
      activeMesocycleSlotPlanSeedJson: input.mesocycle?.slotPlanSeedJson,
      derived,
    });
    trace.push(`selected_incomplete id=${topIncomplete.id} status=${topIncomplete.status}`);
    trace.push(`selected_incomplete_readiness=${readiness.classification}`);
    trace.push(
      materializedIdentity.status === "available"
        ? `materialized_identity=${materializedIdentity.identity.provenance}`
        : `materialized_identity_unavailable=${materializedIdentity.reason}`
    );
    return {
      intent:
        materializedIdentity.status === "available"
          ? materializedIdentity.identity.sessionIntent
          : topIncomplete.sessionIntent?.toLowerCase() ?? null,
      slotId:
        materializedIdentity.status === "available"
          ? materializedIdentity.identity.slotId
          : receiptSlot?.slotId ?? null,
      slotSequenceIndex:
        materializedIdentity.status === "available"
          ? materializedIdentity.identity.slotSequenceIndex
          : receiptSlot?.sequenceIndex ?? null,
      slotSequenceLength:
        materializedIdentity.status === "available"
          ? materializedIdentity.identity.slotSequenceLength
          : receiptSlot?.sequenceLength ?? null,
      slotSource:
        materializedIdentity.status === "available"
          ? materializedIdentity.identity.slotSource
          : receiptSlot?.source ?? null,
      existingWorkoutId: topIncomplete.id,
      isExisting: true,
      source: "existing_incomplete",
      weekInMeso:
        materializedIdentity.status === "available"
          ? materializedIdentity.identity.weekInMeso
          : null,
      sessionInWeek:
        materializedIdentity.status === "available"
          ? materializedIdentity.identity.sessionInWeek
          : null,
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

function buildV4ScheduleResolutionBlocker(input: {
  mesocycleId: string | null;
  reason: string;
}): V4ScheduleResolutionBlocker {
  return {
    code: "V4_SCHEDULE_RESOLUTION_BLOCKED",
    severity: "hard_blocker",
    message:
      "Scheduled workout identity is incomplete or ambiguous. Refresh before continuing.",
    mesocycleId: input.mesocycleId,
    reason: input.reason,
  };
}

function blockedV4NextWorkoutContext(input: {
  mesocycleId: string | null;
  reason: string;
}): NextWorkoutContext {
  const blocker = buildV4ScheduleResolutionBlocker(input);
  return {
    activeMesocycleId: input.mesocycleId,
    intent: null,
    slotId: null,
    slotSequenceIndex: null,
    slotSequenceLength: null,
    slotSource: null,
    existingWorkoutId: null,
    isExisting: false,
    source: "schedule_resolution_blocked",
    weekInMeso: null,
    sessionInWeek: null,
    derivationTrace: [`v4_schedule_resolution_blocked reason=${input.reason}`],
    selectedIncompleteStatus: null,
    selectedIncompleteReadiness: null,
    lifecycleBlocker: blocker,
    eligibleSlotSnapshots: [],
  };
}

export function resolveV4NextWorkoutContext(input: {
  authority: V4ScheduleAuthority;
  workouts: V4ScheduleWorkoutCandidate[];
}): NextWorkoutContext {
  const resolution = resolveV4ScheduledSlots({
    authority: input.authority,
    workouts: input.workouts,
  });
  if (resolution.status === "blocked") {
    return blockedV4NextWorkoutContext({
      mesocycleId: input.authority.mesocycleId,
      reason: resolution.reason,
    });
  }
  const next = resolution.nextUnresolvedSlot;
  if (!next) {
    return blockedV4NextWorkoutContext({
      mesocycleId: input.authority.mesocycleId,
      reason: "resolved_schedule_transition_pending",
    });
  }
  const claim = resolution.claims.find(
    (candidate) =>
      candidate.requiredSlot.weekInMeso === next.weekInMeso &&
      candidate.requiredSlot.slotId === next.slotId,
  );
  const existing = claim
    ? input.workouts.find((workout) => workout.id === claim.workoutId) ?? null
    : null;
  const selectedIncompleteReadiness: IncompleteWorkoutReadiness | null = existing
    ? existing.status === WorkoutStatus.IN_PROGRESS ||
      existing.status === WorkoutStatus.PARTIAL
      ? {
          classification: "in_progress_workout",
          safeToTrain: true,
          action: "resume_logging",
          reason: "Resume the exact unresolved scheduled workout.",
        }
      : {
          classification: "matching_next_planned_workout",
          safeToTrain: true,
          action: "start_logging",
          reason: "This workout owns the next unresolved scheduled slot.",
        }
    : null;
  const eligibleSlotSnapshots = resolution.unresolvedSlotsInNextWeek.map(
    (slot) => ({
      slotId: slot.slotId,
      intent: slot.intent,
      sequenceIndex: slot.sequenceIndex,
      sequenceLength: slot.sequenceLength,
      source: "mesocycle_slot_sequence" as const,
    }),
  );
  return {
    activeMesocycleId: input.authority.mesocycleId,
    intent: next.intent,
    slotId: next.slotId,
    slotSequenceIndex: next.sequenceIndex,
    slotSequenceLength: next.sequenceLength,
    slotSource: "mesocycle_slot_sequence",
    existingWorkoutId: existing?.id ?? null,
    isExisting: Boolean(existing),
    source: existing ? "existing_incomplete" : "rotation",
    weekInMeso: next.weekInMeso,
    sessionInWeek: next.sequenceIndex + 1,
    derivationTrace: [
      `v4_exact_resolution resolved=${resolution.resolvedSlotCount}/${input.authority.requiredSlots.length}`,
      `next_slot week=${next.weekInMeso} slot=${next.slotId}`,
    ],
    selectedIncompleteStatus:
      typeof existing?.status === "string"
        ? existing.status.toLowerCase()
        : null,
    selectedIncompleteReadiness,
    lifecycleBlocker: null,
    eligibleSlotSnapshots,
  };
}

export type V4ScheduleWorkoutCandidate = {
  id: string;
  status: unknown;
  mesocycleId: string | null;
  mesocycleWeekSnapshot: number | null;
  mesoSessionSnapshot: number | null;
  advancesSplit: boolean | null;
  sessionIntent: string | null;
  selectionMetadata: unknown;
  seedRevisionId: string | null;
  seedRevisionNumber: number | null;
  seedPayloadHash: string | null;
};

export async function loadNextWorkoutContext(
  userId: string
): Promise<NextWorkoutContext> {
  const activePlanContext = await resolveActivePlanContext(userId);
  if (activePlanContext.status === "HANDOFF_PENDING") {
    return {
      activeMesocycleId: null,
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
      derivationTrace: [`pending_handoff mesocycle=${activePlanContext.handoff.id}`],
      selectedIncompleteStatus: null,
      selectedIncompleteReadiness: null,
      lifecycleBlocker: null,
    };
  }
  if (activePlanContext.status !== "READY") {
    return {
      activeMesocycleId: null,
      intent: null,
      slotId: null,
      slotSequenceIndex: null,
      slotSequenceLength: null,
      slotSource: null,
      existingWorkoutId: null,
      isExisting: false,
      source: "active_plan_unavailable",
      weekInMeso: null,
      sessionInWeek: null,
      derivationTrace: [`active_plan_context status=${activePlanContext.status}`],
      selectedIncompleteStatus: null,
      selectedIncompleteReadiness: null,
      lifecycleBlocker: null,
    };
  }

  const mesocycle = activePlanContext.activeMesocycle;
  const constraints = await prisma.constraints.findUnique({
    where: { userId },
    select: { weeklySchedule: true },
  });
  if (mesocycle?.currentSeedRevision?.seedPayload) {
    parseAcceptedSeedPayload(mesocycle.currentSeedRevision.seedPayload);
    mesocycle.slotPlanSeedJson = mesocycle.currentSeedRevision.seedPayload;
  }
  const v4AuthorityResolution = mesocycle
    ? resolveV4ScheduleAuthority(mesocycle)
    : { status: "not_v4" as const };
  if (v4AuthorityResolution.status === "blocked") {
    return blockedV4NextWorkoutContext({
      mesocycleId: mesocycle?.id ?? null,
      reason: v4AuthorityResolution.reason,
    });
  }
  const weeklySchedule = (constraints?.weeklySchedule ?? []).map((intent) => intent as string);
  const currentSession = mesocycle ? deriveCurrentMesocycleSession(mesocycle) : null;
  const [
    rawIncomplete,
    pendingWeekClose,
    rawPerformedAdvancingThisWeek,
    rawV4ScheduleWorkouts,
  ] =
    await Promise.all([
      prisma.workout.findMany({
        where: {
          userId,
          status: { in: INCOMPLETE_STATUSES },
          OR: [
            { mesocycleId: null },
            ...(mesocycle ? [{ mesocycleId: mesocycle.id }] : []),
          ],
        },
        orderBy: { scheduledDate: "asc" },
        take: 20,
        select: {
          id: true,
          mesocycleId: true,
          mesocycleWeekSnapshot: true,
          mesoSessionSnapshot: true,
          seedRevisionId: true,
          seedRevisionNumber: true,
          seedPayloadHash: true,
          seedRevision: {
            select: {
              id: true,
              mesocycleId: true,
              revision: true,
              seedPayload: true,
              payloadHash: true,
              hashAlgorithm: true,
              provenanceStatus: true,
            },
          },
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
      v4AuthorityResolution.status === "available"
        ? prisma.workout.findMany({
            where: {
              userId,
              mesocycleId: v4AuthorityResolution.authority.mesocycleId,
            },
            orderBy: [
              { mesocycleWeekSnapshot: "asc" },
              { mesoSessionSnapshot: "asc" },
              { id: "asc" },
            ],
            select: {
              id: true,
              status: true,
              mesocycleId: true,
              mesocycleWeekSnapshot: true,
              mesoSessionSnapshot: true,
              advancesSplit: true,
              sessionIntent: true,
              selectionMetadata: true,
              seedRevisionId: true,
              seedRevisionNumber: true,
              seedPayloadHash: true,
            },
          })
        : Promise.resolve([]),
    ]);
  if (v4AuthorityResolution.status === "available") {
    return resolveV4NextWorkoutContext({
      authority: v4AuthorityResolution.authority,
      workouts: rawV4ScheduleWorkouts,
    });
  }
  const performedAdvancingSlotsThisWeek = buildAdvancingPerformedSlots(rawPerformedAdvancingThisWeek);
  const runtimeSlotSequence = readRuntimeSlotSequence({
    slotSequenceJson: mesocycle?.slotSequenceJson,
    weeklySchedule,
  });

  const resolved = resolveNextWorkoutContext({
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
        seedRevisionId: workout.seedRevisionId,
        seedRevisionNumber: workout.seedRevisionNumber,
        seedPayloadHash: workout.seedPayloadHash,
        seedRevision: workout.seedRevision,
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
  return {
    ...resolved,
    activeMesocycleId: mesocycle?.id ?? null,
  };
}

export async function loadRequestedAdvancingSlotSnapshot(input: {
  userId: string;
  requestedIntent: string;
  explicitSlotId?: string;
  nextWorkoutContext?: Pick<
    NextWorkoutContext,
    "source" | "eligibleSlotSnapshots"
  >;
}): Promise<SessionSlotSnapshot | undefined> {
  const nextWorkoutContext =
    input.nextWorkoutContext ?? (await loadNextWorkoutContext(input.userId));
  if (nextWorkoutContext.eligibleSlotSnapshots) {
    const requestedIntent = input.requestedIntent.trim().toLowerCase();
    return nextWorkoutContext.eligibleSlotSnapshots.find(
      (slot) =>
        slot.intent === requestedIntent &&
        (!input.explicitSlotId || slot.slotId === input.explicitSlotId),
    );
  }
  const activePlanContext = await resolveActivePlanContext(input.userId);
  if (activePlanContext.status !== "READY") {
    return undefined;
  }
  const mesocycle = activePlanContext.activeMesocycle;
  const constraints = await prisma.constraints.findUnique({
    where: { userId: input.userId },
    select: { weeklySchedule: true },
  });
  if (mesocycle?.currentSeedRevision?.seedPayload) {
    parseAcceptedSeedPayload(mesocycle.currentSeedRevision.seedPayload);
    mesocycle.slotPlanSeedJson = mesocycle.currentSeedRevision.seedPayload;
  }
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
