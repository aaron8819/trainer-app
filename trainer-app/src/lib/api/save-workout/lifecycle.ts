import { WorkoutStatus, type Prisma } from "@prisma/client";
import { deriveCurrentMesocycleSession } from "@/lib/api/mesocycle-lifecycle-math";
import {
  claimSelectedPlanForTransitionInTransaction,
  completeOrEnterHandoffInTransaction,
  resolveActivePlanContextInTransaction,
  transitionMesocycleStateInTransaction,
  type TerminalTransitionLockProof,
} from "@/lib/api/mesocycle-lifecycle-state";
import {
  autoDismissPendingWeekCloseOnForwardProgress,
  evaluateWeekCloseAtBoundary,
} from "@/lib/api/mesocycle-week-close";
import {
  assertMesocycleAllowsWorkoutSave,
  type SaveRouteMesocycleState,
} from "./guards";
import {
  resolveV4ScheduledSlots,
  type V4ScheduleAuthority,
  type V4ScheduleResolution,
} from "../v4-scheduled-slot-resolution";

export type SaveRouteMesocycle = {
  id: string;
  state: SaveRouteMesocycleState;
  durationWeeks: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  sessionsPerWeek: number;
  slotSequenceJson?: Prisma.JsonValue | null;
  currentSeedRevisionId?: string | null;
  currentSeedRevision?: {
    id: string;
    mesocycleId: string;
    revision: number;
    seedPayload: Prisma.JsonValue;
    payloadHash: string | null;
    hashAlgorithm: string | null;
    provenanceStatus: string;
  } | null;
  startWeek?: number | null;
  macroCycle?: {
    startDate: Date;
    primaryGoal?: string | null;
  } | null;
};

type SelectedSaveRouteMesocycle = SaveRouteMesocycle & {
  macroCycleId: string;
};

export type SaveRouteMesoSnapshot = {
  week: number;
  phase: "ACCUMULATION" | "DELOAD";
  session: number;
};

export type WeekCloseResult = {
  weekCloseId: string | null;
  resolution:
    | "NO_GAP_FILL_NEEDED"
    | "GAP_FILL_COMPLETED"
    | "GAP_FILL_DISMISSED"
    | "AUTO_DISMISSED"
    | null;
  weekCloseState: {
    workflowState: "PENDING_OPTIONAL_GAP_FILL" | "COMPLETED";
    deficitState: "OPEN" | "PARTIAL" | "CLOSED";
    remainingDeficitSets: number;
  } | null;
};

export function deriveSaveRouteMesoSnapshot(
  mesocycle: SaveRouteMesocycle,
): SaveRouteMesoSnapshot {
  const session = deriveCurrentMesocycleSession(mesocycle);
  return {
    week: session.week,
    phase: session.phase,
    session: session.session,
  };
}

export function buildPerformedLifecycleCounterUpdate(
  state: SaveRouteMesocycleState,
): {
  completedSessions: { increment: 1 };
  accumulationSessionsCompleted?: { increment: 1 };
  deloadSessionsCompleted?: { increment: 1 };
} {
  if (state === "AWAITING_HANDOFF" || state === "COMPLETED") {
    throw new Error(
      `Cannot advance lifecycle counters for mesocycle state ${state}`,
    );
  }

  return state === "ACTIVE_DELOAD"
    ? {
        completedSessions: { increment: 1 },
        deloadSessionsCompleted: { increment: 1 },
      }
    : {
        completedSessions: { increment: 1 },
        accumulationSessionsCompleted: { increment: 1 },
      };
}

export function deriveAccumulationBoundaryAfterPerformedSave(input: {
  state: SaveRouteMesocycleState;
  accumulationSessionsCompleted: number;
  sessionsPerWeek: number;
}): { crossesBoundary: boolean; targetWeek: number | null } {
  if (input.state !== "ACTIVE_ACCUMULATION") {
    return { crossesBoundary: false, targetWeek: null };
  }

  const sessionsPerWeek = Math.max(1, input.sessionsPerWeek);
  const nextAccumulationCount = input.accumulationSessionsCompleted + 1;
  const crossesBoundary = nextAccumulationCount % sessionsPerWeek === 0;

  return {
    crossesBoundary,
    targetWeek: crossesBoundary
      ? nextAccumulationCount / sessionsPerWeek
      : null,
  };
}

