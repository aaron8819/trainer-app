import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimSelectedPlanForTransitionInTransaction: vi.fn(),
  enterMesocycleHandoffInTransaction: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("./active-plan-context", async (importOriginal) => {
  const original = await importOriginal<typeof import("./active-plan-context")>();
  return {
    ...original,
    claimSelectedPlanForTransitionInTransaction:
      mocks.claimSelectedPlanForTransitionInTransaction,
  };
});
vi.mock("./mesocycle-handoff", () => ({
  enterMesocycleHandoffInTransaction:
    mocks.enterMesocycleHandoffInTransaction,
}));
import {
  completeFiniteV4PlanInTransaction,
  completeOrEnterHandoffInTransaction,
  finishDeloadEarlyInTransaction,
  finishMesocycleEarlyInTransaction,
} from "./mesocycle-lifecycle-state";
import { normalizeAcceptedHypertrophySeedV4 } from "./mesocycle-seed-revision";
import {
  buildAcceptedCompatibilityProjections,
} from "@/lib/engine/hypertrophy-plan-authoring";
import { buildV4CustomPlanReferenceAcceptedSeed } from "@/lib/engine/hypertrophy-plan-authoring-v4.fixture";
import {
  applyV4TerminalScheduleResolution,
  lockV4MesocycleForScheduleResolution,
  resolveMesocycleForWorkoutSave,
} from "./save-workout/lifecycle";
import { persistWorkoutRow } from "./save-workout/persistence";
import {
  buildScheduledSlotReceipt,
  resolveV4ScheduleAuthority,
  type V4RequiredSlot,
  type V4ScheduleAuthority,
} from "./v4-scheduled-slot-resolution";

const closedAt = new Date("2026-08-20T12:00:00.000Z");

const acceptedV4Seed = buildV4CustomPlanReferenceAcceptedSeed();
const acceptedV4SeedNormalization =
  normalizeAcceptedHypertrophySeedV4(acceptedV4Seed);
const acceptedV4Compatibility =
  buildAcceptedCompatibilityProjections(acceptedV4Seed);

function v4Seed() {
  return acceptedV4Seed;
}

function lifecycleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "meso-final",
    macroCycleId: "plan-1",
    mesoNumber: 2,
    startWeek: 5,
    durationWeeks: 5,
    sessionsPerWeek: 4,
    completedSessions: 19,
    accumulationSessionsCompleted: 16,
    deloadSessionsCompleted: 3,
    state: "ACTIVE_DELOAD",
    isActive: true,
    closedAt: null,
    handoffSummaryJson: null,
    nextSeedDraftJson: null,
    currentSeedRevisionId: "revision-2",
    currentSeedRevision: {
      id: "revision-2",
      mesocycleId: "meso-final",
      revision: 2,
      seedPayload: v4Seed(),
      payloadHash: acceptedV4SeedNormalization.hash,
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
    },
    slotSequenceJson: acceptedV4Compatibility.slotSequenceJson,
    macroCycle: {
      id: "plan-1",
      userId: "user-1",
      primaryGoal: "HYPERTROPHY",
      durationWeeks: 10,
      mesocycles: [
        {
          id: "meso-1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          state: "COMPLETED",
        },
        {
          id: "meso-final",
          mesoNumber: 2,
          startWeek: 5,
          durationWeeks: 5,
          state: "ACTIVE_DELOAD",
        },
      ],
    },
    ...overrides,
  };
}

