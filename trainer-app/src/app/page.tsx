import Link from "next/link";
import { resolveOwner } from "@/lib/api/workout-context";
import { DashboardGenerateSection } from "@/components/DashboardGenerateSection";
import RecentWorkouts from "@/components/RecentWorkouts";
import { ProgramStatusCard } from "@/components/ProgramStatusCard";
import { CloseoutCard } from "@/components/CloseoutCard";
import { OptionalWeekCompletion } from "@/components/OptionalWeekCompletion";
import { loadHomePageData } from "@/lib/api/home-page";
import { getWorkoutListPrimaryLabel } from "@/lib/ui/workout-list-items";

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

function formatActiveWeekTitle(value: string): string {
  return value.replace(" - ", " — ");
}

function getActiveWeekStatusClass(status: string): string {
  switch (status) {
    case "completed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "next":
      return "border-slate-900 bg-slate-900 text-white";
    case "in_progress":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "skipped":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

export default async function Home() {
  const owner = await resolveOwner();
  const homePage = await loadHomePageData(owner.id);

  function formatActivityDate(value: string | null | undefined) {
    if (!value) return null;
    return new Date(value).toLocaleDateString();
  }

  if (homePage.pendingHandoff) {
    const lastCompleted = homePage.continuity?.lastCompleted ?? null;

    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-5xl">
          <header className="mb-8 md:mb-10">
            <p className="text-sm uppercase tracking-wide text-slate-500">Personal AI Trainer</p>
            <h1 className="page-title mt-2">Mesocycle Handoff</h1>
            <p className="mt-2 text-sm text-slate-500">
              Your last mesocycle is complete. Review the handoff, make any setup edits you want,
              and accept the next cycle to continue.
            </p>
          </header>

          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Action Required
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              Meso {homePage.pendingHandoff.mesoNumber}: {homePage.pendingHandoff.focus}
            </h2>
            <p className="mt-2 text-sm text-slate-700">
              Training is paused. Review and accept your next cycle to continue.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/mesocycles/${homePage.pendingHandoff.mesocycleId}/review`}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
              >
                Review handoff
              </Link>
              <Link
                href="/program"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-900"
              >
                Program status
              </Link>
            </div>
          </section>

          {lastCompleted ? (
            <section className="mt-8 md:mt-10">
              <div className="rounded-2xl border border-slate-200 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Last Completed
                </p>
                <p className="mt-2 text-lg font-semibold">
                  {getWorkoutListPrimaryLabel(lastCompleted)}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {formatActivityDate(lastCompleted.completedAt ?? lastCompleted.scheduledDate)}
                </p>
                <Link
                  className="mt-3 inline-block text-sm font-semibold text-slate-900"
                  href={`/workout/${lastCompleted.id}`}
                >
                  Review session
                </Link>
              </div>
            </section>
          ) : null}

          <RecentWorkouts
            recentWorkouts={homePage.recentActivity}
            heading="Recent Activity"
            showCount={false}
            showDeleteActions={false}
            viewAllLabel="Open History"
          />
        </div>
      </main>
    );
  }

  const programData = homePage.programData;
  const homeProgram = homePage.homeProgram;
  const decision = homePage.decision;
  const continuity = homePage.continuity;
  const closeout = homePage.closeout;

  if (!programData || !homeProgram || !homePage.primaryAction || !decision || !continuity) {
    return null;
  }

  const primaryAction = homePage.primaryAction;
  const primaryActionInitialIntent =
    primaryAction.state === "planned" && primaryAction.mode === "generate"
      ? primaryAction.initialIntent ?? null
      : null;
  const primaryActionIntent: SessionIntent | null = isSessionIntent(primaryActionInitialIntent)
    ? primaryActionInitialIntent
    : null;
  const activeWeekCloseout =
    closeout && homeProgram.closeout.isPriorWeek !== true ? closeout : null;
  const priorWeekCloseout =
    closeout && homeProgram.closeout.isPriorWeek === true ? closeout : null;
  const activeWeekSessions = decision.activeWeekSessions ?? [];

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl">
        <header className="mb-8 md:mb-10">
          <p className="text-sm uppercase tracking-wide text-slate-500">Personal AI Trainer</p>
          <h1 className="page-title mt-2">Today&apos;s Training</h1>
          <p className="mt-2 text-sm text-slate-500">
            {homePage.headerContext}
          </p>
        </header>

        <section className="space-y-6">
          {primaryAction.state === "active" ? (
            <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Today&apos;s Action
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{primaryAction.label}</h2>
              {decision.nextSessionLabel ? (
                <p className="mt-2 text-sm text-slate-500">
                  Next due: {decision.nextSessionLabel}
                </p>
              ) : null}
              {decision.activeWeekLabel ? (
                <p className="mt-1 text-xs text-slate-500">{decision.activeWeekLabel}</p>
              ) : null}
              <p className="mt-2 text-sm font-medium text-slate-800">
                {primaryAction.reasonLabel}
              </p>
              {primaryAction.reason ? (
                <p className="mt-2 text-slate-600">{primaryAction.reason}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
                  href={primaryAction.href}
                >
                  {primaryAction.label}
                </Link>
              </div>
            </div>
          ) : primaryAction.state === "planned" && primaryAction.mode === "existing" ? (
            <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Today&apos;s Action
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{primaryAction.label}</h2>
              {decision.nextSessionLabel ? (
                <p className="mt-2 text-sm text-slate-500">
                  Next due: {decision.nextSessionLabel}
                </p>
              ) : null}
              {decision.activeWeekLabel ? (
                <p className="mt-1 text-xs text-slate-500">{decision.activeWeekLabel}</p>
              ) : null}
              <p className="mt-2 text-sm font-medium text-slate-800">
                {primaryAction.reasonLabel}
              </p>
              {primaryAction.reason ? (
                <p className="mt-2 text-slate-600">{primaryAction.reason}</p>
              ) : null}
              {primaryAction.href ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
                    href={primaryAction.href}
                  >
                    {primaryAction.label}
                  </Link>
                </div>
              ) : null}
            </div>
          ) : primaryAction.state === "completed" ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Completed
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{primaryAction.label}</h2>
              <p className="mt-2 text-sm text-slate-700">{primaryAction.description}</p>
              {primaryAction.href ? (
                <div className="mt-4">
                  <Link
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-emerald-300 bg-white px-5 py-2 text-sm font-semibold text-slate-900"
                    href={primaryAction.href}
                  >
                    Review program
                  </Link>
                </div>
              ) : null}
            </div>
          ) : primaryAction.state === "optional" ? (
            <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Optional
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{primaryAction.label}</h2>
              <p className="mt-2 text-sm text-slate-700">{primaryAction.description}</p>
              <div className="mt-4">
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
                  href={primaryAction.href}
                >
                  {primaryAction.label}
                </Link>
              </div>
            </div>
          ) : primaryAction.state === "planned" && primaryAction.mode === "generate" ? (
              <DashboardGenerateSection
                initialIntent={primaryActionIntent ?? undefined}
                initialSlotId={primaryAction.initialSlotId}
                primaryAction={{
                  label: primaryAction.label,
                  state: primaryAction.state,
                  mode: primaryAction.mode,
                }}
                nextSessionLabel={decision.nextSessionLabel}
                nextSessionDescription={decision.nextSessionDescription}
              />
          ) : (
            <div className="rounded-2xl border border-slate-200 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Blocked
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{primaryAction.label}</h2>
              <p className="mt-2 text-sm text-slate-700">{primaryAction.reason}</p>
              {primaryAction.href ? (
                <Link
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-900"
                  href={primaryAction.href}
                >
                  Review program
                </Link>
              ) : null}
            </div>
          )}
        </section>

        <section className="mt-8 md:mt-10">
          <div className="rounded-2xl border border-slate-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Continuity
            </p>
            {continuity.summary ? (
              <p className="mt-2 text-sm text-slate-700">{continuity.summary}</p>
            ) : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Last Completed
                </p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {continuity.lastCompleted
                    ? getWorkoutListPrimaryLabel(continuity.lastCompleted)
                    : "No completed sessions yet"}
                </p>
                {continuity.lastCompletedDescriptor ? (
                  <p className="mt-1 text-sm text-slate-600">
                    {continuity.lastCompletedDescriptor}
                  </p>
                ) : null}
                <p className="mt-1 text-sm text-slate-600">
                  {continuity.lastCompleted
                    ? formatActivityDate(
                        continuity.lastCompleted.completedAt ??
                          continuity.lastCompleted.scheduledDate
                      )
                    : "Complete a session to build continuity."}
                </p>
                {continuity.lastCompleted ? (
                  <Link
                    className="mt-3 inline-block text-sm font-semibold text-slate-900"
                    href={`/workout/${continuity.lastCompleted.id}`}
                  >
                    Review session
                  </Link>
                ) : null}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Next Due
                </p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {decision.nextSessionLabel ?? "No next session yet"}
                </p>
                {continuity.nextDueDescriptor ? (
                  <p className="mt-1 text-sm text-slate-600">{continuity.nextDueDescriptor}</p>
                ) : null}
                <p className="mt-1 text-xs text-slate-500">
                  {decision.activeWeekLabel ?? decision.nextSessionReasonLabel}
                </p>
                {homeProgram.lastSessionSkipped &&
                homeProgram.nextSession.intent &&
                !homeProgram.nextSession.slotId ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Your last session for this intent was skipped, so it remains next.
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {decision.activeWeekLabel ? (
          <section className="mt-8 md:mt-10">
            <div className="rounded-2xl border border-slate-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Active Week
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {formatActiveWeekTitle(homePage.headerContext)}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {decision.activeWeekLabel}
              </p>
              {activeWeekSessions.length > 0 ? (
                <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {activeWeekSessions.map((session) => {
                    const row = (
                      <>
                        <span className="min-w-0 truncate text-sm font-medium text-slate-900">
                          {session.label}
                        </span>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${getActiveWeekStatusClass(session.status)}`}
                        >
                          {session.statusLabel}
                        </span>
                      </>
                    );

                    return session.href ? (
                      <Link
                        key={session.slotId}
                        href={session.href}
                        className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 transition hover:bg-slate-50"
                      >
                        {row}
                      </Link>
                    ) : (
                      <div
                        key={session.slotId}
                        className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
                      >
                        {row}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  {decision.nextSessionDescription ?? decision.nextSessionReason}
                </p>
              )}
            </div>
          </section>
        ) : null}

        <section className="mt-8 space-y-6 md:mt-10">
          <OptionalWeekCompletion
            activeWeek={homeProgram.activeWeek}
            gapFill={homeProgram.gapFill}
            customSession={activeWeekCloseout}
          />
          {priorWeekCloseout ? <CloseoutCard closeout={priorWeekCloseout} /> : null}
        </section>

        <section className="mt-8 md:mt-10">
          <ProgramStatusCard initialData={programData} variant="homeCompact" />
        </section>

        <RecentWorkouts
          recentWorkouts={homePage.recentActivity}
          heading="Recent Activity"
          showCount={false}
          showDeleteActions={false}
          viewAllLabel="Open History"
        />
      </div>
    </main>
  );
}
