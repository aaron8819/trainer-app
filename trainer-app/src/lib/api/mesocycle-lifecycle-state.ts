import {
  WorkoutStatus,
  type MacroCycle,
  type Mesocycle,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { getWorkoutStatusPolicy } from "@/lib/workout-status";
import { getAccumulationWeeks } from "./mesocycle-lifecycle-math";
import { enterMesocycleHandoffInTransaction } from "./mesocycle-handoff";
import { parseSlotPlanSeedJson } from "./slot-plan-seed-parser";
import { normalizeAcceptedSeedPayload } from "./mesocycle-seed-revision";
import { resolveV4ScheduleAuthority } from "./v4-scheduled-slot-resolution";
import {
  requireSupportedPlanType,
} from "@/lib/plan-types";
import type { SessionCapacityReductionManifest } from "@/lib/engine/planning/v2";
import {
  claimSelectedPlanForTransitionInTransaction,
  resolveActivePlanContext,
  type ResolvedActiveMesocycle,
} from "./active-plan-context";

export {
  ActivePlanContextError,
  ActivePlanSelectionConflictError,
  claimSelectedPlanForTransitionInTransaction,
  requireActivePlanExecutionContext,
  resolveActivePlanContext,
  resolveActivePlanContextInTransaction,
  resolveConfiguredActivePlanContext,
  selectActivePlan,
  selectActivePlanInTransaction,
  type ActivePlanContextResult,
  type SelectActivePlanInput,
  type SelectActivePlanResult,
} from "./active-plan-context";

type MesoWithLifecycle = Pick<
  Mesocycle,
  | "id"
  | "macroCycleId"
  | "mesoNumber"
  | "durationWeeks"
  | "focus"
  | "volumeTarget"
  | "intensityBias"
  | "isActive"
  | "state"
  | "accumulationSessionsCompleted"
  | "deloadSessionsCompleted"
  | "sessionsPerWeek"
  | "daysPerWeek"
  | "splitType"
>;

export type ActiveMesocycleWithBlocks = Prisma.MesocycleGetPayload<{
  include: { blocks: true };
}> & {
  macroCycle?: Partial<
    Pick<MacroCycle, "startDate" | "userId" | "primaryGoal">
  >;
  currentSeedRevision?: {
    id: string;
    mesocycleId: string;
    revision: number;
    seedPayload: Prisma.JsonValue;
    payloadHash: string | null;
    hashAlgorithm: string | null;
    provenanceStatus: string;
  } | null;
  seedRevisions?: Array<{
    id: string;
    revision: number;
    payloadHash: string | null;
    provenanceStatus: string;
    creationReason: string;
    actorSource: string | null;
    sourceRevisionId: string | null;
    activatedAt: Date;
  }>;
  sessionCapacityReductionManifest?: SessionCapacityReductionManifest;
};

export type ResolvedActiveMesocycleWithBlocks = ResolvedActiveMesocycle & {
  sessionCapacityReductionManifest?: SessionCapacityReductionManifest;
};

function getAccumulationSessionThreshold(mesocycle: Pick<MesoWithLifecycle, "durationWeeks" | "sessionsPerWeek">): number {
  return getAccumulationWeeks(mesocycle.durationWeeks) * Math.max(1, mesocycle.sessionsPerWeek);
}

export function getDeloadSessionThreshold(mesocycle: { sessionsPerWeek: number }): number {
  return Math.max(1, mesocycle.sessionsPerWeek);
}

export type LegacyAuthoredScheduleMesocycle = {
  id: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  slotSequenceJson?: unknown;
  currentSeedRevision?: { seedPayload: unknown } | null;
};

export type LegacyAuthoredScheduleWorkout = {
  id: string;
  status: unknown;
  mesocycleId: string | null;
  mesocycleWeekSnapshot: number | null;
  mesocyclePhaseSnapshot: unknown;
  mesoSessionSnapshot: number | null;
  advancesSplit: boolean | null;
  selectionMode: string | null;
  sessionIntent: string | null;
  selectionMetadata: unknown;
};

export type LegacyAuthoredObligation = {
  weekInMeso: number;
  phase: "ACCUMULATION" | "DELOAD";
  sessionInWeek: number;
  slotId: string;
  intent: string;
};

export type StrictFrozenLegacyAuthoredScheduleResolution =
  | { status: "not_legacy" }
  | { status: "unavailable"; reason: string }
  | { status: "blocked"; reason: string }
  | {
      status: "available";
      evidenceMode: "STRICT_FROZEN_TOPOLOGY";
      expectedObligationCount: number;
      resolvedObligationCount: number;
      performedCompletionCount: number;
      accumulationCompletionCount: number;
      deloadCompletionCount: number;
      allAccumulationResolved: boolean;
      allResolved: boolean;
      claims: Array<{
        obligation: LegacyAuthoredObligation;
        workoutId: string;
        status: string;
        scheduleResolved: boolean;
        completed: boolean;
      }>;
    };

type LegacyFrozenSlot = {
  slotId: string;
  intent: string;
  sequenceIndex: number;
};

function legacyRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeLegacyIntent(value: string): string {
  return value.trim().toLowerCase();
}

function legacyObligationKey(input: {
  weekInMeso: number;
  sessionInWeek: number;
}): string {
  return `${input.weekInMeso}:${input.sessionInWeek}`;
}

function resolveLegacyFrozenSlots(
  mesocycle: LegacyAuthoredScheduleMesocycle,
):
  | { status: "available"; slots: LegacyFrozenSlot[] }
  | { status: "unavailable"; reason: string }
  | { status: "blocked"; reason: string } {
  if (
    !Number.isInteger(mesocycle.durationWeeks) ||
    mesocycle.durationWeeks < 1 ||
    !Number.isInteger(mesocycle.sessionsPerWeek) ||
    mesocycle.sessionsPerWeek < 1
  ) {
    return { status: "blocked", reason: "legacy_mesocycle_topology_invalid" };
  }

  if (mesocycle.slotSequenceJson == null) {
    return {
      status: "unavailable",
      reason: "legacy_frozen_slot_sequence_unavailable",
    };
  }
  const sequence = legacyRecord(mesocycle.slotSequenceJson);
  const rawSlots = Array.isArray(sequence?.slots) ? sequence.slots : null;
  if (
    sequence?.version !== 1 ||
    sequence.source !== "handoff_draft" ||
    sequence.sequenceMode !== "ordered_flexible" ||
    !rawSlots ||
    rawSlots.length !== mesocycle.sessionsPerWeek ||
    (sequence.sessionsPerWeek != null &&
      sequence.sessionsPerWeek !== mesocycle.sessionsPerWeek)
  ) {
    return { status: "blocked", reason: "legacy_frozen_slot_sequence_invalid" };
  }

  const seenSlotIds = new Set<string>();
  const slots: LegacyFrozenSlot[] = [];
  for (let sequenceIndex = 0; sequenceIndex < rawSlots.length; sequenceIndex += 1) {
    const rawSlot = legacyRecord(rawSlots[sequenceIndex]);
    if (
      !rawSlot ||
      typeof rawSlot.slotId !== "string" ||
      typeof rawSlot.intent !== "string"
    ) {
      return { status: "blocked", reason: "legacy_frozen_slot_identity_missing" };
    }
    const slotId = rawSlot.slotId.trim();
    const intent = normalizeLegacyIntent(rawSlot.intent);
    if (!slotId || !intent || seenSlotIds.has(slotId)) {
      return { status: "blocked", reason: "legacy_frozen_slot_identity_conflict" };
    }
    seenSlotIds.add(slotId);
    slots.push({ slotId, intent, sequenceIndex });
  }

  return { status: "available", slots };
}

function isExplicitLegacyNonAdvancingWorkout(
  workout: LegacyAuthoredScheduleWorkout,
): boolean {
  const semantics = deriveSessionSemantics({
    advancesSplit: workout.advancesSplit,
    selectionMode: workout.selectionMode,
    sessionIntent: workout.sessionIntent,
    selectionMetadata: workout.selectionMetadata,
    mesocyclePhase:
      typeof workout.mesocyclePhaseSnapshot === "string"
        ? workout.mesocyclePhaseSnapshot
        : null,
  });
  return (
    workout.advancesSplit === false ||
    semantics.isStrictGapFill ||
    semantics.isStrictSupplemental ||
    semantics.isCloseout
  );
}

export function resolveStrictFrozenLegacyAuthoredScheduleLifecycle(input: {
  mesocycle: LegacyAuthoredScheduleMesocycle;
  workouts: readonly LegacyAuthoredScheduleWorkout[];
}): StrictFrozenLegacyAuthoredScheduleResolution {
  if (isV4SeedPayload(input.mesocycle.currentSeedRevision?.seedPayload)) {
    return { status: "not_legacy" };
  }

  const frozenSlots = resolveLegacyFrozenSlots(input.mesocycle);
  if (frozenSlots.status !== "available") return frozenSlots;

  const obligations: LegacyAuthoredObligation[] = [];
  for (let weekInMeso = 1; weekInMeso <= input.mesocycle.durationWeeks; weekInMeso += 1) {
    const phase =
      weekInMeso === input.mesocycle.durationWeeks
        ? "DELOAD"
        : "ACCUMULATION";
    for (const slot of frozenSlots.slots) {
      obligations.push({
        weekInMeso,
        phase,
        sessionInWeek: slot.sequenceIndex + 1,
        slotId: slot.slotId,
        intent: slot.intent,
      });
    }
  }
  const obligationsByKey = new Map(
    obligations.map((obligation) => [legacyObligationKey(obligation), obligation]),
  );
  const claimsByKey = new Map<
    string,
    Extract<StrictFrozenLegacyAuthoredScheduleResolution, { status: "available" }>["claims"][number]
  >();

  for (const workout of input.workouts) {
    if (
      workout.mesocycleId !== input.mesocycle.id ||
      isExplicitLegacyNonAdvancingWorkout(workout)
    ) {
      continue;
    }

    const metadata = legacyRecord(workout.selectionMetadata);
    const hasRawReceipt = metadata != null && "sessionDecisionReceipt" in metadata;
    const receipt = readSessionDecisionReceipt(workout.selectionMetadata);
    const receiptSlot = receipt?.sessionSlot;
    const receiptWeek = receipt?.cycleContext.weekInMeso;
    const receiptSession = receiptSlot ? receiptSlot.sequenceIndex + 1 : null;
    const snapshotHasCoordinates =
      workout.mesocycleWeekSnapshot != null &&
      workout.mesoSessionSnapshot != null;
    const receiptHasCoordinates = receiptWeek != null && receiptSession != null;
    const snapshotIsOutside =
      snapshotHasCoordinates &&
      (!Number.isInteger(workout.mesocycleWeekSnapshot) ||
        workout.mesocycleWeekSnapshot! < 1 ||
        workout.mesocycleWeekSnapshot! > input.mesocycle.durationWeeks ||
        !Number.isInteger(workout.mesoSessionSnapshot) ||
        workout.mesoSessionSnapshot! < 1 ||
        workout.mesoSessionSnapshot! > input.mesocycle.sessionsPerWeek);
    const receiptIsOutside =
      receiptHasCoordinates &&
      (!Number.isInteger(receiptWeek) ||
        receiptWeek! < 1 ||
        receiptWeek! > input.mesocycle.durationWeeks ||
        !Number.isInteger(receiptSession) ||
        receiptSession! < 1 ||
        receiptSession! > input.mesocycle.sessionsPerWeek);
    if (
      (snapshotIsOutside || receiptIsOutside) &&
      (!snapshotHasCoordinates || snapshotIsOutside) &&
      (!receiptHasCoordinates || receiptIsOutside)
    ) {
      continue;
    }

    if (!hasRawReceipt || !receipt) {
      return {
        status: "blocked",
        reason: hasRawReceipt
          ? `strict_frozen_receipt_invalid:${workout.id}`
          : `strict_frozen_receipt_missing:${workout.id}`,
      };
    }
    if (!receiptSlot) {
      return {
        status: "blocked",
        reason: `strict_frozen_session_slot_missing:${workout.id}`,
      };
    }
    if (receiptSlot.source !== "mesocycle_slot_sequence") {
      return {
        status: "blocked",
        reason: `strict_frozen_slot_source_non_authoritative:${workout.id}`,
      };
    }
    if (
      receipt.sessionProvenance?.mesocycleId !== input.mesocycle.id ||
      (receipt.sessionProvenance.compositionSource !== "runtime_selection" &&
        receipt.sessionProvenance.compositionSource !== "persisted_slot_plan_seed" &&
        receipt.sessionProvenance.compositionSource !== "deload_seed_replay")
    ) {
      return {
        status: "blocked",
        reason: `strict_frozen_mesocycle_provenance_invalid:${workout.id}`,
      };
    }
    if (!snapshotHasCoordinates) {
      return {
        status: "blocked",
        reason: `strict_frozen_workout_coordinates_missing:${workout.id}`,
      };
    }
    if (workout.mesocycleWeekSnapshot !== receiptWeek) {
      return { status: "blocked", reason: `legacy_week_identity_conflict:${workout.id}` };
    }
    if (workout.mesoSessionSnapshot !== receiptSession) {
      return { status: "blocked", reason: `legacy_session_identity_conflict:${workout.id}` };
    }

    const weekInMeso = workout.mesocycleWeekSnapshot;
    const sessionInWeek = workout.mesoSessionSnapshot;

    const weekInRange =
      Number.isInteger(weekInMeso) &&
      (weekInMeso ?? 0) >= 1 &&
      (weekInMeso ?? 0) <= input.mesocycle.durationWeeks;
    const sessionInRange =
      Number.isInteger(sessionInWeek) &&
      (sessionInWeek ?? 0) >= 1 &&
      (sessionInWeek ?? 0) <= input.mesocycle.sessionsPerWeek;
    if (!weekInRange || !sessionInRange) {
      if (
        (weekInMeso == null && sessionInRange) ||
        (sessionInWeek == null && weekInRange)
      ) {
        return { status: "blocked", reason: `legacy_authored_claim_incomplete:${workout.id}` };
      }
      continue;
    }

    if (receipt.cycleContext.mesocycleLength !== input.mesocycle.durationWeeks) {
      return { status: "blocked", reason: `legacy_receipt_length_conflict:${workout.id}` };
    }

    const key = legacyObligationKey({
      weekInMeso: weekInMeso!,
      sessionInWeek: sessionInWeek!,
    });
    const obligation = obligationsByKey.get(key);
    if (!obligation) continue;

    const expectedPhase = obligation.phase;
    if (
      typeof workout.mesocyclePhaseSnapshot === "string" &&
      workout.mesocyclePhaseSnapshot.trim().toUpperCase() !== expectedPhase
    ) {
      return { status: "blocked", reason: `legacy_phase_identity_conflict:${workout.id}` };
    }
    if (
      typeof receipt.cycleContext.phase === "string" &&
      receipt.cycleContext.phase.trim().toUpperCase() !== expectedPhase
    ) {
      return { status: "blocked", reason: `legacy_receipt_phase_conflict:${workout.id}` };
    }
    if (receipt.cycleContext.isDeload !== (expectedPhase === "DELOAD")) {
      return { status: "blocked", reason: `legacy_receipt_phase_conflict:${workout.id}` };
    }
    const compositionSource = receipt.sessionProvenance.compositionSource;
    if (
      (expectedPhase === "DELOAD" &&
        compositionSource !== "deload_seed_replay" &&
        compositionSource !== "runtime_selection") ||
      (expectedPhase === "ACCUMULATION" &&
        compositionSource !== "persisted_slot_plan_seed" &&
        compositionSource !== "runtime_selection")
    ) {
      return {
        status: "blocked",
        reason: `strict_frozen_composition_source_conflict:${workout.id}`,
      };
    }
    if (
      typeof workout.sessionIntent !== "string" ||
      normalizeLegacyIntent(workout.sessionIntent) !== obligation.intent
    ) {
      return { status: "blocked", reason: `legacy_intent_identity_conflict:${workout.id}` };
    }
    if (
      receiptSlot.slotId !== obligation.slotId ||
        receiptSlot.sequenceIndex !== obligation.sessionInWeek - 1 ||
        receiptSlot.sequenceLength !== input.mesocycle.sessionsPerWeek ||
        normalizeLegacyIntent(receiptSlot.intent) !== obligation.intent
    ) {
      return { status: "blocked", reason: `legacy_slot_identity_conflict:${workout.id}` };
    }

    const statusPolicy = getWorkoutStatusPolicy(workout.status);
    if (!statusPolicy) {
      return { status: "blocked", reason: `legacy_workout_status_invalid:${workout.id}` };
    }
    if (claimsByKey.has(key)) {
      return { status: "blocked", reason: `duplicate_legacy_authored_claim:${key}` };
    }
    claimsByKey.set(key, {
      obligation,
      workoutId: workout.id,
      status: String(workout.status),
      scheduleResolved: statusPolicy.scheduleResolved,
      completed: statusPolicy.completed,
    });
  }

  const claims = [...claimsByKey.values()];
  const accumulationObligations = obligations.filter(
    (obligation) => obligation.phase === "ACCUMULATION",
  );
  const resolvedObligationCount = claims.filter(
    (claim) => claim.scheduleResolved,
  ).length;
  const performedCompletionCount = claims.filter((claim) => claim.completed).length;
  return {
    status: "available",
    evidenceMode: "STRICT_FROZEN_TOPOLOGY",
    expectedObligationCount: obligations.length,
    resolvedObligationCount,
    performedCompletionCount,
    accumulationCompletionCount: claims.filter(
      (claim) => claim.completed && claim.obligation.phase === "ACCUMULATION",
    ).length,
    deloadCompletionCount: claims.filter(
      (claim) => claim.completed && claim.obligation.phase === "DELOAD",
    ).length,
    allAccumulationResolved: accumulationObligations.every(
      (obligation) =>
        claimsByKey.get(legacyObligationKey(obligation))?.scheduleResolved === true,
    ),
    allResolved: obligations.every(
      (obligation) =>
        claimsByKey.get(legacyObligationKey(obligation))?.scheduleResolved === true,
    ),
    claims,
  };
}

export async function initializeNextMesocycle(
  completedMesocycle: MesoWithLifecycle
): Promise<Mesocycle> {
  void completedMesocycle;
  throw new Error("MESOCYCLE_HANDOFF_REQUIRED");
}

type LifecycleTx = Prisma.TransactionClient;

declare const terminalTransitionLockProofType: unique symbol;

export type TerminalTransitionLockProof = {
  readonly [terminalTransitionLockProofType]: true;
};

type TerminalTransitionLockRecord = {
  readonly tx: LifecycleTx;
  readonly mesocycleId: string;
  readonly macroCycleId: string;
  readonly userId: string;
  readonly expectedState: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD";
  readonly currentSeedRevisionId: string | null;
};

const terminalTransitionLockRegistry = new WeakMap<
  TerminalTransitionLockProof,
  TerminalTransitionLockRecord
>();

export async function claimSelectedPlanAndLockMesocycleForTerminalTransitionInTransaction(
  tx: LifecycleTx,
  input: {
    mesocycleId: string;
    macroCycleId: string;
    userId: string;
    expectedState: "ACTIVE_ACCUMULATION" | "ACTIVE_DELOAD";
    currentSeedRevisionId: string | null;
  },
): Promise<TerminalTransitionLockProof> {
  await claimSelectedPlanForTransitionInTransaction(tx, {
    userId: input.userId,
    macroCycleId: input.macroCycleId,
  });
  const locked = await tx.mesocycle.updateMany({
    where: {
      id: input.mesocycleId,
      macroCycleId: input.macroCycleId,
      state: input.expectedState,
      currentSeedRevisionId: input.currentSeedRevisionId,
    },
    data: { state: input.expectedState },
  });
  if (locked.count !== 1) {
    throw new Error("V4_SCHEDULE_AUTHORITY_CONFLICT");
  }
  const proof = Object.freeze({}) as TerminalTransitionLockProof;
  terminalTransitionLockRegistry.set(proof, {
    tx,
    mesocycleId: input.mesocycleId,
    macroCycleId: input.macroCycleId,
    userId: input.userId,
    expectedState: input.expectedState,
    currentSeedRevisionId: input.currentSeedRevisionId,
  });
  return proof;
}

function requireTerminalTransitionLockRecord(
  tx: LifecycleTx,
  proof: TerminalTransitionLockProof | undefined,
): TerminalTransitionLockRecord {
  const record = proof
    ? terminalTransitionLockRegistry.get(proof)
    : undefined;
  if (!record || record.tx !== tx) {
    throw new Error("V4_SCHEDULE_AUTHORITY_CONFLICT");
  }
  return record;
}

export type FiniteV4CompletionResult =
  | { status: "finite_v4_complete"; mesocycle: Mesocycle }
  | { status: "not_v4" }
  | { status: "v4_blocked"; reason: string };

function isV4SeedPayload(value: unknown): boolean {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "version" in value &&
    value.version === 4
  );
}

