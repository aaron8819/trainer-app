import { describe, expect, it } from "vitest";
import {
  buildV2PlannerMesocyclePolicy,
  buildV2SelectionCapacityPlan,
} from "./index";

function buildPlan() {
  const policy = buildV2PlannerMesocyclePolicy();
  return buildV2SelectionCapacityPlan({
    exerciseClassDistributionBySlot: policy.exerciseClassDistributionBySlot,
    v2SetDistributionIntent: policy.v2SetDistributionIntent,
    v2SupportLanePolicy: policy.v2SupportLanePolicy,
  });
}

function buildPlanWithExplicitUpperBCap(maxExerciseCount: number) {
  const policy = buildV2PlannerMesocyclePolicy();
  return buildV2SelectionCapacityPlan({
    exerciseClassDistributionBySlot: policy.exerciseClassDistributionBySlot,
    v2SetDistributionIntent: policy.v2SetDistributionIntent,
    v2SupportLanePolicy: policy.v2SupportLanePolicy,
    sessionCapacity: {
      maxExerciseCountBySlot: {
        upper_b: maxExerciseCount,
      },
    },
  });
}

function lane(
  week: number,
  slotId: string,
  laneId: string,
) {
  const found = buildPlan()
    .weeks.find((row) => row.week === week)
    ?.slots.find((slot) => slot.slotId === slotId)
    ?.lanes.find((row) => row.laneId === laneId);
  if (!found) {
    throw new Error(`Missing capacity lane ${week}:${slotId}:${laneId}`);
  }
  return found;
}

function slot(week: number, slotId: string) {
  const found = buildPlan()
    .weeks.find((row) => row.week === week)
    ?.slots.find((row) => row.slotId === slotId);
  if (!found) {
    throw new Error(`Missing capacity slot ${week}:${slotId}`);
  }
  return found;
}

function collectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys);
  }
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...collectKeys(nested),
  ]);
}

