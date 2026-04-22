import { describe, expect, it } from "vitest";
import {
  applyCalibrationToEstimate,
  resolveCalibrationConfidenceScale,
  resolveLoadCalibrationPolicy,
  resolveLoadEquipment,
  resolveProgressionEquipment,
} from "./load-calibration";

describe("load calibration", () => {
  it("prefers cable when equipment includes both cable and machine", () => {
    const exercise = { equipment: ["machine", "cable"], isCompound: false };

    expect(resolveLoadEquipment(exercise)).toBe("cable");
    expect(resolveProgressionEquipment(exercise)).toBe("cable");
    expect(resolveLoadCalibrationPolicy(exercise)).toMatchObject({
      equipment: "cable",
      reliabilityTier: "low",
    });
  });

  it("keeps barbell and dumbbell in the high-reliability tier", () => {
    expect(resolveLoadCalibrationPolicy({ equipment: ["barbell"] })).toMatchObject({
      reliabilityTier: "high",
      estimateScale: 1,
      earlyExposureConfidenceScale: 1,
    });
    expect(resolveLoadCalibrationPolicy({ equipment: ["dumbbell"] })).toMatchObject({
      reliabilityTier: "high",
      estimateScale: 1,
      earlyExposureConfidenceScale: 1,
    });
  });

  it("scales low-reliability estimates only for donor and cold-start sources", () => {
    const policy = resolveLoadCalibrationPolicy({ equipment: ["cable"], isCompound: false });

    expect(applyCalibrationToEstimate(40, policy, "cold_start")).toBe(34);
    expect(applyCalibrationToEstimate(40, policy, "donor")).toBe(34);
    expect(applyCalibrationToEstimate(40, policy, "baseline")).toBe(40);
    expect(applyCalibrationToEstimate(40, policy, "history")).toBe(40);
  });

  it("applies confidence scaling only during the first two prior sessions", () => {
    const policy = resolveLoadCalibrationPolicy({ equipment: ["cable"], isCompound: false });

    expect(resolveCalibrationConfidenceScale(policy, 1)).toBe(0.85);
    expect(resolveCalibrationConfidenceScale(policy, 2)).toBe(0.85);
    expect(resolveCalibrationConfidenceScale(policy, 3)).toBe(1);
  });

  it("leaves bodyweight policy unchanged", () => {
    const policy = resolveLoadCalibrationPolicy({ equipment: ["bodyweight", "machine"] });

    expect(policy).toMatchObject({
      equipment: "bodyweight",
      reliabilityTier: "bodyweight",
      estimateScale: 1,
      earlyExposureConfidenceScale: 1,
    });
  });
});
