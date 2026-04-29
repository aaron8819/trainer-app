import { describe, expect, it } from "vitest";
import { buildV2ExerciseClassDistributionBySlot } from "./exercise-class-distribution";
import { buildV2MesocycleDemand } from "./mesocycle-demand";
import { buildV2SlotDemandAllocationByWeek } from "./slot-demand-allocation";
import { buildV2TargetSkeleton } from "./target-skeleton";
import { buildV2WeeklyDemandCurve } from "./weekly-demand-curve";
import { buildV2WeeklyProgressionModel } from "./weekly-progression";

function buildClassDistribution() {
  const targetSkeleton = buildV2TargetSkeleton();
  const mesocycleDemand = buildV2MesocycleDemand({ targetSkeleton });
  const weeklyDemandCurve = buildV2WeeklyDemandCurve({
    mesocycleDemand,
    weeklyProgressionModel: buildV2WeeklyProgressionModel(),
  });
  const slotDemandAllocationByWeek = buildV2SlotDemandAllocationByWeek({
    targetSkeleton,
    weeklyDemandCurve,
  });
  return buildV2ExerciseClassDistributionBySlot({
    slotDemandAllocationByWeek,
  });
}

describe("buildV2ExerciseClassDistributionBySlot", () => {
  it("derives class lanes from slot demand and role policy, not selected exercises", () => {
    const distribution = buildClassDistribution();
    const week1UpperA = distribution.weeks[0].slots.find(
      (slot) => slot.slotId === "upper_a",
    );
    const chestLane = week1UpperA?.classLanes.find(
      (lane) => lane.laneId === "chest_anchor",
    );
    const rearDeltLane = week1UpperA?.classLanes.find(
      (lane) => lane.laneId === "rear_delt",
    );

    expect(distribution).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      distributionTiming: "before_exercise_selection",
      affectsScoringOrGeneration: false,
    });
    expect(chestLane).toMatchObject({
      role: "anchor",
      requiredExerciseClasses: ["horizontal_press", "slight_incline_press"],
      preferredSetSplit: "single_anchor",
      duplicatePolicy: "discourage_if_alternative_exists",
      source: expect.arrayContaining([
        "slot_demand_allocation_by_week",
        "v2_target_skeleton_lane_role_policy",
        "before_exact_exercise_selection",
      ]),
    });
    expect(rearDeltLane).toMatchObject({
      role: "accessory",
      preferredSetSplit: "direct_accessory",
      duplicatePolicy: "block_if_clean_alternative_exists",
    });
    expect(JSON.stringify(distribution)).not.toMatch(
      /exerciseId|exerciseName|selectedExercise|inventoryEvidence|repairEvidence|runtimeReplay/,
    );
  });

  it("keeps Lower B hinge_compound narrow while exposing a low-axial hip-extension anchor alternative", () => {
    const distribution = buildClassDistribution();
    const week1LowerB = distribution.weeks[0].slots.find(
      (slot) => slot.slotId === "lower_b",
    );
    const hingeAnchor = week1LowerB?.classLanes.find(
      (lane) => lane.laneId === "hinge_anchor",
    );
    const kneeFlexionCurl = week1LowerB?.classLanes.find(
      (lane) => lane.laneId === "knee_flexion_curl",
    );

    expect(hingeAnchor).toMatchObject({
      role: "anchor",
      requiredExerciseClasses: [
        "hinge_compound",
        "low_axial_hip_extension_anchor",
      ],
      preferredExerciseClasses: [
        "hinge_compound",
        "low_axial_hip_extension_anchor",
      ],
      primaryMuscles: ["Hamstrings", "Glutes"],
      preferredSetSplit: "single_anchor",
    });
    expect(kneeFlexionCurl).toMatchObject({
      role: "support",
      requiredExerciseClasses: ["hamstring_curl"],
      preferredExerciseClasses: ["hamstring_curl"],
      primaryMuscles: ["Hamstrings"],
      preferredSetSplit: "anchor_plus_support",
    });
  });
});
