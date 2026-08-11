import {
  CANONICAL_MUSCLE_IDS,
  type CanonicalMuscleId,
} from "@/lib/engine/muscle-policy";

// Immutable stored identity grammar: one or more lowercase ASCII alphanumeric
// segments separated by single hyphens.
export const CATALOG_KEY_GRAMMAR = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const CANONICAL_STIMULUS_DISPOSITIONS = [
  "COMPLETE",
  "NOT_APPLICABLE",
  "AMBIGUOUS",
  "UNSUPPORTED",
  "MISSING",
] as const;

export type CanonicalStimulusDisposition =
  (typeof CANONICAL_STIMULUS_DISPOSITIONS)[number];

export type CompleteCanonicalStimulusFactsV1 = {
  disposition: "COMPLETE";
  profile: Partial<Record<CanonicalMuscleId, number>>;
};

export type IncompleteCanonicalStimulusFactsV1 = {
  disposition: Exclude<CanonicalStimulusDisposition, "COMPLETE">;
  profile?: never;
};

export type CanonicalStimulusFactsV1 =
  | CompleteCanonicalStimulusFactsV1
  | IncompleteCanonicalStimulusFactsV1;

// Stage 2 owns this contract. Stage 1 deliberately establishes only the optional
// composition seam and rejects any populated taxonomy object.
export type CanonicalTaxonomyFactsV1 = Readonly<Record<string, unknown>>;

export type CanonicalExerciseFactsV1 = {
  version: 1;
  stimulus: CanonicalStimulusFactsV1;
  taxonomy?: CanonicalTaxonomyFactsV1;
};

export type CanonicalFactsAuthoringEntry = {
  catalogKey: string;
  facts: unknown;
};

const MUSCLE_IDS = new Set<string>(CANONICAL_MUSCLE_IDS);
const STIMULUS_DISPOSITIONS = new Set<string>(
  CANONICAL_STIMULUS_DISPOSITIONS,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

export function validateCanonicalExerciseFactsV1(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["CANONICAL_FACTS_NOT_OBJECT"];
  }

  for (const key of unknownKeys(value, new Set(["version", "stimulus", "taxonomy"]))) {
    errors.push(`CANONICAL_FACTS_UNKNOWN_FIELD:${key}`);
  }
  if (value.version !== 1) {
    errors.push("CANONICAL_FACTS_VERSION_INVALID");
  }
  if (Object.prototype.hasOwnProperty.call(value, "taxonomy")) {
    errors.push("CANONICAL_FACTS_TAXONOMY_DEFERRED");
  }

  const stimulus = value.stimulus;
  if (!isRecord(stimulus)) {
    errors.push("CANONICAL_STIMULUS_NOT_OBJECT");
    return errors.sort((left, right) => left.localeCompare(right));
  }

  const disposition = stimulus.disposition;
  if (typeof disposition !== "string" || !STIMULUS_DISPOSITIONS.has(disposition)) {
    errors.push("CANONICAL_STIMULUS_DISPOSITION_INVALID");
  }

  const complete = disposition === "COMPLETE";
  const allowedStimulusFields = complete
    ? new Set(["disposition", "profile"])
    : new Set(["disposition"]);
  for (const key of unknownKeys(stimulus, allowedStimulusFields)) {
    errors.push(`CANONICAL_STIMULUS_FIELD_INCOMPATIBLE:${key}`);
  }

  if (!complete) {
    return errors.sort((left, right) => left.localeCompare(right));
  }

  const profile = stimulus.profile;
  if (!isRecord(profile)) {
    errors.push("CANONICAL_STIMULUS_COMPLETE_PROFILE_INVALID");
    return errors.sort((left, right) => left.localeCompare(right));
  }
  if (Object.keys(profile).length === 0) {
    errors.push("CANONICAL_STIMULUS_COMPLETE_PROFILE_EMPTY");
  }
  for (const [muscleId, weight] of Object.entries(profile)) {
    if (!MUSCLE_IDS.has(muscleId)) {
      errors.push(`CANONICAL_STIMULUS_MUSCLE_UNKNOWN:${muscleId}`);
    }
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
      errors.push(`CANONICAL_STIMULUS_WEIGHT_INVALID:${muscleId}`);
    }
  }

  return errors.sort((left, right) => left.localeCompare(right));
}

export function parseCanonicalExerciseFactsV1(
  value: unknown,
): CanonicalExerciseFactsV1 {
  const errors = validateCanonicalExerciseFactsV1(value);
  if (errors.length > 0) {
    throw new Error(
      [
        "Canonical exercise facts are invalid:",
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
  return value as CanonicalExerciseFactsV1;
}

export function indexCanonicalFactsByCatalogKey(
  entries: readonly CanonicalFactsAuthoringEntry[],
): ReadonlyMap<string, CanonicalExerciseFactsV1> {
  const byCatalogKey = new Map<string, CanonicalExerciseFactsV1>();
  for (const entry of entries) {
    if (!CATALOG_KEY_GRAMMAR.test(entry.catalogKey)) {
      throw new Error(`Invalid catalog key: ${entry.catalogKey}`);
    }
    if (byCatalogKey.has(entry.catalogKey)) {
      throw new Error(`Duplicate catalog key: ${entry.catalogKey}`);
    }
    byCatalogKey.set(
      entry.catalogKey,
      parseCanonicalExerciseFactsV1(entry.facts),
    );
  }
  return byCatalogKey;
}
