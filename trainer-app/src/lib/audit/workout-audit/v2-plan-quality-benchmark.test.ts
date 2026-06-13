import { describe, expect, it } from "vitest";
import { buildV2PlannerMesocyclePolicy } from "@/lib/engine/planning/v2";
import { buildV2LaneSelectionIntentAudit } from "@/lib/engine/planning/v2/lane-selection-intent-audit";
import type { MesocycleExplainPlannerOnlyNoRepair } from "./types";
import { buildV2PlanQualityBenchmark } from "./v2-plan-quality-benchmark";

function laneSelectionIntentAuditFixture(): MesocycleExplainPlannerOnlyNoRepair["v2LaneSelectionIntentAudit"] {
  const policy = buildV2PlannerMesocyclePolicy();
  return buildV2LaneSelectionIntentAudit({
    exerciseSelectionPlan: policy.exerciseSelectionPlan,
    targetSkeleton: policy.targetSkeleton,
  });
}

function pureV2BasePlanCompareFixture(
  overrides: Partial<
    NonNullable<MesocycleExplainPlannerOnlyNoRepair["v2BasePlanCompare"]>
  > = {},
): NonNullable<MesocycleExplainPlannerOnlyNoRepair["v2BasePlanCompare"]> {
  return {
    version: 1,
    source: "v2_base_plan_compare",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status: "available",
    comparedPlans: {
      v2BasePlanAvailable: true,
      plannerOnlyNoRepairAvailable: true,
      repairedPlanAvailable: true,
    },
    interpretationRules: {
      v2BasePlanIsCandidateStaticNorthStar: true,
      repairedPlanIsEvidenceNotTarget: true,
      noRepairOutputShowsCurrentPlannerBeforeRepair: true,
      differencesDoNotImplyV2WrongBecauseItDiffersFromRepairedPlan: true,
    },
    summary: {
      v2BaseValidationStatus: "pass",
      v2TotalSets: 66,
      noRepairTotalSets: 58,
      repairedTotalSets: 69,
      repairDependencyCount: 72,
      v2ImprovementCount: 16,
      v2RegressionCount: 0,
      unclearCount: 6,
    },
    comparisons: {
      slotShape: {
        classification: "v2_preserves",
        v2Base: {
          slotCount: 4,
          exerciseCount: 20,
          totalSets: 66,
          maxSlotSets: 21,
          optionalLaneMaterializationCount: 0,
          standaloneOneSetExerciseCount: 0,
          fiveSetStackCount: 0,
          setsBySlot: [
            { slotId: "upper_a", exerciseCount: 6, setCount: 20 },
            { slotId: "lower_a", exerciseCount: 4, setCount: 12 },
            { slotId: "upper_b", exerciseCount: 6, setCount: 21 },
            { slotId: "lower_b", exerciseCount: 4, setCount: 13 },
          ],
        },
        rows: [
          {
            item: "max_slot_sets",
            classification: "v2_preserves",
            evidence: ["v2:21", "repaired:21"],
          },
          {
            item: "five_set_stacking",
            classification: "v2_improves",
            evidence: ["v2_five_set:0"],
          },
        ],
      } as NonNullable<
        MesocycleExplainPlannerOnlyNoRepair["v2BasePlanCompare"]
      >["comparisons"]["slotShape"],
      muscleCoverage: {
        classification: "v2_improves",
        underHitMuscles: [],
        overConcentratedMuscles: [],
        managedCollateralExposure: [],
        rows: [],
      },
      exerciseClassCoverage: {} as NonNullable<
        MesocycleExplainPlannerOnlyNoRepair["v2BasePlanCompare"]
      >["comparisons"]["exerciseClassCoverage"],
      repairDependency: {
        classification: "v2_improves",
        dependencyCount: 72,
        responsibilities: [
          {
            item: "support-floor closure as planner author",
            classification: "v2_improves",
            dependencyCount: 4,
            evidence: [
              "directSupportFloorsMissed=0",
              "repaired_projection_is_evidence_only",
            ],
          },
        ],
      },
      exerciseIdentity: {
        classification: "v2_preserves",
        duplicateExactExercises: {
          v2Base: [],
          plannerOnlyNoRepair: ["Cable Lateral Raise"],
          repairedPlan: [],
        },
        duplicateClassFamilies: {
          v2Base: [],
          plannerOnlyNoRepair: ["lateral_raise"],
          repairedPlan: [],
        },
        slots: [],
        materializerDifferences: [],
      } as NonNullable<
        MesocycleExplainPlannerOnlyNoRepair["v2BasePlanCompare"]
      >["comparisons"]["exerciseIdentity"],
      deloadReadiness: {} as NonNullable<
        MesocycleExplainPlannerOnlyNoRepair["v2BasePlanCompare"]
      >["comparisons"]["deloadReadiness"],
    },
    blockersBeforeBehaviorPromotion: [
      "shadow_consumption_trial_not_run",
      "accepted_seed_runtime_consumption_gate_not_changed",
    ],
    nextSafeAction: "add_shadow_consumption_trial",
    guardrails: {
      doesNotUseHistoricalStrategyRecommendations: true,
      doesNotTreatRepairedPlanAsTargetPolicy: true,
      doesNotFeedProductionProjection: true,
      doesNotAffectGeneration: true,
      doesNotAffectSelectionV2: true,
      doesNotAffectRepair: true,
      doesNotAffectSeedSerialization: true,
      doesNotAffectRuntimeReplay: true,
      doesNotAffectReceipts: true,
      consumedByDemandOrMaterializer: false,
    },
    ...overrides,
  };
}

function pureV2ShadowTrialFixture(
  overrides: Partial<
    NonNullable<
      MesocycleExplainPlannerOnlyNoRepair["v2BasePlanShadowConsumptionTrial"]
    >
  > = {},
): NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["v2BasePlanShadowConsumptionTrial"]
> {
  return {
    version: 1,
    source: "v2_base_plan_shadow_consumption_trial",
    readOnly: true,
    affectsScoringOrGeneration: false,
    status: "available",
    consumedByProduction: false,
    shadowAdapter: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      sourcePlan: "v2_base_plan",
      adapter: "v2_base_plan_to_projection_plan_view",
      productionProjectionRerun: false,
      writesSeed: false,
      writesRuntime: false,
      writesReceipts: false,
      limitations: ["diagnostic_only"],
    },
    comparedPlans: {
      v2BasePlanAvailable: true,
      shadowConsumedPlanAvailable: true,
      plannerOnlyNoRepairAvailable: true,
      repairedPlanAvailable: true,
    },
    interpretationRules: {
      shadowConsumptionIsDiagnosticOnly: true,
      repairedPlanIsEvidenceNotTarget: true,
      noRepairOutputShowsCurrentPlannerBeforeRepair: true,
      differencesFromRepairedPlanDoNotImplyV2Wrong: true,
    },
    summary: {
      shadowTotalSets: 66,
      v2BaseTotalSets: 66,
      noRepairTotalSets: 58,
      repairedTotalSets: 69,
      currentRepairDependencyCount: 72,
      shadowRemainingRepairDependencyCount: 0,
      repairDependencyDelta: -72,
      improvementCount: 13,
      preservationCount: 22,
      regressionCount: 0,
      unclearCount: 1,
      notComparableCount: 0,
      categorizedIdentityDifferenceCount: 4,
    },
    changes: {} as NonNullable<
      MesocycleExplainPlannerOnlyNoRepair["v2BasePlanShadowConsumptionTrial"]
    >["changes"],
    blockersBeforeBehaviorPromotion: [
      "production_projection_not_consuming_shadow",
      "accepted_seed_runtime_consumption_gate_not_changed",
    ],
    nextSafeAction: "inspect_shadow_consumption",
    guardrails: {
      doesNotUseHistoricalStrategyRecommendations: true,
      doesNotTreatRepairedPlanAsTargetPolicy: true,
      doesNotFeedProductionProjection: true,
      doesNotAffectGeneration: true,
      doesNotAffectSelectionV2: true,
      doesNotAffectRepair: true,
      doesNotAffectSeedSerialization: true,
      doesNotAffectRuntimeReplay: true,
      doesNotAffectReceipts: true,
      doesNotPersistV2Output: true,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
    },
    ...overrides,
  };
}

