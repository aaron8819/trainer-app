import { describe, expect, it } from "vitest";

import type { WeeklyVolumeTargetBlock } from "./volume-targets";

import {
  buildWeeklyVolumeTargetProfile,
  interpolateWeeklyVolumeTarget,
} from "./volume-targets";

const DEFAULT_FIVE_WEEK_BLOCKS: WeeklyVolumeTargetBlock[] = [
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
];

const DEFAULT_SIX_WEEK_BLOCKS: WeeklyVolumeTargetBlock[] = [
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
];

describe("buildWeeklyVolumeTargetProfile", () => {
  it("preserves the current 5-week accumulation to deload target ramp under default blocks", () => {
    const profile = buildWeeklyVolumeTargetProfile(5, {
      blocks: DEFAULT_FIVE_WEEK_BLOCKS,
    });

    expect(profile.source).toBe("block-aware");
    expect(profile.weekKinds).toEqual([
      "productive",
      "productive",
      "productive",
      "productive",
      "deload",
    ]);
    expect(profile.weekFractions).toEqual([0, 1 / 3, 2 / 3, 1, 0.45]);
  });

  it("reduces realization-week targets below the prior intensification peak in a 6-week block layout", () => {
    const profile = buildWeeklyVolumeTargetProfile(6, {
      blocks: DEFAULT_SIX_WEEK_BLOCKS,
    });

    expect(profile.source).toBe("block-aware");
    expect(profile.weekFractions[3]).toBe(1);
    expect(profile.weekFractions[4]).toBeLessThan(profile.weekFractions[3] ?? 1);
    expect(profile.weekFractions[4]).toBeCloseTo(0.616667, 5);
    expect(profile.weekKinds[5]).toBe("deload");
  });

  it("falls back to duration-only interpolation when block coverage is incomplete", () => {
    const profile = buildWeeklyVolumeTargetProfile(5, {
      blocks: [
        {
          blockType: "accumulation",
          startWeek: 0,
          durationWeeks: 2,
          volumeTarget: "high",
          intensityBias: "hypertrophy",
        },
      ],
    });

    expect(profile.source).toBe("duration-fallback");
    expect(profile.weekFractions).toEqual([0, 1 / 3, 2 / 3, 1, 0.45]);
  });
});

describe("interpolateWeeklyVolumeTarget", () => {
  const lats = {
    mev: 8,
    mav: 16,
    mrv: 24,
  };

  it("keeps default 5-week targets stable when the block layout matches the legacy progression", () => {
    expect(
      interpolateWeeklyVolumeTarget(lats, 5, 1, {
        blocks: DEFAULT_FIVE_WEEK_BLOCKS,
      })
    ).toBe(8);
    expect(
      interpolateWeeklyVolumeTarget(lats, 5, 2, {
        blocks: DEFAULT_FIVE_WEEK_BLOCKS,
      })
    ).toBe(11);
    expect(
      interpolateWeeklyVolumeTarget(lats, 5, 3, {
        blocks: DEFAULT_FIVE_WEEK_BLOCKS,
      })
    ).toBe(13);
    expect(
      interpolateWeeklyVolumeTarget(lats, 5, 4, {
        blocks: DEFAULT_FIVE_WEEK_BLOCKS,
      })
    ).toBe(16);
    expect(
      interpolateWeeklyVolumeTarget(lats, 5, 5, {
        blocks: DEFAULT_FIVE_WEEK_BLOCKS,
      })
    ).toBe(7);
  });

  it("drops weekly targets in a realization block instead of continuing the duration-only rise", () => {
    expect(
      interpolateWeeklyVolumeTarget(lats, 6, 4, {
        blocks: DEFAULT_SIX_WEEK_BLOCKS,
      })
    ).toBe(16);
    expect(
      interpolateWeeklyVolumeTarget(lats, 6, 5, {
        blocks: DEFAULT_SIX_WEEK_BLOCKS,
      })
    ).toBe(13);
    expect(
      interpolateWeeklyVolumeTarget(lats, 6, 6, {
        blocks: DEFAULT_SIX_WEEK_BLOCKS,
      })
    ).toBe(7);
  });
});
