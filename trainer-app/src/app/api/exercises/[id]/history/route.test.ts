import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOwnerReadOnly: vi.fn(),
  loadExerciseHistory: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  findOwnerReadOnly: mocks.findOwnerReadOnly,
}));

vi.mock("@/lib/api/exercise-history", () => ({
  loadExerciseHistory: mocks.loadExerciseHistory,
}));

import { GET } from "./route";

describe("GET /api/exercises/[id]/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOwnerReadOnly.mockResolvedValue({ id: "user-1" });
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

  it("uses an explicit classified workout snapshot as the record comparison context", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/exercises/bench/history?measurementSnapshot=classified&measurementProfile=REPS_EXTERNAL_LOAD&loadConvention=BARBELL_TOTAL&repBasis=TOTAL",
      ),
      { params: Promise.resolve({ id: "bench" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.loadExerciseHistory).toHaveBeenCalledWith("bench", "user-1", 3, {
      measurement: {
        profile: "REPS_EXTERNAL_LOAD",
        loadConvention: "BARBELL_TOTAL",
        repBasis: "TOTAL",
      },
    });
  });

  it("uses an explicit legacy record context and rejects partial classified tuples", async () => {
    const legacy = await GET(
      new Request(
        "http://localhost/api/exercises/bench/history?measurementSnapshot=legacy",
      ),
      { params: Promise.resolve({ id: "bench" }) },
    );
    expect(legacy.status).toBe(200);
    expect(mocks.loadExerciseHistory).toHaveBeenLastCalledWith(
      "bench",
      "user-1",
      3,
      { measurement: null },
    );

    const invalid = await GET(
      new Request(
        "http://localhost/api/exercises/bench/history?measurementSnapshot=classified&measurementProfile=REPS_EXTERNAL_LOAD",
      ),
      { params: Promise.resolve({ id: "bench" }) },
    );
    expect(invalid.status).toBe(400);
  });

  it("does not query history when no owner is available", async () => {
    mocks.findOwnerReadOnly.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/exercises/bench/history"),
      { params: Promise.resolve({ id: "bench" }) }
    );

    expect(response.status).toBe(404);
    expect(mocks.loadExerciseHistory).not.toHaveBeenCalled();
  });
});
