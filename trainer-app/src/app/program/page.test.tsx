import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ProgramDashboardData } from "@/lib/api/program";

function hasTextOutsideDetails(
  text: string,
  container: HTMLElement = document.body,
): boolean {
  return within(container)
    .queryAllByText(text)
    .some((element) => !element.closest("details"));
}

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

type VolumeRow = ProgramDashboardData["volumeThisWeek"][number];

function buildVolumeRow(input: {
  muscle: string;
  dashboardGroup: VolumeRow["dashboardGroup"];
  status: string;
  statusLabel: string;
  statusDescription: string;
  effectiveSets: number;
  target: number;
  deltaLabel: string;
}): VolumeRow {
  return {
    muscle: input.muscle,
    targetKind: input.dashboardGroup === "secondary" ? "soft" : "hard",
    targetRange: null,
    displayGroup: input.dashboardGroup === "secondary" ? "secondary" : "primary",
    targetTier: null,
    warningSeverity: input.dashboardGroup === "secondary" ? "info" : "hard",
    dashboardGroup: input.dashboardGroup,
    effectiveSets: input.effectiveSets,
    directSets: input.effectiveSets,
    indirectSets: 0,
    target: input.target,
    mev: 6,
    mav: 10,
    mrv: 14,
    weightedSetsLabel: `${input.effectiveSets} weighted`,
    targetLabel: `${input.target} target`,
    statusLabel: input.statusLabel,
    statusDescription: input.statusDescription,
    deltaLabel: input.deltaLabel,
    landmarkContext: undefined,
    badges: [{ status: input.status, label: input.statusLabel }],
    opportunityScore: 0,
    opportunityState: "covered",
    opportunityRationale: "Weekly target is covered.",
  };
}

const compactVolumeRows: VolumeRow[] = [
  buildVolumeRow({
    muscle: "Chest",
    dashboardGroup: "primary_driver",
    status: "below_mev",
    statusLabel: "Below MEV",
    statusDescription: "4 weighted sets against 10 target.",
    effectiveSets: 4,
    target: 10,
    deltaLabel: "-6 sets",
  }),
  buildVolumeRow({
    muscle: "Lats",
    dashboardGroup: "primary_driver",
    status: "in_range",
    statusLabel: "Below target",
    statusDescription: "7 weighted sets against 12 target.",
    effectiveSets: 7,
    target: 12,
    deltaLabel: "-5 sets",
  }),
  buildVolumeRow({
    muscle: "Quads",
    dashboardGroup: "primary_driver",
    status: "at_mrv",
    statusLabel: "At MRV",
    statusDescription: "14 weighted sets against 10 target.",
    effectiveSets: 14,
    target: 10,
    deltaLabel: "+4 sets",
  }),
  buildVolumeRow({
    muscle: "Triceps",
    dashboardGroup: "primary_driver",
    status: "on_target",
    statusLabel: "On target",
    statusDescription: "8 weighted sets against 8 target.",
    effectiveSets: 8,
    target: 8,
    deltaLabel: "on target",
  }),
  buildVolumeRow({
    muscle: "Rear Delts",
    dashboardGroup: "support_driver",
    status: "near_mrv",
    statusLabel: "Near MRV",
    statusDescription: "12 weighted sets against 8 target.",
    effectiveSets: 12,
    target: 8,
    deltaLabel: "+4 sets",
  }),
  buildVolumeRow({
    muscle: "Biceps",
    dashboardGroup: "support_driver",
    status: "on_target",
    statusLabel: "On target",
    statusDescription: "8 weighted sets against 8 target.",
    effectiveSets: 8,
    target: 8,
    deltaLabel: "on target",
  }),
  buildVolumeRow({
    muscle: "Core",
    dashboardGroup: "secondary",
    status: "below_mev",
    statusLabel: "Below soft range",
    statusDescription: "0 weighted sets against 4 target.",
    effectiveSets: 0,
    target: 4,
    deltaLabel: "-4 sets",
  }),
];

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/api/mesocycle-handoff", () => ({
  loadPendingMesocycleHandoff: (...args: unknown[]) =>
    mocks.loadPendingMesocycleHandoff(...args),
}));

vi.mock("@/lib/api/program-page", () => ({
  loadProgramPageData: (...args: unknown[]) =>
    mocks.loadProgramPageData(...args),
}));

