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
  readSessionDecisionReceipt: (selectionMetadata: unknown) =>
    (selectionMetadata as { receipt?: unknown })?.receipt,
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
        exercises: [
          {
            exerciseId: "bench",
            sets: [{ id: "bench-set-1" }, { id: "bench-set-2" }, { id: "bench-set-3" }, { id: "bench-set-4" }],
            exercise: {
              name: "Bench Press",
              aliases: [],
              exerciseMuscles: [
                { role: "PRIMARY", muscle: { name: "Chest" } },
                { role: "SECONDARY", muscle: { name: "Triceps" } },
              ],
            },
          },
        ],
      },
      {
        id: "workout-2",
        selectionMetadata: {},
        exercises: [],
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
        exercises: [],
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
      underTargetCount: 0,
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

  it("separates final-opportunity MEV closure additions from missed planned work and mutation drift", async () => {
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
            generated: {
              selectionMode: "INTENT",
              sessionIntent: "PUSH",
              semantics: {
                kind: "advancing",
                isCloseout: false,
                isDeload: false,
                consumesWeeklyScheduleIntent: true,
                countsTowardProgressionHistory: true,
              },
              exerciseCount: 1,
              hardSetCount: 4,
              exercises: [
                {
                  exerciseId: "bench",
                  exerciseName: "Bench Press",
                  orderIndex: 0,
                  section: "main",
                  isMainLift: true,
                  prescribedSetCount: 4,
                  prescribedSets: [],
                },
              ],
              traces: { progression: {} },
            },
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
            version: 1,
            comparisonState: "comparable",
            hasDrift: true,
            changedFields: ["exercise_added"],
            addedExerciseIds: ["pec-deck"],
            removedExerciseIds: [],
            exercisesWithSetCountChanges: [],
            exercisesWithPrescriptionChanges: [],
          },
        },
      ],
      summary: {
        sessionCount: 1,
        advancingCount: 1,
        gapFillCount: 0,
        supplementalCount: 0,
        deloadCount: 0,
        progressionEligibleCount: 1,
        progressionExcludedCount: 0,
        weekCloseRelevantCount: 0,
        persistedSnapshotCount: 1,
        reconstructedSnapshotCount: 0,
        mutationDriftCount: 1,
        statusCounts: { COMPLETED: 1 },
        intentCounts: { PUSH: 1 },
      },
      comparabilityCoverage: {
        comparableSessionCount: 1,
        missingGeneratedSnapshotCount: 0,
        persistedSnapshotCount: 1,
        reconstructedSnapshotCount: 0,
        generatedLayerCoverage: "full",
        limitations: [],
      },
    });
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({
      Chest: {
        directSets: 10,
        indirectSets: 0,
        effectiveSets: 10,
        contributions: [
          {
            exerciseId: "pec-deck",
            exerciseName: "Pec Deck Machine",
            effectiveSets: 2,
            performedSets: 2,
          },
        ],
      },
    });
    mocks.workoutFindMany.mockResolvedValue([
      {
        id: "workout-1",
        selectionMetadata: {
          runtimeEditReconciliation: {
            version: 1,
            lastReconciledAt: "2026-03-15T12:00:00.000Z",
            directives: {
              continuityAlias: "none",
              progressionAlias: "none",
              futureSessionGeneration: "ignore",
              futureSeedCarryForward: "ignore",
            },
            ops: [
              {
                kind: "add_exercise",
                source: "api_workouts_add_exercise",
                appliedAt: "2026-03-15T12:00:00.000Z",
                scope: "current_workout_only",
                facts: {
                  workoutExerciseId: "we-pec",
                  exerciseId: "pec-deck",
                  orderIndex: 1,
                  section: "ACCESSORY",
                  setCount: 2,
                  prescriptionSource: "session_accessory_defaults",
                },
              },
            ],
          },
          slot: {
            slotId: "slot-1",
            intent: "push",
            sequenceIndex: 0,
            source: "mesocycle_slot_sequence",
          },
        },
        exercises: [
          {
            exerciseId: "bench",
            sets: [{ id: "bench-set-1" }, { id: "bench-set-2" }, { id: "bench-set-3" }, { id: "bench-set-4" }],
            exercise: {
              name: "Bench Press",
              aliases: [],
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
            },
          },
          {
            exerciseId: "pec-deck",
            sets: [{ id: "pec-set-1" }, { id: "pec-set-2" }],
            exercise: {
              name: "Pec Deck Machine",
              aliases: [],
              exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Chest" } }],
            },
          },
        ],
      },
    ]);
    mocks.getWeeklyVolumeTarget.mockImplementation(
      (_mesocycle: unknown, muscle: string) => (muscle === "Chest" ? 14 : 0)
    );

    const payload = await buildWeeklyRetroAuditPayload({
      userId: "user-1",
      week: 3,
      mesocycleId: "meso-1",
    });

    expect(payload.planAdherence).toMatchObject({
      plannedWorkCompletedPercent: 100,
      plannedWorkMissedSets: 0,
      plannedWorkTotalSets: 4,
      plannedWorkCompletedSets: 4,
      explainedAdditions: {
        totalSets: 2,
        byIntent: {
          final_weekly_opportunity_mev_closure: 2,
        },
      },
      substitutions: 0,
      painFatigueDeviations: 0,
      unclassifiedDrift: 0,
      engineConfidenceImpact: "none",
    });
    expect(payload.planAdherence.interpretations[0]).toMatchObject({
      intent: "final_weekly_opportunity_mev_closure",
      confidence: "high",
      setDelta: 2,
      muscles: ["Chest"],
    });
    expect(payload.loadCalibration.status).toBe("aligned");
    expect(payload.rootCauses.map((entry) => entry.code)).not.toContain("mutation_drift");
    expect(payload.rootCauses.map((entry) => entry.code)).not.toContain(
      "unclassified_runtime_drift"
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
    expect(payload.executiveSummary.underTargetCount).toBe(1);
    expect(payload.volumeTargeting.status).toBe("within_expected_band");
    expect(payload.interventions.map((entry) => entry.kind)).not.toContain("volume_deficit");
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

  it("emits compact exercise load-calibration rows for clean, mis-targeted, added, and low-coverage work", async () => {
    mocks.buildHistoricalWeekAuditPayload.mockResolvedValue({
      version: 1,
      week: 2,
      mesocycleId: "meso-1",
      sessions: [
        {
          workoutId: "workout-loads",
          scheduledDate: "2026-03-10T00:00:00.000Z",
          status: "COMPLETED",
          sessionIntent: "LOWER",
          selectionMode: "INTENT",
          snapshotSource: "persisted",
          sessionSnapshot: {
            generated: {
              selectionMode: "INTENT",
              sessionIntent: "LOWER",
              semantics: {
                kind: "advancing",
                isCloseout: false,
                isDeload: false,
                consumesWeeklyScheduleIntent: true,
                countsTowardProgressionHistory: true,
              },
              exerciseCount: 4,
              hardSetCount: 13,
              exercises: [
                {
                  exerciseId: "clean-row",
                  exerciseName: "Chest Supported Row",
                  orderIndex: 0,
                  section: "main",
                  isMainLift: true,
                  prescribedSetCount: 3,
                  prescribedSets: [
                    { setIndex: 0, targetReps: 8, targetRpe: 8, targetLoad: 100 },
                  ],
                },
                {
                  exerciseId: "sldl",
                  exerciseName: "Stiff-Legged Deadlift",
                  orderIndex: 1,
                  section: "main",
                  isMainLift: true,
                  prescribedSetCount: 3,
                  prescribedSets: [
                    { setIndex: 0, targetReps: 9, targetRpe: 8, targetLoad: 140 },
                  ],
                },
                {
                  exerciseId: "machine-press",
                  exerciseName: "Machine Shoulder Press",
                  orderIndex: 2,
                  section: "accessory",
                  isMainLift: false,
                  prescribedSetCount: 3,
                  prescribedSets: [
                    { setIndex: 0, targetReps: 12, targetRpe: 8, targetLoad: 22.5 },
                  ],
                },
                {
                  exerciseId: "leg-press",
                  exerciseName: "Leg Press",
                  orderIndex: 3,
                  section: "accessory",
                  isMainLift: false,
                  prescribedSetCount: 4,
                  prescribedSets: [
                    { setIndex: 0, targetReps: 10, targetRpe: 8, targetLoad: 200 },
                  ],
                },
              ],
              traces: { progression: {} },
            },
            saved: {
              mesocycleSnapshot: {
                mesocycleId: "meso-1",
                week: 2,
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
            version: 1,
            comparisonState: "comparable",
            hasDrift: true,
            changedFields: ["exercise_added"],
            addedExerciseIds: ["curl"],
            removedExerciseIds: [],
            exercisesWithSetCountChanges: [],
            exercisesWithPrescriptionChanges: [],
          },
        },
      ],
      summary: {
        sessionCount: 1,
        advancingCount: 1,
        gapFillCount: 0,
        supplementalCount: 0,
        deloadCount: 0,
        progressionEligibleCount: 1,
        progressionExcludedCount: 0,
        weekCloseRelevantCount: 0,
        persistedSnapshotCount: 1,
        reconstructedSnapshotCount: 0,
        mutationDriftCount: 1,
        statusCounts: { COMPLETED: 1 },
        intentCounts: { LOWER: 1 },
      },
      comparabilityCoverage: {
        comparableSessionCount: 1,
        missingGeneratedSnapshotCount: 0,
        persistedSnapshotCount: 1,
        reconstructedSnapshotCount: 0,
        generatedLayerCoverage: "full",
        limitations: [],
      },
    });
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({});
    mocks.workoutFindMany.mockResolvedValue([
      {
        id: "workout-loads",
        selectionMetadata: {
          slot: {
            slotId: "lower_a",
            intent: "lower",
            sequenceIndex: 1,
            source: "mesocycle_slot_sequence",
          },
        },
        exercises: [
          makeRuntimeExercise("clean-row", "Chest Supported Row", 0, [
            makeRuntimeSet(0, 100, 8, 8),
            makeRuntimeSet(1, 105, 8, 8),
            makeRuntimeSet(2, 100, 8, 8),
          ]),
          makeRuntimeExercise("sldl", "Stiff-Legged Deadlift", 1, [
            makeRuntimeSet(0, 95, 9, 8),
            makeRuntimeSet(1, 115, 9, 8),
            makeRuntimeSet(2, 115, 9, 8),
          ]),
          makeRuntimeExercise("machine-press", "Machine Shoulder Press", 2, [
            makeRuntimeSet(0, 55, 12, 8),
            makeRuntimeSet(1, 55, 12, 8),
            makeRuntimeSet(2, 55, 12, 8),
          ]),
          makeRuntimeExercise("leg-press", "Leg Press", 3, [
            makeRuntimeSet(0, 200, 10, 8),
            makeSkippedRuntimeSet(1, 200),
            makeSkippedRuntimeSet(2, 200),
            { setIndex: 3, targetReps: 10, targetLoad: 200, logs: [] },
          ]),
          makeRuntimeExercise("curl", "Barbell Curl", 4, [
            makeRuntimeSet(0, 50, 12, 8),
            makeRuntimeSet(1, 60, 10, 9),
          ]),
        ],
      },
    ]);
    mocks.getWeeklyVolumeTarget.mockReturnValue(0);

    const payload = await buildWeeklyRetroAuditPayload({
      userId: "user-1",
      week: 2,
      mesocycleId: "meso-1",
    });
    const rowsByExercise = new Map(
      payload.exerciseLoadCalibrationRows?.map((row) => [row.exerciseId, row])
    );

    expect(rowsByExercise.get("clean-row")).toMatchObject({
      week: 2,
      slotId: "lower_a",
      sessionLabel: "lower_a",
      plannedSetCount: 3,
      savedSetCount: 3,
      performedSetCount: 3,
      skippedSetCount: 0,
      targetLoad: 100,
      targetRepRange: { min: 8, max: 8 },
      targetRpe: 8,
      classification: "clean",
      performedLoadSummary: {
        anchorLoad: 100,
        medianLoad: 100,
        medianReps: 8,
        modalRpe: 8,
        loadDeltaPct: 0,
      },
    });
    expect(rowsByExercise.get("sldl")).toMatchObject({
      classification: "target_too_high",
      reasonCodes: ["performed_load_materially_below_target"],
      performedLoadSummary: {
        medianLoad: 115,
        medianReps: 9,
        loadDeltaPct: -17.9,
      },
    });
    expect(rowsByExercise.get("machine-press")).toMatchObject({
      classification: "target_too_low",
      reasonCodes: ["performed_load_materially_above_target"],
      performedLoadSummary: {
        medianLoad: 55,
        medianReps: 12,
        loadDeltaPct: 144.4,
      },
    });
    expect(rowsByExercise.get("curl")).toMatchObject({
      classification: "runtime_added",
      plannedSetCount: 0,
      savedSetCount: 2,
      performedSetCount: 2,
      addedSetCount: 2,
    });
    expect(rowsByExercise.get("leg-press")).toMatchObject({
      classification: "skipped_or_low_coverage",
      plannedSetCount: 4,
      savedSetCount: 4,
      performedSetCount: 1,
      skippedSetCount: 2,
      reasonCodes: [
        "planned_exercise_low_performed_coverage",
        "skipped_sets_present",
      ],
    });
  });

  it("separates completed post-session reconciliation from future planned work and likely replacements", async () => {
    mocks.buildHistoricalWeekAuditPayload.mockResolvedValue({
      version: 1,
      week: 1,
      mesocycleId: "9b861675-c98f-42f7-bc8c-64a7de411b77",
      sessions: [
        makeHistoricalSession({
          workoutId: "upper-1",
          scheduledDate: "2026-05-25T10:00:00.000Z",
          status: "COMPLETED",
          sessionIntent: "UPPER",
          mesoSession: 1,
          generatedExercises: [
            makeGeneratedExercise("close-grip-lat-pulldown", "Close-Grip Lat Pulldown", 0, 3),
            makeGeneratedExercise("machine-chest-press", "Machine Chest Press", 1, 3),
            makeGeneratedExercise("face-pull", "Face Pull", 2, 2),
            makeGeneratedExercise("db-curl", "Dumbbell Curl", 3, 2),
          ],
          addedExerciseIds: ["iso-front-lat-pulldown", "cable-crunch"],
        }),
        makeHistoricalSession({
          workoutId: "lower-1",
          scheduledDate: "2026-05-27T10:00:00.000Z",
          status: "PLANNED",
          sessionIntent: "LOWER",
          mesoSession: 2,
          generatedExercises: [
            makeGeneratedExercise("leg-press", "Leg Press", 0, 4),
          ],
          addedExerciseIds: [],
        }),
      ],
      summary: {
        sessionCount: 2,
        advancingCount: 2,
        gapFillCount: 0,
        supplementalCount: 0,
        deloadCount: 0,
        progressionEligibleCount: 1,
        progressionExcludedCount: 1,
        weekCloseRelevantCount: 0,
        persistedSnapshotCount: 2,
        reconstructedSnapshotCount: 0,
        mutationDriftCount: 1,
        statusCounts: { COMPLETED: 1, PLANNED: 1 },
        intentCounts: { UPPER: 1, LOWER: 1 },
      },
      comparabilityCoverage: {
        comparableSessionCount: 2,
        missingGeneratedSnapshotCount: 0,
        persistedSnapshotCount: 2,
        reconstructedSnapshotCount: 0,
        generatedLayerCoverage: "full",
        limitations: [],
      },
    });
    mocks.loadMesocycleWeekMuscleVolume.mockResolvedValue({});
    mocks.workoutFindMany.mockResolvedValue([
      {
        id: "upper-1",
        selectionMetadata: {
          slot: {
            slotId: "upper_a",
            intent: "upper",
            sequenceIndex: 0,
            source: "mesocycle_slot_sequence",
          },
          receipt: {
            sessionProvenance: {
              mesocycleId: "9b861675-c98f-42f7-bc8c-64a7de411b77",
              compositionSource: "persisted_slot_plan_seed",
            },
          },
        },
        exercises: [
          makeRuntimeExercise("close-grip-lat-pulldown", "Close-Grip Lat Pulldown", 0, [
            makeSkippedRuntimeSet(0, 100),
            makeSkippedRuntimeSet(1, 100),
            makeSkippedRuntimeSet(2, 100),
          ]),
          makeRuntimeExercise("machine-chest-press", "Machine Chest Press", 1, [
            makeRuntimeSet(0, 80, 10, 8),
            makeRuntimeSet(1, 80, 10, 8),
            makeRuntimeSet(2, 80, 10, 8),
          ]),
          makeRuntimeExercise("face-pull", "Face Pull", 2, [
            makeSkippedRuntimeSet(0, 30),
            makeSkippedRuntimeSet(1, 30),
          ]),
          makeRuntimeExercise("db-curl", "Dumbbell Curl", 3, [
            makeRuntimeSet(0, 25, 12, 8),
            makeRuntimeSet(1, 25, 12, 8),
          ]),
          makeRuntimeExercise("iso-front-lat-pulldown", "Iso-Lateral Front Lat Pulldown", 4, [
            makeRuntimeSet(0, 90, 10, 8),
            makeRuntimeSet(1, 90, 10, 8),
            makeRuntimeSet(2, 90, 10, 8),
          ]),
          makeRuntimeExercise("cable-crunch", "Cable Crunch", 5, [
            makeRuntimeSet(0, 40, 12, 8),
            makeRuntimeSet(1, 40, 12, 8),
          ]),
        ],
      },
      {
        id: "lower-1",
        selectionMetadata: {
          slot: {
            slotId: "lower_a",
            intent: "lower",
            sequenceIndex: 1,
            source: "mesocycle_slot_sequence",
          },
          receipt: {
            sessionProvenance: {
              mesocycleId: "9b861675-c98f-42f7-bc8c-64a7de411b77",
              compositionSource: "persisted_slot_plan_seed",
            },
          },
        },
        exercises: [
          makeRuntimeExercise("leg-press", "Leg Press", 0, [
            makeUnperformedRuntimeSet(0, 200),
            makeUnperformedRuntimeSet(1, 200),
            makeUnperformedRuntimeSet(2, 200),
            makeUnperformedRuntimeSet(3, 200),
          ]),
        ],
      },
    ]);
    mocks.getWeeklyVolumeTarget.mockReturnValue(0);

    const payload = await buildWeeklyRetroAuditPayload({
      userId: "user-1",
      week: 1,
      mesocycleId: "9b861675-c98f-42f7-bc8c-64a7de411b77",
    });
    const rowsByExercise = new Map(
      payload.exerciseLoadCalibrationRows?.map((row) => [row.exerciseId, row])
    );

    expect(payload.planAdherence).toMatchObject({
      plannedWorkTotalSets: 10,
      plannedWorkCompletedSets: 8,
      plannedWorkMissedSets: 2,
    });
    expect(payload.postSessionReview).toMatchObject({
      readOnly: true,
      seedRuntimeChanged: false,
      plannerMaterializerChanged: false,
      completedWorkoutIds: ["upper-1"],
      futurePlannedIncompleteWorkouts: [
        expect.objectContaining({
          workoutId: "lower-1",
          slotId: "lower_a",
          status: "PLANNED",
          mesocycleWeek: 1,
          mesoSession: 2,
          compositionSource: "persisted_slot_plan_seed",
        }),
      ],
    });
    expect(rowsByExercise.get("leg-press")).toMatchObject({
      reviewBucket: "future_planned_incomplete",
      classification: "skipped_or_low_coverage",
    });
    expect(rowsByExercise.get("close-grip-lat-pulldown")).toMatchObject({
      classification: "replacement_like",
      reviewBucket: "completed_session",
      replacementLike: expect.objectContaining({
        pairedExerciseId: "iso-front-lat-pulldown",
        movementPattern: "vertical_pull",
        seedMutation: false,
      }),
    });
    expect(rowsByExercise.get("iso-front-lat-pulldown")).toMatchObject({
      classification: "replacement_like",
      plannedSetCount: 0,
      performedSetCount: 3,
    });
    expect(rowsByExercise.get("face-pull")).toMatchObject({
      classification: "skipped_or_low_coverage",
      plannedSetCount: 2,
      performedSetCount: 0,
    });
    expect(rowsByExercise.get("cable-crunch")).toMatchObject({
      classification: "runtime_added",
      plannedSetCount: 0,
      performedSetCount: 2,
    });
  });
});

function makeHistoricalSession(input: {
  workoutId: string;
  scheduledDate: string;
  status: string;
  sessionIntent: string;
  mesoSession: number;
  generatedExercises: Array<{
    exerciseId: string;
    exerciseName: string;
    orderIndex: number;
    prescribedSetCount: number;
    prescribedSets: Array<{
      setIndex: number;
      targetReps: number;
      targetRpe: number;
      targetLoad: number;
    }>;
  }>;
  addedExerciseIds: string[];
}) {
  return {
    workoutId: input.workoutId,
    scheduledDate: input.scheduledDate,
    status: input.status,
    sessionIntent: input.sessionIntent,
    selectionMode: "INTENT",
    snapshotSource: "persisted",
    sessionSnapshot: {
      generated: {
        selectionMode: "INTENT",
        sessionIntent: input.sessionIntent,
        semantics: {
          kind: "advancing",
          isCloseout: false,
          isDeload: false,
          consumesWeeklyScheduleIntent: true,
          countsTowardProgressionHistory: input.status === "COMPLETED",
          countsTowardPerformanceHistory: input.status === "COMPLETED",
          updatesProgressionAnchor: input.status === "COMPLETED",
        },
        exerciseCount: input.generatedExercises.length,
        hardSetCount: input.generatedExercises.reduce(
          (sum, exercise) => sum + exercise.prescribedSetCount,
          0
        ),
        exercises: input.generatedExercises,
        traces: { progression: {} },
      },
      saved: {
        workoutId: input.workoutId,
        status: input.status,
        advancesSplit: true,
        mesocycleSnapshot: {
          mesocycleId: "9b861675-c98f-42f7-bc8c-64a7de411b77",
          week: 1,
          session: input.mesoSession,
          phase: "accumulation",
        },
        semantics: {
          kind: "advancing",
          isCloseout: false,
          isDeload: false,
          consumesWeeklyScheduleIntent: true,
          countsTowardProgressionHistory: input.status === "COMPLETED",
          countsTowardPerformanceHistory: input.status === "COMPLETED",
          updatesProgressionAnchor: input.status === "COMPLETED",
          reasons: ["advances_split_true"],
        },
      },
    },
    canonicalSemantics: {
      sourceLayer: "saved",
      phase: "accumulation",
      isDeload: false,
      countsTowardProgressionHistory: input.status === "COMPLETED",
      countsTowardPerformanceHistory: input.status === "COMPLETED",
      updatesProgressionAnchor: input.status === "COMPLETED",
    },
    progressionEvidence: {
      countsTowardProgressionHistory: input.status === "COMPLETED",
      countsTowardPerformanceHistory: input.status === "COMPLETED",
      updatesProgressionAnchor: input.status === "COMPLETED",
      reasonCodes: ["advances_split_true"],
    },
    reconciliation: {
      version: 1,
      comparisonState: "comparable",
      hasDrift: input.addedExerciseIds.length > 0,
      changedFields: input.addedExerciseIds.length > 0 ? ["exercise_added"] : [],
      addedExerciseIds: input.addedExerciseIds,
      removedExerciseIds: [],
      exercisesWithSetCountChanges: [],
      exercisesWithPrescriptionChanges: [],
    },
  };
}

function makeGeneratedExercise(
  exerciseId: string,
  exerciseName: string,
  orderIndex: number,
  prescribedSetCount: number
) {
  return {
    exerciseId,
    exerciseName,
    orderIndex,
    section: "accessory",
    isMainLift: false,
    prescribedSetCount,
    prescribedSets: Array.from({ length: prescribedSetCount }, (_, setIndex) => ({
      setIndex,
      targetReps: 10,
      targetRpe: 8,
      targetLoad: 100,
    })),
  };
}

function makeRuntimeExercise(
  exerciseId: string,
  name: string,
  orderIndex: number,
  sets: Array<{
    setIndex: number;
    targetReps: number;
    targetLoad: number;
    logs: Array<{
      actualReps?: number;
      actualRpe?: number;
      actualLoad?: number;
      wasSkipped: boolean;
    }>;
  }>
) {
  return {
    exerciseId,
    orderIndex,
    sets,
    exercise: {
      name,
      aliases: [],
      exerciseMuscles: [{ role: "PRIMARY", muscle: { name: "Test Muscle" } }],
    },
  };
}

function makeRuntimeSet(
  setIndex: number,
  load: number,
  reps: number,
  rpe: number
) {
  return {
    setIndex,
    targetReps: reps,
    targetLoad: load,
    logs: [
      {
        actualLoad: load,
        actualReps: reps,
        actualRpe: rpe,
        wasSkipped: false,
      },
    ],
  };
}

function makeSkippedRuntimeSet(setIndex: number, targetLoad: number) {
  return {
    setIndex,
    targetReps: 10,
    targetLoad,
    logs: [
      {
        wasSkipped: true,
      },
    ],
  };
}

function makeUnperformedRuntimeSet(setIndex: number, targetLoad: number) {
  return {
    setIndex,
    targetReps: 10,
    targetLoad,
    logs: [],
  };
}
