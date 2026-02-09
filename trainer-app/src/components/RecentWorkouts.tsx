"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import DeleteWorkoutButton from "./DeleteWorkoutButton";

type WorkoutListItem = {
  id: string;
  scheduledDate: string;
  status: string;
  exercisesCount: number;
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

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Recent Workouts</h2>
        <span className="text-sm text-slate-500">Last 6 sessions</span>
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
                <p className="text-sm font-semibold">Workout {workout.id.slice(0, 8)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {new Date(workout.scheduledDate).toLocaleDateString()} · {workout.exercisesCount} exercises
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClasses[workout.status]}`}
                >
                  {statusLabels[workout.status] ?? workout.status}
                </span>
                <Link className="text-sm font-semibold text-slate-900" href={`/workout/${workout.id}`}>
                  View
                </Link>
                <Link className="text-sm font-semibold text-slate-900" href={`/log/${workout.id}`}>
                  Log
                </Link>
                <DeleteWorkoutButton workoutId={workout.id} onDeleted={handleDeleted} />
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
