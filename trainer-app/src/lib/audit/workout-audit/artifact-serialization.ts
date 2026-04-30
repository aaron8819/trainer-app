import type {
  MesocycleExplainPlannerOnlyNoRepairDebugArtifactManifest,
  WorkoutAuditArtifact,
} from "./types";

// Internal maintenance helpers for stable audit artifact output.
// These are intentionally not exposed as user-facing CLI commands.
export function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJsonKeys(entry)] as const),
    );
  }
  return value;
}

export function serializeStableJson(value: unknown): string {
  return JSON.stringify(sortJsonKeys(value), null, 2);
}

export function getSerializedArtifactSizeBytes(serialized: string): number {
  return Buffer.byteLength(serialized, "utf8");
}

export type SerializedTopLevelSectionSize = {
  field: string;
  bytes: number;
};

export function getSerializedJsonSizeBytes(value: unknown): number {
  const serialized = serializeStableJson(value) ?? "null";
  return getSerializedArtifactSizeBytes(serialized);
}

export function buildSerializedTopLevelSizeBreakdown(
  value: unknown,
): SerializedTopLevelSectionSize[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([field, section]) => ({
      field,
      bytes: getSerializedJsonSizeBytes(section),
    }))
    .sort(
      (left, right) =>
        right.bytes - left.bytes || left.field.localeCompare(right.field),
    );
}

export function buildArtifactDiffSummary(
  previous: unknown,
  next: unknown,
): {
  changedTopLevelKeys: string[];
} {
  const previousRecord =
    previous && typeof previous === "object"
      ? (previous as Record<string, unknown>)
      : {};
  const nextRecord =
    next && typeof next === "object" ? (next as Record<string, unknown>) : {};
  const keys = new Set([
    ...Object.keys(previousRecord),
    ...Object.keys(nextRecord),
  ]);

  const changedTopLevelKeys = Array.from(keys)
    .filter(
      (key) =>
        JSON.stringify(previousRecord[key]) !== JSON.stringify(nextRecord[key]),
    )
    .sort((left, right) => left.localeCompare(right));

  return { changedTopLevelKeys };
}

type JsonRecord = Record<string, unknown>;

export const V2_PLANNER_NO_REPAIR_DEBUG_CONTAINS = [
  "summary",
  "acceptanceClassification",
  "crossWeekProjectionGate",
  "repairPromotionScoreboard",
  "v2DeloadProjectionDiagnostic",
  "v2MesocycleStrategyDiagnostic",
  "v2MesocyclePlan",
  "v2SetDistributionIntent",
  "v2SupportLanePolicy",
  "v2SupportLaneProjectionDiagnostic",
  "v2SelectionCapacityPlanDiagnostic",
  "plannerOwnedAccumulationProjection",
  "v2ExerciseSelectionPlanDiagnostic",
  "lowAxialHipExtensionLimitation",
  "v2TargetVsNoRepairDiff",
  "slotPlans",
  "weeklyMuscleTotals",
  "setAllocationChanges",
  "weeklyMuscleTotalChanges",
  "acceptanceChecks",
  "acceptanceFailures",
  "qualityWarnings",
  "diagnosticRows",
  "ignoredRows",
  "repairDependenciesDisabled",
  "comparisonToRepaired",
  "laneEvidence",
  "diagnosticCatalogs",
  "classificationDetails",
] as const;

type PlannerOnlyNoRepairDebugArtifactLink = Required<
  Pick<
    MesocycleExplainPlannerOnlyNoRepairDebugArtifactManifest,
    "fileName" | "relativePath" | "sizeBytes" | "sha256"
  >
>;

type ValueCatalog = {
  ref(value: unknown): string;
  entries(): JsonRecord;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function createValueCatalog(prefix: string): ValueCatalog {
  const bySerialized = new Map<string, string>();
  const entries: JsonRecord = {};
  let index = 1;

  return {
    ref(value: unknown): string {
      const serialized = JSON.stringify(value);
      const existing = bySerialized.get(serialized);
      if (existing) {
        return existing;
      }
      const key = `${prefix}${index}`;
      index += 1;
      bySerialized.set(serialized, key);
      entries[key] = value;
      return key;
    },
    entries(): JsonRecord {
      return entries;
    },
  };
}

function compactArrayFieldRefs(
  row: JsonRecord,
  fields: string[],
  catalog: ValueCatalog,
): JsonRecord {
  const next: JsonRecord = { ...row };
  for (const field of fields) {
    const value = next[field];
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }
    next[`${field}Refs`] = value.map((entry) => catalog.ref(entry));
    delete next[field];
  }
  return next;
}

function compactScalarFieldRefs(
  row: JsonRecord,
  fields: string[],
  catalog: ValueCatalog,
): JsonRecord {
  const next: JsonRecord = { ...row };
  for (const field of fields) {
    const value = next[field];
    if (typeof value !== "string" || value.length === 0) {
      continue;
    }
    next[`${field}Ref`] = catalog.ref(value);
    delete next[field];
  }
  return next;
}

function compactWholeArrayRefs(
  row: JsonRecord,
  fields: string[],
  catalog: ValueCatalog,
): JsonRecord {
  const next: JsonRecord = { ...row };
  for (const field of fields) {
    const value = next[field];
    if (!Array.isArray(value) || value.length === 0) {
      continue;
    }
    next[`${field}Ref`] = catalog.ref(value);
    delete next[field];
  }
  return next;
}

