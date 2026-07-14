import type { loadPrescriptionAnchorHistoryForExercises } from "@/lib/api/workout-context";
import type { WorkoutHistoryEntry } from "@/lib/engine/types";

type PrescriptionAnchorHistoryFixtureInput = {
  exerciseIds: readonly string[];
  overrides?: readonly WorkoutHistoryEntry[];
};

type PrescriptionAnchorHistoryLoader =
  typeof loadPrescriptionAnchorHistoryForExercises;

function cloneHistoryEntry(entry: WorkoutHistoryEntry): WorkoutHistoryEntry {
  return {
    ...entry,
    confidenceNotes: entry.confidenceNotes ? [...entry.confidenceNotes] : undefined,
    anomalyFlags: entry.anomalyFlags ? [...entry.anomalyFlags] : undefined,
    exercises: entry.exercises.map((exercise) => ({
      ...exercise,
      primaryMuscles: exercise.primaryMuscles
        ? [...exercise.primaryMuscles]
        : undefined,
      secondaryMuscles: exercise.secondaryMuscles
        ? [...exercise.secondaryMuscles]
        : undefined,
      sets: exercise.sets.map((set) => ({ ...set })),
    })),
    calibrationExercises: entry.calibrationExercises?.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({ ...set })),
    })),
    painFlags: entry.painFlags ? { ...entry.painFlags } : undefined,
  };
}

function entrySortKey(entry: WorkoutHistoryEntry): string {
  return entry.exercises
    .map((exercise) => exercise.exerciseId)
    .sort()
    .join("|");
}

export function createPrescriptionAnchorHistoryFixture({
  exerciseIds,
  overrides = [],
}: PrescriptionAnchorHistoryFixtureInput): WorkoutHistoryEntry[] {
  const requestedExerciseIds = new Set<string>();
  for (const rawExerciseId of exerciseIds) {
    const exerciseId = rawExerciseId.trim();
    if (!exerciseId) {
      throw new Error("Prescription anchor history fixture received a blank exercise ID.");
    }
    requestedExerciseIds.add(exerciseId);
  }

  const entries = overrides.map((entry) => {
    if (!Number.isFinite(Date.parse(entry.date))) {
      throw new Error(
        `Prescription anchor history fixture received an invalid date: ${entry.date}`
      );
    }
    if (entry.progressionEligible === false || entry.performanceEligible === false) {
      throw new Error(
        "Prescription anchor history overrides must be eligible performed history."
      );
    }
    if (entry.exercises.length === 0) {
      throw new Error(
        "Prescription anchor history overrides must include at least one exercise."
      );
    }
    for (const exercise of entry.exercises) {
      if (!requestedExerciseIds.has(exercise.exerciseId)) {
        throw new Error(
          `Prescription anchor history override references unrequested exercise ID: ${exercise.exerciseId}`
        );
      }
      if (exercise.sets.length === 0) {
        throw new Error(
          `Prescription anchor history override has no performed sets for exercise ID: ${exercise.exerciseId}`
        );
      }
    }
    return cloneHistoryEntry(entry);
  });

  return entries.sort((left, right) => {
    const dateOrder = Date.parse(right.date) - Date.parse(left.date);
    if (dateOrder !== 0) {
      return dateOrder;
    }
    const leftKey = entrySortKey(left);
    const rightKey = entrySortKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

export function createPrescriptionAnchorHistoryLoader(
  overrides: readonly WorkoutHistoryEntry[] = []
): PrescriptionAnchorHistoryLoader {
  return async (_userId, exerciseIds) =>
    createPrescriptionAnchorHistoryFixture({ exerciseIds, overrides });
}
