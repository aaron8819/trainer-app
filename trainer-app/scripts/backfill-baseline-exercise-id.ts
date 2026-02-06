import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing DATABASE_URL for backfill");
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

const prisma = new PrismaClient({ adapter });

function normalizeName(name: string) {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s()-]/g, "")
    .trim();
}

async function main() {
  const exercises = await prisma.exercise.findMany({
    include: { aliases: true },
  });

  const exerciseByName = new Map<string, string>();
  const aliasToId = new Map<string, string>();

  for (const exercise of exercises) {
    exerciseByName.set(normalizeName(exercise.name), exercise.id);
    for (const alias of exercise.aliases) {
      aliasToId.set(normalizeName(alias.alias), exercise.id);
    }
  }

  const baselines = await prisma.baseline.findMany();
  let updated = 0;
  let skipped = 0;
  let matchedByName = 0;
  let matchedByAlias = 0;
  const unmatched: string[] = [];

  for (const baseline of baselines) {
    if (baseline.exerciseId) {
      skipped++;
      continue;
    }

    const normalized = normalizeName(baseline.exerciseName);
    const exerciseIdByName = exerciseByName.get(normalized);
    const exerciseIdByAlias = aliasToId.get(normalized);
    const exerciseId = exerciseIdByName ?? exerciseIdByAlias;
    if (!exerciseId) {
      unmatched.push(baseline.exerciseName);
      continue;
    }

    await prisma.baseline.update({
      where: { id: baseline.id },
      data: { exerciseId },
    });
    updated++;
    if (exerciseIdByName) {
      matchedByName++;
    } else if (exerciseIdByAlias) {
      matchedByAlias++;
    }
  }

  console.log(`Updated ${updated} baselines.`);
  console.log(`Skipped ${skipped} baselines (already set).`);
  console.log(`Matched by name: ${matchedByName}.`);
  console.log(`Matched by alias: ${matchedByAlias}.`);
  if (unmatched.length > 0) {
    console.warn(`Unmatched baselines (${unmatched.length}): ${unmatched.join(", ")}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
