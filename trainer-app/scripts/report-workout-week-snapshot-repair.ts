import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  inferWorkoutCanonicalWeek,
  type CandidateWorkoutRow,
  type RepairConfidence,
} from "./workout-week-snapshot-repair-lib";

type ReportRow = {
  workoutId: string;
  userId: string;
  status: string;
  strictGapFill: boolean;
  currentMesocycleWeekSnapshot: number | null;
  inferredCanonicalWeek: number | null;
  confidence: RepairConfidence;
  source: string;
  reason: string;
  receiptWeek: number | null;
  scheduledDateWeek: number | null;
  phaseSnapshot: string | null;
  mesoSessionSnapshot: number | null;
  scheduledDate: string;
  completedAt: string | null;
};

function parseArgs(argv: string[]): { userId?: string; limit: number } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) continue;
    args[key] = value;
    i += 1;
  }
  return {
    userId: args["user-id"],
    limit: Number(args.limit ?? "2000"),
  };
}

function toReportRow(workout: CandidateWorkoutRow): ReportRow {
  const inference = inferWorkoutCanonicalWeek(workout);
  return {
    workoutId: workout.id,
    userId: workout.userId,
    status: workout.status,
    strictGapFill: inference.strictGapFill,
    currentMesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
    inferredCanonicalWeek: inference.inferredCanonicalWeek,
    confidence: inference.confidence,
    source: inference.source,
    reason: inference.reason,
    receiptWeek: inference.receiptWeek,
    scheduledDateWeek: inference.scheduledDateWeek,
    phaseSnapshot: workout.mesocyclePhaseSnapshot,
    mesoSessionSnapshot: workout.mesoSessionSnapshot,
    scheduledDate: workout.scheduledDate.toISOString(),
    completedAt: workout.completedAt?.toISOString() ?? null,
  };
}

function isLikelyCorrupted(row: ReportRow): boolean {
  return (
    row.inferredCanonicalWeek != null &&
    row.currentMesocycleWeekSnapshot != null &&
    row.inferredCanonicalWeek !== row.currentMesocycleWeekSnapshot
  );
}

async function main() {
  const { userId, limit } = parseArgs(process.argv.slice(2));
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

  const rows = workouts.map(toReportRow);
  const mismatches = rows.filter(isLikelyCorrupted);
  const highConfidence = mismatches.filter((row) => row.confidence === "high");
  const byConfidence = rows.reduce<Record<RepairConfidence, number>>(
    (acc, row) => {
      acc[row.confidence] += 1;
      return acc;
    },
    { high: 0, medium: 0, low: 0, none: 0 }
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    filters: { userId: userId ?? null, limit },
    summary: {
      scanned: rows.length,
      likelyCorrupted: mismatches.length,
      highConfidenceRepairable: highConfidence.length,
      byConfidence,
    },
    likelyCorrupted: mismatches,
  };

  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[report-workout-week-snapshot-repair] ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

