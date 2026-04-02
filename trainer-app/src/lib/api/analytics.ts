import { prisma } from "@/lib/db/prisma";
import { WorkoutStatus } from "@prisma/client";
import {
  getExposedVolumeLandmarkEntries,
  normalizeExposedMuscle,
} from "@/lib/engine/volume-landmarks";
import { getEffectiveStimulusByMuscle } from "@/lib/engine/stimulus";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";
import { countCompletedSets } from "@/lib/api/weekly-volume";

export type WeeklyMuscleVolume = {
  weekStart: string;
  muscles: Record<string, { directSets: number; indirectSets: number; effectiveSets: number }>;
};

type AnalyticsWorkoutVolumeSource = {
  scheduledDate: Date;
  exercises: Array<{
    exercise: {
      id?: string | null;
      name?: string | null;
      aliases?: Array<{ alias: string }>;
      exerciseMuscles: Array<{ role: string; muscle: { name: string } }>;
    };
    sets: Array<{ logs: Array<{ wasSkipped: boolean }> }>;
  }>;
};

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function getIsoWeekStart(date: Date): string {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result.toISOString().slice(0, 10);
}

function getOrCreateWeekMuscleRow(
  weekData: Record<string, { directSets: number; indirectSets: number; effectiveSets: number }>,
  muscle: string
) {
  if (!weekData[muscle]) {
    weekData[muscle] = { directSets: 0, indirectSets: 0, effectiveSets: 0 };
  }
  return weekData[muscle];
}

export function buildWeeklyMuscleVolumeSeries(
  workouts: AnalyticsWorkoutVolumeSource[]
): WeeklyMuscleVolume[] {
  const weekMap = new Map<
    string,
    Record<string, { directSets: number; indirectSets: number; effectiveSets: number }>
  >();

  for (const workout of workouts) {
    const weekStart = getIsoWeekStart(workout.scheduledDate);

    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, {});
    }
    const weekData = weekMap.get(weekStart)!;

    for (const we of workout.exercises) {
      const completedSets = countCompletedSets(we.sets);
      if (completedSets === 0) continue;

      const primaryMuscles = Array.from(
        new Set(
          we.exercise.exerciseMuscles
        .filter((m) => m.role === "PRIMARY")
        .map((m) => normalizeExposedMuscle(m.muscle.name))
        )
      );
      const secondaryMuscles = Array.from(
        new Set(
          we.exercise.exerciseMuscles
        .filter((m) => m.role === "SECONDARY")
        .map((m) => normalizeExposedMuscle(m.muscle.name))
        )
      );

      for (const muscle of primaryMuscles) {
        getOrCreateWeekMuscleRow(weekData, muscle).directSets += completedSets;
      }
      for (const muscle of secondaryMuscles) {
        getOrCreateWeekMuscleRow(weekData, muscle).indirectSets += completedSets;
      }

      const effectiveContribution = getEffectiveStimulusByMuscle(
        {
          id: we.exercise.id ?? we.exercise.name ?? "unknown-exercise",
          name: we.exercise.name ?? we.exercise.id ?? "Unknown Exercise",
          primaryMuscles,
          secondaryMuscles,
          aliases: (we.exercise.aliases ?? []).map((alias) => alias.alias),
        },
        completedSets,
        { logFallback: false }
      );

      for (const [muscle, effectiveSets] of effectiveContribution) {
        const exposedMuscle = normalizeExposedMuscle(muscle);
        getOrCreateWeekMuscleRow(weekData, exposedMuscle).effectiveSets += effectiveSets;
      }
    }
  }

  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, muscles]) => ({
      weekStart,
      muscles: Object.fromEntries(
        Object.entries(muscles).map(([muscle, row]) => [
          muscle,
          {
            directSets: row.directSets,
            indirectSets: row.indirectSets,
            effectiveSets: roundToTenth(row.effectiveSets),
          },
        ])
      ),
    }));
}

export async function computeWeeklyMuscleVolume(
  userId: string,
  weeks: number = 4
): Promise<WeeklyMuscleVolume[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);

  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      status: { in: [...PERFORMED_WORKOUT_STATUSES] as WorkoutStatus[] },
      scheduledDate: { gte: cutoff },
    },
    orderBy: { scheduledDate: "asc" },
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

  return buildWeeklyMuscleVolumeSeries(workouts);
}

export function getVolumeLandmarks(): Record<
  string,
  { mv: number; mev: number; mav: number; mrv: number }
> {
  const result: Record<string, { mv: number; mev: number; mav: number; mrv: number }> = {};
  for (const [muscle, lm] of getExposedVolumeLandmarkEntries()) {
    result[muscle] = { mv: lm.mv, mev: lm.mev, mav: lm.mav, mrv: lm.mrv };
  }
  return result;
}

