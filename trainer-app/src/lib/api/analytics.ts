import { prisma } from "@/lib/db/prisma";
import { WorkoutStatus } from "@prisma/client";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";

export type WeeklyMuscleVolume = {
  weekStart: string;
  muscles: Record<string, { directSets: number; indirectSets: number }>;
};

export async function computeWeeklyMuscleVolume(
  userId: string,
  weeks: number = 4
): Promise<WeeklyMuscleVolume[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);

  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      status: WorkoutStatus.COMPLETED,
      scheduledDate: { gte: cutoff },
    },
    orderBy: { scheduledDate: "asc" },
    include: {
      exercises: {
        include: {
          exercise: {
            include: {
              exerciseMuscles: { include: { muscle: true } },
            },
          },
          sets: { include: { logs: { orderBy: { completedAt: "desc" }, take: 1 } } },
        },
      },
    },
  });

  // Group by ISO week
  const weekMap = new Map<string, Record<string, { directSets: number; indirectSets: number }>>();

  for (const workout of workouts) {
    const weekStart = getWeekStart(workout.scheduledDate);

    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, {});
    }
    const weekData = weekMap.get(weekStart)!;

    for (const we of workout.exercises) {
      const completedSets = we.sets.filter(
        (s) => s.logs.length > 0 && !s.logs[0].wasSkipped
      ).length;
      if (completedSets === 0) continue;

      const primaryMuscles = we.exercise.exerciseMuscles
        .filter((m) => m.role === "PRIMARY")
        .map((m) => m.muscle.name);
      const secondaryMuscles = we.exercise.exerciseMuscles
        .filter((m) => m.role === "SECONDARY")
        .map((m) => m.muscle.name);

      for (const muscle of primaryMuscles) {
        if (!weekData[muscle]) weekData[muscle] = { directSets: 0, indirectSets: 0 };
        weekData[muscle].directSets += completedSets;
      }
      for (const muscle of secondaryMuscles) {
        if (!weekData[muscle]) weekData[muscle] = { directSets: 0, indirectSets: 0 };
        weekData[muscle].indirectSets += completedSets;
      }
    }
  }

  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, muscles]) => ({ weekStart, muscles }));
}

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

export function getVolumeLandmarks(): Record<
  string,
  { mv: number; mev: number; mav: number; mrv: number }
> {
  const result: Record<string, { mv: number; mev: number; mav: number; mrv: number }> = {};
  for (const [muscle, lm] of Object.entries(VOLUME_LANDMARKS)) {
    result[muscle] = { mv: lm.mv, mev: lm.mev, mav: lm.mav, mrv: lm.mrv };
  }
  return result;
}

