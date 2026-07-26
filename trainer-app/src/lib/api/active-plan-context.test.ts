import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

import {
  claimSelectedPlanForTransitionInTransaction,
  resolveActivePlanContextInTransaction,
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

  it("atomically selects Plan B and activates only its target mesocycle", async () => {
    const mesocycleUpdateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const tx = {
      macroCycle: {
        findUnique: vi.fn(async () => ({ id: "plan-b", userId: "user-1" })),
      },
      mesocycle: {
        findUnique: vi.fn(async () => ({
          id: "meso-b",
          macroCycleId: "plan-b",
          state: "ACTIVE_ACCUMULATION",
          isActive: false,
        })),
        updateMany: mesocycleUpdateMany,
      },
      user: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
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

    expect(mesocycleUpdateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ macroCycleId: "plan-b" }),
      })
    );
  });

  it("returns a replayed success after an already-committed identical selection", async () => {
    const tx = {
      macroCycle: {
        findUnique: vi.fn(async () => ({ id: "plan-b", userId: "user-1" })),
      },
      mesocycle: {
        findUnique: vi.fn(async () => ({
          id: "meso-b",
          macroCycleId: "plan-b",
          state: "ACTIVE_ACCUMULATION",
          isActive: true,
        })),
        updateMany: vi.fn(),
      },
      user: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn(async () => ({
          activeMacroCycleId: "plan-b",
        })),
      },
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
    expect(tx.mesocycle.updateMany).not.toHaveBeenCalled();
  });
});
