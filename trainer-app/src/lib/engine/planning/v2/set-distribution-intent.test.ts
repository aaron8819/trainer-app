import { describe, expect, it } from "vitest";
import { buildV2PlannerMesocyclePolicy } from "./mesocycle-policy";
import { buildV2TargetSkeleton } from "./target-skeleton";
import type {
  V2ExerciseClassDistributionBySlot,
  V2PlannerSetRange,
  V2PlannerMesocyclePolicy,
} from "./types";
import type { V2SetDistributionIntent } from "./set-distribution-intent";

type IntentLane =
  V2SetDistributionIntent["weeks"][number]["slots"][number]["lanes"][number];
type ClassLane =
  V2ExerciseClassDistributionBySlot["weeks"][number]["slots"][number]["classLanes"][number];

function buildPolicy(): V2PlannerMesocyclePolicy {
  return buildV2PlannerMesocyclePolicy();
}

function intent(): V2SetDistributionIntent {
  return buildPolicy().v2SetDistributionIntent;
}

function week(
  plan: V2SetDistributionIntent,
  weekNumber = 2,
): V2SetDistributionIntent["weeks"][number] {
  const found = plan.weeks.find((row) => row.week === weekNumber);
  if (!found) {
    throw new Error(`Missing set-distribution week ${weekNumber}`);
  }
  return found;
}

function slot(
  plan: V2SetDistributionIntent,
  slotId: string,
  weekNumber = 2,
) {
  const found = week(plan, weekNumber).slots.find((row) => row.slotId === slotId);
  if (!found) {
    throw new Error(`Missing set-distribution slot ${weekNumber}:${slotId}`);
  }
  return found;
}

function lane(
  plan: V2SetDistributionIntent,
  slotId: string,
  laneId: string,
  weekNumber = 2,
): IntentLane {
  const found = slot(plan, slotId, weekNumber).lanes.find(
    (row) => row.laneId === laneId,
  );
  if (!found) {
    throw new Error(`Missing set-distribution lane ${weekNumber}:${slotId}:${laneId}`);
  }
  return found;
}

function classLane(
  policy: V2PlannerMesocyclePolicy,
  slotId: string,
  laneId: string,
  weekNumber = 2,
): ClassLane {
  const found = policy.exerciseClassDistributionBySlot.weeks
    .find((row) => row.week === weekNumber)
    ?.slots.find((row) => row.slotId === slotId)
    ?.classLanes.find((row) => row.laneId === laneId);
  if (!found) {
    throw new Error(`Missing class lane ${weekNumber}:${slotId}:${laneId}`);
  }
  return found;
}

function demandRange(
  policy: V2PlannerMesocyclePolicy,
  muscle: string,
  weekNumber = 2,
): V2PlannerSetRange {
  const found = policy.weeklyDemandCurve.weeks
    .find((row) => row.week === weekNumber)
    ?.muscles.find((row) => row.muscle === muscle);
  if (!found) {
    throw new Error(`Missing demand ${weekNumber}:${muscle}`);
  }
  return found.targetSetRange;
}

function sumPreferred(lanes: ReadonlyArray<IntentLane>): number {
  return lanes.reduce((sum, row) => sum + row.setBudget.preferred, 0);
}

function lanesForMuscle(
  plan: V2SetDistributionIntent,
  muscle: string,
  weekNumber = 2,
): IntentLane[] {
  return week(plan, weekNumber).slots.flatMap((slotRow) =>
    slotRow.lanes.filter((laneRow) => laneRow.primaryMuscles.includes(muscle)),
  );
}

function rawLaneSummedPreferred(muscle: string): number {
  return buildV2TargetSkeleton().slots
    .flatMap((slotRow) => slotRow.lanes)
    .filter((laneRow) => laneRow.primaryMuscles.includes(muscle))
    .reduce((sum, laneRow) => sum + laneRow.targetSets.preferred, 0);
}

