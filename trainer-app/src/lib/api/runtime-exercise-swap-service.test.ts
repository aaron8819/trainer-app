import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutExerciseFindFirst = vi.fn();
  const workoutExerciseFindMany = vi.fn();
  const exerciseFindMany = vi.fn();
  const setLogFindFirst = vi.fn();
  const txWorkoutFindUnique = vi.fn();
  const txWorkoutUpdate = vi.fn();
  const txWorkoutExerciseUpdate = vi.fn();
  const txWorkoutExerciseFindMany = vi.fn();
  const txWorkoutSetUpdate = vi.fn();

  const tx = {
    workout: {
      findUnique: txWorkoutFindUnique,
      update: txWorkoutUpdate,
    },
    workoutExercise: {
      update: txWorkoutExerciseUpdate,
      findMany: txWorkoutExerciseFindMany,
    },
    workoutSet: {
      update: txWorkoutSetUpdate,
    },
  };

  const prisma = {
    workout: {
      findFirst: workoutFindFirst,
    },
    workoutExercise: {
      findFirst: workoutExerciseFindFirst,
      findMany: workoutExerciseFindMany,
    },
    exercise: {
      findMany: exerciseFindMany,
    },
    setLog: {
      findFirst: setLogFindFirst,
    },
    $transaction: vi.fn(
      async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };

  const searchExerciseLibrary = vi.fn();

  return {
    prisma,
    workoutFindFirst,
    workoutExerciseFindFirst,
    workoutExerciseFindMany,
    exerciseFindMany,
    setLogFindFirst,
    txWorkoutFindUnique,
    txWorkoutUpdate,
    txWorkoutExerciseUpdate,
    txWorkoutExerciseFindMany,
    txWorkoutSetUpdate,
    searchExerciseLibrary,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/exercise-library", () => ({
  searchExerciseLibrary: mocks.searchExerciseLibrary,
}));

import {
  applyRuntimeExerciseSwap,
  resolveRuntimeExerciseSwapCandidates,
  resolveRuntimeExerciseSwapPreview,
} from "./runtime-exercise-swap-service";

const runtimeEditDirectives = {
  continuityAlias: "none",
  progressionAlias: "none",
  futureSessionGeneration: "ignore",
  futureSeedCarryForward: "ignore",
} as const;

function buildRuntimeAddedSelectionMetadata() {
  return {
    runtimeEditReconciliation: {
      version: 1,
      lastReconciledAt: "2026-03-01T00:00:00.000Z",
      directives: runtimeEditDirectives,
      ops: [
        {
          kind: "add_exercise",
          source: "api_workouts_add_exercise",
          appliedAt: "2026-03-01T00:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-1",
            exerciseId: "t-bar-row",
            orderIndex: 0,
            section: "MAIN",
            setCount: 2,
            prescriptionSource: "session_accessory_defaults",
          },
        },
      ],
    },
  };
}

function buildAlreadySwappedSelectionMetadata() {
  return {
    runtimeEditReconciliation: {
      version: 1,
      lastReconciledAt: "2026-03-01T00:00:00.000Z",
      directives: runtimeEditDirectives,
      ops: [
        {
          kind: "replace_exercise",
          source: "api_workouts_swap_exercise",
          appliedAt: "2026-03-01T00:00:00.000Z",
          scope: "current_workout_only",
          facts: {
            workoutExerciseId: "we-1",
            fromExerciseId: "t-bar-row",
            fromExerciseName: "T-Bar Row",
            toExerciseId: "chest-supported-db-row",
            toExerciseName: "Chest-Supported Dumbbell Row",
            reason: "equipment_availability_equivalent_pull_swap",
            setCount: 2,
          },
        },
      ],
    },
  };
}

function buildCloseoutSelectionMetadata() {
  return {
    weekCloseId: "week-close-1",
    sessionDecisionReceipt: {
      version: 1,
      cycleContext: { weekInMeso: 4 },
      readiness: { wasAutoregulated: false },
      lifecycleVolume: { targets: [] },
      targetMuscles: ["lats"],
      sorenessSuppressedMuscles: [],
      exceptions: [
        {
          code: "closeout_session",
          message: "Marked as closeout session.",
        },
      ],
    },
  };
}

