import { describe, expect, it } from "vitest";
import type { SlotPlanPlanningRealityDiagnostic } from "@/lib/api/planning-reality";
import type { MesocycleExplainPlannerOnlyNoRepair } from "./types";
import { buildV2PromotionCandidateEvaluator } from "./v2-promotion-candidate-evaluator";

function makeNoRepair(
  input: Partial<MesocycleExplainPlannerOnlyNoRepair>,
): MesocycleExplainPlannerOnlyNoRepair {
  return input as MesocycleExplainPlannerOnlyNoRepair;
}

function makeGap(
  input: Partial<
    NonNullable<
      MesocycleExplainPlannerOnlyNoRepair["repairPromotionScoreboard"]
    >["interpretation"]["gapInventory"][number]
  >,
): NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["repairPromotionScoreboard"]
>["interpretation"]["gapInventory"][number] {
  return {
    rank: 1,
    gapId: "support_direct_floor",
    description: "Support floor diagnostic",
    likelyOwnerSeam: "SetDistributionIntent",
    evidenceQuality: "measured_materializer_projection",
    trainingImportance: "high",
    gapCount: 1,
    currentEvidence: ["owner=SetDistributionIntent"],
    missingProof: [],
    measurableNextStep: "pivot_to_higher_roi_track",
    status: "measured_no_candidate_impact",
    ...input,
  };
}

function makeScoreboard(
  gaps: ReturnType<typeof makeGap>[],
): MesocycleExplainPlannerOnlyNoRepair["repairPromotionScoreboard"] {
  return {
    version: 1,
    readOnly: true,
    affectsScoringOrGeneration: false,
    source: "repaired_planning_reality",
    rawRepairEvidence: {
      rawRowCount: 0,
      materialRepairCount: 0,
      majorRepairCount: 0,
      likelyAvoidableMaterialRepairCount: 0,
      remainingMaterialRepairCount: 0,
      suspiciousRepairCount: 0,
    },
    summary: {
      promotionCandidateCount: 0,
      doNotPromoteCount: 0,
      safetyNetCount: 0,
      collateralDiagnosticCount: 0,
      diagnosticOnlyCount: 0,
    },
    interpretation: {
      legacyRepairPressure: {
        rawRowCount: 0,
        materialRepairCount: 0,
        majorRepairCount: 0,
        likelyAvoidableMaterialRepairCount: 0,
        remainingMaterialRepairCount: 0,
        suspiciousRepairCount: 0,
        note: "raw_legacy_repair_evidence_not_behavior_promotion_pressure",
      },
      currentV2PolicyGap: {
        selectionFeasibilityCapacityPressureCount: 0,
        classTaxonomyMismatchCount: 0,
        setDistributionCapacityGapCount: 0,
        supportDirectFloorBlockerCount: 0,
        concentrationQualityGapCount: 0,
        setBudgetPolicyFailureCount: 0,
        staleWeek1ReadoutArtifactCount: 0,
        optionalDiagnosticLaneCount: 0,
      },
      safetyNonRegressionRows: {
        count: 0,
        includesSuspiciousRows: false,
      },
      staleRepairedProjectionArtifacts: {
        count: 0,
        examples: [],
      },
      quarantineGroups: {
        upstreamOwnedCandidate: 0,
        safetyRepairOnly: 0,
        collateralAmbiguous: 0,
        staleArtifact: 0,
        missingEvidenceOrUnmeasuredGate: 0,
      },
      missingProofBeforeBehaviorPromotion: [],
      gapInventory: gaps,
      legacyRepairQuarantine: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        repairedProjectionRole: "legacy_evidence_not_target_policy",
        policyPromotionBasis: "positive_slot_owned_likely_avoidable_rows_only",
        rawLegacyEvidenceRowCount: 0,
        behaviorPromotionCandidateCount: 0,
        quarantinedRowCount: 0,
        safetyNetCount: 0,
        collateralDiagnosticCount: 0,
        diagnosticOnlyCount: 0,
        staleRepairedProjectionArtifactCount: 0,
        suspiciousRepairCount: 0,
      },
      repairDeprecationReadiness: {
        status: "not_ready",
        readOnly: true,
        affectsScoringOrGeneration: false,
        roles: [],
        summary: {
          safetyNetCount: 0,
          planAuthoringLeftoverCount: 0,
          obsoleteNoImpactCount: 0,
          stillUnprovenCount: 0,
          readyForDeprecationReviewCount: 0,
        },
        nextSafeAction: "keep_repair_as_safety_net",
      },
    },
    promotionCandidates: [],
    doNotPromoteRows: [],
    safetyNetRows: [],
    collateralDiagnosticRows: [],
    diagnosticRows: [],
  } as unknown as MesocycleExplainPlannerOnlyNoRepair["repairPromotionScoreboard"];
}

