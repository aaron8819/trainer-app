import { describe, expect, it } from "vitest";
import { classifySessionBySplit, getHistoryBasedSplitDay } from "./split-queue";
import type { Exercise, WorkoutHistoryEntry } from "./types";

const makeExercise = (id: string, primaryMuscles: string[]): Exercise => ({
  id,
  name: id,
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  jointStress: "low",
  equipment: ["barbell"],
  primaryMuscles,
});

const library: Exercise[] = [
  makeExercise("bench", ["Chest", "Triceps"]),
  makeExercise("ohp", ["Front Delts", "Triceps"]),
  makeExercise("row", ["Back", "Upper Back"]),
  makeExercise("curl", ["Biceps"]),
  makeExercise("squat", ["Quads", "Glutes"]),
  makeExercise("rdl", ["Hamstrings", "Glutes"]),
];

describe("classifySessionBySplit", () => {
  it("classifies a bench/ohp session as push", () => {
    const exercises: WorkoutHistoryEntry["exercises"] = [
      { exerciseId: "bench", movementPattern: "push", sets: [{ exerciseId: "bench", setIndex: 1, reps: 8 }] },
      { exerciseId: "ohp", movementPattern: "push", sets: [{ exerciseId: "ohp", setIndex: 1, reps: 8 }] },
    ];
    expect(classifySessionBySplit(exercises, library)).toBe("push");
  });

  it("classifies a row/curl session as pull", () => {
    const exercises: WorkoutHistoryEntry["exercises"] = [
      { exerciseId: "row", movementPattern: "pull", sets: [{ exerciseId: "row", setIndex: 1, reps: 8 }] },
      { exerciseId: "curl", movementPattern: "pull", sets: [{ exerciseId: "curl", setIndex: 1, reps: 8 }] },
    ];
    expect(classifySessionBySplit(exercises, library)).toBe("pull");
  });

  it("classifies a squat/rdl session as legs", () => {
    const exercises: WorkoutHistoryEntry["exercises"] = [
      { exerciseId: "squat", movementPattern: "squat", sets: [{ exerciseId: "squat", setIndex: 1, reps: 8 }] },
      { exerciseId: "rdl", movementPattern: "hinge", sets: [{ exerciseId: "rdl", setIndex: 1, reps: 8 }] },
    ];
    expect(classifySessionBySplit(exercises, library)).toBe("legs");
  });

  it("falls back to movementPattern when no muscle data", () => {
    const exercises: WorkoutHistoryEntry["exercises"] = [
      { exerciseId: "unknown", movementPattern: "pull", sets: [{ exerciseId: "unknown", setIndex: 1, reps: 8 }] },
    ];
    expect(classifySessionBySplit(exercises, library)).toBe("pull");
  });

  it("uses primaryMuscles from history entry when available", () => {
    const exercises: WorkoutHistoryEntry["exercises"] = [
      {
        exerciseId: "unknown",
        movementPattern: "push",
        primaryMuscles: ["Quads", "Glutes"],
        sets: [{ exerciseId: "unknown", setIndex: 1, reps: 8 }],
      },
    ];
    expect(classifySessionBySplit(exercises, library)).toBe("legs");
  });
});

describe("getHistoryBasedSplitDay", () => {
  it("defaults to push when no history", () => {
    expect(getHistoryBasedSplitDay([], library)).toBe("push");
  });

  it("picks the least-recently-trained split", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(Date.now() - 1 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED",
        exercises: [
          { exerciseId: "bench", movementPattern: "push", sets: [{ exerciseId: "bench", setIndex: 1, reps: 8 }] },
        ],
      },
      {
        date: new Date(Date.now() - 2 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED",
        exercises: [
          { exerciseId: "row", movementPattern: "pull", sets: [{ exerciseId: "row", setIndex: 1, reps: 8 }] },
        ],
      },
      {
        date: new Date(Date.now() - 3 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED",
        exercises: [
          { exerciseId: "squat", movementPattern: "squat", sets: [{ exerciseId: "squat", setIndex: 1, reps: 8 }] },
        ],
      },
    ];
    // Most recent: push, then pull, then legs → legs is least recent
    expect(getHistoryBasedSplitDay(history, library)).toBe("legs");
  });

  it("picks missing split when not all trained", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(Date.now() - 1 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED",
        exercises: [
          { exerciseId: "bench", movementPattern: "push", sets: [{ exerciseId: "bench", setIndex: 1, reps: 8 }] },
        ],
      },
      {
        date: new Date(Date.now() - 2 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED",
        exercises: [
          { exerciseId: "row", movementPattern: "pull", sets: [{ exerciseId: "row", setIndex: 1, reps: 8 }] },
        ],
      },
    ];
    // Push and pull trained, legs never → pick legs
    expect(getHistoryBasedSplitDay(history, library)).toBe("legs");
  });

  it("ignores non-advancing sessions", () => {
    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(Date.now() - 1 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED",
        advancesSplit: false,
        exercises: [
          { exerciseId: "squat", movementPattern: "squat", sets: [{ exerciseId: "squat", setIndex: 1, reps: 8 }] },
        ],
      },
      {
        date: new Date(Date.now() - 2 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED",
        exercises: [
          { exerciseId: "bench", movementPattern: "push", sets: [{ exerciseId: "bench", setIndex: 1, reps: 8 }] },
        ],
      },
    ];
    // The legs session doesn't advance split, so only push is counted → pull and legs missing → pull first in order
    expect(getHistoryBasedSplitDay(history, library)).toBe("pull");
  });
});
