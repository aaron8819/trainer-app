import { describe, expect, it } from "vitest";
import { buildV2ExerciseClassDistributionBySlot } from "./exercise-class-distribution";
import { buildV2MesocycleDemand } from "./mesocycle-demand";
import {
  V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION,
  buildV2SlotDemandAllocationByWeek,
  buildV2SlotWeekAllocationPolicyTrial,
  buildV2SlotWeekDonorCapacityProjection,
  type V2SlotWeekDonorCapacityMeasuredRow,
} from "./slot-demand-allocation";
import { buildV2SetDistributionIntent } from "./set-distribution-intent";
import { buildV2SupportLanePolicy } from "./support-lane-policy";
import { buildV2TargetSkeleton } from "./target-skeleton";
import type {
  V2MesocycleDemand,
  V2PlannerSetRange,
  V2SlotDemandAllocationByWeek,
  V2TargetSkeleton,
  V2WeeklyDemandCurve,
} from "./types";
import { buildV2WeeklyDemandCurve } from "./weekly-demand-curve";
import { buildV2WeeklyProgressionModel } from "./weekly-progression";

type AllocationRow = {
  slotId: string;
  laneId: string;
  laneRole: string;
  muscle: V2SlotDemandAllocationByWeek["weeks"][number]["slots"][number]["lanes"][number]["allocatedMuscles"][number];
};

function buildFixture(): {
  targetSkeleton: V2TargetSkeleton;
  mesocycleDemand: V2MesocycleDemand;
  weeklyDemandCurve: V2WeeklyDemandCurve;
  allocation: V2SlotDemandAllocationByWeek;
} {
  const targetSkeleton = buildV2TargetSkeleton();
  const mesocycleDemand = buildV2MesocycleDemand({ targetSkeleton });
  const weeklyDemandCurve = buildV2WeeklyDemandCurve({
    mesocycleDemand,
    weeklyProgressionModel: buildV2WeeklyProgressionModel(),
  });
  const allocation = buildV2SlotDemandAllocationByWeek({
    targetSkeleton,
    weeklyDemandCurve,
  });

  return {
    targetSkeleton,
    mesocycleDemand,
    weeklyDemandCurve,
    allocation,
  };
}

function buildAllocation() {
  return buildFixture().allocation;
}

function rawLaneSummedRange(
  skeleton: V2TargetSkeleton,
  muscle: string,
): V2PlannerSetRange & { laneCount: number } {
  return skeleton.slots
    .flatMap((slot) => slot.lanes)
    .filter((lane) => lane.primaryMuscles.includes(muscle))
    .reduce(
      (total, lane) => ({
        min: total.min + lane.targetSets.min,
        preferred: total.preferred + lane.targetSets.preferred,
        max: total.max + lane.targetSets.max,
        laneCount: total.laneCount + 1,
      }),
      { min: 0, preferred: 0, max: 0, laneCount: 0 },
    );
}

function weekDemand(
  weeklyDemandCurve: V2WeeklyDemandCurve,
  weekNumber: number,
  muscle: string,
): V2PlannerSetRange {
  const demand = weeklyDemandCurve.weeks
    .find((week) => week.week === weekNumber)
    ?.muscles.find((row) => row.muscle === muscle);
  if (!demand) {
    throw new Error(`Missing demand for ${muscle} in week ${weekNumber}`);
  }
  return demand.targetSetRange;
}

function allocationRows(
  allocation: V2SlotDemandAllocationByWeek,
  weekNumber = 2,
): AllocationRow[] {
  const week = allocation.weeks.find((row) => row.week === weekNumber);
  if (!week) {
    throw new Error(`Missing allocation week ${weekNumber}`);
  }
  return week.slots.flatMap((slot) =>
    slot.lanes.flatMap((lane) =>
      lane.allocatedMuscles.map((muscle) => ({
        slotId: slot.slotId,
        laneId: lane.laneId,
        laneRole: lane.role,
        muscle,
      })),
    ),
  );
}

function rowsForMuscle(
  allocation: V2SlotDemandAllocationByWeek,
  muscle: string,
  weekNumber = 2,
): AllocationRow[] {
  return allocationRows(allocation, weekNumber).filter(
    (row) => row.muscle.muscle === muscle,
  );
}

