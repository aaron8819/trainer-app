import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleExerciseLibrary, exampleGoals, exampleUser } from "../engine/sample-data";
import type { WorkoutHistoryEntry } from "../engine/types";

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
      availableEquipment: ["barbell", "dumbbell"],
    });
    mapExercisesMock.mockReturnValue([bench, dumbbellPress, thirdMainLift]);
    mapHistoryMock.mockReturnValue(history);
    mapPreferencesMock.mockReturnValue(undefined);
    mapCheckInMock.mockReturnValue(undefined);
    deriveWeekInBlockMock.mockReturnValue(0);
    applyLoadsMock.mockImplementation((workout) => workout);
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
});
