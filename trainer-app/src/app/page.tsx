import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import {
  loadWorkoutContext,
  mapConstraints,
  mapExercises,
  mapHistory,
  resolveOwner,
} from "@/lib/api/workout-context";
import { getSplitPreview } from "@/lib/api/split-preview";
import { DashboardGenerateSection } from "@/components/DashboardGenerateSection";
import RecentWorkouts from "@/components/RecentWorkouts";
import { loadTemplatesWithScores } from "@/lib/api/templates";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
};

const STATUS_CLASSES: Record<string, string> = {
  COMPLETED: "bg-emerald-50 text-emerald-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  SKIPPED: "bg-slate-100 text-slate-600",
  PLANNED: "bg-slate-100 text-slate-700",
};

export default async function Home() {
  const owner = await resolveOwner();
  const [latestWorkout, latestCompleted, latestIncomplete, recentWorkouts, templates, context] =
    await Promise.all([
      prisma.workout.findFirst({
        where: { userId: owner.id },
        orderBy: { scheduledDate: "desc" },
        include: {
          exercises: {
            orderBy: { orderIndex: "asc" },
            include: { exercise: true },
          },
        },
      }),
      prisma.workout.findFirst({
        where: { userId: owner.id, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
      }),
      prisma.workout.findFirst({
        where: { userId: owner.id, status: { in: ["PLANNED", "IN_PROGRESS"] } },
        orderBy: { scheduledDate: "desc" },
      }),
      prisma.workout.findMany({
        where: { userId: owner.id },
        orderBy: { scheduledDate: "desc" },
        take: 6,
        include: {
          exercises: {
            orderBy: { orderIndex: "asc" },
            include: { exercise: true },
          },
        },
      }),
      loadTemplatesWithScores(owner.id),
      loadWorkoutContext(owner.id),
    ]);

  const splitPreview = context.constraints
    ? getSplitPreview(
        mapConstraints(context.constraints),
        mapHistory(context.workouts),
        mapExercises(context.exercises)
      )
    : undefined;

  const nextSessionName = latestWorkout
    ? latestWorkout.exercises
        .slice(0, 3)
        .map((exercise) => exercise.exercise.name)
        .join(", ")
    : "No saved workouts yet";

  const recentList = recentWorkouts.map((workout) => ({
    id: workout.id,
    scheduledDate: workout.scheduledDate.toISOString(),
    status: workout.status,
    exercisesCount: workout.exercises.length,
  }));

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-10">
          <p className="text-sm uppercase tracking-wide text-slate-500">Personal AI Trainer</p>
          <h1 className="mt-2 text-3xl font-semibold">Today&apos;s Training</h1>
          <p className="mt-2 text-slate-600">
            Generate, log, and adapt your plan with minimal friction.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <DashboardGenerateSection
            nextAutoLabel={splitPreview?.nextAutoLabel}
            queuePreview={splitPreview?.queuePreview}
            templates={templates.map((t) => ({
              id: t.id,
              name: t.name,
              exerciseCount: t.exerciseCount,
              score: t.score,
              scoreLabel: t.scoreLabel,
            }))}
          />
          <div className="space-y-6">
            {latestIncomplete ? (
              <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-xl font-semibold">Resume Workout</h2>
                <p className="mt-2 text-slate-600">Continue your latest in-progress session.</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
                    href={`/log/${latestIncomplete.id}`}
                  >
                    Resume logging
                  </Link>
                  <Link
                    className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold"
                    href={`/workout/${latestIncomplete.id}`}
                  >
                    View workout
                  </Link>
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Quick Snapshot</h2>
              <ul className="mt-4 space-y-2 text-sm text-slate-600">
                <li>Rolling plan: 4 days / week</li>
                <li>Average session length: 55 minutes</li>
                <li>Readiness trend: stable</li>
              </ul>
              <Link className="mt-4 inline-block text-sm font-semibold text-slate-900" href="/analytics">
                View analytics
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-10 grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Next Session</h3>
            <p className="mt-3 text-lg font-semibold">{latestWorkout ? "Upcoming Workout" : "No workout"}</p>
            <p className="mt-2 text-sm text-slate-600">{nextSessionName}</p>
            {latestWorkout ? (
              <Link
                className="mt-3 inline-block text-sm font-semibold text-slate-900"
                href={`/workout/${latestWorkout.id}`}
              >
                View workout
              </Link>
            ) : (
              <span className="mt-3 inline-block text-sm text-slate-400">Generate a workout first</span>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Latest Log</h3>
            <p className="mt-3 text-lg font-semibold">
              {latestCompleted ? "Last completed" : "No completed logs"}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {latestCompleted
                ? new Date(latestCompleted.completedAt ?? latestCompleted.scheduledDate).toLocaleDateString()
                : "Complete a workout to see logs"}
            </p>
            {latestCompleted ? (
              <Link
                className="mt-3 inline-block text-sm font-semibold text-slate-900"
                href={`/log/${latestCompleted.id}`}
              >
                Review log
              </Link>
            ) : (
              <span className="mt-3 inline-block text-sm text-slate-400">No logs yet</span>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Settings</h3>
            <p className="mt-3 text-sm text-slate-600">Split, equipment, and goals</p>
            <Link className="mt-3 inline-block text-sm font-semibold text-slate-900" href="/settings">
              Manage settings
            </Link>
          </div>
        </section>

        <RecentWorkouts
          recentWorkouts={recentList}
          statusLabels={STATUS_LABELS}
          statusClasses={STATUS_CLASSES}
        />
      </div>
    </main>
  );
}