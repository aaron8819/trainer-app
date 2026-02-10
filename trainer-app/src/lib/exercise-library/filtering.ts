import { MUSCLE_GROUP_HIERARCHY, MUSCLE_GROUP_LABELS, MUSCLE_TO_GROUP } from "./constants";
import type { ExerciseFilters, ExerciseListItem, ExerciseSort } from "./types";
import type { MuscleGroup } from "./types";

function getMuscleGroupSortKey(exercise: ExerciseListItem): string {
  const canonicalGroups = Array.from(
    new Set(
      exercise.primaryMuscles
        .map((muscle) => MUSCLE_TO_GROUP[muscle])
        .filter((group): group is MuscleGroup => Boolean(group))
    )
  ).sort((a, b) => a.localeCompare(b));

  if (canonicalGroups.length > 0) {
    return MUSCLE_GROUP_LABELS[canonicalGroups[0]];
  }

  return [...exercise.primaryMuscles].sort((a, b) => a.localeCompare(b))[0] ?? "";
}

function getPrimaryMuscleSortKey(exercise: ExerciseListItem): string {
  return [...exercise.primaryMuscles].sort((a, b) => a.localeCompare(b))[0] ?? "";
}

export function filterExercises(
  exercises: ExerciseListItem[],
  filters: ExerciseFilters
): ExerciseListItem[] {
  const selectedMuscles = filters.muscles ?? [];
  const selectedMuscleGroups = filters.muscleGroups ?? [];
  const selectedExerciseTypes = filters.exerciseTypes ?? [];
  const selectedMovementPatterns = filters.movementPatterns ?? [];
  const selectedGroupMuscles = selectedMuscleGroups.flatMap(
    (group) => MUSCLE_GROUP_HIERARCHY[group] ?? []
  );

  return exercises.filter((exercise) => {
    if (filters.search) {
      const term = filters.search.toLowerCase();
      if (!exercise.name.toLowerCase().includes(term)) {
        return false;
      }
    }

    if (selectedMuscles.length > 0) {
      if (!exercise.primaryMuscles.some((muscle) => selectedMuscles.includes(muscle))) {
        return false;
      }
    } else if (selectedGroupMuscles.length > 0) {
      if (!exercise.primaryMuscles.some((muscle) => selectedGroupMuscles.includes(muscle))) {
        return false;
      }
    }

    if (selectedExerciseTypes.length > 0) {
      const matchesExerciseType =
        (exercise.isCompound && selectedExerciseTypes.includes("compound")) ||
        (!exercise.isCompound && selectedExerciseTypes.includes("isolation"));
      if (!matchesExerciseType) {
        return false;
      }
    }

    if (selectedMovementPatterns.length > 0) {
      if (!exercise.movementPatterns.some((pattern) => selectedMovementPatterns.includes(pattern))) {
        return false;
      }
    }

    if (filters.equipment) {
      if (!exercise.equipment.includes(filters.equipment)) {
        return false;
      }
    }

    if (filters.splitTag) {
      if (!exercise.splitTags.includes(filters.splitTag)) {
        return false;
      }
    }

    if (filters.favoritesOnly) {
      if (!exercise.isFavorite) {
        return false;
      }
    }

    return true;
  });
}

export function sortExercises(
  exercises: ExerciseListItem[],
  sort: ExerciseSort
): ExerciseListItem[] {
  const sorted = [...exercises];
  sorted.sort((a, b) => {
    let cmp: number;
    switch (sort.field) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "sfrScore":
        cmp = a.sfrScore - b.sfrScore;
        break;
      case "lengthPositionScore":
        cmp = a.lengthPositionScore - b.lengthPositionScore;
        break;
      case "fatigueCost":
        cmp = a.fatigueCost - b.fatigueCost;
        break;
      case "muscleGroup":
        cmp = getMuscleGroupSortKey(a).localeCompare(getMuscleGroupSortKey(b));
        if (cmp === 0) {
          cmp = getPrimaryMuscleSortKey(a).localeCompare(getPrimaryMuscleSortKey(b));
        }
        if (cmp === 0) {
          cmp = a.name.localeCompare(b.name);
        }
        break;
      default:
        cmp = a.name.localeCompare(b.name);
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}
