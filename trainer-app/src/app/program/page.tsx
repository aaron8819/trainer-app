import Link from "next/link";
import { resolveOwner } from "@/lib/api/workout-context";
import { loadPendingMesocycleHandoff } from "@/lib/api/mesocycle-handoff";
import { loadProgramPageData, type ProgramCurrentWeekPlanRow } from "@/lib/api/program-page";
import { CycleAnchorControls } from "@/components/CycleAnchorControls";
import { ProgramStatusCard } from "@/components/ProgramStatusCard";
import { CloseoutCard } from "@/components/CloseoutCard";
import { WeekCompletionOutlookSection } from "./WeekCompletionOutlookSection";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const CURRENT_WEEK_PLAN_STATE_STYLE: Record<ProgramCurrentWeekPlanRow["state"], string> = {
  completed: "border-emerald-200 bg-emerald-50/80 text-emerald-800",
  next: "border-blue-300 bg-white text-blue-900 shadow-sm ring-1 ring-blue-200/80",
  remaining: "border-slate-200 bg-slate-50/80 text-slate-700",
};

function formatBlockLabel(value: string | null): string {
  if (!value) {
    return "Program";
  }

  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatWorkoutStatusLabel(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatProjectedSetCount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPlanStateLabel(value: ProgramCurrentWeekPlanRow["state"]): string {
  switch (value) {
    case "next":
      return "Next up";
    case "completed":
      return "Completed";
    default:
      return "Remaining";
  }
}

export default async function ProgramPage() {
  const user = await resolveOwner();
  const pendingHandoff = await loadPendingMesocycleHandoff(user.id);

  if (pendingHandoff) {
    return (
      <main className="min-h-screen bg-white text-slate-900">
        <div className="page-shell max-w-5xl">
          <h1 className="page-title">My Program</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Training is paused while the handoff is pending.
          </p>

          <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Handoff Pending
            </p>
            <h2 className="mt-2 text-2xl font-semibold">
              Meso {pendingHandoff.mesoNumber}: {pendingHandoff.focus}
            </h2>
            <p className="mt-2 text-sm text-slate-700">
              Review the frozen handoff, make any setup edits you want, then accept the next cycle
              to resume generation and program controls.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href={`/mesocycles/${pendingHandoff.mesocycleId}/review`}
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
              >
                Review handoff
              </Link>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-900"
              >
                Home
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const data = await loadProgramPageData(user.id);
  const currentWeekPlan = data.currentWeekPlan;
  const closeout = data.closeout;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl pb-8">
        <h1 className="page-title">My Program</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Active mesocycle overview and current-week structure. Use History for past sessions and
          Analytics for longer-term trends.
        </p>

        {data.overview ? (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Active Mesocycle
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                  Meso {data.overview.mesoNumber}: {data.overview.focus}
                </h2>
                <p className="mt-2 text-sm text-slate-600">{data.overview.coachingCue}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                {formatBlockLabel(data.overview.currentBlockType)}
              </span>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Week</p>
                <p className="mt-2 text-xl font-semibold text-slate-900">
                  {data.overview.currentWeek} / {data.overview.durationWeeks}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Progress
                </p>
                <p className="mt-2 text-xl font-semibold text-slate-900">
                  {data.overview.percentComplete}%
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Target RIR
                </p>
                <p className="mt-2 text-xl font-semibold text-slate-900">
                  {data.overview.rirTarget
                    ? `${data.overview.rirTarget.min}-${data.overview.rirTarget.max}`
                    : "n/a"}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Lighter Week
                </p>
                <p className="mt-2 text-xl font-semibold text-slate-900">
                  {data.overview.sessionsUntilDeload === 0
                    ? "Scheduled"
                    : `${data.overview.sessionsUntilDeload} away`}
                </p>
              </div>
            </div>

            <div className="mt-5 h-2 w-full rounded-full bg-slate-200">
              <div
                className="h-2 rounded-full bg-slate-900 transition-all"
                style={{ width: `${data.overview.percentComplete}%` }}
              />
            </div>

            {data.overview.blocks.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {data.overview.blocks.map((block) => {
                  const endWeek = block.startWeek + block.durationWeeks - 1;
                  return (
                    <span
                      key={`${block.blockType}:${block.startWeek}`}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                    >
                      {formatBlockLabel(block.blockType)} W{block.startWeek}
                      {endWeek > block.startWeek ? `-${endWeek}` : ""}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="mt-6">
            <ProgramStatusCard initialData={data.volumeDetails.dashboard} />
          </section>
        )}

        {currentWeekPlan ? (
          <section className="mt-7 rounded-3xl border-2 border-blue-200 bg-gradient-to-b from-blue-50 via-white to-white p-5 shadow-sm sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  Current Week Plan
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900">
                  Ordered weekly slots
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Follow the next slot first, then use the projection below to understand the
                  full-week consequence.
                </p>
              </div>
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                Week {currentWeekPlan.week}
              </span>
            </div>

            <div className="mt-5 grid gap-3">
              {currentWeekPlan.slots.map((slot) => {
                const workoutStatusLabel = formatWorkoutStatusLabel(slot.linkedWorkoutStatus);
                return (
                  <div
                    key={slot.slotId}
                    className={`rounded-2xl border px-4 py-4 transition-colors sm:px-5 ${CURRENT_WEEK_PLAN_STATE_STYLE[slot.state]}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-base font-semibold text-slate-900">{slot.label}</p>
                          {slot.state === "next" ? (
                            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue-800">
                              Primary
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                          Session {slot.sessionInWeek} of {currentWeekPlan.slots.length}
                        </p>
                        {workoutStatusLabel ? (
                          <p className="mt-1 text-xs text-slate-600">Workout: {workoutStatusLabel}</p>
                        ) : null}
                        {slot.impact ? (
                          <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                              Impact
                            </p>
                            <p className="mt-1 text-sm font-medium text-slate-900">
                              {slot.impact.summaryLabel}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              {[
                                ...slot.impact.topMuscles.map(
                                  (muscle) =>
                                    `${muscle.muscle} ${formatProjectedSetCount(
                                      muscle.projectedEffectiveSets
                                    )}`
                                ),
                                ...(slot.impact.hiddenMuscleCount > 0
                                  ? [`+${slot.impact.hiddenMuscleCount} more`]
                                  : []),
                              ].join(" • ")}
                            </p>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2 self-start">
                        <span className="rounded-full border border-current px-2.5 py-1 text-xs font-semibold">
                          {formatPlanStateLabel(slot.state)}
                        </span>
                        {slot.linkedWorkoutId ? (
                          <Link
                            href={`/workout/${slot.linkedWorkoutId}`}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-900 transition-colors hover:border-slate-400"
                          >
                            Open workout
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {closeout ? (
          <section className="mt-7">
            <CloseoutCard
              closeout={closeout}
              titleElement="h2"
              titleClassName="mt-1 text-xl font-semibold text-slate-900"
            />
          </section>
        ) : null}

        {data.weekCompletionOutlook ? (
          <WeekCompletionOutlookSection outlook={data.weekCompletionOutlook} />
        ) : null}

        {data.overview ? (
          <section className="mt-8">
            <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Volume Details
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                Weighted weekly volume
              </h2>
              <p className="mt-2 text-sm text-slate-600">
                Review active or historical volume here. Program overview, slots, closeout, and
                projected landing above stay anchored to the active week.
              </p>

              <div className="mt-4">
                <ProgramStatusCard initialData={data.volumeDetails.dashboard} variant="volumeOnly" />
              </div>
            </div>
          </section>
        ) : null}

        {data.overview ? (
          <section className="mt-8">
            <details className="rounded-2xl border border-slate-200 bg-white p-5">
              <summary className="cursor-pointer list-none text-sm font-semibold uppercase tracking-wide text-slate-500">
                Advanced Cycle Actions
              </summary>
              <p className="mt-3 text-sm text-slate-600">
                Manual mesocycle adjustments live here so the main Program flow stays focused on
                understanding the active week.
              </p>
              <CycleAnchorControls
                availableActions={data.advancedActions.availableActions}
                showHeading={false}
              />
            </details>
          </section>
        ) : null}
      </div>
    </main>
  );
}
