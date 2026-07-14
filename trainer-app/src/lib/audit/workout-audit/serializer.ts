import {
  buildGenerationWarningSummary,
  WORKOUT_AUDIT_CONCLUSIONS,
} from "./conclusions";
import type {
  AcceptedMesocycleSeedProvenanceConsistency,
} from "@/lib/api/accepted-mesocycle-seed-provenance";
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
import type {
  ProgressionDecisionTrace,
  SessionAuditExerciseSnapshot,
  SessionAuditSnapshot,
} from "@/lib/evidence/session-audit-types";

const TARGET_EFFORT_MISMATCH_REP_GAP = 2;
const TARGET_EFFORT_MISMATCH_RPE_GAP = 1.5;
const TARGET_EFFORT_MISMATCH_MIN_PERFORMANCE_JUMP_RATIO = 1.05;

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

function buildTargetEffortLoadMismatchWarnings(
  sessionSnapshot: SessionAuditSnapshot | undefined,
): string[] {
  const generated = sessionSnapshot?.generated;
  if (!generated) {
    return [];
  }

  const warnings: string[] = [];
  for (const exercise of generated.exercises) {
    const trace = generated.traces.progression[exercise.exerciseId];
    const target = resolveRepresentativeTarget(exercise, trace);
    if (!trace || !target) {
      continue;
    }

    const anchorLoad = trace.anchor.anchorLoad;
    const priorMedianReps = trace.metrics.medianReps;
    const priorModalRpe = trace.metrics.modalRpe;
    if (
      !Number.isFinite(anchorLoad) ||
      !Number.isFinite(priorMedianReps) ||
      !Number.isFinite(priorModalRpe)
    ) {
      continue;
    }

    const targetLoadHoldsHigh = target.load >= anchorLoad;
    const repsGap = target.reps - priorMedianReps;
    const rpeGap = (priorModalRpe as number) - target.rpe;
    const priorPerformance = anchorLoad * (1 + priorMedianReps / 30);
    const targetPerformance = target.load * (1 + target.reps / 30);
    const performanceJumpRatio =
      priorPerformance > 0 ? targetPerformance / priorPerformance : 0;

    if (
      targetLoadHoldsHigh &&
      repsGap >= TARGET_EFFORT_MISMATCH_REP_GAP &&
      rpeGap >= TARGET_EFFORT_MISMATCH_RPE_GAP &&
      performanceJumpRatio >= TARGET_EFFORT_MISMATCH_MIN_PERFORMANCE_JUMP_RATIO
    ) {
      warnings.push(
        `target_effort_load_mismatch: ${exercise.exerciseName} generated ${formatAuditNumber(target.load)} lb for ${formatAuditNumber(target.reps)} reps @ RPE ${formatAuditNumber(target.rpe)} after prior anchor ${formatAuditNumber(anchorLoad)} lb, median ${formatAuditNumber(priorMedianReps)} reps @ RPE ${formatAuditNumber(priorModalRpe as number)}; load delta ${formatSignedAuditNumber(trace.metrics.loadDelta)} lb while prior reps/effort do not support the easier target.`,
      );
    }
  }

  return warnings;
}

function resolveRepresentativeTarget(
  exercise: SessionAuditExerciseSnapshot,
  trace: ProgressionDecisionTrace | undefined,
): { load: number; reps: number; rpe: number } | null {
  if (!trace) {
    return null;
  }

  const targetSet =
    exercise.prescribedSets.find((set) => set.setIndex === 1) ??
    exercise.prescribedSets[0];
  const targetLoad = targetSet?.targetLoad ?? trace.metrics.nextLoad;
  const targetReps =
    targetSet?.targetReps ??
    targetSet?.targetRepRange?.max ??
    trace.repRange.max;
  const targetRpe = targetSet?.targetRpe;

  if (
    !Number.isFinite(targetLoad) ||
    !Number.isFinite(targetReps) ||
    !Number.isFinite(targetRpe)
  ) {
    return null;
  }

  return {
    load: targetLoad as number,
    reps: targetReps as number,
    rpe: targetRpe as number,
  };
}

function formatAuditNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatSignedAuditNumber(value: number): string {
  const formatted = formatAuditNumber(value);
  return value >= 0 ? `+${formatted}` : formatted;
}

function buildGenerationProvenanceSummary(input: {
  generation: AuditSessionGenerationResult | undefined;
  generationPath: WorkoutAuditGenerationPath | undefined;
  acceptedSeedProvenanceConsistency:
    | AcceptedMesocycleSeedProvenanceConsistency
    | undefined;
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
      seedProvenance: receiptProvenance?.seedProvenance ?? null,
    },
    auditOnly: {
      generationPath: input.generationPath ?? null,
    },
    ...(input.acceptedSeedProvenanceConsistency
      ? {
          seed: {
            provenanceConsistency: input.acceptedSeedProvenanceConsistency,
          },
        }
      : {}),
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
    acceptedSeedProvenanceConsistency:
      run.acceptedSeedProvenanceConsistency,
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

  const semanticWarnings = [
    ...getArtifactGuardrailWarnings(run),
    ...buildTargetEffortLoadMismatchWarnings(run.sessionSnapshot),
  ];

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
    preSessionReadiness: run.preSessionReadiness,
    activeMesocycleSlotReseed: run.activeMesocycleSlotReseed,
    replaceEmptyMesocycleWithV2: run.replaceEmptyMesocycleWithV2,
    replaceEmptySuccessorFromAcceptedSeedDraft:
      run.replaceEmptySuccessorFromAcceptedSeedDraft,
    v2AcceptedSeedPrepareCompare: run.v2AcceptedSeedPrepareCompare,
    nextMesocycleHandoffDryRun: run.nextMesocycleHandoffDryRun,
    nextMesocycleAcceptanceGate: run.nextMesocycleAcceptanceGate,
    nextMesocyclePostAcceptVerification:
      run.nextMesocyclePostAcceptVerification,
    mesocycleExplain: run.mesocycleExplain,
    progressionAnchor: run.progressionAnchor,
    warningSummary: buildGenerationWarningSummary({
      generation: normalizedGeneration,
      capturedWarnings: options?.capturedWarnings,
      additionalSemanticWarnings: semanticWarnings,
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
  const planningRealityDebugShard = v2DebugArtifact?.shards.find(
    (shard) => shard.metadata.id === "planning-reality",
  );
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
          ...(planningRealityDebugShard
            ? {
                planningRealityDebugArtifact: {
                  fileName: planningRealityDebugShard.fileName,
                  relativePath: planningRealityDebugShard.relativePath,
                  sizeBytes: planningRealityDebugShard.sizeBytes,
                  sha256: planningRealityDebugShard.sha256,
                  detailLevel: planningRealityDebugShard.artifact.detailLevel,
                },
              }
            : {}),
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
