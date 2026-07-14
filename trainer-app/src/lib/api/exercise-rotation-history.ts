import { prisma } from "@/lib/db/prisma";
import { isCloseoutSession } from "@/lib/session-semantics/closeout-classifier";
import { classifySetLog } from "@/lib/session-semantics/set-classification";
import { readRuntimeAddedExerciseIds } from "@/lib/ui/selection-metadata";
import { Prisma } from "@prisma/client";
import type { RotationContext } from "@/lib/engine/selection-v2/types";

const ROTATION_LOOKBACK_MS = 12 * 7 * 24 * 60 * 60 * 1000;

export const performedRotationLogWhere = {
  wasSkipped: false,
  setIntent: "WORK",
  OR: [{ actualReps: { not: null } }, { actualRpe: { not: null } }],
} satisfies Prisma.SetLogWhereInput;

const rotationHistorySelect = {
  id: true,
  exerciseId: true,
  workout: {
    select: {
      selectionMetadata: true,
    },
  },
  sets: {
    select: {
      logs: {
        orderBy: { completedAt: "desc" },
        take: 1,
        select: {
          completedAt: true,
          actualLoad: true,
          actualReps: true,
          actualRpe: true,
          setIntent: true,
          wasSkipped: true,
        },
      },
    },
  },
} satisfies Prisma.WorkoutExerciseSelect;

export type RotationHistoryRow = Prisma.WorkoutExerciseGetPayload<{
  select: typeof rotationHistorySelect;
}>;

function latestQualifyingPerformedAt(row: RotationHistoryRow): Date | null {
  let latest: Date | null = null;

  for (const set of row.sets) {
    const log = set.logs[0];
    if (!log || !classifySetLog(log).isWorkEvidence) {
      continue;
    }
    if (!latest || log.completedAt > latest) {
      latest = log.completedAt;
    }
  }

  return latest;
}

function isQualifyingRotationRow(row: RotationHistoryRow): boolean {
  if (isCloseoutSession(row.workout.selectionMetadata)) {
    return false;
  }
  return !readRuntimeAddedExerciseIds(row.workout.selectionMetadata).has(row.id);
}

export function buildExerciseRotationContext(
  rows: RotationHistoryRow[],
  now: Date = new Date()
): RotationContext {
  const latestByExerciseId = new Map<string, Date>();

  for (const row of rows) {
    if (!isQualifyingRotationRow(row)) {
      continue;
    }
    const performedAt = latestQualifyingPerformedAt(row);
    if (!performedAt) {
      continue;
    }
    const current = latestByExerciseId.get(row.exerciseId);
    if (!current || performedAt > current) {
      latestByExerciseId.set(row.exerciseId, performedAt);
    }
  }

  return new Map(
    [...latestByExerciseId.entries()].map(([exerciseId, lastUsed]) => {
      const diffMs = Math.max(0, now.getTime() - lastUsed.getTime());
      return [
        exerciseId,
        {
          lastUsed,
          weeksAgo: Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)),
        },
      ];
    })
  );
}

async function loadRotationHistoryRows(input: {
  userId: string;
  performedAtGte?: Date;
}): Promise<RotationHistoryRow[]> {
  return prisma.workoutExercise.findMany({
    where: {
      workout: {
        userId: input.userId,
        status: "COMPLETED",
      },
      sets: {
        some: {
          logs: {
            some: {
              ...performedRotationLogWhere,
              completedAt: input.performedAtGte
                ? { gte: input.performedAtGte }
                : undefined,
            },
          },
        },
      },
    },
    select: rotationHistorySelect,
  });
}

/**
 * Derives selection freshness from canonical performed history.
 * The map is keyed by stable Exercise.id; exercise names are display metadata only.
 */
export async function loadExerciseRotationContext(
  userId: string,
  now: Date = new Date()
): Promise<RotationContext> {
  return buildExerciseRotationContext(
    await loadRotationHistoryRows({
      userId,
      performedAtGte: new Date(now.getTime() - ROTATION_LOOKBACK_MS),
    }),
    now
  );
}

/** Returns stable IDs with qualifying performed work at or after the cutoff. */
export async function loadRecentPerformedExerciseIds(
  userId: string,
  cutoff: Date,
  now: Date = new Date()
): Promise<Set<string>> {
  const context = buildExerciseRotationContext(
    await loadRotationHistoryRows({ userId, performedAtGte: cutoff }),
    now
  );
  return new Set(
    [...context.entries()]
      .filter(([, exposure]) => exposure.lastUsed >= cutoff)
      .map(([exerciseId]) => exerciseId)
  );
}