function scheduledWorkout(
  authority: V4ScheduleAuthority,
  slot: V4RequiredSlot,
  status: "COMPLETED" | "SKIPPED" | "PLANNED",
) {
  return {
    id: `workout-${slot.weekInMeso}-${slot.slotId}`,
    userId: "user-1",
    revision: 1,
    status,
    mesocycleId: authority.mesocycleId,
    mesocycleWeekSnapshot: slot.weekInMeso,
    mesocyclePhaseSnapshot: slot.phase,
    mesoSessionSnapshot: slot.sequenceIndex + 1,
    advancesSplit: true,
    selectionMode: "AUTO",
    sessionIntent: slot.intent.toUpperCase(),
    seedRevisionId: authority.revisionId,
    seedRevisionNumber: authority.revisionNumber,
    seedPayloadHash: authority.revisionHash,
    exercises: [],
    selectionMetadata: {
      sessionDecisionReceipt: {
        version: 2,
        cycleContext: {
          weekInMeso: slot.weekInMeso,
          weekInBlock: slot.phase === "DELOAD" ? 1 : slot.weekInMeso,
          mesocycleLength: 5,
          phase: slot.phase === "DELOAD" ? "deload" : "accumulation",
          blockType: slot.phase === "DELOAD" ? "deload" : "accumulation",
          isDeload: slot.phase === "DELOAD",
          source: "computed",
        },
        sessionProvenance: {
          mesocycleId: authority.mesocycleId,
          compositionSource:
            slot.phase === "DELOAD"
              ? "deload_seed_replay"
              : "persisted_slot_plan_seed",
          seedProvenance: {
            revisionId: authority.revisionId,
            revision: authority.revisionNumber,
            hash: authority.revisionHash,
          },
        },
        sessionSlot: {
          slotId: slot.slotId,
          intent: slot.intent,
          sequenceIndex: slot.sequenceIndex,
          sequenceLength: slot.sequenceLength,
          source: "mesocycle_slot_sequence",
        },
        scheduledSlotReceipt: buildScheduledSlotReceipt(authority, slot),
        lifecycleVolume: { source: "unknown" },
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: slot.phase === "DELOAD" ? "scheduled" : "none",
          reason: [],
          reductionPercent: 0,
          appliedTo: "none",
        },
        readiness: {
          wasAutoregulated: false,
          signalAgeHours: null,
          fatigueScoreOverall: null,
          intensityScaling: {
            applied: false,
            exerciseIds: [],
            scaledUpCount: 0,
            scaledDownCount: 0,
          },
        },
        exceptions: [],
      },
    },
  };
}

function integratedSaveHarness(overrides: Record<string, unknown> = {}) {
  const row = lifecycleRow(overrides);
  const authorityResolution = resolveV4ScheduleAuthority(row);
  if (authorityResolution.status !== "available") {
    throw new Error(`Invalid integration fixture: ${authorityResolution.status}`);
  }
  const authority = authorityResolution.authority;
  const finalSlot = authority.requiredSlots.at(-1)!;
  let state = {
    row,
    workouts: authority.requiredSlots.map((slot) =>
      scheduledWorkout(
        authority,
        slot,
        slot === finalSlot ? "PLANNED" : "COMPLETED",
      ),
    ),
  };
  let committedVersion = 0;

  const tx = {
    mesocycle: {
      findFirst: vi.fn(async () => state.row),
      findUnique: vi.fn(async (args: Record<string, unknown>) => {
        if ("include" in args) return structuredClone(state.row);
        const select = args.select as Record<string, unknown> | undefined;
        if (select?.macroCycleId && !select.id) {
          return {
            macroCycleId: state.row.macroCycleId,
            state: state.row.state,
            isActive: state.row.isActive,
            closedAt: state.row.closedAt,
            currentSeedRevision: {
              seedPayload: state.row.currentSeedRevision.seedPayload,
            },
            macroCycle: { userId: state.row.macroCycle.userId },
          };
        }
        return structuredClone(state.row);
      }),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const completedSessions = args.data.completedSessions as
          | { increment: number }
          | undefined;
        const deloadSessionsCompleted = args.data.deloadSessionsCompleted as
          | { increment: number }
          | undefined;
        if (completedSessions) {
          state.row.completedSessions += completedSessions.increment;
        }
        if (deloadSessionsCompleted) {
          state.row.deloadSessionsCompleted +=
            deloadSessionsCompleted.increment;
        }
        return state.row;
      }),
      updateMany: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const where = (args as { where?: Record<string, unknown> }).where;
        if (
          where?.state !== undefined &&
          (state.row.state !== where.state ||
            (where.currentSeedRevisionId !== undefined &&
              state.row.currentSeedRevisionId !== where.currentSeedRevisionId))
        ) {
          return { count: 0 };
        }
        if (args.data.state === "COMPLETED") {
          if (!state.row.isActive) {
            return { count: 0 };
          }
          state.row.state = "COMPLETED";
          state.row.isActive = false;
          state.row.closedAt = args.data.closedAt as never;
          state.row.macroCycle.mesocycles.at(-1)!.state = "COMPLETED";
        }
        return { count: 1 };
      }),
    },
    workout: {
      updateMany: vi.fn(
        async (args: {
          where: { id: string; revision: number; status: string };
          data: { status: "COMPLETED" | "SKIPPED"; revision: { increment: number } };
        }) => {
          const workout = state.workouts.find(
            (candidate) => candidate.id === args.where.id,
          );
          if (
            !workout ||
            workout.revision !== args.where.revision ||
            workout.status !== args.where.status
          ) {
            return { count: 0 };
          }
          workout.status = args.data.status;
          workout.revision += args.data.revision.increment;
          return { count: 1 };
        },
      ),
      findFirst: vi.fn(async (args: { where: { id: string } }) =>
        state.workouts.find((workout) => workout.id === args.where.id) ?? null,
      ),
      findMany: vi.fn(
        async (args?: { where?: { status?: { in?: string[] } } }) => {
          const statuses = args?.where?.status?.in;
          return statuses
            ? state.workouts.filter((workout) =>
                statuses.includes(workout.status),
              )
            : state.workouts;
        },
      ),
      update: vi.fn(
        async (args: {
          where: { id: string };
          data: { status: "SKIPPED"; selectionMetadata: unknown };
        }) => {
          const workout = state.workouts.find(
            (candidate) => candidate.id === args.where.id,
          );
          if (!workout) throw new Error("WORKOUT_NOT_FOUND");
          workout.status = args.data.status;
          workout.selectionMetadata = args.data.selectionMetadata as never;
          return workout;
        },
      ),
    },
  };

  return {
    authority,
    finalWorkoutId: `workout-${finalSlot.weekInMeso}-${finalSlot.slotId}`,
    mesocycleUpdateMany: tx.mesocycle.updateMany,
    state: () => state,
    transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => {
      const snapshot = structuredClone(state);
      const snapshotVersion = committedVersion;
      try {
        const result = await callback(tx);
        committedVersion += 1;
        return result;
      } catch (error) {
        if (committedVersion === snapshotVersion) state = snapshot;
        throw error;
      }
    },
  };
}

