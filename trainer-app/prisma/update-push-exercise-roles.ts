import { PrismaClient, type MesocycleExerciseRoleType, type WorkoutSessionIntent } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const delimiter = trimmed.indexOf("=");
    if (delimiter <= 0) continue;
    const key = trimmed.slice(0, delimiter);
    const rawValue = trimmed.slice(delimiter + 1);
    const value = rawValue.replace(/^"|"$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing DATABASE_URL");
}
const disableVerify = process.env.DATABASE_SSL_NO_VERIFY === "true";
const sanitizedConnectionString = (() => {
  if (!disableVerify) {
    return connectionString;
  }
  const url = new URL(connectionString);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  return url.toString();
})();

const pool = new Pool({
  connectionString: sanitizedConnectionString,
  ssl: disableVerify ? { rejectUnauthorized: false } : undefined,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const MESOCYCLE_ID = "85ecd62b-788e-4a51-96c1-e38862996377";
const SESSION_INTENT: WorkoutSessionIntent = "PUSH";

type CanonicalExercise = {
  name: string;
  role: MesocycleExerciseRoleType;
  addedInWeek: number;
};

const CANONICAL_PUSH_EXERCISES: CanonicalExercise[] = [
  {
    name: "Incline Dumbbell Bench Press",
    role: "CORE_COMPOUND",
    addedInWeek: 1,
  },
  {
    name: "Dumbbell Overhead Press",
    role: "CORE_COMPOUND",
    addedInWeek: 1,
  },
  {
    name: "Dip (Chest Emphasis)",
    role: "ACCESSORY",
    addedInWeek: 1,
  },
  {
    name: "Overhead Cable Triceps Extension",
    role: "ACCESSORY",
    addedInWeek: 1,
  },
  {
    name: "Cable Lateral Raise",
    role: "ACCESSORY",
    addedInWeek: 1,
  },
];

async function resolveExerciseByName(name: string) {
  const exact = await prisma.exercise.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (exact) {
    return exact;
  }

  const aliasMatch = await prisma.exerciseAlias.findFirst({
    where: { alias: { equals: name, mode: "insensitive" } },
    select: {
      exercise: {
        select: { id: true, name: true },
      },
    },
  });
  return aliasMatch?.exercise ?? null;
}

async function main() {
  const mesocycle = await prisma.mesocycle.findUnique({
    where: { id: MESOCYCLE_ID },
    select: { id: true },
  });
  if (!mesocycle) {
    throw new Error(`Mesocycle not found: ${MESOCYCLE_ID}`);
  }

  const resolved = await Promise.all(
    CANONICAL_PUSH_EXERCISES.map(async (entry) => {
      const exercise = await resolveExerciseByName(entry.name);
      if (!exercise) {
        throw new Error(`Could not resolve exercise "${entry.name}" by name or alias`);
      }
      return { entry, exercise };
    })
  );

  const canonicalIds = new Set(resolved.map((item) => item.exercise.id));
  if (canonicalIds.size !== resolved.length) {
    throw new Error("Canonical PUSH exercise list resolved to duplicate exercise IDs.");
  }

  const deleted = await prisma.mesocycleExerciseRole.deleteMany({
    where: {
      mesocycleId: MESOCYCLE_ID,
      sessionIntent: SESSION_INTENT,
      NOT: {
        exerciseId: { in: [...canonicalIds] },
      },
    },
  });

  let inserted = 0;
  let updated = 0;

  for (const item of resolved) {
    const existing = await prisma.mesocycleExerciseRole.findUnique({
      where: {
        mesocycleId_exerciseId_sessionIntent: {
          mesocycleId: MESOCYCLE_ID,
          exerciseId: item.exercise.id,
          sessionIntent: SESSION_INTENT,
        },
      },
      select: { id: true },
    });

    await prisma.mesocycleExerciseRole.upsert({
      where: {
        mesocycleId_exerciseId_sessionIntent: {
          mesocycleId: MESOCYCLE_ID,
          exerciseId: item.exercise.id,
          sessionIntent: SESSION_INTENT,
        },
      },
      create: {
        mesocycleId: MESOCYCLE_ID,
        exerciseId: item.exercise.id,
        sessionIntent: SESSION_INTENT,
        role: item.entry.role,
        addedInWeek: item.entry.addedInWeek,
      },
      update: {
        role: item.entry.role,
        addedInWeek: item.entry.addedInWeek,
      },
    });

    if (existing) updated += 1;
    else inserted += 1;
  }

  const finalRows = await prisma.mesocycleExerciseRole.findMany({
    where: {
      mesocycleId: MESOCYCLE_ID,
      sessionIntent: SESSION_INTENT,
    },
    include: {
      exercise: { select: { id: true, name: true } },
    },
    orderBy: [{ addedInWeek: "asc" }, { role: "asc" }, { exercise: { name: "asc" } }],
  });

  console.log(`Mesocycle: ${MESOCYCLE_ID}`);
  console.log(`Session intent: ${SESSION_INTENT}`);
  console.log(`Deleted non-canonical PUSH rows: ${deleted.count}`);
  console.log(`Inserted canonical rows: ${inserted}`);
  console.log(`Updated canonical rows: ${updated}`);
  console.log("Final PUSH MesocycleExerciseRole rows:");
  for (const row of finalRows) {
    console.log(`  (${row.exerciseId}, ${row.exercise.name}, ${row.role}, ${row.addedInWeek})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
