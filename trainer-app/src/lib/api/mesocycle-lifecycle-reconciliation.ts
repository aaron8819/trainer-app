import type { MesocyclePhase, MesocycleState, Prisma } from "@prisma/client";
import { getAccumulationWeeks, getDeloadWeek } from "@/lib/api/mesocycle-lifecycle-math";
import { ADVANCEMENT_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  resolveStrictFrozenLegacyAuthoredScheduleLifecycle,
  transitionMesocycleStateInTransaction,
  type LegacyAuthoredScheduleWorkout,
} from "@/lib/api/mesocycle-lifecycle-state";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import {
  resolveV4ScheduleAuthority,
  type V4ScheduleAuthorityInput,
} from "@/lib/api/v4-scheduled-slot-resolution";

type MesocycleLifecycleTx = Prisma.TransactionClient;

type MesocycleLifecycleRecord = {
  id: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  state: MesocycleState;
  completedSessions: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  slotSequenceJson?: unknown;
  currentSeedRevisionId?: string | null;
  currentSeedRevision?:
    | {
        seedPayload: unknown;
        id?: string;
        mesocycleId?: string;
        revision?: number;
        payloadHash?: string | null;
        hashAlgorithm?: string | null;
        provenanceStatus?: string;
      }
    | null;
};

type AdvancingWorkoutSnapshot = LegacyAuthoredScheduleWorkout & {
  mesocyclePhaseSnapshot: MesocyclePhase | null;
  mesocycleWeekSnapshot: number | null;
};

export type ReconciledMesocycleLifecycle = {
  completedSessions: number;
  accumulationSessionsCompleted: number;
  deloadSessionsCompleted: number;
  state: MesocycleState;
};

export type ClosedHandoffDeletionAssessment =
  | { safe: true }
  | {
      safe: false;
      reason:
        | "strict_identity_blocked"
        | "authored_obligation_unresolved"
        | "v4_authority_blocked";
    };

function resolveReconciliationV4Authority(
  mesocycle: MesocycleLifecycleRecord,
) {
  const resolution = resolveV4ScheduleAuthority(
    mesocycle as V4ScheduleAuthorityInput,
  );
  if (resolution.status === "blocked") {
    throw new Error(`V4_SCHEDULE_RESOLUTION_BLOCKED:${resolution.reason}`);
  }
  return resolution;
}

function isDeloadWorkout(
  workout: AdvancingWorkoutSnapshot,
  mesocycleDurationWeeks: number
): boolean {
  if (workout.mesocyclePhaseSnapshot === "DELOAD") {
    return true;
  }

  if (workout.mesocycleWeekSnapshot == null) {
    return false;
  }

  return workout.mesocycleWeekSnapshot >= getDeloadWeek(mesocycleDurationWeeks);
}

export async function deriveReconciledMesocycleLifecycle(
  tx: MesocycleLifecycleTx,
  mesocycle: MesocycleLifecycleRecord
): Promise<ReconciledMesocycleLifecycle> {
  resolveReconciliationV4Authority(mesocycle);
  const workouts = await tx.workout.findMany({
    where: {
      mesocycleId: mesocycle.id,
    },
    select: {
      id: true,
      status: true,
      mesocycleId: true,
      mesocyclePhaseSnapshot: true,
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
      advancesSplit: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
    },
  });

  const legacyResolution = resolveStrictFrozenLegacyAuthoredScheduleLifecycle({
    mesocycle,
    workouts,
  });

  if (legacyResolution.status === "available") {
    const state: MesocycleState = legacyResolution.allResolved
      ? mesocycle.state
      : legacyResolution.allAccumulationResolved
        ? "ACTIVE_DELOAD"
        : "ACTIVE_ACCUMULATION";
    return {
      completedSessions: legacyResolution.performedCompletionCount,
      accumulationSessionsCompleted:
        legacyResolution.accumulationCompletionCount,
      deloadSessionsCompleted: legacyResolution.deloadCompletionCount,
      state,
    };
  }

  if (legacyResolution.status === "blocked") {
    return {
      completedSessions: mesocycle.completedSessions,
      accumulationSessionsCompleted:
        mesocycle.accumulationSessionsCompleted,
      deloadSessionsCompleted: mesocycle.deloadSessionsCompleted,
      state: mesocycle.state,
    };
  }

  // For `unavailable`, this is HISTORICAL_RECEIPTLESS_COUNTER_COMPATIBILITY:
  // it retains the old counter rebuild without inferring authored obligations,
  // so final-skip closure is not guaranteed. `not_legacy` retains the existing
  // non-strict (including V4 deletion) reconciliation behavior unchanged.
  let accumulationSessionsCompleted = 0;
  let deloadSessionsCompleted = 0;

  for (const workout of workouts) {
    const semantics = deriveSessionSemantics({
      advancesSplit: workout.advancesSplit,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      selectionMetadata: workout.selectionMetadata,
      mesocyclePhase: workout.mesocyclePhaseSnapshot,
    });
    if (
      !(ADVANCEMENT_WORKOUT_STATUSES as readonly string[]).includes(
        String(workout.status),
      ) ||
      !semantics.advancesLifecycle ||
      semantics.isStrictGapFill ||
      semantics.isStrictSupplemental ||
      semantics.isCloseout
    ) {
      continue;
    }
    if (isDeloadWorkout(workout, mesocycle.durationWeeks)) {
      deloadSessionsCompleted += 1;
      continue;
    }

    accumulationSessionsCompleted += 1;
  }

  const accumulationThreshold =
    getAccumulationWeeks(mesocycle.durationWeeks) * Math.max(1, mesocycle.sessionsPerWeek);
  const deloadThreshold = Math.max(1, mesocycle.sessionsPerWeek);

  let state: MesocycleState = "ACTIVE_ACCUMULATION";
  if (deloadSessionsCompleted >= deloadThreshold) {
    state = "COMPLETED";
  } else if (accumulationSessionsCompleted >= accumulationThreshold) {
    state = "ACTIVE_DELOAD";
  }

  return {
    completedSessions: accumulationSessionsCompleted + deloadSessionsCompleted,
    accumulationSessionsCompleted,
    deloadSessionsCompleted,
    state,
  };
}