describe("buildV2SelectionCapacityPlan", () => {
  it("returns deterministic V2 pre-selection capacity policy", () => {
    const first = buildPlan();
    const second = buildPlan();

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      version: 1,
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      capacityTiming: "before_exercise_selection",
      guardrails: {
        doesNotUseSelectedIdentities: true,
        doesNotUseNoRepairOutput: true,
        doesNotUseRepairedProjection: true,
        doesNotAffectSelection: true,
        doesNotAffectRepair: true,
        doesNotAffectRuntimeReplay: true,
      },
    });
    expect(first.weeks.map((week) => week.week)).toEqual([1, 2, 3, 4, 5]);
  });

  it("does not carry selected identities, diagnostics, readouts, or artifact fields", () => {
    const keys = collectKeys(buildPlan());

    expect(keys).not.toEqual(
      expect.arrayContaining([
        "status",
        "summary",
        "blockers",
        "warnings",
        "safeForBehaviorPromotion",
        "selectedIdentity",
        "selectedExercise",
        "exerciseId",
        "exerciseName",
        "v2TargetVsNoRepairDiff",
        "v2ExerciseSelectionPlanDiagnostic",
        "comparisonToRepaired",
        "repairMateriality",
        "weeklyMuscleTotals",
        "slotPlans",
        "debugArtifact",
        "readout",
        "artifact",
      ]),
    );
  });

  it("preserves the bounded 3/5 calf allocation with an explicit 5-set lane cap", () => {
    expect(lane(4, "lower_a", "calves")).toMatchObject({
      role: "accessory",
      setBudget: { min: 3, preferred: 3, max: 3 },
      perExerciseCap: {
        maxSetsWithoutJustification: 5,
        maxDirectExercises: 1,
        allowAboveFiveSetsOnlyWithJustification: true,
      },
      laneHeadroomPolicy: {
        preferredRequiresHeadroom: false,
        cleanAlternativeRequiredForExpansion: false,
        capAwareExpansion: "not_needed",
      },
    });
    expect(lane(4, "lower_b", "calves")).toMatchObject({
      setBudget: { min: 3, preferred: 5, max: 5 },
      perExerciseCap: { maxSetsWithoutJustification: 5 },
      laneHeadroomPolicy: {
        capAwareExpansion: "not_needed",
      },
    });
  });

  it("represents optional support lane activation rules without evaluating eligibility", () => {
    expect(lane(1, "upper_b", "optional_triceps_if_under_target")).toMatchObject({
      role: "optional",
      optionalActivation: {
        type: "activate_only_if_weekly_target_below_range",
        weeklyFloorSets: 6,
        requiresSlotExerciseHeadroom: true,
        requiresCleanAlternative: true,
        requiresRecoverability: true,
      },
      laneHeadroomPolicy: {
        preferredRequiresHeadroom: false,
        cleanAlternativeRequiredForExpansion: true,
      },
    });
    expect(lane(1, "upper_a", "triceps").optionalActivation).toEqual({
      type: "not_applicable",
    });
  });

  it("represents per-exercise caps separately from lane set budgets", () => {
    expect(lane(2, "upper_a", "chest_anchor")).toMatchObject({
      setBudget: { min: 3, preferred: 4, max: 4 },
      perExerciseCap: {
        maxSetsWithoutJustification: 4,
        maxDirectExercises: 2,
        allowAboveFiveSetsOnlyWithJustification: true,
      },
    });
    expect(lane(2, "upper_a", "rear_delt")).toMatchObject({
      setBudget: { min: 4, preferred: 4, max: 4 },
      perExerciseCap: {
        maxSetsWithoutJustification: 4,
        maxDirectExercises: 1,
        allowAboveFiveSetsOnlyWithJustification: true,
      },
    });
  });

  it("carries upper and lower slot capacity plus target session sets", () => {
    expect(slot(2, "upper_b")).toMatchObject({
      slotId: "upper_b",
      slotIndex: 2,
      maxExerciseCount: 7,
      targetSessionSets: { min: 15, preferred: 21, max: 21 },
    });
    expect(slot(2, "lower_b")).toMatchObject({
      slotId: "lower_b",
      slotIndex: 3,
      maxExerciseCount: 6,
      targetSessionSets: { min: 10, preferred: 14, max: 15 },
    });
  });

  it("adds only one protected headroom slot for budgeted support-floor optional lanes", () => {
    expect(slot(2, "upper_b").maxExerciseCount).toBe(7);
    expect(slot(2, "upper_a").maxExerciseCount).toBe(6);
    expect(slot(2, "lower_a").maxExerciseCount).toBe(6);
    expect(slot(2, "lower_b").maxExerciseCount).toBe(6);
  });

  it("respects explicit stronger slot caps over protected support-floor headroom", () => {
    const explicit = buildPlanWithExplicitUpperBCap(6);
    const upperB = explicit.weeks
      .find((week) => week.week === 2)
      ?.slots.find((row) => row.slotId === "upper_b");

    expect(upperB).toMatchObject({
      slotId: "upper_b",
      maxExerciseCount: 6,
    });
  });

  it("represents upper-pull capacity as policy headroom rather than observed pressure", () => {
    expect(lane(2, "upper_a", "row_anchor")).toMatchObject({
      setBudget: { min: 3, preferred: 3, max: 4 },
      laneHeadroomPolicy: {
        preferredRequiresHeadroom: false,
        cleanAlternativeRequiredForExpansion: false,
        capAwareExpansion: "not_needed",
      },
    });
    expect(lane(2, "upper_b", "vertical_pull_anchor")).toMatchObject({
      laneHeadroomPolicy: {
        preferredRequiresHeadroom: false,
        cleanAlternativeRequiredForExpansion: false,
        capAwareExpansion: "not_needed",
      },
    });
  });

  it("is included in the aggregate V2 planner mesocycle policy", () => {
    const policy = buildV2PlannerMesocyclePolicy();

    expect(policy.selectionCapacityPlan).toEqual(buildPlan());
    expect(policy.selectionCapacityPlan.capacityTiming).toBe(
      "before_exercise_selection",
    );
  });
});
