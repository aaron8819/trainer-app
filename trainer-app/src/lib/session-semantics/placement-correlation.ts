export type PlacementCorrelationRecord = {
  generatedPlacementId: string;
  persistedWorkoutExerciseId: string;
};

export type PlacementCorrelationIssueCode =
  | "malformed_explicit_correlation"
  | "unknown_generated_source"
  | "invalid_explicit_target"
  | "duplicate_explicit_source"
  | "duplicate_explicit_target";

export type PlacementCorrelationIssue = {
  code: PlacementCorrelationIssueCode;
  recordIndexes: number[];
  generatedPlacementId?: string;
  persistedWorkoutExerciseId?: string;
};

export type PlacementCorrelationOccurrence<T> = {
  occurrenceId?: string;
  exerciseId: string;
  value: T;
};

export type ResolvedPlacementCorrelationPair<TGenerated, TPersisted> = {
  source: "explicit" | "legacy_unique";
  generated: PlacementCorrelationOccurrence<TGenerated>;
  persisted: PlacementCorrelationOccurrence<TPersisted>;
};

export type ResolvedPlacementCorrelation<TGenerated, TPersisted> = {
  state:
    | "resolved"
    | "ambiguous_legacy_correlation"
    | "invalid_explicit_correlation";
  rawCorrelationState: "absent" | "present";
  pairs: Array<ResolvedPlacementCorrelationPair<TGenerated, TPersisted>>;
  generatedToPersisted: Map<string, string>;
  persistedToGenerated: Map<string, string>;
  unresolvedGenerated: Array<PlacementCorrelationOccurrence<TGenerated>>;
  unresolvedPersisted: Array<PlacementCorrelationOccurrence<TPersisted>>;
  ambiguousExerciseIds: string[];
  invalidExplicitMappings: PlacementCorrelationIssue[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function addGroupedIndex(map: Map<string, number[]>, key: string, index: number): void {
  const indexes = map.get(key) ?? [];
  indexes.push(index);
  map.set(key, indexes);
}

/**
 * The only business-rule owner for interpreting saved generated-to-persisted
 * placement correlations. Raw metadata is untrusted. Explicit records are
 * validated before legacy canonical matching is considered.
 */
export function resolvePlacementCorrelations<TGenerated, TPersisted>(input: {
  generatedOccurrences: Array<PlacementCorrelationOccurrence<TGenerated>>;
  persistedOccurrences: Array<PlacementCorrelationOccurrence<TPersisted>>;
  rawCorrelations: unknown;
}): ResolvedPlacementCorrelation<TGenerated, TPersisted> {
  const rawCorrelationState = input.rawCorrelations === undefined ? "absent" : "present";
  const generatedById = new Map(
    input.generatedOccurrences.flatMap((occurrence) =>
      occurrence.occurrenceId ? [[occurrence.occurrenceId, occurrence] as const] : [],
    ),
  );
  const persistedById = new Map(
    input.persistedOccurrences.flatMap((occurrence) =>
      occurrence.occurrenceId ? [[occurrence.occurrenceId, occurrence] as const] : [],
    ),
  );
  const issues: PlacementCorrelationIssue[] = [];
  const blockedGeneratedIds = new Set<string>();
  const blockedPersistedIds = new Set<string>();
  let blockAllLegacyFallback = false;

  const parsedRecords: Array<PlacementCorrelationRecord & { recordIndex: number }> = [];
  if (input.rawCorrelations !== undefined && !Array.isArray(input.rawCorrelations)) {
    issues.push({ code: "malformed_explicit_correlation", recordIndexes: [] });
    blockAllLegacyFallback = true;
  } else {
    for (const [recordIndex, rawRecord] of (input.rawCorrelations ?? []).entries()) {
      const record = isRecord(rawRecord) ? rawRecord : undefined;
      const generatedPlacementId = readNonEmptyString(record?.generatedPlacementId);
      const persistedWorkoutExerciseId = readNonEmptyString(
        record?.persistedWorkoutExerciseId,
      );
      if (!generatedPlacementId || !persistedWorkoutExerciseId) {
        issues.push({
          code: "malformed_explicit_correlation",
          recordIndexes: [recordIndex],
          ...(generatedPlacementId ? { generatedPlacementId } : {}),
          ...(persistedWorkoutExerciseId ? { persistedWorkoutExerciseId } : {}),
        });
        if (generatedPlacementId) blockedGeneratedIds.add(generatedPlacementId);
        if (persistedWorkoutExerciseId) blockedPersistedIds.add(persistedWorkoutExerciseId);
        if (!generatedPlacementId && !persistedWorkoutExerciseId) {
          blockAllLegacyFallback = true;
        }
        continue;
      }
      parsedRecords.push({ generatedPlacementId, persistedWorkoutExerciseId, recordIndex });
    }
  }

  const recordIndexesBySource = new Map<string, number[]>();
  const recordIndexesByTarget = new Map<string, number[]>();
  for (const record of parsedRecords) {
    addGroupedIndex(recordIndexesBySource, record.generatedPlacementId, record.recordIndex);
    addGroupedIndex(recordIndexesByTarget, record.persistedWorkoutExerciseId, record.recordIndex);
  }

  const invalidRecordIndexes = new Set<number>();
  // Saved correlation serialization has no legitimate duplicate-record form.
  // Reject duplicate-identical records with the same cardinality rules as
  // conflicting duplicates instead of silently normalizing malformed input.
  for (const [generatedPlacementId, recordIndexes] of recordIndexesBySource) {
    if (recordIndexes.length <= 1) continue;
    issues.push({
      code: "duplicate_explicit_source",
      recordIndexes: [...recordIndexes],
      generatedPlacementId,
    });
    blockedGeneratedIds.add(generatedPlacementId);
    for (const record of parsedRecords.filter((entry) => recordIndexes.includes(entry.recordIndex))) {
      invalidRecordIndexes.add(record.recordIndex);
      blockedPersistedIds.add(record.persistedWorkoutExerciseId);
    }
  }
  for (const [persistedWorkoutExerciseId, recordIndexes] of recordIndexesByTarget) {
    if (recordIndexes.length <= 1) continue;
    issues.push({
      code: "duplicate_explicit_target",
      recordIndexes: [...recordIndexes],
      persistedWorkoutExerciseId,
    });
    blockedPersistedIds.add(persistedWorkoutExerciseId);
    for (const record of parsedRecords.filter((entry) => recordIndexes.includes(entry.recordIndex))) {
      invalidRecordIndexes.add(record.recordIndex);
      blockedGeneratedIds.add(record.generatedPlacementId);
    }
  }

  for (const record of parsedRecords) {
    if (!generatedById.has(record.generatedPlacementId)) {
      issues.push({
        code: "unknown_generated_source",
        recordIndexes: [record.recordIndex],
        generatedPlacementId: record.generatedPlacementId,
        persistedWorkoutExerciseId: record.persistedWorkoutExerciseId,
      });
      invalidRecordIndexes.add(record.recordIndex);
    }
    if (!persistedById.has(record.persistedWorkoutExerciseId)) {
      issues.push({
        code: "invalid_explicit_target",
        recordIndexes: [record.recordIndex],
        generatedPlacementId: record.generatedPlacementId,
        persistedWorkoutExerciseId: record.persistedWorkoutExerciseId,
      });
      invalidRecordIndexes.add(record.recordIndex);
      blockedGeneratedIds.add(record.generatedPlacementId);
    }
  }

  const pairs: Array<ResolvedPlacementCorrelationPair<TGenerated, TPersisted>> = [];
  const matchedGenerated = new Set<PlacementCorrelationOccurrence<TGenerated>>();
  const matchedPersisted = new Set<PlacementCorrelationOccurrence<TPersisted>>();
  for (const record of parsedRecords) {
    if (invalidRecordIndexes.has(record.recordIndex)) continue;
    const generated = generatedById.get(record.generatedPlacementId);
    const persisted = persistedById.get(record.persistedWorkoutExerciseId);
    if (!generated || !persisted) continue;
    pairs.push({ source: "explicit", generated, persisted });
    matchedGenerated.add(generated);
    matchedPersisted.add(persisted);
  }

  const legacyGenerated = input.generatedOccurrences.filter(
    (occurrence) =>
      !matchedGenerated.has(occurrence) &&
      !blockAllLegacyFallback &&
      (!occurrence.occurrenceId || !blockedGeneratedIds.has(occurrence.occurrenceId)),
  );
  const legacyPersisted = input.persistedOccurrences.filter(
    (occurrence) =>
      !matchedPersisted.has(occurrence) &&
      !blockAllLegacyFallback &&
      (!occurrence.occurrenceId || !blockedPersistedIds.has(occurrence.occurrenceId)),
  );
  const generatedByExerciseId = new Map<
    string,
    Array<PlacementCorrelationOccurrence<TGenerated>>
  >();
  const persistedByExerciseId = new Map<
    string,
    Array<PlacementCorrelationOccurrence<TPersisted>>
  >();
  for (const occurrence of legacyGenerated) {
    const occurrences = generatedByExerciseId.get(occurrence.exerciseId) ?? [];
    occurrences.push(occurrence);
    generatedByExerciseId.set(occurrence.exerciseId, occurrences);
  }
  for (const occurrence of legacyPersisted) {
    const occurrences = persistedByExerciseId.get(occurrence.exerciseId) ?? [];
    occurrences.push(occurrence);
    persistedByExerciseId.set(occurrence.exerciseId, occurrences);
  }

  const ambiguousExerciseIds = new Set<string>();
  for (const exerciseId of new Set([
    ...generatedByExerciseId.keys(),
    ...persistedByExerciseId.keys(),
  ])) {
    const generated = generatedByExerciseId.get(exerciseId) ?? [];
    const persisted = persistedByExerciseId.get(exerciseId) ?? [];
    if (generated.length === 1 && persisted.length === 1) {
      pairs.push({ source: "legacy_unique", generated: generated[0]!, persisted: persisted[0]! });
      matchedGenerated.add(generated[0]!);
      matchedPersisted.add(persisted[0]!);
    } else if (generated.length > 0 && persisted.length > 0) {
      ambiguousExerciseIds.add(exerciseId);
    }
  }

  const generatedToPersisted = new Map<string, string>();
  const persistedToGenerated = new Map<string, string>();
  for (const pair of pairs) {
    if (!pair.generated.occurrenceId || !pair.persisted.occurrenceId) continue;
    generatedToPersisted.set(pair.generated.occurrenceId, pair.persisted.occurrenceId);
    persistedToGenerated.set(pair.persisted.occurrenceId, pair.generated.occurrenceId);
  }

  return {
    state:
      issues.length > 0
        ? "invalid_explicit_correlation"
        : ambiguousExerciseIds.size > 0
          ? "ambiguous_legacy_correlation"
          : "resolved",
    rawCorrelationState,
    pairs,
    generatedToPersisted,
    persistedToGenerated,
    unresolvedGenerated: input.generatedOccurrences.filter(
      (occurrence) => !matchedGenerated.has(occurrence),
    ),
    unresolvedPersisted: input.persistedOccurrences.filter(
      (occurrence) => !matchedPersisted.has(occurrence),
    ),
    ambiguousExerciseIds: [...ambiguousExerciseIds].sort(),
    invalidExplicitMappings: issues.sort(
      (left, right) =>
        (left.recordIndexes[0] ?? -1) - (right.recordIndexes[0] ?? -1) ||
        left.code.localeCompare(right.code),
    ),
  };
}
