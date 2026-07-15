import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workoutFindFirst: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workout: {
      findFirst: (...args: unknown[]) => mocks.workoutFindFirst(...args),
    },
  },
}));

import { loadWorkoutWithExplainabilityRelations } from "./query";

describe("loadWorkoutWithExplainabilityRelations", () => {
  const ownedWorkout = { id: "workout-1", userId: "owner-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workoutFindFirst.mockImplementation(
      async (args: { where?: { id?: string; userId?: string } }) =>
        args.where?.id === ownedWorkout.id && args.where.userId === ownedWorkout.userId
          ? ownedWorkout
          : null
    );
  });

  it("loads a workout only when both workout and owner IDs match", async () => {
    await expect(
      loadWorkoutWithExplainabilityRelations({
        workoutId: "workout-1",
        ownerId: "owner-1",
      })
    ).resolves.toEqual(ownedWorkout);

    expect(mocks.workoutFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "workout-1",
          userId: "owner-1",
        },
      })
    );
  });

  it("returns the same null result for a foreign-owned and nonexistent workout", async () => {
    const foreignWorkout = await loadWorkoutWithExplainabilityRelations({
      workoutId: "workout-1",
      ownerId: "owner-2",
    });
    const nonexistentWorkout = await loadWorkoutWithExplainabilityRelations({
      workoutId: "missing-workout",
      ownerId: "owner-1",
    });

    expect(foreignWorkout).toBeNull();
    expect(nonexistentWorkout).toBeNull();
  });
});
