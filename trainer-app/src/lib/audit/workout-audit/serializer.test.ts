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
    expect(artifact.version).toBe(3);
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
});
