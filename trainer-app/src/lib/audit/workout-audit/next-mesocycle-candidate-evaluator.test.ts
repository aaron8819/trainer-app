import { describe, expect, it } from "vitest";
import type {
  MesocycleExplainAuditPayload,
  NextMesocycleAcceptanceGatePayload,
} from "./types";
import {
  buildCandidateDecisionSummary,
  buildCandidateEvaluationAssessments,
  buildCandidateRepairBurdenAssessment,
  buildMaterializerGuardrailAssessment,
  buildShadowConsumptionAssessment,
  buildSupportLaneBoundaryAssessment,
} from "./next-mesocycle-candidate-evaluator";

function preview(input?: {
  planningShape?: string;
  materialRepairCount?: number;
  majorRepairCount?: number;
  supportLaneMuscle?: string;
  shadowConsumptionTrial?: unknown;
  unresolvedCauses?: Array<{
    owningCause: string;
    muscle?: string;
    recommendedOwner?: string;
  }>;
  v2ExerciseSelectionPlanDiagnostic?: unknown;
  v2SelectionCapacityPlanDiagnostic?: unknown;
}): MesocycleExplainAuditPayload {
  return {
    preview: {
      projectionDiagnostics: {
        planningReality: {
          summary: {
            planningShape: input?.planningShape ?? "mostly_upstream_planned",
            materialRepairCount: input?.materialRepairCount,
            majorRepairCount: input?.majorRepairCount,
          },
          exerciseClassUnresolvedCauses:
            input?.unresolvedCauses?.map((row) => ({
              slotId: "upper_a",
              muscle: row.muscle ?? "Chest",
              targetStatus: "hard",
              demandType: "direct",
              initialAlignment: "partial",
              finalAlignment: "partial",
              owningCause: row.owningCause,
              recommendedOwner: row.recommendedOwner ?? "selection_objective",
              behaviorReadiness: "needs_duplicate_policy",
              evidence: [`${row.owningCause}:evidence`],
              limitations: [],
            })) ?? [],
        },
      },
    },
    plannerOnlyNoRepair: {
      ...(input?.shadowConsumptionTrial
        ? { v2BasePlanShadowConsumptionTrial: input.shadowConsumptionTrial }
        : {}),
      ...(input?.v2ExerciseSelectionPlanDiagnostic
        ? {
            v2ExerciseSelectionPlanDiagnostic:
              input.v2ExerciseSelectionPlanDiagnostic,
          }
        : {}),
      ...(input?.v2SelectionCapacityPlanDiagnostic
        ? {
            v2SelectionCapacityPlanDiagnostic:
              input.v2SelectionCapacityPlanDiagnostic,
          }
        : {}),
      v2SupportLaneProjectionDiagnostic: {
        laneBoundaryRows: input?.supportLaneMuscle
          ? [
              {
                muscle: input.supportLaneMuscle,
                slotId: "upper_b",
                laneId: "optional_triceps_if_under_target",
                status: "authored_support_lane_dropped",
                projectedEffectiveSets: 5,
                mevFloor: 6,
              },
            ]
          : [],
      },
    },
  } as unknown as MesocycleExplainAuditPayload;
}

