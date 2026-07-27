import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import {
  claimSelectedPlanForTransitionInTransaction,
  resolveActivePlanContextInTransaction,
  selectSoleCreatedPlanInTransaction,
  selectActivePlanInTransaction,
} from "./active-plan-context";

function makeReader(input: {
  activeMacroCycleId: string | null;
  macroCycleOwnerId?: string;
  activeMesocycles?: unknown[];
  pendingHandoffs?: unknown[];
}) {
  const mesocycleFindMany = vi.fn(async (args: {
    where: { isActive?: boolean; macroCycleId: string };
  }) =>
    args.where.isActive
      ? input.activeMesocycles ?? []
      : input.pendingHandoffs ?? []
  );
  return {
    client: {
      user: {
        findUnique: vi.fn(async () => ({
          id: "user-1",
          email: "owner@test.local",
          activeMacroCycleId: input.activeMacroCycleId,
        })),
      },
      macroCycle: {
        findUnique: vi.fn(async () =>
          input.activeMacroCycleId
            ? {
                id: input.activeMacroCycleId,
                userId: input.macroCycleOwnerId ?? "user-1",
                name: "Plan B",
                archivedAt: null,
                startDate: new Date("2026-01-01"),
                endDate: new Date("2026-06-01"),
                durationWeeks: 20,
              }
            : null
        ),
      },
      mesocycle: { findMany: mesocycleFindMany },
    } as unknown as Prisma.TransactionClient,
    mesocycleFindMany,
  };
}

function activeMesocycle(id = "meso-b") {
  return {
    id,
    macroCycleId: "plan-b",
    state: "ACTIVE_ACCUMULATION",
    isActive: true,
    blocks: [],
    seedRevisions: [],
    currentSeedRevision: null,
    macroCycle: {
      id: "plan-b",
      userId: "user-1",
      name: "Plan B",
      archivedAt: null,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-06-01"),
      durationWeeks: 20,
      trainingAge: "INTERMEDIATE",
      primaryGoal: "HYPERTROPHY",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

describe("active plan context", () => {
  it("returns an explicit no-plan state", async () => {
    const { client } = makeReader({ activeMacroCycleId: null });

    await expect(
      resolveActivePlanContextInTransaction(client, "user-1")
    ).resolves.toMatchObject({
      status: "NO_SELECTED_PLAN",
      activeMacroCycle: null,
      activeMesocycle: null,
    });
  });

  it("resolves the selected plan and its single active mesocycle", async () => {
    const { client } = makeReader({
      activeMacroCycleId: "plan-b",
      activeMesocycles: [activeMesocycle()],
    });

    await expect(
      resolveActivePlanContextInTransaction(client, "user-1")
    ).resolves.toMatchObject({
      status: "READY",
      activeMacroCycle: { id: "plan-b" },
      activeMesocycle: { id: "meso-b" },
    });
  });

  it("fails closed when the selected plan has no active mesocycle", async () => {
    const { client } = makeReader({
      activeMacroCycleId: "plan-b",
      activeMesocycles: [],
    });

    await expect(
      resolveActivePlanContextInTransaction(client, "user-1")
    ).resolves.toMatchObject({
      status: "MISSING_ACTIVE_MESOCYCLE",
      activeMacroCycle: { id: "plan-b" },
    });
  });

  it("fails closed when the selected plan belongs to another owner", async () => {
    const { client, mesocycleFindMany } = makeReader({
      activeMacroCycleId: "plan-b",
      macroCycleOwnerId: "user-2",
    });

    await expect(
      resolveActivePlanContextInTransaction(client, "user-1")
    ).resolves.toMatchObject({
      status: "CORRUPT_STATE",
      reason: "SELECTED_PLAN_NOT_OWNED",
    });
    expect(mesocycleFindMany).not.toHaveBeenCalled();
  });

  it("returns an explicit corrupt state for duplicate active mesocycles", async () => {
    const { client } = makeReader({
      activeMacroCycleId: "plan-b",
      activeMesocycles: [activeMesocycle("meso-b1"), activeMesocycle("meso-b2")],
    });

    await expect(
      resolveActivePlanContextInTransaction(client, "user-1")
    ).resolves.toMatchObject({
      status: "CORRUPT_STATE",
      reason: "MULTIPLE_ACTIVE_MESOCYCLES",
      affectedMesocycleIds: ["meso-b1", "meso-b2"],
    });
  });

  it("returns handoff pending only for the selected plan", async () => {
    const { client } = makeReader({
      activeMacroCycleId: "plan-b",
      activeMesocycles: [],
      pendingHandoffs: [
        {
          id: "meso-b",
          macroCycleId: "plan-b",
          mesoNumber: 1,
          state: "AWAITING_HANDOFF",
          closedAt: new Date(),
        },
      ],
    });

    await expect(
      resolveActivePlanContextInTransaction(client, "user-1")
    ).resolves.toMatchObject({
      status: "HANDOFF_PENDING",
      handoff: { id: "meso-b", macroCycleId: "plan-b" },
    });
  });

  it("returns an explicit completed state when every selected-plan mesocycle is complete", async () => {
    const { client } = makeReader({
      activeMacroCycleId: "plan-b",
      activeMesocycles: [],
      pendingHandoffs: [
        {
          id: "meso-b",
          macroCycleId: "plan-b",
          mesoNumber: 1,
          state: "COMPLETED",
          closedAt: new Date(),
        },
      ],
    });

    await expect(
      resolveActivePlanContextInTransaction(client, "user-1")
    ).resolves.toMatchObject({
      status: "COMPLETED",
      completedMesocycleIds: ["meso-b"],
    });
  });

  it("does not discover a handoff from an unselected plan", async () => {
    const { client, mesocycleFindMany } = makeReader({
      activeMacroCycleId: "plan-b",
      activeMesocycles: [activeMesocycle()],
    });

    const result = await resolveActivePlanContextInTransaction(
      client,
      "user-1"
    );

    expect(result.status).toBe("READY");
    expect(mesocycleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ macroCycleId: "plan-b" }),
      })
    );
  });
});

