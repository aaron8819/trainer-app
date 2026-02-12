import type { Constraints, Exercise, MovementPattern, SplitDay, WorkoutHistoryEntry } from "./types";
import { MUSCLE_SPLIT_MAP } from "./volume-landmarks";
import { isCompletedHistoryEntry } from "./history";

export const SPLIT_PATTERNS: Record<string, MovementPattern[][]> = {
  ppl: [
    ["push"],
    ["pull"],
    ["squat", "hinge"],
    ["push"],
    ["pull"],
  ],
  upper_lower: [
    ["push", "pull"],
    ["squat", "hinge"],
    ["push", "pull"],
    ["squat", "hinge"],
  ],
  full_body: [
    ["push", "pull", "squat", "hinge", "rotate"],
    ["push", "pull", "lunge", "hinge", "rotate"],
    ["push", "pull", "squat", "hinge", "carry"],
  ],
  custom: [
    ["push", "pull", "squat", "hinge"],
  ],
};

export function getSplitDayIndex(history: WorkoutHistoryEntry[], patternLength: number): number {
  const advancingCompleted = history.filter(
    (entry) => entry.advancesSplit !== false && isCompletedHistoryEntry(entry)
  );
  const completedCount = advancingCompleted.length;
  return completedCount % Math.max(1, patternLength);
}

export function classifySessionBySplit(
  exercises: WorkoutHistoryEntry["exercises"],
  exerciseLibrary: Exercise[]
): "push" | "pull" | "legs" {
  const byId = new Map(exerciseLibrary.map((e) => [e.id, e]));
  const splitCounts: Record<string, number> = { push: 0, pull: 0, legs: 0 };

  for (const ex of exercises) {
    // Prefer primaryMuscles from the history entry (populated by API layer)
    const muscles = ex.primaryMuscles ?? byId.get(ex.exerciseId)?.primaryMuscles ?? [];
    const setsCount = ex.sets.length || 1;

    for (const muscle of muscles) {
      const split = MUSCLE_SPLIT_MAP[muscle];
      if (split) {
        splitCounts[split] += setsCount;
      }
    }
  }

  // If no muscle data available, fall back to movementPattern classification
  const total = splitCounts.push + splitCounts.pull + splitCounts.legs;
  if (total === 0) {
    return classifyByMovementPattern(exercises);
  }

  if (splitCounts.push >= splitCounts.pull && splitCounts.push >= splitCounts.legs) return "push";
  if (splitCounts.pull >= splitCounts.legs) return "pull";
  return "legs";
}

function classifyByMovementPattern(
  exercises: WorkoutHistoryEntry["exercises"]
): "push" | "pull" | "legs" {
  const counts: Record<string, number> = { push: 0, pull: 0, legs: 0 };

  for (const ex of exercises) {
    const mp = ex.movementPattern;
    if (mp === "push" || mp === "push_pull") {
      counts.push += ex.sets.length || 1;
    } else if (mp === "pull") {
      counts.pull += ex.sets.length || 1;
    } else {
      counts.legs += ex.sets.length || 1;
    }
  }

  if (counts.push >= counts.pull && counts.push >= counts.legs) return "push";
  if (counts.pull >= counts.legs) return "pull";
  return "legs";
}

export function getHistoryBasedSplitDay(
  history: WorkoutHistoryEntry[],
  exerciseLibrary: Exercise[]
): SplitDay {
  const completed = history
    .filter((e) => isCompletedHistoryEntry(e) && e.advancesSplit !== false)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (completed.length === 0) return "push";

  const recentSplits = completed.slice(0, 3).map((entry) =>
    classifySessionBySplit(entry.exercises, exerciseLibrary)
  );

  // Find least-recently-trained split
  const splitOrder: ("push" | "pull" | "legs")[] = ["push", "pull", "legs"];
  const lastSeen: Record<string, number> = {};

  for (let i = 0; i < recentSplits.length; i++) {
    const split = recentSplits[i];
    if (!(split in lastSeen)) {
      lastSeen[split] = i;
    }
  }

  // Pick the split that was seen least recently (or not at all)
  let leastRecent: "push" | "pull" | "legs" = "push";
  let maxIndex = -1;

  for (const split of splitOrder) {
    const index = lastSeen[split];
    if (index === undefined) {
      // Never trained in recent history → pick this one
      return split;
    }
    if (index > maxIndex) {
      maxIndex = index;
      leastRecent = split;
    }
  }

  return leastRecent;
}

export function resolveTargetPatterns(
  splitType: Constraints["splitType"],
  dayIndex: number,
  forcedSplit?: SplitDay
): MovementPattern[] {
  if (forcedSplit) {
    const forced = forcedSplit.toLowerCase();
    if (forced === "push") return ["push"];
    if (forced === "pull") return ["pull"];
    if (forced === "legs") return ["squat", "hinge"];
    if (forced === "upper") return ["push", "pull"];
    if (forced === "lower") return ["squat", "hinge"];
    if (forced === "full_body") return ["push", "pull", "squat", "hinge", "rotate"];
    if (forced === "body_part") return ["push", "pull", "squat", "hinge", "rotate"];
  }

  const patternOptions = SPLIT_PATTERNS[splitType] ?? SPLIT_PATTERNS.full_body;
  return patternOptions[dayIndex % patternOptions.length];
}

export function resolveAllowedPatterns(
  splitType: Constraints["splitType"],
  targetPatterns: MovementPattern[]
): MovementPattern[] {
  if (splitType !== "ppl") return targetPatterns;

  if (targetPatterns.includes("push")) return ["push", "push_pull"];
  if (targetPatterns.includes("pull")) return ["pull"];
  if (targetPatterns.includes("squat") || targetPatterns.includes("hinge")) {
    return ["squat", "hinge", "lunge", "carry", "rotate"];
  }
  return targetPatterns;
}
