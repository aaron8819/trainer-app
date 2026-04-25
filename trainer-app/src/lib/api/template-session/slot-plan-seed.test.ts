import { describe, expect, it, vi } from "vitest";

import { resolveRequiredSeededSlotPlan } from "./slot-plan-seed";
import type { MappedGenerationContext } from "./types";

function makeMapped(slotPlanSeedJson: unknown): MappedGenerationContext {
  return {
    activeMesocycle: {
      slotPlanSeedJson,
      slotSequenceJson: {
        version: 1,
        source: "handoff_draft",
        sequenceMode: "ordered_flexible",
        slots: [{ slotId: "upper_a", intent: "UPPER" }],
      },
    },
    mappedConstraints: {
      weeklySchedule: ["upper"],
    },
    exerciseLibrary: [
      {
        id: "bench",
        name: "Bench Press",
        movementPatterns: ["horizontal_push"],
        splitTags: ["upper"],
        jointStress: "medium",
        isMainLiftEligible: true,
        isCompound: true,
        fatigueCost: 4,
        equipment: ["barbell"],
        primaryMuscles: ["Chest"],
        secondaryMuscles: ["Triceps"],
      },
    ],
    history: [],
  } as unknown as MappedGenerationContext;
}

describe("resolveRequiredSeededSlotPlan", () => {
  it("returns explicit set-count overrides for set-aware seeds", () => {
    const resolved = resolveRequiredSeededSlotPlan({
      mapped: makeMapped({
        version: 1,
        source: "handoff_slot_plan_projection",
        slots: [
          {
            slotId: "upper_a",
            exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND", setCount: 5 }],
          },
        ],
      }),
      sessionIntent: "upper",
      slotId: "upper_a",
    });

    expect(resolved).toMatchObject({
      slotId: "upper_a",
      setCountOverrides: { bench: 5 },
      usesLegacySetCountFallback: false,
    });
  });

  it("marks missing setCount as legacy fallback and logs the compatibility path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const resolved = resolveRequiredSeededSlotPlan({
        mapped: makeMapped({
          version: 1,
          source: "handoff_slot_plan_projection",
          slots: [
            {
              slotId: "upper_a",
              exercises: [{ exerciseId: "bench", role: "CORE_COMPOUND" }],
            },
          ],
        }),
        sessionIntent: "upper",
        slotId: "upper_a",
      });

      expect(resolved).toMatchObject({
        slotId: "upper_a",
        usesLegacySetCountFallback: true,
      });
      expect(resolved && !("error" in resolved) ? resolved.setCountOverrides : "error").toBeUndefined();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("missing setCount for seeded runtime replay")
      );
    } finally {
      warn.mockRestore();
    }
  });
});
