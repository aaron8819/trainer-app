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

import { generateSessionFromTemplate } from "./template-session";

const bench = exampleExerciseLibrary.find((exercise) => exercise.id === "bench");
const dumbbellPress = exampleExerciseLibrary.find((exercise) => exercise.id === "db-press");

if (!bench || !dumbbellPress) {
  throw new Error("Expected sample exercises bench and db-press");
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
      exercises: [{ id: bench.id }, { id: dumbbellPress.id }],
      workouts: [{ programBlockId: "block-1", programBlock: { id: "block-1", weeks: 4 } }],
      preferences: null,
      checkIns: [],
    });

    mapProfileMock.mockReturnValue(exampleUser);
    mapGoalsMock.mockReturnValue(exampleGoals);
    mapConstraintsMock.mockReturnValue({
      daysPerWeek: 4,
      sessionMinutes: 90,
      splitType: "upper_lower",
      availableEquipment: ["barbell", "dumbbell"],
    });
    mapExercisesMock.mockReturnValue([bench, dumbbellPress]);
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
  });
});
