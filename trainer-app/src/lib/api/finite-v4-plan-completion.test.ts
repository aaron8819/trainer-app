import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimSelectedPlanForTransitionInTransaction: vi.fn(),
  enterMesocycleHandoffInTransaction: vi.fn(),
  resolveV4ScheduleAuthority: vi.fn(),
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
vi.mock("./v4-scheduled-slot-resolution", () => ({
  resolveV4ScheduleAuthority: mocks.resolveV4ScheduleAuthority,
}));

import {
  completeFiniteV4PlanInTransaction,
  completeOrEnterHandoffInTransaction,
  finishDeloadEarlyInTransaction,
  finishMesocycleEarlyInTransaction,
} from "./mesocycle-lifecycle-state";

const closedAt = new Date("2026-08-20T12:00:00.000Z");

function v4Seed() {
  return { version: 4, source: "custom_hypertrophy_plan_v2" };
}

function lifecycleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "meso-final",
    macroCycleId: "plan-1",
    mesoNumber: 2,
    startWeek: 5,
    durationWeeks: 5,
    sessionsPerWeek: 4,
    state: "ACTIVE_DELOAD",
    isActive: true,
    closedAt: null,
    handoffSummaryJson: null,
    nextSeedDraftJson: null,
    currentSeedRevisionId: "revision-2",
    currentSeedRevision: {
      id: "revision-2",
      revision: 2,
      seedPayload: v4Seed(),
      payloadHash: "hash-2",
      hashAlgorithm: "sha256",
      provenanceStatus: "exact",
    },
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
    mocks.resolveV4ScheduleAuthority.mockReturnValue({
      status: "available",
      authority: { revisionId: "revision-2" },
    });
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
        id: "meso-final",
        state: "COMPLETED",
        isActive: false,
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
    },
  );

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
      expect(mocks.enterMesocycleHandoffInTransaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["not at macro end", { durationWeeks: 4 }],
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
    ],
    ["handoff data already exists", { handoffSummaryJson: { version: 1 } }],
  ])("falls through when %s", async (_label, overrides) => {
    const { tx, updateMany } = transaction(lifecycleRow(overrides));

    const result = await completeFiniteV4PlanInTransaction(tx as never, {
      mesocycleId: "meso-final",
      expectedState: "ACTIVE_DELOAD",
    });

    expect(result).toBeNull();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it.each(["not_v4", "blocked"] as const)(
    "falls through when accepted revision authority is %s",
    async (status) => {
      mocks.resolveV4ScheduleAuthority.mockReturnValue(
        status === "blocked"
          ? { status, reason: "accepted_revision_hash_mismatch" }
          : { status },
      );
      const { tx, updateMany } = transaction();

      await expect(
        completeFiniteV4PlanInTransaction(tx as never, {
          mesocycleId: "meso-final",
          expectedState: "ACTIVE_DELOAD",
        }),
      ).resolves.toBeNull();
      expect(updateMany).toHaveBeenCalledTimes(1);
    },
  );

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

    expect(result).toBe(completed);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it("falls back to the unchanged hypertrophy handoff for malformed V4 authority", async () => {
    mocks.resolveV4ScheduleAuthority.mockReturnValue({
      status: "blocked",
      reason: "accepted_revision_payload_invalid",
    });
    const { tx } = transaction();

    const result = await completeOrEnterHandoffInTransaction(tx as never, {
      id: "meso-final",
      state: "ACTIVE_DELOAD",
      macroCycle: { primaryGoal: "HYPERTROPHY" },
      currentSeedRevision: { seedPayload: v4Seed() },
    });

    expect(result).toMatchObject({ state: "AWAITING_HANDOFF" });
    expect(mocks.enterMesocycleHandoffInTransaction).toHaveBeenCalledWith(
      tx,
      "meso-final",
    );
  });

  it("stops before lifecycle writes when selected-plan ownership changes", async () => {
    mocks.claimSelectedPlanForTransitionInTransaction.mockRejectedValue(
      new Error("ACTIVE_PLAN_SELECTION_CONFLICT"),
    );
    const { tx, updateMany } = transaction();

    await expect(
      completeFiniteV4PlanInTransaction(tx as never, {
        mesocycleId: "meso-final",
        expectedState: "ACTIVE_DELOAD",
      }),
    ).rejects.toThrow("ACTIVE_PLAN_SELECTION_CONFLICT");
    expect(updateMany).not.toHaveBeenCalled();
  });
});
