"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import DeleteWorkoutButton from "./DeleteWorkoutButton";
import { WorkoutRowActions } from "./workout/WorkoutRowActions";
import {
  formatWorkoutListExerciseLabel,
  getWorkoutListDisplayStatusClasses,
  getWorkoutListDisplayStatusLabel,
  getWorkoutListDebugLabel,
  getWorkoutListPrimaryLabel,
  getWorkoutListSecondaryLabel,
  type WorkoutListSurfaceSummary,
} from "@/lib/ui/workout-list-items";
import {
  formatWorkoutSessionSnapshotLabel,
} from "@/lib/ui/workout-session-snapshot";

type Props = {
  recentWorkouts: WorkoutListSurfaceSummary[];
  heading?: string;
  showCount?: boolean;
  showDeleteActions?: boolean;
  viewAllLabel?: string;
};

export default function RecentWorkouts({
  recentWorkouts,
  heading = "Recent Workouts",
  showCount = true,
  showDeleteActions = true,
  viewAllLabel = "View all",
}: Props) {
  const router = useRouter();

  const handleDeleted = () => {
    router.refresh();
  };

  const countLabel = `${recentWorkouts.length} workout${recentWorkouts.length === 1 ? "" : "s"}`;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <div className="flex items-center gap-3">
          {showCount ? <span className="text-sm text-slate-500">{countLabel}</span> : null}
          <Link className="text-sm font-semibold text-slate-900" href="/history">
            {viewAllLabel}
          </Link>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {recentWorkouts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">
            No workouts saved yet.
          </div>
        ) : (
          recentWorkouts.map((workout) => {
            const sessionSnapshotLabel = formatWorkoutSessionSnapshotLabel(
              workout.sessionSnapshot
            );
            const secondaryLabel = getWorkoutListSecondaryLabel(workout);
            const debugLabel = getWorkoutListDebugLabel(workout);

            return (
              <div
                key={workout.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 p-5"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {getWorkoutListPrimaryLabel(workout)}
                    {sessionSnapshotLabel ? (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                        {sessionSnapshotLabel}
                      </span>
                    ) : null}
                    {workout.isDeload ? (
                      <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">
                        Deload
                      </span>
                    ) : null}
                    {workout.isSupplementalDeficitSession ? (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        Supplemental
                      </span>
                    ) : null}
                  </p>
                  {secondaryLabel ? (
                    <p className="mt-1 text-xs text-slate-600">{secondaryLabel}</p>
                  ) : null}
                  {debugLabel ? (
                    <p className="mt-1 text-xs text-slate-500">{debugLabel}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(workout.scheduledDate).toLocaleDateString()} |{" "}
                    {formatWorkoutListExerciseLabel(workout.exerciseCount)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${getWorkoutListDisplayStatusClasses(workout)}`}
                  >
                    {getWorkoutListDisplayStatusLabel(workout)}
                  </span>
                  <WorkoutRowActions workout={workout} />
                  {showDeleteActions ? (
                    <DeleteWorkoutButton workoutId={workout.id} onDeleted={handleDeleted} />
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
