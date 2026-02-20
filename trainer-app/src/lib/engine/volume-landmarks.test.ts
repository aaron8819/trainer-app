import { describe, expect, it } from "vitest";
import { VOLUME_LANDMARKS, MUSCLE_SPLIT_MAP, computeWeeklyVolumeTarget } from "./volume-landmarks";

describe("VOLUME_LANDMARKS", () => {
  const muscles = Object.keys(VOLUME_LANDMARKS);

  it("has all 18 canonical muscles", () => {
    expect(muscles).toHaveLength(18);
    expect(muscles).toContain("Chest");
    expect(muscles).toContain("Lats");
    expect(muscles).toContain("Quads");
    expect(muscles).toContain("Biceps");
    expect(muscles).toContain("Core");
    expect(muscles).toContain("Abs");
    expect(muscles).toContain("Abductors");
  });

  it("maintains mev <= mav <= mrv for every muscle", () => {
    for (const [muscle, lm] of Object.entries(VOLUME_LANDMARKS)) {
      expect(lm.mev, `${muscle} mev <= mav`).toBeLessThanOrEqual(lm.mav);
      expect(lm.mav, `${muscle} mav <= mrv`).toBeLessThanOrEqual(lm.mrv);
    }
  });

  it("mv <= mev for every muscle (or both are 0)", () => {
    for (const [muscle, lm] of Object.entries(VOLUME_LANDMARKS)) {
      expect(lm.mv, `${muscle} mv <= mev`).toBeLessThanOrEqual(Math.max(lm.mev, lm.mv));
    }
  });

  it("has positive sraHours for every muscle", () => {
    for (const [muscle, lm] of Object.entries(VOLUME_LANDMARKS)) {
      expect(lm.sraHours, `${muscle} sraHours`).toBeGreaterThan(0);
    }
  });

  it("uses corrected landmark values for biceps mrv and hamstrings mev", () => {
    expect(VOLUME_LANDMARKS["Biceps"]?.mrv).toBe(26);
    expect(VOLUME_LANDMARKS["Hamstrings"]?.mev).toBe(6);
  });
});

describe("computeWeeklyVolumeTarget (G1: volume progression)", () => {
  // Chest: MEV=10, MAV=16, MV=6
  const chest = VOLUME_LANDMARKS["Chest"]!;

  it("returns MEV at week 1 of accumulation", () => {
    expect(computeWeeklyVolumeTarget(chest, 1, 4, false)).toBe(10);
  });

  it("ramps to midpoint at week 2 of a 4-week block", () => {
    // week 2, accumWeeks=3, progress=(2-1)/(3-1)=0.5 → MEV + 0.5*(MAV-MEV)=13
    expect(computeWeeklyVolumeTarget(chest, 2, 4, false)).toBe(13);
  });

  it("reaches MAV at the final accumulation week", () => {
    // week 3, accumWeeks=3, progress=1.0 → MAV=16
    expect(computeWeeklyVolumeTarget(chest, 3, 4, false)).toBe(16);
  });

  it("returns MV during deload regardless of week", () => {
    expect(computeWeeklyVolumeTarget(chest, 4, 4, true)).toBe(6);
    expect(computeWeeklyVolumeTarget(chest, 1, 4, true)).toBe(6);
  });

  it("returns at least MEV for muscles with MEV=0 (e.g. Glutes)", () => {
    const glutes = VOLUME_LANDMARKS["Glutes"]!;
    // MEV=0, MAV=8 — week 1 should be 0 (MEV), week 3 should be 8 (MAV)
    expect(computeWeeklyVolumeTarget(glutes, 1, 4, false)).toBe(0);
    expect(computeWeeklyVolumeTarget(glutes, 3, 4, false)).toBe(8);
  });
});

describe("MUSCLE_SPLIT_MAP", () => {
  it("covers all 18 muscles", () => {
    const mapped = Object.keys(MUSCLE_SPLIT_MAP);
    expect(mapped).toHaveLength(18);
    for (const muscle of Object.keys(VOLUME_LANDMARKS)) {
      expect(MUSCLE_SPLIT_MAP[muscle], `${muscle} mapped`).toBeDefined();
    }
  });

  it("maps push muscles correctly", () => {
    expect(MUSCLE_SPLIT_MAP["Chest"]).toBe("push");
    expect(MUSCLE_SPLIT_MAP["Front Delts"]).toBe("push");
    expect(MUSCLE_SPLIT_MAP["Side Delts"]).toBe("push");
    expect(MUSCLE_SPLIT_MAP["Triceps"]).toBe("push");
  });

  it("maps pull muscles correctly", () => {
    expect(MUSCLE_SPLIT_MAP["Lats"]).toBe("pull");
    expect(MUSCLE_SPLIT_MAP["Biceps"]).toBe("pull");
    expect(MUSCLE_SPLIT_MAP["Rear Delts"]).toBe("pull");
  });

  it("maps leg muscles correctly", () => {
    expect(MUSCLE_SPLIT_MAP["Quads"]).toBe("legs");
    expect(MUSCLE_SPLIT_MAP["Hamstrings"]).toBe("legs");
    expect(MUSCLE_SPLIT_MAP["Glutes"]).toBe("legs");
    expect(MUSCLE_SPLIT_MAP["Calves"]).toBe("legs");
  });
});
