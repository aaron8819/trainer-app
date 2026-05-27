import { describe, expect, it } from "vitest";
import { buildV2PlannerMesocyclePolicy } from "@/lib/engine/planning/v2";
import { exerciseMatchesSlotLane } from "@/lib/engine/selection-v2/slot-lane-plan";
import {
  buildV2ExerciseSelectionPlanDiagnostic,
  type V2ExerciseSelectionPlanDiagnostic,
} from "./exercise-selection-plan-diagnostic";
import {
  buildV2SelectionCapacityPlanDiagnostic,
  type V2SelectionCapacityPlanDiagnostic,
} from "./selection-capacity-plan-diagnostic";

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

  it("matches chest_isolation to chest secondary fly lanes diagnostically", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        laneId: "chest_secondary",
        exerciseName: "Cable Crossover",
        primaryMuscles: ["Chest"],
        movementPatterns: ["horizontal_push"],
        plannedClasses: ["fly", "machine_press", "cable_press"],
        selectedClass: "chest_isolation",
        concentrationFlags: [],
        currentStatus: "satisfied",
        gapCause: "none",
        severity: "pass",
        migrationRecommendation: "no_action",
        relevantDiagnostics: ["setPolicy:in_budget"],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.laneClassStatus).toBe("match");
    expect(lane.identityStatus).toBe("preserved");
    expect(diagnostic.summary.classMismatchCount).toBe(0);
  });

  it("matches clean chest fly to distinct second-exposure intent when the target diff is satisfied", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        slotId: "upper_b",
        laneId: "chest_second_exposure",
        exerciseName: "Cable Fly",
        primaryMuscles: ["Chest"],
        movementPatterns: ["isolation"],
        plannedClasses: ["distinct_chest_press_or_fly"],
        selectedClass: "chest_isolation",
        concentrationFlags: [],
        currentStatus: "satisfied",
        gapCause: "none",
        severity: "pass",
        migrationRecommendation: "no_action",
        relevantDiagnostics: [
          "setPolicy:in_budget",
          "setBudget:within_preferred",
          "concentration:chest_primary",
          "concentration:second_exposure",
          "concentration:class_distinct",
          "concentration:exercise_distinct",
          "readout_note:clean_chest_second_exposure",
        ],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.selectedIdentity).toMatchObject({
      exerciseName: "Cable Fly",
      setCount: 2,
    });
    expect(lane.laneClassStatus).toBe("match");
    expect(lane.identityStatus).toBe("preserved");
    expect(diagnostic.summary.classMismatchCount).toBe(0);
  });

  it("keeps true chest second-exposure class mismatch counted", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        slotId: "upper_b",
        laneId: "chest_second_exposure",
        exerciseName: "Machine Chest Press",
        primaryMuscles: ["Chest"],
        movementPatterns: ["horizontal_push"],
        plannedClasses: ["distinct_chest_press_or_fly"],
        selectedClass: "chest_press",
        concentrationFlags: [],
        currentStatus: "satisfied",
        gapCause: "none",
        severity: "pass",
        migrationRecommendation: "no_action",
        relevantDiagnostics: [
          "setPolicy:in_budget",
          "setBudget:within_preferred",
        ],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.laneClassStatus).toBe("mismatch");
    expect(lane.identityStatus).toBe("class_mismatch");
    expect(diagnostic.summary.classMismatchCount).toBe(1);
  });

  it("keeps duplicate chest press warnings when duplicate identity evidence exists", () => {
    const input = makeInput({
      slotId: "upper_b",
      laneId: "chest_second_exposure",
      exerciseName: "Deficit Push-Up",
      primaryMuscles: ["Chest"],
      movementPatterns: ["horizontal_push"],
      plannedClasses: ["distinct_chest_press_or_fly"],
      selectedClass: "chest_press",
      concentrationFlags: [],
      currentStatus: "partial",
      gapCause: "duplicate_policy_gap",
      severity: "quality_warning",
      migrationRecommendation: "keep_diagnostic_only",
      relevantDiagnostics: [
        "setPolicy:quality_warning",
        "concentration:duplicate_exposure",
      ],
    });
    input.duplicateContinuityJustification = {
      version: 1,
      source: "diagnostic_shadow_planner",
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        totalDuplicates: 1,
        justifiedDuplicates: 0,
        unjustifiedOrUnknown: 1,
        cleanAlternativeAvailable: 1,
        highRiskDuplicates: 1,
      },
      duplicates: [
        {
          exerciseId: "exercise-1",
          exerciseName: "Deficit Push-Up",
          duplicateType: "same_exercise_cross_slot",
          duplicatedInSlots: ["upper_a", "upper_b"],
          roleBySlot: { upper_a: "main", upper_b: "accessory" },
          setCountBySlot: { upper_a: 3, upper_b: 2 },
          primaryMuscles: ["Chest"],
          movementPatterns: ["horizontal_push"],
          exerciseClass: "chest_press",
          compatibleAlternativeExists: true,
          compatibleAlternatives: [],
          justification: "unjustified",
          policyRecommendation: "requires_planner_decision",
          risk: "high",
          evidence: ["duplicate:Deficit Push-Up:unjustified"],
          limitations: [],
        },
      ],
    };

    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(input);
    const lane = onlyLane(diagnostic);

    expect(lane.duplicateStatus).toBe("blocked");
    expect(lane.identityStatus).toBe("duplicate_requires_justification");
    expect(diagnostic.summary.duplicateRequiresJustificationCount).toBe(1);
  });

  it("matches knee_flexion_curl to hamstring_curl lanes diagnostically", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        slotId: "lower_b",
        laneId: "knee_flexion_curl",
        exerciseName: "Seated Leg Curl",
        primaryMuscles: ["Hamstrings"],
        movementPatterns: ["flexion"],
        plannedClasses: ["hamstring_curl"],
        selectedClass: "knee_flexion_curl",
        concentrationFlags: [],
        currentStatus: "satisfied",
        gapCause: "none",
        severity: "pass",
        migrationRecommendation: "no_action",
        relevantDiagnostics: ["setPolicy:in_budget"],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.laneClassStatus).toBe("match");
    expect(lane.identityStatus).toBe("preserved");
    expect(diagnostic.summary.classMismatchCount).toBe(0);
  });

  it("matches generic hinge to low-dose support hinge lanes only", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        slotId: "lower_a",
        laneId: "secondary_hinge",
        exerciseName: "Cable Pull-Through",
        primaryMuscles: ["Hamstrings", "Glutes"],
        movementPatterns: ["hinge"],
        plannedClasses: ["low_dose_hinge"],
        selectedClass: "hinge",
        concentrationFlags: [],
        currentStatus: "satisfied",
        gapCause: "none",
        severity: "pass",
        migrationRecommendation: "no_action",
        relevantDiagnostics: ["setPolicy:in_budget"],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.laneClassStatus).toBe("match");
    expect(lane.identityStatus).toBe("preserved");
    expect(diagnostic.summary.classMismatchCount).toBe(0);
  });

  it("keeps generic hinge mismatched against hinge_compound", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        slotId: "lower_b",
        laneId: "hinge_anchor",
        exerciseName: "Glute Bridge",
        primaryMuscles: ["Hamstrings", "Glutes"],
        movementPatterns: ["hinge"],
        plannedClasses: ["hinge_compound"],
        selectedClass: "hinge",
        concentrationFlags: [],
        currentStatus: "satisfied",
        gapCause: "none",
        severity: "pass",
        migrationRecommendation: "no_action",
        relevantDiagnostics: ["setPolicy:in_budget"],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.laneClassStatus).toBe("mismatch");
    expect(lane.identityStatus).toBe("class_mismatch");
    expect(diagnostic.summary.classMismatchCount).toBe(1);
  });

  it("keeps Glute Bridge mismatched when the lane is strict hinge_compound-only", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        slotId: "lower_b",
        laneId: "hinge_anchor",
        exerciseName: "Glute Bridge",
        primaryMuscles: ["Hamstrings", "Glutes"],
        movementPatterns: ["hinge"],
        plannedClasses: ["hinge_compound"],
        selectedClass: "low_axial_hip_extension_anchor",
        concentrationFlags: [],
        currentStatus: "satisfied",
        gapCause: "none",
        severity: "pass",
        migrationRecommendation: "no_action",
        relevantDiagnostics: ["setPolicy:in_budget"],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.laneClassStatus).toBe("mismatch");
    expect(lane.identityStatus).toBe("class_mismatch");
    expect(diagnostic.summary.classMismatchCount).toBe(1);
  });

  it("accepts Glute Bridge as a low-axial hip-extension anchor only when policy allows that class", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        slotId: "lower_b",
        laneId: "hinge_anchor",
        exerciseName: "Glute Bridge",
        primaryMuscles: ["Hamstrings", "Glutes"],
        movementPatterns: ["hinge"],
        plannedClasses: [
          "hinge_compound",
          "low_axial_hip_extension_anchor",
        ],
        selectedClass: "low_axial_hip_extension_anchor",
        concentrationFlags: [],
        currentStatus: "satisfied",
        gapCause: "none",
        severity: "pass",
        migrationRecommendation: "no_action",
        relevantDiagnostics: ["setPolicy:in_budget"],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.plannedClass).toEqual([
      "hinge_compound",
      "low_axial_hip_extension_anchor",
    ]);
    expect(lane.laneClassStatus).toBe("match");
    expect(lane.identityStatus).toBe("preserved");
    expect(diagnostic.summary.classMismatchCount).toBe(0);
  });

  it("accepts glute_bridge_anchor as a diagnostic alias for the low-axial hip-extension anchor", () => {
    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(
      makeInput({
        slotId: "lower_b",
        laneId: "hinge_anchor",
        exerciseName: "Hip Thrust",
        primaryMuscles: ["Glutes", "Hamstrings"],
        movementPatterns: ["hinge"],
        plannedClasses: ["low_axial_hip_extension_anchor"],
        selectedClass: "glute_bridge_anchor",
        concentrationFlags: [],
        currentStatus: "satisfied",
        gapCause: "none",
        severity: "pass",
        migrationRecommendation: "no_action",
        relevantDiagnostics: ["setPolicy:in_budget"],
      }),
    );
    const lane = onlyLane(diagnostic);

    expect(lane.laneClassStatus).toBe("match");
    expect(lane.identityStatus).toBe("preserved");
    expect(diagnostic.summary.classMismatchCount).toBe(0);
  });

  it("binds row_support to row exercise evidence before vertical-pull evidence", () => {
    const input = makeInput({
      slotId: "upper_b",
      laneId: "row_support",
      exerciseName: "Close-Grip Lat Pulldown",
      primaryMuscles: ["Upper Back", "Lats"],
      movementPatterns: ["vertical_pull"],
      plannedClasses: ["horizontal_pull_support"],
      selectedClass: "vertical_pull",
      concentrationFlags: [],
      currentStatus: "satisfied",
      gapCause: "none",
      severity: "pass",
      migrationRecommendation: "no_action",
      relevantDiagnostics: ["setPolicy:in_budget"],
    });
    const slot = input.week1SelectedIdentities[0];
    if (!slot) {
      throw new Error("expected test slot");
    }
    slot.exercises.push({
      exerciseId: "exercise-2",
      exerciseName: "Close-Grip Seated Cable Row",
      role: "accessory",
      setCount: 2,
      primaryMuscles: ["Upper Back", "Lats"],
      movementPatterns: ["horizontal_pull"],
      effectiveStimulusByMuscle: {
        "Upper Back": 2,
        Lats: 1,
      },
    });
    input.v2TargetVsNoRepairDiff.slotDiffs[0]?.laneDiffs[0]?.currentEvidence.selectedExercises.push({
      name: "Close-Grip Seated Cable Row",
      sets: 2,
      role: "accessory",
    });

    const diagnostic = buildV2ExerciseSelectionPlanDiagnostic(input);
    const lane = onlyLane(diagnostic);

    expect(lane.selectedIdentity?.exerciseName).toBe("Close-Grip Seated Cable Row");
    expect(lane.laneClassStatus).toBe("match");
    expect(lane.identityStatus).toBe("preserved");
    expect(diagnostic.summary.classMismatchCount).toBe(0);
  });

  it("keeps diagnostic aliases out of production slot-lane matching", () => {
    expect(
      exerciseMatchesSlotLane(
        {
          id: "glute-bridge",
          name: "Glute Bridge",
          movementPatterns: ["hinge"],
          primaryMuscles: ["Glutes", "Hamstrings"],
          equipment: ["bodyweight"],
        },
        {
          slotId: "lower_b",
          laneId: "hinge_anchor",
          preferredClasses: ["sldl"],
          minSets: 3,
          preferredSets: 3,
          source: "hypertrophy_upper_lower_slot_lane_plan",
        },
      ),
    ).toBe(false);
  });
});

