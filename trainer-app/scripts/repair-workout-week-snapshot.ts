import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  inferWorkoutCanonicalWeek,
  type CandidateWorkoutRow,
} from "./workout-week-snapshot-repair-lib";

function parseArgs(argv: string[]): {
  apply: boolean;
  userId?: string;
  limit: number;
} {
  let apply = false;
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") {
      apply = true;
      continue;
    }
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) continue;
    args[key] = value;
    i += 1;
  }

  return {
    apply,
    userId: args["user-id"],
    limit: Number(args.limit ?? "2000"),
  };
}

async function main() {
  const { apply, userId, limit } = parseArgs(process.argv.slice(2));
  const where: Prisma.WorkoutWhereInput = {
    mesocycleId: { not: null },
    status: { in: ["COMPLETED", "PARTIAL"] },
    ...(userId ? { userId } : {}),
  };

  const workouts = (await prisma.workout.findMany({
    where,
    orderBy: [{ scheduledDate: "desc" }],
    take: Number.isFinite(limit) ? Math.max(1, Math.trunc(limit)) : 2000,
    select: {
      id: true,
      userId: true,
      status: true,
      selectionMode: true,
      sessionIntent: true,
      selectionMetadata: true,
      scheduledDate: true,
      completedAt: true,
      mesocycleId: true,
      mesocycleWeekSnapshot: true,
      mesocyclePhaseSnapshot: true,
      mesoSessionSnapshot: true,
      advancesSplit: true,
      mesocycle: {
        select: {
          id: true,
          durationWeeks: true,
          sessionsPerWeek: true,
          startWeek: true,
          macroCycle: { select: { startDate: true } },
        },
      },
    },
  })) as CandidateWorkoutRow[];

  const candidates = workouts
    .map((workout) => {
      const inference = inferWorkoutCanonicalWeek(workout);
      return {
        workout,
        inference,
      };
    })
    .filter(({ workout, inference }) => {
      return (
        inference.confidence === "high" &&
        inference.strictGapFill &&
        inference.inferredCanonicalWeek != null &&
        workout.mesocycleWeekSnapshot != null &&
        inference.inferredCanonicalWeek !== workout.mesocycleWeekSnapshot
      );
    });

  const preview = candidates.map(({ workout, inference }) => ({
    workoutId: workout.id,
    userId: workout.userId,
    status: workout.status,
    currentMesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
    inferredCanonicalWeek: inference.inferredCanonicalWeek,
    source: inference.source,
    reason: inference.reason,
  }));

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          message:
            "No writes performed. Re-run with --apply to update high-confidence strict gap-fill rows only.",
          candidateCount: preview.length,
          candidates: preview,
        },
        null,
        2
      )
    );
    return;
  }

  let updated = 0;
  for (const { workout, inference } of candidates) {
    await prisma.workout.update({
      where: { id: workout.id },
      data: { mesocycleWeekSnapshot: inference.inferredCanonicalWeek! },
    });
    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        updated,
        candidates: preview,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[repair-workout-week-snapshot] ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