function makeBenchmark(): MesocycleExplainPlannerOnlyNoRepair["v2PlanQualityBenchmark"] {
  return {
    version: 1,
    source: "v2_candidate_quality_benchmark",
    readOnly: true,
    affectsScoringOrGeneration: false,
    consumedByProduction: false,
    repairedProjectionUsedAs: "evidence_only_not_target_policy",
    status: "warning",
    summary: {
      passCount: 4,
      warningCount: 2,
      failCount: 0,
      missingEvidenceCount: 0,
      mustFixBeforeWeek1Count: 0,
      concentrationReadinessDecision: "candidate_for_bounded_policy_design",
      concentrationNextSafeSlice: "bounded_behavior_promotion_review",
      concentrationReadinessBlockerCount: 0,
      slotWeekAllocationReadiness: "candidate_for_acceptance_projection",
      slotWeekAllocationBlockedRowCount: 0,
      slotWeekAllocationNextSafeSlice: "run_acceptance_non_regression_projection",
      nextSafeAction: "resolve_watch_items_before_behavior_promotion",
    },
    slotWeekAllocationAcceptanceProjection: {
      version: 1,
      source: "v2_slot_week_allocation_acceptance_non_regression_projection",
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      candidateSource: "SlotDemandAllocationByWeek",
      evidenceSource:
        "v2_plan_quality_benchmark_and_donor_offset_materializer_projection",
      representativeAccumulationWeeks: [2, 3, 4],
      decision: "accepted_with_watch_items",
      week1Trainability: {
        status: "pass",
        replacementReadinessStatus: "not_ready",
        hardBlockerCount: 0,
        qualityWarningCount: 2,
      },
      protectedVolumeCoverage: {
        status: "pass",
        evidence: [],
      },
      materializerNonRegression: {
        status: "pass",
        evidence: [],
      },
      duplicateConcentrationNonRegression: {
        status: "pass",
        evidence: [],
      },
      nonConsumption: {
        seedRuntimeReceiptDb: "pass",
        productionMaterializer: "pass",
        acceptanceThreshold: "pass",
      },
      acceptance: {
        watchItems: ["duplicate", "lane"],
        blockers: [],
        classificationCounts: {
          acceptedWatch: 0,
          boundedOwnerWatch: 1,
          blocker: 0,
          staleOrDiagnosticNoise: 1,
          ownerSpecificNextFix: 0,
        },
        itemClassifications: [],
        nextSafeSlice: "resolve_watch_items_before_behavior_promotion",
      },
    },
    gates: [
      {
        gate: "duplicate_concentration_risk",
        status: "warning",
        ownerSeam: "v2_base_plan_validation.duplicate_distinctness",
        evidenceSource: "pure_v2_base_plan",
        evidence: ["v2DuplicateExactExercises=0", "baseRegressions=0"],
        missingEvidence: [],
        candidateImpact: "needs_more_evidence",
        mustFixBeforeWeek1: false,
      },
      {
        gate: "lane_preservation",
        status: "warning",
        ownerSeam: "v2_shadow_lane_preservation",
        evidenceSource: "shadow_diagnostic",
        evidence: ["lane_preservation_shadow_warning"],
        missingEvidence: [],
        candidateImpact: "needs_more_evidence",
        mustFixBeforeWeek1: false,
      },
    ],
    deprecationReadiness: {
      status: "not_ready",
      roles: [],
      nextSafeAction: "keep_repair_as_safety_net",
    },
    guardrails: {
      seedRuntimeChanged: false,
      productionMaterializerChanged: false,
      acceptanceThresholdChanged: false,
      persistenceChanged: false,
    },
  } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2PlanQualityBenchmark"];
}

