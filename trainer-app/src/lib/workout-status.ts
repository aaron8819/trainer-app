import { WorkoutStatus } from "@prisma/client";

export type WorkoutStatusPolicy = {
  performed: boolean;
  completed: boolean;
  scheduleResolved: boolean;
  immutableTerminal: boolean;
};

const WORKOUT_STATUS_POLICY = {
  [WorkoutStatus.PLANNED]: {
    performed: false,
    completed: false,
    scheduleResolved: false,
    immutableTerminal: false,
  },
  [WorkoutStatus.IN_PROGRESS]: {
    performed: false,
    completed: false,
    scheduleResolved: false,
    immutableTerminal: false,
  },
  [WorkoutStatus.PARTIAL]: {
    performed: true,
    completed: false,
    scheduleResolved: false,
    immutableTerminal: false,
  },
  [WorkoutStatus.COMPLETED]: {
    performed: true,
    completed: true,
    scheduleResolved: true,
    immutableTerminal: true,
  },
  [WorkoutStatus.SKIPPED]: {
    performed: false,
    completed: false,
    scheduleResolved: true,
    immutableTerminal: true,
  },
} satisfies Record<WorkoutStatus, WorkoutStatusPolicy>;

export function getWorkoutStatusPolicy(
  status: unknown,
): WorkoutStatusPolicy | null {
  if (typeof status !== "string") return null;
  return WORKOUT_STATUS_POLICY[status as WorkoutStatus] ?? null;
}

export const PERFORMED_WORKOUT_STATUSES = [
  WorkoutStatus.COMPLETED,
  WorkoutStatus.PARTIAL,
].filter((status) => WORKOUT_STATUS_POLICY[status].performed);

export const ADVANCEMENT_WORKOUT_STATUSES = [WorkoutStatus.COMPLETED].filter(
  (status) => WORKOUT_STATUS_POLICY[status].completed,
);

export const SCHEDULE_RESOLVED_WORKOUT_STATUSES = [
  WorkoutStatus.COMPLETED,
  WorkoutStatus.SKIPPED,
].filter((status) => WORKOUT_STATUS_POLICY[status].scheduleResolved);

export const TERMINAL_WORKOUT_STATUSES = [
  "COMPLETED",
  "PARTIAL",
  "SKIPPED",
] as const;

export function isTerminalWorkoutStatus(
  status: string | null | undefined,
): status is (typeof TERMINAL_WORKOUT_STATUSES)[number] {
  return (
    Boolean(status) &&
    TERMINAL_WORKOUT_STATUSES.includes(
      status as (typeof TERMINAL_WORKOUT_STATUSES)[number],
    )
  );
}
