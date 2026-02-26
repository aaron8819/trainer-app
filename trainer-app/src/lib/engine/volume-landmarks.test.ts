import { describe, expect, it } from "vitest";
import { VOLUME_LANDMARKS, computeWeeklyVolumeTarget } from "./volume-landmarks";

describe("computeWeeklyVolumeTarget", () => {
  it("returns MEV at week 1 and MAV at the last accumulation week", () => {
    const lats = VOLUME_LANDMARKS["Lats"];
    expect(computeWeeklyVolumeTarget(lats, 1, 4, false)).toBe(lats.mev);
    // accumWeeks = 3, progress at w3 = (3-1)/(3-1) = 1 → MAV
    expect(computeWeeklyVolumeTarget(lats, 3, 4, false)).toBe(lats.mav);
  });

  it("returns MV during deload week", () => {
    const chest = VOLUME_LANDMARKS["Chest"];
    expect(computeWeeklyVolumeTarget(chest, 4, 4, true)).toBe(chest.mv);
  });

  it("W2 target for Rear Delts is 7 in a 5-week meso (mev=4, mav=12)", () => {
    const rearDelts = VOLUME_LANDMARKS["Rear Delts"];
    expect(rearDelts.mev).toBe(4);
    expect(rearDelts.mav).toBe(12);
    // mesoLength=5, accumWeeks=4, progress at w2 = (2-1)/(4-1) = 1/3
    // target = round(4 + 1/3 * (12-4)) = round(4 + 2.667) = round(6.667) = 7
    expect(computeWeeklyVolumeTarget(rearDelts, 2, 5, false)).toBe(7);
  });

  it("W2 target for Upper Back is 9 in a 5-week meso (mev=6, mav=14)", () => {
    const upperBack = VOLUME_LANDMARKS["Upper Back"];
    expect(upperBack.mev).toBe(6);
    expect(upperBack.mav).toBe(14);
    // mesoLength=5, accumWeeks=4, progress at w2 = 1/3
    // target = round(6 + 1/3 * (14-6)) = round(6 + 2.667) = round(8.667) = 9
    expect(computeWeeklyVolumeTarget(upperBack, 2, 5, false)).toBe(9);
  });

  it("ramps monotonically from MEV to MAV across accumulation weeks", () => {
    const muscles = ["Lats", "Upper Back", "Rear Delts", "Quads", "Hamstrings", "Biceps", "Triceps", "Chest"];
    const mesoLength = 5;
    for (const muscle of muscles) {
      const lm = VOLUME_LANDMARKS[muscle];
      const w1 = computeWeeklyVolumeTarget(lm, 1, mesoLength, false);
      const w2 = computeWeeklyVolumeTarget(lm, 2, mesoLength, false);
      const w3 = computeWeeklyVolumeTarget(lm, 3, mesoLength, false);
      const w4 = computeWeeklyVolumeTarget(lm, 4, mesoLength, false);
      expect(w1, `${muscle} w1`).toBe(lm.mev);
      expect(w2, `${muscle} w2>=w1`).toBeGreaterThanOrEqual(w1);
      expect(w3, `${muscle} w3>=w2`).toBeGreaterThanOrEqual(w2);
      expect(w4, `${muscle} w4>=w3`).toBeGreaterThanOrEqual(w3);
    }
  });
});