function noRepairFixture(
  overrides: Partial<MesocycleExplainPlannerOnlyNoRepair> = {},
): MesocycleExplainPlannerOnlyNoRepair {
  return {
    enabled: true,
    readOnly: true,
    affectsScoringOrGeneration: false,
    canReplaceRepairedProjection: false,
    summary: {
      status: "pass",
      targetLanesSatisfied: 8,
      targetLanesMissing: 0,
      unresolvedDemandCount: 0,
      validationFailureCount: 0,
    },
    acceptanceClassification: {
      basicMesocycleShapeStatus: "pass",
      replacementReadinessStatus: "not_ready",
      hardBlockers: [],
      qualityWarnings: [],
      diagnosticOnly: [],
      sessionShaping: [],
      migrationScoreboard: {
        materialRepairCount: 0,
        majorRepairCount: 0,
        suspiciousRepairs: 0,
        canReplaceRepairedProjection: false,
        reason: "read_only_benchmark",
      },
    },
    v2MesocycleStrategyDiagnostic: {} as MesocycleExplainPlannerOnlyNoRepair["v2MesocycleStrategyDiagnostic"],
    strategyToDemandProjection: {} as MesocycleExplainPlannerOnlyNoRepair["strategyToDemandProjection"],
    crossWeekProjectionGate: {} as MesocycleExplainPlannerOnlyNoRepair["crossWeekProjectionGate"],
    v2MesocyclePlan: {} as MesocycleExplainPlannerOnlyNoRepair["v2MesocyclePlan"],
    v2DeloadProjectionDiagnostic: {} as MesocycleExplainPlannerOnlyNoRepair["v2DeloadProjectionDiagnostic"],
    v2TargetVsNoRepairDiff: {
      summary: {
        targetLaneCount: 8,
        satisfiedLaneCount: 8,
        partialLaneCount: 0,
        missingLaneCount: 0,
        blockedLaneCount: 0,
        repairDependentLaneCount: 0,
        migrationCandidateCount: 0,
        suspiciousOrBlockedCount: 0,
      },
      slotDiffs: [],
      replacementReadinessImpact: {
        canReplaceRepairedProjection: false,
        blockers: [],
        nextBestMigrationSlice: null,
      },
    } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2TargetVsNoRepairDiff"],
    v2SetDistributionIntent: {} as MesocycleExplainPlannerOnlyNoRepair["v2SetDistributionIntent"],
    v2SupportLanePolicy: {} as MesocycleExplainPlannerOnlyNoRepair["v2SupportLanePolicy"],
    v2SupportLaneProjectionDiagnostic: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        directFloorsMet: 4,
        directFloorsBelow: 0,
        authoredDroppedCount: 0,
        highRiskDroppedCount: 0,
      },
      laneBoundaryRows: [],
      missingInputs: [],
    } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2SupportLaneProjectionDiagnostic"],
    v2SelectionCapacityPlanDiagnostic: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        blockerCount: 0,
        capacityPressureCount: 0,
        capAwareExpansionNeededCount: 0,
        optionalSuppressedCount: 0,
      },
      missingInputs: [],
    } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2SelectionCapacityPlanDiagnostic"],
    plannerOwnedAccumulationProjection: {} as MesocycleExplainPlannerOnlyNoRepair["plannerOwnedAccumulationProjection"],
    v2ExerciseSelectionPlanDiagnostic: {
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        blockedLaneCount: 0,
        duplicateRequiresJustificationCount: 0,
        concentrationWarningCount: 0,
      },
      weeks: [],
      missingInputs: [],
    } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2ExerciseSelectionPlanDiagnostic"],
    v2LaneSelectionIntentAudit: laneSelectionIntentAuditFixture(),
    lowAxialHipExtensionLimitation: {} as MesocycleExplainPlannerOnlyNoRepair["lowAxialHipExtensionLimitation"],
    v2BasePlanCompare: pureV2BasePlanCompareFixture(),
    slotPlans: [],
    weeklyMuscleTotals: [
      {
        muscle: "Chest",
        projectedEffectiveSets: 10,
        targetMin: 8,
        targetPreferred: 12,
        status: "within",
      },
    ],
    setAllocationChanges: [],
    weeklyMuscleTotalChanges: [],
    acceptanceChecks: [],
    acceptanceFailures: [],
    qualityWarnings: [],
    diagnosticRows: [],
    ignoredRows: [],
    repairDependenciesDisabled: [],
    ...overrides,
  };
}

