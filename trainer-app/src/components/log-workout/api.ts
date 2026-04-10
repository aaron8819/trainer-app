import type { FilteredExerciseSummary } from "@/lib/engine/explainability";
import type { LoggingWeeklyVolumeGuidance } from "@/lib/api/logging-weekly-volume-guidance";
import type { SaveWorkoutResponse } from "@/lib/api/workout-save-contract";
import type { WorkoutStatus } from "@/lib/api/workout-save-contract";
import type { SaveableSelectionMetadata } from "@/lib/ui/selection-metadata";

type ApiResult<T> = { data: T; error: null } | { data: null; error: string };

type WorkoutSaveAction = "save_plan" | "mark_completed" | "mark_partial" | "mark_skipped";
type WorkoutSelectionMode = "AUTO" | "MANUAL" | "BONUS" | "INTENT";
type WorkoutSessionIntentDb = "PUSH" | "PULL" | "LEGS" | "UPPER" | "LOWER" | "FULL_BODY" | "BODY_PART";
type WorkoutForcedSplit = "PUSH" | "PULL" | "LEGS" | "UPPER" | "LOWER" | "FULL_BODY";
type WorkoutExerciseSection = "WARMUP" | "MAIN" | "ACCESSORY";

export type SaveWorkoutExerciseInput = {
  section: WorkoutExerciseSection;
  exerciseId: string;
  sets: Array<{
    setIndex: number;
    targetReps: number;
    targetRepRange?: { min: number; max: number };
    targetRpe?: number;
    targetLoad?: number;
    restSeconds?: number;
  }>;
};

export type SaveWorkoutRequestPayload = {
  workoutId: string;
  action?: WorkoutSaveAction;
  expectedRevision?: number;
  templateId?: string;
  scheduledDate?: string;
  status?: WorkoutStatus;
  estimatedMinutes?: number;
  notes?: string;
  selectionMode?: WorkoutSelectionMode;
  sessionIntent?: WorkoutSessionIntentDb;
  selectionMetadata?: SaveableSelectionMetadata;
  forcedSplit?: WorkoutForcedSplit;
  advancesSplit?: boolean;
  mesocycleWeekSnapshot?: number;
  filteredExercises?: FilteredExerciseSummary[];
  exercises?: SaveWorkoutExerciseInput[];
};

async function parseJsonResponse<T>(response: Response): Promise<ApiResult<T>> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error =
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : "Request failed";
    return { data: null, error };
  }
  return { data: body as T, error: null };
}

export async function logSetRequest(payload: {
  workoutSetId: string;
  actualReps?: number | null;
  actualLoad?: number | null;
  actualRpe?: number | null;
  wasSkipped?: boolean;
}): Promise<ApiResult<{
  status: string;
  wasCreated: boolean;
  previousLog?: {
    actualReps?: number | null;
    actualRpe?: number | null;
    actualLoad?: number | null;
    wasSkipped?: boolean | null;
    notes?: string | null;
  } | null;
  workoutStatusUpdated?: boolean;
}>> {
  const response = await fetch("/api/logs/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response);
}

export async function deleteSetLogRequest(workoutSetId: string): Promise<ApiResult<{ status: string }>> {
  const response = await fetch("/api/logs/set", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workoutSetId }),
  });
  return parseJsonResponse(response);
}

export async function addSetToExerciseRequest(payload: {
  workoutId: string;
  workoutExerciseId: string;
}): Promise<
  ApiResult<{
    set: {
      setId: string;
      setIndex: number;
      targetReps: number;
      targetRepRange?: { min: number; max: number };
      targetLoad?: number | null;
      targetRpe?: number | null;
      restSeconds?: number | null;
      isRuntimeAdded: true;
    };
  }>
> {
  const response = await fetch(
    `/api/workouts/${payload.workoutId}/exercises/${payload.workoutExerciseId}/add-set`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );
  return parseJsonResponse(response);
}

export async function deleteWorkoutExerciseRequest(payload: {
  workoutId: string;
  workoutExerciseId: string;
}): Promise<ApiResult<{ ok: true; removedWorkoutExerciseId: string }>> {
  const response = await fetch(
    `/api/workouts/${payload.workoutId}/exercises/${payload.workoutExerciseId}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    }
  );
  return parseJsonResponse(response);
}

export async function saveWorkoutRequest(payload: SaveWorkoutRequestPayload): Promise<ApiResult<SaveWorkoutResponse & {
  baselineSummary?: unknown;
}>> {
  const response = await fetch("/api/workouts/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response);
}

export async function loadWeeklyVolumeCheckRequest(
  workoutId: string
): Promise<ApiResult<LoggingWeeklyVolumeGuidance>> {
  const response = await fetch(`/api/workouts/${workoutId}/logging-weekly-volume-check`, {
    method: "GET",
    cache: "no-store",
  });
  return parseJsonResponse(response);
}
