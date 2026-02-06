import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import LogWorkoutClient from "@/components/LogWorkoutClient";
import { splitExercises } from "@/lib/ui/workout-sections";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export default async function LogWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;

  if (!resolvedParams?.id) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Missing workout id</h1>
          <Link className="mt-4 inline-block text-sm font-semibold text-slate-900" href="/">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const workout = await prisma.workout.findUnique({
    where: { id: resolvedParams.id },
    include: {
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: {
          exercise: true,
          sets: { orderBy: { setIndex: "asc" }, include: { logs: true } },
        },
      },
    },
  });

  if (!workout) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <h1 className="text-2xl font-semibold">Workout not found</h1>
          <Link className="mt-4 inline-block text-sm font-semibold text-slate-900" href="/">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const exercises = splitExercises(workout.exercises);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-500">Log Session</p>
            <h1 className="mt-2 text-3xl font-semibold">Workout Log</h1>
            <p className="mt-2 text-slate-600">Tap to log each set quickly.</p>
          </div>
          <Link
            className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold"
            href={`/workout/${workout.id}`}
          >
            View workout
          </Link>
        </div>

        <LogWorkoutClient workoutId={workout.id} exercises={exercises} />
      </div>
    </main>
  );
}
