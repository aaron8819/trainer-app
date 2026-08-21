import Link from "next/link";
import { PlanFinalizeButton } from "@/components/plans/PlanFinalizeButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { planTypeLabel } from "@/lib/plan-types";
import type { PlanReview } from "@/lib/ui/plan-management";

function formatLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function PlanReviewView({
  plan,
  backHref = "/plans",
}: {
  plan: PlanReview;
  backHref?: string;
}) {
  const planType = planTypeLabel(plan.primaryGoal);
  const isSelectedCompleted = plan.isActive && plan.status === "COMPLETED";

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="page-shell max-w-4xl pb-10">
        <Link
          href={backHref}
          className="text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          Back to plans
        </Link>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {plan.editableCopyAvailable ? "Accepted" : "Generated"} {planType.toLowerCase()} plan
            </p>
            <h1 className="page-title mt-2">{plan.name}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {plan.editableCopyAvailable
                ? isSelectedCompleted
                  ? "This selected plan is complete and immutable. You can review it here or create an editable copy from Plan Management."
                  : "This accepted plan is immutable. Activate it separately, or create an editable copy from Plan Management."
                : "Review the generated mesocycles before finalizing. Finalization makes the plan READY without changing your active plan."}
            </p>
          </div>
          <StatusBadge
            tone={
              plan.status === "COMPLETED"
                ? "neutral"
                : plan.status === "READY"
                  ? "positive"
                  : "warning"
            }
          >
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
              <dd className="mt-1 font-medium">{planType}</dd>
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
                {isSelectedCompleted ? "Selected" : "Active now"}
              </dt>
              <dd className="mt-1 font-medium">{plan.isActive ? "Yes" : "No"}</dd>
            </div>
          </dl>
        </section>

        {plan.weeklyStructure.length > 0 ? (
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold text-slate-900">
                  Weekly {plan.primaryGoal === "STRENGTH" ? "strength " : ""}structure
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {plan.primaryGoal === "STRENGTH"
                    ? "Primary lifts stay stable so performance can progress. Focused assistance supports balance and resilience."
                    : "This is the immutable ordered composition used by the initial block."}
                </p>
              </div>
              {plan.strengthConfiguration ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                  {plan.strengthConfiguration.daysPerWeek} days · about{" "}
                  {plan.strengthConfiguration.sessionDurationMinutes} min
                </span>
              ) : null}
            </div>
            {plan.strengthConfiguration ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">
                    Main emphasis
                  </dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {formatLabel(plan.strengthConfiguration.emphasis)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">
                    Equipment
                  </dt>
                  <dd className="mt-1 font-medium text-slate-900">
                    {formatLabel(plan.strengthConfiguration.equipmentProfile)}
                  </dd>
                </div>
              </dl>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {plan.weeklyStructure.map((slot) => (
                <article
                  key={slot.slotId}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-slate-900">
                      {slot.label}
                    </h3>
                    {slot.estimatedMinutes ? (
                      <span className="shrink-0 text-xs text-slate-500">
                        <span className="sr-only">Estimated duration: </span>
                        ~{slot.estimatedMinutes} min
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-slate-700">
                    <span className="font-medium">Primary:</span>
                  </p>
                  <ul className="mt-1 space-y-1 text-sm text-slate-700">
                    {slot.primaryLifts.map((exercise) => (
                      <li key={exercise.exerciseId}>
                        {exercise.setCount}{" "}
                        {exercise.setCount === 1 ? "set" : "sets"} ·{" "}
                        {exercise.name}
                      </li>
                    ))}
                  </ul>
                  {slot.assistance.length > 0 ? (
                    <>
                      <p className="mt-2 text-sm font-medium text-slate-600">
                        Assistance:
                      </p>
                      <ul className="mt-1 space-y-1 text-sm text-slate-600">
                        {slot.assistance.map((exercise) => (
                          <li key={exercise.exerciseId}>
                            {exercise.setCount}{" "}
                            {exercise.setCount === 1 ? "set" : "sets"} ·{" "}
                            {exercise.name}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </article>
              ))}
            </div>
            {plan.primaryGoal === "STRENGTH" ? (
              <p className="mt-4 text-xs text-slate-500">
                Main work uses lower rep ranges and longer rests. Loads start from
                relevant history when available and otherwise use conservative
                calibration; no 1RM is assumed.
              </p>
            ) : null}
          </section>
        ) : null}

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
          <h2 className="font-semibold text-slate-900">
            {plan.status === "PREPARING"
              ? "Ready to finalize?"
              : isSelectedCompleted
                ? "Completed plan"
                : "Plan ready"}
          </h2>
          <p className="mt-2 text-sm text-slate-700">
            {plan.status === "PREPARING"
              ? "This locks in the generated plan’s readiness state and accepts its executable session structure when required. It does not activate the plan."
              : isSelectedCompleted
                ? "This plan remains selected for completed-plan history. Return to Plan Management to choose another plan or create an editable copy."
                : "Making a plan ready does not activate it. Return to Plan Management to activate it or create an editable copy."}
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
                href={backHref}
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