export async function assessClosedHandoffDeletionInTransaction(
  tx: MesocycleLifecycleTx,
  mesocycle: MesocycleLifecycleRecord,
): Promise<ClosedHandoffDeletionAssessment> {
  const v4Authority = resolveV4ScheduleAuthority(
    mesocycle as V4ScheduleAuthorityInput,
  );
  if (v4Authority.status === "blocked") {
    return { safe: false, reason: "v4_authority_blocked" };
  }
  if (v4Authority.status === "available") {
    return { safe: true };
  }
  const workouts = await tx.workout.findMany({
    where: { mesocycleId: mesocycle.id },
    select: {
      id: true,
      status: true,
      mesocycleId: true,
      mesocyclePhaseSnapshot: true,
      mesocycleWeekSnapshot: true,
      mesoSessionSnapshot: true,
      advancesSplit: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
    },
  });
  const strictResolution =
    resolveStrictFrozenLegacyAuthoredScheduleLifecycle({
      mesocycle,
      workouts,
    });
  if (strictResolution.status === "blocked") {
    return { safe: false, reason: "strict_identity_blocked" };
  }
  if (strictResolution.status === "available") {
    return strictResolution.allResolved
      ? { safe: true }
      : { safe: false, reason: "authored_obligation_unresolved" };
  }

  const postDeleteLifecycle = await deriveReconciledMesocycleLifecycle(
    tx,
    mesocycle,
  );
  return postDeleteLifecycle.state === "ACTIVE_ACCUMULATION" ||
    postDeleteLifecycle.state === "ACTIVE_DELOAD"
    ? { safe: false, reason: "authored_obligation_unresolved" }
    : { safe: true };
}

export async function reconcileMesocycleLifecycle(
  tx: MesocycleLifecycleTx,
  mesocycle: MesocycleLifecycleRecord
) {
  const authority = await tx.mesocycle.findUnique({
    where: { id: mesocycle.id },
    select: {
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
    },
  });
  const authoritativeMesocycle = {
    ...mesocycle,
    slotSequenceJson: authority?.slotSequenceJson,
    currentSeedRevisionId: authority?.currentSeedRevisionId,
    currentSeedRevision: authority?.currentSeedRevision,
  };
  const v4Authority = resolveReconciliationV4Authority(
    authoritativeMesocycle,
  );
  const nextLifecycle = await deriveReconciledMesocycleLifecycle(
    tx,
    authoritativeMesocycle,
  );

  const updated = await tx.mesocycle.update({
    where: { id: mesocycle.id },
    data: nextLifecycle,
  });
  if (
    authority?.slotSequenceJson != null &&
    v4Authority.status === "not_v4" &&
    (nextLifecycle.state === "ACTIVE_ACCUMULATION" ||
      nextLifecycle.state === "ACTIVE_DELOAD")
  ) {
    return (
      await transitionMesocycleStateInTransaction(tx, mesocycle.id)
    ).mesocycle;
  }
  return updated;
}
