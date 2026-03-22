import { describe, expect, it } from "vitest";
import type { GenesisPolicyContext } from "./mesocycle-handoff-contract";
import { designNextMesocycle } from "./mesocycle-genesis-policy";

function buildContext(
  overrides: Partial<GenesisPolicyContext> = {}
): GenesisPolicyContext {
  return {
    sourceProfile: {
      sourceMesocycleId: "meso-1",
      focus: "Upper Hypertrophy",
      durationWeeks: 5,
      volumeTarget: "HIGH",
      intensityBias: "HYPERTROPHY",
      blocks: [],
      ...overrides.sourceProfile,
    },
    constraints: {
      availableDaysPerWeek: 4,
      ...overrides.constraints,
    },
    preferences: {
      ...overrides.preferences,
    },
    sourceTopology: {
      splitType: "UPPER_LOWER",
      sessionsPerWeek: 4,
      daysPerWeek: 4,
      weeklySequence: ["UPPER", "LOWER", "UPPER", "LOWER"],
      slotSource: "persisted_slot_sequence",
      hasPersistedSlotSequence: true,
      slots: [
        { slotId: "upper_a", intent: "UPPER", sequenceIndex: 0 },
        { slotId: "lower_a", intent: "LOWER", sequenceIndex: 1 },
        { slotId: "upper_b", intent: "UPPER", sequenceIndex: 2 },
        { slotId: "lower_b", intent: "LOWER", sequenceIndex: 3 },
      ],
      repeatedIntents: ["UPPER", "LOWER"],
      ...overrides.sourceTopology,
    },
    closeoutEvidence: {
      scheduledSessions: 10,
      performedSessions: 9,
      completedSessions: 8,
      advancingSessions: 8,
      nonAdvancingPerformedSessions: 1,
      adherenceRate: 0.9,
      completionRate: 0.8,
      terminalDeloadPerformed: true,
      latestReadiness: {
        readiness: 4,
        signalAgeHours: 6,
      },
      ...overrides.closeoutEvidence,
    },
    carryForwardCandidateEvidence: overrides.carryForwardCandidateEvidence ?? [
      {
        exerciseId: "bench",
        exerciseName: "Bench Press",
        role: "CORE_COMPOUND",
        priorIntent: "UPPER",
        priorSlotId: "upper_a",
        anchorLevel: "required",
        evidence: {
          exposureCount: 3,
          advancingExposureCount: 3,
          latestPerformedAt: "2026-04-01T00:00:00.000Z",
          latestSourceIntent: "UPPER",
          latestSourceSlotId: "upper_a",
          latestSemanticsKind: "advancing",
        },
      },
      {
        exerciseId: "row",
        exerciseName: "Chest-Supported Row",
        role: "ACCESSORY",
        priorIntent: "UPPER",
        anchorLevel: "none",
        evidence: {
          exposureCount: 0,
          advancingExposureCount: 0,
          latestPerformedAt: null,
        },
      },
    ],
  };
}

describe("designNextMesocycle", () => {
  it("honors preferred frequency and split when present", () => {
    const design = designNextMesocycle(
      buildContext({
        constraints: {
          availableDaysPerWeek: 5,
        },
        preferences: {
          preferredSessionsPerWeek: 5,
          preferredSessionsPerWeekSource: "constraints_days_per_week",
          preferredSplitType: "PPL",
          preferredSplitTypeSource: "constraints_split_type",
        },
      })
    );

    expect(design.structure.sessionsPerWeek).toBe(5);
    expect(design.structure.splitType).toBe("PPL");
    expect(design.explainability.structureReasonCodes).toEqual([
      "preferred_frequency_honored",
      "preferred_split_honored",
    ]);
    expect(design.explainability.structureSignalQuality).toBe("high");
  });

  it("caps preferred frequency by constraints without changing the preferred split branch", () => {
    const design = designNextMesocycle(
      buildContext({
        constraints: {
          availableDaysPerWeek: 4,
        },
        preferences: {
          preferredSessionsPerWeek: 6,
          preferredSessionsPerWeekSource: "constraints_days_per_week",
          preferredSplitType: "PPL",
          preferredSplitTypeSource: "constraints_split_type",
        },
      })
    );

    expect(design.structure.sessionsPerWeek).toBe(4);
    expect(design.structure.splitType).toBe("PPL");
    expect(design.explainability.structureReasonCodes).toEqual([
      "preferred_frequency_capped_by_constraints",
      "preferred_split_honored",
    ]);
    expect(design.explainability.structureSignalQuality).toBe("high");
  });

  it("keeps fallback structure defaults unchanged when preference signals are absent", () => {
    const design = designNextMesocycle(
      buildContext({
        constraints: {
          availableDaysPerWeek: 6,
        },
        preferences: {},
      })
    );

    expect(design.structure.sessionsPerWeek).toBe(4);
    expect(design.structure.splitType).toBe("UPPER_LOWER");
    expect(design.explainability.structureReasonCodes).toEqual([
      "default_frequency_cap_applied",
      "default_upper_lower_for_four_plus_sessions",
    ]);
    expect(design.explainability.structureSignalQuality).toBe("medium");
  });

  it("distinguishes evidence-backed keep decisions from fallback carry-forward decisions", () => {
    const design = designNextMesocycle(
      buildContext({
        carryForwardCandidateEvidence: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            role: "CORE_COMPOUND",
            priorIntent: "UPPER",
            priorSlotId: "upper_a",
            anchorLevel: "required",
            evidence: {
              exposureCount: 4,
              advancingExposureCount: 4,
              latestPerformedAt: "2026-04-01T00:00:00.000Z",
              latestSourceIntent: "UPPER",
              latestSourceSlotId: "upper_a",
              latestSemanticsKind: "advancing",
            },
          },
          {
            exerciseId: "squat",
            exerciseName: "Back Squat",
            role: "CORE_COMPOUND",
            priorIntent: "LOWER",
            anchorLevel: "required",
            evidence: {
              exposureCount: 2,
              advancingExposureCount: 2,
              latestPerformedAt: "2026-03-29T00:00:00.000Z",
            },
          },
          {
            exerciseId: "curl",
            exerciseName: "Cable Curl",
            role: "ACCESSORY",
            priorIntent: "UPPER",
            anchorLevel: "none",
            evidence: {
              exposureCount: 3,
              advancingExposureCount: 3,
              latestPerformedAt: "2026-04-01T00:00:00.000Z",
              latestSourceIntent: "UPPER",
              latestSourceSlotId: "upper_b",
              latestSemanticsKind: "advancing",
            },
          },
        ],
      })
    );

    expect(design.carryForward.decisions).toEqual([
      expect.objectContaining({
        exerciseId: "bench",
        action: "keep",
        signalQuality: "high",
        reasonCodes: ["required_anchor_continuity_supported_by_receipt_slot"],
      }),
      expect.objectContaining({
        exerciseId: "squat",
        action: "keep",
        signalQuality: "medium",
        reasonCodes: ["required_anchor_continuity_fallback"],
      }),
      expect.objectContaining({
        exerciseId: "curl",
        action: "rotate",
        signalQuality: "medium",
        reasonCodes: ["accessory_rotation_fallback_pending_action_refinement"],
      }),
    ]);
  });
});
