import Link from "next/link";
import { notFound } from "next/navigation";
import { PlanFinalizeButton } from "@/components/plans/PlanFinalizeButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { loadPlanReview } from "@/lib/api/plan-management";
import { resolveOwner } from "@/lib/api/workout-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = Promise<{ id: string }>;

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function PlanReviewPage({
  params,
}: {
  params: Params;
}) {
  const [{ id }, owner] = await Promise.all([params, resolveOwner()]);
  const plan = await loadPlanReview(owner.id, id);
  if (!plan) notFound();

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl pb-10">
        <Link
          href="/plans"
          className="text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          Back to plans
        </Link>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Generated hypertrophy plan
            </p>
            <h1 className="page-title mt-2">{plan.name}</h1>
            <p className="mt-2 text-sm text-slate-600">
              Review the generated mesocycles before finalizing. Finalization
              makes the plan READY without changing your active plan.
            </p>
          </div>
          <StatusBadge tone={plan.status === "READY" ? "positive" : "warning"}>
            {formatLabel(plan.status)}
          </StatusBadge>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
          <h2 className="font-semibold text-slate-900">Plan outline</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Goal
              </dt>
              <dd className="mt-1 font-medium">Hypertrophy</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Duration
              </dt>
              <dd className="mt-1 font-medium">{plan.durationWeeks} weeks</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Mesocycles
              </dt>
              <dd className="mt-1 font-medium">{plan.mesocycleCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Active now
              </dt>
              <dd className="mt-1 font-medium">{plan.isActive ? "Yes" : "No"}</dd>
            </div>
          </dl>
        </section>

        <div className="mt-5 grid gap-3">
          {plan.mesocycles.map((mesocycle) => (
            <article
              key={mesocycle.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Mesocycle {mesocycle.mesoNumber}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">
                    {mesocycle.focus}
                  </h2>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  Weeks {mesocycle.startWeek + 1}–
                  {mesocycle.startWeek + mesocycle.durationWeeks}
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                {mesocycle.blockCount} training blocks ·{" "}
                {formatLabel(mesocycle.volumeTarget)} volume ·{" "}
                {formatLabel(mesocycle.intensityBias)} emphasis
              </p>
            </article>
          ))}
        </div>

        <section className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:p-5">
          <h2 className="font-semibold text-slate-900">Ready to finalize?</h2>
          <p className="mt-2 text-sm text-slate-700">
            This locks in the generated plan’s readiness state. It does not
            rewrite plan content, accepted seeds, workouts, or historical
            records.
          </p>
          <div className="mt-4">
            {plan.status === "PREPARING" ? (
              <PlanFinalizeButton
                planId={plan.id}
                planName={plan.name}
                expectedUpdatedAt={plan.updatedAt}
              />
            ) : (
              <Link
                href="/plans"
                className="text-sm font-semibold text-blue-800 underline"
              >
                Return to Plan Management
              </Link>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
