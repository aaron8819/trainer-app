import { describe, expect, it } from "vitest";
import type { MesocycleExplainPlannerOnlyNoRepair } from "./types";
import { buildV2PlanQualityBenchmark } from "./v2-plan-quality-benchmark";

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
    v2LaneSelectionIntentAudit: {} as MesocycleExplainPlannerOnlyNoRepair["v2LaneSelectionIntentAudit"],
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

describe("V2 plan quality benchmark", () => {
  it("passes first-principles gates from V2 candidate evidence without using repaired projection as target policy", () => {
    const result = buildV2PlanQualityBenchmark(noRepairFixture());

    expect(result).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      repairedProjectionUsedAs: "evidence_only_not_target_policy",
      status: "pass",
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
      "session_size",
      "fatigue_distribution",
      "duplicate_concentration_risk",
      "materializer_omissions",
      "week_1_trainability",
    ]);
    expect(result.summary.failCount).toBe(0);
    expect(result.summary.missingEvidenceCount).toBe(0);
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
        }),
        expect.objectContaining({
          gate: "duplicate_concentration_risk",
          status: "warning",
          ownerSeam: "v2_base_plan_validation.duplicate_distinctness",
          evidenceSource: "pure_v2_base_plan",
          candidateImpact: "needs_more_evidence",
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
});
