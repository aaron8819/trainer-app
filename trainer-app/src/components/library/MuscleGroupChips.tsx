"use client";

import {
  MUSCLE_GROUP_HIERARCHY,
  MUSCLE_GROUP_LABELS,
} from "@/lib/exercise-library/constants";
import type { MuscleGroup } from "@/lib/exercise-library/types";

type MuscleGroupChipsProps = {
  selectedGroups: MuscleGroup[];
  selectedMuscles: string[];
  onToggleGroup: (group: MuscleGroup) => void;
  onToggleMuscle: (muscle: string) => void;
};

export function MuscleGroupChips({
  selectedGroups,
  selectedMuscles,
  onToggleGroup,
  onToggleMuscle,
}: MuscleGroupChipsProps) {
  const groups = Object.keys(MUSCLE_GROUP_HIERARCHY) as MuscleGroup[];
  const fineMuscles = Array.from(
    new Set(selectedGroups.flatMap((group) => MUSCLE_GROUP_HIERARCHY[group] ?? []))
  );
  const showFineMuscles = selectedGroups.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {groups.map((group) => (
          <button
            key={group}
            onClick={() => onToggleGroup(group)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selectedGroups.includes(group)
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {MUSCLE_GROUP_LABELS[group]}
          </button>
        ))}
      </div>

      {showFineMuscles && (
        <div className="flex flex-wrap gap-1.5">
          {fineMuscles.map((muscle) => (
            <button
              key={muscle}
              onClick={() => onToggleMuscle(muscle)}
              className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                selectedMuscles.includes(muscle)
                  ? "bg-emerald-600 text-white"
                  : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              }`}
            >
              {muscle}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
