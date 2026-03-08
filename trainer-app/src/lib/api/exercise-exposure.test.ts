/**
 * Protects: Exposure history should track performed work only, not template presence.
 * Why it matters: Rotation novelty and SRA context should ignore completed workout rows with zero real stimulus.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindUnique = vi.fn();
  const workoutExerciseCount = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const exerciseExposureUpsert = vi.fn();
  const exerciseExposureFindMany = vi.fn();

  return {
    workoutFindUnique,
    workoutExerciseCount,
    workoutExerciseFindMany,
    exerciseExposureUpsert,
    exerciseExposureFindMany,
    prisma: {
      workout: {
        findUnique: workoutFindUnique,
      },
      workoutExercise: {
        count: workoutExerciseCount,
        findMany: workoutExerciseFindMany,
      },
      exerciseExposure: {
        upsert: exerciseExposureUpsert,
        findMany: exerciseExposureFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { loadExerciseExposure, updateExerciseExposure } from "./exercise-exposure";

describe("exercise exposure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not update exposure for completed exercises with no performed stimulus", async () => {
    mocks.workoutFindUnique.mockResolvedValue({
      id: "workout-1",
      status: "COMPLETED",
      exercises: [
        {
          exercise: { name: "Cable Curl" },
          sets: [
            { logs: [] },
            { logs: [{ actualReps: null, actualRpe: null, wasSkipped: true }] },
          ],
        },
      ],
    });

    await updateExerciseExposure("user-1", "workout-1");

    expect(mocks.workoutExerciseCount).not.toHaveBeenCalled();
    expect(mocks.exerciseExposureUpsert).not.toHaveBeenCalled();
  });

  it("updates exposure for exercises with at least one performed set", async () => {
    mocks.workoutFindUnique.mockResolvedValue({
      id: "workout-1",
      status: "COMPLETED",
      exercises: [
        {
          exercise: { name: "Bench Press" },
          sets: [
            { logs: [{ actualReps: 8, actualRpe: 8, wasSkipped: false }] },
            { logs: [{ actualReps: null, actualRpe: null, wasSkipped: true }] },
          ],
        },
        {
          exercise: { name: "Cable Curl" },
          sets: [{ logs: [] }],
        },
      ],
    });
    mocks.workoutExerciseCount
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4);

    await updateExerciseExposure("user-1", "workout-1");

    expect(mocks.workoutExerciseCount).toHaveBeenCalledTimes(3);
    for (const call of mocks.workoutExerciseCount.mock.calls) {
      expect(call[0].where.exercise.name).toBe("Bench Press");
      expect(call[0].where.sets).toEqual({
        some: {
          logs: {
            some: {
              wasSkipped: false,
              OR: [{ actualReps: { not: null } }, { actualRpe: { not: null } }],
            },
          },
        },
      });
    }

    expect(mocks.exerciseExposureUpsert).toHaveBeenCalledTimes(1);
    expect(mocks.exerciseExposureUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_exerciseName: {
            userId: "user-1",
            exerciseName: "Bench Press",
          },
        },
        create: expect.objectContaining({
          exerciseName: "Bench Press",
          timesUsedL4W: 2,
          timesUsedL8W: 3,
          timesUsedL12W: 4,
          avgSetsPerWeek: 0.25,
        }),
      })
    );
  });

  it("preserves selection history for genuinely performed exercises", async () => {
    mocks.exerciseExposureFindMany.mockResolvedValue([
      {
        exerciseName: "Bench Press",
        lastUsedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        timesUsedL12W: 3,
      },
    ]);
    mocks.workoutExerciseFindMany.mockResolvedValue([
      {
        workout: { completedAt: new Date("2026-02-15T00:00:00.000Z") },
        sets: [{ logs: [{ actualLoad: 190, actualReps: 8 }] }],
      },
      {
        workout: { completedAt: new Date("2026-02-08T00:00:00.000Z") },
        sets: [{ logs: [{ actualLoad: 185, actualReps: 8 }] }],
      },
      {
        workout: { completedAt: new Date("2026-02-01T00:00:00.000Z") },
        sets: [{ logs: [{ actualLoad: 180, actualReps: 8 }] }],
      },
    ]);

    const result = await loadExerciseExposure("user-1");

    expect(mocks.workoutExerciseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          exercise: { name: "Bench Press" },
          sets: {
            some: {
              logs: {
                some: {
                  wasSkipped: false,
                  OR: [{ actualReps: { not: null } }, { actualRpe: { not: null } }],
                },
              },
            },
          },
        }),
      })
    );

    expect(result.get("Bench Press")).toEqual(
      expect.objectContaining({
        usageCount: 3,
        trend: "improving",
      })
    );
  });
});
