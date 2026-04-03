import { buildGenerationWarningSummary, WORKOUT_AUDIT_CONCLUSIONS } from "./conclusions";
import type { WorkoutAuditArtifact, WorkoutAuditRequest, WorkoutAuditRun } from "./types";
import {
  AUDIT_RECONSTRUCTION_GUARDRAIL,
  WORKOUT_AUDIT_ARTIFACT_VERSION,
} from "./constants";
import {
  getSerializedArtifactSizeBytes,
  serializeStableJson,
} from "./artifact-serialization";
import { resolveAuditCanonicalSemantics } from "./canonical-semantics";
import {
  normalizeExposedMuscleListForAudit,
  normalizeSessionGenerationResultForAudit,
} from "./exposed-muscles";

function getArtifactGuardrailWarnings(run: WorkoutAuditRun): string[] {
  const warnings: string[] = [];

  if (run.progressionAnchor?.sessionSnapshotSource === "reconstructed_saved_only") {
    warnings.push(
      `${AUDIT_RECONSTRUCTION_GUARDRAIL} Progression-anchor coverage is using a saved-only reconstructed snapshot.`
    );
  }

  if ((run.historicalWeek?.comparabilityCoverage.reconstructedSnapshotCount ?? 0) > 0) {
    warnings.push(
      `${AUDIT_RECONSTRUCTION_GUARDRAIL} Historical-week coverage includes saved-only reconstructed sessions.`
    );
  }

  return warnings;
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
  const sanitizedRequest: WorkoutAuditRequest = {
    ...request,
    ...(piiSafe
      ? {
          userId: undefined,
          ownerEmail: undefined,
        }
      : {}),
    targetMuscles: normalizeExposedMuscleListForAudit(request.targetMuscles),
  };

  const guardrailWarnings = getArtifactGuardrailWarnings(run);

  return {
    version: WORKOUT_AUDIT_ARTIFACT_VERSION,
    generatedAt: run.generatedAt,
    mode: run.context.mode,
    requestedMode: run.context.requestedMode ?? request.mode,
    source: piiSafe ? "pii-safe" : "live",
    conclusions: WORKOUT_AUDIT_CONCLUSIONS,
    identity: {
      userId: piiSafe ? "redacted" : run.context.userId,
      ownerEmail: piiSafe ? undefined : run.context.ownerEmail,
    },
    request: sanitizedRequest,
    nextSession: run.context.nextSession,
    generation: normalizeSessionGenerationResultForAudit(run.generationResult),
    sessionSnapshot: run.sessionSnapshot,
    canonicalSemantics: resolveAuditCanonicalSemantics(run.sessionSnapshot),
    generationPath: run.generationPath,
    historicalWeek: run.historicalWeek,
    weeklyRetro: run.weeklyRetro,
    projectedWeekVolume: run.projectedWeekVolume,
    progressionAnchor: run.progressionAnchor,
    warningSummary: buildGenerationWarningSummary({
      generation: run.generationResult,
      capturedWarnings: options?.capturedWarnings,
      additionalSemanticWarnings: guardrailWarnings,
    }),
  };
}

export function serializeWorkoutAuditArtifact(
  artifact: WorkoutAuditArtifact
): string {
  return serializeStableJson(artifact);
}

export function createWorkoutAuditArtifactOutput(
  request: WorkoutAuditRequest,
  run: WorkoutAuditRun,
  options?: Parameters<typeof buildWorkoutAuditArtifact>[2]
): {
  artifact: WorkoutAuditArtifact;
  serialized: string;
  sizeBytes: number;
} {
  const artifact = buildWorkoutAuditArtifact(request, run, options);
  const serialized = serializeWorkoutAuditArtifact(artifact);
  return {
    artifact,
    serialized,
    sizeBytes: getSerializedArtifactSizeBytes(serialized),
  };
}
