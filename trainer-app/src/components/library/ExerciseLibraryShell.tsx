"use client";

import { useState, useMemo } from "react";
import type { ExerciseFilters, ExerciseListItem } from "@/lib/exercise-library/types";
import { filterExercises, sortExercises } from "@/lib/exercise-library/filtering";
import { FilterBar } from "./FilterBar";
import { ExerciseList } from "./ExerciseList";
import { ExerciseDetailSheet } from "./ExerciseDetailSheet";

type ExerciseLibraryShellProps = {
  exercises: ExerciseListItem[];
};

export function ExerciseLibraryShell({ exercises }: ExerciseLibraryShellProps) {
  const [filters, setFilters] = useState<ExerciseFilters>({});
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null);

  const filteredExercises = useMemo(() => {
    const filtered = filterExercises(exercises, filters);
    return sortExercises(filtered, { field: "name", direction: "asc" });
  }, [exercises, filters]);

  return (
    <>
      <div className="space-y-4">
        <FilterBar
          filters={filters}
          onFiltersChange={setFilters}
          resultCount={filteredExercises.length}
        />
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
