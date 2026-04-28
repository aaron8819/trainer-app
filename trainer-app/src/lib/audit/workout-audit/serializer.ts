import { buildGenerationWarningSummary, WORKOUT_AUDIT_CONCLUSIONS } from "./conclusions";
import type {
  WorkoutAuditArtifact,
  WorkoutAuditGenerationPath,
  WorkoutAuditGenerationProvenanceSummary,
  WorkoutAuditRequest,
  WorkoutAuditRun,
} from "./types";
import {
  AUDIT_RECONSTRUCTION_GUARDRAIL,
  WORKOUT_AUDIT_ARTIFACT_VERSION,
} from "./constants";
import {
  compactWorkoutAuditArtifactForSerialization,
  getSerializedArtifactSizeBytes,
  serializeStableJson,
} from "./artifact-serialization";
import { resolveAuditCanonicalSemantics } from "./canonical-semantics";
import {
  type AuditSessionGenerationResult,
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

function buildGenerationProvenanceSummary(input: {
  generation: AuditSessionGenerationResult | undefined;
  generationPath: WorkoutAuditGenerationPath | undefined;
}): WorkoutAuditGenerationProvenanceSummary | undefined {
  if (!input.generation && !input.generationPath) {
    return undefined;
  }

  const receiptProvenance =
    input.generation && !("error" in input.generation)
      ? input.generation.selection.sessionDecisionReceipt?.sessionProvenance
      : undefined;

  return {
    receiptProvenance: {
      mesocycleId: receiptProvenance?.mesocycleId ?? null,
      compositionSource: receiptProvenance?.compositionSource ?? null,
    },
    auditOnly: {
      generationPath: input.generationPath ?? null,
    },
  };
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
  const normalizedGeneration = normalizeSessionGenerationResultForAudit(run.generationResult);
  const generationProvenance = buildGenerationProvenanceSummary({
    generation: normalizedGeneration,
    generationPath: run.generationPath,
  });
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
    generation: normalizedGeneration,
    sessionSnapshot: run.sessionSnapshot,
    canonicalSemantics: resolveAuditCanonicalSemantics(run.sessionSnapshot),
    generationPath: run.generationPath,
    generationProvenance,
    historicalWeek: run.historicalWeek,
    weeklyRetro: run.weeklyRetro,
    projectedWeekVolume: run.projectedWeekVolume,
    activeMesocycleSlotReseed: run.activeMesocycleSlotReseed,
    mesocycleExplain: run.mesocycleExplain,
    progressionAnchor: run.progressionAnchor,
    warningSummary: buildGenerationWarningSummary({
      generation: normalizedGeneration,
      capturedWarnings: options?.capturedWarnings,
      additionalSemanticWarnings: guardrailWarnings,
    }),
  };
}

export function serializeWorkoutAuditArtifact(
  artifact: WorkoutAuditArtifact
): string {
  return serializeStableJson(compactWorkoutAuditArtifactForSerialization(artifact));
}

export function createWorkoutAuditArtifactOutput(
  request: WorkoutAuditRequest,
  run: WorkoutAuditRun,
  options?: Parameters<typeof buildWorkoutAuditArtifact>[2]
): {
  artifact: WorkoutAuditArtifact;
  serializedArtifact: WorkoutAuditArtifact;
  serialized: string;
  sizeBytes: number;
} {
  const artifact = buildWorkoutAuditArtifact(request, run, options);
  const serializedArtifact = compactWorkoutAuditArtifactForSerialization(artifact);
  const serialized = serializeStableJson(serializedArtifact);
  return {
    artifact,
    serializedArtifact,
    serialized,
    sizeBytes: getSerializedArtifactSizeBytes(serialized),
  };
}
