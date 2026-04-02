import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mesocycleFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const loadPreloadedGenerationSnapshot = vi.fn();
  const buildMappedGenerationContextFromSnapshot = vi.fn();
  const loadMesocycleWeekMuscleVolume = vi.fn();
  const loadNextWorkoutContext = vi.fn();
  const deriveCurrentMesocycleSession = vi.fn();
  const getWeeklyVolumeTarget = vi.fn();
  const deriveNextRuntimeSlotSession = vi.fn();
  const buildRemainingFutureSlotsFromRuntime = vi.fn();
  const generateSessionFromMappedContext = vi.fn();
  const generateDeloadSessionFromIntentContext = vi.fn();
  const finalizeDeloadSessionResult = vi.fn();
  const getEffectiveStimulusByMuscle = vi.fn();

  return {
    mesocycleFindFirst,
    workoutFindMany,
    loadPreloadedGenerationSnapshot,
    buildMappedGenerationContextFromSnapshot,
    loadMesocycleWeekMuscleVolume,
    loadNextWorkoutContext,
    deriveCurrentMesocycleSession,
    getWeeklyVolumeTarget,
    deriveNextRuntimeSlotSession,
    buildRemainingFutureSlotsFromRuntime,
    generateSessionFromMappedContext,
    generateDeloadSessionFromIntentContext,
    finalizeDeloadSessionResult,
    getEffectiveStimulusByMuscle,
    prisma: {
      mesocycle: {
        findFirst: mesocycleFindFirst,
      },
      workout: {
        findMany: workoutFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("./template-session/context-loader", () => ({
  loadPreloadedGenerationSnapshot: (...args: unknown[]) =>
    mocks.loadPreloadedGenerationSnapshot(...args),
  buildMappedGenerationContextFromSnapshot: (...args: unknown[]) =>
    mocks.buildMappedGenerationContextFromSnapshot(...args),
}));

vi.mock("./weekly-volume", () => ({
  loadMesocycleWeekMuscleVolume: (...args: unknown[]) =>
    mocks.loadMesocycleWeekMuscleVolume(...args),
}));

vi.mock("./next-session", () => ({
  loadNextWorkoutContext: (...args: unknown[]) => mocks.loadNextWorkoutContext(...args),
}));

vi.mock("./mesocycle-lifecycle", () => ({
  deriveCurrentMesocycleSession: (...args: unknown[]) =>
    mocks.deriveCurrentMesocycleSession(...args),
  getWeeklyVolumeTarget: (...args: unknown[]) =>
    mocks.getWeeklyVolumeTarget(...args),
}));

vi.mock("./mesocycle-slot-runtime", () => ({
  deriveNextRuntimeSlotSession: (...args: unknown[]) =>
    mocks.deriveNextRuntimeSlotSession(...args),
  buildRemainingFutureSlotsFromRuntime: (...args: unknown[]) =>
    mocks.buildRemainingFutureSlotsFromRuntime(...args),
}));

vi.mock("./template-session", () => ({
  generateSessionFromMappedContext: (...args: unknown[]) =>
    mocks.generateSessionFromMappedContext(...args),
}));

vi.mock("./template-session/deload-session", () => ({
  generateDeloadSessionFromIntentContext: (...args: unknown[]) =>
    mocks.generateDeloadSessionFromIntentContext(...args),
}));

vi.mock("./template-session/finalize-session", () => ({
  finalizeDeloadSessionResult: (...args: unknown[]) =>
    mocks.finalizeDeloadSessionResult(...args),
}));

vi.mock("@/lib/engine/stimulus", () => ({
  getEffectiveStimulusByMuscle: (...args: unknown[]) =>
    mocks.getEffectiveStimulusByMuscle(...args),
}));

import { loadProjectedWeekVolumeReport } from "./projected-week-volume";

function buildWorkout(exerciseNames: string[]) {
  return {
    id: "workout-projected",
    scheduledDate: "2026-03-24",
    warmup: [],
    mainLifts: exerciseNames.map((name, index) => ({
      id: `we-${name}-${index}`,
      orderIndex: index,
      isMainLift: true,
      exercise: {
        id: name,
        name,
        primaryMuscles: [name],
        secondaryMuscles: [],
      },
      sets: [
        {
          setIndex: 1,
          targetReps: 8,
          targetRpe: 8,
          targetLoad: 100,
        },
      ],
    })),
    accessories: [],
    estimatedMinutes: 45,
  };
}

describe("loadProjectedWeekVolumeReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      startWeek: 0,
      durationWeeks: 5,
      accumulationSessionsCompleted: 2,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      splitType: "upper_lower",
      state: "ACTIVE_ACCUMULATION",
      slotSequenceJson: {
        slots: [
          { slotId: "upper_a", intent: "upper", sequenceIndex: 0 },
          { slotId: "lower_a", intent: "lower", sequenceIndex: 1 },
          { slotId: "upper_b", intent: "upper", sequenceIndex: 2 },
          { slotId: "lower_b", intent: "lower", sequenceIndex: 3 },
        ],
      },
      blocks: [],
      macroCycle: {
        startDate: new Date("2026-03-23T00:00:00.000Z"),
      },
    });
    mocks.workoutFindMany.mockResolvedValue([
      {
        advancesSplit: true,
        selectionMetadata: {
          sessionDecisionReceipt: {
            sessionSlot: {
              slotId: "upper_a",
              intent: "upper",
              sequenceIndex: 0,
              source: "mesocycle_slot_sequence",
            },
          },
        },
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
      },
    ]);
    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({
      activeMesocycle: { id: "meso-1", state: "ACTIVE_ACCUMULATION" },
    });
    mocks.buildMappedGenerationContextFromSnapshot.mockReturnValue({
      mappedConstraints: { weeklySchedule: ["upper", "lower", "upper", "lower"] },
      cycleContext: { phase: "accumulation", blockType: "accumulation" },
      history: [],
      rotationContext: new Map(),
      activeMesocycle: {
        id: "meso-1",
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 2,
      },
    });
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: { directSets: 4, indirectSets: 0, effectiveSets: 4 },
      Quads: { directSets: 3, indirectSets: 0, effectiveSets: 3 },
    });
    mocks.loadNextWorkoutContext.mockResolvedValue({
      source: "existing_incomplete",
      existingWorkoutId: "w-in-progress",
    });
    mocks.deriveCurrentMesocycleSession.mockReturnValue({
      week: 1,
      session: 3,
      phase: "ACCUMULATION",
    });
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => {
        if (muscle === "Chest") return 10;
        if (muscle === "Quads") return 8;
        return 0;
      }
    );
    mocks.deriveNextRuntimeSlotSession.mockReturnValue({
      week: 1,
      session: 3,
      phase: "ACCUMULATION",
      intent: "upper",
      slotId: "upper_b",
      slotSequenceIndex: 2,
      slotSource: "mesocycle_slot_sequence",
    });
    mocks.buildRemainingFutureSlotsFromRuntime.mockReturnValue([
      {
        slotId: "lower_b",
        intent: "lower",
        sequenceIndex: 3,
      },
    ]);
    mocks.generateSessionFromMappedContext
      .mockReturnValueOnce({
        workout: buildWorkout(["Chest"]),
        selection: {},
        selectionMode: "INTENT",
        sessionIntent: "upper",
        sraWarnings: [],
        substitutions: [],
        volumePlanByMuscle: {},
      })
      .mockReturnValueOnce({
        workout: buildWorkout(["Quads"]),
        selection: {},
        selectionMode: "INTENT",
        sessionIntent: "lower",
        sraWarnings: [],
        substitutions: [],
        volumePlanByMuscle: {},
      });
    mocks.generateDeloadSessionFromIntentContext.mockResolvedValue({
      error: "unexpected deload call",
    });
    mocks.getEffectiveStimulusByMuscle.mockImplementation(
      (exercise: { primaryMuscles?: string[] }, setCount: number) =>
        new Map([[exercise.primaryMuscles?.[0] ?? "Unknown", setCount]])
    );
  });

  it("chains remaining slots in runtime order and separates completed vs projected full-week totals", async () => {
    const report = await loadProjectedWeekVolumeReport({
      userId: "user-1",
      plannerDiagnosticsMode: "debug",
    });

    expect(report.currentWeek).toEqual({
      mesocycleId: "meso-1",
      week: 1,
      phase: "accumulation",
      blockType: "accumulation",
    });
    expect(report.projectionNotes).toEqual([
      "Generation-centric projection ignored persisted incomplete workout w-in-progress and projected remaining current-week advancing slots from canonical performed runtime state only.",
    ]);
    expect(report.projectedSessions.map((session) => session.slotId)).toEqual([
      "upper_b",
      "lower_b",
    ]);
    expect(report.projectedSessions.map((session) => session.isNext)).toEqual([
      true,
      false,
    ]);
    expect(mocks.generateSessionFromMappedContext).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({
        intent: "upper",
        slotId: "upper_b",
        plannerDiagnosticsMode: "debug",
      })
    );
    expect(mocks.generateSessionFromMappedContext).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({
        intent: "lower",
        slotId: "lower_b",
        plannerDiagnosticsMode: "debug",
      })
    );

    expect(report.completedVolumeByMuscle).toEqual({
      Chest: { directSets: 4, indirectSets: 0, effectiveSets: 4 },
      Quads: { directSets: 3, indirectSets: 0, effectiveSets: 3 },
    });
    expect(report.projectedSessions).toEqual([
      {
        slotId: "upper_b",
        intent: "upper",
        isNext: true,
        exerciseCount: 1,
        totalSets: 1,
        projectedContributionByMuscle: { Chest: 1 },
      },
      {
        slotId: "lower_b",
        intent: "lower",
        isNext: false,
        exerciseCount: 1,
        totalSets: 1,
        projectedContributionByMuscle: { Quads: 1 },
      },
    ]);

    const chestRow = report.fullWeekByMuscle.find((row) => row.muscle === "Chest");
    const quadsRow = report.fullWeekByMuscle.find((row) => row.muscle === "Quads");

    expect(chestRow).toMatchObject({
      completedEffectiveSets: 4,
      projectedNextSessionEffectiveSets: 1,
      projectedRemainingWeekEffectiveSets: 0,
      projectedFullWeekEffectiveSets: 5,
      weeklyTarget: 10,
      deltaToTarget: -5,
    });
    expect(quadsRow).toMatchObject({
      completedEffectiveSets: 3,
      projectedNextSessionEffectiveSets: 0,
      projectedRemainingWeekEffectiveSets: 1,
      projectedFullWeekEffectiveSets: 4,
      weeklyTarget: 8,
      deltaToTarget: -4,
    });
  });

  it("uses the exposed scope for projection rows so Core absorbs Abs and broader muscles remain visible", async () => {
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Core: { directSets: 2, indirectSets: 0, effectiveSets: 2 },
      "Lower Back": { directSets: 0, indirectSets: 2, effectiveSets: 0.6 },
    });
    mocks.generateSessionFromMappedContext
      .mockReset()
      .mockReturnValueOnce({
        workout: buildWorkout(["Abs"]),
        selection: {},
        selectionMode: "INTENT",
        sessionIntent: "upper",
        sraWarnings: [],
        substitutions: [],
        volumePlanByMuscle: {},
      })
      .mockReturnValueOnce({
        workout: buildWorkout(["Forearms"]),
        selection: {},
        selectionMode: "INTENT",
        sessionIntent: "lower",
        sraWarnings: [],
        substitutions: [],
        volumePlanByMuscle: {},
      });
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => {
        if (muscle === "Core") return 4;
        if (muscle === "Lower Back") return 1;
        return 0;
      }
    );

    const report = await loadProjectedWeekVolumeReport({
      userId: "user-1",
      plannerDiagnosticsMode: "standard",
    });

    expect(report.projectedSessions[0]?.projectedContributionByMuscle).toEqual({ Core: 1 });
    expect(report.fullWeekByMuscle.map((row) => row.muscle)).toEqual(
      expect.arrayContaining(["Core", "Lower Back", "Forearms"])
    );
    expect(report.fullWeekByMuscle.map((row) => row.muscle)).not.toContain("Abs");
    expect(report.fullWeekByMuscle.find((row) => row.muscle === "Core")).toMatchObject({
      completedEffectiveSets: 2,
      projectedNextSessionEffectiveSets: 1,
      projectedFullWeekEffectiveSets: 3,
    });
  });
});
