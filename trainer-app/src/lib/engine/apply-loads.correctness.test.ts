/**
 * Protects: Progression/load assignment correctness (performed-history-driven decisions).
 * Why it matters: Load progression must reward actual performance and ignore unperformed/planned history.
 */
import { describe, expect, it } from "vitest";
import { applyLoads } from "./apply-loads";
import type { Exercise, WorkoutHistoryEntry, WorkoutPlan } from "./types";

const bench: Exercise = {
  id: "bench",
  name: "Bench Press",
  movementPatterns: ["horizontal_push"],
  splitTags: ["push"],
  jointStress: "high",
  isMainLiftEligible: true,
  isCompound: true,
  fatigueCost: 4,
  equipment: ["barbell", "bench", "rack"],
  primaryMuscles: ["Chest"],
  repRangeMin: 3,
  repRangeMax: 12,
};

const baseWorkout: WorkoutPlan = {
  id: "w1",
  scheduledDate: "2026-02-20T00:00:00.000Z",
  warmup: [],
  mainLifts: [
    {
      id: "we1",
      exercise: bench,
      orderIndex: 0,
      isMainLift: true,
      sets: [
        { setIndex: 1, targetReps: 10, targetRpe: 8 },
        { setIndex: 2, targetReps: 10, targetRpe: 8 },
      ],
    },
  ],
  accessories: [],
  estimatedMinutes: 45,
};

function makeHistory(completed: boolean): WorkoutHistoryEntry[] {
  return [
    {
      date: "2026-02-19T00:00:00.000Z",
      completed,
      status: completed ? "COMPLETED" : "PLANNED",
      exercises: [
        {
          exerciseId: "bench",
          sets: [
            { exerciseId: "bench", setIndex: 1, reps: 10, rpe: 7.5, load: 200 },
            { exerciseId: "bench", setIndex: 2, reps: 10, rpe: 8, load: 200 },
          ],
        },
      ],
    },
  ];
}

describe("applyLoads correctness", () => {
  it("progresses load from performed history but does not from unperformed history", () => {
    const withPerformed = applyLoads(baseWorkout, {
      history: makeHistory(true),
      baselines: [{ exerciseId: "bench", context: "volume", topSetWeight: 200 }],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    const withUnperformed = applyLoads(baseWorkout, {
      history: makeHistory(false),
      baselines: [{ exerciseId: "bench", context: "volume", topSetWeight: 200 }],
      exerciseById: { bench },
      primaryGoal: "hypertrophy",
      profile: { trainingAge: "intermediate" },
    });

    const performedTop = withPerformed.mainLifts[0].sets[0].targetLoad ?? 0;
    const unperformedTop = withUnperformed.mainLifts[0].sets[0].targetLoad ?? 0;

    expect(performedTop).toBeGreaterThan(200);
    expect(unperformedTop).toBe(200);
  });
});
