import type { Constraints, MovementPattern, SplitDay, WorkoutHistoryEntry } from "./types";

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
    (entry) => entry.advancesSplit !== false && entry.status === "COMPLETED"
  );
  const completedCount = advancingCompleted.length;
  return completedCount % Math.max(1, patternLength);
}

export function resolveTargetPatterns(
  splitType: Constraints["splitType"],
  dayIndex: number,
  forcedSplit?: SplitDay
): MovementPattern[] {
  if (forcedSplit) {
    const forced = forcedSplit.toLowerCase();
    if (forced === "push") {
      return ["push"];
    }
    if (forced === "pull") {
      return ["pull"];
    }
    if (forced === "legs") {
      return ["squat", "hinge"];
    }
    if (forced === "upper") {
      return ["push", "pull"];
    }
    if (forced === "lower") {
      return ["squat", "hinge"];
    }
    if (forced === "full_body") {
      return ["push", "pull", "squat", "hinge", "rotate"];
    }
  }

  const patternOptions = SPLIT_PATTERNS[splitType] ?? SPLIT_PATTERNS.full_body;
  return patternOptions[dayIndex % patternOptions.length];
}

export function resolveAllowedPatterns(
  splitType: Constraints["splitType"],
  targetPatterns: MovementPattern[]
): MovementPattern[] {
  if (splitType !== "ppl") {
    return targetPatterns;
  }

  if (targetPatterns.includes("push")) {
    return ["push", "push_pull"];
  }
  if (targetPatterns.includes("pull")) {
    return ["pull"];
  }
  if (targetPatterns.includes("squat") || targetPatterns.includes("hinge")) {
    return ["squat", "hinge", "lunge", "carry", "rotate"];
  }
  return targetPatterns;
}
