import { describe, expect, it } from "vitest";
import {
  buildWeekCloseHandoffConclusions,
  classifyOptionalGapFillBasis,
  readPostWeekCloseDeficits,
  readPreWeekCloseDeficits,
} from "./week-close-handoff";

describe("readPreWeekCloseDeficits", () => {
  it("extracts unresolved receipt deficits with future-capacity context", () => {
    const deficits = readPreWeekCloseDeficits({
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 4,
          weekInBlock: 4,
          phase: "ACCUMULATION",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        deloadDecision: {
          mode: "none",
          reason: [],
          reductionPercent: 0,
          appliedTo: "none",
        },
        lifecycleVolume: {
          source: "lifecycle",
        },
        plannerDiagnosticsMode: "debug",
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
        plannerDiagnostics: {
          muscles: {},
          exercises: {},
          closure: {
            eligible: false,
            used: false,
            eligibleExerciseIds: [],
            actions: [],
          },
          opportunity: {
            opportunityKey: "push",
            sessionIntent: "push",
            sessionCharacter: "upper",
            planningInventoryKind: "standard",
            currentSessionMuscleOpportunity: {
              Chest: {
                sessionOpportunityWeight: 1,
                weeklyTarget: 12,
                performedEffectiveVolumeBeforeSession: 6,
                startingDeficit: 6,
                futureCapacity: 0,
                requiredNow: 2,
              },
            },
          },
          outcome: {
            layersUsed: ["anchor", "standard", "closure"],
            startingDeficits: {},
            deficitsAfterBaseSession: {},
            deficitsAfterSupplementation: {},
            deficitsAfterClosure: {
              Chest: {
                weeklyTarget: 12,
                performedEffectiveVolumeBeforeSession: 6,
                plannedEffectiveVolume: 4,
                projectedEffectiveVolume: 10,
                remainingDeficit: 2,
              },
            },
            unresolvedDeficits: ["Chest"],
            keyTradeoffs: [],
          },
        },
      },
    });

    expect(deficits).toEqual([
      {
        muscle: "Chest",
        remainingDeficit: 2,
        weeklyTarget: 12,
        projectedEffectiveVolume: 10,
        futureCapacity: 0,
        requiredNow: 2,
      },
    ]);
  });
});

