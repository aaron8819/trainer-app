import { describe, expect, it } from "vitest";

import { parseSlotPlanSeedJson } from "./slot-plan-seed-parser";

describe("parseSlotPlanSeedJson", () => {
  it("parses and normalizes the canonical slot-plan seed shape", () => {
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: " upper_a ",
            exercises: [
              { exerciseId: " bench ", role: "CORE_COMPOUND" },
              { exerciseId: " row ", role: "ACCESSORY" },
            ],
          },
        ],
      })
    ).toEqual({
      version: 1,
      source: "handoff_slot_plan_projection",
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            { exerciseId: "bench", role: "CORE_COMPOUND" },
            { exerciseId: "row", role: "ACCESSORY" },
          ],
        },
      ],
    });
  });

  it("keeps source optional so callers own source fallback behavior", () => {
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
          },
        ],
      })
    ).toEqual({
      version: 1,
      source: undefined,
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
        },
      ],
    });
  });

  it("rejects invalid version, slots, ids, and roles", () => {
    expect(parseSlotPlanSeedJson(null)).toBeNull();
    expect(parseSlotPlanSeedJson({ version: 2, slots: [] })).toBeNull();
    expect(parseSlotPlanSeedJson({ version: 1, slots: null })).toBeNull();
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        slots: [{ slotId: " ", exercises: [] }],
      })
    ).toBeNull();
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "MAIN" }],
          },
        ],
      })
    ).toBeNull();
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "", role: "ACCESSORY" }],
          },
        ],
      })
    ).toBeNull();
  });
});
