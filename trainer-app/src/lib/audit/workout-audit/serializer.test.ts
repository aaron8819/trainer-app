import { describe, expect, it } from "vitest";
import { buildV2PlannerMesocyclePolicy } from "@/lib/engine/planning/v2";
import { AUDIT_RECONSTRUCTION_GUARDRAIL } from "./constants";
import {
  buildWorkoutAuditArtifact,
  createWorkoutAuditArtifactOutput,
  serializeWorkoutAuditArtifact,
} from "./serializer";
import { expectStableArtifactSection } from "./test-helpers/audit-drift-assertions";
import type { WorkoutAuditRun } from "./types";

const baseRun: WorkoutAuditRun = {
  context: {
    mode: "future-week",
    requestedMode: "future-week",
    userId: "user-1",
    ownerEmail: "owner@test.local",
    plannerDiagnosticsMode: "standard",
    generationInput: { intent: "push" },
  },
  generatedAt: "2026-03-04T00:00:00.000Z",
  generationResult: {
    workout: {
      id: "workout-1",
      scheduledDate: "2026-03-04",
      warmup: [],
      mainLifts: [],
      accessories: [],
      estimatedMinutes: 45,
    },
    selectionMode: "INTENT",
    sessionIntent: "push",
    selection: {
      selectedExerciseIds: [],
      mainLiftIds: [],
      accessoryIds: [],
      perExerciseSetTargets: {},
      rationale: {},
      volumePlanByMuscle: {},
    },
    sraWarnings: [],
    substitutions: [],
    volumePlanByMuscle: {},
  },
};

function expectSuccessfulGeneration(
  artifact: ReturnType<typeof buildWorkoutAuditArtifact>,
) {
  const generation = artifact.generation;
  if (!generation || "error" in generation) {
    throw new Error("expected successful generation artifact");
  }
  return generation;
}

function makePlannerOwnedAccumulationProjection() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    weeks: ([2, 3, 4] as const).map((week) => ({
      week,
      phase:
        week === 4
          ? ("peak_overreach_lite" as const)
          : week === 3
            ? ("hard_accumulation" as const)
            : ("accumulation" as const),
      volumeMultiplier: week === 4 ? 1.125 : week === 3 ? 1.075 : 1,
      projectionStatus: "planner_owned_read_only" as const,
      safeForBehaviorPromotion: false as const,
      slots: [],
      validation: {
        unresolvedDemand: [],
        concentrationWarnings: [],
        duplicateWarnings: [],
        missingInputs: [],
      },
    })),
  };
}

function makeV2ExerciseSelectionPlanDiagnostic() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    status: "projected_with_limitations" as const,
    identityBasis: "week_1_selected_identities" as const,
    projectionBasis:
      "planner_owned_accumulation_projection_plus_week_1_identity_continuity" as const,
    summary: {
      weeksEvaluated: 4,
      lanesEvaluated: 1,
      preservedIdentityCount: 0,
      candidateAvailableCount: 0,
      missingCandidateCount: 1,
      classMismatchCount: 0,
      duplicateRequiresJustificationCount: 0,
      concentrationWarningCount: 0,
      blockedLaneCount: 0,
    },
    weeks: [
      {
        week: 1 as const,
        slots: [
          {
            slotId: "upper_a",
            lanes: [
              {
                laneId: "chest_anchor",
                plannedClass: ["horizontal_press"],
                primaryMuscles: ["Chest"],
                identityStatus: "missing_candidate" as const,
                laneClassStatus: "not_evaluated" as const,
                setBudgetStatus: "within_budget" as const,
                duplicateStatus: "pass" as const,
                concentrationStatus: "pass" as const,
                fatigueStatus: "not_evaluated" as const,
                inventoryStatus: "not_evaluated" as const,
                capacityStatus: "not_evaluated" as const,
                cleanAlternatives: [],
                unresolvedDemand: ["v2TargetVsNoRepairDiff:capacity_gap"],
                evidenceRefs: ["target_status:missing"],
                limitations: [
                  "week_1_selected_identity_basis",
                  "generic_per_lane_candidate_inventory_not_available",
                ],
              },
            ],
          },
        ],
      },
    ],
    blockers: [],
    warnings: ["week_1:upper_a:chest_anchor:inventory_not_evaluated"],
    missingInputs: [],
    safeForBehaviorPromotion: false as const,
  };
}

function makeV2SupportLaneProjectionDiagnostic() {
  return {
    version: 1 as const,
    source: "v2_planner_policy" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    status: "projected_with_limitations" as const,
    summary: {
      supportMusclesEvaluated: 4,
      directFloorsMet: 1,
      directFloorsBelow: 3,
      optionalActivations: 1,
      expansionRecommendations: 3,
      unrecoverableExpansions: 0,
      diagnosticOnlyWarnings: 4,
    },
    muscles: [
      {
        muscle: "Triceps" as const,
        ownerSlots: ["upper_a", "upper_b"],
        directFloor: 2,
        preferredDirectSets: 3,
        currentDirectSets: 2,
        collateralCreditUsed: 1,
        collateralCreditLimit: 2,
        weeklyTargetStatus: "below" as const,
        directFloorStatus: "met" as const,
        optionalActivationStatus: "triggered_diagnostic_only" as const,
        expansionStatus: "recoverable" as const,
        rationale: ["direct_floor_satisfaction_uses_direct_lane_sets_only"],
        limitations: ["optional_activation_does_not_create_hard_floor"],
      },
    ],
    blockers: [],
    warnings: ["Triceps:optional_activation_triggered_diagnostic_only"],
    missingInputs: [],
    safeForBehaviorPromotion: false as const,
  };
}

function makeV2DeloadProjectionDiagnostic() {
  return {
    version: 1 as const,
    source: "v2_deload_projection_diagnostic" as const,
    readOnly: true as const,
    affectsScoringOrGeneration: false as const,
    status: "projected_with_limitations" as const,
    identityBasis: "week_1_selected_identities" as const,
    projectionBasis: "v2_deload_transform_read_only" as const,
    slots: [
      {
        slotId: "upper_a",
        lanes: [
          {
            laneId: "chest_anchor",
            status: "projected_with_limitations" as const,
            limitations: ["diagnostic_only_not_runtime_consumed"],
            exercises: [
              {
                preservedIdentity: {
                  exerciseId: "bench",
                  exerciseName: "Bench Press",
                  sourceWeek: 1 as const,
                },
                week1Sets: 4,
                deloadProjectedSets: 2,
                setReductionPercent: 50,
                targetRir: "4-5",
                introducesNewMovement: false as const,
                status: "projected" as const,
                limitations: [
                  "diagnostic_only_not_runtime_consumed",
                  "preserves_week_1_identity",
                ],
              },
            ],
          },
        ],
      },
    ],
    summary: {
      identitiesPreservedCount: 1,
      movementsIntroducedCount: 0,
      totalWeek1Sets: 4,
      totalDeloadProjectedSets: 2,
      volumeReductionPercent: 50,
      blockedLaneCount: 0,
      warningCount: 0,
    },
    blockers: [],
    warnings: [],
    missingInputs: [],
    safeForBehaviorPromotion: false as const,
  };
}

