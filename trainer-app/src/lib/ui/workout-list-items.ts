import type { Prisma } from "@prisma/client";
import { buildWorkoutSessionSnapshotSummary } from "./workout-session-snapshot";

export const workoutListItemSelect = {
  id: true,
  scheduledDate: true,
  completedAt: true,
  status: true,
  selectionMode: true,
  sessionIntent: true,
  mesocycleId: true,
  mesocycleWeekSnapshot: true,
  mesoSessionSnapshot: true,
  mesocyclePhaseSnapshot: true,
  _count: { select: { exercises: true } },
  exercises: {
    select: {
      sets: {
        select: {
          _count: {
            select: {
              logs: { where: { wasSkipped: false } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.WorkoutSelect;

type WorkoutListItemRow = Prisma.WorkoutGetPayload<{
  select: typeof workoutListItemSelect;
}>;

export type WorkoutListSurfaceSummary = {
  id: string;
  scheduledDate: string;
  completedAt: string | null;
  status: string;
  selectionMode: string | null;
  sessionIntent: string | null;
  mesocycleId: string | null;
  sessionSnapshot: ReturnType<typeof buildWorkoutSessionSnapshotSummary>;
  exerciseCount: number;
  totalSetsLogged: number;
};

function countLoggedSets(row: WorkoutListItemRow): number {
  return row.exercises.flatMap((exercise) => exercise.sets).reduce((sum, set) => sum + set._count.logs, 0);
}

export function buildWorkoutListSurfaceSummary(
  row: WorkoutListItemRow
): WorkoutListSurfaceSummary {
  return {
    id: row.id,
    scheduledDate: row.scheduledDate.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    status: row.status,
    selectionMode: row.selectionMode,
    sessionIntent: row.sessionIntent ?? null,
    mesocycleId: row.mesocycleId ?? null,
    sessionSnapshot: buildWorkoutSessionSnapshotSummary({
      week: row.mesocycleWeekSnapshot,
      session: row.mesoSessionSnapshot,
      phase: row.mesocyclePhaseSnapshot,
    }),
    exerciseCount: row._count.exercises,
    totalSetsLogged: countLoggedSets(row),
  };
}
