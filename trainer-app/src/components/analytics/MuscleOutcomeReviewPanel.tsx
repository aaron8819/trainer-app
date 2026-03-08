"use client";

import { useEffect, useState } from "react";
import type {
  MuscleOutcomeStatus,
  WeeklyMuscleOutcomeReview,
} from "@/lib/api/muscle-outcome-review";

type MuscleOutcomeReviewResponse = {
  review: WeeklyMuscleOutcomeReview | null;
};

function formatSignedValue(value: number): string {
  if (value === 0) {
    return "0.0";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}

function formatPercentDelta(value: number): string {
  return `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

function formatStatusLabel(status: MuscleOutcomeStatus): string {
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

function getStatusClasses(status: MuscleOutcomeStatus): string {
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

export function MuscleOutcomeReviewPanel() {
  const [data, setData] = useState<MuscleOutcomeReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/muscle-outcomes")
      .then((response) => response.json())
      .then((payload) => setData(payload))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        Loading muscle outcome review...
      </div>
    );
  }

  if (!data?.review) {
    return (
      <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        No active mesocycle outcome review is available yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
        Week {data.review.week} outcome review. Targets use canonical lifecycle volume targets and
        actuals use weighted effective stimulus from performed workouts only.
      </div>

      <div className="overflow-x-auto">
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
            {data.review.rows.map((row) => (
              <tr key={row.muscle} className="align-top text-sm text-slate-700">
                <td className="border-b border-slate-100 px-3 py-3">
                  <p className="font-medium text-slate-900">{row.muscle}</p>
                  {row.contributingExerciseCount > 0 && (
                    <div className="mt-1 space-y-1 text-xs text-slate-500">
                      <p>{row.contributingExerciseCount} contributing exercises</p>
                      {row.topContributors.length > 0 && (
                        <p>
                          Top drivers:{" "}
                          {row.topContributors
                            .map(
                              (contribution) =>
                                `${contribution.exerciseName} ${contribution.effectiveSets.toFixed(1)}`
                            )
                            .join(", ")}
                        </p>
                      )}
                    </div>
                  )}
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
                    {formatPercentDelta(row.percentDelta)}
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
    </div>
  );
}
