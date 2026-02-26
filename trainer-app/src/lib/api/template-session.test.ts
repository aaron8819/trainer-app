/**
 * Protects: Intent generation is intent-aligned (push/pull/legs/upper/lower/full_body/body_part(targetMuscles)) with diagnostics.
 * Why it matters: Intent outputs drive workout quality, so alignment and diagnostics must stay stable across refactors.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleExerciseLibrary, exampleGoals, exampleUser } from "../engine/sample-data";
import * as selectionV2 from "@/lib/engine/selection-v2";

const mesocycleRoleFindManyMock = vi.fn();
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    mesocycleExerciseRole: {
      findMany: (...args: unknown[]) => mesocycleRoleFindManyMock(...args),
    },
  },
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
    mesocycleRoleFindManyMock.mockResolvedValue([]);
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

  it("caps week-2 auto-generated RPE at 8 for all prescribed exercises", async () => {
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      durationWeeks: 5,
    });
    getCurrentMesoWeekMock.mockReturnValue(2);
    getRirTargetMock.mockReturnValue({ min: 2, max: 3 });

    const result = await generateSessionFromIntent("user-1", { intent: "pull" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const allSets = [...result.workout.mainLifts, ...result.workout.accessories].flatMap((exercise) => exercise.sets);
    const rpes = allSets.map((set) => set.targetRpe).filter((rpe): rpe is number => rpe != null);
    expect(rpes.length).toBeGreaterThan(0);
    for (const rpe of rpes) {
      expect(rpe).toBeLessThanOrEqual(8);
    }
  });

  it("pins CORE_COMPOUND roles for push/pull/legs intents regardless of beam scoring order", async () => {
    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "bench", role: "CORE_COMPOUND", sessionIntent: "PUSH" },
      { exerciseId: "row", role: "CORE_COMPOUND", sessionIntent: "PULL" },
      { exerciseId: "squat", role: "CORE_COMPOUND", sessionIntent: "LEGS" },
      { exerciseId: "lat-pull", role: "ACCESSORY", sessionIntent: "PULL" },
    ]);

    const push = await generateSessionFromIntent("user-1", { intent: "push" });
    const pull = await generateSessionFromIntent("user-1", { intent: "pull" });
    const legs = await generateSessionFromIntent("user-1", { intent: "legs" });

    expect("error" in push).toBe(false);
    expect("error" in pull).toBe(false);
    expect("error" in legs).toBe(false);
    if ("error" in push || "error" in pull || "error" in legs) return;

    expect(push.workout.mainLifts.map((entry) => entry.exercise.id)).toContain("bench");
    expect(pull.workout.mainLifts.map((entry) => entry.exercise.id)).toContain("row");
    expect(legs.workout.mainLifts.map((entry) => entry.exercise.id)).toContain("squat");
    expect(pull.workout.accessories.map((entry) => entry.exercise.id)).toContain("lat-pull");
  });

  it("treats CORE-only carried roles as incomplete and beam-fills accessory slots for a new mesocycle", async () => {
    mapExercisesMock.mockReturnValue([
      ...exampleExerciseLibrary,
      {
        id: "hack-squat",
        name: "Hack Squat",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: true,
        fatigueCost: 2,
        sfrScore: 5,
        lengthPositionScore: 5,
        equipment: ["machine"],
        primaryMuscles: ["Quads"],
        secondaryMuscles: ["Glutes"],
      },
    ]);

    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "squat", role: "CORE_COMPOUND", sessionIntent: "LEGS" },
    ]);
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 0,
      durationWeeks: 5,
    });

    const selectSpy = vi.spyOn(selectionV2, "selectExercisesOptimized").mockImplementation((pool) => {
      const byId = new Map(pool.map((exercise) => [exercise.id, exercise]));
      const toCandidate = (id: string, score: number) => {
        const exercise = byId.get(id);
        if (!exercise) {
          throw new Error(`Missing mocked exercise: ${id}`);
        }
        return {
          exercise,
          proposedSets: 3,
          volumeContribution: new Map(),
          timeContribution: 8,
          scores: {
            deficitFill: 0.9,
            rotationNovelty: 0.8,
            sfrScore: 0.9,
            lengthenedScore: 0.9,
            movementNovelty: 0.4,
            sraAlignment: 0.8,
            userPreference: 0.5,
          },
          totalScore: score,
        };
      };

      const selected = [
        toCandidate("hack-squat", 1.0),
        toCandidate("leg-press", 0.9),
        toCandidate("split-squat", 0.8),
      ];

      return {
        selected,
        rejected: [],
        volumeFilled: new Map(),
        volumeDeficit: new Map(),
        timeUsed: selected.reduce((sum, candidate) => sum + candidate.timeContribution, 0),
        constraintsSatisfied: true,
        rationale: {
          overallStrategy: "test",
          perExercise: new Map(selected.map((candidate) => [candidate.exercise.id, "test"])),
        },
      };
    });

    try {
      const result = await generateSessionFromIntent("user-1", { intent: "legs" });

        expect("error" in result).toBe(false);
        if ("error" in result) return;

        expect(result.workout.mainLifts.map((entry) => entry.exercise.id)).toEqual(["squat"]);
        expect(result.workout.accessories.length).toBeGreaterThan(0);
        expect(result.workout.accessories.map((entry) => entry.exercise.id)).toEqual(
          expect.arrayContaining(["hack-squat"])
        );
        expect(result.selection.mainLiftIds).toEqual(["squat"]);
        expect(selectSpy).toHaveBeenCalledTimes(1);
      } finally {
        selectSpy.mockRestore();
      }
  });

  it("preserves two main lifts for PULL intent when two CORE_COMPOUND roles are registered", async () => {
    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "row", role: "CORE_COMPOUND", sessionIntent: "PULL" },
      { exerciseId: "lat-pull", role: "CORE_COMPOUND", sessionIntent: "PULL" },
    ]);

    const result = await generateSessionFromIntent("user-1", { intent: "pull" });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const mainLiftIds = result.workout.mainLifts.map((entry) => entry.exercise.id);
    expect(mainLiftIds).toHaveLength(2);
    expect(mainLiftIds).toContain("row");
    expect(mainLiftIds).toContain("lat-pull");
  });

  it("uses exactly registered LEGS roles with no non-role additions and preserves role set targets", async () => {
    mapExercisesMock.mockReturnValue([
      ...exampleExerciseLibrary,
      {
        id: "seated-leg-curl",
        name: "Seated Leg Curl",
        movementPatterns: ["knee_flexion"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        fatigueCost: 2,
        sfrScore: 4,
        lengthPositionScore: 4,
        equipment: ["machine"],
        primaryMuscles: ["Hamstrings"],
        secondaryMuscles: ["Calves"],
      },
    ]);

    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "squat", role: "CORE_COMPOUND", sessionIntent: "LEGS" },
      { exerciseId: "rdl", role: "ACCESSORY", sessionIntent: "LEGS" },
      { exerciseId: "seated-leg-curl", role: "ACCESSORY", sessionIntent: "LEGS" },
    ]);

    const result = await generateSessionFromIntent("user-1", { intent: "legs" });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const allIds = [...result.workout.mainLifts, ...result.workout.accessories]
      .map((entry) => entry.exercise.id)
      .sort();
    expect(allIds).toEqual(["rdl", "seated-leg-curl", "squat"]);

    expect(result.selection.selectedExerciseIds.sort()).toEqual(["rdl", "seated-leg-curl", "squat"]);
    expect(result.workout.mainLifts.map((entry) => entry.exercise.id)).toEqual(["squat"]);
    expect(result.workout.accessories.map((entry) => entry.exercise.id).sort()).toEqual([
      "rdl",
      "seated-leg-curl",
    ]);

    const setCountById = new Map(
      [...result.workout.mainLifts, ...result.workout.accessories].map((entry) => [
        entry.exercise.id,
        entry.sets.length,
      ])
    );
    expect(setCountById.get("squat")).toBe(5);
    expect(setCountById.get("rdl")).toBe(3);
    expect(setCountById.get("seated-leg-curl")).toBe(5);
    expect(result.selection.perExerciseSetTargets["squat"]).toBe(5);
    expect(result.selection.perExerciseSetTargets["rdl"]).toBe(3);
    expect(result.selection.perExerciseSetTargets["seated-leg-curl"]).toBe(5);
  });

  it("keeps W2 accumulation role exercise sets at or above W1 performed sets", async () => {
    mapHistoryMock.mockReturnValue([
      {
        date: "2026-02-18T00:00:00.000Z",
        completed: true,
        status: "COMPLETED",
        selectionMode: "MANUAL",
        sessionIntent: "legs",
        exercises: [
          {
            exerciseId: "squat",
            sets: Array.from({ length: 4 }, (_, idx) => ({
              exerciseId: "squat",
              setIndex: idx + 1,
              reps: 6,
              rpe: 8,
              load: 225,
            })),
          },
          {
            exerciseId: "leg-press",
            sets: Array.from({ length: 3 }, (_, idx) => ({
              exerciseId: "leg-press",
              setIndex: idx + 1,
              reps: 10,
              rpe: 8,
              load: 360,
            })),
          },
        ],
      },
    ]);
    getCurrentMesoWeekMock.mockReturnValue(2);
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      durationWeeks: 5,
    });

    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "squat", role: "CORE_COMPOUND", sessionIntent: "LEGS" },
      { exerciseId: "leg-press", role: "ACCESSORY", sessionIntent: "LEGS" },
    ]);

    const result = await generateSessionFromIntent("user-1", { intent: "legs" });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const setCountById = new Map(
      [...result.workout.mainLifts, ...result.workout.accessories].map((entry) => [
        entry.exercise.id,
        entry.sets.length,
      ])
    );
    expect(setCountById.get("squat") ?? 0).toBeGreaterThanOrEqual(4);
    expect(setCountById.get("leg-press") ?? 0).toBeGreaterThanOrEqual(3);
    expect(result.selection.perExerciseSetTargets["squat"]).toBeGreaterThanOrEqual(4);
    expect(result.selection.perExerciseSetTargets["leg-press"]).toBeGreaterThanOrEqual(3);
  });

  it("clamps W4 role continuity progression to weekly target unless prior-floor hold is required", async () => {
    mapHistoryMock.mockReturnValue([
      {
        date: "2026-02-18T00:00:00.000Z",
        completed: true,
        status: "COMPLETED",
        selectionMode: "INTENT",
        sessionIntent: "legs",
        exercises: [
          {
            exerciseId: "squat",
            sets: Array.from({ length: 2 }, (_, idx) => ({
              exerciseId: "squat",
              setIndex: idx + 1,
              reps: 8,
              rpe: 8,
              load: 225,
            })),
          },
          {
            exerciseId: "leg-press",
            sets: Array.from({ length: 1 }, (_, idx) => ({
              exerciseId: "leg-press",
              setIndex: idx + 1,
              reps: 12,
              rpe: 8,
              load: 315,
            })),
          },
        ],
      },
    ]);
    getCurrentMesoWeekMock.mockReturnValue(4);
    getWeeklyVolumeTargetMock.mockImplementation(() => 5);
    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "squat", role: "CORE_COMPOUND", sessionIntent: "LEGS" },
      { exerciseId: "leg-press", role: "ACCESSORY", sessionIntent: "LEGS" },
    ]);

    const result = await generateSessionFromIntent("user-1", { intent: "legs" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const quadTotal =
      (result.selection.perExerciseSetTargets["squat"] ?? 0) +
      (result.selection.perExerciseSetTargets["leg-press"] ?? 0);
    expect(quadTotal).toBe(6);
    expect(quadTotal).toBeLessThanOrEqual(6);
  });

  it("never reduces W4 role continuity targets below W3 performed counts", async () => {
    mapHistoryMock.mockReturnValue([
      {
        date: "2026-02-18T00:00:00.000Z",
        completed: true,
        status: "COMPLETED",
        selectionMode: "INTENT",
        sessionIntent: "legs",
        exercises: [
          {
            exerciseId: "squat",
            sets: Array.from({ length: 4 }, (_, idx) => ({
              exerciseId: "squat",
              setIndex: idx + 1,
              reps: 6,
              rpe: 8,
              load: 245,
            })),
          },
          {
            exerciseId: "leg-press",
            sets: Array.from({ length: 2 }, (_, idx) => ({
              exerciseId: "leg-press",
              setIndex: idx + 1,
              reps: 10,
              rpe: 8,
              load: 360,
            })),
          },
        ],
      },
    ]);
    getCurrentMesoWeekMock.mockReturnValue(4);
    getWeeklyVolumeTargetMock.mockImplementation((_meso: unknown, muscle: string) =>
      muscle === "Quads" ? 6 : 12
    );
    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "squat", role: "CORE_COMPOUND", sessionIntent: "LEGS" },
      { exerciseId: "leg-press", role: "ACCESSORY", sessionIntent: "LEGS" },
    ]);

    const result = await generateSessionFromIntent("user-1", { intent: "legs" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.perExerciseSetTargets["squat"]).toBeGreaterThanOrEqual(4);
    expect(result.selection.perExerciseSetTargets["leg-press"]).toBeGreaterThanOrEqual(2);
  });

  it("ignores client roleListIncomplete=false when server derives role list as incomplete", async () => {
    mapExercisesMock.mockReturnValue([
      ...exampleExerciseLibrary,
      {
        id: "hack-squat",
        name: "Hack Squat",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: true,
        fatigueCost: 2,
        sfrScore: 5,
        lengthPositionScore: 5,
        equipment: ["machine"],
        primaryMuscles: ["Quads"],
        secondaryMuscles: ["Glutes"],
      },
    ]);
    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "squat", role: "CORE_COMPOUND", sessionIntent: "LEGS" },
    ]);

    const selectSpy = vi.spyOn(selectionV2, "selectExercisesOptimized");
    try {
      const result = await generateSessionFromIntent("user-1", {
        intent: "legs",
        roleListIncomplete: false as never,
      });
      expect("error" in result).toBe(false);
      if ("error" in result) return;
      expect(selectSpy).toHaveBeenCalledTimes(1);
      expect(result.workout.accessories.length).toBeGreaterThan(0);
    } finally {
      selectSpy.mockRestore();
    }
  });

  it("respects client roleListIncomplete=true even when server role list is complete", async () => {
    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "squat", role: "CORE_COMPOUND", sessionIntent: "LEGS" },
      { exerciseId: "leg-press", role: "ACCESSORY", sessionIntent: "LEGS" },
    ]);
    const selectSpy = vi.spyOn(selectionV2, "selectExercisesOptimized");
    try {
      const result = await generateSessionFromIntent("user-1", {
        intent: "legs",
        roleListIncomplete: true,
      });
      expect("error" in result).toBe(false);
      if ("error" in result) return;
      expect(selectSpy).toHaveBeenCalledTimes(1);
      expect(result.selection.selectedExerciseIds.length).toBeGreaterThan(2);
    } finally {
      selectSpy.mockRestore();
    }
  });
});
