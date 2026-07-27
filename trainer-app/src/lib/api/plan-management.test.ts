import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesocycleState } from "@prisma/client";

const mocks = vi.hoisted(() => {
  const macroCycleUpdateMany = vi.fn();
  const macroCycleFindFirst = vi.fn();
  const macroCycleCreate = vi.fn();
  const userFindUnique = vi.fn();
  const generateMacroCycle = vi.fn();
  const tx = {
    user: { findUnique: vi.fn() },
    macroCycle: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  return {
    macroCycleUpdateMany,
    macroCycleFindFirst,
    macroCycleCreate,
    userFindUnique,
    generateMacroCycle,
    tx,
    prisma: {
      user: { findUnique: userFindUnique },
      macroCycle: {
        create: macroCycleCreate,
        updateMany: macroCycleUpdateMany,
        findFirst: macroCycleFindFirst,
      },
      $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) =>
        operation(tx),
      ),
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/engine", () => ({
  generateMacroCycle: mocks.generateMacroCycle,
}));

import {
  archivePlan,
  createHypertrophyPlan,
  derivePlanLifecycle,
  loadPlanManagementData,
  loadPlanReview,
  renamePlan,
} from "./plan-management";

function mesocycle(
  id: string,
  state: MesocycleState,
  isActive = false,
  mesoNumber = 1,
) {
  return { id, state, isActive, mesoNumber };
}

describe("plan lifecycle derivation", () => {
  it("keeps generated plans PREPARING until explicit finalization", () => {
    expect(
      derivePlanLifecycle([
        mesocycle("meso-1", MesocycleState.ACTIVE_ACCUMULATION),
      ]),
    ).toEqual({
      status: "PREPARING",
      activeMesocycleId: null,
      reviewMesocycleId: "meso-1",
    });
  });

  it("marks exactly one valid active mesocycle READY", () => {
    expect(
      derivePlanLifecycle([
        mesocycle("meso-1", MesocycleState.ACTIVE_ACCUMULATION, true),
      ]),
    ).toMatchObject({
      status: "READY",
      activeMesocycleId: "meso-1",
    });
  });

  it("fails closed for ambiguous or handoff-conflicted plan state", () => {
    expect(derivePlanLifecycle([]).status).toBe("INVALID");
    expect(
      derivePlanLifecycle([
        mesocycle("meso-1", MesocycleState.ACTIVE_DELOAD),
      ]).status,
    ).toBe("INVALID");
    expect(
      derivePlanLifecycle([
        mesocycle("meso-1", MesocycleState.ACTIVE_ACCUMULATION, true, 1),
        mesocycle("meso-2", MesocycleState.ACTIVE_DELOAD, true, 2),
      ]).status,
    ).toBe("INVALID");
    expect(
      derivePlanLifecycle([
        mesocycle("meso-1", MesocycleState.AWAITING_HANDOFF),
      ]).status,
    ).toBe("HANDOFF_PENDING");
  });
});

describe("plan management persistence policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists only owner-scoped non-archived hypertrophy plans", async () => {
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: "plan-a",
      macroCycles: [],
    });

    await expect(loadPlanManagementData("user-1")).resolves.toEqual({
      activeMacroCycleId: "plan-a",
      plans: [],
    });
    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: expect.objectContaining({
        macroCycles: expect.objectContaining({
          where: {
            archivedAt: null,
            primaryGoal: "HYPERTROPHY",
          },
        }),
      }),
    });
  });

  it("creates a generated plan as inactive PREPARING without changing the active pointer", async () => {
    const startDate = new Date("2026-08-03T00:00:00.000Z");
    const endDate = new Date("2026-11-22T00:00:00.000Z");
    mocks.userFindUnique.mockResolvedValue({
      activeMacroCycleId: "plan-a",
      profile: { trainingAge: "INTERMEDIATE" },
    });
    mocks.generateMacroCycle.mockReturnValue({
      id: "plan-b",
      startDate,
      endDate,
      durationWeeks: 16,
      mesocycles: [
        {
          id: "meso-b1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 4,
          focus: "Accumulation",
          volumeTarget: "moderate",
          intensityBias: "moderate",
          blocks: [
            {
              id: "block-b1",
              blockNumber: 1,
              blockType: "accumulation",
              startWeek: 0,
              durationWeeks: 4,
              volumeTarget: "moderate",
              intensityBias: "moderate",
              adaptationType: "hypertrophy",
            },
          ],
        },
      ],
    });
    mocks.macroCycleCreate.mockResolvedValue({
      id: "plan-b",
      name: "Second Plan",
      primaryGoal: "HYPERTROPHY",
      startDate,
      endDate,
      durationWeeks: 16,
      createdAt: startDate,
      updatedAt: startDate,
      mesocycles: [
        mesocycle("meso-b1", MesocycleState.ACTIVE_ACCUMULATION),
      ],
    });

    await expect(
      createHypertrophyPlan({
        userId: "user-1",
        name: "Second Plan",
        startDate,
        durationWeeks: 16,
      }),
    ).resolves.toMatchObject({
      id: "plan-b",
      status: "PREPARING",
      isActive: false,
    });
    expect(mocks.generateMacroCycle).toHaveBeenCalledWith({
      userId: "user-1",
      startDate,
      durationWeeks: 16,
      trainingAge: "intermediate",
      primaryGoal: "hypertrophy",
    });
    expect(mocks.macroCycleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: "plan-b",
          userId: "user-1",
          name: "Second Plan",
          mesocycles: {
            create: [
              expect.objectContaining({
                id: "meso-b1",
                isActive: false,
              }),
            ],
          },
        }),
      }),
    );
  });

  it("resolves explicit review identity with the owner in the database predicate", async () => {
    mocks.userFindUnique.mockResolvedValue({ activeMacroCycleId: "plan-a" });
    mocks.macroCycleFindFirst.mockResolvedValue(null);

    await expect(loadPlanReview("user-1", "foreign-plan")).resolves.toBeNull();
    expect(mocks.macroCycleFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "foreign-plan",
          userId: "user-1",
          archivedAt: null,
          primaryGoal: "HYPERTROPHY",
        },
      }),
    );
  });

  it("normalizes stale rename failures into deterministic conflicts", async () => {
    mocks.macroCycleUpdateMany.mockResolvedValue({ count: 0 });
    mocks.macroCycleFindFirst.mockResolvedValue({
      updatedAt: new Date("2026-07-27T02:00:00.000Z"),
    });

    await expect(
      renamePlan({
        userId: "user-1",
        planId: "plan-a",
        name: "Renamed",
        expectedUpdatedAt: "2026-07-27T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "PLAN_MUTATION_CONFLICT",
      details: { currentUpdatedAt: "2026-07-27T02:00:00.000Z" },
    });
  });

  it("prevents archiving the active plan before any plan write", async () => {
    mocks.tx.user.findUnique.mockResolvedValue({
      activeMacroCycleId: "plan-a",
    });

    await expect(
      archivePlan({
        userId: "user-1",
        planId: "plan-a",
        expectedUpdatedAt: "2026-07-27T01:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "ACTIVE_PLAN_ARCHIVE_FORBIDDEN",
    });
    expect(mocks.tx.macroCycle.updateMany).not.toHaveBeenCalled();
  });
});
