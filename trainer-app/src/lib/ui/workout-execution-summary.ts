export type WorkoutExecutionSummarySet = {
  isRuntimeAdded?: boolean;
  wasLogged: boolean;
  wasSkipped: boolean;
};

export type WorkoutExecutionSummaryExercise = {
  exerciseId?: string | null;
  name?: string | null;
  isRuntimeAdded?: boolean;
  sets: WorkoutExecutionSummarySet[];
};

export type DuplicateAddedExerciseSummary = {
  exerciseId?: string | null;
  exerciseName: string;
  plannedSkippedSetCount: number;
  addedPerformedSetCount: number;
  coveredSkippedSetCount: number;
};

export type WorkoutExecutionSummary = {
  plannedSetCount: number;
  completedSetCount: number;
  skippedSetCount: number;
  uncoveredSkippedSetCount: number;
  extraSetCount: number;
  duplicateCoveredSkippedSetCount: number;
  duplicateAddedExercises: DuplicateAddedExerciseSummary[];
};

function isExtraSet(
  exercise: WorkoutExecutionSummaryExercise,
  set: WorkoutExecutionSummarySet
): boolean {
  return exercise.isRuntimeAdded === true || set.isRuntimeAdded === true;
}

function normalizeExerciseName(name: string | null | undefined): string | null {
  const normalized = name?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  return normalized.length > 0 ? normalized : null;
}

function buildDuplicateKey(exercise: WorkoutExecutionSummaryExercise): string | null {
  const exerciseId = exercise.exerciseId?.trim();
  if (exerciseId) {
    return `id:${exerciseId}`;
  }

  const name = normalizeExerciseName(exercise.name);
  return name ? `name:${name}` : null;
}

function countPerformedSets(exercise: WorkoutExecutionSummaryExercise): number {
  return exercise.sets.filter((set) => set.wasLogged && !set.wasSkipped).length;
}

function countSkippedPlannedSets(exercise: WorkoutExecutionSummaryExercise): number {
  if (exercise.isRuntimeAdded === true) {
    return 0;
  }
  return exercise.sets.filter(
    (set) => !isExtraSet(exercise, set) && set.wasLogged && set.wasSkipped
  ).length;
}

function buildDuplicateAddedExerciseSummaries(
  exercises: WorkoutExecutionSummaryExercise[]
): DuplicateAddedExerciseSummary[] {
  const plannedByKey = new Map<
    string,
    { exerciseId?: string | null; exerciseName: string; skippedSetCount: number }
  >();
  const addedByKey = new Map<
    string,
    { exerciseId?: string | null; exerciseName: string; performedSetCount: number }
  >();

  for (const exercise of exercises) {
    const key = buildDuplicateKey(exercise);
    if (!key) {
      continue;
    }

    const exerciseName = exercise.name?.trim() || exercise.exerciseId?.trim() || "Exercise";
    if (exercise.isRuntimeAdded === true) {
      const performedSetCount = countPerformedSets(exercise);
      if (performedSetCount <= 0) {
        continue;
      }
      const existing = addedByKey.get(key);
      addedByKey.set(key, {
        exerciseId: exercise.exerciseId,
        exerciseName: existing?.exerciseName ?? exerciseName,
        performedSetCount: (existing?.performedSetCount ?? 0) + performedSetCount,
      });
      continue;
    }

    const skippedSetCount = countSkippedPlannedSets(exercise);
    if (skippedSetCount <= 0) {
      continue;
    }
    const existing = plannedByKey.get(key);
    plannedByKey.set(key, {
      exerciseId: exercise.exerciseId,
      exerciseName: existing?.exerciseName ?? exerciseName,
      skippedSetCount: (existing?.skippedSetCount ?? 0) + skippedSetCount,
    });
  }

  return Array.from(plannedByKey.entries())
    .flatMap(([key, planned]) => {
      const added = addedByKey.get(key);
      if (!added) {
        return [];
      }

      return [
        {
          exerciseId: planned.exerciseId ?? added.exerciseId,
          exerciseName: planned.exerciseName,
          plannedSkippedSetCount: planned.skippedSetCount,
          addedPerformedSetCount: added.performedSetCount,
          coveredSkippedSetCount: Math.min(planned.skippedSetCount, added.performedSetCount),
        },
      ];
    })
    .filter((entry) => entry.coveredSkippedSetCount > 0);
}

export function buildWorkoutExecutionSummary(
  exercises: WorkoutExecutionSummaryExercise[]
): WorkoutExecutionSummary {
  const summary = exercises.reduce<WorkoutExecutionSummary>(
    (summary, exercise) => {
      for (const set of exercise.sets) {
        const isExtra = isExtraSet(exercise, set);
        if (!isExtra) {
          summary.plannedSetCount += 1;
        }

        if (!set.wasLogged) {
          continue;
        }

        if (set.wasSkipped) {
          summary.skippedSetCount += 1;
          continue;
        }

        summary.completedSetCount += 1;
        if (isExtra) {
          summary.extraSetCount += 1;
        }
      }

      return summary;
    },
    {
      plannedSetCount: 0,
      completedSetCount: 0,
      skippedSetCount: 0,
      uncoveredSkippedSetCount: 0,
      extraSetCount: 0,
      duplicateCoveredSkippedSetCount: 0,
      duplicateAddedExercises: [],
    }
  );
  const duplicateAddedExercises = buildDuplicateAddedExerciseSummaries(exercises);
  const duplicateCoveredSkippedSetCount = duplicateAddedExercises.reduce(
    (sum, entry) => sum + entry.coveredSkippedSetCount,
    0
  );

  return {
    ...summary,
    uncoveredSkippedSetCount: Math.max(0, summary.skippedSetCount - duplicateCoveredSkippedSetCount),
    duplicateCoveredSkippedSetCount,
    duplicateAddedExercises,
  };
}
