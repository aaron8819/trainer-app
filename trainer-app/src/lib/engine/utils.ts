import { randomUUID } from "crypto";
import type { Exercise, WorkoutHistoryEntry } from "./types";
import { filterCompletedHistory, sortHistoryByDateDesc } from "./history";

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s()-]/g, "")
    .trim();
}

export function buildNameSet(items?: string[]): Set<string> {
  if (!items || items.length === 0) {
    return new Set<string>();
  }
  return new Set(items.map((item) => normalizeName(item)));
}

export function buildRecencyIndex(history: WorkoutHistoryEntry[]): Map<string, number> {
  const sorted = sortHistoryByDateDesc(filterCompletedHistory(history));
  const index = new Map<string, number>();
  sorted.forEach((entry, entryIndex) => {
    for (const exercise of entry.exercises) {
      if (!index.has(exercise.exerciseId)) {
        index.set(exercise.exerciseId, entryIndex);
      }
    }
  });
  return index;
}

export function getRecencyMultiplier(
  exerciseId: string,
  recencyIndex: Map<string, number>
): number {
  const lastSeen = recencyIndex.get(exerciseId);
  if (lastSeen === undefined) {
    return 1;
  }
  if (lastSeen === 0) {
    return 0.3;
  }
  if (lastSeen === 1) {
    return 0.5;
  }
  if (lastSeen === 2) {
    return 0.7;
  }
  return 1;
}

export function getNoveltyMultiplier(
  exerciseId: string,
  recencyIndex: Map<string, number>
): number {
  return recencyIndex.has(exerciseId) ? 1 : 1.5;
}

export function weightedPick(
  items: { exercise: Exercise; weight: number }[],
  rng: () => number
): Exercise | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) {
    return items[0].exercise;
  }
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) {
      return item.exercise;
    }
  }
  return items[items.length - 1].exercise;
}

export function getPrimaryMuscles(exercise: Exercise): string[] {
  if (exercise.primaryMuscles && exercise.primaryMuscles.length > 0) {
    return exercise.primaryMuscles;
  }
  if (exercise.secondaryMuscles && exercise.secondaryMuscles.length > 0) {
    return exercise.secondaryMuscles;
  }
  return [];
}

export function roundLoad(value: number): number {
  return Math.round(value * 2) / 2;
}

export function createId(seed?: string): string {
  if (seed) {
    return seed;
  }
  return typeof randomUUID === "function" ? randomUUID() : `${Date.now()}-${Math.random()}`;
}
