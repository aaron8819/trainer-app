import { describe, expect, it } from "vitest";
import {
  buildProjectionBehaviorTrialGateMetricsFromPlanningReality,
  evaluateProjectionBehaviorTrialGate,
  findDistributionGuardActionInvariantViolations,
  type ProjectionBehaviorTrialGateMetrics,
} from "./planning-reality-invariants.test-helper";

const baselineTrialGateMetrics: ProjectionBehaviorTrialGateMetrics = {
  materialRepairCount: 20,
  majorRepairCount: 10,
  suspiciousRepairCount: 6,
  highExerciseConcentrationCount: 4,
  weakPreselectionConsumptionCount: 0,
  forbiddenFinalPrimaryViolationCount: 0,
};

function evaluateImprovedChestTrial(
  trial: Partial<ProjectionBehaviorTrialGateMetrics>,
) {
  return evaluateProjectionBehaviorTrialGate({
    baseline: baselineTrialGateMetrics,
    trial: {
      ...baselineTrialGateMetrics,
      ...trial,
    },
    intendedImprovement: {
      metric: "Chest effective sets",
      baselineValue: 7,
      trialValue: 9,
      direction: "increase",
    },
  });
}

const basePlanningReality = {
  setDistributionIntents: [
    {
      slotId: "upper_a",
      musclePolicies: [
        {
          muscle: "Chest",
          maxSingleExerciseShare: 0.5,
          maxSinglePatternShare: 0.7,
          whenAtLimit: "prefer_alternative",
        },
      ],
      evidence: {
        concentrationRows: ["upper_a:Incline Dumbbell Bench Press:Chest:57.1%"],
        capCleanupRows: [],
        repairRowsStillRepairOwned: [],
      },
    },
  ],
  exerciseConcentration: [
    {
      slotId: "upper_a",
      exerciseName: "Incline Dumbbell Bench Press",
      primaryMuscles: ["Chest"],
      flags: ["EXERCISE_SUPPLIES_OVER_50_PERCENT_WEEKLY_STIMULUS"],
    },
  ],
};

describe("planningReality distribution guard invariants", () => {
  it("rejects a reroute to the same exercise", () => {
    const violations = findDistributionGuardActionInvariantViolations({
      ...basePlanningReality,
      distributionGuardActions: [
        {
          slotId: "upper_a",
          exerciseName: "Incline Dumbbell Bench Press",
          muscle: "Chest",
          attemptedAction: "set_bump",
          decision: "rerouted",
          reason: "single_exercise_share_limit",
          alternativeExerciseName: "Incline Dumbbell Bench Press",
        },
      ],
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "reroute_to_same_exercise",
          slotId: "upper_a",
          exerciseName: "Incline Dumbbell Bench Press",
          muscle: "Chest",
        }),
      ]),
    );
  });

  it("accepts a valid reroute to a different compatible exercise", () => {
    expect(
      findDistributionGuardActionInvariantViolations({
        ...basePlanningReality,
        distributionGuardActions: [
          {
            slotId: "upper_a",
            exerciseName: "Incline Dumbbell Bench Press",
            muscle: "Chest",
            attemptedAction: "set_bump",
            decision: "rerouted",
            reason: "single_exercise_share_limit",
            alternativeExerciseName: "Cable Fly",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("accepts the current live-like left-unresolved row without an alternative", () => {
    expect(
      findDistributionGuardActionInvariantViolations({
        ...basePlanningReality,
        distributionGuardActions: [
          {
            slotId: "upper_a",
            exerciseName: "Incline Dumbbell Bench Press",
            muscle: "Chest",
            attemptedAction: "set_bump",
            decision: "left_unresolved",
            reason: "single_exercise_share_limit",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("rejects left-unresolved rows that claim an alternative receiver", () => {
    const violations = findDistributionGuardActionInvariantViolations({
      ...basePlanningReality,
      distributionGuardActions: [
        {
          slotId: "upper_a",
          exerciseName: "Incline Dumbbell Bench Press",
          muscle: "Chest",
          attemptedAction: "set_bump",
          decision: "left_unresolved",
          reason: "single_exercise_share_limit",
          alternativeExerciseName: "Cable Fly",
        },
      ],
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "left_unresolved_has_alternative",
        }),
      ]),
    );
  });

  it("rejects duplicate noisy final rows", () => {
    const action = {
      slotId: "upper_a",
      exerciseName: "Incline Dumbbell Bench Press",
      muscle: "Chest",
      attemptedAction: "set_bump",
      decision: "left_unresolved",
      reason: "single_exercise_share_limit",
    };

    const violations = findDistributionGuardActionInvariantViolations({
      ...basePlanningReality,
      distributionGuardActions: [action, { ...action }],
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "duplicate_distribution_guard_action",
        }),
      ]),
    );
  });

  it("rejects transient blocked rows when a final outcome row exists", () => {
    const baseAction = {
      slotId: "upper_a",
      exerciseName: "Incline Dumbbell Bench Press",
      muscle: "Chest",
      attemptedAction: "set_bump",
      reason: "single_exercise_share_limit",
    };

    const violations = findDistributionGuardActionInvariantViolations({
      ...basePlanningReality,
      distributionGuardActions: [
        {
          ...baseAction,
          decision: "blocked",
        },
        {
          ...baseAction,
          decision: "left_unresolved",
        },
      ],
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "transient_distribution_guard_attempt_leaked",
        }),
      ]),
    );
  });

  it("rejects guard rows without policy or concentration evidence", () => {
    const violations = findDistributionGuardActionInvariantViolations({
      distributionGuardActions: [
        {
          slotId: "upper_a",
          exerciseName: "Incline Dumbbell Bench Press",
          muscle: "Chest",
          attemptedAction: "set_bump",
          decision: "left_unresolved",
          reason: "single_exercise_share_limit",
        },
      ],
    });

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "untraceable_distribution_guard_action",
        }),
      ]),
    );
  });
});

