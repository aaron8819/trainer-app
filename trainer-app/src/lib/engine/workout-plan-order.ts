type WorkoutExerciseWithOrder = {
  id: string;
  orderIndex: number;
};

type WorkoutPlanWithOrderedExercises<TExercise extends WorkoutExerciseWithOrder> = {
  warmup?: TExercise[];
  mainLifts: TExercise[];
  accessories: TExercise[];
};

export type OrderedWorkoutExerciseSection = "warmup" | "main" | "accessory";

export type OrderedWorkoutPlanExercise<TExercise extends WorkoutExerciseWithOrder> = {
  section: OrderedWorkoutExerciseSection;
  exercise: TExercise;
};

function compareExerciseOrder<TExercise extends WorkoutExerciseWithOrder>(
  left: OrderedWorkoutPlanExercise<TExercise>,
  right: OrderedWorkoutPlanExercise<TExercise>
): number {
  if (left.exercise.orderIndex !== right.exercise.orderIndex) {
    return left.exercise.orderIndex - right.exercise.orderIndex;
  }

  return left.exercise.id.localeCompare(right.exercise.id);
}

export function listWorkoutPlanExercisesInOrder<
  TExercise extends WorkoutExerciseWithOrder,
>(
  workout: WorkoutPlanWithOrderedExercises<TExercise>
): OrderedWorkoutPlanExercise<TExercise>[] {
  const warmups = (workout.warmup ?? []).map((exercise) => ({
    section: "warmup" as const,
    exercise,
  }));
  const workingExercises = [
    ...workout.mainLifts.map((exercise) => ({
      section: "main" as const,
      exercise,
    })),
    ...workout.accessories.map((exercise) => ({
      section: "accessory" as const,
      exercise,
    })),
  ].sort(compareExerciseOrder);

  return [...warmups, ...workingExercises];
}
