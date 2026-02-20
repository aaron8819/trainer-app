import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleExerciseLibrary, exampleGoals, exampleUser } from "../engine/sample-data";
import type { WorkoutHistoryEntry } from "../engine/types";

// Mock Prisma client to avoid DATABASE_URL requirement
vi.mock("@/lib/db/prisma", () => ({
  prisma: {},
}));

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

import { generateSessionFromIntent, generateSessionFromTemplate } from "./template-session";

const bench = exampleExerciseLibrary.find((exercise) => exercise.id === "bench");
const dumbbellPress = exampleExerciseLibrary.find((exercise) => exercise.id === "db-press");
const thirdMainLift = exampleExerciseLibrary.find(
  (exercise) =>
    exercise.isMainLiftEligible &&
    exercise.id !== bench?.id &&
    exercise.id !== dumbbellPress?.id
);

if (!bench || !dumbbellPress || !thirdMainLift) {
  throw new Error("Expected sample main-lift exercises for tests");
}

describe("generateSessionFromTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    loadTemplateDetailMock.mockResolvedValue({
      id: "template-1",
      name: "Push Day",
      targetMuscles: ["Chest"],
      isStrict: true,
      intent: "PUSH_PULL_LEGS",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      exercises: [
        { exerciseId: bench.id, orderIndex: 0, supersetGroup: null },
        { exerciseId: dumbbellPress.id, orderIndex: 1, supersetGroup: null },
      ],
    });

    const history: WorkoutHistoryEntry[] = [
      {
        date: new Date(Date.now() - 1 * 86400000).toISOString(),
        completed: true,
        status: "COMPLETED",
        exercises: [
          {
            exerciseId: bench.id,

            primaryMuscles: ["Chest", "Triceps"],
            sets: Array.from({ length: 20 }, (_, index) => ({
              exerciseId: bench.id,
              setIndex: index + 1,
              reps: 8,
            })),
          },
        ],
      },
    ];

    loadWorkoutContextMock.mockResolvedValue({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: { sessionMinutes: 90, daysPerWeek: 4 },
      injuries: [],
      exercises: [{ id: bench.id }, { id: dumbbellPress.id }, { id: thirdMainLift.id }],
      workouts: [],
      preferences: null,
      checkIns: [],
    });

    mapProfileMock.mockReturnValue(exampleUser);
    mapGoalsMock.mockReturnValue(exampleGoals);
    mapConstraintsMock.mockReturnValue({
      daysPerWeek: 4,
      sessionMinutes: 90,
      splitType: "upper_lower",
    });
    mapExercisesMock.mockReturnValue([bench, dumbbellPress, thirdMainLift]);
    mapHistoryMock.mockReturnValue(history);
    mapPreferencesMock.mockReturnValue(undefined);
    mapCheckInMock.mockReturnValue(undefined);
    applyLoadsMock.mockImplementation((workout: unknown) => workout);
    loadCurrentBlockContextMock.mockResolvedValue({ blockContext: null, weekInMeso: 1 });
    loadExerciseExposureMock.mockResolvedValue(new Map());
  });

  it("enforces enhanced MRV caps in the API template-generation path", async () => {
    const result = await generateSessionFromTemplate("user-1", "template-1");

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(result.workout.mainLifts.map((entry) => entry.exercise.id)).toEqual(["bench"]);
    expect(result.workout.accessories.map((entry) => entry.exercise.id)).not.toContain("db-press");
    expect(result.volumePlanByMuscle.Chest).toBeDefined();
  });

  it("supports template auto-fill inputs and returns selection metadata", async () => {
    const result = await generateSessionFromTemplate("user-1", "template-1", {
      autoFillUnpinned: true,
      pinnedExerciseIds: ["bench"],
    });

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(result.sessionIntent).toBe("push");
    expect(result.selection.selectedExerciseIds.length).toBeGreaterThan(0);
    expect(result.selection.selectedExerciseIds).toContain("bench");
  });

  it("generates sessions from intent using the shared selector", async () => {
    const result = await generateSessionFromIntent("user-1", {
      intent: "push",
      pinnedExerciseIds: ["bench"],
    });

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(result.sessionIntent).toBe("push");
    expect(result.selection.selectedExerciseIds.length).toBeGreaterThan(0);
    expect(result.selection.selectedExerciseIds).toContain("bench");
    expect(Object.keys(result.selection.perExerciseSetTargets).length).toBeGreaterThan(0);
  });

  it("uses weekInMeso from blockContext as the periodization week", async () => {
    loadCurrentBlockContextMock.mockResolvedValue({ blockContext: null, weekInMeso: 3 });

    const result = await generateSessionFromTemplate("user-1", "template-1");

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(result.selection.periodizationWeek).toBe(3);
  });

  describe("avoid exercises enforcement", () => {
    it("enforces user avoid preferences as hard constraints (never selects avoided exercises)", async () => {
      mapPreferencesMock.mockReturnValue({
        favoriteExerciseIds: [],
        avoidExerciseIds: [dumbbellPress.id],
      });

      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }

      expect(result.selection.selectedExerciseIds).not.toContain(dumbbellPress.id);
      expect(result.workout.mainLifts.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);
      expect(result.workout.accessories.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);
    });

    it("combines pain flags and user avoids into contraindications", async () => {
      const allPushExercises = exampleExerciseLibrary.filter((ex) =>
        ex.splitTags.includes("push")
      );
      mapExercisesMock.mockReturnValue(allPushExercises);

      const historyWithPain: WorkoutHistoryEntry[] = [
        {
          date: new Date(Date.now() - 1 * 86400000).toISOString(),
          completed: true,
          status: "COMPLETED",
          exercises: [
            {
              exerciseId: bench.id,
  
              primaryMuscles: ["Chest", "Triceps"],
              sets: Array.from({ length: 3 }, (_, index) => ({
                exerciseId: bench.id,
                setIndex: index + 1,
                reps: 8,
              })),
            },
          ],
        },
      ];

      mapHistoryMock.mockReturnValue(historyWithPain);
      mapPreferencesMock.mockReturnValue({
        favoriteExerciseIds: [],
        avoidExerciseIds: [dumbbellPress.id],
      });

      // Mock check-in with shoulder pain (bench has contraindications: { shoulder: true })
      mapCheckInMock.mockReturnValue({
        date: new Date().toISOString(),
        painFlags: {
          shoulder: 3, // Body-part key (>= 2) → resolves to exercises with contraindications.shoulder
        },
      });

      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }

      expect(result.selection.selectedExerciseIds).not.toContain(bench.id);
      expect(result.selection.selectedExerciseIds).not.toContain(dumbbellPress.id);
      expect(result.workout.mainLifts.map((ex) => ex.exercise.id)).not.toContain(bench.id);
      expect(result.workout.mainLifts.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);
      expect(result.workout.accessories.map((ex) => ex.exercise.id)).not.toContain(bench.id);
      expect(result.workout.accessories.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);

      mapExercisesMock.mockReturnValue([bench, dumbbellPress, thirdMainLift]);
    });

    it("handles undefined or null preferences gracefully", async () => {
      mapPreferencesMock.mockReturnValue(undefined);

      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }

      expect(result.selection.selectedExerciseIds.length).toBeGreaterThan(0);
      expect(result.workout.mainLifts.length).toBeGreaterThan(0);
    });

    it("handles empty avoid list gracefully", async () => {
      mapPreferencesMock.mockReturnValue({
        favoriteExerciseIds: [bench.id],
        avoidExerciseIds: [],
      });

      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }

      expect(result.selection.selectedExerciseIds.length).toBeGreaterThan(0);
      expect(result.workout.mainLifts.length).toBeGreaterThan(0);
    });

    it("enforces avoid preferences in template mode with auto-fill", async () => {
      mapPreferencesMock.mockReturnValue({
        favoriteExerciseIds: [],
        avoidExerciseIds: [dumbbellPress.id],
      });

      const result = await generateSessionFromTemplate("user-1", "template-1", {
        autoFillUnpinned: true,
        pinnedExerciseIds: [bench.id],
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }

      expect(result.selection.selectedExerciseIds).not.toContain(dumbbellPress.id);
      expect(result.workout.mainLifts.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);
      expect(result.workout.accessories.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);
    });

    it("automatically substitutes avoided exercises with alternatives targeting same muscles", async () => {
      const allPushExercises = exampleExerciseLibrary.filter((ex) =>
        ex.splitTags.includes("push")
      );
      mapExercisesMock.mockReturnValue(allPushExercises);

      const chestAccessories = allPushExercises.filter(
        (ex) =>
          (ex.primaryMuscles?.includes("Chest") ?? false) &&
          ex.id !== bench.id &&
          !ex.isMainLiftEligible
      );

      if (chestAccessories.length === 0) {
        throw new Error("Test setup error: need a chest accessory to avoid");
      }

      const chestExerciseToAvoid = chestAccessories[0];

      mapPreferencesMock.mockReturnValue({
        favoriteExerciseIds: [],
        avoidExerciseIds: [chestExerciseToAvoid.id],
      });

      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }

      expect(result.selection.selectedExerciseIds).not.toContain(chestExerciseToAvoid.id);

      const selectedExercises = result.selection.selectedExerciseIds
        .map((id) => allPushExercises.find((ex) => ex.id === id))
        .filter((ex): ex is NonNullable<typeof ex> => ex !== undefined);

      const chestExercisesSelected = selectedExercises.filter((ex) =>
        ex.primaryMuscles?.includes("Chest") ?? false
      );

      expect(chestExercisesSelected.length).toBeGreaterThan(0);
      expect(selectedExercises.length).toBeGreaterThan(0);
      expect(chestExercisesSelected.find((ex) => ex.id === chestExerciseToAvoid.id)).toBeUndefined();

      mapExercisesMock.mockReturnValue([bench, dumbbellPress, thirdMainLift]);
    });
  });
});