function positiveRowsForMuscle(
  allocation: V2SlotDemandAllocationByWeek,
  muscle: string,
  weekNumber = 2,
): AllocationRow[] {
  return rowsForMuscle(allocation, muscle, weekNumber).filter(
    (row) => row.muscle.targetSetRange.preferred > 0,
  );
}

function sumRanges(rows: AllocationRow[]): V2PlannerSetRange {
  return rows.reduce(
    (total, row) => ({
      min: Math.round((total.min + row.muscle.targetSetRange.min) * 10) / 10,
      preferred:
        Math.round(
          (total.preferred + row.muscle.targetSetRange.preferred) * 10,
        ) / 10,
      max: Math.round((total.max + row.muscle.targetSetRange.max) * 10) / 10,
    }),
    { min: 0, preferred: 0, max: 0 },
  );
}

function groupPreferredBySlot(rows: AllocationRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.slotId] =
      Math.round(
        ((acc[row.slotId] ?? 0) + row.muscle.targetSetRange.preferred) * 10,
      ) / 10;
    return acc;
  }, {});
}

function groupPreferredBySlotForWeek(
  allocation: V2SlotDemandAllocationByWeek,
  muscle: string,
  weekNumber: number,
): Record<string, number> {
  return groupPreferredBySlot(
    positiveRowsForMuscle(allocation, muscle, weekNumber),
  );
}

