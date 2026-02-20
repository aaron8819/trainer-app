export const PERFORMED_WORKOUT_STATUSES = [
  "COMPLETED",
  "PARTIAL",
] as const;

export const ADVANCEMENT_WORKOUT_STATUSES = ["COMPLETED"] as const;

export const TERMINAL_WORKOUT_STATUSES = [
  "COMPLETED",
  "PARTIAL",
  "SKIPPED",
] as const;

export function isTerminalWorkoutStatus(
  status: string | null | undefined
): status is (typeof TERMINAL_WORKOUT_STATUSES)[number] {
  return Boolean(status) && TERMINAL_WORKOUT_STATUSES.includes(status as (typeof TERMINAL_WORKOUT_STATUSES)[number]);
}
