import { beforeEach, describe, expect, it, vi } from "vitest";
import { replaceEmptySuccessorFromAcceptedSeedDraft } from "./replace-empty-successor-from-accepted-seed-draft";

const mocks = vi.hoisted(() => {
  const counts = {
    workout: 0,
    completedOrPartial: 0,
    workoutExercise: 0,
    workoutSet: 0,
    setLog: 0,
    performedSetLog: 0,
    sessionCheckIn: 0,
  };
  const exerciseCatalog = new Map<string, string>();
  const txMesocycleFindFirst = vi.fn();
  const txMesocycleUpdate = vi.fn();
  const txWorkoutCount = vi.fn(async (args: { where?: { status?: unknown } }) =>
    args.where?.status ? counts.completedOrPartial : counts.workout,
  );
  const txWorkoutExerciseCount = vi.fn(async () => counts.workoutExercise);
  const txWorkoutSetCount = vi.fn(async () => counts.workoutSet);
  const txSetLogCount = vi.fn(async (args: { where?: { wasSkipped?: boolean } }) =>
    args.where?.wasSkipped === false ? counts.performedSetLog : counts.setLog,
  );
  const txSessionCheckInCount = vi.fn(async () => counts.sessionCheckIn);
  const txExerciseFindMany = vi.fn(async () =>
    Array.from(exerciseCatalog.entries()).map(([id, name]) => ({ id, name })),
  );
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      mesocycle: {
        findFirst: txMesocycleFindFirst,
        update: txMesocycleUpdate,
      },
      workout: { count: txWorkoutCount },
      workoutExercise: { count: txWorkoutExerciseCount },
      workoutSet: { count: txWorkoutSetCount },
      setLog: { count: txSetLogCount },
      sessionCheckIn: { count: txSessionCheckInCount },
      exercise: { findMany: txExerciseFindMany },
    }),
  );

  return {
    counts,
    exerciseCatalog,
    txMesocycleFindFirst,
    txMesocycleUpdate,
    txWorkoutCount,
    txWorkoutExerciseCount,
    txWorkoutSetCount,
    txSetLogCount,
    txSessionCheckInCount,
    txExerciseFindMany,
    transaction,
    prisma: { $transaction: transaction },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

const persistedAcceptedSeed = {
  version: 1,
  source: "v2_materialized_seed",
  slots: [
    {
      slotId: "upper_a",
      exercises: [
        {
          exerciseId: "barbell-bench",
          role: "CORE_COMPOUND",
          setCount: 4,
        },
      ],
    },
    {
      slotId: "lower_a",
      exercises: [
        {
          exerciseId: "barbell-squat",
          role: "CORE_COMPOUND",
          setCount: 4,
        },
      ],
    },
  ],
};

const currentWrongSeed = {
  version: 1,
  source: "handoff_slot_plan_projection",
  slots: [
    {
      slotId: "upper_a",
      exercises: [
        {
          exerciseId: "incline-db-bench",
          role: "CORE_COMPOUND",
          setCount: 5,
        },
      ],
    },
    {
      slotId: "lower_a",
      exercises: [
        {
          exerciseId: "barbell-squat",
          role: "CORE_COMPOUND",
          setCount: 3,
        },
      ],
    },
  ],
};

function sourceMesocycle(nextSeedDraftJson: unknown = {
  acceptedSeedDraft: {
    source: "v2_materialized_seed",
    slotPlanSeedJson: persistedAcceptedSeed,
  },
}) {
  return {
    id: "source-1",
    state: "COMPLETED",
    isActive: false,
    macroCycleId: "macro-1",
    mesoNumber: 1,
    accumulationSessionsCompleted: 20,
    deloadSessionsCompleted: 4,
    nextSeedDraftJson,
    slotSequenceJson: null,
    slotPlanSeedJson: null,
    macroCycle: {
      userId: "user-1",
      user: { email: "owner@test.local" },
    },
  };
}

function successorMesocycle(slotPlanSeedJson: unknown = currentWrongSeed) {
  return {
    id: "successor-1",
    state: "ACTIVE_ACCUMULATION",
    isActive: true,
    macroCycleId: "macro-1",
    mesoNumber: 2,
    accumulationSessionsCompleted: 0,
    deloadSessionsCompleted: 0,
    nextSeedDraftJson: null,
    slotSequenceJson: {
      version: 1,
      source: "handoff_draft",
      sequenceMode: "ordered_flexible",
      slots: [
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "lower_a", intent: "LOWER" },
      ],
    },
    slotPlanSeedJson,
    macroCycle: {
      userId: "user-1",
      user: { email: "owner@test.local" },
    },
  };
}

