import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mesocycleFindUnique = vi.fn();
  const mesocycleUpdate = vi.fn();
  const txMesoFindUnique = vi.fn();
  const txMesoUpdate = vi.fn();
  const txMesoCreate = vi.fn();
  const txRoleFindMany = vi.fn();
  const txRoleCreateMany = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      mesocycle: {
        findUnique: txMesoFindUnique,
        update: txMesoUpdate,
        create: txMesoCreate,
      },
      mesocycleExerciseRole: {
        findMany: txRoleFindMany,
        createMany: txRoleCreateMany,
      },
    })
  );

  return {
    mesocycleFindUnique,
    mesocycleUpdate,
    txMesoFindUnique,
    txMesoUpdate,
    txMesoCreate,
    txRoleFindMany,
    txRoleCreateMany,
    transaction,
    prisma: {
      mesocycle: {
        findUnique: mesocycleFindUnique,
        update: mesocycleUpdate,
      },
      $transaction: transaction,
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  getCurrentMesoWeek,
  getRirTarget,
  getWeeklyVolumeTarget,
  initializeNextMesocycle,
  transitionMesocycleState,
} from "./mesocycle-lifecycle";

describe("mesocycle-lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments accumulation counter for each performed transition call", async () => {
    mocks.mesocycleFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
    });
    mocks.mesocycleUpdate.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.accumulationSessionsCompleted).toBe(4);
    expect(mocks.mesocycleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accumulationSessionsCompleted: 4,
        }),
      })
    );
  });

  it("transitions ACTIVE_ACCUMULATION to ACTIVE_DELOAD at session 12", async () => {
    mocks.mesocycleFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 11,
      deloadSessionsCompleted: 0,
    });
    mocks.mesocycleUpdate.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("ACTIVE_DELOAD");
    expect(mocks.mesocycleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          accumulationSessionsCompleted: 12,
          state: "ACTIVE_DELOAD",
        },
      })
    );
  });

  it("transitions ACTIVE_DELOAD to COMPLETED at session 3 and initializes next mesocycle", async () => {
    mocks.mesocycleFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 2,
    });
    mocks.mesocycleUpdate.mockResolvedValue({
      id: "m1",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 5,
      focus: "Hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      isActive: true,
      state: "COMPLETED",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      sessionsPerWeek: 3,
      daysPerWeek: 3,
      splitType: "PPL",
      volumeRampConfig: { weekTargets: {} },
      rirBandConfig: { weekBands: {} },
    });

    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 5,
      focus: "Hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      sessionsPerWeek: 3,
      daysPerWeek: 3,
      splitType: "PPL",
      volumeRampConfig: { weekTargets: {} },
      rirBandConfig: { weekBands: {} },
    });
    mocks.txMesoCreate.mockResolvedValue({ id: "m2" });
    mocks.txRoleFindMany.mockResolvedValue([]);

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("COMPLETED");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.txMesoCreate).toHaveBeenCalledTimes(1);
  });

  it("no-ops transition for already COMPLETED mesocycle", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.mesocycleFindUnique.mockResolvedValue({
      id: "m1",
      state: "COMPLETED",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("COMPLETED");
    expect(mocks.mesocycleUpdate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("derives current mesocycle week correctly for sessions 0-12 and deload", () => {
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 0,
        sessionsPerWeek: 3,
      })
    ).toBe(1);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 3,
        sessionsPerWeek: 3,
      })
    ).toBe(2);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 6,
        sessionsPerWeek: 3,
      })
    ).toBe(3);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 9,
        sessionsPerWeek: 3,
      })
    ).toBe(4);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 12,
        sessionsPerWeek: 3,
      })
    ).toBe(4);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_DELOAD",
        accumulationSessionsCompleted: 12,
        sessionsPerWeek: 3,
      })
    ).toBe(5);
  });

  it("computes weekly volume targets for back/biceps/rear delts across all 5 weeks", () => {
    const meso = { volumeRampConfig: { weekTargets: {} } };

    expect(getWeeklyVolumeTarget(meso, "Back", 1)).toBe(10);
    expect(getWeeklyVolumeTarget(meso, "Back", 2)).toBe(12);
    expect(getWeeklyVolumeTarget(meso, "Back", 3)).toBe(14);
    expect(getWeeklyVolumeTarget(meso, "Back", 4)).toBe(22);
    expect(getWeeklyVolumeTarget(meso, "Back", 5)).toBe(10);

    expect(getWeeklyVolumeTarget(meso, "Biceps", 1)).toBe(8);
    expect(getWeeklyVolumeTarget(meso, "Biceps", 2)).toBe(10);
    expect(getWeeklyVolumeTarget(meso, "Biceps", 3)).toBe(12);
    expect(getWeeklyVolumeTarget(meso, "Biceps", 4)).toBe(20);
    expect(getWeeklyVolumeTarget(meso, "Biceps", 5)).toBe(9);

    expect(getWeeklyVolumeTarget(meso, "Rear delts", 1)).toBe(8);
    expect(getWeeklyVolumeTarget(meso, "Rear delts", 2)).toBe(10);
    expect(getWeeklyVolumeTarget(meso, "Rear delts", 3)).toBe(12);
    expect(getWeeklyVolumeTarget(meso, "Rear delts", 4)).toBe(18);
    expect(getWeeklyVolumeTarget(meso, "Rear delts", 5)).toBe(8);
  });

  it("returns correct RIR bands for all 5 weeks", () => {
    const meso = {
      state: "ACTIVE_ACCUMULATION" as const,
      rirBandConfig: {
        weekBands: {
          week1: { min: 3, max: 4 },
          week2: { min: 2, max: 3 },
          week3: { min: 2, max: 3 },
          week4: { min: 1, max: 2 },
          week5Deload: { min: 4, max: 6 },
        },
      },
    };

    expect(getRirTarget(meso, 1)).toEqual({ min: 3, max: 4 });
    expect(getRirTarget(meso, 2)).toEqual({ min: 2, max: 3 });
    expect(getRirTarget(meso, 3)).toEqual({ min: 2, max: 3 });
    expect(getRirTarget(meso, 4)).toEqual({ min: 1, max: 2 });
    expect(getRirTarget(meso, 5)).toEqual({ min: 4, max: 6 });
  });

  it("initializeNextMesocycle carries CORE_COMPOUND only and resets counters", async () => {
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      macroCycleId: "macro-1",
      mesoNumber: 3,
      startWeek: 10,
      durationWeeks: 5,
      focus: "Hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      sessionsPerWeek: 3,
      daysPerWeek: 3,
      splitType: "PPL",
      volumeRampConfig: { weekTargets: {} },
      rirBandConfig: { weekBands: {} },
    });
    mocks.txMesoCreate.mockResolvedValue({
      id: "m4",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 0,
      deloadSessionsCompleted: 0,
    });
    mocks.txRoleFindMany.mockResolvedValue([
      { exerciseId: "bench", sessionIntent: "PUSH", role: "CORE_COMPOUND" },
      { exerciseId: "row", sessionIntent: "PULL", role: "CORE_COMPOUND" },
    ]);

    const next = await initializeNextMesocycle({
      id: "m1",
      macroCycleId: "macro-1",
      mesoNumber: 3,
      durationWeeks: 5,
      focus: "Hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      isActive: true,
      state: "COMPLETED",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      sessionsPerWeek: 3,
      daysPerWeek: 3,
      splitType: "PPL",
      volumeRampConfig: { weekTargets: {} },
      rirBandConfig: { weekBands: {} },
    } as never);

    expect(next.id).toBe("m4");
    expect(mocks.txMesoUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { isActive: false },
    });
    expect(mocks.txMesoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "ACTIVE_ACCUMULATION",
          accumulationSessionsCompleted: 0,
          deloadSessionsCompleted: 0,
          isActive: true,
        }),
      })
    );
    expect(mocks.txRoleCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            mesocycleId: "m4",
            exerciseId: "bench",
            role: "CORE_COMPOUND",
            addedInWeek: 1,
          }),
          expect.objectContaining({
            mesocycleId: "m4",
            exerciseId: "row",
            role: "CORE_COMPOUND",
            addedInWeek: 1,
          }),
        ],
      })
    );
  });
});

