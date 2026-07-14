import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import { loadExerciseRotationContext } from "../src/lib/api/exercise-rotation-history";

type LegacyExposureRow = {
  userId: string;
  exerciseName: string;
  lastUsedAt: Date;
  timesUsedL4W: number;
  timesUsedL8W: number;
  timesUsedL12W: number;
  avgSetsPerWeek: number;
  avgVolumePerWeek: number;
};

function parseUserId(argv: string[]): string | undefined {
  const value = argv.find((arg) => arg.startsWith("--user-id="));
  return value?.slice("--user-id=".length) || undefined;
}

function listProductionFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const entryPath = path.join(root, entry);
    if (statSync(entryPath).isDirectory()) {
      return listProductionFiles(entryPath);
    }
    if (!/\.tsx?$/.test(entryPath) || /\.test\.tsx?$/.test(entryPath)) {
      return [];
    }
    return [entryPath];
  });
}

function readOwnershipSignals() {
  const files = listProductionFiles("src");
  const directLegacyAccess = files.filter((file) =>
    /\.exerciseExposure\b/.test(readFileSync(file, "utf8"))
  );
  const retiredHelperImports = files.filter((file) =>
    /["'](?:@\/lib\/api|\.)\/exercise-exposure["']/.test(
      readFileSync(file, "utf8")
    )
  );

  return {
    productionReadersOrWriters: directLegacyAccess,
    retiredHelperImports,
  };
}

async function loadLegacyRows(userId?: string): Promise<LegacyExposureRow[] | null> {
  try {
    return await prisma.$queryRaw<LegacyExposureRow[]>(Prisma.sql`
      SELECT
        "userId",
        "exerciseName",
        "lastUsedAt",
        "timesUsedL4W",
        "timesUsedL8W",
        "timesUsedL12W",
        "avgSetsPerWeek",
        "avgVolumePerWeek"
      FROM "ExerciseExposure"
      WHERE (${userId ?? null}::text IS NULL OR "userId" = ${userId ?? null})
      ORDER BY "userId", "exerciseName"
    `);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2010" &&
      String(error.meta?.message ?? "").includes("does not exist")
    ) {
      return null;
    }
    throw error;
  }
}

async function main() {
  const userId = parseUserId(process.argv.slice(2));
  const [legacyRows, catalog] = await Promise.all([
    loadLegacyRows(userId),
    prisma.exercise.findMany({ select: { id: true, name: true } }),
  ]);
  const ownership = readOwnershipSignals();

  if (legacyRows == null) {
    console.log(
      JSON.stringify(
        {
          mode: "read_only",
          legacyTable: "absent",
          activeProjection: false,
          rotationFreshnessSource: "performed_workout_history_by_exercise_id",
          ownership,
        },
        null,
        2
      )
    );
    return;
  }

  const catalogByName = new Map<string, string[]>();
  for (const exercise of catalog) {
    catalogByName.set(exercise.name, [
      ...(catalogByName.get(exercise.name) ?? []),
      exercise.id,
    ]);
  }

  const userIds = [...new Set(legacyRows.map((row) => row.userId))];
  const canonicalByUser = new Map(
    await Promise.all(
      userIds.map(async (id) => [id, await loadExerciseRotationContext(id)] as const)
    )
  );
  let exact = 0;
  let ambiguous = 0;
  let missing = 0;
  let lastUsedDrift = 0;
  const stableKeys = new Map<string, number>();

  for (const row of legacyRows) {
    const matches = catalogByName.get(row.exerciseName) ?? [];
    if (matches.length === 0) {
      missing += 1;
      continue;
    }
    if (matches.length > 1) {
      ambiguous += 1;
      continue;
    }
    exact += 1;
    const stableKey = `${row.userId}:${matches[0]}`;
    stableKeys.set(stableKey, (stableKeys.get(stableKey) ?? 0) + 1);
    const canonical = canonicalByUser.get(row.userId)?.get(matches[0]);
    if (!canonical || canonical.lastUsed.getTime() !== row.lastUsedAt.getTime()) {
      lastUsedDrift += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: "read_only",
        activeProjection: false,
        legacyTable: "retained_for_rollout_comparison",
        projectionVersion: null,
        computedThrough: null,
        staleProjectionState: "retired_untrusted",
        rotationFreshnessSource: "performed_workout_history_by_exercise_id",
        totalRows: legacyRows.length,
        mapping: {
          exactUnique: exact,
          ambiguous,
          missing,
          duplicateCatalogNames: [...catalogByName.values()].filter(
            (matches) => matches.length > 1
          ).length,
          multipleRowsResolvingToOneStableId: [...stableKeys.values()].filter(
            (count) => count > 1
          ).length,
          orphaned: missing,
        },
        drift: {
          lastUsedAt: lastUsedDrift,
          rollingCounts: "retired_untrusted_not_consumed",
          averageSetsPerWeek: "retired_untrusted_not_consumed",
          averageVolumePerWeek: "retired_untrusted_not_consumed",
        },
        ownership,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Exercise exposure retirement audit failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