export function shouldAdvanceLifecycleForPerformedTransition(
  advancesSplit: boolean | null | undefined,
): boolean {
  return advancesSplit !== false;
}

export function resolvePersistedAdvancesSplit(input: {
  persistedAdvancesSplit: boolean | null | undefined;
  requestAdvancesSplit: boolean | null | undefined;
}): boolean | undefined {
  if (input.persistedAdvancesSplit != null) {
    return input.persistedAdvancesSplit;
  }
  return input.requestAdvancesSplit ?? undefined;
}

export function resolveGapFillSnapshot(input: {
  existingWorkout: {
    mesocycleWeekSnapshot: number | null;
    mesocyclePhaseSnapshot: string | null;
    mesoSessionSnapshot: number | null;
  } | null;
  receiptWeek: number | undefined;
  requestWeek: number | undefined;
  sessionsPerWeek: number;
}): { week: number; phase: "ACCUMULATION"; session: number } | undefined {
  const anchorWeek =
    input.existingWorkout?.mesocycleWeekSnapshot ??
    input.requestWeek ??
    input.receiptWeek;
  if (anchorWeek == null) {
    return undefined;
  }

  return {
    week: anchorWeek,
    phase: "ACCUMULATION",
    session:
      input.existingWorkout?.mesoSessionSnapshot ?? input.sessionsPerWeek + 1,
  };
}

const mesocycleSelect = {
  id: true,
  macroCycleId: true,
  state: true,
  durationWeeks: true,
  accumulationSessionsCompleted: true,
  deloadSessionsCompleted: true,
  sessionsPerWeek: true,
  slotSequenceJson: true,
  currentSeedRevisionId: true,
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
  startWeek: true,
  macroCycle: {
    select: {
      startDate: true,
      primaryGoal: true,
    },
  },
} as const;

async function readV4ScheduleWorkoutEvidence(
  tx: Prisma.TransactionClient,
  mesocycleId: string,
) {
  return tx.workout.findMany({
    where: { mesocycleId },
    orderBy: [{ mesocycleWeekSnapshot: "asc" }, { mesoSessionSnapshot: "asc" }, { id: "asc" }],
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
      seedRevisionId: true,
      seedRevisionNumber: true,
      seedPayloadHash: true,
    },
  });
}

export async function resolveV4ScheduleBeforeWorkoutCreation(
  tx: Prisma.TransactionClient,
  input: {
    authority: V4ScheduleAuthority;
    requiredSlot: { weekInMeso: number; slotId: string };
  },
): Promise<void> {
  const resolution = resolveV4ScheduledSlots({
    authority: input.authority,
    workouts: await readV4ScheduleWorkoutEvidence(
      tx,
      input.authority.mesocycleId,
    ),
  });
  if (resolution.status === "blocked") {
    throw new Error(`V4_SCHEDULE_RESOLUTION_BLOCKED:${resolution.reason}`);
  }
  if (
    resolution.claims.some(
      (claim) =>
        claim.requiredSlot.weekInMeso === input.requiredSlot.weekInMeso &&
        claim.requiredSlot.slotId === input.requiredSlot.slotId,
    )
  ) {
    throw new Error("V4_SCHEDULE_SLOT_ALREADY_MATERIALIZED");
  }
  if (
    resolution.nextUnresolvedSlot?.weekInMeso !== input.requiredSlot.weekInMeso ||
    !resolution.unresolvedSlotsInNextWeek.some(
      (slot) => slot.slotId === input.requiredSlot.slotId,
    )
  ) {
    throw new Error("V4_SCHEDULE_SLOT_NOT_ELIGIBLE");
  }
}

