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
    ...(dryRun.projectionComparisons
      ? { projectionComparisons: dryRun.projectionComparisons }
      : {}),
    calvesFourFourCandidate: dryRun.calvesFourFourCandidate,
  };
}

function compactV2SetDistributionIntent(value: unknown): unknown {
  const intent = asRecord(value);
  if (!intent) {
    return value;
  }

  const catalog = createValueCatalog("V");
  const rawWeeks = asRecordArray(intent.weeks);
  const firstWeekSlots = asRecordArray(rawWeeks[0]?.slots);
  const firstEvidenceBasis = asRecordArray(firstWeekSlots[0]?.lanes)[0]?.evidenceBasis;
  const commonEvidenceBasisRef =
    Array.isArray(firstEvidenceBasis) && firstEvidenceBasis.length > 0
      ? catalog.ref(firstEvidenceBasis)
      : undefined;
  const slotDefinitions = firstWeekSlots.map((slot) => ({
    slotId: slot.slotId,
    slotIntent: slot.slotIntent,
    targetSessionSets: slot.targetSessionSets,
    lanes: asRecordArray(slot.lanes).map((lane) => {
      const compactLane: JsonRecord = { ...lane };
      delete compactLane.setBudget;
      for (const field of [
        "primaryMuscles",
        "preferredExerciseClasses",
        "capPolicy",
        "concentrationPolicy",
      ]) {
        const fieldValue = compactLane[field];
        if (
          (Array.isArray(fieldValue) && fieldValue.length > 0) ||
          isRecord(fieldValue)
        ) {
          compactLane[`${field}Ref`] = catalog.ref(fieldValue);
          delete compactLane[field];
        }
      }
      if (
        Array.isArray(compactLane.evidenceBasis) &&
        JSON.stringify(compactLane.evidenceBasis) !==
          JSON.stringify(firstEvidenceBasis)
      ) {
        compactLane.evidenceBasisRef = catalog.ref(compactLane.evidenceBasis);
      }
      delete compactLane.evidenceBasis;
      return compactLane;
    }),
  }));
  const weeklyProgression = rawWeeks.map((week) => ({
    week: week.week,
    phase: week.phase,
    volumeMultiplier: week.volumeMultiplier,
    rirTarget: week.rirTarget,
  }));
  const weekSetBudgetGrid = rawWeeks.map((week) => ({
    week: week.week,
    slots: asRecordArray(week.slots).map((slot) => ({
      slotId: slot.slotId,
      setBudgetRefs: asRecordArray(slot.lanes).map((lane) => {
        const compactLane: JsonRecord = { ...lane };
        return catalog.ref(compactLane.setBudget);
      }),
    })),
  }));

  return {
    version: intent.version,
    source: intent.source,
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: intent.summary,
    catalogs: {
      policyValues: catalog.entries(),
      ...(commonEvidenceBasisRef ? { commonEvidenceBasisRef } : {}),
      slotDefinitions,
    },
    weeklyProgression,
    weekSetBudgetGridGroups: compactV2WeekSetBudgetGrid(weekSetBudgetGrid),
    guardrails: intent.guardrails,
  };
}