function donorCapacityRow(
  overrides: Partial<V2SlotWeekDonorCapacityMeasuredRow> = {},
): V2SlotWeekDonorCapacityMeasuredRow {
  return {
    week: 2,
    muscle: "Calves",
    sourceSlotId: "lower_a",
    sourceLaneId: "calves",
    sourceBeforeSets: 4,
    sourceAfterSets: 3,
    sourceSetDelta: -1,
    donorSlotId: "lower_b",
    donorLaneId: "calves",
    donorBeforeSets: 4,
    donorAfterSets: 4,
    donorSetDelta: 0,
    netWeeklySetDelta: -1,
    protectedCoverageStatus: "regressed",
    materializerRegressionCount: 0,
    materializerBlockerDelta: 0,
    concentrationWarningDelta: -1,
    ...overrides,
  };
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
      exposureOwnershipPolicy: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        demandSource: "balanced_static_block_policy",
        basis: "static_upper_lower_slot_exposure_ownership",
      },
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
          allocationBasis: "static_slot_exposure_ownership",
          classIntent: "knee_flexion_curl_support",
        }),
      ],
    });
    expect(JSON.stringify(allocation)).not.toMatch(
      /exerciseId|exerciseName|selectedExercise|repairMateriality|slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });

  it("consumes balanced base demand instead of skeleton lane-summed demand", () => {
    const { targetSkeleton, weeklyDemandCurve, allocation } = buildFixture();
    const rawHamstrings = rawLaneSummedRange(targetSkeleton, "Hamstrings");
    const rawChest = rawLaneSummedRange(targetSkeleton, "Chest");
    const hamstringsTotal = sumRanges(
      positiveRowsForMuscle(allocation, "Hamstrings"),
    );
    const chestTotal = sumRanges(positiveRowsForMuscle(allocation, "Chest"));

    expect(rawHamstrings).toMatchObject({ preferred: 9, laneCount: 4 });
    expect(rawChest).toMatchObject({ preferred: 10, laneCount: 3 });
    expect(hamstringsTotal).toEqual(weekDemand(weeklyDemandCurve, 2, "Hamstrings"));
    expect(chestTotal).toEqual(weekDemand(weeklyDemandCurve, 2, "Chest"));
    expect(hamstringsTotal.preferred).toBeLessThan(rawHamstrings.preferred);
    expect(chestTotal.preferred).toBeLessThan(rawChest.preferred);
    expect(
      rowsForMuscle(allocation, "Chest").some(
        (row) => row.slotId === "upper_a" && row.laneId === "chest_secondary",
      ),
    ).toBe(false);
  });

  it("splits Chest across two upper exposures with distinct class ownership", () => {
    const { weeklyDemandCurve, allocation } = buildFixture();
    const chestRows = positiveRowsForMuscle(allocation, "Chest");

    expect(chestRows.map((row) => ({
      slotId: row.slotId,
      laneId: row.laneId,
      role: row.muscle.role,
      demandShare: row.muscle.demandShare,
      classIntent: row.muscle.classIntent,
      ownershipKind: row.muscle.ownershipKind,
    }))).toEqual([
      {
        slotId: "upper_a",
        laneId: "chest_anchor",
        role: "primary",
        demandShare: 0.5,
        classIntent: "horizontal_press_or_slight_incline",
        ownershipKind: "primary_exposure",
      },
      {
        slotId: "upper_b",
        laneId: "vertical_press",
        role: "support",
        demandShare: 0.25,
        classIntent: "chest_biased_press_support",
        ownershipKind: "support_exposure",
      },
      {
        slotId: "upper_b",
        laneId: "chest_second_exposure",
        role: "support",
        demandShare: 0.5,
        classIntent: "distinct_second_chest_press_or_fly",
        ownershipKind: "support_exposure",
      },
    ]);
    expect(sumRanges(chestRows)).toEqual(weekDemand(weeklyDemandCurve, 2, "Chest"));
  });

  it("keeps Hamstrings inside balanced demand while splitting hinge and curl ownership", () => {
    const { weeklyDemandCurve, allocation } = buildFixture();
    const rows = positiveRowsForMuscle(allocation, "Hamstrings");
    const hingeRows = rows.filter((row) =>
      row.muscle.classIntent.includes("hinge"),
    );
    const curlRows = rows.filter((row) =>
      row.muscle.classIntent.includes("curl"),
    );

    expect(rows.map((row) => `${row.slotId}:${row.laneId}:${row.muscle.classIntent}`))
      .toEqual([
        "lower_a:hamstring_curl:knee_flexion_curl",
        "lower_b:hinge_anchor:hinge_primary",
        "lower_b:knee_flexion_curl:knee_flexion_curl_support",
      ]);
    expect(sumRanges(rows)).toEqual(
      weekDemand(weeklyDemandCurve, 2, "Hamstrings"),
    );
    expect(sumRanges(hingeRows).preferred).toBe(3.8);
    expect(sumRanges(curlRows).preferred).toBe(4.2);
  });

  it("applies the bounded Calves lower-slot redistribution only in accumulation Weeks 2-4", () => {
    const { weeklyDemandCurve, allocation } = buildFixture();
    const week2Rows = positiveRowsForMuscle(allocation, "Calves", 2);

    expect(V2_BOUNDED_CALVES_SLOT_DEMAND_REDISTRIBUTION).toMatchObject({
      weeks: [2, 3, 4],
      phases: ["accumulation", "hard_accumulation", "peak_overreach_lite"],
      muscle: "Calves",
      laneId: "calves",
      sourceSlotId: "lower_a",
      donorSlotId: "lower_b",
      sourceBaselineSetCount: 4,
      donorBaselineSetCount: 4,
      sourceSetDelta: -1,
      donorSetDelta: 1,
      sourceTargetSetCount: 3,
      donorTargetSetCount: 5,
      netWeeklySetDelta: 0,
    });
    expect(week2Rows.map((row) => `${row.slotId}:${row.laneId}`)).toEqual([
      "lower_a:calves",
      "lower_b:calves",
    ]);
    expect(groupPreferredBySlotForWeek(allocation, "Calves", 1)).toEqual({
      lower_a: 3.5,
      lower_b: 3.5,
    });
    for (const weekNumber of [2, 3, 4]) {
      expect(groupPreferredBySlotForWeek(allocation, "Calves", weekNumber)).toEqual(
        {
          lower_a: 3,
          lower_b: 5,
        },
      );
      const total = sumRanges(positiveRowsForMuscle(allocation, "Calves", weekNumber));
      expect(total.preferred).toBe(weekDemand(weeklyDemandCurve, 2, "Calves").preferred);
      expect(total.max).toBe(8);
    }
    expect(groupPreferredBySlotForWeek(allocation, "Calves", 5)).toEqual({
      lower_a: 2,
      lower_b: 2,
    });
  });

  it("does not redistribute wrong slots or wrong muscles", () => {
    const { allocation } = buildFixture();

    expect(groupPreferredBySlotForWeek(allocation, "Quads", 2)).toEqual({
      lower_a: 6,
      lower_b: 3,
    });
    expect(groupPreferredBySlotForWeek(allocation, "Hamstrings", 2)).toEqual({
      lower_a: 2.1,
      lower_b: 5.9,
    });
    expect(groupPreferredBySlotForWeek(allocation, "Side Delts", 2)).toEqual({
      upper_a: 2,
      upper_b: 4,
    });
    expect(
      positiveRowsForMuscle(allocation, "Calves", 2).map(
        (row) => `${row.slotId}:${row.laneId}:${row.muscle.muscle}`,
      ),
    ).toEqual(["lower_a:calves:Calves", "lower_b:calves:Calves"]);
  });

  it("assigns Side Delts direct low-collateral ownership to both upper slots", () => {
    const { weeklyDemandCurve, allocation } = buildFixture();
    const rows = positiveRowsForMuscle(allocation, "Side Delts");

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => ({
      slotId: row.slotId,
      laneId: row.laneId,
      demandShare: row.muscle.demandShare,
      classIntent: row.muscle.classIntent,
      ownershipKind: row.muscle.ownershipKind,
    }))).toEqual([
      {
        slotId: "upper_a",
        laneId: "side_delt_isolation",
        demandShare: 1 / 3,
        classIntent: "lateral_raise_low_collateral_side_delt",
        ownershipKind: "direct_support",
      },
      {
        slotId: "upper_b",
        laneId: "side_delt_isolation",
        demandShare: 2 / 3,
        classIntent: "lateral_raise_low_collateral_side_delt",
        ownershipKind: "direct_support",
      },
    ]);
    expect(sumRanges(rows)).toEqual(
      weekDemand(weeklyDemandCurve, 2, "Side Delts"),
    );
  });

  it("assigns Rear Delts direct/support ownership to Upper A", () => {
    const { weeklyDemandCurve, allocation } = buildFixture();
    const rows = positiveRowsForMuscle(allocation, "Rear Delts");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slotId: "upper_a",
      laneId: "rear_delt",
      muscle: {
        role: "support",
        demandShare: 1,
        classIntent: "rear_delt_isolation",
        ownershipKind: "direct_support",
      },
    });
    expect(sumRanges(rows)).toEqual(
      weekDemand(weeklyDemandCurve, 2, "Rear Delts"),
    );
  });

  it("splits Quads into Lower A primary plus Lower B support", () => {
    const { weeklyDemandCurve, allocation } = buildFixture();
    const rows = positiveRowsForMuscle(allocation, "Quads");

    expect(rows.map((row) => ({
      slotId: row.slotId,
      laneId: row.laneId,
      role: row.muscle.role,
      classIntent: row.muscle.classIntent,
    }))).toEqual([
      {
        slotId: "lower_a",
        laneId: "squat_anchor",
        role: "primary",
        classIntent: "squat_or_leg_press_anchor",
      },
      {
        slotId: "lower_a",
        laneId: "quad_isolation",
        role: "support",
        classIntent: "quad_isolation_or_support",
      },
      {
        slotId: "lower_b",
        laneId: "quad_support",
        role: "support",
        classIntent: "quad_support",
      },
    ]);
    expect(groupPreferredBySlot(rows)).toEqual({
      lower_a: 6,
      lower_b: 3,
    });
    expect(sumRanges(rows)).toEqual(weekDemand(weeklyDemandCurve, 2, "Quads"));
  });

  it("balances Lats and Upper Back across row and vertical-pull exposure ownership", () => {
    const { weeklyDemandCurve, allocation } = buildFixture();
    const latRows = positiveRowsForMuscle(allocation, "Lats");
    const upperBackRows = positiveRowsForMuscle(allocation, "Upper Back");

    expect(latRows.map((row) => `${row.slotId}:${row.laneId}:${row.muscle.classIntent}`))
      .toEqual([
        "upper_a:row_anchor:row_horizontal_pull_emphasis",
        "upper_a:vertical_pull_support:vertical_pull_support",
        "upper_b:vertical_pull_anchor:vertical_pull_anchor",
        "upper_b:row_support:row_support",
      ]);
    expect(sumRanges(latRows)).toEqual(weekDemand(weeklyDemandCurve, 2, "Lats"));
    expect(sumRanges(latRows.filter((row) => row.muscle.classIntent.includes("row"))).preferred)
      .toBeGreaterThan(0);
    expect(sumRanges(latRows.filter((row) => row.muscle.classIntent.includes("vertical"))).preferred)
      .toBeGreaterThan(0);
    expect(upperBackRows.map((row) => `${row.slotId}:${row.laneId}`)).toEqual([
      "upper_a:row_anchor",
      "upper_b:row_support",
    ]);
    expect(sumRanges(upperBackRows)).toEqual(
      weekDemand(weeklyDemandCurve, 2, "Upper Back"),
    );
  });

  it("keeps hip and axial fatigue managed while front delts get bounded vertical-press pattern support", () => {
    const { allocation } = buildFixture();

    const frontDeltRows = rowsForMuscle(allocation, "Front Delts");
    expect(frontDeltRows).toHaveLength(1);
    expect(frontDeltRows[0]).toMatchObject({
      slotId: "upper_b",
      laneId: "vertical_press",
      muscle: {
        role: "support",
        ownershipKind: "support_exposure",
        classIntent: "vertical_press_support",
        targetSetRange: { min: 0, preferred: 1, max: 3 },
      },
    });

    for (const muscle of ["Glutes", "Lower Back"]) {
      const rows = rowsForMuscle(allocation, muscle);
      expect(rows.length).toBeGreaterThan(0);
      expect(sumRanges(rows)).toEqual({ min: 0, preferred: 0, max: 0 });
      expect(rows.every((row) => row.muscle.role === "implicit")).toBe(true);
      expect(
        rows.every((row) =>
          ["managed_collateral", "optional_if_needed"].includes(
            row.muscle.ownershipKind,
          ),
        ),
      ).toBe(true);
    }
  });

  it("does not allocate more than balanced weekly demand for any muscle", () => {
    const { weeklyDemandCurve, allocation } = buildFixture();
    const week2DemandMuscles = weeklyDemandCurve.weeks.find(
      (week) => week.week === 2,
    )?.muscles;

    expect(week2DemandMuscles).toBeDefined();
    for (const demand of week2DemandMuscles ?? []) {
      const allocated = sumRanges(rowsForMuscle(allocation, demand.muscle));
      expect(allocated.min).toBeLessThanOrEqual(demand.targetSetRange.min);
      expect(allocated.preferred).toBeLessThanOrEqual(
        demand.targetSetRange.preferred,
      );
      expect(allocated.max).toBeLessThanOrEqual(demand.targetSetRange.max);
    }
  });

  it("blocks concentration relief when the slot-owned donor does not absorb the required set", () => {
    const projection = buildV2SlotWeekDonorCapacityProjection({
      slotDemandAllocationByWeek: buildAllocation(),
      measuredRows: [donorCapacityRow()],
    });

    expect(projection).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      status: "blocked",
      designDecision: {
        policy:
          "only_relieve_concentration_when_slot_owned_donor_absorbs_required_sets",
        requireMeasuredDonorAbsorption: true,
        requireNetWeeklyVolumePreserved: true,
        requireProtectedCoveragePreserved: true,
        requireMaterializerNonRegression: true,
      },
      summary: {
        rowCount: 1,
        passingRowCount: 0,
        blockedRowCount: 1,
        measuredDonorCapacityFailCount: 1,
        measuredDonorCapacityUnderAbsorptionCount: 1,
        measuredDonorCapacityOverAbsorptionCount: 0,
        protectedCoverageRegressionCount: 1,
        netWeeklySetDelta: -1,
        behaviorReadiness: "blocked_by_evidence",
        nextSafeSlice: "design_slot_week_allocation_policy",
      },
    });
    expect(projection.rows[0]).toMatchObject({
      muscle: "Calves",
      protectedWeeklyDemand: { preferred: 8 },
      sourceLanePressure: {
        slotId: "lower_a",
        laneId: "calves",
        allocatedPreferredSets: 3,
        setDelta: -1,
        pressureRelieved: true,
      },
      donorCapacity: {
        donorSlotId: "lower_b",
        donorLaneId: "calves",
        requiredSetAbsorption: 1,
        donorSetDelta: 0,
        absorbedRequiredSets: false,
        status: "insufficient",
      },
      blockingReasons: expect.arrayContaining([
        "donor_capacity_did_not_absorb_required_sets",
        "net_weekly_volume_changed",
        "protected_coverage_not_preserved",
      ]),
    });
  });

  it("applies a read-only slot/week allocation policy trial before set distribution", () => {
    const { allocation, targetSkeleton } = buildFixture();
    const trial = buildV2SlotWeekAllocationPolicyTrial({
      slotDemandAllocationByWeek: allocation,
      week: 1,
      source: {
        slotId: "lower_a",
        laneId: "calves",
        muscle: "Calves",
        setDelta: -1,
      },
      donor: {
        slotId: "lower_b",
        laneId: "calves",
        setDelta: 1,
      },
    });
    const trialClassDistribution = buildV2ExerciseClassDistributionBySlot({
      slotDemandAllocationByWeek: trial.slotDemandAllocationByWeek,
    });
    const trialSetDistribution = buildV2SetDistributionIntent({
      slotDemandAllocationByWeek: trial.slotDemandAllocationByWeek,
      exerciseClassDistributionBySlot: trialClassDistribution,
      v2SupportLanePolicy: buildV2SupportLanePolicy({ targetSkeleton }),
      weeklyProgressionModel: buildV2WeeklyProgressionModel(),
    });
    const sourceLane = trialSetDistribution.weeks
      .find((week) => week.week === 1)
      ?.slots.find((slot) => slot.slotId === "lower_a")
      ?.lanes.find((lane) => lane.laneId === "calves");
    const donorLane = trialSetDistribution.weeks
      .find((week) => week.week === 1)
      ?.slots.find((slot) => slot.slotId === "lower_b")
      ?.lanes.find((lane) => lane.laneId === "calves");

    expect(trial.trial).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      dryRunOnly: true,
      status: "applied",
      ownerSeam: "SlotDemandAllocationByWeek",
      sourcePressureRow: {
        slotId: "lower_a",
        laneId: "calves",
        muscle: "Calves",
        pressureRelieved: true,
      },
      selectedDonorLane: {
        slotId: "lower_b",
        laneId: "calves",
        muscle: "Calves",
        setDelta: 1,
        eligibleSlotOwnedDonor: true,
      },
      setMovementIntent: {
        requiredSourceReduction: 1,
        requestedDonorAbsorption: 1,
        netWeeklySetIntentDelta: 0,
        sameMuscle: true,
      },
      donorCapacity: {
        before: { preferredSets: 3.5 },
        after: { preferredSets: 4.5 },
        capacityDelta: 1,
        status: "capacity_created",
      },
      blockingReasons: [],
    });
    expect(sourceLane?.setBudget).toMatchObject({
      preferred: 3,
    });
    expect(donorLane?.setBudget).toMatchObject({
      preferred: 5,
    });
    expect(groupPreferredBySlot(positiveRowsForMuscle(allocation, "Calves"))).toEqual({
      lower_a: 3,
      lower_b: 5,
    });
  });

  it("propagates exact bounded Calves movement through downstream set distribution", () => {
    const { allocation, targetSkeleton } = buildFixture();
    const classDistribution = buildV2ExerciseClassDistributionBySlot({
      slotDemandAllocationByWeek: allocation,
    });
    const setDistribution = buildV2SetDistributionIntent({
      slotDemandAllocationByWeek: allocation,
      exerciseClassDistributionBySlot: classDistribution,
      v2SupportLanePolicy: buildV2SupportLanePolicy({ targetSkeleton }),
      weeklyProgressionModel: buildV2WeeklyProgressionModel(),
    });
    const lane = (weekNumber: number, slotId: "lower_a" | "lower_b") =>
      setDistribution.weeks
        .find((week) => week.week === weekNumber)
        ?.slots.find((slot) => slot.slotId === slotId)
        ?.lanes.find((row) => row.laneId === "calves");

    for (const weekNumber of [2, 3, 4]) {
      expect(lane(weekNumber, "lower_a")?.setBudget).toMatchObject({
        min: 3,
        preferred: 3,
        max: 3,
      });
      expect(lane(weekNumber, "lower_b")?.setBudget).toMatchObject({
        min: 3,
        preferred: 5,
        max: 5,
      });
    }
  });

  it("blocks the allocation policy trial when no same-muscle slot-owned donor row exists", () => {
    const allocation = buildAllocation();
    const trial = buildV2SlotWeekAllocationPolicyTrial({
      slotDemandAllocationByWeek: allocation,
      week: 2,
      source: {
        slotId: "lower_a",
        laneId: "calves",
        muscle: "Calves",
        setDelta: -1,
      },
      donor: {
        slotId: "upper_b",
        laneId: "biceps",
        muscle: "Calves",
        setDelta: 1,
      },
    });

    expect(trial.trial.status).toBe("blocked");
    expect(trial.trial.blockingReasons).toEqual(
      expect.arrayContaining(["donor_row_missing_or_not_slot_owned"]),
    );
    expect(groupPreferredBySlot(positiveRowsForMuscle(allocation, "Calves"))).toEqual({
      lower_a: 3,
      lower_b: 5,
    });
  });

  it("passes only when a slot-owned donor absorbs the source reduction without net volume loss", () => {
    const projection = buildV2SlotWeekDonorCapacityProjection({
      slotDemandAllocationByWeek: buildAllocation(),
      measuredRows: [
        donorCapacityRow({
          donorAfterSets: 5,
          donorSetDelta: 1,
          netWeeklySetDelta: 0,
          protectedCoverageStatus: "preserved",
          materializerRegressionCount: 0,
          materializerBlockerDelta: 0,
        }),
      ],
    });

    expect(projection).toMatchObject({
      status: "available",
      summary: {
        passingRowCount: 1,
        blockedRowCount: 0,
        measuredDonorCapacityPassCount: 1,
        measuredDonorCapacityFailCount: 0,
        measuredDonorCapacityUnderAbsorptionCount: 0,
        measuredDonorCapacityOverAbsorptionCount: 0,
        protectedCoverageRegressionCount: 0,
        netWeeklySetDelta: 0,
        behaviorReadiness: "candidate_for_acceptance_projection",
        nextSafeSlice: "run_acceptance_non_regression_projection",
      },
    });
    expect(projection.rows[0]).toMatchObject({
      donorCapacity: {
        requiredSetAbsorption: 1,
        donorSetDelta: 1,
        absorbedRequiredSets: true,
        status: "absorbed",
      },
      protectedCoverageImpact: {
        status: "preserved",
        netWeeklySetDelta: 0,
      },
      materializerNonRegressionStatus: "pass",
      behaviorReadiness: "candidate_for_acceptance_projection",
      blockingReasons: [],
    });
  });

  it("blocks when protected coverage regresses even if donor absorption is measured", () => {
    const projection = buildV2SlotWeekDonorCapacityProjection({
      slotDemandAllocationByWeek: buildAllocation(),
      measuredRows: [
        donorCapacityRow({
          donorAfterSets: 5,
          donorSetDelta: 1,
          netWeeklySetDelta: 0,
          protectedCoverageStatus: "regressed",
        }),
      ],
    });

    expect(projection.summary).toMatchObject({
      measuredDonorCapacityPassCount: 1,
      protectedCoverageRegressionCount: 1,
      behaviorReadiness: "blocked_by_evidence",
      nextSafeSlice: "design_slot_week_allocation_policy",
    });
    expect(projection.rows[0].blockingReasons).toEqual([
      "protected_coverage_not_preserved",
    ]);
  });

  it("blocks when net weekly volume changes even if donor set delta and coverage pass", () => {
    const projection = buildV2SlotWeekDonorCapacityProjection({
      slotDemandAllocationByWeek: buildAllocation(),
      measuredRows: [
        donorCapacityRow({
          donorAfterSets: 5,
          donorSetDelta: 1,
          netWeeklySetDelta: 1,
          protectedCoverageStatus: "preserved",
        }),
      ],
    });

    expect(projection.summary).toMatchObject({
      measuredDonorCapacityPassCount: 0,
      measuredDonorCapacityFailCount: 1,
      measuredDonorCapacityUnderAbsorptionCount: 0,
      measuredDonorCapacityOverAbsorptionCount: 1,
      protectedCoverageRegressionCount: 0,
      netWeeklySetDelta: 1,
      behaviorReadiness: "blocked_by_evidence",
      nextSafeSlice: "design_slot_week_allocation_policy",
    });
    expect(projection.rows[0].blockingReasons).toEqual(
      expect.arrayContaining([
        "donor_capacity_over_absorbed_required_sets",
        "net_weekly_volume_changed",
      ]),
    );
  });

  it("stays read-only and does not expose seed, runtime, receipt, or repair policy inputs", () => {
    const projection = buildV2SlotWeekDonorCapacityProjection({
      slotDemandAllocationByWeek: buildAllocation(),
      measuredRows: [donorCapacityRow()],
    });

    expect(JSON.stringify(projection)).not.toMatch(
      /exerciseId|exerciseName|selectedExercise|repairMateriality|slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });
});
