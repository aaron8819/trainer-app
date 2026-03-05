import { WorkoutStatus } from "@prisma/client";
import { isTerminalWorkoutStatus } from "@/lib/workout-status";

export type SaveAction = "save_plan" | "mark_completed" | "mark_partial" | "mark_skipped";
export type PersistedStatus = "PLANNED" | "IN_PROGRESS" | "PARTIAL" | "COMPLETED" | "SKIPPED";

type InferActionInput = {
  action?: SaveAction;
  hasExerciseRewrite: boolean;
  status?: string;
};

type ResolveFinalStatusInput = {
  action: SaveAction;
  requestedStatus?: PersistedStatus;
  existingStatus?: PersistedStatus;
  completedMetrics?: {
    allSetsCount: number;
    resolvedSignalSetCount: number;
    effectiveSetCount: number;
  };
};

export function inferAction(input: InferActionInput): SaveAction {
  if (input.action) {
    return input.action;
  }
  if (input.hasExerciseRewrite) {
    return "save_plan";
  }
  if (input.status === "SKIPPED") {
    return "mark_skipped";
  }
  if (input.status === "COMPLETED") {
    return "mark_completed";
  }
  if (input.status === "PARTIAL") {
    return "mark_partial";
  }
  return "save_plan";
}

export function resolveFinalStatus(input: ResolveFinalStatusInput): PersistedStatus {
  if (input.action === "mark_completed") {
    if (!input.completedMetrics || input.completedMetrics.effectiveSetCount === 0) {
      throw new Error("WORKOUT_COMPLETION_EMPTY");
    }
    return input.completedMetrics.resolvedSignalSetCount < input.completedMetrics.allSetsCount
      ? "PARTIAL"
      : "COMPLETED";
  }

  if (input.action === "mark_partial") {
    return "PARTIAL";
  }

  if (input.action === "mark_skipped") {
    return "SKIPPED";
  }

  if (isTerminalWorkoutStatus(input.requestedStatus)) {
    // Plan writes cannot finalize workouts.
    return (input.existingStatus ?? WorkoutStatus.PLANNED) as PersistedStatus;
  }

  return (input.requestedStatus ?? input.existingStatus ?? WorkoutStatus.PLANNED) as PersistedStatus;
}
