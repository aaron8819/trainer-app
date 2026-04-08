export type WorkoutExecutionSummarySet = {
  isRuntimeAdded?: boolean;
  wasLogged: boolean;
  wasSkipped: boolean;
};

export type WorkoutExecutionSummaryExercise = {
  isRuntimeAdded?: boolean;
  sets: WorkoutExecutionSummarySet[];
};

export type WorkoutExecutionSummary = {
  plannedSetCount: number;
  completedSetCount: number;
  skippedSetCount: number;
  extraSetCount: number;
};

function isExtraSet(
  exercise: WorkoutExecutionSummaryExercise,
  set: WorkoutExecutionSummarySet
): boolean {
  return exercise.isRuntimeAdded === true || set.isRuntimeAdded === true;
}

export function buildWorkoutExecutionSummary(
  exercises: WorkoutExecutionSummaryExercise[]
): WorkoutExecutionSummary {
  return exercises.reduce<WorkoutExecutionSummary>(
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
      extraSetCount: 0,
    }
  );
}
