import { describe, expect, it } from "vitest";
import {
  DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
  buildV2ExerciseMaterializationPlan,
  buildV2PlannerMesocyclePolicy,
} from "./index";
import {
  buildV2LaneSelectionIntentAudit,
  type V2LaneSelectionIntentAudit,
} from "./lane-selection-intent-audit";
import { buildV2LaneSelectionIntentBenchmark } from "./lane-selection-intent-benchmark";
import type { V2ExerciseSelectionPlan } from "./types";

function buildAudit(): V2LaneSelectionIntentAudit {
  const policy = buildV2PlannerMesocyclePolicy();
  return buildV2LaneSelectionIntentAudit({
    exerciseSelectionPlan: policy.exerciseSelectionPlan,
    targetSkeleton: policy.targetSkeleton,
  });
}

function auditLane(
  audit: V2LaneSelectionIntentAudit,
  slotId: string,
  laneId: string,
) {
  const found = audit.lanes.find(
    (lane) => lane.slotId === slotId && lane.laneId === laneId,
  );
  if (!found) {
    throw new Error(`Missing audited lane ${slotId}:${laneId}`);
  }
  return found;
}

function expectMissing(
  lane: V2LaneSelectionIntentAudit["lanes"][number],
  field: string,
  risk: V2LaneSelectionIntentAudit["lanes"][number]["missingIntent"][number]["risk"],
) {
  expect(lane.missingIntent).toEqual(
    expect.arrayContaining([expect.objectContaining({ field, risk })]),
  );
}

