import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  loadHomePageData: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/home-page", () => ({
  loadHomePageData: (...args: unknown[]) => mocks.loadHomePageData(...args),
}));

vi.mock("@/components/DashboardGenerateSection", () => ({
  DashboardGenerateSection: ({
    initialIntent,
    initialSlotId,
    primaryAction,
    nextSessionLabel,
    nextSessionDescription,
  }: {
    initialIntent?: string;
    initialSlotId?: string | null;
    primaryAction?: { label: string };
    nextSessionLabel?: string | null;
    nextSessionDescription?: string | null;
  }) =>
    (
      <div>
        {`DashboardGenerateSection:${initialIntent ?? "none"}:${initialSlotId ?? "none"}:${primaryAction?.label ?? "none"}:${nextSessionLabel ?? "none"}:${nextSessionDescription ?? "none"}`}
      </div>
    ),
}));

vi.mock("@/components/ProgramStatusCard", () => ({
  ProgramStatusCard: ({ variant }: { variant?: string }) => (
    <div>{`ProgramStatusCard:${variant ?? "default"}`}</div>
  ),
}));

vi.mock("@/components/OptionalWeekCompletion", () => ({
  OptionalWeekCompletion: ({
    gapFill,
    customSession,
  }: {
    gapFill?: { visible: boolean };
    customSession?: { actionHref: string } | null;
  }) => (
    <div>
      {`OptionalWeekCompletion:${gapFill?.visible ? "gap" : "no-gap"}:${customSession?.actionHref ?? "no-custom"}`}
    </div>
  ),
}));

vi.mock("@/components/HomePreSessionReadinessPanel", () => ({
  HomePreSessionReadinessPanel: ({
    card,
    canPrepare,
  }: {
    card?: { sessionLabel?: string } | null;
    canPrepare: boolean;
  }) => (
    <div>
      {`HomePreSessionReadinessPanel:${canPrepare ? "prepare" : "no-prepare"}:${card?.sessionLabel ?? "no-card"}`}
    </div>
  ),
}));

vi.mock("@/components/CloseoutCard", () => ({
  CloseoutCard: ({ closeout }: { closeout: { title: string; actionLabel: string } }) => (
    <div>{`CloseoutCard:${closeout.title}:${closeout.actionLabel}`}</div>
  ),
}));

vi.mock("@/components/RecentWorkouts", () => ({
  default: ({
    heading,
    showDeleteActions,
    showCount,
    viewAllLabel,
  }: {
    heading?: string;
    showDeleteActions?: boolean;
    showCount?: boolean;
    viewAllLabel?: string;
  }) => (
    <div>{`RecentWorkouts:${heading ?? "Recent Workouts"}:${String(showDeleteActions)}:${String(showCount)}:${viewAllLabel ?? "View all"}`}</div>
  ),
}));

