"use client";

import Link from "next/link";
import type { SessionSummaryModel } from "@/lib/ui/session-summary";

type Props = {
  summary: SessionSummaryModel;
  startLoggingHref?: string | null;
};

const ITEM_TONE_STYLES = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  positive: "border-emerald-200 bg-emerald-50 text-emerald-800",
  caution: "border-amber-200 bg-amber-50 text-amber-800",
} as const;

export function SessionContextCard({ summary, startLoggingHref }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{summary.title}</p>
          <p className="mt-2 text-base font-semibold text-slate-900">{summary.summary}</p>
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
  );
}
