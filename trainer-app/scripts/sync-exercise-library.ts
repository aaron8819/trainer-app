import "dotenv/config";
import {
  Difficulty,
  JointStress,
  MovementPatternV2,
  MuscleRole,
  Prisma,
  PrismaClient,
  SplitTag,
  StimulusBias,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { runWithRolloutEnvironment } from "@/lib/operations/rollout-environment";
import { exerciseAliases, type ExerciseAliasSeed } from "../prisma/exercise-aliases";
import exercisesJson from "../prisma/exercises_comprehensive.json";
import {
  measurementColumns,
  parseMeasurementColumns,
} from "@/lib/exercise-measurement/semantics";
import {
  assertCatalogInvariants,
  type CatalogExerciseDefinition as CatalogExerciseSeed,
} from "@/lib/exercise-library/catalog-invariants";
import { CATALOG_KEY_GRAMMAR } from "@/lib/exercise-library/canonical-exercise-facts";

export type { CatalogExerciseDefinition as CatalogExerciseSeed } from "@/lib/exercise-library/catalog-invariants";

const catalogExercises = exercisesJson.exercises as CatalogExerciseSeed[];

type DbExercise = {
  id: string;
  name: string;
  movementPatterns: string[];
  splitTags: string[];
  jointStress: string;
  isMainLiftEligible: boolean;
  isCompound: boolean;
  fatigueCost: number;
  stimulusBias: string[];
  contraindications: unknown;
  timePerSetSec: number;
  sfrScore: number;
  lengthPositionScore: number;
  difficulty: string;
  isUnilateral: boolean;
  repRangeMin: number;
  repRangeMax: number;
  measurementProfile?: string | null;
  loadConvention?: string | null;
  repBasis?: string | null;
  aliases: Array<{ alias: string; exerciseId: string }>;
  exerciseMuscles: Array<{ role: string; muscle: { id: string; name: string } }>;
  exerciseEquipment: Array<{ equipment: { id: string; name: string; type: string } }>;
};

type DbMuscle = { id: string; name: string };
type DbEquipment = { id: string; name: string };

export type ExerciseLibrarySnapshot = {
  exercises: DbExercise[];
  muscles: DbMuscle[];
  equipment: DbEquipment[];
};

export type CatalogSyncPlan = {
  missingInDb: string[];
  extraInDb: string[];
  fieldMismatches: Array<{ exerciseName: string; fields: string[] }>;
  plannedExerciseCreates: string[];
  plannedExerciseUpdates: string[];
  plannedExerciseDeletes: string[];
  plannedAliasCreates: Array<{ exerciseName: string; alias: string }>;
  plannedAliasUpdates: Array<{ exerciseName: string; alias: string; fromExerciseName: string }>;
  skippedAliases: Array<{ exerciseName: string; alias: string; reason: string }>;
  missingReferencedMuscles: string[];
  missingReferencedEquipment: string[];
};

export type CatalogSyncScope = {
  mode: "catalog-wide" | "identity-scoped";
  catalogKeys: string[];
  exerciseNames: string[];
  databaseMatch: "exact-canonical-name";
};

export type CatalogSyncOperationSummary = {
  operationCount: number;
  exerciseCreates: string[];
  exerciseUpdates: string[];
  aliasCreates: Array<{ exerciseName: string; alias: string }>;
  aliasUpdates: Array<{ exerciseName: string; alias: string; fromExerciseName: string }>;
};

export type CatalogSyncDriftSummary = CatalogSyncOperationSummary & {
  extraInDb: string[];
  skippedAliases: Array<{ exerciseName: string; alias: string; reason: string }>;
  missingReferencedMuscles: string[];
  missingReferencedEquipment: string[];
};

export type CatalogSyncReport = {
  scope: CatalogSyncScope;
  totalPlan: CatalogSyncPlan;
  inScopePlan: CatalogSyncPlan;
  summary: {
    totalCatalogDrift: CatalogSyncDriftSummary;
    selectedInScopeOperations: CatalogSyncOperationSummary;
    deferredOutOfScopeOperations: CatalogSyncOperationSummary;
  };
};

type CatalogOnlyDb = {
  exercise: {
    findMany(args?: unknown): Promise<DbExercise[]>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; name: string }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  muscle: {
    findMany(args?: unknown): Promise<DbMuscle[]>;
  };
  equipment: {
    findMany(args?: unknown): Promise<DbEquipment[]>;
  };
  exerciseMuscle: {
    deleteMany(args: { where: { exerciseId: string } }): Promise<unknown>;
    createMany(args: {
      data: Array<{ exerciseId: string; muscleId: string; role: MuscleRole }>;
    }): Promise<unknown>;
  };
  exerciseEquipment: {
    deleteMany(args: { where: { exerciseId: string } }): Promise<unknown>;
    createMany(args: {
      data: Array<{ exerciseId: string; equipmentId: string }>;
    }): Promise<unknown>;
  };
  exerciseAlias: {
    upsert(args: {
      where: { alias: string };
      update: { exerciseId: string };
      create: { alias: string; exerciseId: string };
    }): Promise<unknown>;
  };
};

type CatalogTransactionalDb = CatalogOnlyDb & {
  $transaction<T>(operation: (tx: CatalogOnlyDb) => Promise<T>): Promise<T>;
};

function normalizeArray(values: string[] | undefined): string[] {
  return [...(values ?? [])]
    .map((value) => value.toLowerCase().trim())
    .sort((a, b) => a.localeCompare(b));
}

function normalizeMovementPatterns(values: string[] | undefined): string[] {
  return normalizeArray(values).map((pattern) =>
    pattern === "calf_raise_extended" || pattern === "calf_raise_flexed"
      ? "isolation"
      : pattern,
  );
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJson(item));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return Object.fromEntries(entries.map(([key, child]) => [key, normalizeJson(child)]));
  }
  return value;
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  if (Object.keys(value as Record<string, unknown>).length === 0) {
    return "";
  }
  return JSON.stringify(normalizeJson(value));
}

