import type { Prisma as PrismaTypes, PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import {
  buildExerciseStimulusSnapshot,
  parseExerciseStimulusSnapshot,
} from "@/lib/stimulus-accounting/snapshot";
import {
  runWithRolloutEnvironment,
  sanitizedRolloutEnvironment,
} from "@/lib/operations/rollout-environment";

type Options = {
  write: boolean;
  batchSize: number;
  afterId?: string;
  limit?: number;
  inventoryOnly: boolean;
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
    inventoryOnly: process.argv.includes("--inventory-only"),
  };
}

async function createClient(): Promise<{ prisma: PrismaClient; pool: Pool }> {
  const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
    import("@prisma/client"),
    import("@prisma/adapter-pg"),
  ]);
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

type InventoryRow = {
  workoutExerciseId: string;
  exerciseId: string | null;
  exerciseName: string | null;
  aliases: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
};

async function runInventory(pool: Pool): Promise<void> {
  const result = await pool.query<InventoryRow>(`
    SELECT we."id" AS "workoutExerciseId", e."id" AS "exerciseId",
      e."name" AS "exerciseName",
      COALESCE((SELECT json_agg(a."alias" ORDER BY a."alias") FROM "ExerciseAlias" a
        WHERE a."exerciseId" = e."id"), '[]'::json) AS aliases,
      COALESCE((SELECT json_agg(m."name" ORDER BY m."name") FROM "ExerciseMuscle" em
        JOIN "Muscle" m ON m."id" = em."muscleId"
        WHERE em."exerciseId" = e."id" AND em."role" = 'PRIMARY'), '[]'::json) AS "primaryMuscles",
      COALESCE((SELECT json_agg(m."name" ORDER BY m."name") FROM "ExerciseMuscle" em
        JOIN "Muscle" m ON m."id" = em."muscleId"
        WHERE em."exerciseId" = e."id" AND em."role" = 'SECONDARY'), '[]'::json) AS "secondaryMuscles"
    FROM "WorkoutExercise" we
    LEFT JOIN "Exercise" e ON e."id" = we."exerciseId"
    ORDER BY we."id"
  `);
  const summary = {
    mode: "projected_pre_migration_inventory",
    writes: 0,
    totalCandidateWorkoutExercises: result.rows.length,
    canonicalProfilesResolved: 0,
    missingOrInvalidExerciseIds: 0,
    emptyVectors: 0,
    projectedProvenance: { legacy_derived: 0 },
    hashDistribution: {} as Record<string, number>,
    estimatedPayloadBytes: 0,
    expectedWriteCountAfterMigration: 0,
    failures: [] as Array<{ workoutExerciseId: string; reason: string }>,
  };

  for (const row of result.rows) {
    if (!row.exerciseId || !row.exerciseName) {
      summary.missingOrInvalidExerciseIds += 1;
      summary.failures.push({
        workoutExerciseId: row.workoutExerciseId,
        reason: "canonical_exercise_missing",
      });
      continue;
    }
    try {
      const snapshot = buildExerciseStimulusSnapshot(
        {
          id: row.exerciseId,
          name: row.exerciseName,
          aliases: row.aliases,
          primaryMuscles: row.primaryMuscles,
          secondaryMuscles: row.secondaryMuscles,
        },
        "legacy_derived",
      );
      if (snapshot.contributions.length === 0) summary.emptyVectors += 1;
      summary.canonicalProfilesResolved += 1;
      summary.projectedProvenance.legacy_derived += 1;
      summary.hashDistribution[snapshot.policyHash] =
        (summary.hashDistribution[snapshot.policyHash] ?? 0) + 1;
      summary.estimatedPayloadBytes += Buffer.byteLength(JSON.stringify(snapshot));
      summary.expectedWriteCountAfterMigration += 1;
    } catch (error) {
      summary.emptyVectors += 1;
      summary.failures.push({
        workoutExerciseId: row.workoutExerciseId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.log(JSON.stringify(summary, null, 2));
}

async function main(): Promise<void> {
  const options = parseOptions();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  if (options.inventoryOnly) {
    try {
      await runInventory(pool);
    } finally {
      await pool.end();
    }
    return;
  }
  const { Prisma } = await import("@prisma/client");
  await pool.end();
  const { prisma, pool: prismaPool } = await createClient();
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

      const writes: Array<{ id: string; snapshot: PrismaTypes.InputJsonValue }> = [];
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
          writes.push({ id: row.id, snapshot: snapshot as PrismaTypes.InputJsonValue });
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
    await prismaPool.end();
  }
}

runWithRolloutEnvironment(
  { argv: process.argv.slice(2), allowWrite: true },
  async (environment) => {
    console.log(JSON.stringify({ environment: sanitizedRolloutEnvironment(environment) }));
    await main();
  },
).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
