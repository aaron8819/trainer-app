import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const resolveOwner = vi.fn();
  const loadActiveMesocycle = vi.fn();
  const generateSessionFromIntent = vi.fn();
  const generateDeloadSessionFromIntent = vi.fn();
  const applyAutoregulation = vi.fn();

  return {
    resolveOwner,
    loadActiveMesocycle,
    generateSessionFromIntent,
    generateDeloadSessionFromIntent,
    applyAutoregulation,
  };
});

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => mocks.loadActiveMesocycle(...args),
}));

vi.mock("@/lib/api/template-session", () => ({
  generateSessionFromIntent: (...args: unknown[]) => mocks.generateSessionFromIntent(...args),
  generateDeloadSessionFromIntent: (...args: unknown[]) =>
    mocks.generateDeloadSessionFromIntent(...args),
}));

vi.mock("@/lib/api/autoregulation", () => ({
  applyAutoregulation: (...args: unknown[]) => mocks.applyAutoregulation(...args),
}));

import { POST } from "./route";

describe("POST /api/workouts/generate-from-intent deload gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.applyAutoregulation.mockImplementation(async (_userId, workout) => ({
      adjusted: workout,
      applied: false,
      reason: null,
      signalAgeHours: null,
      fatigueScore: null,
      modifications: [],
      rationale: null,
      wasAutoregulated: false,
    }));
  });

  it("returns deload prescription path when active mesocycle state is ACTIVE_DELOAD", async () => {
    mocks.loadActiveMesocycle.mockResolvedValue({ id: "meso-1", state: "ACTIVE_DELOAD" });
    mocks.generateDeloadSessionFromIntent.mockResolvedValue({
      workout: {
        id: "w1",
        scheduledDate: new Date().toISOString(),
        warmup: [],
        mainLifts: [{ id: "ex", exercise: { id: "ex", name: "Row" }, isMainLift: true, orderIndex: 0, sets: [{ setIndex: 1, targetReps: 8, targetLoad: 60, targetRpe: 5 }] }],
        accessories: [],
        estimatedMinutes: 30,
      },
      selectionMode: "INTENT",
      sessionIntent: "pull",
      sraWarnings: [],
      substitutions: [],
      volumePlanByMuscle: {},
      selection: {
        selectedExerciseIds: ["ex"],
        mainLiftIds: ["ex"],
        accessoryIds: [],
        perExerciseSetTargets: { ex: 1 },
        rationale: {},
        volumePlanByMuscle: {},
      },
      filteredExercises: [],
    });

    const response = await POST(
      new Request("http://localhost/api/workouts/generate-from-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "pull" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.generateDeloadSessionFromIntent).toHaveBeenCalledOnce();
    expect(mocks.generateSessionFromIntent).not.toHaveBeenCalled();
    expect(body.workout.mainLifts[0].sets[0].targetRpe).toBe(5);
  });
});

