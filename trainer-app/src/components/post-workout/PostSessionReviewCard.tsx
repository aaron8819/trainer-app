import type { ReactNode } from "react";
import type { PostSessionReviewDisplayDto } from "@/lib/api/post-session-review-display";

type Props = {
  review: PostSessionReviewDisplayDto;
};

type SectionProps = {
  title: string;
  children: ReactNode;
};

function Section({ title, children }: SectionProps) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function rowKey(...parts: Array<string | number | null | undefined>) {
  return parts.filter((part) => part != null && part !== "").join(":");
}

export function PostSessionReviewCard({ review }: Props) {
  if (review.status !== "reviewed") {
    return (
      <section
        aria-label="Post-session review"
        className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Post-session review
        </p>
        <h2 className="mt-1 text-base font-semibold text-slate-900">
          {review.headline}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {review.warnings[0] ?? "Review notes are not available yet."}
        </p>
        <p className="mt-3 text-xs font-medium text-slate-500">
          {review.source.noMutationNote}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Post-session review"
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Post-session review
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            {review.headline}
          </h2>
        </div>
        <span className="inline-flex w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
          Observational
        </span>
      </div>

      {review.summaryBullets.length > 0 ? (
        <ul className="mt-4 space-y-1.5 text-sm leading-6 text-slate-700">
          {review.summaryBullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}

      {review.completion ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Completion
          </p>
          <p className="mt-1 text-sm font-medium text-slate-800">
            {review.completion.label}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {review.completion.completedSetCount} completed of{" "}
            {review.completion.plannedSetCount} planned sets
            {review.completion.skippedSetCount > 0
              ? `, ${review.completion.skippedSetCount} skipped`
              : ""}
            {review.completion.extraSetCount > 0
              ? `, ${review.completion.extraSetCount} session-local extra`
              : ""}
            {review.completion.missingLogSetCount > 0
              ? `, ${review.completion.missingLogSetCount} unlogged`
              : ""}
            .
          </p>
        </div>
      ) : null}

      <div className="mt-5 space-y-5">
        {review.exerciseChanges.length > 0 ? (
          <Section title="Exercise changes">
            <div className="space-y-2">
              {review.exerciseChanges.map((row) => (
                <div
                  key={rowKey(row.kind, row.exerciseName, row.headline)}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <p className="text-sm font-medium text-slate-900">{row.headline}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{row.detail}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {review.performedRealityTrends?.length ? (
          <Section title="Recent trends">
            <div className="space-y-2">
              {review.performedRealityTrends.map((row) => (
                <div
                  key={rowKey(row.label, row.headline)}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {row.label}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {row.headline}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{row.detail}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {review.performedReality?.length ? (
          <Section title="Performed reality">
            <div className="space-y-2">
              {review.performedReality.map((row) => (
                <div
                  key={rowKey(row.exerciseName, row.headline)}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {row.label}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    {row.headline}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{row.detail}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {review.loadCalibration.length > 0 ? (
          <Section title="Load calibration">
            <div className="space-y-2">
              {review.loadCalibration.map((row) => (
                <div
                  key={rowKey(row.exerciseName, row.headline)}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <p className="text-sm font-medium text-slate-900">{row.headline}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{row.detail}</p>
                  {row.nextExposureNote ? (
                    <p className="mt-1 text-sm leading-6 text-slate-700">
                      {row.nextExposureNote}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {review.nextExposureNotes.length > 0 ? (
          <Section title="Next exposure notes">
            <div className="space-y-2">
              {review.nextExposureNotes.map((row) => (
                <div
                  key={rowKey(row.exerciseName, row.recommendation)}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <p className="text-sm font-medium text-slate-900">
                    {row.exerciseName}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-700">
                    {row.recommendation}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{row.basis}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {review.weeklyImpact.length > 0 ? (
          <Section title="Weekly impact">
            <div className="space-y-2">
              {review.weeklyImpact.map((row) => (
                <div
                  key={rowKey(row.muscle, row.headline)}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <p className="text-sm font-medium text-slate-900">{row.headline}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{row.detail}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {review.learningSignals.length > 0 ? (
          <Section title="Learning signals">
            <div className="space-y-2">
              {review.learningSignals.map((row) => (
                <div key={rowKey(row.label, row.summary)} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-900">{row.label}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{row.summary}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {review.warnings.length > 0 ? (
          <Section title="Warnings">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              {review.warnings.map((warning) => (
                <p key={warning} className="text-sm leading-6 text-amber-900">
                  {warning}
                </p>
              ))}
            </div>
          </Section>
        ) : null}
      </div>

      <p className="mt-5 text-xs font-medium text-slate-500">
        {review.source.noMutationNote}
      </p>
    </section>
  );
}
