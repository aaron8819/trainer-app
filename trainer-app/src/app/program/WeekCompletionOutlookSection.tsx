"use client";

import { useMemo, useState } from "react";
import type {
  ProgramOutcomeSummary,
  ProgramWeekCompletionOutlook,
} from "@/lib/api/program-page";
import type { MuscleOutcomeStatus } from "@/lib/api/muscle-outcome-review";

type SummaryKey = keyof ProgramOutcomeSummary;

const BADGE_CONFIG: Array<{
  summaryKey: SummaryKey;
  status: MuscleOutcomeStatus;
  label: string;
  baseClassName: string;
  activeClassName: string;
}> = [
  {
    summaryKey: "meaningfullyLow",
    status: "meaningfully_low",
    label: "meaningfully low",
    baseClassName: "bg-rose-50 text-rose-700",
    activeClassName: "ring-2 ring-rose-300",
  },
  {
    summaryKey: "slightlyLow",
    status: "slightly_low",
    label: "slightly low",
    baseClassName: "bg-amber-50 text-amber-700",
    activeClassName: "ring-2 ring-amber-300",
  },
  {
    summaryKey: "onTarget",
    status: "on_target",
    label: "on target",
    baseClassName: "bg-emerald-50 text-emerald-700",
    activeClassName: "ring-2 ring-emerald-300",
  },
  {
    summaryKey: "slightlyHigh",
    status: "slightly_high",
    label: "slightly high",
    baseClassName: "bg-sky-50 text-sky-700",
    activeClassName: "ring-2 ring-sky-300",
  },
  {
    summaryKey: "meaningfullyHigh",
    status: "meaningfully_high",
    label: "meaningfully high",
    baseClassName: "bg-indigo-50 text-indigo-700",
    activeClassName: "ring-2 ring-indigo-300",
  },
];

function formatSignedSetDelta(value: number): string {
  if (value === 0) {
    return "on target";
  }

  const absValue = Number.isInteger(value) ? Math.abs(value).toString() : Math.abs(value).toFixed(1);
  return `${value > 0 ? "+" : "-"}${absValue}`;
}

function formatOutcomeLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function WeekCompletionOutlookSection({
  outlook,
}: {
  outlook: ProgramWeekCompletionOutlook;
}) {
  const [selectedStatus, setSelectedStatus] = useState<MuscleOutcomeStatus | null>(null);

  const visibleRows = useMemo(() => {
    if (!selectedStatus) {
      return outlook.defaultRows;
    }

    return outlook.rows.filter((row) => row.status === selectedStatus);
  }, [outlook.defaultRows, outlook.rows, selectedStatus]);

  return (
    <section className="mt-7 rounded-3xl border border-sky-200 bg-sky-50/50 p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
        Week Completion Outlook
      </p>
      <h2 className="mt-1 text-xl font-semibold text-slate-900">Projected week landing</h2>
      <p className="mt-2 text-sm text-slate-600">{outlook.assumptionLabel}</p>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-700">
        {BADGE_CONFIG.map((badge) => {
          const count = outlook.summary[badge.summaryKey];
          const isSelected = selectedStatus === badge.status;
          const className = `rounded-full px-3 py-1 transition ${
            badge.baseClassName
          } ${isSelected ? badge.activeClassName : ""} ${
            count > 0 ? "cursor-pointer shadow-sm" : "cursor-default opacity-60"
          }`;

          if (count === 0) {
            return (
              <span key={badge.status} className={className}>
                {count} {badge.label}
              </span>
            );
          }

          return (
            <button
              key={badge.status}
              type="button"
              className={className}
              aria-pressed={isSelected}
              onClick={() =>
                setSelectedStatus((current) => (current === badge.status ? null : badge.status))
              }
            >
              {count} {badge.label}
            </button>
          );
        })}
      </div>

      {selectedStatus ? (
        <p className="mt-3 text-xs font-medium text-slate-600">
          Showing all projected muscles in the {formatOutcomeLabel(selectedStatus)} bucket.
        </p>
      ) : null}

      {visibleRows.length > 0 ? (
        <div className="mt-4 space-y-2">
          {visibleRows.map((row) => (
            <div
              key={`${row.status}:${row.muscle}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-100 bg-white/85 px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{row.muscle}</p>
                <p className="mt-1 text-xs text-slate-600">
                  {formatOutcomeLabel(row.status)} • {row.projectedFullWeekEffectiveSets} projected vs{" "}
                  {row.targetSets} target
                </p>
              </div>
              <p className="text-sm font-semibold text-slate-700">
                {formatSignedSetDelta(row.delta)} sets
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-600">
          No major projected misses if you finish the planned week.
        </p>
      )}
    </section>
  );
}

export default WeekCompletionOutlookSection;
