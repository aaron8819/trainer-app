import { describe, expect, it } from "vitest";
import { buildV2ExerciseClassDistributionBySlot } from "./exercise-class-distribution";
import { buildV2MesocycleDemand } from "./mesocycle-demand";
import { buildV2SlotDemandAllocationByWeek } from "./slot-demand-allocation";
import { buildV2TargetSkeleton } from "./target-skeleton";
import type {
  V2ExerciseClassDistributionBySlot,
  V2PlannerSetRange,
  V2SlotDemandAllocationByWeek,
  V2WeeklyDemandCurve,
} from "./types";
import { buildV2WeeklyDemandCurve } from "./weekly-demand-curve";
import { buildV2WeeklyProgressionModel } from "./weekly-progression";

type ClassLane =
  V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number]["classLanes"][number];
type OwnershipRow = ClassLane["ownershipRows"][number];

function buildFixture(): {
  weeklyDemandCurve: V2WeeklyDemandCurve;
  slotDemandAllocationByWeek: V2SlotDemandAllocationByWeek;
  distribution: V2ExerciseClassDistributionBySlot;
} {
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
  const distribution = buildV2ExerciseClassDistributionBySlot({
    slotDemandAllocationByWeek,
  });

  return {
    weeklyDemandCurve,
    slotDemandAllocationByWeek,
    distribution,
  };
}

function buildClassDistribution() {
  return buildFixture().distribution;
}

function lane(
  distribution: V2ExerciseClassDistributionBySlot,
  slotId: string,
  laneId: string,
  weekNumber = 2,
): ClassLane {
  const found = distribution.weeks
    .find((week) => week.week === weekNumber)
    ?.slots.find((slot) => slot.slotId === slotId)
    ?.classLanes.find((classLane) => classLane.laneId === laneId);
  if (!found) {
    throw new Error(`Missing class lane ${weekNumber}:${slotId}:${laneId}`);
  }
  return found;
}

function lanesForSlot(
  distribution: V2ExerciseClassDistributionBySlot,
  slotId: string,
  weekNumber = 2,
): ClassLane[] {
  const slot = distribution.weeks
    .find((week) => week.week === weekNumber)
    ?.slots.find((row) => row.slotId === slotId);
  if (!slot) {
    throw new Error(`Missing class slot ${weekNumber}:${slotId}`);
  }
  return slot.classLanes;
}

function classOwnershipRows(
  distribution: V2ExerciseClassDistributionBySlot,
  weekNumber = 2,
): OwnershipRow[] {
  const week = distribution.weeks.find((row) => row.week === weekNumber);
  if (!week) {
    throw new Error(`Missing distribution week ${weekNumber}`);
  }
  return week.slots.flatMap((slot) =>
    slot.classLanes.flatMap((classLane) => classLane.ownershipRows),
  );
}

function allocationRows(
  allocation: V2SlotDemandAllocationByWeek,
  weekNumber = 2,
): Array<Omit<OwnershipRow, "owningSlotId" | "classLaneKind"> & { slotId: string }> {
  const week = allocation.weeks.find((row) => row.week === weekNumber);
  if (!week) {
    throw new Error(`Missing allocation week ${weekNumber}`);
  }
  return week.slots.flatMap((slot) =>
    slot.lanes.flatMap((allocationLane) =>
      allocationLane.allocatedMuscles.map((row) => ({
        slotId: slot.slotId,
        laneId: allocationLane.laneId,
        muscle: row.muscle,
        role: row.role,
        targetStatus: row.targetStatus,
        targetSetRange: row.targetSetRange,
        demandShare: row.demandShare,
        classIntent: row.classIntent,
        ownsClassObligation: row.ownsClassObligation,
        ownershipKind: row.ownershipKind,
        allocationBasis: row.allocationBasis,
      })),
    ),
  );
}

function ownershipRowsForMuscle(
  distribution: V2ExerciseClassDistributionBySlot,
  muscle: string,
  weekNumber = 2,
): OwnershipRow[] {
  return classOwnershipRows(distribution, weekNumber).filter(
    (row) => row.muscle === muscle,
  );
}

function positiveOwnershipRowsForMuscle(
  distribution: V2ExerciseClassDistributionBySlot,
  muscle: string,
  weekNumber = 2,
): OwnershipRow[] {
  return ownershipRowsForMuscle(distribution, muscle, weekNumber).filter(
    (row) => row.targetSetRange.preferred > 0,
  );
}

function sumRanges(rows: ReadonlyArray<{ targetSetRange: V2PlannerSetRange }>): V2PlannerSetRange {
  return rows.reduce(
    (total, row) => ({
      min: Math.round((total.min + row.targetSetRange.min) * 10) / 10,
      preferred:
        Math.round((total.preferred + row.targetSetRange.preferred) * 10) / 10,
      max: Math.round((total.max + row.targetSetRange.max) * 10) / 10,
    }),
    { min: 0, preferred: 0, max: 0 },
  );
}