describe("Home page", () => {
  beforeEach(() => {
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.loadHomePageData.mockResolvedValue({
      pendingHandoff: null,
      programData: {
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
      },
      homeProgram: {
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
        activeWeek: 2,
        completedAdvancingSessionsThisWeek: 1,
        totalAdvancingSessionsThisWeek: 4,
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
      },
      primaryAction: {
        state: "planned",
        mode: "generate",
        label: "Start workout",
        action: "generate-required-workout",
        initialIntent: "lower",
        initialSlotId: "lower_a",
        reasonLabel: "Next in sequence",
        reason: "Nothing earlier is still open, so Lower 1 is next this week.",
      },
      decision: {
        nextSessionLabel: "Lower 1",
        nextSessionDescription: "First lower session this week",
        nextSessionReasonLabel: "Next in sequence",
        nextSessionReason: "Nothing earlier is still open, so Lower 1 is next this week.",
        activeWeekLabel: "Week 2 - 1 of 4 sessions complete",
        activeWeekPlanSource: "mesocycle_slot_sequence",
        activeWeekSessions: [
          {
            slotId: "upper_a",
            label: "Upper 1",
            status: "completed",
            statusLabel: "Completed",
            href: "/workout/workout-1",
            workoutId: "workout-1",
            sequenceIndex: 0,
          },
          {
            slotId: "lower_a",
            label: "Lower 1",
            status: "next",
            statusLabel: "Next",
            href: "#generate-workout",
            workoutId: null,
            sequenceIndex: 1,
          },
          {
            slotId: "upper_b",
            label: "Upper 2",
            status: "upcoming",
            statusLabel: "Upcoming",
            href: null,
            workoutId: null,
            sequenceIndex: 2,
          },
          {
            slotId: "lower_b",
            label: "Lower 2",
            status: "upcoming",
            statusLabel: "Upcoming",
            href: null,
            workoutId: null,
            sequenceIndex: 3,
          },
        ],
        completedAdvancingSessionsThisWeek: 1,
        totalAdvancingSessionsThisWeek: 4,
      },
      continuity: {
        summary: null,
        lastCompleted: {
          id: "workout-1",
          scheduledDate: "2026-03-24T00:00:00.000Z",
          completedAt: "2026-03-24T01:00:00.000Z",
          status: "COMPLETED",
          selectionMode: "INTENT",
          sessionIntent: "UPPER",
          sessionIdentityLabel: "Upper",
          sessionSlotId: null,
          sessionTechnicalLabel: null,
          mesocycleId: "meso-1",
          mesocycleState: "ACTIVE_ACCUMULATION",
          mesocycleIsActive: true,
          sessionSnapshot: null,
          isDeload: false,
          isGapFill: false,
          isSupplementalDeficitSession: false,
          gapFillTargetMuscles: [],
          exerciseCount: 5,
          totalSetsLogged: 0,
        },
        lastCompletedDescriptor: "Upper session",
        nextDueLabel: "Lower 1",
        nextDueDescriptor: "First lower session this week",
      },
      closeout: null,
      headerContext: "Week 2 - Accumulation",
      recentActivity: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the action-first Home structure without the old Explore or Next Session card", async () => {
    const { default: HomePage } = await import("./page");
    const ui = await HomePage();

    render(ui);

    expect(screen.getByRole("heading", { name: "Today's Training" })).toBeInTheDocument();
    expect(screen.getByText("Week 2 - Accumulation")).toBeInTheDocument();
    expect(
      screen.getByText(
        "DashboardGenerateSection:lower:lower_a:Start workout:Lower 1:First lower session this week"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("HomePreSessionReadinessPanel:prepare:no-card")
    ).toBeInTheDocument();
    expect(screen.getByText("Continuity")).toBeInTheDocument();
    expect(screen.getByText("Active Week")).toBeInTheDocument();
    expect(screen.getByText("Upper 1")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getAllByText("Lower 1").length).toBeGreaterThan(0);
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("Upper 2")).toBeInTheDocument();
    expect(screen.getAllByText("Upcoming")).toHaveLength(2);
    expect(screen.getByText("ProgramStatusCard:homeCompact")).toBeInTheDocument();
    expect(
      screen.getByText("RecentWorkouts:Recent Activity:false:false:Open History")
    ).toBeInTheDocument();
    expect(screen.queryByText("Explore")).not.toBeInTheDocument();
    expect(screen.queryByText("Next Session")).not.toBeInTheDocument();
  });

  it("renders an existing readiness card without hiding Start workout", async () => {
    mocks.loadHomePageData.mockResolvedValueOnce({
      pendingHandoff: null,
      programData: {
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
      },
      homeProgram: {
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
        activeWeek: 2,
        completedAdvancingSessionsThisWeek: 1,
        totalAdvancingSessionsThisWeek: 4,
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
          weekCloseId: null,
          status: null,
          targetWeek: null,
          isIncomplete: false,
          isPriorWeek: false,
          canCreate: false,
        },
      },
      primaryAction: {
        state: "planned",
        mode: "generate",
        label: "Start workout",
        action: "generate-required-workout",
        initialIntent: "lower",
        initialSlotId: "lower_a",
        reasonLabel: "Next in sequence",
        reason: "Nothing earlier is still open, so Lower 1 is next this week.",
      },
      decision: {
        nextSessionLabel: "Lower 1",
        nextSessionDescription: "First lower session this week",
        nextSessionReasonLabel: "Next in sequence",
        nextSessionReason: "Nothing earlier is still open, so Lower 1 is next this week.",
        activeWeekLabel: "Week 2 - 1 of 4 sessions complete",
        activeWeekPlanSource: null,
        activeWeekSessions: [],
        completedAdvancingSessionsThisWeek: 1,
        totalAdvancingSessionsThisWeek: 4,
      },
      continuity: {
        summary: null,
        lastCompleted: null,
        lastCompletedDescriptor: null,
        nextDueLabel: "Lower 1",
        nextDueDescriptor: "First lower session this week",
      },
      closeout: null,
      preSessionReadinessCard: {
        safeToTrain: false,
        action: "blocked",
        sessionLabel: "Lower 1",
      },
      headerContext: "Week 2 - Accumulation",
      recentActivity: [],
    });

    const { default: HomePage } = await import("./page");
    const ui = await HomePage();

    render(ui);

    expect(
      screen.getByText(
        "DashboardGenerateSection:lower:lower_a:Start workout:Lower 1:First lower session this week"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "HomePreSessionReadinessPanel:prepare:Lower 1"
      )
    ).toBeInTheDocument();
  });

  it("renders active-week custom work in optional completion without replacing the main next-session surface", async () => {
    mocks.loadHomePageData.mockResolvedValueOnce({
      pendingHandoff: null,
      programData: {
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
      },
      homeProgram: {
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
        activeWeek: 2,
        completedAdvancingSessionsThisWeek: 1,
        totalAdvancingSessionsThisWeek: 4,
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
          weekCloseId: null,
          status: "planned",
          targetWeek: 2,
          isIncomplete: true,
          isPriorWeek: false,
          canCreate: false,
        },
      },
      primaryAction: {
        state: "planned",
        mode: "generate",
        label: "Start workout",
        action: "generate-required-workout",
        initialIntent: "lower",
        initialSlotId: "lower_a",
        reasonLabel: "Next in sequence",
        reason: "Nothing earlier is still open, so Lower 1 is next this week.",
      },
      decision: {
        nextSessionLabel: "Lower 1",
        nextSessionDescription: "First lower session this week",
        nextSessionReasonLabel: "Next in sequence",
        nextSessionReason: "Nothing earlier is still open, so Lower 1 is next this week.",
        activeWeekLabel: "Week 2 - 1 of 4 sessions complete",
        activeWeekPlanSource: null,
        activeWeekSessions: [],
        completedAdvancingSessionsThisWeek: 1,
        totalAdvancingSessionsThisWeek: 4,
      },
      continuity: {
        summary: null,
        lastCompleted: null,
        lastCompletedDescriptor: null,
        nextDueLabel: "Lower 1",
        nextDueDescriptor: "First lower session this week",
      },
      closeout: {
        title: "Custom session",
        workoutId: "workout-closeout",
        status: "planned",
        statusLabel: "Planned",
        detail:
          "Optional manual session for this week. It can add actual weekly volume without becoming required work.",
        actionHref: "/log/workout-closeout",
        actionLabel: "Open custom session",
        dismissActionHref: "/api/workouts/workout-closeout/dismiss-closeout",
        dismissActionLabel: "Dismiss optional session",
      },
      headerContext: "Week 2 - Accumulation",
      recentActivity: [],
    });

    const { default: HomePage } = await import("./page");
    const ui = await HomePage();

    render(ui);

    expect(
      screen.getByText("OptionalWeekCompletion:no-gap:/log/workout-closeout")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "DashboardGenerateSection:lower:lower_a:Start workout:Lower 1:First lower session this week"
      )
    ).toBeInTheDocument();
  });
});
