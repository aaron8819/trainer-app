import { describe, expect, it } from "vitest";
import { buildV2DebugArtifacts } from "./v2-debug-artifacts";
import type { WorkoutAuditArtifact, WorkoutAuditRequest } from "./types";

describe("buildV2DebugArtifacts", () => {
  it("puts Side Delts strategy-row materializer detail in the materialization shard and compact counters in the index", () => {
    const artifact = {
      generatedAt: "2026-06-13T00:00:00.000Z",
      mesocycleExplain: {
        sourceMesocycleId: "meso-source",
        retrospectiveMesocycleId: "meso-retro",
        preview: {
          projectionDiagnostics: {},
        },
        plannerOnlyNoRepair: {
          summary: { status: "pass_with_warnings" },
          v2StrategyRowMaterializerProjection: {
            version: 1,
            source: "v2_strategy_row_materializer_projection",
            readOnly: true,
            affectsScoringOrGeneration: false,
            dryRunOnly: true,
            consumedByProduction: false,
            consumedByDemandOrMaterializer: false,
            status: "projected_with_limitations",
            projectionMode: "strategy_row_slot_allocation_materializer_dry_run",
            sourcePerformedEvidence: ["Side Delts:under_hit"],
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
              baselineAllocatedSets: { min: 2, preferred: 4, max: 4 },
              trialAllocatedSets: { min: 3, preferred: 5, max: 5 },
            },
            downstreamProjection: {
              classDistributionStatus: "measured",
              capacityPlanStatus: "measured",
              exerciseSelectionStatus: "measured",
              baselineClassLaneCount: 100,
              trialClassLaneCount: 100,
              baselineCapacityLaneCount: 100,
              trialCapacityLaneCount: 100,
              baselineSelectionLaneCount: 100,
              trialSelectionLaneCount: 100,
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
              evidence: [
                "baselineSetBudgetBasis=support_direct_floor",
                "trialSetBudgetBasis=support_direct_floor",
                "selectionSetBudgetDelta=0",
              ],
            },
            protectedCoverageLossCause: {
              classification: "not_measured",
              primaryCause: "target_lane_not_regressed",
              ownerSeam: "unknown",
              summary: "target lane did not lose materialized sets",
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
            readiness: "blocked",
            blockersBeforeBehavior: ["acceptance_gate_not_rerun"],
            remainingProofBeforeBehavior: [
              "read_only_acceptance_gate_result_for_projected_candidate",
            ],
            nextSafeSlice: "keep_blocked_until_owner_donor_or_acceptance_proof",
            nonConsumption: {
              demandOrMaterializer: false,
              seedRuntimeReceiptDb: false,
              acceptanceThreshold: false,
            },
            limitations: ["read_only_materializer_dry_run_only"],
            safeForBehaviorPromotion: false,
          },
          v2PromotionCandidateEvaluator: {
            version: 1,
            source: "v2_promotion_candidate_evaluator",
            readOnly: true,
            affectsScoringOrGeneration: false,
            consumedByProduction: false,
            consumedByDemandOrMaterializer: false,
            repairedProjectionUsedAs: "evidence_only_not_target_policy",
            status: "none_ready",
            summary: {
              evaluatedCandidateCount: 1,
              readyCandidateCount: 0,
              stoppedCandidateCount: 1,
              watchCandidateCount: 0,
              topCandidateId: null,
              topRecommendation: "none_ready",
              nextSafeAction: "pivot_to_new_owner_specific_candidate_inventory",
            },
            recommendation: {
              decision: "none_ready",
              candidateId: null,
              label: "none ready",
              ownerSeam: null,
              reason: "measured no-impact",
              nextSafeAction: "pivot_to_new_owner_specific_candidate_inventory",
              score: null,
            },
            candidates: [
              {
                rank: null,
                candidateId: "side_delts_protect_floor",
                label: "Side Delts protect-floor strategy row",
                ownerSeam: "SlotDemandAllocationByWeek",
                sourceSurface: "strategy_row_materializer_projection",
                priorProbe: "measured_no_impact",
                status: "stopped",
                stopReasons: ["measured_no_impact"],
                score: {
                  total: 15,
                  measuredOwnerSpecificPositiveImpact: 0,
                  materializerNonRegression: 20,
                  protectedCoverage: 15,
                  acceptanceWatchStatus: 0,
                  seedRuntimeReceiptDbNonConsumption: 20,
                  sourceAttributionQuality: 15,
                  priorProbeAdjustment: -35,
                  implementationScope: 8,
                },
                evidence: ["identityDelta=0"],
                missingProof: ["acceptance_projection"],
                nextSafeAction: "pivot_to_higher_roi_track",
              },
            ],
            stopReasonCounts: {
              measured_no_impact: 1,
            },
            guardrails: {
              seedRuntimeChanged: false,
              receiptChanged: false,
              persistenceChanged: false,
              productionMaterializerChanged: false,
              acceptanceThresholdChanged: false,
            },
          },
        },
      },
    } as unknown as WorkoutAuditArtifact;
    const request = {
      mode: "mesocycle-explain",
      plannerOnlyNoRepair: true,
      compareRepaired: true,
      v2DebugArtifact: true,
    } as WorkoutAuditRequest;

    const built = buildV2DebugArtifacts({
      artifact,
      request,
      parentFileName: "parent.json",
      parentRelativePath: "parent.json",
      indexFileName: "parent-v2-debug-index.json",
      indexRelativePath: "parent-v2-debug-index.json",
    });

    expect(built?.artifact.summary).toMatchObject({
      v2StrategyRowMaterializerProjectionStatus: "projected_with_limitations",
      v2StrategyRowMaterializerProjectionReadiness: "blocked",
      v2StrategyRowMaterializerProjectionIdentityDelta: 0,
      v2StrategyRowMaterializerProjectionTotalSetDelta: 0,
      v2StrategyRowMaterializerProjectionTargetLaneSetDelta: 0,
      v2StrategyRowMaterializerProjectionBlockerDelta: 0,
      v2StrategyRowMaterializerProjectionLossCause: "not_measured",
      v2StrategyRowMaterializerProjectionLossPrimaryCause:
        "target_lane_not_regressed",
      v2StrategyRowMaterializerProjectionLossOwnerSeam: "unknown",
      v2StrategyRowMaterializerProjectionSetBudgetBasisStatus: "preserved",
      v2StrategyRowMaterializerProjectionSetBudgetBasisChanged: false,
      v2StrategyRowMaterializerProjectionSetBudgetBasisBlocker: null,
      v2StrategyRowMaterializerProjectionNextSafeSlice:
        "keep_blocked_until_owner_donor_or_acceptance_proof",
      v2PromotionCandidateEvaluatorStatus: "none_ready",
      v2PromotionCandidateEvaluatorReady: 0,
      v2PromotionCandidateEvaluatorStopped: 1,
      v2PromotionCandidateEvaluatorWatch: 0,
      v2PromotionCandidateEvaluatorRecommendation: "none_ready",
      v2PromotionCandidateEvaluatorTopCandidate: null,
    });
    const materializationShard = built?.shards.find(
      (shard) => shard.metadata.id === "materialization",
    )?.artifact;

    expect(
      materializationShard?.data.v2StrategyRowMaterializerProjection,
    ).toMatchObject({
      row: {
        rowKey: "SlotDemandAllocationByWeek:Side Delts:protect_floor",
      },
      boundedDeltaAttempted: {
        week: 1,
        slotId: "upper_b",
        laneId: "side_delt_isolation",
      },
      materializerDeltas: {
        totalSetDelta: 0,
        targetLaneSetDelta: 0,
      },
      setBudgetBasisCheck: {
        status: "preserved",
        markerChangedSetBudgetBasis: false,
      },
      protectedCoverageLossCause: {
        classification: "not_measured",
        primaryCause: "target_lane_not_regressed",
        targetLane: {
          baselineSetBudgetBasis: "support_direct_floor",
          trialSetBudgetBasis: "support_direct_floor",
        },
      },
      nonConsumption: {
        demandOrMaterializer: false,
        seedRuntimeReceiptDb: false,
        acceptanceThreshold: false,
      },
    });
    const promotionReadinessShard = built?.shards.find(
      (shard) => shard.metadata.id === "promotion-readiness",
    )?.artifact;
    expect(promotionReadinessShard?.data).toMatchObject({
      v2PromotionCandidateEvaluator: {
        status: "none_ready",
        recommendation: {
          decision: "none_ready",
        },
        candidates: [
          expect.objectContaining({
            candidateId: "side_delts_protect_floor",
            stopReasons: ["measured_no_impact"],
          }),
        ],
      },
    });
  });
});
