import type { Prisma } from "@prisma/client";
import { WorkoutStatus } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { normalizeExposedMuscle } from "@/lib/engine/volume-landmarks";
import { deriveSessionSemantics } from "@/lib/session-semantics/derive-session-semantics";
import { classifySetLog } from "@/lib/session-semantics/set-classification";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { roundToTenth } from "./volume-read-model-helpers";
import {
  getEffectiveStimulusFromSnapshot,
  getRelationshipMusclesFromSnapshot,
  resolveHistoricalStimulusAccounting,
} from "@/lib/stimulus-accounting/snapshot";

type WorkoutReader = Pick<Prisma.TransactionClient, "workout"> | Pick<typeof prisma, "workout">;

export type WeeklyMuscleVolumeRow = {
  directSets: number;
  indirectSets: number;
  effectiveSets: number;
  contributions?: WeeklyMuscleExerciseContribution[];
};

type WeeklyMuscleVolumeMap = Record<string, WeeklyMuscleVolumeRow>;

export type WeeklyMuscleExerciseContribution = {
  exerciseId?: string;
  exerciseName: string;
  effectiveSets: number;
  performedSets: number;
  directSets?: number;
  indirectSets?: number;
};

type WeeklyMuscleExerciseContributionAccumulator = {
  exerciseId?: string;
  exerciseName: string;
  effectiveSets: number;
  performedSets: number;
  directSets: number;
  indirectSets: number;
};

type WeeklyMuscleVolumeAccumulator = WeeklyMuscleVolumeRow & {
  contributionMap?: Map<string, WeeklyMuscleExerciseContributionAccumulator>;
};

export function countCompletedSets(
  sets: Array<{
    logs: Array<{
      setIntent?: "WORK" | "WARMUP" | null;
      actualReps?: number | null;
      actualRpe?: number | null;
      actualLoad?: number | null;
      wasSkipped: boolean;
    }>;
  }>
): number {
  return sets.filter((set) => classifySetLog(set.logs[0]).countsTowardVolume).length;
}

function getOrCreateMuscleRow(
  muscles: Record<string, WeeklyMuscleVolumeAccumulator>,
  muscle: string
): WeeklyMuscleVolumeAccumulator {
  if (!muscles[muscle]) {
    muscles[muscle] = { directSets: 0, indirectSets: 0, effectiveSets: 0 };
  }
  return muscles[muscle];
}

function getOrCreateContributionRow(
  row: WeeklyMuscleVolumeAccumulator,
  exerciseId: string | undefined,
  exerciseName: string
): WeeklyMuscleExerciseContributionAccumulator {
  if (!row.contributionMap) {
    row.contributionMap = new Map<string, WeeklyMuscleExerciseContributionAccumulator>();
  }

  const key = exerciseId ?? exerciseName;
  const existing = row.contributionMap.get(key);
  if (existing) {
    return existing;
  }

  const created: WeeklyMuscleExerciseContributionAccumulator = {
    exerciseId,
    exerciseName,
    effectiveSets: 0,
    performedSets: 0,
    directSets: 0,
    indirectSets: 0,
  };
  row.contributionMap.set(key, created);
  return created;
}

function normalizeExposedMuscleList(muscles: string[]): string[] {
  return Array.from(new Set(muscles.map((muscle) => normalizeExposedMuscle(muscle))));
}

function normalizeEffectiveContributionByMuscle(
  contribution: Map<string, number>
): Map<string, number> {
  const normalized = new Map<string, number>();
  for (const [muscle, effectiveSets] of contribution) {
    const exposedMuscle = normalizeExposedMuscle(muscle);
    normalized.set(exposedMuscle, (normalized.get(exposedMuscle) ?? 0) + effectiveSets);
  }
  return normalized;
}

function finalizeWeeklyMuscleVolumeMap(
  muscles: Record<string, WeeklyMuscleVolumeAccumulator>
): WeeklyMuscleVolumeMap {
  return Object.fromEntries(
    Object.entries(muscles).map(([muscle, row]) => {
      const contributions = row.contributionMap
        ? Array.from(row.contributionMap.values())
            .map((contribution) => ({
              exerciseId: contribution.exerciseId,
              exerciseName: contribution.exerciseName,
              effectiveSets: roundToTenth(contribution.effectiveSets),
              performedSets: contribution.performedSets,
              ...(contribution.directSets > 0 ? { directSets: contribution.directSets } : {}),
              ...(contribution.indirectSets > 0 ? { indirectSets: contribution.indirectSets } : {}),
            }))
            .sort((left, right) => {
              if (right.effectiveSets !== left.effectiveSets) {
                return right.effectiveSets - left.effectiveSets;
              }
              return left.exerciseName.localeCompare(right.exerciseName);
            })
        : undefined;

      return [
        muscle,
        {
          directSets: row.directSets,
          indirectSets: row.indirectSets,
          effectiveSets: roundToTenth(row.effectiveSets),
          ...(contributions && contributions.length > 0 ? { contributions } : {}),
        },
      ];
    })
  );
}

