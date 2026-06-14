import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadMesocycleReview } from "./mesocycle-review";

function buildBenchExercise(load: number, id = `bench-${load}`) {
  return {
    id,
    exerciseId: "bench",
    orderIndex: 1,
    section: "MAIN",
    isMainLift: true,
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
      id: `${id}-set-${index + 1}`,
      setIndex: index + 1,
      targetReps: 8,
      targetRepMin: 8,
      targetRepMax: 12,
      targetRpe: 8,
      targetLoad: 100,
      logs: [
        {
          wasSkipped: false,
          actualReps: 8,
          actualLoad: load,
          actualRpe: 8,
          completedAt: new Date("2026-03-25T01:00:00.000Z"),
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
            volumeEntry: "conservative",
            baselineSource: "accumulation_preferred",
            allowNonDeloadFallback: true,
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
        revision: 1,
        scheduledDate: new Date("2026-03-05T00:00:00.000Z"),
        completedAt: null,
        status: "SKIPPED",
        sessionIntent: "UPPER",
        selectionMode: "AUTO",
        selectionMetadata: null,
        advancesSplit: true,
        mesocycleId: "meso-1",
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesocycleWeekSnapshot: null,
        mesoSessionSnapshot: null,
        exercises: [],
      },
      {
        id: "wk2-upper-a",
        revision: 2,
        scheduledDate: new Date("2026-03-25T00:00:00.000Z"),
        completedAt: new Date("2026-03-25T01:00:00.000Z"),
        status: "COMPLETED",
        sessionIntent: "UPPER",
        selectionMode: "AUTO",
        selectionMetadata: null,
        advancesSplit: true,
        mesocycleId: "meso-1",
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesocycleWeekSnapshot: 2,
        mesoSessionSnapshot: 1,
        exercises: [buildBenchExercise(100, "we-bench-a")],
      },
      {
        id: "wk2-upper-b",
        revision: 2,
        scheduledDate: new Date("2026-03-27T00:00:00.000Z"),
        completedAt: new Date("2026-03-27T01:00:00.000Z"),
        status: "COMPLETED",
        sessionIntent: "UPPER",
        selectionMode: "AUTO",
        selectionMetadata: null,
        advancesSplit: true,
        mesocycleId: "meso-1",
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesocycleWeekSnapshot: 2,
        mesoSessionSnapshot: 2,
        exercises: [buildBenchExercise(110, "we-bench-b")],
      },
      {
        id: "optional-gap-fill",
        revision: 2,
        scheduledDate: new Date("2026-03-06T00:00:00.000Z"),
        completedAt: new Date("2026-03-06T01:00:00.000Z"),
        status: "COMPLETED",
        sessionIntent: "BODY_PART",
        selectionMode: "INTENT",
        selectionMetadata: {
          optionalGapFill: { enabled: true },
        },
        advancesSplit: false,
        mesocycleId: "meso-1",
        mesocyclePhaseSnapshot: "ACCUMULATION",
        mesocycleWeekSnapshot: 1,
        mesoSessionSnapshot: null,
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
    expect(result?.derived.weeklyRetroCalibration).toMatchObject({
      status: "info",
      headline: "Execution stable as planned",
      rowCount: 2,
      patternCount: 1,
      source: {
        ownerSeam: "api/mesocycle-review",
        contractOwnerSeam: "api/weekly-retro-calibration-contract",
        readOnly: true,
        evidenceOnly: true,
        noMutationNote: "No seed or plan changes made",
      },
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

  it("keeps duplicate same-exercise workout rows visible in the calibration display count", async () => {
    const result = await loadMesocycleReview(
      {
        mesocycle: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({
              id: "meso-1",
              state: "AWAITING_HANDOFF",
              handoffSummaryJson: {
                version: 1,
                mesocycleId: "meso-1",
                macroCycleId: "macro-1",
                mesoNumber: 1,
                closedAt: "2026-04-01T00:00:00.000Z",
                lifecycle: {
                  terminalState: "AWAITING_HANDOFF",
                  durationWeeks: 5,
                  accumulationSessionsCompleted: 1,
                  deloadSessionsCompleted: 0,
                  deloadExcludedFromNextBaseline: true,
                },
                training: {
                  focus: "Test",
                  splitType: "UPPER_LOWER",
                  sessionsPerWeek: 4,
                  daysPerWeek: 4,
                  weeklySequence: ["UPPER", "LOWER"],
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
                    slots: [{ slotId: "upper_a", intent: "UPPER" }],
                  },
                  startingPoint: {
                    volumeEntry: "conservative",
                    baselineSource: "accumulation_preferred",
                    allowNonDeloadFallback: true,
                  },
                  carryForwardSelections: [],
                },
              },
            })
            .mockResolvedValueOnce({
              id: "meso-1",
              mesoNumber: 1,
              focus: "Test",
              state: "AWAITING_HANDOFF",
              startWeek: 0,
              durationWeeks: 5,
              sessionsPerWeek: 4,
              closedAt: new Date("2026-04-01T00:00:00.000Z"),
              handoffSummaryJson: { version: 1 },
              macroCycle: { startDate: new Date("2026-03-02T00:00:00.000Z") },
              blocks: [],
            }),
        },
        workout: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "wk2-upper-a",
              revision: 2,
              scheduledDate: new Date("2026-03-25T00:00:00.000Z"),
              completedAt: new Date("2026-03-25T01:00:00.000Z"),
              status: "COMPLETED",
              sessionIntent: "UPPER",
              selectionMode: "AUTO",
              selectionMetadata: null,
              advancesSplit: true,
              mesocycleId: "meso-1",
              mesocyclePhaseSnapshot: "ACCUMULATION",
              mesocycleWeekSnapshot: 2,
              mesoSessionSnapshot: 1,
              exercises: [
                buildBenchExercise(75, "we-bench-a"),
                { ...buildBenchExercise(125, "we-bench-b"), orderIndex: 2 },
              ],
            },
          ]),
        },
      } as never,
      { userId: "user-1", mesocycleId: "meso-1" }
    );

    expect(result?.derived.weeklyRetroCalibration).toMatchObject({
      headline: "Mixed weekly execution signals",
      rowCount: 2,
    });
    expect(result?.derived.weeklyRetroCalibration?.detail).toContain(
      "2 performed-reality rows"
    );
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
                    volumeEntry: "conservative",
                    baselineSource: "accumulation_preferred",
                    allowNonDeloadFallback: true,
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
    expect(result?.derived.weeklyRetroCalibration).toBeNull();
  });

  it("does not import audit artifact or mutation paths for the app-owned weekly calibration consumer", () => {
    const source = readFileSync("src/lib/api/mesocycle-review.ts", "utf8");

    expect(source).toContain("./weekly-retro-calibration-contract");
    expect(source).not.toContain("@/lib/audit/workout-audit");
    expect(source).not.toContain("buildWeeklyRetroAuditPayload");
    expect(source).not.toContain("workout-audit-cli");
    expect(source).not.toContain("scripts/workout-audit");
    expect(source).not.toContain("artifacts/audits");
    expect(source).not.toContain(".create(");
    expect(source).not.toContain(".update(");
    expect(source).not.toContain(".upsert(");
    expect(source).not.toContain(".delete(");
  });
});
