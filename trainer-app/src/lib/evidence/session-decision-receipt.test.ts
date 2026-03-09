import { describe, expect, it } from "vitest";

import {
  buildSessionDecisionReceipt,
  normalizeSelectionMetadataWithReceipt,
  readSessionDecisionReceipt,
} from "./session-decision-receipt";

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
          blockDurationWeeks: 3,
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
          opportunity: {
            opportunityKey: "push",
            sessionIntent: "push",
            sessionCharacter: "upper",
            planningInventoryKind: "standard",
            closureInventoryKind: "closure",
            currentSessionMuscleOpportunity: {
              Chest: {
                sessionOpportunityWeight: 1,
                weeklyTarget: 16,
                performedEffectiveVolumeBeforeSession: 6,
                startingDeficit: 10,
                weeklyOpportunityUnits: 4,
                futureOpportunityUnits: 2,
                futureCapacity: 4,
                requiredNow: 6,
                urgencyMultiplier: 1.5,
              },
            },
            remainingWeek: {
              futureSlots: ["pull", "legs"],
              futureSlotCounts: { pull: 1, legs: 1 },
              futureCapacityFactor: 0.9,
            },
          },
          anchor: {
            used: true,
            policy: {
              coreMinimumSets: 1,
              accessoryMinimumSets: 0,
              coreDeferredDeficitCarryFraction: 0.4,
              accessoryDeferredDeficitCarryFraction: 0.25,
              supplementalInventory: "closure",
            },
            consideredFixtureIds: ["ex1"],
            keptFixtureIds: ["ex1"],
            droppedFixtureIds: [],
            fixtures: [
              {
                exerciseId: "ex1",
                exerciseName: "Bench Press",
                role: "CORE_COMPOUND",
                priority: "core",
                anchor: { kind: "muscle", muscle: "chest" },
                proposedSets: 5,
                minimumSets: 1,
                desiredSets: 5,
                plannedSets: 4,
                kept: true,
                decisionCode: "trimmed_by_collateral_guardrail",
                reason: "Fixture was trimmed to avoid collateral overshoot on non-anchor muscles.",
              },
            ],
          },
          standard: {
            used: true,
            reason: "standard_inventory_drove_base_selection",
            inventoryKind: "standard",
            selectedExerciseIds: ["ex1"],
            candidateCount: 1,
            candidates: [
              {
                exerciseId: "ex1",
                exerciseName: "Bench Press",
                inventoryKind: "standard",
                eligibilityReason: "eligible_by_standard_session_alignment",
                selected: true,
                selectedSets: 4,
              },
            ],
          },
          supplemental: {
            allowed: true,
            used: false,
            reason: "anchor_selection_already_satisfies_session_floor",
            inventoryKind: "closure",
            deficitsTargeted: ["Chest"],
            selectedExerciseIds: [],
            candidateCount: 0,
          },
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
            eligible: true,
            used: true,
            reason: "closure_applied",
            inventoryKind: "closure",
            eligibleExerciseIds: ["ex1"],
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
          rescue: {
            eligible: false,
            used: false,
            reason: "rescue_not_requested",
            rescueOnlyCandidateCount: 0,
            rescueOnlyExerciseIds: [],
            selectedExerciseIds: [],
          },
          outcome: {
            layersUsed: ["anchor", "standard", "closure"],
            startingDeficits: {
              Chest: {
                weeklyTarget: 16,
                performedEffectiveVolumeBeforeSession: 6,
                plannedEffectiveVolume: 0,
                projectedEffectiveVolume: 6,
                remainingDeficit: 10,
              },
            },
            deficitsAfterBaseSession: {
              Chest: {
                weeklyTarget: 16,
                performedEffectiveVolumeBeforeSession: 6,
                plannedEffectiveVolume: 4,
                projectedEffectiveVolume: 10,
                remainingDeficit: 6,
              },
            },
            deficitsAfterSupplementation: {
              Chest: {
                weeklyTarget: 16,
                performedEffectiveVolumeBeforeSession: 6,
                plannedEffectiveVolume: 4,
                projectedEffectiveVolume: 10,
                remainingDeficit: 6,
              },
            },
            deficitsAfterClosure: {
              Chest: {
                weeklyTarget: 16,
                performedEffectiveVolumeBeforeSession: 6,
                plannedEffectiveVolume: 6,
                projectedEffectiveVolume: 12,
                remainingDeficit: 4,
              },
            },
            unresolvedDeficits: ["Chest"],
            keyTradeoffs: [
              {
                layer: "closure",
                code: "closure_expand",
                message: "Bench Press won closure with expand (+1 set).",
                exerciseId: "ex1",
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
    expect(receipt?.cycleContext.blockDurationWeeks).toBe(3);
    expect(receipt?.lifecycleRirTarget).toEqual({ min: 2, max: 3 });
    expect(receipt?.lifecycleVolume.targets).toEqual({ Chest: 16 });
    expect(receipt?.sorenessSuppressedMuscles).toEqual([]);
    expect(receipt?.deloadDecision.mode).toBe("none");
    expect(receipt?.plannerDiagnostics?.muscles.Chest.plannedEffectiveVolumeAfterClosure).toBe(6);
    expect(receipt?.plannerDiagnosticsMode).toBe("debug");
    expect(receipt?.plannerDiagnostics?.opportunity?.sessionIntent).toBe("push");
    expect(receipt?.plannerDiagnostics?.anchor?.fixtures[0]?.decisionCode).toBe("trimmed_by_collateral_guardrail");
    expect(receipt?.plannerDiagnostics?.standard?.candidates?.[0]?.exerciseId).toBe("ex1");
    expect(receipt?.plannerDiagnostics?.closure.actions[0]?.kind).toBe("expand");
    expect(receipt?.plannerDiagnostics?.closure.firstIterationCandidates?.[0]?.exerciseId).toBe("ex1");
    expect(receipt?.plannerDiagnostics?.outcome?.layersUsed).toEqual(["anchor", "standard", "closure"]);
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
        blockDurationWeeks: 3,
        mesocycleLength: 5,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
      plannerDiagnostics: {
        standard: {
          used: true,
          reason: "standard_inventory_drove_base_selection",
          inventoryKind: "standard",
          selectedExerciseIds: ["ex1"],
          candidateCount: 1,
          candidates: [
            {
              exerciseId: "ex1",
              exerciseName: "Bench Press",
              inventoryKind: "standard",
              eligibilityReason: "eligible_by_standard_session_alignment",
              selected: true,
            },
          ],
        },
        supplemental: {
          allowed: true,
          used: false,
          reason: "anchor_selection_already_satisfies_session_floor",
          inventoryKind: "closure",
          deficitsTargeted: ["Chest"],
          selectedExerciseIds: [],
          candidateCount: 1,
          candidates: [
            {
              exerciseId: "ex2",
              exerciseName: "Cable Fly",
              inventoryKind: "closure",
              eligibilityReason: "eligible_by_closure_inventory_alignment",
              selected: false,
            },
          ],
        },
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
        rescue: {
          eligible: true,
          used: false,
          reason: "rescue_inventory_available_but_not_needed",
          rescueOnlyCandidateCount: 1,
          rescueOnlyExerciseIds: ["ex3"],
          selectedExerciseIds: [],
          candidates: [
            {
              exerciseId: "ex3",
              exerciseName: "Weighted Dip",
              inventoryKind: "rescue",
              eligibilityReason: "eligible_by_rescue_inventory_alignment",
              selected: false,
            },
          ],
        },
      },
    });

    expect(receipt.plannerDiagnosticsMode).toBe("standard");
    expect(receipt.plannerDiagnostics?.standard?.candidates).toBeUndefined();
    expect(receipt.plannerDiagnostics?.supplemental?.candidates).toBeUndefined();
    expect(receipt.plannerDiagnostics?.closure.firstIterationCandidates).toBeUndefined();
    expect(receipt.plannerDiagnostics?.rescue?.candidates).toBeUndefined();
  });

  it("keeps closure candidate trace when debug diagnostics mode is requested", () => {
    const receipt = buildSessionDecisionReceipt({
      cycleContext: {
        weekInMeso: 2,
        weekInBlock: 2,
        blockDurationWeeks: 3,
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

  it("preserves only supported receipt exceptions during normalization", () => {
    const normalized = normalizeSelectionMetadataWithReceipt({
      selectionMetadata: {
        sessionDecisionReceipt: {
          version: 1,
          cycleContext: {
            weekInMeso: 3,
            weekInBlock: 3,
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
          exceptions: [
            {
              code: "optional_gap_fill",
              message: "Marked as optional gap-fill session.",
            },
            {
              code: "supplemental_deficit_session",
              message: "Marked as supplemental deficit session.",
            },
            {
              code: "unexpected_exception_code",
              message: "should be dropped",
            },
          ],
        },
      },
      cycleContext: {
        weekInMeso: 3,
        weekInBlock: 3,
        phase: "accumulation",
        blockType: "accumulation",
        isDeload: false,
        source: "computed",
      },
    });

    expect(
      (
        readSessionDecisionReceipt(normalized)?.exceptions.map((entry) => entry.code) ?? []
      )
    ).toEqual(["optional_gap_fill", "supplemental_deficit_session"]);
  });
});
