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
const loadActiveMesocycleMock = vi.fn();
const loadExerciseExposureMock = vi.fn();
const getCurrentMesoWeekMock = vi.fn();
const getRirTargetMock = vi.fn();
const getWeeklyVolumeTargetMock = vi.fn();

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

vi.mock("./exercise-exposure", () => ({
  loadExerciseExposure: (...args: unknown[]) => loadExerciseExposureMock(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => loadActiveMesocycleMock(...args),
  getCurrentMesoWeek: (...args: unknown[]) => getCurrentMesoWeekMock(...args),
  getRirTarget: (...args: unknown[]) => getRirTargetMock(...args),
  getWeeklyVolumeTarget: (...args: unknown[]) => getWeeklyVolumeTargetMock(...args),
}));

import { generateSessionFromIntent } from "./template-session";

describe("generateSessionFromIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    loadTemplateDetailMock.mockResolvedValue(null);
    loadWorkoutContextMock.mockResolvedValue({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: { daysPerWeek: 4, splitType: "UPPER_LOWER", weeklySchedule: ["UPPER", "LOWER"] },
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
      weeklySchedule: ["upper", "lower"],
    });
    mapExercisesMock.mockReturnValue(exampleExerciseLibrary);
    mapHistoryMock.mockReturnValue([]);
    mapPreferencesMock.mockReturnValue(undefined);
    mapCheckInMock.mockReturnValue(undefined);
    applyLoadsMock.mockImplementation((workout: unknown) => workout);
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      durationWeeks: 5,
    });
    getCurrentMesoWeekMock.mockReturnValue(2);
    getRirTargetMock.mockReturnValue({ min: 2, max: 3 });
    getWeeklyVolumeTargetMock.mockImplementation(() => 12);
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

  it("uses lifecycle week for periodization week and cycle context", async () => {
    getCurrentMesoWeekMock.mockReturnValue(4);
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 9,
      durationWeeks: 5,
    });

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.periodizationWeek).toBe(4);
    expect(result.selection.cycleContext?.weekInMeso).toBe(4);
    expect(result.selection.cycleContext?.weekInBlock).toBe(4);
  });

  it("populates deloadDecision when a deload is applied", async () => {
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_DELOAD",
      accumulationSessionsCompleted: 12,
      durationWeeks: 5,
    });
    getCurrentMesoWeekMock.mockReturnValue(5);
    getRirTargetMock.mockReturnValue({ min: 4, max: 6 });

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.deloadDecision?.mode).toBe("scheduled");
    expect(result.selection.deloadDecision?.reductionPercent).toBe(50);
  });

  it("applies lifecycle RIR bands to session RPE progression (week 1 -> 2 -> 4)", async () => {
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 0,
      durationWeeks: 5,
    });
    getCurrentMesoWeekMock.mockReturnValue(1);
    getRirTargetMock.mockReturnValue({ min: 3, max: 4 });
    let result = await generateSessionFromIntent("user-1", { intent: "push" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const week1Rpe = result.workout.mainLifts[0]?.sets[0]?.targetRpe ?? 0;
    expect(week1Rpe).toBeGreaterThanOrEqual(6);
    expect(week1Rpe).toBeLessThanOrEqual(7);

    getCurrentMesoWeekMock.mockReturnValue(2);
    getRirTargetMock.mockReturnValue({ min: 2, max: 3 });
    result = await generateSessionFromIntent("user-1", { intent: "push" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const week2Rpe = result.workout.mainLifts[0]?.sets[0]?.targetRpe ?? 0;
    expect(week2Rpe).toBeGreaterThanOrEqual(7);
    expect(week2Rpe).toBeLessThanOrEqual(8);

    getCurrentMesoWeekMock.mockReturnValue(4);
    getRirTargetMock.mockReturnValue({ min: 1, max: 2 });
    result = await generateSessionFromIntent("user-1", { intent: "push" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const week4Rpe = result.workout.mainLifts[0]?.sets[0]?.targetRpe ?? 0;
    expect(week4Rpe).toBeGreaterThanOrEqual(8);
    expect(week4Rpe).toBeLessThanOrEqual(9);
  });
});
