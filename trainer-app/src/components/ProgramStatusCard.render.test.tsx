import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgramStatusCard } from "./ProgramStatusCard";
import type { ProgramDashboardData, ProgramVolumeRow } from "@/lib/api/program";
import type { ComponentPropsWithoutRef } from "react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
});

function setupDialogMocks() {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  });
}

function buildData(
  volumeThisWeek: ProgramDashboardData["volumeThisWeek"],
  overrides: Partial<ProgramDashboardData> = {}
): ProgramDashboardData {
  return {
    activeMeso: {
      mesoNumber: 1,
      focus: "Strength-Hypertrophy",
      durationWeeks: 5,
      completedSessions: 8,
      volumeTarget: "moderate",
      currentBlockType: "accumulation",
      blocks: [{ blockType: "accumulation", startWeek: 1, durationWeeks: 5 }],
    },
    currentWeek: 4,
    viewedWeek: 3,
    viewedBlockType: "accumulation",
    sessionsUntilDeload: 3,
    volumeThisWeek,
    deloadReadiness: null,
    rirTarget: { min: 0, max: 1 },
    coachingCue: "Build volume.",
    ...overrides,
  };
}

function withOpportunity(
  row: Omit<ProgramVolumeRow, "opportunityScore" | "opportunityState" | "opportunityRationale">
): ProgramVolumeRow {
  return {
    ...row,
    opportunityScore: 0,
    opportunityState: "covered",
    opportunityRationale: "Weekly target is already covered in this volume snapshot.",
  };
}

function buildCurrentWeekData(
  volumeThisWeek: ProgramDashboardData["volumeThisWeek"]
): ProgramDashboardData {
  return {
    ...buildData(volumeThisWeek),
    viewedWeek: 4,
  };
}

describe("ProgramStatusCard indirect volume context", () => {
  it("renders indirect line when indirectSets > 0", () => {
    const data = buildData([
      withOpportunity({
        muscle: "Front Delts",
        effectiveSets: 0.9,
        directSets: 0,
        indirectSets: 3,
        target: 5,
        mev: 2,
        mav: 7,
        mrv: 14,
        breakdown: {
          muscle: "Front Delts",
          effectiveSets: 0.9,
          targetSets: 5,
          contributions: [
            {
              exerciseId: "press",
              exerciseName: "Bench Press",
              effectiveSets: 0.9,
              performedSets: 3,
              indirectSets: 3,
            },
          ],
        },
      }),
    ]);

    render(<ProgramStatusCard initialData={data} />);

    expect(screen.getByText("0 direct, +3 indirect")).toBeInTheDocument();
  });

  it("hides indirect line when indirectSets = 0", () => {
    const data = buildData([
      withOpportunity({
        muscle: "Front Delts",
        effectiveSets: 0,
        directSets: 0,
        indirectSets: 0,
        target: 5,
        mev: 2,
        mav: 7,
        mrv: 14,
        breakdown: {
          muscle: "Front Delts",
          effectiveSets: 0,
          targetSets: 5,
          contributions: [],
        },
      }),
    ]);

    render(<ProgramStatusCard initialData={data} />);

    expect(screen.queryByText(/^\d+ direct/)).not.toBeInTheDocument();
  });

  it("shows effective sets as the primary value and keeps raw counts contextual", () => {
    const data = buildData([
      withOpportunity({
        muscle: "Front Delts",
        effectiveSets: 0.9,
        directSets: 0,
        indirectSets: 3,
        target: 5,
        mev: 2,
        mav: 7,
        mrv: 14,
        breakdown: {
          muscle: "Front Delts",
          effectiveSets: 0.9,
          targetSets: 5,
          contributions: [
            {
              exerciseId: "press",
              exerciseName: "Bench Press",
              effectiveSets: 0.9,
              performedSets: 3,
              indirectSets: 3,
            },
          ],
        },
      }),
    ]);

    render(<ProgramStatusCard initialData={data} />);

    const card = screen.getByText("Front Delts").closest("div");
    expect(card).not.toBeNull();
    if (!card) return;

    const scoped = within(card);
    expect(scoped.getByText("0.9")).toBeInTheDocument();
    expect(scoped.getByText("target 5 sets")).toBeInTheDocument();
    expect(scoped.getByText("0 direct, +3 indirect")).toBeInTheDocument();
  });
});

