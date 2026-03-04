import { ADVANCEMENT_WORKOUT_STATUSES, PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";

type AnalyticsStatus = string | null | undefined;

export type AnalyticsWindowSemantics =
  | {
      kind: "all_time";
      label: string;
      dateField: "scheduledDate";
    }
  | {
      kind: "rolling_days";
      label: string;
      dateField: "scheduledDate";
      days: number;
      anchor: "today";
    }
  | {
      kind: "rolling_iso_weeks";
      label: string;
      dateField: "scheduledDate";
      weeks: number;
      anchor: "today";
    }
  | {
      kind: "date_range";
      label: string;
      dateField: "scheduledDate" | "completedAt";
      dateFrom: string | null;
      dateTo: string | null;
      anchor: "query";
    };

export type AnalyticsWorkoutCountSummary = {
  generated: number;
  performed: number;
  completed: number;
  performedRate: number | null;
  completionRate: number | null;
};

export function isAnalyticsPerformedWorkoutStatus(status: AnalyticsStatus): boolean {
  return Boolean(status) && (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(status as string);
}

export function isAnalyticsCompletedWorkoutStatus(status: AnalyticsStatus): boolean {
  return (
    Boolean(status) &&
    (ADVANCEMENT_WORKOUT_STATUSES as readonly string[]).includes(status as string)
  );
}

export function countAnalyticsWorkoutStatuses(
  statuses: AnalyticsStatus[]
): AnalyticsWorkoutCountSummary {
  let generated = 0;
  let performed = 0;
  let completed = 0;

  for (const status of statuses) {
    generated += 1;

    if (isAnalyticsPerformedWorkoutStatus(status)) {
      performed += 1;
    }

    if (isAnalyticsCompletedWorkoutStatus(status)) {
      completed += 1;
    }
  }

  return {
    generated,
    performed,
    completed,
    performedRate: generated > 0 ? Number((performed / generated).toFixed(3)) : null,
    completionRate: generated > 0 ? Number((completed / generated).toFixed(3)) : null,
  };
}

export function buildAllTimeAnalyticsWindow(label: string): AnalyticsWindowSemantics {
  return {
    kind: "all_time",
    label,
    dateField: "scheduledDate",
  };
}

export function buildRollingDaysAnalyticsWindow(
  days: number,
  label: string
): AnalyticsWindowSemantics {
  return {
    kind: "rolling_days",
    label,
    dateField: "scheduledDate",
    days,
    anchor: "today",
  };
}

export function buildRollingIsoWeeksAnalyticsWindow(
  weeks: number,
  label: string
): AnalyticsWindowSemantics {
  return {
    kind: "rolling_iso_weeks",
    label,
    dateField: "scheduledDate",
    weeks,
    anchor: "today",
  };
}

export function buildDateRangeAnalyticsWindow(input: {
  label: string;
  dateField: "scheduledDate" | "completedAt";
  dateFrom?: Date;
  dateTo?: Date;
}): AnalyticsWindowSemantics {
  return {
    kind: "date_range",
    label: input.label,
    dateField: input.dateField,
    dateFrom: input.dateFrom?.toISOString() ?? null,
    dateTo: input.dateTo?.toISOString() ?? null,
    anchor: "query",
  };
}
