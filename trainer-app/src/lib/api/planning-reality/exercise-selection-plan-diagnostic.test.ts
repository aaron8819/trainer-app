import { describe, expect, it } from "vitest";
import {
  buildV2ExerciseSelectionPlanDiagnostic,
  type V2ExerciseSelectionPlanDiagnostic,
} from "./exercise-selection-plan-diagnostic";

type BuilderInput = Parameters<typeof buildV2ExerciseSelectionPlanDiagnostic>[0];

function makeInput(overrides: {
  laneId?: string;
  plannedClasses?: string[];
  selectedClass?: string;
  currentStatus?: string;
  severity?: string;
  migrationRecommendation?: string;
  gapCause?: string;
  relevantDiagnostics?: string[];
  concentrationFlags?: string[];
  exerciseName?: string;
  slotId?: string;
  primaryMuscles?: string[];
  movementPatterns?: string[];
} = {}): BuilderInput {
  const slotId = overrides.slotId ?? "upper_a";
  const laneId = overrides.laneId ?? "rear_delt";
  const exerciseName = overrides.exerciseName ?? "Cable Rear Delt Fly";
  const primaryMuscles = overrides.primaryMuscles ?? ["Rear Delts"];
  const plannedClasses = overrides.plannedClasses ?? ["rear_delt_isolation"];

  return {
    plannerOwnedAccumulationProjection: {
      version: 1,
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      weeks: [],
    },
    week1SelectedIdentities: [
      {
        slotId,
        slotIndex: 0,
        intent: slotId.startsWith("lower") ? "lower" : "upper",
        exerciseCount: 1,
        totalSets: 2,
        projectedEffectiveStimulusByMuscle: Object.fromEntries(
          primaryMuscles.map((muscle) => [muscle, 2]),
        ),
        exercises: [
          {
            exerciseId: "exercise-1",
            exerciseName,
            role: "accessory",
            setCount: 2,
            primaryMuscles,
            movementPatterns: overrides.movementPatterns ?? ["isolation"],
            effectiveStimulusByMuscle: Object.fromEntries(
              primaryMuscles.map((muscle) => [muscle, 2]),
            ),
          },
        ],
      },
    ],
    v2SetDistributionIntent: {
      version: 1,
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        weekCount: 1,
        slotCount: 1,
        laneCount: 1,
        plannedTotalSetsByWeek: [],
      },
      weeks: [
        {
          week: 1,
          phase: "entry_calibration",
          volumeMultiplier: 1,
          slots: [
            {
              slotId,
              slotIndex: 0,
              intent: slotId.startsWith("lower") ? "lower" : "upper",
              lanes: [
                {
                  laneId,
                  role: "support",
                  primaryMuscles,
                  preferredExerciseClasses: plannedClasses,
                  setBudget: { min: 2, preferred: 2, max: 3 },
                  capPolicy: {
                    maxSetsPerExerciseWithoutJustification: 4,
                    maxDirectExercises: 1,
                  },
                },
              ],
            },
          ],
        },
      ],
      guardrails: {
        doesNotUseRepairedProjectionAsTarget: true,
        doesNotUseAcceptedSeedAsTarget: true,
        doesNotAffectSelection: true,
        doesNotAffectRepair: true,
        doesNotAffectRuntimeReplay: true,
      },
    },
    v2TargetVsNoRepairDiff: {
      slotDiffs: [
        {
          slotId,
          laneDiffs: [
            {
              laneId,
              targetPrimaryMuscles: primaryMuscles,
              targetExerciseClasses: plannedClasses,
              targetSets: { min: 2, preferred: 2, max: 3 },
              currentStatus: overrides.currentStatus ?? "partial",
              currentEvidence: {
                selectedExercises: [
                  {
                    name: exerciseName,
                    sets: 2,
                    matchedClass: overrides.selectedClass ?? plannedClasses[0],
                    role: "accessory",
                  },
                ],
                relevantDiagnostics: overrides.relevantDiagnostics ?? [
                  "setPolicy:quality_warning",
                  "concentration:quality_warning",
                  "justification:small_target_denominator",
                ],
              },
              gapCause: overrides.gapCause ?? "concentration_policy_gap",
              migrationRecommendation:
                overrides.migrationRecommendation ?? "keep_diagnostic_only",
              severity: overrides.severity ?? "quality_warning",
            },
          ],
        },
      ],
    },
    exerciseConcentration: [
      {
        slotId,
        intent: slotId.startsWith("lower") ? "lower" : "upper",
        exerciseId: "exercise-1",
        exerciseName,
        setCount: 2,
        role: "accessory",
        isCompound: false,
        primaryMuscles,
        effectiveStimulusContributionByMuscle: Object.fromEntries(
          primaryMuscles.map((muscle) => [muscle, 2]),
        ),
        percentageOfWeeklyProjectedStimulusByMuscle: Object.fromEntries(
          primaryMuscles.map((muscle) => [muscle, 65]),
        ),
        producedOrIncreasedByRepair: false,
        flags: overrides.concentrationFlags ?? [
          "EXERCISE_SUPPLIES_OVER_60_PERCENT_WEEKLY_STIMULUS",
        ],
      },
    ],
  } as unknown as BuilderInput;
}