type CapacityBuilderInput = Parameters<
  typeof buildV2SelectionCapacityPlanDiagnostic
>[0];

function makeSelectionCapacityLane(input: {
  laneId: string;
  primaryMuscles: string[];
  selectedExercise?: string;
  selectedSets?: number;
  setBudgetStatus?: "within_budget" | "allowed_expansion" | "requires_justification" | "blocked";
  capacityStatus?: "within_capacity" | "at_capacity" | "blocked" | "not_evaluated";
  cleanAlternatives?: Array<{ exerciseName: string; exerciseClass: string }>;
  concentrationStatus?: "pass" | "quality_warning" | "blocked";
}): V2ExerciseSelectionPlanDiagnostic["weeks"][number]["slots"][number]["lanes"][number] {
  return {
    laneId: input.laneId,
    plannedClass: [],
    primaryMuscles: input.primaryMuscles,
    ...(input.selectedExercise
      ? {
          selectedIdentity: {
            exerciseId: `${input.laneId}-exercise`,
            exerciseName: input.selectedExercise,
            sourceWeek: 1 as const,
            setCount: input.selectedSets ?? 0,
          },
        }
      : {}),
    identityStatus: input.selectedExercise ? "preserved" : "not_evaluated",
    laneClassStatus: input.selectedExercise ? "match" : "not_evaluated",
    setBudgetStatus: input.setBudgetStatus ?? "within_budget",
    duplicateStatus: "pass",
    concentrationStatus: input.concentrationStatus ?? "pass",
    fatigueStatus:
      input.concentrationStatus === "quality_warning" ? "quality_warning" : "pass",
    inventoryStatus: input.cleanAlternatives ? "available" : "not_evaluated",
    capacityStatus: input.capacityStatus ?? "within_capacity",
    cleanAlternatives: (input.cleanAlternatives ?? []).map((alternative) => ({
      exerciseId: null,
      exerciseName: alternative.exerciseName,
      exerciseClass: alternative.exerciseClass,
      evidence: [`inventory:${alternative.exerciseName}:clean_available`],
    })),
    unresolvedDemand: [],
    evidenceRefs: ["setPolicy:in_budget"],
    limitations: ["week_1_selected_identity_basis"],
  };
}

