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
      </section>
    );
  }

  const hasEvidence = Boolean(
    review.completion ||
      review.exerciseChanges.length ||
      review.performedReality?.length ||
      review.performedRealityTrends?.length ||
      review.loadCalibration.length ||
      review.learningSignals.length
  );

  return (
    <section
      aria-label="Post-session review"
      className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Session result
      </p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">{review.headline}</h2>
      {review.summaryBullets[0] ? (
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {review.summaryBullets[0]}
        </p>
      ) : null}

      <div className="mt-5 space-y-5">
        {review.nextExposureNotes.length > 0 ? (
          <Section title="Next time">
            <div className="space-y-2">
              {review.nextExposureNotes.map((row) => (
                <div
                  key={rowKey(row.exerciseName, row.recommendation)}
                  className="rounded-xl border border-slate-200 p-3"
                >
                  <p className="text-sm font-medium text-slate-900">{row.exerciseName}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-700">
                    {row.recommendation}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{row.basis}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {review.warnings.length > 0 ? (
          <Section title="Unusual or potentially incorrect">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              {review.warnings.map((warning) => (
                <p key={warning} className="text-sm leading-6 text-amber-900">
                  {warning}
                </p>
              ))}
            </div>
          </Section>
        ) : null}

        {review.weeklyImpact.length > 0 ? (
          <Section title="Weekly impact">
            <div className="space-y-2">
              {review.weeklyImpact.map((row) => (
                <div key={rowKey(row.muscle, row.headline)}>
                  <p className="text-sm font-medium text-slate-900">{row.headline}</p>
                  <p className="mt-0.5 text-sm leading-6 text-slate-600">{row.detail}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}
      </div>

      {hasEvidence ? (
        <details className="mt-5 border-t border-slate-200 pt-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">
            Review evidence
          </summary>
          <div className="mt-4 space-y-5">
            {review.completion ? (
              <Section title="Completion">
                <p className="text-sm leading-6 text-slate-700">
                  {review.completion.completedSetCount} completed of{" "}
                  {review.completion.plannedSetCount} planned sets
                  {review.completion.skippedSetCount > 0
                    ? `, ${review.completion.skippedSetCount} skipped`
                    : ""}
                  {review.completion.extraSetCount > 0
                    ? `, ${review.completion.extraSetCount} extra`
                    : ""}
                  {review.completion.missingLogSetCount > 0
                    ? `, ${review.completion.missingLogSetCount} unlogged`
                    : ""}
                  .
                </p>
              </Section>
            ) : null}

            {review.exerciseChanges.length > 0 ? (
              <Section title="Exercise changes">
                {review.exerciseChanges.map((row) => (
                  <div key={rowKey(row.kind, row.exerciseName)} className="mb-2">
                    <p className="text-sm font-medium text-slate-900">{row.headline}</p>
                    <p className="text-sm leading-6 text-slate-600">{row.detail}</p>
                  </div>
                ))}
              </Section>
            ) : null}

            {review.performedRealityTrends?.length ? (
              <Section title="Recent trends">
                {review.performedRealityTrends.map((row) => (
                  <div key={rowKey(row.label, row.headline)} className="mb-2">
                    <p className="text-sm font-medium text-slate-900">{row.headline}</p>
                    <p className="text-sm leading-6 text-slate-600">{row.detail}</p>
                  </div>
                ))}
              </Section>
            ) : null}

            {review.performedReality?.length ? (
              <Section title="Performed work">
                {review.performedReality.map((row) => (
                  <div key={rowKey(row.exerciseName, row.headline)} className="mb-2">
                    <p className="text-sm font-medium text-slate-900">{row.headline}</p>
                    <p className="text-sm leading-6 text-slate-600">{row.detail}</p>
                  </div>
                ))}
              </Section>
            ) : null}

            {review.loadCalibration.length > 0 ? (
              <Section title="Load evidence">
                {review.loadCalibration.map((row) => (
                  <div key={rowKey(row.exerciseName, row.headline)} className="mb-2">
                    <p className="text-sm font-medium text-slate-900">{row.headline}</p>
                    <p className="text-sm leading-6 text-slate-600">{row.detail}</p>
                  </div>
                ))}
              </Section>
            ) : null}

            {review.learningSignals.length > 0 ? (
              <Section title="Other evidence">
                {review.learningSignals.map((row) => (
                  <p key={rowKey(row.label, row.summary)} className="text-sm leading-6 text-slate-600">
                    <span className="font-medium text-slate-800">{row.label}:</span>{" "}
                    {row.summary}
                  </p>
                ))}
              </Section>
            ) : null}

            <p className="text-xs font-medium text-slate-500">
              {review.source.noMutationNote}
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
}
