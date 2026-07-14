import { WorkoutStatus, type Mesocycle, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { getAccumulationWeeks } from "./mesocycle-lifecycle-math";
import { enterMesocycleHandoffInTransaction } from "./mesocycle-handoff";

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
  currentSeedRevision?: {
    id: string;
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
      state: true,
      isActive: true,
      handoffSummaryJson: true,
      nextSeedDraftJson: true,
      closedAt: true,
    },
  });

  if (!mesocycle) {
    throw new Error("MESOCYCLE_FINISH_EARLY_NOT_FOUND");
  }
  if (mesocycle.state !== "ACTIVE_ACCUMULATION" || !mesocycle.isActive) {
    throw new Error("MESOCYCLE_FINISH_EARLY_INVALID_STATE");
  }
  if (mesocycle.handoffSummaryJson || mesocycle.nextSeedDraftJson || mesocycle.closedAt) {
    throw new Error("MESOCYCLE_FINISH_EARLY_HANDOFF_EXISTS");
  }

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

  const updated = await enterMesocycleHandoffInTransaction(tx, input.mesocycleId);
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
  });
  if (!mesocycle) {
    throw new Error(`Mesocycle not found: ${mesocycleId}`);
  }

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
  const updated = await enterMesocycleHandoffInTransaction(tx, mesocycle.id);
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
      state: true,
      isActive: true,
      handoffSummaryJson: true,
      nextSeedDraftJson: true,
      closedAt: true,
    },
  });

  if (!mesocycle) {
    throw new Error("MESOCYCLE_FINISH_DELOAD_NOT_FOUND");
  }
  if (mesocycle.state !== "ACTIVE_DELOAD") {
    throw new Error("MESOCYCLE_FINISH_DELOAD_INVALID_STATE");
  }
  if (!mesocycle.isActive) {
    throw new Error("MESOCYCLE_FINISH_DELOAD_INVALID_STATE");
  }
  if (mesocycle.handoffSummaryJson || mesocycle.nextSeedDraftJson || mesocycle.closedAt) {
    throw new Error("MESOCYCLE_FINISH_DELOAD_HANDOFF_EXISTS");
  }

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

  const updated = await enterMesocycleHandoffInTransaction(tx, input.mesocycleId);
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

export async function loadActiveMesocycle(userId: string): Promise<ActiveMesocycleWithBlocks | null> {
  const mesocycle = await prisma.mesocycle.findFirst({
    where: {
      isActive: true,
      macroCycle: { userId },
    },
    orderBy: [{ mesoNumber: "desc" }],
    include: {
      currentSeedRevision: {
        select: {
          id: true,
          revision: true,
          seedPayload: true,
          payloadHash: true,
          hashAlgorithm: true,
          provenanceStatus: true,
        },
      },
      seedRevisions: {
        orderBy: { revision: "asc" },
        select: {
          id: true,
          revision: true,
          payloadHash: true,
          provenanceStatus: true,
          creationReason: true,
          actorSource: true,
          sourceRevisionId: true,
          activatedAt: true,
        },
      },
      blocks: {
        orderBy: { blockNumber: "asc" },
      },
    },
  });
  if (!mesocycle) {
    return null;
  }
  return {
    ...mesocycle,
    slotPlanSeedJson:
      mesocycle.currentSeedRevision?.seedPayload ?? mesocycle.slotPlanSeedJson,
  };
}
