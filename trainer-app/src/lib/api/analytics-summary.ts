import { WorkoutStatus } from "@prisma/client";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";

export type AnalyticsSummaryWorkout = {
  status: string | WorkoutStatus;
  scheduledDate: Date;
  selectionMode: string | null;
  sessionIntent: string | null;
};

export type AnalyticsSummaryBucket = {
  generated: number;
  performed: number;
  completed: number;
  performedRate: number | null;
  completionRate: number | null;
};

export type AnalyticsConsistencySummary = {
  targetSessionsPerWeek: number;
  thisWeekPerformed: number;
  rollingFourWeekAverage: number;
  currentTrainingStreakWeeks: number;
  weeksMeetingTarget: number;
  trackedWeeks: number;
};

export type AnalyticsSummaryResult = {
  totals: {
    workoutsGenerated: number;
    workoutsPerformed: number;
    workoutsCompleted: number;
    totalSets: number;
  };
  consistency: AnalyticsConsistencySummary;
  kpis: {
    selectionModes: Array<AnalyticsSummaryBucket & { mode: string }>;
    intents: Array<AnalyticsSummaryBucket & { intent: string }>;
  };
};

type BuildAnalyticsSummaryInput = {
  workouts: AnalyticsSummaryWorkout[];
  trackedSelectionModes: readonly string[];
  targetSessionsPerWeek: number;
  totalSets: number;
  now?: Date;
  dateFrom?: Date;
  dateTo?: Date;
};

const COMPLETED_WORKOUT_STATUS = WorkoutStatus.COMPLETED;

function startOfIsoWeek(date: Date): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = result.getUTCDay() || 7;
  result.setUTCDate(result.getUTCDate() - day + 1);
  return result;
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addWeeks(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount * 7);
  return result;
}

function weeksBetweenInclusive(start: Date, end: Date): number {
  const diffMs = startOfIsoWeek(end).getTime() - startOfIsoWeek(start).getTime();
  return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildRateBucket(input: { generated: number; performed: number; completed: number }) {
  return {
    generated: input.generated,
    performed: input.performed,
    completed: input.completed,
    performedRate:
      input.generated > 0 ? Number((input.performed / input.generated).toFixed(3)) : null,
    completionRate:
      input.generated > 0 ? Number((input.completed / input.generated).toFixed(3)) : null,
  };
}

function buildConsistencySummary(input: {
  workouts: AnalyticsSummaryWorkout[];
  targetSessionsPerWeek: number;
  now: Date;
  dateFrom?: Date;
  dateTo?: Date;
}): AnalyticsConsistencySummary {
  const performedWeekCounts = new Map<string, number>();

  for (const workout of input.workouts) {
    if (!(PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(workout.status)) {
      continue;
    }
    const weekKey = toIsoDate(startOfIsoWeek(workout.scheduledDate));
    performedWeekCounts.set(weekKey, (performedWeekCounts.get(weekKey) ?? 0) + 1);
  }

  const anchorDate = input.dateTo ?? input.now;
  const anchorWeekStart = startOfIsoWeek(anchorDate);
  const thisWeekPerformed = performedWeekCounts.get(toIsoDate(anchorWeekStart)) ?? 0;

  let rollingTotal = 0;
  for (let index = 0; index < 4; index += 1) {
    const weekKey = toIsoDate(addWeeks(anchorWeekStart, -index));
    rollingTotal += performedWeekCounts.get(weekKey) ?? 0;
  }

  const performedWeekStarts = Array.from(performedWeekCounts.keys()).sort();
  let currentTrainingStreakWeeks = 0;
  if (performedWeekStarts.length > 0) {
    let cursor = new Date(`${performedWeekStarts[performedWeekStarts.length - 1]}T00:00:00.000Z`);
    while (performedWeekCounts.get(toIsoDate(cursor)) != null) {
      currentTrainingStreakWeeks += 1;
      cursor = addWeeks(cursor, -1);
    }
  }

  const scheduledDates = input.workouts.map((workout) => workout.scheduledDate).sort((a, b) => a.getTime() - b.getTime());
  const rangeStart =
    input.dateFrom ??
    (scheduledDates.length > 0 ? startOfIsoWeek(scheduledDates[0]) : undefined);
  const rangeEnd =
    input.dateTo ??
    (scheduledDates.length > 0
      ? startOfIsoWeek(scheduledDates[scheduledDates.length - 1])
      : undefined);

  const trackedWeeks =
    rangeStart && rangeEnd ? weeksBetweenInclusive(rangeStart, rangeEnd) : 0;

  let weeksMeetingTarget = 0;
  if (rangeStart && rangeEnd) {
    for (let cursor = startOfIsoWeek(rangeStart); cursor <= startOfIsoWeek(rangeEnd); cursor = addWeeks(cursor, 1)) {
      const weekKey = toIsoDate(cursor);
      if ((performedWeekCounts.get(weekKey) ?? 0) >= input.targetSessionsPerWeek) {
        weeksMeetingTarget += 1;
      }
    }
  }

  return {
    targetSessionsPerWeek: input.targetSessionsPerWeek,
    thisWeekPerformed,
    rollingFourWeekAverage: roundToTenth(rollingTotal / 4),
    currentTrainingStreakWeeks,
    weeksMeetingTarget,
    trackedWeeks,
  };
}

export function buildAnalyticsSummary(input: BuildAnalyticsSummaryInput): AnalyticsSummaryResult {
  const modeCounts = new Map<string, { generated: number; performed: number; completed: number }>(
    input.trackedSelectionModes.map((mode) => [mode, { generated: 0, performed: 0, completed: 0 }])
  );
  const intentCounts = new Map<string, { generated: number; performed: number; completed: number }>();

  let workoutsPerformed = 0;
  let workoutsCompleted = 0;

  for (const workout of input.workouts) {
    const isPerformed = (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(workout.status);
    const isCompleted = workout.status === COMPLETED_WORKOUT_STATUS;

    if (isPerformed) {
      workoutsPerformed += 1;
    }
    if (isCompleted) {
      workoutsCompleted += 1;
    }

    const mode = input.trackedSelectionModes.includes(workout.selectionMode ?? "")
      ? (workout.selectionMode as string)
      : "AUTO";
    const modeBucket = modeCounts.get(mode);
    if (modeBucket) {
      modeBucket.generated += 1;
      if (isPerformed) {
        modeBucket.performed += 1;
      }
      if (isCompleted) {
        modeBucket.completed += 1;
      }
    }

    if (!workout.sessionIntent) {
      continue;
    }

    const intentBucket = intentCounts.get(workout.sessionIntent) ?? {
      generated: 0,
      performed: 0,
      completed: 0,
    };
    intentBucket.generated += 1;
    if (isPerformed) {
      intentBucket.performed += 1;
    }
    if (isCompleted) {
      intentBucket.completed += 1;
    }
    intentCounts.set(workout.sessionIntent, intentBucket);
  }

  return {
    totals: {
      workoutsGenerated: input.workouts.length,
      workoutsPerformed,
      workoutsCompleted,
      totalSets: input.totalSets,
    },
    consistency: buildConsistencySummary({
      workouts: input.workouts,
      targetSessionsPerWeek: input.targetSessionsPerWeek,
      now: input.now ?? new Date(),
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
    }),
    kpis: {
      selectionModes: input.trackedSelectionModes.map((mode) => ({
        mode,
        ...buildRateBucket(modeCounts.get(mode) ?? { generated: 0, performed: 0, completed: 0 }),
      })),
      intents: Array.from(intentCounts.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([intent, bucket]) => ({
          intent,
          ...buildRateBucket(bucket),
        })),
    },
  };
}
