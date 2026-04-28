import { describe, expect, it } from "vitest";
import { buildV2MesocycleDemand } from "./mesocycle-demand";
import { buildV2SlotDemandAllocationByWeek } from "./slot-demand-allocation";
import { buildV2TargetSkeleton } from "./target-skeleton";
import { buildV2WeeklyDemandCurve } from "./weekly-demand-curve";
import { buildV2WeeklyProgressionModel } from "./weekly-progression";

function buildAllocation() {
  const targetSkeleton = buildV2TargetSkeleton();
  const mesocycleDemand = buildV2MesocycleDemand({ targetSkeleton });
  const weeklyDemandCurve = buildV2WeeklyDemandCurve({
    mesocycleDemand,
    weeklyProgressionModel: buildV2WeeklyProgressionModel(),
  });
  return buildV2SlotDemandAllocationByWeek({
    targetSkeleton,
    weeklyDemandCurve,
  });
}

describe("buildV2SlotDemandAllocationByWeek", () => {
  it("allocates weeks 1-5 to slots and lanes before exercise selection", () => {
    const allocation = buildAllocation();
    const weekNumbers = allocation.weeks.map((week) => week.week);
    const week4LowerB = allocation.weeks[3].slots.find(
      (slot) => slot.slotId === "lower_b",
    );
    const hamstringsCurlLane = week4LowerB?.lanes.find(
      (lane) => lane.laneId === "knee_flexion_curl",
    );

    expect(allocation).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      allocationTiming: "before_exercise_selection",
      affectsScoringOrGeneration: false,
    });
    expect(weekNumbers).toEqual([1, 2, 3, 4, 5]);
    expect(allocation.weeks.every((week) => week.slots.length === 4)).toBe(true);
    expect(hamstringsCurlLane).toMatchObject({
      role: "support",
      preferredExerciseClasses: ["hamstring_curl"],
      allocatedMuscles: [
        expect.objectContaining({
          muscle: "Hamstrings",
          targetStatus: "hard",
          allocationBasis: "slot_role_policy",
        }),
      ],
    });
    expect(JSON.stringify(allocation)).not.toMatch(
      /exerciseId|exerciseName|selectedExercise|repairMateriality|slotPlanSeedJson/,
    );
  });
});
