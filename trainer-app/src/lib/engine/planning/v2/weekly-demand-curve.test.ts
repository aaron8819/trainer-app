import { describe, expect, it } from "vitest";
import { buildV2MesocycleDemand } from "./mesocycle-demand";
import { buildV2TargetSkeleton } from "./target-skeleton";
import { buildV2WeeklyDemandCurve } from "./weekly-demand-curve";
import { buildV2WeeklyProgressionModel } from "./weekly-progression";

describe("buildV2WeeklyDemandCurve", () => {
  it("derives weekly demand from MesocycleDemand and progression policy only", () => {
    const mesocycleDemand = buildV2MesocycleDemand({
      targetSkeleton: buildV2TargetSkeleton(),
    });
    const curve = buildV2WeeklyDemandCurve({
      mesocycleDemand,
      weeklyProgressionModel: buildV2WeeklyProgressionModel(),
    });
    const week2Chest = curve.weeks[1].muscles.find(
      (muscle) => muscle.muscle === "Chest",
    );
    const week5Chest = curve.weeks[4].muscles.find(
      (muscle) => muscle.muscle === "Chest",
    );

    expect(curve.weeks.map((week) => week.week)).toEqual([1, 2, 3, 4, 5]);
    expect(curve.weeks[1]).toMatchObject({
      phase: "accumulation",
      volumeMultiplier: 1,
      projectionStatus: "projected_from_mesocycle_demand",
    });
    expect(week2Chest).toMatchObject({
      targetSetRange: { min: 7, preferred: 8, max: 10 },
      source: expect.arrayContaining([
        "mesocycle_demand",
        "v2_weekly_progression_model",
        "volume_landmarks",
        "muscle_target_tiers",
      ]),
    });
    expect(week5Chest).toMatchObject({
      targetSetRange: { min: 3.5, preferred: 4, max: 5 },
      source: expect.not.arrayContaining([
        "planningReality",
        "no_repair_output",
        "repaired_projection",
      ]),
    });
    expect(JSON.stringify(curve)).not.toMatch(
      /planningReality|noRepair|repairedProjection|slotPlanSeedJson|runtimeReplay/,
    );
  });
});
