import { describe, expect, it } from "vitest";
import { buildProjectionDeliveryDrift } from "./projection-drift";
import type { WeeklyRetroAuditPayload } from "./types";

function makeRetro(
  overrides?: Partial<WeeklyRetroAuditPayload>
): WeeklyRetroAuditPayload {
  return {
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
      muscles: [
        {
          muscle: "Chest",
          actualEffectiveSets: 10.5,
          weeklyTarget: 10,
          mev: 8,
          mav: 16,
          deltaToTarget: 0.5,
          deltaToMev: 2.5,
          deltaToMav: -5.5,
          status: "within_target_band",
          topContributors: [],
        },
        {
          muscle: "Lats",
          actualEffectiveSets: 6,
          weeklyTarget: 10,
          mev: 8,
          mav: 16,
          deltaToTarget: -4,
          deltaToMev: -2,
          deltaToMav: -10,
          status: "below_mev",
          topContributors: [],
        },
        {
          muscle: "Calves",
          actualEffectiveSets: 3.1,
          weeklyTarget: 8,
          mev: 6,
          mav: 12,
          deltaToTarget: -4.9,
          deltaToMev: -2.9,
          deltaToMav: -8.9,
          status: "below_mev",
          topContributors: [],
        },
        {
          muscle: "Forearms",
          actualEffectiveSets: 1.9,
          weeklyTarget: 4,
          mev: 2,
          mav: 8,
          deltaToTarget: -2.1,
          deltaToMev: -0.1,
          deltaToMav: -6.1,
          status: "under_target_only",
          topContributors: [],
        },
      ],
    },
    interventions: [],
    rootCauses: [],
    recommendedPriorities: [],
    ...overrides,
  };
}

