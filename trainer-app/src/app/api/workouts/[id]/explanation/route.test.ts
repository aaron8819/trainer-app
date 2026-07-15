import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  generateWorkoutExplanation: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/explainability", () => ({
  generateWorkoutExplanation: (...args: unknown[]) =>
    mocks.generateWorkoutExplanation(...args),
}));

import { GET } from "./route";

describe("GET /api/workouts/[id]/explanation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "owner-1" });
  });

  it("returns the existing explanation output for an owner-scoped workout", async () => {
    mocks.generateWorkoutExplanation.mockResolvedValue({
      confidence: { level: "high", summary: "Complete evidence", missingSignals: [] },
      sessionContext: {
        narrative: "Authorized explanation",
        volumeStatus: {
          overallSummary: "On target",
          muscleStatuses: new Map([["Chest", { status: "on_target" }]]),
        },
      },
      coachMessages: [],
      exerciseRationales: new Map([["exercise-1", { exerciseName: "Bench Press" }]]),
      prescriptionRationales: new Map(),
      progressionReceipts: new Map(),
      nextExposureDecisions: new Map(),
      filteredExercises: [],
      volumeCompliance: [],
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workout-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.generateWorkoutExplanation).toHaveBeenCalledWith({
      workoutId: "workout-1",
      ownerId: "owner-1",
    });
    await expect(response.json()).resolves.toMatchObject({
      confidence: { level: "high" },
      sessionContext: {
        narrative: "Authorized explanation",
        volumeStatus: {
          muscleStatuses: { Chest: { status: "on_target" } },
        },
      },
      exerciseRationales: {
        "exercise-1": { exerciseName: "Bench Press" },
      },
    });
  });

  it.each(["foreign-owned", "nonexistent"])(
    "returns the existing not-found response for a %s workout",
    async () => {
      mocks.generateWorkoutExplanation.mockResolvedValue({ error: "Workout not found" });

      const response = await GET(new Request("http://localhost"), {
        params: Promise.resolve({ id: "workout-1" }),
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Workout not found" });
    }
  );
});
