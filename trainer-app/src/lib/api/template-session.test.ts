/**
 * Protects: Intent generation is intent-aligned (push/pull/legs/upper/lower/full_body/body_part(targetMuscles)) with diagnostics.
 * Why it matters: Intent outputs drive workout quality, so alignment and diagnostics must stay stable across refactors.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleExerciseLibrary, exampleGoals, exampleUser } from "../engine/sample-data";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const loadTemplateDetailMock = vi.fn();
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

vi.mock("./templates", () => ({
  loadTemplateDetail: (...args: unknown[]) => loadTemplateDetailMock(...args),
}));

vi.mock("./workout-context", () => ({
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

vi.mock("./periodization", () => ({
  loadCurrentBlockContext: (...args: unknown[]) => loadCurrentBlockContextMock(...args),
}));

vi.mock("./exercise-exposure", () => ({
  loadExerciseExposure: (...args: unknown[]) => loadExerciseExposureMock(...args),
}));

import { generateSessionFromIntent } from "./template-session";

describe("generateSessionFromIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    loadTemplateDetailMock.mockResolvedValue(null);
    loadWorkoutContextMock.mockResolvedValue({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: { daysPerWeek: 4, splitType: "UPPER_LOWER" },
      injuries: [],
      exercises: exampleExerciseLibrary.map((exercise) => ({ id: exercise.id })),
      workouts: [],
      preferences: null,
      checkIns: [],
    });

    mapProfileMock.mockReturnValue(exampleUser);
    mapGoalsMock.mockReturnValue(exampleGoals);
    mapConstraintsMock.mockReturnValue({
      daysPerWeek: 4,
      splitType: "upper_lower",
    });
    mapExercisesMock.mockReturnValue(exampleExerciseLibrary);
    mapHistoryMock.mockReturnValue([]);
    mapPreferencesMock.mockReturnValue(undefined);
    mapCheckInMock.mockReturnValue(undefined);
    applyLoadsMock.mockImplementation((workout: unknown) => workout);
    loadCurrentBlockContextMock.mockResolvedValue({ blockContext: null, weekInMeso: 1 });
    loadExerciseExposureMock.mockResolvedValue(new Map());
  });

  it.each(["push", "pull", "legs", "upper", "lower", "full_body"] as const)(
    "returns intent diagnostics for %s",
    async (intent) => {
      const result = await generateSessionFromIntent("user-1", { intent });

      expect("error" in result).toBe(false);
      if ("error" in result) return;

      expect(result.sessionIntent).toBe(intent);
      expect(result.selection.intentDiagnostics).toBeDefined();
      expect(result.selection.intentDiagnostics?.intent).toBe(intent);
      expect(result.selection.intentDiagnostics?.alignedRatio).toBeGreaterThanOrEqual(0.7);
      expect(result.selection.selectedExerciseIds.length).toBeGreaterThan(0);
    }
  );

  it("requires targetMuscles for body_part intent", async () => {
    const result = await generateSessionFromIntent("user-1", { intent: "body_part" });

    expect(result).toEqual({ error: "targetMuscles is required when intent is body_part" });
  });

  it("returns body_part diagnostics including selected target muscles", async () => {
    const result = await generateSessionFromIntent("user-1", {
      intent: "body_part",
      targetMuscles: ["Chest"],
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.intentDiagnostics?.intent).toBe("body_part");
    expect(result.selection.intentDiagnostics?.targetMuscles).toEqual(["Chest"]);
    expect(result.selection.intentDiagnostics?.alignedRatio).toBeGreaterThanOrEqual(0.7);
  });

  it("uses blockContext.weekInBlock for periodization week when it differs from weekInMeso", async () => {
    loadCurrentBlockContextMock.mockResolvedValue({
      weekInMeso: 4,
      blockContext: {
        weekInBlock: 2,
        block: { blockType: "intensification", durationWeeks: 3 },
        mesocycle: { durationWeeks: 5 },
        macroCycle: { primaryGoal: "hypertrophy", trainingAge: "intermediate" },
      },
    });

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.periodizationWeek).toBe(2);
    expect(result.selection.cycleContext?.weekInMeso).toBe(4);
    expect(result.selection.cycleContext?.weekInBlock).toBe(2);
  });

  it("populates deloadDecision when a deload is applied", async () => {
    loadCurrentBlockContextMock.mockResolvedValue({ blockContext: null, weekInMeso: 4 });

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.deloadDecision?.mode).toBe("scheduled");
    expect(result.selection.deloadDecision?.reductionPercent).toBe(50);
  });
});
