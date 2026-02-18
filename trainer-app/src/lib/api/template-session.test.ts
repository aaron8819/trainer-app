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
const deriveWeekInBlockMock = vi.fn();
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
  deriveWeekInBlock: (...args: unknown[]) => deriveWeekInBlockMock(...args),
  applyLoads: (...args: unknown[]) => applyLoadsMock(...args),
}));

vi.mock("./periodization", () => ({
  loadCurrentBlockContext: (...args: unknown[]) => loadCurrentBlockContextMock(...args),
  deriveWeekInBlock: (...args: unknown[]) => deriveWeekInBlockMock(...args),
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
            movementPattern: "push",
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
      baselines: [],
      exercises: [{ id: bench.id }, { id: dumbbellPress.id }, { id: thirdMainLift.id }],
      workouts: [{ programBlockId: "block-1", programBlock: { id: "block-1", weeks: 4 } }],
      preferences: null,
      checkIns: [],
      checkInCount: 2,
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
    deriveWeekInBlockMock.mockReturnValue(0);
    applyLoadsMock.mockImplementation((workout) => workout);
    loadCurrentBlockContextMock.mockResolvedValue(null);
    loadExerciseExposureMock.mockResolvedValue(new Map());
  });

  it("enforces enhanced MRV caps in the API template-generation path", async () => {
    const result = await generateSessionFromTemplate("user-1", "template-1");

    expect("error" in result).toBe(false);
    if ("error" in result) {
      return;
    }

    expect(deriveWeekInBlockMock).toHaveBeenCalledTimes(1);
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
    expect(result.selection.coldStartStage).toBeDefined();
    expect(result.selection.coldStartProtocolEnabled).toBe(false);
    expect(result.selection.effectiveColdStartStage).toBe(2);
  });

  it("sets coldStartStage=2 only when baselines have repeated completed logged performance", async () => {
    const previousFlag = process.env.USE_INTENT_COLD_START_PROTOCOL;
    process.env.USE_INTENT_COLD_START_PROTOCOL = "true";

    const completedWorkouts = Array.from({ length: 12 }, (_, index) => ({
      id: `w-${index + 1}`,
      status: "COMPLETED",
      programBlockId: "block-1",
      programBlock: { id: "block-1", weeks: 4 },
      exercises: [bench, dumbbellPress, thirdMainLift].map((exercise) => ({
        exerciseId: exercise.id,
        sets: [
          {
            logs: [{ actualLoad: 100 + index, actualReps: 8 }],
          },
        ],
      })),
    }));

    loadWorkoutContextMock.mockResolvedValueOnce({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: { sessionMinutes: 90, daysPerWeek: 4 },
      injuries: [],
      baselines: [
        { exerciseId: bench.id },
        { exerciseId: dumbbellPress.id },
        { exerciseId: thirdMainLift.id },
      ],
      exercises: [
        { id: bench.id, isMainLiftEligible: true },
        { id: dumbbellPress.id, isMainLiftEligible: true },
        { id: thirdMainLift.id, isMainLiftEligible: true },
      ],
      workouts: completedWorkouts,
      preferences: null,
      checkIns: [{ id: "checkin-1" }],
      checkInCount: 3,
    });
    mapHistoryMock.mockReturnValue(
      completedWorkouts.map((entry) => ({
        date: new Date().toISOString(),
        completed: true,
        status: "COMPLETED",
        exercises: [
          {
            exerciseId: bench.id,
            movementPattern: "push",
            primaryMuscles: ["Chest"],
            sets: [{ exerciseId: bench.id, setIndex: 1, reps: 8 }],
          },
        ],
      }))
    );

    try {
      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
        pinnedExerciseIds: ["bench"],
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }
      expect(result.selection.coldStartStage).toBe(2);
      expect(result.selection.coldStartBypass).toBeUndefined();
      expect(result.selection.coldStartProtocolEnabled).toBe(true);
      expect(result.selection.effectiveColdStartStage).toBe(2);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.USE_INTENT_COLD_START_PROTOCOL;
      } else {
        process.env.USE_INTENT_COLD_START_PROTOCOL = previousFlag;
      }
    }
  });

  it("bypasses stage 0 to stage 1 for intermediate users with 3+ weighted main-lift baselines", async () => {
    const previousFlag = process.env.USE_INTENT_COLD_START_PROTOCOL;
    process.env.USE_INTENT_COLD_START_PROTOCOL = "true";
    mapProfileMock.mockReturnValue({
      ...exampleUser,
      trainingAge: "intermediate",
    });
    mapHistoryMock.mockReturnValue([]);
    loadWorkoutContextMock.mockResolvedValueOnce({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: { sessionMinutes: 90, daysPerWeek: 4 },
      injuries: [],
      baselines: [
        { exerciseId: bench.id, workingWeightMin: 185, topSetWeight: null },
        { exerciseId: dumbbellPress.id, workingWeightMin: null, topSetWeight: 70 },
        { exerciseId: thirdMainLift.id, workingWeightMin: 205, topSetWeight: null },
      ],
      exercises: [
        { id: bench.id, isMainLiftEligible: true },
        { id: dumbbellPress.id, isMainLiftEligible: true },
        { id: thirdMainLift.id, isMainLiftEligible: true },
      ],
      workouts: [],
      preferences: null,
      checkIns: [],
      checkInCount: 0,
    });

    try {
      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }

      expect(result.selection.coldStartStage).toBe(1);
      expect(result.selection.coldStartBypass).toBe("baseline_experienced");
      expect(result.selection.coldStartProtocolEnabled).toBe(true);
      expect(result.selection.effectiveColdStartStage).toBe(1);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.USE_INTENT_COLD_START_PROTOCOL;
      } else {
        process.env.USE_INTENT_COLD_START_PROTOCOL = previousFlag;
      }
    }
  });

  it("keeps beginner users in stage 0 even with 3+ weighted main-lift baselines", async () => {
    const previousFlag = process.env.USE_INTENT_COLD_START_PROTOCOL;
    process.env.USE_INTENT_COLD_START_PROTOCOL = "true";
    mapProfileMock.mockReturnValue({
      ...exampleUser,
      trainingAge: "beginner",
    });
    mapHistoryMock.mockReturnValue([]);
    loadWorkoutContextMock.mockResolvedValueOnce({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: { sessionMinutes: 90, daysPerWeek: 4 },
      injuries: [],
      baselines: [
        { exerciseId: bench.id, workingWeightMin: 135, topSetWeight: null },
        { exerciseId: dumbbellPress.id, workingWeightMin: null, topSetWeight: 55 },
        { exerciseId: thirdMainLift.id, workingWeightMin: 155, topSetWeight: null },
      ],
      exercises: [
        { id: bench.id, isMainLiftEligible: true },
        { id: dumbbellPress.id, isMainLiftEligible: true },
        { id: thirdMainLift.id, isMainLiftEligible: true },
      ],
      workouts: [],
      preferences: null,
      checkIns: [],
      checkInCount: 0,
    });

    try {
      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }

      expect(result.selection.coldStartStage).toBe(0);
      expect(result.selection.coldStartBypass).toBeUndefined();
      expect(result.selection.coldStartProtocolEnabled).toBe(true);
      expect(result.selection.effectiveColdStartStage).toBe(0);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.USE_INTENT_COLD_START_PROTOCOL;
      } else {
        process.env.USE_INTENT_COLD_START_PROTOCOL = previousFlag;
      }
    }
  });

  it("keeps intermediate users in stage 0 when fewer than 3 weighted main-lift baselines exist", async () => {
    const previousFlag = process.env.USE_INTENT_COLD_START_PROTOCOL;
    process.env.USE_INTENT_COLD_START_PROTOCOL = "true";
    mapProfileMock.mockReturnValue({
      ...exampleUser,
      trainingAge: "intermediate",
    });
    mapHistoryMock.mockReturnValue([]);
    loadWorkoutContextMock.mockResolvedValueOnce({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: { sessionMinutes: 90, daysPerWeek: 4 },
      injuries: [],
      baselines: [
        { exerciseId: bench.id, workingWeightMin: 185, topSetWeight: null },
        { exerciseId: dumbbellPress.id, workingWeightMin: null, topSetWeight: 70 },
        { exerciseId: thirdMainLift.id, workingWeightMin: null, topSetWeight: null },
      ],
      exercises: [
        { id: bench.id, isMainLiftEligible: true },
        { id: dumbbellPress.id, isMainLiftEligible: true },
        { id: thirdMainLift.id, isMainLiftEligible: true },
      ],
      workouts: [],
      preferences: null,
      checkIns: [],
      checkInCount: 0,
    });

    try {
      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }

      expect(result.selection.coldStartStage).toBe(0);
      expect(result.selection.coldStartBypass).toBeUndefined();
      expect(result.selection.coldStartProtocolEnabled).toBe(true);
      expect(result.selection.effectiveColdStartStage).toBe(0);
    } finally {
      if (previousFlag === undefined) {
        delete process.env.USE_INTENT_COLD_START_PROTOCOL;
      } else {
        process.env.USE_INTENT_COLD_START_PROTOCOL = previousFlag;
      }
    }
  });

  describe("avoid exercises enforcement", () => {
    it("enforces user avoid preferences as hard constraints (never selects avoided exercises)", async () => {
      // Setup: User has explicitly avoided dumbbell press
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

      // Verify avoided exercise is NOT in the selected exercises
      expect(result.selection.selectedExerciseIds).not.toContain(dumbbellPress.id);
      expect(result.workout.mainLifts.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);
      expect(result.workout.accessories.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);
    });

    it("combines pain flags and user avoids into contraindications", async () => {
      // Setup: Expand exercise library to ensure enough alternatives exist
      const allPushExercises = exampleExerciseLibrary.filter((ex) =>
        ex.splitTags.includes("push")
      );
      mapExercisesMock.mockReturnValue(allPushExercises);

      // User has pain flag on bench AND explicitly avoids dumbbell press
      const historyWithPain: WorkoutHistoryEntry[] = [
        {
          date: new Date(Date.now() - 1 * 86400000).toISOString(),
          completed: true,
          status: "COMPLETED",
          exercises: [
            {
              exerciseId: bench.id,
              movementPattern: "push",
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

      // Verify BOTH bench (pain flag) AND dumbbell press (user avoid) are excluded
      expect(result.selection.selectedExerciseIds).not.toContain(bench.id);
      expect(result.selection.selectedExerciseIds).not.toContain(dumbbellPress.id);
      expect(result.workout.mainLifts.map((ex) => ex.exercise.id)).not.toContain(bench.id);
      expect(result.workout.mainLifts.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);
      expect(result.workout.accessories.map((ex) => ex.exercise.id)).not.toContain(bench.id);
      expect(result.workout.accessories.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);

      // Restore original mock for other tests
      mapExercisesMock.mockReturnValue([bench, dumbbellPress, thirdMainLift]);
    });

    it("handles undefined or null preferences gracefully", async () => {
      // Setup: No preferences object (null/undefined)
      mapPreferencesMock.mockReturnValue(undefined);

      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) {
        return;
      }

      // Should still generate workout without errors
      expect(result.selection.selectedExerciseIds.length).toBeGreaterThan(0);
      expect(result.workout.mainLifts.length).toBeGreaterThan(0);
    });

    it("handles empty avoid list gracefully", async () => {
      // Setup: Preferences exist but avoidExerciseIds is empty
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

      // Should still generate workout without errors
      expect(result.selection.selectedExerciseIds.length).toBeGreaterThan(0);
      expect(result.workout.mainLifts.length).toBeGreaterThan(0);
    });

    it("enforces avoid preferences in template mode with auto-fill", async () => {
      // Setup: User has avoided dumbbell press
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

      // Verify avoided exercise is NOT selected during auto-fill
      expect(result.selection.selectedExerciseIds).not.toContain(dumbbellPress.id);
      expect(result.workout.mainLifts.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);
      expect(result.workout.accessories.map((ex) => ex.exercise.id)).not.toContain(dumbbellPress.id);
    });

    it("automatically substitutes avoided exercises with alternatives targeting same muscles", async () => {
      // Setup: Full push exercise library for substitution
      const allPushExercises = exampleExerciseLibrary.filter((ex) =>
        ex.splitTags.includes("push")
      );
      mapExercisesMock.mockReturnValue(allPushExercises);

      // Find a chest exercise to avoid (not bench, since bench is likely a main lift)
      const chestAccessories = allPushExercises.filter(
        (ex) =>
          ex.primaryMuscles.includes("Chest") &&
          ex.id !== bench.id &&
          !ex.isMainLiftEligible
      );

      if (chestAccessories.length === 0) {
        throw new Error("Test setup error: need a chest accessory to avoid");
      }

      const chestExerciseToAvoid = chestAccessories[0];

      // User avoids a specific chest accessory
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

      // Core assertion: Avoided exercise is NOT selected
      expect(result.selection.selectedExerciseIds).not.toContain(chestExerciseToAvoid.id);

      // Verify workout still includes OTHER chest exercises (substitution occurred)
      const selectedExercises = result.selection.selectedExerciseIds
        .map((id) => allPushExercises.find((ex) => ex.id === id))
        .filter((ex): ex is NonNullable<typeof ex> => ex !== undefined);

      const chestExercisesSelected = selectedExercises.filter((ex) =>
        ex.primaryMuscles.includes("Chest")
      );

      // Should have at least one chest exercise (even though we avoided one)
      expect(chestExercisesSelected.length).toBeGreaterThan(0);
      // Should have generated a valid workout
      expect(selectedExercises.length).toBeGreaterThan(0);

      // Verify the avoided exercise is NOT among the chest exercises selected
      expect(chestExercisesSelected.find((ex) => ex.id === chestExerciseToAvoid.id)).toBeUndefined();

      // Restore original mock
      mapExercisesMock.mockReturnValue([bench, dumbbellPress, thirdMainLift]);
    });
  });
});
