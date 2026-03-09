import type { WorkoutExplanation } from "@/lib/engine/explainability";
import {
  buildPostWorkoutInsightsModel,
  type ReviewedExerciseMeta,
  type PostWorkoutInsightTone,
} from "@/lib/ui/post-workout-insights";

type Props = {
  explanation: WorkoutExplanation;
  exercises: ReviewedExerciseMeta[];
};

function toneClasses(tone: PostWorkoutInsightTone): string {
  if (tone === "positive") {
    return "border-emerald-200 bg-emerald-50";
  }
  if (tone === "caution") {
    return "border-amber-200 bg-amber-50";
  }
  return "border-slate-200 bg-slate-50";
}

function badgeClasses(tone: PostWorkoutInsightTone): string {
  if (tone === "positive") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (tone === "caution") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-slate-100 text-slate-700";
}

export function PostWorkoutInsights({ explanation, exercises }: Props) {
  const model = buildPostWorkoutInsightsModel({ explanation, exercises });

  return (
    <div className="space-y-4 sm:space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session outcome</p>
        <h2 className="mt-1 text-lg font-semibold text-slate-900">{model.headline}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{model.summary}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {model.overview.map((item) => (
            <div key={item.label} className={`rounded-xl border p-3 ${toneClasses(item.tone)}`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
              <p className="mt-1 text-sm text-slate-700">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      {model.keyLifts.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Key lift takeaways
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              These cards separate what today meant from what the next exposure likely does.
            </p>
          </div>
          <div className="space-y-3">
            {model.keyLifts.map((lift) => (
              <article
                key={lift.exerciseId}
                className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{lift.exerciseName}</h3>
                    <p className="mt-1 text-sm text-slate-600">{lift.performed}</p>
                  </div>
                  <span
                    className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClasses(lift.tone)}`}
                  >
                    {lift.badge}
                  </span>
                </div>

                <dl className="mt-4 space-y-3">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Today&apos;s target context
                    </dt>
                    <dd className="mt-1 text-sm text-slate-700">{lift.todayContext}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Next time
                    </dt>
                    <dd className="mt-1 text-sm text-slate-700">{lift.nextTime}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {model.programSignals.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Program impact
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              A compact read on the weekly training picture after this session.
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {model.programSignals.map((signal) => (
              <div key={signal.label} className={`rounded-xl border p-3 ${toneClasses(signal.tone)}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {signal.label}
                </p>
                <p className="mt-1 text-sm text-slate-700">{signal.value}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
