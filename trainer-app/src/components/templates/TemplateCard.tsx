"use client";

import Link from "next/link";

type TemplateCardProps = {
  id: string;
  name: string;
  exerciseCount: number;
  targetMuscles: string[];
  onDeleteClick: (id: string) => void;
};

export function TemplateCard({
  id,
  name,
  exerciseCount,
  targetMuscles,
  onDeleteClick,
}: TemplateCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 truncate">{name}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {exerciseCount} exercise{exerciseCount !== 1 ? "s" : ""}
          </p>
          {targetMuscles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {targetMuscles.map((muscle) => (
                <span
                  key={muscle}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                >
                  {muscle}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Link
            href={`/templates/${id}/edit`}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Edit
          </Link>
          <button
            onClick={() => onDeleteClick(id)}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