export async function applyV4TerminalScheduleResolution(
  tx: Prisma.TransactionClient,
  input: {
    resolvedMesocycle: SaveRouteMesocycle;
    authority: V4ScheduleAuthority;
    finalStatus: "COMPLETED" | "SKIPPED";
    terminalLock: TerminalTransitionLockProof;
  },
): Promise<V4ScheduleResolution> {
  if (input.finalStatus === WorkoutStatus.COMPLETED) {
    await tx.mesocycle.update({
      where: { id: input.resolvedMesocycle.id },
      data: buildPerformedLifecycleCounterUpdate(
        input.resolvedMesocycle.state,
      ),
    });
  }

  const resolution = resolveV4ScheduledSlots({
    authority: input.authority,
    workouts: await readV4ScheduleWorkoutEvidence(
      tx,
      input.resolvedMesocycle.id,
    ),
  });
  if (resolution.status === "blocked") {
    throw new Error(`V4_SCHEDULE_RESOLUTION_BLOCKED:${resolution.reason}`);
  }

  if (
    (input.resolvedMesocycle.state === "ACTIVE_ACCUMULATION" ||
      input.resolvedMesocycle.state === "ACTIVE_DELOAD") &&
    resolution.allResolved
  ) {
    await completeOrEnterHandoffInTransaction(
      tx,
      {
        id: input.resolvedMesocycle.id,
        state: input.resolvedMesocycle.state,
        macroCycle: input.resolvedMesocycle.macroCycle,
        currentSeedRevision: input.resolvedMesocycle.currentSeedRevision,
      },
      input.terminalLock,
    );
  } else if (
    input.resolvedMesocycle.state === "ACTIVE_ACCUMULATION" &&
    resolution.allAccumulationResolved
  ) {
    const advanced = await tx.mesocycle.updateMany({
      where: {
        id: input.resolvedMesocycle.id,
        state: "ACTIVE_ACCUMULATION",
        currentSeedRevisionId: input.authority.revisionId,
      },
      data: { state: "ACTIVE_DELOAD" },
    });
    if (advanced.count !== 1) {
      throw new Error("V4_SCHEDULE_AUTHORITY_CONFLICT");
    }
  }

  return resolution;
}

export async function resolveMesocycleForWorkoutSave(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    existingMesocycleId?: string | null;
    shouldResolve: boolean;
    shouldRequireForPerformedTransition: boolean;
    claimSelectedPlan?: boolean;
  },
): Promise<{
  resolvedMesocycleId: string | null;
  resolvedMesocycle: SelectedSaveRouteMesocycle | null;
}> {
  let resolvedMesocycleId = input.existingMesocycleId ?? null;
  let resolvedMesocycle: SelectedSaveRouteMesocycle | null = null;

  if (!input.shouldResolve) {
    return { resolvedMesocycleId, resolvedMesocycle };
  }

  if (resolvedMesocycleId) {
    resolvedMesocycle = await tx.mesocycle.findUnique({
      where: { id: resolvedMesocycleId },
      select: mesocycleSelect,
    });
  } else {
    const context = await resolveActivePlanContextInTransaction(
      tx,
      input.userId
    );
    if (context.status === "CORRUPT_STATE") {
      throw new Error(`ACTIVE_PLAN_CONTEXT_CORRUPT_STATE:${context.reason}`);
    }
    resolvedMesocycle =
      context.status === "READY" ? context.activeMesocycle : null;
    resolvedMesocycleId = resolvedMesocycle?.id ?? null;
  }

  if (resolvedMesocycle) {
    assertMesocycleAllowsWorkoutSave(resolvedMesocycle.state);
    if (input.claimSelectedPlan !== false) {
      await claimSelectedPlanForTransitionInTransaction(tx, {
        userId: input.userId,
        macroCycleId: resolvedMesocycle.macroCycleId,
      });
    }
  }

  if (
    input.shouldRequireForPerformedTransition &&
    (!resolvedMesocycleId || !resolvedMesocycle)
  ) {
    throw new Error("ACTIVE_MESOCYCLE_NOT_FOUND");
  }

  return { resolvedMesocycleId, resolvedMesocycle };
}

