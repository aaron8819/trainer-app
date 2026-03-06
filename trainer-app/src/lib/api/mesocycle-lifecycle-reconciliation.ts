import type { MesocyclePhase, MesocycleState, Prisma } from "@prisma/client";
import { getAccumulationWeeks, getDeloadWeek } from "@/lib/api/mesocycle-lifecycle-math";
import { ADVANCEMENT_WORKOUT_STATUSES } from "@/lib/workout-status";

type MesocycleLifecycleTx = Prisma.TransactionClient;

type MesocycleLifecycleRecord = {
  id: string;
  durationWeeks: number;
  sessionsPerWeek: number;
  state: MesocycleState;
};

type AdvancingWorkoutSnapshot = {
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
      status: { in: [...ADVANCEMENT_WORKOUT_STATUSES] },
      advancesSplit: true,
    },
    select: {
      mesocyclePhaseSnapshot: true,
      mesocycleWeekSnapshot: true,
    },
  });

  let accumulationSessionsCompleted = 0;
  let deloadSessionsCompleted = 0;

  for (const workout of workouts) {
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

export async function reconcileMesocycleLifecycle(
  tx: MesocycleLifecycleTx,
  mesocycle: MesocycleLifecycleRecord
) {
  const nextLifecycle = await deriveReconciledMesocycleLifecycle(tx, mesocycle);

  return tx.mesocycle.update({
    where: { id: mesocycle.id },
    data: nextLifecycle,
  });
}