function makeCapacityDiagnosticInput(): CapacityBuilderInput {
  const policy = buildV2PlannerMesocyclePolicy();
  const v2SetDistributionIntent = policy.v2SetDistributionIntent;
  const upperASelection = [
    makeSelectionCapacityLane({
      laneId: "row_anchor",
      primaryMuscles: ["Upper Back", "Lats"],
      selectedExercise: "Chest-Supported Row",
      selectedSets: 4,
      capacityStatus: "at_capacity",
      concentrationStatus: "quality_warning",
    }),
    makeSelectionCapacityLane({
      laneId: "chest_anchor",
      primaryMuscles: ["Chest"],
      selectedExercise: "Machine Chest Press",
      selectedSets: 1,
      capacityStatus: "at_capacity",
    }),
  ];
  const lowerASelection = [
    makeSelectionCapacityLane({
      laneId: "calves",
      primaryMuscles: ["Calves"],
      selectedExercise: "Standing Calf Raise",
      selectedSets: 4,
      capacityStatus: "within_capacity",
    }),
  ];
  const upperBSelection = [
    makeSelectionCapacityLane({
      laneId: "vertical_pull_anchor",
      primaryMuscles: ["Lats"],
      selectedExercise: "Lat Pulldown",
      selectedSets: 4,
      capacityStatus: "at_capacity",
      concentrationStatus: "quality_warning",
    }),
    makeSelectionCapacityLane({
      laneId: "optional_triceps_if_under_target",
      primaryMuscles: ["Triceps"],
      capacityStatus: "at_capacity",
      cleanAlternatives: [],
    }),
  ];
  const lowerBSelection = [
    makeSelectionCapacityLane({
      laneId: "calves",
      primaryMuscles: ["Calves"],
      selectedExercise: "Seated Calf Raise",
      selectedSets: 4,
      capacityStatus: "within_capacity",
    }),
  ];

  return {
    v2SetDistributionIntent,
    v2ExerciseSelectionPlanDiagnostic: {
      version: 1,
      source: "v2_planner_policy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "projected_with_limitations",
      identityBasis: "week_1_selected_identities",
      projectionBasis:
        "planner_owned_accumulation_projection_plus_week_1_identity_continuity",
      summary: {
        weeksEvaluated: 1,
        lanesEvaluated: 6,
        preservedIdentityCount: 5,
        candidateAvailableCount: 0,
        missingCandidateCount: 0,
        classMismatchCount: 0,
        duplicateRequiresJustificationCount: 0,
        concentrationWarningCount: 2,
        blockedLaneCount: 0,
      },
      weeks: [
        {
          week: 1,
          slots: [
            { slotId: "upper_a", lanes: upperASelection },
            { slotId: "lower_a", lanes: lowerASelection },
            { slotId: "upper_b", lanes: upperBSelection },
            { slotId: "lower_b", lanes: lowerBSelection },
          ],
        },
      ],
      blockers: [],
      warnings: [],
      missingInputs: [],
      safeForBehaviorPromotion: false,
    },
    v2TargetVsNoRepairDiff: {
      slotDiffs: [
        {
          slotId: "upper_a",
          laneDiffs: [
            {
              laneId: "row_anchor",
              currentStatus: "partial",
              currentEvidence: {
                selectedExercises: [
                  {
                    name: "Chest-Supported Row",
                    sets: 4,
                    matchedClass: "row",
                    role: "main",
                  },
                ],
                relevantDiagnostics: [
                  "setPolicy:quality_warning",
                  "setBudget:within_preferred",
                  "selectionFeasibility:session_capacity_pressure",
                  "capacityPressure:upper_pull_distribution",
                  "concentration:quality_warning",
                ],
              },
              gapCause: "selection_feasibility_pressure",
              migrationRecommendation: "keep_diagnostic_only",
              severity: "quality_warning",
            },
            {
              laneId: "chest_anchor",
              currentStatus: "partial",
              currentEvidence: {
                selectedExercises: [
                  {
                    name: "Machine Chest Press",
                    sets: 1,
                    matchedClass: "chest_press",
                    role: "main",
                  },
                ],
                relevantDiagnostics: ["target_delivery:below_min"],
              },
              gapCause: "set_distribution_gap",
              migrationRecommendation: "needs_set_distribution_policy",
              severity: "quality_warning",
            },
          ],
        },
        {
          slotId: "upper_b",
          laneDiffs: [
            {
              laneId: "vertical_pull_anchor",
              currentStatus: "partial",
              currentEvidence: {
                selectedExercises: [
                  {
                    name: "Lat Pulldown",
                    sets: 4,
                    matchedClass: "vertical_pull",
                    role: "main",
                  },
                ],
                relevantDiagnostics: [
                  "setPolicy:quality_warning",
                  "setBudget:within_preferred",
                  "selectionFeasibility:session_capacity_pressure",
                  "capacityPressure:upper_pull_distribution",
                ],
              },
              gapCause: "selection_feasibility_pressure",
              migrationRecommendation: "keep_diagnostic_only",
              severity: "quality_warning",
            },
            {
              laneId: "optional_triceps_if_under_target",
              currentStatus: "missing",
              currentEvidence: {
                selectedExercises: [],
                relevantDiagnostics: ["optional_lane:target_met_or_no_headroom"],
              },
              gapCause: "unknown",
              migrationRecommendation: "keep_diagnostic_only",
              severity: "diagnostic_only",
            },
          ],
        },
        {
          slotId: "lower_a",
          laneDiffs: [
            {
              laneId: "calves",
              currentStatus: "satisfied",
              currentEvidence: {
                selectedExercises: [
                  {
                    name: "Standing Calf Raise",
                    sets: 4,
                    matchedClass: "calf_raise",
                    role: "accessory",
                  },
                ],
                relevantDiagnostics: ["setPolicy:in_budget"],
              },
              gapCause: "none",
              migrationRecommendation: "no_action",
              severity: "pass",
            },
          ],
        },
        {
          slotId: "lower_b",
          laneDiffs: [
            {
              laneId: "calves",
              currentStatus: "satisfied",
              currentEvidence: {
                selectedExercises: [
                  {
                    name: "Seated Calf Raise",
                    sets: 4,
                    matchedClass: "calf_raise",
                    role: "accessory",
                  },
                ],
                relevantDiagnostics: ["setPolicy:in_budget"],
              },
              gapCause: "none",
              migrationRecommendation: "no_action",
              severity: "pass",
            },
          ],
        },
      ],
    },
    week1SelectedIdentities: [
      {
        slotId: "upper_a",
        slotIndex: 0,
        intent: "upper",
        exerciseCount: 6,
        totalSets: 20,
        projectedEffectiveStimulusByMuscle: {
          Chest: 1,
          Lats: 8,
          "Upper Back": 7,
        },
        exercises: [
          {
            exerciseId: "row",
            exerciseName: "Chest-Supported Row",
            role: "main",
            setCount: 4,
            primaryMuscles: ["Upper Back", "Lats"],
            movementPatterns: ["horizontal_pull"],
            effectiveStimulusByMuscle: { "Upper Back": 4, Lats: 3 },
          },
        ],
      },
      {
        slotId: "lower_a",
        slotIndex: 1,
        intent: "lower",
        exerciseCount: 5,
        totalSets: 16,
        projectedEffectiveStimulusByMuscle: { Calves: 4 },
        exercises: [
          {
            exerciseId: "standing-calf",
            exerciseName: "Standing Calf Raise",
            role: "accessory",
            setCount: 4,
            primaryMuscles: ["Calves"],
            movementPatterns: ["isolation"],
            effectiveStimulusByMuscle: { Calves: 4 },
          },
        ],
      },
      {
        slotId: "upper_b",
        slotIndex: 2,
        intent: "upper",
        exerciseCount: 6,
        totalSets: 21,
        projectedEffectiveStimulusByMuscle: { Lats: 8, Triceps: 6 },
        exercises: [
          {
            exerciseId: "pulldown",
            exerciseName: "Lat Pulldown",
            role: "main",
            setCount: 4,
            primaryMuscles: ["Lats"],
            movementPatterns: ["vertical_pull"],
            effectiveStimulusByMuscle: { Lats: 4 },
          },
        ],
      },
      {
        slotId: "lower_b",
        slotIndex: 3,
        intent: "lower",
        exerciseCount: 4,
        totalSets: 14,
        projectedEffectiveStimulusByMuscle: { Calves: 4 },
        exercises: [
          {
            exerciseId: "seated-calf",
            exerciseName: "Seated Calf Raise",
            role: "accessory",
            setCount: 4,
            primaryMuscles: ["Calves"],
            movementPatterns: ["isolation"],
            effectiveStimulusByMuscle: { Calves: 4 },
          },
        ],
      },
    ],
    weeklyMuscleTotals: [
      {
        muscle: "Lats",
        projectedEffectiveSets: 16,
        targetMin: 8,
        targetPreferred: 16,
        status: "within",
      },
      {
        muscle: "Upper Back",
        projectedEffectiveSets: 7,
        targetMin: 6,
        targetPreferred: 14,
        status: "within",
      },
      {
        muscle: "Calves",
        projectedEffectiveSets: 8,
        targetMin: 8,
        targetPreferred: 8,
        status: "within",
      },
      {
        muscle: "Triceps",
        projectedEffectiveSets: 6,
        targetMin: 4,
        targetPreferred: 8,
        status: "within",
      },
      {
        muscle: "Chest",
        projectedEffectiveSets: 1,
        targetMin: 8,
        targetPreferred: 12,
        status: "below",
      },
    ],
  } as unknown as CapacityBuilderInput;
}

