"use client";

import type { ExerciseListItem } from "@/lib/exercise-library/types";
import { ExerciseCard } from "./ExerciseCard";

type ExerciseListProps = {
  exercises: ExerciseListItem[];
  onSelectExercise: (exercise: ExerciseListItem) => void;
};

export function ExerciseList({ exercises, onSelectExercise }: ExerciseListProps) {
  if (exercises.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-500">No exercises match your filters.</p>
        <p className="mt-1 text-xs text-slate-400">Try adjusting your search or clearing filters.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {exercises.map((exercise) => (
        <ExerciseCard
          key={exercise.id}
          exercise={exercise}
          onClick={() => onSelectExercise(exercise)}
        />
      ))}
    </div>
  );
}
