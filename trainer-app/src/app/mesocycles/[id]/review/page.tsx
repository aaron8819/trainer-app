import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveOwner } from "@/lib/api/workout-context";
import {
  buildMesocycleReviewPlainEnglishSummary,
  loadMesocycleReviewFromPrisma,
  type MesocycleReviewMuscleRow,
} from "@/lib/api/mesocycle-review";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

type Params = Promise<{ id: string }>;

function formatDate(value: string | null): string {
  if (!value) {
    return "n/a";
  }
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatPercent(value: number | null): string {
  if (value == null) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

function formatIntent(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSplitType(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" / ");
}

function formatSignedValue(value: number): string {
  if (value === 0) {
    return "0.0";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function getStatusClasses(status: MesocycleReviewMuscleRow["status"]): string {
  switch (status) {
    case "on_target":
      return "bg-emerald-50 text-emerald-700";
    case "slightly_low":
      return "bg-amber-50 text-amber-700";
    case "meaningfully_low":
      return "bg-rose-50 text-rose-700";
    case "slightly_high":
      return "bg-sky-50 text-sky-700";
    case "meaningfully_high":
      return "bg-indigo-50 text-indigo-700";
  }
}

function formatStatusLabel(status: MesocycleReviewMuscleRow["status"]): string {
  switch (status) {
    case "on_target":
      return "On target";
    case "slightly_low":
      return "Slightly low";
    case "meaningfully_low":
      return "Meaningfully low";
    case "slightly_high":
      return "Slightly high";
    case "meaningfully_high":
      return "Meaningfully high";
  }
}

export default async function MesocycleReviewPage({ params }: { params: Params }) {
  const { id } = await params;
  const owner = await resolveOwner();
  const review = await loadMesocycleReviewFromPrisma({ userId: owner.id, mesocycleId: id });

  if (!review) {
    notFound();
  }

  const frozenSummary = review.frozenSummary;
  const closedSessionCount =
    frozenSummary.lifecycle.accumulationSessionsCompleted +
    frozenSummary.lifecycle.deloadSessionsCompleted;
  const carryForward = {
    keep: frozenSummary.carryForwardRecommendations.filter(
      (recommendation) => recommendation.recommendation === "keep"
    ),
    rotate: frozenSummary.carryForwardRecommendations.filter(
      (recommendation) => recommendation.recommendation === "rotate"
    ),
    drop: [] as typeof frozenSummary.carryForwardRecommendations,
  };
  const recommendedNextCycle = frozenSummary.recommendedNextSeed;

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-5xl pb-10">
        <header className="mb-8 md:mb-10">
          <Link href="/" className="text-sm font-medium text-slate-500 hover:text-slate-900">
            Back to Home
          </Link>
          <p className="mt-4 text-sm uppercase tracking-wide text-slate-500">
            {review.archive.reviewState === "pending_handoff"
              ? "Pending Handoff Review"
              : "Historical Closeout Archive"}
          </p>
          <h1 className="page-title mt-2">Meso {review.mesoNumber} complete</h1>
          <p className="mt-2 text-sm text-slate-600">
            Closeout review for {review.focus}. Frozen handoff facts stay separate from live review
            analytics recomputed from workouts tagged to this mesocycle.
          </p>
        </header>

        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Frozen handoff summary
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Mesocycle complete</h2>
          <p className="mt-2 text-sm text-slate-700">
            {buildMesocycleReviewPlainEnglishSummary(review)}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-amber-200 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Duration
              </p>
              <p className="mt-2 text-xl font-semibold">
                {frozenSummary.lifecycle.durationWeeks} weeks
              </p>
              <p className="mt-1 text-sm text-slate-600">Closed {formatDate(frozenSummary.closedAt)}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Sessions completed
              </p>
              <p className="mt-2 text-xl font-semibold">{closedSessionCount}</p>
              <p className="mt-1 text-sm text-slate-600">
                {frozenSummary.lifecycle.accumulationSessionsCompleted} accumulation,{" "}
                {frozenSummary.lifecycle.deloadSessionsCompleted} deload
              </p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Deload
              </p>
              <p className="mt-2 text-xl font-semibold">Complete</p>
              <p className="mt-1 text-sm text-slate-600">
                Excluded from next-cycle baseline by design
              </p>
            </div>
          </div>
          <p className="mt-5 text-sm text-slate-700">
            {formatSplitType(frozenSummary.training.splitType)} • {frozenSummary.training.sessionsPerWeek}
            x/week • Focus: {frozenSummary.training.focus}
          </p>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Derived live from mesocycle workouts
          </p>
          <h2 className="mt-2 text-xl font-semibold">What improved</h2>
          <p className="mt-2 text-sm text-slate-600">
            These metrics are recomputed from {review.derived.scopedWorkoutCount} workouts scoped by{" "}
            <code>mesocycleId</code>. No active-cycle readers are used here.
          </p>

          <div className="mt-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-2xl bg-slate-50 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Core adherence
              </h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-2xl font-semibold">
                    {review.derived.adherence.performedSessions}/{review.derived.adherence.plannedSessions}
                  </p>
                  <p className="text-sm text-slate-600">Core sessions performed</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold">
                    {formatPercent(review.derived.adherence.adherenceRate)}
                  </p>
                  <p className="text-sm text-slate-600">Adherence rate</p>
                </div>
                <div>
                  <p className="text-lg font-semibold">
                    {review.derived.adherence.coreCompletedSessions} completed /{" "}
                    {review.derived.adherence.partialSessions} partial
                  </p>
                  <p className="text-sm text-slate-600">Core session outcomes</p>
                </div>
                <div>
                  <p className="text-lg font-semibold">
                    {review.derived.adherence.skippedSessions} skipped
                    {review.derived.adherence.optionalPerformedSessions > 0
                      ? ` • ${review.derived.adherence.optionalPerformedSessions} optional performed`
                      : ""}
                  </p>
                  <p className="text-sm text-slate-600">Follow-through context</p>
                </div>
              </div>

              <div className="mt-5">
                <h4 className="text-sm font-semibold text-slate-900">Week-by-week</h4>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {review.derived.weeklyBreakdown.map((week) => (
                    <div key={week.week} className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Week {week.week}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {week.performedSessions}/{week.plannedSessions} core sessions
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {week.phase === "DELOAD" ? "Deload week" : "Accumulation week"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Top progressed exercises
              </h3>
              {review.derived.topProgressedExercises.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {review.derived.topProgressedExercises.map((exercise) => (
                    <div key={exercise.exerciseId} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">{exercise.exerciseName}</p>
                        {exercise.sessionIntent ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                            {formatIntent(exercise.sessionIntent)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{exercise.summary}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Latest best set: {exercise.latestBestSet}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-600">
                  Not enough repeated performed exposures yet to call out a clear exercise-level trend.
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Derived live from mesocycle workouts
          </p>
          <h2 className="mt-2 text-xl font-semibold">Muscle / volume summary</h2>
          <p className="mt-2 text-sm text-slate-600">
            Targets are canonical weekly targets summed across this mesocycle. Actuals are weighted
            effective sets recomputed from mesocycle-scoped workouts.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="border-b border-slate-200 px-3 py-2 font-semibold">Muscle</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-semibold">Target</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-semibold">Actual</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-semibold">Delta</th>
                  <th className="border-b border-slate-200 px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {review.derived.muscleVolumeSummary.map((row) => (
                  <tr key={row.muscle} className="align-top text-sm text-slate-700">
                    <td className="border-b border-slate-100 px-3 py-3">
                      <p className="font-medium text-slate-900">{row.muscle}</p>
                      {row.topContributors.length > 0 ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Top drivers:{" "}
                          {row.topContributors
                            .map(
                              (contribution) =>
                                `${contribution.exerciseName} ${contribution.effectiveSets.toFixed(1)}`
                            )
                            .join(", ")}
                        </p>
                      ) : null}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3 font-medium text-slate-900">
                      {row.targetSets.toFixed(1)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3 font-medium text-slate-900">
                      {row.actualEffectiveSets.toFixed(1)}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <p className="font-medium text-slate-900">{formatSignedValue(row.delta)}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {Math.round(row.percentDelta * 100)}%
                      </p>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClasses(row.status)}`}
                      >
                        {formatStatusLabel(row.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Frozen handoff summary
          </p>
          <h2 className="mt-2 text-xl font-semibold">Carry-forward recommendations</h2>
          <p className="mt-2 text-sm text-slate-600">
            This stays intentionally small: the frozen handoff stores recommendation calls, while
            the detailed review above is recomputed live.
          </p>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {(
              [
                ["Keep", carryForward.keep, "Carry straight into the next cycle."],
                ["Rotate", carryForward.rotate, "Swap or refresh next cycle."],
                ["Drop", carryForward.drop, "Nothing was explicitly marked for drop."],
              ] as const
            ).map(([label, items, emptyCopy]) => (
              <div key={label} className="rounded-2xl bg-slate-50 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {label}
                </h3>
                {items.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {items.map((item) => (
                      <div key={`${item.exerciseId}:${item.sessionIntent}`} className="rounded-xl border border-slate-200 bg-white p-4">
                        <p className="font-medium text-slate-900">{item.exerciseName}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {formatIntent(item.sessionIntent)} • {item.role.toLowerCase().replace("_", " ")}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-600">{emptyCopy}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-200 p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {review.archive.isEditableHandoff
              ? "Frozen next-cycle recommendation"
              : "Historical closeout"}
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            {review.archive.isEditableHandoff ? "Recommended next cycle" : "Archived handoff recommendation"}
          </h2>
          <p className="mt-2 text-sm text-slate-700">
            Default recommendation: {recommendedNextCycle.structure.sessionsPerWeek}x/week{" "}
            {formatSplitType(recommendedNextCycle.structure.splitType)}.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Ordered-flexible means the slot order stays fixed, but you can slide sessions across the
            week without changing the sequence.
          </p>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl bg-slate-50 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Slot order
              </h3>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {recommendedNextCycle.structure.slots.map((slot, index) => (
                  <div key={slot.slotId} className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Slot {index + 1}
                    </p>
                    <p className="mt-1 font-medium text-slate-900">{formatIntent(slot.intent)}</p>
                    <p className="mt-1 text-xs text-slate-500">{slot.slotId.replace("_", " ")}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Starting point
              </h3>
              <p className="mt-4 text-sm text-slate-700">
                Volume preset: <span className="font-medium">conservative productive</span>
              </p>
              <p className="mt-2 text-sm text-slate-700">
                Baseline: use peak accumulation first, otherwise highest non-deload accumulation week.
              </p>
              <p className="mt-2 text-sm text-slate-700">
                Carry forward keeps:{" "}
                <span className="font-medium">
                  {
                    recommendedNextCycle.carryForwardSelections.filter(
                      (selection) => selection.action === "keep"
                    ).length
                  }
                </span>
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {review.archive.isEditableHandoff ? "Next step" : "Archive note"}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              {review.archive.isEditableHandoff
                ? "Continue into setup to compare the frozen recommendation against the mutable draft, make changes if you want them, then accept the next cycle."
                : "This mesocycle is already archived as historical closeout. The frozen recommendation stays reviewable here, but the editable handoff workflow is no longer available."}
            </p>
            {review.archive.isEditableHandoff ? (
              <div className="mt-4">
                <Link
                  href={`/mesocycles/${review.mesocycleId}/setup`}
                  className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
                >
                  Review and edit next-cycle setup
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
