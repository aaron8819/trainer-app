"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import DeleteWorkoutButton from "./DeleteWorkoutButton";
import { WorkoutRowActions } from "./workout/WorkoutRowActions";

type WorkoutListItem = {
  id: string;
  scheduledDate: string;
  status: string;
  sessionIntent: string | null;
  exercisesCount: number;
  mesocycleWeekSnapshot: number | null;
  mesoSessionSnapshot: number | null;
};

type StatusMap = {
  [key: string]: string;
};

type Props = {
  recentWorkouts: WorkoutListItem[];
  statusLabels: StatusMap;
  statusClasses: StatusMap;
};

export default function RecentWorkouts({
  recentWorkouts,
  statusLabels,
  statusClasses,
}: Props) {
  const router = useRouter();

  const handleDeleted = () => {
    router.refresh();
  };

  const formatSessionIntent = (intent: string) =>
    intent
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const countLabel = `${recentWorkouts.length} workout${recentWorkouts.length === 1 ? "" : "s"}`;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent Workouts</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{countLabel}</span>
          <Link className="text-sm font-semibold text-slate-900" href="/history">
            View all
          </Link>
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {recentWorkouts.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 p-6 text-sm text-slate-500">
            No workouts saved yet.
          </div>
        ) : (
          recentWorkouts.map((workout) => (
            <div
              key={workout.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 p-5"
            >
              <div>
                <p className="text-sm font-semibold">
                  {workout.sessionIntent ? formatSessionIntent(workout.sessionIntent) : "Workout"}
                  {workout.mesocycleWeekSnapshot != null ? (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                      Wk{workout.mesocycleWeekSnapshot}
                      {workout.mesoSessionSnapshot != null
                        ? `·S${workout.mesoSessionSnapshot}`
                        : ""}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(workout.scheduledDate).toLocaleDateString()} · {workout.exercisesCount}{" "}
                  exercises
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[workout.status]}`}
                >
                  {statusLabels[workout.status] ?? workout.status}
                </span>
                <WorkoutRowActions workout={workout} />
                <DeleteWorkoutButton workoutId={workout.id} onDeleted={handleDeleted} />
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
