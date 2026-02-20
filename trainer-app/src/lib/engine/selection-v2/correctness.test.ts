/**
 * Protects: Selection correctness (constraints + intent alignment behavior).
 * Why it matters: Session generation must never select hard-blocked exercises and must preserve intent-aligned output quality.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleExerciseLibrary, exampleGoals, exampleUser } from "@/lib/engine/sample-data";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const loadWorkoutContextMock = vi.fn();
const mapProfileMock = vi.fn();
const mapGoalsMock = vi.fn();
const mapConstraintsMock = vi.fn();
const mapExercisesMock = vi.fn();
const mapHistoryMock = vi.fn();
const mapPreferencesMock = vi.fn();
const mapCheckInMock = vi.fn();
const applyLoadsMock = vi.fn();
const loadCurrentBlockContextMock = vi.fn();
const loadExerciseExposureMock = vi.fn();

vi.mock("@/lib/api/workout-context", () => ({
  loadWorkoutContext: (...args: unknown[]) => loadWorkoutContextMock(...args),
  mapProfile: (...args: unknown[]) => mapProfileMock(...args),
  mapGoals: (...args: unknown[]) => mapGoalsMock(...args),
  mapConstraints: (...args: unknown[]) => mapConstraintsMock(...args),
  mapExercises: (...args: unknown[]) => mapExercisesMock(...args),
  mapHistory: (...args: unknown[]) => mapHistoryMock(...args),
  mapPreferences: (...args: unknown[]) => mapPreferencesMock(...args),
  mapCheckIn: (...args: unknown[]) => mapCheckInMock(...args),
  applyLoads: (...args: unknown[]) => applyLoadsMock(...args),
}));

vi.mock("@/lib/api/periodization", () => ({
  loadCurrentBlockContext: (...args: unknown[]) => loadCurrentBlockContextMock(...args),
}));

vi.mock("@/lib/api/exercise-exposure", () => ({
  loadExerciseExposure: (...args: unknown[]) => loadExerciseExposureMock(...args),
}));

import { generateSessionFromIntent } from "@/lib/api/template-session";

describe("selection correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    loadWorkoutContextMock.mockResolvedValue({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: { sessionMinutes: 60, daysPerWeek: 4 },
      injuries: [],
      exercises: exampleExerciseLibrary.map((exercise) => ({ id: exercise.id })),
      workouts: [],
      preferences: null,
      checkIns: [],
    });

    mapProfileMock.mockReturnValue(exampleUser);
    mapGoalsMock.mockReturnValue(exampleGoals);
    mapConstraintsMock.mockReturnValue({ daysPerWeek: 4, sessionMinutes: 60, splitType: "upper_lower" });
    mapHistoryMock.mockReturnValue([]);
    mapCheckInMock.mockReturnValue(undefined);
    applyLoadsMock.mockImplementation((workout: unknown) => workout);
    loadCurrentBlockContextMock.mockResolvedValue({ blockContext: null, weekInMeso: 1 });
    loadExerciseExposureMock.mockResolvedValue(new Map());
  });

  it("respects avoid constraints and still meets intent alignment minimum ratio", async () => {
    const pushPool = exampleExerciseLibrary.filter((exercise) =>
      ["push", "pull", "legs"].includes(exercise.splitTags[0] ?? "")
    );

    mapExercisesMock.mockReturnValue(pushPool);
    mapPreferencesMock.mockReturnValue({
      favoriteExerciseIds: [],
      avoidExerciseIds: ["bench"],
    });

    const result = await generateSessionFromIntent("user-1", { intent: "push" });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.selectedExerciseIds).not.toContain("bench");
    expect(result.selection.intentDiagnostics?.alignedRatio).toBeGreaterThanOrEqual(0.7);
  });
});