function measuredSlotWeekAcceptanceProjectionFixture(
  overrides: Partial<
    NonNullable<
      MesocycleExplainPlannerOnlyNoRepair["v2ConcentrationMaterializerProjection"]
    >
  > = {},
): NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["v2ConcentrationMaterializerProjection"]
> {
  const rows = [2, 3, 4].map((week) => ({
    week,
    phase: "accumulation",
    status: "improved",
    source: {
      slotId: "lower_a",
      laneId: "calves",
      scopedLaneId: "lower_a:calves",
      muscles: ["Calves"],
      baselineSetCount: 4,
      trialSetCount: 3,
      setDelta: -1,
    },
    donor: {
      slotId: "lower_b",
      laneId: "calves",
      scopedLaneId: "lower_b:calves",
      muscles: ["Calves"],
      baselineSetCount: 4,
      trialSetCount: 5,
      setDelta: 1,
    },
    allocationPolicyTrial: null,
    protectedCoverageImpact: {
      protectedMuscles: ["Calves"],
      sourceFloorSets: 3,
      sourceBeforeSets: 4,
      sourceAfterSets: 3,
      sourceSetDelta: -1,
      donorSetDelta: 1,
      netWeeklySetDelta: 0,
      status: "preserved",
      blockers: [],
    },
    materializerDelta: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      regressions: [],
      changedSlotCount: 0,
    },
    concentrationWarningDelta: -1,
    regressionCauses: [],
    primaryDonorCandidate: null,
    alternateDonorCandidates: [],
    selectedDonorKind: "alternate",
    acceptanceTrainabilityStatus: "pass",
    behaviorReadinessDecision: "candidate_for_acceptance_projection",
    blockers: [],
    nextSafeSlice: "run_acceptance_non_regression_projection",
  }));

  return {
    version: 1,
    source: "v2_concentration_materializer_projection",
    readOnly: true,
    affectsScoringOrGeneration: false,
    dryRunOnly: true,
    consumedByProduction: false,
    consumedByDemandOrMaterializer: false,
    status: "projected_with_limitations",
    projectionMode: "concentration_set_cap_shadow_materializer_dry_run",
    trialId: "lower_a_calves_slot_week_allocation_acceptance_projection",
    comparedPlans: {
      baselineAvailable: true,
      trialAvailable: true,
      inventoryExerciseCount: 12,
    },
    targetLane: {
      scopedLaneId: "lower_a:calves",
      week: 2,
      slotId: "lower_a",
      laneId: "calves",
      muscles: ["Calves"],
      warningEvidence: ["concentration:Calves:over_50_percent"],
      currentBudget: { min: 3, preferred: 4, max: 4 },
      trialBudget: { min: 3, preferred: 3, max: 3 },
      baselineExerciseCount: 1,
      trialExerciseCount: 1,
      baselineSetCount: 4,
      trialSetCount: 3,
      addedIdentities: [],
      removedIdentities: [],
    },
    materializer: {
      baselineStatus: "materialized",
      trialStatus: "materialized",
      baselineBlockerCount: 0,
      trialBlockerCount: 0,
      baselineSeedShapeCompatible: true,
      trialSeedShapeCompatible: true,
    },
    candidateImpact: {
      selectedIdentityDelta: 0,
      totalSetDelta: 0,
      targetLaneSetDelta: -1,
      targetLaneExerciseDelta: 0,
      materializerBlockerDelta: 0,
      regressionCount: 0,
      regressions: [],
      improvements: ["concentration_warning_reduced"],
      changedSlotCount: 0,
      changedSlots: [],
    },
    concentrationDelta: {
      baselineWarningCount: 3,
      trialWarningCount: 0,
      warningDelta: -3,
      baselineOver60Count: 3,
      trialOver60Count: 0,
      over60Delta: -3,
      baselineMaxSharePercent: 66.7,
      trialMaxSharePercent: 50,
      maxShareDelta: -16.7,
      baselineHighFatigueSetCount: 12,
      trialHighFatigueSetCount: 9,
      highFatigueSetDelta: -3,
      baselineFatigueWeightedSets: 36,
      trialFatigueWeightedSets: 27,
      fatigueWeightedSetDelta: -9,
    },
    donorOffsetRedistributionProjection: {
      version: 1,
      source: "v2_concentration_donor_offset_redistribution_projection",
      readOnly: true,
      affectsScoringOrGeneration: false,
      dryRunOnly: true,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
      status: "projected_with_limitations",
      projectionMode:
        "source_lane_cap_with_slot_owned_donor_offset_shadow_materializer_dry_run",
      sourceAttribution: {
        sourceLane: "pure_v2_materializer_projection",
        donorSelection: "SlotDemandAllocationByWeek",
        materializerProjection: "baseline_vs_donor_offset_trial_dry_run",
        noRepairProjection: "not_used_as_target_policy",
        repairedProjection: "evidence_only_not_target_policy",
        acceptanceNoRepair: "week_1_trainability_shape_only",
      },
      summary: {
        projectedWeekCount: 3,
        improvedWeekCount: 3,
        noImpactWeekCount: 0,
        blockedWeekCount: 0,
        protectedCoveragePassCount: 3,
        materializerRegressionCount: 0,
        concentrationRegressionCount: 0,
        regressionCauseCounts: {},
        totalSetDelta: 0,
        concentrationWarningDelta: -3,
        alternateCandidateCount: 3,
        alternatePassingCandidateCount: 3,
        selectedAlternateWeekCount: 3,
        acceptanceTrainabilityStatus: "pass",
        behaviorReadinessDecision: "candidate_for_acceptance_projection",
        blockerCount: 0,
        nextSafeSlice: "run_acceptance_non_regression_projection",
        slotWeekAllocationReadiness: "candidate_for_acceptance_projection",
        slotWeekAllocationNextSafeSlice:
          "run_acceptance_non_regression_projection",
        slotWeekAllocationBlockedRowCount: 0,
      },
      slotWeekAllocationProjection: {
        version: 1,
        source: "v2_slot_week_donor_capacity_projection",
        readOnly: true,
        affectsScoringOrGeneration: false,
        consumedByDemandOrMaterializer: false,
        status: "available",
        designDecision: {
          policy:
            "only_relieve_concentration_when_slot_owned_donor_absorbs_required_sets",
          requireMeasuredDonorAbsorption: true,
          requireNetWeeklyVolumePreserved: true,
          requireProtectedCoveragePreserved: true,
          requireMaterializerNonRegression: true,
        },
        summary: {
          rowCount: 3,
          passingRowCount: 3,
          blockedRowCount: 0,
          eligibleDonorSlotCount: 3,
          measuredDonorCapacityPassCount: 3,
          measuredDonorCapacityFailCount: 0,
          measuredDonorCapacityUnderAbsorptionCount: 0,
          measuredDonorCapacityOverAbsorptionCount: 0,
          protectedCoverageRegressionCount: 0,
          materializerRegressionCount: 0,
          netWeeklySetDelta: 0,
          behaviorReadiness: "candidate_for_acceptance_projection",
          nextSafeSlice: "run_acceptance_non_regression_projection",
        },
        rows: rows.map((row) => ({
          week: row.week,
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
        })),
        limitations: ["test_fixture_compact"],
      },
      rows,
      blockersBeforeBehavior: [],
      limitations: ["read_only_donor_offset_materializer_dry_run_only"],
      safeForBehaviorPromotion: false,
    },
    crossWeekReadiness: {
      decision: "candidate_for_bounded_policy_design",
      sourceAttribution: {
        pureV2BasePlan: "not_evaluated_by_concentration_projection",
        materializerProjection: "baseline_vs_trial_dry_run",
        noRepairProjection:
          "selected_warning_from_exercise_selection_diagnostic",
        repairedProjection: "evidence_only_not_target_policy",
        acceptanceNoRepair: "week_1_trainability_shape_only",
      },
      representativeAccumulationWeeks: [2, 3, 4],
      projectedWeekCount: 3,
      improvedWeekCount: 3,
      regressedWeekCount: 0,
      noImpactWeekCount: 0,
      blockerCount: 0,
      nextSafeSlice: "run_acceptance_non_regression_projection",
      gates: [],
      rows: [],
    },
    blockersBeforeBehavior: [],
    nextSafeAction: "run_read_only_acceptance_projection",
    limitations: ["read_only_materializer_dry_run_only"],
    safeForBehaviorPromotion: false,
    ...overrides,
  } as unknown as NonNullable<
    MesocycleExplainPlannerOnlyNoRepair["v2ConcentrationMaterializerProjection"]
  >;
}

