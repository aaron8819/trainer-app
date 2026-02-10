import type { WorkoutHistoryEntry } from "./types";

export function isCompletedHistoryEntry(entry: WorkoutHistoryEntry): boolean {
  return entry.status === "COMPLETED" || entry.completed;
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

export function getMostRecentHistoryEntry(
  history: WorkoutHistoryEntry[]
): WorkoutHistoryEntry | undefined {
  return sortHistoryByDateDesc(history)[0];
}
