"use client";

import { useMemo, useState } from "react";
import type { ProgramWeekCompletionOutlook } from "@/lib/api/program-page";
import type { MuscleOutcomeStatus } from "@/lib/api/muscle-outcome-review";

const BADGE_STYLE: Record<
  MuscleOutcomeStatus,
  {
    baseClassName: string;
    activeClassName: string;
  }
> = {
  meaningfully_low: {
    baseClassName: "bg-rose-50 text-rose-700",
    activeClassName: "ring-2 ring-rose-300",
  },
  slightly_low: {
    baseClassName: "bg-amber-50 text-amber-700",
    activeClassName: "ring-2 ring-amber-300",
  },
  on_target: {
    baseClassName: "bg-emerald-50 text-emerald-700",
    activeClassName: "ring-2 ring-emerald-300",
  },
  slightly_high: {
    baseClassName: "bg-sky-50 text-sky-700",
    activeClassName: "ring-2 ring-sky-300",
  },
  meaningfully_high: {
    baseClassName: "bg-indigo-50 text-indigo-700",
    activeClassName: "ring-2 ring-indigo-300",
  },
};

function formatSummaryBadgeLabel(
  status: MuscleOutcomeStatus,
  fallback: string,
): string {
  switch (status) {
    case "meaningfully_low":
      return "below MEV";
    case "slightly_low":
      return "below preferred";
    case "on_target":
      return "productive zone";
    case "slightly_high":
      return "above preferred";
    case "meaningfully_high":
      return "watch high";
  }

  return fallback;
}

function formatRowsHeading(selectedStatus: MuscleOutcomeStatus | null): string {
  if (!selectedStatus) {
    return "Priority coaching notes";
  }

    return `${formatSummaryBadgeLabel(selectedStatus, "selected")} primary targets`;
}

export function WeekCompletionOutlookSection({
  outlook,
}: {
  outlook: ProgramWeekCompletionOutlook;
}) {
  const [selectedStatus, setSelectedStatus] = useState<MuscleOutcomeStatus | null>(null);

  const primaryRows =
    outlook.primaryRows ??
    outlook.rows.filter(
      (row) => (row.dashboardGroup ?? row.displayGroup) === "primary_driver"
    );
  const supportRows =
    outlook.supportRows ??
    outlook.rows.filter((row) => row.dashboardGroup === "support_driver");
  const secondaryRows =
    outlook.secondaryRows ??
    outlook.rows.filter((row) => (row.dashboardGroup ?? row.displayGroup) === "secondary");
  const secondaryBadges = outlook.secondaryBadges ?? [];
  const visibleRows = useMemo(() => {
    if (!selectedStatus) {
      return outlook.defaultRows;
    }

    return primaryRows.filter((row) => row.status === selectedStatus);
  }, [outlook.defaultRows, primaryRows, selectedStatus]);
  const selectedBadge = selectedStatus
    ? outlook.badges.find((badge) => badge.status === selectedStatus)
    : null;
  const visibleBadges = outlook.badges.filter((badge) => (badge.count ?? 0) > 0);
  const activeDescription = selectedStatus
    ? `Showing ${formatSummaryBadgeLabel(
        selectedStatus,
        selectedBadge?.label ?? "selected",
      )} primary targets.`
    : null;

  return (
    <section className="mt-7 rounded-2xl border border-sky-200 bg-sky-50/50 p-4 shadow-sm sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
        Week Completion Outlook
      </p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">Projected Week Finish</h2>
      <p className="mt-2 text-sm text-slate-600">{outlook.assumptionLabel}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium text-slate-600">
        <span className="rounded-full border border-sky-100 bg-white/80 px-3 py-1">
          Projected: remaining planned sessions completed
        </span>
        <span className="rounded-full border border-sky-100 bg-white/80 px-3 py-1">
          Completed: performed logs so far
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-700">
        {visibleBadges.map((badge) => {
          const status = badge.status as MuscleOutcomeStatus;
          const count = badge.count ?? 0;
          const isSelected = selectedStatus === status;
          const style = BADGE_STYLE[status];
          const className = `rounded-full px-3 py-1 transition ${
            style.baseClassName
          } ${isSelected ? style.activeClassName : ""} cursor-pointer shadow-sm`;

          return (
            <button
              key={badge.status}
              type="button"
              className={className}
              aria-pressed={isSelected}
              onClick={() => setSelectedStatus((current) => (current === status ? null : status))}
            >
              {count} {formatSummaryBadgeLabel(status, badge.label)}
            </button>
          );
        })}
      </div>

      {activeDescription ? (
        <p className="mt-3 text-xs font-medium text-slate-600">
          {activeDescription}
        </p>
      ) : null}

      {visibleRows.length > 0 ? (
        <div className="mt-4 space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">
            {formatRowsHeading(selectedStatus)}
          </h3>
          {visibleRows.map((row) => (
            <div
              key={`${row.status}:${row.muscle}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-100 bg-white/85 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{row.muscle}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {row.statusLabel} - {row.comparisonLabel}
                </p>
              </div>
              <p className="text-sm font-semibold text-slate-700">{row.deltaLabel}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-600">
          No major projected misses if you finish the planned week.
        </p>
      )}

      {supportRows.length > 0 ? (
        <details className="mt-4 rounded-xl border border-sky-100 bg-white/60 px-3 py-2.5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">
            Support targets ({supportRows.length})
          </summary>
          <p className="mt-1 text-xs text-slate-600">
            Tracked separately from primary-driver counts.
          </p>
          <div className="mt-3 space-y-2">
            {supportRows.map((row) => (
              <div
                key={`${row.status}:${row.muscle}:support`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/75 px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">{row.muscle}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {row.statusLabel} - {row.comparisonLabel}
                  </p>
                </div>
                <p className="text-sm font-semibold text-slate-600">{row.deltaLabel}</p>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {secondaryRows.length > 0 ? (
        <details className="mt-3 rounded-xl border border-sky-100 bg-white/60 px-3 py-2.5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">
            Secondary targets ({secondaryRows.length})
          </summary>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="mt-1 text-xs text-slate-600">
                Tracked for balance and awareness. These do not drive generation or block progression.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-600">
              {secondaryBadges.filter((badge) => (badge.count ?? 0) > 0).map((badge) => (
                <span
                  key={badge.status}
                  className="rounded-full bg-white/80 px-3 py-1 shadow-sm"
                >
                  {badge.count ?? 0} {badge.label}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {secondaryRows.map((row) => (
              <div
                key={`${row.status}:${row.muscle}:secondary`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/75 px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">{row.muscle}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {row.statusLabel} - {row.comparisonLabel}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Non-blocking</p>
                </div>
                <p className="text-sm font-semibold text-slate-600">{row.deltaLabel}</p>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {primaryRows.length > visibleRows.length ? (
        <details className="mt-3 rounded-xl border border-sky-100 bg-white/60 px-3 py-2.5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-slate-800">
            All primary target details ({primaryRows.length})
          </summary>
          <div className="mt-3 space-y-2">
            {primaryRows.map((row) => (
              <div
                key={`${row.status}:${row.muscle}:primary-details`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/75 px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-800">{row.muscle}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    {row.statusLabel} - {row.comparisonLabel}
                  </p>
                </div>
                <p className="text-sm font-semibold text-slate-600">{row.deltaLabel}</p>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

export default WeekCompletionOutlookSection;