describe("buildWorkoutAuditArtifact", () => {
  it("keeps identity fields in live mode", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        sanitizationLevel: "none",
      },
      baseRun,
    );

    expect(artifact.source).toBe("live");
    expect(artifact.version).toBe(4);
    expect(artifact.mode).toBe("future-week");
    expect(artifact.identity.userId).toBe("user-1");
    expect(artifact.identity.ownerEmail).toBe("owner@test.local");
    expect(artifact.request.userId).toBe("user-1");
    expect(artifact.request.ownerEmail).toBe("owner@test.local");
    expect(artifact.conclusions.next_session_basis.sourceFunction).toBe(
      "loadNextWorkoutContext",
    );
    expect(artifact.warningSummary.blockingErrors).toEqual([]);
    expect(artifact.warningSummary.counts).toEqual({
      blockingErrors: 0,
      semanticWarnings: 0,
      backgroundWarnings: 0,
    });
  });

  it("keeps CLI timing readout out of serialized artifacts", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        ownerEmail: "owner@test.local",
      },
      baseRun,
    );
    const serialized = JSON.parse(serializeWorkoutAuditArtifact(artifact));

    expect(serialized).not.toHaveProperty("timing");
    expect(JSON.stringify(serialized)).not.toContain("workout-audit:timing");
  });

  it("redacts identity fields in pii-safe mode", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        sanitizationLevel: "pii-safe",
      },
      baseRun,
    );

    expect(artifact.source).toBe("pii-safe");
    expect(artifact.identity.userId).toBe("redacted");
    expect(artifact.identity.ownerEmail).toBeUndefined();
    expect(artifact.request.userId).toBeUndefined();
    expect(artifact.request.ownerEmail).toBeUndefined();
  });

  it("normalizes outward-facing muscle scope in rich generation artifacts", () => {
    const baseGenerationResult = baseRun.generationResult;
    if (!baseGenerationResult || "error" in baseGenerationResult) {
      throw new Error("expected successful base generation fixture");
    }

    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        targetMuscles: ["Abs", "Core", "Chest"],
      },
      {
        ...baseRun,
        generationResult: {
          ...baseGenerationResult,
          volumePlanByMuscle: {
            Abs: { target: 0, planned: 2, delta: -2 },
            Core: { target: 0, planned: 1, delta: -1 },
            Chest: { target: 0, planned: 5, delta: -5 },
          },
          selection: {
            ...baseGenerationResult.selection,
            volumePlanByMuscle: {
              Abs: { target: 0, planned: 3, delta: -3 },
              Core: { target: 0, planned: 1, delta: -1 },
            },
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
              targetMuscles: ["Abs", "Core", "Chest"],
              lifecycleVolume: {
                targets: {
                  Abs: 7,
                  Core: 8,
                  Chest: 14,
                },
                source: "lifecycle",
              },
              sorenessSuppressedMuscles: ["Abs", "Core"],
              deloadDecision: {
                mode: "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
              },
              plannerDiagnosticsMode: "debug",
              plannerDiagnostics: {
                opportunity: {
                  opportunityKey: "upper",
                  sessionIntent: "upper",
                  sessionCharacter: "upper",
                  planningInventoryKind: "standard",
                  closureInventoryKind: "closure",
                  targetMuscles: ["Abs", "Core"],
                  currentSessionMuscleOpportunity: {
                    Abs: {
                      sessionOpportunityWeight: 1,
                      weeklyTarget: 7,
                      performedEffectiveVolumeBeforeSession: 1,
                      startingDeficit: 6,
                      futureOpportunityUnits: 1,
                      weeklyOpportunityUnits: 2,
                      futureCapacity: 1,
                      requiredNow: 2,
                      urgencyMultiplier: 1.2,
                    },
                    Core: {
                      sessionOpportunityWeight: 2,
                      weeklyTarget: 8,
                      performedEffectiveVolumeBeforeSession: 2,
                      startingDeficit: 6,
                      futureOpportunityUnits: 2,
                      weeklyOpportunityUnits: 3,
                      futureCapacity: 2,
                      requiredNow: 1,
                      urgencyMultiplier: 1.5,
                    },
                  },
                },
                muscles: {
                  Abs: {
                    weeklyTarget: 7,
                    performedEffectiveVolumeBeforeSession: 1,
                    plannedEffectiveVolumeAfterRoleBudgeting: 2,
                    projectedEffectiveVolumeAfterRoleBudgeting: 3,
                    deficitAfterRoleBudgeting: 4,
                    plannedEffectiveVolumeAfterClosure: 4,
                    projectedEffectiveVolumeAfterClosure: 5,
                    finalRemainingDeficit: 2,
                  },
                  Core: {
                    weeklyTarget: 8,
                    performedEffectiveVolumeBeforeSession: 2,
                    plannedEffectiveVolumeAfterRoleBudgeting: 3,
                    projectedEffectiveVolumeAfterRoleBudgeting: 4,
                    deficitAfterRoleBudgeting: 4,
                    plannedEffectiveVolumeAfterClosure: 5,
                    projectedEffectiveVolumeAfterClosure: 6,
                    finalRemainingDeficit: 2,
                  },
                },
                exercises: {
                  crunch: {
                    exerciseId: "crunch",
                    exerciseName: "Cable Crunch",
                    assignedSetCount: 4,
                    stimulusVector: {
                      Abs: 2,
                      Core: 1,
                    },
                    anchorUsed: {
                      kind: "muscle",
                      muscle: "abs",
                    },
                    isRoleFixture: false,
                    isClosureAddition: false,
                    isSetExpandedCarryover: false,
                    closureSetDelta: 0,
                  },
                },
                closure: {
                  actions: [],
                },
                outcome: {
                  layersUsed: ["anchor", "closure"],
                  startingDeficits: {
                    Abs: {
                      weeklyTarget: 7,
                      performedEffectiveVolumeBeforeSession: 1,
                      plannedEffectiveVolume: 0,
                      projectedEffectiveVolume: 1,
                      remainingDeficit: 6,
                    },
                    Core: {
                      weeklyTarget: 8,
                      performedEffectiveVolumeBeforeSession: 2,
                      plannedEffectiveVolume: 0,
                      projectedEffectiveVolume: 2,
                      remainingDeficit: 6,
                    },
                  },
                  deficitsAfterBaseSession: {},
                  deficitsAfterSupplementation: {},
                  deficitsAfterClosure: {
                    Abs: {
                      weeklyTarget: 7,
                      performedEffectiveVolumeBeforeSession: 1,
                      plannedEffectiveVolume: 2,
                      projectedEffectiveVolume: 3,
                      remainingDeficit: 4,
                    },
                    Core: {
                      weeklyTarget: 8,
                      performedEffectiveVolumeBeforeSession: 2,
                      plannedEffectiveVolume: 3,
                      projectedEffectiveVolume: 4,
                      remainingDeficit: 4,
                    },
                  },
                  unresolvedDeficits: ["Abs", "Core"],
                  keyTradeoffs: [
                    {
                      layer: "closure",
                      code: "core_tradeoff",
                      message: "Core work was preserved.",
                      muscle: "Abs",
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
          },
        },
      },
    );

    const generation = expectSuccessfulGeneration(artifact);

    expect(artifact.request.targetMuscles).toEqual(["Core", "Chest"]);
    expect(generation.volumePlanByMuscle).toEqual({
      Chest: 5,
      Core: 3,
    });
    expect(generation.selection.volumePlanByMuscle).toEqual({
      Core: 4,
    });
    expect(
      generation.selection.sessionDecisionReceipt?.lifecycleVolume.targets,
    ).toEqual({
      Chest: 14,
      Core: 15,
    });
    expect(generation.selection.sessionDecisionReceipt?.targetMuscles).toEqual([
      "Core",
      "Chest",
    ]);
    expect(
      generation.selection.sessionDecisionReceipt?.sorenessSuppressedMuscles,
    ).toEqual(["Core"]);
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics
        ?.opportunity?.currentSessionMuscleOpportunity,
    ).toEqual({
      Core: {
        sessionOpportunityWeight: 3,
        weeklyTarget: 15,
        performedEffectiveVolumeBeforeSession: 3,
        startingDeficit: 12,
        futureOpportunityUnits: 3,
        weeklyOpportunityUnits: 5,
        futureCapacity: 3,
        requiredNow: 3,
        urgencyMultiplier: 1.5,
      },
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.muscles,
    ).toEqual({
      Core: {
        weeklyTarget: 15,
        performedEffectiveVolumeBeforeSession: 3,
        plannedEffectiveVolumeAfterRoleBudgeting: 5,
        projectedEffectiveVolumeAfterRoleBudgeting: 7,
        deficitAfterRoleBudgeting: 8,
        plannedEffectiveVolumeAfterClosure: 9,
        projectedEffectiveVolumeAfterClosure: 11,
        finalRemainingDeficit: 4,
      },
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.exercises
        .crunch.stimulusVector,
    ).toEqual({
      Core: 3,
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.exercises
        .crunch.anchorUsed,
    ).toEqual({
      kind: "muscle",
      muscle: "Core",
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.startingDeficits,
    ).toEqual({
      Core: {
        weeklyTarget: 15,
        performedEffectiveVolumeBeforeSession: 3,
        plannedEffectiveVolume: 0,
        projectedEffectiveVolume: 3,
        remainingDeficit: 12,
      },
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.deficitsAfterClosure,
    ).toEqual({
      Core: {
        weeklyTarget: 15,
        performedEffectiveVolumeBeforeSession: 3,
        plannedEffectiveVolume: 5,
        projectedEffectiveVolume: 7,
        remainingDeficit: 8,
      },
    });
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.unresolvedDeficits,
    ).toEqual(["Core"]);
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.keyTradeoffs,
    ).toEqual([
      {
        layer: "closure",
        code: "core_tradeoff",
        message: "Core work was preserved.",
        muscle: "Core",
      },
    ]);
    expect(
      generation.selection.sessionDecisionReceipt?.plannerDiagnostics?.muscles
        .Abs,
    ).toBeUndefined();
  });

  it("classifies generation errors as blocking warnings", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
      },
      {
        ...baseRun,
        generationResult: { error: "generation exploded" },
      },
    );

    expect(artifact.warningSummary.blockingErrors).toEqual([
      "generation exploded",
    ]);
    expect(artifact.warningSummary.semanticWarnings).toEqual([]);
    expect(artifact.warningSummary.counts.blockingErrors).toBe(1);
  });

  it("adds normalized canonical semantics when a session snapshot is available", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
      },
      {
        ...baseRun,
        sessionSnapshot: {
          version: 1,
          generated: {
            selectionMode: "INTENT",
            sessionIntent: "push",
            cycleContext: {
              weekInMeso: 5,
              weekInBlock: 1,
              phase: "deload",
              blockType: "deload",
              isDeload: true,
              source: "computed",
            },
            semantics: {
              kind: "advancing",
              effectiveSelectionMode: "INTENT",
              isDeload: true,
              isStrictGapFill: false,
              isStrictSupplemental: false,
              advancesLifecycle: true,
              consumesWeeklyScheduleIntent: true,
              countsTowardCompliance: true,
              countsTowardRecentStimulus: true,
              countsTowardWeeklyVolume: true,
              countsTowardProgressionHistory: false,
              countsTowardPerformanceHistory: false,
              updatesProgressionAnchor: false,
              eligibleForUniqueIntentSubtraction: true,
              reasons: [],
              trace: {
                advancesSplitInput: true,
              },
            },
            exerciseCount: 0,
            hardSetCount: 0,
            exercises: [],
            traces: {
              progression: {},
            },
          },
        },
      },
    );

    expect(artifact.canonicalSemantics).toEqual({
      sourceLayer: "generated",
      phase: "deload",
      isDeload: true,
      countsTowardProgressionHistory: false,
      countsTowardPerformanceHistory: false,
      updatesProgressionAnchor: false,
    });
  });

  it("persists merged captured warnings and generation path metadata", () => {
    const baseGenerationResult = baseRun.generationResult;
    if (!baseGenerationResult || "error" in baseGenerationResult) {
      throw new Error("expected base generation result");
    }

    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
      },
      {
        ...baseRun,
        context: {
          ...baseRun.context,
          mode: "future-week",
          requestedMode: "future-week",
        },
        generationPath: {
          requestedMode: "future-week",
          executionMode: "active_deload_reroute",
          generator: "generateDeloadSessionFromIntent",
          reason: "active_mesocycle_state_active_deload",
        },
        generationResult: {
          ...baseGenerationResult,
          selection: {
            ...baseGenerationResult.selection,
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 2,
                weekInBlock: 2,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              sessionProvenance: {
                mesocycleId: "meso-1",
                compositionSource: "persisted_slot_plan_seed",
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
              exceptions: [],
            },
          },
          sraWarnings: [
            {
              muscle: "Chest",
              recoveryPercent: 62,
              lastTrainedHoursAgo: 36,
              sraWindowHours: 72,
            },
          ],
        },
      },
      {
        capturedWarnings: {
          blockingErrors: [],
          semanticWarnings: [
            "[template-session] Section/role mismatch detected for bench",
          ],
          backgroundWarnings: [
            "[stimulus-profile:fallback] Ab Wheel Rollout using centralized fallback mapper.",
          ],
        },
      },
    );

    expect(artifact.generationPath).toEqual({
      requestedMode: "future-week",
      executionMode: "active_deload_reroute",
      generator: "generateDeloadSessionFromIntent",
      reason: "active_mesocycle_state_active_deload",
    });
    expect(artifact.generationProvenance).toEqual({
      receiptProvenance: {
        mesocycleId: "meso-1",
        compositionSource: "persisted_slot_plan_seed",
      },
      auditOnly: {
        generationPath: {
          requestedMode: "future-week",
          executionMode: "active_deload_reroute",
          generator: "generateDeloadSessionFromIntent",
          reason: "active_mesocycle_state_active_deload",
        },
      },
    });
    expect(
      JSON.parse(serializeWorkoutAuditArtifact(artifact)).generationProvenance,
    ).toEqual(artifact.generationProvenance);
    const generation = expectSuccessfulGeneration(artifact);
    expect(
      generation.selection.sessionDecisionReceipt?.sessionProvenance,
    ).toEqual({
      mesocycleId: "meso-1",
      compositionSource: "persisted_slot_plan_seed",
    });
    expect(
      (generation.selection.sessionDecisionReceipt as Record<string, unknown>)
        .generationPath,
    ).toBeUndefined();
    expect(artifact.warningSummary.semanticWarnings).toEqual([
      "Chest: recovery=62% last_trained_hours=36",
      "[template-session] Section/role mismatch detected for bench",
    ]);
    expect(artifact.warningSummary.backgroundWarnings).toEqual([
      "[stimulus-profile:fallback] Ab Wheel Rollout using centralized fallback mapper.",
    ]);
    expect(artifact.warningSummary.counts).toEqual({
      blockingErrors: 0,
      semanticWarnings: 2,
      backgroundWarnings: 1,
    });
  });

  it("summarizes missing legacy receipt provenance safely", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
      },
      {
        ...baseRun,
        generationPath: {
          requestedMode: "future-week",
          executionMode: "standard_generation",
          generator: "generateSessionFromIntent",
          reason: "standard_future_week_or_preview",
        },
      },
    );

    expect(artifact.generationProvenance).toEqual({
      receiptProvenance: {
        mesocycleId: null,
        compositionSource: null,
      },
      auditOnly: {
        generationPath: {
          requestedMode: "future-week",
          executionMode: "standard_generation",
          generator: "generateSessionFromIntent",
          reason: "standard_future_week_or_preview",
        },
      },
    });
    expect(artifact.generationPath).toEqual(
      artifact.generationProvenance?.auditOnly.generationPath,
    );
  });

  it("adds do-not-reconstruct guardrails for saved-only legacy audit coverage", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "progression-anchor",
        userId: "user-1",
        exerciseId: "exercise-1",
      },
      {
        ...baseRun,
        context: {
          ...baseRun.context,
          mode: "progression-anchor",
          requestedMode: "progression-anchor",
          generationInput: undefined,
        },
        generationResult: undefined,
        progressionAnchor: {
          version: 1,
          workoutId: "workout-1",
          exerciseId: "exercise-1",
          exerciseName: "Bench Press",
          scheduledDate: "2026-03-04T00:00:00.000Z",
          sessionSnapshotSource: "reconstructed_saved_only",
          trace: {
            version: 1,
            decisionSource: "double_progression",
            repRange: {
              min: 8,
              max: 10,
            },
            equipment: "barbell",
            anchor: {
              source: "conservative_modal",
              workingSetApplied: false,
              anchorLoad: 200,
              signalSetCount: 1,
              effectiveSetCount: 1,
              trimmedSetCount: 0,
              highVarianceDetected: false,
              minSignalLoad: 200,
              maxSignalLoad: 200,
              medianSignalLoad: 200,
            },
            confidence: {
              priorSessionCount: 0,
              sampleScale: 1,
              historyScale: 1,
              combinedScale: 1,
              reasons: [],
            },
            metrics: {
              medianReps: 8,
              modalRpe: 8,
              nextLoad: 200,
              loadDelta: 0,
            },
            outcome: {
              path: "fallback_hold",
              action: "hold",
              reasonCodes: ["no_change"],
            },
            decisionLog: [],
          },
        },
      },
    );

    expect(artifact.warningSummary.semanticWarnings).toContain(
      `${AUDIT_RECONSTRUCTION_GUARDRAIL} Progression-anchor coverage is using a saved-only reconstructed snapshot.`,
    );
  });

  it("serializes projected-week-volume payloads without changing unrelated audit fields", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "projected-week-volume",
        userId: "user-1",
      },
      {
        ...baseRun,
        context: {
          mode: "projected-week-volume",
          requestedMode: "projected-week-volume",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          projectedWeekVolume: {
            enabled: true,
          },
        },
        generationResult: undefined,
        projectedWeekVolume: {
          version: 1,
          currentWeek: {
            mesocycleId: "meso-1",
            week: 2,
            phase: "accumulation",
            blockType: "accumulation",
          },
          projectionNotes: [],
          completedVolumeByMuscle: {},
          projectedSessions: [],
          fullWeekByMuscle: [],
        },
      },
    );

    expect(artifact.mode).toBe("projected-week-volume");
    expect(artifact.projectedWeekVolume).toMatchObject({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 2,
      },
    });
    expect(artifact.generation).toBeUndefined();
    expect(artifact.warningSummary.counts).toEqual({
      blockingErrors: 0,
      semanticWarnings: 0,
      backgroundWarnings: 0,
    });
  });

  it("serializes weekly-retro projection delivery drift when present", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "weekly-retro",
        userId: "user-1",
        week: 3,
        mesocycleId: "meso-1",
        projectionArtifactPath: "C:\\artifacts\\projection.json",
      },
      {
        ...baseRun,
        context: {
          mode: "weekly-retro",
          requestedMode: "weekly-retro",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          weeklyRetro: {
            week: 3,
            mesocycleId: "meso-1",
            projectionArtifactPath: "C:\\artifacts\\projection.json",
          },
        },
        generationResult: undefined,
        weeklyRetro: {
          version: 1,
          week: 3,
          mesocycleId: "meso-1",
          executiveSummary: {
            status: "stable",
            generatedLayerCoverage: "full",
            sessionCount: 3,
            advancingSessionCount: 3,
            progressionEligibleCount: 3,
            progressionExcludedCount: 0,
            driftSessionCount: 0,
            belowMevCount: 0,
            underTargetCount: 0,
            overMavCount: 0,
            slotIdentityIssueCount: 0,
            highlights: [],
          },
          loadCalibration: {
            status: "aligned",
            comparableSessionCount: 3,
            driftSessionCount: 0,
            prescriptionChangeCount: 0,
            selectionDriftCount: 0,
            legacyLimitedSessionCount: 0,
            highlightedSessions: [],
          },
          sessionExecution: {
            summary: {
              sessionCount: 3,
              advancingCount: 3,
              gapFillCount: 0,
              supplementalCount: 0,
              deloadCount: 0,
              progressionEligibleCount: 3,
              progressionExcludedCount: 0,
              weekCloseRelevantCount: 0,
              persistedSnapshotCount: 3,
              reconstructedSnapshotCount: 0,
              mutationDriftCount: 0,
              statusCounts: { COMPLETED: 3 },
              intentCounts: { PUSH: 1, PULL: 1, LEGS: 1 },
            },
            sessions: [],
          },
          slotBalance: {
            status: "balanced",
            advancingSessionCount: 3,
            identifiedSlotCount: 3,
            missingSlotIdentityCount: 0,
            duplicateSlotCount: 0,
            intentMismatchCount: 0,
            missingSlotIdentityWorkoutIds: [],
            duplicateSlots: [],
            intentMismatches: [],
          },
          volumeTargeting: {
            status: "within_expected_band",
            belowMev: [],
            underTargetOnly: [],
            overMav: [],
            overTargetOnly: [],
            muscles: [],
          },
          planAdherence: {
            plannedWorkCompletedPercent: 100,
            plannedWorkMissedSets: 0,
            plannedWorkTotalSets: 45,
            plannedWorkCompletedSets: 45,
            explainedAdditions: {
              totalSets: 0,
              byIntent: {},
            },
            substitutions: 0,
            painFatigueDeviations: 0,
            unclassifiedDrift: 0,
            engineConfidenceImpact: "none",
            interpretations: [],
          },
          projectionDeliveryDrift: {
            status: "comparable",
            baseline: {
              generatedAt: "2026-04-01T12:00:00.000Z",
              projectedSessionCount: 2,
            },
            summary: {
              direction: "aligned",
              materialUnderdeliveryCount: 0,
              materialOverdeliveryCount: 0,
              netEffectiveSetDelta: 0,
            },
            muscles: [],
            limitations: [],
          },
          interventions: [],
          rootCauses: [],
          recommendedPriorities: [],
        },
      },
    );

    expect(artifact.mode).toBe("weekly-retro");
    expect(artifact.weeklyRetro?.projectionDeliveryDrift).toEqual({
      status: "comparable",
      baseline: {
        generatedAt: "2026-04-01T12:00:00.000Z",
        projectedSessionCount: 2,
      },
      summary: {
        direction: "aligned",
        materialUnderdeliveryCount: 0,
        materialOverdeliveryCount: 0,
        netEffectiveSetDelta: 0,
      },
      muscles: [],
      limitations: [],
    });
    expect(artifact.projectedWeekVolume).toBeUndefined();
  });

  it("serializes current-week-audit payloads as projected-week output plus guidance fields", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "current-week-audit",
        userId: "user-1",
      },
      {
        ...baseRun,
        context: {
          mode: "current-week-audit",
          requestedMode: "current-week-audit",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          projectedWeekVolume: {
            enabled: true,
          },
        },
        generationResult: undefined,
        projectedWeekVolume: {
          version: 1,
          currentWeek: {
            mesocycleId: "meso-1",
            week: 4,
            phase: "accumulation",
            blockType: "accumulation",
          },
          projectionNotes: [],
          completedVolumeByMuscle: {},
          projectedSessions: [],
          fullWeekByMuscle: [],
          currentWeekAudit: {
            belowMEV: [],
            overMAV: ["Glutes"],
            underTargetClusters: [],
            fatigueRisks: ["Glutes projects 2.0 sets over MAV"],
          },
          interventionHints: [],
          sessionRisks: [],
        },
      },
    );

    expect(artifact.mode).toBe("current-week-audit");
    expect(artifact.projectedWeekVolume).toMatchObject({
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 4,
      },
      currentWeekAudit: {
        overMAV: ["Glutes"],
      },
      interventionHints: [],
      sessionRisks: [],
    });
    expect(artifact.generation).toBeUndefined();
  });

  it("serializes active-mesocycle-slot-reseed payloads without attaching generation fields", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "active-mesocycle-slot-reseed",
        userId: "user-1",
      },
      {
        ...baseRun,
        context: {
          mode: "active-mesocycle-slot-reseed",
          requestedMode: "active-mesocycle-slot-reseed",
          userId: "user-1",
          plannerDiagnosticsMode: "standard",
          activeMesocycleSlotReseed: {
            enabled: true,
          },
        },
        generationResult: undefined,
        activeMesocycleSlotReseed: {
          version: 1,
          activeMesocycle: {
            mesocycleId: "meso-1",
            mesoNumber: 3,
            state: "ACTIVE_ACCUMULATION",
            week: 3,
            splitType: "UPPER_LOWER",
            targetSlotIds: ["upper_a", "upper_b"],
          },
          executiveSummary: ["Verdict: safe_to_apply_bounded_reseed."],
          persistedSeedResolution: {
            sourceModule: "slot-plan-seed.ts",
            sourceFunction: "readPersistedSeedSlots",
            runtimeRule: "normalize persisted slot seed",
          },
          freshReprojection: {
            sourceModule: "mesocycle-handoff-slot-plan-projection.ts",
            sourceFunction: "projectSuccessorSlotPlansFromSnapshot",
            runtimeRule: "reproject candidate slot seed",
          },
          candidateSessionEvaluation: {
            sourceModule: "projected-week-volume-shared.ts",
            sourceFunction: "generateProjectedSession",
            runtimeRule: "generate candidate seeded sessions",
          },
          diffArtifactDescription: "upper-slot dry-run diff",
          slotDiffs: [],
          aggregateMuscleDiff: [],
          flags: {
            improvesChestSupport: true,
            improvesTricepsSupport: true,
            improvesSideDeltSupport: false,
            improvesRearDeltSupport: false,
            improvesTierBSupport: false,
            reducesStackingPressure: false,
            reducesLowerFatigue: false,
            reducesUpperSessionDuration: false,
            preservesRowAndVerticalPullWhereAppropriate: true,
            avoidsNewObviousOvershoot: true,
            preservesSlotIdentity: true,
            materiallyChangesExerciseSelection: true,
          },
          recommendation: {
            verdict: "safe_to_apply_bounded_reseed",
            reasons: ["push support improved"],
          },
        },
      },
    );

    expect(artifact.mode).toBe("active-mesocycle-slot-reseed");
    expect(artifact.activeMesocycleSlotReseed).toMatchObject({
      version: 1,
      activeMesocycle: {
        mesocycleId: "meso-1",
        week: 3,
      },
      recommendation: {
        verdict: "safe_to_apply_bounded_reseed",
      },
    });
    expect(artifact.generation).toBeUndefined();
  });

  it("serializes mesocycle-explain payloads without attaching generation fields", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "mesocycle-explain",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        sourceMesocycleId: "meso-source",
        retrospectiveMesocycleId: "meso-retro",
      },
      {
        ...baseRun,
        context: {
          mode: "mesocycle-explain",
          requestedMode: "mesocycle-explain",
          userId: "user-1",
          ownerEmail: "owner@test.local",
          plannerDiagnosticsMode: "standard",
          mesocycleExplain: {
            sourceMesocycleId: "meso-source",
            retrospectiveMesocycleId: "meso-retro",
          },
        },
        generationResult: undefined,
        mesocycleExplain: {
          version: 1,
          sourceMesocycleId: "meso-source",
          retrospectiveMesocycleId: "meso-retro",
          preview: {
            sourceMesocycleId: "meso-source",
            rationaleBasis: "reconstructed_now",
            designBasis: {
              focus: "hypertrophy",
              splitType: "UPPER_LOWER",
              sessionsPerWeek: 4,
              daysPerWeek: 4,
              durationWeeks: 5,
              volumeTarget: "MEDIUM",
              intensityBias: "MODERATE",
              profileReasonCodes: [],
              structureReasonCodes: [],
              startingPointReasonCodes: [],
            },
            carryForwardReasons: [],
            slotPlans: [],
            projectedSessions: [],
            projectionDiagnostics: {
              label: "projection diagnostics",
              readOnly: true,
              affectsScoringOrGeneration: false,
              summary: {
                setStackingPressure: 0,
                duplicateExercisePressure: 0,
                diversityPenalties: 0,
                hingeSquatBalance: 0,
                isolationInjectionTriggers: 0,
                softCapsOverriddenByP0: 0,
              },
              constraintsTriggered: [],
              tradeoffs: [],
              softCapOverridesByP0: [],
            },
            exerciseRationale: [],
          },
          seed: {
            mesocycleId: "meso-retro",
            available: false,
            slotPlans: [],
            exerciseRationale: [],
          },
          reality: {
            mesocycleId: "meso-retro",
            workoutCount: 0,
            generatedVsSaved: [],
            runtimeDrift: [],
            exerciseRationale: [],
          },
          comparison: {
            previewVsSeed: {
              comparable: false,
              comparisonBasis: "none",
              slotDiffs: [],
            },
            seedVsReality: {
              comparable: false,
              workoutDrift: [],
            },
            previewVsReality: {
              comparable: false,
              comparisonBasis: "none",
              slotDiffs: [],
            },
          },
          limitations: ["historical ranking unavailable"],
        },
      },
    );

    expect(artifact.mode).toBe("mesocycle-explain");
    expect(artifact.generation).toBeUndefined();
    expect(artifact.mesocycleExplain).toMatchObject({
      sourceMesocycleId: "meso-source",
      retrospectiveMesocycleId: "meso-retro",
      limitations: ["historical ranking unavailable"],
    });
  });

  it("keeps full no-repair diagnostics in memory while serializing the main artifact as an operator summary", () => {
    const output = createWorkoutAuditArtifactOutput(
      {
        mode: "mesocycle-explain",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        plannerOnlyNoRepair: true,
        compareRepaired: true,
      },
      {
        ...baseRun,
        context: {
          mode: "mesocycle-explain",
          requestedMode: "mesocycle-explain",
          userId: "user-1",
          ownerEmail: "owner@test.local",
          plannerDiagnosticsMode: "standard",
          mesocycleExplain: {
            plannerOnlyNoRepair: {
              enabled: true,
              compareRepaired: true,
            },
          },
        },
        generationResult: undefined,
        mesocycleExplain: makeMesocycleExplainNoRepairPayload(),
      },
    );

    const fullNoRepair = output.artifact.mesocycleExplain?.plannerOnlyNoRepair;
    const serializedNoRepair = output.serializedArtifact.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;

    expect(fullNoRepair?.v2MesocyclePlan).toBeTruthy();
    expect(fullNoRepair?.v2SetDistributionIntent).toBeTruthy();
    expect(fullNoRepair?.v2SupportLanePolicy).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      summary: {
        policyCount: 4,
      },
    });
    expect(fullNoRepair?.v2SupportLaneProjectionDiagnostic).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      safeForBehaviorPromotion: false,
      summary: {
        supportMusclesEvaluated: 4,
      },
    });
    expect(fullNoRepair?.plannerOwnedAccumulationProjection).toBeTruthy();
    expect(fullNoRepair?.v2ExerciseSelectionPlanDiagnostic).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      identityBasis: "week_1_selected_identities",
      safeForBehaviorPromotion: false,
    });
    expect(fullNoRepair?.v2DeloadProjectionDiagnostic).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      status: "projected_with_limitations",
      identityBasis: "week_1_selected_identities",
      projectionBasis: "v2_deload_transform_read_only",
      summary: {
        identitiesPreservedCount: 1,
        movementsIntroducedCount: 0,
        volumeReductionPercent: 50,
      },
      safeForBehaviorPromotion: false,
    });
    expect(fullNoRepair?.v2TargetVsNoRepairDiff).toBeTruthy();
    expect(
      fullNoRepair?.crossWeekProjectionGate.accumulationWeeksStatus.weeks,
    ).toHaveLength(3);
    expect(serializedNoRepair).toMatchObject({
      summary: {
        status: "fail",
        replacementReadinessStatus: "blocked",
      },
      v2Summary: {
        split: "upper_lower_4x",
        weekCount: 5,
        slotCount: 1,
        exerciseSelectionPlanDiagnostic: {
          status: "projected_with_limitations",
          summary: expect.objectContaining({
            preservedIdentityCount: 0,
            missingCandidateCount: 1,
          }),
        },
        deloadProjectionDiagnostic: {
          status: "projected_with_limitations",
          summary: expect.objectContaining({
            identitiesPreservedCount: 1,
            movementsIntroducedCount: 0,
            volumeReductionPercent: 50,
          }),
          blockerCount: 0,
          warningCount: 0,
        },
        supportLanePolicy: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: {
            policyCount: 4,
          },
        },
        supportLaneProjectionDiagnostic: {
          status: "projected_with_limitations",
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: expect.objectContaining({
            supportMusclesEvaluated: 4,
            optionalActivations: 1,
          }),
          blockerCount: 0,
          warningCount: 1,
          missingInputCount: 0,
        },
      },
      debugArtifact: {
        created: false,
        enableWith: "--v2-debug-artifact",
      },
      crossWeekProjectionGate: {
        accumulationWeeksStatus: {
          status: "projected_with_limitations",
          weekCount: 3,
          projectionBasisCounts: {
            planner_owned_read_only_projection: 3,
          },
        },
        deloadStatus: {
          status: "diagnostic_projection_only",
          projectionBasis: "v2_deload_transform_read_only",
        },
        replacementReadinessStatus: "not_ready",
        safeToPromoteBehavior: false,
        blockerCount: 1,
      },
    });
    expect(serializedNoRepair).not.toHaveProperty("v2MesocyclePlan");
    expect(serializedNoRepair).not.toHaveProperty("v2SetDistributionIntent");
    expect(serializedNoRepair).not.toHaveProperty("v2SupportLanePolicy");
    expect(serializedNoRepair).not.toHaveProperty(
      "v2SupportLaneProjectionDiagnostic",
    );
    expect(serializedNoRepair).not.toHaveProperty(
      "plannerOwnedAccumulationProjection",
    );
    expect(serializedNoRepair).not.toHaveProperty(
      "v2ExerciseSelectionPlanDiagnostic",
    );
    expect(serializedNoRepair).not.toHaveProperty(
      "v2DeloadProjectionDiagnostic",
    );
    expect(serializedNoRepair).not.toHaveProperty("v2TargetVsNoRepairDiff");
    expect(
      (serializedNoRepair.crossWeekProjectionGate as Record<string, unknown>)
        .accumulationWeeksStatus,
    ).not.toHaveProperty("weeks");
    expect(output.v2DebugArtifact).toBeUndefined();
  });

  it("returns a linked V2 no-repair debug sidecar only when the explicit sidecar flag is enabled", () => {
    const mesocycleExplain = makeMesocycleExplainNoRepairPayload();
    mesocycleExplain!.plannerOnlyNoRepair?.v2TargetVsNoRepairDiff.slotDiffs[0]?.laneDiffs.push(
      {
        laneId: "biceps",
        targetRole: "accessory",
        targetPrimaryMuscles: ["Biceps"],
        targetExerciseClasses: ["biceps_isolation"],
        targetSets: { min: 2, preferred: 3, max: 3 },
        currentStatus: "partial",
        currentEvidence: {
          selectedExercises: [
            {
              name: "Barbell Curl",
              sets: 2,
              matchedClass: "biceps_curl",
              role: "accessory",
            },
          ],
          relevantDiagnostics: [
            "setPolicy:in_budget",
            "setBudget:within_preferred",
            "target_delivery:below_min",
            "exposure:single_direct_curl",
            "concentration:pulling_collateral",
          ],
        },
        gapCause: "set_distribution_gap",
        migrationRecommendation: "needs_set_distribution_policy",
        severity: "quality_warning",
      },
    );

    const output = createWorkoutAuditArtifactOutput(
      {
        mode: "mesocycle-explain",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        plannerOnlyNoRepair: true,
        compareRepaired: true,
        v2DebugArtifact: true,
      },
      {
        ...baseRun,
        context: {
          mode: "mesocycle-explain",
          requestedMode: "mesocycle-explain",
          userId: "user-1",
          ownerEmail: "owner@test.local",
          plannerDiagnosticsMode: "standard",
          mesocycleExplain: {
            sourceMesocycleId: "meso-source",
            retrospectiveMesocycleId: "meso-retro",
            plannerOnlyNoRepair: {
              enabled: true,
              compareRepaired: true,
              v2DebugArtifact: true,
            },
          },
        },
        generationResult: undefined,
        mesocycleExplain,
      },
      {
        artifactFileName: "parent.json",
        artifactRelativePath: "artifacts/audits/parent.json",
        v2DebugArtifactFileName: "parent-v2-no-repair-debug.json",
        v2DebugArtifactRelativePath:
          "artifacts/audits/parent-v2-no-repair-debug.json",
      },
    );
    const mainNoRepair = output.serializedArtifact.mesocycleExplain
      ?.plannerOnlyNoRepair as unknown as Record<string, unknown>;

    expectStableArtifactSection(
      {
        plannerOnlyNoRepair:
          output.artifact.mesocycleExplain?.plannerOnlyNoRepair,
      },
      output.v2DebugArtifact?.artifact,
      "plannerOnlyNoRepair.repairPromotionScoreboard",
    );
    expect(output.v2DebugArtifact).toMatchObject({
      fileName: "parent-v2-no-repair-debug.json",
      relativePath: "artifacts/audits/parent-v2-no-repair-debug.json",
      sizeBytes: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(mainNoRepair.debugArtifact).toMatchObject({
      kind: "v2_planner_no_repair_debug",
      created: true,
      fileName: "parent-v2-no-repair-debug.json",
      relativePath: "artifacts/audits/parent-v2-no-repair-debug.json",
      sizeBytes: output.v2DebugArtifact?.sizeBytes,
      sha256: output.v2DebugArtifact?.sha256,
    });
    expect(mainNoRepair.v2Summary).toMatchObject({
      repairPromotionScoreboard: {
        rawRepairEvidence: {
          materialRepairCount: 2,
          majorRepairCount: 1,
          suspiciousRepairCount: 1,
        },
        summary: {
          promotionCandidateCount: 1,
          safetyNetCount: 1,
          diagnosticOnlyCount: 1,
        },
      },
    });
    expect(JSON.stringify(mainNoRepair.v2Summary)).not.toContain(
      "promotionCandidates",
    );
    expect(output.v2DebugArtifact?.artifact.parent).toMatchObject({
      fileName: "parent.json",
      relativePath: "artifacts/audits/parent.json",
      mode: "mesocycle-explain",
      sourceMesocycleId: "meso-source",
      retrospectiveMesocycleId: "meso-retro",
      requestFlags: [
        "--mode mesocycle-explain",
        "--planner-only-no-repair",
        "--compare-repaired",
        "--v2-debug-artifact",
      ],
    });
    expect(output.v2DebugArtifact?.artifact).toMatchObject({
      readOnly: true,
      affectsScoringOrGeneration: false,
      plannerOnlyNoRepair: {
        crossWeekProjectionGate: {
          readOnly: true,
          affectsScoringOrGeneration: false,
          accumulationWeeksStatus: {
            weeks: expect.arrayContaining([
              expect.objectContaining({
                week: 2,
                safeForBehaviorPromotion: false,
              }),
            ]),
          },
          deloadStatus: {
            safeForBehaviorPromotion: false,
          },
          safeToPromoteBehavior: false,
        },
        repairPromotionScoreboard: {
          promotionCandidates: [
            expect.objectContaining({
              slotId: "upper_b",
              muscle: "Chest",
              exerciseName: "Incline DB Bench",
            }),
          ],
          rawSuspiciousRows: [
            expect.objectContaining({
              exerciseName: "Cable Pullover",
            }),
          ],
          doNotPromoteRows: expect.arrayContaining([
            expect.objectContaining({
              reason: "raw_suspicious_do_not_promote",
            }),
            expect.objectContaining({
              reason: "materiality_none_or_diagnostic_denominator_artifact",
            }),
          ]),
        },
        v2MesocyclePlan: expect.any(Object),
        v2SetDistributionIntent: expect.any(Object),
        v2SupportLanePolicy: expect.objectContaining({
          readOnly: true,
          affectsScoringOrGeneration: false,
          summary: expect.objectContaining({
            policyCount: 4,
          }),
        }),
        v2SupportLaneProjectionDiagnostic: expect.objectContaining({
          readOnly: true,
          affectsScoringOrGeneration: false,
          safeForBehaviorPromotion: false,
          muscles: expect.arrayContaining([
            expect.objectContaining({
              muscle: "Triceps",
              optionalActivationStatus: "triggered_diagnostic_only",
            }),
          ]),
        }),
        plannerOwnedAccumulationProjection: expect.objectContaining({
          readOnly: true,
          affectsScoringOrGeneration: false,
          weeks: expect.arrayContaining([
            expect.objectContaining({
              week: 2,
              projectionStatus: "planner_owned_read_only",
              safeForBehaviorPromotion: false,
            }),
          ]),
        }),
        v2ExerciseSelectionPlanDiagnostic: expect.objectContaining({
          readOnly: true,
          affectsScoringOrGeneration: false,
          identityBasis: "week_1_selected_identities",
          projectionBasis:
            "planner_owned_accumulation_projection_plus_week_1_identity_continuity",
          safeForBehaviorPromotion: false,
          weeks: expect.arrayContaining([
            expect.objectContaining({
              week: 1,
              slots: expect.arrayContaining([
                expect.objectContaining({
                  slotId: "upper_a",
                  lanes: expect.arrayContaining([
                    expect.objectContaining({
                      laneId: "chest_anchor",
                      identityStatus: "missing_candidate",
                      inventoryStatus: "not_evaluated",
                      cleanAlternatives: [],
                    }),
                  ]),
                }),
              ]),
            }),
          ]),
        }),
        v2DeloadProjectionDiagnostic: expect.objectContaining({
          readOnly: true,
          affectsScoringOrGeneration: false,
          identityBasis: "week_1_selected_identities",
          projectionBasis: "v2_deload_transform_read_only",
          status: "projected_with_limitations",
          slots: expect.arrayContaining([
            expect.objectContaining({
              slotId: "upper_a",
              lanes: expect.arrayContaining([
                expect.objectContaining({
                  laneId: "chest_anchor",
                  exercises: expect.arrayContaining([
                    expect.objectContaining({
                      preservedIdentity: expect.objectContaining({
                        exerciseName: "Bench Press",
                        sourceWeek: 1,
                      }),
                      week1Sets: 4,
                      deloadProjectedSets: 2,
                      setReductionPercent: 50,
                      targetRir: "4-5",
                      introducesNewMovement: false,
                    }),
                  ]),
                }),
              ]),
            }),
          ]),
        }),
        v2TargetVsNoRepairDiff: expect.any(Object),
        laneEvidence: expect.arrayContaining([
          expect.objectContaining({
            slotId: "upper_a",
            laneId: "chest_anchor",
          }),
        ]),
      },
    });
    expect(
      output.v2DebugArtifact?.artifact.plannerOnlyNoRepair
        .v2TargetVsNoRepairDiff.slotDiffs[0]?.laneDiffs,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          laneId: "biceps",
          currentEvidence: expect.objectContaining({
            selectedExercises: [
              expect.objectContaining({
                name: "Barbell Curl",
                matchedClass: "biceps_curl",
              }),
            ],
            relevantDiagnostics: expect.arrayContaining([
              "target_delivery:below_min",
              "concentration:pulling_collateral",
            ]),
          }),
        }),
      ]),
    );
    expect(output.sizeBytes).toBeLessThan(1_048_576);
  });
});

