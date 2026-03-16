"use client";

import type {
  ExerciseRationale,
  PrescriptionRationale,
  NextExposureDecision,
} from "@/lib/engine/explainability";
import type { ProgressionReceipt } from "@/lib/evidence/types";
import { PrescriptionDetails } from "./PrescriptionDetails";

type Props = {
  rationale: ExerciseRationale;
  prescription?: PrescriptionRationale;
  progressionReceipt?: ProgressionReceipt;
  nextExposureDecision?: NextExposureDecision;
  isExpanded: boolean;
  onToggle: () => void;
};

export function ExerciseRationaleCard({
  rationale,
  prescription,
  progressionReceipt,
  nextExposureDecision,
  isExpanded,
  onToggle,
}: Props) {
  const plainLanguageFactors = getPlainLanguageFactors(rationale);
  const lastPerformedSummary = formatSummary(progressionReceipt?.lastPerformed);
  const todayTargetSummary = formatSummary(progressionReceipt?.todayPrescription);

  return (
    <div className="rounded-xl border border-slate-200 bg-white text-sm">
      <button onClick={onToggle} className="w-full px-4 py-3 text-left hover:bg-slate-50 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">{rationale.exerciseName}</p>
            <p className="mt-1 text-xs text-slate-600">{rationale.volumeContribution}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">{isExpanded ? "Hide" : "Open"} drill-down</span>
            <svg
              className={`h-5 w-5 text-slate-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
      </button>

      {isExpanded ? (
        <div className="border-t border-slate-100 px-4 py-3 sm:px-5">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why this lift stayed in</p>
            <ul className="mt-2 space-y-1">
              {rationale.primaryReasons.map((reason, idx) => (
                <li key={idx} className="flex items-start gap-2 text-slate-700">
                  <span className="text-slate-400">*</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>

          {plainLanguageFactors.length > 0 ? (
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Top factors</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {plainLanguageFactors.map((factor) => (
                  <div key={factor.label} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-700">{factor.label}</p>
                    <p className="mt-1 text-xs text-slate-600">{factor.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {prescription ? (
            <div className="mb-4">
              <PrescriptionDetails prescription={prescription} />
            </div>
          ) : null}

          {nextExposureDecision ? (
            <div className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Next exposure
              </p>
              <p className="mt-1 text-sm text-emerald-950">{nextExposureDecision.summary}</p>
              <p className="mt-1 text-xs text-emerald-900">{nextExposureDecision.reason}</p>
              <p className="mt-1 text-xs text-emerald-800">
                Anchor {nextExposureDecision.anchorLoad ?? "n/a"} | median reps{" "}
                {nextExposureDecision.medianReps ?? "n/a"} | modal RPE {nextExposureDecision.modalRpe ?? "n/a"}
              </p>
              {nextExposureDecision.decisionLog && nextExposureDecision.decisionLog.length > 0 ? (
                <p className="mt-1 text-xs text-emerald-900">
                  {nextExposureDecision.decisionLog[nextExposureDecision.decisionLog.length - 1]}
                </p>
              ) : null}
            </div>
          ) : null}

          {progressionReceipt ? (
            <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Today&apos;s target context
              </p>
              <p className="mt-1 text-sm text-slate-700">{formatTrigger(progressionReceipt.trigger)}</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Prior session anchor
                  </p>
                  <p className="mt-1 text-xs text-slate-700">{lastPerformedSummary.label}</p>
                  {lastPerformedSummary.detail ? (
                    <p className="mt-1 text-xs text-slate-500">{lastPerformedSummary.detail}</p>
                  ) : null}
                </div>
                <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Today&apos;s written target
                  </p>
                  <p className="mt-1 text-xs text-slate-700">{todayTargetSummary.label}</p>
                  {todayTargetSummary.detail ? (
                    <p className="mt-1 text-xs text-slate-500">{todayTargetSummary.detail}</p>
                  ) : null}
                </div>
              </div>
              {progressionReceipt.delta.loadPercent != null ? (
                <p className="mt-1 text-xs text-slate-600">
                  Change: {progressionReceipt.delta.loadPercent >= 0 ? "+" : ""}
                  {progressionReceipt.delta.loadPercent.toFixed(1)}% load
                </p>
              ) : null}
            </div>
          ) : null}

          {rationale.citations.length > 0 ? (
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Research note</p>
              <div className="mt-2 space-y-2">
                {rationale.citations.slice(0, 2).map((citation) => (
                  <div key={citation.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-800">
                      {citation.authors} ({citation.year})
                    </p>
                    <p className="mt-1 text-xs text-slate-600">{citation.finding}</p>
                    {citation.url ? (
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs font-medium text-slate-700 underline"
                      >
                        Open source
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {rationale.alternatives.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Other options skipped</p>
              <div className="mt-2 space-y-2">
                {rationale.alternatives.slice(0, 2).map((alt, idx) => (
                  <div key={idx} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                    <p className="text-xs font-medium text-slate-700">{alt.exerciseName}</p>
                    <p className="text-xs text-slate-600">{alt.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function getPlainLanguageFactors(rationale: ExerciseRationale): Array<{ label: string; explanation: string }> {
  const labels: Array<{ key: keyof ExerciseRationale["selectionFactors"]; label: string }> = [
    { key: "deficitFill", label: "Volume need" },
    { key: "rotationNovelty", label: "Exercise rotation" },
    { key: "sfrEfficiency", label: "Fatigue tradeoff" },
    { key: "lengthenedPosition", label: "Muscle challenge" },
    { key: "sraAlignment", label: "Recovery fit" },
    { key: "userPreference", label: "Preference fit" },
    { key: "movementNovelty", label: "Movement variety" },
  ];

  return labels
    .map(({ key, label }) => ({
      label,
      explanation: rationale.selectionFactors[key].explanation,
      score: rationale.selectionFactors[key].score,
    }))
    .filter((factor) => factor.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ label, explanation }) => ({ label, explanation }));
}

function formatTrigger(trigger: ProgressionReceipt["trigger"]): string {
  switch (trigger) {
    case "double_progression":
      return "Recent performance supported writing a heavier target for today.";
    case "hold":
      return "Recent performance supported writing the same target for today.";
    case "deload":
      return "Today's written target was reduced because this session is in deload mode.";
    case "readiness_scale":
      return "Today's written target was adjusted to match readiness.";
    default:
      return "There was not enough recent performed history to move today's written target.";
  }
}

function formatSummary(
  summary: ProgressionReceipt["lastPerformed"] | ProgressionReceipt["todayPrescription"] | undefined
) {
  if (!summary) {
    return {
      label: "No recent performed anchor",
    };
  }

  const parts = [
    summary.reps != null ? `${summary.reps} reps` : null,
    summary.load != null ? `${summary.load} load` : null,
    summary.rpe != null ? `RPE ${summary.rpe}` : null,
  ].filter(Boolean);

  return {
    label: parts.length > 0 ? parts.join(" | ") : "No recent performed anchor",
    detail:
      "performedAt" in summary && summary.performedAt
        ? `Logged ${new Date(summary.performedAt).toLocaleDateString()}`
        : undefined,
  };
}
