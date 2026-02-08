"use client";

import { useState, useEffect } from "react";
import type { ExerciseFilters, MuscleGroup } from "@/lib/exercise-library/types";
import type { MovementPatternV2 } from "@/lib/engine/types";
import { MOVEMENT_PATTERN_LABELS } from "@/lib/exercise-library/constants";
import { MuscleGroupChips } from "./MuscleGroupChips";

type FilterBarProps = {
  filters: ExerciseFilters;
  onFiltersChange: (filters: ExerciseFilters) => void;
  resultCount: number;
  compact?: boolean;
};

const MOVEMENT_PATTERNS: MovementPatternV2[] = [
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "squat",
  "hinge",
  "lunge",
  "flexion",
  "extension",
];

export function FilterBar({ filters, onFiltersChange, resultCount, compact }: FilterBarProps) {
  const [searchInput, setSearchInput] = useState(filters.search ?? "");

  useEffect(() => {
    const timeout = setTimeout(() => {
      onFiltersChange({ ...filters, search: searchInput || undefined });
    }, 200);
    return () => clearTimeout(timeout);
  }, [searchInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = Boolean(
    filters.search ||
      filters.muscleGroup ||
      filters.muscle ||
      filters.isCompound !== undefined ||
      filters.movementPattern ||
      filters.favoritesOnly
  );

  const clearAll = () => {
    setSearchInput("");
    onFiltersChange({});
  };

  return (
    <div className="space-y-3">
      {/* Search */}
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
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
        />
      </div>

      {!compact && (
        <>
          {/* Muscle Groups */}
          <MuscleGroupChips
            selectedGroup={filters.muscleGroup}
            selectedMuscle={filters.muscle}
            onGroupChange={(group: MuscleGroup | undefined) =>
              onFiltersChange({ ...filters, muscleGroup: group, muscle: undefined })
            }
            onMuscleChange={(muscle: string | undefined) =>
              onFiltersChange({ ...filters, muscle })
            }
          />

          {/* Compound / Isolation toggle */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  isCompound: filters.isCompound === true ? undefined : true,
                })
              }
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filters.isCompound === true
                  ? "bg-blue-600 text-white"
                  : "bg-blue-50 text-blue-700 hover:bg-blue-100"
              }`}
            >
              Compound
            </button>
            <button
              onClick={() =>
                onFiltersChange({
                  ...filters,
                  isCompound: filters.isCompound === false ? undefined : false,
                })
              }
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filters.isCompound === false
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
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filters.favoritesOnly
                  ? "bg-amber-500 text-white"
                  : "bg-amber-50 text-amber-700 hover:bg-amber-100"
              }`}
            >
              Favorites
            </button>
          </div>

          {/* Movement Patterns */}
          <div className="flex flex-wrap gap-1.5">
            {MOVEMENT_PATTERNS.map((pattern) => (
              <button
                key={pattern}
                onClick={() =>
                  onFiltersChange({
                    ...filters,
                    movementPattern: filters.movementPattern === pattern ? undefined : pattern,
                  })
                }
                className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                  filters.movementPattern === pattern
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

      {/* Result count + Clear */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{resultCount} exercise{resultCount !== 1 ? "s" : ""}</span>
        {hasFilters && (
          <button onClick={clearAll} className="text-slate-600 underline hover:text-slate-800">
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