function finiteV4Blocked(reason: string): FiniteV4CompletionResult {
  return { status: "v4_blocked", reason };
}

function finiteV4CompletionConflict(reason: string): Error {
  return new Error(`V4_SCHEDULE_COMPLETION_BLOCKED:${reason}`);
}

function validateFiniteV4MacroTopology(input: {
  currentMesocycleId: string;
  macroDurationWeeks: number;
  siblings: Array<{
    id: string;
    mesoNumber: number;
    startWeek: number;
    durationWeeks: number;
    state: string;
  }>;
}): string | null {
  if (!Number.isInteger(input.macroDurationWeeks) || input.macroDurationWeeks < 1) {
    return "macro_duration_invalid";
  }
  if (input.siblings.length === 0) return "macro_topology_empty";

  let exclusiveEnd = 0;
  for (let index = 0; index < input.siblings.length; index += 1) {
    const sibling = input.siblings[index];
    if (sibling.mesoNumber !== index + 1) {
      return "macro_mesocycle_numbering_invalid";
    }
    if (!Number.isInteger(sibling.durationWeeks) || sibling.durationWeeks < 1) {
      return "macro_mesocycle_duration_invalid";
    }
    if (sibling.startWeek !== exclusiveEnd) {
      if (index === 0) return "macro_first_mesocycle_start_invalid";
      return sibling.startWeek < exclusiveEnd
        ? "macro_mesocycle_overlap"
        : "macro_mesocycle_gap";
    }
    exclusiveEnd = sibling.startWeek + sibling.durationWeeks;
  }

  const currentIndex = input.siblings.findIndex(
    (sibling) => sibling.id === input.currentMesocycleId,
  );
  if (currentIndex < 0) return "current_mesocycle_missing_from_macro";
  if (currentIndex !== input.siblings.length - 1) {
    return "later_mesocycle_exists";
  }
  if (
    input.siblings
      .slice(0, currentIndex)
      .some((sibling) => sibling.state !== "COMPLETED")
  ) {
    return "earlier_mesocycle_incomplete";
  }
  if (exclusiveEnd !== input.macroDurationWeeks) {
    return "macro_duration_boundary_mismatch";
  }
  return null;
}

