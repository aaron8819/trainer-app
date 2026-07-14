import { createHash } from "node:crypto";
import {
  resolveStimulusProfile,
  toMuscleId,
  toMuscleLabel,
} from "@/lib/engine/stimulus";
import type {
  Exercise,
  Muscle,
  MuscleId,
  StimulusProfile,
} from "@/lib/engine/types";

export const EXERCISE_STIMULUS_SNAPSHOT_VERSION = 1 as const;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VALUE_PRECISION = 6;

export type ExerciseStimulusSnapshotProvenance =
  | "exact"
  | "legacy_derived";

export type ExerciseStimulusContribution = {
  muscleId: MuscleId;
  effectiveSetsPerQualifyingSet: number;
};

export type ExerciseStimulusRelationship = {
  muscleId: MuscleId;
  role: "primary" | "secondary";
};

export type ExerciseStimulusSnapshot = {
  version: typeof EXERCISE_STIMULUS_SNAPSHOT_VERSION;
  sourceExerciseId: string;
  contributions: ExerciseStimulusContribution[];
  relationships: ExerciseStimulusRelationship[];
  policyHash: string;
  provenance: ExerciseStimulusSnapshotProvenance;
};

export type ExerciseStimulusAccountingEvidence = {
  contractVersion: typeof EXERCISE_STIMULUS_SNAPSHOT_VERSION;
  snapshotHash: string;
  provenance: ExerciseStimulusSnapshotProvenance;
};

export type HistoricalStimulusAccountingResolution = {
  snapshot: ExerciseStimulusSnapshot | null;
  provenance:
    | ExerciseStimulusSnapshotProvenance
    | "legacy_unknown";
  integrity: "verified" | "derived_current_policy" | "missing" | "invalid";
};

export type StimulusSnapshotExerciseSource = Pick<
  Exercise,
  "id" | "name" | "primaryMuscles" | "secondaryMuscles" | "stimulusProfile"
> & {
  aliases?: string[];
};

type JsonRecord = Record<string, unknown>;

function toObject(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function normalizeContributionValue(value: number): number {
  return Number(value.toFixed(VALUE_PRECISION));
}

function normalizeContributions(
  contributions: ExerciseStimulusContribution[]
): ExerciseStimulusContribution[] {
  return contributions
    .map((entry) => ({
      muscleId: entry.muscleId,
      effectiveSetsPerQualifyingSet: normalizeContributionValue(
        entry.effectiveSetsPerQualifyingSet
      ),
    }))
    .sort((left, right) => left.muscleId.localeCompare(right.muscleId));
}

function normalizeRelationships(
  relationships: ExerciseStimulusRelationship[]
): ExerciseStimulusRelationship[] {
  return [...relationships].sort((left, right) => {
    const muscleOrder = left.muscleId.localeCompare(right.muscleId);
    return muscleOrder !== 0 ? muscleOrder : left.role.localeCompare(right.role);
  });
}

function buildHashPayload(input: {
  version: number;
  contributions: ExerciseStimulusContribution[];
  relationships: ExerciseStimulusRelationship[];
}): string {
  return JSON.stringify({
    version: input.version,
    contributions: normalizeContributions(input.contributions).map((entry) => ({
      muscleId: entry.muscleId,
      effectiveSetsPerQualifyingSet:
        entry.effectiveSetsPerQualifyingSet.toFixed(VALUE_PRECISION),
    })),
    relationships: normalizeRelationships(input.relationships),
  });
}

export function hashExerciseStimulusAccounting(input: {
  version: number;
  contributions: ExerciseStimulusContribution[];
  relationships: ExerciseStimulusRelationship[];
}): string {
  return createHash("sha256").update(buildHashPayload(input)).digest("hex");
}

function relationshipsFromExercise(
  exercise: StimulusSnapshotExerciseSource
): ExerciseStimulusRelationship[] {
  const relationships = new Map<string, ExerciseStimulusRelationship>();
  for (const [role, muscles] of [
    ["primary", exercise.primaryMuscles ?? []],
    ["secondary", exercise.secondaryMuscles ?? []],
  ] as const) {
    for (const muscle of muscles) {
      const muscleId = toMuscleId(muscle);
      if (!muscleId) {
        continue;
      }
      const key = `${muscleId}:${role}`;
      relationships.set(key, { muscleId, role });
    }
  }
  return normalizeRelationships(Array.from(relationships.values()));
}

function contributionsFromProfile(
  profile: StimulusProfile
): ExerciseStimulusContribution[] {
  return normalizeContributions(
    Object.entries(profile).flatMap(([muscleId, value]) => {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value <= 0
      ) {
        return [];
      }
      return [
        {
          muscleId: muscleId as MuscleId,
          effectiveSetsPerQualifyingSet: value,
        },
      ];
    })
  );
}

export function buildExerciseStimulusSnapshot(
  exercise: StimulusSnapshotExerciseSource,
  provenance: ExerciseStimulusSnapshotProvenance
): ExerciseStimulusSnapshot {
  const contributions = contributionsFromProfile(
    resolveStimulusProfile(exercise, { logFallback: false })
  );
  if (contributions.length === 0) {
    throw new Error(`STIMULUS_ACCOUNTING_PROFILE_MISSING:${exercise.id}`);
  }

  const relationships = relationshipsFromExercise(exercise);
  const policyHash = hashExerciseStimulusAccounting({
    version: EXERCISE_STIMULUS_SNAPSHOT_VERSION,
    contributions,
    relationships,
  });

  return {
    version: EXERCISE_STIMULUS_SNAPSHOT_VERSION,
    sourceExerciseId: exercise.id,
    contributions,
    relationships,
    policyHash,
    provenance,
  };
}

