/**
 * Protects: Selection correctness (constraints + intent alignment behavior).
 * Why it matters: Session generation must never select hard-blocked exercises and must preserve intent-aligned output quality.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleExerciseLibrary, exampleGoals, exampleUser } from "@/lib/engine/sample-data";
import type { Exercise } from "@/lib/engine/types";

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
const loadActiveMesocycleMock = vi.fn();
const loadExerciseExposureMock = vi.fn();
const getCurrentMesoWeekMock = vi.fn();
const getRirTargetMock = vi.fn();
const getWeeklyVolumeTargetMock = vi.fn();

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

vi.mock("@/lib/api/exercise-exposure", () => ({
  loadExerciseExposure: (...args: unknown[]) => loadExerciseExposureMock(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", () => ({
  loadActiveMesocycle: (...args: unknown[]) => loadActiveMesocycleMock(...args),
  getCurrentMesoWeek: (...args: unknown[]) => getCurrentMesoWeekMock(...args),
  getRirTarget: (...args: unknown[]) => getRirTargetMock(...args),
  getWeeklyVolumeTarget: (...args: unknown[]) => getWeeklyVolumeTargetMock(...args),
}));

import { generateSessionFromIntent } from "@/lib/api/template-session";

describe("selection correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();

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
    mapHistoryMock.mockReturnValue([]);
    mapCheckInMock.mockReturnValue(undefined);
    applyLoadsMock.mockImplementation((workout: unknown) => workout);
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 0,
      durationWeeks: 5,
    });
    getCurrentMesoWeekMock.mockReturnValue(1);
    getRirTargetMock.mockReturnValue({ min: 3, max: 4 });
    getWeeklyVolumeTargetMock.mockImplementation(() => 10);
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

  it("prevents duplicate vertical-pull main lifts and preserves horizontal pull coverage", async () => {
    const pullPool: Exercise[] = [
      {
        id: "weighted-pull-up",
        name: "Weighted Pull-Up",
        movementPatterns: ["vertical_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 3,
        lengthPositionScore: 4,
        equipment: ["bodyweight", "dumbbell"],
        primaryMuscles: ["Lats", "Biceps"],
        secondaryMuscles: ["Upper Back", "Forearms"],
      },
      {
        id: "chin-up",
        name: "Chin-Up",
        movementPatterns: ["vertical_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 3,
        sfrScore: 4,
        lengthPositionScore: 4,
        equipment: ["bodyweight"],
        primaryMuscles: ["Lats", "Biceps"],
        secondaryMuscles: ["Upper Back", "Forearms"],
      },
      {
        id: "row",
        name: "Barbell Row",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 2,
        lengthPositionScore: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Lats", "Upper Back"],
        secondaryMuscles: ["Biceps", "Rear Delts", "Forearms"],
      },
      {
        id: "rear-delt-fly",
        name: "Rear Delt Fly",
        movementPatterns: ["horizontal_pull", "isolation"],
        splitTags: ["pull"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 1,
        sfrScore: 5,
        lengthPositionScore: 3,
        equipment: ["cable"],
        primaryMuscles: ["Rear Delts"],
        secondaryMuscles: ["Upper Back"],
      },
      {
        id: "incline-curl",
        name: "Incline Curl",
        movementPatterns: ["isolation"],
        splitTags: ["pull"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 1,
        sfrScore: 5,
        lengthPositionScore: 4,
        equipment: ["dumbbell", "bench"],
        primaryMuscles: ["Biceps"],
        secondaryMuscles: ["Forearms"],
      },
    ];

    mapExercisesMock.mockReturnValue(pullPool);
    mapPreferencesMock.mockReturnValue(undefined);

    const result = await generateSessionFromIntent("user-1", { intent: "pull" });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const selected = new Set(result.selection.selectedExerciseIds);
    expect(selected.has("weighted-pull-up") && selected.has("chin-up")).toBe(false);

    const selectedCompounds = pullPool.filter(
      (exercise) => selected.has(exercise.id) && (exercise.isCompound ?? false)
    );
    if (selectedCompounds.length >= 2) {
      const hasHorizontal = selectedCompounds.some((exercise) =>
        exercise.movementPatterns.includes("horizontal_pull")
      );
      expect(hasHorizontal).toBe(true);
    }
  });

  it("never selects avoided exercises even when they appear in recent performed continuity history", async () => {
    const pullPool: Exercise[] = [
      {
        id: "tbar-row",
        name: "T-Bar Row",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["pull"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 3,
        lengthPositionScore: 3,
        equipment: ["machine"],
        primaryMuscles: ["Upper Back"],
        secondaryMuscles: ["Biceps"],
      },
      {
        id: "cable-pullover",
        name: "Cable Pullover",
        movementPatterns: ["vertical_pull"],
        splitTags: ["pull"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        sfrScore: 4,
        lengthPositionScore: 4,
        equipment: ["cable"],
        primaryMuscles: ["Lats"],
        secondaryMuscles: [],
      },
      {
        id: "face-pull",
        name: "Face Pull",
        movementPatterns: ["isolation"],
        splitTags: ["pull"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        sfrScore: 4,
        lengthPositionScore: 3,
        equipment: ["cable"],
        primaryMuscles: ["Rear Delts"],
        secondaryMuscles: ["Upper Back"],
      },
      {
        id: "cable-curl",
        name: "Cable Curl",
        movementPatterns: ["flexion"],
        splitTags: ["pull"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 1,
        sfrScore: 4,
        lengthPositionScore: 3,
        equipment: ["cable"],
        primaryMuscles: ["Biceps"],
        secondaryMuscles: [],
      },
      {
        id: "bayesian-curl",
        name: "Bayesian Curl",
        movementPatterns: ["flexion"],
        splitTags: ["pull"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 1,
        sfrScore: 5,
        lengthPositionScore: 5,
        equipment: ["cable"],
        primaryMuscles: ["Biceps"],
        secondaryMuscles: [],
      },
    ];

    mapExercisesMock.mockReturnValue(pullPool);
    mapHistoryMock.mockReturnValue([
      {
        date: "2026-02-17T01:40:25.252Z",
        completed: true,
        status: "COMPLETED",
        sessionIntent: "pull",
        exercises: [
          {
            exerciseId: "tbar-row",
            sets: [{ exerciseId: "tbar-row", setIndex: 1, reps: 8, load: 120, rpe: 8 }],
          },
          {
            exerciseId: "cable-pullover",
            sets: [{ exerciseId: "cable-pullover", setIndex: 1, reps: 10, load: 40, rpe: 8 }],
          },
          {
            exerciseId: "face-pull",
            sets: [{ exerciseId: "face-pull", setIndex: 1, reps: 12, load: 40, rpe: 8 }],
          },
          {
            exerciseId: "cable-curl",
            sets: [{ exerciseId: "cable-curl", setIndex: 1, reps: 10, load: 30, rpe: 8 }],
          },
        ],
      },
    ]);
    mapPreferencesMock.mockReturnValue({
      favoriteExerciseIds: [],
      avoidExerciseIds: ["cable-curl"],
    });

    const result = await generateSessionFromIntent("user-1", { intent: "pull" });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.selectedExerciseIds).not.toContain("cable-curl");
    expect(result.selection.selectedExerciseIds).toContain("bayesian-curl");
  });

  it("selects at most one variation when exercises share the same base name", async () => {
    const pushPool: Exercise[] = [
      {
        id: "incline-db",
        name: "Incline Dumbbell Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 4,
        lengthPositionScore: 4,
        equipment: ["dumbbell", "bench"],
        primaryMuscles: ["Chest", "Front Delts", "Triceps"],
        secondaryMuscles: [],
      },
      {
        id: "db-ohp",
        name: "Dumbbell Overhead Press",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        sfrScore: 4,
        lengthPositionScore: 3,
        equipment: ["dumbbell"],
        primaryMuscles: ["Front Delts", "Triceps"],
        secondaryMuscles: ["Chest"],
      },
      {
        id: "dip-chest",
        name: "Dip (Chest Emphasis)",
        movementPatterns: ["horizontal_push", "isolation"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        sfrScore: 4,
        lengthPositionScore: 4,
        equipment: ["bodyweight"],
        primaryMuscles: ["Chest", "Triceps"],
        secondaryMuscles: [],
      },
      {
        id: "dip-triceps",
        name: "Dip (Triceps Emphasis)",
        movementPatterns: ["vertical_push", "isolation"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        sfrScore: 3,
        lengthPositionScore: 3,
        equipment: ["bodyweight"],
        primaryMuscles: ["Triceps", "Chest"],
        secondaryMuscles: [],
      },
      {
        id: "cable-lateral",
        name: "Cable Lateral Raise",
        movementPatterns: ["abduction", "isolation"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 1,
        sfrScore: 5,
        lengthPositionScore: 4,
        equipment: ["cable"],
        primaryMuscles: ["Side Delts"],
        secondaryMuscles: [],
      },
      {
        id: "oh-tri-ext",
        name: "Overhead Cable Triceps Extension",
        movementPatterns: ["extension", "isolation"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 1,
        sfrScore: 5,
        lengthPositionScore: 5,
        equipment: ["cable"],
        primaryMuscles: ["Triceps"],
        secondaryMuscles: [],
      },
    ];

    mapExercisesMock.mockReturnValue(pushPool);
    mapPreferencesMock.mockReturnValue(undefined);

    const result = await generateSessionFromIntent("user-1", { intent: "push" });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const selected = new Set(result.selection.selectedExerciseIds);
    const selectedDips = ["dip-chest", "dip-triceps"].filter((id) => selected.has(id));
    expect(selectedDips.length).toBeLessThanOrEqual(1);
  });
});
