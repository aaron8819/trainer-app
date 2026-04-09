import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRuntimeExerciseSwapCandidates: vi.fn(),
  applyRuntimeExerciseSwap: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/api/runtime-exercise-swap-service", () => ({
  resolveRuntimeExerciseSwapCandidates: mocks.resolveRuntimeExerciseSwapCandidates,
  applyRuntimeExerciseSwap: mocks.applyRuntimeExerciseSwap,
  isRuntimeExerciseSwapError: (error: unknown) =>
    error instanceof Error &&
    typeof (error as Error & { status?: unknown }).status === "number",
}));

import { GET, POST } from "./route";

describe("/api/workouts/[id]/swap-exercise route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps GET thin and returns shared swap candidates", async () => {
    mocks.resolveRuntimeExerciseSwapCandidates.mockResolvedValue([
      {
        exerciseId: "chest-supported-db-row",
        exerciseName: "Chest-Supported Dumbbell Row",
        primaryMuscles: ["lats", "upper back"],
        equipment: ["dumbbell"],
        compatibility: {
          primaryMuscleOverlap: ["lats", "upper back"],
          movementPatternOverlap: ["horizontal_pull"],
          equipmentDemandStayedAtOrBelowOriginal: true,
          fatigueDelta: -1,
          score: 11,
        },
        reason: "Keeps lats, upper back, matches horizontal_pull, and reduces fatigue by 1 without raising equipment complexity.",
      },
    ]);

    const response = await GET(
      new Request("http://localhost/api/workouts/workout-1/swap-exercise?workoutExerciseId=we-1"),
      { params: Promise.resolve({ id: "workout-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      candidates: [
        expect.objectContaining({
          exerciseId: "chest-supported-db-row",
          exerciseName: "Chest-Supported Dumbbell Row",
        }),
      ],
    });
    expect(mocks.resolveRuntimeExerciseSwapCandidates).toHaveBeenCalledWith({
      workoutId: "workout-1",
      workoutExerciseId: "we-1",
      userId: "user-1",
    });
  });

  it("keeps POST thin and returns the shared swap payload", async () => {
    mocks.applyRuntimeExerciseSwap.mockResolvedValue({
      workoutExerciseId: "we-1",
      exerciseId: "chest-supported-db-row",
      name: "Chest-Supported Dumbbell Row",
      equipment: ["DUMBBELL"],
      movementPatterns: ["horizontal_pull"],
      isMainLift: false,
      isSwapped: true,
      section: "MAIN",
      sessionNote: "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
      sets: [
        {
          setId: "set-1",
          setIndex: 1,
          targetReps: 10,
          targetRepRange: { min: 8, max: 12 },
          targetLoad: 27.5,
          targetRpe: 8,
          restSeconds: 120,
        },
      ],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/workout-1/swap-exercise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutExerciseId: "we-1",
          replacementExerciseId: "chest-supported-db-row",
        }),
      }),
      { params: Promise.resolve({ id: "workout-1" }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      exercise: expect.objectContaining({
        workoutExerciseId: "we-1",
        exerciseId: "chest-supported-db-row",
        name: "Chest-Supported Dumbbell Row",
      }),
    });
    expect(mocks.applyRuntimeExerciseSwap).toHaveBeenCalledWith({
      workoutId: "workout-1",
      workoutExerciseId: "we-1",
      replacementExerciseId: "chest-supported-db-row",
      userId: "user-1",
    });
  });
});
