"use client";

import type { FilteredExerciseSummary } from "@/lib/engine/explainability";

type Props = {
  filteredExercises: FilteredExerciseSummary[];
};

export function FilteredExercisesCard({ filteredExercises }: Props) {
  if (filteredExercises.length === 0) return null;

  const groups = [
    {
      title: "Preferences respected",
      items: filteredExercises.filter((ex) => ex.reason === "user_avoided"),
    },
    {
      title: "Pain or recovery conflicts",
      items: filteredExercises.filter((ex) => ex.reason === "pain_conflict"),
    },
    {
      title: "Other skipped options",
      items: filteredExercises.filter((ex) => ex.reason !== "user_avoided" && ex.reason !== "pain_conflict"),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:p-5">
      <h3 className="text-base font-semibold text-slate-900">Exercises left out</h3>
      <p className="mt-2 text-xs text-slate-600">
        These movements were skipped so the final plan fit your constraints for today.
      </p>

      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</p>
            <div className="mt-2 space-y-2">
              {group.items.map((exercise) => (
                <div key={exercise.exerciseId} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-800">{exercise.exerciseName}</p>
                  <p className="mt-1 text-xs text-slate-600">{exercise.userFriendlyMessage}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
