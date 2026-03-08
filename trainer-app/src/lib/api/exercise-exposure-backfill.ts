import type { Prisma } from "@prisma/client";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_4W_MS = 4 * WEEK_MS;
const WINDOW_8W_MS = 8 * WEEK_MS;
const WINDOW_12W_MS = 12 * WEEK_MS;

export const performedExposureLogWhere = {
  wasSkipped: false,
  OR: [
    { actualReps: { not: null } },
    { actualRpe: { not: null } },
  ],
} satisfies Prisma.SetLogWhereInput;

type ExposureSetLog = {
  actualLoad: number | null;
  actualReps: number | null;
  actualRpe: number | null;
  wasSkipped: boolean;
};

type ExposureSet = {
  logs: ExposureSetLog[];
};

export type ExposureBackfillWorkout = {
  completedAt: Date | null;
  scheduledDate: Date;
  exercises: Array<{
    exercise: {
      name: string;
    };
    sets: ExposureSet[];
  }>;
};

type ExposureAccumulator = {
  lastUsedAt: Date;
  timesUsedL4W: number;
  timesUsedL8W: number;
  timesUsedL12W: number;
  totalPerformedSetsL12W: number;
  totalPerformedVolumeL12W: number;
};

export function isPerformedExposureLog(
  log: ExposureSetLog | null | undefined
): log is ExposureSetLog {
  return log != null && log.wasSkipped !== true && (log.actualReps != null || log.actualRpe != null);
}

function summarizePerformedSets(sets: ExposureSet[]): {
  performedSetCount: number;
  performedVolume: number;
} {
  let performedSetCount = 0;
  let performedVolume = 0;

  for (const set of sets) {
    const log = set.logs[0];
    if (!log || !isPerformedExposureLog(log)) {
      continue;
    }

    performedSetCount += 1;
    performedVolume += (log.actualReps ?? 0) * (log.actualLoad ?? 0);
  }

  return { performedSetCount, performedVolume };
}

export function buildExerciseExposureRows(
  userId: string,
  workouts: ExposureBackfillWorkout[],
  now: Date = new Date()
): Prisma.ExerciseExposureCreateManyInput[] {
  const cutoff4w = now.getTime() - WINDOW_4W_MS;
  const cutoff8w = now.getTime() - WINDOW_8W_MS;
  const cutoff12w = now.getTime() - WINDOW_12W_MS;

  const exposureByExercise = new Map<string, ExposureAccumulator>();

  for (const workout of workouts) {
    const eventTime = workout.completedAt ?? workout.scheduledDate;
    const eventMs = eventTime.getTime();

    for (const workoutExercise of workout.exercises) {
      const { performedSetCount, performedVolume } = summarizePerformedSets(workoutExercise.sets);
      if (performedSetCount <= 0) {
        continue;
      }

      const exerciseName = workoutExercise.exercise.name;
      const current = exposureByExercise.get(exerciseName);
      if (!current) {
        exposureByExercise.set(exerciseName, {
          lastUsedAt: eventTime,
          timesUsedL4W: eventMs >= cutoff4w ? 1 : 0,
          timesUsedL8W: eventMs >= cutoff8w ? 1 : 0,
          timesUsedL12W: eventMs >= cutoff12w ? 1 : 0,
          totalPerformedSetsL12W: eventMs >= cutoff12w ? performedSetCount : 0,
          totalPerformedVolumeL12W: eventMs >= cutoff12w ? performedVolume : 0,
        });
        continue;
      }

      if (eventTime > current.lastUsedAt) {
        current.lastUsedAt = eventTime;
      }
      if (eventMs >= cutoff4w) {
        current.timesUsedL4W += 1;
      }
      if (eventMs >= cutoff8w) {
        current.timesUsedL8W += 1;
      }
      if (eventMs >= cutoff12w) {
        current.timesUsedL12W += 1;
        current.totalPerformedSetsL12W += performedSetCount;
        current.totalPerformedVolumeL12W += performedVolume;
      }
    }
  }

  return [...exposureByExercise.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([exerciseName, exposure]) => ({
      userId,
      exerciseName,
      lastUsedAt: exposure.lastUsedAt,
      timesUsedL4W: exposure.timesUsedL4W,
      timesUsedL8W: exposure.timesUsedL8W,
      timesUsedL12W: exposure.timesUsedL12W,
      avgSetsPerWeek: Number((exposure.totalPerformedSetsL12W / 12).toFixed(2)),
      avgVolumePerWeek: Number((exposure.totalPerformedVolumeL12W / 12).toFixed(2)),
    }));
}
