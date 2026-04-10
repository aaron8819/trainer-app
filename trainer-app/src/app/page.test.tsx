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
    recommendedReasonLabel,
    recommendedReasonDetail,
  }: {
    initialIntent?: string;
    initialSlotId?: string | null;
    recommendedReasonLabel?: string | null;
    recommendedReasonDetail?: string | null;
  }) =>
    (
      <div>
        {`DashboardGenerateSection:${initialIntent ?? "none"}:${initialSlotId ?? "none"}:${recommendedReasonLabel ?? "none"}:${recommendedReasonDetail ?? "none"}`}
      </div>
    ),
}));

vi.mock("@/components/ProgramStatusCard", () => ({
  ProgramStatusCard: ({ variant }: { variant?: string }) => (
    <div>{`ProgramStatusCard:${variant ?? "default"}`}</div>
  ),
}));

vi.mock("@/components/OptionalGapFillCard", () => ({
  OptionalGapFillCard: () => <div>OptionalGapFillCard</div>,
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
      decision: {
        nextSessionLabel: "Lower 1",
        nextSessionDescription: "First lower session this week",
        nextSessionReasonLabel: "Next in sequence",
        nextSessionReason: "Nothing earlier is still open, so Lower 1 is next this week.",
        activeWeekLabel: "Week 2 - Session 2 of 4",
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
        "DashboardGenerateSection:lower:lower_a:Next in sequence:Nothing earlier is still open, so Lower 1 is next this week."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Continuity")).toBeInTheDocument();
    expect(screen.getByText("Active Week")).toBeInTheDocument();
    expect(screen.getByText("ProgramStatusCard:homeCompact")).toBeInTheDocument();
    expect(
      screen.getByText("RecentWorkouts:Recent Activity:false:false:Open History")
    ).toBeInTheDocument();
    expect(screen.queryByText("Explore")).not.toBeInTheDocument();
    expect(screen.queryByText("Next Session")).not.toBeInTheDocument();
  });

  it("renders a separate closeout card without replacing the main next-session surface", async () => {
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
      decision: {
        nextSessionLabel: "Lower 1",
        nextSessionDescription: "First lower session this week",
        nextSessionReasonLabel: "Next in sequence",
        nextSessionReason: "Nothing earlier is still open, so Lower 1 is next this week.",
        activeWeekLabel: "Week 2 - Session 2 of 4",
      },
      continuity: {
        summary: null,
        lastCompleted: null,
        lastCompletedDescriptor: null,
        nextDueLabel: "Lower 1",
        nextDueDescriptor: "First lower session this week",
      },
      closeout: {
        title: "Closeout",
        workoutId: "workout-closeout",
        status: "planned",
        statusLabel: "Planned",
        detail:
          "Optional manual closeout work for this week. It can add actual weekly volume without becoming your next canonical session.",
        actionHref: "/log/workout-closeout",
        actionLabel: "Open closeout",
      },
      headerContext: "Week 2 - Accumulation",
      recentActivity: [],
    });

    const { default: HomePage } = await import("./page");
    const ui = await HomePage();

    render(ui);

    expect(screen.getAllByText("Closeout")[0]).toBeInTheDocument();
    expect(screen.getByText(/Optional manual closeout work for this week/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open closeout" })).toHaveAttribute(
      "href",
      "/log/workout-closeout"
    );
    expect(
      screen.getByText(
        "DashboardGenerateSection:lower:lower_a:Next in sequence:Nothing earlier is still open, so Lower 1 is next this week."
      )
    ).toBeInTheDocument();
  });
});
