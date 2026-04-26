import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const txMesocycleFindFirst = vi.fn();
  const txMesocycleUpdate = vi.fn();
  const txExerciseFindMany = vi.fn();
  const txWorkoutUpdate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      mesocycle: {
        findFirst: txMesocycleFindFirst,
        update: txMesocycleUpdate,
      },
      exercise: {
        findMany: txExerciseFindMany,
      },
      workout: {
        update: txWorkoutUpdate,
      },
    })
  );

  return {
    txMesocycleFindFirst,
    txMesocycleUpdate,
    txExerciseFindMany,
    txWorkoutUpdate,
    transaction,
    prisma: {
      $transaction: transaction,
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import {
  acceptActiveMesocycleSlotPlanSeedUpgrade,
  applyActiveMesocycleBoundedUpperSlotReseed,
  buildSlotPlanSeedUpgradeReplacement,
} from "./active-mesocycle-slot-reseed-apply";

describe("applyActiveMesocycleBoundedUpperSlotReseed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txExerciseFindMany.mockResolvedValue([
      { id: "incline-db-bench" },
      { id: "machine-press" },
      { id: "squat" },
      { id: "rdl" },
      { id: "leg-curl" },
      { id: "lateral-raise" },
    ]);
  });

  it("patches only the active upper slots when the dry-run verdict is safe", async () => {
    mocks.txMesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
          },
          {
            slotId: "lower_a",
            exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND" }],
          },
          {
            slotId: "upper_b",
            exercises: [{ exerciseId: "row", role: "CORE_COMPOUND" }],
          },
          {
            slotId: "lower_b",
            exercises: [{ exerciseId: "rdl", role: "CORE_COMPOUND" }],
          },
        ],
      },
    });

    const result = await applyActiveMesocycleBoundedUpperSlotReseed({
      userId: "user-1",
      activeMesocycleId: "meso-1",
      candidateSlotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "incline_press", role: "CORE_COMPOUND" }],
          },
          {
            slotId: "lower_a",
            exercises: [{ exerciseId: "leg_press", role: "ACCESSORY" }],
          },
          {
            slotId: "upper_b",
            exercises: [{ exerciseId: "lat_pulldown", role: "ACCESSORY" }],
          },
          {
            slotId: "lower_b",
            exercises: [{ exerciseId: "curl", role: "ACCESSORY" }],
          },
        ],
      },
      targetSlotIds: ["upper_a", "upper_b"],
      dryRunVerdict: "safe_to_apply_bounded_reseed",
    });

    expect(result).toEqual({
      mesocycleId: "meso-1",
      targetSlotIds: ["upper_a", "upper_b"],
      changedSlotIds: ["upper_a", "upper_b"],
      applied: true,
    });
    expect(mocks.txMesocycleUpdate).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: {
        slotPlanSeedJson: {
          version: 1,
          source: "handoff_slot_plan_projection",
          slots: [
            {
              slotId: "upper_a",
              exercises: [{ exerciseId: "incline_press", role: "CORE_COMPOUND" }],
            },
            {
              slotId: "lower_a",
              exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND" }],
            },
            {
              slotId: "upper_b",
              exercises: [{ exerciseId: "lat_pulldown", role: "ACCESSORY" }],
            },
            {
              slotId: "lower_b",
              exercises: [{ exerciseId: "rdl", role: "CORE_COMPOUND" }],
            },
          ],
        },
      },
    });
  });

  it("rejects apply when the dry-run verdict is not safe", async () => {
    await expect(
      applyActiveMesocycleBoundedUpperSlotReseed({
        userId: "user-1",
        activeMesocycleId: "meso-1",
        candidateSlotPlanSeedJson: null,
        targetSlotIds: ["upper_a", "upper_b"],
        dryRunVerdict: "not_safe_to_apply",
      })
    ).rejects.toThrow("ACTIVE_MESOCYCLE_RESEED_APPLY_REQUIRES_SAFE_VERDICT:not_safe_to_apply");

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects non-upper or partial target slot requests", async () => {
    await expect(
      applyActiveMesocycleBoundedUpperSlotReseed({
        userId: "user-1",
        activeMesocycleId: "meso-1",
        candidateSlotPlanSeedJson: {
          version: 1,
          source: "handoff_slot_plan_projection",
          slots: [],
        },
        targetSlotIds: ["upper_a"],
        dryRunVerdict: "safe_to_apply_bounded_reseed",
      })
    ).rejects.toThrow("ACTIVE_MESOCYCLE_RESEED_BOUNDED_TARGET_INVALID");
  });

  it("builds the same full replacement for the same mesocycle state across runs", () => {
    const persistedSeedRecord = {
      version: 1 as const,
      source: "handoff_slot_plan_projection",
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "incline-db-bench", role: "CORE_COMPOUND" as const, setCount: 5, hasExplicitName: false, hasExplicitSetCount: true }],
        },
        {
          slotId: "lower_a",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND" as const, setCount: 4, hasExplicitName: false, hasExplicitSetCount: true }],
        },
      ],
    };
    const candidateSeedRecord = {
      version: 1 as const,
      source: "handoff_slot_plan_projection",
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            { exerciseId: "incline-db-bench", role: "CORE_COMPOUND" as const, setCount: 3, hasExplicitName: false, hasExplicitSetCount: true },
            { exerciseId: "machine-press", role: "ACCESSORY" as const, setCount: 2, hasExplicitName: false, hasExplicitSetCount: true },
          ],
        },
        {
          slotId: "lower_a",
          exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND" as const, setCount: 4, hasExplicitName: false, hasExplicitSetCount: true }],
        },
      ],
    };

    expect(
      buildSlotPlanSeedUpgradeReplacement({ persistedSeedRecord, candidateSeedRecord })
    ).toEqual(
      buildSlotPlanSeedUpgradeReplacement({ persistedSeedRecord, candidateSeedRecord })
    );
  });

  it("accepts a full seed upgrade that splits a known 5-set incline stack into 3+2", async () => {
    mocks.txMesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              { exerciseId: "incline-db-bench", role: "CORE_COMPOUND", setCount: 5 },
            ],
          },
          {
            slotId: "lower_a",
            exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
          },
          {
            slotId: "upper_b",
            exercises: [{ exerciseId: "lateral-raise", role: "ACCESSORY", setCount: 3 }],
          },
          {
            slotId: "lower_b",
            exercises: [{ exerciseId: "rdl", role: "CORE_COMPOUND", setCount: 5 }],
          },
        ],
      },
    });

    const result = await acceptActiveMesocycleSlotPlanSeedUpgrade({
      userId: "user-1",
      activeMesocycleId: "meso-1",
      dryRunVerdict: "safe_to_accept_upgrade",
      candidateSlotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              { exerciseId: "incline-db-bench", role: "CORE_COMPOUND", setCount: 3 },
              { exerciseId: "machine-press", role: "ACCESSORY", setCount: 2 },
            ],
          },
          {
            slotId: "lower_a",
            exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
          },
          {
            slotId: "upper_b",
            exercises: [{ exerciseId: "lateral-raise", role: "ACCESSORY", setCount: 3 }],
          },
          {
            slotId: "lower_b",
            exercises: [
              { exerciseId: "rdl", role: "CORE_COMPOUND", setCount: 3 },
              { exerciseId: "leg-curl", role: "ACCESSORY", setCount: 2 },
            ],
          },
        ],
      },
    });

    expect(result).toEqual({
      mesocycleId: "meso-1",
      targetSlotIds: ["upper_a", "lower_a", "upper_b", "lower_b"],
      changedSlotIds: ["upper_a", "lower_b"],
      applied: true,
    });
    expect(mocks.txMesocycleUpdate).toHaveBeenCalledWith({
      where: { id: "meso-1" },
      data: {
        slotPlanSeedJson: {
          version: 1,
          source: "handoff_slot_plan_projection",
          slots: [
            {
              slotId: "upper_a",
              exercises: [
                { exerciseId: "incline-db-bench", role: "CORE_COMPOUND", setCount: 3 },
                { exerciseId: "machine-press", role: "ACCESSORY", setCount: 2 },
              ],
            },
            {
              slotId: "lower_a",
              exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
            },
            {
              slotId: "upper_b",
              exercises: [{ exerciseId: "lateral-raise", role: "ACCESSORY", setCount: 3 }],
            },
            {
              slotId: "lower_b",
              exercises: [
                { exerciseId: "rdl", role: "CORE_COMPOUND", setCount: 3 },
                { exerciseId: "leg-curl", role: "ACCESSORY", setCount: 2 },
              ],
            },
          ],
        },
      },
    });
  });

  it("rejects candidates that change slot identity or sequence", async () => {
    mocks.txMesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "incline-db-bench", role: "CORE_COMPOUND", setCount: 5 }],
          },
          {
            slotId: "lower_a",
            exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
          },
        ],
      },
    });

    await expect(
      acceptActiveMesocycleSlotPlanSeedUpgrade({
        userId: "user-1",
        activeMesocycleId: "meso-1",
        dryRunVerdict: "safe_to_accept_upgrade",
        candidateSlotPlanSeedJson: {
          version: 1,
          source: "handoff_slot_plan_projection",
          slots: [
            {
              slotId: "lower_a",
              exercises: [{ exerciseId: "squat", role: "CORE_COMPOUND", setCount: 4 }],
            },
            {
              slotId: "upper_a",
              exercises: [{ exerciseId: "incline-db-bench", role: "CORE_COMPOUND", setCount: 3 }],
            },
          ],
        },
      })
    ).rejects.toThrow("ACTIVE_MESOCYCLE_RESEED_SLOT_SEQUENCE_CHANGED");
  });

  it("requires explicit set counts so seeded runtime replay remains stable", async () => {
    mocks.txMesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "incline-db-bench", role: "CORE_COMPOUND", setCount: 5 }],
          },
        ],
      },
    });

    await expect(
      acceptActiveMesocycleSlotPlanSeedUpgrade({
        userId: "user-1",
        activeMesocycleId: "meso-1",
        dryRunVerdict: "safe_to_accept_upgrade",
        candidateSlotPlanSeedJson: {
          version: 1,
          source: "handoff_slot_plan_projection",
          slots: [
            {
              slotId: "upper_a",
              exercises: [{ exerciseId: "incline-db-bench", role: "CORE_COMPOUND" }],
            },
          ],
        },
      })
    ).rejects.toThrow(
      "ACTIVE_MESOCYCLE_RESEED_CANDIDATE_SET_COUNT_MISSING:upper_a:incline-db-bench"
    );
  });

  it("replaces only slotPlanSeedJson and does not mutate completed workout rows", async () => {
    mocks.txMesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      slotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "incline-db-bench", role: "CORE_COMPOUND", setCount: 5 }],
          },
        ],
      },
    });

    await acceptActiveMesocycleSlotPlanSeedUpgrade({
      userId: "user-1",
      activeMesocycleId: "meso-1",
      dryRunVerdict: "safe_to_accept_upgrade",
      candidateSlotPlanSeedJson: {
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [
              { exerciseId: "incline-db-bench", role: "CORE_COMPOUND", setCount: 3 },
              { exerciseId: "machine-press", role: "ACCESSORY", setCount: 2 },
            ],
          },
        ],
      },
    });

    expect(mocks.txMesocycleUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.txWorkoutUpdate).not.toHaveBeenCalled();
  });
});