export async function completeFiniteV4PlanInTransaction(
  tx: LifecycleTx,
  input: {
    mesocycleId: string;
    expectedState: string;
    terminalLock?: TerminalTransitionLockProof;
  },
): Promise<FiniteV4CompletionResult> {
  const identity = await tx.mesocycle.findUnique({
    where: { id: input.mesocycleId },
    select: {
      macroCycleId: true,
      state: true,
      isActive: true,
      closedAt: true,
      currentSeedRevision: { select: { seedPayload: true } },
      macroCycle: { select: { userId: true } },
    },
  });
  if (!identity) return finiteV4Blocked("mesocycle_not_found");
  if (!isV4SeedPayload(identity.currentSeedRevision?.seedPayload)) {
    return { status: "not_v4" };
  }

  const terminalLock = requireTerminalTransitionLockRecord(
    tx,
    input.terminalLock,
  );

  const expectedState =
    input.expectedState === "ACTIVE_ACCUMULATION" ||
    input.expectedState === "ACTIVE_DELOAD"
      ? input.expectedState
      : null;
  if (
    !expectedState ||
    terminalLock.mesocycleId !== input.mesocycleId ||
    terminalLock.expectedState !== expectedState ||
    terminalLock.macroCycleId !== identity.macroCycleId ||
    terminalLock.userId !== identity.macroCycle.userId ||
    identity.state !== expectedState ||
    !identity.isActive ||
    identity.closedAt != null
  ) {
    throw new Error("V4_SCHEDULE_AUTHORITY_CONFLICT");
  }

  const mesocycle = await tx.mesocycle.findUnique({
    where: { id: input.mesocycleId },
    include: {
      currentSeedRevision: {
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
      macroCycle: {
        select: {
          id: true,
          userId: true,
          primaryGoal: true,
          durationWeeks: true,
          mesocycles: {
            orderBy: [{ mesoNumber: "asc" }, { id: "asc" }],
            select: {
              id: true,
              mesoNumber: true,
              startWeek: true,
              durationWeeks: true,
              state: true,
            },
          },
        },
      },
    },
  });
  if (!mesocycle) return finiteV4Blocked("mesocycle_disappeared");
  if (!isV4SeedPayload(mesocycle.currentSeedRevision?.seedPayload)) {
    return finiteV4Blocked("accepted_revision_changed");
  }

  const isExpectedActiveState =
    expectedState != null &&
    mesocycle.state === expectedState &&
    mesocycle.isActive &&
    mesocycle.closedAt == null;
  const authority = resolveV4ScheduleAuthority(mesocycle);
  if (mesocycle.macroCycle.id !== identity.macroCycleId) {
    return finiteV4Blocked("macro_identity_changed");
  }
  if (mesocycle.macroCycle.userId !== identity.macroCycle.userId) {
    return finiteV4Blocked("macro_owner_changed");
  }
  if (mesocycle.macroCycle.primaryGoal !== "HYPERTROPHY") {
    return finiteV4Blocked("plan_type_invalid");
  }
  if (authority.status !== "available") {
    return finiteV4Blocked(
      authority.status === "blocked"
        ? authority.reason
        : "accepted_revision_not_v4_after_lock",
    );
  }
  if (
    terminalLock.currentSeedRevisionId !==
    authority.authority.revisionId
  ) {
    throw new Error("V4_SCHEDULE_AUTHORITY_CONFLICT");
  }
  const topologyReason = validateFiniteV4MacroTopology({
    currentMesocycleId: mesocycle.id,
    macroDurationWeeks: mesocycle.macroCycle.durationWeeks,
    siblings: mesocycle.macroCycle.mesocycles,
  });
  if (topologyReason) return finiteV4Blocked(topologyReason);
  if (mesocycle.handoffSummaryJson != null || mesocycle.nextSeedDraftJson != null) {
    return finiteV4Blocked("handoff_artifacts_present");
  }
  if (!isExpectedActiveState) {
    throw new Error("V4_SCHEDULE_AUTHORITY_CONFLICT");
  }

  const completed = await tx.mesocycle.updateMany({
    where: {
      id: mesocycle.id,
      macroCycleId: mesocycle.macroCycleId,
      state: expectedState,
      isActive: true,
      closedAt: null,
      currentSeedRevisionId: authority.authority.revisionId,
      handoffSummaryJson: { equals: Prisma.DbNull },
      nextSeedDraftJson: { equals: Prisma.DbNull },
    },
    data: {
      state: "COMPLETED",
      isActive: false,
      closedAt: new Date(),
    },
  });
  if (completed.count !== 1) {
    throw new Error("V4_SCHEDULE_AUTHORITY_CONFLICT");
  }

  const updated = await tx.mesocycle.findUnique({
    where: { id: mesocycle.id },
  });
  if (!updated) {
    throw finiteV4CompletionConflict("completed_mesocycle_not_found");
  }
  return { status: "finite_v4_complete", mesocycle: updated };
}

export async function completeOrEnterHandoffInTransaction(
  tx: LifecycleTx,
  mesocycle: {
    id: string;
    state: string;
    macroCycle?: { primaryGoal?: string | null } | null;
    currentSeedRevision?: { seedPayload: unknown } | null;
  },
  terminalLock?: TerminalTransitionLockProof,
): Promise<Mesocycle> {
  const planType = requireSupportedPlanType(
    mesocycle.macroCycle?.primaryGoal,
  );
  switch (planType) {
    case "HYPERTROPHY": {
      const completion = await completeFiniteV4PlanInTransaction(tx, {
        mesocycleId: mesocycle.id,
        expectedState: mesocycle.state,
        terminalLock,
      });
      switch (completion.status) {
        case "finite_v4_complete":
          return completion.mesocycle;
        case "not_v4":
          return enterMesocycleHandoffInTransaction(tx, mesocycle.id);
        case "v4_blocked":
          throw finiteV4CompletionConflict(completion.reason);
      }
    }
    case "STRENGTH":
      return tx.mesocycle.update({
        where: { id: mesocycle.id },
        data: {
          state: "COMPLETED",
          isActive: false,
          closedAt: new Date(),
        },
      });
  }
}

const EARLY_FINISH_INCOMPLETE_WORKOUT_STATUSES = [
  WorkoutStatus.PLANNED,
  WorkoutStatus.IN_PROGRESS,
  WorkoutStatus.PARTIAL,
] as const;

type EarlyFinishWorkoutRow = {
  id: string;
  status: WorkoutStatus;
  advancesSplit: boolean | null;
  selectionMode: string | null;
  sessionIntent: string | null;
  selectionMetadata: Prisma.JsonValue | null;
  mesocyclePhaseSnapshot: string | null;
  exercises: Array<{
    sets: Array<{
      logs: Array<{
        wasSkipped: boolean;
        actualReps: number | null;
        actualRpe: number | null;
        actualLoad: number | null;
      }>;
    }>;
  }>;
};

export type FinishDeloadEarlyResult = {
  mesocycle: Mesocycle;
  skippedWorkoutIds: string[];
  skippedWorkoutCount: number;
  handoffSummaryCreated: boolean;
  nextSeedDraftCreated: boolean;
};

export type FinishMesocycleEarlyResult = FinishDeloadEarlyResult;

export class FinishDeloadEarlyBlockedWorkoutError extends Error {
  readonly workoutIds: string[];

  constructor(workoutIds: string[]) {
    super("MESOCYCLE_FINISH_DELOAD_WORKOUT_HAS_PERFORMED_LOGS");
    this.name = "FinishDeloadEarlyBlockedWorkoutError";
    this.workoutIds = workoutIds;
  }
}

export class FinishMesocycleEarlyBlockedWorkoutError extends Error {
  readonly workoutIds: string[];

  constructor(workoutIds: string[]) {
    super("MESOCYCLE_FINISH_EARLY_WORKOUT_HAS_PERFORMED_LOGS");
    this.name = "FinishMesocycleEarlyBlockedWorkoutError";
    this.workoutIds = workoutIds;
  }
}

function isJsonObject(value: Prisma.JsonValue | null): value is Prisma.JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasPerformedLog(workout: EarlyFinishWorkoutRow): boolean {
  return workout.exercises.some((exercise) =>
    exercise.sets.some((set) =>
      set.logs.some(
        (log) =>
          log.wasSkipped !== true &&
          (log.actualReps != null || log.actualRpe != null || log.actualLoad != null)
      )
    )
  );
}

function isDeloadWorkout(workout: EarlyFinishWorkoutRow): boolean {
  return deriveSessionSemantics({
    advancesSplit: workout.advancesSplit,
    selectionMode: workout.selectionMode,
    sessionIntent: workout.sessionIntent,
    selectionMetadata: workout.selectionMetadata,
    mesocyclePhase: workout.mesocyclePhaseSnapshot,
  }).isDeload;
}

function withFinishDeloadSkippedMetadata(
  selectionMetadata: Prisma.JsonValue | null,
  skippedAt: string
): Prisma.InputJsonValue {
  const base = isJsonObject(selectionMetadata) ? selectionMetadata : {};
  return {
    ...base,
    finishDeloadEarly: {
      version: 1,
      reason: "user_finished_deload_early",
      skippedAt,
      terminalStatus: WorkoutStatus.SKIPPED,
    },
  };
}

function withFinishMesocycleSkippedMetadata(
  selectionMetadata: Prisma.JsonValue | null,
  skippedAt: string
): Prisma.InputJsonValue {
  const base = isJsonObject(selectionMetadata) ? selectionMetadata : {};
  return {
    ...base,
    finishMesocycleEarly: {
      version: 1,
      reason: "user_ended_accumulation_early",
      skippedAt,
      terminalStatus: WorkoutStatus.SKIPPED,
    },
  };
}

export async function finishMesocycleEarlyInTransaction(
  tx: LifecycleTx,
  input: { userId: string; mesocycleId: string }
): Promise<FinishMesocycleEarlyResult> {
  const mesocycle = await tx.mesocycle.findFirst({
    where: {
      id: input.mesocycleId,
      macroCycle: { userId: input.userId },
    },
    select: {
      id: true,
      macroCycleId: true,
      state: true,
      isActive: true,
      handoffSummaryJson: true,
      nextSeedDraftJson: true,
      closedAt: true,
      currentSeedRevisionId: true,
      macroCycle: { select: { primaryGoal: true } },
      currentSeedRevision: { select: { seedPayload: true } },
    },
  });

  if (!mesocycle) {
    throw new Error("MESOCYCLE_FINISH_EARLY_NOT_FOUND");
  }
  requireSupportedPlanType(mesocycle.macroCycle?.primaryGoal);
  if (mesocycle.state !== "ACTIVE_ACCUMULATION" || !mesocycle.isActive) {
    throw new Error("MESOCYCLE_FINISH_EARLY_INVALID_STATE");
  }
  if (mesocycle.handoffSummaryJson || mesocycle.nextSeedDraftJson || mesocycle.closedAt) {
    throw new Error("MESOCYCLE_FINISH_EARLY_HANDOFF_EXISTS");
  }
  const terminalLock =
    await claimSelectedPlanAndLockMesocycleForTerminalTransitionInTransaction(
      tx,
      {
        mesocycleId: mesocycle.id,
        macroCycleId: mesocycle.macroCycleId,
        userId: input.userId,
        expectedState: "ACTIVE_ACCUMULATION",
        currentSeedRevisionId: mesocycle.currentSeedRevisionId,
      },
    );

  const incompleteWorkouts: EarlyFinishWorkoutRow[] = await tx.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      status: { in: [...EARLY_FINISH_INCOMPLETE_WORKOUT_STATUSES] },
    },
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      status: true,
      advancesSplit: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      mesocyclePhaseSnapshot: true,
      exercises: {
        select: {
          sets: {
            select: {
              logs: {
                select: {
                  wasSkipped: true,
                  actualReps: true,
                  actualRpe: true,
                  actualLoad: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const blockedWorkoutIds = incompleteWorkouts
    .filter((workout) => workout.status === WorkoutStatus.PARTIAL || hasPerformedLog(workout))
    .map((workout) => workout.id);
  if (blockedWorkoutIds.length > 0) {
    throw new FinishMesocycleEarlyBlockedWorkoutError(blockedWorkoutIds);
  }

  const skippedAt = new Date().toISOString();
  for (const workout of incompleteWorkouts) {
    await tx.workout.update({
      where: { id: workout.id },
      data: {
        status: WorkoutStatus.SKIPPED,
        selectionMetadata: withFinishMesocycleSkippedMetadata(
          workout.selectionMetadata,
          skippedAt
        ),
      },
    });
  }

  const updated = await completeOrEnterHandoffInTransaction(
    tx,
    mesocycle,
    terminalLock,
  );
  return {
    mesocycle: updated,
    skippedWorkoutIds: incompleteWorkouts.map((workout) => workout.id),
    skippedWorkoutCount: incompleteWorkouts.length,
    handoffSummaryCreated: Boolean(updated.handoffSummaryJson),
    nextSeedDraftCreated: Boolean(updated.nextSeedDraftJson),
  };
}

export async function finishMesocycleEarly(input: {
  userId: string;
  mesocycleId: string;
}): Promise<FinishMesocycleEarlyResult> {
  return prisma.$transaction((tx) => finishMesocycleEarlyInTransaction(tx, input));
}

export async function transitionMesocycleStateInTransaction(
  tx: LifecycleTx,
  mesocycleId: string
): Promise<{ mesocycle: Mesocycle; advanced: boolean }> {
  const mesocycle = await tx.mesocycle.findUnique({
    where: { id: mesocycleId },
    include: {
      macroCycle: { select: { primaryGoal: true } },
      currentSeedRevision: { select: { seedPayload: true } },
    },
  });
  if (!mesocycle) {
    throw new Error(`Mesocycle not found: ${mesocycleId}`);
  }
  requireSupportedPlanType(mesocycle.macroCycle?.primaryGoal);

  if (mesocycle.state === "COMPLETED" || mesocycle.state === "AWAITING_HANDOFF") {
    console.warn(
      `[mesocycle-lifecycle] transition requested on ${mesocycle.state} mesocycle ${mesocycleId}; no-op`
    );
    return { mesocycle, advanced: false };
  }

  const legacyResolution = resolveStrictFrozenLegacyAuthoredScheduleLifecycle({
    mesocycle,
    workouts: await tx.workout.findMany({
      where: { mesocycleId: mesocycle.id },
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
        mesocyclePhaseSnapshot: true,
        mesoSessionSnapshot: true,
        advancesSplit: true,
        selectionMode: true,
        sessionIntent: true,
        selectionMetadata: true,
      },
    }),
  });

  if (legacyResolution.status === "blocked") {
    console.warn(
      `[mesocycle-lifecycle] legacy authored schedule blocked for ${mesocycleId}: ${legacyResolution.reason}`,
    );
    return { mesocycle, advanced: false };
  }

  if (legacyResolution.status === "available") {
    if (legacyResolution.allResolved) {
      const updated = await completeOrEnterHandoffInTransaction(tx, mesocycle);
      return { mesocycle: updated, advanced: true };
    }
    if (
      mesocycle.state === "ACTIVE_ACCUMULATION" &&
      legacyResolution.allAccumulationResolved
    ) {
      const updated = await tx.mesocycle.update({
        where: { id: mesocycle.id },
        data: { state: "ACTIVE_DELOAD" },
      });
      return { mesocycle: updated, advanced: true };
    }
    return { mesocycle, advanced: false };
  }

  if (mesocycle.state === "ACTIVE_ACCUMULATION") {
    if (mesocycle.accumulationSessionsCompleted < getAccumulationSessionThreshold(mesocycle)) {
      return { mesocycle, advanced: false };
    }
    const updated = await tx.mesocycle.update({
      where: { id: mesocycle.id },
      data: { state: "ACTIVE_DELOAD" },
    });
    return { mesocycle: updated, advanced: true };
  }

  if (mesocycle.deloadSessionsCompleted < getDeloadSessionThreshold(mesocycle)) {
    return { mesocycle, advanced: false };
  }
  const updated = await completeOrEnterHandoffInTransaction(tx, mesocycle);
  return { mesocycle: updated, advanced: true };
}

/**
 * Check lifecycle thresholds and transition mesocycle state if needed.
 *
 * Counter increments (accumulationSessionsCompleted / deloadSessionsCompleted) are
 * performed atomically inside the save-workout transaction BEFORE this function runs.
 * This function only reads the already-incremented counters and applies state
 * transitions when the threshold has been reached.
 */
export async function transitionMesocycleState(mesocycleId: string): Promise<Mesocycle> {
  const result = await prisma.$transaction(async (tx) =>
    transitionMesocycleStateInTransaction(tx, mesocycleId)
  );
  return result.mesocycle;
}

export async function finishDeloadEarlyInTransaction(
  tx: LifecycleTx,
  input: { userId: string; mesocycleId: string }
): Promise<FinishDeloadEarlyResult> {
  const mesocycle = await tx.mesocycle.findFirst({
    where: {
      id: input.mesocycleId,
      macroCycle: { userId: input.userId },
    },
    select: {
      id: true,
      macroCycleId: true,
      state: true,
      isActive: true,
      handoffSummaryJson: true,
      nextSeedDraftJson: true,
      closedAt: true,
      currentSeedRevisionId: true,
      macroCycle: { select: { primaryGoal: true } },
      currentSeedRevision: { select: { seedPayload: true } },
    },
  });

  if (!mesocycle) {
    throw new Error("MESOCYCLE_FINISH_DELOAD_NOT_FOUND");
  }
  requireSupportedPlanType(mesocycle.macroCycle?.primaryGoal);
  if (mesocycle.state !== "ACTIVE_DELOAD") {
    throw new Error("MESOCYCLE_FINISH_DELOAD_INVALID_STATE");
  }
  if (!mesocycle.isActive) {
    throw new Error("MESOCYCLE_FINISH_DELOAD_INVALID_STATE");
  }
  if (mesocycle.handoffSummaryJson || mesocycle.nextSeedDraftJson || mesocycle.closedAt) {
    throw new Error("MESOCYCLE_FINISH_DELOAD_HANDOFF_EXISTS");
  }
  const terminalLock =
    await claimSelectedPlanAndLockMesocycleForTerminalTransitionInTransaction(
      tx,
      {
        mesocycleId: mesocycle.id,
        macroCycleId: mesocycle.macroCycleId,
        userId: input.userId,
        expectedState: "ACTIVE_DELOAD",
        currentSeedRevisionId: mesocycle.currentSeedRevisionId,
      },
    );

  const incompleteWorkouts: EarlyFinishWorkoutRow[] = await tx.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      status: { in: [...EARLY_FINISH_INCOMPLETE_WORKOUT_STATUSES] },
    },
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      status: true,
      advancesSplit: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      mesocyclePhaseSnapshot: true,
      exercises: {
        select: {
          sets: {
            select: {
              logs: {
                select: {
                  wasSkipped: true,
                  actualReps: true,
                  actualRpe: true,
                  actualLoad: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const blockedWorkoutIds = incompleteWorkouts
    .filter(
      (workout) =>
        !isDeloadWorkout(workout) ||
        workout.status === WorkoutStatus.PARTIAL ||
        hasPerformedLog(workout)
    )
    .map((workout) => workout.id);
  if (blockedWorkoutIds.length > 0) {
    throw new FinishDeloadEarlyBlockedWorkoutError(blockedWorkoutIds);
  }

  const skippedAt = new Date().toISOString();
  for (const workout of incompleteWorkouts) {
    await tx.workout.update({
      where: { id: workout.id },
      data: {
        status: WorkoutStatus.SKIPPED,
        selectionMetadata: withFinishDeloadSkippedMetadata(
          workout.selectionMetadata,
          skippedAt
        ),
      },
    });
  }

  const updated = await completeOrEnterHandoffInTransaction(
    tx,
    mesocycle,
    terminalLock,
  );
  return {
    mesocycle: updated,
    skippedWorkoutIds: incompleteWorkouts.map((workout) => workout.id),
    skippedWorkoutCount: incompleteWorkouts.length,
    handoffSummaryCreated: Boolean(updated.handoffSummaryJson),
    nextSeedDraftCreated: Boolean(updated.nextSeedDraftJson),
  };
}

export async function finishDeloadEarly(input: {
  userId: string;
  mesocycleId: string;
}): Promise<FinishDeloadEarlyResult> {
  return prisma.$transaction((tx) => finishDeloadEarlyInTransaction(tx, input));
}

export async function loadActiveMesocycle(
  userId: string
): Promise<ResolvedActiveMesocycleWithBlocks | null> {
  const context = await resolveActivePlanContext(userId);
  if (
    context.status === "NO_SELECTED_PLAN" ||
    context.status === "HANDOFF_PENDING" ||
    context.status === "COMPLETED"
  ) {
    return null;
  }
  if (context.status !== "READY") {
    throw new Error(`ACTIVE_PLAN_CONTEXT_${context.status}`);
  }
  const mesocycle = context.activeMesocycle;
  const sessionCapacityReductionManifest =
    parseSlotPlanSeedJson(mesocycle.slotPlanSeedJson)?.acceptedPlannerIntent
      ?.sessionCapacityReductionManifest;
  const currentSeedPayload = mesocycle.currentSeedRevision?.seedPayload;
  const currentSeed = currentSeedPayload
    ? {
        payload: currentSeedPayload,
        normalized: normalizeAcceptedSeedPayload(currentSeedPayload),
      }
    : null;
  return {
    ...mesocycle,
    ...(sessionCapacityReductionManifest
      ? { sessionCapacityReductionManifest }
      : {}),
    slotPlanSeedJson: currentSeed
      ? currentSeed.normalized.payloadVersion === 3
        ? currentSeed.normalized.executablePayload as Prisma.JsonValue
        : currentSeed.payload
      : mesocycle.slotPlanSeedJson,
  };
}