describe("projection behavior trial materiality gate", () => {
  it("fails when target improves but materialRepairCount increases", () => {
    const result = evaluateImprovedChestTrial({
      materialRepairCount: baselineTrialGateMetrics.materialRepairCount + 1,
    });

    expect(result).toMatchObject({
      decision: "revert_candidate",
      failedReasons: expect.arrayContaining([
        "materialRepairCount:20->21:regressed",
      ]),
      improvedSignals: expect.arrayContaining([
        "Chest effective sets:7->9:improved",
      ]),
    });
  });

  it("fails when target improves but majorRepairCount increases", () => {
    const result = evaluateImprovedChestTrial({
      majorRepairCount: baselineTrialGateMetrics.majorRepairCount + 1,
    });

    expect(result).toMatchObject({
      decision: "revert_candidate",
      failedReasons: expect.arrayContaining([
        "majorRepairCount:10->11:regressed",
      ]),
    });
  });

  it("fails when target improves but suspicious repairs increase", () => {
    const result = evaluateImprovedChestTrial({
      suspiciousRepairCount:
        baselineTrialGateMetrics.suspiciousRepairCount + 1,
    });

    expect(result).toMatchObject({
      decision: "revert_candidate",
      failedReasons: expect.arrayContaining([
        "suspiciousRepairCount:6->7:regressed",
      ]),
    });
  });

  it("fails when weak preselection appears", () => {
    const result = evaluateImprovedChestTrial({
      weakPreselectionConsumptionCount: 1,
    });

    expect(result).toMatchObject({
      decision: "revert_candidate",
      failedReasons: expect.arrayContaining([
        "weakPreselectionConsumptionCount:0->1:regressed",
      ]),
    });
  });

  it("fails when forbidden final-primary violations appear", () => {
    const baseline =
      buildProjectionBehaviorTrialGateMetricsFromPlanningReality({
        summary: {
          materialRepairCount: 0,
          majorRepairCount: 0,
          highExerciseConcentrationCount: 0,
        },
        suspiciousRepairsNotEligibleForPromotion: [],
        weakPreselectionConsumption: [],
      });
    const trial = buildProjectionBehaviorTrialGateMetricsFromPlanningReality({
      summary: {
        materialRepairCount: 0,
        majorRepairCount: 0,
        highExerciseConcentrationCount: 0,
      },
      suspiciousRepairsNotEligibleForPromotion: [],
      weakPreselectionConsumption: [],
      finalSlotPlan: [
        {
          slotId: "lower_b",
          exercises: [
            {
              exerciseId: "cable-crossover",
              exerciseName: "Cable Crossover",
              primaryMuscles: ["Chest"],
            },
          ],
        },
      ],
      slotPrescriptionIntents: [
        {
          slotId: "lower_b",
          musclePrescriptions: [
            {
              muscle: "Chest",
              targetStatus: "forbidden",
              demandType: "do_not_train_here",
            },
          ],
        },
      ],
    });

    const result = evaluateProjectionBehaviorTrialGate({
      baseline,
      trial,
      intendedImprovement: {
        metric: "Chest effective sets",
        baselineValue: 7,
        trialValue: 9,
        direction: "increase",
      },
    });

    expect(result).toMatchObject({
      decision: "revert_candidate",
      failedReasons: expect.arrayContaining([
        "forbiddenFinalPrimaryViolationCount:0->1:regressed",
      ]),
    });
  });

  it("passes only when target improves and repair/invariant metrics stay flat or improve", () => {
    const result = evaluateProjectionBehaviorTrialGate({
      baseline: baselineTrialGateMetrics,
      trial: {
        ...baselineTrialGateMetrics,
        materialRepairCount: 19,
        majorRepairCount: 10,
        suspiciousRepairCount: 6,
        highExerciseConcentrationCount: 3,
      },
      intendedImprovement: {
        metric: "Chest effective sets",
        baselineValue: 7,
        trialValue: 9,
        direction: "increase",
      },
    });

    expect(result).toMatchObject({
      decision: "keep_candidate",
      failedReasons: [],
      improvedSignals: expect.arrayContaining([
        "Chest effective sets:7->9:improved",
        "materialRepairCount:20->19:improved",
        "highExerciseConcentrationCount:4->3:improved",
      ]),
    });
  });

  it("classifies the failed Chest upper-slot distinct exercise distribution trial as revert_candidate", () => {
    const result = evaluateProjectionBehaviorTrialGate({
      baseline: baselineTrialGateMetrics,
      trial: {
        ...baselineTrialGateMetrics,
        materialRepairCount: 25,
        majorRepairCount: 16,
        suspiciousRepairCount: 11,
      },
      intendedImprovement: {
        metric: "Chest effective sets with lower Incline DB Bench duplication",
        baselineValue: 7,
        trialValue: 9,
        direction: "increase",
      },
    });

    expect(result).toMatchObject({
      decision: "revert_candidate",
      failedReasons: expect.arrayContaining([
        "materialRepairCount:20->25:regressed",
        "majorRepairCount:10->16:regressed",
        "suspiciousRepairCount:6->11:regressed",
      ]),
      improvedSignals: expect.arrayContaining([
        "Chest effective sets with lower Incline DB Bench duplication:7->9:improved",
      ]),
    });
  });
});
