"use client";

import Link from "next/link";
import { TemplateScoreBadge } from "./TemplateScoreBadge";

type TemplateCardProps = {
  id: string;
  name: string;
  exerciseCount: number;
  targetMuscles: string[];
  intent: string;
  score?: number;
  scoreLabel?: string;
  onDeleteClick: (id: string) => void;
};

export function TemplateCard({
  id,
  name,
  exerciseCount,
  targetMuscles,
  intent,
  score,
  scoreLabel,
  onDeleteClick,
}: TemplateCardProps) {
  const intentLabel = intent.replaceAll("_", " ").toLowerCase();

  return (
    <div className="rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-5 text-slate-900 break-words">{name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-xs text-slate-500">
              {exerciseCount} exercise{exerciseCount !== 1 ? "s" : ""}
            </p>
            {score !== undefined && scoreLabel && (
              <TemplateScoreBadge score={score} label={scoreLabel} size="sm" />
            )}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
              {intentLabel}
            </span>
          </div>
          {targetMuscles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {targetMuscles.map((muscle) => (
                <span
                  key={muscle}
                  className="max-w-full truncate rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                  title={muscle}
                >
                  {muscle}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:gap-1">
          <Link
            href={`/templates/${id}/edit`}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 sm:min-h-0 sm:border-transparent sm:px-2.5 sm:py-1.5 sm:text-slate-600"
          >
            Edit
          </Link>
          <button
            onClick={() => onDeleteClick(id)}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 sm:min-h-0 sm:border-transparent sm:px-2.5 sm:py-1.5 sm:text-rose-600"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
