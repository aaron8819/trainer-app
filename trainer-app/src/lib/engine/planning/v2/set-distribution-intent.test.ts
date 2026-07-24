import { describe, expect, it } from "vitest";
import { VOLUME_LANDMARKS } from "@/lib/engine/volume-landmarks";
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

function setBudgetTotalForMuscle(
  plan: V2SetDistributionIntent,
  muscle: string,
  weekNumber = 2,
): number {
  return week(plan, weekNumber).slots
    .flatMap((slotRow) => slotRow.lanes)
    .filter(
      (laneRow) =>
        laneRow.primaryMuscles.includes(muscle) ||
        laneRow.optionalMuscles.includes(muscle),
    )
    .reduce((sum, laneRow) => sum + laneRow.setBudget.preferred, 0);
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
    expect(sumPreferred(lanesForMuscle(plan, "Chest"))).toBe(7);
    expect(sumPreferred(lanesForMuscle(plan, "Chest"))).toBeLessThanOrEqual(
      rawLaneSummedPreferred("Chest"),
    );
  });

  it("gives Chest enough sane exposures without duplicate-class inflation", () => {
    const plan = intent();
    const upperAChest = lane(plan, "upper_a", "chest_anchor");
    const upperBChest = lane(plan, "upper_b", "chest_second_exposure");
    const upperBPressSupport = lane(plan, "upper_b", "vertical_press");

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
      setBudget: { min: 2, preferred: 3, max: 3 },
    });
    expect(upperBPressSupport).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Front Delts"],
      preferredExerciseClasses: ["vertical_press"],
      setBudget: { min: 2, preferred: 3, max: 3 },
    });
    expect(sumPreferred([upperAChest, upperBChest])).toBe(7);
  });

  it("uses role-sensitive preferred budgets instead of making every lane 4 sets", () => {
    const plan = intent();

    expect(lane(plan, "upper_a", "row_anchor")).toMatchObject({
      role: "anchor",
      setBudget: { min: 3, preferred: 3, max: 4 },
    });
    expect(lane(plan, "upper_a", "vertical_pull_support")).toMatchObject({
      role: "support",
      setBudget: { min: 2, preferred: 2, max: 3 },
    });
    expect(lane(plan, "upper_b", "vertical_pull_anchor")).toMatchObject({
      role: "anchor",
      setBudget: { min: 3, preferred: 3, max: 4 },
    });
    expect(lane(plan, "upper_b", "row_support")).toMatchObject({
      role: "support",
      setBudget: { min: 2, preferred: 3, max: 3 },
    });
    expect(lane(plan, "lower_b", "calves")).toMatchObject({
      role: "accessory",
      setBudget: { min: 3, preferred: 5, max: 5 },
    });
    expect(
      week(plan).slots
        .flatMap((slotRow) => slotRow.lanes)
        .filter((laneRow) => laneRow.setBudget.preferred === 4),
    ).toHaveLength(6);
  });

  it("keeps Hamstrings hinge and curl split within balanced demand", () => {
    const policy = buildPolicy();
    const plan = policy.v2SetDistributionIntent;
    const hamstrings = lanesForMuscle(plan, "Hamstrings");

    expect(hamstrings.map((row) => `${row.laneId}:${row.setBudget.preferred}`))
      .toEqual([
        "hamstring_curl:2",
        "hinge_anchor:3",
        "knee_flexion_curl:3",
      ]);
    expect(sumPreferred(hamstrings)).toBeLessThanOrEqual(
      demandRange(policy, "Hamstrings").max,
    );
    expect(sumPreferred(hamstrings)).toBeLessThan(rawLaneSummedPreferred("Hamstrings"));
  });

  it("keeps Calves weekly demand distinct from executable lower-slot budgets", () => {
    const policy = buildPolicy();
    const plan = policy.v2SetDistributionIntent;

    expect(lane(plan, "lower_a", "calves")).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Calves"],
      setBudget: { min: 3, preferred: 3, max: 3 },
    });
    expect(lane(plan, "lower_b", "calves")).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Calves"],
      setBudget: { min: 3, preferred: 5, max: 5 },
    });
    expect(demandRange(policy, "Calves")).toEqual({
      min: 6,
      preferred: 8,
      max: 10,
    });
    expect(setBudgetTotalForMuscle(plan, "Calves")).toBe(8);
  });

  it("plans Side Delts as two direct exposures and keeps Vertical Press class-owned", () => {
    const plan = intent();

    expect(lane(plan, "upper_a", "side_delt_isolation")).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Side Delts"],
      directFloor: {
        muscle: "Side Delts",
        minDirectSets: 4,
        collateralCanSatisfy: false,
      },
      setBudget: { min: 4, preferred: 4, max: 4, basis: "support_direct_floor" },
    });
    expect(lane(plan, "upper_b", "side_delt_isolation")).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Side Delts"],
      directFloor: {
        muscle: "Side Delts",
        minDirectSets: 4,
        collateralCanSatisfy: false,
      },
      setBudget: { min: 4, preferred: 4, max: 4, basis: "support_direct_floor" },
    });
    expect(lane(plan, "upper_b", "vertical_press")).toMatchObject({
      classLaneKind: "support_class_lane",
      primaryMuscles: ["Front Delts"],
      managedCollateralMuscles: [],
      preferredExerciseClasses: ["vertical_press"],
      setBudget: { min: 2, preferred: 3, max: 3 },
    });
    expect(
      lane(plan, "upper_b", "vertical_press").ownershipKinds,
    ).toContain("support_exposure");
  });

  it("plans rear delts, biceps, and triceps direct/support budgets", () => {
    const plan = intent();

    expect(lane(plan, "upper_a", "rear_delt")).toMatchObject({
      directFloor: { muscle: "Rear Delts", minDirectSets: 4 },
      setBudget: { min: 4, preferred: 4, max: 4, basis: "support_direct_floor" },
    });
    expect(lane(plan, "upper_a", "triceps")).toMatchObject({
      directFloor: { muscle: "Triceps", minDirectSets: 4 },
      setBudget: { min: 4, preferred: 4, max: 4, basis: "support_direct_floor" },
    });
    expect(lane(plan, "upper_b", "biceps")).toMatchObject({
      directFloor: { muscle: "Biceps", minDirectSets: 2 },
      setBudget: { min: 2, preferred: 3, max: 3, basis: "support_direct_floor" },
    });
  });

  it("authors Side Delt, Rear Delt, and Triceps support-floor coverage upstream without MAV or primary-lane regression", () => {
    const plan = intent();

    expect(setBudgetTotalForMuscle(plan, "Side Delts")).toBeGreaterThanOrEqual(
      VOLUME_LANDMARKS["Side Delts"].mev,
    );
    expect(setBudgetTotalForMuscle(plan, "Rear Delts")).toBeGreaterThanOrEqual(
      VOLUME_LANDMARKS["Rear Delts"].mev,
    );
    expect(setBudgetTotalForMuscle(plan, "Triceps")).toBeGreaterThanOrEqual(5);

    for (const muscle of ["Side Delts", "Rear Delts", "Triceps"] as const) {
      expect(setBudgetTotalForMuscle(plan, muscle)).toBeLessThanOrEqual(
        VOLUME_LANDMARKS[muscle].mav,
      );
    }
    for (const planWeek of plan.weeks) {
      for (const planSlot of planWeek.slots) {
        for (const planLane of planSlot.lanes) {
          expect(planLane.setBudget.preferred).toBeLessThanOrEqual(
            planLane.laneId === "calves" ? 5 : 4,
          );
        }
      }
    }
    expect(lane(plan, "upper_a", "chest_anchor")).toMatchObject({
      setBudget: { min: 3, preferred: 4, max: 4 },
    });
    expect(lane(plan, "upper_b", "vertical_pull_anchor")).toMatchObject({
      setBudget: { min: 3, preferred: 3, max: 4 },
    });
  });

  it("activates bounded Triceps support-floor top-up without broad optional volume", () => {
    const plan = intent();

    expect(lane(plan, "upper_b", "optional_triceps_if_under_target")).toMatchObject({
      classLaneKind: "optional_recoverable_lane",
      optionalMuscles: ["Triceps"],
      setBudget: {
        min: 2,
        preferred: 2,
        max: 2,
        basis: "optional_activation_required",
      },
      optionalActivation: {
        type: "activate_only_if_weekly_target_below_range",
        weeklyFloorSets: 6,
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
    expect(lane(plan, "lower_a", "secondary_hinge")).toMatchObject({
      classLaneKind: "optional_recoverable_lane",
      optionalMuscles: ["Hamstrings"],
      managedCollateralMuscles: ["Glutes", "Lower Back"],
      setBudget: {
        min: 0,
        preferred: 0,
        max: 0,
        basis: "optional_activation_required",
      },
    });
  });

  it("keeps managed collateral rows at zero direct set budget", () => {
    const plan = intent();
    const managed = week(plan).slots.flatMap((slotRow) =>
      slotRow.lanes.filter(
        (laneRow) => laneRow.classLaneKind === "managed_collateral_marker",
      ),
    );

    expect(managed.map((row) => `${row.laneId}:${row.managedCollateralMuscles.join("+")}`))
      .toEqual([]);
    expect(lane(plan, "lower_b", "hinge_anchor")).toMatchObject({
      managedCollateralMuscles: ["Glutes", "Lower Back"],
      setBudget: { min: 3, preferred: 3, max: 4 },
    });
    expect(managed.every((row) => row.setBudget.preferred === 0)).toBe(true);
  });

  it("keeps the representative accumulation base within the sane weekly set range", () => {
    const plan = intent();
    const accumulationTotal = week(plan, 2).slots.reduce(
      (sum, row) => sum + row.targetSessionSets.preferred,
      0,
    );

    expect(accumulationTotal).toBe(67);
    expect(accumulationTotal).toBeGreaterThanOrEqual(60);
    expect(accumulationTotal).toBeLessThanOrEqual(67);
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
          expect(planLane.setBudget.max).toBeLessThanOrEqual(
            planLane.laneId === "calves" ? 5 : 4,
          );
          expect(
            planLane.capPolicy.maxSetsPerExerciseWithoutJustification,
          ).toBeLessThanOrEqual(planLane.laneId === "calves" ? 5 : 4);
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
