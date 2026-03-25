import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import type { SessionSlotSnapshot } from "@/lib/evidence/types";
import type { SaveableSelectionMetadata } from "@/lib/ui/selection-metadata";
import { attachSessionSlotMetadata } from "@/lib/ui/selection-metadata";
import {
  HISTORICAL_SESSION_SLOT_PERSISTENCE_FIX_CUTOFF_ISO,
  inferHistoricalSessionSlotRepair,
  type HistoricalSessionSlotRepairResult,
} from "@/lib/api/historical-session-slot-repair";

type ParsedArgs = {
  apply: boolean;
  workoutId?: string;
  userId?: string;
  limit: number;
};

type CandidateWorkoutRow = {
  id: string;
  userId: string;
  status: string;
  advancesSplit: boolean | null;
  selectionMode: string | null;
  sessionIntent: string | null;
  selectionMetadata: Prisma.JsonValue | null;
  mesocycleId: string | null;
  mesocycleWeekSnapshot: number | null;
  scheduledDate: Date;
  completedAt: Date | null;
  exercises: Array<{
    exerciseId: string;
    orderIndex: number;
  }>;
  mesocycle: {
    slotSequenceJson: Prisma.JsonValue | null;
    slotPlanSeedJson: Prisma.JsonValue | null;
  } | null;
};

type ConflictWorkoutRow = {
  id: string;
  userId: string;
  mesocycleId: string | null;
  status: string;
  advancesSplit: boolean | null;
  selectionMode: string | null;
  sessionIntent: string | null;
  selectionMetadata: Prisma.JsonValue | null;
  mesocycleWeekSnapshot: number | null;
};

type ReportRow = {
  workoutId: string;
  userId: string;
  mesocycleId: string | null;
  completedAt: string | null;
  scheduledDate: string;
  result: HistoricalSessionSlotRepairResult["kind"];
  candidateWeek: number | null;
  matchedSlotIds: string[];
  workoutExerciseIds: string[];
  reason: string | null;
  sessionSlot: SessionSlotSnapshot | null;
  conflictingWorkoutIds: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  let apply = false;
  const args: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") {
      apply = true;
      continue;
    }
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      continue;
    }
    args[key] = value;
    index += 1;
  }

  const parsedLimit = Number.parseInt(args.limit ?? "2000", 10);
  return {
    apply,
    workoutId: args["workout-id"],
    userId: args["user-id"],
    limit: Number.isFinite(parsedLimit) ? Math.max(1, parsedLimit) : 2000,
  };
}

