import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  loadExerciseHistory: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: mocks.resolveOwner,
}));

vi.mock("@/lib/api/exercise-history", () => ({
  loadExerciseHistory: mocks.loadExerciseHistory,
}));

import { GET } from "./route";

describe("GET /api/exercises/[id]/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.loadExerciseHistory.mockResolvedValue({ lastExposure: null });
  });

  it("delegates exact exercise and owner identity to the canonical history reader", async () => {
    const response = await GET(
      new Request("http://localhost/api/exercises/bench/history?limit=50"),
      { params: Promise.resolve({ id: "bench" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.loadExerciseHistory).toHaveBeenCalledWith("bench", "user-1", 20);
  });

  it("does not query history when no owner is available", async () => {
    mocks.resolveOwner.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/exercises/bench/history"),
      { params: Promise.resolve({ id: "bench" }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.loadExerciseHistory).not.toHaveBeenCalled();
  });
});
