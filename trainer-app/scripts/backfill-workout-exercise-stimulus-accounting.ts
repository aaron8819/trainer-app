import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  buildExerciseStimulusSnapshot,
  parseExerciseStimulusSnapshot,
} from "@/lib/stimulus-accounting/snapshot";

type Options = {
  write: boolean;
  batchSize: number;
  afterId?: string;
  limit?: number;
};

function readValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readPositiveInteger(name: string, fallback?: number): number | undefined {
  const raw = readValue(name);
  if (raw == null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function parseOptions(): Options {
  return {
    write: process.argv.includes("--write"),
    batchSize: readPositiveInteger("--batch-size", 100)!,
    afterId: readValue("--after-id"),
    limit: readPositiveInteger("--limit"),
  };
}

function createClient(): { prisma: PrismaClient; pool: Pool } {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing DATABASE_URL");
  const disableVerify = process.env.DATABASE_SSL_NO_VERIFY === "true";
  const ssl = disableVerify ? { rejectUnauthorized: false } : undefined;
  const url = new URL(connectionString);
  if (disableVerify) {
    url.searchParams.delete("sslmode");
    url.searchParams.delete("sslrootcert");
  }
  const pool = new Pool({ connectionString: url.toString(), ssl });
  return { prisma: new PrismaClient({ adapter: new PrismaPg(pool) }), pool };
}

async function main(): Promise<void> {
  const options = parseOptions();
  const { prisma, pool } = createClient();
  const summary = {
    mode: options.write ? "write" : "dry_run",
    contractVersion: 1,
    afterId: options.afterId ?? null,
    batchSize: options.batchSize,
    limit: options.limit ?? null,
    scanned: 0,
    exact: 0,
    legacyDerived: 0,
    legacyUnknown: 0,
    invalidPersisted: 0,
    eligibleNullRows: 0,
    updated: 0,
    writeConflicts: 0,
    lastScannedId: options.afterId ?? null,
    sourceHistoryCapabilities: {
      renameHistory: "unsupported_by_schema",
      inactiveHistory: "unsupported_by_schema",
    },
    hashDistribution: {} as Record<string, number>,
    unknownWorkoutExerciseIds: [] as string[],
    invalidWorkoutExerciseIds: [] as string[],
  };

  let cursor = options.afterId;
  try {
    while (options.limit == null || summary.scanned < options.limit) {
      const take = Math.min(
        options.batchSize,
        options.limit == null ? options.batchSize : options.limit - summary.scanned
      );
      const rows = await prisma.workoutExercise.findMany({
        where: cursor ? { id: { gt: cursor } } : undefined,
        orderBy: { id: "asc" },
        take,
        select: {
          id: true,
          stimulusAccountingSnapshot: true,
          exercise: {
            select: {
              id: true,
              name: true,
              aliases: { select: { alias: true } },
              exerciseMuscles: {
                select: { role: true, muscle: { select: { name: true } } },
              },
            },
          },
        },
      });
      if (rows.length === 0) break;

      const writes: Array<{ id: string; snapshot: Prisma.InputJsonValue }> = [];
      for (const row of rows) {
        summary.scanned += 1;
        summary.lastScannedId = row.id;
        if (row.stimulusAccountingSnapshot != null) {
          const snapshot = parseExerciseStimulusSnapshot(row.stimulusAccountingSnapshot);
          if (!snapshot) {
            summary.invalidPersisted += 1;
            summary.invalidWorkoutExerciseIds.push(row.id);
            continue;
          }
          if (snapshot.provenance === "exact") summary.exact += 1;
          else summary.legacyDerived += 1;
          summary.hashDistribution[snapshot.policyHash] =
            (summary.hashDistribution[snapshot.policyHash] ?? 0) + 1;
          continue;
        }

        try {
          const snapshot = buildExerciseStimulusSnapshot(
            {
              id: row.exercise.id,
              name: row.exercise.name,
              aliases: row.exercise.aliases.map((entry) => entry.alias),
              primaryMuscles: row.exercise.exerciseMuscles
                .filter((entry) => entry.role === "PRIMARY")
                .map((entry) => entry.muscle.name),
              secondaryMuscles: row.exercise.exerciseMuscles
                .filter((entry) => entry.role === "SECONDARY")
                .map((entry) => entry.muscle.name),
            },
            "legacy_derived"
          );
          summary.legacyDerived += 1;
          summary.eligibleNullRows += 1;
          summary.hashDistribution[snapshot.policyHash] =
            (summary.hashDistribution[snapshot.policyHash] ?? 0) + 1;
          writes.push({ id: row.id, snapshot: snapshot as Prisma.InputJsonValue });
        } catch {
          summary.legacyUnknown += 1;
          summary.unknownWorkoutExerciseIds.push(row.id);
        }
      }

      if (options.write && writes.length > 0) {
        const results = await prisma.$transaction(
          writes.map((write) =>
            prisma.workoutExercise.updateMany({
              where: { id: write.id, stimulusAccountingSnapshot: { equals: Prisma.DbNull } },
              data: { stimulusAccountingSnapshot: write.snapshot },
            })
          )
        );
        for (const result of results) {
          summary.updated += result.count;
          summary.writeConflicts += result.count === 0 ? 1 : 0;
        }
      }

      cursor = rows.at(-1)!.id;
      if (rows.length < take) break;
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