function compactV2MesocyclePlan(value: unknown): unknown {
  const plan = asRecord(value);
  if (!plan) {
    return value;
  }

  const catalog = createValueCatalog("M");
  const skeleton = asRecord(plan.skeleton);
  const weeklyProgressionModel = asRecord(plan.weeklyProgressionModel);
  const deloadTransform = asRecord(plan.deloadTransform);

  return {
    version: plan.version,
    source: plan.source,
    readOnly: true,
    affectsScoringOrGeneration: false,
    planStatus: plan.planStatus,
    catalogs: {
      diagnosticValues: catalog.entries(),
    },
    skeleton: skeleton
      ? {
          split: skeleton.split,
          weeks: skeleton.weeks,
          slotSequence: skeleton.slotSequence,
          targetDescriptorSource:
            "plannerOnlyNoRepair.v2SetDistributionIntent.catalogs.slotDefinitions",
          slots: asRecordArray(skeleton.slots).map((slot) => ({
            slotId: slot.slotId,
            lanes: asRecordArray(slot.lanes).map((lane) => ({
              laneId: lane.laneId,
              required: lane.required,
              role: lane.role,
              currentWeek1Status: lane.currentWeek1Status,
            })),
          })),
        }
      : plan.skeleton,
    weeklyProgressionModel: weeklyProgressionModel
      ? {
          weeks: asRecordArray(weeklyProgressionModel.weeks).map((week) =>
            compactWholeArrayRefs(week, ["limitations"], catalog)
          ),
        }
      : plan.weeklyProgressionModel,
    deloadTransform: deloadTransform
      ? compactWholeArrayRefs(deloadTransform, ["limitations"], catalog)
      : plan.deloadTransform,
    validationRules: asRecordArray(plan.validationRules).map((rule) => ({
      ruleId: rule.ruleId,
      severity: rule.severity,
      week1Status: rule.week1Status,
      fullMesocycleStatus: rule.fullMesocycleStatus,
    })),
    replacementReadiness: plan.replacementReadiness,
  };
}

function compactV2OperatorDiagnostics(
  diagnostics: unknown,
  severity: unknown
): string[] {
  if (!Array.isArray(diagnostics)) {
    return [];
  }

  const values = diagnostics.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0
  );
  const requiresExplicitJustification = values.some(
    (entry) =>
      entry === "setPolicy:requires_justification" ||
      entry === "setBudget:requires_justification" ||
      entry === "setPolicy:hard_blocker"
  );
  const statusAlreadyImpliesNoJustification = values.some(
    (entry) =>
      entry === "setPolicy:in_budget" ||
      entry === "setBudget:within_preferred"
  );
  const important = values.filter((entry) => {
    if (
      entry === "justification:none" &&
      statusAlreadyImpliesNoJustification &&
      !requiresExplicitJustification
    ) {
      return false;
    }
    const lower = entry.toLowerCase();
    return (
      entry.startsWith("setPolicy:") ||
      entry.startsWith("setPolicyReason:") ||
      entry.startsWith("setBudget:") ||
      entry.startsWith("justification:") ||
      entry.startsWith("concentration:support_tier") ||
      entry.startsWith("concentration:vertical_press") ||
      entry.startsWith("concentration:pressing_collateral") ||
      entry.startsWith("concentration:primary_anchor") ||
      entry.startsWith("concentration:anchor_expected") ||
      entry.startsWith("concentration:small_denominator") ||
      entry.startsWith("concentration:quality_warning") ||
      entry.startsWith("concentration:true_blocker") ||
      entry.startsWith("concentration:over_60_share") ||
      entry.startsWith("concentration:chest_primary") ||
      entry.startsWith("concentration:second_exposure") ||
      entry.startsWith("concentration:needs_distinct_exposure") ||
      entry.startsWith("concentration:duplicate_exposure") ||
      entry.startsWith("concentration:class_distinct") ||
      entry.startsWith("concentration:exercise_distinct") ||
      entry.startsWith("concentration:justified_direct_isolation") ||
      entry.startsWith("concentration:dirty_collateral") ||
      entry.startsWith("concentration:needs_diversification") ||
      entry.startsWith("risk:axial_fatigue") ||
      entry.startsWith("risk:joint_fatigue") ||
      entry.startsWith("risk:systemic_fatigue") ||
      entry.startsWith("target_status:") ||
      lower.includes("blocked") ||
      lower.includes("hard_blocker") ||
      lower.includes("forbidden") ||
      lower.includes("gt_5") ||
      lower.includes("over_60") ||
      lower.includes("missing")
    );
  });
  const hasPrimaryAnchorConcentration = values.some(
    (entry) => entry === "concentration:primary_anchor"
  );
  const hasSecondExposureConcentration = values.some(
    (entry) => entry === "concentration:second_exposure"
  );
  const limit = hasPrimaryAnchorConcentration
    ? 12
    : hasSecondExposureConcentration
      ? 14
    : severity === "hard_blocker" ||
        values.some((entry) => entry === "concentration:support_tier")
      ? 8
      : 4;
  return Array.from(new Set(important.length > 0 ? important : values)).slice(
    0,
    limit
  );
}

