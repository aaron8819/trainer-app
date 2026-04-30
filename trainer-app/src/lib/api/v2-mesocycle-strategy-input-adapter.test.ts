import { describe, expect, it } from "vitest";
import type { ReadinessSignal } from "@/lib/engine/readiness/types";
import type { MesocycleHandoffSummary } from "./mesocycle-handoff-contract";
import type { MesocycleReviewData } from "./mesocycle-review";
import { buildV2MesocycleStrategyInputFromReadModels } from "./v2-mesocycle-strategy-input-adapter";

function makeHandoffSummary(): MesocycleHandoffSummary {
  return {
    version: 1,
    mesocycleId: "meso-future-user-1",
    macroCycleId: "macro-future-user-1",
    mesoNumber: 2,
    closedAt: "2026-04-01T00:00:00.000Z",
    lifecycle: {
      terminalState: "AWAITING_HANDOFF",
      durationWeeks: 5,
      accumulationSessionsCompleted: 16,
      deloadSessionsCompleted: 1,
      deloadExcludedFromNextBaseline: true,
    },
    training: {
      focus: "Hypertrophy",
      splitType: "UPPER_LOWER",
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      weeklySequence: ["UPPER", "LOWER", "UPPER", "LOWER"],
    },
    carryForwardRecommendations: [],
    recommendedNextSeed: {
      version: 1,
      sourceMesocycleId: "meso-future-user-1",
      createdAt: "2026-04-01T00:00:00.000Z",
      structure: {
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        sequenceMode: "ordered_flexible",
        slots: [
          { slotId: "upper_a", intent: "UPPER" },
          { slotId: "lower_a", intent: "LOWER" },
        ],
      },
      startingPoint: {
        volumeEntry: "conservative",
        baselineSource: "accumulation_preferred",
        allowNonDeloadFallback: true,
      },
      carryForwardSelections: [],
    },
    recommendedDesign: {
      version: 1,
      designedAt: "2026-04-01T00:00:00.000Z",
      sourceMesocycleId: "meso-future-user-1",
      profile: {
        focus: "Hypertrophy",
        durationWeeks: 5,
        volumeTarget: "MODERATE",
        intensityBias: "HYPERTROPHY",
        blocks: [
          {
            blockNumber: 1,
            blockType: "ACCUMULATION",
            durationWeeks: 4,
            volumeTarget: "MODERATE",
            intensityBias: "HYPERTROPHY",
            adaptationType: "SARCOPLASMIC_HYPERTROPHY",
          },
        ],
      },
      structure: {
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        sequenceMode: "ordered_flexible",
        slots: [
          {
            slotId: "upper_a",
            intent: "UPPER",
            authoredSemantics: {
              slotArchetype: "upper_horizontal_balanced",
              primaryLaneContract: null,
              supportCoverageContract: null,
              continuityScope: "slot",
            },
          },
          {
            slotId: "lower_a",
            intent: "LOWER",
            authoredSemantics: {
              slotArchetype: "lower_squat_dominant",
              primaryLaneContract: null,
              supportCoverageContract: null,
              continuityScope: "slot",
            },
          },
        ],
      },
      carryForward: { decisions: [] },
      startingPoint: {
        volumeEntry: "conservative",
        baselineSource: "accumulation_preferred",
        allowNonDeloadFallback: true,
      },
      explainability: {
        profileReasonCodes: ["profile_reused_with_constraints"],
        profileSignalQuality: "medium",
        structureReasonCodes: ["preferred_upper_lower_honored"],
        structureSignalQuality: "medium",
        startingPointReasonCodes: ["conservative_after_deload"],
        startingPointSignalQuality: "medium",
      },
    },
  };
}

function makeReview(): MesocycleReviewData {
  return {
    mesocycleId: "meso-future-user-1",
    mesoNumber: 2,
    focus: "Hypertrophy",
    closedAt: "2026-04-01T00:00:00.000Z",
    archive: {
      currentState: "COMPLETED",
      reviewState: "historical_closeout",
      isEditableHandoff: false,
    },
    frozenSummary: makeHandoffSummary(),
    recommendation: {} as MesocycleReviewData["recommendation"],
    derived: {
      scopedWorkoutCount: 17,
      performedWorkoutCount: 16,
      adherence: {
        plannedSessions: 16,
        performedSessions: 15,
        coreCompletedSessions: 14,
        partialSessions: 1,
        skippedSessions: 1,
        adherenceRate: 0.938,
        completionRate: 0.875,
        optionalPerformedSessions: 1,
      },
      weeklyBreakdown: [],
      topProgressedExercises: [
        {
          exerciseId: "incline-db-press",
          exerciseName: "Incline Dumbbell Press",
          sessionIntent: "UPPER",
          exposureCount: 3,
          signal: "estimated_strength",
          changePct: 0.06,
          summary: "Estimated strength up 6% across 3 exposures.",
          latestBestSet: "8 reps @ 80 lb",
        },
      ],
      muscleVolumeSummary: [
        {
          muscle: "Chest",
          targetSets: 40,
          actualEffectiveSets: 37,
          delta: -3,
          percentDelta: -0.075,
          status: "on_target",
          topContributors: [
            {
              exerciseId: "incline-db-press",
              exerciseName: "Incline Dumbbell Press",
              effectiveSets: 16,
            },
          ],
        },
        {
          muscle: "Side Delts",
          targetSets: 20,
          actualEffectiveSets: 12,
          delta: -8,
          percentDelta: -0.4,
          status: "meaningfully_low",
          topContributors: [],
        },
      ],
    },
  };
}

