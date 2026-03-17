import { describe, expect, it, vi } from "vitest";
import { loadMesocycleReview } from "./mesocycle-review";

function buildBenchExercise(load: number) {
  return {
    exerciseId: "bench",
    exercise: {
      id: "bench",
      name: "Bench Press",
      aliases: [],
      exerciseMuscles: [
        { role: "PRIMARY" as const, muscle: { name: "Chest" } },
        { role: "SECONDARY" as const, muscle: { name: "Triceps" } },
        { role: "SECONDARY" as const, muscle: { name: "Front Delts" } },
      ],
    },
    sets: Array.from({ length: 3 }, (_, index) => ({
      setIndex: index + 1,
      logs: [
        {
          wasSkipped: false,
          actualReps: 8,
          actualLoad: load,
          actualRpe: 8,
        },
      ],
    })),
  };
}

describe("loadMesocycleReview", () => {
  it("loads frozen handoff data and derives mesocycle-scoped review metrics from mesocycleId", async () => {
    const mesocycleFindFirst = vi.fn().mockResolvedValue({
      id: "meso-1",
      mesoNumber: 3,
      focus: "Upper Hypertrophy",
      state: "AWAITING_HANDOFF",
      startWeek: 0,
      durationWeeks: 5,
      sessionsPerWeek: 4,
      closedAt: new Date("2026-04-01T00:00:00.000Z"),
      handoffSummaryJson: {
        version: 1,
        mesocycleId: "meso-1",
        macroCycleId: "macro-1",
        mesoNumber: 3,
        closedAt: "2026-04-01T00:00:00.000Z",
        lifecycle: {
          terminalState: "AWAITING_HANDOFF",
          durationWeeks: 5,
          accumulationSessionsCompleted: 8,
          deloadSessionsCompleted: 1,
          deloadExcludedFromNextBaseline: true,
        },
        training: {
          focus: "Upper Hypertrophy",
          splitType: "UPPER_LOWER",
          sessionsPerWeek: 4,
          daysPerWeek: 4,
          weeklySequence: ["UPPER", "LOWER", "UPPER", "LOWER"],
        },
        carryForwardRecommendations: [
          {
            exerciseId: "bench",
            exerciseName: "Bench Press",
            sessionIntent: "UPPER",
            role: "CORE_COMPOUND",
            recommendation: "keep",
            signalQuality: "high",
            reasonCodes: ["core_compound_continuity"],
          },
        ],
        recommendedNextSeed: {
          version: 1,
          sourceMesocycleId: "meso-1",
          createdAt: "2026-04-01T00:00:00.000Z",
          structure: {
            splitType: "UPPER_LOWER",
            sessionsPerWeek: 4,
            daysPerWeek: 4,
            sequenceMode: "ordered_flexible",
            slots: [
              { slotId: "upper_a", intent: "UPPER" },
              { slotId: "lower_a", intent: "LOWER" },
              { slotId: "upper_b", intent: "UPPER" },
              { slotId: "lower_b", intent: "LOWER" },
            ],
          },
          startingPoint: {
            volumePreset: "conservative_productive",
            baselineRule: "peak_accumulation_else_highest_accumulation_else_non_deload",
            excludeDeload: true,
          },
          carryForwardSelections: [
            {
              exerciseId: "bench",
              exerciseName: "Bench Press",
              sessionIntent: "UPPER",
              role: "CORE_COMPOUND",
              action: "keep",
            },
          ],
        },
      },
      macroCycle: {
        startDate: new Date("2026-03-02T00:00:00.000Z"),
      },
      blocks: [],
    });

    const workoutFindMany = vi.fn().mockResolvedValue([
      {
        id: "wk1-skip",
        scheduledDate: new Date("2026-03-05T00:00:00.000Z"),
        completedAt: null,
        status: "SKIPPED",
        sessionIntent: "UPPER",
        selectionMode: "AUTO",
        selectionMetadata: null,
        advancesSplit: true,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesocycleWeekSnapshot: null,
        exercises: [],
      },
      {
        id: "wk2-upper-a",
        scheduledDate: new Date("2026-03-25T00:00:00.000Z"),
        completedAt: new Date("2026-03-25T01:00:00.000Z"),
        status: "COMPLETED",
        sessionIntent: "UPPER",
        selectionMode: "AUTO",
        selectionMetadata: null,
        advancesSplit: true,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesocycleWeekSnapshot: 2,
        exercises: [buildBenchExercise(100)],
      },
      {
        id: "wk2-upper-b",
        scheduledDate: new Date("2026-03-27T00:00:00.000Z"),
        completedAt: new Date("2026-03-27T01:00:00.000Z"),
        status: "COMPLETED",
        sessionIntent: "UPPER",
        selectionMode: "AUTO",
        selectionMetadata: null,
        advancesSplit: true,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesocycleWeekSnapshot: 2,
        exercises: [buildBenchExercise(110)],
      },
      {
        id: "optional-gap-fill",
        scheduledDate: new Date("2026-03-06T00:00:00.000Z"),
        completedAt: new Date("2026-03-06T01:00:00.000Z"),
        status: "COMPLETED",
        sessionIntent: "BODY_PART",
        selectionMode: "INTENT",
        selectionMetadata: {
          optionalGapFill: { enabled: true },
        },
        advancesSplit: false,
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesocycleWeekSnapshot: 1,
        exercises: [],
      },
    ]);

    const result = await loadMesocycleReview(
      {
        mesocycle: { findFirst: mesocycleFindFirst },
        workout: { findMany: workoutFindMany },
      } as never,
      { userId: "user-1", mesocycleId: "meso-1" }
    );

    expect(result).not.toBeNull();
    expect(result?.archive).toEqual({
      currentState: "AWAITING_HANDOFF",
      reviewState: "pending_handoff",
      isEditableHandoff: true,
    });
    expect(result?.frozenSummary.training.splitType).toBe("UPPER_LOWER");
    expect(result?.derived.adherence).toMatchObject({
      plannedSessions: 3,
      performedSessions: 2,
      coreCompletedSessions: 2,
      skippedSessions: 1,
      optionalPerformedSessions: 1,
      adherenceRate: 0.667,
    });
    expect(result?.derived.weeklyBreakdown.find((week) => week.week === 2)).toMatchObject({
      plannedSessions: 2,
      performedSessions: 2,
    });
    expect(result?.derived.weeklyBreakdown.find((week) => week.week === 4)).toMatchObject({
      plannedSessions: 0,
      performedSessions: 0,
    });
    expect(result?.derived.topProgressedExercises[0]).toMatchObject({
      exerciseId: "bench",
      exerciseName: "Bench Press",
      signal: "estimated_strength",
    });
    expect(result?.derived.topProgressedExercises[0]?.summary).toMatch(/Estimated strength up/i);
    expect(result?.derived.muscleVolumeSummary.find((row) => row.muscle === "Chest")).toMatchObject({
      targetSets: expect.any(Number),
      actualEffectiveSets: 6,
    });
    expect(workoutFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          mesocycleId: "meso-1",
        }),
      })
    );
  });

  it("returns null when the mesocycle has no readable frozen handoff summary", async () => {
    const result = await loadMesocycleReview(
      {
        mesocycle: {
          findFirst: vi.fn().mockResolvedValue({
            id: "meso-1",
            mesoNumber: 1,
            focus: "Test",
            state: "AWAITING_HANDOFF",
            startWeek: 0,
            durationWeeks: 5,
            sessionsPerWeek: 4,
            closedAt: null,
            handoffSummaryJson: null,
            macroCycle: { startDate: new Date("2026-03-02T00:00:00.000Z") },
            blocks: [],
          }),
        },
        workout: { findMany: vi.fn() },
      } as never,
      { userId: "user-1", mesocycleId: "meso-1" }
    );

    expect(result).toBeNull();
  });

  it("loads historical closeout review data for COMPLETED mesocycles without exposing editable handoff state", async () => {
    const result = await loadMesocycleReview(
      {
        mesocycle: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: "meso-1",
              state: "COMPLETED",
              mesoNumber: 3,
              focus: "Upper Hypertrophy",
              closedAt: new Date("2026-04-01T00:00:00.000Z"),
              handoffSummaryJson: {
                version: 1,
                mesocycleId: "meso-1",
                macroCycleId: "macro-1",
                mesoNumber: 3,
                closedAt: "2026-04-01T00:00:00.000Z",
                lifecycle: {
                  terminalState: "AWAITING_HANDOFF",
                  durationWeeks: 5,
                  accumulationSessionsCompleted: 8,
                  deloadSessionsCompleted: 1,
                  deloadExcludedFromNextBaseline: true,
                },
                training: {
                  focus: "Upper Hypertrophy",
                  splitType: "UPPER_LOWER",
                  sessionsPerWeek: 4,
                  daysPerWeek: 4,
                  weeklySequence: ["UPPER", "LOWER", "UPPER", "LOWER"],
                },
                carryForwardRecommendations: [],
                recommendedNextSeed: {
                  version: 1,
                  sourceMesocycleId: "meso-1",
                  createdAt: "2026-04-01T00:00:00.000Z",
                  structure: {
                    splitType: "UPPER_LOWER",
                    sessionsPerWeek: 4,
                    daysPerWeek: 4,
                    sequenceMode: "ordered_flexible",
                    slots: [
                      { slotId: "upper_a", intent: "UPPER" },
                      { slotId: "lower_a", intent: "LOWER" },
                    ],
                  },
                  startingPoint: {
                    volumePreset: "conservative_productive",
                    baselineRule: "peak_accumulation_else_highest_accumulation_else_non_deload",
                    excludeDeload: true,
                  },
                  carryForwardSelections: [],
                },
              },
              nextSeedDraftJson: {
                version: 999,
              },
            })
            .mockResolvedValueOnce({
              id: "meso-1",
              mesoNumber: 3,
              focus: "Upper Hypertrophy",
              state: "COMPLETED",
              startWeek: 0,
              durationWeeks: 5,
              sessionsPerWeek: 4,
              closedAt: new Date("2026-04-01T00:00:00.000Z"),
              handoffSummaryJson: {
                version: 1,
              },
              macroCycle: {
                startDate: new Date("2026-03-02T00:00:00.000Z"),
              },
              blocks: [],
            }),
        },
        workout: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as never,
      { userId: "user-1", mesocycleId: "meso-1" }
    );

    expect(result?.archive).toEqual({
      currentState: "COMPLETED",
      reviewState: "historical_closeout",
      isEditableHandoff: false,
    });
  });
});
