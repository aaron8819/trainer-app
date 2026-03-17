import { describe, expect, it } from "vitest";

import {
  getLifecycleSetTargets,
  getRirTarget,
} from "@/lib/api/mesocycle-lifecycle";
import {
  CANONICAL_DELOAD_RIR_TARGET,
  CANONICAL_DELOAD_SET_MULTIPLIER,
  CANONICAL_DELOAD_SET_TARGETS,
} from "@/lib/deload/semantics";

import { getPrescriptionModifiers } from "./block-config";
import { buildBlockPrescriptionIntent } from "./block-prescription-intent";

describe("block-prescription-intent", () => {
  const mesocycle = {
    state: "ACTIVE_ACCUMULATION" as const,
    durationWeeks: 5,
  };

  it("authors canonical accumulation-week effort intent once for lifecycle and legacy bridges", () => {
    const profile = {
      blockType: "accumulation" as const,
      weekInBlock: 2,
      blockDurationWeeks: 2,
      isDeload: false,
    };

    const intent = buildBlockPrescriptionIntent(profile);

    expect(intent.rirTarget).toEqual(
      getRirTarget(mesocycle, 2, profile)
    );
    expect(intent.setTargets).toEqual(
      getLifecycleSetTargets(mesocycle.durationWeeks, 2, false, profile)
    );
    expect(intent.setMultiplier).toBe(1);
    expect(intent.modifiers).toEqual(
      getPrescriptionModifiers(profile.blockType, profile.weekInBlock, profile.blockDurationWeeks)
    );
  });

  it("keeps intensification week-2 lifecycle targets aligned with the legacy modifier bridge", () => {
    const profile = {
      blockType: "intensification" as const,
      weekInBlock: 2,
      blockDurationWeeks: 2,
      isDeload: false,
    };

    const intent = buildBlockPrescriptionIntent(profile);

    expect(intent.rirTarget).toEqual({ min: 0, max: 1 });
    expect(intent.setTargets).toEqual({ main: 5, accessory: 5 });
    expect(intent.setMultiplier).toBe(1.3);
    expect(intent.modifiers.volumeMultiplier).toBeCloseTo(0.8, 5);
    expect(intent.modifiers.intensityMultiplier).toBeCloseTo(0.95, 5);
    expect(intent.modifiers.rirAdjustment).toBe(-1);
    expect(intent.modifiers.restMultiplier).toBe(1);
  });

  it("keeps deload intent explicit across lifecycle targets and block modifiers", () => {
    const profile = {
      blockType: "deload" as const,
      weekInBlock: 1,
      blockDurationWeeks: 1,
      isDeload: true,
    };

    const intent = buildBlockPrescriptionIntent(profile);

    expect(intent.rirTarget).toEqual(CANONICAL_DELOAD_RIR_TARGET);
    expect(intent.setTargets).toEqual(CANONICAL_DELOAD_SET_TARGETS);
    expect(intent.setMultiplier).toBe(CANONICAL_DELOAD_SET_MULTIPLIER);
    expect(intent.modifiers).toEqual(
      getPrescriptionModifiers(profile.blockType, profile.weekInBlock, profile.blockDurationWeeks)
    );
  });
});
