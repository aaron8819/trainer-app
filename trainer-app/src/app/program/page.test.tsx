import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

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
  loadPendingMesocycleHandoff: vi.fn(),
  loadProgramPageData: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff", () => ({
  loadPendingMesocycleHandoff: (...args: unknown[]) => mocks.loadPendingMesocycleHandoff(...args),
}));

vi.mock("@/lib/api/program-page", () => ({
  loadProgramPageData: (...args: unknown[]) => mocks.loadProgramPageData(...args),
}));

vi.mock("@/components/ProgramStatusCard", () => ({
  ProgramStatusCard: ({ variant }: { variant?: string }) => <div>ProgramStatusCard:{variant ?? "default"}</div>,
}));

vi.mock("@/components/CycleAnchorControls", () => ({
  CycleAnchorControls: ({ availableActions }: { availableActions: string[] }) => (
    <div>CycleAnchorControls:{availableActions.join(",")}</div>
  ),
}));

describe("ProgramPage", () => {
  beforeEach(() => {
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.loadPendingMesocycleHandoff.mockResolvedValue(null);
    mocks.loadProgramPageData.mockResolvedValue({
      overview: {
        mesoNumber: 2,
        focus: "Strength-Hypertrophy",
        currentBlockType: "accumulation",
        durationWeeks: 5,
        currentWeek: 2,
        percentComplete: 40,
        blocks: [{ blockType: "accumulation", startWeek: 1, durationWeeks: 5 }],
        rirTarget: { min: 2, max: 3 },
        sessionsUntilDeload: 6,
        deloadReadiness: null,
        coachingCue: "Build volume with crisp execution.",
      },
      currentWeekPlan: {
        week: 2,
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
            linkedWorkoutId: "w-next",
            linkedWorkoutStatus: "planned",
          },
        ],
        nextSessionImpact: {
          slotLabel: "Lower 1",
          topMuscles: [
            { muscle: "Lats", projectedEffectiveSets: 3 },
            { muscle: "Upper Back", projectedEffectiveSets: 2 },
            { muscle: "Rear Delts", projectedEffectiveSets: 1.5 },
          ],
          summaryLabel: "Next session impact: likely increases Lats, Upper Back, Rear Delts",
        },
      },
      closeout: null,
      weekCompletionOutlook: {
        assumptionLabel:
          "If you complete the remaining planned sessions this week, you will likely land here.",
        summary: {
          meaningfullyLow: 1,
          slightlyLow: 1,
          onTarget: 1,
          slightlyHigh: 1,
          meaningfullyHigh: 1,
        },
        rows: [
          {
            muscle: "Chest",
            status: "meaningfully_low",
            projectedFullWeekEffectiveSets: 8,
            targetSets: 12,
            delta: -4,
          },
          {
            muscle: "Lats",
            status: "slightly_low",
            projectedFullWeekEffectiveSets: 10,
            targetSets: 12,
            delta: -2,
          },
          {
            muscle: "Rear Delts",
            status: "slightly_high",
            projectedFullWeekEffectiveSets: 7,
            targetSets: 6,
            delta: 1,
          },
          {
            muscle: "Quads",
            status: "meaningfully_high",
            projectedFullWeekEffectiveSets: 15,
            targetSets: 10,
            delta: 5,
          },
          {
            muscle: "Biceps",
            status: "on_target",
            projectedFullWeekEffectiveSets: 8,
            targetSets: 8,
            delta: 0,
          },
        ],
        defaultRows: [
          {
            muscle: "Chest",
            status: "meaningfully_low",
            projectedFullWeekEffectiveSets: 8,
            targetSets: 12,
            delta: -4,
          },
          {
            muscle: "Quads",
            status: "meaningfully_high",
            projectedFullWeekEffectiveSets: 15,
            targetSets: 10,
            delta: 5,
          },
        ],
      },
      volumeDetails: {
        dashboard: {
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
        currentWeekStatusSummary: {
          below_mev: 1,
          in_range: 0,
          near_target: 1,
          on_target: 1,
          near_mrv: 0,
          at_mrv: 0,
        },
      },
      advancedActions: {
        availableActions: ["deload", "extend_phase", "reset"],
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the outlook and toggles between default and filtered badge views client-side", async () => {
    const user = userEvent.setup();
    const { default: ProgramPage } = await import("./page");
    const ui = await ProgramPage();

    render(ui);

    expect(screen.getByRole("heading", { name: "My Program" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Meso 2: Strength-Hypertrophy/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ordered weekly slots" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Projected week landing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Weighted weekly volume" })).toBeInTheDocument();
    expect(screen.getByText("1 Below MEV")).toBeInTheDocument();
    expect(screen.getByText("1 Near target")).toBeInTheDocument();
    expect(screen.getByText("1 On target")).toBeInTheDocument();
    expect(
      screen.getByText(
        "If you complete the remaining planned sessions this week, you will likely land here."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 meaningfully low" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 slightly low" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 on target" })).toBeInTheDocument();
    expect(screen.getByText("Upper 1")).toBeInTheDocument();
    expect(screen.getByText("Lower 1")).toBeInTheDocument();
    expect(screen.getByText("Impact")).toBeInTheDocument();
    expect(
      screen.getByText(/This session will increase Lats, Upper Back, Rear Delts/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Lats 3 • Upper Back 2 • Rear Delts 1.5/)).toBeInTheDocument();
    expect(screen.getByText("Chest")).toBeInTheDocument();
    expect(screen.getByText("Quads")).toBeInTheDocument();
    expect(screen.getByText("-4 sets")).toBeInTheDocument();
    expect(screen.getByText("+5 sets")).toBeInTheDocument();
    expect(screen.queryByText("Lats")).not.toBeInTheDocument();
    expect(screen.queryByText("Rear Delts")).not.toBeInTheDocument();
    expect(screen.queryByText("Biceps")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1 slightly low" }));

    expect(screen.getByText("Showing all projected muscles in the Slightly Low bucket.")).toBeInTheDocument();
    expect(screen.getByText("Lats")).toBeInTheDocument();
    expect(screen.queryByText("Chest")).not.toBeInTheDocument();
    expect(screen.queryByText("Quads")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1 slightly low" }));

    expect(
      screen.queryByText("Showing all projected muscles in the Slightly Low bucket.")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Chest")).toBeInTheDocument();
    expect(screen.getByText("Quads")).toBeInTheDocument();
    expect(screen.queryByText("Lats")).not.toBeInTheDocument();
    expect(screen.getByText("ProgramStatusCard:volumeOnly")).toBeInTheDocument();
    expect(screen.getByText("CycleAnchorControls:deload,extend_phase,reset")).toBeInTheDocument();
    expect(screen.queryByText("Next Views")).not.toBeInTheDocument();
    expect(screen.queryByText("Session History")).not.toBeInTheDocument();
    expect(screen.queryByText(/skip_phase/i)).not.toBeInTheDocument();
  });

  it("renders closeout separately from the ordered slot map", async () => {
    mocks.loadProgramPageData.mockResolvedValueOnce({
      overview: {
        mesoNumber: 2,
        focus: "Strength-Hypertrophy",
        currentBlockType: "accumulation",
        durationWeeks: 5,
        currentWeek: 2,
        percentComplete: 40,
        blocks: [{ blockType: "accumulation", startWeek: 1, durationWeeks: 5 }],
        rirTarget: { min: 2, max: 3 },
        sessionsUntilDeload: 6,
        deloadReadiness: null,
        coachingCue: "Build volume with crisp execution.",
      },
      currentWeekPlan: {
        week: 2,
        slots: [
          {
            slotId: "upper_a",
            label: "Upper 1",
            sessionInWeek: 1,
            state: "next",
            linkedWorkoutId: "w-next",
            linkedWorkoutStatus: "planned",
          },
        ],
        nextSessionImpact: null,
      },
      closeout: {
        title: "Closeout",
        workoutId: "workout-closeout",
        status: "planned",
        statusLabel: "Planned",
        detail:
          "Optional manual closeout work. It counts toward actual weekly volume once performed, but it is not a remaining slot.",
        actionHref: "/log/workout-closeout",
        actionLabel: "Open closeout",
      },
      weekCompletionOutlook: null,
      volumeDetails: {
        dashboard: {
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
        currentWeekStatusSummary: null,
      },
      advancedActions: {
        availableActions: ["deload", "extend_phase", "reset"],
      },
    });

    const { default: ProgramPage } = await import("./page");
    const ui = await ProgramPage();

    render(ui);

    expect(screen.getByRole("heading", { name: "Ordered weekly slots" })).toBeInTheDocument();
    expect(screen.getAllByText("Closeout")[0]).toBeInTheDocument();
    expect(
      screen.getByText(
        "Optional manual closeout work. It counts toward actual weekly volume once performed, but it is not a remaining slot."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open closeout" })).toHaveAttribute(
      "href",
      "/log/workout-closeout"
    );
    expect(screen.getAllByText(/Upper 1/)).toHaveLength(1);
  });
});
