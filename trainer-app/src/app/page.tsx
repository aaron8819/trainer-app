import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { resolveOwner } from "@/lib/api/workout-context";
import { DashboardGenerateSection } from "@/components/DashboardGenerateSection";
import RecentWorkouts from "@/components/RecentWorkouts";
import { ProgramStatusCard } from "@/components/ProgramStatusCard";
import { OptionalGapFillCard } from "@/components/OptionalGapFillCard";
import {
  loadHomeProgramSupport,
  loadProgramDashboardData,
} from "@/lib/api/program";
import {
  buildWorkoutListSurfaceSummary,
  workoutListItemSelect,
} from "@/lib/ui/workout-list-items";
import { getWorkoutWorkflowState } from "@/lib/workout-workflow";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

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

  const [latestCompleted, recentWorkouts, programData, homeProgram] =
    await Promise.all([
      prisma.workout.findFirst({
        where: { userId: owner.id, status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
      }),
      // Rolling 6: all statuses, most recently scheduled first
      prisma.workout.findMany({
        where: { userId: owner.id },
        orderBy: { scheduledDate: "desc" },
        take: 6,
        select: workoutListItemSelect,
      }),
      loadProgramDashboardData(owner.id),
      loadHomeProgramSupport(owner.id),
    ]);

  const latestIncomplete = homeProgram.latestIncomplete;

  const formatSessionIntent = (intent: string) =>
    intent
      .split("_")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const nextSession = homeProgram.nextSession;
  // Validate intent type for DashboardGenerateSection (typed prop).
  const nextSessionTyped = isSessionIntent(nextSession.intent) ? nextSession.intent : null;
  const existingWorkoutStatus = latestIncomplete?.status ?? null;
  const existingWorkflow = getWorkoutWorkflowState(existingWorkoutStatus);
  const hasExistingWorkout = Boolean(nextSession.isExisting && nextSession.workoutId && latestIncomplete);
  const currentPhase = programData.activeMeso?.currentBlockType
    ? programData.activeMeso.currentBlockType.charAt(0).toUpperCase() +
      programData.activeMeso.currentBlockType.slice(1)
    : null;
  const headerContext = programData.activeMeso
    ? `Week ${programData.currentWeek} • ${currentPhase ?? "Program"}`
    : "Generate your first session.";
  const existingWorkoutTitle =
    existingWorkflow.kind === "planned"
      ? "Start Workout"
      : existingWorkflow.kind === "partial"
      ? "Resume Partial Workout"
      : "Resume Workout";
  const existingWorkoutDescription =
    existingWorkflow.kind === "planned"
      ? "Your next workout is already planned and ready to log."
      : existingWorkflow.kind === "partial"
      ? "This session was partially logged. Review it or continue logging before generating anything new."
      : "Continue your latest incomplete session before generating anything new.";
  const existingWorkoutActionLabel =
    existingWorkflow.kind === "planned" ? "Start logging" : "Continue logging";

  const recentList = recentWorkouts.map(buildWorkoutListSurfaceSummary);

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <header className="mb-8 md:mb-10">
          <p className="text-sm uppercase tracking-wide text-slate-500">Personal AI Trainer</p>
          <h1 className="page-title mt-2">Today&apos;s Training</h1>
          <p className="mt-2 text-sm text-slate-500">
            {headerContext}
          </p>
        </header>

        <section className="space-y-6">
          {hasExistingWorkout && nextSession.workoutId && latestIncomplete ? (
            <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Today&apos;s Action
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{existingWorkoutTitle}</h2>
              {nextSession.intent ? (
                <p className="mt-2 text-sm text-slate-500">
                  Next: {formatSessionIntent(nextSession.intent)}
                </p>
              ) : null}
              <p className="mt-2 text-slate-600">{existingWorkoutDescription}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
                  href={`/log/${nextSession.workoutId}`}
                >
                  {existingWorkoutActionLabel}
                </Link>
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold"
                  href={`/workout/${latestIncomplete.id}`}
                >
                  View workout
                </Link>
              </div>
            </div>
          ) : (
            <DashboardGenerateSection
              initialIntent={nextSessionTyped ?? undefined}
            />
          )}

          {!hasExistingWorkout ? (
            <div className="rounded-2xl border border-slate-200 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Next Session
              </h2>
              <p className="mt-3 text-lg font-semibold">
                {nextSession.intent
                  ? `Next: ${formatSessionIntent(nextSession.intent)}`
                  : "No session intent"}
              </p>
              {homeProgram.lastSessionSkipped && nextSession.intent ? (
                <p className="mt-1 text-xs text-slate-500">
                  You skipped your last {formatSessionIntent(nextSession.intent)} session.
                </p>
              ) : null}
              <p className="mt-2 text-sm text-slate-600">
                {nextSession.intent
                  ? "The generator above is preset to this recommendation."
                  : "Set up weekly schedule to unlock a recommended next session."}
              </p>
            </div>
          ) : null}
        </section>

        <section className="mt-8 space-y-6 md:mt-10">
          {homeProgram.gapFill.eligible ? <OptionalGapFillCard gapFill={homeProgram.gapFill} /> : null}
        </section>

        <section className="mt-8 md:mt-10">
          <ProgramStatusCard initialData={programData} variant="homeCompact" />
        </section>

        <section className="mt-8 md:mt-10">
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
        </section>

        <RecentWorkouts recentWorkouts={recentList} />

        <section className="mt-8 md:mt-10">
          <div className="rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Explore</h3>
            <p className="mt-3 text-sm text-slate-600">
              Move from today&apos;s decisions to block state, session history, or trend review.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900"
                href="/program"
              >
                Program
              </Link>
              <Link
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900"
                href="/history"
              >
                History
              </Link>
              <Link
                className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900"
                href="/analytics"
              >
                Analytics
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
