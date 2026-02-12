import {
  SPLIT_PATTERNS,
  getHistoryBasedSplitDay,
  getSplitDayIndex,
  resolveTargetPatterns,
} from "../engine/split-queue";
import type {
  Constraints,
  Exercise,
  MovementPattern,
  SplitDay,
  WorkoutHistoryEntry,
} from "../engine/types";

const DAY_TO_LABEL: Record<SplitDay, string> = {
  push: "Push",
  pull: "Pull",
  legs: "Legs",
  upper: "Upper",
  lower: "Lower",
  full_body: "Full Body",
  body_part: "Body Part",
};

function patternsToLabel(patterns: MovementPattern[]): string {
  const normalized = patterns.join(",");
  if (normalized === "push") return "Push";
  if (normalized === "pull") return "Pull";
  if (normalized === "squat,hinge") return "Legs";
  if (normalized === "push,pull") return "Upper";
  if (normalized.includes("squat") || normalized.includes("hinge")) return "Lower";
  return "Full Body";
}

function buildSyntheticEntry(split: SplitDay, offset: number): WorkoutHistoryEntry {
  const splitKey: "push" | "pull" | "legs" =
    split === "pull" ? "pull" : split === "push" ? "push" : "legs";
  const exerciseBySplit = {
    push: { movementPattern: "push" as const, primaryMuscles: ["Chest"] },
    pull: { movementPattern: "pull" as const, primaryMuscles: ["Lats"] },
    legs: { movementPattern: "squat" as const, primaryMuscles: ["Quads"] },
  }[splitKey];

  return {
    date: new Date(Date.now() + offset * 60_000).toISOString(),
    completed: true,
    status: "COMPLETED",
    advancesSplit: true,
    exercises: [
      {
        exerciseId: `synthetic-${split}-${offset}`,
        movementPattern: exerciseBySplit.movementPattern,
        primaryMuscles: exerciseBySplit.primaryMuscles,
        sets: [{ exerciseId: `synthetic-${split}-${offset}`, reps: 8, setIndex: 1 }],
      },
    ],
  };
}

export function getSplitPreview(
  constraints: Constraints,
  history: WorkoutHistoryEntry[],
  exerciseLibrary: Exercise[],
  depth: number = 3
): { nextAutoLabel: string; queuePreview?: string } {
  if (constraints.splitType === "ppl") {
    const simulatedHistory = [...history];
    const sequence: SplitDay[] = [];
    const total = Math.max(1, depth);
    for (let i = 0; i < total; i++) {
      const day = getHistoryBasedSplitDay(simulatedHistory, exerciseLibrary);
      sequence.push(day);
      simulatedHistory.push(buildSyntheticEntry(day, i + 1));
    }
    return {
      nextAutoLabel: DAY_TO_LABEL[sequence[0]],
      queuePreview: sequence.map((day) => DAY_TO_LABEL[day]).join(" → "),
    };
  }

  const patternOptions = SPLIT_PATTERNS[constraints.splitType] ?? SPLIT_PATTERNS.full_body;
  const dayIndex = getSplitDayIndex(history, patternOptions.length);
  const preview = Array.from({ length: Math.min(depth, patternOptions.length) }, (_, offset) => {
    const patterns = resolveTargetPatterns(constraints.splitType, dayIndex + offset);
    return patternsToLabel(patterns);
  });

  return {
    nextAutoLabel: preview[0] ?? "Full Body",
    queuePreview: preview.join(" → "),
  };
}
