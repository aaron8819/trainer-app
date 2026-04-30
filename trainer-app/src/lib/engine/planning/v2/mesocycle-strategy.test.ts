import { describe, expect, it } from "vitest";
import {
  buildV2MesocycleDemand,
  buildV2MesocycleStrategyDiagnostic,
  buildV2PlannerMesocyclePolicy,
  buildV2TargetSkeleton,
  type V2MesocycleStrategyInput,
} from "./index";

function buildStrategyInput(): V2MesocycleStrategyInput {
  return {
    version: 1,
    userProfile: {
      trainingGoal: "hypertrophy",
      trainingAge: "intermediate",
      availableTrainingDays: 4,
      equipmentProfile: ["barbell", "cable", "dumbbell"],
      constraints: ["split:upper_lower", "sessions_per_week:4"],
      preferences: ["favorite_exercise_count:2"],
      painOrToleranceFlags: ["shoulder_history"],
      confidence: "medium",
    },
    currentTrainingContext: {
      split: "upper_lower",
      currentPhase: "AWAITING_HANDOFF",
      currentMesocycleStatus: "COMPLETED",
      weekCount: 5,
      slotSequence: ["upper_a", "lower_a", "upper_b", "lower_b"],
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
    },
    historicalMesocycles: [
      {
        mesocycleId: "meso-any-1",
        sourcePlanner: "legacy_projection",
        status: "COMPLETED",
        adherenceSummary: {
          plannedSessions: 16,
          completedSessions: 14,
          partialSessions: 1,
          skippedSessions: 1,
        },
        performedVolumeSummary: [
          {
            muscle: "Chest",
            plannedSets: 40,
            performedSets: 36,
            targetRange: "target:40",
            status: "within",
          },
        ],
        performanceSignals: [
          {
            exerciseId: "incline-db-press",
            exerciseName: "Incline Dumbbell Press",
            signal: "progressed",
            confidence: "medium",
          },
        ],
      },
      {
        mesocycleId: "meso-any-2",
        sourcePlanner: "legacy_projection",
        status: "COMPLETED",
        adherenceSummary: {
          plannedSessions: 16,
          completedSessions: 13,
          partialSessions: 2,
          skippedSessions: 1,
        },
      },
    ],
    readinessAndRecoverySignals: {
      available: ["subjective_readiness", "performance_compliance"],
      missing: ["wearable_recovery_signal"],
      fatigueFlags: ["performance_stalls:1"],
      painFlags: ["soreness:shoulder:2"],
      adherenceFlags: ["historical_adherence_below_80_percent:meso-any-2"],
    },
    evidenceLimitations: [
      "historical_mesocycles_are_validation_data_not_policy_targets",
      "strategy_input_does_not_feed_mesocycle_demand",
    ],
  };
}

