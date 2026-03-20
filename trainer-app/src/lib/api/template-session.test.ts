/**
 * Protects: Intent generation is intent-aligned (push/pull/legs/upper/lower/full_body/body_part(targetMuscles)) with diagnostics.
 * Why it matters: Intent outputs drive workout quality, so alignment and diagnostics must stay stable across refactors.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exampleExerciseLibrary, exampleGoals, exampleUser } from "../engine/sample-data";
import * as selectionV2 from "@/lib/engine/selection-v2";
import type { Exercise } from "@/lib/engine/types";

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
const loadGenerationPhaseBlockContextMock = vi.fn();

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

vi.mock("@/lib/api/generation-phase-block-context", () => ({
  loadGenerationPhaseBlockContext: (...args: unknown[]) =>
    loadGenerationPhaseBlockContextMock(...args),
  resolveGenerationPhaseBlockContext: (...args: unknown[]) =>
    loadGenerationPhaseBlockContextMock(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api/mesocycle-lifecycle")>();
  return {
    ...original,
    loadActiveMesocycle: (...args: unknown[]) => loadActiveMesocycleMock(...args),
    getCurrentMesoWeek: (...args: unknown[]) => getCurrentMesoWeekMock(...args),
    getRirTarget: (...args: unknown[]) => getRirTargetMock(...args),
    getWeeklyVolumeTarget: (...args: unknown[]) => getWeeklyVolumeTargetMock(...args),
  };
});

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
    loadGenerationPhaseBlockContextMock.mockResolvedValue({
      blockContext: {
        block: {
          id: "block-1",
          mesocycleId: "meso-1",
          blockNumber: 1,
          blockType: "accumulation",
          startWeek: 0,
          durationWeeks: 2,
          volumeTarget: "high",
          intensityBias: "hypertrophy",
          adaptationType: "myofibrillar_hypertrophy",
        },
        weekInBlock: 2,
        weekInMeso: 2,
        weekInMacro: 2,
        mesocycle: {
          id: "meso-1",
          macroCycleId: "macro-1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Hypertrophy",
          volumeTarget: "high",
          intensityBias: "hypertrophy",
          blocks: [],
        },
        macroCycle: {
          id: "macro-1",
          userId: "user-1",
          startDate: new Date("2026-03-01T00:00:00.000Z"),
          endDate: new Date("2026-04-05T00:00:00.000Z"),
          durationWeeks: 5,
          trainingAge: "intermediate",
          primaryGoal: "hypertrophy",
          mesocycles: [],
        },
      },
      profile: {
        blockType: "accumulation",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      },
      cycleContext: {
        weekInMeso: 2,
        weekInBlock: 2,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      weekInMeso: 2,
      weekInBlock: 2,
      mesocycleLength: 5,
    });
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
      expect(result.selection.intentDiagnostics?.alignedRatio).toBeGreaterThan(0);
      expect(result.selection.intentDiagnostics?.minAlignedRatio).toBe(0);
      expect(result.selection.selectedExerciseIds.length).toBeGreaterThan(0);
    }
  );

  it("uses persisted slotPlanSeedJson only for seeded next-slot composition", async () => {
    loadWorkoutContextMock.mockResolvedValue({
      profile: { id: "profile" },
      goals: { primaryGoal: "HYPERTROPHY", secondaryGoal: "NONE" },
      constraints: {
        daysPerWeek: 4,
        splitType: "UPPER_LOWER",
        weeklySchedule: ["UPPER", "LOWER", "UPPER", "LOWER"],
      },
      injuries: [],
      exercises: [
        { id: "bench" },
        { id: "row" },
        { id: "incline-db-press" },
        { id: "lat-pulldown" },
      ],
      workouts: [
        {
          id: "w-upper-a",
          scheduledDate: new Date("2026-03-08T00:00:00.000Z"),
          status: "COMPLETED",
          advancesSplit: true,
          selectionMode: "INTENT",
          sessionIntent: "UPPER",
          forcedSplit: null,
          templateId: null,
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              sessionSlot: {
                slotId: "upper_a",
                intent: "upper",
                sequenceIndex: 0,
                source: "mesocycle_slot_sequence",
              },
            },
          },
          mesocycleId: "meso-1",
          mesocycleWeekSnapshot: 3,
          mesoSessionSnapshot: 1,
          mesocyclePhaseSnapshot: "ACCUMULATION",
          exercises: [],
        },
        {
          id: "w-lower-a",
          scheduledDate: new Date("2026-03-09T00:00:00.000Z"),
          status: "COMPLETED",
          advancesSplit: true,
          selectionMode: "INTENT",
          sessionIntent: "LOWER",
          forcedSplit: null,
          templateId: null,
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              sessionSlot: {
                slotId: "lower_a",
                intent: "lower",
                sequenceIndex: 1,
                source: "mesocycle_slot_sequence",
              },
            },
          },
          mesocycleId: "meso-1",
          mesocycleWeekSnapshot: 3,
          mesoSessionSnapshot: 2,
          mesocyclePhaseSnapshot: "ACCUMULATION",
          exercises: [],
        },
      ],
      preferences: null,
      checkIns: [],
    });
    mapConstraintsMock.mockReturnValue({
      daysPerWeek: 4,
      splitType: "upper_lower",
      weeklySchedule: ["upper", "lower", "upper", "lower"],
    });
    mapExercisesMock.mockReturnValue([
      {
        id: "bench",
        name: "Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["upper"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
        sfrScore: 4,
        lengthPositionScore: 3,
      },
      {
        id: "row",
        name: "Chest Supported Row",
        movementPatterns: ["horizontal_pull"],
        splitTags: ["upper"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["machine"],
        primaryMuscles: ["Upper Back"],
        secondaryMuscles: ["Biceps"],
        sfrScore: 4,
        lengthPositionScore: 3,
      },
      {
        id: "incline-db-press",
        name: "Incline Dumbbell Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["upper"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["dumbbell"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Front Delts", "Triceps"],
        sfrScore: 4,
        lengthPositionScore: 4,
      },
      {
        id: "lat-pulldown",
        name: "Lat Pulldown",
        movementPatterns: ["vertical_pull"],
        splitTags: ["upper"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["cable"],
        primaryMuscles: ["Lats"],
        secondaryMuscles: ["Biceps"],
        sfrScore: 4,
        lengthPositionScore: 3,
      },
    ]);
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 10,
      deloadSessionsCompleted: 0,
      durationWeeks: 5,
      sessionsPerWeek: 4,
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
          { slotId: "upper_b", intent: "UPPER" },
          { slotId: "lower_b", intent: "LOWER" },
        ],
      },
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              { exerciseId: "bench", role: "CORE_COMPOUND" },
              { exerciseId: "row", role: "ACCESSORY" },
            ],
          },
          {
            slotId: "lower_a",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
          },
          {
            slotId: "upper_b",
            exercises: [
              { exerciseId: "incline-db-press", role: "CORE_COMPOUND" },
              { exerciseId: "lat-pulldown", role: "ACCESSORY" },
            ],
          },
          {
            slotId: "lower_b",
            exercises: [{ exerciseId: "row", role: "CORE_COMPOUND" }],
          },
        ],
      },
    });
    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "bench", role: "CORE_COMPOUND", sessionIntent: "UPPER" },
      { exerciseId: "row", role: "ACCESSORY", sessionIntent: "UPPER" },
    ]);

    const selectSpy = vi.spyOn(selectionV2, "selectExercisesOptimized");
    try {
      const result = await generateSessionFromIntent("user-1", { intent: "upper" });

      expect("error" in result).toBe(false);
      if ("error" in result) return;

      expect(selectSpy).not.toHaveBeenCalled();
      expect(result.selection.selectedExerciseIds).toEqual([
        "incline-db-press",
        "lat-pulldown",
      ]);
      expect(result.workout.mainLifts.map((entry) => entry.exercise.id)).toEqual([
        "incline-db-press",
      ]);
      expect(result.workout.accessories.map((entry) => entry.exercise.id)).toEqual([
        "lat-pulldown",
      ]);
      expect(result.selection.sessionDecisionReceipt).toBeDefined();
      expect(result.audit?.progressionTraces).toBeDefined();
    } finally {
      selectSpy.mockRestore();
    }
  });

  it("requires targetMuscles for body_part intent", async () => {
    const result = await generateSessionFromIntent("user-1", { intent: "body_part" });

    expect(result).toEqual({ error: "targetMuscles is required when intent is body_part" });
  });

  it("keeps body_part generation on the legacy fallback path even when the mesocycle is seeded", async () => {
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      durationWeeks: 5,
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "push_a",
            exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND" }],
          },
        ],
      },
    });

    const selectSpy = vi.spyOn(selectionV2, "selectExercisesOptimized");
    try {
      const result = await generateSessionFromIntent("user-1", {
        intent: "body_part",
        targetMuscles: ["Chest"],
      });

      expect("error" in result).toBe(false);
      if ("error" in result) return;

      expect(selectSpy).toHaveBeenCalled();
      expect(result.selection.intentDiagnostics?.intent).toBe("body_part");
    } finally {
      selectSpy.mockRestore();
    }
  });

  it("keeps unseeded mesocycles on the legacy intent-selection path", async () => {
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      durationWeeks: 5,
      slotPlanSeedJson: null,
    });

    const selectSpy = vi.spyOn(selectionV2, "selectExercisesOptimized");
    try {
      const result = await generateSessionFromIntent("user-1", { intent: "push" });

      expect("error" in result).toBe(false);
      if ("error" in result) return;

      expect(selectSpy).toHaveBeenCalled();
      expect(result.selection.intentDiagnostics?.intent).toBe("push");
    } finally {
      selectSpy.mockRestore();
    }
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
    expect(result.selection.intentDiagnostics?.alignedRatio).toBeGreaterThan(0);
    expect(result.selection.intentDiagnostics?.minAlignedRatio).toBe(0);
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
    loadGenerationPhaseBlockContextMock.mockResolvedValueOnce({
      blockContext: {
        block: {
          id: "block-3",
          mesocycleId: "meso-1",
          blockNumber: 3,
          blockType: "deload",
          startWeek: 4,
          durationWeeks: 1,
          volumeTarget: "low",
          intensityBias: "hypertrophy",
          adaptationType: "recovery",
        },
        weekInBlock: 1,
        weekInMeso: 5,
        weekInMacro: 5,
        mesocycle: {
          id: "meso-1",
          macroCycleId: "macro-1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Hypertrophy",
          volumeTarget: "high",
          intensityBias: "hypertrophy",
          blocks: [],
        },
        macroCycle: {
          id: "macro-1",
          userId: "user-1",
          startDate: new Date("2026-03-01T00:00:00.000Z"),
          endDate: new Date("2026-04-05T00:00:00.000Z"),
          durationWeeks: 5,
          trainingAge: "intermediate",
          primaryGoal: "hypertrophy",
          mesocycles: [],
        },
      },
      profile: {
        blockType: "deload",
        weekInBlock: 1,
        blockDurationWeeks: 1,
        isDeload: true,
      },
      cycleContext: {
        weekInMeso: 5,
        weekInBlock: 1,
        mesocycleLength: 5,
        phase: "deload",
        blockType: "deload",
        isDeload: true,
        source: "computed",
      },
      weekInMeso: 5,
      weekInBlock: 1,
      mesocycleLength: 5,
    });

    const result = await generateSessionFromIntent("user-1", { intent: "push" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.sessionDecisionReceipt?.deloadDecision.mode).toBe("scheduled");
    expect(result.selection.sessionDecisionReceipt?.deloadDecision.reductionPercent).toBe(50);
    expect(result.selection.sessionDecisionReceipt?.deloadDecision.appliedTo).toBe("both");
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

  it("prescribes week-3 pull work at 8-9 RPE in a 5-week hypertrophy mesocycle", async () => {
    loadActiveMesocycleMock.mockResolvedValue({
      id: "meso-1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 6,
      durationWeeks: 5,
    });
    getCurrentMesoWeekMock.mockReturnValue(3);
    getRirTargetMock.mockReturnValue({ min: 1, max: 2 });

    const result = await generateSessionFromIntent("user-1", { intent: "pull" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const allSets = [...result.workout.mainLifts, ...result.workout.accessories].flatMap((exercise) => exercise.sets);
    const rpes = allSets.map((set) => set.targetRpe).filter((rpe): rpe is number => rpe != null);
    expect(rpes.length).toBeGreaterThan(0);
    for (const rpe of rpes) {
      expect(rpe).toBeGreaterThanOrEqual(8);
      expect(rpe).toBeLessThanOrEqual(9);
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

  it("keeps W4 role continuity at the prior performed floor when the weekly deficit is closable later", async () => {
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
    expect(quadTotal).toBe(3);
    expect(quadTotal).toBeLessThanOrEqual(5);
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

  it("treats complete role lists as anchors and still supplements from opportunity inventory when deficits remain", async () => {
    const customLibrary: Exercise[] = [
      {
        id: "bench",
        name: "Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps", "Front Delts"],
        sfrScore: 4,
        lengthPositionScore: 3,
      },
      {
        id: "pressdown",
        name: "Cable Triceps Pushdown",
        movementPatterns: ["isolation"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["cable"],
        primaryMuscles: ["Triceps"],
        secondaryMuscles: [],
        sfrScore: 4,
        lengthPositionScore: 3,
      },
      {
        id: "cable-fly",
        name: "Cable Fly",
        movementPatterns: ["isolation"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["cable"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: [],
        sfrScore: 4,
        lengthPositionScore: 4,
      },
    ];
    mapExercisesMock.mockReturnValue(customLibrary);
    mesocycleRoleFindManyMock.mockResolvedValue([
      { exerciseId: "bench", role: "CORE_COMPOUND", sessionIntent: "PUSH" },
      { exerciseId: "pressdown", role: "ACCESSORY", sessionIntent: "PUSH" },
    ]);

    const selectSpy = vi.spyOn(selectionV2, "selectExercisesOptimized").mockImplementation((pool) => {
      const fly = pool.find((exercise) => exercise.id === "cable-fly");
      if (!fly) {
        throw new Error("Expected cable-fly in supplemental pool");
      }
      return {
        selected: [
          {
            exercise: fly,
            proposedSets: 3,
            volumeContribution: new Map([["Chest", 3]]),
            timeContribution: 8,
            scores: {
              deficitFill: 0.9,
              rotationNovelty: 0.6,
              sfrScore: 0.8,
              lengthenedScore: 0.8,
              movementNovelty: 0.6,
              sraAlignment: 0.7,
              userPreference: 0.5,
            },
            totalScore: 0.82,
          },
        ],
        rejected: [],
        volumeFilled: new Map([["Chest", 3]]),
        volumeDeficit: new Map(),
        timeUsed: 8,
        constraintsSatisfied: true,
        rationale: {
          overallStrategy: "supplement anchors",
          perExercise: new Map([["cable-fly", "fills chest deficit beyond anchor fixtures"]]),
        },
      };
    });

    try {
      const result = await generateSessionFromIntent("user-1", {
        intent: "push",
        plannerDiagnosticsMode: "debug",
      });

      expect("error" in result).toBe(false);
      if ("error" in result) return;

      const diagnostics = result.selection.sessionDecisionReceipt?.plannerDiagnostics;
      expect(selectSpy).toHaveBeenCalledTimes(1);
      expect(result.selection.selectedExerciseIds).toEqual(
        expect.arrayContaining(["bench", "pressdown", "cable-fly"])
      );
      expect(diagnostics?.anchor?.used).toBe(true);
      expect(diagnostics?.anchor?.fixtures.map((fixture) => fixture.exerciseId)).toEqual(
        expect.arrayContaining(["bench", "pressdown"])
      );
      expect(diagnostics?.standard?.used).toBe(false);
      expect(diagnostics?.supplemental?.allowed).toBe(true);
      expect(diagnostics?.supplemental?.used).toBe(true);
      expect(diagnostics?.supplemental?.selectedExerciseIds).toEqual(["cable-fly"]);
      expect(diagnostics?.supplemental?.candidates?.some((candidate) => candidate.exerciseId === "cable-fly")).toBe(true);
      expect(diagnostics?.outcome?.layersUsed).toEqual(
        expect.arrayContaining(["anchor", "supplemental"])
      );
    } finally {
      selectSpy.mockRestore();
    }
  });

  it("uses rescue inventory for optional gap-fill generation when standard body_part inventory has no direct primary matches", async () => {
    const rescueOnlyLibrary = [
      {
        id: "close-grip-bench",
        name: "Close-Grip Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
        primaryMuscles: ["Triceps"],
        secondaryMuscles: ["Chest"],
        stimulusProfile: {
          triceps: 1,
          chest: 0.35,
        },
        sfrScore: 4,
        lengthPositionScore: 3,
      },
      {
        id: "landmine-press",
        name: "Landmine Press",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 3,
        equipment: ["barbell"],
        primaryMuscles: ["Front Delts"],
        secondaryMuscles: ["Chest", "Triceps"],
        stimulusProfile: {
          front_delts: 1,
          chest: 0.35,
          triceps: 0.35,
        },
        sfrScore: 4,
        lengthPositionScore: 3,
      },
      {
        id: "weighted-dip",
        name: "Weighted Dip",
        movementPatterns: ["vertical_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["bodyweight"],
        primaryMuscles: ["Triceps"],
        secondaryMuscles: ["Chest"],
        stimulusProfile: {
          triceps: 1,
          chest: 0.4,
          front_delts: 0.25,
        },
        sfrScore: 4,
        lengthPositionScore: 3,
      },
    ];
    mapExercisesMock.mockReturnValue(rescueOnlyLibrary);
    mesocycleRoleFindManyMock.mockResolvedValue([]);

    const standard = await generateSessionFromIntent("user-1", {
      intent: "body_part",
      targetMuscles: ["Chest"],
    });
    expect(standard).toEqual({ error: "No compatible exercises found for the requested intent" });

    const rescue = await generateSessionFromIntent("user-1", {
      intent: "body_part",
      targetMuscles: ["Chest"],
      optionalGapFill: true,
      plannerDiagnosticsMode: "debug",
    });

    expect("error" in rescue).toBe(false);
    if ("error" in rescue) return;

    const diagnostics = rescue.selection.sessionDecisionReceipt?.plannerDiagnostics;
    expect(rescue.selection.selectedExerciseIds.length).toBeGreaterThan(0);
    expect(rescue.selection.selectedExerciseIds).toEqual(
      expect.arrayContaining(["close-grip-bench", "landmine-press"])
    );
    expect(rescue.selection.intentDiagnostics?.alignedRatio).toBeGreaterThan(0);
    expect(diagnostics?.standard?.used).toBe(false);
    expect(diagnostics?.rescue?.eligible).toBe(true);
    expect(diagnostics?.rescue?.used).toBe(true);
    expect(diagnostics?.rescue?.rescueOnlyExerciseIds).toEqual(
      expect.arrayContaining(["close-grip-bench", "landmine-press", "weighted-dip"])
    );
    expect(diagnostics?.rescue?.selectedExerciseIds).toEqual(
      expect.arrayContaining(["close-grip-bench", "landmine-press"])
    );
    expect(diagnostics?.rescue?.candidates?.length).toBeGreaterThan(0);
    expect(diagnostics?.closure).toBeDefined();
    expect(diagnostics?.outcome?.layersUsed).toContain("rescue");
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

  it("generates smaller accessory-first supplemental body_part sessions", async () => {
    mapExercisesMock.mockReturnValue([
      {
        id: "bench",
        name: "Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
        sfrScore: 3,
        lengthPositionScore: 3,
      },
      {
        id: "cable-fly",
        name: "Cable Fly",
        movementPatterns: ["isolation"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["cable"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: [],
        sfrScore: 4,
        lengthPositionScore: 4,
      },
      {
        id: "machine-press",
        name: "Machine Chest Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: true,
        fatigueCost: 3,
        equipment: ["machine"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
        sfrScore: 4,
        lengthPositionScore: 3,
      },
    ]);

    const result = await generateSessionFromIntent("user-1", {
      intent: "body_part",
      targetMuscles: ["Chest"],
      supplementalPlannerProfile: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    const totalExercises = result.workout.mainLifts.length + result.workout.accessories.length;
    expect(totalExercises).toBeGreaterThanOrEqual(1);
    expect(totalExercises).toBeLessThanOrEqual(3);
    expect(result.workout.mainLifts).toHaveLength(0);
    expect(result.workout.accessories.length).toBeGreaterThan(0);
    for (const exercise of result.workout.accessories) {
      expect(exercise.sets.length).toBeGreaterThanOrEqual(2);
      expect(exercise.sets.length).toBeLessThanOrEqual(3);
    }
  });

  it("keeps supplemental multi-target sessions covering each target muscle", async () => {
    mapExercisesMock.mockReturnValue([
      {
        id: "leg-curl",
        name: "Seated Leg Curl",
        movementPatterns: ["isolation"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Hamstrings"],
        secondaryMuscles: [],
        sfrScore: 4,
        lengthPositionScore: 4,
      },
      {
        id: "leg-extension",
        name: "Leg Extension",
        movementPatterns: ["isolation"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Quads"],
        secondaryMuscles: [],
        sfrScore: 4,
        lengthPositionScore: 2,
      },
      {
        id: "bench",
        name: "Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["push"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
        sfrScore: 3,
        lengthPositionScore: 3,
      },
    ]);

    const result = await generateSessionFromIntent("user-1", {
      intent: "body_part",
      targetMuscles: ["Hamstrings", "Quads"],
      supplementalPlannerProfile: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.selectedExerciseIds).toEqual(
      expect.arrayContaining(["leg-curl", "leg-extension"])
    );
    expect(result.workout.mainLifts).toHaveLength(0);
  });

  it("falls back to compound accessory-style coverage when supplemental accessory coverage is limited", async () => {
    mapExercisesMock.mockReturnValue([
      {
        id: "leg-curl",
        name: "Seated Leg Curl",
        movementPatterns: ["isolation"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Hamstrings"],
        secondaryMuscles: [],
        sfrScore: 4,
        lengthPositionScore: 4,
      },
      {
        id: "hack-squat",
        name: "Hack Squat",
        movementPatterns: ["squat"],
        splitTags: ["legs"],
        jointStress: "medium",
        isMainLiftEligible: false,
        isCompound: true,
        fatigueCost: 3,
        equipment: ["machine"],
        primaryMuscles: ["Quads"],
        secondaryMuscles: ["Glutes"],
        sfrScore: 4,
        lengthPositionScore: 3,
      },
    ]);

    const result = await generateSessionFromIntent("user-1", {
      intent: "body_part",
      targetMuscles: ["Hamstrings", "Quads"],
      supplementalPlannerProfile: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.selection.selectedExerciseIds).toEqual(
      expect.arrayContaining(["leg-curl", "hack-squat"])
    );
    expect(result.workout.mainLifts).toHaveLength(0);
    expect(result.workout.accessories.map((entry) => entry.exercise.id)).toEqual(
      expect.arrayContaining(["hack-squat"])
    );
  });

  it("shrinks supplemental prescriptions when only a small remaining deficit is left", async () => {
    mapExercisesMock.mockReturnValue([
      {
        id: "cable-fly",
        name: "Cable Fly",
        movementPatterns: ["isolation"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["cable"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: [],
        sfrScore: 4,
        lengthPositionScore: 4,
      },
    ]);
    mapHistoryMock.mockReturnValue([]);
    getWeeklyVolumeTargetMock.mockImplementation(() => 1);

    const result = await generateSessionFromIntent("user-1", {
      intent: "body_part",
      targetMuscles: ["Chest"],
      supplementalPlannerProfile: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.workout.mainLifts).toHaveLength(0);
    expect(result.workout.accessories).toHaveLength(1);
    expect(result.workout.accessories[0]?.sets).toHaveLength(1);
  });

  it("keeps the normal supplemental range when the remaining deficit is still meaningful", async () => {
    mapExercisesMock.mockReturnValue([
      {
        id: "cable-fly",
        name: "Cable Fly",
        movementPatterns: ["isolation"],
        splitTags: ["push"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["cable"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: [],
        sfrScore: 4,
        lengthPositionScore: 4,
      },
    ]);
    mapHistoryMock.mockReturnValue([]);

    const result = await generateSessionFromIntent("user-1", {
      intent: "body_part",
      targetMuscles: ["Chest"],
      supplementalPlannerProfile: true,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.workout.accessories).toHaveLength(1);
    expect(result.workout.accessories[0]?.sets.length).toBeGreaterThanOrEqual(2);
    expect(result.workout.accessories[0]?.sets.length).toBeLessThanOrEqual(3);
  });

  it("repairs multi-target supplemental coverage when the base selection misses one target", async () => {
    const customLibrary: Exercise[] = [
      {
        id: "leg-curl",
        name: "Seated Leg Curl",
        movementPatterns: ["isolation"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Hamstrings"],
        secondaryMuscles: [],
        sfrScore: 4,
        lengthPositionScore: 4,
      },
      {
        id: "hip-hinge",
        name: "45 Degree Back Extension",
        movementPatterns: ["hinge"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: true,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Hamstrings"],
        secondaryMuscles: ["Glutes"],
        sfrScore: 4,
        lengthPositionScore: 3,
      },
      {
        id: "leg-extension",
        name: "Leg Extension",
        movementPatterns: ["isolation"],
        splitTags: ["legs"],
        jointStress: "low",
        isMainLiftEligible: false,
        isCompound: false,
        fatigueCost: 2,
        equipment: ["machine"],
        primaryMuscles: ["Quads"],
        secondaryMuscles: [],
        sfrScore: 3,
        lengthPositionScore: 2,
      },
    ];
    mapExercisesMock.mockReturnValue(customLibrary);

    const selectSpy = vi.spyOn(selectionV2, "selectExercisesOptimized").mockReturnValue({
      selected: customLibrary
        .filter((exercise) => exercise.id !== "leg-extension")
        .map((exercise, index) => ({
          exercise,
          proposedSets: 2,
          volumeContribution: new Map([[exercise.primaryMuscles?.[0] ?? "Hamstrings", 2]]),
          timeContribution: 8,
          scores: {
            deficitFill: 0.8 - index * 0.1,
            rotationNovelty: 0.6,
            sfrScore: 0.8,
            lengthenedScore: 0.8,
            movementNovelty: 0.5,
            sraAlignment: 0.8,
            userPreference: 0.5,
          },
          totalScore: 0.8 - index * 0.1,
        })),
      rejected: [],
      volumeFilled: new Map([["Hamstrings", 4]]),
      volumeDeficit: new Map([["Quads", 12]]),
      timeUsed: 16,
      constraintsSatisfied: true,
      rationale: {
        overallStrategy: "test",
        perExercise: new Map([
          ["leg-curl", "test"],
          ["hip-hinge", "test"],
        ]),
      },
    });

    try {
      const result = await generateSessionFromIntent("user-1", {
        intent: "body_part",
        targetMuscles: ["Hamstrings", "Quads"],
        supplementalPlannerProfile: true,
      });

      expect("error" in result).toBe(false);
      if ("error" in result) return;

      expect(result.selection.selectedExerciseIds).toEqual(
        expect.arrayContaining(["leg-extension"])
      );
      expect(
        result.workout.accessories.some((entry) => entry.exercise.id === "leg-extension")
      ).toBe(true);
    } finally {
      selectSpy.mockRestore();
    }
  });
});
