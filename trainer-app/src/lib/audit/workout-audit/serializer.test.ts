import { describe, expect, it } from "vitest";
import { buildWorkoutAuditArtifact } from "./serializer";
import type { WorkoutAuditRun } from "./types";

const baseRun: WorkoutAuditRun = {
  context: {
    mode: "next-session",
    requestedMode: "next-session",
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
        mode: "next-session",
        userId: "user-1",
        ownerEmail: "owner@test.local",
        sanitizationLevel: "none",
      },
      baseRun
    );

    expect(artifact.source).toBe("live");
    expect(artifact.version).toBe(2);
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
        mode: "next-session",
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
        mode: "next-session",
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
});
