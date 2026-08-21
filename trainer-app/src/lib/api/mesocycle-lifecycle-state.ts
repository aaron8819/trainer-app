import {
  WorkoutStatus,
  type MacroCycle,
  type Mesocycle,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
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