export function deriveMesoSnapshotForSave(input: {
  shouldSetMesoSnapshot: boolean;
  resolvedMesocycle: SaveRouteMesocycle | null;
  existingWorkout: {
    mesocycleWeekSnapshot: number | null;
    mesocyclePhaseSnapshot: string | null;
    mesoSessionSnapshot: number | null;
  } | null;
  isOptionalGapFill: boolean;
  receiptWeek?: number;
  requestWeek?: number;
}): SaveRouteMesoSnapshot | undefined {
  if (!input.shouldSetMesoSnapshot || !input.resolvedMesocycle) {
    return undefined;
  }

  let mesoSnapshot = deriveSaveRouteMesoSnapshot(input.resolvedMesocycle);
  if (input.existingWorkout?.mesocycleWeekSnapshot != null) {
    mesoSnapshot = {
      week: input.existingWorkout.mesocycleWeekSnapshot,
      phase:
        (input.existingWorkout.mesocyclePhaseSnapshot as
          | "ACCUMULATION"
          | "DELOAD"
          | null
          | undefined) ?? mesoSnapshot.phase,
      session:
        input.existingWorkout.mesoSessionSnapshot ?? mesoSnapshot.session,
    };
  }
  if (input.isOptionalGapFill) {
    return (
      resolveGapFillSnapshot({
        existingWorkout: input.existingWorkout,
        receiptWeek: input.receiptWeek,
        requestWeek: input.requestWeek,
        sessionsPerWeek: input.resolvedMesocycle.sessionsPerWeek,
      }) ?? mesoSnapshot
    );
  }

  return mesoSnapshot;
}

export async function applyPerformedLifecycleSideEffects(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    scheduledDate: Date;
    resolvedMesocycleId: string;
    resolvedMesocycle: SaveRouteMesocycle;
    mesoSnapshot?: SaveRouteMesoSnapshot;
    isOptionalGapFill: boolean;
  },
): Promise<WeekCloseResult | null> {
  await tx.mesocycle.update({
    where: { id: input.resolvedMesocycleId },
    data: buildPerformedLifecycleCounterUpdate(input.resolvedMesocycle.state),
  });

  const boundaryProgression = deriveAccumulationBoundaryAfterPerformedSave({
    state: input.resolvedMesocycle.state,
    accumulationSessionsCompleted:
      input.resolvedMesocycle.accumulationSessionsCompleted,
    sessionsPerWeek: input.resolvedMesocycle.sessionsPerWeek,
  });
  if (boundaryProgression.crossesBoundary && !input.isOptionalGapFill) {
    const boundaryResult = await evaluateWeekCloseAtBoundary(tx, {
      userId: input.userId,
      mesocycle: {
        id: input.resolvedMesocycle.id,
        durationWeeks: input.resolvedMesocycle.durationWeeks,
        sessionsPerWeek: input.resolvedMesocycle.sessionsPerWeek,
        startWeek: input.resolvedMesocycle.startWeek ?? 0,
        macroCycle: {
          startDate:
            input.resolvedMesocycle.macroCycle?.startDate ??
            input.scheduledDate,
        },
      },
      targetWeek: boundaryProgression.targetWeek!,
      targetPhase: "ACCUMULATION",
    });
    return {
      weekCloseId: boundaryResult.weekCloseId,
      resolution: boundaryResult.resolution,
      weekCloseState: boundaryResult.weekCloseState,
    };
  }

  const autoDismissResult = !input.isOptionalGapFill
    ? await autoDismissPendingWeekCloseOnForwardProgress(tx, {
        mesocycleId: input.resolvedMesocycleId,
        workoutWeek: input.mesoSnapshot?.week,
      })
    : null;
  if (autoDismissResult && autoDismissResult.weekCloseId) {
    return {
      weekCloseId: autoDismissResult.weekCloseId,
      resolution: autoDismissResult.resolution,
      weekCloseState: autoDismissResult.weekCloseState,
    };
  }
  if (
    !autoDismissResult ||
    autoDismissResult.outcome === "not_found" ||
    autoDismissResult.outcome === "not_applicable"
  ) {
    await transitionMesocycleStateInTransaction(tx, input.resolvedMesocycleId);
  }

  return null;
}

export function buildWeekCloseResponse(result: WeekCloseResult | null) {
  if (!result) {
    return undefined;
  }

  return {
    weekCloseId: result.weekCloseId,
    resolution: result.resolution,
    workflowState: result.weekCloseState?.workflowState ?? null,
    deficitState: result.weekCloseState?.deficitState ?? null,
    remainingDeficitSets: result.weekCloseState?.remainingDeficitSets ?? null,
  };
}
