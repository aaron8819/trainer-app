type ApiResult<T> = { data: T; error: null } | { data: null; error: string };

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

export async function saveWorkoutRequest(payload: Record<string, unknown>): Promise<ApiResult<{
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
