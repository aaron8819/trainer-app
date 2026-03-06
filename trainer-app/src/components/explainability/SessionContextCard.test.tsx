import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SessionContextCard } from "./SessionContextCard";
import type { SessionSummaryModel } from "@/lib/ui/session-summary";

const summary: SessionSummaryModel = {
  title: "Why today looks like this",
  summary: "This pull session is set up to build workload without pushing to failure.",
  tags: ["Pull", "Accumulation week 2"],
  items: [
    { label: "Today's goal", value: "Build pull work this week." },
    { label: "Target effort", value: "Leave 2-3 reps in reserve on work sets." },
    { label: "Readiness", value: "Readiness looked normal." },
  ],
};

afterEach(() => cleanup());

describe("SessionContextCard", () => {
  it("renders collapsed by default when defaultCollapsed=true", () => {
    render(<SessionContextCard summary={summary} defaultCollapsed={true} />);

    expect(screen.getByText("Why today looks like this")).toBeInTheDocument();
    // Summary preview visible in collapsed header
    expect(screen.getByText("This pull session is set up to build workload without pushing to failure.")).toBeInTheDocument();
    // Detail items hidden
    expect(screen.queryByText("Build pull work this week.")).not.toBeInTheDocument();
    expect(screen.queryByText("Leave 2-3 reps in reserve on work sets.")).not.toBeInTheDocument();
  });

  it("expand button has aria-expanded=false when collapsed", () => {
    render(<SessionContextCard summary={summary} defaultCollapsed={true} />);
    const button = screen.getByRole("button", { name: /expand session context/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("expands to show full content when tapped", async () => {
    const user = userEvent.setup();
    render(<SessionContextCard summary={summary} defaultCollapsed={true} />);

    const button = screen.getByRole("button", { name: /expand session context/i });
    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Build pull work this week.")).toBeInTheDocument();
    expect(screen.getByText("Leave 2-3 reps in reserve on work sets.")).toBeInTheDocument();
    expect(screen.getByText("Pull")).toBeInTheDocument();
    expect(screen.getByText("Accumulation week 2")).toBeInTheDocument();
  });

  it("collapses again on second tap", async () => {
    const user = userEvent.setup();
    render(<SessionContextCard summary={summary} defaultCollapsed={true} />);

    const button = screen.getByRole("button");
    await user.click(button);
    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Build pull work this week.")).not.toBeInTheDocument();
  });

  it("renders expanded by default when defaultCollapsed is omitted", () => {
    render(<SessionContextCard summary={summary} />);

    const button = screen.getByRole("button", { name: /collapse session context/i });
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Build pull work this week.")).toBeInTheDocument();
    expect(screen.getByText("Today's goal")).toBeInTheDocument();
  });
});
