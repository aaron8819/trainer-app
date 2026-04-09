import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const loadProgramDashboardData = vi.fn();
  const loadProjectedWeekVolumeReport = vi.fn();
  const loadNextWorkoutContext = vi.fn();
  const mesocycleFindFirst = vi.fn();
  const constraintsFindUnique = vi.fn();
  const workoutFindMany = vi.fn();

  return {
    loadProgramDashboardData,
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

vi.mock("./program", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./program")>();
  return {
    ...actual,
    loadProgramDashboardData: (...args: unknown[]) => mocks.loadProgramDashboardData(...args),
    computeMesoWeekStart: (date: Date, week: number) => {
      const next = new Date(date);
      next.setDate(next.getDate() + (week - 1) * 7);
      return next;
    },
  };
});

vi.mock("./muscle-outcome-review", async (importOriginal) => {
  const original = await importOriginal<typeof import("./muscle-outcome-review")>();
  return {
    ...original,
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

  it("does not let a closeout workout appear as an extra slot row or linked slot workout", () => {
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
          id: "closeout-planned",
          status: "PLANNED",
          scheduledDate: new Date("2026-03-02T00:00:00.000Z"),
          sessionIntent: null,
          selectionMode: "MANUAL",
          selectionMetadata: {
            sessionDecisionReceipt: {
              version: 1,
              cycleContext: {
                weekInMeso: 2,
                weekInBlock: 2,
                phase: "accumulation",
                blockType: "accumulation",
                isDeload: false,
                source: "computed",
              },
              sessionSlot: {
                slotId: "upper_a",
                intent: "upper",
                sequenceIndex: 0,
                sequenceLength: 3,
                source: "mesocycle_slot_sequence",
              },
              lifecycleVolume: { source: "unknown" },
              sorenessSuppressedMuscles: [],
              deloadDecision: {
                mode: "none",
                reason: [],
                reductionPercent: 0,
                appliedTo: "none",
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
              exceptions: [{ code: "closeout_session", message: "Marked as closeout session." }],
            },
          },
          advancesSplit: false,
        },
      ],
      nextWorkoutContext: {
        intent: "upper",
        slotId: "upper_a",
        slotSequenceIndex: 0,
        slotSequenceLength: 3,
        slotSource: "mesocycle_slot_sequence",
        existingWorkoutId: null,
        isExisting: false,
        source: "rotation",
        weekInMeso: 2,
        sessionInWeek: 1,
        derivationTrace: [],
        selectedIncompleteStatus: null,
      },
    });

    expect(result?.slots).toEqual([
      {
        slotId: "upper_a",
        label: "Upper 1",
        sessionInWeek: 1,
        state: "next",
        linkedWorkoutId: null,
        linkedWorkoutStatus: null,
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
    ]);
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
      volumeThisWeek: [
        {
          muscle: "Chest",
          effectiveSets: 4,
          directSets: 4,
          indirectSets: 0,
          target: 10,
          mev: 6,
          mav: 16,
          mrv: 22,
          opportunityScore: 0,
          opportunityState: "high_opportunity",
          opportunityRationale: "Below target in this snapshot, with recovery room for more work.",
        },
        {
          muscle: "Biceps",
          effectiveSets: 8,
          directSets: 8,
          indirectSets: 0,
          target: 8,
          mev: 4,
          mav: 14,
          mrv: 18,
          opportunityScore: 0,
          opportunityState: "covered",
          opportunityRationale: "Weekly target is already covered in this volume snapshot.",
        },
        {
          muscle: "Quads",
          effectiveSets: 18,
          directSets: 18,
          indirectSets: 0,
          target: 10,
          mev: 6,
          mav: 16,
          mrv: 20,
          opportunityScore: 0,
          opportunityState: "deprioritize_today",
          opportunityRationale: "Recent weighted stimulus is already high for this muscle.",
        },
      ],
      deloadReadiness: null,
      rirTarget: { min: 2, max: 3 },
      coachingCue: "Build volume with crisp execution.",
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
      {
        id: "closeout-planned",
        status: "PLANNED",
        scheduledDate: new Date("2026-03-03T00:00:00.000Z"),
        sessionIntent: null,
        selectionMode: "MANUAL",
        selectionMetadata: {
          sessionDecisionReceipt: {
            version: 1,
            cycleContext: {
              weekInMeso: 2,
              weekInBlock: 2,
              phase: "accumulation",
              blockType: "accumulation",
              isDeload: false,
              source: "computed",
            },
            lifecycleVolume: { source: "unknown" },
            sorenessSuppressedMuscles: [],
            deloadDecision: {
              mode: "none",
              reason: [],
              reductionPercent: 0,
              appliedTo: "none",
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
            exceptions: [{ code: "closeout_session", message: "Marked as closeout session." }],
          },
        },
        advancesSplit: false,
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
    expect(result.closeout).toEqual({
      workoutId: "closeout-planned",
      status: "planned",
      statusLabel: "Planned",
      detail:
        "Optional manual closeout work. It counts toward actual weekly volume once performed, but it is not a remaining slot.",
      actionHref: "/log/closeout-planned",
      actionLabel: "Open closeout",
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
    expect(result.volumeDetails.currentWeekStatusSummary).toEqual({
      below_mev: 1,
      in_range: 0,
      near_target: 0,
      on_target: 1,
      near_mrv: 1,
      at_mrv: 0,
    });
    expect(result.advancedActions.availableActions).toEqual(["deload", "extend_phase", "reset"]);
  });
});
