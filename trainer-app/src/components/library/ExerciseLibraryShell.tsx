"use client";

import { useState, useMemo } from "react";
import type { ExerciseFilters, ExerciseListItem, ExerciseSort } from "@/lib/exercise-library/types";
import { filterExercises, sortExercises } from "@/lib/exercise-library/filtering";
import { FilterBar } from "./FilterBar";
import { ExerciseList } from "./ExerciseList";
import { ExerciseDetailSheet } from "./ExerciseDetailSheet";

type ExerciseLibraryShellProps = {
  exercises: ExerciseListItem[];
};

export function ExerciseLibraryShell({ exercises }: ExerciseLibraryShellProps) {
  const [filters, setFilters] = useState<ExerciseFilters>({});
  const [sort, setSort] = useState<ExerciseSort>({ field: "name", direction: "asc" });
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);

  const filteredExercises = useMemo(() => {
    const filtered = filterExercises(exercises, filters);
    return sortExercises(filtered, sort);
  }, [exercises, filters, sort]);

  return (
    <>
      <div className="space-y-4">
        <FilterBar
          filters={filters}
          onFiltersChange={setFilters}
          resultCount={filteredExercises.length}
        />
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Sort</label>
          <select
            value={`${sort.field}:${sort.direction}`}
            onChange={(e) => {
              const [field, direction] = e.target.value.split(":") as [ExerciseSort["field"], ExerciseSort["direction"]];
              setSort({ field, direction });
            }}
            className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm sm:w-auto sm:min-w-52"
          >
            <option value="name:asc">Name A-Z</option>
            <option value="name:desc">Name Z-A</option>
            <option value="sfrScore:desc">Best SFR</option>
            <option value="sfrScore:asc">Lowest SFR</option>
            <option value="lengthPositionScore:desc">Best Stretch Position</option>
            <option value="muscleGroup:asc">Muscle Group</option>
          </select>
        </div>
        <ExerciseList
          exercises={filteredExercises}
          onSelectExercise={(exercise) => setSelectedExerciseId(exercise.id)}
        />
      </div>

      <ExerciseDetailSheet
        exerciseId={selectedExerciseId}
        onClose={() => setSelectedExerciseId(null)}
        onNavigate={(id) => setSelectedExerciseId(id)}
      />
    </>
  );
}
