import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const workoutFindFirst = vi.fn();
  const workoutFindMany = vi.fn();
  const loadPendingMesocycleHandoff = vi.fn();
  const loadProgramDashboardData = vi.fn();
  const loadHomeProgramSupport = vi.fn();

  return {
    workoutFindFirst,
    workoutFindMany,
    loadPendingMesocycleHandoff,
    loadProgramDashboardData,
    loadHomeProgramSupport,
    prisma: {
      workout: {
        findFirst: workoutFindFirst,
        findMany: workoutFindMany,
      },
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("./mesocycle-handoff", () => ({
  loadPendingMesocycleHandoff: (...args: unknown[]) =>
    mocks.loadPendingMesocycleHandoff(...args),
}));

vi.mock("./program", () => ({
  loadProgramDashboardData: (...args: unknown[]) =>
    mocks.loadProgramDashboardData(...args),
  loadHomeProgramSupport: (...args: unknown[]) =>
    mocks.loadHomeProgramSupport(...args),
}));

import { loadHomePageData } from "./home-page";

function makeWorkoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "workout-1",
    scheduledDate: new Date("2026-03-24T00:00:00.000Z"),
    completedAt: new Date("2026-03-24T01:00:00.000Z"),
    status: "COMPLETED",
    selectionMode: "INTENT",
    sessionIntent: "UPPER",
    mesocycleId: "meso-1",
    mesocycleWeekSnapshot: 2,
    mesoSessionSnapshot: 1,
    mesocyclePhaseSnapshot: "ACCUMULATION",
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
        exceptions: [],
      },
    },
    mesocycle: {
      sessionsPerWeek: 4,
      state: "ACTIVE_ACCUMULATION",
      isActive: true,
    },
    _count: { exercises: 5 },
    exercises: [],
    ...overrides,
  };
}

