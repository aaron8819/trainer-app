import type {
  ClassifiedHypertrophyPlanHealthIssue,
  HypertrophyPlanHealthAssessment,
  HypertrophyPlanHealthResult,
  HypertrophyPlanHealthTier,
} from "@/lib/engine/hypertrophy-plan-health";

const TIER_PRESENTATION: Record<
  Exclude<HypertrophyPlanHealthTier, "INFORMATIONAL_ESTIMATE">,
  { heading: string; label: string; description: string }
> = {
  BLOCKING_SAFETY: {
    heading: "Needs attention",
    label: "Blocking safety",
    description: "These issues must be resolved before finalization.",
  },
  IMPORTANT_WARNING: {
    heading: "Review before finalizing",
    label: "Important warning",
    description: "These issues require deliberate acknowledgment at finalization.",
  },
  COACHING_OBSERVATION: {
    heading: "Coaching notes",
    label: "Coaching observation",
    description: "These notes are optional context and do not require acknowledgment.",
  },
};

function formatApproximate(value: number): string {
  return `~${Number.isInteger(value) ? value : value.toFixed(1)}`;
}
function IssueList({
  assessment,
  tier,
}: {
  assessment: HypertrophyPlanHealthAssessment;
  tier: Exclude<HypertrophyPlanHealthTier, "INFORMATIONAL_ESTIMATE">;
}) {
  const presentation = TIER_PRESENTATION[tier];
  const issues = assessment.issues.filter((issue) => issue.tier === tier);
  return (
    <details className="border-t border-slate-200 py-1" open={tier === "BLOCKING_SAFETY" && issues.length > 0}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-semibold text-slate-900">
        <span>{presentation.heading}</span>
        <span aria-label={`${issues.length} ${presentation.label.toLowerCase()} issues`}>
          {issues.length}
        </span>
      </summary>
      <div className="pb-3">
        <p className="text-xs text-slate-600">{presentation.description}</p>
        {issues.length > 0 ? (
          <ul className="mt-3 space-y-3" aria-label={presentation.heading}>
            {issues.map((issue, index) => (
              <IssueCard key={`${issue.code}-${index}`} issue={issue} label={presentation.label} />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-500">None in the saved assessment.</p>
        )}
      </div>
    </details>
  );
}

function IssueCard({
  issue,
  label,
}: {
  issue: ClassifiedHypertrophyPlanHealthIssue;
  label: string;
}) {
  const affected = [
    issue.affected?.session,
    issue.affected?.exercise,
    issue.affected?.muscle,
  ].filter(Boolean);
  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
        {label}
        {issue.blocksFinalization ? " · Blocks finalization" : " · Does not block finalization"}
      </p>
      <h4 className="mt-1 text-sm font-semibold text-slate-950">{issue.title}</h4>
      <p className="mt-1 text-xs leading-5 text-slate-700">{issue.explanation}</p>
      {affected.length > 0 ? (
        <p className="mt-1 text-xs text-slate-600">Affected: {affected.join(" · ")}</p>
      ) : null}
      <p className="mt-2 text-xs text-slate-700">
        <span className="font-semibold">Next action:</span> {issue.suggestedAction}
      </p>
    </li>
  );
}

export function PlanHealthPanel({
  health,
  stale,
  updating,
}: {
  health: HypertrophyPlanHealthResult;
  stale: boolean;
  updating: boolean;
}) {
  const stateText = stale
    ? updating
      ? "Updating after save… Based on the last saved version."
      : "Based on the last saved version. Local edits are not included yet."
    : health.status === "AVAILABLE"
      ? `Current for saved revision ${health.draftRevision}.`
      : `Unavailable for saved revision ${health.draftRevision}.`;

  return (
    <section
      aria-labelledby="plan-health-heading"
      aria-describedby="plan-health-state"
      aria-busy={updating}
      className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="plan-health-heading" className="font-semibold text-slate-950">
            Plan Health
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Safety and coaching context for the saved draft. Health never changes your plan.
          </p>
        </div>
        {health.status === "AVAILABLE" ? (
          <span className="rounded-full border border-slate-300 px-2 py-1 text-xs text-slate-700">
            Saved revision {health.draftRevision}
          </span>
        ) : null}
      </div>

      <p
        id="plan-health-state"
        className={`mt-3 rounded-lg border p-2 text-xs ${
          stale || health.status === "UNAVAILABLE"
            ? "border-amber-200 bg-amber-50 text-amber-950"
            : "border-slate-200 bg-slate-50 text-slate-700"
        }`}
      >
        {stateText}
      </p>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        Plan Health: {stateText}
      </span>

      {health.status === "UNAVAILABLE" ? (
        <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <h3 className="text-sm font-semibold text-amber-950">Health is temporarily unavailable</h3>
          <p className="mt-1 text-xs leading-5 text-amber-900">
            You can keep editing. This is not a “no issues” result, and finalization will still run a fresh authoritative check.
          </p>
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-center text-xs">
            <div className="rounded-lg border border-slate-200 p-2">
              <dt className="text-slate-600">Blocking</dt>
              <dd className="mt-1 text-lg font-semibold text-slate-950">
                {health.summary.blockingSafety}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 p-2">
              <dt className="text-slate-600">Important</dt>
              <dd className="mt-1 text-lg font-semibold text-slate-950">
                {health.summary.importantWarnings}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 p-2">
              <dt className="text-slate-600">Coaching</dt>
              <dd className="mt-1 text-lg font-semibold text-slate-950">
                {health.summary.coachingObservations}
              </dd>
            </div>
            <div className="rounded-lg border border-slate-200 p-2">
              <dt className="text-slate-600">Volume estimates</dt>
              <dd className="mt-1 font-semibold text-slate-950">
                {health.summary.informationalVolumeAvailable ? "Available" : "Unavailable"}
              </dd>
            </div>
          </dl>

          <div className="mt-4">
            <IssueList assessment={health} tier="BLOCKING_SAFETY" />
            <IssueList assessment={health} tier="IMPORTANT_WARNING" />
            <IssueList assessment={health} tier="COACHING_OBSERVATION" />
            <details className="border-t border-slate-200 py-1">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-sm font-semibold text-slate-900">
                <span>Estimated weekly volume</span>
                <span>{health.volumeEstimates.length}</span>
              </summary>
              <div className="pb-3">
                <p className="text-xs leading-5 text-slate-600">
                  Informational estimates{health.evaluatedWeek ? ` for Week ${health.evaluatedWeek}` : ""}. Effective sets can include fractional, compound-derived stimulus. Reference ranges are context, not quotas.
                </p>
                {health.volumeEstimates.length > 0 ? (
                  <ul className="mt-3 space-y-2" aria-label="Informational estimated weekly volume">
                    {health.volumeEstimates.map((volume) => (
                      <li key={volume.muscle} className="rounded-lg border border-slate-200 p-2 text-xs text-slate-700">
                        <span className="font-semibold text-slate-950">{volume.muscle}</span>
                        {`: ${formatApproximate(volume.effectiveSets)} effective sets · ${formatApproximate(volume.directSets)} direct sets · ${volume.frequency}× weekly frequency`}
                        {volume.referenceRange
                          ? ` · reference context ${volume.referenceRange.min}–${volume.referenceRange.max}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">No informational estimate is available for this saved draft.</p>
                )}
              </div>
            </details>
          </div>
        </>
      )}
    </section>
  );
}
