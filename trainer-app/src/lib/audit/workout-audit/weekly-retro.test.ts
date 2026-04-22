import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const buildHistoricalWeekAuditPayload = vi.fn();
  const loadMesocycleWeekMuscleVolume = vi.fn();
  const getWeeklyVolumeTarget = vi.fn();
  const mesocycleFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  return {
    buildHistoricalWeekAuditPayload,
    loadMesocycleWeekMuscleVolume,
    getWeeklyVolumeTarget,
    mesocycleFindFirst,
    workoutFindMany,
    prisma: {
      mesocycle: {
        findFirst: mesocycleFindFirst,
      },
      workout: {
        findMany: workoutFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/api/weekly-volume", () => ({
  loadMesocycleWeekMuscleVolume: (...args: unknown[]) =>
    mocks.loadMesocycleWeekMuscleVolume(...args),
}));

vi.mock("@/lib/api/mesocycle-lifecycle-math", () => ({
  getWeeklyVolumeTarget: (...args: unknown[]) => mocks.getWeeklyVolumeTarget(...args),
}));

vi.mock("@/lib/evidence/session-decision-receipt", () => ({
  readSessionSlotSnapshot: (selectionMetadata: unknown) =>
    (selectionMetadata as { slot?: unknown })?.slot,
}));

vi.mock("./historical-week", () => ({
  buildHistoricalWeekAuditPayload: (...args: unknown[]) =>
    mocks.buildHistoricalWeekAuditPayload(...args),
}));

import { buildWeeklyRetroAuditPayload } from "./weekly-retro";

describe("buildWeeklyRetroAuditPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildHistoricalWeekAuditPayload.mockResolvedValue({
      version: 1,
      week: 3,
      mesocycleId: "meso-1",
      sessions: [
        {
          workoutId: "workout-1",
          scheduledDate: "2026-03-15T00:00:00.000Z",
          status: "COMPLETED",
          sessionIntent: "PUSH",
          selectionMode: "INTENT",
          snapshotSource: "persisted",
          sessionSnapshot: {
            saved: {
              mesocycleSnapshot: {
                mesocycleId: "meso-1",
                week: 3,
                session: 1,
                phase: "accumulation",
              },
              semantics: {
                kind: "advancing",
                isCloseout: false,
                isDeload: false,
                consumesWeeklyScheduleIntent: true,
              },
            },
          },
          canonicalSemantics: {
            sourceLayer: "saved",
            phase: "accumulation",
            isDeload: false,
            countsTowardProgressionHistory: true,
            countsTowardPerformanceHistory: true,
            updatesProgressionAnchor: true,
          },
          progressionEvidence: {
            countsTowardProgressionHistory: true,
            countsTowardPerformanceHistory: true,
            updatesProgressionAnchor: true,
            reasonCodes: ["advances_split_true"],
          },
          reconciliation: {
            hasDrift: true,
            changedFields: ["exercise_prescription_changed", "selection_mode"],
          },
        },
        {
          workoutId: "workout-2",
          scheduledDate: "2026-03-16T00:00:00.000Z",
          status: "COMPLETED",
          sessionIntent: "PULL",
          selectionMode: "INTENT",
          snapshotSource: "reconstructed_saved_only",
          sessionSnapshot: {
            saved: {
              semantics: {
                kind: "advancing",
                isCloseout: false,
                isDeload: false,
                consumesWeeklyScheduleIntent: true,
              },
            },
          },
          canonicalSemantics: {
            sourceLayer: "saved",
            phase: "accumulation",
            isDeload: false,
            countsTowardProgressionHistory: true,
            countsTowardPerformanceHistory: true,
            updatesProgressionAnchor: true,
          },
          progressionEvidence: {
            countsTowardProgressionHistory: true,
            countsTowardPerformanceHistory: true,
            updatesProgressionAnchor: true,
            reasonCodes: ["advances_split_true"],
          },
          reconciliation: {
            hasDrift: false,
            changedFields: [],
          },
        },
        {
          workoutId: "workout-3",
          scheduledDate: "2026-03-17T00:00:00.000Z",
          status: "COMPLETED",
          sessionIntent: "LEGS",
          selectionMode: "INTENT",
          snapshotSource: "persisted",
          sessionSnapshot: {
            saved: {
              semantics: {
                kind: "advancing",
                isCloseout: false,
                isDeload: false,
                consumesWeeklyScheduleIntent: true,
              },
            },
          },
          canonicalSemantics: {
            sourceLayer: "saved",
            phase: "accumulation",
            isDeload: false,
            countsTowardProgressionHistory: false,
            countsTowardPerformanceHistory: true,
            updatesProgressionAnchor: false,
          },
          progressionEvidence: {
            countsTowardProgressionHistory: false,
            countsTowardPerformanceHistory: true,
            updatesProgressionAnchor: false,
            reasonCodes: ["advances_split_true"],
          },
          reconciliation: {
            hasDrift: false,
            changedFields: [],
          },
        },
      ],
      summary: {
        sessionCount: 3,
        advancingCount: 3,
        gapFillCount: 0,
        supplementalCount: 0,
        deloadCount: 0,
        progressionEligibleCount: 2,
        progressionExcludedCount: 1,
        weekCloseRelevantCount: 0,
        persistedSnapshotCount: 2,
        reconstructedSnapshotCount: 1,
        mutationDriftCount: 1,
        statusCounts: { COMPLETED: 3 },
        intentCounts: { PUSH: 1, PULL: 1, LEGS: 1 },
      },
      comparabilityCoverage: {
        comparableSessionCount: 2,
        missingGeneratedSnapshotCount: 1,
        persistedSnapshotCount: 2,
        reconstructedSnapshotCount: 1,
        generatedLayerCoverage: "partial",
        limitations: ["1 session lacks generated-layer coverage."],
      },
    });
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      durationWeeks: 5,
      startWeek: 0,
      blocks: [],
      macroCycle: {
        startDate: new Date("2026-03-02T00:00:00.000Z"),
      },
    });
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: {
        directSets: 6,
        indirectSets: 0,
        effectiveSets: 6,
        contributions: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            effectiveSets: 4,
            performedSets: 4,
          },
        ],
      },
      Lats: {
        directSets: 17,
        indirectSets: 0,
        effectiveSets: 17,
        contributions: [
          {
            exerciseId: "row",
            exerciseName: "Chest Supported Row",
            effectiveSets: 8,
            performedSets: 8,
          },
        ],
      },
    });
    mocks.workoutFindMany.mockResolvedValue([
      {
        id: "workout-1",
        selectionMetadata: {
          slot: {
            slotId: "slot-1",
            intent: "push",
            sequenceIndex: 0,
            source: "mesocycle_slot_sequence",
          },
        },
      },
      {
        id: "workout-2",
        selectionMetadata: {},
      },
      {
        id: "workout-3",
        selectionMetadata: {
          slot: {
            slotId: "slot-1",
            intent: "push",
            sequenceIndex: 1,
            source: "mesocycle_slot_sequence",
          },
        },
      },
    ]);
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => {
        if (muscle === "Chest") {
          return 10;
        }
        if (muscle === "Lats") {
          return 14;
        }
        return 0;
      }
    );
  });

  it("composes historical coverage, actual weekly volume, targets, and slot receipts into a retro artifact", async () => {
    const payload = await buildWeeklyRetroAuditPayload({
      userId: "user-1",
      week: 3,
      mesocycleId: "meso-1",
    });

    expect(mocks.buildHistoricalWeekAuditPayload).toHaveBeenCalledWith({
      userId: "user-1",
      week: 3,
      mesocycleId: "meso-1",
    });
    expect(mocks.loadMesocycleWeekMuscleVolume).toHaveBeenCalledWith(
      mocks.prisma,
      expect.objectContaining({
        userId: "user-1",
        mesocycleId: "meso-1",
        targetWeek: 3,
        includeBreakdowns: true,
      })
    );
    expect(
      (mocks.loadMesocycleWeekMuscleVolume.mock.calls[0]?.[1] as { weekStart: Date }).weekStart
        .toISOString()
        .slice(0, 10)
    ).toBe("2026-03-15");
    expect(payload.executiveSummary).toMatchObject({
      status: "attention_required",
      generatedLayerCoverage: "partial",
      sessionCount: 3,
      driftSessionCount: 1,
      belowMevCount: 1,
      underTargetCount: 1,
      overMavCount: 1,
      slotIdentityIssueCount: 3,
    });
    expect(payload.loadCalibration).toMatchObject({
      status: "attention_required",
      comparableSessionCount: 2,
      driftSessionCount: 1,
      prescriptionChangeCount: 1,
      selectionDriftCount: 1,
      legacyLimitedSessionCount: 1,
    });
    expect(payload.sessionExecution).toMatchObject({
      summary: {
        sessionCount: 3,
        advancingCount: 3,
        progressionEligibleCount: 2,
        progressionExcludedCount: 1,
      },
      sessions: [
        {
          workoutId: "workout-1",
          status: "COMPLETED",
          sessionIntent: "PUSH",
          semanticKind: "advancing",
          consumesWeeklyScheduleIntent: true,
          slot: {
            slotId: "slot-1",
            intent: "push",
          },
          progressionEvidence: {
            countsTowardProgressionHistory: true,
            updatesProgressionAnchor: true,
          },
          reconciliation: {
            hasDrift: true,
            changedFields: ["exercise_prescription_changed", "selection_mode"],
          },
        },
        {
          workoutId: "workout-2",
          snapshotSource: "reconstructed_saved_only",
          slot: undefined,
        },
        {
          workoutId: "workout-3",
          progressionEvidence: {
            countsTowardProgressionHistory: false,
            updatesProgressionAnchor: false,
          },
        },
      ],
    });
    expect(payload.slotBalance).toEqual({
      status: "attention_required",
      advancingSessionCount: 3,
      identifiedSlotCount: 2,
      missingSlotIdentityCount: 1,
      duplicateSlotCount: 1,
      intentMismatchCount: 1,
      missingSlotIdentityWorkoutIds: ["workout-2"],
      duplicateSlots: [
        {
          slotId: "slot-1",
          workoutIds: ["workout-1", "workout-3"],
        },
      ],
      intentMismatches: [
        {
          workoutId: "workout-3",
          sessionIntent: "LEGS",
          slotIntent: "push",
          slotId: "slot-1",
        },
      ],
    });
    expect(payload.volumeTargeting.belowMev).toContain("Chest");
    expect(payload.volumeTargeting.overMav).toContain("Lats");
    expect(payload.volumeTargeting.muscles.find((row) => row.muscle === "Chest")).toMatchObject({
      actualEffectiveSets: 6,
      weeklyTarget: 10,
      mev: 10,
      mav: 16,
      deltaToTarget: -4,
      deltaToMev: -4,
      status: "below_mev",
      topContributors: [
        {
          exerciseId: "bench",
          exerciseName: "Bench Press",
          effectiveSets: 4,
          performedSets: 4,
        },
      ],
    });
    expect(payload.rootCauses.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "slot_identity_gap",
        "slot_identity_duplicate",
        "slot_identity_intent_mismatch",
        "mutation_drift",
        "legacy_coverage_gap",
        "below_mev",
        "over_mav",
      ])
    );
    expect(payload.recommendedPriorities[0]).toBe(
      "Repair missing session-slot receipts before trusting slot-balance conclusions."
    );
    expect(payload.projectionDeliveryDrift).toBeUndefined();
  });

  it("attaches projection delivery drift when a projection artifact is provided", async () => {
    const payload = await buildWeeklyRetroAuditPayload({
      userId: "user-1",
      ownerEmail: "owner@test.local",
      week: 3,
      mesocycleId: "meso-1",
      projectionArtifact: {
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
          ],
        },
      },
    });

    expect(payload.projectionDeliveryDrift).toMatchObject({
      status: "comparable",
      baseline: {
        generatedAt: "2026-04-01T12:00:00.000Z",
        projectedSessionCount: 1,
      },
      summary: {
        direction: "mixed",
        materialUnderdeliveryCount: 1,
        materialOverdeliveryCount: 1,
        netEffectiveSetDelta: 3,
      },
    });
    expect(payload.projectionDeliveryDrift?.muscles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          muscle: "Chest",
          projectedEffectiveSets: 10,
          actualEffectiveSets: 6,
          classification: "underdelivered",
        }),
        expect.objectContaining({
          muscle: "Lats",
          projectedEffectiveSets: 10,
          actualEffectiveSets: 17,
          classification: "overdelivered",
        }),
      ])
    );
  });

  it("returns not_available drift when a provided projection artifact path cannot be read", async () => {
    const payload = await buildWeeklyRetroAuditPayload({
      userId: "user-1",
      week: 3,
      mesocycleId: "meso-1",
      projectionArtifactPath: "C:\\missing\\projection.json",
    });

    expect(payload.projectionDeliveryDrift).toMatchObject({
      status: "not_available",
      muscles: [],
    });
    expect(payload.projectionDeliveryDrift?.limitations[0]).toContain(
      "Projection artifact could not be read:"
    );
  });

  it("uses the exposed muscle scope so Core absorbs Abs and no separate Abs row is emitted", async () => {
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Core: {
        directSets: 2,
        indirectSets: 0,
        effectiveSets: 2,
        contributions: [
          {
            exerciseId: "crunch",
            exerciseName: "Cable Crunch",
            effectiveSets: 2,
            performedSets: 2,
          },
        ],
      },
    });
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => {
        if (muscle === "Core") {
          return 8;
        }
        if (muscle === "Abs") {
          return 7;
        }
        return 0;
      }
    );

    const payload = await buildWeeklyRetroAuditPayload({
      userId: "user-1",
      week: 3,
      mesocycleId: "meso-1",
    });

    const muscles = payload.volumeTargeting.muscles.map((row) => row.muscle);
    expect(muscles).toContain("Core");
    expect(muscles).not.toContain("Abs");
    expect(payload.volumeTargeting.underTargetOnly).toContain("Core");
    expect(payload.volumeTargeting.underTargetOnly).not.toContain("Abs");
    expect(payload.volumeTargeting.muscles.find((row) => row.muscle === "Core")).toMatchObject({
      actualEffectiveSets: 2,
      weeklyTarget: 8,
      deltaToTarget: -6,
      topContributors: [
        {
          exerciseId: "crunch",
          exerciseName: "Cable Crunch",
          effectiveSets: 2,
          performedSets: 2,
        },
      ],
    });
  });
});
