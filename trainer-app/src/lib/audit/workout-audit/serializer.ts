import { createHash } from "node:crypto";
import {
  buildGenerationWarningSummary,
  WORKOUT_AUDIT_CONCLUSIONS,
} from "./conclusions";
import type {
  MesocycleExplainPlannerOnlyNoRepairDebugArtifact,
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

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildRequestFlags(request: WorkoutAuditRequest): string[] {
  const flags = [`--mode ${request.mode}`];
  if (request.plannerOnlyNoRepair) {
    flags.push("--planner-only-no-repair");
  }
  if (request.compareRepaired) {
    flags.push("--compare-repaired");
  }
  if (request.v2DebugArtifact) {
    flags.push("--v2-debug-artifact");
  }
  return flags;
}

function incrementCount(record: Record<string, number>, key: unknown): void {
  const normalized =
    typeof key === "string" && key.length > 0 ? key : "unknown";
  record[normalized] = (record[normalized] ?? 0) + 1;
}

function buildV2DebugSidecarPayload(input: {
  artifact: WorkoutAuditArtifact;
  request: WorkoutAuditRequest;
  parentFileName: string;
  parentRelativePath: string;
}): MesocycleExplainPlannerOnlyNoRepairDebugArtifact | undefined {
  const mesocycleExplain = input.artifact.mesocycleExplain;
  const noRepair = mesocycleExplain?.plannerOnlyNoRepair;
  if (!mesocycleExplain || !noRepair) {
    return undefined;
  }

  const laneStatusCounts: Record<string, number> = {};
  const severityCounts: Record<string, number> = {};
  const migrationRecommendationCounts: Record<string, number> = {};
  const gapCauseCounts: Record<string, number> = {};
  const laneEvidence = noRepair.v2TargetVsNoRepairDiff.slotDiffs.flatMap(
    (slot) =>
      slot.laneDiffs.map((lane) => {
        incrementCount(laneStatusCounts, lane.currentStatus);
        incrementCount(severityCounts, lane.severity);
        incrementCount(
          migrationRecommendationCounts,
          lane.migrationRecommendation,
        );
        incrementCount(gapCauseCounts, lane.gapCause);
        return {
          slotId: slot.slotId,
          laneId: lane.laneId,
          currentStatus: lane.currentStatus,
          severity: lane.severity,
          selectedExercises: lane.currentEvidence.selectedExercises,
          relevantDiagnostics: lane.currentEvidence.relevantDiagnostics,
        };
      }),
  );

  return {
    version: 1,
    kind: "v2_planner_no_repair_debug",
    generatedAt: input.artifact.generatedAt,
    parent: {
      fileName: input.parentFileName,
      relativePath: input.parentRelativePath,
      mode: "mesocycle-explain",
      sourceMesocycleId: mesocycleExplain.sourceMesocycleId,
      retrospectiveMesocycleId: mesocycleExplain.retrospectiveMesocycleId,
      requestFlags: buildRequestFlags(input.request),
    },
    readOnly: true,
    affectsScoringOrGeneration: false,
    plannerOnlyNoRepair: {
      summary: noRepair.summary,
      acceptanceClassification: noRepair.acceptanceClassification,
      repairPromotionScoreboard: noRepair.repairPromotionScoreboard,
      crossWeekProjectionGate: noRepair.crossWeekProjectionGate,
      v2DeloadProjectionDiagnostic: noRepair.v2DeloadProjectionDiagnostic,
      v2MesocyclePlan: noRepair.v2MesocyclePlan,
      v2SetDistributionIntent: noRepair.v2SetDistributionIntent,
      v2SupportLanePolicy: noRepair.v2SupportLanePolicy,
      v2SupportLaneProjectionDiagnostic:
        noRepair.v2SupportLaneProjectionDiagnostic,
      v2SelectionCapacityPlanDiagnostic:
        noRepair.v2SelectionCapacityPlanDiagnostic,
      plannerOwnedAccumulationProjection:
        noRepair.plannerOwnedAccumulationProjection,
      v2ExerciseSelectionPlanDiagnostic:
        noRepair.v2ExerciseSelectionPlanDiagnostic,
      lowAxialHipExtensionLimitation:
        noRepair.lowAxialHipExtensionLimitation,
      v2TargetVsNoRepairDiff: noRepair.v2TargetVsNoRepairDiff,
      slotPlans: noRepair.slotPlans,
      weeklyMuscleTotals: noRepair.weeklyMuscleTotals,
      setAllocationChanges: noRepair.setAllocationChanges,
      weeklyMuscleTotalChanges: noRepair.weeklyMuscleTotalChanges,
      acceptanceChecks: noRepair.acceptanceChecks,
      acceptanceFailures: noRepair.acceptanceFailures,
      qualityWarnings: noRepair.qualityWarnings,
      diagnosticRows: noRepair.diagnosticRows,
      ignoredRows: noRepair.ignoredRows,
      repairDependenciesDisabled: noRepair.repairDependenciesDisabled,
      comparisonToRepaired: noRepair.comparisonToRepaired,
      laneEvidence,
      diagnosticCatalogs: {
        laneStatusCounts,
        severityCounts,
        migrationRecommendationCounts,
        gapCauseCounts,
      },
      classificationDetails: {
        hardBlockerCount: noRepair.acceptanceClassification.hardBlockers.length,
        qualityWarningCount:
          noRepair.acceptanceClassification.qualityWarnings.length,
        diagnosticOnlyCount:
          noRepair.acceptanceClassification.diagnosticOnly.length,
        sessionShapingCount:
          noRepair.acceptanceClassification.sessionShaping.length,
      },
    },
  };
}

export function createWorkoutAuditArtifactOutput(
  request: WorkoutAuditRequest,
  run: WorkoutAuditRun,
  options?: Parameters<typeof buildWorkoutAuditArtifact>[2] & {
    artifactFileName?: string;
    artifactRelativePath?: string;
    v2DebugArtifactFileName?: string;
    v2DebugArtifactRelativePath?: string;
  },
): {
  artifact: WorkoutAuditArtifact;
  serializedArtifact: WorkoutAuditArtifact;
  serialized: string;
  sizeBytes: number;
  v2DebugArtifact?: {
    artifact: MesocycleExplainPlannerOnlyNoRepairDebugArtifact;
    serialized: string;
    sizeBytes: number;
    sha256: string;
    fileName: string;
    relativePath: string;
  };
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
  const v2DebugPayload = shouldCreateV2DebugArtifact
    ? buildV2DebugSidecarPayload({
        artifact,
        request,
        parentFileName: parentFileName as string,
        parentRelativePath: parentRelativePath as string,
      })
    : undefined;
  const v2DebugSerialized = v2DebugPayload
    ? serializeStableJson(v2DebugPayload)
    : undefined;
  const v2DebugArtifact =
    v2DebugPayload &&
    v2DebugSerialized &&
    sidecarFileName &&
    sidecarRelativePath
      ? {
          artifact: v2DebugPayload,
          serialized: v2DebugSerialized,
          sizeBytes: getSerializedArtifactSizeBytes(v2DebugSerialized),
          sha256: sha256Hex(v2DebugSerialized),
          fileName: sidecarFileName,
          relativePath: sidecarRelativePath,
        }
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
