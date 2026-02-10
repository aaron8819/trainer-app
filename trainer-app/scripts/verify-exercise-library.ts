import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

type JsonExercise = {
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
};

type JsonData = {
  exercises: JsonExercise[];
};

type ExerciseRecord = Awaited<ReturnType<typeof loadDbExercises>>[number];

function normalizeArray(values: string[] | undefined): string[] {
  return [...(values ?? [])]
    .map((value) => value.toLowerCase().trim())
    .sort((a, b) => a.localeCompare(b));
}

function stableContraindications(value: Record<string, unknown> | null | undefined): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    return "";
  }
  return JSON.stringify(Object.fromEntries(entries));
}

function normalizeJsonExercise(exercise: JsonExercise) {
  return {
    movementPatterns: normalizeArray(exercise.movementPatterns),
    splitTags: normalizeArray([exercise.splitTag]),
    jointStress: exercise.jointStress.toLowerCase(),
    equipment: normalizeArray(exercise.equipment),
    stimulusBias: normalizeArray(exercise.stimulusBias),
    primaryMuscles: normalizeArray(exercise.primaryMuscles),
    secondaryMuscles: normalizeArray(exercise.secondaryMuscles),
    contraindications: stableContraindications(exercise.contraindications),
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

function normalizeDbExercise(exercise: ExerciseRecord) {
  return {
    movementPatterns: normalizeArray(exercise.movementPatterns),
    splitTags: normalizeArray(exercise.splitTags),
    jointStress: exercise.jointStress.toLowerCase(),
    equipment: normalizeArray(exercise.exerciseEquipment.map((entry) => entry.equipment.type)),
    stimulusBias: normalizeArray(exercise.stimulusBias),
    primaryMuscles: normalizeArray(
      exercise.exerciseMuscles
        .filter((entry) => entry.role === "PRIMARY")
        .map((entry) => entry.muscle.name)
    ),
    secondaryMuscles: normalizeArray(
      exercise.exerciseMuscles
        .filter((entry) => entry.role === "SECONDARY")
        .map((entry) => entry.muscle.name)
    ),
    contraindications: stableContraindications(
      exercise.contraindications as Record<string, unknown> | null | undefined
    ),
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

function diffFields(name: string, jsonExercise: JsonExercise, dbExercise: ExerciseRecord): string[] {
  const json = normalizeJsonExercise(jsonExercise);
  const db = normalizeDbExercise(dbExercise);

  const fields: (keyof typeof json)[] = [
    "movementPatterns",
    "splitTags",
    "jointStress",
    "equipment",
    "stimulusBias",
    "primaryMuscles",
    "secondaryMuscles",
    "contraindications",
    "isCompound",
    "isMainLiftEligible",
    "fatigueCost",
    "sfrScore",
    "lengthPositionScore",
    "difficulty",
    "isUnilateral",
    "repRangeMin",
    "repRangeMax",
  ];

  const mismatches: string[] = [];
  for (const field of fields) {
    if (JSON.stringify(json[field]) !== JSON.stringify(db[field])) {
      mismatches.push(`${name}: ${field}`);
    }
  }
  return mismatches;
}

function createPrisma() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL");
  }

  const disableVerify = process.env.DATABASE_SSL_NO_VERIFY === "true";
  const ssl = disableVerify ? { rejectUnauthorized: false } : undefined;

  const sanitizedConnectionString = (() => {
    if (!disableVerify) {
      return connectionString;
    }
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslrootcert");
    return url.toString();
  })();

  const pool = new Pool({ connectionString: sanitizedConnectionString, ssl });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

async function loadDbExercises(prisma: PrismaClient) {
  return prisma.exercise.findMany({
    include: {
      exerciseEquipment: { include: { equipment: true } },
      exerciseMuscles: { include: { muscle: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function verifyExerciseLibrary() {
  const jsonPath = path.resolve(process.cwd(), "prisma/exercises_comprehensive.json");
  const jsonData = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as JsonData;
  const jsonExercises = jsonData.exercises ?? [];

  const prisma = createPrisma();
  try {
    const dbExercises = await loadDbExercises(prisma);
    const jsonByName = new Map(jsonExercises.map((exercise) => [exercise.name, exercise]));
    const dbByName = new Map(dbExercises.map((exercise) => [exercise.name, exercise]));

    const missingInDb = jsonExercises
      .map((exercise) => exercise.name)
      .filter((name) => !dbByName.has(name))
      .sort((a, b) => a.localeCompare(b));

    const extraInDb = dbExercises
      .map((exercise) => exercise.name)
      .filter((name) => !jsonByName.has(name))
      .sort((a, b) => a.localeCompare(b));

    const mismatches: string[] = [];
    for (const [name, jsonExercise] of jsonByName.entries()) {
      const dbExercise = dbByName.get(name);
      if (!dbExercise) continue;
      mismatches.push(...diffFields(name, jsonExercise, dbExercise));
    }

    return {
      jsonCount: jsonExercises.length,
      dbCount: dbExercises.length,
      missingInDb,
      extraInDb,
      mismatches,
      isClean: missingInDb.length === 0 && extraInDb.length === 0 && mismatches.length === 0,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const result = await verifyExerciseLibrary();
  console.log(`JSON exercises: ${result.jsonCount}`);
  console.log(`DB exercises: ${result.dbCount}`);
  console.log(`Missing in DB: ${result.missingInDb.length}`);
  console.log(`Extra in DB: ${result.extraInDb.length}`);
  console.log(`Field mismatches: ${result.mismatches.length}`);

  if (result.missingInDb.length > 0) {
    console.log("\nMissing in DB:");
    for (const name of result.missingInDb) {
      console.log(`- ${name}`);
    }
  }

  if (result.extraInDb.length > 0) {
    console.log("\nExtra in DB:");
    for (const name of result.extraInDb) {
      console.log(`- ${name}`);
    }
  }

  if (result.mismatches.length > 0) {
    console.log("\nField mismatches:");
    for (const mismatch of result.mismatches.slice(0, 200)) {
      console.log(`- ${mismatch}`);
    }
    if (result.mismatches.length > 200) {
      console.log(`... and ${result.mismatches.length - 200} more`);
    }
  }

  if (!result.isClean) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to verify exercise library", error);
    process.exit(1);
  });
}
