import { prisma } from "@/lib/db/prisma";
import { WorkoutStatus } from "@prisma/client";

export type ExerciseSession = {
  date: string;
  sets: { setIndex: number; reps: number; load: number | null; rpe: number | null }[];
};

export type PersonalBests = {
  maxLoad: number | null;
  maxReps: number | null;
  maxVolume: number | null;
};

export type ExerciseTrend = "improving" | "stable" | "declining" | "insufficient_data";

export type ExerciseHistoryResult = {
  sessions: ExerciseSession[];
  personalBests: PersonalBests;
  trend: ExerciseTrend;
};

export async function loadExerciseHistory(
  exerciseId: string,
  userId: string,
  limit: number = 3
): Promise<ExerciseHistoryResult> {
  const workoutExercises = await prisma.workoutExercise.findMany({
    where: {
      exerciseId,
      workout: {
        userId,
        status: WorkoutStatus.COMPLETED,
      },
    },
    orderBy: { workout: { scheduledDate: "desc" } },
    take: limit,
    include: {
      workout: { select: { scheduledDate: true } },
      sets: {
        orderBy: { setIndex: "asc" },
        include: { logs: true },
      },
    },
  });

  const sessions: ExerciseSession[] = workoutExercises.map((we) => ({
    date: we.workout.scheduledDate.toISOString(),
    sets: we.sets.map((set) => {
      const log = set.logs[0];
      return {
        setIndex: set.setIndex,
        reps: log?.actualReps ?? set.targetReps ?? 0,
        load: log?.actualLoad ?? set.targetLoad ?? null,
        rpe: log?.actualRpe ?? set.targetRpe ?? null,
      };
    }),
  }));

  const personalBests = computePersonalBests(sessions);
  const trend = computeTrend(sessions);

  return { sessions, personalBests, trend };
}

export function computePersonalBests(sessions: ExerciseSession[]): PersonalBests {
  let maxLoad: number | null = null;
  let maxReps: number | null = null;
  let maxVolume: number | null = null;

  for (const session of sessions) {
    for (const set of session.sets) {
      if (set.load !== null && (maxLoad === null || set.load > maxLoad)) {
        maxLoad = set.load;
      }
      if (maxReps === null || set.reps > maxReps) {
        maxReps = set.reps;
      }
      const volume = set.reps * (set.load ?? 0);
      if (volume > 0 && (maxVolume === null || volume > maxVolume)) {
        maxVolume = volume;
      }
    }
  }

  return { maxLoad, maxReps, maxVolume };
}

export function computeTrend(sessions: ExerciseSession[]): ExerciseTrend {
  if (sessions.length < 2) return "insufficient_data";

  // Compare average estimated 1RM across sessions (most recent vs oldest)
  const sessionE1rms = sessions.map((s) => {
    const e1rms = s.sets
      .filter((set) => set.load !== null && set.load > 0)
      .map((set) => (set.load ?? 0) * (1 + set.reps / 30));
    return e1rms.length > 0 ? Math.max(...e1rms) : 0;
  });

  const recent = sessionE1rms[0];
  const oldest = sessionE1rms[sessionE1rms.length - 1];

  if (recent === 0 || oldest === 0) return "insufficient_data";

  const change = (recent - oldest) / oldest;
  if (change > 0.03) return "improving";
  if (change < -0.03) return "declining";
  return "stable";
}
