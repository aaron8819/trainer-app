/**
 * FilteredExercisesCard - Filtered Exercises Explanation
 *
 * Phase 2: Display exercises filtered during selection with specific reasons
 *
 * Explains "Why was this exercise not selected?" grouped by rejection reason:
 * - User avoids (preferences)
 * - Pain conflicts (autoregulation)
 * - Other contraindications
 */

"use client";

import type { FilteredExerciseSummary } from "@/lib/engine/explainability";

type Props = {
  filteredExercises: FilteredExerciseSummary[];
};

export function FilteredExercisesCard({ filteredExercises }: Props) {
  if (filteredExercises.length === 0) return null;

  // Group filtered exercises by reason
  const userAvoids = filteredExercises.filter((ex) => ex.reason === "user_avoided");
  const painConflicts = filteredExercises.filter((ex) => ex.reason === "pain_conflict");
  const other = filteredExercises.filter(
    (ex) => ex.reason !== "user_avoided" && ex.reason !== "pain_conflict"
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:p-5">
      <h3 className="text-base font-semibold text-slate-900">Filtered Exercises</h3>
      <p className="mt-2 text-xs text-slate-600">
        The following exercises were excluded from this workout based on your constraints and
        preferences.
      </p>

      <div className="mt-4 space-y-4">
        {/* User Avoids */}
        {userAvoids.length > 0 && (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg text-emerald-500">✓</span>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Your Preferences Honored
              </p>
            </div>
            <ul className="mt-2 space-y-1 pl-7">
              {userAvoids.map((ex) => (
                <li key={ex.exerciseId} className="text-sm text-slate-700">
                  <span className="font-medium">{ex.exerciseName}</span>
                  <span className="ml-2 text-xs text-slate-500">({ex.userFriendlyMessage})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pain Conflicts */}
        {painConflicts.length > 0 && (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg text-amber-500">⚠</span>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Pain Conflicts
              </p>
            </div>
            <ul className="mt-2 space-y-1 pl-7">
              {painConflicts.map((ex) => (
                <li key={ex.exerciseId} className="text-sm text-slate-700">
                  <span className="font-medium">{ex.exerciseName}</span>
                  <span className="ml-2 text-xs text-slate-500">({ex.userFriendlyMessage})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Other Reasons */}
        {other.length > 0 && (
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">ℹ️</span>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Other Filters
              </p>
            </div>
            <ul className="mt-2 space-y-1 pl-7">
              {other.map((ex) => (
                <li key={ex.exerciseId} className="text-sm text-slate-700">
                  <span className="font-medium">{ex.exerciseName}</span>
                  <span className="ml-2 text-xs text-slate-500">({ex.userFriendlyMessage})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
