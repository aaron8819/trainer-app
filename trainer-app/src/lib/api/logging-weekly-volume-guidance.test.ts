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
  const listWorkoutExerciseIds = vi.fn();
  const loadMesocycleWeekMuscleVolume = vi.fn();
  const deriveNextRuntimeSlotSession = vi.fn();
  const buildRemainingFutureSlotsFromRuntime = vi.fn();
  const buildAdvancingPerformedSlots = vi.fn();
  const getWeeklyVolumeTarget = vi.fn();
  const deriveSessionSemantics = vi.fn();

  return {
    workoutFindFirst,
    workoutFindMany,
    loadPreloadedGenerationSnapshot,
    buildMappedGenerationContextFromSnapshot,
    generateProjectedSession,
    computeWorkoutContributionByMuscle,
    buildProjectedWorkoutHistoryEntry,
    appendWorkoutHistoryEntryToMappedContext,
    listWorkoutExerciseIds,
    loadMesocycleWeekMuscleVolume,
    deriveNextRuntimeSlotSession,
    buildRemainingFutureSlotsFromRuntime,
    buildAdvancingPerformedSlots,
    getWeeklyVolumeTarget,
    deriveSessionSemantics,
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
  listWorkoutExerciseIds: (...args: unknown[]) =>
    mocks.listWorkoutExerciseIds(...args),
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

vi.mock("@/lib/session-semantics/derive-session-semantics", () => ({
  deriveSessionSemantics: (...args: unknown[]) => mocks.deriveSessionSemantics(...args),
}));

vi.mock("@/lib/engine/stimulus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/engine/stimulus")>();
  return {
    ...actual,
    resolveStimulusProfile: (exercise: { primaryMuscles?: string[] }) =>
      Object.fromEntries(
        (exercise.primaryMuscles ?? []).flatMap((muscle) => {
          const muscleId = actual.toMuscleId(muscle);
          return muscleId ? [[muscleId, 1]] : [];
        })
      ),
  };
});

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
    mocks.listWorkoutExerciseIds.mockReturnValue(["projected-exercise-id"]);
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => {
        if (muscle === "Chest") return 10;
        if (muscle === "Quads") return 8;
        if (muscle === "Biceps") return 4;
        return 0;
      }
    );
    mocks.deriveSessionSemantics.mockReturnValue({
      advancesLifecycle: true,
      consumesWeeklyScheduleIntent: true,
      isDeload: false,
      countsTowardProgressionHistory: true,
      countsTowardPerformanceHistory: true,
    });
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
      performedSoFar: 6,
      plannedRemaining: 2,
      projectedFinish: 8,
      MEV: 10,
      MAV: 16,
      status: "floor_risk",
      statusLabel: "Floor risk",
      recommendationKind: "add_low_fatigue_buffer_optional",
      optionalOrSuppress: true,
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
      performedSoFar: 2,
      plannedRemaining: 0,
      projectedFinish: 2,
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
      performedSoFar: 7,
      plannedRemaining: 0,
      projectedFinish: 7,
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
      performedSoFar: 1,
      plannedRemaining: 0,
      projectedFinish: 1,
    });
  });

  it("classifies above-MEV but below-target rows as productive without recommending add-ons", async () => {
    mocks.workoutFindFirst.mockResolvedValue(buildWorkout());
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: { directSets: 8, indirectSets: 0, effectiveSets: 8 },
    });
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => {
        if (muscle === "Chest") return 14;
        return 0;
      }
    );
    mocks.computeWorkoutContributionByMuscle.mockReset();
    mocks.computeWorkoutContributionByMuscle
      .mockReturnValueOnce({ Chest: 2 })
      .mockReturnValueOnce({});

    const result = await loadLoggingWeeklyVolumeGuidance({
      userId: "user-1",
      workoutId: "workout-1",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      muscle: "Chest",
      performedSoFar: 10,
      plannedRemaining: 2,
      projectedFinish: 12,
      MEV: 10,
      MAV: 16,
      status: "productive",
      recommendationKind: "watch",
      optionalOrSuppress: false,
    });
  });

  it("shows floor risk when the projected finish remains below MEV", async () => {
    mocks.workoutFindFirst.mockResolvedValue(buildWorkout());
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: { directSets: 4, indirectSets: 0, effectiveSets: 4 },
    });
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => (muscle === "Chest" ? 12 : 0)
    );
    mocks.computeWorkoutContributionByMuscle.mockReset();
    mocks.computeWorkoutContributionByMuscle.mockReturnValue({});

    const result = await loadLoggingWeeklyVolumeGuidance({
      userId: "user-1",
      workoutId: "workout-1",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      muscle: "Chest",
      performedSoFar: 6,
      projectedFinish: 6,
      status: "floor_risk",
      statusLabel: "Floor risk",
      recommendationKind: "add_low_fatigue_buffer_optional",
    });
  });

  it("shows exact-floor projection as an optional low-fatigue buffer, not a requirement", async () => {
    mocks.workoutFindFirst.mockResolvedValue(buildWorkout());
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: { directSets: 8, indirectSets: 0, effectiveSets: 8 },
    });
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => (muscle === "Chest" ? 14 : 0)
    );
    mocks.computeWorkoutContributionByMuscle.mockReset();
    mocks.computeWorkoutContributionByMuscle.mockReturnValue({});

    const result = await loadLoggingWeeklyVolumeGuidance({
      userId: "user-1",
      workoutId: "workout-1",
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      muscle: "Chest",
      performedSoFar: 10,
      projectedFinish: 10,
      status: "optional_floor_buffer",
      statusLabel: "Optional low-fatigue buffer",
      recommendationKind: "add_low_fatigue_buffer_optional",
      optionalOrSuppress: true,
    });
    expect(result.rows[0]?.reasonCopy).toContain("Optional +1 low-fatigue buffer");
  });

  it("suppresses extras near and over MAV", async () => {
    mocks.workoutFindFirst.mockResolvedValue(buildWorkout());
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: { directSets: 14, indirectSets: 0, effectiveSets: 14 },
      Quads: { directSets: 19, indirectSets: 0, effectiveSets: 19 },
    });
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => {
        if (muscle === "Chest") return 16;
        if (muscle === "Quads") return 12;
        return 0;
      }
    );
    mocks.computeWorkoutContributionByMuscle.mockReset();
    mocks.computeWorkoutContributionByMuscle.mockReturnValue({});

    const result = await loadLoggingWeeklyVolumeGuidance({
      userId: "user-1",
      workoutId: "workout-1",
    });

    expect(result.rows.find((row) => row.muscle === "Chest")).toMatchObject({
      projectedFinish: 16,
      status: "near_cap",
      recommendationKind: "suppress_extras",
      optionalOrSuppress: true,
    });
    expect(result.rows.find((row) => row.muscle === "Quads")).toMatchObject({
      projectedFinish: 19,
      status: "over_cap",
      recommendationKind: "suppress_extras",
      optionalOrSuppress: true,
    });
  });

  it("returns no rows when the relevant week is covered with no floor or cap issue", async () => {
    mocks.workoutFindFirst.mockResolvedValue(buildWorkout());
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: { directSets: 10, indirectSets: 0, effectiveSets: 10 },
    });
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => (muscle === "Chest" ? 12 : 0)
    );
    mocks.computeWorkoutContributionByMuscle.mockReset();
    mocks.computeWorkoutContributionByMuscle.mockReturnValue({});

    const result = await loadLoggingWeeklyVolumeGuidance({
      userId: "user-1",
      workoutId: "workout-1",
    });

    expect(result.rows).toEqual([]);
    expect(result.summary).toEqual({
      status: "no_addons_recommended",
      recommendationKind: "no_action",
      reasonCopy:
        "Relevant muscles are covered by performed work and the remaining projection. No add-ons recommended.",
    });
  });
});
