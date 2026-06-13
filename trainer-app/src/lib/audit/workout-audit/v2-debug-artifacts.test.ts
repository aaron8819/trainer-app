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
              totalSetDelta: 1,
              targetLaneSetDelta: 1,
              targetLaneExerciseDelta: 0,
              materializerBlockerDelta: 0,
              regressionCount: 0,
              changedSlotCount: 1,
              changedSlots: [
                {
                  slotId: "upper_b",
                  exerciseCountDelta: 0,
                  setDelta: 1,
                  addedIdentityCount: 0,
                  removedIdentityCount: 0,
                },
              ],
            },
            protectedCoverageImpact: {
              status: "improved",
              baselineTargetLaneSets: 4,
              trialTargetLaneSets: 5,
              targetLaneSetDelta: 1,
              netWeeklySetDelta: 1,
            },
            protectedCoverageLossCause: {
              classification: "diagnostic_artifact",
              primaryCause: "target_lane_marker_changes_set_budget_basis",
              ownerSeam: "v2_strategy_row_materializer_projection",
              summary: "projection-only trial changed the lane budget basis",
              targetLane: {
                week: 1,
                slotId: "upper_b",
                laneId: "side_delt_isolation",
                baselineSetBudget: { min: 4, preferred: 4, max: 4 },
                trialSetBudget: { min: 3, preferred: 3, max: 3 },
                baselineSetBudgetBasis: "support_direct_floor",
                trialSetBudgetBasis: "class_ownership_allocation",
                baselineMaterializedSets: 4,
                trialMaterializedSets: 3,
                selectionSetBudgetDelta: -1,
                materializedSetDelta: -1,
              },
              collateralLaneSetDeltas: [
                {
                  slotId: "upper_b",
                  laneId: "chest_second_exposure",
                  baselineSetBudget: { min: 2, preferred: 2, max: 2 },
                  trialSetBudget: { min: 2, preferred: 3, max: 3 },
                  baselineSetBudgetBasis: "class_ownership_allocation",
                  trialSetBudgetBasis: "class_ownership_allocation",
                  baselineMaterializedSets: 2,
                  trialMaterializedSets: 3,
                  selectionSetBudgetDelta: 1,
                  materializedSetDelta: 1,
                },
              ],
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
      v2StrategyRowMaterializerProjectionTotalSetDelta: 1,
      v2StrategyRowMaterializerProjectionTargetLaneSetDelta: 1,
      v2StrategyRowMaterializerProjectionBlockerDelta: 0,
      v2StrategyRowMaterializerProjectionLossCause: "diagnostic_artifact",
      v2StrategyRowMaterializerProjectionLossPrimaryCause:
        "target_lane_marker_changes_set_budget_basis",
      v2StrategyRowMaterializerProjectionLossOwnerSeam:
        "v2_strategy_row_materializer_projection",
      v2StrategyRowMaterializerProjectionNextSafeSlice:
        "keep_blocked_until_owner_donor_or_acceptance_proof",
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
        totalSetDelta: 1,
        targetLaneSetDelta: 1,
      },
      protectedCoverageLossCause: {
        classification: "diagnostic_artifact",
        primaryCause: "target_lane_marker_changes_set_budget_basis",
        targetLane: {
          baselineSetBudgetBasis: "support_direct_floor",
          trialSetBudgetBasis: "class_ownership_allocation",
        },
      },
      nonConsumption: {
        demandOrMaterializer: false,
        seedRuntimeReceiptDb: false,
        acceptanceThreshold: false,
      },
    });
  });
});
