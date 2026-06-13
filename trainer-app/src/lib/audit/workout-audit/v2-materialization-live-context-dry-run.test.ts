import { describe, expect, it } from "vitest";
import {
  buildV2PlannerMesocyclePolicy,
  type V2PlannerMesocyclePolicy,
} from "@/lib/engine/planning/v2";
import type { V2ExerciseSelectionPlanDiagnostic } from "@/lib/api/planning-reality";
import type { V2MaterializationExercise } from "@/lib/engine/planning/v2";
import {
  buildV2ConcentrationMaterializerProjectionFromLiveContext,
  buildV2LaneIntentMaterializerProjectionFromLiveContext,
  buildV2PreselectionMaterializerProjectionFromLiveContext,
  buildV2StrategyRowMaterializerProjectionFromLiveContext,
  hasPromotedBoundedCalvesBaselineProof,
  type V2ConcentrationDonorOffsetRedistributionProjection,
} from "./v2-materialization-live-context-dry-run";

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
  exercise({
    id: "reverse-hyperextension",
    name: "Reverse Hyperextension",
    patterns: ["hip_extension"],
    primaryMuscles: ["Glutes"],
    stimulus: { Glutes: 1, Hamstrings: 0.35, "Lower Back": 0.1 },
    fatigue: 1,
  }),
  exercise({
    id: "back-extension",
    name: "Back Extension",
    patterns: ["extension"],
    primaryMuscles: ["Lower Back"],
    stimulus: { "Lower Back": 1, Glutes: 0.35, Hamstrings: 0.25 },
    fatigue: 2,
  }),
  exercise({
    id: "glute-kickback",
    name: "Cable Glute Kickback",
    patterns: ["isolation"],
    primaryMuscles: ["Glutes"],
    stimulus: { Glutes: 0.8 },
    fatigue: 1,
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

function withoutDonorOffsetCandidates(
  policy: V2PlannerMesocyclePolicy,
): V2PlannerMesocyclePolicy {
  return {
    ...policy,
    slotDemandAllocationByWeek: {
      ...policy.slotDemandAllocationByWeek,
      weeks: policy.slotDemandAllocationByWeek.weeks.map((week) => ({
        ...week,
        slots: week.slots.map((slot) => ({
          ...slot,
          lanes: slot.lanes.map((lane) =>
            slot.slotId === "lower_a" && lane.laneId === "squat_anchor"
              ? lane
              : { ...lane, allocatedMuscles: [] },
          ),
        })),
      })),
    },
  };
}

describe("V2 live-context materializer projections", () => {
  it("measures lower-b Hamstrings clean preselection through materializer deltas", () => {
    const result = buildV2PreselectionMaterializerProjectionFromLiveContext({
      plannerPolicy: buildV2PlannerMesocyclePolicy(),
      inventory: INVENTORY,
      planningReality: {
        preselectionFeasibility: [
          {
            slotId: "lower_b",
            muscle: "Hamstrings",
            role: "primary",
            targetStatus: "hard",
            demandType: "primary_hard_target",
            candidateStatus: "clean_candidate",
            targetEffectiveSets: 6,
            currentInitialEffectiveSets: 3,
            currentFinalEffectiveSets: 6,
            shortfallBeforeRepair: 3,
            preferredCleanPath: [
              {
                exerciseClass: "knee_flexion_curl",
                available: true,
                evidence: ["Leg Curl available"],
              },
            ],
            dirtyClosureSignals: [],
            collateralEstimate: {
              glutesDelta: 0,
              lowerBackDelta: 0,
            },
            candidateInventory: [
              {
                exerciseId: "leg-curl",
                exerciseName: "Leg Curl",
                candidateClass: "knee_flexion_curl",
                primaryMuscles: ["Hamstrings"],
                secondaryMuscles: [],
                movementPatterns: ["knee_flexion"],
                hamstringsStimulusPerSet: 1,
                glutesStimulusPerSet: 0,
                lowerBackStimulusPerSet: 0,
                lowerSlotCompatible: true,
                lowerBCompatible: true,
                alreadySelectedInWeek: false,
                alreadySelectedSlotIds: [],
                selectedInLowerBInitial: false,
                selectedInLowerBFinal: false,
                availability: "available_but_capacity_blocked",
                reasons: ["clean_knee_flexion_candidate_visible"],
              },
            ],
            recommendation: "safe_to_trial_preselection",
            reasons: ["clean_knee_flexion_path_evidence_present"],
            readOnly: true,
            affectsScoringOrGeneration: false,
          },
        ],
      } as unknown as Parameters<
        typeof buildV2PreselectionMaterializerProjectionFromLiveContext
      >[0]["planningReality"],
    });

    expect(result).toMatchObject({
      source: "v2_preselection_materializer_projection",
      readOnly: true,
      affectsScoringOrGeneration: false,
      dryRunOnly: true,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
      candidateId: "fresh_preselection_lower_b_hamstrings",
      ownerSeam: "ExerciseClassDistributionBySlot -> ExerciseSelectionPlan",
      sourceSurface: "clean_preselection_feasibility",
      row: {
        slotId: "lower_b",
        laneId: "knee_flexion_curl",
        muscle: "Hamstrings",
        cleanCandidateCount: 1,
      },
      downstreamProjection: {
        classDistributionStatus: "measured",
        capacityPlanStatus: "measured",
        exerciseSelectionStatus: "measured",
      },
      protectedCoverageImpact: {
        status: "regressed",
      },
      nonConsumption: {
        demandOrMaterializer: false,
        seedRuntimeReceiptDb: false,
        acceptanceThreshold: false,
      },
      safeForBehaviorPromotion: false,
    });
    expect(result.readiness).toBe("blocked");
    expect(result.deltas.targetLaneSetDelta).toBeLessThan(0);
    expect(result.deltas.materializerBlockerDelta).toBe(1);
    expect(result.deltas.blockerOmissionDelta).toBe(1);
    expect(result.blockersBeforeBehavior).toContain(
      "preselection_protected_coverage_regression",
    );
  });

  it("measures the Side Delts strategy row through downstream policy and materializer deltas", () => {
    const result = buildV2StrategyRowMaterializerProjectionFromLiveContext({
      plannerPolicy: buildV2PlannerMesocyclePolicy(),
      inventory: INVENTORY,
      sourcePerformedEvidence: [
        "meso-any-1:floor:Side Delts:below_target_or_mev_evidence",
      ],
    });

    expect(result).toMatchObject({
      version: 1,
      source: "v2_strategy_row_materializer_projection",
      readOnly: true,
      affectsScoringOrGeneration: false,
      dryRunOnly: true,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
      projectionMode: "strategy_row_slot_allocation_materializer_dry_run",
      row: {
        rowKey: "SlotDemandAllocationByWeek:Side Delts:protect_floor",
        muscle: "Side Delts",
        ownerSeam: "SlotDemandAllocationByWeek",
        action: "protect_floor",
      },
      boundedDeltaAttempted: {
        type: "single_set_floor_buffer",
        week: 1,
        slotId: "upper_b",
        laneId: "side_delt_isolation",
        muscle: "Side Delts",
        setDelta: 1,
      },
      downstreamProjection: {
        classDistributionStatus: "measured",
        capacityPlanStatus: "measured",
        exerciseSelectionStatus: "measured",
      },
      nonConsumption: {
        demandOrMaterializer: false,
        seedRuntimeReceiptDb: false,
        acceptanceThreshold: false,
      },
      safeForBehaviorPromotion: false,
    });
    expect(result.sourcePerformedEvidence).toEqual([
      "meso-any-1:floor:Side Delts:below_target_or_mev_evidence",
    ]);
    expect(result.boundedDeltaAttempted.trialAllocatedSets.preferred).toBe(
      result.boundedDeltaAttempted.baselineAllocatedSets.preferred + 1,
    );
    expect(result.downstreamProjection.trialClassLaneCount).toBe(
      result.downstreamProjection.baselineClassLaneCount,
    );
    expect(result.downstreamProjection.trialCapacityLaneCount).toBe(
      result.downstreamProjection.baselineCapacityLaneCount,
    );
    expect(result.downstreamProjection.trialSelectionLaneCount).toBe(
      result.downstreamProjection.baselineSelectionLaneCount,
    );
    expect(result.status).not.toBe("not_available");
    expect(result.materializer.baselineBlockerCount).toBeGreaterThanOrEqual(0);
    expect(result.materializer.trialBlockerCount).toBeGreaterThanOrEqual(0);
    expect(result.materializerDeltas.changedSlotCount).toBeGreaterThanOrEqual(0);
    expect(result.readiness).toBe("blocked");
    expect(result.protectedCoverageImpact).toMatchObject({
      status: "preserved",
      baselineTargetLaneSets: 4,
      trialTargetLaneSets: 4,
      targetLaneSetDelta: 0,
      netWeeklySetDelta: 0,
    });
    expect(result.materializerDeltas.targetLaneSetDelta).toBe(0);
    expect(result.setBudgetBasisCheck).toMatchObject({
      status: "preserved",
      baselineSetBudgetBasis: "support_direct_floor",
      trialSetBudgetBasis: "support_direct_floor",
      selectionSetBudgetDelta: 0,
      markerChangedSetBudgetBasis: false,
      blocker: null,
    });
    expect(result.protectedCoverageLossCause).toMatchObject({
      classification: "not_measured",
      primaryCause: "target_lane_not_regressed",
      ownerSeam: "unknown",
      targetLane: {
        week: 1,
        slotId: "upper_b",
        laneId: "side_delt_isolation",
        baselineSetBudget: { min: 4, preferred: 4, max: 4 },
        trialSetBudget: { min: 4, preferred: 4, max: 4 },
        baselineSetBudgetBasis: "support_direct_floor",
        trialSetBudgetBasis: "support_direct_floor",
        baselineMaterializedSets: 4,
        trialMaterializedSets: 4,
        selectionSetBudgetDelta: 0,
        materializedSetDelta: 0,
      },
    });
    expect(result.protectedCoverageLossCause.collateralLaneSetDeltas).toEqual([]);
    expect(result.nextSafeSlice).toBe(
      "inspect_materializer_or_concentration_regressions",
    );
    expect(result.blockersBeforeBehavior).toEqual(
      expect.arrayContaining([
        "acceptance_gate_not_rerun",
        "production_slot_demand_allocation_unchanged",
        "production_materializer_not_consuming_strategy_row_trial",
      ]),
    );
    expect(result.blockersBeforeBehavior).not.toContain(
      "strategy_row_protected_coverage_regression",
    );
    expect(result.remainingProofBeforeBehavior).toEqual(
      expect.arrayContaining([
        "read_only_acceptance_gate_result_for_projected_candidate",
        "seed_runtime_receipt_db_non_consumption_must_remain_proven",
        "repaired_projection_must_remain_evidence_only_not_target_policy",
      ]),
    );
    expect(result.remainingProofBeforeBehavior).not.toContain(
      "protected_coverage_non_regression",
    );
    expect(JSON.stringify(result)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });

  it("measures the Biceps protect-floor strategy row through the same read-only materializer seam", () => {
    const result = buildV2StrategyRowMaterializerProjectionFromLiveContext({
      plannerPolicy: buildV2PlannerMesocyclePolicy(),
      inventory: INVENTORY,
      sourcePerformedEvidence: [
        "meso-any-1:floor:Biceps:below_target_or_mev_evidence",
      ],
      target: {
        week: 1,
        slotId: "upper_b",
        laneId: "biceps",
        muscle: "Biceps",
        rowKey: "SlotDemandAllocationByWeek:Biceps:protect_floor",
      },
    });

    expect(result).toMatchObject({
      version: 1,
      source: "v2_strategy_row_materializer_projection",
      readOnly: true,
      affectsScoringOrGeneration: false,
      dryRunOnly: true,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
      row: {
        rowKey: "SlotDemandAllocationByWeek:Biceps:protect_floor",
        muscle: "Biceps",
        ownerSeam: "SlotDemandAllocationByWeek",
        action: "protect_floor",
      },
      boundedDeltaAttempted: {
        type: "single_set_floor_buffer",
        week: 1,
        slotId: "upper_b",
        laneId: "biceps",
        muscle: "Biceps",
        setDelta: 1,
      },
      downstreamProjection: {
        classDistributionStatus: "measured",
        capacityPlanStatus: "measured",
        exerciseSelectionStatus: "measured",
      },
      nonConsumption: {
        demandOrMaterializer: false,
        seedRuntimeReceiptDb: false,
        acceptanceThreshold: false,
      },
      safeForBehaviorPromotion: false,
    });
    expect(result.sourcePerformedEvidence).toEqual([
      "meso-any-1:floor:Biceps:below_target_or_mev_evidence",
    ]);
    expect(result.boundedDeltaAttempted.trialAllocatedSets.preferred).toBe(
      result.boundedDeltaAttempted.baselineAllocatedSets.preferred + 1,
    );
    expect(result.status).not.toBe("not_available");
    expect(result.materializer.baselineBlockerCount).toBeGreaterThanOrEqual(0);
    expect(result.materializer.trialBlockerCount).toBeGreaterThanOrEqual(0);
    expect(result.materializerDeltas.targetLaneSetDelta).toBe(
      result.protectedCoverageImpact.targetLaneSetDelta,
    );
    expect(result.remainingProofBeforeBehavior).toEqual(
      expect.arrayContaining([
        "read_only_acceptance_gate_result_for_projected_candidate",
        "seed_runtime_receipt_db_non_consumption_must_remain_proven",
        "repaired_projection_must_remain_evidence_only_not_target_policy",
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });

  it("measures the low-axial support-coverage contract as an audit-only materializer projection", () => {
    const result = buildV2LaneIntentMaterializerProjectionFromLiveContext({
      plannerPolicy: buildV2PlannerMesocyclePolicy(),
      inventory: INVENTORY,
      targetLane: {
        slotId: "lower_b",
        laneId: "hinge_anchor",
        trialId: "lower_b_hinge_anchor_low_axial_support_coverage_shadow",
        diagnosticContract: "low_axial_support_coverage",
      },
    });

    expect(result).toMatchObject({
      version: 1,
      source: "v2_lane_intent_materializer_projection",
      readOnly: true,
      affectsScoringOrGeneration: false,
      dryRunOnly: true,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
      projectionMode: "lane_intent_shadow_materializer_dry_run",
      trialId: "lower_b_hinge_anchor_low_axial_support_coverage_shadow",
      targetLane: {
        scopedLaneId: "lower_b:hinge_anchor",
        slotId: "lower_b",
        laneId: "hinge_anchor",
        intentAvailable: true,
        baselineConsumedByProduction: true,
        trialConsumesLaneIntent: false,
      },
      contractTrial: {
        appliedContract: "low_axial_support_coverage",
        exactFutureContractApplied: true,
        representedThrough: "laneSelectionIntent_v0_diagnostic_override",
        futureMovementPattern: "low_axial_hip_extension",
        futureExerciseClass: "low_axial_hip_extension_anchor",
        v0CanExpressFutureMovementAndClass: true,
        v0ProxyAllowedExerciseClasses: ["low_axial_hip_extension_anchor"],
      },
      lowAxialClosureStatus: {
        baseline: "closed_without_low_axial_anchor",
        trial: "closed_with_low_axial_anchor",
        status: "improved",
      },
      protectedCoverage: {
        status: "improved",
        protectedMuscles: ["Glutes"],
        baselineLowAxialSets: 0,
        trialLowAxialSets: 3,
        lowAxialSetDelta: 3,
      },
      exclusionProof: {
        trueHingesExcluded: true,
        hamstringCurlsExcluded: true,
        backExtensionClosureExcluded: true,
        genericGluteAccessoriesExcluded: true,
        selectedExcludedIdentities: [],
      },
      nonConsumption: {
        productionPlannerMaterializerRanking: false,
        seedRuntimeReceiptDb: false,
        acceptanceThreshold: false,
        repairBehavior: false,
      },
      safeForBehaviorPromotion: false,
    });
    expect(
      result.relevantLowerBPosteriorChainLanes.find(
        (row) => row.laneId === "hinge_anchor",
      ),
    ).toMatchObject({
      baseline: [{ exerciseName: "Romanian Deadlift", setCount: 3 }],
      trial: [{ exerciseName: "Reverse Hyperextension", setCount: 3 }],
      identityDelta: 2,
      setDelta: 0,
    });
    expect(result.candidateImpact.selectedIdentityDelta).toBeGreaterThan(0);
    expect(result.candidateImpact.totalSetDelta).toBe(0);
    expect(result.candidateImpact.materializerBlockerDelta).toBe(0);
    expect(result.duplicateConcentrationFatigueImpact).toMatchObject({
      status: "improved",
      duplicateExerciseDelta: 0,
      highFatigueSetDelta: -3,
    });
    expect(result.blockersBeforeBehavior).toEqual(
      expect.arrayContaining([
        "acceptance_gate_not_rerun",
        "diagnostic_lane_intent_override_not_consumed_by_runtime",
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });

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
          status: "fail",
          ownerSeam: "SlotDemandAllocationByWeek",
          blockers: expect.arrayContaining([
            "redistribution_donor_offset_regressed",
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
    expect(result.donorOffsetRedistributionProjection).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
      status: "blocked",
      summary: {
        projectedWeekCount: 3,
        behaviorReadinessDecision: "blocked_by_evidence",
        materializerRegressionCount: 3,
        concentrationRegressionCount: 0,
        alternateCandidateCount: 3,
        alternatePassingCandidateCount: 0,
        selectedAlternateWeekCount: 0,
        slotWeekAllocationReadiness: "blocked_by_evidence",
        slotWeekAllocationBlockedRowCount: 3,
        slotWeekAllocationNextSafeSlice: "inspect_materializer_regressions",
        nextSafeSlice: "inspect_donor_offset_regressions",
      },
      slotWeekAllocationProjection: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByDemandOrMaterializer: false,
        status: "blocked",
        summary: {
          rowCount: 3,
          blockedRowCount: 3,
          measuredDonorCapacityPassCount: 0,
          measuredDonorCapacityFailCount: 3,
          measuredDonorCapacityUnderAbsorptionCount: 0,
          measuredDonorCapacityOverAbsorptionCount: 3,
          behaviorReadiness: "blocked_by_evidence",
          nextSafeSlice: "inspect_materializer_regressions",
        },
      },
    });
    expect(result.donorOffsetRedistributionProjection.rows).toHaveLength(3);
    expect(
      result.donorOffsetRedistributionProjection.rows.every(
        (row) =>
          row.source.slotId === "lower_a" &&
          row.source.laneId === "squat_anchor" &&
          row.donor?.slotId === "lower_b" &&
          row.donor.laneId === "quad_support",
      ),
    ).toBe(true);
    expect(
      result.donorOffsetRedistributionProjection.rows.every(
        (row) =>
          row.allocationPolicyTrial?.status === "applied" &&
          row.allocationPolicyTrial.sourcePressureRow.setDelta === -1 &&
          row.allocationPolicyTrial.selectedDonorLane.setDelta === 1 &&
          row.allocationPolicyTrial.setMovementIntent.netWeeklySetIntentDelta ===
            0 &&
          row.selectedDonorKind === "primary" &&
          row.primaryDonorCandidate?.scopedLaneId ===
            "lower_b:quad_support" &&
          row.alternateDonorCandidates.length === 1 &&
          row.alternateDonorCandidates[0]?.scopedLaneId ===
            "lower_a:quad_isolation" &&
          row.alternateDonorCandidates[0]?.status === "blocked" &&
          row.materializerDelta.regressions.includes(
            "trial_seed_shape_incompatible",
          ) &&
          row.regressionCauses.includes("lane_identity"),
      ),
    ).toBe(true);
    expect(
      result.donorOffsetRedistributionProjection.summary.regressionCauseCounts,
    ).toMatchObject({
      lane_identity: 3,
    });
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
        "redistribution_donor_offset_regressed",
        "materializer_identity_set_or_blocker_regression",
        "donor_offset_materializer_identity_set_or_blocker_regression",
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });

  it("keeps donor-offset readiness unavailable when no slot-owned donor lane exists", () => {
    const result = buildV2ConcentrationMaterializerProjectionFromLiveContext({
      plannerPolicy: withoutDonorOffsetCandidates(buildV2PlannerMesocyclePolicy()),
      selectionDiagnostic: concentrationDiagnostic(),
      inventory: INVENTORY,
    });

    expect(result.donorOffsetRedistributionProjection).toMatchObject({
      status: "not_available",
      summary: {
        behaviorReadinessDecision: "not_available",
        projectedWeekCount: 0,
        alternateCandidateCount: 0,
        alternatePassingCandidateCount: 0,
        selectedAlternateWeekCount: 0,
        slotWeekAllocationReadiness: "not_available",
        slotWeekAllocationBlockedRowCount: 0,
        slotWeekAllocationNextSafeSlice: "keep_diagnostic_only",
      },
      slotWeekAllocationProjection: {
        status: "not_available",
        summary: {
          behaviorReadiness: "not_available",
          nextSafeSlice: "keep_diagnostic_only",
        },
      },
      safeForBehaviorPromotion: false,
    });
    expect(result.crossWeekReadiness.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gateId: "redistribution_donor_offset",
          status: "unknown",
          measured: false,
          blockers: expect.arrayContaining([
            "redistribution_donor_offset_not_projected",
            "donor_offset_candidate_unavailable",
          ]),
        }),
      ]),
    );
  });

  it("recognizes the promoted Calves 3/5 slot allocation proof as idempotent baseline evidence", () => {
    const rows: V2ConcentrationDonorOffsetRedistributionProjection["slotWeekAllocationProjection"]["rows"] =
      [2, 3, 4].map((week) => ({
        week,
        muscle: "Calves",
        protectedWeeklyDemand: { min: 6, preferred: 8, max: 8 },
        sourceLanePressure: {
          slotId: "lower_a",
          laneId: "calves",
          allocatedPreferredSets: 3,
          baselineSetCount: 4,
          trialSetCount: 3,
          setDelta: -1,
          pressureRelieved: true,
        },
        eligibleDonorSlots: [
          {
            slotId: "lower_b",
            laneId: "calves",
            allocatedPreferredSets: 5,
            ownershipKind: "direct_support",
            measured: true,
          },
        ],
        donorCapacity: {
          requiredSetAbsorption: 1,
          donorSlotId: "lower_b",
          donorLaneId: "calves",
          donorBeforeSets: 4,
          donorAfterSets: 5,
          donorSetDelta: 1,
          absorbedRequiredSets: true,
          headroomSets: 0,
          status: "absorbed",
        },
        protectedCoverageImpact: {
          status: "preserved",
          netWeeklySetDelta: 0,
        },
        materializerNonRegressionStatus: "pass",
        behaviorReadiness: "candidate_for_acceptance_projection",
        blockingReasons: [],
        nextSafeSlice: "run_acceptance_non_regression_projection",
      }));
    const donorOffset = {
      status: "projected_with_limitations",
      summary: {
        behaviorReadinessDecision: "candidate_for_acceptance_projection",
        materializerRegressionCount: 0,
        concentrationRegressionCount: 0,
        totalSetDelta: 0,
      },
      slotWeekAllocationProjection: {
        status: "available",
        summary: {
          behaviorReadiness: "candidate_for_acceptance_projection",
          blockedRowCount: 0,
          passingRowCount: 3,
          netWeeklySetDelta: 0,
        },
        rows,
      },
    } as V2ConcentrationDonorOffsetRedistributionProjection;

    expect(hasPromotedBoundedCalvesBaselineProof(donorOffset)).toBe(true);
    expect(
      hasPromotedBoundedCalvesBaselineProof({
        ...donorOffset,
        slotWeekAllocationProjection: {
          ...donorOffset.slotWeekAllocationProjection,
          rows: [
            {
              ...rows[0]!,
              donorCapacity: {
                ...rows[0]!.donorCapacity,
                donorAfterSets: 4,
                absorbedRequiredSets: false,
                status: "insufficient",
              },
            },
            ...rows.slice(1),
          ],
        },
      }),
    ).toBe(false);
  });
});
