import { describe, expect, it } from "vitest";
import { AUDIT_RECONSTRUCTION_GUARDRAIL } from "./constants";
import { buildWorkoutAuditArtifact } from "./serializer";
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

describe("buildWorkoutAuditArtifact", () => {
  it("keeps identity fields in live mode", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        sanitizationLevel: "none",
      },
      baseRun
    );

    expect(artifact.source).toBe("live");
    expect(artifact.version).toBe(4);
    expect(artifact.mode).toBe("future-week");
    expect(artifact.identity.userId).toBe("user-1");
    expect(artifact.identity.ownerEmail).toBe("owner@test.local");
    expect(artifact.request.userId).toBe("user-1");
    expect(artifact.request.ownerEmail).toBe("owner@test.local");
    expect(artifact.conclusions.next_session_basis.sourceFunction).toBe("loadNextWorkoutContext");
    expect(artifact.warningSummary.blockingErrors).toEqual([]);
    expect(artifact.warningSummary.counts).toEqual({
      blockingErrors: 0,
      semanticWarnings: 0,
      backgroundWarnings: 0,
    });
  });

  it("redacts identity fields in pii-safe mode", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        sanitizationLevel: "pii-safe",
      },
      baseRun
    );

    expect(artifact.source).toBe("pii-safe");
    expect(artifact.identity.userId).toBe("redacted");
    expect(artifact.identity.ownerEmail).toBeUndefined();
    expect(artifact.request.userId).toBeUndefined();
    expect(artifact.request.ownerEmail).toBeUndefined();
  });

  it("normalizes outward-facing muscle scope in rich generation artifacts", () => {
    const artifact = buildWorkoutAuditArtifact(
      {
        mode: "future-week",
        userId: "user-1",
        targetMuscles: ["Abs", "Core", "Chest"],
      },
      {
        ...baseRun,
        generationResult: {
          ...baseRun.generationResult!,
          volumePlanByMuscle: {
            Abs: 2,
            Core: 1,
            Chest: 5,
          },
          selection: {
            ...baseRun.generationResult!.selection,
            volumePlanByMuscle: {
              Abs: 3,
              Core: 1,
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
                      muscle: "Abs",
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
      }
    );

    expect(artifact.request.targetMuscles).toEqual(["Core", "Chest"]);
    expect(artifact.generation?.volumePlanByMuscle).toEqual({
      Chest: 5,
      Core: 3,
    });
    expect(artifact.generation?.selection.volumePlanByMuscle).toEqual({
      Core: 4,
    });
    expect(
      artifact.generation?.selection.sessionDecisionReceipt?.lifecycleVolume.targets
    ).toEqual({
      Chest: 14,
      Core: 15,
    });
    expect(artifact.generation?.selection.sessionDecisionReceipt?.targetMuscles).toEqual([
      "Core",
      "Chest",
    ]);
    expect(
      artifact.generation?.selection.sessionDecisionReceipt?.sorenessSuppressedMuscles
    ).toEqual(["Core"]);
    expect(
      artifact.generation?.selection.sessionDecisionReceipt?.plannerDiagnostics?.opportunity
        ?.currentSessionMuscleOpportunity
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
      artifact.generation?.selection.sessionDecisionReceipt?.plannerDiagnostics?.muscles
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
      artifact.generation?.selection.sessionDecisionReceipt?.plannerDiagnostics?.exercises.crunch
        .stimulusVector
    ).toEqual({
      Core: 3,
    });
    expect(
      artifact.generation?.selection.sessionDecisionReceipt?.plannerDiagnostics?.exercises.crunch
        .anchorUsed
    ).toEqual({
      kind: "muscle",
      muscle: "Core",
    });
    expect(
      artifact.generation?.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.startingDeficits
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
      artifact.generation?.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.deficitsAfterClosure
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
      artifact.generation?.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.unresolvedDeficits
    ).toEqual(["Core"]);
    expect(
      artifact.generation?.selection.sessionDecisionReceipt?.plannerDiagnostics?.outcome
        ?.keyTradeoffs
    ).toEqual([
      {
        layer: "closure",
        code: "core_tradeoff",
        message: "Core work was preserved.",
        muscle: "Core",
      },
    ]);
    expect(
      artifact.generation?.selection.sessionDecisionReceipt?.plannerDiagnostics?.muscles.Abs
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
      }
    );

    expect(artifact.warningSummary.blockingErrors).toEqual(["generation exploded"]);
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
      }
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
          ...baseRun.generationResult!,
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
      }
    );

    expect(artifact.generationPath).toEqual({
      requestedMode: "future-week",
      executionMode: "active_deload_reroute",
      generator: "generateDeloadSessionFromIntent",
      reason: "active_mesocycle_state_active_deload",
    });
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
      }
    );

    expect(artifact.warningSummary.semanticWarnings).toContain(
      `${AUDIT_RECONSTRUCTION_GUARDRAIL} Progression-anchor coverage is using a saved-only reconstructed snapshot.`
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
      }
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
      }
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
});