function buildPairKey(userId: string, mesocycleId: string): string {
  return `${userId}::${mesocycleId}`;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function buildReportRow(
  workout: CandidateWorkoutRow,
  result: HistoricalSessionSlotRepairResult
): ReportRow {
  return {
    workoutId: workout.id,
    userId: workout.userId,
    mesocycleId: workout.mesocycleId,
    completedAt: workout.completedAt?.toISOString() ?? null,
    scheduledDate: workout.scheduledDate.toISOString(),
    result: result.kind,
    candidateWeek: result.candidateWeek,
    matchedSlotIds: result.matchedSlotIds,
    workoutExerciseIds: result.workoutExerciseIds,
    reason: "reason" in result ? result.reason : null,
    sessionSlot: result.kind === "repairable" ? result.sessionSlot : null,
    conflictingWorkoutIds:
      result.kind === "skipped_conflict" ? result.conflictingWorkoutIds : [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  const cutoff = new Date(HISTORICAL_SESSION_SLOT_PERSISTENCE_FIX_CUTOFF_ISO);

  try {
    const historicalWindowWorkouts = (await prisma.workout.findMany({
      where: {
        status: "COMPLETED",
        advancesSplit: true,
        sessionIntent: { not: null },
        mesocycleId: { not: null },
        completedAt: { lt: cutoff },
        ...(args.workoutId ? { id: args.workoutId } : {}),
        ...(args.userId ? { userId: args.userId } : {}),
      },
      orderBy: [{ completedAt: "asc" }, { scheduledDate: "asc" }],
      take: args.limit,
      select: {
        id: true,
        userId: true,
        status: true,
        advancesSplit: true,
        selectionMode: true,
        sessionIntent: true,
        selectionMetadata: true,
        mesocycleId: true,
        mesocycleWeekSnapshot: true,
        scheduledDate: true,
        completedAt: true,
        exercises: {
          orderBy: { orderIndex: "asc" },
          select: {
            exerciseId: true,
            orderIndex: true,
          },
        },
        mesocycle: {
          select: {
            slotSequenceJson: true,
            slotPlanSeedJson: true,
          },
        },
      },
    })) as CandidateWorkoutRow[];

    const candidateWorkouts = historicalWindowWorkouts.filter((workout) => {
      const receipt = readSessionDecisionReceipt(workout.selectionMetadata);
      return Boolean(receipt) && !receipt?.sessionSlot;
    });

    const pairKeys = Array.from(
      new Set(
        candidateWorkouts.flatMap((workout) =>
          workout.mesocycleId ? [buildPairKey(workout.userId, workout.mesocycleId)] : []
        )
      )
    );

    const conflictWhere: Prisma.WorkoutWhereInput =
      pairKeys.length === 0
        ? { id: "__no_candidate_pairs__" }
        : {
            status: { in: ["COMPLETED", "PARTIAL"] },
            sessionIntent: { not: null },
            OR: pairKeys.map((pairKey) => {
              const [userId, mesocycleId] = pairKey.split("::");
              return {
                userId,
                mesocycleId,
              };
            }),
          };

    const potentialConflicts = (await prisma.workout.findMany({
      where: conflictWhere,
      select: {
        id: true,
        userId: true,
        mesocycleId: true,
        status: true,
        advancesSplit: true,
        selectionMode: true,
        sessionIntent: true,
        selectionMetadata: true,
        mesocycleWeekSnapshot: true,
      },
    })) as ConflictWorkoutRow[];

    const conflictsByPair = new Map<string, ConflictWorkoutRow[]>();
    for (const workout of potentialConflicts) {
      if (!workout.mesocycleId) {
        continue;
      }
      const pairKey = buildPairKey(workout.userId, workout.mesocycleId);
      const existing = conflictsByPair.get(pairKey) ?? [];
      existing.push(workout);
      conflictsByPair.set(pairKey, existing);
    }

    const reports = candidateWorkouts.map((workout) => {
      const pairKey =
        workout.mesocycleId != null ? buildPairKey(workout.userId, workout.mesocycleId) : null;
      const conflictingWorkouts =
        pairKey == null
          ? []
          : (conflictsByPair.get(pairKey) ?? []).filter((entry) => entry.id !== workout.id);

      const result = inferHistoricalSessionSlotRepair({
        id: workout.id,
        advancesSplit: workout.advancesSplit,
        selectionMode: workout.selectionMode,
        sessionIntent: workout.sessionIntent,
        selectionMetadata: workout.selectionMetadata,
        mesocycleWeekSnapshot: workout.mesocycleWeekSnapshot,
        exercises: workout.exercises,
        mesocycle: workout.mesocycle,
        conflictingWorkouts,
      });

      return {
        workout,
        result,
        report: buildReportRow(workout, result),
      };
    });

    const summary = reports.reduce(
      (acc, entry) => {
        acc.scanned += 1;
        if (entry.result.kind === "repairable") {
          acc.wouldRepair += 1;
        } else if (entry.result.kind === "skipped_ambiguous") {
          acc.skippedAmbiguous += 1;
        } else if (entry.result.kind === "skipped_no_match") {
          acc.skippedNoMatch += 1;
        } else if (entry.result.kind === "skipped_conflict") {
          acc.skippedConflict += 1;
        } else if (entry.result.kind === "skipped_unseeded") {
          acc.skippedUnseeded += 1;
        } else {
          acc.skippedOther += 1;
        }
        return acc;
      },
      {
        windowRows: historicalWindowWorkouts.length,
        excludedNonTargetRows: historicalWindowWorkouts.length - candidateWorkouts.length,
        scanned: 0,
        wouldRepair: 0,
        skippedAmbiguous: 0,
        skippedNoMatch: 0,
        skippedConflict: 0,
        skippedUnseeded: 0,
        skippedOther: 0,
      }
    );

    if (!args.apply) {
      console.log(
        JSON.stringify(
          {
            mode: "dry-run",
            cutoffIso: HISTORICAL_SESSION_SLOT_PERSISTENCE_FIX_CUTOFF_ISO,
            filters: {
              workoutId: args.workoutId ?? null,
              userId: args.userId ?? null,
              limit: args.limit,
            },
            summary,
            reports: reports.map((entry) => entry.report),
          },
          null,
          2
        )
      );
      return;
    }

    const repairable = reports.filter(
      (entry): entry is (typeof reports)[number] & {
        result: Extract<HistoricalSessionSlotRepairResult, { kind: "repairable" }>;
      } => entry.result.kind === "repairable"
    );

    await prisma.$transaction(async (tx) => {
      for (const entry of repairable) {
        const nextSelectionMetadata = attachSessionSlotMetadata(
          (entry.workout.selectionMetadata ?? {}) as SaveableSelectionMetadata,
          entry.result.sessionSlot
        );

        await tx.workout.update({
          where: { id: entry.workout.id },
          data: {
            selectionMetadata: toPrismaJson(nextSelectionMetadata),
          },
        });
      }
    });

    console.log(
      JSON.stringify(
        {
          mode: "apply",
          cutoffIso: HISTORICAL_SESSION_SLOT_PERSISTENCE_FIX_CUTOFF_ISO,
          filters: {
            workoutId: args.workoutId ?? null,
            userId: args.userId ?? null,
            limit: args.limit,
          },
          summary: {
            ...summary,
            applied: repairable.length,
          },
          reports: reports.map((entry) => entry.report),
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[repair-historical-session-slot-receipts] ${message}`);
  process.exitCode = 1;
});
