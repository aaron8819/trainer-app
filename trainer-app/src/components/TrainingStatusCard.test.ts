import { describe, expect, it } from "vitest";
import { getVolumeDotClass } from "./TrainingStatusCard";

// Fixtures: mev=6, target=10, mav=16, mrv=20
const MEV = 6;
const TARGET = 10;
const MAV = 16;
const MRV = 20;

describe("getVolumeDotClass", () => {
  it("slate-300 — below MEV", () => {
    expect(getVolumeDotClass(0, TARGET, MEV, MAV, MRV)).toBe("bg-slate-300");
    expect(getVolumeDotClass(MEV - 1, TARGET, MEV, MAV, MRV)).toBe("bg-slate-300");
  });

  it("emerald-500 — at or between MEV and weekly target (on track)", () => {
    expect(getVolumeDotClass(MEV, TARGET, MEV, MAV, MRV)).toBe("bg-emerald-500");
    expect(getVolumeDotClass(TARGET, TARGET, MEV, MAV, MRV)).toBe("bg-emerald-500");
  });

  it("emerald-300 — above weekly target but within MAV (ahead of target)", () => {
    expect(getVolumeDotClass(TARGET + 1, TARGET, MEV, MAV, MRV)).toBe("bg-emerald-300");
    expect(getVolumeDotClass(MAV, TARGET, MEV, MAV, MRV)).toBe("bg-emerald-300");
  });

  it("amber-400 — above MAV but below MRV (near MRV)", () => {
    expect(getVolumeDotClass(MAV + 1, TARGET, MEV, MAV, MRV)).toBe("bg-amber-400");
    expect(getVolumeDotClass(MRV - 1, TARGET, MEV, MAV, MRV)).toBe("bg-amber-400");
  });

  it("rose-500 — at or above MRV", () => {
    expect(getVolumeDotClass(MRV, TARGET, MEV, MAV, MRV)).toBe("bg-rose-500");
    expect(getVolumeDotClass(MRV + 5, TARGET, MEV, MAV, MRV)).toBe("bg-rose-500");
  });

  it("boundary: target === mav — directSets at target is on-track (not ahead)", () => {
    // directSets > target is strictly greater; when directSets === target === mav it's NOT greater,
    // so the check falls through to the on-track state (emerald-500).
    expect(getVolumeDotClass(MAV, MAV, MEV, MAV, MRV)).toBe("bg-emerald-500");
    // directSets > MAV (=TARGET) → near MRV (amber-400)
    expect(getVolumeDotClass(MAV + 1, MAV, MEV, MAV, MRV)).toBe("bg-amber-400");
  });
});
