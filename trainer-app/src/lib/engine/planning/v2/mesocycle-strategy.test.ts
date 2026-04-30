import { describe, expect, it } from "vitest";
import {
  buildV2MesocycleDemand,
  buildV2MesocycleStrategyDiagnostic,
  buildV2PlannerMesocyclePolicy,
  buildV2TargetSkeleton,
} from "./index";

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
      confidence: "low",
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

  it("is attached above MesocycleDemand without changing demand output", () => {
    const policy = buildV2PlannerMesocyclePolicy();
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