function makeSideDeltsProjection(
  input: Partial<
    NonNullable<
      MesocycleExplainPlannerOnlyNoRepair["v2StrategyRowMaterializerProjection"]
    >
  > = {},
): MesocycleExplainPlannerOnlyNoRepair["v2StrategyRowMaterializerProjection"] {
  return {
    version: 1,
    source: "v2_strategy_row_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "projected_with_limitations",
    projectionMode: "strategy_row_slot_allocation_materializer_dry_run",
    sourcePerformedEvidence: ["source=owner_scoped_projection"],
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
      baselineAllocatedSets: { min: 4, preferred: 4, max: 4 },
      trialAllocatedSets: { min: 4, preferred: 4, max: 4 },
    },
    downstreamProjection: {
      classDistributionStatus: "measured",
      capacityPlanStatus: "measured",
      exerciseSelectionStatus: "measured",
      baselineClassLaneCount: 1,
      trialClassLaneCount: 1,
      baselineCapacityLaneCount: 1,
      trialCapacityLaneCount: 1,
      baselineSelectionLaneCount: 1,
      trialSelectionLaneCount: 1,
    },
    materializer: {
      baselineStatus: "materialized",
      trialStatus: "materialized",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: true,
      trialSeedShapeCompatible: true,
    },
    materializerDeltas: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      targetLaneSetDelta: 0,
      targetLaneExerciseDelta: 0,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      changedSlotCount: 0,
      changedSlots: [],
    },
    protectedCoverageImpact: {
      status: "preserved",
      baselineTargetLaneSets: 4,
      trialTargetLaneSets: 4,
      targetLaneSetDelta: 0,
      netWeeklySetDelta: 0,
    },
    setBudgetBasisCheck: {
      status: "preserved",
      baselineSetBudgetBasis: "support_direct_floor",
      trialSetBudgetBasis: "support_direct_floor",
      selectionSetBudgetDelta: 0,
      markerChangedSetBudgetBasis: false,
      blocker: null,
      evidence: [],
    },
    protectedCoverageLossCause: {
      classification: "not_measured",
      primaryCause: "target_lane_not_regressed",
      ownerSeam: "unknown",
      summary: "target lane not regressed",
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
      collateralLaneSetDeltas: [],
    },
    duplicateConcentrationImpact: {
      status: "preserved",
      warningDelta: 0,
      maxShareDelta: 0,
      highFatigueSetDelta: 0,
    },
    readiness: "diagnostic_no_impact",
    blockersBeforeBehavior: [],
    remainingProofBeforeBehavior: ["acceptance_projection"],
    nextSafeSlice: "pivot_to_higher_roi_track",
    nonConsumption: {
      demandOrMaterializer: false,
      seedRuntimeReceiptDb: false,
      acceptanceThreshold: false,
    },
    limitations: [],
    safeForBehaviorPromotion: false,
    ...input,
  };
}