describe("loadHomePageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.loadPendingMesocycleHandoff.mockResolvedValue(null);
    mocks.workoutFindFirst.mockResolvedValue(makeWorkoutRow());
    mocks.workoutFindMany.mockResolvedValue([
      makeWorkoutRow({ id: "activity-1" }),
      makeWorkoutRow({
        id: "activity-2",
        status: "PLANNED",
        completedAt: null,
        sessionIntent: "LOWER",
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
              slotId: "lower_a",
              intent: "lower",
              sequenceIndex: 1,
              sequenceLength: 4,
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
            exceptions: [],
          },
        },
      }),
      makeWorkoutRow({ id: "activity-3", sessionIntent: "PULL" }),
    ]);
    mocks.loadProgramDashboardData.mockResolvedValue({
      activeMeso: {
        mesoNumber: 2,
        focus: "Strength-Hypertrophy",
        durationWeeks: 5,
        completedSessions: 4,
        volumeTarget: "moderate",
        currentBlockType: "accumulation",
        blocks: [],
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
    mocks.loadHomeProgramSupport.mockResolvedValue({
      nextSession: {
        intent: "lower",
        slotId: "lower_a",
        slotSequenceIndex: 1,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        weekInMeso: 2,
        sessionInWeek: 2,
        workoutId: null,
        isExisting: false,
      },
      lastSessionSkipped: false,
      latestIncomplete: null,
      gapFill: {
        eligible: false,
        visible: false,
        reason: "no_pending_week_close",
        weekCloseId: null,
        anchorWeek: null,
        targetWeek: null,
        targetPhase: null,
        resolution: null,
        workflowState: null,
        deficitState: null,
        remainingDeficitSets: 0,
        targetMuscles: [],
        deficitSummary: [],
        alreadyUsedThisWeek: false,
        suppressedByStartedNextWeek: false,
        linkedWorkout: null,
        policy: {
          requiredSessionsPerWeek: 4,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
      },
      closeout: {
        visible: false,
        workoutId: null,
        status: null,
        targetWeek: null,
        isIncomplete: false,
      },
    });
  });

  it("composes decision, continuity, recent activity preview, and compact program inputs", async () => {
    const result = await loadHomePageData("user-1");

    expect(result.pendingHandoff).toBeNull();
    expect(result.headerContext).toBe("Week 2 - Accumulation");
    expect(result.decision).toEqual({
      nextSessionLabel: "Lower 1",
      nextSessionDescription: "First lower session this week",
      nextSessionReasonLabel: "Next in sequence",
      nextSessionReason: "Nothing earlier is still open, so Lower 1 is next this week.",
      activeWeekLabel: "Week 2 - Session 2 of 4",
    });
    expect(result.continuity).toMatchObject({
      nextDueLabel: "Lower 1",
      lastCompletedDescriptor: "Upper session",
      nextDueDescriptor: "First lower session this week",
      summary: null,
    });
    expect(result.closeout).toBeNull();
    expect(result.recentActivity).toHaveLength(3);
    expect(mocks.workoutFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
      })
    );
  });

  it("returns recent activity without loading program seams when handoff is pending", async () => {
    mocks.loadPendingMesocycleHandoff.mockResolvedValue({
      mesocycleId: "meso-1",
      mesoNumber: 2,
      focus: "Strength-Hypertrophy",
    });

    const result = await loadHomePageData("user-1");

    expect(result.pendingHandoff).toMatchObject({
      mesocycleId: "meso-1",
    });
    expect(result.programData).toBeNull();
    expect(result.homeProgram).toBeNull();
    expect(mocks.loadProgramDashboardData).not.toHaveBeenCalled();
    expect(mocks.loadHomeProgramSupport).not.toHaveBeenCalled();
    expect(result.recentActivity).toHaveLength(3);
  });

  it("uses resume reasoning when an incomplete workout exists even if the next-session seam has rotation context", async () => {
    mocks.loadHomeProgramSupport.mockResolvedValue({
      nextSession: {
        intent: "lower",
        slotId: "lower_a",
        slotSequenceIndex: 1,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        weekInMeso: 2,
        sessionInWeek: 2,
        workoutId: "workout-planned",
        isExisting: true,
      },
      lastSessionSkipped: false,
      latestIncomplete: {
        id: "workout-planned",
        status: "planned",
      },
      gapFill: {
        eligible: false,
        visible: false,
        reason: "no_pending_week_close",
        weekCloseId: null,
        anchorWeek: null,
        targetWeek: null,
        targetPhase: null,
        resolution: null,
        workflowState: null,
        deficitState: null,
        remainingDeficitSets: 0,
        targetMuscles: [],
        deficitSummary: [],
        alreadyUsedThisWeek: false,
        suppressedByStartedNextWeek: false,
        linkedWorkout: null,
        policy: {
          requiredSessionsPerWeek: 4,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
      },
      closeout: {
        visible: false,
        workoutId: null,
        status: null,
        targetWeek: null,
        isIncomplete: false,
      },
    });

    const result = await loadHomePageData("user-1");

    expect(result.decision).toMatchObject({
      nextSessionLabel: "Lower 1",
      nextSessionReasonLabel: "Up next",
      nextSessionReason: "A planned workout already exists, so you can start logging right away.",
    });
  });

  it("adds a separate closeout summary without altering the canonical next-session decision", async () => {
    mocks.loadHomeProgramSupport.mockResolvedValue({
      nextSession: {
        intent: "lower",
        slotId: "lower_a",
        slotSequenceIndex: 1,
        slotSequenceLength: 4,
        slotSource: "mesocycle_slot_sequence",
        weekInMeso: 2,
        sessionInWeek: 2,
        workoutId: null,
        isExisting: false,
      },
      lastSessionSkipped: false,
      latestIncomplete: null,
      gapFill: {
        eligible: false,
        visible: false,
        reason: "no_pending_week_close",
        weekCloseId: null,
        anchorWeek: null,
        targetWeek: null,
        targetPhase: null,
        resolution: null,
        workflowState: null,
        deficitState: null,
        remainingDeficitSets: 0,
        targetMuscles: [],
        deficitSummary: [],
        alreadyUsedThisWeek: false,
        suppressedByStartedNextWeek: false,
        linkedWorkout: null,
        policy: {
          requiredSessionsPerWeek: 4,
          maxOptionalGapFillSessionsPerWeek: 1,
          maxGeneratedHardSets: 12,
          maxGeneratedExercises: 4,
        },
      },
      closeout: {
        visible: true,
        workoutId: "workout-closeout",
        status: "planned",
        targetWeek: 2,
        isIncomplete: true,
      },
    });

    const result = await loadHomePageData("user-1");

    expect(result.decision).toMatchObject({
      nextSessionLabel: "Lower 1",
      nextSessionReasonLabel: "Next in sequence",
    });
    expect(result.closeout).toEqual({
      workoutId: "workout-closeout",
      status: "planned",
      statusLabel: "Planned",
      detail:
        "Optional manual closeout work for this week. It can add actual weekly volume without becoming your next canonical session.",
      actionHref: "/log/workout-closeout",
      actionLabel: "Open closeout",
    });
  });
});
