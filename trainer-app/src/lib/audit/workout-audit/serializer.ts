import { buildGenerationWarningSummary, WORKOUT_AUDIT_CONCLUSIONS } from "./conclusions";
import { normalizeWorkoutAuditMode } from "./context-builder";
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
  run: WorkoutAuditRun,
  options?: {
    capturedWarnings?: {
      blockingErrors: string[];
      semanticWarnings: string[];
      backgroundWarnings: string[];
    };
  }
): WorkoutAuditArtifact {
  const piiSafe = request.sanitizationLevel === "pii-safe";
  const sanitizedRequest: WorkoutAuditRequest = piiSafe
    ? {
        ...request,
        userId: undefined,
        ownerEmail: undefined,
      }
    : request;

  return {
    version: 2,
    generatedAt: run.generatedAt,
    mode: normalizeWorkoutAuditMode(run.context.mode),
    requestedMode: run.context.requestedMode ?? request.mode,
    source: piiSafe ? "pii-safe" : "live",
    conclusions: WORKOUT_AUDIT_CONCLUSIONS,
    identity: {
      userId: piiSafe ? "redacted" : run.context.userId,
      ownerEmail: piiSafe ? undefined : run.context.ownerEmail,
    },
    request: sanitizedRequest,
    nextSession: run.context.nextSession,
    generation: run.generationResult,
    sessionSnapshot: run.sessionSnapshot,
    generationPath: run.generationPath,
    historicalWeek: run.historicalWeek,
    progressionAnchor: run.progressionAnchor,
    warningSummary: buildGenerationWarningSummary({
      generation: run.generationResult,
      capturedWarnings: options?.capturedWarnings,
    }),
  };
}

export function serializeWorkoutAuditArtifact(
  artifact: WorkoutAuditArtifact
): string {
  return JSON.stringify(sortJson(artifact), null, 2);
}
