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
          sessionIntent: "PUSH",
          sessionSnapshot: {
            saved: {
              semantics: {
                kind: "advancing",
                consumesWeeklyScheduleIntent: true,
              },
            },
          },
          reconciliation: {
            hasDrift: true,
            changedFields: ["exercise_prescription_changed", "selection_mode"],
          },
        },
        {
          workoutId: "workout-2",
          sessionIntent: "PULL",
          sessionSnapshot: {
            saved: {
              semantics: {
                kind: "advancing",
                consumesWeeklyScheduleIntent: true,
              },
            },
          },
          reconciliation: {
            hasDrift: false,
            changedFields: [],
          },
        },
        {
          workoutId: "workout-3",
          sessionIntent: "LEGS",
          sessionSnapshot: {
            saved: {
              semantics: {
                kind: "advancing",
                consumesWeeklyScheduleIntent: true,
              },
            },
          },
          reconciliation: {
            hasDrift: false,
            changedFields: [],
          },
        },
      ],
      summary: {
        sessionCount: 3,
        progressionEligibleCount: 2,
        progressionExcludedCount: 1,
      },
      comparabilityCoverage: {
        comparableSessionCount: 2,
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
  });
});
