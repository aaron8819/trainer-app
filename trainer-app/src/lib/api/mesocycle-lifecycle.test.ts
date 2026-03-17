import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mesocycleFindUnique = vi.fn();
  const mesocycleUpdate = vi.fn();
  const txMesoFindUnique = vi.fn();
  const txMesoUpdate = vi.fn();
  const txMesoCreate = vi.fn();
  const txConstraintsFindUnique = vi.fn();
  const txTrainingBlockCreateMany = vi.fn();
  const txRoleFindMany = vi.fn();
  const txRoleCreateMany = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      mesocycle: {
        findUnique: txMesoFindUnique,
        update: txMesoUpdate,
        create: txMesoCreate,
      },
      trainingBlock: {
        createMany: txTrainingBlockCreateMany,
      },
      constraints: {
        findUnique: txConstraintsFindUnique,
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
    txConstraintsFindUnique,
    txTrainingBlockCreateMany,
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
  deriveCurrentMesocycleSession,
  deriveNextAdvancingIntentByWeeklySubtraction,
  deriveNextAdvancingSession,
  getLifecycleSetTargets,
  getCurrentMesoWeek,
  getRirTarget,
  getWeeklyVolumeTarget,
  initializeNextMesocycle,
  transitionMesocycleState,
} from "./mesocycle-lifecycle";
import {
  CANONICAL_DELOAD_RIR_TARGET,
  CANONICAL_DELOAD_SET_TARGETS,
  CANONICAL_DELOAD_VOLUME_FRACTION,
} from "@/lib/deload/semantics";