describe("buildV2MesocycleStrategyDiagnostic", () => {
  it("returns a read-only strategy diagnostic without generation authority", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic();

    expect(diagnostic).toMatchObject({
      version: 1,
      source: "v2_mesocycle_strategy",
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "available_with_limitations",
    });
    expect(diagnostic.phaseStrategy).toMatchObject({
      proposedPhase: "unknown",
      classificationStatus: "unknown",
      confidence: "low",
    });
    expect(diagnostic.strategyInputSummary).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      inputContractVersion: null,
      presentGroups: [],
      missingGroups: [
        "userProfile",
        "currentTrainingContext",
        "historicalMesocycles",
        "readinessAndRecoverySignals",
      ],
      ownerAgnostic: true,
    });
  });

  it("represents missing inputs and partial performed-history support honestly", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic();

    expect(diagnostic.userTrainingProfileInputs.available).toContain(
      "v2_target_skeleton:upper_lower_4x_slot_architecture",
    );
    expect(diagnostic.userTrainingProfileInputs.missing).toEqual(
      expect.arrayContaining([
        "pure_v2_user_training_profile_input",
        "explicit_macrocycle_phase_strategy",
        "pain_or_tolerance_history_by_exercise_and_pattern",
      ]),
    );
    expect(diagnostic.performedHistorySignals.available).toContain(
      "progression_history_and_mesocycle_review_read_models_exist",
    );
    expect(diagnostic.performedHistorySignals.missing).toContain(
      "performed_history_is_not_primary_input_to_pure_v2_strategy",
    );
    expect(diagnostic.continuityVariationPolicy.currentSupport).toBe("partial");
  });

  it("reports current demand as fixed skeleton lane-derived and separates north-star gaps", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic();

    expect(diagnostic.demandDerivationPlan).toMatchObject({
      currentDemandSource: "fixed_skeleton_lanes",
      targetDemandSource: "mesocycle_strategy",
    });
    expect(diagnostic.currentStateVsNorthStarGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          gap: expect.stringContaining("MesocycleDemand currently derives"),
          targetOwner: "MesocycleStrategy -> MesocycleDemand",
          priority: "P0",
        }),
        expect.objectContaining({
          gap: expect.stringContaining("Legacy repair/projection remains"),
          priority: "P0",
        }),
      ]),
    );
  });

  it("consumes strategy input as read-only evidence without claiming phase or objective classification", () => {
    const diagnostic = buildV2MesocycleStrategyDiagnostic({
      strategyInput: buildStrategyInput(),
    });

    expect(diagnostic).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "available_with_limitations",
      phaseStrategy: {
        proposedPhase: "unknown",
        classificationStatus: "unknown",
        confidence: "medium",
      },
      mesocycleObjective: {
        classificationStatus: "unknown",
        specializationTargets: [],
        maintenanceTargets: [],
        recoveryBiases: [],
      },
      demandDerivationPlan: {
        currentDemandSource: "fixed_skeleton_lanes",
        targetDemandSource: "mesocycle_strategy",
      },
      strategyInputSummary: {
        inputContractVersion: 1,
        presentGroups: [
          "userProfile",
          "currentTrainingContext",
          "historicalMesocycles",
          "readinessAndRecoverySignals",
        ],
        missingGroups: [],
        historicalMesocycleCount: 2,
        historicalSourcePlanners: ["legacy_projection"],
        historicalSourcePlannerCounts: {
          legacy_projection: 2,
          v2: 0,
          unknown: 0,
        },
        evidenceCategoriesAvailable: expect.arrayContaining([
          "adherence",
          "performed_volume",
          "performance_signals",
          "readiness",
          "fatigue_flags",
          "pain_or_tolerance",
          "historical_adherence_flags",
        ]),
        performedHistoryEvidenceLoaded: true,
        prescribedPlanShapeExcludedFromStrategyPolicy: true,
        confidenceChange: "eligible_for_medium_evidence",
        ownerAgnostic: true,
      },
    });
    expect(diagnostic.performedHistorySignals.available).toEqual(
      expect.arrayContaining([
        "strategy_input:performed_history_evidence_loaded",
        "historical_prescribed_plan_shape_excluded_from_strategy_policy",
      ]),
    );
    expect(diagnostic.userTrainingProfileInputs.missing).not.toContain(
      "pure_v2_user_training_profile_input",
    );
  });

  it("is attached above MesocycleDemand without changing demand output", () => {
    const policy = buildV2PlannerMesocyclePolicy({
      mesocycleStrategyInput: buildStrategyInput(),
    });
    const standaloneDemand = buildV2MesocycleDemand({
      targetSkeleton: buildV2TargetSkeleton(),
    });
    const policyKeys = Object.keys(policy);

    expect(policy.mesocycleStrategyDiagnostic.readOnly).toBe(true);
    expect(policyKeys.indexOf("mesocycleStrategyDiagnostic")).toBeLessThan(
      policyKeys.indexOf("mesocycleDemand"),
    );
    expect(policy.mesocycleDemand).toEqual(standaloneDemand);
  });
});
