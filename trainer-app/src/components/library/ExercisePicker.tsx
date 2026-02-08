"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { SlideUpSheet } from "@/components/ui/SlideUpSheet";
import { FilterBar } from "./FilterBar";
import { filterExercises, sortExercises } from "@/lib/exercise-library/filtering";
import type { ExerciseFilters, ExerciseListItem } from "@/lib/exercise-library/types";

type ExercisePickerProps = {
  isOpen: boolean;
  onClose: () => void;
  selectedNames: string[];
  onSelectionChange: (names: string[]) => void;
  mode: "multi" | "single";
  exercises?: ExerciseListItem[];
};

export function ExercisePicker({
  isOpen,
  onClose,
  selectedNames,
  onSelectionChange,
  mode,
  exercises: exercisesProp,
}: ExercisePickerProps) {
  const [filters, setFilters] = useState<ExerciseFilters>({});
  const [fetchedExercises, setFetchedExercises] = useState<ExerciseListItem[]>([]);
  const [loading, setLoading] = useState(false);

  const localExercises = exercisesProp ?? fetchedExercises;

  useEffect(() => {
    if (!isOpen || exercisesProp || fetchedExercises.length > 0) return;
    let cancelled = false;
    setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect
    fetch("/api/exercises")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setFetchedExercises(data.exercises ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, exercisesProp, fetchedExercises.length]);

  const filtered = useMemo(() => {
    const f = filterExercises(localExercises, filters);
    return sortExercises(f, { field: "name", direction: "asc" });
  }, [localExercises, filters]);

  const toggleExercise = useCallback(
    (name: string) => {
      if (mode === "single") {
        onSelectionChange([name]);
        onClose();
        return;
      }
      if (selectedNames.includes(name)) {
        onSelectionChange(selectedNames.filter((n) => n !== name));
      } else {
        onSelectionChange([...selectedNames, name]);
      }
    },
    [mode, selectedNames, onSelectionChange, onClose]
  );

  return (
    <SlideUpSheet
      isOpen={isOpen}
      onClose={onClose}
      title={mode === "multi" ? "Select Exercises" : "Choose Exercise"}
    >
      <div className="space-y-3">
        <FilterBar
          filters={filters}
          onFiltersChange={setFilters}
          resultCount={filtered.length}
          compact
        />

        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 rounded bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {filtered.map((exercise) => {
              const isSelected = selectedNames.includes(exercise.name);
              return (
                <button
                  key={exercise.id}
                  onClick={() => toggleExercise(exercise.name)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    isSelected ? "bg-emerald-50" : "hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                      mode === "multi" ? "rounded" : "rounded-full"
                    } border ${
                      isSelected
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-slate-300"
                    }`}
                  >
                    {isSelected && (
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-800 truncate">{exercise.name}</div>
                    <div className="flex gap-1 mt-0.5">
                      {exercise.primaryMuscles.slice(0, 3).map((m) => (
                        <span key={m} className="text-[10px] text-slate-400">{m}</span>
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {mode === "multi" && (
          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-500">{selectedNames.length} selected</span>
            <button
              onClick={onClose}
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </SlideUpSheet>
  );
}