function weekDemand(
  weeklyDemandCurve: V2WeeklyDemandCurve,
  muscle: string,
  weekNumber = 2,
): V2PlannerSetRange {
  const demand = weeklyDemandCurve.weeks
    .find((week) => week.week === weekNumber)
    ?.muscles.find((row) => row.muscle === muscle);
  if (!demand) {
    throw new Error(`Missing demand for ${muscle} in week ${weekNumber}`);
  }
  return demand.targetSetRange;
}

describe("buildV2ExerciseClassDistributionBySlot", () => {
  it("consumes slot allocation ownership rows instead of selected exercises", () => {
    const { slotDemandAllocationByWeek, distribution } = buildFixture();

    expect(distribution).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      distributionTiming: "before_exercise_selection",
      readOnly: true,
      affectsScoringOrGeneration: false,
    });
    expect(classOwnershipRows(distribution).map((row) => ({
      slotId: row.owningSlotId,
      laneId: row.laneId,
      muscle: row.muscle,
      role: row.role,
      targetStatus: row.targetStatus,
      targetSetRange: row.targetSetRange,
      demandShare: row.demandShare,
      classIntent: row.classIntent,
      ownsClassObligation: row.ownsClassObligation,
      ownershipKind: row.ownershipKind,
      allocationBasis: row.allocationBasis,
    }))).toEqual(allocationRows(slotDemandAllocationByWeek));
    expect(lanesForSlot(distribution, "upper_a").map((row) => row.laneId))
      .not.toContain("chest_secondary");
    expect(JSON.stringify(distribution)).not.toMatch(
      /exerciseId|exerciseName|selectedExercise|inventoryEvidence|repairEvidence|runtimeReplay|slotPlanSeedJson|sessionDecisionReceipt/,
    );
  });

  it("preserves distinct Chest class intent across Upper A and Upper B", () => {
    const distribution = buildClassDistribution();
    const upperAChest = lane(distribution, "upper_a", "chest_anchor");
    const upperBChest = lane(distribution, "upper_b", "chest_second_exposure");

    expect(upperAChest).toMatchObject({
      classLaneKind: "owned_class_lane",
      primaryMuscles: ["Chest"],
      classIntents: ["horizontal_press_or_slight_incline"],
      requiredExerciseClasses: ["horizontal_press", "slight_incline_press"],
      ownershipRows: [
        expect.objectContaining({
          owningSlotId: "upper_a",
          demandShare: 0.5,
          ownershipKind: "primary_exposure",
          classIntent: "horizontal_press_or_slight_incline",
        }),
      ],
    });
    expect(upperBChest).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Chest"],
      supportMuscles: ["Chest"],
      classIntents: ["distinct_second_chest_press_or_fly"],
      requiredExerciseClasses: [
        "distinct_chest_press_or_fly",
        "fly",
        "machine_press",
        "cable_press",
      ],
      ownershipRows: [
        expect.objectContaining({
          owningSlotId: "upper_b",
          demandShare: 0.5,
          ownershipKind: "support_exposure",
          classIntent: "distinct_second_chest_press_or_fly",
        }),
      ],
    });
  });

  it("keeps Hamstrings hinge plus knee-flexion curl split without inflating demand", () => {
    const { weeklyDemandCurve, distribution } = buildFixture();
    const rows = positiveOwnershipRowsForMuscle(distribution, "Hamstrings");
    const lowerBHinge = lane(distribution, "lower_b", "hinge_anchor");

    expect(rows.map((row) => `${row.owningSlotId}:${row.laneId}:${row.classIntent}`))
      .toEqual([
        "lower_a:hamstring_curl:knee_flexion_curl",
        "lower_b:hinge_anchor:hinge_primary",
        "lower_b:knee_flexion_curl:knee_flexion_curl_support",
      ]);
    expect(sumRanges(rows)).toEqual(weekDemand(weeklyDemandCurve, "Hamstrings"));
    expect(lowerBHinge).toMatchObject({
      classLaneKind: "owned_class_lane",
      primaryMuscles: ["Hamstrings"],
      managedCollateralMuscles: ["Glutes", "Lower Back"],
      requiredExerciseClasses: [
        "hinge_compound",
        "low_axial_hip_extension_anchor",
      ],
      ownershipRows: expect.arrayContaining([
        expect.objectContaining({
          muscle: "Hamstrings",
          ownershipKind: "primary_exposure",
          classIntent: "hinge_primary",
        }),
        expect.objectContaining({
          muscle: "Glutes",
          ownershipKind: "managed_collateral",
          classIntent: "managed_hip_extension_collateral",
          targetSetRange: { min: 0, preferred: 0, max: 0 },
        }),
        expect.objectContaining({
          muscle: "Lower Back",
          ownershipKind: "managed_collateral",
          classIntent: "managed_axial_fatigue_collateral",
          targetSetRange: { min: 0, preferred: 0, max: 0 },
        }),
      ]),
    });
  });

  it("keeps side delt direct classes separate from vertical-press support", () => {
    const { weeklyDemandCurve, distribution } = buildFixture();
    const upperASideDeltLane = lane(distribution, "upper_a", "side_delt_isolation");
    const sideDeltLane = lane(distribution, "upper_b", "side_delt_isolation");
    const verticalPress = lane(distribution, "upper_b", "vertical_press");

    expect(upperASideDeltLane).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Side Delts"],
      supportMuscles: ["Side Delts"],
      classIntents: ["lateral_raise_low_collateral_side_delt"],
      requiredExerciseClasses: ["lateral_raise", "low_collateral_side_delt"],
      ownershipRows: [
        expect.objectContaining({
          muscle: "Side Delts",
          ownershipKind: "direct_support",
          demandShare: 1 / 3,
        }),
      ],
    });
    expect(sideDeltLane).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Side Delts"],
      supportMuscles: ["Side Delts"],
      classIntents: ["lateral_raise_low_collateral_side_delt"],
      requiredExerciseClasses: ["lateral_raise", "low_collateral_side_delt"],
      ownershipRows: [
        expect.objectContaining({
          muscle: "Side Delts",
          ownershipKind: "direct_support",
          demandShare: 2 / 3,
        }),
      ],
    });
    expect(sumRanges(positiveOwnershipRowsForMuscle(distribution, "Side Delts")))
      .toEqual(weekDemand(weeklyDemandCurve, "Side Delts"));
    expect(verticalPress).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Front Delts"],
      supportMuscles: ["Front Delts"],
      managedCollateralMuscles: [],
      requiredExerciseClasses: ["vertical_press"],
      preferredExerciseClasses: ["vertical_press"],
      ownershipRows: expect.arrayContaining([
        expect.objectContaining({
          muscle: "Front Delts",
          ownershipKind: "support_exposure",
          classIntent: "vertical_press_support",
          ownsClassObligation: true,
        }),
        expect.objectContaining({
          muscle: "Chest",
          ownershipKind: "support_exposure",
          classIntent: "chest_biased_press_support",
          ownsClassObligation: false,
          targetSetRange: { min: 1.4, preferred: 1.6, max: 2 },
        }),
      ]),
    });
  });

  it("keeps rear delt direct/support class owned by Upper A", () => {
    const { weeklyDemandCurve, distribution } = buildFixture();
    const rearDeltLane = lane(distribution, "upper_a", "rear_delt");

    expect(rearDeltLane).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Rear Delts"],
      supportMuscles: ["Rear Delts"],
      classIntents: ["rear_delt_isolation"],
      requiredExerciseClasses: ["rear_delt_isolation"],
      preferredSetSplit: "direct_accessory",
      ownershipRows: [
        expect.objectContaining({
          muscle: "Rear Delts",
          ownershipKind: "direct_support",
          demandShare: 1,
        }),
      ],
    });
    expect(sumRanges(positiveOwnershipRowsForMuscle(distribution, "Rear Delts")))
      .toEqual(weekDemand(weeklyDemandCurve, "Rear Delts"));
  });

  it("keeps calf isolation in both lower slots", () => {
    const { weeklyDemandCurve, distribution } = buildFixture();
    const rows = positiveOwnershipRowsForMuscle(distribution, "Calves");

    expect(rows.map((row) => `${row.owningSlotId}:${row.laneId}:${row.classIntent}`))
      .toEqual([
        "lower_a:calves:calf_isolation",
        "lower_b:calves:calf_isolation",
      ]);
    expect(lane(distribution, "lower_a", "calves")).toMatchObject({
      requiredExerciseClasses: ["calf_isolation"],
    });
    expect(lane(distribution, "lower_b", "calves")).toMatchObject({
      requiredExerciseClasses: ["calf_isolation"],
    });
    expect(weekDemand(weeklyDemandCurve, "Calves")).toEqual({
      min: 6,
      preferred: 8,
      max: 10,
    });
    expect(sumRanges(rows)).toEqual({ min: 6, preferred: 8, max: 8 });
  });

  it("preserves quad primary and support ownership", () => {
    const { weeklyDemandCurve, distribution } = buildFixture();
    const rows = positiveOwnershipRowsForMuscle(distribution, "Quads");

    expect(rows.map((row) => ({
      slotId: row.owningSlotId,
      laneId: row.laneId,
      classIntent: row.classIntent,
      ownershipKind: row.ownershipKind,
    }))).toEqual([
      {
        slotId: "lower_a",
        laneId: "squat_anchor",
        classIntent: "squat_or_leg_press_anchor",
        ownershipKind: "primary_exposure",
      },
      {
        slotId: "lower_a",
        laneId: "quad_isolation",
        classIntent: "quad_isolation_or_support",
        ownershipKind: "support_exposure",
      },
      {
        slotId: "lower_b",
        laneId: "quad_support",
        classIntent: "quad_support",
        ownershipKind: "support_exposure",
      },
    ]);
    expect(lane(distribution, "lower_a", "squat_anchor")).toMatchObject({
      classLaneKind: "owned_class_lane",
      requiredExerciseClasses: ["squat_pattern", "leg_press"],
    });
    expect(lane(distribution, "lower_b", "quad_support")).toMatchObject({
      classLaneKind: "support_class_lane",
      requiredExerciseClasses: [
        "leg_press",
        "squat_pattern",
        "quad_isolation",
        "lunge",
      ],
    });
    expect(sumRanges(rows)).toEqual(weekDemand(weeklyDemandCurve, "Quads"));
  });

  it("keeps managed collateral markers out of required class lanes", () => {
    const distribution = buildClassDistribution();
    const managedRows = classOwnershipRows(distribution).filter(
      (row) => row.ownershipKind === "managed_collateral",
    );

    expect(managedRows.map((row) => `${row.owningSlotId}:${row.laneId}:${row.muscle}`))
      .toEqual([
        "lower_a:secondary_hinge:Glutes",
        "lower_a:secondary_hinge:Lower Back",
        "lower_b:hinge_anchor:Glutes",
        "lower_b:hinge_anchor:Lower Back",
      ]);
    expect(managedRows.every((row) => row.classLaneKind === "managed_collateral_marker"))
      .toBe(true);
    expect(managedRows.every((row) => row.targetSetRange.preferred === 0)).toBe(
      true,
    );
    expect(lane(distribution, "upper_b", "vertical_press").requiredExerciseClasses)
      .toEqual(["vertical_press"]);
    expect(lane(distribution, "lower_a", "secondary_hinge").requiredExerciseClasses)
      .toEqual([]);
  });

  it("keeps optional lanes optional unless activation criteria are met elsewhere", () => {
    const distribution = buildClassDistribution();
    const optionalTriceps = lane(
      distribution,
      "upper_b",
      "optional_triceps_if_under_target",
    );
    const optionalGluteCore = lane(
      distribution,
      "lower_b",
      "optional_glute_core_if_recoverable",
    );

    expect(optionalTriceps).toMatchObject({
      classLaneKind: "optional_recoverable_lane",
      optionalMuscles: ["Triceps"],
      requiredExerciseClasses: [],
      preferredExerciseClasses: ["triceps_isolation"],
      allocatedTargetSetRange: { min: 0, preferred: 0, max: 0 },
      duplicatePolicy: "allow_with_justification",
    });
    expect(optionalGluteCore).toMatchObject({
      classLaneKind: "optional_recoverable_lane",
      optionalMuscles: ["Core", "Glutes"],
      requiredExerciseClasses: [],
      preferredExerciseClasses: ["glute_or_core_accessory"],
      allocatedTargetSetRange: { min: 0, preferred: 0, max: 0 },
      preferredSetSplit: "optional_if_recoverable",
    });
    expect(lane(distribution, "lower_a", "secondary_hinge")).toMatchObject({
      classLaneKind: "optional_recoverable_lane",
      optionalMuscles: ["Hamstrings"],
      managedCollateralMuscles: ["Glutes", "Lower Back"],
      requiredExerciseClasses: [],
      preferredExerciseClasses: ["low_dose_hinge"],
      allocatedTargetSetRange: { min: 0, preferred: 0, max: 0 },
      preferredSetSplit: "optional_if_recoverable",
    });
  });

  it("does not exceed balanced base allocation when class ownership is summed by muscle", () => {
    const { weeklyDemandCurve, distribution } = buildFixture();
    const week2DemandMuscles = weeklyDemandCurve.weeks.find(
      (week) => week.week === 2,
    )?.muscles;

    expect(week2DemandMuscles).toBeDefined();
    for (const demand of week2DemandMuscles ?? []) {
      const allocated = sumRanges(ownershipRowsForMuscle(distribution, demand.muscle));
      expect(allocated.min).toBeLessThanOrEqual(demand.targetSetRange.min);
      expect(allocated.preferred).toBeLessThanOrEqual(
        demand.targetSetRange.preferred,
      );
      expect(allocated.max).toBeLessThanOrEqual(demand.targetSetRange.max);
    }
  });
});