describe("runtime exercise swap service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      status: "IN_PROGRESS",
      selectionMode: "INTENT",
      sessionIntent: "PULL",
      exercises: [{ id: "we-1", exerciseId: "t-bar-row" }],
      selectionMetadata: {
        sessionAuditSnapshot: {
          version: 1,
          generated: {
            selectionMode: "INTENT",
            sessionIntent: "PULL",
            exerciseCount: 1,
            hardSetCount: 2,
            exercises: [
              {
                exerciseId: "t-bar-row",
                exerciseName: "T-Bar Row",
                orderIndex: 0,
                section: "main",
                isMainLift: false,
                prescribedSetCount: 2,
                prescribedSets: [{ setIndex: 1, targetReps: 10, targetRpe: 8 }],
              },
            ],
            semantics: {
              kind: "advancing",
              effectiveSelectionMode: "INTENT",
              isDeload: false,
              isStrictGapFill: false,
              isStrictSupplemental: false,
              advancesLifecycle: true,
              consumesWeeklyScheduleIntent: true,
              countsTowardCompliance: true,
              countsTowardRecentStimulus: true,
              countsTowardWeeklyVolume: true,
              countsTowardProgressionHistory: true,
              countsTowardPerformanceHistory: true,
              updatesProgressionAnchor: true,
              eligibleForUniqueIntentSubtraction: true,
              reasons: [],
              trace: { advancesSplitInput: true },
            },
            traces: { progression: {} },
          },
        },
      },
    });

    mocks.workoutExerciseFindFirst.mockResolvedValue({
      id: "we-1",
      workoutId: "workout-1",
      exerciseId: "t-bar-row",
      section: "MAIN",
      isMainLift: false,
      exercise: {
        id: "t-bar-row",
        name: "T-Bar Row",
        fatigueCost: 3,
        jointStress: "MEDIUM",
        isMainLiftEligible: false,
        isCompound: true,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
      sets: [
        {
          id: "set-1",
          setIndex: 1,
          targetRpe: 8,
          restSeconds: 120,
          logs: [],
        },
        {
          id: "set-2",
          setIndex: 2,
          targetRpe: 8,
          restSeconds: 120,
          logs: [],
        },
      ],
    });

    mocks.exerciseFindMany.mockResolvedValue([
      {
        id: "t-bar-row",
        name: "T-Bar Row",
        fatigueCost: 3,
        jointStress: "MEDIUM",
        isMainLiftEligible: false,
        isCompound: true,
        repRangeMin: 8,
        repRangeMax: 12,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
      {
        id: "chest-supported-db-row",
        name: "Chest-Supported Dumbbell Row",
        fatigueCost: 2,
        jointStress: "LOW",
        isMainLiftEligible: false,
        isCompound: true,
        repRangeMin: 8,
        repRangeMax: 12,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "DUMBBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
      {
        id: "lat-pulldown",
        name: "Lat Pulldown",
        fatigueCost: 2,
        jointStress: "LOW",
        isMainLiftEligible: false,
        isCompound: true,
        repRangeMin: 8,
        repRangeMax: 12,
        movementPatterns: ["VERTICAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "CABLE" } }],
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Lats" } }],
      },
      {
        id: "cable-row",
        name: "Cable Row",
        fatigueCost: 2,
        jointStress: "LOW",
        isMainLiftEligible: false,
        isCompound: true,
        repRangeMin: 10,
        repRangeMax: 14,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "CABLE" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
    ]);

    mocks.searchExerciseLibrary.mockResolvedValue([]);
    mocks.workoutExerciseFindMany.mockResolvedValue([]);
    mocks.setLogFindFirst.mockResolvedValue({ actualLoad: 27.5 });
    mocks.txWorkoutFindUnique.mockResolvedValue({
      selectionMetadata: {
        sessionAuditSnapshot: {
          version: 1,
          generated: {
            selectionMode: "INTENT",
            sessionIntent: "PULL",
            exerciseCount: 1,
            hardSetCount: 2,
            exercises: [
              {
                exerciseId: "t-bar-row",
                exerciseName: "T-Bar Row",
                orderIndex: 0,
                section: "main",
                isMainLift: false,
                prescribedSetCount: 2,
                prescribedSets: [{ setIndex: 1, targetReps: 10, targetRpe: 8 }],
              },
            ],
            semantics: {
              kind: "advancing",
              effectiveSelectionMode: "INTENT",
              isDeload: false,
              isStrictGapFill: false,
              isStrictSupplemental: false,
              advancesLifecycle: true,
              consumesWeeklyScheduleIntent: true,
              countsTowardCompliance: true,
              countsTowardRecentStimulus: true,
              countsTowardWeeklyVolume: true,
              countsTowardProgressionHistory: true,
              countsTowardPerformanceHistory: true,
              updatesProgressionAnchor: true,
              eligibleForUniqueIntentSubtraction: true,
              reasons: [],
              trace: { advancesSplitInput: true },
            },
            traces: { progression: {} },
          },
        },
      },
      selectionMode: "INTENT",
      sessionIntent: "PULL",
    });
    mocks.txWorkoutExerciseFindMany.mockResolvedValue([
      {
        exerciseId: "chest-supported-db-row",
        orderIndex: 0,
        section: "MAIN",
        exercise: { name: "Chest-Supported Dumbbell Row" },
        sets: [
          {
            setIndex: 1,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 27.5,
            restSeconds: 120,
          },
          {
            setIndex: 2,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 27.5,
            restSeconds: 120,
          },
        ],
      },
    ]);
  });

  it("derives preview and mutation from the same exact server-owned prescription", async () => {
    const input = {
      workoutId: "workout-1",
      workoutExerciseId: "we-1",
      replacementExerciseId: "chest-supported-db-row",
      userId: "user-1",
    };

    const preview = await resolveRuntimeExerciseSwapPreview(input);
    const applied = await applyRuntimeExerciseSwap(input);

    expect(preview).toEqual(applied);
    expect(preview).toMatchObject({
      workoutExerciseId: "we-1",
      exerciseId: "chest-supported-db-row",
      name: "Chest-Supported Dumbbell Row",
      isSwapped: true,
      isMainLift: false,
      section: "MAIN",
      sessionNote:
        "Swapped from T-Bar Row. Session-only; future progression stays exercise-specific.",
      sets: [
        {
          setId: "set-1",
          setIndex: 1,
          targetReps: 10,
          targetRepRange: { min: 8, max: 12 },
          targetLoad: 27.5,
          targetRpe: 8,
          restSeconds: 120,
        },
        {
          setId: "set-2",
          setIndex: 2,
          targetReps: 10,
          targetRepRange: { min: 8, max: 12 },
          targetLoad: 27.5,
          targetRpe: 8,
          restSeconds: 120,
        },
      ],
    });
    expect(mocks.txWorkoutExerciseUpdate).toHaveBeenCalledWith({
      where: { id: "we-1" },
      data: {
        exerciseId: "chest-supported-db-row",
        movementPatterns: ["HORIZONTAL_PULL"],
      },
    });
    expect(mocks.txWorkoutSetUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.txWorkoutSetUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "set-1" },
      data: {
        targetReps: 10,
        targetRepMin: 8,
        targetRepMax: 12,
        targetLoad: 27.5,
      },
    });
    expect(mocks.txWorkoutSetUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: "set-2" },
      data: {
        targetReps: 10,
        targetRepMin: 8,
        targetRepMax: 12,
        targetLoad: 27.5,
      },
    });
    expect(mocks.txWorkoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "workout-1" },
        data: expect.objectContaining({
          revision: { increment: 1 },
          selectionMetadata: expect.objectContaining({
            runtimeEditReconciliation: expect.objectContaining({
              version: 1,
              directives: {
                continuityAlias: "none",
                progressionAlias: "none",
                futureSessionGeneration: "ignore",
                futureSeedCarryForward: "ignore",
              },
              ops: [
                expect.objectContaining({
                  kind: "replace_exercise",
                  source: "api_workouts_swap_exercise",
                  scope: "current_workout_only",
                  facts: {
                    workoutExerciseId: "we-1",
                    fromExerciseId: "t-bar-row",
                    fromExerciseName: "T-Bar Row",
                    toExerciseId: "chest-supported-db-row",
                    toExerciseName: "Chest-Supported Dumbbell Row",
                    reason: "equipment_availability_equivalent_pull_swap",
                    setCount: 2,
                  },
                }),
              ],
            }),
            workoutStructureState: expect.objectContaining({
              reconciliation: expect.objectContaining({
                hasDrift: true,
                changedFields: expect.arrayContaining([
                  "exercise_added",
                  "exercise_removed",
                ]),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("swaps runtime-added unlogged rows while preserving runtime-added provenance", async () => {
    const runtimeAddedSelectionMetadata = buildRuntimeAddedSelectionMetadata();
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      status: "IN_PROGRESS",
      selectionMode: "MANUAL",
      sessionIntent: null,
      exercises: [{ id: "we-1", exerciseId: "t-bar-row" }],
      selectionMetadata: runtimeAddedSelectionMetadata,
    });
    mocks.txWorkoutFindUnique.mockResolvedValue({
      selectionMetadata: runtimeAddedSelectionMetadata,
      selectionMode: "MANUAL",
      sessionIntent: null,
    });

    const input = {
      workoutId: "workout-1",
      workoutExerciseId: "we-1",
      replacementExerciseId: "chest-supported-db-row",
      userId: "user-1",
    };

    await expect(resolveRuntimeExerciseSwapPreview(input)).resolves.toMatchObject({
      workoutExerciseId: "we-1",
      exerciseId: "chest-supported-db-row",
      isRuntimeAdded: true,
      isSwapped: true,
    });
    await expect(applyRuntimeExerciseSwap(input)).resolves.toMatchObject({
      workoutExerciseId: "we-1",
      exerciseId: "chest-supported-db-row",
      isRuntimeAdded: true,
      isSwapped: true,
    });

    const updateCall = mocks.txWorkoutUpdate.mock.calls.at(-1)?.[0];
    const selectionMetadata = updateCall?.data.selectionMetadata as {
      runtimeEditReconciliation?: { ops?: Array<{ kind: string; facts: unknown }> };
    };
    expect(selectionMetadata.runtimeEditReconciliation?.ops?.map((op) => op.kind)).toEqual([
      "add_exercise",
      "replace_exercise",
    ]);
    expect(selectionMetadata.runtimeEditReconciliation?.ops?.[0]).toMatchObject({
      kind: "add_exercise",
      facts: expect.objectContaining({ workoutExerciseId: "we-1" }),
    });
  });

  it("swaps closeout unlogged rows while preserving week-close receipt ownership", async () => {
    const closeoutSelectionMetadata = buildCloseoutSelectionMetadata();
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      status: "IN_PROGRESS",
      selectionMode: "MANUAL",
      sessionIntent: null,
      exercises: [{ id: "we-1", exerciseId: "t-bar-row" }],
      selectionMetadata: closeoutSelectionMetadata,
    });
    mocks.txWorkoutFindUnique.mockResolvedValue({
      selectionMetadata: closeoutSelectionMetadata,
      selectionMode: "MANUAL",
      sessionIntent: null,
    });

    await expect(
      applyRuntimeExerciseSwap({
        workoutId: "workout-1",
        workoutExerciseId: "we-1",
        replacementExerciseId: "chest-supported-db-row",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({
      workoutExerciseId: "we-1",
      exerciseId: "chest-supported-db-row",
      isRuntimeAdded: false,
      isSwapped: true,
    });

    const updateCall = mocks.txWorkoutUpdate.mock.calls.at(-1)?.[0];
    const selectionMetadata = updateCall?.data.selectionMetadata as {
      weekCloseId?: string;
      sessionDecisionReceipt?: {
        exceptions?: Array<{ code: string }>;
        sessionSlot?: unknown;
      };
      runtimeEditReconciliation?: { ops?: Array<{ kind: string }> };
    };
    expect(selectionMetadata.weekCloseId).toBe("week-close-1");
    expect(selectionMetadata.sessionDecisionReceipt?.exceptions).toEqual([
      expect.objectContaining({ code: "closeout_session" }),
    ]);
    expect(selectionMetadata.sessionDecisionReceipt?.sessionSlot).toBeUndefined();
    expect(selectionMetadata.runtimeEditReconciliation?.ops?.map((op) => op.kind)).toEqual([
      "replace_exercise",
    ]);
  });

  it("normalizes nullable sections back to MAIN", async () => {
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      id: "we-1",
      workoutId: "workout-1",
      exerciseId: "t-bar-row",
      section: null,
      isMainLift: false,
      exercise: {
        id: "t-bar-row",
        name: "T-Bar Row",
        fatigueCost: 3,
        jointStress: "MEDIUM",
        isMainLiftEligible: false,
        isCompound: true,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
      sets: [
        {
          id: "set-1",
          setIndex: 1,
          targetRpe: 8,
          restSeconds: 120,
          logs: [],
        },
        {
          id: "set-2",
          setIndex: 2,
          targetRpe: 8,
          restSeconds: 120,
          logs: [],
        },
      ],
    });
    mocks.txWorkoutExerciseFindMany.mockResolvedValueOnce([
      {
        exerciseId: "chest-supported-db-row",
        orderIndex: 0,
        section: null,
        exercise: { name: "Chest-Supported Dumbbell Row" },
        sets: [
          {
            setIndex: 1,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 27.5,
            restSeconds: 120,
          },
          {
            setIndex: 2,
            targetReps: 10,
            targetRepMin: 8,
            targetRepMax: 12,
            targetRpe: 8,
            targetLoad: 27.5,
            restSeconds: 120,
          },
        ],
      },
    ]);

    const input = {
      workoutId: "workout-1",
      workoutExerciseId: "we-1",
      replacementExerciseId: "chest-supported-db-row",
      userId: "user-1",
    };

    await expect(
      resolveRuntimeExerciseSwapPreview(input),
    ).resolves.toMatchObject({
      section: "MAIN",
    });
    await expect(applyRuntimeExerciseSwap(input)).resolves.toMatchObject({
      section: "MAIN",
    });
  });

  it("keeps the ranked shortlist for initial discovery", async () => {
    const candidates = await resolveRuntimeExerciseSwapCandidates({
      workoutId: "workout-1",
      workoutExerciseId: "we-1",
      userId: "user-1",
    });

    expect(candidates.map((candidate) => candidate.exerciseId)).toEqual([
      "cable-row",
      "chest-supported-db-row",
      "lat-pulldown",
    ]);
    expect(mocks.searchExerciseLibrary).not.toHaveBeenCalled();
    expect(mocks.exerciseFindMany).toHaveBeenCalledTimes(1);
  });

  it("uses server-backed typed search and filters results back through swap eligibility", async () => {
    mocks.searchExerciseLibrary.mockResolvedValue([
      {
        id: "cable-row",
        name: "Cable Row",
        primaryMuscles: ["Lats", "Upper Back"],
        equipment: ["CABLE"],
      },
      {
        id: "unsupported-curl",
        name: "Cable Curl",
        primaryMuscles: ["Biceps"],
        equipment: ["CABLE"],
      },
      {
        id: "chest-supported-db-row",
        name: "Chest-Supported Dumbbell Row",
        primaryMuscles: ["Lats", "Upper Back"],
        equipment: ["DUMBBELL"],
      },
    ]);
    mocks.exerciseFindMany.mockResolvedValue([
      {
        id: "cable-row",
        name: "Cable Row",
        fatigueCost: 2,
        jointStress: "LOW",
        isMainLiftEligible: false,
        isCompound: true,
        repRangeMin: 10,
        repRangeMax: 14,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "CABLE" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
      {
        id: "unsupported-curl",
        name: "Cable Curl",
        fatigueCost: 2,
        jointStress: "LOW",
        isMainLiftEligible: false,
        isCompound: false,
        repRangeMin: 8,
        repRangeMax: 12,
        movementPatterns: ["ISOLATION"],
        exerciseEquipment: [{ equipment: { type: "CABLE" } }],
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Biceps" } }],
      },
      {
        id: "chest-supported-db-row",
        name: "Chest-Supported Dumbbell Row",
        fatigueCost: 2,
        jointStress: "LOW",
        isMainLiftEligible: false,
        isCompound: true,
        repRangeMin: 8,
        repRangeMax: 12,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "DUMBBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
    ]);

    const candidates = await resolveRuntimeExerciseSwapCandidates({
      workoutId: "workout-1",
      workoutExerciseId: "we-1",
      userId: "user-1",
      query: "row",
      limit: 8,
    });

    expect(mocks.searchExerciseLibrary).toHaveBeenCalledWith("row", 48);
    expect(candidates).toEqual([
      expect.objectContaining({
        exerciseId: "cable-row",
        exerciseName: "Cable Row",
      }),
      expect.objectContaining({
        exerciseId: "chest-supported-db-row",
        exerciseName: "Chest-Supported Dumbbell Row",
      }),
    ]);
    expect(
      candidates.some(
        (candidate) => candidate.exerciseId === "unsupported-curl",
      ),
    ).toBe(false);
  });

  it("swaps an unlogged main lift only to a main-lift eligible movement-family match", async () => {
    mocks.workoutFindFirst.mockResolvedValueOnce({
      id: "workout-1",
      status: "IN_PROGRESS",
      selectionMode: "INTENT",
      sessionIntent: "PUSH",
      exercises: [{ id: "we-1", exerciseId: "barbell-bench-press" }],
      selectionMetadata: {},
    });
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      id: "we-1",
      workoutId: "workout-1",
      exerciseId: "barbell-bench-press",
      section: "MAIN",
      isMainLift: true,
      exercise: {
        id: "barbell-bench-press",
        name: "Barbell Bench Press",
        fatigueCost: 4,
        jointStress: "HIGH",
        isMainLiftEligible: true,
        isCompound: true,
        movementPatterns: ["HORIZONTAL_PUSH"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Chest" } },
          { role: "PRIMARY", muscle: { name: "Triceps" } },
        ],
      },
      sets: [
        {
          id: "set-1",
          setIndex: 1,
          targetRpe: 8,
          restSeconds: 180,
          logs: [],
        },
      ],
    });
    mocks.exerciseFindMany.mockResolvedValueOnce([
      {
        id: "barbell-bench-press",
        name: "Barbell Bench Press",
        fatigueCost: 4,
        jointStress: "HIGH",
        isMainLiftEligible: true,
        isCompound: true,
        repRangeMin: 5,
        repRangeMax: 8,
        movementPatterns: ["HORIZONTAL_PUSH"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Chest" } },
          { role: "PRIMARY", muscle: { name: "Triceps" } },
        ],
      },
      {
        id: "dumbbell-bench-press",
        name: "Dumbbell Bench Press",
        fatigueCost: 3,
        jointStress: "MEDIUM",
        isMainLiftEligible: true,
        isCompound: true,
        repRangeMin: 6,
        repRangeMax: 10,
        movementPatterns: ["HORIZONTAL_PUSH"],
        exerciseEquipment: [{ equipment: { type: "DUMBBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Chest" } },
          { role: "PRIMARY", muscle: { name: "Triceps" } },
        ],
      },
      {
        id: "pec-deck",
        name: "Pec Deck",
        fatigueCost: 1,
        jointStress: "LOW",
        isMainLiftEligible: false,
        isCompound: false,
        repRangeMin: 10,
        repRangeMax: 15,
        movementPatterns: ["ISOLATION"],
        exerciseEquipment: [{ equipment: { type: "MACHINE" } }],
        exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
      },
    ]);

    await expect(
      resolveRuntimeExerciseSwapPreview({
        workoutId: "workout-1",
        workoutExerciseId: "we-1",
        replacementExerciseId: "dumbbell-bench-press",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({
      workoutExerciseId: "we-1",
      exerciseId: "dumbbell-bench-press",
      isMainLift: true,
      sets: [{ targetReps: 8, targetRepRange: { min: 6, max: 10 } }],
    });
  });

  it("blocks partially logged source exercises with a reason code", async () => {
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      id: "we-1",
      workoutId: "workout-1",
      exerciseId: "t-bar-row",
      section: "MAIN",
      isMainLift: false,
      exercise: {
        id: "t-bar-row",
        name: "T-Bar Row",
        fatigueCost: 3,
        jointStress: "MEDIUM",
        isMainLiftEligible: false,
        isCompound: true,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
      sets: [
        {
          id: "set-1",
          setIndex: 1,
          targetRpe: 8,
          restSeconds: 120,
          logs: [{ id: "log-1" }],
        },
        {
          id: "set-2",
          setIndex: 2,
          targetRpe: 8,
          restSeconds: 120,
          logs: [],
        },
      ],
    });

    await expect(
      resolveRuntimeExerciseSwapCandidates({
        workoutId: "workout-1",
        workoutExerciseId: "we-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "PARTIALLY_LOGGED_EXERCISE_BLOCKED" });
  });

  it("blocks fully logged source exercises with a reason code", async () => {
    mocks.workoutExerciseFindFirst.mockResolvedValueOnce({
      id: "we-1",
      workoutId: "workout-1",
      exerciseId: "t-bar-row",
      section: "MAIN",
      isMainLift: false,
      exercise: {
        id: "t-bar-row",
        name: "T-Bar Row",
        fatigueCost: 3,
        jointStress: "MEDIUM",
        isMainLiftEligible: false,
        isCompound: true,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
      sets: [
        {
          id: "set-1",
          setIndex: 1,
          targetRpe: 8,
          restSeconds: 120,
          logs: [{ id: "log-1" }],
        },
        {
          id: "set-2",
          setIndex: 2,
          targetRpe: 8,
          restSeconds: 120,
          logs: [{ id: "log-2" }],
        },
      ],
    });

    await expect(
      resolveRuntimeExerciseSwapCandidates({
        workoutId: "workout-1",
        workoutExerciseId: "we-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "FULLY_LOGGED_EXERCISE_BLOCKED" });
  });

  it("blocks already-swapped source exercises with a reason code", async () => {
    mocks.workoutFindFirst.mockResolvedValueOnce({
      id: "workout-1",
      status: "IN_PROGRESS",
      selectionMode: "INTENT",
      sessionIntent: "PULL",
      exercises: [{ id: "we-1", exerciseId: "chest-supported-db-row" }],
      selectionMetadata: buildAlreadySwappedSelectionMetadata(),
    });

    await expect(
      resolveRuntimeExerciseSwapCandidates({
        workoutId: "workout-1",
        workoutExerciseId: "we-1",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_SWAPPED" });
  });

  it("blocks replacement exercises that already exist elsewhere in the workout", async () => {
    mocks.workoutFindFirst.mockResolvedValueOnce({
      id: "workout-1",
      status: "IN_PROGRESS",
      selectionMode: "INTENT",
      sessionIntent: "PULL",
      exercises: [
        { id: "we-1", exerciseId: "t-bar-row" },
        { id: "we-2", exerciseId: "cable-row" },
      ],
      selectionMetadata: {},
    });

    const candidates = await resolveRuntimeExerciseSwapCandidates({
      workoutId: "workout-1",
      workoutExerciseId: "we-1",
      userId: "user-1",
    });

    expect(candidates.map((candidate) => candidate.exerciseId)).toEqual([
      "chest-supported-db-row",
      "lat-pulldown",
    ]);

    mocks.workoutFindFirst.mockResolvedValueOnce({
      id: "workout-1",
      status: "IN_PROGRESS",
      selectionMode: "INTENT",
      sessionIntent: "PULL",
      exercises: [
        { id: "we-1", exerciseId: "t-bar-row" },
        { id: "we-2", exerciseId: "cable-row" },
      ],
      selectionMetadata: {},
    });

    await expect(
      resolveRuntimeExerciseSwapPreview({
        workoutId: "workout-1",
        workoutExerciseId: "we-1",
        replacementExerciseId: "cable-row",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "REPLACEMENT_NOT_ELIGIBLE" });
  });

  it("returns an empty shortlist when no safe candidates exist", async () => {
    mocks.exerciseFindMany.mockResolvedValueOnce([
      {
        id: "t-bar-row",
        name: "T-Bar Row",
        fatigueCost: 3,
        jointStress: "MEDIUM",
        isMainLiftEligible: false,
        isCompound: true,
        repRangeMin: 8,
        repRangeMax: 12,
        movementPatterns: ["HORIZONTAL_PULL"],
        exerciseEquipment: [{ equipment: { type: "BARBELL" } }],
        exerciseMuscles: [
          { role: "PRIMARY", muscle: { name: "Lats" } },
          { role: "PRIMARY", muscle: { name: "Upper Back" } },
        ],
      },
    ]);

    await expect(
      resolveRuntimeExerciseSwapCandidates({
        workoutId: "workout-1",
        workoutExerciseId: "we-1",
        userId: "user-1",
      }),
    ).resolves.toEqual([]);
  });
});
