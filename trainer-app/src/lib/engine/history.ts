import type { WorkoutHistoryEntry } from "./types";
import { PERFORMED_WORKOUT_STATUSES } from "../workout-status";

export function isCompletedHistoryEntry(entry: WorkoutHistoryEntry): boolean {
  return entry.status === "COMPLETED" || entry.completed;
}

export function isPerformedHistoryEntry(entry: WorkoutHistoryEntry): boolean {
  if (!entry.status) {
    return false;
  }
  return (PERFORMED_WORKOUT_STATUSES as readonly string[]).includes(entry.status);
}

export function sortHistoryByDateDesc(
  history: WorkoutHistoryEntry[]
): WorkoutHistoryEntry[] {
  return [...history].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function filterCompletedHistory(
  history: WorkoutHistoryEntry[]
): WorkoutHistoryEntry[] {
  return history.filter(isCompletedHistoryEntry);
}

export function filterPerformedHistory(
  history: WorkoutHistoryEntry[]
): WorkoutHistoryEntry[] {
  return history.filter(isPerformedHistoryEntry);
}

export function getMostRecentHistoryEntry(
  history: WorkoutHistoryEntry[]
): WorkoutHistoryEntry | undefined {
  return sortHistoryByDateDesc(history)[0];
}