describe("buildV2SetDistributionIntent", () => {
  it("consumes ownership-driven exercise class lanes before exact exercise selection", () => {
    const policy = buildPolicy();
    const plan = policy.v2SetDistributionIntent;
    const chest = lane(plan, "upper_a", "chest_anchor");
    const chestClassLane = classLane(policy, "upper_a", "chest_anchor");

    expect(plan).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
    });
    expect(chest).toMatchObject({
      classLaneKind: "owned_class_lane",
      allocatedTargetSetRange: chestClassLane.allocatedTargetSetRange,
      ownershipKinds: ["primary_exposure"],
      setBudget: {
        preferred: 4,
        basis: "class_ownership_allocation",
      },
    });
    expect(chest.evidenceBasis).toEqual(
      expect.arrayContaining([
        "exercise_class_distribution_by_slot",
        "slot_demand_allocation_ownership_rows",
        "allocated_target_set_range",
        "session_capacity_policy",
      ]),
    );
    expect(JSON.stringify(plan)).not.toMatch(
      /exerciseId|exerciseName|selectedExercise|inventoryEvidence|repairMateriality|slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });

  it("does not use raw skeleton lane budgets as target policy", () => {
    const plan = intent();
    const upperA = slot(plan, "upper_a");

    expect(upperA.lanes.map((row) => row.laneId)).not.toContain(
      "chest_secondary",
    );
    expect(sumPreferred(lanesForMuscle(plan, "Hamstrings"))).toBeLessThan(
      rawLaneSummedPreferred("Hamstrings"),
    );
    expect(sumPreferred(lanesForMuscle(plan, "Chest"))).toBeLessThan(
      rawLaneSummedPreferred("Chest"),
    );
  });

  it("gives Chest two sane exposures without duplicate-class inflation", () => {
    const plan = intent();
    const upperAChest = lane(plan, "upper_a", "chest_anchor");
    const upperBChest = lane(plan, "upper_b", "chest_second_exposure");

    expect(upperAChest).toMatchObject({
      preferredExerciseClasses: ["horizontal_press", "slight_incline_press"],
      setBudget: { min: 3, preferred: 4, max: 4 },
    });
    expect(upperBChest).toMatchObject({
      classLaneKind: "support_class_lane",
      preferredExerciseClasses: [
        "distinct_chest_press_or_fly",
        "fly",
        "machine_press",
        "cable_press",
      ],
      setBudget: { min: 2, preferred: 4, max: 4 },
    });
    expect(sumPreferred([upperAChest, upperBChest])).toBeLessThanOrEqual(
      demandRange(buildPolicy(), "Chest").preferred,
    );
  });

  it("keeps Hamstrings hinge and curl split within balanced demand", () => {
    const policy = buildPolicy();
    const plan = policy.v2SetDistributionIntent;
    const hamstrings = lanesForMuscle(plan, "Hamstrings");

    expect(hamstrings.map((row) => `${row.laneId}:${row.setBudget.preferred}`))
      .toEqual([
        "hamstring_curl:2",
        "secondary_hinge:1",
        "hinge_anchor:3",
        "knee_flexion_curl:2",
      ]);
    expect(sumPreferred(hamstrings)).toBeLessThanOrEqual(
      demandRange(policy, "Hamstrings").max,
    );
    expect(sumPreferred(hamstrings)).toBeLessThan(rawLaneSummedPreferred("Hamstrings"));
  });

  it("plans calves as direct lower-slot set budgets", () => {
    const plan = intent();

    expect(lane(plan, "lower_a", "calves")).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Calves"],
      setBudget: { min: 3, preferred: 4, max: 4 },
    });
    expect(lane(plan, "lower_b", "calves")).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Calves"],
      setBudget: { min: 3, preferred: 4, max: 4 },
    });
  });

  it("plans Side Delts as direct work instead of vertical-press collateral only", () => {
    const plan = intent();

    expect(lane(plan, "upper_b", "side_delt_isolation")).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Side Delts"],
      directFloor: {
        muscle: "Side Delts",
        minDirectSets: 3,
        collateralCanSatisfy: false,
      },
      setBudget: { min: 3, preferred: 4, max: 4, basis: "support_direct_floor" },
    });
    expect(lane(plan, "upper_b", "vertical_press")).toMatchObject({
      classLaneKind: "managed_collateral_marker",
      primaryMuscles: [],
      managedCollateralMuscles: ["Front Delts"],
      setBudget: { min: 0, preferred: 0, max: 0 },
    });
  });

  it("plans rear delts, biceps, and triceps direct/support budgets", () => {
    const plan = intent();

    expect(lane(plan, "upper_a", "rear_delt")).toMatchObject({
      directFloor: { muscle: "Rear Delts", minDirectSets: 2 },
      setBudget: { min: 2, preferred: 3, max: 3, basis: "support_direct_floor" },
    });
    expect(lane(plan, "upper_a", "triceps")).toMatchObject({
      directFloor: { muscle: "Triceps", minDirectSets: 2 },
      setBudget: { min: 2, preferred: 3, max: 3, basis: "support_direct_floor" },
    });
    expect(lane(plan, "upper_b", "biceps")).toMatchObject({
      directFloor: { muscle: "Biceps", minDirectSets: 2 },
      setBudget: { min: 2, preferred: 3, max: 3, basis: "support_direct_floor" },
    });
  });

  it("keeps optional lanes at zero unless activation criteria are met elsewhere", () => {
    const plan = intent();

    expect(lane(plan, "upper_b", "optional_triceps_if_under_target")).toMatchObject({
      classLaneKind: "optional_recoverable_lane",
      optionalMuscles: ["Triceps"],
      setBudget: {
        min: 0,
        preferred: 0,
        max: 0,
        basis: "optional_activation_required",
      },
      optionalActivation: {
        type: "activate_only_if_weekly_target_below_range",
        weeklyFloorSets: 4,
      },
    });
    expect(lane(plan, "lower_b", "optional_glute_core_if_recoverable")).toMatchObject(
      {
        classLaneKind: "optional_recoverable_lane",
        optionalMuscles: ["Core", "Glutes"],
        setBudget: {
          min: 0,
          preferred: 0,
          max: 0,
          basis: "optional_activation_required",
        },
      },
    );
  });

  it("keeps managed collateral rows at zero direct set budget", () => {
    const plan = intent();
    const managed = week(plan).slots.flatMap((slotRow) =>
      slotRow.lanes.filter(
        (laneRow) => laneRow.classLaneKind === "managed_collateral_marker",
      ),
    );

    expect(managed.map((row) => `${row.laneId}:${row.managedCollateralMuscles.join("+")}`))
      .toEqual([
        "vertical_press:Front Delts",
      ]);
    expect(lane(plan, "lower_b", "hinge_anchor")).toMatchObject({
      managedCollateralMuscles: ["Glutes", "Lower Back"],
      setBudget: { min: 3, preferred: 3, max: 4 },
    });
    expect(managed.every((row) => row.setBudget.preferred === 0)).toBe(true);
  });

  it("prevents default 5-set stacking and stays within slot capacity", () => {
    const policy = buildPolicy();
    const plan = policy.v2SetDistributionIntent;

    for (const planWeek of plan.weeks) {
      for (const planSlot of planWeek.slots) {
        const allocationSlot = policy.slotDemandAllocationByWeek.weeks
          .find((row) => row.week === planWeek.week)
          ?.slots.find((row) => row.slotId === planSlot.slotId);

        expect(planSlot.targetSessionSets.preferred).toBeLessThanOrEqual(
          allocationSlot?.targetSessionSets.max ?? Number.POSITIVE_INFINITY,
        );
        expect(planSlot.targetSessionSets.max).toBeLessThanOrEqual(
          allocationSlot?.targetSessionSets.max ?? Number.POSITIVE_INFINITY,
        );
        for (const planLane of planSlot.lanes) {
          expect(planLane.setBudget.max).toBeLessThanOrEqual(4);
          expect(
            planLane.capPolicy.maxSetsPerExerciseWithoutJustification,
          ).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it("keeps read-only guardrails explicit", () => {
    expect(intent().guardrails).toEqual({
      doesNotUseRepairedProjectionAsTarget: true,
      doesNotUseAcceptedSeedAsTarget: true,
      doesNotAffectSelection: true,
      doesNotAffectRepair: true,
      doesNotAffectSeedSerialization: true,
      doesNotAffectRuntimeReplay: true,
    });
  });
});
