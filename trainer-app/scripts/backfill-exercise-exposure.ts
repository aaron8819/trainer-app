/**
 * Rebuild ExerciseExposure from canonical performed history only.
 *
 * Safe mode:
 *   npx tsx scripts/backfill-exercise-exposure.ts --dry-run
 *
 * Execute:
 *   npx tsx scripts/backfill-exercise-exposure.ts
 *
 * Optional:
 *   npx tsx scripts/backfill-exercise-exposure.ts --user=<userId>
 */

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import {
  buildExerciseExposureRows,
  performedExposureLogWhere,
} from "../src/lib/api/exercise-exposure-backfill";

dotenv.config({ path: ".env.local" });
dotenv.config();

type BackfillOptions = {
  dryRun: boolean;
  userId?: string;
};

type DiffSummary = {
  removedExerciseNames: string[];
  keptExerciseNames: string[];
};

function summarizeExerciseCounts(
  counts: Map<string, number>,
  limit = 8
): string {
  if (counts.size === 0) {
    return "none";
  }

  return [...counts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([exerciseName, count]) => `${exerciseName}=${count}`)
    .join(", ");
}

function parseOptions(argv: string[]): BackfillOptions {
  let userId: string | undefined;
  let dryRun = false;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg.startsWith("--user=")) {
      userId = arg.slice("--user=".length);
    }
  }

  return { dryRun, userId };
}

async function rebuildExposureForUser(
  prisma: PrismaClient,
  userId: string,
  options: BackfillOptions
): Promise<{
  userId: string;
  existingRowCount: number;
  rebuiltRowCount: number;
  deleted: number;
  created: number;
  diff: DiffSummary;
}> {
  const [existingRows, workouts] = await Promise.all([
    prisma.exerciseExposure.findMany({
      where: { userId },
      select: { exerciseName: true },
      orderBy: { exerciseName: "asc" },
    }),
    prisma.workout.findMany({
      where: {
        userId,
        status: "COMPLETED",
        exercises: {
          some: {
            sets: {
              some: {
                logs: {
                  some: performedExposureLogWhere,
                },
              },
            },
          },
        },
      },
      select: {
        completedAt: true,
        scheduledDate: true,
        exercises: {
          select: {
            exercise: {
              select: {
                name: true,
              },
            },
            sets: {
              select: {
                logs: {
                  orderBy: { completedAt: "desc" },
                  take: 1,
                  select: {
                    actualLoad: true,
                    actualReps: true,
                    actualRpe: true,
                    wasSkipped: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const existingExerciseNames = new Set(existingRows.map((row) => row.exerciseName));
  const rebuiltRows = buildExerciseExposureRows(userId, workouts, new Date());
  const rebuiltExerciseNames = new Set(rebuiltRows.map((row) => row.exerciseName));
  const removedExerciseNames = [...existingExerciseNames]
    .filter((exerciseName) => !rebuiltExerciseNames.has(exerciseName))
    .sort((left, right) => left.localeCompare(right));
  const keptExerciseNames = [...existingExerciseNames]
    .filter((exerciseName) => rebuiltExerciseNames.has(exerciseName))
    .sort((left, right) => left.localeCompare(right));
  const existingRowCount = existingRows.length;

  if (options.dryRun) {
    return {
      userId,
      existingRowCount,
      rebuiltRowCount: rebuiltRows.length,
      deleted: existingRowCount,
      created: rebuiltRows.length,
      diff: {
        removedExerciseNames,
        keptExerciseNames,
      },
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.exerciseExposure.deleteMany({
      where: { userId },
    });

    if (rebuiltRows.length > 0) {
      await tx.exerciseExposure.createMany({
        data: rebuiltRows,
      });
    }
  });

  return {
    userId,
    existingRowCount,
    rebuiltRowCount: rebuiltRows.length,
    deleted: existingRowCount,
    created: rebuiltRows.length,
    diff: {
      removedExerciseNames,
      keptExerciseNames,
    },
  };
}

async function main() {
  const { prisma } = await import("../src/lib/db/prisma");
  const options = parseOptions(process.argv.slice(2));
  try {
    const users = await prisma.user.findMany({
      where: options.userId ? { id: options.userId } : undefined,
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });

    if (users.length === 0) {
      throw new Error(options.userId ? `User ${options.userId} not found.` : "No users found.");
    }

    console.log(
      options.dryRun
        ? `Dry-run ExerciseExposure rebuild for ${users.length} user(s)`
        : `Rebuilding ExerciseExposure for ${users.length} user(s)`
    );

    let totalDeleted = 0;
    let totalCreated = 0;
    const removedExerciseCounts = new Map<string, number>();
    const keptExerciseCounts = new Map<string, number>();

    for (const user of users) {
      const result = await rebuildExposureForUser(prisma, user.id, options);
      totalDeleted += result.deleted;
      totalCreated += result.created;
      for (const exerciseName of result.diff.removedExerciseNames) {
        removedExerciseCounts.set(exerciseName, (removedExerciseCounts.get(exerciseName) ?? 0) + 1);
      }
      for (const exerciseName of result.diff.keptExerciseNames) {
        keptExerciseCounts.set(exerciseName, (keptExerciseCounts.get(exerciseName) ?? 0) + 1);
      }
      console.log(
        [
          `user=${result.userId}`,
          `existing=${result.existingRowCount}`,
          `rebuilt=${result.rebuiltRowCount}`,
          `delete=${result.deleted}`,
          `create=${result.created}`,
        ].join(" ")
      );
    }

    if (options.dryRun) {
      console.log(`removed(top): ${summarizeExerciseCounts(removedExerciseCounts)}`);
      console.log(`kept(top): ${summarizeExerciseCounts(keptExerciseCounts)}`);
    }

    console.log(
      options.dryRun
        ? `Dry-run complete. delete=${totalDeleted} create=${totalCreated}`
        : `Rebuild complete. delete=${totalDeleted} create=${totalCreated}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error("ExerciseExposure backfill failed:", error);
    process.exit(1);
  });