describe("buildV2LaneSelectionIntentAudit", () => {
  it("is read-only and explicitly cannot affect scoring or generation", () => {
    const audit = buildAudit();

    expect(audit).toMatchObject({
      version: 1,
      source: "v2_lane_selection_intent_audit",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
    });
    expect(audit.summary.totalLanes).toBe(audit.lanes.length);
    expect(audit.summary.lanesWithCorrectnessRisk).toBeGreaterThan(0);
  });

  it("emits laneSelectionIntent v0 for high-risk lanes and Stage C consumption flags for the promoted slice", () => {
    const audit = buildAudit();

    for (const [slotId, laneId] of [
      ["upper_b", "vertical_press"],
      ["upper_b", "vertical_pull_anchor"],
      ["lower_a", "hamstring_curl"],
      ["lower_a", "quad_isolation"],
      ["lower_a", "calves"],
      ["upper_b", "side_delt_isolation"],
      ["upper_a", "rear_delt"],
      ["upper_a", "triceps"],
      ["upper_b", "biceps"],
      ["upper_b", "chest_second_exposure"],
      ["upper_b", "row_support"],
    ] as const) {
      const lane = auditLane(audit, slotId, laneId);
      const stageCConsumed =
        (slotId === "upper_b" && laneId === "vertical_press") ||
        (slotId === "upper_b" && laneId === "vertical_pull_anchor") ||
        (slotId === "lower_a" && laneId === "hamstring_curl") ||
        (slotId === "lower_a" && laneId === "quad_isolation") ||
        (slotId === "lower_a" && laneId === "calves") ||
        (slotId === "upper_b" && laneId === "side_delt_isolation") ||
        (slotId === "upper_a" && laneId === "rear_delt") ||
        (slotId === "upper_a" && laneId === "triceps") ||
        (slotId === "upper_b" && laneId === "row_support");

      expect(lane.proposedLaneSelectionIntent).toMatchObject({
        version: 0,
        contract: "laneSelectionIntent",
        source: "v2_planner_policy",
        consumedByMaterializer: stageCConsumed,
      });
      expect(lane.missingRequiredV0Fields).toEqual([]);
      expect(lane.consumedByMaterializer).toBe(stageCConsumed);
      expect(lane.materializerInferenceRequired).toBe(!stageCConsumed);
    }
  });

  it("reports v0 risk fields and missing required fields when intent is absent", () => {
    const policy = buildV2PlannerMesocyclePolicy();
    const planWithoutRowSupportIntent = JSON.parse(
      JSON.stringify(policy.exerciseSelectionPlan),
    ) as V2ExerciseSelectionPlan;
    let deletedCount = 0;
    for (const week of planWithoutRowSupportIntent.weeks) {
      const rowSupport = week.slots
        .find((slot) => slot.slotId === "upper_b")
        ?.lanes.find((lane) => lane.laneId === "row_support");
      if (rowSupport) {
        delete rowSupport.laneSelectionIntent;
        deletedCount += 1;
      }
    }
    expect(deletedCount).toBeGreaterThan(0);

    const audit = buildV2LaneSelectionIntentAudit({
      exerciseSelectionPlan: planWithoutRowSupportIntent,
      targetSkeleton: policy.targetSkeleton,
    });
    const lane = auditLane(audit, "upper_b", "row_support");

    expect(lane.missingRequiredV0Fields).toEqual(
      expect.arrayContaining([
        "laneJob",
        "requiredMovementPattern",
        "allowedExerciseClasses",
        "directnessRequirement",
        "capacityPriority",
        "fallbackPolicy",
        "identityPreservationMode",
      ]),
    );
    expect(lane.risks).toMatchObject({
      quality: "under_specified_current_plan",
      extensibility: "under_specified_current_plan",
    });
  });

  it("flags vertical pull lanes when strict movement and substitution policy are implicit", () => {
    const audit = buildAudit();

    for (const [slotId, laneId] of [
      ["upper_a", "vertical_pull_support"],
      ["upper_b", "vertical_pull_anchor"],
    ] as const) {
      const lane = auditLane(audit, slotId, laneId);

      expect(lane.notes).toEqual(
        expect.arrayContaining([
          "high_risk_lane_family:vertical_pull",
          "class_intent_available:vertical_pull",
        ]),
      );
      expect(lane.availableIntent).toMatchObject({
        classRequirementsPreferences: {
          acceptableExerciseClasses: ["vertical_pull"],
        },
      });
      if (laneId === "vertical_pull_anchor") {
        expect(lane.availableIntent).toMatchObject({
          laneSelectionIntent: {
            laneJob: "anchor_overload",
            requiredMovementPattern: "vertical_pull",
            disallowedExerciseClasses: [
              "row",
              "pullover",
              "straight_arm_pulldown",
            ],
          },
        });
      }
      expectMissing(lane, "requiredMovementPatterns", "correctness");
      expectMissing(lane, "substitutionStrictness", "correctness");
    }
  });

  it("flags quad isolation and support lanes when movement or substitution intent is incomplete", () => {
    const audit = buildAudit();
    const isolation = auditLane(audit, "lower_a", "quad_isolation");
    const support = auditLane(audit, "lower_b", "quad_support");

    expect(isolation.notes).toEqual(
      expect.arrayContaining([
        "high_risk_lane_family:squat_quad",
        "quad_isolation_class_separate_from_squat_pattern",
      ]),
    );
    expect(isolation.availableIntent).toMatchObject({
      laneSelectionIntent: {
        laneJob: "direct_floor",
        requiredMovementPattern: "knee_extension",
        disallowedExerciseClasses: ["squat_pattern", "lunge", "leg_press"],
      },
      classRequirementsPreferences: {
        acceptableExerciseClasses: ["leg_extension", "quad_isolation"],
      },
    });
    expectMissing(isolation, "requiredMovementPatterns", "correctness");
    expectMissing(isolation, "substitutionStrictness", "correctness");

    expect(support.notes).toContain("high_risk_lane_family:squat_quad");
    expect(support.availableIntent).toMatchObject({
      classRequirementsPreferences: {
        acceptableExerciseClasses: [
          "leg_press",
          "squat_pattern",
          "quad_isolation",
          "lunge",
        ],
      },
    });
    expectMissing(support, "movementPatternPreferences", "quality");
    expectMissing(support, "substitutionStrictness", "quality");
  });

  it("flags hinge anchor when managed collateral and axial fatigue policy are not materializer-consumable", () => {
    const audit = buildAudit();
    const hinge = auditLane(audit, "lower_b", "hinge_anchor");

    expect(hinge.notes).toEqual(
      expect.arrayContaining([
        "high_risk_lane_family:hinge_anchor",
        "managed_collateral_muscles_available",
      ]),
    );
    expect(hinge.availableIntent).toMatchObject({
      targetMuscles: {
        primary: ["Hamstrings"],
        managedCollateral: ["Glutes", "Lower Back"],
      },
    });
    expectMissing(hinge, "managedCollateralPolicy", "correctness");
    expectMissing(hinge, "axialFatiguePreference", "quality");
  });

  it("flags chest anchor and second exposure when stability or press-vs-fly priority is implicit", () => {
    const audit = buildAudit();
    const anchor = auditLane(audit, "upper_a", "chest_anchor");
    const secondExposure = auditLane(audit, "upper_b", "chest_second_exposure");

    expect(anchor.notes).toContain("high_risk_lane_family:chest");
    expectMissing(anchor, "stabilityPreference", "quality");

    expect(secondExposure.notes).toContain("high_risk_lane_family:chest");
    expect(secondExposure.availableIntent).toMatchObject({
      laneSelectionIntent: {
        laneJob: "support_coverage",
        requiredMovementPattern: "chest_press_or_fly",
        preferredMovementPatterns: ["chest_press"],
        allowedExerciseClasses: ["chest_press", "chest_fly"],
        consumedByMaterializer: false,
      },
      classRequirementsPreferences: {
        acceptableExerciseClasses: [
          "distinct_chest_press_or_fly",
          "fly",
          "machine_press",
          "cable_press",
        ],
      },
    });
    expectMissing(secondExposure, "pressVsFlyPriority", "quality");
  });

  it("captures chest, hamstring, and calf v0 requirements from the high-priority specs", () => {
    const audit = buildAudit();
    const chestSupport = auditLane(audit, "upper_b", "vertical_press");
    const hamstringCurl = auditLane(audit, "lower_a", "hamstring_curl");
    const calves = auditLane(audit, "lower_a", "calves");

    expect(chestSupport.proposedLaneSelectionIntent).toMatchObject({
      laneJob: "support_coverage",
      requiredMovementPattern: "chest_press",
      allowedExerciseClasses: ["chest_press", "chest_biased_press_support"],
      minimumTargetStimulus: {
        muscle: "Chest",
        minimumPerSetStimulus: 0.75,
      },
      consumedByMaterializer: true,
      duplicatePolicy: "prefer_variation_if_clean",
    });
    expect(hamstringCurl.proposedLaneSelectionIntent).toMatchObject({
      requiredMovementPattern: "knee_flexion",
      allowedExerciseClasses: ["hamstring_curl"],
      disallowedExerciseClasses: ["hinge", "back_extension", "hip_thrust"],
      fatiguePreference: "low_axial",
      consumedByMaterializer: true,
    });
    expect(calves.proposedLaneSelectionIntent).toMatchObject({
      requiredMovementPattern: "calf_raise",
      allowedExerciseClasses: ["calf_isolation"],
      consumedByMaterializer: true,
      duplicatePolicy: "prefer_variation_if_clean",
    });
  });

  it("flags skeleton-only upper_a:chest_secondary when it is absent from the materializer-facing plan", () => {
    const audit = buildAudit();
    const skeletonOnly = auditLane(audit, "upper_a", "chest_secondary");

    expect(skeletonOnly.role).toBe("support");
    expect(skeletonOnly.notes).toEqual(
      expect.arrayContaining([
        "skeleton_only_lane",
        "not_materializer_facing",
        "high_risk_lane_family:chest",
      ]),
    );
    expect(skeletonOnly.availableIntent).toMatchObject({
      materializerFacing: false,
      presentInTargetSkeleton: true,
      presentInExerciseSelectionPlan: false,
    });
    expectMissing(skeletonOnly, "materializerFacingLane", "correctness");
  });

  it("does not mutate the selection plan or materialized dry-run output", () => {
    const policy = buildV2PlannerMesocyclePolicy();
    const selectionPlanBefore = JSON.parse(
      JSON.stringify(policy.exerciseSelectionPlan),
    );
    const materializedBefore = buildV2ExerciseMaterializationPlan({
      exerciseSelectionPlan: policy.exerciseSelectionPlan,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: [],
      constraints: {
        avoidExerciseIds: [],
        favoriteExerciseIds: [],
        painConflictExerciseIds: [],
      },
    });

    buildV2LaneSelectionIntentAudit({
      exerciseSelectionPlan: policy.exerciseSelectionPlan,
      targetSkeleton: policy.targetSkeleton,
    });

    const materializedAfter = buildV2ExerciseMaterializationPlan({
      exerciseSelectionPlan: policy.exerciseSelectionPlan,
      taxonomy: DEFAULT_V2_EXERCISE_CLASS_TAXONOMY,
      inventory: [],
      constraints: {
        avoidExerciseIds: [],
        favoriteExerciseIds: [],
        painConflictExerciseIds: [],
      },
    });

    expect(policy.exerciseSelectionPlan).toEqual(selectionPlanBefore);
    expect(materializedAfter).toEqual(materializedBefore);
  });
});

