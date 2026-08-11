import {
  CANONICAL_MOVEMENT_PATTERN_VALUES,
  DIFFICULTY_VALUES,
  EQUIPMENT_TYPE_VALUES,
  JOINT_STRESS_VALUES,
  LEGACY_MOVEMENT_PATTERN_ALIAS_VALUES,
  SPLIT_TAG_VALUES,
  STIMULUS_BIAS_VALUES,
} from "@/lib/engine/types";
import { MUSCLE_POLICY_BY_ID } from "@/lib/engine/muscle-policy";
import { parseMeasurementColumns } from "@/lib/exercise-measurement/semantics";
import { normalizeSearchText } from "@/lib/exercise-library/search";

export type CatalogExerciseDefinition = {
  name: string;
  movementPatterns: string[];
  splitTag: string;
  isCompound: boolean;
  isMainLiftEligible: boolean;
  jointStress: string;
  equipment: string[];
  fatigueCost: number;
  sfrScore: number;
  lengthPositionScore: number;
  stimulusBias: string[];
  contraindications: Record<string, unknown> | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  difficulty?: string;
  unilateral?: boolean;
  repRangeRecommendation?: { min: number; max: number };
  timePerSetSec?: number;
  measurementProfile?: string | null;
  loadConvention?: string | null;
  repBasis?: string | null;
};

export type CatalogAliasDefinition = {
  exerciseName: string;
  alias: string;
};

const MOVEMENT_PATTERNS = new Set<string>([
  ...CANONICAL_MOVEMENT_PATTERN_VALUES,
  ...LEGACY_MOVEMENT_PATTERN_ALIAS_VALUES,
]);
const SPLIT_TAGS = new Set<string>(SPLIT_TAG_VALUES);
const JOINT_STRESS = new Set<string>(JOINT_STRESS_VALUES);
const STIMULUS_BIASES = new Set<string>(STIMULUS_BIAS_VALUES);
const DIFFICULTIES = new Set<string>(DIFFICULTY_VALUES);
const EQUIPMENT = new Set<string>(EQUIPMENT_TYPE_VALUES);
const MUSCLES = new Set<string>(
  Object.values(MUSCLE_POLICY_BY_ID).map((policy) => policy.displayName),
);

export function normalizeCatalogIdentityKey(value: string): string {
  return normalizeSearchText(value);
}

function normalizeVocabularyToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function validateVocabulary(input: {
  exerciseName: string;
  dimension: string;
  values: readonly string[];
  allowed: ReadonlySet<string>;
  normalize?: (value: string) => string;
}): string[] {
  const normalize = input.normalize ?? ((value: string) => value.trim());
  return input.values.flatMap((value) => {
    const token = normalize(value);
    return input.allowed.has(token)
      ? []
      : [`CATALOG_${input.dimension}_UNKNOWN:${input.exerciseName}:${value}`];
  });
}

