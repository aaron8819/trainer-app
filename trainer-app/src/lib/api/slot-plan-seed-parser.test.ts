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
              { exerciseId: " bench ", name: " Incline DB Bench ", role: "CORE_COMPOUND", setCount: 4 },
              { exerciseId: " row ", name: " T-Bar Row ", role: "ACCESSORY", setCount: 3 },
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
            {
              exerciseId: "bench",
              name: "Incline DB Bench",
              role: "CORE_COMPOUND",
              setCount: 4,
              hasExplicitName: true,
              hasExplicitSetCount: true,
            },
            {
              exerciseId: "row",
              name: "T-Bar Row",
              role: "ACCESSORY",
              setCount: 3,
              hasExplicitName: true,
              hasExplicitSetCount: true,
            },
          ],
        },
      ],
    });
  });

  it("keeps source and setCount optional so callers own legacy fallback behavior", () => {
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
          exercises: [{
            exerciseId: "bench",
            role: "CORE_COMPOUND",
            hasExplicitName: false,
            hasExplicitSetCount: false,
          }],
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
    expect(
      parseSlotPlanSeedJson({
        version: 1,
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "ACCESSORY", setCount: 0 }],
          },
        ],
      })
    ).toBeNull();
  });
});
