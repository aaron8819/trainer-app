import type { WorkoutHistoryEntry } from "./types";
import { PERFORMED_WORKOUT_STATUSES } from "../workout-status";

const MANUAL_SELECTION_CONFIDENCE = 0.7;
const INTENT_SELECTION_CONFIDENCE = 1.0;
const DEFAULT_SELECTION_CONFIDENCE = 0.8;

function hasUniformRpe(entry: WorkoutHistoryEntry): boolean {
  if (entry.selectionMode !== "MANUAL") {
    return false;
  }
  const rpes = entry.exercises
    .flatMap((exercise) => exercise.sets.map((set) => set.rpe))
    .filter((rpe): rpe is number => Number.isFinite(rpe));
  if (rpes.length === 0) {
    return false;
  }
  return rpes.every((rpe) => rpe === rpes[0]);
}

export function resolveBaseSelectionModeConfidence(entry: WorkoutHistoryEntry): number {
  if (entry.selectionMode === "INTENT") {
    return INTENT_SELECTION_CONFIDENCE;
  }
  if (entry.selectionMode === "MANUAL") {
    return MANUAL_SELECTION_CONFIDENCE;
  }
  return DEFAULT_SELECTION_CONFIDENCE;
}

export function resolveHistoryEntryConfidence(entry: WorkoutHistoryEntry): number {
  if (typeof entry.confidence === "number" && Number.isFinite(entry.confidence)) {
    return entry.confidence;
  }
  const base = resolveBaseSelectionModeConfidence(entry);
  if (entry.selectionMode === "MANUAL" && hasUniformRpe(entry)) {
    return Number((base * 0.5).toFixed(2));
  }
  return base;
}

export function withDerivedConfidence(entry: WorkoutHistoryEntry): WorkoutHistoryEntry {
  if (typeof entry.confidence === "number" && Number.isFinite(entry.confidence)) {
    return entry;
  }
  return {
    ...entry,
    confidence: resolveHistoryEntryConfidence(entry),
  };
}

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
  return history.filter(isPerformedHistoryEntry).map(withDerivedConfidence);
}

export function getMostRecentHistoryEntry(
  history: WorkoutHistoryEntry[]
): WorkoutHistoryEntry | undefined {
  return sortHistoryByDateDesc(history)[0];
}
