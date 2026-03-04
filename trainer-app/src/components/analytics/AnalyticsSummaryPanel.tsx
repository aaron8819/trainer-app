"use client";

import { useEffect, useState } from "react";

type SummaryBucket = {
  generated: number;
  performed: number;
  completed: number;
  performedRate: number | null;
  completionRate: number | null;
};

type AnalyticsSummaryResponse = {
  totals: {
    workoutsGenerated: number;
    workoutsPerformed: number;
    workoutsCompleted: number;
    totalSets: number;
  };
  kpis: {
    selectionModes: Array<SummaryBucket & { mode: string }>;
    intents: Array<SummaryBucket & { intent: string }>;
  };
};

function formatPercent(value: number | null): string {
  return value === null ? "N/A" : `${Math.round(value * 100)}%`;
}

function formatIntent(intent: string): string {
  return intent
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function AnalyticsSummaryPanel() {
  const [data, setData] = useState<AnalyticsSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/analytics/summary")
      .then((r) => r.json())
      .then((payload) => setData(payload))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        Loading analytics summary...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500 sm:p-6">
        No analytics summary available yet.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Generated Workouts
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {data.totals.workoutsGenerated}
          </p>
          <p className="mt-1 text-xs text-slate-500">All saved workouts.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Performed Workouts
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {data.totals.workoutsPerformed}
          </p>
          <p className="mt-1 text-xs text-slate-500">Completed plus partial sessions.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Completed Workouts
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {data.totals.workoutsCompleted}
          </p>
          <p className="mt-1 text-xs text-slate-500">Only fully completed sessions.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Performed Sets
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{data.totals.totalSets}</p>
          <p className="mt-1 text-xs text-slate-500">Logged, non-skipped set records.</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Selection Modes</h3>
          <div className="mt-3 space-y-2">
            {data.kpis.selectionModes.map((item) => (
              <div
                key={item.mode}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">{item.mode}</p>
                  <p className="text-xs text-slate-500">
                    {item.performed} performed / {item.generated} generated
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>Performed {formatPercent(item.performedRate)}</p>
                  <p>Completed {formatPercent(item.completionRate)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Session Intents</h3>
          <div className="mt-3 space-y-2">
            {data.kpis.intents.length === 0 ? (
              <p className="text-sm text-slate-500">No intent history yet.</p>
            ) : (
              data.kpis.intents.map((item) => (
                <div
                  key={item.intent}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {formatIntent(item.intent)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.performed} performed / {item.generated} generated
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>Performed {formatPercent(item.performedRate)}</p>
                    <p>Completed {formatPercent(item.completionRate)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
