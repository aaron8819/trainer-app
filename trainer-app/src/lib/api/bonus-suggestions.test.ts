import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workoutFindFirst: vi.fn(),
  exerciseFindMany: vi.fn(),
  loadRecentPerformedExerciseIds: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workout: { findFirst: mocks.workoutFindFirst },
    exercise: { findMany: mocks.exerciseFindMany },
  },
}));

vi.mock("./exercise-rotation-history", () => ({
  loadRecentPerformedExerciseIds: (...args: unknown[]) =>
    mocks.loadRecentPerformedExerciseIds(...args),
}));

import { getBonusSuggestions } from "./bonus-suggestions";

describe("getBonusSuggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workoutFindFirst.mockResolvedValue({
      exercises: [{ exercise: { id: "current-id", name: "Renamed Current Exercise" } }],
    });
    mocks.loadRecentPerformedExerciseIds.mockResolvedValue(new Set(["recent-id"]));
    mocks.exerciseFindMany.mockResolvedValue([
      {
        id: "candidate-id",
        name: "Candidate",
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Biceps" } }],
        exerciseEquipment: [{ equipment: { type: "CABLE" } }],
      },
    ]);
  });

  it("excludes current and recently performed exercises by stable ID", async () => {
    const suggestions = await getBonusSuggestions("workout-1", "user-1");

    expect(mocks.loadRecentPerformedExerciseIds).toHaveBeenCalledWith(
      "user-1",
      expect.any(Date)
    );
    expect(mocks.exerciseFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { notIn: ["current-id", "recent-id"] },
          isMainLiftEligible: false,
        },
      })
    );
    expect(suggestions).toEqual([
      expect.objectContaining({
        exerciseId: "candidate-id",
        exerciseName: "Candidate",
      }),
    ]);
  });
});
