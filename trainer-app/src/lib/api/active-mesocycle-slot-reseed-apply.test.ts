import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const txMesocycleFindFirst = vi.fn();
  const txMesocycleUpdate = vi.fn();
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      mesocycle: {
        findFirst: txMesocycleFindFirst,
        update: txMesocycleUpdate,
      },
    })
  );

  return {
    txMesocycleFindFirst,
    txMesocycleUpdate,
    transaction,
    prisma: {
      $transaction: transaction,
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

import { applyActiveMesocycleBoundedUpperSlotReseed } from "./active-mesocycle-slot-reseed-apply";

describe("applyActiveMesocycleBoundedUpperSlotReseed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
