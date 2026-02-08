"use client";

import {
  MUSCLE_GROUP_HIERARCHY,
  MUSCLE_GROUP_LABELS,
  SINGLE_MUSCLE_GROUPS,
} from "@/lib/exercise-library/constants";
import type { MuscleGroup } from "@/lib/exercise-library/types";

type MuscleGroupChipsProps = {
  selectedGroup?: MuscleGroup;
  selectedMuscle?: string;
  onGroupChange: (group: MuscleGroup | undefined) => void;
  onMuscleChange: (muscle: string | undefined) => void;
};

export function MuscleGroupChips({
  selectedGroup,
  selectedMuscle,
  onGroupChange,
  onMuscleChange,
}: MuscleGroupChipsProps) {
  const groups = Object.keys(MUSCLE_GROUP_HIERARCHY) as MuscleGroup[];

  const handleGroupClick = (group: MuscleGroup) => {
    if (selectedGroup === group) {
      onGroupChange(undefined);
      onMuscleChange(undefined);
      return;
    }

    // Single-muscle groups toggle the muscle directly
    if (SINGLE_MUSCLE_GROUPS.includes(group)) {
      const muscle = MUSCLE_GROUP_HIERARCHY[group][0];
      onGroupChange(group);
      onMuscleChange(muscle);
    } else {
      onGroupChange(group);
      onMuscleChange(undefined);
    }
  };

  const handleMuscleClick = (muscle: string) => {
    if (selectedMuscle === muscle) {
      onMuscleChange(undefined);
    } else {
      onMuscleChange(muscle);
    }
  };

  const fineMuscles = selectedGroup ? MUSCLE_GROUP_HIERARCHY[selectedGroup] : [];
  const showFineMuscles =
    selectedGroup && !SINGLE_MUSCLE_GROUPS.includes(selectedGroup);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {groups.map((group) => (
          <button
            key={group}
            onClick={() => handleGroupClick(group)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              selectedGroup === group
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
              onClick={() => handleMuscleClick(muscle)}
              className={`rounded-full px-2.5 py-0.5 text-xs transition-colors ${
                selectedMuscle === muscle
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
