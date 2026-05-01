import {
  buildGenerationWarningSummary,
  WORKOUT_AUDIT_CONCLUSIONS,
} from "./conclusions";
import type {
  V2DebugDetailLevel,
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
import {
  buildV2DebugArtifacts,
  type BuiltV2DebugArtifactOutput,
} from "./v2-debug-artifacts";

function getArtifactGuardrailWarnings(run: WorkoutAuditRun): string[] {
  const warnings: string[] = [];

  if (
    run.progressionAnchor?.sessionSnapshotSource === "reconstructed_saved_only"
  ) {
    warnings.push(
      `${AUDIT_RECONSTRUCTION_GUARDRAIL} Progression-anchor coverage is using a saved-only reconstructed snapshot.`,
    );
  }

  if (
    (run.historicalWeek?.comparabilityCoverage.reconstructedSnapshotCount ??
      0) > 0
  ) {
    warnings.push(
      `${AUDIT_RECONSTRUCTION_GUARDRAIL} Historical-week coverage includes saved-only reconstructed sessions.`,
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
  },
): WorkoutAuditArtifact {
  const piiSafe = request.sanitizationLevel === "pii-safe";
  const normalizedGeneration = normalizeSessionGenerationResultForAudit(
    run.generationResult,
  );
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
    replaceEmptyMesocycleWithV2: run.replaceEmptyMesocycleWithV2,
    v2AcceptedSeedPrepareCompare: run.v2AcceptedSeedPrepareCompare,
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
  artifact: WorkoutAuditArtifact,
): string {
  return serializeStableJson(
    compactWorkoutAuditArtifactForSerialization(artifact),
  );
}

export function createWorkoutAuditArtifactOutput(
  request: WorkoutAuditRequest,
  run: WorkoutAuditRun,
  options?: Parameters<typeof buildWorkoutAuditArtifact>[2] & {
    artifactFileName?: string;
    artifactRelativePath?: string;
    v2DebugArtifactFileName?: string;
    v2DebugArtifactRelativePath?: string;
    v2DebugDetailLevel?: V2DebugDetailLevel;
  },
): {
  artifact: WorkoutAuditArtifact;
  serializedArtifact: WorkoutAuditArtifact;
  serialized: string;
  sizeBytes: number;
  v2DebugArtifact?: BuiltV2DebugArtifactOutput;
} {
  const artifact = buildWorkoutAuditArtifact(request, run, options);
  const parentFileName = options?.artifactFileName;
  const parentRelativePath = options?.artifactRelativePath;
  const sidecarFileName = options?.v2DebugArtifactFileName;
  const sidecarRelativePath = options?.v2DebugArtifactRelativePath;
  const shouldCreateV2DebugArtifact =
    request.v2DebugArtifact === true &&
    request.mode === "mesocycle-explain" &&
    request.plannerOnlyNoRepair === true &&
    Boolean(
      parentFileName &&
      parentRelativePath &&
      sidecarFileName &&
      sidecarRelativePath,
    );
  const v2DebugArtifact = shouldCreateV2DebugArtifact
    ? buildV2DebugArtifacts({
        artifact,
        request,
        parentFileName: parentFileName as string,
        parentRelativePath: parentRelativePath as string,
        indexFileName: sidecarFileName as string,
        indexRelativePath: sidecarRelativePath as string,
        detailLevel: options?.v2DebugDetailLevel ?? "compact",
      })
    : undefined;
  const serializedArtifact = compactWorkoutAuditArtifactForSerialization(
    artifact,
    v2DebugArtifact
      ? {
          plannerOnlyNoRepairDebugArtifact: {
            fileName: v2DebugArtifact.fileName,
            relativePath: v2DebugArtifact.relativePath,
            sizeBytes: v2DebugArtifact.sizeBytes,
            sha256: v2DebugArtifact.sha256,
            detailLevel: v2DebugArtifact.artifact.detailLevel,
          },
        }
      : undefined,
  );
  const serialized = serializeStableJson(serializedArtifact);
  return {
    artifact,
    serializedArtifact,
    serialized,
    sizeBytes: getSerializedArtifactSizeBytes(serialized),
    v2DebugArtifact,
  };
}
