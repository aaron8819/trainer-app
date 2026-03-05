import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgramStatusCard } from "./ProgramStatusCard";
import type { ProgramDashboardData } from "@/lib/api/program";
import type { ComponentPropsWithoutRef } from "react";

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

function buildData(volumeThisWeek: ProgramDashboardData["volumeThisWeek"]): ProgramDashboardData {
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
    sessionsUntilDeload: 3,
    volumeThisWeek,
    deloadReadiness: null,
    rirTarget: { min: 0, max: 1 },
    coachingCue: "Build volume.",
  };
}

describe("ProgramStatusCard indirect volume context", () => {
  it("renders indirect line when indirectSets > 0", () => {
    const data = buildData([
      {
        muscle: "Front Delts",
        directSets: 0,
        indirectSets: 3,
        target: 5,
        mev: 2,
        mav: 7,
        mrv: 14,
      },
    ]);

    render(<ProgramStatusCard initialData={data} />);

    expect(screen.getByText("+3 indirect sets")).toBeInTheDocument();
  });

  it("hides indirect line when indirectSets = 0", () => {
    const data = buildData([
      {
        muscle: "Front Delts",
        directSets: 0,
        indirectSets: 0,
        target: 5,
        mev: 2,
        mav: 7,
        mrv: 14,
      },
    ]);

    render(<ProgramStatusCard initialData={data} />);

    expect(screen.queryByText("+0 indirect sets")).not.toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+ indirect sets$/)).not.toBeInTheDocument();
  });

  it("keeps direct sets as primary value and target copy unchanged", () => {
    const data = buildData([
      {
        muscle: "Front Delts",
        directSets: 0,
        indirectSets: 3,
        target: 5,
        mev: 2,
        mav: 7,
        mrv: 14,
      },
    ]);

    render(<ProgramStatusCard initialData={data} />);

    const card = screen.getByText("Front Delts").closest("div");
    expect(card).not.toBeNull();
    if (!card) return;

    const scoped = within(card);
    expect(scoped.getByText("0")).toBeInTheDocument();
    expect(scoped.getByText("target 5 sets")).toBeInTheDocument();
    expect(scoped.getByText("+3 indirect sets")).toBeInTheDocument();
  });
});