describe("ProgramStatusCard opportunity state", () => {
  it("shows a subtle opportunity label on current week muscle cards", () => {
    const data = buildCurrentWeekData([
      {
        ...withOpportunity({
          muscle: "Chest",
          effectiveSets: 4,
          directSets: 4,
          indirectSets: 0,
          target: 10,
          mev: 6,
          mav: 16,
          mrv: 22,
        }),
        opportunityState: "high_opportunity",
        opportunityRationale:
          "Below target in this snapshot, with enough recovery room to consider more volume.",
      },
    ]);

    render(<ProgramStatusCard initialData={data} />);

    expect(screen.getByText("Volume opportunity")).toBeInTheDocument();
    expect(screen.queryByText("High opportunity")).not.toBeInTheDocument();
    expect(screen.queryByText(/^0\.[0-9]+$/)).not.toBeInTheDocument();
  });

  it("hides the opportunity label when viewing a historical week", () => {
    const data = buildData([
      {
        ...withOpportunity({
          muscle: "Chest",
          effectiveSets: 4,
          directSets: 4,
          indirectSets: 0,
          target: 10,
          mev: 6,
          mav: 16,
          mrv: 22,
        }),
        opportunityState: "deprioritize_today",
        opportunityRationale:
          "Below target in this snapshot, but recent weighted stimulus is still fresh.",
      },
    ]);

    render(<ProgramStatusCard initialData={data} />);

    expect(screen.queryByText("Saturation watch")).not.toBeInTheDocument();
    expect(screen.queryByText("Deprioritize today")).not.toBeInTheDocument();
  });

  it("renders a coherent fetched historical payload instead of mixing current-week chrome", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () =>
        buildData(
          [
            withOpportunity({
              muscle: "Back",
              effectiveSets: 7,
              directSets: 6,
              indirectSets: 1,
              target: 9,
              mev: 6,
              mav: 14,
              mrv: 18,
            }),
          ],
          {
            viewedWeek: 3,
            viewedBlockType: "intensification",
            rirTarget: { min: 2, max: 3 },
            coachingCue: "Push load, not fatigue.",
            sessionsUntilDeload: 0,
            deloadReadiness: {
              shouldDeload: true,
              urgency: "scheduled",
              reason: "Deload week",
            },
          }
        ),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProgramStatusCard
        initialData={buildCurrentWeekData([
          withOpportunity({
            muscle: "Chest",
            effectiveSets: 4,
            directSets: 4,
            indirectSets: 0,
            target: 10,
            mev: 6,
            mav: 16,
            mrv: 22,
          }),
        ])}
      />
    );

    await user.click(screen.getByRole("button", { name: "View previous week" }));
    await waitFor(() => {
      expect(screen.getByText("Week 3 of 5")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/program?week=3");
    expect(screen.getByText("intensification")).toBeInTheDocument();
    expect(screen.getByText("2-3 RIR")).toBeInTheDocument();
    expect(screen.getByText("Push load, not fatigue.")).toBeInTheDocument();
    expect(screen.getByText("Volume - Week 3 of 5")).toBeInTheDocument();
    expect(screen.getByText("Viewing Week 3 - read only")).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
    expect(screen.queryByText("3 sessions until deload")).not.toBeInTheDocument();
    expect(screen.queryByText(/Deload week/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Volume opportunity")).not.toBeInTheDocument();
    expect(screen.queryByText("High opportunity")).not.toBeInTheDocument();
  });
});

describe("ProgramStatusCard muscle breakdown", () => {
  it("opens the breakdown sheet and shows contributors in descending weighted order", async () => {
    setupDialogMocks();
    const user = userEvent.setup();
    const data = buildData([
      withOpportunity({
        muscle: "Biceps",
        effectiveSets: 4.1,
        directSets: 2,
        indirectSets: 5,
        target: 8,
        mev: 4,
        mav: 14,
        mrv: 18,
        breakdown: {
          muscle: "Biceps",
          effectiveSets: 4.1,
          targetSets: 8,
          contributions: [
            {
              exerciseId: "curl",
              exerciseName: "EZ-Bar Curl",
              effectiveSets: 2,
              performedSets: 2,
              directSets: 2,
            },
            {
              exerciseId: "row",
              exerciseName: "Barbell Row",
              effectiveSets: 1.2,
              performedSets: 3,
              indirectSets: 3,
            },
            {
              exerciseId: "pullup",
              exerciseName: "Pull-Up",
              effectiveSets: 0.9,
              performedSets: 2,
              indirectSets: 2,
            },
          ],
        },
      }),
    ]);

    render(<ProgramStatusCard initialData={data} />);

    await user.click(screen.getByRole("button", { name: "Show where Biceps sets came from" }));

    expect(screen.getByTestId("muscle-breakdown-sheet")).toBeInTheDocument();
    expect(screen.getByText("Biceps 4.1 / 8 sets this week")).toBeInTheDocument();
    expect(
      screen.getByText(/Values are weighted by how much each exercise trains the muscle\./)
    ).toBeInTheDocument();
    expect(screen.getByText("Total weighted sets")).toBeInTheDocument();
    expect(screen.getByText("2 direct, +5 indirect")).toBeInTheDocument();

    const contributors = screen.getAllByTestId("muscle-breakdown-contributor");
    expect(within(contributors[0]!).getByText("EZ-Bar Curl")).toBeInTheDocument();
    expect(within(contributors[1]!).getByText("Barbell Row")).toBeInTheDocument();
    expect(within(contributors[2]!).getByText("Pull-Up")).toBeInTheDocument();
    expect(screen.getByText("2 direct")).toBeInTheDocument();
    expect(screen.getByText("3 indirect")).toBeInTheDocument();
  });
});

describe("ProgramStatusCard homeCompact variant", () => {
  it("renders a compact summary without timeline or volume grid details", () => {
    const data = buildData([
      withOpportunity({
        muscle: "Front Delts",
        effectiveSets: 0.9,
        directSets: 0,
        indirectSets: 3,
        target: 5,
        mev: 2,
        mav: 7,
        mrv: 14,
      }),
    ]);

    render(<ProgramStatusCard initialData={data} variant="homeCompact" />);

    expect(screen.getByText("Mesocycle 1")).toBeInTheDocument();
    expect(screen.getByText("Strength-Hypertrophy")).toBeInTheDocument();
    expect(screen.getByText("Week 4 of 5")).toBeInTheDocument();
    expect(screen.getByText("0-1 RIR")).toBeInTheDocument();
    expect(screen.getByText("3 sessions until deload")).toBeInTheDocument();
    expect(screen.getByText("Build volume.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open program details" })).toHaveAttribute(
      "href",
      "/program"
    );

    expect(screen.queryByText("Mesocycle Timeline")).not.toBeInTheDocument();
    expect(screen.queryByText("Volume This Week")).not.toBeInTheDocument();
    expect(screen.queryByText("Front Delts")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("View previous week")).not.toBeInTheDocument();
  });
});