describe("active plan selection transition", () => {
  it("does not auto-select a newly created plan when another owned plan already exists", async () => {
    const macroCycleFindUnique = vi.fn();
    const mesocycleFindMany = vi.fn();
    const userUpdateMany = vi.fn();
    const tx = {
      user: {
        findUnique: vi.fn(async () => ({ activeMacroCycleId: null })),
        updateMany: userUpdateMany,
      },
      macroCycle: {
        count: vi.fn(async () => 2),
        findUnique: macroCycleFindUnique,
      },
      mesocycle: {
        findMany: mesocycleFindMany,
        updateMany: vi.fn(),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      selectSoleCreatedPlanInTransaction(tx, {
        userId: "user-1",
        targetMacroCycleId: "plan-b",
        targetMesocycleId: "meso-b",
      })
    ).resolves.toBeNull();
    expect(macroCycleFindUnique).not.toHaveBeenCalled();
    expect(mesocycleFindMany).not.toHaveBeenCalled();
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it("delegates sole first-plan auto-selection to the canonical transaction owner", async () => {
    const tx = {
      user: {
        findUnique: vi.fn(async () => ({ activeMacroCycleId: null })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      macroCycle: {
        count: vi.fn(async () => 1),
        findUnique: vi.fn(async () => ({
          id: "plan-a",
          userId: "user-1",
          archivedAt: null,
          primaryGoal: "HYPERTROPHY",
        })),
      },
      mesocycle: {
        findMany: vi.fn(async () => [
          {
            id: "meso-a",
            macroCycleId: "plan-a",
            state: "ACTIVE_ACCUMULATION",
            isActive: true,
          },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      workout: { findFirst: vi.fn(async () => null) },
    } as unknown as Prisma.TransactionClient;

    await expect(
      selectSoleCreatedPlanInTransaction(tx, {
        userId: "user-1",
        targetMacroCycleId: "plan-a",
        targetMesocycleId: "meso-a",
      })
    ).resolves.toMatchObject({
      activeMacroCycleId: "plan-a",
      activeMesocycleId: "meso-a",
      replayed: false,
    });
  });

  it("rejects a lifecycle mutation for an unselected plan", async () => {
    const tx = {
      user: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => ({
          activeMacroCycleId: "plan-b",
        })),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      claimSelectedPlanForTransitionInTransaction(tx, {
        userId: "user-1",
        macroCycleId: "plan-a",
      })
    ).rejects.toMatchObject({
      message: "ACTIVE_PLAN_SELECTION_CONFLICT",
      currentActiveMacroCycleId: "plan-b",
    });
  });

  it("atomically selects a READY Plan B without mutating its plan structure", async () => {
    const tx = {
      macroCycle: {
        findUnique: vi.fn(async () => ({
          id: "plan-b",
          userId: "user-1",
          archivedAt: null,
          primaryGoal: "HYPERTROPHY",
        })),
      },
      mesocycle: {
        findMany: vi.fn(async () => [
          {
            id: "meso-b",
            macroCycleId: "plan-b",
            state: "ACTIVE_ACCUMULATION",
            isActive: true,
          },
        ]),
      },
      user: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      workout: { findFirst: vi.fn(async () => null) },
    } as unknown as Prisma.TransactionClient;

    await expect(
      selectActivePlanInTransaction(tx, {
        userId: "user-1",
        targetMacroCycleId: "plan-b",
        targetMesocycleId: "meso-b",
        expectedActiveMacroCycleId: "plan-a",
      })
    ).resolves.toEqual({
      activeMacroCycleId: "plan-b",
      activeMesocycleId: "meso-b",
      replayed: false,
    });

    expect(tx.workout.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", status: "IN_PROGRESS" },
      }),
    );
  });

  it("returns a replayed success after an already-committed identical selection", async () => {
    const tx = {
      macroCycle: {
        findUnique: vi.fn(async () => ({
          id: "plan-b",
          userId: "user-1",
          archivedAt: null,
          primaryGoal: "HYPERTROPHY",
        })),
      },
      mesocycle: {
        findMany: vi.fn(async () => [
          {
            id: "meso-b",
            macroCycleId: "plan-b",
            state: "ACTIVE_ACCUMULATION",
            isActive: true,
          },
        ]),
      },
      user: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => ({
          activeMacroCycleId: "plan-b",
        })),
      },
      workout: { findFirst: vi.fn(async () => null) },
    } as unknown as Prisma.TransactionClient;

    await expect(
      selectActivePlanInTransaction(tx, {
        userId: "user-1",
        targetMacroCycleId: "plan-b",
        targetMesocycleId: "meso-b",
        expectedActiveMacroCycleId: "plan-a",
      })
    ).resolves.toEqual({
      activeMacroCycleId: "plan-b",
      activeMesocycleId: "meso-b",
      replayed: true,
    });
    expect(tx.workout.findFirst).not.toHaveBeenCalled();
  });

  it("rejects activation when the target plan is not READY", async () => {
    const tx = {
      macroCycle: {
        findUnique: vi.fn(async () => ({
          id: "plan-b",
          userId: "user-1",
          archivedAt: null,
          primaryGoal: "HYPERTROPHY",
        })),
      },
      mesocycle: {
        findMany: vi.fn(async () => [
          {
            id: "meso-b",
            macroCycleId: "plan-b",
            state: "ACTIVE_ACCUMULATION",
            isActive: false,
          },
        ]),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      selectActivePlanInTransaction(tx, {
        userId: "user-1",
        targetMacroCycleId: "plan-b",
        targetMesocycleId: "meso-b",
        expectedActiveMacroCycleId: "plan-a",
      }),
    ).rejects.toMatchObject({ message: "ACTIVE_PLAN_TARGET_NOT_READY" });
  });

  it("rolls back switching while any owner workout is in progress", async () => {
    const tx = {
      macroCycle: {
        findUnique: vi.fn(async () => ({
          id: "plan-b",
          userId: "user-1",
          archivedAt: null,
          primaryGoal: "HYPERTROPHY",
        })),
      },
      mesocycle: {
        findMany: vi.fn(async () => [
          {
            id: "meso-b",
            macroCycleId: "plan-b",
            state: "ACTIVE_ACCUMULATION",
            isActive: true,
          },
        ]),
      },
      user: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      workout: {
        findFirst: vi.fn(async () => ({ id: "workout-in-progress" })),
      },
    } as unknown as Prisma.TransactionClient;

    await expect(
      selectActivePlanInTransaction(tx, {
        userId: "user-1",
        targetMacroCycleId: "plan-b",
        targetMesocycleId: "meso-b",
        expectedActiveMacroCycleId: "plan-a",
      }),
    ).rejects.toMatchObject({
      message: "ACTIVE_WORKOUT_IN_PROGRESS",
      workoutId: "workout-in-progress",
    });
  });
});