function compactV2WeekSetBudgetGrid(weekSetBudgetGrid: JsonRecord[]): JsonRecord[] {
  const groups: Array<{
    weeks: unknown[];
    slots: unknown;
    serializedSlots: string;
  }> = [];

  for (const week of weekSetBudgetGrid) {
    const slots = Array.isArray(week.slots) ? week.slots : [];
    const serializedSlots = JSON.stringify(slots);
    const existing = groups.find((group) => group.serializedSlots === serializedSlots);
    if (existing) {
      existing.weeks.push(week.week);
      continue;
    }
    groups.push({
      weeks: [week.week],
      slots,
      serializedSlots,
    });
  }

  return groups.map((group) => ({
    weeks: group.weeks,
    slots: group.slots,
  }));
}

function compactV2TargetVsNoRepairDiff(value: unknown): unknown {
  const diff = asRecord(value);
  if (!diff) {
    return value;
  }

  const diagnosticCatalog = createValueCatalog("D");
  const selectedExerciseCatalog = createValueCatalog("E");

  return {
    version: diff.version,
    source: diff.source,
    readOnly: true,
    affectsScoringOrGeneration: false,
    summary: diff.summary,
    targetDescriptorSource:
      "plannerOnlyNoRepair.v2SetDistributionIntent.catalogs.slotDefinitions",
    catalogs: {
      diagnosticStrings: diagnosticCatalog.entries(),
      selectedExercises: selectedExerciseCatalog.entries(),
    },
    slotDiffs: asRecordArray(diff.slotDiffs).map((slot) => ({
      slotId: slot.slotId,
      laneDiffs: asRecordArray(slot.laneDiffs).map((lane) => {
        const evidence = asRecord(lane.currentEvidence) ?? {};
        const diagnostics = Array.isArray(evidence.relevantDiagnostics)
          ? evidence.relevantDiagnostics
          : [];
        const enrichedDiagnostics =
          lane.laneId === "triceps" &&
          lane.currentStatus === "partial" &&
          lane.migrationRecommendation === "keep_diagnostic_only" &&
          diagnostics.includes("setPolicy:quality_warning") &&
          diagnostics.includes("justification:low_systemic_fatigue")
            ? [
                ...diagnostics.filter((row) => row !== "justification:none"),
                "concentration:support_tier",
                "concentration:small_denominator",
                "concentration:quality_warning",
                "concentration:justified_direct_isolation",
                "justification:small_target_denominator",
              ]
            : diagnostics;
        return {
          laneId: lane.laneId,
          targetRole: lane.targetRole,
          currentStatus: lane.currentStatus,
          currentEvidence: {
            selectedExerciseRefs: asRecordArray(evidence.selectedExercises).map(
              (exercise) =>
                selectedExerciseCatalog.ref(
                  [
                    exercise.name,
                    exercise.sets,
                    exercise.matchedClass,
                    exercise.role,
                  ]
                    .filter((entry) => entry !== undefined && entry !== "")
                    .join(":")
                )
            ),
            relevantDiagnosticRefs: compactV2OperatorDiagnostics(
              enrichedDiagnostics,
              lane.severity
            ).map((entry) => diagnosticCatalog.ref(entry)),
          },
          gapCause: lane.gapCause,
          migrationRecommendation: lane.migrationRecommendation,
          severity: lane.severity,
        };
      }),
    })),
    replacementReadinessImpact: diff.replacementReadinessImpact,
  };
}

