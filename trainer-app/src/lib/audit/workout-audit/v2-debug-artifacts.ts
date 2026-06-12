import { createHash } from "node:crypto";
import {
  V2_DEBUG_DEFAULT_SHARD_BUDGET_BYTES,
  V2_DEBUG_FULL_DETAIL_SHARD_BUDGET_BYTES,
  V2_DEBUG_INDEX_BUDGET_BYTES,
  WORKOUT_AUDIT_MAIN_ARTIFACT_BUDGET_BYTES,
  WORKOUT_AUDIT_SIZE_LIMIT_BYTES,
} from "./constants";
import {
  compactPlanningRealityDetail,
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
  "planning-reality",
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
  "planning-reality": "v2-planning-reality",
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

function countConflictTypes(conflicts: unknown): JsonRecord {
  return asRecordArray(conflicts).reduce<JsonRecord>((counts, conflict) => {
    const type =
      typeof conflict.type === "string" && conflict.type.length > 0
        ? conflict.type
        : "unknown";
    counts[type] = ((counts[type] as number) ?? 0) + 1;
    return counts;
  }, {});
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

function compactSelectionCapacityLaneInspection(value: unknown): JsonRecord {
  const diagnostic = asRecord(value);
  if (!diagnostic) {
    return { status: "not_available", rows: [] };
  }
  const rows = asRecordArray(diagnostic.weeks).flatMap((week) =>
    asRecordArray(week.slots).flatMap((slot) =>
      asRecordArray(slot.lanes).map((lane) => ({
        week: week.week,
        slotId: slot.slotId,
        laneId: lane.laneId,
        classification: lane.classification,
        inspectionCategory: lane.inspectionCategory ?? "unknown",
        weeklyTargetStatus: lane.weeklyTargetStatus,
        optionalEligibility: lane.optionalEligibility,
        selectedExercise: lane.selectedExercise,
        selectedSets: lane.selectedSets,
        slotHeadroom: lane.slotHeadroom,
        setHeadroom: lane.setHeadroom,
        cleanAlternativeCount: lane.cleanAlternativeCount,
        exerciseCount: slot.exerciseCount,
        maxExerciseCount: slot.maxExerciseCount,
        setCount: slot.setCount,
        setBudget: lane.setBudget,
        perExerciseCap: lane.perExerciseCap,
        evidenceTop: asStringArray(lane.evidence).slice(0, 4),
        limitationTop: asStringArray(lane.limitations).slice(0, 4),
      })),
    ),
  );
  const nonTargetMetRows = rows.filter(
    (row) => row.classification !== "target_met_no_action",
  );
  const rowLimit = 80;
  return {
    status: diagnostic.status ?? "not_available",
    readOnly: diagnostic.readOnly === true,
    affectsScoringOrGeneration:
      diagnostic.affectsScoringOrGeneration === true ? true : false,
    laneInspectionCategoryCounts:
      asRecord(asRecord(diagnostic.summary)?.laneInspectionCategoryCounts) ?? {},
    nonTargetMetRowCount: nonTargetMetRows.length,
    rows: nonTargetMetRows.slice(0, rowLimit),
    omittedRowCount: Math.max(0, nonTargetMetRows.length - rowLimit),
  };
}

function compactCapacityPolicyTrialDesign(value: unknown): JsonRecord {
  const diagnostic = asRecord(value);
  const design = asRecord(diagnostic?.capacityPolicyTrialDesign);
  if (!design) {
    return { status: "not_available" };
  }
  const candidateChange = asRecord(design.candidateChange);
  const gates = asRecordArray(design.gates);
  return {
    status: design.status ?? "not_available",
    readOnly: design.readOnly === true,
    affectsScoringOrGeneration:
      design.affectsScoringOrGeneration === true ? true : false,
    consumedByDemandOrMaterializer:
      design.consumedByDemandOrMaterializer === true ? true : false,
    safeForBehaviorPromotion:
      design.safeForBehaviorPromotion === true ? true : false,
    trialId: design.trialId ?? null,
    scope: design.scope ?? "read_only_projection_only",
    candidateChange: candidateChange
      ? {
          kind: candidateChange.kind,
          slotId: candidateChange.slotId,
          delta: candidateChange.delta,
        }
      : null,
    targetSlots: asStringArray(design.targetSlots),
    basis: asRecord(design.basis) ?? {},
    gateStatusCounts: countBy(gates, "status"),
    gates: gates.map((gate) => ({
      gateId: gate.gateId,
      status: gate.status,
      ownerSeam: gate.ownerSeam,
      requiredEvidenceCount: countArray(gate.requiredEvidence),
      currentEvidenceTop: asStringArray(gate.currentEvidence).slice(0, 3),
    })),
    blockersBeforeBehavior: asStringArray(design.blockersBeforeBehavior),
    nextSafeAction: design.nextSafeAction ?? "inspect_capacity_rows",
    limitationCount: countArray(design.limitations),
  };
}

function compactCapacityBehaviorProjection(value: unknown): JsonRecord {
  const diagnostic = asRecord(value);
  const projection = asRecord(diagnostic?.capacityBehaviorProjection);
  if (!projection) {
    return { status: "not_available" };
  }
  const gates = asRecordArray(projection.gates);
  const candidateImpact = asRecord(projection.candidateImpact);
  return {
    status: projection.status ?? "not_available",
    readOnly: projection.readOnly === true,
    affectsScoringOrGeneration:
      projection.affectsScoringOrGeneration === true ? true : false,
    consumedByDemandOrMaterializer:
      projection.consumedByDemandOrMaterializer === true ? true : false,
    safeForBehaviorPromotion:
      projection.safeForBehaviorPromotion === true ? true : false,
    projectionMode: projection.projectionMode,
    trialId: projection.trialId ?? null,
    candidateImpact: candidateImpact
      ? {
          selectedIdentityDelta: candidateImpact.selectedIdentityDelta,
          weeklyVolumeDelta: candidateImpact.weeklyVolumeDelta,
          capacityPressureRowsBefore:
            candidateImpact.capacityPressureRowsBefore,
          capacityPressureRowsAfter: candidateImpact.capacityPressureRowsAfter,
          capacityPressureRowsRelieved:
            candidateImpact.capacityPressureRowsRelieved,
          floorCriticalRowsAfter: candidateImpact.floorCriticalRowsAfter,
          optionalStretchRowsActivated:
            candidateImpact.optionalStretchRowsActivated,
          regressionCount: candidateImpact.regressionCount,
          improvements: asStringArray(candidateImpact.improvements).slice(0, 6),
          regressions: asStringArray(candidateImpact.regressions).slice(0, 6),
        }
      : {},
    projectedSlots: asRecordArray(projection.projectedSlots).map((slot) => ({
      week: slot.week,
      slotId: slot.slotId,
      exerciseCount: slot.exerciseCount,
      maxExerciseCountBefore: slot.maxExerciseCountBefore,
      maxExerciseCountAfter: slot.maxExerciseCountAfter,
      slotHeadroomBefore: slot.slotHeadroomBefore,
      slotHeadroomAfter: slot.slotHeadroomAfter,
      setCount: slot.setCount,
      targetSessionMaxSets: slot.targetSessionMaxSets,
      capacityPressureRowsBefore: slot.capacityPressureRowsBefore,
      capacityPressureRowsAfter: slot.capacityPressureRowsAfter,
      floorCriticalRowsAfter: slot.floorCriticalRowsAfter,
      sessionSizeStatus: slot.sessionSizeStatus,
    })),
    gateStatusCounts: countBy(gates, "status"),
    gates: gates.map((gate) => ({
      gateId: gate.gateId,
      status: gate.status,
      measured: gate.measured === true,
      ownerSeam: gate.ownerSeam,
      evidenceTop: asStringArray(gate.evidence).slice(0, 3),
      regressionCount: countArray(gate.regressions),
      requiredNextEvidenceCount: countArray(gate.requiredNextEvidence),
    })),
    blockersBeforeBehavior: asStringArray(projection.blockersBeforeBehavior),
    nextSafeAction:
      projection.nextSafeAction ?? "run_read_only_materializer_capacity_projection",
    limitationCount: countArray(projection.limitations),
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
  const basePlanCompare = asRecord(noRepair.v2BasePlanCompare);
  const shadowConsumption = asRecord(noRepair.v2BasePlanShadowConsumptionTrial);
  const capacityMaterializer = asRecord(
    noRepair.v2CapacityMaterializerProjection,
  );
  const laneIntentMaterializer = asRecord(
    noRepair.v2LaneIntentMaterializerProjection,
  );
  const setBudgetMaterializer = asRecord(
    noRepair.v2SetBudgetMaterializerProjection,
  );
  const supportFloorMaterializer = asRecord(
    noRepair.v2SupportFloorMaterializerProjection,
  );
  const concentrationMaterializer = asRecord(
    noRepair.v2ConcentrationMaterializerProjection,
  );
  const planQualityBenchmark = asRecord(noRepair.v2PlanQualityBenchmark);
  if (
    !v2Plan &&
    !setDistribution &&
    !supportPolicy &&
    !basePlanCompare &&
    !shadowConsumption &&
    !capacityMaterializer &&
    !laneIntentMaterializer &&
    !setBudgetMaterializer &&
    !supportFloorMaterializer &&
    !concentrationMaterializer &&
    !planQualityBenchmark
  ) {
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
    ...(basePlanCompare ? { v2BasePlanCompare: basePlanCompare } : {}),
    ...(shadowConsumption
      ? { v2BasePlanShadowConsumptionTrial: shadowConsumption }
      : {}),
    ...(capacityMaterializer
      ? { v2CapacityMaterializerProjection: capacityMaterializer }
      : {}),
    ...(laneIntentMaterializer
      ? { v2LaneIntentMaterializerProjection: laneIntentMaterializer }
      : {}),
    ...(setBudgetMaterializer
      ? { v2SetBudgetMaterializerProjection: setBudgetMaterializer }
      : {}),
    ...(supportFloorMaterializer
      ? { v2SupportFloorMaterializerProjection: supportFloorMaterializer }
      : {}),
    ...(concentrationMaterializer
      ? { v2ConcentrationMaterializerProjection: concentrationMaterializer }
      : {}),
    ...(planQualityBenchmark
      ? { v2PlanQualityBenchmark: planQualityBenchmark }
      : {}),
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
  const laneIntent = asRecord(noRepair.v2LaneSelectionIntentAudit);
  const laneIntentRows = asRecordArray(laneIntent?.lanes);
  return {
    v2ExerciseSelectionPlanDiagnostic: compactDiagnosticStatus(
      noRepair.v2ExerciseSelectionPlanDiagnostic,
    ),
    v2LaneSelectionIntentAudit: laneIntent
      ? {
          source: laneIntent.source ?? "v2_lane_selection_intent_audit",
          readOnly: laneIntent.readOnly === true,
          affectsScoringOrGeneration:
            laneIntent.affectsScoringOrGeneration === true ? true : false,
          consumedByDemandOrMaterializer:
            laneIntent.consumedByDemandOrMaterializer === true ? true : false,
          summary: asRecord(laneIntent.summary) ?? {},
          missingRequiredV0FieldCount: laneIntentRows.reduce(
            (sum, row) => sum + countArray(row.missingRequiredV0Fields),
            0,
          ),
          materializerInferenceRequiredCount: laneIntentRows.filter(
            (row) => row.materializerInferenceRequired === true,
          ).length,
        }
      : { source: "v2_lane_selection_intent_audit", status: "not_available" },
    v2SelectionCapacityPlanDiagnostic: compactDiagnosticStatus(
      noRepair.v2SelectionCapacityPlanDiagnostic,
    ),
    v2SelectionCapacityLaneInspection: compactSelectionCapacityLaneInspection(
      noRepair.v2SelectionCapacityPlanDiagnostic,
    ),
    v2CapacityPolicyTrialDesign: compactCapacityPolicyTrialDesign(
      noRepair.v2SelectionCapacityPlanDiagnostic,
    ),
    v2CapacityBehaviorProjection: compactCapacityBehaviorProjection(
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

function getPlanningRealityData(artifact: WorkoutAuditArtifact): JsonRecord | null {
  const planningReality =
    artifact.mesocycleExplain?.preview.projectionDiagnostics.planningReality;
  if (!planningReality) {
    return null;
  }
  const compactPlanningReality = compactPlanningRealityDetail(planningReality);
  return isRecord(compactPlanningReality)
    ? { planningReality: compactPlanningReality }
    : null;
}

function buildFullShardData(
  shardId: V2DebugShardId,
  noRepair: JsonRecord,
  artifact: WorkoutAuditArtifact,
): JsonRecord | null {
  switch (shardId) {
    case "planning-reality":
      return getPlanningRealityData(artifact);
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
        v2LaneSelectionIntentAudit: noRepair.v2LaneSelectionIntentAudit,
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
  artifact: WorkoutAuditArtifact,
): JsonRecord | null {
  switch (shardId) {
    case "planning-reality":
      return getPlanningRealityData(artifact);
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
      ? buildFullShardData(input.shardId, input.noRepair, input.artifact)
      : buildCompactShardData(input.shardId, input.noRepair, input.artifact);
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
    input.shardId === "planning-reality"
      ? WORKOUT_AUDIT_MAIN_ARTIFACT_BUDGET_BYTES
      : input.detailLevel === "full"
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
  const donorSurplusEvidence = asRecord(
    strategyPromotionDiff?.donorSurplusEvidence,
  );
  const donorSurplusSummary = asRecord(donorSurplusEvidence?.summary);
  const conflictAwareRefinement = asRecord(
    strategyProjectionDiff?.conflictAwareRefinement,
  );
  const preShadowCandidateFilter = asRecord(
    strategyProjectionDiff?.preShadowCandidateFilter,
  );
  const preShadowOverride = asRecord(
    preShadowCandidateFilter?.overrideConstruction,
  );
  const slotOwnedPlan = asRecord(
    strategyPromotionDiff?.slotOwnedDemandAdjustmentPlan,
  );
  const slotOwnedFeasibility = asRecord(slotOwnedPlan?.feasibility);
  const slotOwnedBudgetPolicy = asRecord(slotOwnedPlan?.slotBudgetPolicy);
  const projectionCandidateStrategy = asRecord(
    strategyProjectionDiff?.candidateStrategy,
  );
  const projectionRedistributionPreference = asRecord(
    projectionCandidateStrategy?.redistributionPreference,
  );
  const exerciseSelection = asRecord(noRepair.v2ExerciseSelectionPlanDiagnostic);
  const laneSelectionIntent = asRecord(noRepair.v2LaneSelectionIntentAudit);
  const deloadProjection = asRecord(noRepair.v2DeloadProjectionDiagnostic);
  const basePlanCompare = asRecord(noRepair.v2BasePlanCompare);
  const basePlanCompareSummary = asRecord(basePlanCompare?.summary);
  const shadowConsumption = asRecord(noRepair.v2BasePlanShadowConsumptionTrial);
  const shadowSummary = asRecord(shadowConsumption?.summary);
  const capacityMaterializer = asRecord(
    noRepair.v2CapacityMaterializerProjection,
  );
  const capacityMaterializerImpact = asRecord(
    capacityMaterializer?.candidateImpact,
  );
  const laneIntentMaterializer = asRecord(
    noRepair.v2LaneIntentMaterializerProjection,
  );
  const laneIntentMaterializerImpact = asRecord(
    laneIntentMaterializer?.candidateImpact,
  );
  const setBudgetMaterializer = asRecord(
    noRepair.v2SetBudgetMaterializerProjection,
  );
  const setBudgetMaterializerImpact = asRecord(
    setBudgetMaterializer?.candidateImpact,
  );
  const supportFloorMaterializer = asRecord(
    noRepair.v2SupportFloorMaterializerProjection,
  );
  const supportFloorMaterializerImpact = asRecord(
    supportFloorMaterializer?.candidateImpact,
  );
  const concentrationMaterializer = asRecord(
    noRepair.v2ConcentrationMaterializerProjection,
  );
  const concentrationMaterializerImpact = asRecord(
    concentrationMaterializer?.candidateImpact,
  );
  const concentrationDelta = asRecord(
    concentrationMaterializer?.concentrationDelta,
  );
  const concentrationReadiness = asRecord(
    concentrationMaterializer?.crossWeekReadiness,
  );
  const concentrationDonorOffset = asRecord(
    concentrationMaterializer?.donorOffsetRedistributionProjection,
  );
  const concentrationDonorOffsetSummary = asRecord(
    concentrationDonorOffset?.summary,
  );
  const concentrationSlotWeekAllocation = asRecord(
    concentrationDonorOffset?.slotWeekAllocationProjection,
  );

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
    v2LaneSelectionIntentAudit: {
      source:
        laneSelectionIntent?.source ?? "v2_lane_selection_intent_audit",
      totalLanes: asRecord(laneSelectionIntent?.summary)?.totalLanes ?? null,
      materializerInferenceRequired: true,
      consumedByDemandOrMaterializer:
        laneSelectionIntent?.consumedByDemandOrMaterializer === true
          ? true
          : false,
    },
    v2DeloadProjectionDiagnostic: {
      status: deloadProjection?.status ?? "not_available",
    },
    v2BasePlanCompare: basePlanCompare
      ? {
          status: basePlanCompare.status ?? "not_available",
          readOnly: basePlanCompare.readOnly === true,
          affectsScoringOrGeneration:
            basePlanCompare.affectsScoringOrGeneration === true ? true : false,
          comparedPlans: asRecord(basePlanCompare.comparedPlans) ?? {},
          summary: basePlanCompareSummary ?? {},
          nextSafeAction:
            typeof basePlanCompare.nextSafeAction === "string"
              ? basePlanCompare.nextSafeAction
            : "inspect_compare",
      }
      : undefined,
    v2BasePlanShadowConsumptionTrial: shadowConsumption
      ? {
          status: shadowConsumption.status ?? "not_available",
          readOnly: shadowConsumption.readOnly === true,
          affectsScoringOrGeneration:
            shadowConsumption.affectsScoringOrGeneration === true ? true : false,
          consumedByProduction:
            shadowConsumption.consumedByProduction === true ? true : false,
          comparedPlans: asRecord(shadowConsumption.comparedPlans) ?? {},
          summary: shadowSummary ?? {},
          nextSafeAction:
            typeof shadowConsumption.nextSafeAction === "string"
              ? shadowConsumption.nextSafeAction
              : "inspect_shadow_consumption",
        }
      : undefined,
    v2CapacityMaterializerProjection: capacityMaterializer
      ? {
          status: capacityMaterializer.status ?? "not_available",
          readOnly: capacityMaterializer.readOnly === true,
          affectsScoringOrGeneration:
            capacityMaterializer.affectsScoringOrGeneration === true
              ? true
              : false,
          consumedByProduction:
            capacityMaterializer.consumedByProduction === true ? true : false,
          projectionMode:
            capacityMaterializer.projectionMode ??
            "slot_cap_delta_materializer_dry_run",
          trialId: capacityMaterializer.trialId ?? null,
          candidateImpact: capacityMaterializerImpact
            ? {
                selectedIdentityDelta:
                  capacityMaterializerImpact.selectedIdentityDelta,
                totalSetDelta: capacityMaterializerImpact.totalSetDelta,
                targetSlotExerciseDelta:
                  capacityMaterializerImpact.targetSlotExerciseDelta,
                materializerBlockerDelta:
                  capacityMaterializerImpact.materializerBlockerDelta,
                regressionCount: capacityMaterializerImpact.regressionCount,
              }
            : {},
          gateStatusCounts: countBy(
            asRecordArray(capacityMaterializer.gates),
            "status",
          ),
          nextSafeAction:
            typeof capacityMaterializer.nextSafeAction === "string"
              ? capacityMaterializer.nextSafeAction
              : "inspect_materializer_capacity_projection",
        }
      : undefined,
    v2LaneIntentMaterializerProjection: laneIntentMaterializer
      ? {
          status: laneIntentMaterializer.status ?? "not_available",
          readOnly: laneIntentMaterializer.readOnly === true,
          affectsScoringOrGeneration:
            laneIntentMaterializer.affectsScoringOrGeneration === true
              ? true
              : false,
          consumedByProduction:
            laneIntentMaterializer.consumedByProduction === true ? true : false,
          consumedByDemandOrMaterializer:
            laneIntentMaterializer.consumedByDemandOrMaterializer === true
              ? true
              : false,
          projectionMode:
            laneIntentMaterializer.projectionMode ??
            "lane_intent_shadow_materializer_dry_run",
          trialId: laneIntentMaterializer.trialId ?? null,
          targetLane: pickRecordFields(laneIntentMaterializer.targetLane, [
            "scopedLaneId",
            "slotId",
            "laneId",
            "intentAvailable",
            "baselineConsumedByProduction",
            "trialConsumesLaneIntent",
          ]),
          candidateImpact: laneIntentMaterializerImpact
            ? {
                selectedIdentityDelta:
                  laneIntentMaterializerImpact.selectedIdentityDelta,
                totalSetDelta: laneIntentMaterializerImpact.totalSetDelta,
                targetLaneExerciseDelta:
                  laneIntentMaterializerImpact.targetLaneExerciseDelta,
                materializerBlockerDelta:
                  laneIntentMaterializerImpact.materializerBlockerDelta,
                regressionCount: laneIntentMaterializerImpact.regressionCount,
              }
            : {},
          nextSafeAction:
            typeof laneIntentMaterializer.nextSafeAction === "string"
              ? laneIntentMaterializer.nextSafeAction
              : "inspect_lane_intent_materializer_projection",
        }
      : undefined,
    v2SetBudgetMaterializerProjection: setBudgetMaterializer
      ? {
          status: setBudgetMaterializer.status ?? "not_available",
          readOnly: setBudgetMaterializer.readOnly === true,
          affectsScoringOrGeneration:
            setBudgetMaterializer.affectsScoringOrGeneration === true
              ? true
              : false,
          consumedByProduction:
            setBudgetMaterializer.consumedByProduction === true ? true : false,
          consumedByDemandOrMaterializer:
            setBudgetMaterializer.consumedByDemandOrMaterializer === true
              ? true
              : false,
          projectionMode:
            setBudgetMaterializer.projectionMode ??
            "set_budget_shadow_materializer_dry_run",
          trialId: setBudgetMaterializer.trialId ?? null,
          targetLane: pickRecordFields(setBudgetMaterializer.targetLane, [
            "scopedLaneId",
            "week",
            "slotId",
            "laneId",
            "currentBudget",
            "trialBudget",
            "suspectedNeededBudget",
          ]),
          candidateImpact: setBudgetMaterializerImpact
            ? {
                selectedIdentityDelta:
                  setBudgetMaterializerImpact.selectedIdentityDelta,
                totalSetDelta: setBudgetMaterializerImpact.totalSetDelta,
                targetLaneSetDelta:
                  setBudgetMaterializerImpact.targetLaneSetDelta,
                targetLaneExerciseDelta:
                  setBudgetMaterializerImpact.targetLaneExerciseDelta,
                materializerBlockerDelta:
                  setBudgetMaterializerImpact.materializerBlockerDelta,
                regressionCount: setBudgetMaterializerImpact.regressionCount,
              }
            : {},
          nextSafeAction:
            typeof setBudgetMaterializer.nextSafeAction === "string"
              ? setBudgetMaterializer.nextSafeAction
              : "inspect_set_budget_materializer_projection",
        }
      : undefined,
    v2SupportFloorMaterializerProjection: supportFloorMaterializer
      ? {
          status: supportFloorMaterializer.status ?? "not_available",
          readOnly: supportFloorMaterializer.readOnly === true,
          affectsScoringOrGeneration:
            supportFloorMaterializer.affectsScoringOrGeneration === true
              ? true
              : false,
          consumedByProduction:
            supportFloorMaterializer.consumedByProduction === true
              ? true
              : false,
          consumedByDemandOrMaterializer:
            supportFloorMaterializer.consumedByDemandOrMaterializer === true
              ? true
              : false,
          projectionMode:
            supportFloorMaterializer.projectionMode ??
            "support_direct_floor_shadow_materializer_dry_run",
          trialId: supportFloorMaterializer.trialId ?? null,
          targetLane: pickRecordFields(
            supportFloorMaterializer.targetLane,
            [
              "scopedLaneId",
              "week",
              "slotId",
              "laneId",
              "supportFloorGapId",
              "muscle",
              "directFloorExpected",
              "directFloorDelivered",
              "currentBudget",
              "trialBudget",
              "suspectedNeededBudget",
              "likelyOwnerSeam",
            ],
          ),
          candidateImpact: supportFloorMaterializerImpact
            ? {
                selectedIdentityDelta:
                  supportFloorMaterializerImpact.selectedIdentityDelta,
                totalSetDelta: supportFloorMaterializerImpact.totalSetDelta,
                targetLaneSetDelta:
                  supportFloorMaterializerImpact.targetLaneSetDelta,
                targetLaneExerciseDelta:
                  supportFloorMaterializerImpact.targetLaneExerciseDelta,
                materializerBlockerDelta:
                  supportFloorMaterializerImpact.materializerBlockerDelta,
                regressionCount:
                  supportFloorMaterializerImpact.regressionCount,
              }
            : {},
          nextSafeAction:
            typeof supportFloorMaterializer.nextSafeAction === "string"
              ? supportFloorMaterializer.nextSafeAction
              : "inspect_support_floor_materializer_projection",
        }
      : undefined,
    v2ConcentrationMaterializerProjection: concentrationMaterializer
      ? {
          status: concentrationMaterializer.status ?? "not_available",
          readOnly: concentrationMaterializer.readOnly === true,
          affectsScoringOrGeneration:
            concentrationMaterializer.affectsScoringOrGeneration === true
              ? true
              : false,
          consumedByProduction:
            concentrationMaterializer.consumedByProduction === true
              ? true
              : false,
          consumedByDemandOrMaterializer:
            concentrationMaterializer.consumedByDemandOrMaterializer === true
              ? true
              : false,
          projectionMode:
            concentrationMaterializer.projectionMode ??
            "concentration_set_cap_shadow_materializer_dry_run",
          trialId: concentrationMaterializer.trialId ?? null,
          targetLane: pickRecordFields(concentrationMaterializer.targetLane, [
            "scopedLaneId",
            "week",
            "slotId",
            "laneId",
            "muscles",
            "currentBudget",
            "trialBudget",
          ]),
          candidateImpact: concentrationMaterializerImpact
            ? {
                selectedIdentityDelta:
                  concentrationMaterializerImpact.selectedIdentityDelta,
                totalSetDelta: concentrationMaterializerImpact.totalSetDelta,
                targetLaneSetDelta:
                  concentrationMaterializerImpact.targetLaneSetDelta,
                targetLaneExerciseDelta:
                  concentrationMaterializerImpact.targetLaneExerciseDelta,
                materializerBlockerDelta:
                  concentrationMaterializerImpact.materializerBlockerDelta,
                regressionCount:
                  concentrationMaterializerImpact.regressionCount,
              }
            : {},
          concentrationDelta: concentrationDelta
            ? {
                warningDelta: concentrationDelta.warningDelta,
                over60Delta: concentrationDelta.over60Delta,
                maxShareDelta: concentrationDelta.maxShareDelta,
                highFatigueSetDelta: concentrationDelta.highFatigueSetDelta,
                fatigueWeightedSetDelta:
                  concentrationDelta.fatigueWeightedSetDelta,
              }
            : {},
          crossWeekReadiness: concentrationReadiness
            ? {
                decision: concentrationReadiness.decision,
                projectedWeekCount: concentrationReadiness.projectedWeekCount,
                improvedWeekCount: concentrationReadiness.improvedWeekCount,
                regressedWeekCount: concentrationReadiness.regressedWeekCount,
                noImpactWeekCount: concentrationReadiness.noImpactWeekCount,
                blockerCount: concentrationReadiness.blockerCount,
                nextSafeSlice: concentrationReadiness.nextSafeSlice,
              }
            : {},
          donorOffsetRedistributionProjection: concentrationDonorOffset
            ? {
                status: concentrationDonorOffset.status ?? "not_available",
                readOnly: concentrationDonorOffset.readOnly === true,
                affectsScoringOrGeneration:
                  concentrationDonorOffset.affectsScoringOrGeneration === true
                    ? true
                    : false,
                consumedByProduction:
                  concentrationDonorOffset.consumedByProduction === true
                    ? true
                    : false,
                consumedByDemandOrMaterializer:
                  concentrationDonorOffset.consumedByDemandOrMaterializer === true
                    ? true
                    : false,
                summary: concentrationDonorOffsetSummary ?? {},
                slotWeekAllocationProjection: concentrationSlotWeekAllocation
                  ? {
                      status:
                        concentrationSlotWeekAllocation.status ??
                        "not_available",
                      readOnly:
                        concentrationSlotWeekAllocation.readOnly === true,
                      affectsScoringOrGeneration:
                        concentrationSlotWeekAllocation.affectsScoringOrGeneration ===
                        true
                          ? true
                          : false,
                      consumedByDemandOrMaterializer:
                        concentrationSlotWeekAllocation.consumedByDemandOrMaterializer ===
                        true
                          ? true
                          : false,
                      designDecision:
                        asRecord(concentrationSlotWeekAllocation.designDecision) ??
                        {},
                      summary:
                        asRecord(concentrationSlotWeekAllocation.summary) ?? {},
                      rows: asRecordArray(
                        concentrationSlotWeekAllocation.rows,
                      ).map((allocationRow) => ({
                        week: allocationRow.week,
                        muscle: allocationRow.muscle,
                        protectedWeeklyDemand:
                          asRecord(allocationRow.protectedWeeklyDemand) ?? {},
                        sourceLanePressure:
                          asRecord(allocationRow.sourceLanePressure) ?? {},
                        eligibleDonorSlots: asRecordArray(
                          allocationRow.eligibleDonorSlots,
                        ),
                        donorCapacity:
                          asRecord(allocationRow.donorCapacity) ?? {},
                        protectedCoverageImpact:
                          asRecord(allocationRow.protectedCoverageImpact) ?? {},
                        materializerNonRegressionStatus:
                          allocationRow.materializerNonRegressionStatus,
                        behaviorReadiness: allocationRow.behaviorReadiness,
                        blockingReasons: asStringArray(
                          allocationRow.blockingReasons,
                        ),
                        nextSafeSlice: allocationRow.nextSafeSlice,
                      })),
                    }
                  : {},
                rowCount: countArray(concentrationDonorOffset.rows),
                rows: asRecordArray(concentrationDonorOffset.rows).map((row) => ({
                  week: row.week,
                  phase: row.phase,
                  status: row.status,
                  source: asRecord(row.source) ?? {},
                  donor: asRecord(row.donor) ?? null,
                  allocationPolicyTrial: asRecord(row.allocationPolicyTrial) ?? null,
                  protectedCoverageImpact:
                    asRecord(row.protectedCoverageImpact) ?? {},
                  materializerDelta: asRecord(row.materializerDelta) ?? {},
                  concentrationWarningDelta: row.concentrationWarningDelta,
                  regressionCauses: asStringArray(row.regressionCauses),
                  selectedDonorKind: row.selectedDonorKind ?? "none",
                  primaryDonorCandidate:
                    asRecord(row.primaryDonorCandidate) ?? null,
                  alternateDonorCandidates: asRecordArray(
                    row.alternateDonorCandidates,
                  ),
                  behaviorReadinessDecision: row.behaviorReadinessDecision,
                  blockers: asStringArray(row.blockers),
                  nextSafeSlice: row.nextSafeSlice,
                })),
                blockersBeforeBehavior: asStringArray(
                  concentrationDonorOffset.blockersBeforeBehavior,
                ),
              }
            : {},
          nextSafeAction:
            typeof concentrationMaterializer.nextSafeAction === "string"
              ? concentrationMaterializer.nextSafeAction
              : "inspect_concentration_materializer_projection",
        }
      : undefined,
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
          donorSurplusEvidence: donorSurplusEvidence
            ? {
                status: donorSurplusEvidence.status ?? "not_available",
                readOnly: donorSurplusEvidence.readOnly === true,
                affectsScoringOrGeneration:
                  donorSurplusEvidence.affectsScoringOrGeneration === true
                    ? true
                    : false,
                candidateCount:
                  typeof donorSurplusSummary?.candidateCount === "number"
                    ? donorSurplusSummary.candidateCount
                    : countArray(donorSurplusEvidence.donorEvidence),
                measuredMarginCount:
                  typeof donorSurplusSummary?.measuredMarginCount === "number"
                    ? donorSurplusSummary.measuredMarginCount
                    : asRecordArray(donorSurplusEvidence.donorEvidence).filter(
                        (row) =>
                          asRecord(row.baselineCoverage)?.measured === true,
                      ).length,
                eligibleCount:
                  typeof donorSurplusSummary?.eligibleCount === "number"
                    ? donorSurplusSummary.eligibleCount
                    : asRecordArray(donorSurplusEvidence.donorEvidence).filter(
                        (row) => asRecord(row.eligibility)?.eligible === true,
                      ).length,
                ineligibleCount:
                  typeof donorSurplusSummary?.ineligibleCount === "number"
                    ? donorSurplusSummary.ineligibleCount
                    : asRecordArray(donorSurplusEvidence.donorEvidence).filter(
                        (row) =>
                          asRecord(row.eligibility)?.eligible !== true,
                      ).length,
                unknownMarginCount:
                  typeof donorSurplusSummary?.unknownMarginCount === "number"
                    ? donorSurplusSummary.unknownMarginCount
                    : 0,
                protectedOverlapCount:
                  typeof donorSurplusSummary?.protectedOverlapCount === "number"
                    ? donorSurplusSummary.protectedOverlapCount
                    : 0,
                slotIncompatibleCount:
                  typeof donorSurplusSummary?.slotIncompatibleCount === "number"
                    ? donorSurplusSummary.slotIncompatibleCount
                    : 0,
                topReasons: Array.isArray(donorSurplusSummary?.topReasons)
                  ? donorSurplusSummary.topReasons
                  : [],
                consumedByDemandOrMaterializer:
                  donorSurplusEvidence.consumedByDemandOrMaterializer === true
                    ? true
                    : false,
              }
            : undefined,
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
                ...(preShadowCandidateFilter
                  ? {
                      preShadowCandidateFilter: {
                        status:
                          preShadowCandidateFilter.status ?? "not_available",
                        eligibleDonorCount: asRecordArray(
                          preShadowCandidateFilter.donorEligibility,
                        ).filter((row) => row.eligible === true).length,
                        excludedDonorCount: countArray(
                          preShadowOverride?.excludedDonors,
                        ),
                        retainedDonorCount: countArray(
                          preShadowOverride?.retainedDonors,
                        ),
                        excludedProtectedMuscleCount: countArray(
                          preShadowOverride?.excludedProtectedMuscles,
                        ),
                        retainedProtectedMuscleCount: countArray(
                          preShadowOverride?.retainedProtectedMuscles,
                        ),
                        consumedByDemandOrMaterializer:
                          preShadowCandidateFilter.consumedByDemandOrMaterializer ===
                          true
                            ? true
                            : false,
                      },
                    }
                  : {}),
                conflictAwareRefinement: conflictAwareRefinement
                  ? {
                      status:
                        conflictAwareRefinement.status ??
                        "available_with_limitations",
                      conflictCount: countArray(
                        conflictAwareRefinement.conflicts,
                      ),
                      conflictCountsByType:
                        asRecord(
                          conflictAwareRefinement.conflictCountsByType,
                        ) ?? countConflictTypes(conflictAwareRefinement.conflicts),
                    }
                  : undefined,
                consumedByDemandOrMaterializer:
                  strategyProjectionDiff.consumedByDemandOrMaterializer === true
                    ? true
                    : false,
              }
            : undefined,
          slotOwnedDemandAdjustmentPlan: slotOwnedPlan
            ? {
                status: slotOwnedPlan.status ?? "not_available",
                readOnly: slotOwnedPlan.readOnly === true,
                affectsScoringOrGeneration:
                  slotOwnedPlan.affectsScoringOrGeneration === true
                    ? true
                    : false,
                protectedDemandCount: countArray(slotOwnedPlan.protectedDemand),
                donorDemandCount: countArray(slotOwnedPlan.donorDemand),
                eligibleDonorCount: asRecordArray(
                  slotOwnedPlan.donorDemand,
                ).filter((row) => row.eligible === true).length,
                slotBudgetPolicy: {
                  netNewVolumeAllowed:
                    slotOwnedBudgetPolicy?.netNewVolumeAllowed === true
                      ? true
                      : false,
                  maxSlotIncreaseAllowed:
                    typeof slotOwnedBudgetPolicy?.maxSlotIncreaseAllowed ===
                    "number"
                      ? slotOwnedBudgetPolicy.maxSlotIncreaseAllowed
                      : 0,
                  requireSlotOwnership:
                    slotOwnedBudgetPolicy?.requireSlotOwnership === true,
                  requireFloorPreservation:
                    slotOwnedBudgetPolicy?.requireFloorPreservation === true,
                  requirePriorityCoveragePreservation:
                    slotOwnedBudgetPolicy?.requirePriorityCoveragePreservation ===
                    true,
                },
                feasibility: {
                  status: slotOwnedFeasibility?.status ?? "unknown",
                  blockingReasonCount: countArray(
                    slotOwnedFeasibility?.blockingReasons,
                  ),
                  unresolvedInputCount: countArray(
                    slotOwnedFeasibility?.unresolvedInputs,
                  ),
                  nextRequiredEvidenceCount: countArray(
                    slotOwnedFeasibility?.nextRequiredEvidence,
                  ),
                },
                nextSafeAction:
                  typeof slotOwnedPlan.nextSafeAction === "string"
                    ? slotOwnedPlan.nextSafeAction
                    : "do_not_promote",
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
  const basePlanCompare = asRecord(input.noRepair.v2BasePlanCompare);
  const basePlanSummary = asRecord(basePlanCompare?.summary);
  const shadowConsumption = asRecord(input.noRepair.v2BasePlanShadowConsumptionTrial);
  const shadowSummary = asRecord(shadowConsumption?.summary);
  const capacityMaterializer = asRecord(
    input.noRepair.v2CapacityMaterializerProjection,
  );
  const capacityMaterializerImpact = asRecord(
    capacityMaterializer?.candidateImpact,
  );
  const laneIntentMaterializer = asRecord(
    input.noRepair.v2LaneIntentMaterializerProjection,
  );
  const laneIntentMaterializerImpact = asRecord(
    laneIntentMaterializer?.candidateImpact,
  );
  const setBudgetMaterializer = asRecord(
    input.noRepair.v2SetBudgetMaterializerProjection,
  );
  const setBudgetMaterializerImpact = asRecord(
    setBudgetMaterializer?.candidateImpact,
  );
  const supportFloorMaterializer = asRecord(
    input.noRepair.v2SupportFloorMaterializerProjection,
  );
  const supportFloorMaterializerImpact = asRecord(
    supportFloorMaterializer?.candidateImpact,
  );
  const concentrationMaterializer = asRecord(
    input.noRepair.v2ConcentrationMaterializerProjection,
  );
  const concentrationMaterializerImpact = asRecord(
    concentrationMaterializer?.candidateImpact,
  );
  const concentrationMaterializerDelta = asRecord(
    concentrationMaterializer?.concentrationDelta,
  );
  const concentrationReadiness = asRecord(
    concentrationMaterializer?.crossWeekReadiness,
  );
  const concentrationDonorOffset = asRecord(
    concentrationMaterializer?.donorOffsetRedistributionProjection,
  );
  const concentrationDonorOffsetSummary = asRecord(
    concentrationDonorOffset?.summary,
  );
  const concentrationSlotWeekAllocationSummary = asRecord(
    asRecord(concentrationDonorOffset?.slotWeekAllocationProjection)?.summary,
  );
  const planQualityBenchmark = asRecord(input.noRepair.v2PlanQualityBenchmark);
  const planQualitySummary = asRecord(planQualityBenchmark?.summary);
  const planQualityDeprecationReadiness = asRecord(
    planQualityBenchmark?.deprecationReadiness,
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
    v2BasePlanCompareStatus: basePlanCompare?.status ?? "not_available",
    v2BasePlanCompareImprovementCount:
      basePlanSummary?.v2ImprovementCount ?? null,
    v2BasePlanCompareRegressionCount:
      basePlanSummary?.v2RegressionCount ?? null,
    v2BasePlanShadowConsumptionStatus:
      shadowConsumption?.status ?? "not_available",
    v2BasePlanShadowConsumptionRepairDependencyDelta:
      shadowSummary?.repairDependencyDelta ?? null,
    v2BasePlanShadowConsumptionRegressionCount:
      shadowSummary?.regressionCount ?? null,
    v2CapacityMaterializerProjectionStatus:
      capacityMaterializer?.status ?? "not_available",
    v2CapacityMaterializerProjectionIdentityDelta:
      capacityMaterializerImpact?.selectedIdentityDelta ?? null,
    v2CapacityMaterializerProjectionTotalSetDelta:
      capacityMaterializerImpact?.totalSetDelta ?? null,
    v2LaneIntentMaterializerProjectionStatus:
      laneIntentMaterializer?.status ?? "not_available",
    v2LaneIntentMaterializerProjectionIdentityDelta:
      laneIntentMaterializerImpact?.selectedIdentityDelta ?? null,
    v2LaneIntentMaterializerProjectionTotalSetDelta:
      laneIntentMaterializerImpact?.totalSetDelta ?? null,
    v2SetBudgetMaterializerProjectionStatus:
      setBudgetMaterializer?.status ?? "not_available",
    v2SetBudgetMaterializerProjectionIdentityDelta:
      setBudgetMaterializerImpact?.selectedIdentityDelta ?? null,
    v2SetBudgetMaterializerProjectionTotalSetDelta:
      setBudgetMaterializerImpact?.totalSetDelta ?? null,
    v2SetBudgetMaterializerProjectionTargetLaneSetDelta:
      setBudgetMaterializerImpact?.targetLaneSetDelta ?? null,
    v2SupportFloorMaterializerProjectionStatus:
      supportFloorMaterializer?.status ?? "not_available",
    v2SupportFloorMaterializerProjectionIdentityDelta:
      supportFloorMaterializerImpact?.selectedIdentityDelta ?? null,
    v2SupportFloorMaterializerProjectionTotalSetDelta:
      supportFloorMaterializerImpact?.totalSetDelta ?? null,
    v2SupportFloorMaterializerProjectionTargetLaneSetDelta:
      supportFloorMaterializerImpact?.targetLaneSetDelta ?? null,
    v2ConcentrationMaterializerProjectionStatus:
      concentrationMaterializer?.status ?? "not_available",
    v2ConcentrationMaterializerProjectionIdentityDelta:
      concentrationMaterializerImpact?.selectedIdentityDelta ?? null,
    v2ConcentrationMaterializerProjectionTotalSetDelta:
      concentrationMaterializerImpact?.totalSetDelta ?? null,
    v2ConcentrationMaterializerProjectionWarningDelta:
      concentrationMaterializerDelta?.warningDelta ?? null,
    v2ConcentrationMaterializerProjectionReadinessDecision:
      concentrationReadiness?.decision ?? "not_available",
    v2ConcentrationMaterializerProjectionProjectedWeeks:
      concentrationReadiness?.projectedWeekCount ?? null,
    v2ConcentrationMaterializerProjectionImprovedWeeks:
      concentrationReadiness?.improvedWeekCount ?? null,
    v2ConcentrationMaterializerProjectionReadinessBlockers:
      concentrationReadiness?.blockerCount ?? null,
    v2ConcentrationMaterializerProjectionNextSafeSlice:
      concentrationReadiness?.nextSafeSlice ?? null,
    v2ConcentrationMaterializerProjectionSafeForBehaviorPromotion:
      concentrationMaterializer?.safeForBehaviorPromotion === true,
    v2ConcentrationMaterializerProjectionBehaviorBlockers:
      Array.isArray(concentrationMaterializer?.blockersBeforeBehavior)
        ? concentrationMaterializer.blockersBeforeBehavior.length
        : null,
    v2ConcentrationMaterializerProjectionNextSafeAction:
      concentrationMaterializer?.nextSafeAction ?? null,
    v2ConcentrationDonorOffsetProjectionStatus:
      concentrationDonorOffset?.status ?? "not_available",
    v2ConcentrationDonorOffsetProjectionReadiness:
      concentrationDonorOffsetSummary?.behaviorReadinessDecision ??
      "not_available",
    v2ConcentrationDonorOffsetProjectionProjectedWeeks:
      concentrationDonorOffsetSummary?.projectedWeekCount ?? null,
    v2ConcentrationDonorOffsetProjectionWarningDelta:
      concentrationDonorOffsetSummary?.concentrationWarningDelta ?? null,
    v2ConcentrationDonorOffsetProjectionNextSafeSlice:
      concentrationDonorOffsetSummary?.nextSafeSlice ?? null,
    v2ConcentrationSlotWeekAllocationReadiness:
      concentrationSlotWeekAllocationSummary?.behaviorReadiness ?? null,
    v2ConcentrationSlotWeekAllocationBlockedRows:
      concentrationSlotWeekAllocationSummary?.blockedRowCount ?? null,
    v2ConcentrationSlotWeekAllocationNextSafeSlice:
      concentrationSlotWeekAllocationSummary?.nextSafeSlice ?? null,
    v2PlanQualityBenchmarkStatus:
      planQualityBenchmark?.status ?? "not_available",
    v2PlanQualityBenchmarkFailedGates:
      planQualitySummary?.failCount ?? null,
    v2PlanQualityBenchmarkMissingEvidenceGates:
      planQualitySummary?.missingEvidenceCount ?? null,
    v2PlanQualityDeprecationReadiness:
      planQualityDeprecationReadiness?.status ?? "not_available",
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
