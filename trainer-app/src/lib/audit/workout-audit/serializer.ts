import type { WorkoutAuditArtifact, WorkoutAuditRequest, WorkoutAuditRun } from "./types";

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export function buildWorkoutAuditArtifact(
  request: WorkoutAuditRequest,
  run: WorkoutAuditRun
): WorkoutAuditArtifact {
  return {
    version: 1,
    generatedAt: run.generatedAt,
    mode: request.mode,
    source: "live",
    identity: {
      userId: run.context.userId,
      ownerEmail: run.context.ownerEmail,
    },
    request,
    nextSession: run.context.nextSession,
    generation: run.generationResult,
  };
}

export function serializeWorkoutAuditArtifact(
  artifact: WorkoutAuditArtifact
): string {
  return JSON.stringify(sortJson(artifact), null, 2);
}
