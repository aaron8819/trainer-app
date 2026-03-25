import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const loadProgramDashboardData = vi.fn();
  const loadWeeklyMuscleOutcomeFromPrisma = vi.fn();
  const loadProjectedWeekVolumeReport = vi.fn();
  const loadNextWorkoutContext = vi.fn();
  const mesocycleFindFirst = vi.fn();
  const constraintsFindUnique = vi.fn();
  const workoutFindMany = vi.fn();

  return {
    loadProgramDashboardData,
    loadWeeklyMuscleOutcomeFromPrisma,
    loadProjectedWeekVolumeReport,
    loadNextWorkoutContext,
    mesocycleFindFirst,
    constraintsFindUnique,
    workoutFindMany,
    prisma: {
      mesocycle: { findFirst: mesocycleFindFirst },
      constraints: { findUnique: constraintsFindUnique },
      workout: { findMany: workoutFindMany },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("./program", () => ({
  loadProgramDashboardData: (...args: unknown[]) => mocks.loadProgramDashboardData(...args),
  computeMesoWeekStart: (date: Date, week: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + (week - 1) * 7);
    return next;
  },
}));

vi.mock("./muscle-outcome-review", async (importOriginal) => {
  const original = await importOriginal<typeof import("./muscle-outcome-review")>();
  return {
    ...original,
    loadWeeklyMuscleOutcomeFromPrisma: (...args: unknown[]) =>
      mocks.loadWeeklyMuscleOutcomeFromPrisma(...args),
  };
});

vi.mock("./projected-week-volume", () => ({
  loadProjectedWeekVolumeReport: (...args: unknown[]) =>
    mocks.loadProjectedWeekVolumeReport(...args),
}));

vi.mock("./next-session", async (importOriginal) => {
  const original = await importOriginal<typeof import("./next-session")>();
  return {
    ...original,
    loadNextWorkoutContext: (...args: unknown[]) => mocks.loadNextWorkoutContext(...args),
  };
});

import { buildMesocycleSlotSequence } from "./mesocycle-slot-contract";
import { buildProgramCurrentWeekPlan, loadProgramPageData } from "./program-page";

describe("buildProgramCurrentWeekPlan", () => {
  it("marks ordered slots as completed, next, and remaining from canonical runtime context", () => {
    const slotSequenceJson = buildMesocycleSlotSequence([
      { slotId: "upper_a", intent: "UPPER" },
      { slotId: "lower_a", intent: "LOWER" },
      { slotId: "upper_b", intent: "UPPER" },
    ]);

    const result = buildProgramCurrentWeekPlan({
      week: 2,
      slotSequenceJson,
      weeklySchedule: [],
      currentWeekWorkouts: [
        {
          id: "completed-upper",
          status: "COMPLETED",
          scheduledDate: new Date("2026-03-02T00:00:00.000Z"),
          sessionIntent: "UPPER",
          selectionMode: "INTENT",
          selectionMetadata: null,
          advancesSplit: true,
        },
      ],
      nextWorkoutContext: {
        intent: "lower",
        slotId: "lower_a",
        slotSequenceIndex: 1,
        slotSequenceLength: 3,
        slotSource: "mesocycle_slot_sequence",
        existingWorkoutId: "planned-lower",
        isExisting: true,
        source: "existing_incomplete",
        weekInMeso: null,
        sessionInWeek: null,
        derivationTrace: [],
        selectedIncompleteStatus: "planned",
      },
    });

    expect(result).toEqual({
      week: 2,
      nextSessionImpact: null,
      slots: [
        {
          slotId: "upper_a",
          label: "Upper 1",
          sessionInWeek: 1,
          state: "completed",
          linkedWorkoutId: null,
          linkedWorkoutStatus: null,
        },
        {
          slotId: "lower_a",
          label: "Lower 1",
          sessionInWeek: 2,
          state: "next",
          linkedWorkoutId: "planned-lower",
          linkedWorkoutStatus: "planned",
        },
        {
          slotId: "upper_b",
          label: "Upper 2",
          sessionInWeek: 3,
          state: "remaining",
          linkedWorkoutId: null,
          linkedWorkoutStatus: null,
        },
      ],
    });
  });
});

describe("loadProgramPageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.loadProgramDashboardData.mockResolvedValue({
      activeMeso: {
        mesoNumber: 2,
        focus: "Strength-Hypertrophy",
        durationWeeks: 5,
        completedSessions: 4,
        volumeTarget: "moderate",
        currentBlockType: "accumulation",
        blocks: [{ blockType: "accumulation", startWeek: 1, durationWeeks: 5 }],
      },
      currentWeek: 2,
      viewedWeek: 2,
      viewedBlockType: "accumulation",
      sessionsUntilDeload: 6,
      volumeThisWeek: [],
      deloadReadiness: null,
      rirTarget: { min: 2, max: 3 },
      coachingCue: "Build volume with crisp execution.",
    });
    mocks.loadWeeklyMuscleOutcomeFromPrisma.mockResolvedValue({
      mesocycleId: "meso-1",
      week: 2,
      weekStart: "2026-03-02",
      rows: [{ muscle: "Chest", status: "on_target" }],
    });
    mocks.loadProjectedWeekVolumeReport.mockResolvedValue({
      currentWeek: {
        mesocycleId: "meso-1",
        week: 2,
        phase: "accumulation",
        blockType: "accumulation",
      },
      projectionNotes: [],
      completedVolumeByMuscle: {},
      projectedSessions: [
        {
          slotId: "upper_a",
          intent: "upper",
          isNext: true,
          exerciseCount: 5,
          totalSets: 14,
          projectedContributionByMuscle: {
            Chest: 4,
          },
        },
      ],
      fullWeekByMuscle: [
        {
          muscle: "Chest",
          completedEffectiveSets: 4,
          projectedNextSessionEffectiveSets: 4,
          projectedRemainingWeekEffectiveSets: 0,
          projectedFullWeekEffectiveSets: 8,
          weeklyTarget: 10,
          mev: 6,
          mav: 16,
          deltaToTarget: -2,
          deltaToMev: 2,
          deltaToMav: -8,
        },
        {
          muscle: "Quads",
          completedEffectiveSets: 12,
          projectedNextSessionEffectiveSets: 0,
          projectedRemainingWeekEffectiveSets: 3,
          projectedFullWeekEffectiveSets: 15,
          weeklyTarget: 10,
          mev: 6,
          mav: 16,
          deltaToTarget: 5,
          deltaToMev: 9,
          deltaToMav: -1,
        },
      ],
    });
    mocks.mesocycleFindFirst.mockResolvedValue({
      id: "meso-1",
      startWeek: 0,
      durationWeeks: 5,
      accumulationSessionsCompleted: 4,
      deloadSessionsCompleted: 0,
      sessionsPerWeek: 3,
      state: "ACTIVE_ACCUMULATION",
      slotSequenceJson: buildMesocycleSlotSequence([
        { slotId: "upper_a", intent: "UPPER" },
        { slotId: "lower_a", intent: "LOWER" },
        { slotId: "upper_b", intent: "UPPER" },
      ]),
      macroCycle: { startDate: new Date("2026-03-02T00:00:00.000Z") },
    });
    mocks.constraintsFindUnique.mockResolvedValue({
      weeklySchedule: ["UPPER", "LOWER", "UPPER"],
    });
    mocks.workoutFindMany.mockResolvedValue([
      {
        id: "planned-upper",
        status: "PLANNED",
        scheduledDate: new Date("2026-03-02T00:00:00.000Z"),
        sessionIntent: "UPPER",
        selectionMode: "INTENT",
        selectionMetadata: {
          sessionDecisionReceipt: {
            sessionSlot: {
              slotId: "upper_a",
              intent: "upper",
              sequenceIndex: 0,
              sequenceLength: 3,
              source: "mesocycle_slot_sequence",
            },
          },
        },
        advancesSplit: true,
      },
    ]);
    mocks.loadNextWorkoutContext.mockResolvedValue({
      intent: "upper",
      slotId: "upper_a",
      slotSequenceIndex: 0,
      slotSequenceLength: 3,
      slotSource: "mesocycle_slot_sequence",
      existingWorkoutId: "planned-upper",
      isExisting: true,
      source: "existing_incomplete",
      weekInMeso: 2,
      sessionInWeek: 1,
      derivationTrace: [],
      selectedIncompleteStatus: "planned",
    });
  });

  it("composes overview, current-week plan, week-completion outlook, volume details, and advanced actions", async () => {
    const result = await loadProgramPageData("user-1");

    expect(result.overview).toMatchObject({
      mesoNumber: 2,
      focus: "Strength-Hypertrophy",
      currentWeek: 2,
      percentComplete: 40,
      sessionsUntilDeload: 6,
    });
    expect(result.currentWeekPlan).toEqual({
      week: 2,
      slots: [
        {
          slotId: "upper_a",
          label: "Upper 1",
          sessionInWeek: 1,
          state: "next",
          linkedWorkoutId: "planned-upper",
          linkedWorkoutStatus: "planned",
        },
        {
          slotId: "lower_a",
          label: "Lower 1",
          sessionInWeek: 2,
          state: "remaining",
          linkedWorkoutId: null,
          linkedWorkoutStatus: null,
        },
        {
          slotId: "upper_b",
          label: "Upper 2",
          sessionInWeek: 3,
          state: "remaining",
          linkedWorkoutId: null,
          linkedWorkoutStatus: null,
        },
      ],
      nextSessionImpact: {
        slotLabel: "Upper 1",
        topMuscles: [
          {
            muscle: "Chest",
            projectedEffectiveSets: 4,
          },
        ],
        summaryLabel: "Next session impact: likely increases Chest",
      },
    });
    expect(result.weekCompletionOutlook).toEqual({
      assumptionLabel: "If you complete the remaining planned sessions this week, you will likely land here.",
      summary: {
        meaningfullyLow: 0,
        slightlyLow: 1,
        onTarget: 0,
        slightlyHigh: 0,
        meaningfullyHigh: 1,
      },
      rows: [
        {
          muscle: "Quads",
          status: "meaningfully_high",
          projectedFullWeekEffectiveSets: 15,
          targetSets: 10,
          delta: 5,
        },
        {
          muscle: "Chest",
          status: "slightly_low",
          projectedFullWeekEffectiveSets: 8,
          targetSets: 10,
          delta: -2,
        },
      ],
      defaultRows: [
        {
          muscle: "Quads",
          status: "meaningfully_high",
          projectedFullWeekEffectiveSets: 15,
          targetSets: 10,
          delta: 5,
        },
        {
          muscle: "Chest",
          status: "slightly_low",
          projectedFullWeekEffectiveSets: 8,
          targetSets: 10,
          delta: -2,
        },
      ],
    });
    expect(result.volumeDetails.currentWeekOutcome).toMatchObject({
      week: 2,
    });
    expect(result.volumeDetails.currentWeekOutcomeSummary).toEqual({
      meaningfullyLow: 0,
      slightlyLow: 0,
      onTarget: 1,
      slightlyHigh: 0,
      meaningfullyHigh: 0,
    });
    expect(result.advancedActions.availableActions).toEqual(["deload", "extend_phase", "reset"]);
  });
});
