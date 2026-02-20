import type { PrismaClient, WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type PRSummary = {
  prsDetected: number;
  updates: Array<{
    exerciseName: string;
    previousTopSet: number | null;
    newTopSet: number;
    unit: string;
  }>;
  repsPRs: Array<{
    exerciseName: string;
    previousTopReps: number | null;
    newTopReps: number;
  }>;
};

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Detects personal records set in the just-completed workout by comparing
 * each exercise's top logged set weight against all previously completed workouts.
 *
 * Must be called within a transaction AFTER the workout has been saved and
 * marked COMPLETED so the current workout's sets are already in the DB.
 */
export async function detectPRsFromWorkout(
  workoutId: string,
  userId: string,
  tx: TransactionClient
): Promise<PRSummary> {
  // Load all logged sets from the current workout
  const currentSets = await tx.setLog.findMany({
    where: {
      workoutSet: {
        workoutExercise: { workoutId },
      },
      wasSkipped: false,
      actualLoad: { not: null },
    },
    include: {
      workoutSet: {
        include: {
          workoutExercise: {
            include: {
              exercise: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (currentSets.length === 0) {
    return { prsDetected: 0, updates: [], repsPRs: [] };
  }

  // Group current sets by exercise, find top set weight per exercise
  const currentTopByExercise = new Map<string, { name: string; topLoad: number }>();
  for (const log of currentSets) {
    if (log.actualLoad == null) continue;
    const exerciseId = log.workoutSet.workoutExercise.exerciseId;
    const exerciseName = log.workoutSet.workoutExercise.exercise.name;
    const existing = currentTopByExercise.get(exerciseId);
    if (!existing || log.actualLoad > existing.topLoad) {
      currentTopByExercise.set(exerciseId, { name: exerciseName, topLoad: log.actualLoad });
    }
  }

  const exerciseIds = [...currentTopByExercise.keys()];
  if (exerciseIds.length === 0) {
    return { prsDetected: 0, updates: [], repsPRs: [] };
  }

  // For each exercise, find historical max weight from OTHER completed workouts
  const historicalMaxByExercise = new Map<string, number | null>();
  await Promise.all(
    exerciseIds.map(async (exerciseId) => {
      const result = await tx.setLog.aggregate({
        _max: { actualLoad: true },
        where: {
          workoutSet: {
            workoutExercise: {
              exerciseId,
              workout: {
                userId,
                status: "COMPLETED" as WorkoutStatus,
                id: { not: workoutId },
              },
            },
          },
          wasSkipped: false,
          actualLoad: { not: null },
        },
      });
      historicalMaxByExercise.set(exerciseId, result._max.actualLoad ?? null);
    })
  );

  // Compare and collect load PRs
  const updates: PRSummary["updates"] = [];
  for (const [exerciseId, { name, topLoad }] of currentTopByExercise.entries()) {
    const prevMax = historicalMaxByExercise.get(exerciseId) ?? null;
    if (prevMax !== null && topLoad > prevMax) {
      updates.push({
        exerciseName: name,
        previousTopSet: prevMax,
        newTopSet: topLoad,
        unit: "lbs",
      });
    }
  }

  // T9: Track reps PRs for bodyweight exercises (sets with no load)
  const bodyweightSets = await tx.setLog.findMany({
    where: {
      workoutSet: { workoutExercise: { workoutId } },
      wasSkipped: false,
      actualLoad: null,
      actualReps: { not: null },
    },
    include: {
      workoutSet: {
        include: {
          workoutExercise: {
            include: { exercise: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  const repsPRs: PRSummary["repsPRs"] = [];
  if (bodyweightSets.length > 0) {
    // Find max reps per exercise in this workout
    const currentMaxRepsByExercise = new Map<string, { name: string; maxReps: number }>();
    for (const log of bodyweightSets) {
      if (log.actualReps == null) continue;
      const exerciseId = log.workoutSet.workoutExercise.exerciseId;
      const exerciseName = log.workoutSet.workoutExercise.exercise.name;
      const existing = currentMaxRepsByExercise.get(exerciseId);
      if (!existing || log.actualReps > existing.maxReps) {
        currentMaxRepsByExercise.set(exerciseId, { name: exerciseName, maxReps: log.actualReps });
      }
    }

    // Compare against historical max reps
    await Promise.all(
      [...currentMaxRepsByExercise.entries()].map(async ([exerciseId, { name, maxReps }]) => {
        const result = await tx.setLog.aggregate({
          _max: { actualReps: true },
          where: {
            workoutSet: {
              workoutExercise: {
                exerciseId,
                workout: { userId, status: "COMPLETED", id: { not: workoutId } },
              },
            },
            wasSkipped: false,
            actualLoad: null,
            actualReps: { not: null },
          },
        });
        const prevMax = result._max.actualReps ?? null;
        if (prevMax !== null && maxReps > prevMax) {
          repsPRs.push({ exerciseName: name, previousTopReps: prevMax, newTopReps: maxReps });
        }
      })
    );
  }

  return {
    prsDetected: updates.length,
    updates,
    repsPRs,
  };
}

/**
 * Convenience wrapper for reading PR data outside a transaction.
 *
 * Suitable for server-component page renders (e.g. session overview).
 * Uses the singleton Prisma client which satisfies the TransactionClient
 * interface for read-only queries.
 */
export async function computePRsForDisplay(
  workoutId: string,
  userId: string
): Promise<PRSummary> {
  return prisma.$transaction((tx) => detectPRsFromWorkout(workoutId, userId, tx));
}
