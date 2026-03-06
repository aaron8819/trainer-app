"use client";

import { useState } from "react";
import Link from "next/link";
import type { SessionSummaryModel } from "@/lib/ui/session-summary";

type Props = {
  summary: SessionSummaryModel;
  startLoggingHref?: string | null;
  defaultCollapsed?: boolean;
};

const ITEM_TONE_STYLES = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  positive: "border-emerald-200 bg-emerald-50 text-emerald-800",
  caution: "border-amber-200 bg-amber-50 text-amber-800",
} as const;

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SessionContextCard({ summary, startLoggingHref, defaultCollapsed = false }: Props) {
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white text-sm">
      <button
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Collapse session context" : "Expand session context"}
        className="flex w-full items-start justify-between gap-3 p-4 text-left sm:p-5"
        onClick={() => setIsExpanded((prev) => !prev)}
        type="button"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{summary.title}</p>
          {!isExpanded && (
            <p className="mt-1 truncate text-sm text-slate-600">{summary.summary}</p>
          )}
        </div>
        <ChevronIcon expanded={isExpanded} />
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-base font-semibold text-slate-900">{summary.summary}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700">
                {summary.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
                    {tag}
                  </span>
                ))}
              </div>
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

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {summary.items.map((item) => (
              <div
                key={item.label}
                className={`rounded-xl border px-3 py-2 ${ITEM_TONE_STYLES[item.tone ?? "neutral"]}`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide">{item.label}</p>
                <p className="mt-1 text-sm leading-5">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
