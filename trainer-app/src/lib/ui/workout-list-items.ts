import type { Prisma } from "@prisma/client";
import { buildWorkoutSessionSnapshotSummary } from "./workout-session-snapshot";
import {
  formatGapFillMuscleList,
  isGapFillWorkout,
  resolveGapFillTargetMuscles,
} from "./gap-fill";
import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { isStrictSupplementalDeficitSession } from "@/lib/session-semantics/supplemental-classifier";

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
  selectionMetadata: true,
  mesocycle: {
    select: {
      sessionsPerWeek: true,
    },
  },
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
  isGapFill?: boolean;
  isSupplementalDeficitSession?: boolean;
  gapFillTargetMuscles?: string[];
  exerciseCount: number;
  totalSetsLogged: number;
};

export const WORKOUT_LIST_STATUS_OPTIONS = [
  "COMPLETED",
  "PARTIAL",
  "SKIPPED",
  "PLANNED",
] as const;

const WORKOUT_LIST_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  PARTIAL: "Partial",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
};

const WORKOUT_LIST_STATUS_CLASSES: Record<string, string> = {
  COMPLETED: "bg-emerald-50 text-emerald-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  PARTIAL: "bg-orange-50 text-orange-700",
  SKIPPED: "bg-slate-100 text-slate-600",
  PLANNED: "bg-slate-100 text-slate-700",
};

export function formatWorkoutListIntentLabel(intent: string | null | undefined): string {
  if (!intent) {
    return "Workout";
  }

  return intent
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function getWorkoutListPrimaryLabel(workout: Pick<WorkoutListSurfaceSummary, "isGapFill" | "sessionIntent">): string {
  return workout.isGapFill ? "Gap Fill" : formatWorkoutListIntentLabel(workout.sessionIntent);
}

export function getWorkoutListSecondaryLabel(workout: Pick<WorkoutListSurfaceSummary, "isGapFill" | "gapFillTargetMuscles">): string | null {
  if (!workout.isGapFill) {
    return null;
  }
  if (!workout.gapFillTargetMuscles || workout.gapFillTargetMuscles.length === 0) {
    return null;
  }
  return formatGapFillMuscleList(workout.gapFillTargetMuscles);
}

export function getWorkoutListStatusLabel(status: string): string {
  return WORKOUT_LIST_STATUS_LABELS[status] ?? status;
}

export function getWorkoutListStatusClasses(status: string): string {
  return WORKOUT_LIST_STATUS_CLASSES[status] ?? "bg-slate-100 text-slate-600";
}

export function formatWorkoutListExerciseLabel(exerciseCount: number): string {
  return `${exerciseCount} exercise${exerciseCount === 1 ? "" : "s"}`;
}

export function formatWorkoutListLoggedSetsLabel(totalSetsLogged: number): string {
  return `${totalSetsLogged} set${totalSetsLogged === 1 ? "" : "s"} logged`;
}

function countLoggedSets(row: WorkoutListItemRow): number {
  return row.exercises.flatMap((exercise) => exercise.sets).reduce((sum, set) => sum + set._count.logs, 0);
}

export function buildWorkoutListSurfaceSummary(
  row: WorkoutListItemRow
): WorkoutListSurfaceSummary {
  const isGapFill = isGapFillWorkout({
    selectionMetadata: row.selectionMetadata,
    selectionMode: row.selectionMode,
    sessionIntent: row.sessionIntent,
  });
  const isSupplementalDeficit = isStrictSupplementalDeficitSession({
    selectionMetadata: row.selectionMetadata,
    selectionMode: row.selectionMode,
    sessionIntent: row.sessionIntent,
  });
  const receipt = readSessionDecisionReceipt(row.selectionMetadata);
  const displayWeek = row.mesocycleWeekSnapshot ?? receipt?.cycleContext.weekInMeso ?? null;
  const displaySession =
    displayWeek == null
      ? null
      : row.mesoSessionSnapshot ?? null;
  const displayPhase = row.mesocyclePhaseSnapshot ?? receipt?.cycleContext.phase?.toUpperCase() ?? null;
  const gapFillTargetMuscles = resolveGapFillTargetMuscles({
    selectionMetadata: row.selectionMetadata,
  });

  return {
    id: row.id,
    scheduledDate: row.scheduledDate.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    status: row.status,
    selectionMode: row.selectionMode,
    sessionIntent: row.sessionIntent ?? null,
    mesocycleId: row.mesocycleId ?? null,
    sessionSnapshot: buildWorkoutSessionSnapshotSummary({
      week: displayWeek,
      session: displaySession,
      phase: displayPhase,
    }),
    isGapFill,
    isSupplementalDeficitSession: isSupplementalDeficit,
    gapFillTargetMuscles,
    exerciseCount: row._count.exercises,
    totalSetsLogged: countLoggedSets(row),
  };
}