vi.mock("@/components/ProgramStatusCard", () => ({
  ProgramStatusCard: ({ variant }: { variant?: string }) => (
    <div>ProgramStatusCard:{variant ?? "default"}</div>
  ),
}));

vi.mock("@/components/CycleAnchorControls", () => ({
  CycleAnchorControls: ({
    availableActions,
  }: {
    availableActions: string[];
  }) => <div>CycleAnchorControls:{availableActions.join(",")}</div>,
}));

vi.mock("@/components/CloseoutCard", () => ({
  CloseoutCard: ({
    closeout,
  }: {
    closeout: { title: string; actionLabel: string };
  }) => <div>{`CloseoutCard:${closeout.title}:${closeout.actionLabel}`}</div>,
}));

vi.mock("@/components/OptionalWeekCompletion", () => ({
  OptionalWeekCompletion: ({
    customSession,
  }: {
    customSession?: { actionHref: string } | null;
  }) => (
    <div>{`OptionalWeekCompletion:${customSession?.actionHref ?? "no-custom"}`}</div>
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
            uiState: "completed",
            statusLabel: "Completed",
            statusDescription:
              "Session 1 is counted from actual completed volume.",
            volumeBasis: "actual_completed",
            linkedWorkoutId: "w-completed",
            linkedWorkoutStatus: "completed",
            exercises: [
              {
                exerciseId: "incline-db-bench",
                name: "Incline DB Bench",
                setCount: 3,
                role: "primary",
              },
            ],
            exerciseSource: "persisted_slot_plan_seed",
            impact: null,
          },
          {
            slotId: "lower_a",
            label: "Lower 1",
            sessionInWeek: 2,
            uiState: "planned",
            statusLabel: "Planned next",
            statusDescription:
              "Session 2 already has a planned workout ready to log.",
            volumeBasis: "projected_next",
            linkedWorkoutId: "w-next",
            linkedWorkoutStatus: "planned",
            exercises: [
              {
                exerciseId: "tbar-row",
                name: "T-Bar Row",
                setCount: 3,
                role: "primary",
              },
              {
                exerciseId: "face-pull",
                name: "Face Pull",
                setCount: 2,
                role: "accessory",
              },
            ],
            exerciseSource: "persisted_slot_plan_seed",
            impact: {
              topMuscles: [
                { muscle: "Lats", projectedEffectiveSets: 3 },
                { muscle: "Upper Back", projectedEffectiveSets: 2 },
                { muscle: "Rear Delts", projectedEffectiveSets: 1.5 },
              ],
              hiddenMuscleCount: 2,
              summaryLabel:
                "Lats +3 \u00b7 Upper Back +2 \u00b7 Rear Delts +1.5 \u00b7 +2 more",
            },
          },
          {
            slotId: "upper_b",
            label: "Upper 2",
            sessionInWeek: 3,
            uiState: "projected",
            statusLabel: "Projected",
            statusDescription:
              "Session 3 is unresolved; its volume is projected as remaining work.",
            volumeBasis: "projected_remaining",
            linkedWorkoutId: null,
            linkedWorkoutStatus: null,
            exercises: [
              {
                exerciseId: "cable-curl",
                name: "Cable Curl",
                setCount: 2,
                role: "accessory",
              },
            ],
            exerciseSource: "projected_week_volume",
            impact: null,
          },
        ],
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
        badges: [
          {
            status: "meaningfully_low",
            label: "meaningfully low",
            count: 1,
            activeDescription:
              "Showing all projected muscles in the Meaningfully low bucket.",
          },
          {
            status: "slightly_low",
            label: "below target",
            count: 1,
            activeDescription:
              "Showing all projected muscles in the Below target bucket.",
          },
          {
            status: "on_target",
            label: "on target",
            count: 1,
            activeDescription:
              "Showing all projected muscles in the On target bucket.",
          },
          {
            status: "slightly_high",
            label: "slightly high",
            count: 0,
            activeDescription:
              "Showing all projected muscles in the Slightly high bucket.",
          },
          {
            status: "meaningfully_high",
            label: "meaningfully high",
            count: 1,
            activeDescription:
              "Showing all projected muscles in the Meaningfully high bucket.",
          },
        ],
        rows: [
          {
            muscle: "Chest",
            status: "meaningfully_low",
            dashboardGroup: "primary_driver",
            statusLabel: "Below MEV",
            statusDescription:
              "8 projected is still below MEV after the planned week.",
            deltaLabel: "-4 sets",
            comparisonLabel: "8 projected vs 12 target",
            badges: [],
          },
          {
            muscle: "Lats",
            status: "slightly_low",
            dashboardGroup: "primary_driver",
            statusLabel: "Below target",
            statusDescription: "10 projected vs 12 target; 6 completed so far.",
            deltaLabel: "-2 sets",
            comparisonLabel: "10 projected vs 12 target",
            badges: [],
          },
          {
            muscle: "Rear Delts",
            status: "slightly_high",
            dashboardGroup: "primary_driver",
            statusLabel: "Slightly high",
            statusDescription: "7 projected vs 6 target; 4 completed so far.",
            deltaLabel: "+1 sets",
            comparisonLabel: "7 projected vs 6 target",
            badges: [],
          },
          {
            muscle: "Quads",
            status: "meaningfully_high",
            dashboardGroup: "primary_driver",
            statusLabel: "Meaningfully high",
            statusDescription:
              "15 projected vs 10 target; 12 completed so far.",
            deltaLabel: "+5 sets",
            comparisonLabel: "15 projected vs 10 target",
            badges: [],
          },
          {
            muscle: "Biceps",
            status: "on_target",
            dashboardGroup: "primary_driver",
            statusLabel: "On target",
            statusDescription: "8 projected vs 8 target; 8 completed so far.",
            deltaLabel: "on target",
            comparisonLabel: "8 projected vs 8 target",
            badges: [],
          },
        ],
        defaultRows: [
          {
            muscle: "Chest",
            status: "meaningfully_low",
            dashboardGroup: "primary_driver",
            statusLabel: "Below MEV",
            statusDescription:
              "8 projected is still below MEV after the planned week.",
            deltaLabel: "-4 sets",
            comparisonLabel: "8 projected vs 12 target",
            badges: [],
          },
          {
            muscle: "Quads",
            status: "meaningfully_high",
            dashboardGroup: "primary_driver",
            statusLabel: "Meaningfully high",
            statusDescription:
              "15 projected vs 10 target; 12 completed so far.",
            deltaLabel: "+5 sets",
            comparisonLabel: "15 projected vs 10 target",
            badges: [],
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
          volumeThisWeek: compactVolumeRows,
          deloadReadiness: null,
          rirTarget: { min: 2, max: 3 },
          coachingCue: "Build volume with crisp execution.",
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

    expect(
      screen.getByRole("heading", { name: "My Program" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Meso 2: Strength-Hypertrophy/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Train next: Lower 1" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Train next: Upper 1" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Week 2 · Lower 1 · Target 2-3 RIR · 5 planned sets"),
    ).toBeInTheDocument();
    expect(screen.getByText("T-Bar Row + Face Pull")).toBeInTheDocument();
    expect(screen.getByText("From your accepted plan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start workout" })).toHaveAttribute(
      "href",
      "/log/w-next",
    );
    expect(
      screen.getByRole("heading", { name: "This Week's Training Plan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Projected Week Finish" }),
    ).toBeInTheDocument();
    const projectedSection = screen
      .getByRole("heading", { name: "Projected Week Finish" })
      .closest("section") as HTMLElement;
    expect(projectedSection).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Weekly Volume Snapshot" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "4 primary/support targets need a quick check this week.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Active-week volume uses the existing Program read model. Projected week finish remains above.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Primary 4")).toBeInTheDocument();
    expect(screen.getByText("Support 2")).toBeInTheDocument();
    expect(screen.getByText("Watch list 2")).toBeInTheDocument();
    expect(screen.getByText("On track 2")).toBeInTheDocument();
    expect(screen.getByText("Watch high 2")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Analytics" }),
    ).toHaveAttribute("href", "/analytics");
    expect(screen.getByText("4 weighted sets against 10 target.")).toBeInTheDocument();
    expect(screen.getByText("7 weighted sets against 12 target.")).toBeInTheDocument();
    expect(screen.getByText("14 weighted sets against 10 target.")).toBeInTheDocument();
    expect(screen.getByText("12 weighted sets against 8 target.")).toBeInTheDocument();
    expect(screen.queryByText("Triceps")).not.toBeInTheDocument();
    expect(screen.queryByText("Core")).not.toBeInTheDocument();
    expect(screen.queryByText("Primary hypertrophy targets")).not.toBeInTheDocument();
    expect(screen.queryByText("ProgramStatusCard:volumeOnly")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "If you complete the remaining planned sessions this week, you will likely land here.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Projected: remaining planned sessions completed"),
    ).toBeInTheDocument();
    expect(screen.getByText("Completed: performed logs so far")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 below MEV" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "1 below target" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "1 on target" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1 watch high" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "0 slightly high" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Upper 1")).toBeInTheDocument();
    expect(screen.getByText("Lower 1")).toBeInTheDocument();
    expect(screen.getByText("Upper 2")).toBeInTheDocument();
    expect(screen.getAllByText("Exercises").length).toBeGreaterThan(0);
    expect(screen.queryByText("Incline DB Bench")).not.toBeInTheDocument();
    expect(screen.getByText("Workout: Completed")).toBeInTheDocument();
    expect(screen.getAllByText("T-Bar Row").length).toBeGreaterThan(0);
    expect(screen.getByText("Cable Curl")).toBeInTheDocument();
    expect(screen.getAllByText("3 sets").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 sets").length).toBeGreaterThan(0);
    expect(screen.getByText("If you train this slot")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review workout" }),
    ).toHaveAttribute("href", "/workout/w-completed");
    expect(screen.getByRole("link", { name: "Open Lower 1" })).toHaveAttribute(
      "href",
      "/workout/w-next",
    );
    expect(
      screen.getAllByText(
        /Lats \+3 · Upper Back \+2 · Rear Delts \+1.5 · \+2 more/,
      ).length,
    ).toBeGreaterThan(0);
    expect(hasTextOutsideDetails("Chest", projectedSection)).toBe(true);
    expect(hasTextOutsideDetails("Quads", projectedSection)).toBe(true);
    expect(hasTextOutsideDetails("-4 sets", projectedSection)).toBe(true);
    expect(hasTextOutsideDetails("+5 sets", projectedSection)).toBe(true);
    expect(screen.getByText("Priority coaching notes")).toBeInTheDocument();
    expect(screen.getByText("All primary target details (5)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1 below target" }));

    expect(
      screen.getByText(
        "Showing below target primary targets.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "below target primary targets" }),
    ).toBeInTheDocument();
    expect(hasTextOutsideDetails("Lats", projectedSection)).toBe(true);
    expect(hasTextOutsideDetails("Chest", projectedSection)).toBe(false);
    expect(hasTextOutsideDetails("Quads", projectedSection)).toBe(false);

    await user.click(screen.getByRole("button", { name: "1 below target" }));

    expect(
      screen.queryByText(
        "Showing below target primary targets.",
      ),
    ).not.toBeInTheDocument();
    expect(hasTextOutsideDetails("Chest", projectedSection)).toBe(true);
    expect(hasTextOutsideDetails("Quads", projectedSection)).toBe(true);
    expect(hasTextOutsideDetails("Lats", projectedSection)).toBe(false);
    expect(screen.queryByText("ProgramStatusCard:volumeOnly")).not.toBeInTheDocument();
    expect(
      screen.getByText("CycleAnchorControls:deload,extend_phase,reset"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Next Views")).not.toBeInTheDocument();
    expect(screen.queryByText("Session History")).not.toBeInTheDocument();
    expect(screen.queryByText(/skip_phase/i)).not.toBeInTheDocument();
  });

  it("renders performed set totals for compact completed slots when linked workout structure is the available source", async () => {
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
            uiState: "completed",
            statusLabel: "Completed",
            statusDescription:
              "Session 1 is counted from actual completed volume.",
            volumeBasis: "actual_completed",
            linkedWorkoutId: "w-completed",
            linkedWorkoutStatus: "completed",
            exercises: [
              {
                exerciseId: "runtime-bench",
                name: "Runtime Bench",
                setCount: 3,
                role: "primary",
              },
              {
                exerciseId: "runtime-row",
                name: "Runtime Row",
                setCount: 2,
                role: "accessory",
              },
            ],
            exerciseSource: "linked_workout_structure",
            impact: null,
          },
        ],
      },
      closeout: null,
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
      },
      advancedActions: {
        availableActions: ["deload", "extend_phase", "reset"],
      },
    });

    const { default: ProgramPage } = await import("./page");
    const ui = await ProgramPage();

    render(ui);

    expect(screen.getByText("Upper 1")).toBeInTheDocument();
    expect(screen.getByText("Workout: Completed")).toBeInTheDocument();
    expect(screen.getByText("Performed: 5 sets")).toBeInTheDocument();
    expect(screen.queryByText("Runtime Bench")).not.toBeInTheDocument();
    expect(screen.queryByText("Runtime Row")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Review workout" }),
    ).toHaveAttribute("href", "/workout/w-completed");
  });

  it("renders active-week custom work separately from the ordered slot map", async () => {
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
            uiState: "planned",
            statusLabel: "Planned next",
            statusDescription:
              "Session 1 already has a planned workout ready to log.",
            volumeBasis: "projected_next",
            linkedWorkoutId: "w-next",
            linkedWorkoutStatus: "planned",
            exercises: [],
            exerciseSource: "unavailable",
            impact: null,
          },
        ],
      },
      closeout: {
        title: "Custom session",
        workoutId: "workout-closeout",
        status: "planned",
        statusLabel: "Planned",
        detail:
          "Optional manual session. It counts toward actual weekly volume once performed, but it is not a remaining slot.",
        actionHref: "/log/workout-closeout",
        actionLabel: "Open custom session",
        dismissActionHref: "/api/workouts/workout-closeout/dismiss-closeout",
        dismissActionLabel: "Dismiss optional session",
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
      },
      advancedActions: {
        availableActions: ["deload", "extend_phase", "reset"],
      },
    });

    const { default: ProgramPage } = await import("./page");
    const ui = await ProgramPage();

    render(ui);

    expect(
      screen.getByRole("heading", { name: "This Week's Training Plan" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Train next: Upper 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Exercise details unavailable for 1 slot."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Exercises unavailable")).not.toBeInTheDocument();
    expect(
      screen.getByText("OptionalWeekCompletion:/log/workout-closeout"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Upper 1").length).toBeGreaterThan(0);
  });

  it("opens an active incomplete next workout from the Train next card", async () => {
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
            slotId: "lower_a",
            label: "Lower 1",
            sessionInWeek: 1,
            uiState: "active",
            statusLabel: "Active",
            statusDescription: "Session 1 has started and remains editable.",
            volumeBasis: "projected_next",
            linkedWorkoutId: "w-active",
            linkedWorkoutStatus: "in_progress",
            exercises: [
              {
                exerciseId: "rdl",
                name: "Romanian Deadlift",
                setCount: 3,
                role: "primary",
              },
              {
                exerciseId: "leg-curl",
                name: "Leg Curl",
                setCount: 3,
                role: "accessory",
              },
            ],
            exerciseSource: "linked_workout_structure",
            impact: null,
          },
        ],
      },
      closeout: null,
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
      },
      advancedActions: {
        availableActions: ["deload", "extend_phase", "reset"],
      },
    });

    const { default: ProgramPage } = await import("./page");
    const ui = await ProgramPage();

    render(ui);

    expect(
      screen.getByRole("heading", { name: "Train next: Lower 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Romanian Deadlift + Leg Curl"),
    ).toBeInTheDocument();
    expect(screen.getByText("From your active workout")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open workout" })).toHaveAttribute(
      "href",
      "/log/w-active",
    );
  });

  it("does not render a Train next card when required slots are complete and closeout owns the next action", async () => {
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
            uiState: "completed",
            statusLabel: "Completed",
            statusDescription:
              "Session 1 is counted from actual completed volume.",
            volumeBasis: "actual_completed",
            linkedWorkoutId: "w-completed",
            linkedWorkoutStatus: "completed",
            exercises: [
              {
                exerciseId: "incline-db-bench",
                name: "Incline DB Bench",
                setCount: 3,
                role: "primary",
              },
            ],
            exerciseSource: "persisted_slot_plan_seed",
            impact: null,
          },
        ],
      },
      closeout: {
        title: "Custom session",
        workoutId: null,
        status: "available",
        statusLabel: "Available",
        detail: "Optional manual session is available for this week.",
        actionHref: "/api/mesocycles/week-close/wc-1/closeout",
        actionLabel: "Create optional session",
        actionMethod: "post",
        dismissActionHref: null,
        dismissActionLabel: null,
        targetWeek: 2,
        isPriorWeek: false,
        canDismiss: true,
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
      },
      advancedActions: {
        availableActions: ["deload", "extend_phase", "reset"],
      },
    });

    const { default: ProgramPage } = await import("./page");
    const ui = await ProgramPage();

    render(ui);

    expect(
      screen.queryByRole("heading", { name: /Train next:/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "OptionalWeekCompletion:/api/mesocycles/week-close/wc-1/closeout",
      ),
    ).toBeInTheDocument();
  });
});