export async function loadMesocycleWeekMuscleVolume(
  client: WorkoutReader,
  input: {
    userId: string;
    mesocycleId: string;
    targetWeek: number;
    weekStart: Date;
    excludeWorkoutId?: string;
    performedBefore?: Date;
    includeBreakdowns?: boolean;
  }
): Promise<WeeklyMuscleVolumeMap> {
  const weekEnd = new Date(input.weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const workouts = await client.workout.findMany({
    where: {
      userId: input.userId,
      mesocycleId: input.mesocycleId,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
      ...(input.excludeWorkoutId ? { id: { not: input.excludeWorkoutId } } : {}),
      ...(input.performedBefore ? { scheduledDate: { lt: input.performedBefore } } : {}),
      OR: [
        { mesocycleWeekSnapshot: input.targetWeek },
        {
          mesocycleWeekSnapshot: null,
          scheduledDate: { gte: input.weekStart, lt: weekEnd },
        },
      ],
    },
    include: {
      exercises: {
        include: {
          exercise: {
            include: {
              aliases: true,
              exerciseMuscles: { include: { muscle: true } },
            },
          },
          sets: { include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } } },
        },
      },
    },
  });

  const muscles: Record<string, WeeklyMuscleVolumeAccumulator> = {};
  for (const workout of workouts) {
    const semantics = deriveSessionSemantics({
      advancesSplit: workout.advancesSplit,
      selectionMetadata: workout.selectionMetadata,
      selectionMode: workout.selectionMode,
      sessionIntent: workout.sessionIntent,
      mesocyclePhase: workout.mesocyclePhaseSnapshot,
    });
    if (!semantics.countsTowardWeeklyVolume) {
      continue;
    }

    for (const workoutExercise of workout.exercises) {
      const completedSets = countCompletedSets(workoutExercise.sets);
      if (completedSets <= 0) {
        continue;
      }

      const accounting = resolveHistoricalStimulusAccounting({
        persistedSnapshot: workoutExercise.stimulusAccountingSnapshot,
        exercise: {
          id:
            workoutExercise.exercise.id ??
            workoutExercise.exercise.name ??
            "unknown-exercise",
          name:
            workoutExercise.exercise.name ??
            workoutExercise.exercise.id ??
            "Unknown Exercise",
          primaryMuscles: workoutExercise.exercise.exerciseMuscles
            .filter((mapping) => mapping.role === "PRIMARY")
            .map((mapping) => mapping.muscle.name),
          secondaryMuscles: workoutExercise.exercise.exerciseMuscles
            .filter((mapping) => mapping.role === "SECONDARY")
            .map((mapping) => mapping.muscle.name),
          aliases: (workoutExercise.exercise.aliases ?? []).map(
            (alias) => alias.alias
          ),
        },
      });
      if (!accounting.snapshot) {
        continue;
      }
      const primaryMuscles = normalizeExposedMuscleList(
        getRelationshipMusclesFromSnapshot(accounting.snapshot, "primary")
      );
      const secondaryMuscles = normalizeExposedMuscleList(
        getRelationshipMusclesFromSnapshot(accounting.snapshot, "secondary")
      );

      for (const muscle of primaryMuscles) {
        getOrCreateMuscleRow(muscles, muscle).directSets += completedSets;
      }
      for (const muscle of secondaryMuscles) {
        getOrCreateMuscleRow(muscles, muscle).indirectSets += completedSets;
      }

      const effectiveContribution = normalizeEffectiveContributionByMuscle(
        getEffectiveStimulusFromSnapshot(accounting.snapshot, completedSets)
      );
      for (const [muscle, effectiveSets] of effectiveContribution) {
        const row = getOrCreateMuscleRow(muscles, muscle);
        row.effectiveSets += effectiveSets;

        if (!input.includeBreakdowns) {
          continue;
        }

        const contribution = getOrCreateContributionRow(
          row,
          workoutExercise.exercise.id ?? undefined,
          workoutExercise.exercise.name ?? workoutExercise.exercise.id ?? "Unknown Exercise"
        );
        contribution.effectiveSets += effectiveSets;
        contribution.performedSets += completedSets;
        if (primaryMuscles.includes(muscle)) {
          contribution.directSets += completedSets;
        }
        if (secondaryMuscles.includes(muscle)) {
          contribution.indirectSets += completedSets;
        }
      }
    }
  }

  return finalizeWeeklyMuscleVolumeMap(muscles);
}
