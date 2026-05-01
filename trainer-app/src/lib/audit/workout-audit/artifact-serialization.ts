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
  "v2-debug-index",
  "v2-strategy",
  "v2-promotion-readiness",
  "v2-promotion-diffs",
  "v2-repair-evidence",
  "v2-materialization",
  "v2-cross-week-projection",
  "v2-selection-alignment",
] as const;

type PlannerOnlyNoRepairDebugArtifactLink = Required<
  Pick<
    MesocycleExplainPlannerOnlyNoRepairDebugArtifactManifest,
    "fileName" | "relativePath" | "sizeBytes" | "sha256"
  >
> &
  Pick<MesocycleExplainPlannerOnlyNoRepairDebugArtifactManifest, "detailLevel">;

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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
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

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
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
    kind: "v2_debug_index",
    created: Boolean(link),
    ...(link ?? { enableWith: "--v2-debug-artifact" as const }),
    detailLevel: link?.detailLevel ?? "compact",
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

function compactStrategyPromotionDiff(value: unknown): JsonRecord | undefined {
  const diff = asRecord(value);
  if (!diff) {
    return undefined;
  }
  const gates = asRecord(diff.nonRegressionGates) ?? {};
  const gateValues = Object.values(gates).filter(
    (entry): entry is boolean => typeof entry === "boolean",
  );
  const reportedGateCount = gateValues.filter(Boolean).length;
  const projectionDiff = asRecord(diff.projectionDiff);
  const conflictAwareRefinement = asRecord(
    projectionDiff?.conflictAwareRefinement,
  );
  const preShadowCandidateFilter = asRecord(
    projectionDiff?.preShadowCandidateFilter,
  );
  const preShadowOverride = asRecord(
    preShadowCandidateFilter?.overrideConstruction,
  );
  const candidateStrategy = asRecord(projectionDiff?.candidateStrategy);
  const redistributionPreference = asRecord(
    candidateStrategy?.redistributionPreference,
  );
  const donorSurplusEvidence = asRecord(diff.donorSurplusEvidence);
  const donorSurplusSummary = asRecord(donorSurplusEvidence?.summary);
  const slotOwnedPlan = asRecord(diff.slotOwnedDemandAdjustmentPlan);
  const slotOwnedFeasibility = asRecord(slotOwnedPlan?.feasibility);
  const slotOwnedBudgetPolicy = asRecord(slotOwnedPlan?.slotBudgetPolicy);
  const computedGateValues = Object.values(
    asRecord(projectionDiff?.computedNonRegressionGates) ?? {},
  ).filter((entry): entry is string =>
    entry === "pass" || entry === "fail" || entry === "unknown",
  );
  const computedGateCounts = {
    pass: computedGateValues.filter((entry) => entry === "pass").length,
    fail: computedGateValues.filter((entry) => entry === "fail").length,
    unknown: computedGateValues.filter((entry) => entry === "unknown").length,
  };

  return {
    status: diff.status ?? "not_available",
    readOnly: diff.readOnly === true,
    affectsScoringOrGeneration:
      diff.affectsScoringOrGeneration === true ? true : false,
    evaluatedHypothesisCount: countArray(diff.evaluatedHypotheses),
    interactionRiskStatus:
      asRecord(diff.interactionRisk)?.status ?? "not_evaluated",
    nonRegressionGateStatus: {
      reported: reportedGateCount > 0,
      reportedCount: reportedGateCount,
      totalCount: gateValues.length,
      enforcedAsBehavior: false,
    },
    nextSafeAction:
      typeof diff.nextSafeAction === "string"
        ? diff.nextSafeAction
        : "do_not_promote",
    consumedByDemandOrMaterializer:
      diff.consumedByDemandOrMaterializer === true ? true : false,
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
                  (row) => asRecord(row.baselineCoverage)?.measured === true,
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
                  (row) => asRecord(row.eligibility)?.eligible !== true,
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
    projectionDiff: projectionDiff
      ? {
          status: projectionDiff.status ?? "not_available",
          readOnly: projectionDiff.readOnly === true,
          affectsScoringOrGeneration:
            projectionDiff.affectsScoringOrGeneration === true ? true : false,
          projectionMode: projectionDiff.projectionMode ?? "not_projected",
          candidateProtectedMuscleCount: countArray(
            redistributionPreference?.candidateProtectedMuscles,
          ),
          candidateDonorMuscleCount: countArray(
            redistributionPreference?.candidateDonorMuscles,
          ),
          computedGateCounts,
          readiness: projectionDiff.readiness ?? "not_ready",
          ...(preShadowCandidateFilter
            ? {
                preShadowCandidateFilter: {
                  enabled: preShadowCandidateFilter.enabled === true,
                  readOnly: preShadowCandidateFilter.readOnly === true,
                  affectsScoringOrGeneration:
                    preShadowCandidateFilter.affectsScoringOrGeneration === true
                      ? true
                      : false,
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
                    preShadowCandidateFilter.consumedByDemandOrMaterializer === true
                      ? true
                      : false,
                },
              }
            : {}),
          conflictAwareRefinement: conflictAwareRefinement
            ? {
                enabled: conflictAwareRefinement.enabled === true,
                readOnly: conflictAwareRefinement.readOnly === true,
                affectsScoringOrGeneration:
                  conflictAwareRefinement.affectsScoringOrGeneration === true
                    ? true
                    : false,
                status:
                  conflictAwareRefinement.status ??
                  "available_with_limitations",
                conflictCount: countArray(
                  conflictAwareRefinement.conflicts,
                ),
                conflictCountsByType:
                  asRecord(conflictAwareRefinement.conflictCountsByType) ??
                  countConflictTypes(conflictAwareRefinement.conflicts),
                excludedDonorMuscleCount: countArray(
                  asRecord(conflictAwareRefinement.donorResolution)
                    ?.excludedDonorMuscles,
                ),
                retainedDonorMuscleCount: countArray(
                  asRecord(conflictAwareRefinement.donorResolution)
                    ?.retainedDonorMuscles,
                ),
                volumePolicy:
                  asRecord(conflictAwareRefinement.volumePolicy) ?? {},
              }
            : undefined,
          topLimitations: asStringArray(projectionDiff.limitations).slice(0, 5),
          consumedByDemandOrMaterializer:
            projectionDiff.consumedByDemandOrMaterializer === true
              ? true
              : false,
        }
      : undefined,
    slotOwnedDemandAdjustmentPlan: slotOwnedPlan
      ? {
          status: slotOwnedPlan.status ?? "not_available",
          readOnly: slotOwnedPlan.readOnly === true,
          affectsScoringOrGeneration:
            slotOwnedPlan.affectsScoringOrGeneration === true ? true : false,
          protectedDemandCount: countArray(slotOwnedPlan.protectedDemand),
          donorDemandCount: countArray(slotOwnedPlan.donorDemand),
          eligibleDonorCount: asRecordArray(slotOwnedPlan.donorDemand).filter(
            (row) => row.eligible === true,
          ).length,
          slotBudgetPolicy: {
            netNewVolumeAllowed:
              slotOwnedBudgetPolicy?.netNewVolumeAllowed === true
                ? true
                : false,
            maxSlotIncreaseAllowed:
              typeof slotOwnedBudgetPolicy?.maxSlotIncreaseAllowed === "number"
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
  const v2BasePlanCompare = asRecord(noRepair.v2BasePlanCompare);
  const v2BasePlanCompareSummary = asRecord(v2BasePlanCompare?.summary);
  const v2BasePlanCompareComparedPlans = asRecord(
    v2BasePlanCompare?.comparedPlans,
  );
  const v2BasePlanShadowConsumptionTrial = asRecord(
    noRepair.v2BasePlanShadowConsumptionTrial,
  );
  const v2BasePlanShadowSummary = asRecord(
    v2BasePlanShadowConsumptionTrial?.summary,
  );
  const v2BasePlanShadowComparedPlans = asRecord(
    v2BasePlanShadowConsumptionTrial?.comparedPlans,
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
  const v2ResponseEvidenceSummary = asRecord(
    v2MesocycleStrategyDiagnostic?.responseEvidenceSummary,
  );
  const v2ContinuityVariationEvidence = asRecord(
    v2MesocycleStrategyDiagnostic?.continuityVariationEvidence,
  );
  const v2VolumeFatigueStrategyEvidence = asRecord(
    v2MesocycleStrategyDiagnostic?.volumeFatigueStrategyEvidence,
  );
  const v2StrategyRecommendation = asRecord(
    v2MesocycleStrategyDiagnostic?.strategyRecommendation,
  );
  const v2StrategyRecommendationHypotheses = asRecordArray(
    v2StrategyRecommendation?.hypotheses,
  );
  const v2StrategyPromotionReadiness = asRecord(
    v2MesocycleStrategyDiagnostic?.strategyHypothesisPromotionReadiness,
  );
  const v2StrategyPromotionDiff = asRecord(
    v2MesocycleStrategyDiagnostic?.strategyHypothesisPromotionDiff,
  );
  const v2StrategyPromotionReadinessRows = asRecordArray(
    v2StrategyPromotionReadiness?.hypothesisReadiness,
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
              v2DemandDerivationPlan?.currentDemandSource ?? "mixed",
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
            blockResponseSignalCount:
              typeof v2StrategyInputSummary?.blockResponseSignalCount ===
              "number"
                ? v2StrategyInputSummary.blockResponseSignalCount
                : 0,
            exerciseResponseSignalCount:
              typeof v2StrategyInputSummary?.exerciseResponseSignalCount ===
              "number"
                ? v2StrategyInputSummary.exerciseResponseSignalCount
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
            strategyImplicationCounts:
              asRecord(v2ResponseEvidenceSummary?.strategyImplicationCounts) ??
              {},
            recurringUnderHitMuscleExamples: Array.isArray(
              v2ResponseEvidenceSummary?.recurringUnderHitMuscleExamples,
            )
              ? v2ResponseEvidenceSummary.recurringUnderHitMuscleExamples
              : [],
            recurringOverConcentrationExamples: Array.isArray(
              v2ResponseEvidenceSummary?.recurringOverConcentrationExamples,
            )
              ? v2ResponseEvidenceSummary.recurringOverConcentrationExamples
              : [],
            exerciseSignalsByType:
              asRecord(v2ResponseEvidenceSummary?.exerciseSignalsByType) ?? {},
            confidenceDistribution:
              asRecord(v2ResponseEvidenceSummary?.confidenceDistribution) ?? {},
            evidenceLimitationCount: Array.isArray(
              v2ResponseEvidenceSummary?.evidenceLimitations,
            )
              ? v2ResponseEvidenceSummary.evidenceLimitations.length
              : 0,
            usableForFutureContinuityVariation:
              v2ResponseEvidenceSummary?.usableForFutureContinuityVariation ===
              true,
            usableForFutureMaterializerRanking:
              v2ResponseEvidenceSummary?.usableForFutureMaterializerRanking ===
              true,
            usableForFutureVolumeFatigueStrategy:
              v2ResponseEvidenceSummary?.usableForFutureVolumeFatigueStrategy ===
              true,
            continuityVariationEvidence: v2ContinuityVariationEvidence
              ? {
                  status:
                    v2ContinuityVariationEvidence.status ?? "not_available",
                  keepCandidateCount:
                    v2ContinuityVariationEvidence.keepCandidateCount ?? 0,
                  rotateCandidateCount:
                    v2ContinuityVariationEvidence.rotateCandidateCount ?? 0,
                  avoidCandidateCount:
                    v2ContinuityVariationEvidence.avoidCandidateCount ?? 0,
                  lowConfidenceCount:
                    v2ContinuityVariationEvidence.lowConfidenceCount ?? 0,
                  limitationCount: Array.isArray(
                    v2ContinuityVariationEvidence.limitations,
                  )
                    ? v2ContinuityVariationEvidence.limitations.length
                    : 0,
                }
              : undefined,
            volumeFatigueStrategyEvidence: v2VolumeFatigueStrategyEvidence
              ? {
                  status:
                    v2VolumeFatigueStrategyEvidence.status ?? "not_available",
                  protectLaggingMuscleSignals: Array.isArray(
                    v2VolumeFatigueStrategyEvidence.protectLaggingMuscleSignals,
                  )
                    ? v2VolumeFatigueStrategyEvidence.protectLaggingMuscleSignals
                    : [],
                  overConcentrationSignals: Array.isArray(
                    v2VolumeFatigueStrategyEvidence.overConcentrationSignals,
                  )
                    ? v2VolumeFatigueStrategyEvidence.overConcentrationSignals
                    : [],
                  lateBlockFatigueSignals: Array.isArray(
                    v2VolumeFatigueStrategyEvidence.lateBlockFatigueSignals,
                  )
                    ? v2VolumeFatigueStrategyEvidence.lateBlockFatigueSignals
                    : [],
                  deloadExecutionSignals: Array.isArray(
                    v2VolumeFatigueStrategyEvidence.deloadExecutionSignals,
                  )
                    ? v2VolumeFatigueStrategyEvidence.deloadExecutionSignals
                    : [],
                  limitationCount: Array.isArray(
                    v2VolumeFatigueStrategyEvidence.limitations,
                  )
                    ? v2VolumeFatigueStrategyEvidence.limitations.length
                    : 0,
                }
              : undefined,
            strategyRecommendation: v2StrategyRecommendation
              ? {
                  status:
                    v2StrategyRecommendation.status ?? "not_available",
                  readOnly: v2StrategyRecommendation.readOnly === true,
                  affectsScoringOrGeneration:
                    v2StrategyRecommendation.affectsScoringOrGeneration ===
                    true
                      ? true
                      : false,
                  recommendedPhase:
                    v2StrategyRecommendation.recommendedPhase ?? "unknown",
                  confidence: v2StrategyRecommendation.confidence ?? "low",
                  hypothesisCount: v2StrategyRecommendationHypotheses.length,
                  hypothesisIds: v2StrategyRecommendationHypotheses
                    .map((hypothesis) => hypothesis.id)
                    .filter((id): id is string => typeof id === "string"),
                  priorityCounts: countBy(
                    v2StrategyRecommendationHypotheses,
                    "priority",
                  ),
                  topEvidenceExamples: v2StrategyRecommendationHypotheses
                    .flatMap((hypothesis) =>
                      asStringArray(hypothesis.evidence),
                    )
                    .slice(0, 6),
                  promotionBlockers: v2StrategyRecommendationHypotheses
                    .flatMap((hypothesis) =>
                      asStringArray(hypothesis.promotionBlockers),
                    )
                    .filter(
                      (blocker, index, blockers) =>
                        blockers.indexOf(blocker) === index,
                    )
                    .slice(0, 8),
                  mustNotYetInfluence: v2StrategyRecommendationHypotheses
                    .flatMap((hypothesis) =>
                      asStringArray(hypothesis.mustNotYetInfluence),
                    )
                    .filter(
                      (target, index, targets) =>
                        targets.indexOf(target) === index,
                    ),
                  consumedByDemandOrMaterializer: false,
                }
              : undefined,
            strategyHypothesisPromotionReadiness: v2StrategyPromotionReadiness
              ? {
                  status:
                    v2StrategyPromotionReadiness.status ?? "not_ready",
                  readOnly: v2StrategyPromotionReadiness.readOnly === true,
                  affectsScoringOrGeneration:
                    v2StrategyPromotionReadiness
                      .affectsScoringOrGeneration === true
                      ? true
                      : false,
                  hypothesisCount: v2StrategyPromotionReadinessRows.length,
                  hypothesisIds: v2StrategyPromotionReadinessRows
                    .map((row) => row.hypothesisId)
                    .filter((id): id is string => typeof id === "string"),
                  readinessCounts: countBy(
                    v2StrategyPromotionReadinessRows,
                    "readiness",
                  ),
                  proposedOwnerCounts: countBy(
                    v2StrategyPromotionReadinessRows,
                    "proposedOwner",
                  ),
                  nextSafeActionCounts: countBy(
                    v2StrategyPromotionReadinessRows,
                    "nextSafeAction",
                  ),
                  topMissingEvidenceCategories:
                    v2StrategyPromotionReadinessRows
                      .flatMap((row) => asStringArray(row.missingEvidence))
                      .filter(
                        (evidence, index, rows) =>
                          rows.indexOf(evidence) === index,
                      )
                      .slice(0, 8),
                  globalBlockers: asStringArray(
                    v2StrategyPromotionReadiness.globalBlockers,
                  ).slice(0, 8),
                  consumedByDemandOrMaterializer: false,
                }
              : undefined,
            strategyHypothesisPromotionDiff: compactStrategyPromotionDiff(
              v2StrategyPromotionDiff,
            ),
            northStarGapCount: Array.isArray(
              v2MesocycleStrategyDiagnostic.currentStateVsNorthStarGaps,
            )
              ? v2MesocycleStrategyDiagnostic.currentStateVsNorthStarGaps.length
              : 0,
          }
        : undefined,
      basePlanCompare: v2BasePlanCompare
        ? {
            status: v2BasePlanCompare.status ?? "not_available",
            readOnly: v2BasePlanCompare.readOnly === true,
            affectsScoringOrGeneration:
              v2BasePlanCompare.affectsScoringOrGeneration === true
                ? true
                : false,
            comparedPlans: v2BasePlanCompareComparedPlans ?? {},
            summary: {
              v2BaseValidationStatus:
                v2BasePlanCompareSummary?.v2BaseValidationStatus ??
                "not_available",
              v2TotalSets: v2BasePlanCompareSummary?.v2TotalSets ?? null,
              noRepairTotalSets:
                v2BasePlanCompareSummary?.noRepairTotalSets ?? null,
              repairedTotalSets:
                v2BasePlanCompareSummary?.repairedTotalSets ?? null,
              repairDependencyCount:
                v2BasePlanCompareSummary?.repairDependencyCount ?? null,
              v2ImprovementCount:
                v2BasePlanCompareSummary?.v2ImprovementCount ?? 0,
              v2RegressionCount:
                v2BasePlanCompareSummary?.v2RegressionCount ?? 0,
              unclearCount: v2BasePlanCompareSummary?.unclearCount ?? 0,
            },
            nextSafeAction:
              typeof v2BasePlanCompare.nextSafeAction === "string"
                ? v2BasePlanCompare.nextSafeAction
                : "inspect_compare",
          }
        : undefined,
      basePlanShadowConsumptionTrial: v2BasePlanShadowConsumptionTrial
        ? {
            status:
              v2BasePlanShadowConsumptionTrial.status ?? "not_available",
            readOnly: v2BasePlanShadowConsumptionTrial.readOnly === true,
            affectsScoringOrGeneration:
              v2BasePlanShadowConsumptionTrial.affectsScoringOrGeneration ===
              true
                ? true
                : false,
            consumedByProduction:
              v2BasePlanShadowConsumptionTrial.consumedByProduction === true
                ? true
                : false,
            comparedPlans: v2BasePlanShadowComparedPlans ?? {},
            summary: {
              shadowTotalSets:
                v2BasePlanShadowSummary?.shadowTotalSets ?? null,
              v2BaseTotalSets:
                v2BasePlanShadowSummary?.v2BaseTotalSets ?? null,
              noRepairTotalSets:
                v2BasePlanShadowSummary?.noRepairTotalSets ?? null,
              repairedTotalSets:
                v2BasePlanShadowSummary?.repairedTotalSets ?? null,
              currentRepairDependencyCount:
                v2BasePlanShadowSummary?.currentRepairDependencyCount ?? null,
              shadowRemainingRepairDependencyCount:
                v2BasePlanShadowSummary
                  ?.shadowRemainingRepairDependencyCount ?? null,
              repairDependencyDelta:
                v2BasePlanShadowSummary?.repairDependencyDelta ?? null,
              improvementCount:
                v2BasePlanShadowSummary?.improvementCount ?? 0,
              preservationCount:
                v2BasePlanShadowSummary?.preservationCount ?? 0,
              regressionCount:
                v2BasePlanShadowSummary?.regressionCount ?? 0,
              unclearCount: v2BasePlanShadowSummary?.unclearCount ?? 0,
              notComparableCount:
                v2BasePlanShadowSummary?.notComparableCount ?? 0,
              categorizedIdentityDifferenceCount:
                v2BasePlanShadowSummary
                  ?.categorizedIdentityDifferenceCount ?? 0,
            },
            nextSafeAction:
              typeof v2BasePlanShadowConsumptionTrial.nextSafeAction ===
              "string"
                ? v2BasePlanShadowConsumptionTrial.nextSafeAction
                : "inspect_shadow_consumption",
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
