/**
 * Protects: Performed-work-only adaptation: no planned fallback in history/progression/explainability/readiness.
 * Why it matters: Progression quality depends on filtering to truly performed work only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERFORMED_WORKOUT_STATUSES } from "@/lib/workout-status";

const mocks = vi.hoisted(() => {
  const findMany = vi.fn();
  return {
    findMany,
    prisma: {
      workoutExercise: {
        findMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { loadExerciseHistory } from "./exercise-history";

describe("loadExerciseHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries performed workout statuses and returns performed non-skipped logs only", async () => {
    mocks.findMany.mockResolvedValue([
      {
        workout: { scheduledDate: new Date("2026-02-20T00:00:00.000Z") },
        sets: [
          {
            setIndex: 1,
            logs: [{ actualReps: 8, actualLoad: 185, actualRpe: 8, wasSkipped: false }],
          },
          {
            setIndex: 2,
            logs: [],
          },
          {
            setIndex: 3,
            logs: [{ actualReps: null, actualLoad: null, actualRpe: null, wasSkipped: true }],
          },
        ],
      },
    ]);

    const result = await loadExerciseHistory("bench", "user-1", 3);

    expect(mocks.findMany).toHaveBeenCalled();
    const query = mocks.findMany.mock.calls[0][0];
    expect(query.where.workout.status.in).toEqual([...PERFORMED_WORKOUT_STATUSES]);

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].sets).toEqual([{ setIndex: 1, reps: 8, load: 185, rpe: 8 }]);
  });
});
