import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const getBonusSuggestions = vi.fn();
  const getCloseoutSuggestions = vi.fn();
  const workoutFindFirst = vi.fn();
  const isCloseoutSession = vi.fn();

  return {
    resolveOwner,
    getBonusSuggestions,
    getCloseoutSuggestions,
    workoutFindFirst,
    isCloseoutSession,
    prisma: {
      workout: {
        findFirst: workoutFindFirst,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/bonus-suggestions", () => ({
  getBonusSuggestions: (...args: unknown[]) => mocks.getBonusSuggestions(...args),
}));

vi.mock("@/lib/api/closeout-suggestions", () => ({
  getCloseoutSuggestions: (...args: unknown[]) => mocks.getCloseoutSuggestions(...args),
}));

vi.mock("@/lib/session-semantics/closeout-classifier", () => ({
  isCloseoutSession: (...args: unknown[]) => mocks.isCloseoutSession(...args),
}));

import { GET } from "./route";

describe("GET /api/workouts/[id]/bonus-suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.isCloseoutSession.mockReturnValue(false);
  });

  it("delegates closeout workouts to the closeout suggestion helper", async () => {
    mocks.workoutFindFirst.mockResolvedValue({ selectionMetadata: { any: "shape" } });
    mocks.isCloseoutSession.mockReturnValue(true);
    mocks.getCloseoutSuggestions.mockResolvedValue([
      {
        muscle: "Chest",
        exerciseId: "fly",
        exerciseName: "Cable Fly",
        primaryMuscles: ["Chest"],
        equipment: ["CABLE"],
        sets: 2,
        reps: "10-14",
        rationale: "High-priority closeout: Chest is projected 6/10 against target.",
        reason: "High-priority closeout: Chest is projected 6/10 against target.",
        suggestedSets: 2,
        suggestedLoad: null,
      },
    ]);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workout-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggestions: [
        expect.objectContaining({
          exerciseId: "fly",
          muscle: "Chest",
        }),
      ],
    });
    expect(mocks.getCloseoutSuggestions).toHaveBeenCalledWith({
      workoutId: "workout-1",
      userId: "user-1",
    });
    expect(mocks.getBonusSuggestions).not.toHaveBeenCalled();
  });

  it("preserves legacy behavior for non-closeout workouts", async () => {
    mocks.workoutFindFirst.mockResolvedValue({ selectionMetadata: { any: "shape" } });
    mocks.getBonusSuggestions.mockResolvedValue([
      {
        muscle: null,
        exerciseId: "curl",
        exerciseName: "Curl",
        primaryMuscles: ["Biceps"],
        equipment: ["CABLE"],
        sets: 3,
        reps: null,
        rationale: "Biceps has room to grow.",
        reason: "Biceps has room to grow.",
        suggestedSets: 3,
        suggestedLoad: null,
      },
    ]);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "workout-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      suggestions: [
        expect.objectContaining({
          exerciseId: "curl",
        }),
      ],
    });
    expect(mocks.getBonusSuggestions).toHaveBeenCalledWith("workout-1", "user-1");
    expect(mocks.getCloseoutSuggestions).not.toHaveBeenCalled();
  });
});