async function runRecovery(
  overrides: Partial<Parameters<typeof replaceEmptySuccessorFromAcceptedSeedDraft>[0]> = {},
) {
  return replaceEmptySuccessorFromAcceptedSeedDraft({
    userId: "user-1",
    ownerEmail: "owner@test.local",
    sourceMesocycleId: "source-1",
    successorMesocycleId: "successor-1",
    replaceEmptySuccessorFromAcceptedSeedDraft: true,
    ...overrides,
  });
}

describe("replaceEmptySuccessorFromAcceptedSeedDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.counts).forEach((key) => {
      mocks.counts[key as keyof typeof mocks.counts] = 0;
    });
    mocks.exerciseCatalog.clear();
    mocks.exerciseCatalog.set("barbell-bench", "Barbell Bench Press");
    mocks.exerciseCatalog.set("barbell-squat", "Barbell Back Squat");
    mocks.exerciseCatalog.set("incline-db-bench", "Incline Dumbbell Bench Press");
    mocks.txMesocycleFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      args.where?.id === "source-1" ? sourceMesocycle() : successorMesocycle(),
    );
  });

  it("dry-run returns safe_to_accept_upgrade for a completed source and empty active successor with stored V2 acceptedSeedDraft", async () => {
    const result = await runRecovery();

    expect(result.verdict).toBe("safe_to_accept_upgrade");
    expect(result.write.eligible).toBe(true);
    expect(result.guardSummary.blockers).toEqual([]);
    expect(result.guardSummary.targetEmpty).toBe(true);
    expect(result.guardSummary.slotOrderCompatible).toBe(true);
    expect(result.seedComparison.anchors.upperA.candidate).toMatchObject({
      exerciseName: "Barbell Bench Press",
      setCount: 4,
    });
    expect(result.seedComparison.anchors.lowerA.candidate).toMatchObject({
      exerciseName: "Barbell Back Squat",
      setCount: 4,
    });
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("uses the persisted acceptedSeedDraft and not fresh generated V2", async () => {
    const result = await runRecovery();

    expect(result.recoverySource).toMatchObject({
      replacementSource:
        "source.nextSeedDraftJson.acceptedSeedDraft.slotPlanSeedJson",
      freshV2Generated: false,
      persistedAcceptedSeedDraft: true,
      candidateSeedSource: "v2_materialized_seed",
    });
    expect(result.seedComparison.anchors.upperA.old).toMatchObject({
      exerciseName: "Incline Dumbbell Bench Press",
      setCount: 5,
    });
    expect(result.seedRuntimeBoundary.freshV2GenerationUsed).toBe(false);
  });

  it("fails when acceptedSeedDraft is missing", async () => {
    mocks.txMesocycleFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      args.where?.id === "source-1"
        ? sourceMesocycle({ version: 1 })
        : successorMesocycle(),
    );

    const result = await runRecovery();

    expect(result.verdict).toBe("not_safe_to_apply");
    expect(result.guardSummary.blockers).toContain("accepted_seed_draft_missing");
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("fails when acceptedSeedDraft is malformed", async () => {
    mocks.txMesocycleFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      args.where?.id === "source-1"
        ? sourceMesocycle({
            acceptedSeedDraft: {
              source: "v2_materialized_seed",
              slotPlanSeedJson: {
                version: 1,
                source: "v2_materialized_seed",
                slots: [{ slotId: "upper_a", exercises: "bad" }],
              },
            },
          })
        : successorMesocycle(),
    );

    const result = await runRecovery();

    expect(result.verdict).toBe("not_safe_to_apply");
    expect(result.guardSummary.blockers).toContain("replacement_seed_malformed");
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("fails when target successor has workouts, logs, or session check-ins", async () => {
    mocks.counts.workout = 1;
    mocks.counts.setLog = 1;
    mocks.counts.sessionCheckIn = 1;

    const result = await runRecovery();

    expect(result.verdict).toBe("not_safe_to_apply");
    expect(result.guardSummary.blockers).toEqual(
      expect.arrayContaining([
        "target_workouts_exist",
        "target_set_logs_exist",
        "target_session_check_ins_exist",
        "target_not_empty",
      ]),
    );
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("fails when exercise IDs are invalid", async () => {
    mocks.exerciseCatalog.delete("barbell-bench");

    const result = await runRecovery();

    expect(result.verdict).toBe("not_safe_to_apply");
    expect(result.guardSummary.blockers).toContain("replacement_seed_exercise_missing");
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("fails when setCount is missing", async () => {
    const missingSetCountSeed = {
      ...persistedAcceptedSeed,
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "barbell-bench", role: "CORE_COMPOUND" }],
        },
        persistedAcceptedSeed.slots[1],
      ],
    };
    mocks.txMesocycleFindFirst.mockImplementation(async (args: { where?: { id?: string } }) =>
      args.where?.id === "source-1"
        ? sourceMesocycle({
            acceptedSeedDraft: {
              source: "v2_materialized_seed",
              slotPlanSeedJson: missingSetCountSeed,
            },
          })
        : successorMesocycle(),
    );

    const result = await runRecovery();

    expect(result.verdict).toBe("not_safe_to_apply");
    expect(result.guardSummary.blockers).toContain("replacement_seed_set_count_missing");
    expect(result.guardSummary.blockers).toContain("replacement_seed_not_minimal");
    expect(mocks.txMesocycleUpdate).not.toHaveBeenCalled();
  });

  it("apply updates only the target successor slotPlanSeedJson", async () => {
    const result = await runRecovery({
      write: true,
      confirmAcceptedSeedDraftSuccessorRecovery: true,
    });

    expect(result.verdict).toBe("safe_to_accept_upgrade");
    expect(result.write).toMatchObject({
      dbWriteOccurred: true,
      transactionStatus: "success",
      updatedFields: ["slotPlanSeedJson"],
    });
    expect(mocks.txMesocycleUpdate).toHaveBeenCalledWith({
      where: { id: "successor-1" },
      data: { slotPlanSeedJson: persistedAcceptedSeed },
    });
  });

  it("apply does not create successors, workouts, logs, or sessions", async () => {
    const result = await runRecovery({
      write: true,
      confirmAcceptedSeedDraftSuccessorRecovery: true,
    });

    expect(result.safety).toMatchObject({
      newSuccessorCreated: false,
      workoutsLogsSessionsCreated: false,
      liveDbMutated: true,
    });
    expect(mocks.txMesocycleUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps runtime replay unchanged and seed rows minimal", async () => {
    const result = await runRecovery();

    expect(result.seedRuntimeBoundary).toMatchObject({
      executableRowFields: ["exerciseId", "role", "setCount"],
      runtimeReplayUnchanged: true,
      runtimeConsumesPlannerMetadata: false,
      acceptedSeedShapeChanged: false,
    });
    expect(result.guardSummary.replacementSeedMinimal).toBe(true);
    expect(JSON.stringify(persistedAcceptedSeed.slots)).not.toContain("lane");
  });
});