function makeMesocycleExplainNoRepairPayload() {
  return {
    version: 1,
    sourceMesocycleId: "meso-source",
    retrospectiveMesocycleId: "meso-retro",
    preview: {
      sourceMesocycleId: "meso-source",
      rationaleBasis: "reconstructed_now",
      designBasis: {
        focus: "hypertrophy",
        splitType: "UPPER_LOWER",
        sessionsPerWeek: 4,
        daysPerWeek: 4,
        durationWeeks: 5,
        volumeTarget: "MEDIUM",
        intensityBias: "MODERATE",
        profileReasonCodes: [],
        structureReasonCodes: [],
        startingPointReasonCodes: [],
      },
      carryForwardReasons: [],
      slotPlans: [],
      projectedSessions: [],
      projectionDiagnostics: {
        label: "projection diagnostics",
        readOnly: true,
        affectsScoringOrGeneration: false,
        summary: {
          setStackingPressure: 0,
          duplicateExercisePressure: 0,
          diversityPenalties: 0,
          hingeSquatBalance: 0,
          isolationInjectionTriggers: 0,
          softCapsOverriddenByP0: 0,
        },
        constraintsTriggered: [],
        tradeoffs: [],
        softCapOverridesByP0: [],
      },
      exerciseRationale: [],
    },
    seed: {
      mesocycleId: "meso-retro",
      available: false,
      slotPlans: [],
      exerciseRationale: [],
    },
    reality: {
      mesocycleId: "meso-retro",
      workoutCount: 0,
      generatedVsSaved: [],
      runtimeDrift: [],
      exerciseRationale: [],
    },
    comparison: {
      previewVsSeed: {
        comparable: false,
        comparisonBasis: "none",
        slotDiffs: [],
      },
      seedVsReality: {
        comparable: false,
        workoutDrift: [],
      },
      previewVsReality: {
        comparable: false,
        comparisonBasis: "none",
        slotDiffs: [],
      },
    },
    limitations: [],
    plannerOnlyNoRepair: {
      enabled: true,
      readOnly: true,
      affectsScoringOrGeneration: false,
      canReplaceRepairedProjection: false,
      summary: {
        status: "fail",
        targetLanesSatisfied: 0,
        targetLanesMissing: 1,
        unresolvedDemandCount: 1,
        validationFailureCount: 1,
      },
      acceptanceClassification: {
        basicMesocycleShapeStatus: "fail",
        replacementReadinessStatus: "blocked",
        hardBlockers: [
          {
            code: "primary_hard_target_below_minimum",
            evidence: ["upper_a:Chest:below_minimum"],
          },
        ],
        qualityWarnings: [],
        diagnosticOnly: [],
        sessionShaping: [],
        migrationScoreboard: {
          materialRepairCount: 1,
          majorRepairCount: 0,
          suspiciousRepairs: 0,
          canReplaceRepairedProjection: false,
          reason: "blocked",
        },
      },
      repairPromotionScoreboard: {
        version: 1,
        readOnly: true,
        affectsScoringOrGeneration: false,
        source: "repaired_planning_reality",
        rawRepairEvidence: {
          rawRowCount: 3,
          materialRepairCount: 2,
          majorRepairCount: 1,
          likelyAvoidableMaterialRepairCount: 1,
          remainingMaterialRepairCount: 1,
          suspiciousRepairCount: 1,
        },
        summary: {
          promotionCandidateCount: 1,
          doNotPromoteCount: 2,
          safetyNetCount: 1,
          collateralDiagnosticCount: 0,
          diagnosticOnlyCount: 1,
        },
        promotionCandidates: [
          {
            slotId: "upper_b",
            muscle: "Chest",
            exerciseName: "Incline DB Bench",
            action: "set_bumped",
            materiality: "major",
            repairMechanism: "support_floor_closure",
            correctOwner: "SlotDemandAllocationByWeek",
            evidence: [
              "shadowAllocationBasis:slot_owned_muscle_before_selection",
            ],
          },
        ],
        doNotPromoteRows: [
          {
            slotId: "upper_a",
            muscle: "Lats",
            exerciseName: "Cable Pullover",
            action: "removed",
            materiality: "major",
            repairMechanism: "forbidden_cleanup",
            reason: "raw_suspicious_do_not_promote",
            demotionReasons: ["raw_suspicious_do_not_promote"],
            bucket: "safety_net",
            evidence: ["action:removed"],
          },
          {
            slotId: null,
            muscle: "Chest",
            exerciseName: null,
            action: "diagnostic_only",
            materiality: "none",
            repairMechanism: "diagnostic_denominator",
            reason: "materiality_none_or_diagnostic_denominator_artifact",
            demotionReasons: [
              "materiality_none_or_diagnostic_denominator_artifact",
            ],
            bucket: "diagnostic_only",
            evidence: ["materiality:none"],
          },
        ],
        safetyNetRows: [
          {
            slotId: "upper_a",
            muscle: "Lats",
            exerciseName: "Cable Pullover",
            action: "removed",
            materiality: "major",
            repairMechanism: "forbidden_cleanup",
            reason: "raw_suspicious_do_not_promote",
            demotionReasons: ["raw_suspicious_do_not_promote"],
            evidence: ["action:removed"],
          },
        ],
        collateralDiagnosticRows: [],
        diagnosticRows: [
          {
            slotId: null,
            muscle: "Chest",
            exerciseName: null,
            action: "diagnostic_only",
            materiality: "none",
            repairMechanism: "diagnostic_denominator",
            reason: "materiality_none_or_diagnostic_denominator_artifact",
            demotionReasons: [
              "materiality_none_or_diagnostic_denominator_artifact",
            ],
            evidence: ["materiality:none"],
          },
        ],
        rawSuspiciousRows: [
          {
            slotId: "upper_a",
            muscle: "Lats",
            exerciseName: "Cable Pullover",
            repairMechanism: "forbidden_cleanup",
            reason: "do_not_promote",
            recommendation: "Do not promote this repair upstream.",
          },
        ],
      },
      crossWeekProjectionGate: {
        readOnly: true,
        affectsScoringOrGeneration: false,
        week1Status: {
          status: "fail",
          basis: ["basicMesocycleShapeStatus:fail"],
        },
        accumulationWeeksStatus: {
          status: "projected_with_limitations",
          weeks: [
            {
              week: 2,
              phase: "accumulation",
              volumeMultiplier: 1,
              rirTarget: "2-3",
              projectionBasis: "planner_owned_read_only_projection",
              limitations: [
                "planner_owned_week_projection_exists_but_is_diagnostic_only",
              ],
              safeForBehaviorPromotion: false,
            },
            {
              week: 3,
              phase: "hard_accumulation",
              volumeMultiplier: 1.075,
              rirTarget: "1-2",
              projectionBasis: "planner_owned_read_only_projection",
              limitations: [
                "planner_owned_week_projection_exists_but_is_diagnostic_only",
              ],
              safeForBehaviorPromotion: false,
            },
            {
              week: 4,
              phase: "peak_overreach_lite",
              volumeMultiplier: 1.125,
              rirTarget: "0-1",
              projectionBasis: "planner_owned_read_only_projection",
              limitations: [
                "planner_owned_week_projection_exists_but_is_diagnostic_only",
              ],
              safeForBehaviorPromotion: false,
            },
          ],
        },
        deloadStatus: {
          status: "diagnostic_projection_only",
          projectionBasis: "v2_deload_transform_read_only",
          preserveIdentities: true,
          targetVolumeReductionPercent: { min: 40, max: 60 },
          targetRir: "4-5",
          limitations: ["runtime_replay_consumption_path_missing"],
          safeForBehaviorPromotion: false,
        },
        replacementReadinessStatus: "not_ready",
        blockers: ["required_lane_missing"],
        warnings: ["planner_owned_weeks_2_to_4_projection_is_read_only"],
        missingInputs: [],
        projectedWeekSummaries: [
          {
            week: 1,
            phase: "entry_calibration",
            volumeMultiplier: 1,
            totalPlannedSets: 12,
            projectionBasis: "week_1_no_repair_shape",
            limitations: ["week_1_no_repair_shape_only"],
          },
        ],
        deloadSummary: {
          targetVolumeReductionPercent: { min: 40, max: 60 },
          preserveExerciseIdentities: true,
          introducesNewMovements: false,
          projectionBasis: "v2_deload_transform_read_only",
          limitations: ["runtime_replay_consumption_path_missing"],
        },
        safeToPromoteBehavior: false,
      },
      v2MesocyclePlan: {
        version: 1,
        source: "v2_planner_no_repair_experimental",
        readOnly: true,
        affectsScoringOrGeneration: false,
        planStatus: "replacement_not_ready",
        skeleton: {
          split: "upper_lower_4x",
          weeks: 5,
          slotSequence: ["upper_a", "lower_a", "upper_b", "lower_b"],
          slots: [
            {
              slotId: "upper_a",
              intent: "upper",
              targetSessionSets: { min: 12, max: 18 },
              lanes: [
                {
                  laneId: "chest_anchor",
                  required: true,
                  role: "anchor",
                  primaryMuscles: ["Chest"],
                  preferredExerciseClasses: ["horizontal_press"],
                  targetSets: { min: 3, preferred: 4, max: 5 },
                  currentWeek1Status: "missing",
                },
              ],
            },
          ],
        },
        weeklyProgressionModel: {
          weeks: [
            {
              week: 1,
              phase: "entry_calibration",
              volumeMultiplier: 1,
              rirTarget: "3-4",
              progressionIntent: "establish_anchors",
              limitations: [],
            },
          ],
        },
        deloadTransform: {
          preserveExerciseIdentities: true,
          targetVolumeReductionPercent: { min: 40, max: 60 },
          targetRir: "4-5",
          removeRedundantAccessories: true,
          introduceNewMovements: false,
          projectionStatus: "partially_modeled",
          limitations: [],
        },
        validationRules: [
          {
            ruleId: "required_lanes_present",
            severity: "hard_blocker",
            description: "Required lanes must be present.",
            week1Status: "fail",
            fullMesocycleStatus: "fail",
          },
        ],
        replacementReadiness: {
          canReplaceRepairedProjection: false,
          reason: ["hard_blockers_present"],
        },
      },
      v2TargetVsNoRepairDiff: {
        version: 1,
        source: "v2_planner_no_repair_experimental",
        readOnly: true,
        affectsScoringOrGeneration: false,
        summary: {
          targetLaneCount: 1,
          satisfiedLaneCount: 0,
          partialLaneCount: 0,
          missingLaneCount: 1,
          blockedLaneCount: 0,
          repairDependentLaneCount: 0,
          migrationCandidateCount: 1,
          suspiciousOrBlockedCount: 0,
        },
        slotDiffs: [
          {
            slotId: "upper_a",
            laneDiffs: [
              {
                laneId: "chest_anchor",
                targetRole: "anchor",
                targetPrimaryMuscles: ["Chest"],
                targetExerciseClasses: ["horizontal_press"],
                targetSets: { min: 3, preferred: 4, max: 5 },
                currentStatus: "missing",
                currentEvidence: {
                  selectedExercises: [],
                  relevantDiagnostics: ["target_status:missing"],
                },
                gapCause: "capacity_gap",
                migrationRecommendation: "promote_to_planner_later",
                severity: "hard_blocker",
              },
            ],
          },
        ],
        replacementReadinessImpact: {
          canReplaceRepairedProjection: false,
          blockers: ["required_lane_missing"],
          nextBestMigrationSlice: "upper_a:chest_anchor",
        },
      },
      v2SetDistributionIntent: {
        version: 1,
        source: "v2_planner_policy",
        readOnly: true,
        affectsScoringOrGeneration: false,
        summary: {
          weekCount: 5,
          slotCount: 1,
          laneCount: 1,
          plannedTotalSetsByWeek: [
            {
              week: 1,
              totalSets: 12,
              volumeMultiplier: 1,
              phase: "entry_calibration",
            },
          ],
        },
        weeks: [],
        guardrails: {
          doesNotUseRepairedProjectionAsTarget: true,
          doesNotUseAcceptedSeedAsTarget: true,
          doesNotAffectSelection: true,
          doesNotAffectRepair: true,
          doesNotAffectRuntimeReplay: true,
        },
      },
      v2SupportLanePolicy: buildV2PlannerMesocyclePolicy().v2SupportLanePolicy,
      v2SupportLaneProjectionDiagnostic:
        makeV2SupportLaneProjectionDiagnostic(),
      plannerOwnedAccumulationProjection:
        makePlannerOwnedAccumulationProjection(),
      v2DeloadProjectionDiagnostic: makeV2DeloadProjectionDiagnostic(),
      v2ExerciseSelectionPlanDiagnostic:
        makeV2ExerciseSelectionPlanDiagnostic(),
      slotPlans: [
        {
          slotId: "upper_a",
          exercises: [],
          missingLanes: ["chest_anchor"],
          unresolvedDemand: ["Chest below minimum"],
          validationFailures: ["required lane missing"],
        },
      ],
      weeklyMuscleTotals: [],
      setAllocationChanges: [],
      weeklyMuscleTotalChanges: [],
      acceptanceChecks: [
        {
          check: "required lanes present",
          status: "fail",
          evidence: ["upper_a:chest_anchor:missing"],
        },
      ],
      acceptanceFailures: [],
      qualityWarnings: [],
      diagnosticRows: [],
      ignoredRows: [],
      repairDependenciesDisabled: ["support-floor closure"],
      comparisonToRepaired: {
        repairedPasses: true,
        noRepairPasses: false,
        mainGaps: ["required_lane_missing"],
      },
    },
  } as WorkoutAuditRun["mesocycleExplain"];
}
