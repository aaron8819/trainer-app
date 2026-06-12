import { describe, expect, it } from "vitest";
import type { MesocycleExplainPlannerOnlyNoRepair } from "./types";
import { buildV2PlanQualityBenchmark } from "./v2-plan-quality-benchmark";

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
    v2BasePlanCompare: {
      status: "available",
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        v2RegressionCount: 0,
      },
    } as MesocycleExplainPlannerOnlyNoRepair["v2BasePlanCompare"],
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
});
