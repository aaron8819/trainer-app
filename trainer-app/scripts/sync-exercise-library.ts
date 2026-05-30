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
import { exerciseAliases, type ExerciseAliasSeed } from "../prisma/exercise-aliases";
import exercisesJson from "../prisma/exercises_comprehensive.json";

export type CatalogExerciseSeed = {
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
};

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

export function isCatalogSyncPlanClean(plan: CatalogSyncPlan): boolean {
  return (
    plan.missingInDb.length === 0 &&
    plan.extraInDb.length === 0 &&
    plan.fieldMismatches.length === 0 &&
    plan.plannedAliasCreates.length === 0 &&
    plan.plannedAliasUpdates.length === 0 &&
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

export async function applyCatalogSyncPlan(
  db: CatalogOnlyDb,
  catalog: CatalogExerciseSeed[],
  aliases: ExerciseAliasSeed[],
  snapshot: ExerciseLibrarySnapshot,
  plan: CatalogSyncPlan,
) {
  if (plan.missingReferencedMuscles.length > 0 || plan.missingReferencedEquipment.length > 0) {
    throw new Error(
      [
        "Catalog sync cannot apply because referenced lookup rows are missing.",
        `Missing muscles: ${plan.missingReferencedMuscles.join(", ") || "none"}`,
        `Missing equipment: ${plan.missingReferencedEquipment.join(", ") || "none"}`,
      ].join(" "),
    );
  }

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

  for (const name of plan.plannedExerciseCreates) {
    const exercise = catalogByName.get(name);
    if (!exercise) continue;
    const created = await db.exercise.create({ data: { name, ...buildExerciseData(exercise) } });
    dbByName.set(name, created);
    await replaceMappings(db, created.id, exercise, musclesByName, equipmentByName);
    exercisesCreated++;
  }

  for (const name of plan.plannedExerciseUpdates) {
    const exercise = catalogByName.get(name);
    const dbExercise = dbByName.get(name);
    if (!exercise || !dbExercise) continue;
    await db.exercise.update({ where: { id: dbExercise.id }, data: buildExerciseData(exercise) });
    await replaceMappings(db, dbExercise.id, exercise, musclesByName, equipmentByName);
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
    if (!dbExercise) continue;
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
    aliasesUpserted,
    scope: "Exercise, ExerciseMuscle, ExerciseEquipment, ExerciseAlias",
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

function printPlan(plan: CatalogSyncPlan) {
  console.log(`Missing: ${plan.missingInDb.length}`);
  console.log(`Extra: ${plan.extraInDb.length}`);
  console.log(`Field mismatches: ${plan.fieldMismatches.length}`);
  console.log(`Planned creates: ${plan.plannedExerciseCreates.length}`);
  console.log(`Planned updates: ${plan.plannedExerciseUpdates.length}`);
  console.log(`Planned deletes: ${plan.plannedExerciseDeletes.length}`);
  console.log(`Planned alias creates: ${plan.plannedAliasCreates.length}`);
  console.log(`Planned alias updates: ${plan.plannedAliasUpdates.length}`);
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

  if (plan.missingReferencedMuscles.length > 0 || plan.missingReferencedEquipment.length > 0) {
    console.log("\nMissing lookup rows, apply is blocked:");
    console.log(`- Muscles: ${plan.missingReferencedMuscles.join(", ") || "none"}`);
    console.log(`- Equipment: ${plan.missingReferencedEquipment.join(", ") || "none"}`);
  }
}

export async function runExerciseLibrarySync(options: { apply: boolean }) {
  const { prisma, pool } = createPrisma();
  try {
    const snapshot = await loadSnapshot(prisma as unknown as CatalogOnlyDb);
    const plan = buildCatalogSyncPlan(catalogExercises, exerciseAliases, snapshot);
    printPlan(plan);

    if (!options.apply) {
      console.log("\nDry run mode. Re-run with --apply to sync catalog-only rows.");
      if (!isCatalogSyncPlanClean(plan)) {
        process.exitCode = 1;
      }
      return plan;
    }

    if (plan.plannedExerciseDeletes.length > 0) {
      throw new Error("Catalog sync does not delete exercises.");
    }

    const result = await prisma.$transaction((tx) =>
      applyCatalogSyncPlan(tx as unknown as CatalogOnlyDb, catalogExercises, exerciseAliases, snapshot, plan),
    );

    console.log("\nApply complete.");
    console.log(`Exercises created: ${result.exercisesCreated}`);
    console.log(`Exercises updated: ${result.exercisesUpdated}`);
    console.log(`Exercises deleted: ${result.exercisesDeleted}`);
    console.log(`Aliases upserted: ${result.aliasesUpserted}`);
    console.log(`Mutation scope: ${result.scope}`);

    const after = await loadSnapshot(prisma as unknown as CatalogOnlyDb);
    const afterPlan = buildCatalogSyncPlan(catalogExercises, exerciseAliases, after);
    if (!isCatalogSyncPlanClean(afterPlan)) {
      console.error("Catalog sync completed but drift remains.");
      printPlan(afterPlan);
      process.exitCode = 1;
    }
    return afterPlan;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  await runExerciseLibrarySync({ apply });
}

if (typeof require !== "undefined" && require.main === module) {
  main().catch((error) => {
    console.error("Failed to sync exercise library", error);
    process.exit(1);
  });
}