function transaction(row = lifecycleRow(), options: { lockCount?: number } = {}) {
  const completed = {
    ...row,
    state: "COMPLETED",
    isActive: false,
    closedAt,
  };
  const findUnique = vi
    .fn()
    .mockResolvedValueOnce({
      macroCycleId: "plan-1",
      state: row.state,
      isActive: row.isActive,
      closedAt: row.closedAt,
      currentSeedRevision: {
        seedPayload: row.currentSeedRevision?.seedPayload,
      },
      macroCycle: { userId: "user-1" },
    })
    .mockResolvedValueOnce(row)
    .mockResolvedValueOnce(completed);
  const updateMany = vi
    .fn()
    .mockResolvedValueOnce({ count: options.lockCount ?? 1 })
    .mockResolvedValueOnce({ count: 1 });
  return {
    tx: { mesocycle: { findUnique, updateMany } },
    findUnique,
    updateMany,
    completed,
  };
}

describe("finite accepted-V4 plan completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimSelectedPlanForTransitionInTransaction.mockResolvedValue(undefined);
    mocks.enterMesocycleHandoffInTransaction.mockResolvedValue({
      id: "meso-final",
      state: "AWAITING_HANDOFF",
    });
  });

  it.each(["ACTIVE_ACCUMULATION", "ACTIVE_DELOAD"] as const)(
    "completes a structurally final accepted V4 plan from %s",
    async (expectedState) => {
      const row = lifecycleRow({
        state: expectedState,
        macroCycle: {
          ...lifecycleRow().macroCycle,
          mesocycles: [
            lifecycleRow().macroCycle.mesocycles[0],
            {
              ...lifecycleRow().macroCycle.mesocycles[1],
              state: expectedState,
            },
          ],
        },
      });
      const { tx, updateMany } = transaction(row);

      const result = await completeFiniteV4PlanInTransaction(tx as never, {
        mesocycleId: "meso-final",
        expectedState,
      });

      expect(result).toMatchObject({
        status: "finite_v4_complete",
        mesocycle: {
          id: "meso-final",
          state: "COMPLETED",
          isActive: false,
        },
      });
      expect(updateMany).toHaveBeenNthCalledWith(2, {
        where: expect.objectContaining({
          id: "meso-final",
          state: expectedState,
          currentSeedRevisionId: "revision-2",
        }),
        data: {
          state: "COMPLETED",
          isActive: false,
          closedAt: expect.any(Date),
        },
      });
      expect(mocks.claimSelectedPlanForTransitionInTransaction).toHaveBeenCalledWith(
        tx,
        { userId: "user-1", macroCycleId: "plan-1" },
      );
      expect(
        mocks.claimSelectedPlanForTransitionInTransaction.mock.invocationCallOrder[0],
      ).toBeLessThan(updateMany.mock.invocationCallOrder[0]!);
    },
  );

  it.each(["COMPLETED", "SKIPPED"] as const)(
    "commits a natural final %s save through claim, lock, persistence, and lifecycle adapters",
    async (finalStatus) => {
      const harness = integratedSaveHarness();
      const originalPointer = harness.state().row.currentSeedRevisionId;
      let selectedPlanClaimed = false;
      mocks.claimSelectedPlanForTransitionInTransaction.mockImplementation(
        async () => {
          selectedPlanClaimed = true;
        },
      );
      harness.mesocycleUpdateMany.mockImplementationOnce(async () => {
        if (!selectedPlanClaimed) {
          throw new Error("TEST_MESOCYCLE_LOCK_BEFORE_SELECTED_PLAN_CLAIM");
        }
        return { count: 1 };
      });

      await harness.transaction(async (tx) => {
        const resolved = await resolveMesocycleForWorkoutSave(tx as never, {
          userId: "user-1",
          existingMesocycleId: harness.state().row.id,
          shouldResolve: true,
          shouldRequireForPerformedTransition: true,
        });
        await lockV4MesocycleForScheduleResolution(tx as never, {
          mesocycle: resolved.resolvedMesocycle as never,
          authority: harness.authority,
        });
        const existingWorkout = harness
          .state()
          .workouts.find((workout) => workout.id === harness.finalWorkoutId)!;
        await persistWorkoutRow(tx as never, {
          workoutId: existingWorkout.id,
          existingWorkout,
          userId: "user-1",
          expectedRevision: 1,
          shouldAdvanceLifecycleTransition: true,
          resolvedMesocycleId: harness.state().row.id,
          workoutUpdateData: { status: finalStatus },
          workoutCreateData: {},
        });
        await applyV4TerminalScheduleResolution(tx as never, {
          resolvedMesocycle: harness.state().row as never,
          authority: harness.authority,
          finalStatus,
        });
      });

      expect(harness.state().row).toMatchObject({
        state: "COMPLETED",
        isActive: false,
        closedAt: expect.any(Date),
        currentSeedRevisionId: originalPointer,
        completedSessions: finalStatus === "COMPLETED" ? 20 : 19,
        deloadSessionsCompleted: finalStatus === "COMPLETED" ? 4 : 3,
      });
      expect(
        harness.state().workouts.find(
          (workout) => workout.id === harness.finalWorkoutId,
        ),
      ).toMatchObject({ status: finalStatus, revision: 2 });
      expect(mocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
      expect(
        mocks.claimSelectedPlanForTransitionInTransaction.mock.invocationCallOrder[0],
      ).toBeLessThan(
        harness.mesocycleUpdateMany.mock.invocationCallOrder[0]!,
      );
    },
  );

  it.each([
    ["ACTIVE_ACCUMULATION", finishMesocycleEarlyInTransaction],
    ["ACTIVE_DELOAD", finishDeloadEarlyInTransaction],
  ] as const)(
    "serializes a natural final save racing the %s early-finish service boundary",
    async (state, finish) => {
      const harness = integratedSaveHarness({
        state,
        macroCycle: {
          ...lifecycleRow().macroCycle,
          mesocycles: [
            lifecycleRow().macroCycle.mesocycles[0],
            { ...lifecycleRow().macroCycle.mesocycles[1], state },
          ],
        },
      });
      let releaseNaturalClaim!: () => void;
      let signalNaturalClaim!: () => void;
      const naturalClaimEntered = new Promise<void>((resolve) => {
        signalNaturalClaim = resolve;
      });
      const naturalClaimGate = new Promise<void>((resolve) => {
        releaseNaturalClaim = resolve;
      });
      mocks.claimSelectedPlanForTransitionInTransaction
        .mockImplementationOnce(async () => {
          signalNaturalClaim();
          await naturalClaimGate;
        })
        .mockResolvedValue(undefined);

      const naturalSave = harness.transaction(async (tx) => {
        const resolved = await resolveMesocycleForWorkoutSave(tx as never, {
          userId: "user-1",
          existingMesocycleId: harness.state().row.id,
          shouldResolve: true,
          shouldRequireForPerformedTransition: true,
        });
        await lockV4MesocycleForScheduleResolution(tx as never, {
          mesocycle: resolved.resolvedMesocycle as never,
          authority: harness.authority,
        });
        const existingWorkout = harness
          .state()
          .workouts.find((workout) => workout.id === harness.finalWorkoutId)!;
        await persistWorkoutRow(tx as never, {
          workoutId: existingWorkout.id,
          existingWorkout,
          userId: "user-1",
          expectedRevision: 1,
          shouldAdvanceLifecycleTransition: true,
          resolvedMesocycleId: harness.state().row.id,
          workoutUpdateData: { status: "COMPLETED" },
          workoutCreateData: {},
        });
        await applyV4TerminalScheduleResolution(tx as never, {
          resolvedMesocycle: resolved.resolvedMesocycle as never,
          authority: harness.authority,
          finalStatus: "COMPLETED",
        });
      });
      await naturalClaimEntered;

      const earlyResult = await harness.transaction((tx) =>
        finish(tx as never, {
          userId: "user-1",
          mesocycleId: "meso-final",
        }),
      );
      releaseNaturalClaim();

      await expect(naturalSave).rejects.toThrow(
        "V4_SCHEDULE_AUTHORITY_CONFLICT",
      );
      expect(earlyResult.mesocycle).toMatchObject({
        state: "COMPLETED",
        isActive: false,
      });
      expect(harness.state().row).toMatchObject({
        state: "COMPLETED",
        isActive: false,
      });
      expect(
        harness.mesocycleUpdateMany.mock.calls.filter(
          ([input]) => input.data.state === "COMPLETED",
        ),
      ).toHaveLength(1);
      expect(
        mocks.claimSelectedPlanForTransitionInTransaction.mock.invocationCallOrder[1],
      ).toBeLessThan(
        harness.mesocycleUpdateMany.mock.invocationCallOrder[0]!,
      );
      expect(mocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
    },
  );

  it("rolls back the terminal workout and performed counters when finite V4 proof blocks", async () => {
    const harness = integratedSaveHarness({
      macroCycle: {
        ...lifecycleRow().macroCycle,
        mesocycles: [
          { ...lifecycleRow().macroCycle.mesocycles[0], durationWeeks: 4 },
          lifecycleRow().macroCycle.mesocycles[1],
        ],
      },
    });

    await expect(
      harness.transaction(async (tx) => {
        const existingWorkout = harness
          .state()
          .workouts.find((workout) => workout.id === harness.finalWorkoutId)!;
        await persistWorkoutRow(tx as never, {
          workoutId: existingWorkout.id,
          existingWorkout,
          userId: "user-1",
          expectedRevision: 1,
          shouldAdvanceLifecycleTransition: true,
          resolvedMesocycleId: harness.state().row.id,
          workoutUpdateData: { status: "COMPLETED" },
          workoutCreateData: {},
        });
        await applyV4TerminalScheduleResolution(tx as never, {
          resolvedMesocycle: harness.state().row as never,
          authority: harness.authority,
          finalStatus: "COMPLETED",
        });
      }),
    ).rejects.toThrow("V4_SCHEDULE_COMPLETION_BLOCKED:macro_mesocycle_gap");

    expect(harness.state().row).toMatchObject({
      state: "ACTIVE_DELOAD",
      isActive: true,
      closedAt: null,
      completedSessions: 19,
      deloadSessionsCompleted: 3,
    });
    expect(
      harness.state().workouts.find(
        (workout) => workout.id === harness.finalWorkoutId,
      ),
    ).toMatchObject({ status: "PLANNED", revision: 1 });
    expect(mocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
  });

  it("rolls back early-finish skips when finite V4 topology proof blocks", async () => {
    const harness = integratedSaveHarness({
      state: "ACTIVE_ACCUMULATION",
      macroCycle: {
        ...lifecycleRow().macroCycle,
        mesocycles: [
          { ...lifecycleRow().macroCycle.mesocycles[0], durationWeeks: 4 },
          {
            ...lifecycleRow().macroCycle.mesocycles[1],
            state: "ACTIVE_ACCUMULATION",
          },
        ],
      },
    });

    await expect(
      harness.transaction((tx) =>
        finishMesocycleEarlyInTransaction(tx as never, {
          userId: "user-1",
          mesocycleId: "meso-final",
        }),
      ),
    ).rejects.toThrow("V4_SCHEDULE_COMPLETION_BLOCKED:macro_mesocycle_gap");

    expect(harness.state().row).toMatchObject({
      state: "ACTIVE_ACCUMULATION",
      isActive: true,
      closedAt: null,
    });
    expect(
      harness.state().workouts.find(
        (workout) => workout.id === harness.finalWorkoutId,
      ),
    ).toMatchObject({ status: "PLANNED", revision: 1 });
    expect(mocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["ACTIVE_ACCUMULATION", finishMesocycleEarlyInTransaction],
    ["ACTIVE_DELOAD", finishDeloadEarlyInTransaction],
  ] as const)(
    "early-finishes a final V4 plan from %s without fabricating future workouts",
    async (state, finish) => {
      const row = lifecycleRow({
        state,
        macroCycle: {
          ...lifecycleRow().macroCycle,
          mesocycles: [
            lifecycleRow().macroCycle.mesocycles[0],
            { ...lifecycleRow().macroCycle.mesocycles[1], state },
          ],
        },
      });
      const { tx, updateMany } = transaction(row);
      const workoutUpdate = vi.fn();
      Object.assign(tx.mesocycle, {
        findFirst: vi.fn().mockResolvedValue({
          id: row.id,
          macroCycleId: row.macroCycleId,
          state,
          isActive: true,
          handoffSummaryJson: null,
          nextSeedDraftJson: null,
          closedAt: null,
          macroCycle: { primaryGoal: "HYPERTROPHY" },
          currentSeedRevision: { seedPayload: v4Seed() },
        }),
      });
      Object.assign(tx, {
        workout: {
          findMany: vi.fn().mockResolvedValue([]),
          update: workoutUpdate,
        },
      });

      const result = await finish(tx as never, {
        userId: "user-1",
        mesocycleId: row.id,
      });

      expect(result.mesocycle).toMatchObject({
        state: "COMPLETED",
        isActive: false,
      });
      expect(result.skippedWorkoutCount).toBe(0);
      expect(result.handoffSummaryCreated).toBe(false);
      expect(result.nextSeedDraftCreated).toBe(false);
      expect(workoutUpdate).not.toHaveBeenCalled();
      expect(updateMany).toHaveBeenCalledTimes(2);
      expect(
        mocks.claimSelectedPlanForTransitionInTransaction.mock.invocationCallOrder[0],
      ).toBeLessThan(updateMany.mock.invocationCallOrder[0]!);
      expect(mocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["unsupported V4 shape", { durationWeeks: 4 }, "unsupported_v4_topology"],
    [
      "later sibling exists",
      {
        macroCycle: {
          ...lifecycleRow().macroCycle,
          durationWeeks: 15,
          mesocycles: [
            ...lifecycleRow().macroCycle.mesocycles,
            {
              id: "meso-later",
              mesoNumber: 3,
              startWeek: 10,
              durationWeeks: 5,
              state: "ACTIVE_ACCUMULATION",
            },
          ],
        },
      },
      "later_mesocycle_exists",
    ],
    [
      "earlier sibling is incomplete",
      {
        macroCycle: {
          ...lifecycleRow().macroCycle,
          mesocycles: [
            {
              ...lifecycleRow().macroCycle.mesocycles[0],
              state: "ACTIVE_ACCUMULATION",
            },
            lifecycleRow().macroCycle.mesocycles[1],
          ],
        },
      },
      "earlier_mesocycle_incomplete",
    ],
    [
      "handoff data already exists",
      { handoffSummaryJson: { version: 1 } },
      "handoff_artifacts_present",
    ],
  ])("blocks when %s", async (_label, overrides, reason) => {
    const { tx, updateMany } = transaction(lifecycleRow(overrides));

    const result = await completeFiniteV4PlanInTransaction(tx as never, {
      mesocycleId: "meso-final",
      expectedState: "ACTIVE_DELOAD",
    });

    expect(result).toEqual({ status: "v4_blocked", reason });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("classifies a definitive non-V4 revision for legacy handoff", async () => {
    const row = lifecycleRow({
      currentSeedRevision: {
        ...lifecycleRow().currentSeedRevision,
        seedPayload: { version: 3 },
      },
    });
    const { tx, updateMany } = transaction(row);

    await expect(
      completeFiniteV4PlanInTransaction(tx as never, {
        mesocycleId: "meso-final",
        expectedState: "ACTIVE_DELOAD",
      }),
    ).resolves.toEqual({ status: "not_v4" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("preserves the legacy hypertrophy handoff for a definitive non-V4 revision", async () => {
    const row = lifecycleRow({
      currentSeedRevision: {
        ...lifecycleRow().currentSeedRevision,
        seedPayload: { version: 3 },
      },
    });
    const { tx } = transaction(row);

    await expect(
      completeOrEnterHandoffInTransaction(tx as never, {
        id: "meso-final",
        state: "ACTIVE_DELOAD",
        macroCycle: { primaryGoal: "HYPERTROPHY" },
        currentSeedRevision: { seedPayload: { version: 3 } },
      }),
    ).resolves.toMatchObject({ state: "AWAITING_HANDOFF" });
    expect(mocks.enterMesocycleHandoffInTransaction).toHaveBeenCalledWith(
      tx,
      "meso-final",
    );
  });

  it("blocks an invalid accepted V4 revision with the canonical resolver", async () => {
    const row = lifecycleRow({
      currentSeedRevision: {
        ...lifecycleRow().currentSeedRevision,
        payloadHash: "stale-hash",
      },
    });
    const { tx, updateMany } = transaction(row);

    await expect(
      completeFiniteV4PlanInTransaction(tx as never, {
        mesocycleId: "meso-final",
        expectedState: "ACTIVE_DELOAD",
      }),
    ).resolves.toEqual({
      status: "v4_blocked",
      reason: "accepted_revision_hash_mismatch",
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "accepted_revision_payload_invalid",
      {
        currentSeedRevision: {
          ...lifecycleRow().currentSeedRevision,
          seedPayload: { version: 4, source: "custom_hypertrophy_plan_v2" },
        },
      },
    ],
    [
      "accepted_revision_identity_invalid",
      { currentSeedRevisionId: "stale-revision-pointer" },
    ],
    [
      "lifecycle_state_ineligible",
      { state: "AWAITING_HANDOFF", isActive: false },
    ],
  ] as const)("blocks V4 completion with %s", async (reason, overrides) => {
    const { tx } = transaction(lifecycleRow(overrides));

    await expect(
      completeFiniteV4PlanInTransaction(tx as never, {
        mesocycleId: "meso-final",
        expectedState: "ACTIVE_DELOAD",
      }),
    ).resolves.toEqual({ status: "v4_blocked", reason });
  });

  it.each([
    [
      "accepted_revision_ownership_invalid",
      { mesocycleId: "different-mesocycle" },
    ],
    ["accepted_revision_number_invalid", { revision: 0 }],
  ] as const)(
    "blocks canonical revision proof with %s",
    async (reason, revisionOverride) => {
      const row = lifecycleRow({
        currentSeedRevision: {
          ...lifecycleRow().currentSeedRevision,
          ...revisionOverride,
        },
      });
      const { tx } = transaction(row);

      await expect(
        completeFiniteV4PlanInTransaction(tx as never, {
          mesocycleId: "meso-final",
          expectedState: "ACTIVE_DELOAD",
        }),
      ).resolves.toEqual({ status: "v4_blocked", reason });
    },
  );

  it.each([
    [
      "macro_first_mesocycle_start_invalid",
      {
        startWeek: 6,
        macroCycle: {
          ...lifecycleRow().macroCycle,
          durationWeeks: 11,
          mesocycles: [
            { ...lifecycleRow().macroCycle.mesocycles[0], startWeek: 1 },
            { ...lifecycleRow().macroCycle.mesocycles[1], startWeek: 6 },
          ],
        },
      },
    ],
    [
      "macro_mesocycle_gap",
      {
        macroCycle: {
          ...lifecycleRow().macroCycle,
          mesocycles: [
            { ...lifecycleRow().macroCycle.mesocycles[0], durationWeeks: 4 },
            lifecycleRow().macroCycle.mesocycles[1],
          ],
        },
      },
    ],
    [
      "macro_mesocycle_overlap",
      {
        macroCycle: {
          ...lifecycleRow().macroCycle,
          mesocycles: [
            { ...lifecycleRow().macroCycle.mesocycles[0], durationWeeks: 6 },
            lifecycleRow().macroCycle.mesocycles[1],
          ],
        },
      },
    ],
    [
      "macro_mesocycle_numbering_invalid",
      {
        macroCycle: {
          ...lifecycleRow().macroCycle,
          mesocycles: [
            lifecycleRow().macroCycle.mesocycles[0],
            { ...lifecycleRow().macroCycle.mesocycles[1], mesoNumber: 3 },
          ],
        },
      },
    ],
    [
      "macro_duration_boundary_mismatch",
      {
        macroCycle: {
          ...lifecycleRow().macroCycle,
          durationWeeks: 11,
        },
      },
    ],
  ] as const)("blocks invalid macro topology with %s", async (reason, overrides) => {
    const { tx } = transaction(lifecycleRow(overrides));

    await expect(
      completeFiniteV4PlanInTransaction(tx as never, {
        mesocycleId: "meso-final",
        expectedState: "ACTIVE_DELOAD",
      }),
    ).resolves.toEqual({ status: "v4_blocked", reason });
  });

  it("returns an already-completed exact retry without another terminal write", async () => {
    const completed = lifecycleRow({
      state: "COMPLETED",
      isActive: false,
      closedAt,
      macroCycle: {
        ...lifecycleRow().macroCycle,
        mesocycles: [
          lifecycleRow().macroCycle.mesocycles[0],
          {
            ...lifecycleRow().macroCycle.mesocycles[1],
            state: "COMPLETED",
          },
        ],
      },
    });
    const { tx, updateMany } = transaction(completed, { lockCount: 0 });

    const result = await completeFiniteV4PlanInTransaction(tx as never, {
      mesocycleId: "meso-final",
      expectedState: "ACTIVE_DELOAD",
    });

    expect(result).toEqual({
      status: "finite_v4_complete",
      mesocycle: completed,
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("blocks malformed V4 authority without entering hypertrophy handoff", async () => {
    const row = lifecycleRow({
      currentSeedRevision: {
        ...lifecycleRow().currentSeedRevision,
        payloadHash: "stale-hash",
      },
    });
    const { tx } = transaction(row);

    await expect(
      completeOrEnterHandoffInTransaction(tx as never, {
        id: "meso-final",
        state: "ACTIVE_DELOAD",
        macroCycle: { primaryGoal: "HYPERTROPHY" },
        currentSeedRevision: { seedPayload: v4Seed() },
      }),
    ).rejects.toThrow(
      "V4_SCHEDULE_COMPLETION_BLOCKED:accepted_revision_hash_mismatch",
    );
    expect(mocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
  });

  it("stops before lifecycle writes when selected-plan ownership changes", async () => {
    mocks.claimSelectedPlanForTransitionInTransaction.mockRejectedValue(
      new Error("ACTIVE_PLAN_SELECTION_CONFLICT"),
    );
    const { tx, updateMany } = transaction();

    await expect(
      completeOrEnterHandoffInTransaction(tx as never, {
        id: "meso-final",
        state: "ACTIVE_DELOAD",
        macroCycle: { primaryGoal: "HYPERTROPHY" },
        currentSeedRevision: { seedPayload: v4Seed() },
      }),
    ).rejects.toThrow("V4_SCHEDULE_COMPLETION_BLOCKED:selected_plan_conflict");
    expect(updateMany).not.toHaveBeenCalled();
    expect(mocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
  });
});
