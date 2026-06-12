import { describe, expect, it } from "vitest";
import { buildV2PlannerMesocyclePolicy } from "@/lib/engine/planning/v2";
import type { V2ExerciseSelectionPlanDiagnostic } from "@/lib/api/planning-reality";
import type { V2MaterializationExercise } from "@/lib/engine/planning/v2";
import { buildV2ConcentrationMaterializerProjectionFromLiveContext } from "./v2-materialization-live-context-dry-run";

function exercise(input: {
  id: string;
  name: string;
  patterns: string[];
  primaryMuscles: string[];
  stimulus: Record<string, number>;
  compound?: boolean;
  main?: boolean;
  fatigue?: number;
}): V2MaterializationExercise {
  return {
    exerciseId: input.id,
    name: input.name,
    aliases: [],
    movementPatterns: input.patterns,
    primaryMuscles: input.primaryMuscles,
    secondaryMuscles: [],
    equipment: ["machine"],
    isCompound: input.compound ?? false,
    isMainLiftEligible: input.main ?? input.compound ?? false,
    fatigueCost: input.fatigue ?? 1,
    stimulusByMusclePerSet: input.stimulus,
  };
}

const INVENTORY: V2MaterializationExercise[] = [
  exercise({
    id: "machine-chest-press",
    name: "Machine Chest Press",
    patterns: ["horizontal_press"],
    primaryMuscles: ["Chest"],
    stimulus: { Chest: 1 },
    compound: true,
    fatigue: 2,
  }),
  exercise({
    id: "machine-row",
    name: "Machine Row",
    patterns: ["row", "horizontal_pull"],
    primaryMuscles: ["Upper Back"],
    stimulus: { "Upper Back": 1, Lats: 0.5 },
    compound: true,
    fatigue: 2,
  }),
  exercise({
    id: "lat-pulldown",
    name: "Lat Pulldown",
    patterns: ["vertical_pull"],
    primaryMuscles: ["Lats"],
    stimulus: { Lats: 1 },
    compound: true,
    fatigue: 2,
  }),
  exercise({
    id: "reverse-pec-deck",
    name: "Reverse Pec Deck",
    patterns: ["rear_delt_fly"],
    primaryMuscles: ["Rear Delts"],
    stimulus: { "Rear Delts": 1 },
  }),
  exercise({
    id: "cable-lateral-raise",
    name: "Cable Lateral Raise",
    patterns: ["isolation"],
    primaryMuscles: ["Side Delts"],
    stimulus: { "Side Delts": 1 },
  }),
  exercise({
    id: "triceps-pushdown",
    name: "Triceps Pushdown",
    patterns: ["isolation"],
    primaryMuscles: ["Triceps"],
    stimulus: { Triceps: 1 },
  }),
  exercise({
    id: "hack-squat",
    name: "Hack Squat",
    patterns: ["squat"],
    primaryMuscles: ["Quads"],
    stimulus: { Quads: 1 },
    compound: true,
    fatigue: 3,
  }),
  exercise({
    id: "leg-extension",
    name: "Leg Extension",
    patterns: ["knee_extension", "isolation"],
    primaryMuscles: ["Quads"],
    stimulus: { Quads: 1 },
  }),
  exercise({
    id: "leg-curl",
    name: "Leg Curl",
    patterns: ["knee_flexion", "isolation"],
    primaryMuscles: ["Hamstrings"],
    stimulus: { Hamstrings: 1 },
  }),
  exercise({
    id: "calf-raise",
    name: "Standing Calf Raise",
    patterns: ["isolation"],
    primaryMuscles: ["Calves"],
    stimulus: { Calves: 1 },
  }),
  exercise({
    id: "machine-shoulder-press",
    name: "Machine Shoulder Press",
    patterns: ["vertical_press"],
    primaryMuscles: ["Front Delts"],
    stimulus: { "Front Delts": 1, Chest: 0.25 },
    compound: true,
    fatigue: 2,
  }),
  exercise({
    id: "biceps-curl",
    name: "Cable Biceps Curl",
    patterns: ["isolation"],
    primaryMuscles: ["Biceps"],
    stimulus: { Biceps: 1 },
  }),
  exercise({
    id: "romanian-deadlift",
    name: "Romanian Deadlift",
    patterns: ["hinge"],
    primaryMuscles: ["Hamstrings"],
    stimulus: { Hamstrings: 1, Glutes: 0.5, "Lower Back": 0.25 },
    compound: true,
    fatigue: 3,
  }),
];