function makeProjection(overrides?: Record<string, unknown>) {
  return {
    version: 4,
    generatedAt: "2026-04-01T12:00:00.000Z",
    mode: "projected-week-volume",
    identity: {
      userId: "user-1",
      ownerEmail: "owner@test.local",
    },
    projectedWeekVolume: {
      version: 1,
      currentWeek: {
        mesocycleId: "meso-1",
        week: 3,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [
        {
          slotId: "push_a",
          intent: "push",
          isNext: true,
          exerciseCount: 5,
          totalSets: 15,
          projectedContributionByMuscle: {},
        },
        {
          slotId: "pull_a",
          intent: "pull",
          isNext: false,
          exerciseCount: 5,
          totalSets: 15,
          projectedContributionByMuscle: {},
        },
      ],
      fullWeekByMuscle: [
        {
          muscle: "Chest",
          completedEffectiveSets: 6,
          projectedNextSessionEffectiveSets: 2,
          projectedRemainingWeekEffectiveSets: 2,
          projectedFullWeekEffectiveSets: 10,
          weeklyTarget: 10,
          mev: 8,
          mav: 16,
          deltaToTarget: 0,
          deltaToMev: 2,
          deltaToMav: -6,
        },
        {
          muscle: "Lats",
          completedEffectiveSets: 6,
          projectedNextSessionEffectiveSets: 2,
          projectedRemainingWeekEffectiveSets: 2,
          projectedFullWeekEffectiveSets: 10,
          weeklyTarget: 10,
          mev: 8,
          mav: 16,
          deltaToTarget: 0,
          deltaToMev: 2,
          deltaToMav: -6,
        },
        {
          muscle: "Calves",
          completedEffectiveSets: 1,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 1,
          weeklyTarget: 8,
          mev: 6,
          mav: 12,
          deltaToTarget: -7,
          deltaToMev: -5,
          deltaToMav: -11,
        },
        {
          muscle: "Forearms",
          completedEffectiveSets: 1,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 1,
          weeklyTarget: 4,
          mev: 2,
          mav: 8,
          deltaToTarget: -3,
          deltaToMev: -1,
          deltaToMav: -7,
        },
      ],
    },
    ...overrides,
  };
}

describe("buildProjectionDeliveryDrift", () => {
  it("computes comparable per-muscle projection delivery drift", () => {
    const drift = buildProjectionDeliveryDrift({
      projectionArtifact: makeProjection(),
      weeklyRetro: makeRetro(),
      actualIdentity: {
        userId: "user-1",
        ownerEmail: "owner@test.local",
      },
    });

    expect(drift.status).toBe("comparable");
    expect(drift.baseline).toEqual({
      generatedAt: "2026-04-01T12:00:00.000Z",
      projectedSessionCount: 2,
    });
    expect(drift.summary).toEqual({
      direction: "mixed",
      materialUnderdeliveryCount: 1,
      materialOverdeliveryCount: 1,
      netEffectiveSetDelta: -0.5,
    });
    expect(drift.muscles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Lats",
          projectedEffectiveSets: 10,
          actualEffectiveSets: 6,
          delta: -4,
          percentDelta: -0.4,
          classification: "underdelivered",
          actualTargetStatus: "below_mev",
        }),
        expect.objectContaining({
          muscle: "Calves",
          projectedEffectiveSets: 1,
          actualEffectiveSets: 3.1,
          delta: 2.1,
          percentDelta: 2.1,
          classification: "overdelivered",
        }),
        expect.objectContaining({
          muscle: "Chest",
          delta: 0.5,
          percentDelta: 0.05,
          classification: "aligned",
        }),
      ])
    );
  });

  it("uses absolute delta for low-baseline classification", () => {
    const drift = buildProjectionDeliveryDrift({
      projectionArtifact: makeProjection(),
      weeklyRetro: makeRetro(),
      actualIdentity: { userId: "user-1" },
    });

    expect(drift.muscles.find((row) => row.muscle === "Forearms")).toMatchObject({
      projectedEffectiveSets: 1,
      actualEffectiveSets: 1.9,
      delta: 0.9,
      percentDelta: 0.9,
      classification: "aligned",
    });
  });

  it("returns not_available when projection artifact is missing or invalid", () => {
    const drift = buildProjectionDeliveryDrift({
      weeklyRetro: makeRetro(),
      actualIdentity: { userId: "user-1" },
    });

    expect(drift).toMatchObject({
      status: "not_available",
      muscles: [],
      summary: {
        direction: "aligned",
      },
    });
    expect(drift.limitations[0]).toContain("Projection artifact was not provided");
  });

  it("returns not_available for mismatched week or mesocycle", () => {
    const weekMismatch = buildProjectionDeliveryDrift({
      projectionArtifact: makeProjection({
        projectedWeekVolume: {
          ...makeProjection().projectedWeekVolume,
          currentWeek: {
            mesocycleId: "meso-1",
            week: 4,
            phase: "accumulation",
            blockType: "accumulation",
          },
        },
      }),
      weeklyRetro: makeRetro(),
      actualIdentity: { userId: "user-1" },
    });
    const mesocycleMismatch = buildProjectionDeliveryDrift({
      projectionArtifact: makeProjection({
        projectedWeekVolume: {
          ...makeProjection().projectedWeekVolume,
          currentWeek: {
            mesocycleId: "meso-2",
            week: 3,
            phase: "accumulation",
            blockType: "accumulation",
          },
        },
      }),
      weeklyRetro: makeRetro(),
      actualIdentity: { userId: "user-1" },
    });

    expect(weekMismatch.status).toBe("not_available");
    expect(weekMismatch.limitations[0]).toContain("Projection week=4");
    expect(mesocycleMismatch.status).toBe("not_available");
    expect(mesocycleMismatch.limitations[0]).toContain("Projection mesocycleId=meso-2");
  });

  it("returns limited when owner identity is unavailable but week and mesocycle match", () => {
    const projectionWithoutIdentity = makeProjection();
    delete (projectionWithoutIdentity as { identity?: unknown }).identity;

    const drift = buildProjectionDeliveryDrift({
      projectionArtifact: projectionWithoutIdentity,
      weeklyRetro: makeRetro(),
      actualIdentity: { userId: "user-1" },
    });

    expect(drift.status).toBe("limited");
    expect(drift.limitations).toContain(
      "Projection artifact did not include owner identity; week and mesocycle comparability passed."
    );
    expect(drift.muscles.length).toBeGreaterThan(0);
  });
});
