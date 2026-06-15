import { describe, expect, it } from "vitest";
import type { MesocycleExplainPlannerOnlyNoRepair } from "./types";
import { buildV2DefaultAuthorReadinessMap } from "./v2-default-author-readiness-map";

function makeNoRepair(
  input: Partial<MesocycleExplainPlannerOnlyNoRepair>,
): MesocycleExplainPlannerOnlyNoRepair {
  return input as MesocycleExplainPlannerOnlyNoRepair;
}

function makeBenchmark(): NonNullable<
  MesocycleExplainPlannerOnlyNoRepair["v2PlanQualityBenchmark"]
> {
  return {
    status: "warning",
    summary: {
      nextSafeAction: "review_warning_gates_before_deprecation",
    },
    gates: [
      {
        gate: "support_floors",
        status: "pass",
        ownerSeam: "v2_base_plan_validation.support_direct_floors",
        evidenceSource: "pure_v2_base_plan",
        evidence: ["supportFloorClassification=v2_preserves"],
        missingEvidence: [],
      },
      {
        gate: "direct_work",
        status: "pass",
        ownerSeam: "v2_base_plan_validation.direct_work",
        evidenceSource: "pure_v2_base_plan",
        evidence: ["directWorkClassification=v2_preserves"],
        missingEvidence: [],
      },
      {
        gate: "lane_preservation",
        status: "warning",
        ownerSeam: "v2_shadow_lane_preservation",
        evidenceSource: "shadow_diagnostic",
        evidence: ["lane_preservation_shadow_warning"],
        missingEvidence: [],
      },
      {
        gate: "lane_intent_explicitness",
        status: "pass",
        ownerSeam: "V2LaneSelectionIntent",
        evidenceSource: "pure_v2_lane_selection_intent_audit",
        evidence: ["highRiskLaneJobsPassed=7"],
        missingEvidence: [],
      },
      {
        gate: "session_size",
        status: "pass",
        ownerSeam: "v2_base_plan_validation.slot_shape",
        evidenceSource: "pure_v2_base_plan",
        evidence: ["maxSessionSets=21"],
        missingEvidence: [],
      },
      {
        gate: "fatigue_distribution",
        status: "warning",
        ownerSeam: "SlotDemandAllocationByWeek",
        evidenceSource: "pure_v2_base_plan",
        evidence: ["concentrationWarning=bounded_watch"],
        missingEvidence: [],
      },
      {
        gate: "duplicate_concentration_risk",
        status: "warning",
        ownerSeam: "v2_base_plan_validation.duplicate_distinctness",
        evidenceSource: "pure_v2_base_plan",
        evidence: ["v2DuplicateExactExercises=0"],
        missingEvidence: [],
      },
      {
        gate: "materializer_omissions",
        status: "pass",
        ownerSeam: "v2_materialization_dry_run",
        evidenceSource: "pure_v2_base_plan",
        evidence: ["materializerOmissions=0"],
        missingEvidence: [],
      },
      {
        gate: "week_1_trainability",
        status: "pass",
        ownerSeam: "plannerOnlyNoRepair.acceptanceClassification",
        evidenceSource: "acceptance_classification_no_repair",
        evidence: ["basicMesocycleShapeStatus=pass"],
        missingEvidence: [],
      },
    ],
    slotWeekAllocationAcceptanceProjection: {
      decision: "accepted_with_watch_items",
      representativeAccumulationWeeks: [2, 3, 4],
      materializerNonRegression: {
        status: "pass",
      },
      acceptance: {
        watchItems: ["duplicate_concentration_risk"],
        blockers: [],
        nextSafeSlice: "bounded_behavior_promotion_review",
      },
    },
    laneIntentAcceptanceProjection: {
      materializerNonRegression: {
        status: "pass",
      },
    },
  } as unknown as NonNullable<
    MesocycleExplainPlannerOnlyNoRepair["v2PlanQualityBenchmark"]
  >;
}

describe("V2 default-author readiness map", () => {
  it("summarizes concept readiness and upgrades only concept-mapped proof blockers", () => {
    const map = buildV2DefaultAuthorReadinessMap(
      makeNoRepair({
        v2PlanQualityBenchmark: makeBenchmark(),
        v2PromotionCandidateEvaluator: {
          status: "blocked_actionable_missing_proof",
          summary: {
            readyCandidateCount: 0,
            actionableMissingProofCandidateCount: 1,
            nextSafeAction: "collect_actionable_missing_proof",
          },
          candidates: [
            {
              candidateId: "set_distribution_budget",
              ownerSeam: "SetDistributionIntent",
              sourceSurface: "repair_promotion_scoreboard",
              status: "blocked",
              stopReasons: ["missing_bounded_delta"],
              missingProof: ["owner_specific_bounded_delta_projection"],
              nextSafeAction: "run_one_bounded_projection",
            },
          ],
        },
        repairPromotionScoreboard: {
          rawRepairEvidence: {
            materialRepairCount: 21,
            majorRepairCount: 12,
            suspiciousRepairCount: 3,
          },
        },
      } as unknown as Partial<MesocycleExplainPlannerOnlyNoRepair>),
    );

    expect(map).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      consumedByProduction: false,
      consumedByDemandOrMaterializer: false,
      repairedProjectionUsedAs: "evidence_only_not_target_policy",
      summary: {
        conceptCount: 8,
        repairSafetyNetSymptomCount: 36,
      },
      guardrails: {
        seedRuntimeChanged: false,
        receiptChanged: false,
        persistenceChanged: false,
        productionMaterializerChanged: false,
        acceptanceThresholdChanged: false,
        repairBehaviorChanged: false,
      },
    });
    expect(
      map.concepts.find((row) => row.concept === "MesocycleDemand"),
    ).toMatchObject({
      evidenceSource: "pure_v2_candidate",
      readiness: "ready",
      blockerCategory: null,
    });
    expect(
      map.concepts.find((row) => row.concept === "SetDistributionIntent"),
    ).toMatchObject({
      evidenceSource: "repair_safety_net",
      readiness: "blocked",
      blockerCategory: "missing_bounded_projection",
      nextSafeAction:
        "collect_concept_level_owner_proof_before_behavior_or_pivot",
    });
    expect(
      map.concepts.find(
        (row) => row.concept === "Acceptance / promotion readiness",
      ),
    ).toMatchObject({
      readiness: "blocked",
      blockerCategory: "acceptance_or_promotion_blocked",
    });
  });

  it("quarantines raw repair pressure when no concept-level proof blocker exists", () => {
    const map = buildV2DefaultAuthorReadinessMap(
      makeNoRepair({
        repairPromotionScoreboard: {
          rawRepairEvidence: {
            materialRepairCount: 21,
            majorRepairCount: 12,
            suspiciousRepairCount: 3,
          },
        },
      } as unknown as Partial<MesocycleExplainPlannerOnlyNoRepair>),
    );

    expect(map.summary.repairSafetyNetSymptomCount).toBe(36);
    expect(map.summary.blockedCount).toBe(0);
    expect(map.concepts).toHaveLength(8);
    expect(map.concepts.every((row) => row.readiness !== "blocked")).toBe(true);
    expect(
      map.concepts.some((row) => row.evidenceSource === "repair_safety_net"),
    ).toBe(false);
  });
});