describe("V2 plan quality benchmark", () => {
  it("keeps the exact slot/week allocation trial accepted with watch items while lane intent remains diagnostic", () => {
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        v2ConcentrationMaterializerProjection:
          measuredSlotWeekAcceptanceProjectionFixture(),
      }),
    );

    expect(result.summary).toMatchObject({
      passCount: 8,
      warningCount: 1,
      failCount: 0,
      missingEvidenceCount: 0,
      slotWeekAllocationReadiness: "candidate_for_acceptance_projection",
      slotWeekAllocationBlockedRowCount: 0,
      slotWeekAllocationNextSafeSlice:
        "run_acceptance_non_regression_projection",
    });
    expect(result.slotWeekAllocationAcceptanceProjection).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      candidateSource: "SlotDemandAllocationByWeek",
      evidenceSource:
        "v2_plan_quality_benchmark_and_donor_offset_materializer_projection",
      representativeAccumulationWeeks: [2, 3, 4],
      decision: "accepted_with_watch_items",
      protectedVolumeCoverage: {
        status: "pass",
        projectedWeekCount: 3,
        protectedCoveragePassCount: 3,
        blockedRowCount: 0,
        netWeeklySetDelta: 0,
      },
      materializerNonRegression: {
        status: "pass",
        totalSetDelta: 0,
        materializerBlockerDelta: 0,
        regressionCount: 0,
      },
      nonConsumption: {
        seedRuntimeReceiptDbConsumed: false,
        productionMaterializerConsumed: false,
        acceptanceThresholdChanged: false,
        persistenceChanged: false,
      },
    });
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance.blockers,
    ).toEqual([]);
  });

  it("accepts the exact slot/week allocation trial with watch items when non-regression passes but benchmark warnings remain", () => {
    const baseCompare = pureV2BasePlanCompareFixture();
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        acceptanceClassification: {
          ...noRepairFixture().acceptanceClassification,
          basicMesocycleShapeStatus: "pass_with_warnings",
          qualityWarnings: [{ code: "duplicate_family_watch", evidence: [] }],
        },
        v2BasePlanCompare: pureV2BasePlanCompareFixture({
          comparisons: {
            ...baseCompare.comparisons,
            exerciseIdentity: {
              ...baseCompare.comparisons.exerciseIdentity,
              duplicateClassFamilies: {
                v2Base: ["calf_raise"],
                plannerOnlyNoRepair: [],
                repairedPlan: [],
              },
            },
          },
        }),
        v2ConcentrationMaterializerProjection:
          measuredSlotWeekAcceptanceProjectionFixture(),
      }),
    );

    expect(result.slotWeekAllocationAcceptanceProjection).toMatchObject({
      decision: "accepted_with_watch_items",
      week1Trainability: {
        status: "pass_with_warnings",
        hardBlockerCount: 0,
        qualityWarningCount: 1,
      },
      duplicateConcentrationRisk: {
        status: "watch",
        duplicateConcentrationGateStatus: "warning",
      },
      acceptance: {
        nextSafeSlice: "bounded_behavior_promotion_review",
        blockers: [],
      },
    });
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance.watchItems,
    ).toEqual(
      expect.arrayContaining([
        "duplicate_concentration_risk:v2_base_plan_validation.duplicate_distinctness",
        "week_1_trainability:pass_with_warnings",
        "week_1_quality:duplicate_family_watch",
      ]),
    );
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance
        .classificationCounts,
    ).toEqual({
      acceptedWatch: 3,
      boundedOwnerWatch: 2,
      blocker: 0,
      staleOrDiagnosticNoise: 0,
      ownerSpecificNextFix: 0,
    });
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance
        .itemClassifications,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "week_1_quality:duplicate_family_watch",
          classification: "accepted_watch",
          evidenceSource: "acceptance_classification_no_repair",
          mustFixBeforeWeek1: false,
        }),
        expect.objectContaining({
          item: "duplicate_concentration_risk:v2_base_plan_validation.duplicate_distinctness",
          classification: "bounded_owner_watch",
          ownerSeam: "v2_base_plan_validation.duplicate_distinctness",
        }),
      ]),
    );
  });

  it("classifies diagnostic-only shadow ambiguity as stale/noise instead of a blocker", () => {
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        v2BasePlanShadowConsumptionTrial: pureV2ShadowTrialFixture({
          summary: {
            ...pureV2ShadowTrialFixture().summary,
            regressionCount: 0,
            unclearCount: 2,
          },
        }),
        v2ConcentrationMaterializerProjection:
          measuredSlotWeekAcceptanceProjectionFixture(),
      }),
    );

    expect(result.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "lane_preservation",
          status: "warning",
          evidenceSource: "shadow_diagnostic",
          mustFixBeforeWeek1: false,
        }),
      ]),
    );
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance
        .itemClassifications,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "lane_preservation:v2_base_plan_shadow_consumption_trial",
          classification: "stale_or_diagnostic_noise",
          materiality:
            "diagnostic-only shadow ambiguity with no measured regression or production consumption",
          mustFixBeforeWeek1: false,
        }),
      ]),
    );
  });

  it("blocks the slot/week allocation acceptance projection on protected coverage or materializer regression", () => {
    const projection = measuredSlotWeekAcceptanceProjectionFixture();
    const donorOffset = projection.donorOffsetRedistributionProjection;
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        v2ConcentrationMaterializerProjection: {
          ...projection,
          donorOffsetRedistributionProjection: {
            ...donorOffset,
            summary: {
              ...donorOffset.summary,
              protectedCoveragePassCount: 2,
              materializerRegressionCount: 1,
              totalSetDelta: 1,
              slotWeekAllocationBlockedRowCount: 1,
            },
            slotWeekAllocationProjection: {
              ...donorOffset.slotWeekAllocationProjection,
              summary: {
                ...donorOffset.slotWeekAllocationProjection.summary,
                blockedRowCount: 1,
                materializerRegressionCount: 1,
                netWeeklySetDelta: 1,
              },
            },
            rows: donorOffset.rows.map((row, index) =>
              index === 0
                ? {
                    ...row,
                    protectedCoverageImpact: {
                      ...row.protectedCoverageImpact,
                      status: "regressed",
                      netWeeklySetDelta: 1,
                    },
                    materializerDelta: {
                      ...row.materializerDelta,
                      totalSetDelta: 1,
                      materializerBlockerDelta: 1,
                      regressionCount: 1,
                    },
                  }
                : row,
            ),
          },
        },
      }),
    );

    expect(result.slotWeekAllocationAcceptanceProjection).toMatchObject({
      decision: "blocked_by_acceptance_trainability_or_non_regression",
      protectedVolumeCoverage: {
        status: "fail",
        blockedRowCount: 1,
        netWeeklySetDelta: 1,
      },
      materializerNonRegression: {
        status: "fail",
        totalSetDelta: 1,
        materializerBlockerDelta: 1,
        regressionCount: 1,
      },
      acceptance: {
        nextSafeSlice: "fix_acceptance_or_non_regression_blockers",
      },
    });
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance.blockers,
    ).toEqual(
      expect.arrayContaining([
        "protected_volume_or_coverage_regressed",
        "materializer_identity_set_or_blocker_regression",
      ]),
    );
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance
        .classificationCounts.blocker,
    ).toBeGreaterThanOrEqual(2);
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance
        .itemClassifications,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "protected_volume_or_coverage_regressed",
          classification: "blocker",
          ownerSeam: "SlotDemandAllocationByWeek",
        }),
        expect.objectContaining({
          item: "materializer_identity_set_or_blocker_regression",
          classification: "blocker",
          ownerSeam: "v2_materialization_dry_run",
        }),
      ]),
    );
  });

  it("marks acceptance hard blockers as must-fix before Week 1", () => {
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        acceptanceClassification: {
          ...noRepairFixture().acceptanceClassification,
          basicMesocycleShapeStatus: "fail",
          hardBlockers: [
            {
              code: "seed_shape_incompatible",
              evidence: ["week_1:seed_shape_incompatible"],
            },
          ],
        },
        v2ConcentrationMaterializerProjection:
          measuredSlotWeekAcceptanceProjectionFixture(),
      }),
    );

    expect(result.summary.mustFixBeforeWeek1Count).toBe(1);
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance
        .itemClassifications,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "week_1_trainability:seed_shape_incompatible",
          classification: "blocker",
          mustFixBeforeWeek1: true,
          ownerSeam: "plannerOnlyNoRepair.acceptanceClassification",
        }),
      ]),
    );
  });

  it("keeps the slot/week allocation acceptance projection diagnostic-only when projection or non-consumption evidence is missing", () => {
    const missingProjection = buildV2PlanQualityBenchmark(noRepairFixture());
    expect(
      missingProjection.slotWeekAllocationAcceptanceProjection,
    ).toMatchObject({
      decision: "diagnostic_only",
      acceptance: {
        nextSafeSlice: "collect_missing_acceptance_projection_evidence",
      },
    });

    const consumed = buildV2PlanQualityBenchmark(
      noRepairFixture({
        v2ConcentrationMaterializerProjection:
          measuredSlotWeekAcceptanceProjectionFixture({
            consumedByProduction: true,
          } as unknown as Partial<
            NonNullable<
              MesocycleExplainPlannerOnlyNoRepair["v2ConcentrationMaterializerProjection"]
            >
          >),
      }),
    );
    expect(consumed.slotWeekAllocationAcceptanceProjection).toMatchObject({
      decision: "diagnostic_only",
      acceptance: {
        blockers: expect.arrayContaining([
          "read_only_non_consumption_boundary_not_proven",
        ]),
      },
    });
    expect(JSON.stringify(consumed)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });

  it("surfaces first-principles gates from V2 candidate evidence without using repaired projection as target policy", () => {
    const result = buildV2PlanQualityBenchmark(noRepairFixture());

    expect(result).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      repairedProjectionUsedAs: "evidence_only_not_target_policy",
      status: "warning",
      deprecationReadiness: {
        status: "ready_for_review",
      },
      guardrails: {
        seedRuntimeChanged: false,
        productionMaterializerChanged: false,
        acceptanceThresholdChanged: false,
        persistenceChanged: false,
      },
    });
    expect(result.gates.map((row) => row.gate)).toEqual([
      "support_floors",
      "direct_work",
      "lane_preservation",
      "lane_intent_explicitness",
      "session_size",
      "fatigue_distribution",
      "duplicate_concentration_risk",
      "materializer_omissions",
      "week_1_trainability",
    ]);
    expect(result.summary.failCount).toBe(0);
    expect(result.summary.missingEvidenceCount).toBe(0);
    expect(result.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "lane_intent_explicitness",
          status: "warning",
          ownerSeam: "V2LaneSelectionIntentAudit",
          evidenceSource: "pure_v2_lane_selection_intent_audit",
          evidence: expect.arrayContaining([
            "laneJobs=7",
            "pass=6",
            "warning=1",
            "fail=0",
            "missing=0",
            "materializerConsumed=6",
            "diagnosticOnly=1",
            "low_axial_hip_extension:warning:lower_b:hinge_anchor:consumed=false",
            "lane_intent_benchmark_is_read_only",
            "lane_intent_evidence_does_not_change_materializer_ranking",
          ]),
          missingEvidence: [],
          mustFixBeforeWeek1: false,
        }),
      ]),
    );
  });

  it("fails closed when floors fail and materializer evidence is missing", () => {
    const fixture = noRepairFixture({
      weeklyMuscleTotals: [
        {
          muscle: "Chest",
          projectedEffectiveSets: 6,
          targetMin: 8,
          targetPreferred: 12,
          status: "below",
        },
      ],
      v2BasePlanCompare: undefined,
      v2BasePlanShadowConsumptionTrial: undefined,
      acceptanceClassification: {
        ...noRepairFixture().acceptanceClassification,
        basicMesocycleShapeStatus: "fail",
        hardBlockers: [{ code: "below_mev", evidence: ["Chest 6/8"] }],
      },
    });

    const result = buildV2PlanQualityBenchmark(fixture);

    expect(result.status).toBe("fail");
    expect(result.summary.failCount).toBeGreaterThan(0);
    expect(result.summary.missingEvidenceCount).toBeGreaterThan(0);
    expect(result.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "direct_work",
          status: "fail",
          mustFixBeforeWeek1: true,
        }),
        expect.objectContaining({
          gate: "materializer_omissions",
          status: "missing_evidence",
          candidateImpact: "needs_more_evidence",
        }),
      ]),
    );
    expect(result.deprecationReadiness.status).toBe("blocked");
  });

  it("uses pure V2 base-plan evidence to resolve stale no-repair support/direct failures without changing guardrails", () => {
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        weeklyMuscleTotals: [
          {
            muscle: "Side Delts",
            projectedEffectiveSets: 0,
            targetMin: 8,
            targetPreferred: 12,
            status: "below",
          },
        ],
        v2SupportLaneProjectionDiagnostic: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: {
            directFloorsMet: 0,
            directFloorsBelow: 4,
            authoredDroppedCount: 4,
            highRiskDroppedCount: 4,
          },
          laneBoundaryRows: [
            {
              mustFixBeforeWeek1: true,
              severity: "high_risk",
            },
          ],
          missingInputs: [],
        } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2SupportLaneProjectionDiagnostic"],
        v2TargetVsNoRepairDiff: {
          ...noRepairFixture().v2TargetVsNoRepairDiff,
          summary: {
            targetLaneCount: 8,
            satisfiedLaneCount: 4,
            partialLaneCount: 0,
            missingLaneCount: 2,
            blockedLaneCount: 1,
            repairDependentLaneCount: 0,
            migrationCandidateCount: 0,
            suspiciousOrBlockedCount: 3,
          },
        },
        v2BasePlanShadowConsumptionTrial: pureV2ShadowTrialFixture(),
      }),
    );

    expect(result.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "support_floors",
          status: "pass",
          ownerSeam: "v2_base_plan_validation.support_direct_floors",
        }),
        expect.objectContaining({
          gate: "direct_work",
          status: "pass",
          ownerSeam: "v2_base_plan_validation.muscle_coverage",
        }),
        expect.objectContaining({
          gate: "lane_preservation",
          status: "warning",
          ownerSeam: "v2_base_plan_shadow_consumption_trial",
          candidateImpact: "needs_more_evidence",
        }),
      ]),
    );
    expect(result.summary.failCount).toBe(0);
    expect(result.summary.warningCount).toBeGreaterThan(0);
    expect(result.guardrails).toEqual({
      seedRuntimeChanged: false,
      productionMaterializerChanged: false,
      acceptanceThresholdChanged: false,
      persistenceChanged: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay/,
    );
  });

  it("source-attributes session size and duplicate risk to pure V2 before no-repair projection fallback", () => {
    const baseCompare = pureV2BasePlanCompareFixture();
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        v2BasePlanCompare: pureV2BasePlanCompareFixture({
          comparisons: {
            ...baseCompare.comparisons,
            slotShape: {
              ...baseCompare.comparisons.slotShape,
              classification: "unclear",
              rows: [
                ...baseCompare.comparisons.slotShape.rows,
                {
                  item: "total_weekly_sets",
                  classification: "unclear",
                  evidence: ["v2:66", "noRepair:58", "repaired:69"],
                },
              ],
            },
            exerciseIdentity: {
              ...baseCompare.comparisons.exerciseIdentity,
              classification: "v2_preserves",
              duplicateExactExercises: {
                v2Base: ["Standing Calf Raise"],
                plannerOnlyNoRepair: [
                  "Standing Calf Raise",
                  "Cable Lateral Raise",
                ],
                repairedPlan: [],
              },
            },
          },
        }),
        v2SelectionCapacityPlanDiagnostic: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: {
            blockerCount: 3,
            capacityPressureCount: 4,
            capAwareExpansionNeededCount: 2,
            optionalSuppressedCount: 1,
          },
          missingInputs: [],
        } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2SelectionCapacityPlanDiagnostic"],
        v2ExerciseSelectionPlanDiagnostic: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: {
            blockedLaneCount: 5,
            duplicateRequiresJustificationCount: 3,
            concentrationWarningCount: 2,
          },
          weeks: [],
          missingInputs: [],
        } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2ExerciseSelectionPlanDiagnostic"],
      }),
    );

    expect(result.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "session_size",
          status: "pass",
          ownerSeam: "v2_base_plan_validation.slot_shape",
          evidenceSource: "pure_v2_base_plan",
          evidence: expect.arrayContaining([
            "slotShapeClassification=unclear",
            "sessionSizeUnclearRows=none",
          ]),
        }),
        expect.objectContaining({
          gate: "duplicate_concentration_risk",
          status: "warning",
          ownerSeam: "v2_base_plan_validation.duplicate_distinctness",
          evidenceSource: "pure_v2_base_plan",
          candidateImpact: "needs_more_evidence",
          evidence: expect.arrayContaining([
            "watch:exact_duplicate_reuse_needs_variant_or_continuity_justification",
            "v2DuplicateExact:Standing Calf Raise",
          ]),
        }),
        expect.objectContaining({
          gate: "support_floors",
          status: "pass",
          evidenceSource: "pure_v2_base_plan",
        }),
        expect.objectContaining({
          gate: "direct_work",
          status: "pass",
          evidenceSource: "pure_v2_base_plan",
        }),
      ]),
    );
    expect(result.summary.failCount).toBe(0);
    expect(result.repairedProjectionUsedAs).toBe(
      "evidence_only_not_target_policy",
    );
    expect(result.guardrails).toEqual({
      seedRuntimeChanged: false,
      productionMaterializerChanged: false,
      acceptanceThresholdChanged: false,
      persistenceChanged: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });

  it("keeps session-size warning when pure V2 max-slot ambiguity exceeds the base cap", () => {
    const baseCompare = pureV2BasePlanCompareFixture();
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        v2BasePlanCompare: pureV2BasePlanCompareFixture({
          comparisons: {
            ...baseCompare.comparisons,
            slotShape: {
              ...baseCompare.comparisons.slotShape,
              classification: "unclear",
              v2Base: {
                ...baseCompare.comparisons.slotShape.v2Base,
                maxSlotSets: 22,
              },
              rows: [
                ...baseCompare.comparisons.slotShape.rows,
                {
                  item: "max_slot_sets",
                  classification: "unclear",
                  evidence: ["v2:22", "repaired:21"],
                },
              ],
            },
          },
        }),
      }),
    );

    expect(result.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "session_size",
          status: "warning",
          ownerSeam: "v2_base_plan_validation.slot_shape",
          evidence: expect.arrayContaining([
            "sessionSizeWatchSetCap=21",
            "sessionSizeUnclearRows=max_slot_sets",
          ]),
        }),
      ]),
    );
  });

  it("source-attributes fatigue warnings to exact no-repair diagnostic reasons", () => {
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        v2ExerciseSelectionPlanDiagnostic: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          status: "projected_with_limitations",
          summary: {
            weeksEvaluated: 1,
            lanesEvaluated: 2,
            preservedIdentityCount: 2,
            candidateAvailableCount: 2,
            missingCandidateCount: 0,
            classMismatchCount: 0,
            duplicateRequiresJustificationCount: 0,
            concentrationWarningCount: 1,
            blockedLaneCount: 0,
          },
          weeks: [
            {
              week: 1,
              phase: "entry_calibration",
              slots: [
                {
                  slotId: "upper_a",
                  lanes: [
                    {
                      laneId: "chest_anchor",
                      plannedClass: ["distinct_chest_press_or_fly"],
                      primaryMuscles: ["Chest"],
                      selectedIdentity: {
                        exerciseId: "incline-db-press",
                        exerciseName: "Incline DB Press",
                        sourceWeek: 1,
                        setCount: 5,
                      },
                      identityStatus: "preserved",
                      laneClassStatus: "matched",
                      setBudgetStatus: "within_budget",
                      duplicateStatus: "pass",
                      concentrationStatus: "quality_warning",
                      fatigueStatus: "quality_warning",
                      inventoryStatus: "available",
                      capacityStatus: "within_capacity",
                      cleanAlternatives: [],
                      unresolvedDemand: [],
                      evidenceRefs: ["concentration:Chest:50%"],
                    },
                    {
                      laneId: "row_anchor",
                      plannedClass: ["horizontal_pull_support"],
                      primaryMuscles: ["Upper Back"],
                      selectedIdentity: {
                        exerciseId: "t-bar-row",
                        exerciseName: "T-Bar Row",
                        sourceWeek: 1,
                        setCount: 4,
                      },
                      identityStatus: "preserved",
                      laneClassStatus: "matched",
                      setBudgetStatus: "within_budget",
                      duplicateStatus: "pass",
                      concentrationStatus: "pass",
                      fatigueStatus: "quality_warning",
                      inventoryStatus: "available",
                      capacityStatus: "within_capacity",
                      cleanAlternatives: [],
                      unresolvedDemand: [],
                      evidenceRefs: ["risk:systemic_fatigue"],
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
        } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2ExerciseSelectionPlanDiagnostic"],
      }),
    );

    expect(result.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "fatigue_distribution",
          status: "warning",
          ownerSeam: "v2ExerciseSelectionPlanDiagnostic",
          evidenceSource: "no_repair_projection",
          evidence: expect.arrayContaining([
            "fatigueWarnings=2",
            "fatigueWarningsFromConcentration=1",
            "fatigueWarningsWithFatigueOrCollateralEvidence=1",
            "fatigueWarning:week_1:upper_a:chest_anchor:concentration=quality_warning:duplicate=pass:identity=preserved:capacity=within_capacity",
            "no_repair_projection_not_pure_v2_policy",
            "concentration_quality_gap_requires_measured_projection_delta",
          ]),
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /slotPlanSeedJson|sessionDecisionReceipt|runtimeReplay|acceptedPlannerIntent/,
    );
  });

  it("uses measured concentration projection deltas instead of reporting missing concentration proof", () => {
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        v2ConcentrationMaterializerProjection: {
          version: 1,
          source: "v2_concentration_materializer_projection",
          readOnly: true,
          affectsScoringOrGeneration: false,
          dryRunOnly: true,
          consumedByProduction: false,
          consumedByDemandOrMaterializer: false,
          status: "projected_with_limitations",
          projectionMode: "concentration_set_cap_shadow_materializer_dry_run",
          trialId: "lower_a_squat_anchor_concentration_set_cap_shadow",
          comparedPlans: {
            baselineAvailable: true,
            trialAvailable: true,
            inventoryExerciseCount: 12,
          },
          targetLane: {
            scopedLaneId: "lower_a:squat_anchor",
            week: 1,
            slotId: "lower_a",
            laneId: "squat_anchor",
            muscles: ["Quads"],
            warningEvidence: ["concentration:Quads:over_50_percent"],
            currentBudget: { min: 3, preferred: 4, max: 4 },
            trialBudget: { min: 3, preferred: 3, max: 3 },
            baselineExerciseCount: 1,
            trialExerciseCount: 1,
            baselineSetCount: 4,
            trialSetCount: 3,
            addedIdentities: [],
            removedIdentities: [],
          },
          materializer: {
            baselineStatus: "materialized",
            trialStatus: "materialized",
            baselineBlockerCount: 0,
            trialBlockerCount: 0,
            baselineSeedShapeCompatible: true,
            trialSeedShapeCompatible: true,
          },
          candidateImpact: {
            selectedIdentityDelta: 0,
            totalSetDelta: -1,
            targetLaneSetDelta: -1,
            targetLaneExerciseDelta: 0,
            materializerBlockerDelta: 0,
            regressionCount: 0,
            regressions: [],
            improvements: ["target_lane_sets_reduced:1"],
            changedSlotCount: 1,
            changedSlots: [
              {
                slotId: "lower_a",
                exerciseCountDelta: 0,
                setDelta: -1,
                addedIdentityCount: 0,
                removedIdentityCount: 0,
              },
            ],
          },
          concentrationDelta: {
            baselineWarningCount: 2,
            trialWarningCount: 2,
            warningDelta: 0,
            baselineOver60Count: 1,
            trialOver60Count: 1,
            over60Delta: 0,
            baselineMaxSharePercent: 66.7,
            trialMaxSharePercent: 60,
            maxShareDelta: -6.7,
            baselineHighFatigueSetCount: 4,
            trialHighFatigueSetCount: 3,
            highFatigueSetDelta: -1,
            baselineFatigueWeightedSets: 18,
            trialFatigueWeightedSets: 15,
            fatigueWeightedSetDelta: -3,
          },
          donorOffsetRedistributionProjection: {
            version: 1,
            source: "v2_concentration_donor_offset_redistribution_projection",
            readOnly: true,
            affectsScoringOrGeneration: false,
            dryRunOnly: true,
            consumedByProduction: false,
            consumedByDemandOrMaterializer: false,
            status: "projected_with_limitations",
            projectionMode:
              "source_lane_cap_with_slot_owned_donor_offset_shadow_materializer_dry_run",
            sourceAttribution: {
              sourceLane: "pure_v2_materializer_projection",
              donorSelection: "SlotDemandAllocationByWeek",
              materializerProjection:
                "baseline_vs_donor_offset_trial_dry_run",
              noRepairProjection: "not_used_as_target_policy",
              repairedProjection: "evidence_only_not_target_policy",
              acceptanceNoRepair: "week_1_trainability_shape_only",
            },
            summary: {
              projectedWeekCount: 3,
              improvedWeekCount: 3,
              noImpactWeekCount: 0,
              blockedWeekCount: 0,
              protectedCoveragePassCount: 3,
              materializerRegressionCount: 0,
              concentrationRegressionCount: 0,
              regressionCauseCounts: {},
              totalSetDelta: 0,
              concentrationWarningDelta: -3,
              alternateCandidateCount: 3,
              alternatePassingCandidateCount: 3,
              selectedAlternateWeekCount: 3,
              acceptanceTrainabilityStatus: "pass_with_warnings",
              behaviorReadinessDecision: "candidate_for_acceptance_projection",
              blockerCount: 4,
              nextSafeSlice: "run_acceptance_non_regression_projection",
              slotWeekAllocationReadiness: "candidate_for_acceptance_projection",
              slotWeekAllocationNextSafeSlice:
                "run_acceptance_non_regression_projection",
              slotWeekAllocationBlockedRowCount: 0,
            },
            slotWeekAllocationProjection: {
              version: 1,
              source: "v2_slot_week_donor_capacity_projection",
              readOnly: true,
              affectsScoringOrGeneration: false,
              consumedByDemandOrMaterializer: false,
              status: "available",
              designDecision: {
                policy:
                  "only_relieve_concentration_when_slot_owned_donor_absorbs_required_sets",
                requireMeasuredDonorAbsorption: true,
                requireNetWeeklyVolumePreserved: true,
                requireProtectedCoveragePreserved: true,
                requireMaterializerNonRegression: true,
              },
              summary: {
                rowCount: 1,
                passingRowCount: 1,
                blockedRowCount: 0,
                eligibleDonorSlotCount: 1,
                measuredDonorCapacityPassCount: 1,
                measuredDonorCapacityFailCount: 0,
                measuredDonorCapacityUnderAbsorptionCount: 0,
                measuredDonorCapacityOverAbsorptionCount: 0,
                protectedCoverageRegressionCount: 0,
                materializerRegressionCount: 0,
                netWeeklySetDelta: 0,
                behaviorReadiness: "candidate_for_acceptance_projection",
                nextSafeSlice: "run_acceptance_non_regression_projection",
              },
              rows: [],
              limitations: ["test_fixture_compact"],
            },
            rows: [
              {
                week: 2,
                phase: "accumulation",
                status: "improved",
                source: {
                  slotId: "lower_a",
                  laneId: "squat_anchor",
                  scopedLaneId: "lower_a:squat_anchor",
                  muscles: ["Quads"],
                  baselineSetCount: 4,
                  trialSetCount: 3,
                  setDelta: -1,
                },
                donor: {
                  slotId: "lower_b",
                  laneId: "quad_support",
                  scopedLaneId: "lower_b:quad_support",
                  muscles: ["Quads"],
                  baselineSetCount: 2,
                  trialSetCount: 3,
                  setDelta: 1,
                },
                allocationPolicyTrial: null,
                protectedCoverageImpact: {
                  protectedMuscles: ["Quads"],
                  sourceFloorSets: 3,
                  sourceBeforeSets: 4,
                  sourceAfterSets: 3,
                  sourceSetDelta: -1,
                  donorSetDelta: 1,
                  netWeeklySetDelta: 0,
                  status: "preserved",
                  blockers: [],
                },
                materializerDelta: {
                  selectedIdentityDelta: 0,
                  totalSetDelta: 0,
                  materializerBlockerDelta: 0,
                  regressionCount: 0,
                  regressions: [],
                  changedSlotCount: 0,
                },
                concentrationWarningDelta: -1,
                regressionCauses: [],
                primaryDonorCandidate: null,
                alternateDonorCandidates: [],
                selectedDonorKind: "alternate",
                acceptanceTrainabilityStatus: "pass_with_warnings",
                behaviorReadinessDecision:
                  "candidate_for_acceptance_projection",
                blockers: [
                  "acceptance_gate_not_rerun_for_donor_offset_projection",
                ],
                nextSafeSlice: "run_acceptance_non_regression_projection",
              },
            ],
            blockersBeforeBehavior: [
              "acceptance_gate_not_rerun_for_donor_offset_projection",
              "production_slot_demand_allocation_unchanged",
              "production_set_distribution_intent_unchanged",
              "production_materializer_not_consuming_donor_offset_projection",
            ],
            limitations: ["read_only_donor_offset_materializer_dry_run_only"],
            safeForBehaviorPromotion: false,
          },
          crossWeekReadiness: {
            decision: "candidate_for_bounded_policy_design",
            sourceAttribution: {
              pureV2BasePlan: "not_evaluated_by_concentration_projection",
              materializerProjection: "baseline_vs_trial_dry_run",
              noRepairProjection:
                "selected_warning_from_exercise_selection_diagnostic",
              repairedProjection: "evidence_only_not_target_policy",
              acceptanceNoRepair: "week_1_trainability_shape_only",
            },
            representativeAccumulationWeeks: [2, 3, 4],
            projectedWeekCount: 3,
            improvedWeekCount: 3,
            regressedWeekCount: 0,
            noImpactWeekCount: 0,
            blockerCount: 1,
            nextSafeSlice: "run_acceptance_non_regression_projection",
            gates: [
              {
                gateId: "cross_week_coverage",
                status: "pass",
                measured: true,
                ownerSeam: "v2_concentration_materializer_projection",
                evidenceSource: "pure_v2_materializer_projection",
                evidence: ["projectedWeekCount=3"],
                blockers: [],
                requiredNextEvidence: [],
              },
              {
                gateId: "redistribution_donor_offset",
                status: "pass",
                measured: true,
                ownerSeam: "SlotDemandAllocationByWeek",
                evidenceSource: "pure_v2_base_plan",
                evidence: ["donorProjectionStatus=projected_with_limitations"],
                blockers: [],
                requiredNextEvidence: [],
              },
              {
                gateId: "acceptance_or_week_1_trainability",
                status: "unknown",
                measured: true,
                ownerSeam: "plannerOnlyNoRepair.acceptanceClassification",
                evidenceSource: "acceptance_classification_no_repair",
                evidence: ["acceptanceNeedsRerun=true"],
                blockers: [
                  "read_only_acceptance_projection_not_rerun_for_trial",
                ],
                requiredNextEvidence: [
                  "candidate_evaluator_or_acceptance_result_for_projected_trial",
                ],
              },
            ],
            rows: [
              {
                week: 2,
                phase: "accumulation",
                scopedLaneId: "lower_a:squat_anchor",
                status: "improved",
                evidenceSource: "pure_v2_materializer_projection",
                baselineMaterializerStatus: "materialized",
                trialMaterializerStatus: "materialized",
                selectedIdentityDelta: 0,
                totalSetDelta: -1,
                targetLaneSetDelta: -1,
                materializerBlockerDelta: 0,
                warningDelta: -1,
                maxShareDelta: -6.7,
                highFatigueSetDelta: -1,
                regressionCount: 0,
                changedSlotCount: 1,
              },
            ],
          },
          blockersBeforeBehavior: [
            "acceptance_gate_not_rerun",
            "production_slot_demand_allocation_unchanged",
            "production_set_distribution_intent_unchanged",
            "production_materializer_not_consuming_trial",
          ],
          nextSafeAction: "run_read_only_acceptance_projection",
          limitations: ["read_only_materializer_dry_run_only"],
          safeForBehaviorPromotion: false,
        },
        v2ExerciseSelectionPlanDiagnostic: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          status: "projected_with_limitations",
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
              phase: "entry_calibration",
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
        } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2ExerciseSelectionPlanDiagnostic"],
      }),
    );

    expect(result.gates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "fatigue_distribution",
          status: "warning",
          ownerSeam: "v2_concentration_materializer_projection",
          evidenceSource: "pure_v2_materializer_projection",
          evidence: expect.arrayContaining([
            "concentrationProjectionStatus=projected_with_limitations",
            "crossWeekReadiness=candidate_for_bounded_policy_design",
            "crossWeekProjectedWeeks=3",
            "crossWeekImprovedWeeks=3",
            "readinessBlockers=1",
            "concentrationWarningDelta=0",
            "behaviorReadiness=candidate_for_bounded_policy_design",
            "behaviorBlockers=4",
            "promotionGateMissing:acceptance_gate_not_rerun",
            "promotionGateMissing:production_materializer_not_consuming_trial",
            "promotionGateMissing:production_set_distribution_intent_unchanged",
            "promotionGateMissing:production_slot_demand_allocation_unchanged",
            "concentrationMaxShareDelta=-6.7",
            "highFatigueSetDelta=-1",
            "targetLaneSetDelta=-1",
            "materializerBlockerDelta=0",
            "nextSafeSlice=run_acceptance_non_regression_projection",
            "donorOffsetStatus=projected_with_limitations",
            "donorOffsetReadiness=candidate_for_acceptance_projection",
            "donorOffsetProjectedWeeks=3",
            "donorOffsetWarningDelta=-3",
            "donorOffsetMaterializerRegressions=0",
            "donorOffsetConcentrationRegressions=0",
            "donorOffsetAlternateCandidates=3",
            "donorOffsetAlternatePassing=3",
            "slotWeekAllocationReadiness=candidate_for_acceptance_projection",
            "slotWeekAllocationBlockedRows=0",
            "slotWeekAllocationNextSafeSlice=run_acceptance_non_regression_projection",
            "donorOffsetNextSafeSlice=run_acceptance_non_regression_projection",
            "concentration_materializer_projection_is_diagnostic_only",
          ]),
          missingEvidence: expect.arrayContaining([
            "candidate_evaluator_or_acceptance_result_for_projected_trial",
          ]),
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(
      "concentration_quality_gap_requires_measured_projection_delta",
    );
  });

  it("classifies the promoted Calves 3/5 shape as idempotent bounded-owner evidence", () => {
    const promotedBaselineProjection = measuredSlotWeekAcceptanceProjectionFixture({
      targetLane: {
        scopedLaneId: "lower_a:calves",
        week: 1,
        slotId: "lower_a",
        laneId: "calves",
        muscles: ["Calves"],
        warningEvidence: [
          "concentration:Seated Calf Raise:Calves:50%",
          "readout_note:stale_calves_shortfall_suppressed_weekly_within_lane_satisfied",
        ],
        currentBudget: { min: 3, preferred: 4, max: 4 },
        trialBudget: { min: 3, preferred: 3, max: 3 },
        baselineExerciseCount: 1,
        trialExerciseCount: 1,
        baselineSetCount: 3,
        trialSetCount: 3,
        addedIdentities: [],
        removedIdentities: [],
      },
      candidateImpact: {
        selectedIdentityDelta: 0,
        totalSetDelta: 0,
        targetLaneSetDelta: 0,
        targetLaneExerciseDelta: 0,
        materializerBlockerDelta: 0,
        regressionCount: 0,
        regressions: [],
        improvements: [],
        changedSlotCount: 0,
        changedSlots: [],
      },
      concentrationDelta: {
        baselineWarningCount: 3,
        trialWarningCount: 3,
        warningDelta: 0,
        baselineOver60Count: 0,
        trialOver60Count: 0,
        over60Delta: 0,
        baselineMaxSharePercent: 50,
        trialMaxSharePercent: 50,
        maxShareDelta: 0,
        baselineHighFatigueSetCount: 0,
        trialHighFatigueSetCount: 0,
        highFatigueSetDelta: 0,
        baselineFatigueWeightedSets: 9,
        trialFatigueWeightedSets: 9,
        fatigueWeightedSetDelta: 0,
      },
      crossWeekReadiness: {
        decision: "candidate_for_bounded_policy_design",
        sourceAttribution: {
          pureV2BasePlan: "not_evaluated_by_concentration_projection",
          materializerProjection: "baseline_vs_trial_dry_run",
          noRepairProjection:
            "selected_warning_from_exercise_selection_diagnostic",
          repairedProjection: "evidence_only_not_target_policy",
          acceptanceNoRepair: "week_1_trainability_shape_only",
        },
        representativeAccumulationWeeks: [2, 3, 4],
        projectedWeekCount: 3,
        improvedWeekCount: 0,
        regressedWeekCount: 0,
        noImpactWeekCount: 3,
        blockerCount: 0,
        nextSafeSlice: "run_acceptance_non_regression_projection",
        gates: [],
        rows: [],
      },
      blockersBeforeBehavior: [
        "acceptance_gate_not_rerun",
        "production_materializer_not_consuming_trial",
      ],
      nextSafeAction: "run_read_only_acceptance_projection",
    });
    const result = buildV2PlanQualityBenchmark(
      noRepairFixture({
        v2ConcentrationMaterializerProjection: promotedBaselineProjection,
        v2ExerciseSelectionPlanDiagnostic: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          status: "projected_with_limitations",
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
              phase: "entry_calibration",
              slots: [
                {
                  slotId: "lower_a",
                  lanes: [
                    {
                      laneId: "calves",
                      plannedClass: ["calf_isolation"],
                      primaryMuscles: ["Calves"],
                      selectedIdentity: {
                        exerciseId: "seated-calf-raise",
                        exerciseName: "Seated Calf Raise",
                        sourceWeek: 1,
                        setCount: 4,
                      },
                      identityStatus: "class_mismatch",
                      laneClassStatus: "match",
                      setBudgetStatus: "within_preferred",
                      duplicateStatus: "pass",
                      concentrationStatus: "quality_warning",
                      fatigueStatus: "quality_warning",
                      inventoryStatus: "available",
                      capacityStatus: "within_capacity",
                      cleanAlternatives: [],
                      unresolvedDemand: [],
                      evidenceRefs: [
                        "concentration:Seated Calf Raise:Calves:50%",
                      ],
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
        } as unknown as MesocycleExplainPlannerOnlyNoRepair["v2ExerciseSelectionPlanDiagnostic"],
      }),
    );

    const fatigueGate = result.gates.find(
      (row) => row.gate === "fatigue_distribution",
    );
    expect(fatigueGate).toMatchObject({
      status: "warning",
      ownerSeam: "v2_concentration_materializer_projection",
      evidenceSource: "pure_v2_materializer_projection",
      evidence: expect.arrayContaining([
        "crossWeekReadiness=candidate_for_bounded_policy_design",
        "crossWeekImprovedWeeks=0",
        "concentrationWarningDelta=0",
        "promotedBoundedCalvesBaselineIdempotent=true",
        "promotedCalvesMuscle=Calves",
        "promotedCalvesSource=lower_a:calves:4->3",
        "promotedCalvesDonor=lower_b:calves:4->5",
        "promotedCalvesWeeks=2,3,4",
      ]),
    });
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance
        .itemClassifications,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gate: "fatigue_distribution",
          classification: "bounded_owner_watch",
          affected: expect.objectContaining({
            weeks: expect.arrayContaining([2, 3, 4]),
            slots: expect.arrayContaining(["lower_a", "lower_b"]),
            lanes: ["calves"],
            muscles: ["Calves"],
          }),
          materiality: expect.stringContaining(
            "promoted Calves slot allocation is idempotent baseline",
          ),
        }),
      ]),
    );
    expect(
      result.slotWeekAllocationAcceptanceProjection.acceptance
        .classificationCounts,
    ).toMatchObject({
      boundedOwnerWatch: 2,
      ownerSpecificNextFix: 0,
      blocker: 0,
    });
  });
});
