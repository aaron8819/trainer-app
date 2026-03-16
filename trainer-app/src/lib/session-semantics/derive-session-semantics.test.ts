import { describe, expect, it } from "vitest";

import { deriveSessionSemantics } from "./derive-session-semantics";

function buildMetadata(exceptionCode?: string) {
  return {
    sessionDecisionReceipt: {
      version: 1,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 4,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      lifecycleVolume: {
        source: "unknown",
      },
      sorenessSuppressedMuscles: [],
      deloadDecision: {
        mode: "none",
        reason: [],
        reductionPercent: 0,
        appliedTo: "none",
      },
      readiness: {
        wasAutoregulated: false,
        signalAgeHours: null,
        fatigueScoreOverall: null,
        intensityScaling: {
          applied: false,
          exerciseIds: [],
          scaledUpCount: 0,
          scaledDownCount: 0,
        },
      },
      exceptions: exceptionCode
        ? [
            {
              code: exceptionCode,
              message: `Marked as ${exceptionCode}.`,
            },
          ]
        : [],
    },
  };
}

describe("deriveSessionSemantics", () => {
  it("classifies advancing sessions from advancesSplit=true", () => {
    expect(
      deriveSessionSemantics({
        advancesSplit: true,
        selectionMode: "AUTO",
        sessionIntent: "PULL",
      })
    ).toMatchObject({
      kind: "advancing",
      isDeload: false,
      advancesLifecycle: true,
      consumesWeeklyScheduleIntent: true,
      countsTowardCompliance: true,
      countsTowardRecentStimulus: true,
      countsTowardWeeklyVolume: true,
      countsTowardProgressionHistory: true,
      countsTowardPerformanceHistory: true,
      updatesProgressionAnchor: true,
      eligibleForUniqueIntentSubtraction: true,
    });
  });

  it("classifies strict gap-fill sessions without changing progression eligibility", () => {
    expect(
      deriveSessionSemantics({
        advancesSplit: false,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
        selectionMetadata: buildMetadata("optional_gap_fill"),
      })
    ).toMatchObject({
      kind: "gap_fill",
      isDeload: false,
      isStrictGapFill: true,
      advancesLifecycle: false,
      consumesWeeklyScheduleIntent: false,
      countsTowardCompliance: true,
      countsTowardRecentStimulus: true,
      countsTowardWeeklyVolume: true,
      countsTowardProgressionHistory: true,
      countsTowardPerformanceHistory: true,
      updatesProgressionAnchor: true,
      eligibleForUniqueIntentSubtraction: false,
    });
  });

  it("classifies strict supplemental sessions as progression-ineligible", () => {
    expect(
      deriveSessionSemantics({
        advancesSplit: false,
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
        selectionMetadata: buildMetadata("supplemental_deficit_session"),
      })
    ).toMatchObject({
      kind: "supplemental",
      isDeload: false,
      isStrictSupplemental: true,
      advancesLifecycle: false,
      consumesWeeklyScheduleIntent: false,
      countsTowardCompliance: true,
      countsTowardRecentStimulus: true,
      countsTowardWeeklyVolume: true,
      countsTowardProgressionHistory: false,
      countsTowardPerformanceHistory: false,
      updatesProgressionAnchor: false,
      eligibleForUniqueIntentSubtraction: false,
    });
  });

  it("classifies non-advancing generic sessions separately from supplemental and gap-fill", () => {
    expect(
      deriveSessionSemantics({
        advancesSplit: false,
        selectionMode: "MANUAL",
        sessionIntent: "PUSH",
        templateId: "template-1",
      })
    ).toMatchObject({
      kind: "non_advancing_generic",
      isDeload: false,
      isStrictGapFill: false,
      isStrictSupplemental: false,
      advancesLifecycle: false,
      consumesWeeklyScheduleIntent: false,
      countsTowardCompliance: true,
      countsTowardRecentStimulus: true,
      countsTowardWeeklyVolume: true,
      countsTowardProgressionHistory: true,
      countsTowardPerformanceHistory: true,
      updatesProgressionAnchor: true,
      eligibleForUniqueIntentSubtraction: false,
    });
  });

  it("treats null and undefined advancesSplit as advancing for compatibility", () => {
    expect(
      deriveSessionSemantics({
        advancesSplit: undefined,
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
      }).advancesLifecycle
    ).toBe(true);

    expect(
      deriveSessionSemantics({
        advancesSplit: null,
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
      }).advancesLifecycle
    ).toBe(true);
  });

  it("marks scheduled deload sessions as compliance-valid but progression/performance-ineligible", () => {
    expect(
      deriveSessionSemantics({
        advancesSplit: true,
        selectionMode: "INTENT",
        sessionIntent: "PUSH",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 5,
              weekInBlock: 1,
              phase: "deload",
              blockType: "deload",
              isDeload: true,
              source: "computed",
            },
            lifecycleVolume: {
              source: "unknown",
            },
            sorenessSuppressedMuscles: [],
            deloadDecision: {
              mode: "scheduled",
              reason: ["Scheduled deload week."],
              reductionPercent: 50,
              appliedTo: "volume",
            },
            readiness: {
              wasAutoregulated: false,
              signalAgeHours: null,
              fatigueScoreOverall: null,
              intensityScaling: {
                applied: false,
                exerciseIds: [],
                scaledUpCount: 0,
                scaledDownCount: 0,
              },
            },
            exceptions: [],
          },
        },
      })
    ).toMatchObject({
      kind: "advancing",
      isDeload: true,
      advancesLifecycle: true,
      consumesWeeklyScheduleIntent: true,
      countsTowardCompliance: true,
      countsTowardRecentStimulus: true,
      countsTowardWeeklyVolume: true,
      countsTowardProgressionHistory: false,
      countsTowardPerformanceHistory: false,
      updatesProgressionAnchor: false,
      eligibleForUniqueIntentSubtraction: true,
    });
  });
});
