import type { MesocyclePhase, MesocycleState, Prisma } from "@prisma/client";
import { getAccumulationWeeks, getDeloadWeek } from "@/lib/api/mesocycle-lifecycle-math";
import { ADVANCEMENT_WORKOUT_STATUSES } from "@/lib/workout-status";
import {
  resolveLegacyAuthoredScheduleLifecycle,
  transitionMesocycleStateInTransaction,
  type LegacyAuthoredScheduleWorkout,
} from "@/lib/api/mesocycle-lifecycle-state";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";

type MesocycleLifecycleTx = Prisma.TransactionClient;

type MesocycleLifecycleRecord = {
  id: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  state: MesocycleState;
  slotSequenceJson?: Prisma.JsonValue | null;
  currentSeedRevision?: { seedPayload: Prisma.JsonValue } | null;
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

  const legacyResolution = resolveLegacyAuthoredScheduleLifecycle({
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

  if (legacyResolution.status === "blocked") {
    return {
      completedSessions:
        accumulationSessionsCompleted + deloadSessionsCompleted,
      accumulationSessionsCompleted,
      deloadSessionsCompleted,
      state: mesocycle.state,
    };
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

export async function reconcileMesocycleLifecycle(
  tx: MesocycleLifecycleTx,
  mesocycle: MesocycleLifecycleRecord
) {
  const authority = await tx.mesocycle.findUnique({
    where: { id: mesocycle.id },
    select: {
      slotSequenceJson: true,
      currentSeedRevision: { select: { seedPayload: true } },
    },
  });
  const nextLifecycle = await deriveReconciledMesocycleLifecycle(tx, {
    ...mesocycle,
    slotSequenceJson: authority?.slotSequenceJson,
    currentSeedRevision: authority?.currentSeedRevision,
  });

  const updated = await tx.mesocycle.update({
    where: { id: mesocycle.id },
    data: nextLifecycle,
  });
  const seedPayload = authority?.currentSeedRevision?.seedPayload;
  const isV4 =
    seedPayload != null &&
    typeof seedPayload === "object" &&
    !Array.isArray(seedPayload) &&
    "version" in seedPayload &&
    seedPayload.version === 4;
  if (
    authority?.slotSequenceJson != null &&
    !isV4 &&
    (nextLifecycle.state === "ACTIVE_ACCUMULATION" ||
      nextLifecycle.state === "ACTIVE_DELOAD")
  ) {
    return (
      await transitionMesocycleStateInTransaction(tx, mesocycle.id)
    ).mesocycle;
  }
  return updated;
}
