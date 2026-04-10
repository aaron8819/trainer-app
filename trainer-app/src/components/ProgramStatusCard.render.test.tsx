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
  vi.unstubAllGlobals();
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

    expect(screen.getByText("Raw sets: 0 direct, 3 indirect")).toBeInTheDocument();
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

    const card = screen.getByText("Front Delts").closest("button");
    expect(card).not.toBeNull();
    if (!card) return;

    const scoped = within(card);
    expect(scoped.getByText("0.9 weighted sets")).toBeInTheDocument();
    expect(scoped.getByText("target 5 weighted sets")).toBeInTheDocument();
    expect(scoped.getByText("Below MEV")).toBeInTheDocument();
    expect(scoped.getByText("Raw sets: 0 direct, 3 indirect")).toBeInTheDocument();
  });
});

describe("ProgramStatusCard weekly status labels", () => {
  it("uses a more precise in-range label when above MEV but still meaningfully below target", () => {
    const data = buildData([
      withOpportunity({
        muscle: "Upper Back",
        effectiveSets: 9,
        directSets: 9,
        indirectSets: 4,
        target: 14,
        mev: 6,
        mav: 14,
        mrv: 22,
      }),
    ]);

    render(<ProgramStatusCard initialData={data} />);

    expect(screen.getByText("In range")).toBeInTheDocument();
    expect(screen.queryByText("Building")).not.toBeInTheDocument();
  });

  it("uses a near-target label when close to target but not yet on target", () => {
    const data = buildData([
      withOpportunity({
        muscle: "Biceps",
        effectiveSets: 12,
        directSets: 8,
        indirectSets: 9,
        target: 14,
        mev: 6,
        mav: 14,
        mrv: 22,
      }),
    ]);

    render(<ProgramStatusCard initialData={data} />);

    expect(screen.getByText("Near target")).toBeInTheDocument();
    expect(screen.queryByText("Building")).not.toBeInTheDocument();
  });
});

describe("ProgramStatusCard opportunity state", () => {
  it("shows a separate weekly status chip and today-focused advisory on current week muscle cards", () => {
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

    expect(screen.getByText("4 weighted sets")).toBeInTheDocument();
    expect(screen.getByText("target 10 weighted sets")).toBeInTheDocument();
    expect(screen.getByText("Below MEV")).toBeInTheDocument();
    expect(screen.getByText("Today: room for more")).toBeInTheDocument();
    expect(screen.queryByText("Volume opportunity")).not.toBeInTheDocument();
  });

  it("uses concrete secondary wording for moderate and deprioritized advisories", () => {
    const data = buildCurrentWeekData([
      {
        ...withOpportunity({
          muscle: "Chest",
          effectiveSets: 0,
          directSets: 0,
          indirectSets: 0,
          target: 10,
          mev: 6,
          mav: 16,
          mrv: 22,
        }),
        opportunityState: "moderate_opportunity",
        opportunityRationale:
          "Below target in this snapshot, but recent stimulus or readiness keeps the read mixed.",
      },
      {
        ...withOpportunity({
          muscle: "Lats",
          effectiveSets: 12,
          directSets: 13,
          indirectSets: 0,
          target: 16,
          mev: 8,
          mav: 16,
          mrv: 24,
        }),
        opportunityState: "deprioritize_today",
        opportunityRationale:
          "Below target in this snapshot, but recent weighted stimulus is still fresh.",
      },
    ]);

    render(<ProgramStatusCard initialData={data} />);

    expect(screen.getByText("Today: optional")).toBeInTheDocument();
    expect(screen.getByText("Today: go lighter")).toBeInTheDocument();
    expect(screen.queryByText("Today: mixed signal")).not.toBeInTheDocument();
    expect(screen.queryByText("Today: recently hit")).not.toBeInTheDocument();
  });

  it("hides the today-focused advisory when viewing a historical week", () => {
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

    expect(screen.queryByText(/Today:/)).not.toBeInTheDocument();
    expect(screen.getByText("Below MEV")).toBeInTheDocument();
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
              reason: "Scheduled lighter week in the plan.",
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
    expect(
      screen.queryByText("3 sessions until scheduled lighter week")
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Scheduled lighter week/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Today:/)).not.toBeInTheDocument();
  });
});

