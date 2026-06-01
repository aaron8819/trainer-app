"use client";

import { useEffect, useMemo, useState } from "react";
import { loadWeeklyVolumeCheckRequest } from "@/components/log-workout/api";
import type { LoggingWeeklyVolumeGuidance } from "@/lib/api/logging-weekly-volume-guidance";

function formatVolume(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function statusClasses(status: LoggingWeeklyVolumeGuidance["rows"][number]["status"]): string {
  switch (status) {
    case "floor_risk":
      return "bg-rose-100 text-rose-700";
    case "optional_floor_buffer":
      return "bg-amber-100 text-amber-800";
    case "productive":
    case "on_track":
      return "bg-emerald-100 text-emerald-700";
    case "ahead_suppress_extras":
    case "near_cap":
      return "bg-orange-100 text-orange-800";
    case "over_cap":
      return "bg-fuchsia-100 text-fuchsia-800";
    case "no_addons_recommended":
      return "bg-slate-100 text-slate-700";
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
      aria-label="Weekly projection"
      className="rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm"
      data-testid="weekly-volume-check"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Weekly projection</h2>
          <p className="mt-1 text-xs text-slate-600">
            Final session-local check from performed work, this workout, and remaining projected sessions.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-amber-700">{error}</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-700">
          {data?.summary?.reasonCopy ??
            "No add-ons recommended. Finish the session and let review reconcile the completed work."}
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
                Performed {formatVolume(row.performedSoFar)} | Remaining plan{" "}
                {formatVolume(row.plannedRemaining)} | Projected finish{" "}
                {formatVolume(row.projectedFinish)} | MEV {formatVolume(row.MEV)} | MAV{" "}
                {formatVolume(row.MAV)}
              </p>
              <p className="mt-1 text-xs font-medium text-slate-600">{row.reasonCopy}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