function parseContribution(value: unknown): ExerciseStimulusContribution | null {
  const record = toObject(value);
  if (!record || typeof record.muscleId !== "string") {
    return null;
  }
  const muscleId = toMuscleId(record.muscleId);
  const contribution = record.effectiveSetsPerQualifyingSet;
  if (
    !muscleId ||
    typeof contribution !== "number" ||
    !Number.isFinite(contribution) ||
    contribution < 0
  ) {
    return null;
  }
  return {
    muscleId,
    effectiveSetsPerQualifyingSet: normalizeContributionValue(contribution),
  };
}

function parseRelationship(value: unknown): ExerciseStimulusRelationship | null {
  const record = toObject(value);
  if (!record || typeof record.muscleId !== "string") {
    return null;
  }
  const muscleId = toMuscleId(record.muscleId);
  if (
    !muscleId ||
    (record.role !== "primary" && record.role !== "secondary")
  ) {
    return null;
  }
  return { muscleId, role: record.role };
}

export function parseExerciseStimulusSnapshot(
  value: unknown
): ExerciseStimulusSnapshot | undefined {
  const record = toObject(value);
  if (
    !record ||
    record.version !== EXERCISE_STIMULUS_SNAPSHOT_VERSION ||
    typeof record.sourceExerciseId !== "string" ||
    record.sourceExerciseId.length === 0 ||
    !Array.isArray(record.contributions) ||
    !Array.isArray(record.relationships) ||
    typeof record.policyHash !== "string" ||
    !HASH_PATTERN.test(record.policyHash) ||
    (record.provenance !== "exact" && record.provenance !== "legacy_derived")
  ) {
    return undefined;
  }

  const contributions = record.contributions.map(parseContribution);
  const relationships = record.relationships.map(parseRelationship);
  if (contributions.some((entry) => entry == null) || relationships.some((entry) => entry == null)) {
    return undefined;
  }
  const normalizedContributions = normalizeContributions(
    contributions as ExerciseStimulusContribution[]
  );
  const normalizedRelationships = normalizeRelationships(
    relationships as ExerciseStimulusRelationship[]
  );
  if (
    normalizedContributions.length === 0 ||
    !normalizedContributions.some(
      (entry) => entry.effectiveSetsPerQualifyingSet > 0
    ) ||
    new Set(normalizedContributions.map((entry) => entry.muscleId)).size !==
      normalizedContributions.length ||
    new Set(
      normalizedRelationships.map((entry) => `${entry.muscleId}:${entry.role}`)
    ).size !== normalizedRelationships.length
  ) {
    return undefined;
  }

  const expectedHash = hashExerciseStimulusAccounting({
    version: EXERCISE_STIMULUS_SNAPSHOT_VERSION,
    contributions: normalizedContributions,
    relationships: normalizedRelationships,
  });
  if (expectedHash !== record.policyHash) {
    return undefined;
  }

  return {
    version: EXERCISE_STIMULUS_SNAPSHOT_VERSION,
    sourceExerciseId: record.sourceExerciseId,
    contributions: normalizedContributions,
    relationships: normalizedRelationships,
    policyHash: expectedHash,
    provenance: record.provenance,
  };
}

export function resolveHistoricalStimulusAccounting(input: {
  persistedSnapshot: unknown;
  exercise?: StimulusSnapshotExerciseSource | null;
}): HistoricalStimulusAccountingResolution {
  if (input.persistedSnapshot != null) {
    const snapshot = parseExerciseStimulusSnapshot(input.persistedSnapshot);
    const sourceMatches =
      snapshot &&
      (!input.exercise || snapshot.sourceExerciseId === input.exercise.id);
    return sourceMatches
      ? {
          snapshot: snapshot!,
          provenance: snapshot!.provenance,
          integrity: "verified",
        }
      : {
          snapshot: null,
          provenance: "legacy_unknown",
          integrity: "invalid",
        };
  }

  if (!input.exercise) {
    return {
      snapshot: null,
      provenance: "legacy_unknown",
      integrity: "missing",
    };
  }

  try {
    const snapshot = buildExerciseStimulusSnapshot(
      input.exercise,
      "legacy_derived"
    );
    return {
      snapshot,
      provenance: "legacy_derived",
      integrity: "derived_current_policy",
    };
  } catch {
    return {
      snapshot: null,
      provenance: "legacy_unknown",
      integrity: "missing",
    };
  }
}

export function getEffectiveStimulusFromSnapshot(
  snapshot: ExerciseStimulusSnapshot,
  qualifyingSetCount: number
): Map<Muscle, number> {
  const setCount = Number.isFinite(qualifyingSetCount)
    ? Math.max(0, qualifyingSetCount)
    : 0;
  return new Map(
    snapshot.contributions.map((entry) => [
      toMuscleLabel(entry.muscleId),
      entry.effectiveSetsPerQualifyingSet * setCount,
    ])
  );
}

export function getRelationshipMusclesFromSnapshot(
  snapshot: ExerciseStimulusSnapshot,
  role: ExerciseStimulusRelationship["role"]
): Muscle[] {
  return snapshot.relationships
    .filter((entry) => entry.role === role)
    .map((entry) => toMuscleLabel(entry.muscleId));
}

export function toExerciseStimulusAccountingEvidence(
  snapshot: ExerciseStimulusSnapshot
): ExerciseStimulusAccountingEvidence {
  return {
    contractVersion: snapshot.version,
    snapshotHash: snapshot.policyHash,
    provenance: snapshot.provenance,
  };
}
