/**
 * SessionContextCard - Session-level explanation
 *
 * Phase 4.6: Display block phase, volume status, and readiness
 *
 * Explains "Why this workout today?" at macro level
 */

"use client";

import type { SessionContext } from "@/lib/engine/explainability";

type Props = {
  context: SessionContext;
};

export function SessionContextCard({ context }: Props) {
  const { volumeStatus, readinessStatus, progressionContext, narrative } = context;

  // Map readiness to color
  const readinessColor = {
    fresh: "text-green-700",
    moderate: "text-yellow-700",
    fatigued: "text-red-700",
  }[readinessStatus.overall];

  // Convert volume status Map to array
  const volumeStatuses = Array.from(volumeStatus.muscleStatuses.entries());

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:p-5">
      <h3 className="text-base font-semibold text-slate-900">Session Context</h3>
      <p className="mt-2 text-slate-700">{narrative}</p>

      <div className="mt-4 space-y-3">
        {/* Progression Context */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Progression
          </p>
          <p className="mt-1 text-sm text-slate-700">
            Week {progressionContext.weekInMesocycle} — Volume: {progressionContext.volumeProgression}, Intensity:{" "}
            {progressionContext.intensityProgression}
          </p>
          <p className="mt-1 text-xs text-slate-600">{progressionContext.nextMilestone}</p>
        </div>

        {/* Readiness */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Readiness
          </p>
          <p className="mt-1 text-sm">
            <span className={`font-medium ${readinessColor}`}>
              {readinessStatus.overall.charAt(0).toUpperCase() + readinessStatus.overall.slice(1)}
            </span>
            {readinessStatus.signalAge > 0 && (
              <span className="ml-2 text-xs text-slate-500">
                (last check-in {readinessStatus.signalAge}d ago)
              </span>
            )}
          </p>
          {readinessStatus.adaptations.length > 0 && (
            <ul className="mt-1 space-y-1">
              {readinessStatus.adaptations.map((adaptation, idx) => (
                <li key={idx} className="text-xs text-slate-600">
                  • {adaptation}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Volume Status */}
        {volumeStatuses.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Volume Status
            </p>
            <p className="mt-1 text-xs text-slate-600">{volumeStatus.overallSummary}</p>
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
                  <div
                    key={muscle}
                    className={`rounded-lg border px-2 py-1 text-xs ${statusColor}`}
                  >
                    <p className="font-medium">{muscle}</p>
                    <p className="text-xs">
                      {status.currentSets} / {status.targetRange.min}-{status.targetRange.max} sets
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