function normalizeEnumToken(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function parsePrismaEnumValue<E extends string>(
  enumValues: readonly E[],
  rawValue: string,
  context: string,
): E {
  const token = normalizeEnumToken(rawValue) as E;
  if (!enumValues.includes(token)) {
    throw new Error(`Unknown ${context}: ${rawValue}`);
  }
  return token;
}

function parseMovementPattern(rawValue: string): MovementPatternV2 {
  const token = rawValue.trim().toLowerCase();
  if (token === "calf_raise_extended" || token === "calf_raise_flexed") {
    return MovementPatternV2.ISOLATION;
  }
  return parsePrismaEnumValue(Object.values(MovementPatternV2), rawValue, "movement pattern");
}

function parseSplitTag(rawValue: string): SplitTag {
  return parsePrismaEnumValue(Object.values(SplitTag), rawValue, "split tag");
}

function parseJointStress(rawValue: string): JointStress {
  return parsePrismaEnumValue(Object.values(JointStress), rawValue, "joint stress");
}

function parseStimulusBias(rawValue: string): StimulusBias {
  return parsePrismaEnumValue(Object.values(StimulusBias), rawValue, "stimulus bias");
}

function parseDifficulty(rawValue: string | undefined): Difficulty {
  return parsePrismaEnumValue(Object.values(Difficulty), rawValue ?? "beginner", "difficulty");
}

function resolveTimePerSet(exercise: CatalogExerciseSeed): number {
  if ("timePerSetSec" in exercise && typeof exercise.timePerSetSec === "number") {
    return exercise.timePerSetSec;
  }
  if (exercise.isMainLiftEligible) return 210;
  if (exercise.splitTag === "core") return 60;
  if (exercise.splitTag === "conditioning") return 90;
  return 120;
}

export function buildExerciseData(exercise: CatalogExerciseSeed): Record<string, unknown> {
  const measurement = parseMeasurementColumns({
    measurementProfile: exercise.measurementProfile ?? null,
    loadConvention: exercise.loadConvention ?? null,
    repBasis: exercise.repBasis ?? null,
  });
  return {
    movementPatterns: exercise.movementPatterns.map(parseMovementPattern),
    splitTags: [parseSplitTag(exercise.splitTag)],
    jointStress: parseJointStress(exercise.jointStress),
    isMainLiftEligible: exercise.isMainLiftEligible,
    isCompound: exercise.isCompound,
    fatigueCost: exercise.fatigueCost,
    stimulusBias: exercise.stimulusBias.map(parseStimulusBias),
    contraindications:
      exercise.contraindications === null ? Prisma.JsonNull : exercise.contraindications,
    timePerSetSec: resolveTimePerSet(exercise),
    sfrScore: exercise.sfrScore,
    lengthPositionScore: exercise.lengthPositionScore,
    difficulty: parseDifficulty(exercise.difficulty),
    isUnilateral: Boolean(exercise.unilateral),
    repRangeMin: exercise.repRangeRecommendation?.min ?? 1,
    repRangeMax: exercise.repRangeRecommendation?.max ?? 20,
    ...measurementColumns(measurement),
  };
}

function normalizedCatalogExercise(exercise: CatalogExerciseSeed) {
  return {
    movementPatterns: normalizeMovementPatterns(exercise.movementPatterns),
    splitTags: normalizeArray([exercise.splitTag]),
    jointStress: exercise.jointStress.toLowerCase(),
    equipment: normalizeArray(exercise.equipment),
    stimulusBias: normalizeArray(exercise.stimulusBias),
    primaryMuscles: normalizeArray(exercise.primaryMuscles),
    secondaryMuscles: normalizeArray(exercise.secondaryMuscles),
    contraindications: stableJson(exercise.contraindications),
    timePerSetSec: resolveTimePerSet(exercise),
    isCompound: exercise.isCompound,
    isMainLiftEligible: exercise.isMainLiftEligible,
    fatigueCost: exercise.fatigueCost,
    sfrScore: exercise.sfrScore,
    lengthPositionScore: exercise.lengthPositionScore,
    difficulty: (exercise.difficulty ?? "beginner").toLowerCase(),
    isUnilateral: Boolean(exercise.unilateral),
    repRangeMin: exercise.repRangeRecommendation?.min ?? 1,
    repRangeMax: exercise.repRangeRecommendation?.max ?? 20,
    ...measurementColumns(
      parseMeasurementColumns({
        measurementProfile: exercise.measurementProfile ?? null,
        loadConvention: exercise.loadConvention ?? null,
        repBasis: exercise.repBasis ?? null,
      }),
    ),
  };
}

function normalizedDbExercise(exercise: DbExercise) {
  return {
    movementPatterns: normalizeMovementPatterns(exercise.movementPatterns),
    splitTags: normalizeArray(exercise.splitTags),
    jointStress: exercise.jointStress.toLowerCase(),
    equipment: normalizeArray(exercise.exerciseEquipment.map((entry) => entry.equipment.name)),
    stimulusBias: normalizeArray(exercise.stimulusBias),
    primaryMuscles: normalizeArray(
      exercise.exerciseMuscles
        .filter((entry) => entry.role === "PRIMARY")
        .map((entry) => entry.muscle.name),
    ),
    secondaryMuscles: normalizeArray(
      exercise.exerciseMuscles
        .filter((entry) => entry.role === "SECONDARY")
        .map((entry) => entry.muscle.name),
    ),
    contraindications: stableJson(exercise.contraindications),
    timePerSetSec: exercise.timePerSetSec,
    isCompound: exercise.isCompound,
    isMainLiftEligible: exercise.isMainLiftEligible,
    fatigueCost: exercise.fatigueCost,
    sfrScore: exercise.sfrScore,
    lengthPositionScore: exercise.lengthPositionScore,
    difficulty: exercise.difficulty.toLowerCase(),
    isUnilateral: exercise.isUnilateral,
    repRangeMin: exercise.repRangeMin,
    repRangeMax: exercise.repRangeMax,
    measurementProfile: exercise.measurementProfile ?? null,
    loadConvention: exercise.loadConvention ?? null,
    repBasis: exercise.repBasis ?? null,
  };
}

function diffExerciseFields(catalogExercise: CatalogExerciseSeed, dbExercise: DbExercise): string[] {
  const catalog = normalizedCatalogExercise(catalogExercise);
  const db = normalizedDbExercise(dbExercise);
  const fields = Object.keys(catalog) as Array<keyof typeof catalog>;
  return fields.filter((field) => JSON.stringify(catalog[field]) !== JSON.stringify(db[field]));
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

const CATALOG_KEY_SELECTOR = "--catalog-key";

export function parseCatalogKeySelectors(
  argv: string[],
  catalog: CatalogExerciseSeed[] = catalogExercises,
  aliases: ExerciseAliasSeed[] = exerciseAliases,
): string[] | undefined {
  const selectors: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === CATALOG_KEY_SELECTOR) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${CATALOG_KEY_SELECTOR}.`);
      }
      selectors.push(value);
      index++;
      continue;
    }
    if (argument.startsWith(`${CATALOG_KEY_SELECTOR}=`)) {
      selectors.push(argument.slice(CATALOG_KEY_SELECTOR.length + 1));
    }
  }

  if (selectors.length === 0) return undefined;

  const catalogByKey = new Map<string, CatalogExerciseSeed>();
  const catalogByName = new Map(catalog.map((exercise) => [exercise.name, exercise]));
  const aliasByName = new Map(aliases.map((alias) => [alias.alias, alias]));
  for (const exercise of catalog) {
    if (typeof exercise.catalogKey !== "string") continue;
    if (catalogByKey.has(exercise.catalogKey)) {
      throw new Error(`Catalog key is not uniquely owned: ${exercise.catalogKey}`);
    }
    catalogByKey.set(exercise.catalogKey, exercise);
  }

  const seen = new Set<string>();
  for (const selector of selectors) {
    if (selector.length === 0) {
      throw new Error(`Missing value for ${CATALOG_KEY_SELECTOR}.`);
    }
    if (seen.has(selector)) {
      throw new Error(`Duplicate ${CATALOG_KEY_SELECTOR} selector: ${selector}`);
    }
    seen.add(selector);

    const namedExercise = catalogByName.get(selector);
    if (namedExercise) {
      throw new Error(
        `${CATALOG_KEY_SELECTOR} requires a catalog key, not display name: ${selector}`,
      );
    }
    const namedAlias = aliasByName.get(selector);
    if (namedAlias) {
      throw new Error(
        `${CATALOG_KEY_SELECTOR} requires a catalog key, not alias: ${selector}`,
      );
    }
    if (!CATALOG_KEY_GRAMMAR.test(selector)) {
      throw new Error(`Malformed ${CATALOG_KEY_SELECTOR} selector: ${selector}`);
    }
    if (!catalogByKey.has(selector)) {
      throw new Error(`Unknown ${CATALOG_KEY_SELECTOR} selector: ${selector}`);
    }
  }

  return selectors;
}

export function resolveCatalogSyncScope(
  catalog: CatalogExerciseSeed[],
  catalogKeys: string[] | undefined,
): CatalogSyncScope {
  const catalogByKey = new Map<string, CatalogExerciseSeed>();
  for (const exercise of catalog) {
    if (typeof exercise.catalogKey !== "string") {
      throw new Error(`Catalog exercise is missing a canonical key: ${exercise.name}`);
    }
    if (catalogByKey.has(exercise.catalogKey)) {
      throw new Error(`Catalog key is not uniquely owned: ${exercise.catalogKey}`);
    }
    catalogByKey.set(exercise.catalogKey, exercise);
  }

  if (catalogKeys === undefined) {
    return {
      mode: "catalog-wide",
      catalogKeys: catalog.map((exercise) => exercise.catalogKey!),
      exerciseNames: catalog.map((exercise) => exercise.name),
      databaseMatch: "exact-canonical-name",
    };
  }
  if (catalogKeys.length === 0) {
    throw new Error("Identity-scoped catalog synchronization requires at least one catalog key.");
  }

  const seen = new Set<string>();
  const selected = catalogKeys.map((catalogKey) => {
    if (seen.has(catalogKey)) {
      throw new Error(`Duplicate ${CATALOG_KEY_SELECTOR} selector: ${catalogKey}`);
    }
    seen.add(catalogKey);
    const exercise = catalogByKey.get(catalogKey);
    if (!exercise) {
      throw new Error(`Unknown ${CATALOG_KEY_SELECTOR} selector: ${catalogKey}`);
    }
    return exercise;
  });

  return {
    mode: "identity-scoped",
    catalogKeys: selected.map((exercise) => exercise.catalogKey!),
    exerciseNames: selected.map((exercise) => exercise.name),
    databaseMatch: "exact-canonical-name",
  };
}

export function buildCatalogSyncPlan(
  catalog: CatalogExerciseSeed[],
  aliases: ExerciseAliasSeed[],
  snapshot: ExerciseLibrarySnapshot,
): CatalogSyncPlan {
  const catalogByName = new Map(catalog.map((exercise) => [exercise.name, exercise]));
  const dbByName = new Map(snapshot.exercises.map((exercise) => [exercise.name, exercise]));
  const musclesByName = new Set(snapshot.muscles.map((muscle) => muscle.name));
  const equipmentByName = new Set(snapshot.equipment.map((equipment) => equipment.name));
  const aliasByName = new Map<string, { alias: string; exerciseName: string }>();

  for (const exercise of snapshot.exercises) {
    for (const alias of exercise.aliases) {
      aliasByName.set(alias.alias, { alias: alias.alias, exerciseName: exercise.name });
    }
  }

  const missingInDb = uniqueSorted(
    catalog.map((exercise) => exercise.name).filter((name) => !dbByName.has(name)),
  );
  const extraInDb = uniqueSorted(
    snapshot.exercises.map((exercise) => exercise.name).filter((name) => !catalogByName.has(name)),
  );

  const fieldMismatches: CatalogSyncPlan["fieldMismatches"] = [];
  for (const exercise of catalog) {
    const dbExercise = dbByName.get(exercise.name);
    if (!dbExercise) continue;
    const fields = diffExerciseFields(exercise, dbExercise);
    if (fields.length > 0) {
      fieldMismatches.push({ exerciseName: exercise.name, fields });
    }
  }

  const plannedAliasCreates: CatalogSyncPlan["plannedAliasCreates"] = [];
  const plannedAliasUpdates: CatalogSyncPlan["plannedAliasUpdates"] = [];
  const skippedAliases: CatalogSyncPlan["skippedAliases"] = [];

  for (const alias of aliases) {
    if (!catalogByName.has(alias.exerciseName)) {
      skippedAliases.push({ ...alias, reason: "target exercise is not in catalog JSON" });
      continue;
    }
    const canonicalExerciseConflict = dbByName.get(alias.alias) ?? catalogByName.get(alias.alias);
    if (canonicalExerciseConflict) {
      skippedAliases.push({ ...alias, reason: "alias matches a canonical exercise name" });
      continue;
    }
    const existingAlias = aliasByName.get(alias.alias);
    if (!existingAlias) {
      plannedAliasCreates.push(alias);
      continue;
    }
    if (existingAlias.exerciseName !== alias.exerciseName) {
      plannedAliasUpdates.push({
        ...alias,
        fromExerciseName: existingAlias.exerciseName,
      });
    }
  }

  return {
    missingInDb,
    extraInDb,
    fieldMismatches,
    plannedExerciseCreates: missingInDb,
    plannedExerciseUpdates: fieldMismatches.map((mismatch) => mismatch.exerciseName),
    plannedExerciseDeletes: [],
    plannedAliasCreates,
    plannedAliasUpdates,
    skippedAliases,
    missingReferencedMuscles: uniqueSorted(
      catalog.flatMap((exercise) => [...exercise.primaryMuscles, ...exercise.secondaryMuscles])
        .filter((name) => !musclesByName.has(name)),
    ),
    missingReferencedEquipment: uniqueSorted(
      catalog.flatMap((exercise) => exercise.equipment).filter((name) => !equipmentByName.has(name)),
    ),
  };
}

function selectedCatalogForScope(
  catalog: CatalogExerciseSeed[],
  scope: CatalogSyncScope,
): CatalogExerciseSeed[] {
  const selectedNames = new Set(scope.exerciseNames);
  const selectedCatalog = catalog.filter((exercise) => selectedNames.has(exercise.name));
  if (selectedCatalog.length !== scope.exerciseNames.length) {
    throw new Error("Catalog synchronization scope does not resolve to exact canonical identities.");
  }
  for (const exercise of selectedCatalog) {
    if (!scope.catalogKeys.includes(exercise.catalogKey!)) {
      throw new Error(`Catalog synchronization scope key/name mismatch: ${exercise.name}`);
    }
  }
  return selectedCatalog;
}

function filterPlanToScope(
  totalPlan: CatalogSyncPlan,
  selectedCatalog: CatalogExerciseSeed[],
  snapshot: ExerciseLibrarySnapshot,
  catalogWide: boolean,
): CatalogSyncPlan {
  if (catalogWide) return totalPlan;

  const selectedNames = new Set(selectedCatalog.map((exercise) => exercise.name));
  const musclesByName = new Set(snapshot.muscles.map((muscle) => muscle.name));
  const equipmentByName = new Set(snapshot.equipment.map((equipment) => equipment.name));
  return {
    missingInDb: totalPlan.missingInDb.filter((name) => selectedNames.has(name)),
    extraInDb: [],
    fieldMismatches: totalPlan.fieldMismatches.filter((entry) =>
      selectedNames.has(entry.exerciseName),
    ),
    plannedExerciseCreates: totalPlan.plannedExerciseCreates.filter((name) =>
      selectedNames.has(name),
    ),
    plannedExerciseUpdates: totalPlan.plannedExerciseUpdates.filter((name) =>
      selectedNames.has(name),
    ),
    plannedExerciseDeletes: totalPlan.plannedExerciseDeletes.filter((name) =>
      selectedNames.has(name),
    ),
    plannedAliasCreates: totalPlan.plannedAliasCreates.filter((entry) =>
      selectedNames.has(entry.exerciseName),
    ),
    plannedAliasUpdates: totalPlan.plannedAliasUpdates.filter((entry) =>
      selectedNames.has(entry.exerciseName),
    ),
    skippedAliases: totalPlan.skippedAliases.filter((entry) =>
      selectedNames.has(entry.exerciseName),
    ),
    missingReferencedMuscles: uniqueSorted(
      selectedCatalog
        .flatMap((exercise) => [...exercise.primaryMuscles, ...exercise.secondaryMuscles])
        .filter((name) => !musclesByName.has(name)),
    ),
    missingReferencedEquipment: uniqueSorted(
      selectedCatalog
        .flatMap((exercise) => exercise.equipment)
        .filter((name) => !equipmentByName.has(name)),
    ),
  };
}

function summarizeOperations(
  plan: CatalogSyncPlan,
  includeExercise: (name: string) => boolean = () => true,
): CatalogSyncOperationSummary {
  const exerciseCreates = plan.plannedExerciseCreates.filter(includeExercise);
  const exerciseUpdates = plan.plannedExerciseUpdates.filter(includeExercise);
  const aliasCreates = plan.plannedAliasCreates.filter((entry) =>
    includeExercise(entry.exerciseName),
  );
  const aliasUpdates = plan.plannedAliasUpdates.filter((entry) =>
    includeExercise(entry.exerciseName),
  );
  return {
    operationCount:
      exerciseCreates.length + exerciseUpdates.length + aliasCreates.length + aliasUpdates.length,
    exerciseCreates,
    exerciseUpdates,
    aliasCreates,
    aliasUpdates,
  };
}

function summarizeDrift(plan: CatalogSyncPlan): CatalogSyncDriftSummary {
  return {
    ...summarizeOperations(plan),
    extraInDb: [...plan.extraInDb],
    skippedAliases: plan.skippedAliases.map((entry) => ({ ...entry })),
    missingReferencedMuscles: [...plan.missingReferencedMuscles],
    missingReferencedEquipment: [...plan.missingReferencedEquipment],
  };
}

export function buildCatalogSyncReport(
  catalog: CatalogExerciseSeed[],
  aliases: ExerciseAliasSeed[],
  snapshot: ExerciseLibrarySnapshot,
  scope: CatalogSyncScope,
): CatalogSyncReport {
  const selectedCatalog = selectedCatalogForScope(catalog, scope);
  const selectedNames = new Set(selectedCatalog.map((exercise) => exercise.name));
  const totalPlan = buildCatalogSyncPlan(catalog, aliases, snapshot);
  const inScopePlan = filterPlanToScope(
    totalPlan,
    selectedCatalog,
    snapshot,
    scope.mode === "catalog-wide",
  );
  return {
    scope,
    totalPlan,
    inScopePlan,
    summary: {
      totalCatalogDrift: summarizeDrift(totalPlan),
      selectedInScopeOperations: summarizeOperations(inScopePlan),
      deferredOutOfScopeOperations: summarizeOperations(
        totalPlan,
        (name) => !selectedNames.has(name),
      ),
    },
  };
}

export function isCatalogSyncPlanClean(plan: CatalogSyncPlan): boolean {
  return (
    plan.missingInDb.length === 0 &&
    plan.extraInDb.length === 0 &&
    plan.fieldMismatches.length === 0 &&
    plan.plannedAliasCreates.length === 0 &&
    plan.plannedAliasUpdates.length === 0 &&
    plan.skippedAliases.length === 0 &&
    plan.missingReferencedMuscles.length === 0 &&
    plan.missingReferencedEquipment.length === 0
  );
}

async function replaceMappings(
  db: CatalogOnlyDb,
  exerciseId: string,
  exercise: CatalogExerciseSeed,
  musclesByName: Map<string, DbMuscle>,
  equipmentByName: Map<string, DbEquipment>,
) {
  await db.exerciseMuscle.deleteMany({ where: { exerciseId } });
  await db.exerciseMuscle.createMany({
    data: [
      ...exercise.primaryMuscles.map((muscleName) => ({
        exerciseId,
        muscleId: musclesByName.get(muscleName)!.id,
        role: MuscleRole.PRIMARY,
      })),
      ...exercise.secondaryMuscles.map((muscleName) => ({
        exerciseId,
        muscleId: musclesByName.get(muscleName)!.id,
        role: MuscleRole.SECONDARY,
      })),
    ],
  });

  await db.exerciseEquipment.deleteMany({ where: { exerciseId } });
  await db.exerciseEquipment.createMany({
    data: exercise.equipment.map((equipmentName) => ({
      exerciseId,
      equipmentId: equipmentByName.get(equipmentName)!.id,
    })),
  });
}

function assertPlanWithinCatalog(
  catalog: CatalogExerciseSeed[],
  aliases: ExerciseAliasSeed[],
  plan: CatalogSyncPlan,
) {
  const allowedNames = new Set(catalog.map((exercise) => exercise.name));
  const plannedNames = [
    ...plan.plannedExerciseCreates,
    ...plan.plannedExerciseUpdates,
    ...plan.plannedExerciseDeletes,
    ...plan.plannedAliasCreates.map((entry) => entry.exerciseName),
    ...plan.plannedAliasUpdates.map((entry) => entry.exerciseName),
  ];
  const unexpectedName = plannedNames.find((name) => !allowedNames.has(name));
  if (unexpectedName) {
    throw new Error(`Catalog sync plan escaped the selected identities: ${unexpectedName}`);
  }
  const unexpectedAliasOwner = aliases.find((alias) => !allowedNames.has(alias.exerciseName));
  if (unexpectedAliasOwner) {
    throw new Error(
      `Catalog sync aliases escaped the selected identities: ${unexpectedAliasOwner.alias}`,
    );
  }
  const allowedAliases = new Set(
    aliases.map((alias) => `${alias.exerciseName}\u0000${alias.alias}`),
  );
  const unexpectedPlannedAlias = [
    ...plan.plannedAliasCreates,
    ...plan.plannedAliasUpdates,
  ].find((alias) => !allowedAliases.has(`${alias.exerciseName}\u0000${alias.alias}`));
  if (unexpectedPlannedAlias) {
    throw new Error(
      `Catalog sync plan contains an unowned alias: ${unexpectedPlannedAlias.alias}`,
    );
  }
}

export async function applyCatalogSyncPlan(
  db: CatalogOnlyDb,
  catalog: CatalogExerciseSeed[],
  aliases: ExerciseAliasSeed[],
  snapshot: ExerciseLibrarySnapshot,
  plan: CatalogSyncPlan,
) {
  if (plan.skippedAliases.length > 0) {
    throw new Error(
      [
        "Catalog sync cannot apply because aliases could not be resolved.",
        ...plan.skippedAliases.map(
          (alias) => `${alias.alias} -> ${alias.exerciseName}: ${alias.reason}`,
        ),
      ].join(" "),
    );
  }

  if (plan.missingReferencedMuscles.length > 0 || plan.missingReferencedEquipment.length > 0) {
    throw new Error(
      [
        "Catalog sync cannot apply because referenced lookup rows are missing.",
        `Missing muscles: ${plan.missingReferencedMuscles.join(", ") || "none"}`,
        `Missing equipment: ${plan.missingReferencedEquipment.join(", ") || "none"}`,
      ].join(" "),
    );
  }
  assertPlanWithinCatalog(catalog, aliases, plan);

  const catalogByName = new Map(catalog.map((exercise) => [exercise.name, exercise]));
  const dbByName = new Map(
    snapshot.exercises.map((exercise) => [
      exercise.name,
      { id: exercise.id, name: exercise.name },
    ]),
  );
  const musclesByName = new Map(snapshot.muscles.map((muscle) => [muscle.name, muscle]));
  const equipmentByName = new Map(snapshot.equipment.map((equipment) => [equipment.name, equipment]));
  let exercisesCreated = 0;
  let exercisesUpdated = 0;
  let exerciseMappingsReplaced = 0;

  for (const name of plan.plannedExerciseCreates) {
    const exercise = catalogByName.get(name);
    if (!exercise) throw new Error(`Planned exercise create is outside the selected catalog: ${name}`);
    const created = await db.exercise.create({ data: { name, ...buildExerciseData(exercise) } });
    dbByName.set(name, created);
    await replaceMappings(db, created.id, exercise, musclesByName, equipmentByName);
    exercisesCreated++;
    exerciseMappingsReplaced++;
  }

  for (const name of plan.plannedExerciseUpdates) {
    const exercise = catalogByName.get(name);
    const dbExercise = dbByName.get(name);
    if (!exercise || !dbExercise) {
      throw new Error(`Planned exercise update cannot be proven: ${name}`);
    }
    await db.exercise.update({ where: { id: dbExercise.id }, data: buildExerciseData(exercise) });
    const changedFields = plan.fieldMismatches.find(
      (mismatch) => mismatch.exerciseName === name,
    )?.fields;
    if (
      changedFields?.some((field) =>
        ["equipment", "primaryMuscles", "secondaryMuscles"].includes(field),
      )
    ) {
      await replaceMappings(db, dbExercise.id, exercise, musclesByName, equipmentByName);
      exerciseMappingsReplaced++;
    }
    exercisesUpdated++;
  }

  const aliasesToUpsert = new Set([
    ...plan.plannedAliasCreates.map((entry) => entry.alias),
    ...plan.plannedAliasUpdates.map((entry) => entry.alias),
  ]);
  let aliasesUpserted = 0;
  for (const alias of aliases) {
    if (!aliasesToUpsert.has(alias.alias)) continue;
    const dbExercise = dbByName.get(alias.exerciseName);
    if (!dbExercise) {
      throw new Error(`Planned alias target cannot be proven: ${alias.alias}`);
    }
    await db.exerciseAlias.upsert({
      where: { alias: alias.alias },
      update: { exerciseId: dbExercise.id },
      create: { alias: alias.alias, exerciseId: dbExercise.id },
    });
    aliasesUpserted++;
  }

  return {
    exercisesCreated,
    exercisesUpdated,
    exercisesDeleted: 0,
    exerciseMappingsReplaced,
    aliasesUpserted,
    scope: "Exercise, ExerciseMuscle, ExerciseEquipment, ExerciseAlias",
    mutatedIdentities: {
      exerciseCreates: [...plan.plannedExerciseCreates],
      exerciseUpdates: [...plan.plannedExerciseUpdates],
      aliasCreates: plan.plannedAliasCreates.map((entry) => ({ ...entry })),
      aliasUpdates: plan.plannedAliasUpdates.map((entry) => ({ ...entry })),
    },
  };
}

function createPrisma() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL");
  }

  const disableVerify = process.env.DATABASE_SSL_NO_VERIFY === "true";
  const ssl = disableVerify ? { rejectUnauthorized: false } : undefined;
  const sanitizedConnectionString = (() => {
    if (!disableVerify) return connectionString;
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  })();

  const pool = new Pool({ connectionString: sanitizedConnectionString, ssl });
  const adapter = new PrismaPg(pool);
  return { prisma: new PrismaClient({ adapter }), pool };
}

async function loadSnapshot(db: CatalogOnlyDb): Promise<ExerciseLibrarySnapshot> {
  const [exercises, muscles, equipment] = await Promise.all([
    db.exercise.findMany({
      include: {
        aliases: true,
        exerciseEquipment: { include: { equipment: true } },
        exerciseMuscles: { include: { muscle: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.muscle.findMany({ orderBy: { name: "asc" } }),
    db.equipment.findMany({ orderBy: { name: "asc" } }),
  ]);
  return { exercises, muscles, equipment };
}

export async function executeCatalogSync(input: {
  db: CatalogTransactionalDb;
  catalog: CatalogExerciseSeed[];
  aliases: ExerciseAliasSeed[];
  scope: CatalogSyncScope;
  apply: boolean;
}) {
  const beforeSnapshot = await loadSnapshot(input.db);
  const beforeReport = buildCatalogSyncReport(
    input.catalog,
    input.aliases,
    beforeSnapshot,
    input.scope,
  );
  if (!input.apply) return { beforeReport };

  if (beforeReport.inScopePlan.plannedExerciseDeletes.length > 0) {
    throw new Error("Catalog sync does not delete exercises.");
  }

  const selectedCatalog = selectedCatalogForScope(input.catalog, input.scope);
  const selectedNames = new Set(selectedCatalog.map((exercise) => exercise.name));
  const selectedAliases = input.aliases.filter((alias) => selectedNames.has(alias.exerciseName));
  assertPlanWithinCatalog(selectedCatalog, selectedAliases, beforeReport.inScopePlan);

  const mutationResult = await input.db.$transaction(async (tx) => {
    const transactionSnapshot = await loadSnapshot(tx);
    const transactionReport = buildCatalogSyncReport(
      input.catalog,
      input.aliases,
      transactionSnapshot,
      input.scope,
    );
    if (JSON.stringify(transactionReport.inScopePlan) !== JSON.stringify(beforeReport.inScopePlan)) {
      throw new Error(
        "Selected catalog mutation plan changed before apply; transaction aborted before writes.",
      );
    }
    return applyCatalogSyncPlan(
      tx,
      selectedCatalog,
      selectedAliases,
      transactionSnapshot,
      transactionReport.inScopePlan,
    );
  });

  const afterSnapshot = await loadSnapshot(input.db);
  const afterReport = buildCatalogSyncReport(
    input.catalog,
    input.aliases,
    afterSnapshot,
    input.scope,
  );
  return { beforeReport, mutationResult, afterReport };
}

export function printCatalogSyncReport(report: CatalogSyncReport) {
  console.log("\n=== Catalog synchronization scope ===");
  console.log(`Active scope: ${report.scope.mode}`);
  console.log(`Database match boundary: ${report.scope.databaseMatch}`);
  console.log(`Selected catalog keys (${report.scope.catalogKeys.length}): ${report.scope.catalogKeys.join(", ")}`);
  console.log(`Selected canonical names (${report.scope.exerciseNames.length}): ${report.scope.exerciseNames.join(", ")}`);
  console.log(
    `Total catalog drift operations: ${report.summary.totalCatalogDrift.operationCount}`,
  );
  console.log(
    `Selected in-scope operations: ${report.summary.selectedInScopeOperations.operationCount}`,
  );
  console.log(
    `Deferred out-of-scope operations: ${report.summary.deferredOutOfScopeOperations.operationCount}`,
  );
  console.log(`Catalog sync structured summary: ${JSON.stringify({ scope: report.scope, ...report.summary })}`);
  printCatalogSyncPlan(report.inScopePlan);
}

export function printCatalogSyncPlan(plan: CatalogSyncPlan) {
  console.log(`Missing: ${plan.missingInDb.length}`);
  console.log(`Extra: ${plan.extraInDb.length}`);
  console.log(`Field mismatches: ${plan.fieldMismatches.length}`);
  console.log(`Planned creates: ${plan.plannedExerciseCreates.length}`);
  console.log(`Planned updates: ${plan.plannedExerciseUpdates.length}`);
  console.log(`Planned deletes: ${plan.plannedExerciseDeletes.length}`);
  console.log(`Planned alias creates: ${plan.plannedAliasCreates.length}`);
  console.log(`Planned alias updates: ${plan.plannedAliasUpdates.length}`);
  console.log(`Skipped aliases: ${plan.skippedAliases.length}`);
  console.log("Mutation scope: exercise catalog only");

  if (plan.missingInDb.length > 0) {
    console.log("\nMissing exercises:");
    for (const name of plan.missingInDb) {
      console.log(`- ${name}`);
    }
  }

  if (plan.fieldMismatches.length > 0) {
    console.log("\nField mismatches:");
    for (const mismatch of plan.fieldMismatches.slice(0, 100)) {
      console.log(`- ${mismatch.exerciseName}: ${mismatch.fields.join(", ")}`);
    }
  }

  if (plan.extraInDb.length > 0) {
    console.log("\nExtra exercises (no deletes planned):");
    for (const name of plan.extraInDb) {
      console.log(`- ${name}`);
    }
  }

  if (plan.plannedAliasCreates.length > 0) {
    console.log("\nPlanned alias creates:");
    for (const alias of plan.plannedAliasCreates) {
      console.log(`- ${alias.alias} -> ${alias.exerciseName}`);
    }
  }

  if (plan.plannedAliasUpdates.length > 0) {
    console.log("\nPlanned alias updates:");
    for (const alias of plan.plannedAliasUpdates) {
      console.log(`- ${alias.alias}: ${alias.fromExerciseName} -> ${alias.exerciseName}`);
    }
  }

  if (plan.skippedAliases.length > 0) {
    console.log("\nSkipped aliases (apply is blocked):");
    for (const alias of plan.skippedAliases) {
      console.log(`- ${alias.alias} -> ${alias.exerciseName}: ${alias.reason}`);
    }
  }

  if (plan.missingReferencedMuscles.length > 0 || plan.missingReferencedEquipment.length > 0) {
    console.log("\nMissing lookup rows, apply is blocked:");
    console.log(`- Muscles: ${plan.missingReferencedMuscles.join(", ") || "none"}`);
    console.log(`- Equipment: ${plan.missingReferencedEquipment.join(", ") || "none"}`);
  }
}

export async function runExerciseLibrarySync(options: {
  apply: boolean;
  catalogKeys?: string[];
}) {
  assertCatalogInvariants({ exercises: catalogExercises, aliases: exerciseAliases });
  const scope = resolveCatalogSyncScope(catalogExercises, options.catalogKeys);
  const { prisma, pool } = createPrisma();
  try {
    const execution = await executeCatalogSync({
      db: prisma as unknown as CatalogTransactionalDb,
      catalog: catalogExercises,
      aliases: exerciseAliases,
      scope,
      apply: options.apply,
    });
    printCatalogSyncReport(execution.beforeReport);

    if (!options.apply) {
      console.log("\nDry run mode. Re-run with --apply to sync catalog-only rows.");
      if (!isCatalogSyncPlanClean(execution.beforeReport.totalPlan)) {
        process.exitCode = 1;
      }
      return execution.beforeReport;
    }

    const result = execution.mutationResult!;

    console.log("\nApply complete.");
    console.log(`Exercises created: ${result.exercisesCreated}`);
    console.log(`Exercises updated: ${result.exercisesUpdated}`);
    console.log(`Exercises deleted: ${result.exercisesDeleted}`);
    console.log(`Exercise mappings replaced: ${result.exerciseMappingsReplaced}`);
    console.log(`Aliases upserted: ${result.aliasesUpserted}`);
    console.log(`Mutation scope: ${result.scope}`);
    console.log(`Catalog sync structured mutations: ${JSON.stringify(result.mutatedIdentities)}`);

    const afterReport = execution.afterReport!;
    if (!isCatalogSyncPlanClean(afterReport.inScopePlan)) {
      console.error("Catalog sync completed but selected-scope drift remains.");
      printCatalogSyncReport(afterReport);
      process.exitCode = 1;
    }
    if (afterReport.summary.deferredOutOfScopeOperations.operationCount > 0) {
      console.log(
        `Deferred out-of-scope operations remain: ${afterReport.summary.deferredOutOfScopeOperations.operationCount}`,
      );
    }
    return afterReport;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const catalogKeys = parseCatalogKeySelectors(argv);
  await runWithRolloutEnvironment({
    argv: apply ? [...argv, "--write"] : argv,
    allowWrite: apply,
    requiredVariables: ["DATABASE_URL"],
  }, async (environment) => {
    console.log(
      `Catalog sync target: ${environment.targetClass}; mode: ${apply ? "apply" : "dry_run"}`,
    );
    await runExerciseLibrarySync({ apply, catalogKeys });
  });
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((error) => {
    console.error("Failed to sync exercise library", error);
    process.exit(1);
  });
}
