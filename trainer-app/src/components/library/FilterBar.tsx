"use client";

import { useMemo, useState } from "react";
import type { ExerciseFilters, MuscleGroup } from "@/lib/exercise-library/types";
import type { MovementPatternV2 } from "@/lib/engine/types";
import {
  ALL_MOVEMENT_PATTERNS,
  MOVEMENT_PATTERN_LABELS,
  MUSCLE_GROUP_HIERARCHY,
  MUSCLE_TO_GROUP,
} from "@/lib/exercise-library/constants";
import { MuscleGroupChips } from "./MuscleGroupChips";

type FilterBarProps = {
  filters: ExerciseFilters;
  onFiltersChange: (filters: ExerciseFilters) => void;
  resultCount: number;
  compact?: boolean;
};

export function FilterBar({ filters, onFiltersChange, resultCount, compact }: FilterBarProps) {
  const [showFilters, setShowFilters] = useState(!compact);

  const selectedGroups = filters.muscleGroups ?? [];
  const selectedMuscles = filters.muscles ?? [];
  const selectedExerciseTypes = filters.exerciseTypes ?? [];
  const selectedMovementPatterns = filters.movementPatterns ?? [];

  const activeCategoryCount = useMemo(() => {
    let count = 0;
    if (filters.search) count += 1;
    if (selectedGroups.length > 0 || selectedMuscles.length > 0) count += 1;
    if (selectedExerciseTypes.length > 0) count += 1;
    if (selectedMovementPatterns.length > 0) count += 1;
    if (filters.favoritesOnly) count += 1;
    return count;
  }, [
    filters.search,
    selectedGroups.length,
    selectedMuscles.length,
    selectedExerciseTypes.length,
    selectedMovementPatterns.length,
    filters.favoritesOnly,
  ]);

  const hasFilters = activeCategoryCount > 0;

  const asOptionalArray = <T,>(values: T[]): T[] | undefined =>
    values.length > 0 ? values : undefined;

  const toggleValue = <T,>(values: T[], value: T): T[] =>
    values.includes(value) ? values.filter((item) => item !== value) : [...values, value];

  const clearAll = () => {
    onFiltersChange({});
  };

  const toggleGroup = (group: MuscleGroup) => {
    const wasSelected = selectedGroups.includes(group);
    const nextGroups = toggleValue(selectedGroups, group);
    const groupMuscles = MUSCLE_GROUP_HIERARCHY[group] ?? [];
    const nextMuscles = wasSelected
      ? selectedMuscles.filter((muscle) => !groupMuscles.includes(muscle))
      : selectedMuscles;

    onFiltersChange({
      ...filters,
      muscleGroups: asOptionalArray(nextGroups),
      muscles: asOptionalArray(nextMuscles),
    });
  };

  const toggleMuscle = (muscle: string) => {
    const nextMuscles = toggleValue(selectedMuscles, muscle);
    const muscleGroup = MUSCLE_TO_GROUP[muscle];
    const nextGroups =
      muscleGroup && !selectedGroups.includes(muscleGroup)
        ? [...selectedGroups, muscleGroup]
        : selectedGroups;

    onFiltersChange({
      ...filters,
      muscleGroups: asOptionalArray(nextGroups),
      muscles: asOptionalArray(nextMuscles),
    });
  };

  const toggleExerciseType = (type: "compound" | "isolation") => {
    const nextExerciseTypes = toggleValue(selectedExerciseTypes, type);
    onFiltersChange({
      ...filters,
      exerciseTypes: asOptionalArray(nextExerciseTypes),
    });
  };

  const toggleMovementPattern = (pattern: MovementPatternV2) => {
    const nextMovementPatterns = toggleValue(selectedMovementPatterns, pattern);
    onFiltersChange({
      ...filters,
      movementPatterns: asOptionalArray(nextMovementPatterns),
    });
  };

  const filtersVisible = compact ? showFilters : true;

  return (
    <div className="space-y-3.5">
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Search exercises..."
          value={filters.search ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            onFiltersChange({ ...filters, search: value || undefined });
          }}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
        />
      </div>

      {compact && (
        <button
          onClick={() => setShowFilters((open) => !open)}
          className="inline-flex min-h-11 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {showFilters ? "Hide filters" : "Show filters"}
          {activeCategoryCount > 0 ? ` (${activeCategoryCount})` : ""}
        </button>
      )}

      {filtersVisible && (
        <>
          <MuscleGroupChips
            selectedGroups={selectedGroups}
            selectedMuscles={selectedMuscles}
            onToggleGroup={toggleGroup}
            onToggleMuscle={toggleMuscle}
          />

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => toggleExerciseType("compound")}
              className={`min-h-10 rounded-full px-3.5 text-xs font-medium transition-colors ${
                selectedExerciseTypes.includes("compound")
                  ? "bg-blue-600 text-white"
                  : "bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              Compound
            </button>
            <button
              onClick={() => toggleExerciseType("isolation")}
              className={`min-h-10 rounded-full px-3.5 text-xs font-medium transition-colors ${
                selectedExerciseTypes.includes("isolation")
                  ? "bg-blue-600 text-white"
                  : "bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              Isolation
            </button>
            <button
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  favoritesOnly: filters.favoritesOnly ? undefined : true,
                })
              }
              className={`min-h-10 rounded-full px-3.5 text-xs font-medium transition-colors ${
                filters.favoritesOnly
                  ? "bg-amber-500 text-white"
                  : "bg-amber-50 text-amber-700 hover:bg-amber-100"
              }`}
            >
              Favorites
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {ALL_MOVEMENT_PATTERNS.map((pattern) => (
              <button
                key={pattern}
                onClick={() => toggleMovementPattern(pattern)}
                className={`min-h-9 rounded-full px-3 text-xs transition-colors ${
                  selectedMovementPatterns.includes(pattern)
                    ? "bg-violet-600 text-white"
                    : "bg-violet-50 text-violet-700 hover:bg-violet-100"
                }`}
              >
                {MOVEMENT_PATTERN_LABELS[pattern]}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{resultCount} exercise{resultCount !== 1 ? "s" : ""}</span>
        {hasFilters && (
          <button
            onClick={clearAll}
            className="min-h-10 rounded-full px-2 text-slate-600 underline hover:text-slate-800"
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
