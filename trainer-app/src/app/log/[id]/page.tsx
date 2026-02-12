import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
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
        <div className="page-shell max-w-4xl">
          <h1 className="text-2xl font-semibold">Missing workout id</h1>
          <Link className="mt-4 inline-block text-sm font-semibold text-slate-900" href="/">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  const owner = await resolveOwner();
  const workout = await prisma.workout.findFirst({
    where: { id: resolvedParams.id, userId: owner.id },
    include: {
      exercises: {
        orderBy: { orderIndex: "asc" },
        include: {
          exercise: {
            include: {
              exerciseEquipment: {
                include: {
                  equipment: true,
                },
              },
            },
          },
          sets: { orderBy: { setIndex: "asc" }, include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } } },
        },
      },
    },
  });

  if (!workout) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-4xl">
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
      <div className="page-shell max-w-4xl">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-500">Log Session</p>
            <h1 className="page-title mt-1.5">Workout Log</h1>
            <p className="mt-1.5 text-sm text-slate-600">Tap to log each set quickly.</p>
          </div>
          <Link
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold sm:w-auto"
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
