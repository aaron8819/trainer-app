import { createHash } from "node:crypto";
import {
  V2_DEBUG_DEFAULT_SHARD_BUDGET_BYTES,
  V2_DEBUG_FULL_DETAIL_SHARD_BUDGET_BYTES,
  V2_DEBUG_INDEX_BUDGET_BYTES,
  WORKOUT_AUDIT_MAIN_ARTIFACT_BUDGET_BYTES,
  WORKOUT_AUDIT_SIZE_LIMIT_BYTES,
} from "./constants";
import {
  getSerializedArtifactSizeBytes,
  serializeStableJson,
} from "./artifact-serialization";
import type {
  MesocycleExplainPlannerOnlyNoRepairDebugIndex,
  MesocycleExplainPlannerOnlyNoRepairDebugShard,
  V2DebugDetailLevel,
  V2DebugShardMetadata,
  WorkoutAuditArtifact,
  WorkoutAuditRequest,
} from "./types";

type JsonRecord = Record<string, unknown>;

export const V2_DEBUG_SHARD_IDS = [
  "strategy",
  "promotion-readiness",
  "promotion-diffs",
  "repair-evidence",
  "materialization",
  "cross-week-projection",
  "selection-alignment",
] as const;

type V2DebugShardId = (typeof V2_DEBUG_SHARD_IDS)[number];

type V2DebugShardBuildResult = {
  artifact: MesocycleExplainPlannerOnlyNoRepairDebugShard;
  serialized: string;
  sizeBytes: number;
  sha256: string;
  fileName: string;
  relativePath: string;
  metadata: V2DebugShardMetadata;
};

export type BuiltV2DebugArtifactOutput = {
  artifact: MesocycleExplainPlannerOnlyNoRepairDebugIndex;
  serialized: string;
  sizeBytes: number;
  sha256: string;
  fileName: string;
  relativePath: string;
  shards: V2DebugShardBuildResult[];
};

const SHARD_FILE_SUFFIX_BY_ID: Record<V2DebugShardId, string> = {
  strategy: "v2-strategy",
  "promotion-readiness": "v2-promotion-readiness",
  "promotion-diffs": "v2-promotion-diffs",
  "repair-evidence": "v2-repair-evidence",
  materialization: "v2-materialization",
  "cross-week-projection": "v2-cross-week-projection",
  "selection-alignment": "v2-selection-alignment",
};

const EMPTY_SHARD_PATH = "";
const EMPTY_SHARD_HASH = "";
const COMPACT_TOP_ROW_LIMIT = 12;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
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