describe("next mesocycle candidate evaluator", () => {
  it("classifies repair-heavy trainable candidates as architecture debt", () => {
    const result = buildCandidateRepairBurdenAssessment({
      candidateFound: true,
      candidateTruthFailure: false,
      preview: preview({
        planningShape: "mostly_repair_shaped",
        materialRepairCount: 8,
        majorRepairCount: 2,
      }),
    });

    expect(result).toMatchObject({
      repairBurden: "high",
      repairBurdenSource: "planning_reality_summary",
      repairBurdenClassification: "architecture_debt",
      materialRepairCount: 8,
      majorRepairCount: 2,
    });
  });

  it("escalates repair burden to candidate truth only when the candidate fails floors or caps", () => {
    const result = buildCandidateRepairBurdenAssessment({
      candidateFound: true,
      candidateTruthFailure: true,
      preview: preview({
        planningShape: "mostly_repair_shaped",
        materialRepairCount: 8,
        majorRepairCount: 2,
      }),
    });

    expect(result.repairBurdenClassification).toBe("candidate_truth");
  });

  it("classifies read-only shadow consumption gains as diagnostic evidence needing inspection", () => {
    const result = buildShadowConsumptionAssessment({
      preview: preview({
        shadowConsumptionTrial: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          status: "available",
          guardrails: {
            consumedByProduction: false,
            consumedByDemandOrMaterializer: false,
          },
          summary: {
            repairDependencyDelta: -8,
            currentRepairDependencyCount: 9,
            shadowRemainingRepairDependencyCount: 1,
            regressionCount: 0,
          },
          nextSafeAction: "inspect_shadow_consumption",
        },
      }),
    });

    expect(result).toMatchObject({
      shadowConsumptionClassification:
        "diagnostic_positive_needs_inspection",
      shadowConsumptionNextSafeAction: "inspect_shadow_consumption",
    });
    expect(result.shadowConsumptionEvidence).toContain("delta=-8");
    expect(result.shadowConsumptionEvidence).toContain(
      "classification=diagnostic_positive_needs_inspection",
    );
  });

  it("flags shadow consumption guardrail violations before behavior promotion", () => {
    const result = buildShadowConsumptionAssessment({
      preview: preview({
        shadowConsumptionTrial: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: true,
          status: "available",
          summary: {
            repairDependencyDelta: -8,
            currentRepairDependencyCount: 9,
            shadowRemainingRepairDependencyCount: 1,
            regressionCount: 0,
          },
          nextSafeAction: "inspect_shadow_consumption",
        },
      }),
    });

    expect(result.shadowConsumptionClassification).toBe(
      "guardrail_violation",
    );
  });

  it("classifies exercise metadata gaps from existing materializer diagnostics", () => {
    const result = buildMaterializerGuardrailAssessment({
      preview: preview({
        unresolvedCauses: [
          {
            owningCause: "inventory_classification_gap",
            recommendedOwner: "exercise_inventory_classification",
          },
        ],
        v2ExerciseSelectionPlanDiagnostic: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          safeForBehaviorPromotion: false,
          summary: {
            blockedLaneCount: 0,
            classMismatchCount: 1,
            duplicateRequiresJustificationCount: 0,
          },
          blockers: [],
        },
      }),
    });

    expect(result).toMatchObject({
      materializerGuardrailClassification: "exercise_metadata_gap",
      materializerGuardrailNextSafeAction: "inspect_exercise_metadata",
      inventoryClassificationGapCount: 1,
    });
    expect(result.materializerGuardrailEvidence).toContain(
      "classification=exercise_metadata_gap",
    );
  });

  it("classifies duplicate continuity conflicts as selection/ranking guardrails", () => {
    const result = buildMaterializerGuardrailAssessment({
      preview: preview({
        unresolvedCauses: [
          {
            owningCause: "duplicate_continuity_conflict",
            recommendedOwner: "duplicate_continuity_policy",
          },
        ],
        v2ExerciseSelectionPlanDiagnostic: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          safeForBehaviorPromotion: false,
          summary: {
            blockedLaneCount: 0,
            classMismatchCount: 0,
            duplicateRequiresJustificationCount: 1,
          },
          blockers: [],
        },
      }),
    });

    expect(result).toMatchObject({
      materializerGuardrailClassification: "selection_ranking_gap",
      materializerGuardrailNextSafeAction: "inspect_selection_ranking",
      duplicateContinuityConflictCount: 1,
    });
  });

  it("keeps read-only materializer diagnostic guardrails explicit", () => {
    const result = buildMaterializerGuardrailAssessment({
      preview: preview({
        v2ExerciseSelectionPlanDiagnostic: {
          readOnly: true,
          affectsScoringOrGeneration: true,
          safeForBehaviorPromotion: false,
          summary: {
            blockedLaneCount: 0,
            classMismatchCount: 0,
            duplicateRequiresJustificationCount: 0,
          },
          blockers: [],
        },
      }),
    });

    expect(result.materializerGuardrailClassification).toBe(
      "guardrail_violation",
    );
    expect(result.materializerGuardrailNextSafeAction).toBe(
      "stop_guardrail_violation",
    );
  });

  it("keeps authored support-lane drops as warnings when seed volume clears the floor", () => {
    const result = buildSupportLaneBoundaryAssessment({
      preview: preview({ supportLaneMuscle: "Triceps" }),
      candidateFound: true,
      weeklyRows: [
        {
          muscle: "Triceps",
          projectedSets: 8,
          mev: 6,
          productiveTarget: 6,
          mav: 12,
          status: "productive_zone",
          severity: "pass",
          notes: "inside productive zone",
        },
      ],
    });

    expect(result.blockingRows).toEqual([]);
    expect(result.warningRows).toHaveLength(1);
    expect(result.evidence).toContain("Triceps:upper_b");
  });

  it("makes authored support-lane drops blocking when the evaluated candidate is below MEV", () => {
    const result = buildSupportLaneBoundaryAssessment({
      preview: preview({ supportLaneMuscle: "Triceps" }),
      candidateFound: true,
      weeklyRows: [
        {
          muscle: "Triceps",
          projectedSets: 5,
          mev: 6,
          productiveTarget: 6,
          mav: 12,
          status: "below_mev_fail",
          severity: "high_risk",
          notes: "below MEV blocks acceptance",
        },
      ],
    });

    expect(result.blockingRows).toHaveLength(1);
    expect(result.warningRows).toEqual([]);
  });

  it("builds the reusable candidate-quality assessment bundle for the gate wrapper", () => {
    const result = buildCandidateEvaluationAssessments({
      preview: preview({
        planningShape: "mostly_repair_shaped",
        materialRepairCount: 8,
        majorRepairCount: 2,
        supportLaneMuscle: "Triceps",
        shadowConsumptionTrial: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          consumedByProduction: false,
          status: "available",
          guardrails: {
            consumedByProduction: false,
            consumedByDemandOrMaterializer: false,
          },
          summary: {
            repairDependencyDelta: -8,
            currentRepairDependencyCount: 9,
            shadowRemainingRepairDependencyCount: 1,
            regressionCount: 0,
          },
          nextSafeAction: "inspect_shadow_consumption",
        },
      }),
      candidateFound: true,
      candidateTruthFailure: true,
      weeklyRows: [
        {
          muscle: "Triceps",
          projectedSets: 5,
          mev: 6,
          productiveTarget: 6,
          mav: 12,
          status: "below_mev_fail",
          severity: "high_risk",
          notes: "below MEV blocks acceptance",
        },
      ],
    });

    expect(result.repairBurden.repairBurdenClassification).toBe(
      "candidate_truth",
    );
    expect(result.supportLaneBoundary.blockingRows).toHaveLength(1);
    expect(result.shadowConsumption.shadowConsumptionClassification).toBe(
      "diagnostic_positive_needs_inspection",
    );
    expect(result.materializerGuardrail.materializerGuardrailClassification).toBe(
      "no_material_guardrail_issue",
    );
  });

  it("builds decision-summary quality without owning the final gate decision", () => {
    const assessments = buildCandidateEvaluationAssessments({
      preview: preview({
        planningShape: "mostly_repair_shaped",
        materialRepairCount: 8,
        majorRepairCount: 2,
      }),
      candidateFound: true,
      weeklyRows: [],
    });

    const result = buildCandidateDecisionSummary({
      candidateFound: true,
      assessments,
      gates: [
        { gate: "Week 1 trainability", status: "pass" },
        { gate: "Exercise/materialization quality", status: "warning" },
      ] as NextMesocycleAcceptanceGatePayload["gates"],
    });

    expect(result).toMatchObject({
      trainability: "pass",
      plannerMaterializerQuality: "warning",
      repairBurden: "high",
      repairBurdenClassification: "architecture_debt",
      shadowConsumptionClassification: "not_available",
      materializerGuardrailClassification: "no_material_guardrail_issue",
    });
  });
});
