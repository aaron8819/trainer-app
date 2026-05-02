import { describe, expect, it } from "vitest";

import { buildV2AcceptedPlannerIntentDto } from "@/lib/engine/planning/v2";
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

  it("parses and exposes valid optional accepted planner intent metadata", () => {
    const acceptedPlannerIntent = buildV2AcceptedPlannerIntentDto();

    expect(
      parseSlotPlanSeedJson({
        version: 1,
        source: "handoff_slot_plan_projection",
        acceptedPlannerIntent,
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
          },
        ],
      })?.acceptedPlannerIntent
    ).toEqual(acceptedPlannerIntent);
  });

  it("parses V2 source labels while keeping planner metadata outside executable rows", () => {
    const acceptedPlannerIntent = buildV2AcceptedPlannerIntentDto();
    const parsed = parseSlotPlanSeedJson({
      version: 1,
      source: "v2_materialized_seed",
      acceptedPlannerIntent,
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
        },
      ],
    });

    expect(parsed).toMatchObject({
      version: 1,
      source: "v2_materialized_seed",
      acceptedPlannerIntent,
      slots: [
        {
          slotId: "upper_a",
          exercises: [
            {
              exerciseId: "bench",
              role: "CORE_COMPOUND",
              setCount: 4,
              hasExplicitName: false,
              hasExplicitSetCount: true,
            },
          ],
        },
      ],
    });
    expect(parsed?.slots[0]?.exercises[0]).not.toHaveProperty(
      "acceptedPlannerIntent",
    );
  });

  it("ignores malformed optional accepted planner intent metadata while parsing valid slots", () => {
    const parsed = parseSlotPlanSeedJson({
      version: 1,
      source: "handoff_slot_plan_projection",
      acceptedPlannerIntent: {
        version: 1,
        source: "v2_planner_policy",
        targetSkeletonId: "upper_lower_4x_v2",
        weekPolicies: "malformed",
      },
      slots: [
        {
          slotId: "upper_a",
          exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 4 }],
        },
      ],
    });

    expect(parsed?.slots[0]?.exercises[0]).toMatchObject({
      exerciseId: "bench",
      role: "CORE_COMPOUND",
      setCount: 4,
    });
    expect(parsed?.acceptedPlannerIntent).toBeUndefined();
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
        acceptedPlannerIntent: buildV2AcceptedPlannerIntentDto(),
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
