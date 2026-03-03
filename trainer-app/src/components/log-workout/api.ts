import type { FilteredExerciseSummary } from "@/lib/engine/explainability";
import type { SessionDecisionCompatibilityAutoregulationLog } from "@/lib/evidence/session-decision-compatibility";
import type { SaveableSelectionMetadata } from "@/lib/ui/selection-metadata";

type ApiResult<T> = { data: T; error: null } | { data: null; error: string };

type WorkoutSaveAction = "save_plan" | "mark_completed" | "mark_partial" | "mark_skipped";
type WorkoutStatus = "PLANNED" | "IN_PROGRESS" | "PARTIAL" | "COMPLETED" | "SKIPPED";
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
  // Compatibility-only: older callers may still provide this; current app save paths should not.
  wasAutoregulated?: boolean;
  // Compatibility-only: older callers may still provide this; current app save paths should not.
  autoregulationLog?: SessionDecisionCompatibilityAutoregulationLog;
  forcedSplit?: WorkoutForcedSplit;
  advancesSplit?: boolean;
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

export async function saveWorkoutRequest(payload: SaveWorkoutRequestPayload): Promise<ApiResult<{
  status: string;
  baselineSummary?: unknown;
  revision?: number;
  workoutStatus?: string;
  action?: string;
}>> {
  const response = await fetch("/api/workouts/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response);
}
