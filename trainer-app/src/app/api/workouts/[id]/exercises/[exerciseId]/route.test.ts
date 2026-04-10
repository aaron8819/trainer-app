import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  removeRuntimeAddedWorkoutExercise: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: mocks.resolveOwner,
}));

vi.mock("@/lib/api/runtime-exercise-remove-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/runtime-exercise-remove-service")>(
    "@/lib/api/runtime-exercise-remove-service"
  );

  return {
    ...actual,
    removeRuntimeAddedWorkoutExercise: mocks.removeRuntimeAddedWorkoutExercise,
  };
});

import { RuntimeExerciseRemoveError } from "@/lib/api/runtime-exercise-remove-service";
import { DELETE } from "./route";

describe("DELETE /api/workouts/[id]/exercises/[exerciseId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.removeRuntimeAddedWorkoutExercise.mockResolvedValue({
      removedWorkoutExerciseId: "we-added",
    });
  });

  it("delegates owner-scoped runtime-added removal", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/workouts/workout-1/exercises/we-added", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "workout-1", exerciseId: "we-added" }) }
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      removedWorkoutExerciseId: "we-added",
    });
    expect(response.status).toBe(200);
    expect(mocks.removeRuntimeAddedWorkoutExercise).toHaveBeenCalledWith({
      workoutId: "workout-1",
      workoutExerciseId: "we-added",
      userId: "user-1",
    });
  });

  it("returns service validation errors", async () => {
    mocks.removeRuntimeAddedWorkoutExercise.mockRejectedValueOnce(
      new RuntimeExerciseRemoveError("Logged exercises cannot be removed.", {
        status: 409,
        code: "LOGGED_EXERCISE_BLOCKED",
      })
    );

    const response = await DELETE(
      new Request("http://localhost/api/workouts/workout-1/exercises/we-added", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "workout-1", exerciseId: "we-added" }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Logged exercises cannot be removed.",
    });
  });
});
