export type WorkoutStatus = "PLANNED" | "IN_PROGRESS" | "PARTIAL" | "COMPLETED" | "SKIPPED";

export type SaveWorkoutResponse = {
  status: "saved";
  workoutId: string;
  revision: number;
  workoutStatus: WorkoutStatus;
  action: "save_plan" | "mark_completed" | "mark_partial" | "mark_skipped";
};
