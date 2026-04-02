import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const loadPreloadedGenerationSnapshot = vi.fn();
  const buildMappedGenerationContextFromSnapshot = vi.fn();
  const generateProjectedSession = vi.fn();
  const computeWorkoutContributionByMuscle = vi.fn();
  const buildProjectedWorkoutHistoryEntry = vi.fn();
  const appendWorkoutHistoryEntryToMappedContext = vi.fn();
  const listWorkoutExerciseNames = vi.fn();
  const loadMesocycleWeekMuscleVolume = vi.fn();
  const deriveNextRuntimeSlotSession = vi.fn();
  const buildRemainingFutureSlotsFromRuntime = vi.fn();
  const buildAdvancingPerformedSlots = vi.fn();
  const getWeeklyVolumeTarget = vi.fn();
  const getWeeklyMuscleStatus = vi.fn();
  const formatWeeklyMuscleStatusLabel = vi.fn();
  const deriveSessionSemantics = vi.fn();
  const getEffectiveStimulusByMuscle = vi.fn();

  return {
    workoutFindFirst,
    workoutFindMany,
    loadPreloadedGenerationSnapshot,
    buildMappedGenerationContextFromSnapshot,
    generateProjectedSession,
    computeWorkoutContributionByMuscle,
    buildProjectedWorkoutHistoryEntry,
    appendWorkoutHistoryEntryToMappedContext,
    listWorkoutExerciseNames,
    loadMesocycleWeekMuscleVolume,
    deriveNextRuntimeSlotSession,
    buildRemainingFutureSlotsFromRuntime,
    buildAdvancingPerformedSlots,
    getWeeklyVolumeTarget,
    getWeeklyMuscleStatus,
    formatWeeklyMuscleStatusLabel,
    deriveSessionSemantics,
    getEffectiveStimulusByMuscle,
    prisma: {
      workout: {
        findFirst: workoutFindFirst,
        findMany: workoutFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("./projected-week-volume-shared", () => ({
  loadPreloadedGenerationSnapshot: (...args: unknown[]) =>
    mocks.loadPreloadedGenerationSnapshot(...args),
  buildMappedGenerationContextFromSnapshot: (...args: unknown[]) =>
    mocks.buildMappedGenerationContextFromSnapshot(...args),
  generateProjectedSession: (...args: unknown[]) =>
    mocks.generateProjectedSession(...args),
  computeWorkoutContributionByMuscle: (...args: unknown[]) =>
    mocks.computeWorkoutContributionByMuscle(...args),
  buildProjectedWorkoutHistoryEntry: (...args: unknown[]) =>
    mocks.buildProjectedWorkoutHistoryEntry(...args),
  appendWorkoutHistoryEntryToMappedContext: (...args: unknown[]) =>
    mocks.appendWorkoutHistoryEntryToMappedContext(...args),
  listWorkoutExerciseNames: (...args: unknown[]) =>
    mocks.listWorkoutExerciseNames(...args),
}));

vi.mock("./weekly-volume", () => ({
  loadMesocycleWeekMuscleVolume: (...args: unknown[]) =>
    mocks.loadMesocycleWeekMuscleVolume(...args),
}));

vi.mock("./mesocycle-slot-runtime", () => ({
  deriveNextRuntimeSlotSession: (...args: unknown[]) =>
    mocks.deriveNextRuntimeSlotSession(...args),
  buildRemainingFutureSlotsFromRuntime: (...args: unknown[]) =>
    mocks.buildRemainingFutureSlotsFromRuntime(...args),
}));

vi.mock("./next-session", () => ({
  buildAdvancingPerformedSlots: (...args: unknown[]) =>
    mocks.buildAdvancingPerformedSlots(...args),
}));

vi.mock("./mesocycle-lifecycle-math", () => ({
  getWeeklyVolumeTarget: (...args: unknown[]) => mocks.getWeeklyVolumeTarget(...args),
}));

vi.mock("@/lib/ui/weekly-muscle-status", () => ({
  getWeeklyMuscleStatus: (...args: unknown[]) => mocks.getWeeklyMuscleStatus(...args),
  formatWeeklyMuscleStatusLabel: (...args: unknown[]) =>
    mocks.formatWeeklyMuscleStatusLabel(...args),
}));

vi.mock("@/lib/session-semantics/derive-session-semantics", () => ({
  deriveSessionSemantics: (...args: unknown[]) => mocks.deriveSessionSemantics(...args),
}));

vi.mock("@/lib/engine/stimulus", () => ({
  getEffectiveStimulusByMuscle: (...args: unknown[]) =>
    mocks.getEffectiveStimulusByMuscle(...args),
}));

import { loadLoggingWeeklyVolumeGuidance } from "./logging-weekly-volume-guidance";

function buildSelectionMetadata(input?: {
  runtimeAddedExerciseIds?: string[];
  runtimeAddedSetIds?: string[];
}) {
  return {
    runtimeEditReconciliation: {
      version: 1,
      lastReconciledAt: "2026-03-26T00:00:00.000Z",
      directives: {
        continuityAlias: "none",
        progressionAlias: "none",
        futureSessionGeneration: "ignore",
        futureSeedCarryForward: "ignore",
      },
      ops: [
        ...(input?.runtimeAddedExerciseIds ?? []).map((workoutExerciseId, index) => ({
          kind: "add_exercise",
          source: "api_workouts_add_exercise",
          appliedAt: "2026-03-26T00:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId,
            exerciseId: `exercise-added-${index}`,
            orderIndex: index,
            section: "ACCESSORY",
            setCount: 1,
          },
        })),
        ...(input?.runtimeAddedSetIds ?? []).map((workoutSetId, index) => ({
          kind: "add_set",
          source: "api_workouts_add_set",
          appliedAt: "2026-03-26T00:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "workout-ex-1",
            exerciseId: "exercise-1",
            workoutSetId,
            setIndex: index + 3,
            clonedFromSetIndex: 2,
          },
        })),
      ],
    },
  };
}

function buildWorkout(options?: {
  status?: "IN_PROGRESS" | "PARTIAL";
  runtimeAddedExerciseIds?: string[];
  runtimeAddedSetIds?: string[];
  exercises?: Array<{
    id: string;
    exerciseId: string;
    name: string;
    primaryMuscle: string;
    setIds: string[];
    loggedSetIds?: string[];
    skippedSetIds?: string[];
  }>;
}): Record<string, unknown> {
  const exercises =
    options?.exercises ??
    [
      {
        id: "workout-ex-1",
        exerciseId: "exercise-1",
        name: "Bench Press",
        primaryMuscle: "Chest",
        setIds: ["set-1", "set-2"],
        loggedSetIds: ["set-1", "set-2"],
      },
    ];

  return {
    id: "workout-1",
    userId: "user-1",
    scheduledDate: new Date("2026-03-26T00:00:00.000Z"),
    status: options?.status ?? "IN_PROGRESS",
    selectionMetadata: buildSelectionMetadata({
      runtimeAddedExerciseIds: options?.runtimeAddedExerciseIds,
      runtimeAddedSetIds: options?.runtimeAddedSetIds,
    }),
    selectionMode: "INTENT",
    sessionIntent: "UPPER",
    advancesSplit: true,
    templateId: "template-1",
    mesocycleId: "meso-1",
    mesocycleWeekSnapshot: 1,
    mesoSessionSnapshot: 2,
    mesocyclePhaseSnapshot: "ACCUMULATION",
    mesocycle: {
      id: "meso-1",
      startWeek: 0,
      durationWeeks: 4,
      accumulationSessionsCompleted: 1,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      state: "ACTIVE_ACCUMULATION",
      slotSequenceJson: {
        slots: [
          { slotId: "upper_a", intent: "upper", sequenceIndex: 0 },
          { slotId: "lower_a", intent: "lower", sequenceIndex: 1 },
          { slotId: "upper_b", intent: "upper", sequenceIndex: 2 },
        ],
      },
      blocks: [],
      macroCycle: {
        startDate: new Date("2026-03-24T00:00:00.000Z"),
      },
    },
    exercises: exercises.map((exercise) => ({
      id: exercise.id,
      orderIndex: 0,
      section: "MAIN",
      exerciseId: exercise.exerciseId,
      exercise: {
        id: exercise.exerciseId,
        name: exercise.name,
        aliases: [],
        exerciseMuscles: [
          {
            role: "PRIMARY",
            muscle: { name: exercise.primaryMuscle },
          },
        ],
      },
      sets: exercise.setIds.map((setId, index) => ({
        id: setId,
        setIndex: index + 1,
        targetReps: 10,
        targetRepMin: 8,
        targetRepMax: 10,
        targetRpe: 8,
        targetLoad: 100,
        restSeconds: 90,
        logs:
          exercise.loggedSetIds?.includes(setId)
            ? [
                {
                  actualReps: 10,
                  actualRpe: 8,
                  actualLoad: 100,
                  wasSkipped: exercise.skippedSetIds?.includes(setId) ?? false,
                },
              ]
            : [],
      })),
    })),
  };
}

describe("loadLoggingWeeklyVolumeGuidance", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.loadPreloadedGenerationSnapshot.mockResolvedValue({
      activeMesocycle: { id: "meso-1" },
    });
    mocks.buildMappedGenerationContextFromSnapshot.mockReturnValue({
      mappedConstraints: { weeklySchedule: ["upper", "lower", "upper"] },
      cycleContext: { phase: "accumulation", blockType: "accumulation" },
      history: [],
      rotationContext: new Map(),
      activeMesocycle: { id: "meso-1", state: "ACTIVE_ACCUMULATION" },
    });
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: { directSets: 4, indirectSets: 0, effectiveSets: 4 },
      Quads: { directSets: 3, indirectSets: 0, effectiveSets: 3 },
    });
    mocks.buildAdvancingPerformedSlots.mockReturnValue([
      { slotId: "upper_a", intent: "upper" },
    ]);
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
        slotId: "lower_a",
        intent: "lower",
        sequenceIndex: 1,
      },
    ]);
    mocks.generateProjectedSession
      .mockResolvedValueOnce({
        workout: { id: "projected-1" },
      })
      .mockResolvedValueOnce({
        workout: { id: "projected-2" },
      });
    mocks.computeWorkoutContributionByMuscle
      .mockReturnValueOnce({ Chest: 2 })
      .mockReturnValueOnce({ Quads: 1 });
    mocks.buildProjectedWorkoutHistoryEntry.mockReturnValue({
      date: "2026-03-26T00:00:00.000Z",
      completed: true,
      exercises: [],
    });
    mocks.listWorkoutExerciseNames.mockReturnValue(["Projected Exercise"]);
    mocks.getWeeklyMuscleStatus.mockImplementation(
      ({ effectiveSets, target }: { effectiveSets: number; target: number }) =>
        effectiveSets < target ? "below_mev" : "on_target"
    );
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => {
        if (muscle === "Chest") return 10;
        if (muscle === "Quads") return 8;
        if (muscle === "Biceps") return 4;
        return 0;
      }
    );
    mocks.formatWeeklyMuscleStatusLabel.mockImplementation((status: string) =>
      status === "below_mev" ? "Below MEV" : "On target"
    );
    mocks.deriveSessionSemantics.mockReturnValue({
      advancesLifecycle: true,
      consumesWeeklyScheduleIntent: true,
      isDeload: false,
      countsTowardProgressionHistory: true,
      countsTowardPerformanceHistory: true,
    });
    mocks.getEffectiveStimulusByMuscle.mockImplementation(
      (exercise: { primaryMuscles?: string[] }, setCount: number) =>
        new Map([[exercise.primaryMuscles?.[0] ?? "Unknown", setCount]])
    );
    mocks.workoutFindMany.mockResolvedValue([
      {
        advancesSplit: true,
        selectionMetadata: {},
        selectionMode: "INTENT",
        sessionIntent: "UPPER",
      },
    ]);
  });

  it("includes current workout actuals, excludes the current workout from baseline, and projects remaining slots in canonical order", async () => {
    mocks.workoutFindFirst.mockResolvedValue(buildWorkout());

    const result = await loadLoggingWeeklyVolumeGuidance({
      userId: "user-1",
      workoutId: "workout-1",
    });

    expect(mocks.loadMesocycleWeekMuscleVolume).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        mesocycleId: "meso-1",
        targetWeek: 1,
        excludeWorkoutId: "workout-1",
      })
    );
    expect(mocks.generateProjectedSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        intent: "upper",
      })
    );
    expect(mocks.generateProjectedSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        intent: "lower",
      })
    );

    expect(result.shouldShow).toBe(true);
    expect(result.rows.find((row) => row.muscle === "Chest")).toMatchObject({
      muscle: "Chest",
      doneNow: 6,
      projectedRemainingWeek: 2,
      projectedEndOfWeek: 8,
      weeklyTarget: 10,
      deltaToTarget: -2,
      status: "below_mev",
      statusLabel: "Below MEV",
      topUpHint: "Likely needs ~1-2 more hard sets",
    });
  });

  it("uses the exposed scope so Core absorbs Abs and no separate Abs row is emitted", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      buildWorkout({
        exercises: [
          {
            id: "workout-ex-1",
            exerciseId: "exercise-1",
            name: "Plank",
            primaryMuscle: "Abs",
            setIds: ["set-1", "set-2"],
            loggedSetIds: ["set-1", "set-2"],
          },
        ],
      })
    );
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({});
    mocks.computeWorkoutContributionByMuscle
      .mockReturnValueOnce({ "Lower Back": 1 })
      .mockReturnValueOnce({});
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => {
        if (muscle === "Core") return 4;
        if (muscle === "Lower Back") return 2;
        return 0;
      }
    );

    const result = await loadLoggingWeeklyVolumeGuidance({
      userId: "user-1",
      workoutId: "workout-1",
    });

    expect(result.rows.map((row) => row.muscle)).toEqual(
      expect.arrayContaining(["Core", "Lower Back"])
    );
    expect(result.rows.map((row) => row.muscle)).not.toContain("Abs");
    expect(result.rows.find((row) => row.muscle === "Core")).toMatchObject({
      doneNow: 2,
      projectedRemainingWeek: 0,
      projectedEndOfWeek: 2,
      weeklyTarget: 4,
    });
  });

  it("counts runtime-added sets toward current actuals and treats the last session of the week as having no projected remainder", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      buildWorkout({
        runtimeAddedSetIds: ["set-3"],
        exercises: [
          {
            id: "workout-ex-1",
            exerciseId: "exercise-1",
            name: "Bench Press",
            primaryMuscle: "Chest",
            setIds: ["set-1", "set-2", "set-3"],
            loggedSetIds: ["set-1", "set-2", "set-3"],
          },
        ],
      })
    );
    mocks.deriveNextRuntimeSlotSession.mockReturnValue({
      week: 1,
      session: 3,
      phase: "ACCUMULATION",
      intent: null,
      slotId: null,
      slotSequenceIndex: null,
      slotSource: "mesocycle_slot_sequence",
    });
    mocks.buildRemainingFutureSlotsFromRuntime.mockReturnValue([]);
    mocks.computeWorkoutContributionByMuscle.mockReturnValue({});

    const result = await loadLoggingWeeklyVolumeGuidance({
      userId: "user-1",
      workoutId: "workout-1",
    });

    expect(result.rows.find((row) => row.muscle === "Chest")).toMatchObject({
      muscle: "Chest",
      doneNow: 7,
      projectedRemainingWeek: 0,
      projectedEndOfWeek: 7,
    });
  });

  it("counts runtime-added exercises toward current actuals without consuming the future schedule for non-advancing sessions", async () => {
    mocks.workoutFindFirst.mockResolvedValue(
      buildWorkout({
        runtimeAddedExerciseIds: ["workout-ex-added"],
        exercises: [
          {
            id: "workout-ex-1",
            exerciseId: "exercise-1",
            name: "Bench Press",
            primaryMuscle: "Chest",
            setIds: ["set-1", "set-2"],
            loggedSetIds: ["set-1", "set-2"],
          },
          {
            id: "workout-ex-added",
            exerciseId: "exercise-2",
            name: "Curl",
            primaryMuscle: "Biceps",
            setIds: ["set-added-1"],
            loggedSetIds: ["set-added-1"],
          },
        ],
      })
    );
    mocks.deriveSessionSemantics.mockReturnValue({
      advancesLifecycle: false,
      consumesWeeklyScheduleIntent: false,
      isDeload: false,
      countsTowardProgressionHistory: true,
      countsTowardPerformanceHistory: true,
    });
    mocks.computeWorkoutContributionByMuscle.mockReturnValue({});
    mocks.buildRemainingFutureSlotsFromRuntime.mockReturnValue([]);

    const result = await loadLoggingWeeklyVolumeGuidance({
      userId: "user-1",
      workoutId: "workout-1",
    });

    expect(mocks.deriveNextRuntimeSlotSession).toHaveBeenCalledWith(
      expect.objectContaining({
        performedAdvancingSlotIdsThisWeek: ["upper_a"],
        performedAdvancingIntentsThisWeek: ["upper"],
      })
    );
    expect(result.rows.map((row) => row.muscle)).toContain("Biceps");
    expect(result.rows.find((row) => row.muscle === "Biceps")).toMatchObject({
      doneNow: 1,
      projectedRemainingWeek: 0,
      projectedEndOfWeek: 1,
    });
  });

  it("uses the shared weekly status seam and only returns flagged muscles", async () => {
    mocks.workoutFindFirst.mockResolvedValue(buildWorkout());
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: { directSets: 4, indirectSets: 0, effectiveSets: 4 },
      Quads: { directSets: 7, indirectSets: 0, effectiveSets: 7 },
    });
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => {
        if (muscle === "Chest") return 10;
        if (muscle === "Quads") return 7;
        return 0;
      }
    );
    mocks.getWeeklyMuscleStatus
      .mockReturnValueOnce("near_target")
      .mockReturnValueOnce("on_target");
    mocks.formatWeeklyMuscleStatusLabel.mockReturnValue("Shared label");
    mocks.computeWorkoutContributionByMuscle
      .mockReturnValueOnce({ Chest: 2 })
      .mockReturnValueOnce({});

    const result = await loadLoggingWeeklyVolumeGuidance({
      userId: "user-1",
      workoutId: "workout-1",
    });

    expect(mocks.getWeeklyMuscleStatus).toHaveBeenCalled();
    expect(mocks.formatWeeklyMuscleStatusLabel).toHaveBeenCalledWith("near_target");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      muscle: "Chest",
      status: "near_target",
      statusLabel: "Shared label",
    });
  });
});
