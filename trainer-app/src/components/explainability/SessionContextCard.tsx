/**
 * SessionContextCard - Session-level explanation
 *
 * Phase 4.6: Display block phase, volume status, and readiness
 *
 * Explains "Why this workout today?" at macro level
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import type { ExplainabilityConfidence, SessionContext } from "@/lib/engine/explainability";

type Props = {
  context: SessionContext;
  confidence: ExplainabilityConfidence;
  intentLabel?: string;
  deloadSummary?: string | null;
  basisLabel: string;
  startLoggingHref?: string | null;
};

export function SessionContextCard({
  context,
  confidence,
  intentLabel,
  deloadSummary,
  basisLabel,
  startLoggingHref,
}: Props) {
  const { volumeStatus, readinessStatus, progressionContext } = context;
  const [showMissingSignals, setShowMissingSignals] = useState(false);

  const readinessColor = {
    fresh: "text-green-700",
    moderate: "text-yellow-700",
    fatigued: "text-red-700",
  }[readinessStatus.overall];

  const readinessLabelColor =
    readinessStatus.availability === "missing"
      ? "text-slate-700"
      : readinessStatus.availability === "stale"
      ? "text-amber-700"
      : readinessColor;

  const volumeStatuses = Array.from(volumeStatus.muscleStatuses.entries());
  const confidenceTone =
    confidence.level === "high"
      ? "text-emerald-700"
      : confidence.level === "medium"
      ? "text-amber-700"
      : "text-slate-700";

  const phaseWeekLabel = `${context.blockPhase.blockType} W${context.blockPhase.weekInBlock}`;
  const hasActiveDeload = Boolean(deloadSummary);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:p-5">
      <h3 className="text-base font-semibold text-slate-900">Training Status</h3>
      <div className="mt-3 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">{phaseWeekLabel}</span>
            {context.cycleSource === "fallback" ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                Cycle context estimated
              </span>
            ) : null}
            <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1">
              {intentLabel ?? "Intent unavailable"}
            </span>
            {hasActiveDeload ? (
              <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">
                {deloadSummary}
              </span>
            ) : null}
          </div>
          {startLoggingHref ? (
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold"
              href={startLoggingHref}
            >
              Start logging
            </Link>
          ) : null}
        </div>

        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <p className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
            Readiness: <span className={`font-medium ${readinessLabelColor}`}>{readinessStatus.label}</span>
          </p>
          <p className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">{basisLabel}</p>
          <p className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
            Confidence: <span className={`font-medium ${confidenceTone}`}>{confidence.level}</span>
            {confidence.missingSignals.length > 0 ? (
              <button
                className="ml-2 text-[11px] underline"
                onClick={() => setShowMissingSignals((prev) => !prev)}
                type="button"
              >
                Show missing signals
              </button>
            ) : null}
          </p>
        </div>
      </div>

      {showMissingSignals && confidence.missingSignals.length > 0 ? (
        <p className="mt-2 text-xs text-slate-600">
          Missing signals: {confidence.missingSignals.join(", ")}.
        </p>
      ) : null}

      <p className="mt-2 text-xs text-slate-600">
        Progression: {progressionContext.volumeProgression} / {progressionContext.intensityProgression}.{" "}
        {progressionContext.nextMilestone}
      </p>

      {readinessStatus.adaptations.length > 0 ? (
        <p className="mt-1 text-xs text-slate-600">{readinessStatus.adaptations.join(" | ")}</p>
      ) : null}

      {volumeStatuses.length > 0 ? (
        <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            Volume (7d): {volumeStatus.overallSummary}
          </summary>
          <p className="mt-1 text-[11px] text-slate-500">Performed sets in a rolling 7-day window (today inclusive).</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {volumeStatuses.map(([muscle, status]) => {
              const statusColor = {
                below_mev: "bg-red-50 text-red-700 border-red-200",
                at_mev: "bg-yellow-50 text-yellow-700 border-yellow-200",
                optimal: "bg-green-50 text-green-700 border-green-200",
                approaching_mrv: "bg-orange-50 text-orange-700 border-orange-200",
                at_mrv: "bg-red-50 text-red-700 border-red-200",
              }[status.status];

              return (
                <div key={muscle} className={`rounded-lg border px-2 py-1 text-xs ${statusColor}`}>
                  <p className="font-medium">{muscle}</p>
                  <p className="text-xs">
                    {status.currentSets} / {status.targetRange.min}-{status.targetRange.max} sets
                  </p>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