describe("ProgramStatusCard lighter-week language", () => {
  it("frames current-week recovery guidance as program timing or advisory copy", () => {
    const data = buildCurrentWeekData([
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
    ]);
    data.sessionsUntilDeload = 0;
    data.deloadReadiness = {
      shouldDeload: true,
      urgency: "recommended",
      reason: "Program-level recovery timing suggests a lighter week may be worth considering.",
    };

    render(<ProgramStatusCard initialData={data} />);

    expect(screen.getByText("Scheduled lighter week")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Program advisory: Program-level recovery timing suggests a lighter week may be worth considering."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Deload week$/)).not.toBeInTheDocument();
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
    expect(screen.getByText("Biceps: 4.1 weighted / 8 target")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Weighted sets count toward your weekly target. Raw direct and indirect sets are structural context."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Each row shows raw sets x exercise weighting = weighted contribution\./)
    ).toBeInTheDocument();
    expect(screen.getByText("Total weighted sets")).toBeInTheDocument();
    expect(screen.getByText("2 raw direct sets x 1.0 = 2 weighted")).toBeInTheDocument();
    expect(screen.getByText("3 raw indirect sets x 0.4 = 1.2 weighted")).toBeInTheDocument();
    expect(screen.getByText("2 raw indirect sets x 0.45 = 0.9 weighted")).toBeInTheDocument();
    expect(screen.getByText("Raw mapping: 2 direct")).toBeInTheDocument();
    expect(screen.getByText("Raw mapping: 3 indirect")).toBeInTheDocument();

    const contributors = screen.getAllByTestId("muscle-breakdown-contributor");
    expect(within(contributors[0]!).getByText("EZ-Bar Curl")).toBeInTheDocument();
    expect(within(contributors[1]!).getByText("Barbell Row")).toBeInTheDocument();
    expect(within(contributors[2]!).getByText("Pull-Up")).toBeInTheDocument();
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
    expect(screen.getByText("3 sessions until scheduled lighter week")).toBeInTheDocument();
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

describe("ProgramStatusCard volumeOnly variant", () => {
  it("keeps the weekly volume grid but hides the duplicated mesocycle chrome and coaching cue", () => {
    const data = buildCurrentWeekData([
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
    ]);

    render(<ProgramStatusCard initialData={data} variant="volumeOnly" />);

    expect(screen.getByText("Volume This Week")).toBeInTheDocument();
    expect(screen.getByText("Chest")).toBeInTheDocument();
    expect(screen.queryByText("Mesocycle Timeline")).not.toBeInTheDocument();
    expect(screen.queryByText("Week 4 of 5")).not.toBeInTheDocument();
    expect(screen.queryByText("3 sessions until scheduled lighter week")).not.toBeInTheDocument();
    expect(screen.queryByText("Build volume.")).not.toBeInTheDocument();
  });

  it("keeps summary badges in sync when navigating historical weeks and back", async () => {
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
            withOpportunity({
              muscle: "Quads",
              effectiveSets: 17,
              directSets: 17,
              indirectSets: 0,
              target: 10,
              mev: 6,
              mav: 16,
              mrv: 20,
            }),
          ],
          { viewedWeek: 3 }
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
          withOpportunity({
            muscle: "Biceps",
            effectiveSets: 8,
            directSets: 8,
            indirectSets: 0,
            target: 8,
            mev: 4,
            mav: 14,
            mrv: 18,
          }),
        ])}
        variant="volumeOnly"
      />
    );

    expect(screen.getByText("Volume This Week")).toBeInTheDocument();
    expect(screen.getByText("1 Below MEV")).toBeInTheDocument();
    expect(screen.getByText("1 On target")).toBeInTheDocument();
    expect(screen.getByText("Chest")).toBeInTheDocument();
    expect(screen.getByText("Biceps")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View previous week" }));
    await waitFor(() => {
      expect(screen.getByText("Volume - Week 3 of 5")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/program?week=3");
    expect(screen.getByText("1 In range")).toBeInTheDocument();
    expect(screen.getByText("1 Near MRV")).toBeInTheDocument();
    expect(screen.getByText("0 Below MEV")).toBeInTheDocument();
    expect(screen.getByText("0 On target")).toBeInTheDocument();
    expect(screen.getByText("Back")).toBeInTheDocument();
    expect(screen.getByText("Quads")).toBeInTheDocument();
    expect(screen.queryByText("Chest")).not.toBeInTheDocument();
    expect(screen.queryByText("Biceps")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View next week" }));
    await waitFor(() => {
      expect(screen.getByText("Volume This Week")).toBeInTheDocument();
    });

    expect(screen.getByText("1 Below MEV")).toBeInTheDocument();
    expect(screen.getByText("1 On target")).toBeInTheDocument();
    expect(screen.getByText("Chest")).toBeInTheDocument();
    expect(screen.getByText("Biceps")).toBeInTheDocument();
    expect(screen.queryByText("Back")).not.toBeInTheDocument();
    expect(screen.queryByText("Quads")).not.toBeInTheDocument();
  });

  it("keeps the empty volume state without rendering stale summary badges", () => {
    render(<ProgramStatusCard initialData={buildCurrentWeekData([])} variant="volumeOnly" />);

    expect(screen.getByText("No volume data for this week.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Weekly volume status summary")).not.toBeInTheDocument();
    expect(screen.queryByText("0 Below MEV")).not.toBeInTheDocument();
  });
});