export function validateCatalogInvariants(input: {
  exercises: readonly CatalogExerciseDefinition[];
  aliases: readonly CatalogAliasDefinition[];
}): string[] {
  const errors: string[] = [];
  const canonicalByExactName = new Map<string, CatalogExerciseDefinition>();
  const canonicalByNormalizedName = new Map<string, CatalogExerciseDefinition>();

  for (const exercise of input.exercises) {
    const normalizedName = normalizeCatalogIdentityKey(exercise.name);
    const existing = canonicalByNormalizedName.get(normalizedName);
    if (!normalizedName) {
      errors.push("CATALOG_CANONICAL_NAME_EMPTY");
    } else if (existing) {
      errors.push(
        `CATALOG_CANONICAL_NAME_DUPLICATE:${exercise.name}:conflicts_with:${existing.name}`,
      );
    } else {
      canonicalByNormalizedName.set(normalizedName, exercise);
    }
    canonicalByExactName.set(exercise.name, exercise);

    if (exercise.primaryMuscles.length === 0) {
      errors.push(`CATALOG_PRIMARY_MUSCLES_EMPTY:${exercise.name}`);
    }
    const primaryKeys = new Set(
      exercise.primaryMuscles.map(normalizeCatalogIdentityKey),
    );
    for (const secondaryMuscle of exercise.secondaryMuscles) {
      if (primaryKeys.has(normalizeCatalogIdentityKey(secondaryMuscle))) {
        errors.push(
          `CATALOG_MUSCLE_ROLE_OVERLAP:${exercise.name}:${secondaryMuscle}`,
        );
      }
    }

    errors.push(
      ...validateVocabulary({
        exerciseName: exercise.name,
        dimension: "MOVEMENT_PATTERN",
        values: exercise.movementPatterns,
        allowed: MOVEMENT_PATTERNS,
        normalize: (value) => value.trim().toLowerCase(),
      }),
      ...validateVocabulary({
        exerciseName: exercise.name,
        dimension: "PRIMARY_MUSCLE",
        values: exercise.primaryMuscles,
        allowed: MUSCLES,
      }),
      ...validateVocabulary({
        exerciseName: exercise.name,
        dimension: "SECONDARY_MUSCLE",
        values: exercise.secondaryMuscles,
        allowed: MUSCLES,
      }),
      ...validateVocabulary({
        exerciseName: exercise.name,
        dimension: "EQUIPMENT",
        values: exercise.equipment,
        allowed: EQUIPMENT,
        normalize: normalizeVocabularyToken,
      }),
      ...validateVocabulary({
        exerciseName: exercise.name,
        dimension: "SPLIT_TAG",
        values: [exercise.splitTag],
        allowed: SPLIT_TAGS,
        normalize: (value) => value.trim().toLowerCase(),
      }),
      ...validateVocabulary({
        exerciseName: exercise.name,
        dimension: "JOINT_STRESS",
        values: [exercise.jointStress],
        allowed: JOINT_STRESS,
        normalize: (value) => value.trim().toLowerCase(),
      }),
      ...validateVocabulary({
        exerciseName: exercise.name,
        dimension: "STIMULUS_BIAS",
        values: exercise.stimulusBias,
        allowed: STIMULUS_BIASES,
        normalize: (value) => value.trim().toLowerCase(),
      }),
      ...validateVocabulary({
        exerciseName: exercise.name,
        dimension: "DIFFICULTY",
        values: [exercise.difficulty ?? "beginner"],
        allowed: DIFFICULTIES,
        normalize: (value) => value.trim().toLowerCase(),
      }),
    );

    try {
      parseMeasurementColumns({
        measurementProfile: exercise.measurementProfile ?? null,
        loadConvention: exercise.loadConvention ?? null,
        repBasis: exercise.repBasis ?? null,
      });
    } catch {
      errors.push(`CATALOG_MEASUREMENT_INVALID:${exercise.name}`);
    }

    if (exercise.isMainLiftEligible && !exercise.isCompound) {
      errors.push(`CATALOG_MAIN_LIFT_REQUIRES_COMPOUND:${exercise.name}`);
    }
  }

  const aliasByNormalizedName = new Map<string, CatalogAliasDefinition>();
  for (const alias of input.aliases) {
    const normalizedAlias = normalizeCatalogIdentityKey(alias.alias);
    const existingAlias = aliasByNormalizedName.get(normalizedAlias);
    if (!normalizedAlias) {
      errors.push(`CATALOG_ALIAS_EMPTY:${alias.exerciseName}`);
    } else if (existingAlias) {
      errors.push(
        `CATALOG_ALIAS_DUPLICATE:${alias.alias}:conflicts_with:${existingAlias.alias}`,
      );
    } else {
      aliasByNormalizedName.set(normalizedAlias, alias);
    }

    if (!canonicalByExactName.has(alias.exerciseName)) {
      errors.push(`CATALOG_ALIAS_TARGET_MISSING:${alias.alias}:${alias.exerciseName}`);
    }
    const canonicalCollision = canonicalByNormalizedName.get(normalizedAlias);
    if (canonicalCollision && canonicalCollision.name !== alias.exerciseName) {
      errors.push(
        `CATALOG_ALIAS_CANONICAL_COLLISION:${alias.alias}:${alias.exerciseName}:collides_with:${canonicalCollision.name}`,
      );
    }
  }

  return errors.sort((left, right) => left.localeCompare(right));
}

export function assertCatalogInvariants(input: {
  exercises: readonly CatalogExerciseDefinition[];
  aliases: readonly CatalogAliasDefinition[];
}): void {
  const errors = validateCatalogInvariants(input);
  if (errors.length === 0) return;
  throw new Error(
    ["Exercise catalog invariant violations:", ...errors.map((error) => `- ${error}`)].join(
      "\n",
    ),
  );
}