describe("readPostWeekCloseDeficits", () => {
  it("normalizes unresolved week-close muscles", () => {
    expect(
      readPostWeekCloseDeficits({
        version: 1,
        policy: {
          requiredSessionsPerWeek: 3,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
        summary: {
          totalDeficitSets: 4,
          qualifyingMuscleCount: 1,
          topTargetMuscles: ["Chest"],
        },
        muscles: [{ muscle: "Chest", target: 12, actual: 8, deficit: 4 }],
      })
    ).toEqual([{ muscle: "Chest", deficit: 4, target: 12, actual: 8 }]);
  });
});

describe("classifyOptionalGapFillBasis", () => {
  it("marks a pending, generatable handoff as eligible", () => {
    const result = classifyOptionalGapFillBasis({
      previewOptionalGapFill: true,
      weekCloseObserved: true,
      weekClosePending: true,
      weekCloseResolution: null,
      linkedWorkoutId: null,
      targetMuscles: ["Chest", "Biceps"],
      postWeekCloseDeficits: [{ muscle: "Chest", deficit: 4, target: 12, actual: 8 }],
      previewResult: {
        status: "ok",
        exerciseCount: 3,
      },
    });

    expect(result.optionalGapFillExpected).toBe(true);
    expect(result.optionalGapFillEligible).toBe(true);
    expect(result.basis.category).toBe("eligible");
  });

  it("treats preview failure as no valid exercise inventory", () => {
    const result = classifyOptionalGapFillBasis({
      previewOptionalGapFill: true,
      weekCloseObserved: true,
      weekClosePending: true,
      weekCloseResolution: null,
      linkedWorkoutId: null,
      targetMuscles: ["Rear Delts"],
      postWeekCloseDeficits: [{ muscle: "Rear Delts", deficit: 2, target: 6, actual: 4 }],
      previewResult: {
        status: "error",
        error: "No eligible rescue inventory",
      },
    });

    expect(result.optionalGapFillEligible).toBe(false);
    expect(result.basis.category).toBe("no_valid_exercise_inventory_exists");
    expect(result.basis.reasonCode).toBe("generation_preview_failed");
  });
});

describe("buildWeekCloseHandoffConclusions", () => {
  it("keeps the warning-style boundary explicit without turning it into a blocking fail", () => {
    const conclusions = buildWeekCloseHandoffConclusions({
      boundaryWorkoutPresent: true,
      boundaryWorkoutIsFinal: true,
      weekCloseObserved: true,
      weekClosePending: true,
      strictOptionalGapFillWorkoutId: null,
      strictOptionalGapFillWorkoutStatus: null,
      weekCloseResolution: null,
      previewOptionalGapFill: true,
      linkedWorkoutId: null,
      targetMuscles: ["Chest"],
      preWeekCloseDeficits: [
        {
          muscle: "Chest",
          remainingDeficit: 2,
          weeklyTarget: 12,
          projectedEffectiveVolume: 10,
          futureCapacity: 0,
          requiredNow: 2,
        },
      ],
      postWeekCloseDeficits: [{ muscle: "Chest", deficit: 2, target: 12, actual: 10 }],
      postGapFillOpportunityDeficits: [{ muscle: "Chest", deficit: 2, target: 12, actual: 10 }],
      previewResult: {
        status: "ok",
        exerciseCount: 2,
      },
    });

    expect(conclusions.same_intent_capacity_exhausted).toBe(true);
    expect(conclusions.week_close_trigger_expected).toBe(true);
    expect(conclusions.week_close_trigger_observed).toBe(true);
    expect(conclusions.historical_mixed_contract_state.detected).toBe(false);
    expect(conclusions.optional_gap_fill_expected).toBe(true);
    expect(conclusions.optional_gap_fill_eligible).toBe(true);
  });

  it("detects historical mixed-contract state when strict optional gap-fill exists without a week-close row", () => {
    const conclusions = buildWeekCloseHandoffConclusions({
      boundaryWorkoutPresent: true,
      boundaryWorkoutIsFinal: true,
      weekCloseObserved: false,
      weekClosePending: false,
      strictOptionalGapFillWorkoutId: "workout-gap",
      strictOptionalGapFillWorkoutStatus: "COMPLETED",
      weekCloseResolution: null,
      previewOptionalGapFill: false,
      linkedWorkoutId: null,
      targetMuscles: ["Side Delts"],
      preWeekCloseDeficits: [],
      postWeekCloseDeficits: [{ muscle: "Side Delts", deficit: 4, target: 10, actual: 6 }],
      postGapFillOpportunityDeficits: [{ muscle: "Side Delts", deficit: 4, target: 10, actual: 6 }],
      previewResult: null,
    });

    expect(conclusions.historical_mixed_contract_state).toEqual(
      expect.objectContaining({
        detected: true,
        confidence: "high",
        inferenceType: "historical_mixed_contract_state",
        reasonCode: "strict_optional_gap_fill_without_week_close_owner",
        strictOptionalGapFillWorkoutId: "workout-gap",
        strictOptionalGapFillWorkoutStatus: "COMPLETED",
      })
    );
    expect(conclusions.historical_mixed_contract_state.note).toContain(
      "High-confidence inference"
    );
    expect(conclusions.historical_mixed_contract_state.note).toContain(
      "not proof of the exact historical code version"
    );
  });

  it("does not detect historical mixed-contract state when the week-close row exists", () => {
    const conclusions = buildWeekCloseHandoffConclusions({
      boundaryWorkoutPresent: true,
      boundaryWorkoutIsFinal: true,
      weekCloseObserved: true,
      weekClosePending: false,
      strictOptionalGapFillWorkoutId: "workout-gap",
      strictOptionalGapFillWorkoutStatus: "COMPLETED",
      weekCloseResolution: "GAP_FILL_COMPLETED",
      previewOptionalGapFill: false,
      linkedWorkoutId: "workout-gap",
      targetMuscles: ["Side Delts"],
      preWeekCloseDeficits: [],
      postWeekCloseDeficits: [{ muscle: "Side Delts", deficit: 4, target: 10, actual: 6 }],
      postGapFillOpportunityDeficits: [{ muscle: "Side Delts", deficit: 0, target: 10, actual: 10 }],
      previewResult: null,
    });

    expect(conclusions.historical_mixed_contract_state.detected).toBe(false);
  });

  it("does not detect historical mixed-contract state when no strict optional gap-fill workout exists", () => {
    const conclusions = buildWeekCloseHandoffConclusions({
      boundaryWorkoutPresent: true,
      boundaryWorkoutIsFinal: true,
      weekCloseObserved: false,
      weekClosePending: false,
      strictOptionalGapFillWorkoutId: null,
      strictOptionalGapFillWorkoutStatus: null,
      weekCloseResolution: null,
      previewOptionalGapFill: false,
      linkedWorkoutId: null,
      targetMuscles: ["Side Delts"],
      preWeekCloseDeficits: [],
      postWeekCloseDeficits: [{ muscle: "Side Delts", deficit: 4, target: 10, actual: 6 }],
      postGapFillOpportunityDeficits: [{ muscle: "Side Delts", deficit: 4, target: 10, actual: 6 }],
      previewResult: null,
    });

    expect(conclusions.historical_mixed_contract_state.detected).toBe(false);
  });
});