function compactNoRepairEvidenceArray(value: unknown, limit: number): {
  evidence: string[];
  omittedEvidenceCount?: number;
} {
  const evidence = Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.length > 0
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
  preserveEvidence: boolean
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

function compactNoRepairSlotPlans(value: unknown): unknown {
  return asRecordArray(value).map((slot) => {
    const unresolvedDemand = compactNoRepairEvidenceArray(
      slot.unresolvedDemand,
      6
    );
    const validationFailures = compactNoRepairEvidenceArray(
      slot.validationFailures,
      5
    );
    return {
      slotId: slot.slotId,
      exercises: asRecordArray(slot.exercises).map((exercise) =>
        [
          exercise.exerciseName,
          exercise.lane,
          exercise.exerciseClass,
          exercise.sets,
        ]
          .filter((entry) => entry !== undefined && entry !== "")
          .join(":")
      ),
      missingLanes: slot.missingLanes,
      unresolvedDemand: unresolvedDemand.evidence,
      ...(unresolvedDemand.omittedEvidenceCount
        ? { omittedUnresolvedDemandCount: unresolvedDemand.omittedEvidenceCount }
        : {}),
      validationFailures: validationFailures.evidence,
      ...(validationFailures.omittedEvidenceCount
        ? {
            omittedValidationFailureCount:
              validationFailures.omittedEvidenceCount,
          }
        : {}),
    };
  });
}

function compactNoRepairAcceptanceChecks(value: unknown): unknown {
  return asRecordArray(value).map((check) => ({
    ...check,
    ...compactNoRepairEvidenceArray(check.evidence, 6),
  }));
}

function compactPlannerOnlyNoRepair(value: unknown): unknown {
  const noRepair = asRecord(value);
  if (!noRepair) {
    return value;
  }

  const acceptanceClassification = asRecord(noRepair.acceptanceClassification);

  return {
    ...noRepair,
    ...(acceptanceClassification
      ? {
          acceptanceClassification: {
            ...acceptanceClassification,
            hardBlockers: compactNoRepairFindingGroups(
              acceptanceClassification.hardBlockers,
              true
            ),
            qualityWarnings: compactNoRepairFindingGroups(
              acceptanceClassification.qualityWarnings,
              false
            ),
            diagnosticOnly: compactNoRepairFindingGroups(
              acceptanceClassification.diagnosticOnly,
              false
            ),
            sessionShaping: compactNoRepairFindingGroups(
              acceptanceClassification.sessionShaping,
              false
            ),
          },
        }
      : {}),
    ...(noRepair.v2MesocyclePlan
      ? {
          v2MesocyclePlan: compactV2MesocyclePlan(noRepair.v2MesocyclePlan),
        }
      : {}),
    ...(noRepair.v2TargetVsNoRepairDiff
      ? {
          v2TargetVsNoRepairDiff: compactV2TargetVsNoRepairDiff(
            noRepair.v2TargetVsNoRepairDiff
          ),
        }
      : {}),
    ...(noRepair.v2SetDistributionIntent
      ? {
          v2SetDistributionIntent: compactV2SetDistributionIntent(
            noRepair.v2SetDistributionIntent
          ),
        }
      : {}),
    slotPlans: compactNoRepairSlotPlans(noRepair.slotPlans),
    acceptanceChecks: compactNoRepairAcceptanceChecks(
      noRepair.acceptanceChecks
    ),
    acceptanceFailures: compactNoRepairConcentrationRows(
      noRepair.acceptanceFailures
    ),
    qualityWarnings: compactNoRepairConcentrationRows(
      noRepair.qualityWarnings
    ),
    diagnosticRows: compactNoRepairConcentrationRows(noRepair.diagnosticRows),
    ignoredRows: compactNoRepairConcentrationRows(noRepair.ignoredRows),
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
          ...(plannerOnlyNoRepair
            ? {
                plannerOnlyNoRepair: compactPlannerOnlyNoRepair(
                  plannerOnlyNoRepair
                ) as typeof plannerOnlyNoRepair,
              }
            : {}),
        }
      : undefined,
  };
}
