import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRuntimeExerciseSwapPreview: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: vi.fn(async () => ({ id: "user-1" })),
}));

vi.mock("@/lib/api/runtime-exercise-swap-service", () => ({
  resolveRuntimeExerciseSwapPreview: mocks.resolveRuntimeExerciseSwapPreview,
  isRuntimeExerciseSwapError: (error: unknown) =>
    error instanceof Error &&
    typeof (error as Error & { status?: unknown }).status === "number",
}));

import { GET } from "./route";

describe("GET /api/workouts/[id]/swap-exercise-preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the shared preview payload from the canonical swap seam", async () => {
    mocks.resolveRuntimeExerciseSwapPreview.mockResolvedValue({
      workoutExerciseId: "we-1",
      exerciseId: "chest-supported-db-row",
      name: "Chest-Supported Dumbbell Row",
      equipment: ["DUMBBELL"],
      movementPatterns: ["horizontal_pull"],
      isMainLift: false,
      isSwapped: true,
      section: "MAIN",
      sessionNote:
        "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
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

    const response = await GET(
      new Request(
        "http://localhost/api/workouts/workout-1/swap-exercise-preview?workoutExerciseId=we-1&exerciseId=chest-supported-db-row",
      ),
      { params: Promise.resolve({ id: "workout-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      exercise: expect.objectContaining({
        workoutExerciseId: "we-1",
        exerciseId: "chest-supported-db-row",
        name: "Chest-Supported Dumbbell Row",
      }),
    });
    expect(mocks.resolveRuntimeExerciseSwapPreview).toHaveBeenCalledWith({
      workoutId: "workout-1",
      workoutExerciseId: "we-1",
      replacementExerciseId: "chest-supported-db-row",
      userId: "user-1",
    });
  });

  it("returns canonical swap preview error codes from the service", async () => {
    mocks.resolveRuntimeExerciseSwapPreview.mockRejectedValue(
      Object.assign(
        new Error("Replacement exercise is not an eligible runtime swap."),
        {
          status: 409,
          code: "REPLACEMENT_NOT_ELIGIBLE",
        },
      ),
    );

    const response = await GET(
      new Request(
        "http://localhost/api/workouts/workout-1/swap-exercise-preview?workoutExerciseId=we-1&exerciseId=cable-row",
      ),
      { params: Promise.resolve({ id: "workout-1" }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Replacement exercise is not an eligible runtime swap.",
      code: "REPLACEMENT_NOT_ELIGIBLE",
    });
  });
});