function makePreselectionProjection(
  input: Partial<
    NonNullable<
      MesocycleExplainPlannerOnlyNoRepair["v2PreselectionMaterializerProjection"]
    >
  > = {},
): MesocycleExplainPlannerOnlyNoRepair["v2PreselectionMaterializerProjection"] {
  return {
    version: 1,
    source: "v2_preselection_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "projected_with_limitations",
    projectionMode: "clean_preselection_selection_plan_materializer_dry_run",
    candidateId: "fresh_preselection_lower_b_hamstrings",
    ownerSeam: "ExerciseClassDistributionBySlot -> ExerciseSelectionPlan",
    sourceSurface: "clean_preselection_feasibility",
    trialId: "lower_b_hamstrings_clean_preselection_shadow",
    row: {
      slotId: "lower_b",
      laneId: "knee_flexion_curl",
      muscle: "Hamstrings",
      candidateStatus: "clean_candidate",
      recommendation: "safe_to_trial_preselection",
      cleanCandidateCount: 3,
    },
    downstreamProjection: {
      classDistributionStatus: "measured",
      capacityPlanStatus: "measured",
      exerciseSelectionStatus: "measured",
      baselineClassLaneCount: 10,
      trialClassLaneCount: 10,
      baselineCapacityLaneCount: 10,
      trialCapacityLaneCount: 10,
      baselineSelectionLaneCount: 10,
      trialSelectionLaneCount: 10,
    },
    selectedHamstrings: {
      baselineIdentities: [{ exerciseName: "Seated Leg Curl", setCount: 3 }],
      trialIdentities: [{ exerciseName: "Seated Leg Curl", setCount: 3 }],
    },
    materializedHamstrings: {
      baselineIdentities: [{ exerciseName: "Seated Leg Curl", setCount: 3 }],
      trialIdentities: [{ exerciseName: "Seated Leg Curl", setCount: 3 }],
    },
    materializer: {
      baselineStatus: "materialized",
      trialStatus: "materialized",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: true,
      trialSeedShapeCompatible: true,
    },
    deltas: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      targetLaneSetDelta: 0,
      targetLaneExerciseDelta: 0,
      materializerBlockerDelta: 0,
      blockerOmissionDelta: 0,
      regressionCount: 0,
      changedSlotCount: 0,
      changedSlots: [],
    },
    protectedCoverageImpact: {
      status: "preserved",
      baselineTargetLaneSets: 3,
      trialTargetLaneSets: 3,
      targetLaneSetDelta: 0,
      netWeeklySetDelta: 0,
    },
    duplicateConcentrationImpact: {
      status: "preserved",
      warningDelta: 0,
      maxShareDelta: 0,
      highFatigueSetDelta: 0,
    },
    acceptanceWatchStatus: "missing_proof",
    readiness: "diagnostic_no_impact",
    blockersBeforeBehavior: ["preselection_trial_no_candidate_impact"],
    remainingProofBeforeBehavior: ["read_only_acceptance_gate_result_for_projected_candidate"],
    nextSafeSlice: "pivot_to_higher_roi_track",
    nonConsumption: {
      demandOrMaterializer: false,
      seedRuntimeReceiptDb: false,
      acceptanceThreshold: false,
    },
    limitations: [],
    safeForBehaviorPromotion: false,
    ...input,
  };
}