describe("mesocycle-lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns mesocycle unchanged when below accumulation threshold", async () => {
    // Counter is pre-incremented in the save transaction; transitionMesocycleState only checks thresholds.
    // accumulationSessionsCompleted=3 is well below threshold (12) → no update, no state change.
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 3,
      deloadSessionsCompleted: 0,
      durationWeeks: 5,
      sessionsPerWeek: 3,
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.accumulationSessionsCompleted).toBe(3);
    expect(updated.state).toBe("ACTIVE_ACCUMULATION");
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
  });

  it("transitions ACTIVE_ACCUMULATION to ACTIVE_DELOAD at the duration-aware accumulation threshold", async () => {
    // durationWeeks=5 and sessionsPerWeek=3 => 4 accumulation weeks => threshold 12.
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_ACCUMULATION",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
      durationWeeks: 5,
      sessionsPerWeek: 3,
    });
    mocks.txMesoUpdate.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 0,
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("ACTIVE_DELOAD");
    // Counter write is absent — only state changes here.
    expect(mocks.txMesoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { state: "ACTIVE_DELOAD" },
      })
    );
  });

  it("transitions ACTIVE_DELOAD to AWAITING_HANDOFF at session 3 and persists handoff artifacts", async () => {
    // Save transaction has already incremented deloadSessionsCompleted to 3; transitionMesocycleState reads 3 >= threshold.
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "ACTIVE_DELOAD",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      focus: "Hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      isActive: true,
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      durationWeeks: 5,
      sessionsPerWeek: 3,
      daysPerWeek: 3,
      splitType: "PPL",
      macroCycle: { userId: "user-1" },
      blocks: [],
    });
    mocks.txMesoUpdate.mockResolvedValue({
      id: "m1",
      macroCycleId: "macro-1",
      mesoNumber: 1,
      startWeek: 0,
      durationWeeks: 5,
      focus: "Hypertrophy",
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
      isActive: false,
      state: "AWAITING_HANDOFF",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      sessionsPerWeek: 3,
      daysPerWeek: 3,
      splitType: "PPL",
      closedAt: new Date("2026-03-10T00:00:00.000Z"),
      handoffSummaryJson: { version: 1 },
      nextSeedDraftJson: { version: 1 },
    });
    mocks.txConstraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["PUSH", "PULL", "LEGS"],
    });
    mocks.txRoleFindMany.mockResolvedValue([]);

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("AWAITING_HANDOFF");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.txMesoCreate).not.toHaveBeenCalled();
    expect(mocks.txMesoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "AWAITING_HANDOFF",
          isActive: false,
          handoffSummaryJson: expect.objectContaining({ version: 1 }),
          nextSeedDraftJson: expect.objectContaining({ version: 1 }),
        }),
      })
    );
  });

  it("no-ops transition for already COMPLETED mesocycle", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "COMPLETED",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      durationWeeks: 5,
      sessionsPerWeek: 3,
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("COMPLETED");
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("no-ops transition for already AWAITING_HANDOFF mesocycle", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.txMesoFindUnique.mockResolvedValue({
      id: "m1",
      state: "AWAITING_HANDOFF",
      accumulationSessionsCompleted: 12,
      deloadSessionsCompleted: 3,
      durationWeeks: 5,
      sessionsPerWeek: 3,
    });

    const updated = await transitionMesocycleState("m1");
    expect(updated.state).toBe("AWAITING_HANDOFF");
    expect(mocks.txMesoUpdate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("derives current mesocycle week correctly for a 5-week mesocycle", () => {
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 0,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(1);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 3,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(2);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 6,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(3);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 9,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(4);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 12,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(4);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_DELOAD",
        accumulationSessionsCompleted: 12,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toBe(5);
  });

  it("derives current mesocycle week correctly for a 4-week mesocycle", () => {
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 0,
        sessionsPerWeek: 3,
        durationWeeks: 4,
      })
    ).toBe(1);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 3,
        sessionsPerWeek: 3,
        durationWeeks: 4,
      })
    ).toBe(2);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 6,
        sessionsPerWeek: 3,
        durationWeeks: 4,
      })
    ).toBe(3);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 9,
        sessionsPerWeek: 3,
        durationWeeks: 4,
      })
    ).toBe(3);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_DELOAD",
        accumulationSessionsCompleted: 9,
        sessionsPerWeek: 3,
        durationWeeks: 4,
      })
    ).toBe(4);
  });

  it("derives current mesocycle week correctly for a 6-week mesocycle", () => {
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 6,
        sessionsPerWeek: 3,
        durationWeeks: 6,
      })
    ).toBe(3);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 12,
        sessionsPerWeek: 3,
        durationWeeks: 6,
      })
    ).toBe(5);
    expect(
      getCurrentMesoWeek({
        state: "ACTIVE_DELOAD",
        accumulationSessionsCompleted: 15,
        sessionsPerWeek: 3,
        durationWeeks: 6,
      })
    ).toBe(6);
  });

  it("derives the canonical next advancing accumulation slot from lifecycle counters", () => {
    expect(
      deriveCurrentMesocycleSession({
        state: "ACTIVE_ACCUMULATION",
        accumulationSessionsCompleted: 7,
        deloadSessionsCompleted: 0,
        sessionsPerWeek: 3,
        durationWeeks: 5,
      })
    ).toEqual({
      week: 3,
      session: 2,
      phase: "ACCUMULATION",
    });
  });

  it("derives next advancing intent from the weekly schedule instead of legacy completedSessions", () => {
    expect(
      deriveNextAdvancingSession(
        {
          state: "ACTIVE_ACCUMULATION",
          accumulationSessionsCompleted: 7,
          deloadSessionsCompleted: 0,
          sessionsPerWeek: 3,
          durationWeeks: 5,
        },
        ["push", "pull", "legs"]
      )
    ).toEqual({
      week: 3,
      session: 2,
      phase: "ACCUMULATION",
      intent: "pull",
      scheduleIndex: 1,
    });
  });

  it("returns no next advancing intent when all unique weekly intents are already performed", () => {
    expect(
      deriveNextAdvancingIntentByWeeklySubtraction(
        ["pull", "push", "legs"],
        ["pull", "push", "legs"]
      )
    ).toEqual({
      intent: null,
      scheduleIndex: null,
      remainingIntents: [],
      usesSubtraction: true,
    });
  });

  it("falls back from subtraction for duplicate-intent schedules until slot identity exists", () => {
    expect(
      deriveNextAdvancingIntentByWeeklySubtraction(
        ["push", "pull", "push"],
        ["push"]
      )
    ).toEqual({
      intent: null,
      scheduleIndex: null,
      remainingIntents: ["push", "pull", "push"],
      usesSubtraction: false,
    });
  });

  it("derives deterministic current and next sessions for identical lifecycle counters", () => {
    const mesocycle = {
      state: "ACTIVE_ACCUMULATION" as const,
      accumulationSessionsCompleted: 10,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      durationWeeks: 5,
    };

    const firstCurrent = deriveCurrentMesocycleSession(mesocycle);
    const secondCurrent = deriveCurrentMesocycleSession(mesocycle);
    expect(firstCurrent).toEqual(secondCurrent);

    const firstNext = deriveNextAdvancingSession(mesocycle, ["push", "pull", "legs"]);
    const secondNext = deriveNextAdvancingSession(mesocycle, ["push", "pull", "legs"]);
    expect(firstNext).toEqual(secondNext);
  });

  it("uses evidence-based landmarks for rear delts, lats, and upper back", () => {
    const meso = { durationWeeks: 5 };

    expect(getWeeklyVolumeTarget(meso, "Rear delts", 1)).toBe(4);
    expect(getWeeklyVolumeTarget(meso, "Rear delts", 4)).toBe(12);
    expect(getWeeklyVolumeTarget(meso, "Lats", 1)).toBe(8);
    expect(getWeeklyVolumeTarget(meso, "Lats", 4)).toBe(16);
    expect(getWeeklyVolumeTarget(meso, "Upper Back", 1)).toBe(6);
    expect(getWeeklyVolumeTarget(meso, "Upper Back", 4)).toBe(14);
  });

  it("interpolates accumulation volume targets monotonically for all configured muscle groups", () => {
    const meso = { durationWeeks: 5 };
    const muscles = [
      "lats",
      "upper_back",
      "rear_delts",
      "biceps",
      "chest",
      "front_delts",
      "side_delts",
      "quads",
      "hamstrings",
      "glutes",
      "triceps",
      "calves",
      "core",
      "forearms",
      "adductors",
      "neck",
      "lower_back",
      "abductors",
      "abs",
      "traps",
      "rotator_cuff",
    ];

    for (const muscle of muscles) {
      const w1 = getWeeklyVolumeTarget(meso, muscle, 1);
      const w2 = getWeeklyVolumeTarget(meso, muscle, 2);
      const w3 = getWeeklyVolumeTarget(meso, muscle, 3);
      const w4 = getWeeklyVolumeTarget(meso, muscle, 4);
      expect(w2).toBeGreaterThanOrEqual(w1);
      expect(w3).toBeGreaterThanOrEqual(w2);
      expect(w4).toBeGreaterThanOrEqual(w3);

      const maxAllowedJump = (w4 - w1) / 2;
      expect(w2 - w1).toBeLessThanOrEqual(maxAllowedJump);
      expect(w3 - w2).toBeLessThanOrEqual(maxAllowedJump);
      expect(w4 - w3).toBeLessThanOrEqual(maxAllowedJump);
    }
  });

  it("keeps deload target near 45% of W4 volume", () => {
    const meso = { durationWeeks: 5 };
    const w4 = getWeeklyVolumeTarget(meso, "Lats", 4);
    const w5 = getWeeklyVolumeTarget(meso, "Lats", 5);
    expect(w5).toBe(Math.round(w4 * CANONICAL_DELOAD_VOLUME_FRACTION));
  });

  it("uses real block context to preserve the default 5-week target path", () => {
    const meso = { durationWeeks: 5 };
    const blockContext = {
      mesocycle: {
        blocks: [
          {
            blockType: "accumulation",
            startWeek: 0,
            durationWeeks: 2,
            volumeTarget: "high",
            intensityBias: "hypertrophy",
          },
          {
            blockType: "intensification",
            startWeek: 2,
            durationWeeks: 2,
            volumeTarget: "moderate",
            intensityBias: "hypertrophy",
          },
          {
            blockType: "deload",
            startWeek: 4,
            durationWeeks: 1,
            volumeTarget: "low",
            intensityBias: "hypertrophy",
          },
        ],
      },
    } as const;

    expect(getWeeklyVolumeTarget(meso, "Lats", 2, { blockContext })).toBe(11);
    expect(getWeeklyVolumeTarget(meso, "Lats", 3, { blockContext })).toBe(13);
    expect(getWeeklyVolumeTarget(meso, "Lats", 5, { blockContext })).toBe(7);
  });

  it("reduces targets in a realization block when block context includes a low-volume peak phase", () => {
    const meso = { durationWeeks: 6 };
    const blockContext = {
      mesocycle: {
        blocks: [
          {
            blockType: "accumulation",
            startWeek: 0,
            durationWeeks: 2,
            volumeTarget: "high",
            intensityBias: "hypertrophy",
          },
          {
            blockType: "intensification",
            startWeek: 2,
            durationWeeks: 2,
            volumeTarget: "moderate",
            intensityBias: "hypertrophy",
          },
          {
            blockType: "realization",
            startWeek: 4,
            durationWeeks: 1,
            volumeTarget: "low",
            intensityBias: "strength",
          },
          {
            blockType: "deload",
            startWeek: 5,
            durationWeeks: 1,
            volumeTarget: "low",
            intensityBias: "hypertrophy",
          },
        ],
      },
    } as const;

    expect(getWeeklyVolumeTarget(meso, "Lats", 4, { blockContext })).toBe(16);
    expect(getWeeklyVolumeTarget(meso, "Lats", 5, { blockContext })).toBeLessThan(
      getWeeklyVolumeTarget(meso, "Lats", 4, { blockContext })
    );
    expect(getWeeklyVolumeTarget(meso, "Lats", 5, { blockContext })).toBe(13);
  });

  it("uses mesocycle.blocks as the canonical block-aware target source without explicit blockContext", () => {
    const meso = {
      durationWeeks: 6,
      blocks: [
        {
          blockType: "ACCUMULATION",
          startWeek: 0,
          durationWeeks: 2,
          volumeTarget: "HIGH",
          intensityBias: "HYPERTROPHY",
        },
        {
          blockType: "INTENSIFICATION",
          startWeek: 2,
          durationWeeks: 2,
          volumeTarget: "MODERATE",
          intensityBias: "HYPERTROPHY",
        },
        {
          blockType: "REALIZATION",
          startWeek: 4,
          durationWeeks: 1,
          volumeTarget: "LOW",
          intensityBias: "STRENGTH",
        },
        {
          blockType: "DELOAD",
          startWeek: 5,
          durationWeeks: 1,
          volumeTarget: "LOW",
          intensityBias: "HYPERTROPHY",
        },
      ],
    };

    expect(getWeeklyVolumeTarget(meso, "Lats", 4)).toBe(16);
    expect(getWeeklyVolumeTarget(meso, "Lats", 5)).toBe(13);
    expect(getWeeklyVolumeTarget(meso, "Lats", 6)).toBe(7);
  });

  it("returns corrected default RIR bands for a 4-week mesocycle", () => {
    const meso = {
      state: "ACTIVE_ACCUMULATION" as const,
      durationWeeks: 4,
    };

    expect(getRirTarget(meso, 1)).toEqual({ min: 3, max: 4 });
    expect(getRirTarget(meso, 2)).toEqual({ min: 2, max: 3 });
    expect(getRirTarget(meso, 3)).toEqual({ min: 1, max: 2 });
    expect(getRirTarget(meso, 4)).toEqual(CANONICAL_DELOAD_RIR_TARGET);
  });

  it("returns corrected default RIR bands for a 5-week mesocycle", () => {
    const meso = {
      state: "ACTIVE_ACCUMULATION" as const,
      durationWeeks: 5,
    };

    expect(getRirTarget(meso, 1)).toEqual({ min: 3, max: 4 });
    expect(getRirTarget(meso, 2)).toEqual({ min: 2, max: 3 });
    expect(getRirTarget(meso, 3)).toEqual({ min: 1, max: 2 });
    expect(getRirTarget(meso, 4)).toEqual({ min: 0, max: 1 });
    expect(getRirTarget(meso, 5)).toEqual(CANONICAL_DELOAD_RIR_TARGET);
  });

  it("preserves current 5-week hypertrophy RIR and set progression when using the default block definitions", () => {
    const meso = {
      state: "ACTIVE_ACCUMULATION" as const,
      durationWeeks: 5,
    };

    expect(
      getRirTarget(meso, 1, {
        blockType: "accumulation",
        weekInBlock: 1,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ min: 3, max: 4 });
    expect(
      getRirTarget(meso, 2, {
        blockType: "accumulation",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ min: 2, max: 3 });
    expect(
      getRirTarget(meso, 3, {
        blockType: "intensification",
        weekInBlock: 1,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ min: 1, max: 2 });
    expect(
      getRirTarget(meso, 4, {
        blockType: "intensification",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ min: 0, max: 1 });
    expect(
      getRirTarget(meso, 5, {
        blockType: "deload",
        weekInBlock: 1,
        blockDurationWeeks: 1,
        isDeload: true,
      })
    ).toEqual(CANONICAL_DELOAD_RIR_TARGET);

    expect(
      getLifecycleSetTargets(5, 1, false, {
        blockType: "accumulation",
        weekInBlock: 1,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ main: 3, accessory: 2 });
    expect(
      getLifecycleSetTargets(5, 2, false, {
        blockType: "accumulation",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ main: 4, accessory: 3 });
    expect(
      getLifecycleSetTargets(5, 3, false, {
        blockType: "intensification",
        weekInBlock: 1,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ main: 5, accessory: 4 });
    expect(
      getLifecycleSetTargets(5, 4, false, {
        blockType: "intensification",
        weekInBlock: 2,
        blockDurationWeeks: 2,
        isDeload: false,
      })
    ).toEqual({ main: 5, accessory: 5 });
    expect(
      getLifecycleSetTargets(5, 5, true, {
        blockType: "deload",
        weekInBlock: 1,
        blockDurationWeeks: 1,
        isDeload: true,
      })
    ).toEqual(CANONICAL_DELOAD_SET_TARGETS);
  });

  it("returns corrected default RIR bands for a 6-week mesocycle", () => {
    const meso = {
      state: "ACTIVE_ACCUMULATION" as const,
      durationWeeks: 6,
    };

    expect(getRirTarget(meso, 1)).toEqual({ min: 3, max: 4 });
    expect(getRirTarget(meso, 2)).toEqual({ min: 2, max: 3 });
    expect(getRirTarget(meso, 3)).toEqual({ min: 1, max: 2 });
    expect(getRirTarget(meso, 4)).toEqual({ min: 0, max: 1 });
    expect(getRirTarget(meso, 5)).toEqual({ min: 0, max: 1 });
    expect(getRirTarget(meso, 6)).toEqual(CANONICAL_DELOAD_RIR_TARGET);
  });

  it("returns explicit 5-week hypertrophy set targets", () => {
    expect(getLifecycleSetTargets(5, 1)).toEqual({ main: 3, accessory: 2 });
    expect(getLifecycleSetTargets(5, 2)).toEqual({ main: 4, accessory: 3 });
    expect(getLifecycleSetTargets(5, 3)).toEqual({ main: 5, accessory: 4 });
    expect(getLifecycleSetTargets(5, 4)).toEqual({ main: 5, accessory: 5 });
    expect(getLifecycleSetTargets(5, 5, true)).toEqual(CANONICAL_DELOAD_SET_TARGETS);
  });

  it("initializeNextMesocycle is fenced so callers cannot bypass the handoff contract", async () => {
    await expect(
      initializeNextMesocycle({
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
      } as never)
    ).rejects.toThrow("MESOCYCLE_HANDOFF_REQUIRED");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