function makeReadiness(): ReadinessSignal {
  return {
    timestamp: new Date("2026-04-02T12:00:00.000Z"),
    userId: "future-user-1",
    subjective: {
      readiness: 2,
      motivation: 3,
      soreness: { shoulder: 2, quads: 1 },
      stress: 3,
    },
    performance: {
      rpeDeviation: 1.2,
      stallCount: 1,
      volumeComplianceRate: 0.75,
    },
  };
}

describe("buildV2MesocycleStrategyInputFromReadModels", () => {
  it("labels missing evidence honestly instead of fabricating profile, history, or readiness", () => {
    const input = buildV2MesocycleStrategyInputFromReadModels({});

    expect(input).toMatchObject({
      version: 1,
      userProfile: {
        confidence: "low",
      },
      currentTrainingContext: {},
      historicalMesocycles: [],
    });
    expect(input.readinessAndRecoverySignals.available).toEqual([]);
    expect(input.readinessAndRecoverySignals.missing).toEqual(
      expect.arrayContaining([
        "latest_readiness_signal",
        "wearable_recovery_signal",
      ]),
    );
    expect(input.evidenceLimitations).toEqual(
      expect.arrayContaining([
        "user_profile_evidence_missing",
        "historical_mesocycle_review_missing",
        "readiness_signal_missing_or_stale",
        "strategy_input_does_not_feed_mesocycle_demand",
      ]),
    );
  });

  it("maps handoff, review, profile, and readiness evidence into an owner-agnostic DTO", () => {
    const input = buildV2MesocycleStrategyInputFromReadModels({
      userProfile: {
        trainingGoal: "hypertrophy",
        trainingAge: "advanced",
        availableTrainingDays: 4,
        equipmentProfile: ["cable", "dumbbell"],
        constraints: ["split:upper_lower", "sessions_per_week:4"],
        preferences: ["favorite_exercise_count:2"],
        painOrToleranceFlags: ["shoulder_history"],
      },
      handoffSummary: makeHandoffSummary(),
      historicalMesocycleReviews: [
        {
          review: makeReview(),
          sourcePlanner: "legacy_projection",
        },
      ],
      readiness: makeReadiness(),
    });

    expect(input.userProfile).toMatchObject({
      trainingGoal: "hypertrophy",
      trainingAge: "advanced",
      availableTrainingDays: 4,
      confidence: "high",
    });
    expect(input.currentTrainingContext).toMatchObject({
      split: "upper_lower",
      currentMesocycleStatus: "AWAITING_HANDOFF",
      weekCount: 5,
      slotSequence: ["upper_a", "lower_a"],
      volumeTarget: "MODERATE",
      intensityBias: "HYPERTROPHY",
    });
    expect(input.historicalMesocycles).toHaveLength(1);
    expect(input.historicalMesocycles[0]).toMatchObject({
      mesocycleId: "meso-future-user-1",
      sourcePlanner: "legacy_projection",
      adherenceSummary: {
        plannedSessions: 16,
        completedSessions: 14,
        partialSessions: 1,
        skippedSessions: 1,
      },
      performedVolumeSummary: expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          performedSets: 37,
          status: "within",
        }),
        expect.objectContaining({
          muscle: "Side Delts",
          status: "under",
        }),
      ]),
      performanceSignals: [
        expect.objectContaining({
          exerciseId: "incline-db-press",
          signal: "progressed",
          confidence: "medium",
        }),
      ],
    });
    expect(input.readinessAndRecoverySignals).toMatchObject({
      available: expect.arrayContaining([
        "subjective_readiness",
        "performance_stalls",
      ]),
      fatigueFlags: expect.arrayContaining([
        "low_subjective_readiness",
        "performance_stalls:1",
      ]),
      painFlags: ["soreness:shoulder:2"],
    });
    expect(input.evidenceLimitations).toContain(
      "historical_mesocycles_are_validation_data_not_policy_targets",
    );
    expect(JSON.stringify(input)).not.toContain("aaron8819@gmail.com");
    expect(JSON.stringify(input)).not.toContain("ownerEmail");
  });
});
