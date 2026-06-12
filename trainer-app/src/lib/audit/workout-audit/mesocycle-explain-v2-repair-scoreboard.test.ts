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
});
