import { MUSCLE_GROUP_HIERARCHY } from "./constants";
import type { ExerciseFilters, ExerciseListItem, ExerciseSort } from "./types";

export function filterExercises(
  exercises: ExerciseListItem[],
  filters: ExerciseFilters
): ExerciseListItem[] {
  return exercises.filter((exercise) => {
    if (filters.search) {
      const term = filters.search.toLowerCase();
      if (!exercise.name.toLowerCase().includes(term)) {
        return false;
      }
    }

    if (filters.muscle) {
      const allMuscles = [...exercise.primaryMuscles, ...exercise.secondaryMuscles];
      if (!allMuscles.includes(filters.muscle)) {
        return false;
      }
    } else if (filters.muscleGroup) {
      const groupMuscles = MUSCLE_GROUP_HIERARCHY[filters.muscleGroup] ?? [];
      const allMuscles = [...exercise.primaryMuscles, ...exercise.secondaryMuscles];
      if (!allMuscles.some((m) => groupMuscles.includes(m))) {
        return false;
      }
    }

    if (filters.isCompound !== undefined) {
      if (exercise.isCompound !== filters.isCompound) {
        return false;
      }
    }

    if (filters.movementPattern) {
      if (!exercise.movementPatterns.includes(filters.movementPattern)) {
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
      case "muscleGroup":
        cmp = (a.primaryMuscles[0] ?? "").localeCompare(b.primaryMuscles[0] ?? "");
        break;
      default:
        cmp = a.name.localeCompare(b.name);
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });
  return sorted;
}
