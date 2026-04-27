import type { WorkoutAuditArtifact } from "./types";

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
        .map(([key, entry]) => [key, sortJsonKeys(entry)] as const)
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
  value: unknown
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
        right.bytes - left.bytes || left.field.localeCompare(right.field)
    );
}

export function buildArtifactDiffSummary(previous: unknown, next: unknown): {
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
    .filter((key) => JSON.stringify(previousRecord[key]) !== JSON.stringify(nextRecord[key]))
    .sort((left, right) => left.localeCompare(right));

  return { changedTopLevelKeys };
}

type JsonRecord = Record<string, unknown>;

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
  catalog: ValueCatalog
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
  catalog: ValueCatalog
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
  catalog: ValueCatalog
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

function countBy(
  rows: ReadonlyArray<JsonRecord>,
  field: string
): JsonRecord {
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
      catalog
    )
  );

  return {
    summary: {
      totalRows: rows.length,
      materialRows: rows.filter(
        (row) => row.materiality === "moderate" || row.materiality === "major"
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
    const keptIds = new Set(keep.map((candidate) => String(candidate.exerciseId ?? "")));
    const omitted = inventory.filter(
      (candidate) => !keptIds.has(String(candidate.exerciseId ?? ""))
    );

    return {
      ...compactArrayFieldRefs(row, ["reasons"], catalog),
      preferredCleanPath: asRecordArray(row.preferredCleanPath).map((entry) =>
        compactArrayFieldRefs(entry, ["evidence"], catalog)
      ),
      dirtyClosureSignals: asRecordArray(row.dirtyClosureSignals).map((entry) =>
        compactArrayFieldRefs(entry, ["evidence"], catalog)
      ),
      candidateInventory: keep.map((candidate) =>
        compactArrayFieldRefs(candidate, ["reasons"], catalog)
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
        0
      ),
    },
    catalogs: {
      arrays: catalog.entries(),
    },
    rows: rows.map((row) => ({
      ...row,
      musclePrescriptions: asRecordArray(row.musclePrescriptions).map((prescription) =>
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
          catalog
        )
      ),
      movementLanePrescriptions: asRecordArray(row.movementLanePrescriptions).map((lane) =>
        compactWholeArrayRefs(lane, ["preferredPatterns", "fallbackPatterns"], catalog)
      ),
      diagnostic: compactWholeArrayRefs(
        asRecord(row.diagnostic) ?? {},
        ["priorRepairsPrevented", "priorRepairsStillRepairOwned", "blockedRepairs"],
        catalog
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
        0
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
        catalog
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
        0
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
          catalog
        )
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
        row.targetStatus === "forbidden"
    );
    const allRows = asRecordArray(slot.muscleAlignments);
    return {
      ...slot,
      muscleAlignments: notableRows.map((row) =>
        compactWholeArrayRefs(
          compactArrayFieldRefs(row, ["evidence", "limitations"], catalog),
          ["intendedClasses", "forbiddenClasses", "initialSelectedClasses", "finalSelectedClasses"],
          catalog
        )
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
  const projectedMuscles = asRecordArray(representativeWeek?.projectedMuscles).map((row) =>
    compactArrayFieldRefs(row, ["evidence", "limitations"], catalog)
  );
  const projectedSlotRisks = asRecordArray(representativeWeek?.projectedSlotRisks).map((row) =>
    compactArrayFieldRefs(row, ["evidence"], catalog)
  );

  return {
    mesocycleId: projection.mesocycleId,
    source: projection.source,
    readOnly: true,
    affectsScoringOrGeneration: false,
    projectionBasis: compactArrayFieldRefs(
      asRecord(projection.projectionBasis) ?? {},
      ["limitations"],
      catalog
    ),
    summary: {
      projectedWeeks: weeks.map((week) => week.week),
      repeatedShapeBasis: "weeks_share_representative_projected_muscles_and_slot_risks",
      representativeProjectedMuscleCount: projectedMuscles.length,
      representativeProjectedSlotRiskCount: projectedSlotRisks.length,
      crossWeekWarningCount: asRecordArray(projection.crossWeekWarnings).length,
      candidateReadinessCount: asRecordArray(projection.candidateBehaviorReadiness).length,
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
        catalog
      )
    ),
    crossWeekWarnings: asRecordArray(projection.crossWeekWarnings).map((row) =>
      compactArrayFieldRefs(row, ["evidence"], catalog)
    ),
    candidateBehaviorReadiness: asRecordArray(projection.candidateBehaviorReadiness).map((row) =>
      compactArrayFieldRefs(row, ["requiredGuardrails"], catalog)
    ),
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
      (Array.isArray(row.unresolvedDemand) ? row.unresolvedDemand.length : 0) - 4
    ),
    omittedSetDistributionViolationCount: Math.max(
      0,
      (Array.isArray(row.setDistributionViolations)
        ? row.setDistributionViolations.length
        : 0) - 4
    ),
  }));
  const notableMuscles = weeklyMuscleComparison.filter(
    (row) => row.targetStatus !== "within"
  );
  const failedOrPartialChecks = acceptanceChecks.filter(
    (row) => row.status !== "pass"
  );
  const activeRepairDependencies = repairDependencies.filter(
    (row) => row.wouldHaveActed === true
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
    calvesFourFourCandidate: dryRun.calvesFourFourCandidate,
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
      planningReality.slotPrescriptionIntents
    ),
    setDistributionIntents: compactSetDistributionIntents(
      planningReality.setDistributionIntents
    ),
    preselectionFeasibility: compactPreselectionFeasibility(
      planningReality.preselectionFeasibility
    ),
    repairMaterialityAfterShadowAllocation: compactRepairRows(
      planningReality.repairMaterialityAfterShadowAllocation
    ),
    repairMateriality: compactRepairRows(planningReality.repairMateriality),
    exerciseClassDistributionBySlot: compactExerciseClassDistribution(
      planningReality.exerciseClassDistributionBySlot
    ),
    exerciseClassAlignment: compactExerciseClassAlignment(
      planningReality.exerciseClassAlignment
    ),
    accumulationWeekProjection: compactAccumulationWeekProjection(
      planningReality.accumulationWeekProjection
    ),
  };
}

export function compactWorkoutAuditArtifactForSerialization(
  artifact: WorkoutAuditArtifact
): WorkoutAuditArtifact {
  const mesocycleExplain = artifact.mesocycleExplain;
  const planningReality =
    mesocycleExplain?.preview.projectionDiagnostics.planningReality;
  const plannerOnlyDryRun = mesocycleExplain?.plannerOnlyDryRun;
  if (!planningReality && !plannerOnlyDryRun) {
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
                      planningReality
                    ) as typeof planningReality,
                  }
                : {}),
            },
          },
          ...(plannerOnlyDryRun
            ? {
                plannerOnlyDryRun: compactPlannerOnlyDryRun(
                  plannerOnlyDryRun
                ) as typeof plannerOnlyDryRun,
              }
            : {}),
        }
      : undefined,
  };
}