function capacityLane(
  diagnostic: V2SelectionCapacityPlanDiagnostic,
  week: number,
  slotId: string,
  laneId: string,
) {
  const lane = diagnostic.weeks
    .find((row) => row.week === week)
    ?.slots.find((slot) => slot.slotId === slotId)
    ?.lanes.find((row) => row.laneId === laneId);
  if (!lane) {
    throw new Error(`missing ${week}:${slotId}:${laneId}`);
  }
  return lane;
}

describe("buildV2SelectionCapacityPlanDiagnostic", () => {
  it("is read-only and never affects scoring or behavior promotion", () => {
    const diagnostic = buildV2SelectionCapacityPlanDiagnostic(
      makeCapacityDiagnosticInput(),
    );

    expect(diagnostic.readOnly).toBe(true);
    expect(diagnostic.affectsScoringOrGeneration).toBe(false);
    expect(diagnostic.safeForBehaviorPromotion).toBe(false);
  });

  it("classifies upper pull target-met in-budget lanes as capacity pressure", () => {
    const diagnostic = buildV2SelectionCapacityPlanDiagnostic(
      makeCapacityDiagnosticInput(),
    );

    expect(capacityLane(diagnostic, 1, "upper_a", "row_anchor")).toMatchObject({
      classification: "capacity_pressure",
      weeklyTargetStatus: "within",
      slotHeadroom: 0,
      cleanAlternativeCount: null,
    });
    expect(capacityLane(diagnostic, 1, "upper_b", "vertical_pull_anchor")).toMatchObject({
      classification: "capacity_pressure",
      weeklyTargetStatus: "within",
      slotHeadroom: 0,
    });
    expect(diagnostic.summary.capacityPressureCount).toBeGreaterThanOrEqual(2);
  });

  it("does not classify satisfied Week 1 calf lanes as blockers", () => {
    const diagnostic = buildV2SelectionCapacityPlanDiagnostic(
      makeCapacityDiagnosticInput(),
    );

    expect(capacityLane(diagnostic, 1, "lower_a", "calves").classification).not.toBe(
      "blocker",
    );
    expect(capacityLane(diagnostic, 1, "lower_b", "calves").classification).not.toBe(
      "blocker",
    );
  });

  it("classifies Week 4 calves at capped productive target as target met no action", () => {
    const diagnostic = buildV2SelectionCapacityPlanDiagnostic(
      makeCapacityDiagnosticInput(),
    );

    expect(capacityLane(diagnostic, 4, "lower_a", "calves")).toMatchObject({
      classification: "target_met_no_action",
      selectedExercise: "Standing Calf Raise",
      selectedSets: 4,
      perExerciseCap: 4,
      weeklyTargetStatus: "within",
    });
    expect(capacityLane(diagnostic, 4, "lower_b", "calves")).toMatchObject({
      classification: "target_met_no_action",
      selectedExercise: "Seated Calf Raise",
      selectedSets: 4,
      perExerciseCap: 4,
      weeklyTargetStatus: "within",
    });
    expect(diagnostic.summary.capAwareExpansionNeededCount).toBe(0);
    expect(diagnostic.warnings).not.toEqual(
      expect.arrayContaining([
        "week_4:lower_a:calves:cap_aware_expansion_needed",
        "week_4:lower_b:calves:cap_aware_expansion_needed",
      ]),
    );
  });

  it("classifies below-floor calf direct work as a blocker", () => {
    const input = makeCapacityDiagnosticInput();
    const calvesTotal = input.weeklyMuscleTotals.find(
      (row) => row.muscle === "Calves",
    );
    if (!calvesTotal) {
      throw new Error("missing Calves weekly total");
    }
    calvesTotal.projectedEffectiveSets = 7;
    calvesTotal.status = "below";

    const lowerASelectionLane = input.v2ExerciseSelectionPlanDiagnostic.weeks[0]?.slots
      .find((slot) => slot.slotId === "lower_a")
      ?.lanes.find((lane) => lane.laneId === "calves");
    if (!lowerASelectionLane?.selectedIdentity) {
      throw new Error("missing lower_a calf selection lane");
    }
    lowerASelectionLane.selectedIdentity.setCount = 2;
    lowerASelectionLane.setBudgetStatus = "blocked";

    const lowerADiff = input.v2TargetVsNoRepairDiff.slotDiffs
      .find((slot) => slot.slotId === "lower_a")
      ?.laneDiffs.find((lane) => lane.laneId === "calves");
    const lowerASelected = lowerADiff?.currentEvidence.selectedExercises[0];
    if (!lowerADiff || !lowerASelected) {
      throw new Error("missing lower_a calf lane diff");
    }
    lowerASelected.sets = 2;
    lowerADiff.currentStatus = "partial";
    lowerADiff.currentEvidence.relevantDiagnostics = ["target_delivery:below_min"];
    lowerADiff.gapCause = "set_distribution_gap";
    lowerADiff.migrationRecommendation = "needs_set_distribution_policy";
    lowerADiff.severity = "quality_warning";

    const diagnostic = buildV2SelectionCapacityPlanDiagnostic(input);

    expect(capacityLane(diagnostic, 1, "lower_a", "calves")).toMatchObject({
      classification: "blocker",
      selectedExercise: "Standing Calf Raise",
      selectedSets: 2,
      weeklyTargetStatus: "below",
    });
    expect(diagnostic.blockers).toEqual(
      expect.arrayContaining(["week_1:lower_a:calves:blocker"]),
    );
  });

  it("classifies optional lanes with target met or no headroom as optional suppressed", () => {
    const diagnostic = buildV2SelectionCapacityPlanDiagnostic(
      makeCapacityDiagnosticInput(),
    );

    expect(
      capacityLane(diagnostic, 1, "upper_b", "optional_triceps_if_under_target"),
    ).toMatchObject({
      classification: "optional_suppressed",
      optionalEligibility: "suppressed",
    });
  });

  it("classifies true below-min plus target-unmet lanes as blockers", () => {
    const diagnostic = buildV2SelectionCapacityPlanDiagnostic(
      makeCapacityDiagnosticInput(),
    );

    expect(capacityLane(diagnostic, 1, "upper_a", "chest_anchor")).toMatchObject({
      classification: "blocker",
      selectedSets: 1,
      weeklyTargetStatus: "below",
    });
    expect(diagnostic.summary.blockerCount).toBeGreaterThanOrEqual(1);
  });
});
