import { describe, expect, it } from "vitest";

import { buildSessionDecisionReceipt, readSessionDecisionReceipt } from "./session-decision-receipt";

describe("readSessionDecisionReceipt", () => {
  it("prefers the canonical persisted receipt over legacy top-level mirrors", () => {
    const receipt = readSessionDecisionReceipt({
      cycleContext: {
        weekInMeso: 99,
        weekInBlock: 99,
        phase: "deload",
        blockType: "deload",
        isDeload: true,
        source: "fallback",
      },
      lifecycleRirTarget: { min: 0, max: 0 },
      lifecycleVolumeTargets: { Chest: 99 },
      sorenessSuppressedMuscles: ["Chest"],
      deloadDecision: {
        mode: "reactive",
        reason: ["legacy"],
        reductionPercent: 60,
        appliedTo: "both",
      },
      sessionDecisionReceipt: {
        version: 1,
        cycleContext: {
          weekInMeso: 4,
          weekInBlock: 2,
          mesocycleLength: 6,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        lifecycleRirTarget: { min: 2, max: 3 },
        lifecycleVolume: {
          targets: { Chest: 16 },
          source: "lifecycle",
        },
        sorenessSuppressedMuscles: [],
        deloadDecision: {
          mode: "none",
          reason: [],
          reductionPercent: 0,
          appliedTo: "none",
        },
        plannerDiagnosticsMode: "debug",
        plannerDiagnostics: {
          muscles: {
            Chest: {
              weeklyTarget: 16,
              performedEffectiveVolumeBeforeSession: 6,
              plannedEffectiveVolumeAfterRoleBudgeting: 4,
              projectedEffectiveVolumeAfterRoleBudgeting: 10,
              deficitAfterRoleBudgeting: 6,
              plannedEffectiveVolumeAfterClosure: 6,
              projectedEffectiveVolumeAfterClosure: 12,
              finalRemainingDeficit: 4,
            },
          },
          exercises: {
            ex1: {
              exerciseId: "ex1",
              exerciseName: "Bench Press",
              assignedSetCount: 4,
              stimulusVector: { Chest: 1, Triceps: 0.35 },
              anchorUsed: { kind: "muscle", muscle: "chest" },
              anchorBudgetDecision: {
                weeklyTarget: 16,
                performedEffectiveVolumeBeforeSession: 6,
                plannedEffectiveVolumeBeforeAssignment: 0,
                reservedEffectiveVolumeForRemainingRoleFixtures: 1,
                anchorRemainingBeforeAssignment: 9,
                anchorContributionPerSet: 1,
                desiredSetTarget: 5,
                anchorConstrainedContinuousSetTarget: 5,
              },
              overshootAdjustmentsApplied: {
                initialSetTarget: 5,
                finalSetTarget: 4,
                reductionsApplied: 1,
                limitingMuscles: ["Triceps"],
              },
              isRoleFixture: true,
              isClosureAddition: false,
              isSetExpandedCarryover: true,
              closureSetDelta: 1,
            },
          },
          closure: {
            actions: [
              {
                exerciseId: "ex1",
                exerciseName: "Bench Press",
                kind: "expand",
                setDelta: 1,
                deficitReduction: 1,
                collateralOvershoot: 0,
                fatigueCost: 4,
                score: 96,
              },
            ],
            firstIterationCandidates: [
              {
                exerciseId: "ex1",
                exerciseName: "Bench Press",
                kind: "expand",
                setDelta: 1,
                dominantDeficitMuscleId: "chest",
                dominantDeficitRemaining: 6,
                dominantDeficitContribution: 1,
                decision: "selected",
                deficitReduction: 1,
                dominantDeficitReduction: 1,
                collateralOvershoot: 0,
                fatigueCost: 4,
                score: 96,
              },
            ],
          },
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
    });

    expect(receipt?.cycleContext.weekInMeso).toBe(4);
    expect(receipt?.lifecycleRirTarget).toEqual({ min: 2, max: 3 });
    expect(receipt?.lifecycleVolume.targets).toEqual({ Chest: 16 });
    expect(receipt?.sorenessSuppressedMuscles).toEqual([]);
    expect(receipt?.deloadDecision.mode).toBe("none");
    expect(receipt?.plannerDiagnostics?.muscles.Chest.plannedEffectiveVolumeAfterClosure).toBe(6);
    expect(receipt?.plannerDiagnosticsMode).toBe("debug");
    expect(receipt?.plannerDiagnostics?.closure.actions[0]?.kind).toBe("expand");
    expect(receipt?.plannerDiagnostics?.closure.firstIterationCandidates?.[0]?.exerciseId).toBe("ex1");
  });

  it("returns undefined when no canonical persisted receipt exists", () => {
    const receipt = readSessionDecisionReceipt({
      cycleContext: {
        weekInMeso: 3,
        weekInBlock: 3,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      deloadDecision: {
        mode: "scheduled",
        reason: ["legacy deload"],
        reductionPercent: 50,
        appliedTo: "both",
      },
    });

    expect(receipt).toBeUndefined();
  });

  it("defaults to standard diagnostics mode and strips closure candidate trace", () => {
    const receipt = buildSessionDecisionReceipt({
      cycleContext: {
        weekInMeso: 2,
        weekInBlock: 2,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      plannerDiagnostics: {
        muscles: {
          Chest: {
            weeklyTarget: 12,
            performedEffectiveVolumeBeforeSession: 4,
            plannedEffectiveVolumeAfterRoleBudgeting: 3,
            projectedEffectiveVolumeAfterRoleBudgeting: 7,
            deficitAfterRoleBudgeting: 5,
            plannedEffectiveVolumeAfterClosure: 5,
            projectedEffectiveVolumeAfterClosure: 9,
            finalRemainingDeficit: 3,
          },
        },
        exercises: {},
        closure: {
          actions: [],
          firstIterationCandidates: [
            {
              exerciseId: "ex1",
              kind: "expand",
              setDelta: 1,
              dominantDeficitMuscleId: "chest",
              dominantDeficitRemaining: 5,
              dominantDeficitContribution: 1,
              decision: "selected",
              score: 90,
            },
          ],
        },
      },
    });

    expect(receipt.plannerDiagnosticsMode).toBe("standard");
    expect(receipt.plannerDiagnostics?.closure.firstIterationCandidates).toBeUndefined();
  });

  it("keeps closure candidate trace when debug diagnostics mode is requested", () => {
    const receipt = buildSessionDecisionReceipt({
      cycleContext: {
        weekInMeso: 2,
        weekInBlock: 2,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      plannerDiagnosticsMode: "debug",
      plannerDiagnostics: {
        muscles: {
          Chest: {
            weeklyTarget: 12,
            performedEffectiveVolumeBeforeSession: 4,
            plannedEffectiveVolumeAfterRoleBudgeting: 3,
            projectedEffectiveVolumeAfterRoleBudgeting: 7,
            deficitAfterRoleBudgeting: 5,
            plannedEffectiveVolumeAfterClosure: 5,
            projectedEffectiveVolumeAfterClosure: 9,
            finalRemainingDeficit: 3,
          },
        },
        exercises: {},
        closure: {
          actions: [],
          firstIterationCandidates: [
            {
              exerciseId: "ex1",
              kind: "expand",
              setDelta: 1,
              dominantDeficitMuscleId: "chest",
              dominantDeficitRemaining: 5,
              dominantDeficitContribution: 1,
              decision: "selected",
              score: 90,
            },
          ],
        },
      },
    });

    expect(receipt.plannerDiagnosticsMode).toBe("debug");
    expect(receipt.plannerDiagnostics?.closure.firstIterationCandidates?.[0]?.exerciseId).toBe("ex1");
  });
});