function onlyLane(
  diagnostic: V2ExerciseSelectionPlanDiagnostic,
): V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number] {
  const lane = diagnostic.weeks[0]?.slots[0]?.lanes[0];
  if (!lane) {
    throw new Error("expected one diagnostic lane");
  }
  return lane;
}

describe("buildV2ExerciseSelectionPlanDiagnostic", () => {
  it("downgrades raw over-60 concentration when the cleaned lane diff is diagnostic-only quality warning", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(makeInput());
    const lane = onlyLane(diagnostic);

    expect(lane.concentrationStatus).toBe("quality_warning");
    expect(lane.fatigueStatus).toBe("quality_warning");
    expect(diagnostic.summary.blockedLaneCount).toBe(0);
    expect(diagnostic.status).toBe("projected_with_limitations");
  });

  it("keeps true cleaned hard blockers blocked for concentration and fatigue readout", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        currentStatus: "blocked",
        severity: "hard_blocker",
        migrationRecommendation: "needs_set_budget_justification",
        gapCause: "capacity_gap",
        relevantDiagnostics: [
          "setPolicy:hard_blocker",
          "setPolicyReason:gt_5_sets",
          "risk:systemic_fatigue",
        ],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.concentrationStatus).toBe("blocked");
    expect(lane.fatigueStatus).toBe("blocked");
    expect(lane.setBudgetStatus).toBe("blocked");
    expect(diagnostic.summary.blockedLaneCount).toBe(1);
    expect(diagnostic.status).toBe("blocked");
  });

  it("does not hard-block ignored or diagnostic-only collateral rows", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        currentStatus: "blocked",
        severity: "diagnostic_only",
        migrationRecommendation: "keep_diagnostic_only",
        relevantDiagnostics: [
          "setPolicy:quality_warning",
          "concentration:dirty_collateral",
          "concentration:quality_warning",
          "ignoredRows:collateral",
        ],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.concentrationStatus).toBe("quality_warning");
    expect(lane.fatigueStatus).toBe("quality_warning");
    expect(diagnostic.summary.blockedLaneCount).toBe(0);
    expect(diagnostic.blockers).toEqual([]);
  });

  it("matches squat_or_quad_support to the lower quad-support planned class set diagnostically", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        slotId: "lower_b",
        laneId: "quad_support",
        exerciseName: "Goblet Squat",
        primaryMuscles: ["Quads"],
        movementPatterns: ["squat"],
        plannedClasses: ["squat", "leg_press", "lunge", "quad_isolation"],
        selectedClass: "squat_or_quad_support",
        concentrationFlags: [],
        relevantDiagnostics: ["setPolicy:in_budget", "setBudget:within_preferred"],
        gapCause: "none",
        migrationRecommendation: "no_action",
        severity: "pass",
        currentStatus: "satisfied",
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.laneClassStatus).toBe("match");
    expect(lane.identityStatus).toBe("preserved");
    expect(diagnostic.summary.classMismatchCount).toBe(0);
  });
});