function concentrationDiagnostic(): V2ExerciseSelectionPlanDiagnostic {
  return {
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
      lanesEvaluated: 1,
      preservedIdentityCount: 1,
      candidateAvailableCount: 1,
      missingCandidateCount: 0,
      classMismatchCount: 0,
      duplicateRequiresJustificationCount: 0,
      concentrationWarningCount: 1,
      blockedLaneCount: 0,
    },
    weeks: [
      {
        week: 1,
        slots: [
          {
            slotId: "lower_a",
            lanes: [
              {
                laneId: "squat_anchor",
                plannedClass: ["squat_pattern"],
                primaryMuscles: ["Quads"],
                selectedIdentity: {
                  exerciseId: "hack-squat",
                  exerciseName: "Hack Squat",
                  sourceWeek: 1,
                  setCount: 4,
                },
                identityStatus: "preserved",
                laneClassStatus: "match",
                setBudgetStatus: "requires_justification",
                duplicateStatus: "pass",
                concentrationStatus: "quality_warning",
                fatigueStatus: "quality_warning",
                inventoryStatus: "available",
                capacityStatus: "within_capacity",
                cleanAlternatives: [],
                unresolvedDemand: [],
                evidenceRefs: ["concentration:Quads:over_50_percent"],
                limitations: [],
              },
            ],
          },
        ],
      },
    ],
    blockers: [],
    warnings: [],
    missingInputs: [],
    safeForBehaviorPromotion: false,
  };
}

describe("V2 live-context materializer projections", () => {
  it("measures concentration trial deltas without feeding production seams", () => {
    const result = buildV2ConcentrationMaterializerProjectionFromLiveContext({
      plannerPolicy: buildV2PlannerMesocyclePolicy(),
      selectionDiagnostic: concentrationDiagnostic(),
      inventory: INVENTORY,
    });

    expect(result).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      dryRunOnly: true,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
      safeForBehaviorPromotion: false,
      targetLane: {
        slotId: "lower_a",
        laneId: "squat_anchor",
        currentBudget: { min: 3, preferred: 4, max: 4 },
        trialBudget: { min: 3, preferred: 3, max: 3 },
      },
    });
    expect(result.candidateImpact.targetLaneSetDelta).toBe(-1);
    expect(result.candidateImpact.totalSetDelta).toBe(-1);
    expect(result.concentrationDelta.fatigueWeightedSetDelta).toBeLessThan(0);
    expect(result.crossWeekReadiness).toMatchObject({
      decision: "blocked_by_evidence",
      sourceAttribution: {
        materializerProjection: "baseline_vs_trial_dry_run",
        noRepairProjection: "selected_warning_from_exercise_selection_diagnostic",
        repairedProjection: "evidence_only_not_target_policy",
        acceptanceNoRepair: "not_provided",
      },
      projectedWeekCount: 3,
      improvedWeekCount: 0,
      regressedWeekCount: 3,
      nextSafeSlice: "inspect_materializer_regressions",
    });
    expect(result.crossWeekReadiness.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateId: "cross_week_coverage",
          status: "pass",
          evidenceSource: "pure_v2_materializer_projection",
        }),
        expect.objectContaining({
          gateId: "redistribution_donor_offset",
          status: "unknown",
          ownerSeam: "SlotDemandAllocationByWeek",
          blockers: expect.arrayContaining([
            "redistribution_donor_offset_not_projected",
          ]),
        }),
        expect.objectContaining({
          gateId: "acceptance_or_week_1_trainability",
          status: "unknown",
          evidenceSource: "acceptance_classification_no_repair",
        }),
        expect.objectContaining({
          gateId: "materializer_identity_set_blocker_non_regression",
          status: "fail",
          blockers: expect.arrayContaining([
            "materializer_identity_set_or_blocker_regression",
          ]),
        }),
        expect.objectContaining({
          gateId: "seed_runtime_receipt_db_non_consumption",
          status: "pass",
        }),
      ]),
    );
    expect(result.crossWeekReadiness.rows).toHaveLength(3);
    expect(
      result.crossWeekReadiness.rows.every(
        (row) => row.evidenceSource === "pure_v2_materializer_projection",
      ),
    ).toBe(true);
    expect(result.blockersBeforeBehavior).toEqual(
      expect.arrayContaining([
        "production_slot_demand_allocation_unchanged",
        "production_set_distribution_intent_unchanged",
        "production_materializer_not_consuming_trial",
        "weekly_distribution_redistribution_not_projected",
        "redistribution_donor_offset_not_projected",
        "materializer_identity_set_or_blocker_regression",
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });
});
