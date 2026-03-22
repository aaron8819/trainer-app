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

  it("uses explicit compatible weekly schedule order for authored slots", () => {
    const design = designNextMesocycle(
      buildContext({
        preferences: {
          preferredSessionsPerWeek: 4,
          preferredSessionsPerWeekSource: "weekly_schedule_length",
          preferredSplitType: "UPPER_LOWER",
          preferredSplitTypeSource: "constraints_split_type",
        },
        sourceTopology: {
          splitType: "UPPER_LOWER",
          sessionsPerWeek: 4,
          daysPerWeek: 4,
          weeklySequence: ["LOWER", "UPPER", "LOWER", "UPPER"],
          slotSource: "persisted_slot_sequence",
          hasPersistedSlotSequence: true,
          slots: [
            { slotId: "lower_a", intent: "LOWER", sequenceIndex: 0 },
            { slotId: "upper_a", intent: "UPPER", sequenceIndex: 1 },
            { slotId: "lower_b", intent: "LOWER", sequenceIndex: 2 },
            { slotId: "upper_b", intent: "UPPER", sequenceIndex: 3 },
          ],
          repeatedIntents: ["LOWER", "UPPER"],
        },
      })
    );

    expect(design.structure.slots.map((slot) => slot.intent)).toEqual([
      "LOWER",
      "UPPER",
      "LOWER",
      "UPPER",
    ]);
    expect(design.structure.slots.map((slot) => slot.slotId)).toEqual([
      "lower_a",
      "upper_a",
      "lower_b",
      "upper_b",
    ]);
    expect(design.explainability.structureReasonCodes).toEqual([
      "preferred_frequency_honored",
      "preferred_split_honored",
      "explicit_weekly_schedule_order_honored",
    ]);
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
              latestSemanticsKind: "advancing",
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
          {
            exerciseId: "raise",
            exerciseName: "Lateral Raise",
            role: "ACCESSORY",
            priorIntent: "UPPER",
            anchorLevel: "none",
            evidence: {
              exposureCount: 1,
              advancingExposureCount: 1,
              latestPerformedAt: "2026-04-01T00:00:00.000Z",
              latestSemanticsKind: "advancing",
            },
          },
          {
            exerciseId: "fly",
            exerciseName: "Cable Fly",
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
      })
    );

    expect(design.carryForward.decisions).toEqual([
      expect.objectContaining({
        exerciseId: "bench",
        action: "keep",
        targetSlotId: "upper_a",
        signalQuality: "high",
        reasonCodes: [
          "required_anchor_continuity_supported_by_receipt_slot",
          "repeated_slot_target_mapped_from_prior_slot",
        ],
      }),
      expect.objectContaining({
        exerciseId: "squat",
        action: "keep",
        signalQuality: "high",
        reasonCodes: ["required_anchor_continuity_supported_by_advancing_exposure"],
      }),
      expect.objectContaining({
        exerciseId: "curl",
        action: "keep",
        targetSlotId: "upper_b",
        signalQuality: "high",
        reasonCodes: [
          "accessory_continuity_supported_by_receipt_slot",
          "repeated_slot_target_mapped_from_prior_slot",
        ],
      }),
      expect.objectContaining({
        exerciseId: "raise",
        action: "rotate",
        signalQuality: "medium",
        reasonCodes: ["carry_forward_rotation_ambiguous_slot_target"],
      }),
      expect.objectContaining({
        exerciseId: "fly",
        action: "drop",
        signalQuality: "high",
        reasonCodes: ["accessory_drop_no_mesocycle_exposure"],
      }),
    ]);
  });

  it("caps accessory keeps per authored slot and rotates the weakest overflow candidates", () => {
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
              latestPerformedAt: "2026-04-05T00:00:00.000Z",
              latestSourceIntent: "UPPER",
              latestSourceSlotId: "upper_a",
              latestSemanticsKind: "advancing",
            },
          },
          {
            exerciseId: "cable-row",
            exerciseName: "Cable Row",
            role: "ACCESSORY",
            priorIntent: "UPPER",
            anchorLevel: "none",
            evidence: {
              exposureCount: 4,
              advancingExposureCount: 4,
              latestPerformedAt: "2026-04-05T00:00:00.000Z",
              latestSourceIntent: "UPPER",
              latestSourceSlotId: "upper_a",
              latestSemanticsKind: "advancing",
            },
          },
          {
            exerciseId: "lat-pulldown",
            exerciseName: "Lat Pulldown",
            role: "ACCESSORY",
            priorIntent: "UPPER",
            anchorLevel: "none",
            evidence: {
              exposureCount: 4,
              advancingExposureCount: 4,
              latestPerformedAt: "2026-04-04T00:00:00.000Z",
              latestSourceIntent: "UPPER",
              latestSourceSlotId: "upper_b",
              latestSemanticsKind: "advancing",
            },
          },
          {
            exerciseId: "lateral-raise",
            exerciseName: "Lateral Raise",
            role: "ACCESSORY",
            priorIntent: "UPPER",
            anchorLevel: "none",
            evidence: {
              exposureCount: 4,
              advancingExposureCount: 4,
              latestPerformedAt: "2026-04-03T00:00:00.000Z",
              latestSourceIntent: "UPPER",
              latestSemanticsKind: "advancing",
            },
          },
          {
            exerciseId: "face-pull",
            exerciseName: "Face Pull",
            role: "ACCESSORY",
            priorIntent: "UPPER",
            anchorLevel: "none",
            evidence: {
              exposureCount: 3,
              advancingExposureCount: 3,
              latestPerformedAt: "2026-04-02T00:00:00.000Z",
              latestSourceIntent: "UPPER",
              latestSemanticsKind: "advancing",
            },
          },
          {
            exerciseId: "curl",
            exerciseName: "Cable Curl",
            role: "ACCESSORY",
            priorIntent: "UPPER",
            anchorLevel: "none",
            evidence: {
              exposureCount: 2,
              advancingExposureCount: 2,
              latestPerformedAt: "2026-04-01T00:00:00.000Z",
              latestSourceIntent: "UPPER",
              latestSemanticsKind: "advancing",
            },
          },
        ],
      })
    );

    expect(
      design.carryForward.decisions.filter(
        (decision) => decision.role === "ACCESSORY" && decision.action === "keep"
      )
    ).toHaveLength(4);
    expect(
      design.carryForward.decisions.find((decision) => decision.exerciseId === "curl")
    ).toEqual(
      expect.objectContaining({
        action: "rotate",
        signalQuality: "medium",
        reasonCodes: [
          "accessory_rotation_slot_capacity_cap",
          "accessory_continuity_supported_by_advancing_exposure",
        ],
      })
    );
  });

  it("falls back to intent-level targeting when repeated-slot mapping is not exact", () => {
    const design = designNextMesocycle(
      buildContext({
        constraints: {
          availableDaysPerWeek: 2,
        },
        preferences: {
          preferredSessionsPerWeek: 2,
          preferredSessionsPerWeekSource: "constraints_days_per_week",
          preferredSplitType: "UPPER_LOWER",
          preferredSplitTypeSource: "constraints_split_type",
        },
        carryForwardCandidateEvidence: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            role: "CORE_COMPOUND",
            priorIntent: "UPPER",
            priorSlotId: "upper_b",
            anchorLevel: "required",
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
        targetIntent: "UPPER",
        targetSlotId: undefined,
        reasonCodes: ["required_anchor_continuity_supported_by_receipt_slot"],
      }),
    ]);
  });
});
