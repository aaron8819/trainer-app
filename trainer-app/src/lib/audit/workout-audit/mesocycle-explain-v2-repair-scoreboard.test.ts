import { describe, expect, it } from "vitest";
import { buildRepairPromotionScoreboard } from "./mesocycle-explain-v2-repair-scoreboard";
import type { MesocycleExplainProjectionDiagnostics } from "./types";

type PlanningReality = NonNullable<
  MesocycleExplainProjectionDiagnostics["planningReality"]
>;

function repairRow(
  overrides: Partial<
    PlanningReality["repairMaterialityAfterShadowAllocation"][number]
  > = {},
): PlanningReality["repairMaterialityAfterShadowAllocation"][number] {
  return {
    slotId: "upper_a",
    muscle: "Chest",
    exerciseName: "Cable Crossover",
    exerciseId: "ex-cable-crossover",
    action: "diagnostic_only",
    materiality: "none",
    repairMechanism: "diagnostic_readout",
    source: "planning_reality",
    rationale: "fixture",
    shadowAllocationBasis: "diagnostic_or_cap_cleanup",
    shadowRationale: ["fixture"],
    likelyAvoidableWithShadowAllocation: false,
    changedExerciseIdentity: false,
    rawSetDelta: 0,
    effectiveStimulusDelta: 0,
    effectiveStimulusAdded: 0,
    ...overrides,
  } as PlanningReality["repairMaterialityAfterShadowAllocation"][number];
}

describe("mesocycle explain V2 repair scoreboard", () => {
  it("classifies legacy repair paths by deprecation role without making deprecation executable", () => {
    const scoreboard = buildRepairPromotionScoreboard({
      repairMaterialityAfterShadowAllocation: [
        repairRow({
          action: "removed",
          materiality: "moderate",
          repairMechanism: "cap_trim",
          rawSetDelta: -2,
          effectiveStimulusDelta: -2,
        }),
        repairRow({
          action: "diagnostic_only",
          materiality: "none",
          repairMechanism: "legacy_repaired_artifact",
        }),
      ],
      suspiciousRepairsNotEligibleForPromotion: [],
      shadowRepairSummary: {
        materialRepairCount: 1,
        majorRepairCount: 0,
        likelyAvoidableMaterialRepairCount: 0,
        remainingMaterialRepairCount: 1,
        likelyAvoidableMajorRepairCount: 0,
        remainingMajorRepairCount: 0,
        likelyAvoidableByMuscle: {},
        remainingByMuscle: { Chest: 1 },
      },
    } as unknown as PlanningReality);

    const readiness = scoreboard?.interpretation.repairDeprecationReadiness;

    expect(readiness).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      deprecationIsExecutable: false,
      summary: {
        safetyNetCount: 1,
        obsoleteNoImpactCount: 1,
        readyForDeprecationReviewCount: 1,
      },
    });
    expect(readiness?.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "safety_net",
          readiness: "keep",
          count: 1,
        }),
        expect.objectContaining({
          role: "obsolete_no_impact",
          readiness: "ready_for_deprecation_review",
          count: 1,
        }),
        expect.objectContaining({
          role: "still_unproven",
          readiness: "needs_non_regression_proof",
        }),
      ]),
    );
  });

  it("classifies measured support-floor readout cleanup as no-impact evidence", () => {
    const scoreboard = buildRepairPromotionScoreboard(
      {
        repairMaterialityAfterShadowAllocation: [],
        suspiciousRepairsNotEligibleForPromotion: [],
        shadowRepairSummary: {
          materialRepairCount: 0,
          majorRepairCount: 0,
          likelyAvoidableMaterialRepairCount: 0,
          remainingMaterialRepairCount: 0,
          likelyAvoidableMajorRepairCount: 0,
          remainingMajorRepairCount: 0,
          likelyAvoidableByMuscle: {},
          remainingByMuscle: {},
        },
      } as unknown as PlanningReality,
      {
        weeklyMuscleTotals: [],
        slotPlans: [],
        v2MesocyclePlan: {},
        v2SetDistributionIntent: {},
        v2TargetVsNoRepairDiff: { slotDiffs: [] },
        v2ExerciseSelectionPlanDiagnostic: {
          summary: {
            blockedLaneCount: 0,
            classMismatchCount: 0,
          },
          weeks: [],
        },
        v2SupportLaneProjectionDiagnostic: {
          summary: {
            directFloorsMet: 0,
            directFloorsBelow: 1,
            authoredDroppedCount: 0,
            highRiskDroppedCount: 0,
          },
          missingInputs: [],
          muscles: [
            {
              muscle: "Side Delts",
              ownerSlots: ["upper_a"],
              directFloor: 4,
              preferredDirectSets: 4,
              currentDirectSets: 0,
              directFloorStatus: "below_floor",
              rationale: ["fixture_support_readout"],
            },
          ],
          laneBoundaryRows: [
            {
              week: 1,
              slotId: "upper_a",
              laneId: "side_delt_isolation",
              laneKind: "direct_floor",
              muscle: "Side Delts",
              status: "support_lane_preserved",
              severity: "warning",
              mustFixBeforeWeek1: false,
              likelyOwnerSeam: "none",
              supportPolicyAuthored: true,
              setDistributionBudgeted: true,
              exerciseSelectionPreserved: true,
              setBudget: { min: 4, preferred: 4, max: 4 },
              evidence: ["direct_floor_below_fixture"],
            },
          ],
        },
        v2SupportFloorMaterializerProjection: {
          trialId: "upper_a_side_delt_isolation_support_floor_shadow",
          status: "no_candidate_impact",
          consumedByProduction: false,
          consumedByDemandOrMaterializer: false,
          materializer: {
            baselineStatus: "valid",
            trialStatus: "valid",
            trialSeedShapeCompatible: true,
          },
          blockersBeforeBehavior: [],
          targetLane: {
            supportFloorGapId:
              "week_1:upper_a:side_delt_isolation:side_delts",
            currentBudget: { min: 4, preferred: 4, max: 4 },
            trialBudget: { min: 4, preferred: 4, max: 4 },
          },
          candidateImpact: {
            selectedIdentityDelta: 0,
            totalSetDelta: 0,
            targetLaneSetDelta: 0,
            targetLaneExerciseDelta: 0,
            materializerBlockerDelta: 0,
            regressionCount: 0,
          },
          nextSafeAction: "pivot_to_higher_roi_track",
        },
      } as unknown as Parameters<typeof buildRepairPromotionScoreboard>[1],
    );

    const supportInventory =
      scoreboard?.interpretation.supportFloorGapInventory;
    const selectedRow = supportInventory?.rows[0];

    expect(supportInventory?.summary).toMatchObject({
      gapRowCount: 1,
      diagnosticOnlyOrStaleCount: 1,
      measuredNoImpactCount: 1,
      staleNoiseCount: 0,
      trueOwnerSpecificGapCount: 0,
      blockerCount: 0,
      readoutClassificationCounts: {
        measured_no_impact: 1,
      },
    });
    expect(selectedRow).toMatchObject({
      supportFloorGapId: "week_1:upper_a:side_delt_isolation:side_delts",
      likelyOwnerSeam: "audit_readout_cleanup",
      evidenceQuality: "direct_floor_below",
      classification: "blocked_by_missing_evidence",
      readoutClassification: "measured_no_impact",
    });
    expect(scoreboard?.interpretation.selectedGapProof).toMatchObject({
      gapId: "support_direct_floor",
      proofResult: "measured_no_candidate_impact",
      classification: "diagnostic_only_no_impact",
      safeForBehaviorPromotion: false,
    });
  });
});
