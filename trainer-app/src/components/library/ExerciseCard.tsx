"use client";

import type { ExerciseListItem } from "@/lib/exercise-library/types";
import { MOVEMENT_PATTERN_LABELS } from "@/lib/exercise-library/constants";

type ExerciseCardProps = {
  exercise: ExerciseListItem;
  onClick: () => void;
};

export function ExerciseCard({ exercise, onClick }: ExerciseCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl border border-slate-200 bg-white p-4 text-left transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-slate-900">{exercise.name}</h3>
        <div className="flex shrink-0 gap-1">
          {exercise.isFavorite && (
            <span className="text-amber-500" title="Favorite">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </span>
          )}
          {exercise.isAvoided && (
            <span className="text-rose-400" title="Avoided">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            </span>
          )}
        </div>
      </div>

      {/* Muscles */}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {exercise.primaryMuscles.map((m) => (
          <span key={m} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            {m}
          </span>
        ))}
        {exercise.secondaryMuscles.map((m) => (
          <span key={m} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
            {m}
          </span>
        ))}
      </div>

      {/* Tags row */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            exercise.isCompound
              ? "bg-blue-50 text-blue-700"
              : "bg-slate-100 text-slate-600"
          }`}
        >
          {exercise.isCompound ? "Compound" : "Isolation"}
        </span>
        {exercise.movementPatterns.slice(0, 2).map((p) => (
          <span key={p} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-600">
            {MOVEMENT_PATTERN_LABELS[p]}
          </span>
        ))}
      </div>
    </button>
  );
}