describe("buildV2LaneSelectionIntentBenchmark", () => {
  it("benchmarks high-risk lane jobs without changing scoring, generation, or materialization", () => {
    const benchmark = buildV2LaneSelectionIntentBenchmark(buildAudit());

    expect(benchmark).toMatchObject({
      version: 1,
      source: "v2_lane_selection_intent_benchmark",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByDemandOrMaterializer: false,
      status: "warning",
      summary: {
        laneJobCount: 7,
        passCount: 6,
        warningCount: 1,
        failCount: 0,
        missingEvidenceCount: 0,
        materializerConsumedCount: 6,
        diagnosticOnlyCount: 1,
      },
    });
    expect(benchmark.lanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          laneJob: "calf_direct",
          status: "pass",
          materializerConsumed: true,
          evidence: expect.arrayContaining([
            "movement=calf_raise",
            "classes=calf_isolation",
          ]),
        }),
        expect.objectContaining({
          laneJob: "hamstring_curl",
          status: "pass",
          materializerConsumed: true,
          evidence: expect.arrayContaining([
            "movement=knee_flexion",
            "classes=hamstring_curl",
          ]),
        }),
        expect.objectContaining({
          laneJob: "chest_biased_press_support",
          status: "pass",
          materializerConsumed: true,
          evidence: expect.arrayContaining([
            "movement=chest_press",
            "classes=chest_press,chest_biased_press_support",
          ]),
        }),
        expect.objectContaining({
          laneJob: "vertical_pull_anchor",
          status: "pass",
          materializerConsumed: true,
          evidence: expect.arrayContaining([
            "movement=vertical_pull",
            "classes=vertical_pull",
          ]),
        }),
        expect.objectContaining({
          laneJob: "low_axial_hip_extension",
          status: "warning",
          required: false,
          materializerConsumed: false,
          evidence: expect.arrayContaining([
            "coverageGap:laneIntentContract:requiredMovementPattern=low_axial_hip_extension is not expressible in laneSelectionIntent v0 yet",
            "coverageGap:laneIntentContract:stimulusExpectation=meaningful Glutes stimulus minimumTargetStimulus:Glutes:0.75; Hamstrings are support/collateral only and must not be delivered by adding Glute Bridge sets alone",
            "coverageGap:laneIntentContract:substitutionFamily=low_axial_hip_extension_family only; true hinges, hamstring curls, back extensions, and generic glute accessories are not equivalent substitutions",
          ]),
          missingEvidence: [
            "laneJob:support_coverage",
            "allowedExerciseClasses:hip_thrust",
            "disallowedExerciseClasses:hinge,hamstring_curl,back_extension",
            "directnessRequirement:direct_or_high_support",
            "minimumTargetStimulus:Glutes:0.75",
            "fatiguePreference:low_axial",
            "loadabilityPreference:moderate_or_high",
            "duplicatePolicy:prefer_variation_if_clean",
            "fallbackPolicy:allow_labeled_fallback",
            "identityPreservationMode:variation_allowed_within_lane_job",
          ],
          coverageGaps: {
            laneIntentContract: [
              "lower_b:hinge_anchor has no proposed support_coverage laneSelectionIntent for low-axial Glutes support",
              "requiredRole=laneJob:support_coverage for optional lower_b posterior-chain support, not anchor_overload or direct_floor",
              "requiredMovementPattern=low_axial_hip_extension is not expressible in laneSelectionIntent v0 yet",
              "requiredExerciseClass=low_axial_hip_extension_anchor is not expressible in laneSelectionIntent v0 yet; current v0 can only proxy the family through allowedExerciseClasses=hip_thrust",
              "preferredPatterns=hip_thrust,glute_bridge,cable_pull_through,reverse_hyperextension when a clean variation exists",
              "allowedClasses=low_axial_hip_extension_anchor hip-thrust/bridge/pull-through/reverse-hyper family",
              "disallowedClasses=hinge_compound/hinge,knee_flexion_curl/hamstring_curl,back_extension,generic_glute_accessory",
              "stimulusExpectation=meaningful Glutes stimulus minimumTargetStimulus:Glutes:0.75; Hamstrings are support/collateral only and must not be delivered by adding Glute Bridge sets alone",
              "fatigueAndLoadability=low_axial fatiguePreference with moderate_or_high loadabilityPreference",
              "directness=direct_or_high_support hip-extension support, not generic same-muscle accessory work",
              "substitutionFamily=low_axial_hip_extension_family only; true hinges, hamstring curls, back extensions, and generic glute accessories are not equivalent substitutions",
              "duplicateFamily=low_axial_hip_extension_anchor family with prefer_variation_if_clean before same-family reuse",
              "failureMeaning=unresolved planner-owned lane-intent contract; keep diagnostic until a measured materializer projection proves value",
            ],
            ontologyInventory: [],
          },
          nextSafeAction: "keep_diagnostic_watch",
        }),
      ]),
    );
  });

  it("fails required lane jobs when expected movement, class, or failure policy is absent", () => {
    const audit = buildAudit();
    const hamstringCurl = audit.lanes.find(
      (lane) => lane.slotId === "lower_a" && lane.laneId === "hamstring_curl",
    );
    if (!hamstringCurl?.proposedLaneSelectionIntent) {
      throw new Error("Missing hamstring curl lane intent fixture");
    }
    hamstringCurl.proposedLaneSelectionIntent.allowedExerciseClasses = ["hinge"];

    const benchmark = buildV2LaneSelectionIntentBenchmark(audit);

    expect(benchmark.status).toBe("fail");
    expect(benchmark.lanes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          laneJob: "hamstring_curl",
          status: "fail",
          missingEvidence: expect.arrayContaining([
            "allowedExerciseClasses:hamstring_curl",
          ]),
          nextSafeAction: "fix_lane_selection_intent_mismatch",
        }),
      ]),
    );
  });
});