function countBy(rows: ReadonlyArray<JsonRecord>, field: string): JsonRecord {
  return rows.reduce<JsonRecord>((counts, row) => {
    const key =
      typeof row[field] === "string" && row[field].length > 0
        ? row[field]
        : "unknown";
    counts[key as string] = ((counts[key as string] as number) ?? 0) + 1;
    return counts;
  }, {});
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function countProjectionGateStatuses(value: unknown): JsonRecord {
  const gates = Object.values(asRecord(value) ?? {}).filter(
    (entry): entry is string =>
      entry === "pass" || entry === "fail" || entry === "unknown",
  );
  return {
    pass: gates.filter((entry) => entry === "pass").length,
    fail: gates.filter((entry) => entry === "fail").length,
    unknown: gates.filter((entry) => entry === "unknown").length,
  };
}

function pickRecordFields(
  value: unknown,
  fields: ReadonlyArray<string>,
): JsonRecord {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return Object.fromEntries(
    fields
      .filter((field) => field in record)
      .map((field) => [field, record[field]]),
  );
}

function deriveShardFileName(
  indexFileName: string,
  shardId: V2DebugShardId,
): string {
  const suffix = SHARD_FILE_SUFFIX_BY_ID[shardId];
  if (indexFileName.endsWith("-v2-debug-index.json")) {
    return indexFileName.replace("-v2-debug-index.json", `-${suffix}.json`);
  }
  return indexFileName.endsWith(".json")
    ? indexFileName.replace(/\.json$/, `-${suffix}.json`)
    : `${indexFileName}-${suffix}.json`;
}

function deriveSiblingRelativePath(
  indexRelativePath: string,
  shardFileName: string,
): string {
  const slashIndex = indexRelativePath.lastIndexOf("/");
  return slashIndex >= 0
    ? `${indexRelativePath.slice(0, slashIndex + 1)}${shardFileName}`
    : shardFileName;
}

function compactStatusObject(value: unknown): JsonRecord {
  const record = asRecord(value);
  if (!record) {
    return { status: "not_available" };
  }
  return {
    status: record.status ?? "unknown",
    ...(Array.isArray(record.basis) ? { basisCount: record.basis.length } : {}),
    ...(typeof record.projectionBasis === "string"
      ? { projectionBasis: record.projectionBasis }
      : {}),
    ...(typeof record.preserveIdentities === "boolean"
      ? { preserveIdentities: record.preserveIdentities }
      : {}),
    ...(typeof record.safeForBehaviorPromotion === "boolean"
      ? { safeForBehaviorPromotion: record.safeForBehaviorPromotion }
      : {}),
  };
}

function compactCrossWeekProjectionGate(value: unknown): JsonRecord {
  const gate = asRecord(value);
  if (!gate) {
    return {};
  }
  const accumulationWeeksStatus = asRecord(gate.accumulationWeeksStatus);
  const accumulationWeeks = asRecordArray(accumulationWeeksStatus?.weeks);
  return {
    readOnly: true,
    affectsScoringOrGeneration: false,
    week1Status: compactStatusObject(gate.week1Status),
    accumulationWeeksStatus: {
      status: accumulationWeeksStatus?.status ?? "not_projected",
      weekCount: accumulationWeeks.length,
      projectionBasisCounts: countBy(accumulationWeeks, "projectionBasis"),
    },
    deloadStatus: compactStatusObject(gate.deloadStatus),
    replacementReadinessStatus: gate.replacementReadinessStatus ?? "not_ready",
    safeToPromoteBehavior: false,
    blockerCount: countArray(gate.blockers),
    warningCount: countArray(gate.warnings),
    missingInputCount: countArray(gate.missingInputs),
    projectedWeekSummaryCount: countArray(gate.projectedWeekSummaries),
  };
}

function compactDiagnosticStatus(value: unknown): JsonRecord {
  const record = asRecord(value);
  if (!record) {
    return { status: "not_available" };
  }
  return {
    status: record.status ?? "not_available",
    readOnly: record.readOnly === true,
    affectsScoringOrGeneration: record.affectsScoringOrGeneration === true,
    summary: asRecord(record.summary) ?? {},
    blockerCount: countArray(record.blockers),
    warningCount: countArray(record.warnings),
    missingInputCount: countArray(record.missingInputs),
    safeForBehaviorPromotion:
      record.safeForBehaviorPromotion === true ? true : false,
  };
}

function compactStrategyDiagnostic(value: unknown): JsonRecord {
  const diagnostic = asRecord(value);
  if (!diagnostic) {
    return { status: "not_available" };
  }
  const recommendation = asRecord(diagnostic.strategyRecommendation);
  const hypotheses = asRecordArray(recommendation?.hypotheses);
  const readiness = asRecord(diagnostic.strategyHypothesisPromotionReadiness);
  const readinessRows = asRecordArray(readiness?.hypothesisReadiness);
  const inputSummary = asRecord(diagnostic.strategyInputSummary);
  const responseSummary = asRecord(diagnostic.responseEvidenceSummary);

  return {
    status: diagnostic.status ?? "available_with_limitations",
    readOnly: diagnostic.readOnly === true,
    affectsScoringOrGeneration:
      diagnostic.affectsScoringOrGeneration === true ? true : false,
    phaseStrategy: pickRecordFields(diagnostic.phaseStrategy, [
      "proposedPhase",
      "confidence",
      "evidence",
      "limitations",
    ]),
    demandDerivationPlan: pickRecordFields(diagnostic.demandDerivationPlan, [
      "currentDemandSource",
      "targetDemandSource",
      "limitations",
    ]),
    strategyInputSummary: {
      presentGroups: asStringArray(inputSummary?.presentGroups),
      missingGroups: asStringArray(inputSummary?.missingGroups),
      historicalMesocycleCount:
        typeof inputSummary?.historicalMesocycleCount === "number"
          ? inputSummary.historicalMesocycleCount
          : 0,
      blockResponseSignalCount:
        typeof inputSummary?.blockResponseSignalCount === "number"
          ? inputSummary.blockResponseSignalCount
          : 0,
      exerciseResponseSignalCount:
        typeof inputSummary?.exerciseResponseSignalCount === "number"
          ? inputSummary.exerciseResponseSignalCount
          : 0,
      confidenceChange:
        typeof inputSummary?.confidenceChange === "string"
          ? inputSummary.confidenceChange
          : "not_evaluated_no_input",
    },
    responseEvidenceSummary: {
      strategyImplicationCounts:
        asRecord(responseSummary?.strategyImplicationCounts) ?? {},
      exerciseSignalsByType: asRecord(responseSummary?.exerciseSignalsByType) ?? {},
      confidenceDistribution: asRecord(responseSummary?.confidenceDistribution) ?? {},
      evidenceLimitationCount: countArray(responseSummary?.evidenceLimitations),
      recurringUnderHitMuscleExampleCount: countArray(
        responseSummary?.recurringUnderHitMuscleExamples,
      ),
      recurringOverConcentrationExampleCount: countArray(
        responseSummary?.recurringOverConcentrationExamples,
      ),
    },
    strategyRecommendation: recommendation
      ? {
          status: recommendation.status ?? "not_available",
          recommendedPhase: recommendation.recommendedPhase ?? "unknown",
          confidence: recommendation.confidence ?? "low",
          hypothesisCount: hypotheses.length,
          hypothesisIds: hypotheses
            .map((row) => row.id)
            .filter((id): id is string => typeof id === "string"),
          priorityCounts: countBy(hypotheses, "priority"),
        }
      : undefined,
    strategyHypothesisPromotionReadiness: readiness
      ? {
          status: readiness.status ?? "not_ready",
          hypothesisCount: readinessRows.length,
          readinessCounts: countBy(readinessRows, "readiness"),
          proposedOwnerCounts: countBy(readinessRows, "proposedOwner"),
          nextSafeActionCounts: countBy(readinessRows, "nextSafeAction"),
          globalBlockers: asStringArray(readiness.globalBlockers).slice(0, 8),
        }
      : undefined,
    northStarGapCount: countArray(diagnostic.currentStateVsNorthStarGaps),
  };
}

function compactPromotionReadiness(value: unknown): JsonRecord {
  const diagnostic = asRecord(value);
  const readiness = asRecord(diagnostic?.strategyHypothesisPromotionReadiness);
  if (!readiness) {
    return { status: "not_available" };
  }
  const rows = asRecordArray(readiness.hypothesisReadiness);
  return {
    strategyHypothesisPromotionReadiness: {
      status: readiness.status ?? "not_ready",
      readOnly: readiness.readOnly === true,
      affectsScoringOrGeneration:
        readiness.affectsScoringOrGeneration === true ? true : false,
      globalBlockers: asStringArray(readiness.globalBlockers).slice(0, 12),
      hypothesisReadiness: rows.map((row) => ({
        hypothesisId: row.hypothesisId,
        readiness: row.readiness,
        proposedOwner: row.proposedOwner,
        nextSafeAction: row.nextSafeAction,
        missingEvidence: asStringArray(row.missingEvidence).slice(0, 8),
        requiredEvidenceCount: countArray(row.requiredEvidence),
        nonRegressionGateCount: countArray(row.requiredNonRegressionGates),
        knownRiskCount: countArray(row.knownRisks),
        rollbackCriterionCount: countArray(row.rollbackCriteria),
      })),
      readinessCounts: countBy(rows, "readiness"),
      proposedOwnerCounts: countBy(rows, "proposedOwner"),
      nextSafeActionCounts: countBy(rows, "nextSafeAction"),
    },
  };
}

function buildLaneDiagnosticCatalog(diff: unknown): JsonRecord {
  const slotDiffs = asRecordArray(asRecord(diff)?.slotDiffs);
  const laneRows = slotDiffs.flatMap((slot) =>
    asRecordArray(slot.laneDiffs).map((lane) => ({
      slotId: slot.slotId,
      laneId: lane.laneId,
      currentStatus: lane.currentStatus,
      severity: lane.severity,
      migrationRecommendation: lane.migrationRecommendation,
      gapCause: lane.gapCause,
      selectedExerciseCount: countArray(
        asRecord(lane.currentEvidence)?.selectedExercises,
      ),
      relevantDiagnosticCount: countArray(
        asRecord(lane.currentEvidence)?.relevantDiagnostics,
      ),
    })),
  );

  return {
    laneCount: laneRows.length,
    laneStatusCounts: countBy(laneRows, "currentStatus"),
    severityCounts: countBy(laneRows, "severity"),
    migrationRecommendationCounts: countBy(
      laneRows,
      "migrationRecommendation",
    ),
    gapCauseCounts: countBy(laneRows, "gapCause"),
    laneEvidenceTop: laneRows.slice(0, COMPACT_TOP_ROW_LIMIT),
    omittedLaneEvidenceCount: Math.max(0, laneRows.length - COMPACT_TOP_ROW_LIMIT),
  };
}

function compactPromotionDiffs(noRepair: JsonRecord): JsonRecord {
  const diff = asRecord(noRepair.v2TargetVsNoRepairDiff);
  const strategyPromotionDiff = asRecord(
    asRecord(noRepair.v2MesocycleStrategyDiagnostic)
      ?.strategyHypothesisPromotionDiff,
  );
  if (!diff && !strategyPromotionDiff) {
    return { status: "not_available" };
  }

  return {
    ...(strategyPromotionDiff
      ? { strategyHypothesisPromotionDiff: strategyPromotionDiff }
      : {}),
    ...(diff
      ? {
          v2TargetVsNoRepairDiff: {
            version: diff.version,
            source: diff.source,
            readOnly: diff.readOnly === true,
            affectsScoringOrGeneration:
              diff.affectsScoringOrGeneration === true ? true : false,
            summary: asRecord(diff.summary) ?? {},
            replacementReadinessImpact:
              asRecord(diff.replacementReadinessImpact) ?? {},
            diagnosticCatalogs: buildLaneDiagnosticCatalog(diff),
          },
        }
      : {}),
  };
}

function compactRowsWithEvidenceCatalog(
  rows: ReadonlyArray<JsonRecord>,
): { rows: JsonRecord[]; evidenceCatalog: JsonRecord } {
  const evidenceCatalog = new Map<string, string>();
  const catalog: JsonRecord = {};
  let nextIndex = 1;

  const compactRows = rows.map((row) => {
    const evidence = asStringArray(row.evidence);
    const serialized = JSON.stringify(evidence);
    let ref = evidenceCatalog.get(serialized);
    if (!ref) {
      ref = `e${nextIndex}`;
      nextIndex += 1;
      evidenceCatalog.set(serialized, ref);
      catalog[ref] = evidence;
    }
    const rest = { ...row };
    delete rest.evidence;
    return {
      ...rest,
      evidenceRef: ref,
      evidenceCount: evidence.length,
    };
  });

  return { rows: compactRows, evidenceCatalog: catalog };
}

function compactRepairEvidence(value: unknown): JsonRecord {
  const scoreboard = asRecord(value);
  if (!scoreboard) {
    return { status: "not_available" };
  }
  const promotionCandidates = asRecordArray(scoreboard.promotionCandidates);
  const doNotPromoteRows = asRecordArray(scoreboard.doNotPromoteRows);
  const safetyNetRows = asRecordArray(scoreboard.safetyNetRows);
  const diagnosticRows = asRecordArray(scoreboard.diagnosticRows);
  const rawSuspiciousRows = asRecordArray(scoreboard.rawSuspiciousRows);
  const candidateTop = compactRowsWithEvidenceCatalog(
    promotionCandidates.slice(0, COMPACT_TOP_ROW_LIMIT),
  );
  const doNotPromoteTop = compactRowsWithEvidenceCatalog(
    doNotPromoteRows.slice(0, COMPACT_TOP_ROW_LIMIT),
  );

  return {
    repairPromotionScoreboard: {
      version: scoreboard.version,
      readOnly: scoreboard.readOnly === true,
      affectsScoringOrGeneration:
        scoreboard.affectsScoringOrGeneration === true ? true : false,
      source: scoreboard.source,
      rawRepairEvidence: asRecord(scoreboard.rawRepairEvidence) ?? {},
      summary: asRecord(scoreboard.summary) ?? {},
      interpretation: asRecord(scoreboard.interpretation) ?? {},
      promotionCandidatesTop: candidateTop.rows,
      doNotPromoteRowsTop: doNotPromoteTop.rows,
      evidenceCatalogs: {
        promotionCandidates: candidateTop.evidenceCatalog,
        doNotPromoteRows: doNotPromoteTop.evidenceCatalog,
      },
      omittedRows: {
        promotionCandidates: Math.max(
          0,
          promotionCandidates.length - COMPACT_TOP_ROW_LIMIT,
        ),
        doNotPromoteRows: Math.max(
          0,
          doNotPromoteRows.length - COMPACT_TOP_ROW_LIMIT,
        ),
        safetyNetRows: safetyNetRows.length,
        diagnosticRows: diagnosticRows.length,
        rawSuspiciousRows: rawSuspiciousRows.length,
      },
    },
  };
}

function compactMaterialization(noRepair: JsonRecord): JsonRecord | null {
  const v2Plan = asRecord(noRepair.v2MesocyclePlan);
  const setDistribution = asRecord(noRepair.v2SetDistributionIntent);
  const supportPolicy = asRecord(noRepair.v2SupportLanePolicy);
  if (!v2Plan && !setDistribution && !supportPolicy) {
    return null;
  }
  return {
    v2MesocyclePlan: {
      planStatus: v2Plan?.planStatus ?? "not_available",
      skeleton: pickRecordFields(v2Plan?.skeleton, [
        "split",
        "weeks",
        "slotSequence",
      ]),
      validationRuleCount: countArray(v2Plan?.validationRules),
      replacementReadiness: asRecord(v2Plan?.replacementReadiness) ?? {},
      deloadTransform: pickRecordFields(v2Plan?.deloadTransform, [
        "preserveExerciseIdentities",
        "targetVolumeReductionPercent",
        "targetRir",
        "projectionStatus",
      ]),
    },
    v2SetDistributionIntent: {
      summary: asRecord(setDistribution?.summary) ?? {},
      guardrails: asRecord(setDistribution?.guardrails) ?? {},
      weekCount: countArray(setDistribution?.weeks),
    },
    v2SupportLanePolicy: {
      summary: asRecord(supportPolicy?.summary) ?? {},
      readOnly: supportPolicy?.readOnly === true,
      affectsScoringOrGeneration:
        supportPolicy?.affectsScoringOrGeneration === true ? true : false,
    },
    materializedSeedWriteStatus: "not_available_in_audit_artifact",
  };
}

function compactCrossWeekData(noRepair: JsonRecord): JsonRecord {
  return {
    crossWeekProjectionGate: compactCrossWeekProjectionGate(
      noRepair.crossWeekProjectionGate,
    ),
    plannerOwnedAccumulationProjection: {
      status: asRecord(noRepair.plannerOwnedAccumulationProjection)
        ? "available"
        : "not_available",
      readOnly:
        asRecord(noRepair.plannerOwnedAccumulationProjection)?.readOnly === true,
      affectsScoringOrGeneration:
        asRecord(noRepair.plannerOwnedAccumulationProjection)
          ?.affectsScoringOrGeneration === true
          ? true
          : false,
      weekCount: countArray(
        asRecord(noRepair.plannerOwnedAccumulationProjection)?.weeks,
      ),
    },
    v2DeloadProjectionDiagnostic: compactDiagnosticStatus(
      noRepair.v2DeloadProjectionDiagnostic,
    ),
  };
}

function compactSelectionAlignment(noRepair: JsonRecord): JsonRecord {
  const lowAxial = asRecord(noRepair.lowAxialHipExtensionLimitation);
  return {
    v2ExerciseSelectionPlanDiagnostic: compactDiagnosticStatus(
      noRepair.v2ExerciseSelectionPlanDiagnostic,
    ),
    v2SelectionCapacityPlanDiagnostic: compactDiagnosticStatus(
      noRepair.v2SelectionCapacityPlanDiagnostic,
    ),
    v2SupportLaneProjectionDiagnostic: compactDiagnosticStatus(
      noRepair.v2SupportLaneProjectionDiagnostic,
    ),
    lowAxialHipExtensionLimitation: lowAxial
      ? {
          status: lowAxial.status ?? "not_evaluated",
          slotId: lowAxial.slotId ?? "lower_b",
          trueHingeExposureCount: lowAxial.trueHingeExposureCount ?? 0,
          lowAxialHipExtensionAnchorCount:
            lowAxial.lowAxialHipExtensionAnchorCount ?? 0,
          safeForBehaviorPromotion: false,
          evidenceCount: countArray(lowAxial.evidence),
          limitationCount: countArray(lowAxial.limitations),
        }
      : undefined,
  };
}

function buildFullShardData(
  shardId: V2DebugShardId,
  noRepair: JsonRecord,
): JsonRecord | null {
  switch (shardId) {
    case "strategy":
      return noRepair.v2MesocycleStrategyDiagnostic
        ? {
            v2MesocycleStrategyDiagnostic:
              noRepair.v2MesocycleStrategyDiagnostic,
          }
        : null;
    case "promotion-readiness":
      return asRecord(noRepair.v2MesocycleStrategyDiagnostic)
        ?.strategyHypothesisPromotionReadiness
        ? {
            strategyHypothesisPromotionReadiness: asRecord(
              noRepair.v2MesocycleStrategyDiagnostic,
            )?.strategyHypothesisPromotionReadiness,
          }
        : null;
    case "promotion-diffs":
      return noRepair.v2TargetVsNoRepairDiff ||
        asRecord(noRepair.v2MesocycleStrategyDiagnostic)
          ?.strategyHypothesisPromotionDiff
        ? {
            ...(noRepair.v2TargetVsNoRepairDiff
              ? { v2TargetVsNoRepairDiff: noRepair.v2TargetVsNoRepairDiff }
              : {}),
            ...(asRecord(noRepair.v2MesocycleStrategyDiagnostic)
              ?.strategyHypothesisPromotionDiff
              ? {
                  strategyHypothesisPromotionDiff: asRecord(
                    noRepair.v2MesocycleStrategyDiagnostic,
                  )?.strategyHypothesisPromotionDiff,
                }
              : {}),
          }
        : null;
    case "repair-evidence":
      return noRepair.repairPromotionScoreboard
        ? { repairPromotionScoreboard: noRepair.repairPromotionScoreboard }
        : null;
    case "materialization":
      return compactMaterialization(noRepair);
    case "cross-week-projection":
      return {
        crossWeekProjectionGate: noRepair.crossWeekProjectionGate,
        plannerOwnedAccumulationProjection:
          noRepair.plannerOwnedAccumulationProjection,
        v2DeloadProjectionDiagnostic: noRepair.v2DeloadProjectionDiagnostic,
      };
    case "selection-alignment":
      return {
        v2ExerciseSelectionPlanDiagnostic:
          noRepair.v2ExerciseSelectionPlanDiagnostic,
        v2SelectionCapacityPlanDiagnostic:
          noRepair.v2SelectionCapacityPlanDiagnostic,
        v2SupportLaneProjectionDiagnostic:
          noRepair.v2SupportLaneProjectionDiagnostic,
        lowAxialHipExtensionLimitation:
          noRepair.lowAxialHipExtensionLimitation,
      };
  }
}

function buildCompactShardData(
  shardId: V2DebugShardId,
  noRepair: JsonRecord,
): JsonRecord | null {
  switch (shardId) {
    case "strategy":
      return {
        v2MesocycleStrategyDiagnostic: compactStrategyDiagnostic(
          noRepair.v2MesocycleStrategyDiagnostic,
        ),
      };
    case "promotion-readiness":
      return compactPromotionReadiness(noRepair.v2MesocycleStrategyDiagnostic);
    case "promotion-diffs":
      return compactPromotionDiffs(noRepair);
    case "repair-evidence":
      return compactRepairEvidence(noRepair.repairPromotionScoreboard);
    case "materialization":
      return compactMaterialization(noRepair);
    case "cross-week-projection":
      return compactCrossWeekData(noRepair);
    case "selection-alignment":
      return compactSelectionAlignment(noRepair);
  }
}

function buildShardSummary(
  shardId: V2DebugShardId,
  data: JsonRecord,
): JsonRecord {
  return {
    id: shardId,
    topLevelKeys: Object.keys(data).sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function buildShardArtifact(input: {
  shardId: V2DebugShardId;
  artifact: WorkoutAuditArtifact;
  noRepair: JsonRecord;
  request: WorkoutAuditRequest;
  parentFileName: string;
  parentRelativePath: string;
  indexFileName: string;
  indexRelativePath: string;
  detailLevel: V2DebugDetailLevel;
}): MesocycleExplainPlannerOnlyNoRepairDebugShard | null {
  if (input.detailLevel === "summary") {
    return null;
  }
  const data =
    input.detailLevel === "full"
      ? buildFullShardData(input.shardId, input.noRepair)
      : buildCompactShardData(input.shardId, input.noRepair);
  if (!data || Object.keys(data).length === 0) {
    return null;
  }
  const mesocycleExplain = input.artifact.mesocycleExplain;
  return {
    version: 1,
    kind: "v2_debug_shard",
    id: input.shardId,
    generatedAt: input.artifact.generatedAt,
    parent: {
      fileName: input.parentFileName,
      relativePath: input.parentRelativePath,
      indexFileName: input.indexFileName,
      indexRelativePath: input.indexRelativePath,
      mode: "mesocycle-explain",
      sourceMesocycleId: mesocycleExplain?.sourceMesocycleId,
      retrospectiveMesocycleId: mesocycleExplain?.retrospectiveMesocycleId,
      requestFlags: buildRequestFlags(input.request),
    },
    readOnly: true,
    affectsScoringOrGeneration: false,
    detailLevel: input.detailLevel,
    summary: buildShardSummary(input.shardId, data),
    data,
  };
}

function compactShardToBudget(
  shard: MesocycleExplainPlannerOnlyNoRepairDebugShard,
  originalBytes: number,
): MesocycleExplainPlannerOnlyNoRepairDebugShard {
  return {
    ...shard,
    summary: {
      ...shard.summary,
      compactedDueToBudget: true,
      originalBytes,
      retainedTopLevelKeys: Object.keys(shard.data).sort((left, right) =>
        left.localeCompare(right),
      ),
    },
    data: {
      budgetCompaction: {
        reason: "compact_shard_budget_exceeded",
        originalBytes,
        retainedSummaryOnly: true,
      },
    },
  };
}

function buildShardOutput(input: {
  shardId: V2DebugShardId;
  artifact: WorkoutAuditArtifact;
  noRepair: JsonRecord;
  request: WorkoutAuditRequest;
  parentFileName: string;
  parentRelativePath: string;
  indexFileName: string;
  indexRelativePath: string;
  detailLevel: V2DebugDetailLevel;
}): V2DebugShardBuildResult | V2DebugShardMetadata {
  const fileName = deriveShardFileName(input.indexFileName, input.shardId);
  const relativePath = deriveSiblingRelativePath(
    input.indexRelativePath,
    fileName,
  );
  const budgetBytes =
    input.detailLevel === "full"
      ? V2_DEBUG_FULL_DETAIL_SHARD_BUDGET_BYTES
      : V2_DEBUG_DEFAULT_SHARD_BUDGET_BYTES;
  const artifact = buildShardArtifact(input);
  if (!artifact) {
    return {
      id: input.shardId,
      relativePath: EMPTY_SHARD_PATH,
      hash: EMPTY_SHARD_HASH,
      bytes: 0,
      detailLevel: input.detailLevel,
      status: input.detailLevel === "summary" ? "skipped" : "not_available",
      budgetBytes,
      budgetStatus: "within_budget",
    };
  }

  let serialized = serializeStableJson(artifact);
  let sizeBytes = getSerializedArtifactSizeBytes(serialized);
  let budgetStatus: V2DebugShardMetadata["budgetStatus"] =
    sizeBytes <= budgetBytes ? "within_budget" : "exceeded";
  let finalArtifact = artifact;

  if (input.detailLevel !== "full" && sizeBytes > budgetBytes) {
    finalArtifact = compactShardToBudget(artifact, sizeBytes);
    serialized = serializeStableJson(finalArtifact);
    sizeBytes = getSerializedArtifactSizeBytes(serialized);
    budgetStatus =
      sizeBytes <= budgetBytes ? "compacted_to_budget" : "exceeded";
  }

  const sha256 = sha256Hex(serialized);
  const metadata: V2DebugShardMetadata = {
    id: input.shardId,
    relativePath,
    hash: sha256,
    bytes: sizeBytes,
    detailLevel: input.detailLevel,
    status: "written",
    budgetBytes,
    budgetStatus,
  };

  return {
    artifact: finalArtifact,
    serialized,
    sizeBytes,
    sha256,
    fileName,
    relativePath,
    metadata,
  };
}

function isShardOutput(
  value: V2DebugShardBuildResult | V2DebugShardMetadata,
): value is V2DebugShardBuildResult {
  return "artifact" in value;
}

function buildIndexNoRepair(noRepair: JsonRecord): JsonRecord {
  const acceptanceClassification = asRecord(noRepair.acceptanceClassification);
  const v2Diff = asRecord(noRepair.v2TargetVsNoRepairDiff);
  const v2DiffSummary = asRecord(v2Diff?.summary);
  const replacementReadinessImpact = asRecord(
    v2Diff?.replacementReadinessImpact,
  );
  const strategyPromotionDiff = asRecord(
    asRecord(noRepair.v2MesocycleStrategyDiagnostic)
      ?.strategyHypothesisPromotionDiff,
  );
  const strategyProjectionDiff = asRecord(strategyPromotionDiff?.projectionDiff);
  const projectionCandidateStrategy = asRecord(
    strategyProjectionDiff?.candidateStrategy,
  );
  const projectionRedistributionPreference = asRecord(
    projectionCandidateStrategy?.redistributionPreference,
  );
  const exerciseSelection = asRecord(noRepair.v2ExerciseSelectionPlanDiagnostic);
  const deloadProjection = asRecord(noRepair.v2DeloadProjectionDiagnostic);

  return {
    summary: {
      ...(asRecord(noRepair.summary) ?? {}),
      basicMesocycleShapeStatus:
        acceptanceClassification?.basicMesocycleShapeStatus,
      replacementReadinessStatus:
        acceptanceClassification?.replacementReadinessStatus,
      nextBestMigrationSlice:
        replacementReadinessImpact?.nextBestMigrationSlice ?? null,
    },
    replacementReadiness: {
      canReplaceRepairedProjection:
        noRepair.canReplaceRepairedProjection === true,
      blockers: Array.isArray(replacementReadinessImpact?.blockers)
        ? replacementReadinessImpact.blockers
        : [],
    },
    acceptanceClassification: {
      basicMesocycleShapeStatus:
        acceptanceClassification?.basicMesocycleShapeStatus,
      replacementReadinessStatus:
        acceptanceClassification?.replacementReadinessStatus,
      migrationScoreboard:
        asRecord(acceptanceClassification?.migrationScoreboard) ?? {},
    },
    crossWeekProjectionGate: compactCrossWeekProjectionGate(
      noRepair.crossWeekProjectionGate,
    ),
    v2ExerciseSelectionPlanDiagnostic: {
      status: exerciseSelection?.status ?? "not_available",
    },
    v2DeloadProjectionDiagnostic: {
      status: deloadProjection?.status ?? "not_available",
    },
    v2TargetVsNoRepairDiff: {
      summary: v2DiffSummary ?? {},
      replacementReadinessImpact: replacementReadinessImpact ?? {},
    },
    strategyHypothesisPromotionDiff: strategyPromotionDiff
      ? {
          status: strategyPromotionDiff.status ?? "not_available",
          evaluatedHypothesisCount: countArray(
            strategyPromotionDiff.evaluatedHypotheses,
          ),
          nextSafeAction:
            strategyPromotionDiff.nextSafeAction ?? "do_not_promote",
          consumedByDemandOrMaterializer:
            strategyPromotionDiff.consumedByDemandOrMaterializer === true
              ? true
              : false,
          projectionDiff: strategyProjectionDiff
            ? {
                status: strategyProjectionDiff.status ?? "not_available",
                projectionMode:
                  strategyProjectionDiff.projectionMode ?? "not_projected",
                candidateProtectedMuscleCount: countArray(
                  projectionRedistributionPreference?.candidateProtectedMuscles,
                ),
                candidateDonorMuscleCount: countArray(
                  projectionRedistributionPreference?.candidateDonorMuscles,
                ),
                computedGateCounts: countProjectionGateStatuses(
                  strategyProjectionDiff.computedNonRegressionGates,
                ),
                readiness: strategyProjectionDiff.readiness ?? "not_ready",
                consumedByDemandOrMaterializer:
                  strategyProjectionDiff.consumedByDemandOrMaterializer === true
                    ? true
                    : false,
              }
            : undefined,
        }
      : undefined,
    v2Summary: {
      targetVsNoRepairSummary: v2DiffSummary ?? {},
      laneCounts: {
        target: v2DiffSummary?.targetLaneCount ?? null,
        satisfied: v2DiffSummary?.satisfiedLaneCount ?? null,
        partial: v2DiffSummary?.partialLaneCount ?? null,
        missing: v2DiffSummary?.missingLaneCount ?? null,
        blocked: v2DiffSummary?.blockedLaneCount ?? null,
        repairDependent: v2DiffSummary?.repairDependentLaneCount ?? null,
        migrationCandidates: v2DiffSummary?.migrationCandidateCount ?? null,
        suspiciousOrBlocked: v2DiffSummary?.suspiciousOrBlockedCount ?? null,
      },
      migrationScoreboard:
        asRecord(acceptanceClassification?.migrationScoreboard) ?? {},
    },
  };
}

function buildIndexSummary(input: {
  noRepair: JsonRecord;
  shardMetadata: V2DebugShardMetadata[];
}): JsonRecord {
  const acceptanceClassification = asRecord(input.noRepair.acceptanceClassification);
  const v2DiffSummary = asRecord(
    asRecord(input.noRepair.v2TargetVsNoRepairDiff)?.summary,
  );
  return {
    status: asRecord(input.noRepair.summary)?.status ?? "unknown",
    basicMesocycleShapeStatus:
      acceptanceClassification?.basicMesocycleShapeStatus ?? "unknown",
    replacementReadinessStatus:
      acceptanceClassification?.replacementReadinessStatus ?? "unknown",
    canReplaceRepairedProjection:
      input.noRepair.canReplaceRepairedProjection === true,
    targetLaneCount: v2DiffSummary?.targetLaneCount ?? null,
    migrationCandidateCount: v2DiffSummary?.migrationCandidateCount ?? null,
    writtenShardCount: input.shardMetadata.filter(
      (shard) => shard.status === "written",
    ).length,
    skippedShardCount: input.shardMetadata.filter(
      (shard) => shard.status === "skipped",
    ).length,
    notAvailableShardCount: input.shardMetadata.filter(
      (shard) => shard.status === "not_available",
    ).length,
  };
}

export function buildV2DebugArtifacts(input: {
  artifact: WorkoutAuditArtifact;
  request: WorkoutAuditRequest;
  parentFileName: string;
  parentRelativePath: string;
  indexFileName: string;
  indexRelativePath: string;
  detailLevel?: V2DebugDetailLevel;
}): BuiltV2DebugArtifactOutput | undefined {
  const mesocycleExplain = input.artifact.mesocycleExplain;
  const noRepair = asRecord(mesocycleExplain?.plannerOnlyNoRepair);
  if (!mesocycleExplain || !noRepair) {
    return undefined;
  }

  const detailLevel = input.detailLevel ?? "compact";
  const shardResults = V2_DEBUG_SHARD_IDS.map((shardId) =>
    buildShardOutput({
      shardId,
      artifact: input.artifact,
      noRepair,
      request: input.request,
      parentFileName: input.parentFileName,
      parentRelativePath: input.parentRelativePath,
      indexFileName: input.indexFileName,
      indexRelativePath: input.indexRelativePath,
      detailLevel,
    }),
  );
  const shardMetadata = shardResults.map((result) =>
    isShardOutput(result) ? result.metadata : result,
  );
  const shards = shardResults.filter(isShardOutput);
  const indexArtifact: MesocycleExplainPlannerOnlyNoRepairDebugIndex = {
    version: 1,
    kind: "v2_debug_index",
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
    detailLevel,
    budgets: {
      mainArtifactBudgetBytes: WORKOUT_AUDIT_MAIN_ARTIFACT_BUDGET_BYTES,
      v2IndexBudgetBytes: V2_DEBUG_INDEX_BUDGET_BYTES,
      defaultShardBudgetBytes: V2_DEBUG_DEFAULT_SHARD_BUDGET_BYTES,
      fullDetailShardBudgetBytes: V2_DEBUG_FULL_DETAIL_SHARD_BUDGET_BYTES,
      perArtifactLimitBytes: WORKOUT_AUDIT_SIZE_LIMIT_BYTES,
    },
    summary: buildIndexSummary({ noRepair, shardMetadata }),
    plannerOnlyNoRepair: buildIndexNoRepair(noRepair),
    shards: shardMetadata,
  };
  const serialized = serializeStableJson(indexArtifact);
  const sizeBytes = getSerializedArtifactSizeBytes(serialized);

  return {
    artifact: indexArtifact,
    serialized,
    sizeBytes,
    sha256: sha256Hex(serialized),
    fileName: input.indexFileName,
    relativePath: input.indexRelativePath,
    shards,
  };
}
