import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import { detectPRsFromWorkout } from "@/lib/api/pr-tracker";

function loggedSet(input: {
  exerciseId: string;
  exerciseName: string;
  actualLoad: number | null;
  actualReps: number;
}) {
  return {
    actualLoad: input.actualLoad,
    actualReps: input.actualReps,
    workoutSet: {
      workoutExercise: {
        exerciseId: input.exerciseId,
        exercise: { id: input.exerciseId, name: input.exerciseName },
      },
    },
  };
}

function transaction(input: {
  loadSets?: ReturnType<typeof loggedSet>[];
  repsSets?: ReturnType<typeof loggedSet>[];
  aggregates?: Array<{ _max: { actualLoad?: number | null; actualReps?: number | null } }>;
}) {
  const findMany = vi
    .fn()
    .mockResolvedValueOnce(input.loadSets ?? [])
    .mockResolvedValueOnce(input.repsSets ?? []);
  const aggregate = vi.fn();
  for (const result of input.aggregates ?? []) {
    aggregate.mockResolvedValueOnce(result);
  }
  return {
    tx: { setLog: { findMany, aggregate } } as unknown as Parameters<
      typeof detectPRsFromWorkout
    >[2],
    findMany,
    aggregate,
  };
}

describe("detectPRsFromWorkout", () => {
  it("allows an all-bodyweight workout to produce a legitimate reps PR", async () => {
    const { tx } = transaction({
      repsSets: [
        loggedSet({
          exerciseId: "pull-up",
          exerciseName: "Pull-Up",
          actualLoad: null,
          actualReps: 12,
        }),
      ],
      aggregates: [{ _max: { actualReps: 10 } }],
    });

    const result = await detectPRsFromWorkout("workout-1", "user-1", tx);

    expect(result.repsPRs).toEqual([
      {
        exerciseName: "Pull-Up",
        previousTopReps: 10,
        newTopReps: 12,
      },
    ]);
  });

  it("requires REPS_BODYWEIGHT for both current and historical reps evidence", async () => {
    const { tx, findMany, aggregate } = transaction({
      repsSets: [
        loggedSet({
          exerciseId: "pull-up",
          exerciseName: "Pull-Up",
          actualLoad: null,
          actualReps: 12,
        }),
      ],
      aggregates: [{ _max: { actualReps: 10 } }],
    });

    await detectPRsFromWorkout("workout-1", "user-1", tx);

    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      where: {
        workoutSet: {
          workoutExercise: {
            workoutId: "workout-1",
            measurementProfile: "REPS_BODYWEIGHT",
          },
        },
        actualLoad: null,
      },
    });
    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workoutSet: {
            workoutExercise: expect.objectContaining({
              exerciseId: "pull-up",
              measurementProfile: "REPS_BODYWEIGHT",
            }),
          },
        }),
      }),
    );
  });

  it("does not classify a legacy-null load as bodyweight reps evidence", async () => {
    const { tx, aggregate } = transaction({ repsSets: [] });

    const result = await detectPRsFromWorkout("workout-1", "user-1", tx);

    expect(result.repsPRs).toEqual([]);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("does not classify Bulgarian semantic zero as a bodyweight reps PR", async () => {
    const { tx, aggregate } = transaction({
      loadSets: [
        loggedSet({
          exerciseId: "bulgarian-split-squat",
          exerciseName: "Bulgarian Split Squat",
          actualLoad: 0,
          actualReps: 10,
        }),
      ],
      repsSets: [],
    });

    const result = await detectPRsFromWorkout("workout-1", "user-1", tx);

    expect(result).toEqual({ prsDetected: 0, updates: [], repsPRs: [] });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("does not classify Hack semantic zero as a bodyweight reps PR", async () => {
    const { tx, aggregate } = transaction({
      loadSets: [
        loggedSet({
          exerciseId: "hack-squat",
          exerciseName: "Hack Squat",
          actualLoad: 0,
          actualReps: 10,
        }),
      ],
      repsSets: [],
    });

    const result = await detectPRsFromWorkout("workout-1", "user-1", tx);

    expect(result).toEqual({ prsDetected: 0, updates: [], repsPRs: [] });
    expect(aggregate).not.toHaveBeenCalled();
  });

  it("preserves positive external-load PR behavior", async () => {
    const { tx } = transaction({
      loadSets: [
        loggedSet({
          exerciseId: "bench",
          exerciseName: "Bench Press",
          actualLoad: 225,
          actualReps: 8,
        }),
      ],
      aggregates: [{ _max: { actualLoad: 220 } }],
    });

    const result = await detectPRsFromWorkout("workout-1", "user-1", tx);

    expect(result).toMatchObject({
      prsDetected: 1,
      updates: [
        {
          exerciseName: "Bench Press",
          previousTopSet: 220,
          newTopSet: 225,
          unit: "lbs",
        },
      ],
      repsPRs: [],
    });
  });
});