function countBy(rows: ReadonlyArray<JsonRecord>, field: string): JsonRecord {
  return rows.reduce<JsonRecord>((counts, row) => {
    const key = typeof row[field] === "string" ? row[field] : "unknown";
    counts[key] = Number(counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function compactRepairRows(value: unknown): unknown {
  const rows = asRecordArray(value);
  if (rows.length === 0) {
    return value;
  }

  const catalog = createValueCatalog("R");
  const compactRows = rows.map((row) =>
    compactScalarFieldRefs(
      compactWholeArrayRefs(row, ["shadowRationale"], catalog),
      ["source", "rationale"],
      catalog,
    ),
  );

  return {
    summary: {
      totalRows: rows.length,
      materialRows: rows.filter(
        (row) => row.materiality === "moderate" || row.materiality === "major",
      ).length,
      majorRows: rows.filter((row) => row.materiality === "major").length,
      byMateriality: countBy(rows, "materiality"),
      byAction: countBy(rows, "action"),
      byShadowAllocationBasis: countBy(rows, "shadowAllocationBasis"),
    },
    catalogs: {
      diagnosticStrings: catalog.entries(),
    },
    rows: compactRows,
    readOnly: true,
    affectsScoringOrGeneration: false,
  };
}

function compactPreselectionFeasibility(value: unknown): unknown {
  const rows = asRecordArray(value);
  if (rows.length === 0) {
    return value;
  }

  const catalog = createValueCatalog("P");
  return rows.map((row) => {
    const inventory = asRecordArray(row.candidateInventory);
    const keep = inventory.filter((candidate, index) => {
      const availability = String(candidate.availability ?? "");
      const candidateClass = String(candidate.candidateClass ?? "");
      return (
        index < 12 ||
        availability === "clean_available" ||
        candidateClass === "knee_flexion_curl" ||
        Boolean(candidate.selectedInLowerBInitial) ||
        Boolean(candidate.selectedInLowerBFinal)
      );
    });
    const keptIds = new Set(
      keep.map((candidate) => String(candidate.exerciseId ?? "")),
    );
    const omitted = inventory.filter(
      (candidate) => !keptIds.has(String(candidate.exerciseId ?? "")),
    );

    return {
      ...compactArrayFieldRefs(row, ["reasons"], catalog),
      preferredCleanPath: asRecordArray(row.preferredCleanPath).map((entry) =>
        compactArrayFieldRefs(entry, ["evidence"], catalog),
      ),
      dirtyClosureSignals: asRecordArray(row.dirtyClosureSignals).map((entry) =>
        compactArrayFieldRefs(entry, ["evidence"], catalog),
      ),
      candidateInventory: keep.map((candidate) =>
        compactArrayFieldRefs(candidate, ["reasons"], catalog),
      ),
      candidateInventorySummary: {
        totalRows: inventory.length,
        keptRows: keep.length,
        omittedCount: omitted.length,
        omittedByCandidateClass: countBy(omitted, "candidateClass"),
        omittedByAvailability: countBy(omitted, "availability"),
      },
      catalogs: {
        diagnosticStrings: catalog.entries(),
      },
    };
  });
}

function compactSlotPrescriptionIntents(value: unknown): unknown {
  const rows = asRecordArray(value);
  if (rows.length === 0) {
    return value;
  }

  const catalog = createValueCatalog("S");
  return {
    summary: {
      slotCount: rows.length,
      prescriptionCount: rows.reduce(
        (sum, row) => sum + asRecordArray(row.musclePrescriptions).length,
        0,
      ),
    },
    catalogs: {
      arrays: catalog.entries(),
    },
    rows: rows.map((row) => ({
      ...row,
      musclePrescriptions: asRecordArray(row.musclePrescriptions).map(
        (prescription) =>
          compactWholeArrayRefs(
            prescription,
            [
              "allowedPatterns",
              "allowedExerciseClasses",
              "forbiddenPatterns",
              "forbiddenExerciseClasses",
              "collateralLimits",
              "reasons",
            ],
            catalog,
          ),
      ),
      movementLanePrescriptions: asRecordArray(
        row.movementLanePrescriptions,
      ).map((lane) =>
        compactWholeArrayRefs(
          lane,
          ["preferredPatterns", "fallbackPatterns"],
          catalog,
        ),
      ),
      diagnostic: compactWholeArrayRefs(
        asRecord(row.diagnostic) ?? {},
        [
          "priorRepairsPrevented",
          "priorRepairsStillRepairOwned",
          "blockedRepairs",
        ],
        catalog,
      ),
    })),
    readOnly: true,
    affectsScoringOrGeneration: false,
  };
}

function compactSetDistributionIntents(value: unknown): unknown {
  const rows = asRecordArray(value);
  if (rows.length === 0) {
    return value;
  }

  const catalog = createValueCatalog("D");
  return {
    summary: {
      slotCount: rows.length,
      policyCount: rows.reduce(
        (sum, row) => sum + asRecordArray(row.musclePolicies).length,
        0,
      ),
    },
    catalogs: {
      diagnosticStrings: catalog.entries(),
    },
    rows: rows.map((row) => ({
      ...row,
      evidence: compactArrayFieldRefs(
        asRecord(row.evidence) ?? {},
        ["concentrationRows", "capCleanupRows", "repairRowsStillRepairOwned"],
        catalog,
      ),
    })),
    readOnly: true,
    affectsScoringOrGeneration: false,
  };
}

function compactExerciseClassDistribution(value: unknown): unknown {
  const rows = asRecordArray(value);
  if (rows.length === 0) {
    return value;
  }

  const catalog = createValueCatalog("C");
  return {
    summary: {
      slotCount: rows.length,
      demandCount: rows.reduce(
        (sum, row) => sum + asRecordArray(row.muscleDemands).length,
        0,
      ),
    },
    catalogs: {
      arrays: catalog.entries(),
    },
    rows: rows.map((row) => ({
      ...row,
      muscleDemands: asRecordArray(row.muscleDemands).map((demand) =>
        compactWholeArrayRefs(
          demand,
          [
            "preferredExerciseClasses",
            "requiredExerciseClasses",
            "forbiddenExerciseClasses",
            "preferredMovementPatterns",
            "forbiddenMovementPatterns",
            "duplicateJustifications",
            "collateralLimits",
            "inventoryEvidence",
            "repairEvidence",
            "limitations",
          ],
          catalog,
        ),
      ),
    })),
    readOnly: true,
    affectsScoringOrGeneration: false,
  };
}

function compactExerciseClassAlignment(value: unknown): unknown {
  const alignment = asRecord(value);
  if (!alignment) {
    return value;
  }

  const catalog = createValueCatalog("A");
  const notableSlots = asRecordArray(alignment.slots).map((slot) => {
    const notableRows = asRecordArray(slot.muscleAlignments).filter(
      (row) =>
        row.initialAlignment !== "satisfied" ||
        row.finalAlignment !== "satisfied" ||
        row.repairEffect !== "unchanged" ||
        row.targetStatus === "hard" ||
        row.targetStatus === "forbidden",
    );
    const allRows = asRecordArray(slot.muscleAlignments);
    return {
      ...slot,
      muscleAlignments: notableRows.map((row) =>
        compactWholeArrayRefs(
          compactArrayFieldRefs(row, ["evidence", "limitations"], catalog),
          [
            "intendedClasses",
            "forbiddenClasses",
            "initialSelectedClasses",
            "finalSelectedClasses",
          ],
          catalog,
        ),
      ),
      omittedSatisfiedCount: allRows.length - notableRows.length,
    };
  });

  return {
    version: alignment.version,
    source: alignment.source,
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: alignment.summary,
    catalogs: {
      diagnosticValues: catalog.entries(),
    },
    slots: notableSlots,
  };
}

function compactAccumulationWeekProjection(value: unknown): unknown {
  const projection = asRecord(value);
  if (!projection) {
    return value;
  }

  const weeks = asRecordArray(projection.weeks);
  const representativeWeek = weeks[0];
  const catalog = createValueCatalog("W");
  const projectedMuscles = asRecordArray(
    representativeWeek?.projectedMuscles,
  ).map((row) =>
    compactArrayFieldRefs(row, ["evidence", "limitations"], catalog),
  );
  const projectedSlotRisks = asRecordArray(
    representativeWeek?.projectedSlotRisks,
  ).map((row) => compactArrayFieldRefs(row, ["evidence"], catalog));

  return {
    mesocycleId: projection.mesocycleId,
    source: projection.source,
    readOnly: true,
    affectsScoringOrGeneration: false,
    projectionBasis: compactArrayFieldRefs(
      asRecord(projection.projectionBasis) ?? {},
      ["limitations"],
      catalog,
    ),
    summary: {
      projectedWeeks: weeks.map((week) => week.week),
      repeatedShapeBasis:
        "weeks_share_representative_projected_muscles_and_slot_risks",
      representativeProjectedMuscleCount: projectedMuscles.length,
      representativeProjectedSlotRiskCount: projectedSlotRisks.length,
      crossWeekWarningCount: asRecordArray(projection.crossWeekWarnings).length,
      candidateReadinessCount: asRecordArray(
        projection.candidateBehaviorReadiness,
      ).length,
    },
    catalogs: {
      diagnosticStrings: catalog.entries(),
    },
    representativeProjectedMuscles: projectedMuscles,
    representativeProjectedSlotRisks: projectedSlotRisks,
    weeks: weeks.map((week) =>
      compactArrayFieldRefs(
        {
          week: week.week,
          phase: week.phase,
          projectionStatus: week.projectionStatus,
          projectedMusclesRef: "representativeProjectedMuscles",
          projectedSlotRisksRef: "representativeProjectedSlotRisks",
          weekLevelWarnings: week.weekLevelWarnings,
        },
        ["weekLevelWarnings"],
        catalog,
      ),
    ),
    crossWeekWarnings: asRecordArray(projection.crossWeekWarnings).map((row) =>
      compactArrayFieldRefs(row, ["evidence"], catalog),
    ),
    candidateBehaviorReadiness: asRecordArray(
      projection.candidateBehaviorReadiness,
    ).map((row) => compactArrayFieldRefs(row, ["requiredGuardrails"], catalog)),
  };
}

function compactPlannerOnlyDryRun(value: unknown): unknown {
  const dryRun = asRecord(value);
  if (!dryRun) {
    return value;
  }

  const slotComparisons = asRecordArray(dryRun.slotComparisons);
  const weeklyMuscleComparison = asRecordArray(dryRun.weeklyMuscleComparison);
  const acceptanceChecks = asRecordArray(dryRun.acceptanceChecks);
  const repairDependencies = asRecordArray(dryRun.repairDependencies);
  const compactSlots = slotComparisons.map((row) => ({
    slotId: row.slotId,
    laneStatus: row.laneStatus,
    unresolvedDemand: Array.isArray(row.unresolvedDemand)
      ? row.unresolvedDemand.slice(0, 4)
      : [],
    duplicateViolations: Array.isArray(row.duplicateViolations)
      ? row.duplicateViolations.slice(0, 3)
      : [],
    setDistributionViolations: Array.isArray(row.setDistributionViolations)
      ? row.setDistributionViolations.slice(0, 4)
      : [],
    repairedExerciseCount: Array.isArray(row.repairedExercises)
      ? row.repairedExercises.length
      : 0,
    plannerOnlyExerciseCount: Array.isArray(row.plannerOnlyExercises)
      ? row.plannerOnlyExercises.length
      : 0,
    omittedUnresolvedDemandCount: Math.max(
      0,
      (Array.isArray(row.unresolvedDemand) ? row.unresolvedDemand.length : 0) -
        4,
    ),
    omittedSetDistributionViolationCount: Math.max(
      0,
      (Array.isArray(row.setDistributionViolations)
        ? row.setDistributionViolations.length
        : 0) - 4,
    ),
  }));
  const notableMuscles = weeklyMuscleComparison.filter(
    (row) => row.targetStatus !== "within",
  );
  const failedOrPartialChecks = acceptanceChecks.filter(
    (row) => row.status !== "pass",
  );
  const activeRepairDependencies = repairDependencies.filter(
    (row) => row.wouldHaveActed === true,
  );

  return {
    enabled: dryRun.enabled,
    compareRepaired: dryRun.compareRepaired,
    readOnly: true,
    affectsScoringOrGeneration: false,
    ...(dryRun.policyOverride ? { policyOverride: dryRun.policyOverride } : {}),
    canReplaceRepairedProjection: dryRun.canReplaceRepairedProjection,
    summary: dryRun.summary,
    compactSummary: {
      slotComparisonCount: slotComparisons.length,
      weeklyMuscleComparisonCount: weeklyMuscleComparison.length,
      omittedWithinMuscleCount:
        weeklyMuscleComparison.length - notableMuscles.length,
      acceptanceCheckCount: acceptanceChecks.length,
      omittedPassingAcceptanceCheckCount:
        acceptanceChecks.length - failedOrPartialChecks.length,
      repairDependencyCount: repairDependencies.length,
      omittedInactiveRepairDependencyCount:
        repairDependencies.length - activeRepairDependencies.length,
    },
    slotComparisons: compactSlots,
    weeklyMuscleComparison: notableMuscles,
    acceptanceChecks: failedOrPartialChecks,
    repairDependencies: activeRepairDependencies,
    ...(dryRun.projectionComparisons
      ? { projectionComparisons: dryRun.projectionComparisons }
      : {}),
    calvesFourFourCandidate: dryRun.calvesFourFourCandidate,
  };
}

function compactNoRepairEvidenceArray(
  value: unknown,
  limit: number,
): {
  evidence: string[];
  omittedEvidenceCount?: number;
} {
  const evidence = Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0,
      )
    : [];
  return {
    evidence: evidence.slice(0, limit),
    ...(evidence.length > limit
      ? { omittedEvidenceCount: evidence.length - limit }
      : {}),
  };
}

function compactNoRepairFindingGroups(
  value: unknown,
  preserveEvidence: boolean,
): unknown {
  return asRecordArray(value).map((row) => ({
    ...row,
    ...(preserveEvidence
      ? { evidence: row.evidence }
      : compactNoRepairEvidenceArray(row.evidence, 4)),
  }));
}

function compactNoRepairConcentrationRows(value: unknown): unknown {
  return asRecordArray(value).map((row) => ({
    ...row,
    ...compactNoRepairEvidenceArray(row.evidence, 5),
  }));
}

function countRecordsByField(rows: JsonRecord[], field: string): JsonRecord {
  return rows.reduce<JsonRecord>((counts, row) => {
    const key = typeof row[field] === "string" ? row[field] : "unknown";
    counts[key] = Number(counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function summarizeValidationRules(value: unknown): JsonRecord {
  const rules = asRecordArray(value);
  return {
    total: rules.length,
    bySeverity: countRecordsByField(rules, "severity"),
    byWeek1Status: countRecordsByField(rules, "week1Status"),
    byFullMesocycleStatus: countRecordsByField(rules, "fullMesocycleStatus"),
  };
}

function buildNoRepairOperatorFindings(noRepair: JsonRecord): JsonRecord {
  const classification = asRecord(noRepair.acceptanceClassification) ?? {};
  const slotPlans = asRecordArray(noRepair.slotPlans);
  const unresolvedDemandTop = slotPlans
    .flatMap((slot) =>
      Array.isArray(slot.unresolvedDemand)
        ? slot.unresolvedDemand.map((entry) => ({
            slotId: slot.slotId,
            demand: entry,
          }))
        : [],
    )
    .slice(0, 12);

  return {
    hardBlockers: compactNoRepairFindingGroups(
      classification.hardBlockers,
      true,
    ),
    warnings: compactNoRepairFindingGroups(
      classification.qualityWarnings,
      false,
    ),
    unresolvedDemandTop,
    acceptanceFailureTop: compactNoRepairConcentrationRows(
      asRecordArray(noRepair.acceptanceFailures).slice(0, 12),
    ),
  };
}

function buildNoRepairDebugArtifactManifest(
  link: PlannerOnlyNoRepairDebugArtifactLink | undefined,
): MesocycleExplainPlannerOnlyNoRepairDebugArtifactManifest {
  return {
    kind: "v2_planner_no_repair_debug",
    created: Boolean(link),
    ...(link ?? { enableWith: "--v2-debug-artifact" as const }),
    contains: [...V2_PLANNER_NO_REPAIR_DEBUG_CONTAINS],
  };
}

function compactCrossWeekProjectionGate(value: unknown): unknown {
  const gate = asRecord(value);
  if (!gate) {
    return undefined;
  }
  const week1Status = asRecord(gate.week1Status);
  const accumulationWeeksStatus = asRecord(gate.accumulationWeeksStatus);
  const accumulationWeeks = asRecordArray(accumulationWeeksStatus?.weeks);
  const deloadStatus = asRecord(gate.deloadStatus);
  const blockers = Array.isArray(gate.blockers) ? gate.blockers : [];
  const warnings = Array.isArray(gate.warnings) ? gate.warnings : [];
  const missingInputs = Array.isArray(gate.missingInputs)
    ? gate.missingInputs
    : [];
  const projectedWeekSummaries = asRecordArray(gate.projectedWeekSummaries);

  return {
    readOnly: true,
    affectsScoringOrGeneration: false,
    week1Status: {
      status: week1Status?.status ?? "unknown",
      basisCount: Array.isArray(week1Status?.basis)
        ? week1Status.basis.length
        : 0,
    },
    accumulationWeeksStatus: {
      status: accumulationWeeksStatus?.status ?? "not_projected",
      weekCount: accumulationWeeks.length,
      projectionBasisCounts: accumulationWeeks.reduce<Record<string, number>>(
        (counts, week) => {
          const key =
            typeof week.projectionBasis === "string"
              ? week.projectionBasis
              : "unknown";
          counts[key] = (counts[key] ?? 0) + 1;
          return counts;
        },
        {},
      ),
    },
    deloadStatus: {
      status: deloadStatus?.status ?? "not_projected",
      projectionBasis: deloadStatus?.projectionBasis ?? "missing",
      preserveIdentities: deloadStatus?.preserveIdentities === true,
    },
    replacementReadinessStatus: gate.replacementReadinessStatus ?? "not_ready",
    safeToPromoteBehavior: false,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    missingInputCount: missingInputs.length,
    projectedWeekSummaryCount: projectedWeekSummaries.length,
  };
}

function compactPlannerOnlyNoRepair(
  value: unknown,
  debugArtifact?: PlannerOnlyNoRepairDebugArtifactLink,
): unknown {
  const noRepair = asRecord(value);
  if (!noRepair) {
    return value;
  }

  const acceptanceClassification = asRecord(noRepair.acceptanceClassification);
  const v2Plan = asRecord(noRepair.v2MesocyclePlan);
  const v2PlanSkeleton = asRecord(v2Plan?.skeleton);
  const v2Diff = asRecord(noRepair.v2TargetVsNoRepairDiff);
  const v2DiffSummary = asRecord(v2Diff?.summary);
  const repairPromotionScoreboard = asRecord(
    noRepair.repairPromotionScoreboard,
  );
  const repairPromotionRawEvidence = asRecord(
    repairPromotionScoreboard?.rawRepairEvidence,
  );
  const repairPromotionSummary = asRecord(repairPromotionScoreboard?.summary);
  const repairPromotionInterpretation = asRecord(
    repairPromotionScoreboard?.interpretation,
  );
  const v2SetDistributionIntent = asRecord(noRepair.v2SetDistributionIntent);
  const v2SetDistributionSummary = asRecord(v2SetDistributionIntent?.summary);
  const v2MesocycleStrategyDiagnostic = asRecord(
    noRepair.v2MesocycleStrategyDiagnostic,
  );
  const v2PhaseStrategy = asRecord(
    v2MesocycleStrategyDiagnostic?.phaseStrategy,
  );
  const v2DemandDerivationPlan = asRecord(
    v2MesocycleStrategyDiagnostic?.demandDerivationPlan,
  );
  const v2UserProfileInputs = asRecord(
    v2MesocycleStrategyDiagnostic?.userTrainingProfileInputs,
  );
  const v2StrategyInputSummary = asRecord(
    v2MesocycleStrategyDiagnostic?.strategyInputSummary,
  );
  const v2SupportLanePolicy = asRecord(noRepair.v2SupportLanePolicy);
  const v2SupportLaneSummary = asRecord(v2SupportLanePolicy?.summary);
  const v2SupportLaneProjectionDiagnostic = asRecord(
    noRepair.v2SupportLaneProjectionDiagnostic,
  );
  const v2SupportLaneProjectionSummary = asRecord(
    v2SupportLaneProjectionDiagnostic?.summary,
  );
  const v2ExerciseSelectionPlanDiagnostic = asRecord(
    noRepair.v2ExerciseSelectionPlanDiagnostic,
  );
  const v2ExerciseSelectionSummary = asRecord(
    v2ExerciseSelectionPlanDiagnostic?.summary,
  );
  const v2SelectionCapacityPlanDiagnostic = asRecord(
    noRepair.v2SelectionCapacityPlanDiagnostic,
  );
  const v2SelectionCapacitySummary = asRecord(
    v2SelectionCapacityPlanDiagnostic?.summary,
  );
  const lowAxialHipExtensionLimitation = asRecord(
    noRepair.lowAxialHipExtensionLimitation,
  );
  const lowAxialContribution = asRecord(
    lowAxialHipExtensionLimitation?.hamstringContribution,
  );
  const lowAxialCriteria = asRecord(
    lowAxialHipExtensionLimitation?.acceptanceCriteria,
  );
  const v2DeloadProjectionDiagnostic = asRecord(
    noRepair.v2DeloadProjectionDiagnostic,
  );
  const v2DeloadProjectionSummary = asRecord(
    v2DeloadProjectionDiagnostic?.summary,
  );
  const validationRules = asRecordArray(v2Plan?.validationRules);
  const migrationScoreboard = asRecord(
    acceptanceClassification?.migrationScoreboard,
  );
  const replacementReadiness = asRecord(v2Plan?.replacementReadiness);
  const replacementReadinessImpact = asRecord(
    v2Diff?.replacementReadinessImpact,
  );
  const hardBlockers = asRecordArray(acceptanceClassification?.hardBlockers);
  const warnings = asRecordArray(acceptanceClassification?.qualityWarnings);
  const diagnosticRows = [
    ...asRecordArray(acceptanceClassification?.diagnosticOnly),
    ...asRecordArray(acceptanceClassification?.sessionShaping),
    ...asRecordArray(noRepair.diagnosticRows),
    ...asRecordArray(noRepair.ignoredRows),
  ];

  return {
    enabled: noRepair.enabled,
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: {
      ...(asRecord(noRepair.summary) ?? {}),
      replacementReadinessStatus:
        acceptanceClassification?.replacementReadinessStatus,
      basicMesocycleShapeStatus:
        acceptanceClassification?.basicMesocycleShapeStatus,
      hardBlockerCount: hardBlockers.length,
      warningCount: warnings.length,
      diagnosticRowCount: diagnosticRows.length,
      nextBestMigrationSlice:
        replacementReadinessImpact?.nextBestMigrationSlice ?? null,
    },
    replacementReadiness: {
      canReplaceRepairedProjection:
        noRepair.canReplaceRepairedProjection === true,
      reasons: Array.isArray(replacementReadiness?.reason)
        ? replacementReadiness.reason
        : [],
      blockers: Array.isArray(replacementReadinessImpact?.blockers)
        ? replacementReadinessImpact.blockers
        : [],
    },
    v2Summary: {
      planStatus: v2Plan?.planStatus,
      split: v2PlanSkeleton?.split,
      weekCount:
        v2SetDistributionSummary?.weekCount ?? v2PlanSkeleton?.weeks ?? null,
      slotCount:
        v2SetDistributionSummary?.slotCount ??
        asRecordArray(v2PlanSkeleton?.slots).length,
      laneCounts: {
        target:
          v2DiffSummary?.targetLaneCount ??
          v2SetDistributionSummary?.laneCount ??
          null,
        satisfied: v2DiffSummary?.satisfiedLaneCount ?? null,
        partial: v2DiffSummary?.partialLaneCount ?? null,
        missing: v2DiffSummary?.missingLaneCount ?? null,
        blocked: v2DiffSummary?.blockedLaneCount ?? null,
        repairDependent: v2DiffSummary?.repairDependentLaneCount ?? null,
        migrationCandidates: v2DiffSummary?.migrationCandidateCount ?? null,
        suspiciousOrBlocked: v2DiffSummary?.suspiciousOrBlockedCount ?? null,
      },
      plannedTotalSetsByWeek:
        v2SetDistributionSummary?.plannedTotalSetsByWeek ?? [],
      mesocycleStrategyDiagnostic: v2MesocycleStrategyDiagnostic
        ? {
            status:
              v2MesocycleStrategyDiagnostic.status ??
              "available_with_limitations",
            readOnly: v2MesocycleStrategyDiagnostic.readOnly === true,
            affectsScoringOrGeneration:
              v2MesocycleStrategyDiagnostic.affectsScoringOrGeneration === true
                ? true
                : false,
            proposedPhase: v2PhaseStrategy?.proposedPhase ?? "unknown",
            confidence: v2PhaseStrategy?.confidence ?? "low",
            currentDemandSource:
              v2DemandDerivationPlan?.currentDemandSource ?? "fixed_skeleton_lanes",
            targetDemandSource:
              v2DemandDerivationPlan?.targetDemandSource ?? "mesocycle_strategy",
            missingInputCount: Array.isArray(v2UserProfileInputs?.missing)
              ? v2UserProfileInputs.missing.length
              : 0,
            limitationCount: Array.isArray(v2UserProfileInputs?.limitations)
              ? v2UserProfileInputs.limitations.length
              : 0,
            strategyInputPresentGroups: Array.isArray(
              v2StrategyInputSummary?.presentGroups,
            )
              ? v2StrategyInputSummary.presentGroups
              : [],
            strategyInputMissingGroups: Array.isArray(
              v2StrategyInputSummary?.missingGroups,
            )
              ? v2StrategyInputSummary.missingGroups
              : [],
            strategyInputHistoricalMesocycleCount:
              typeof v2StrategyInputSummary?.historicalMesocycleCount ===
              "number"
                ? v2StrategyInputSummary.historicalMesocycleCount
                : 0,
            strategyInputHistoricalSourcePlannerCounts:
              asRecord(v2StrategyInputSummary?.historicalSourcePlannerCounts) ??
              {},
            strategyInputEvidenceCategoriesAvailable: Array.isArray(
              v2StrategyInputSummary?.evidenceCategoriesAvailable,
            )
              ? v2StrategyInputSummary.evidenceCategoriesAvailable
              : [],
            performedHistoryEvidenceLoaded:
              v2StrategyInputSummary?.performedHistoryEvidenceLoaded === true,
            prescribedPlanShapeExcludedFromStrategyPolicy:
              v2StrategyInputSummary
                ?.prescribedPlanShapeExcludedFromStrategyPolicy === true,
            strategyInputConfidenceChange:
              typeof v2StrategyInputSummary?.confidenceChange === "string"
                ? v2StrategyInputSummary.confidenceChange
                : "not_evaluated_no_input",
            northStarGapCount: Array.isArray(
              v2MesocycleStrategyDiagnostic.currentStateVsNorthStarGaps,
            )
              ? v2MesocycleStrategyDiagnostic.currentStateVsNorthStarGaps.length
              : 0,
          }
        : undefined,
      supportLanePolicy: v2SupportLanePolicy
        ? {
            readOnly: v2SupportLanePolicy.readOnly === true,
            affectsScoringOrGeneration:
              v2SupportLanePolicy.affectsScoringOrGeneration === true
                ? true
                : false,
            summary: v2SupportLaneSummary ?? {},
          }
        : undefined,
      supportLaneProjectionDiagnostic: v2SupportLaneProjectionDiagnostic
        ? {
            status:
              v2SupportLaneProjectionDiagnostic.status ?? "diagnostic_only",
            readOnly: v2SupportLaneProjectionDiagnostic.readOnly === true,
            affectsScoringOrGeneration:
              v2SupportLaneProjectionDiagnostic.affectsScoringOrGeneration ===
              true
                ? true
                : false,
            summary: v2SupportLaneProjectionSummary ?? {},
            blockerCount: Array.isArray(
              v2SupportLaneProjectionDiagnostic.blockers,
            )
              ? v2SupportLaneProjectionDiagnostic.blockers.length
              : 0,
            warningCount: Array.isArray(
              v2SupportLaneProjectionDiagnostic.warnings,
            )
              ? v2SupportLaneProjectionDiagnostic.warnings.length
              : 0,
            missingInputCount: Array.isArray(
              v2SupportLaneProjectionDiagnostic.missingInputs,
            )
              ? v2SupportLaneProjectionDiagnostic.missingInputs.length
              : 0,
          }
        : undefined,
      validationRuleSummary: summarizeValidationRules(validationRules),
      targetVsNoRepairSummary: v2DiffSummary ?? {},
      repairPromotionScoreboard: repairPromotionScoreboard
        ? {
            rawRepairEvidence: repairPromotionRawEvidence ?? {},
            summary: repairPromotionSummary ?? {},
            interpretation: repairPromotionInterpretation ?? {},
          }
        : undefined,
      exerciseSelectionPlanDiagnostic: {
        status: v2ExerciseSelectionPlanDiagnostic?.status ?? "diagnostic_only",
        summary: v2ExerciseSelectionSummary ?? {},
        blockerCount: Array.isArray(v2ExerciseSelectionPlanDiagnostic?.blockers)
          ? v2ExerciseSelectionPlanDiagnostic.blockers.length
          : 0,
        warningCount: Array.isArray(v2ExerciseSelectionPlanDiagnostic?.warnings)
          ? v2ExerciseSelectionPlanDiagnostic.warnings.length
          : 0,
        missingInputCount: Array.isArray(
          v2ExerciseSelectionPlanDiagnostic?.missingInputs,
        )
          ? v2ExerciseSelectionPlanDiagnostic.missingInputs.length
          : 0,
      },
      selectionCapacityPlanDiagnostic: {
        status: v2SelectionCapacityPlanDiagnostic?.status ?? "diagnostic_only",
        readOnly: v2SelectionCapacityPlanDiagnostic?.readOnly === true,
        affectsScoringOrGeneration:
          v2SelectionCapacityPlanDiagnostic?.affectsScoringOrGeneration === true
            ? true
            : false,
        summary: v2SelectionCapacitySummary ?? {},
        blockerCount: Array.isArray(v2SelectionCapacityPlanDiagnostic?.blockers)
          ? v2SelectionCapacityPlanDiagnostic.blockers.length
          : 0,
        warningCount: Array.isArray(v2SelectionCapacityPlanDiagnostic?.warnings)
          ? v2SelectionCapacityPlanDiagnostic.warnings.length
          : 0,
        missingInputCount: Array.isArray(
          v2SelectionCapacityPlanDiagnostic?.missingInputs,
        )
          ? v2SelectionCapacityPlanDiagnostic.missingInputs.length
          : 0,
        safeForBehaviorPromotion: false,
      },
      lowAxialHipExtensionLimitation: lowAxialHipExtensionLimitation
        ? {
            status:
              lowAxialHipExtensionLimitation.status ?? "not_evaluated",
            slotId: lowAxialHipExtensionLimitation.slotId ?? "lower_b",
            trueHingeExposureCount:
              lowAxialHipExtensionLimitation.trueHingeExposureCount ?? 0,
            lowAxialHipExtensionAnchorCount:
              lowAxialHipExtensionLimitation.lowAxialHipExtensionAnchorCount ??
              0,
            hamstringContribution: {
              curlEffectiveSets:
                lowAxialContribution?.curlEffectiveSets ?? 0,
              hipExtensionEffectiveSets:
                lowAxialContribution?.hipExtensionEffectiveSets ?? 0,
              trueHingeEffectiveSets:
                lowAxialContribution?.trueHingeEffectiveSets ?? 0,
              lowerBEffectiveSets:
                lowAxialContribution?.lowerBEffectiveSets ?? 0,
              weeklyCurlEffectiveSets:
                lowAxialContribution?.weeklyCurlEffectiveSets ?? 0,
              weeklyHipExtensionEffectiveSets:
                lowAxialContribution?.weeklyHipExtensionEffectiveSets ?? 0,
              curlShareOfWeeklyPercent:
                lowAxialContribution?.curlShareOfWeeklyPercent ?? null,
              hipExtensionShareOfWeeklyPercent:
                lowAxialContribution?.hipExtensionShareOfWeeklyPercent ?? null,
              curlShareOfLowerBPercent:
                lowAxialContribution?.curlShareOfLowerBPercent ?? null,
              hipExtensionShareOfLowerBPercent:
                lowAxialContribution?.hipExtensionShareOfLowerBPercent ?? null,
            },
            acceptanceCriteria: lowAxialCriteria ?? {},
            evidenceCount: Array.isArray(
              lowAxialHipExtensionLimitation.evidence,
            )
              ? lowAxialHipExtensionLimitation.evidence.length
              : 0,
            limitationCount: Array.isArray(
              lowAxialHipExtensionLimitation.limitations,
            )
              ? lowAxialHipExtensionLimitation.limitations.length
              : 0,
            safeForBehaviorPromotion: false,
          }
        : undefined,
      deloadProjectionDiagnostic: {
        status: v2DeloadProjectionDiagnostic?.status ?? "not_evaluated",
        summary: v2DeloadProjectionSummary ?? {},
        blockerCount: Array.isArray(v2DeloadProjectionDiagnostic?.blockers)
          ? v2DeloadProjectionDiagnostic.blockers.length
          : 0,
        warningCount: Array.isArray(v2DeloadProjectionDiagnostic?.warnings)
          ? v2DeloadProjectionDiagnostic.warnings.length
          : 0,
        missingInputCount: Array.isArray(
          v2DeloadProjectionDiagnostic?.missingInputs,
        )
          ? v2DeloadProjectionDiagnostic.missingInputs.length
          : 0,
      },
      migrationScoreboard: migrationScoreboard ?? {},
    },
    crossWeekProjectionGate: compactCrossWeekProjectionGate(
      noRepair.crossWeekProjectionGate,
    ),
    operatorFindings: buildNoRepairOperatorFindings(noRepair),
    debugArtifact: buildNoRepairDebugArtifactManifest(debugArtifact),
  };
}

function compactPlanningReality(value: unknown): unknown {
  const planningReality = asRecord(value);
  if (!planningReality) {
    return value;
  }

  return {
    ...planningReality,
    slotPrescriptionIntents: compactSlotPrescriptionIntents(
      planningReality.slotPrescriptionIntents,
    ),
    setDistributionIntents: compactSetDistributionIntents(
      planningReality.setDistributionIntents,
    ),
    preselectionFeasibility: compactPreselectionFeasibility(
      planningReality.preselectionFeasibility,
    ),
    repairMaterialityAfterShadowAllocation: compactRepairRows(
      planningReality.repairMaterialityAfterShadowAllocation,
    ),
    repairMateriality: compactRepairRows(planningReality.repairMateriality),
    exerciseClassDistributionBySlot: compactExerciseClassDistribution(
      planningReality.exerciseClassDistributionBySlot,
    ),
    exerciseClassAlignment: compactExerciseClassAlignment(
      planningReality.exerciseClassAlignment,
    ),
    accumulationWeekProjection: compactAccumulationWeekProjection(
      planningReality.accumulationWeekProjection,
    ),
  };
}

export function compactWorkoutAuditArtifactForSerialization(
  artifact: WorkoutAuditArtifact,
  options?: {
    plannerOnlyNoRepairDebugArtifact?: PlannerOnlyNoRepairDebugArtifactLink;
  },
): WorkoutAuditArtifact {
  const mesocycleExplain = artifact.mesocycleExplain;
  const planningReality =
    mesocycleExplain?.preview.projectionDiagnostics.planningReality;
  const plannerOnlyDryRun = mesocycleExplain?.plannerOnlyDryRun;
  const plannerOnlyNoRepair = mesocycleExplain?.plannerOnlyNoRepair;
  if (!planningReality && !plannerOnlyDryRun && !plannerOnlyNoRepair) {
    return artifact;
  }

  return {
    ...artifact,
    mesocycleExplain: mesocycleExplain
      ? {
          ...mesocycleExplain,
          preview: {
            ...mesocycleExplain.preview,
            projectionDiagnostics: {
              ...mesocycleExplain.preview.projectionDiagnostics,
              ...(planningReality
                ? {
                    planningReality: compactPlanningReality(
                      planningReality,
                    ) as typeof planningReality,
                  }
                : {}),
            },
          },
          ...(plannerOnlyDryRun
            ? {
                plannerOnlyDryRun: compactPlannerOnlyDryRun(
                  plannerOnlyDryRun,
                ) as typeof plannerOnlyDryRun,
              }
            : {}),
          ...(plannerOnlyNoRepair
            ? {
                plannerOnlyNoRepair: compactPlannerOnlyNoRepair(
                  plannerOnlyNoRepair,
                  options?.plannerOnlyNoRepairDebugArtifact,
                ) as typeof plannerOnlyNoRepair,
              }
            : {}),
        }
      : undefined,
  };
}
