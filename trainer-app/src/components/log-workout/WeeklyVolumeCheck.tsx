"use client";

import { useEffect, useMemo, useState } from "react";
import { loadWeeklyVolumeCheckRequest } from "@/components/log-workout/api";
import type { LoggingWeeklyVolumeGuidance } from "@/lib/api/logging-weekly-volume-guidance";

function formatVolume(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function statusClasses(status: LoggingWeeklyVolumeGuidance["rows"][number]["status"]): string {
  switch (status) {
    case "below_mev":
      return "bg-rose-100 text-rose-700";
    case "in_range":
      return "bg-amber-100 text-amber-800";
    case "near_target":
      return "bg-sky-100 text-sky-800";
    case "on_target":
      return "bg-emerald-100 text-emerald-700";
    case "near_mrv":
      return "bg-orange-100 text-orange-800";
    case "at_mrv":
      return "bg-fuchsia-100 text-fuchsia-800";
  }
}

export function WeeklyVolumeCheck({
  workoutId,
  visible,
  refreshKey,
}: {
  workoutId: string;
  visible: boolean;
  refreshKey: string;
}) {
  const [data, setData] = useState<LoggingWeeklyVolumeGuidance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let cancelled = false;

    void loadWeeklyVolumeCheckRequest(workoutId)
      .then((response) => {
        if (cancelled) {
          return;
        }

        if (response.error) {
          setError(response.error);
          setData(null);
          return;
        }

        setError(null);
        setData(response.data);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setError("Weekly volume check unavailable.");
        setData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, visible, workoutId]);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  if (!visible) {
    return null;
  }

  return (
    <section
      aria-label="Weekly Volume Check"
      className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm"
      data-testid="weekly-volume-check"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Weekly Volume Check</h2>
          <p className="mt-1 text-xs text-slate-600">
            If you finish now, this is where flagged muscles are projected to land by week end.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-amber-700">{error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-700">
          If you finish now, no muscles are currently projected below target.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {rows.map((row) => (
            <article
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
              data-testid={`weekly-volume-row-${row.muscle}`}
              key={row.muscle}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">{row.muscle}</p>
                <span
                  className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${statusClasses(row.status)}`}
                >
                  {row.statusLabel}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-700">
                Done now {formatVolume(row.doneNow)} • Projected {formatVolume(row.projectedEndOfWeek)} •
                Target {formatVolume(row.weeklyTarget)} • Delta {formatVolume(row.deltaToTarget)}
              </p>
              {row.topUpHint ? (
                <p className="mt-1 text-xs font-medium text-slate-600">{row.topUpHint}</p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
