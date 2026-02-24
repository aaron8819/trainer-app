import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { DashboardGenerateSection } from "@/components/DashboardGenerateSection";
import RecentWorkouts from "@/components/RecentWorkouts";
import ReadinessCheckInForm from "@/components/ReadinessCheckInForm";
import TrainingStatusCard from "@/components/TrainingStatusCard";
import { loadCapabilityFlags, loadProgramDashboardData } from "@/lib/api/program";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  PARTIAL: "Partial",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
};

const STATUS_CLASSES: Record<string, string> = {
  COMPLETED: "bg-emerald-50 text-emerald-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  PARTIAL: "bg-orange-50 text-orange-700",
  SKIPPED: "bg-slate-100 text-slate-600",
  PLANNED: "bg-slate-100 text-slate-700",
};

type SessionIntent = "push" | "pull" | "legs" | "upper" | "lower" | "full_body" | "body_part";

function isSessionIntent(value: string | null): value is SessionIntent {
  return (
    value === "push" ||
    value === "pull" ||
    value === "legs" ||
    value === "upper" ||
    value === "lower" ||
    value === "full_body" ||
    value === "body_part"
  );
}

export default async function Home() {
  const owner = await resolveOwner();
  const [latestCompleted, latestIncomplete, recentWorkouts, templateCount, capabilities, programData] =
    await Promise.all([
      prisma.workout.findFirst({
        where: { userId: owner.id, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
      }),
      prisma.workout.findFirst({
        where: { userId: owner.id, status: { in: ["PLANNED", "IN_PROGRESS", "PARTIAL"] } },
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
      prisma.workoutTemplate.count({ where: { userId: owner.id } }),
      loadCapabilityFlags(owner.id),
      loadProgramDashboardData(owner.id),
    ]);

  const formatSessionIntent = (intent: string) =>
    intent
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const nextSessionIntent = isSessionIntent(programData.nextSessionIntent)
    ? programData.nextSessionIntent
    : null;
  const nextSessionLabel = nextSessionIntent ? formatSessionIntent(nextSessionIntent) : null;

  const matchingPlannedWorkout =
    nextSessionIntent
      ? recentWorkouts.find(
          (workout) =>
            ["PLANNED", "IN_PROGRESS", "PARTIAL"].includes(workout.status) &&
            workout.sessionIntent?.toLowerCase() === nextSessionIntent
        ) ?? null
      : null;

  const recentList = recentWorkouts.map((workout) => ({
    id: workout.id,
    scheduledDate: workout.scheduledDate.toISOString(),
    status: workout.status,
    sessionIntent: workout.sessionIntent?.toLowerCase() ?? null,
    exercisesCount: workout.exercises.length,
  }));

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <header className="mb-8 md:mb-10">
          <p className="text-sm uppercase tracking-wide text-slate-500">Personal AI Trainer</p>
          <h1 className="page-title mt-2">Today&apos;s Training</h1>
          <p className="mt-2 text-slate-600">
            Generate, log, and adapt your plan with minimal friction.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="min-w-0">
            <DashboardGenerateSection
              templateCount={templateCount}
              initialIntent={nextSessionIntent ?? undefined}
            />
          </div>
          <div className="min-w-0 space-y-6">
            {capabilities.readinessEnabled ? (
              <details className="rounded-2xl border border-slate-200 p-6 shadow-sm">
                <summary className="cursor-pointer text-xl font-semibold">Optional readiness check-in</summary>
                <p className="mt-2 text-sm text-slate-600">
                  Manual readiness input can tune today&apos;s session intensity.
                </p>
                <div className="mt-4">
                  <ReadinessCheckInForm />
                </div>
              </details>
            ) : null}

            {latestIncomplete ? (
              <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
                <h2 className="text-xl font-semibold">Resume Workout</h2>
                <p className="mt-2 text-slate-600">Continue your latest in-progress session.</p>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
                    href={`/log/${latestIncomplete.id}`}
                  >
                    Resume logging
                  </Link>
                  <Link
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold"
                    href={`/workout/${latestIncomplete.id}`}
                  >
                    View workout
                  </Link>
                </div>
              </div>
            ) : null}
            <TrainingStatusCard data={programData} />
          </div>
        </section>

        <section className="mt-8 grid gap-6 md:mt-10 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Next Session</h3>
            <p className="mt-3 text-lg font-semibold">
              {nextSessionLabel ? `Next: ${nextSessionLabel}` : "No session intent"}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              {matchingPlannedWorkout
                ? "A matching workout is already saved."
                : nextSessionLabel
                  ? `Generate a ${nextSessionLabel} session.`
                  : "Set up weekly schedule to enable next-session intent."}
            </p>
            {matchingPlannedWorkout ? (
              <Link
                className="mt-3 inline-block text-sm font-semibold text-slate-900"
                href={`/workout/${matchingPlannedWorkout.id}`}
              >
                View workout
              </Link>
            ) : nextSessionLabel ? (
              <Link className="mt-3 inline-block text-sm font-semibold text-slate-900" href="#generate-workout">
                Generate {nextSessionLabel}
              </Link>
            ) : (
              <span className="mt-3 inline-block text-sm text-slate-500">Generate a workout first</span>
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
              <span className="mt-3 inline-block text-sm text-slate-500">No logs yet</span>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Settings</h3>
            <p className="mt-3 text-sm text-slate-600">Split, goals, and preferences</p>
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