describe("V2 promotion candidate evaluator", () => {
  it("stops the current known candidates instead of recommending row chasing", () => {
    const evaluator = buildV2PromotionCandidateEvaluator(
      makeNoRepair({
        repairPromotionScoreboard: makeScoreboard([
          makeGap({
            gapId: "concentration_quality",
            description: "Calves slot/week allocation is now baseline",
            likelyOwnerSeam: "SlotDemandAllocationByWeek",
            status: "measured_promoted_baseline_idempotent",
            currentEvidence: ["promotedBoundedCalvesBaselineIdempotent=true"],
          }),
          makeGap({
            gapId: "support_direct_floor",
            status: "measured_no_candidate_impact",
            currentEvidence: ["selectedSupportFloorGapId=side_delts"],
          }),
          makeGap({
            gapId: "class_taxonomy_mismatch",
            status: "measured_no_drift",
            currentEvidence: ["taxonomyProjection=measured_no_drift"],
          }),
        ]),
        v2PlanQualityBenchmark: makeBenchmark(),
        v2StrategyRowMaterializerProjection: makeSideDeltsProjection(),
      }),
    );

    expect(evaluator.status).toBe("none_ready");
    expect(evaluator.recommendation).toMatchObject({
      decision: "none_ready",
      candidateId: null,
    });
    expect(evaluator.stopReasonCounts).toMatchObject({
      already_promoted_baseline: 1,
      measured_no_impact: 2,
      stale_noise: 2,
      missing_bounded_delta: 1,
    });
    expect(evaluator.candidates.map((row) => row.candidateId)).toEqual(
      expect.arrayContaining([
        "concentration_quality",
        "support_direct_floor",
        "class_taxonomy_mismatch",
        "duplicate_class_family_distinctness",
        "lane_preservation_shadow_readout",
        "side_delts_protect_floor",
      ]),
    );
  });

  it("ranks a measured owner-specific positive candidate above stopped rows", () => {
    const evaluator = buildV2PromotionCandidateEvaluator(
      makeNoRepair({
        repairPromotionScoreboard: makeScoreboard([
          makeGap({
            gapId: "support_direct_floor",
            status: "measured_no_candidate_impact",
          }),
        ]),
        v2StrategyRowMaterializerProjection: makeSideDeltsProjection({
          materializerDeltas: {
            selectedIdentityDelta: 1,
            totalSetDelta: 1,
            targetLaneSetDelta: 1,
            targetLaneExerciseDelta: 1,
            materializerBlockerDelta: 0,
            regressionCount: 0,
            changedSlotCount: 1,
            changedSlots: [],
          },
          protectedCoverageImpact: {
            status: "improved",
            baselineTargetLaneSets: 3,
            trialTargetLaneSets: 4,
            targetLaneSetDelta: 1,
            netWeeklySetDelta: 0,
          },
          readiness: "candidate_for_bounded_review",
          remainingProofBeforeBehavior: [],
          nextSafeSlice: "run_read_only_acceptance_projection",
        }),
      }),
    );

    expect(evaluator.status).toBe("candidate_ready");
    expect(evaluator.recommendation).toMatchObject({
      decision: "recommend_next_safe_slice",
      candidateId: "side_delts_protect_floor",
      ownerSeam: "SlotDemandAllocationByWeek",
    });
    expect(
      evaluator.candidates.find(
        (row) => row.candidateId === "side_delts_protect_floor",
      ),
    ).toMatchObject({
      rank: 1,
      status: "ready",
      stopReasons: [],
    });
  });

  it("preserves source attribution and non-consumption guardrails", () => {
    const evaluator = buildV2PromotionCandidateEvaluator(
      makeNoRepair({
        repairPromotionScoreboard: makeScoreboard([
          makeGap({
            gapId: "set_distribution_budget",
            likelyOwnerSeam: "SetDistributionIntent",
            status: "blocked_by_missing_evidence",
            currentEvidence: ["selectedSetBudgetGapId=week_1:upper_b"],
          }),
        ]),
      }),
    );

    expect(evaluator.readOnly).toBe(true);
    expect(evaluator.affectsScoringOrGeneration).toBe(false);
    expect(evaluator.consumedByProduction).toBe(false);
    expect(evaluator.consumedByDemandOrMaterializer).toBe(false);
    expect(evaluator.repairedProjectionUsedAs).toBe(
      "evidence_only_not_target_policy",
    );
    expect(evaluator.guardrails).toEqual({
      seedRuntimeChanged: false,
      receiptChanged: false,
      persistenceChanged: false,
      productionMaterializerChanged: false,
      acceptanceThresholdChanged: false,
    });
    expect(evaluator.candidates[0]).toMatchObject({
      candidateId: "set_distribution_budget",
      ownerSeam: "SetDistributionIntent",
      evidence: ["selectedSetBudgetGapId=week_1:upper_b"],
      stopReasons: ["missing_bounded_delta"],
    });
  });

  it("gates fresh clean-preselection inventory behind bounded projection proof", () => {
    const evaluator = buildV2PromotionCandidateEvaluator(
      makeNoRepair({}),
      {
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
                  evidence: ["Lying Leg Curl available"],
                },
              ],
              dirtyClosureSignals: [],
              collateralEstimate: {
                glutesDelta: 0,
                lowerBackDelta: 0,
              },
              candidateInventory: [
                {
                  exerciseId: "lying-leg-curl",
                  exerciseName: "Lying Leg Curl",
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
        } as unknown as SlotPlanPlanningRealityDiagnostic,
      },
    );

    expect(evaluator.status).toBe("blocked_by_missing_evidence");
    expect(evaluator.recommendation).toMatchObject({
      decision: "collect_more_evidence",
      candidateId: null,
    });
    expect(evaluator.candidates[0]).toMatchObject({
      candidateId: "fresh_preselection_lower_b_hamstrings",
      sourceSurface: "fresh_owner_specific_inventory",
      ownerSeam: "ExerciseClassDistributionBySlot -> ExerciseSelectionPlan",
      status: "blocked",
      stopReasons: [
        "missing_bounded_delta",
        "missing_acceptance_or_watch_clearance",
      ],
      nextSafeAction: "run_one_read_only_preselection_materializer_projection",
    });
  });

  it("uses measured clean-preselection projection instead of keeping the row unmeasured", () => {
    const evaluator = buildV2PromotionCandidateEvaluator(
      makeNoRepair({
        v2PreselectionMaterializerProjection: makePreselectionProjection(),
      }),
      {
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
              preferredCleanPath: [],
              dirtyClosureSignals: [],
              collateralEstimate: {
                glutesDelta: 0,
                lowerBackDelta: 0,
              },
              candidateInventory: [],
              recommendation: "safe_to_trial_preselection",
              reasons: ["clean_knee_flexion_path_evidence_present"],
              readOnly: true,
              affectsScoringOrGeneration: false,
            },
          ],
        } as unknown as SlotPlanPlanningRealityDiagnostic,
      },
    );

    expect(evaluator.status).toBe("none_ready");
    expect(evaluator.summary.evaluatedCandidateCount).toBe(1);
    expect(evaluator.stopReasonCounts).toMatchObject({
      measured_no_impact: 1,
      missing_acceptance_or_watch_clearance: 1,
    });
    expect(evaluator.candidates[0]).toMatchObject({
      candidateId: "fresh_preselection_lower_b_hamstrings",
      sourceSurface: "preselection_materializer_projection",
      status: "stopped",
      priorProbe: "measured_no_impact",
      nextSafeAction: "pivot_to_higher_roi_track",
    });
  });

  it("adds performed-reality strategy inventory without re-adding exhausted Side Delts", () => {
    const evaluator = buildV2PromotionCandidateEvaluator(
      makeNoRepair({
        strategyToDemandProjection: {
          candidateInventory: {
            rows: [
              {
                evidenceSource: "performed_reality",
                affected: {
                  muscle: "Side Delts",
                  slotIds: ["upper_b"],
                  laneIds: [],
                  weekNumbers: [],
                },
                proposedOwnerSeam: "SlotDemandAllocationByWeek",
                suggestedFutureActionType: "protect_floor",
                evidenceClass: "performed_reality",
                readiness: "blocked",
                requiredProofBeforeBehavior: ["bounded_delta_not_available"],
                sourceAttribution: ["side_delts_known_no_impact"],
                nonConsumption: {
                  demandOrMaterializer: false,
                  seedRuntimeReceiptDb: false,
                  acceptanceThreshold: false,
                },
              },
              {
                evidenceSource: "performed_reality",
                affected: {
                  muscle: "Chest",
                  slotIds: ["upper_a", "upper_b"],
                  laneIds: [],
                  weekNumbers: [],
                },
                proposedOwnerSeam: "SetDistributionIntent",
                suggestedFutureActionType: "redistribute_or_cap",
                evidenceClass: "performed_reality",
                readiness: "blocked",
                requiredProofBeforeBehavior: [
                  "owner_specific_bounded_delta_projection",
                ],
                sourceAttribution: [
                  "Chest:under_hit_in_3_performed_block_response",
                ],
                nonConsumption: {
                  demandOrMaterializer: false,
                  seedRuntimeReceiptDb: false,
                  acceptanceThreshold: false,
                },
              },
            ],
          },
        } as unknown as MesocycleExplainPlannerOnlyNoRepair["strategyToDemandProjection"],
      }),
    );

    expect(
      evaluator.candidates.some(
        (row) =>
          row.candidateId ===
          "fresh_strategy_slotdemandallocationbyweek_side_delts_protect_floor",
      ),
    ).toBe(false);
    expect(evaluator.candidates[0]).toMatchObject({
      candidateId: "fresh_strategy_setdistributionintent_chest_redistribute_or_cap",
      sourceSurface: "fresh_owner_specific_inventory",
      ownerSeam: "SetDistributionIntent",
      status: "blocked",
      stopReasons: [
        "missing_bounded_delta",
        "missing_acceptance_or_watch_clearance",
      ],
    });
  });
});
