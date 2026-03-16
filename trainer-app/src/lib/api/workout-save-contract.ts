export type WorkoutStatus = "PLANNED" | "IN_PROGRESS" | "PARTIAL" | "COMPLETED" | "SKIPPED";

export type SaveWorkoutResponse = {
  status: "saved";
  workoutId: string;
  revision: number;
  workoutStatus: WorkoutStatus;
  action: "save_plan" | "mark_completed" | "mark_partial" | "mark_skipped";
  weekClose?: {
    weekCloseId: string | null;
    resolution: "NO_GAP_FILL_NEEDED" | "GAP_FILL_COMPLETED" | "GAP_FILL_DISMISSED" | "AUTO_DISMISSED" | null;
    workflowState: "PENDING_OPTIONAL_GAP_FILL" | "COMPLETED" | null;
    deficitState: "OPEN" | "PARTIAL" | "CLOSED" | null;
    remainingDeficitSets: number | null;
  };
};
