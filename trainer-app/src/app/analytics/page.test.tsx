import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AnalyticsPage from "./page";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/analytics/AnalyticsSummaryPanel", () => ({
  AnalyticsSummaryPanel: () => <div>Summary Panel</div>,
}));

vi.mock("@/components/SurfaceGuideCard", () => ({
  SurfaceGuideCard: () => <div>Surface Guide</div>,
}));

vi.mock("@/components/analytics/MuscleRecoveryPanel", () => ({
  MuscleRecoveryPanel: () => <div>Recovery Panel</div>,
}));

vi.mock("@/components/analytics/MuscleVolumeChart", () => ({
  MuscleVolumeChart: () => <div>Volume Chart</div>,
}));

vi.mock("@/components/analytics/MuscleOutcomeReviewPanel", () => ({
  MuscleOutcomeReviewPanel: () => <div>Outcome Review</div>,
}));

vi.mock("@/components/analytics/WeeklyVolumeTrend", () => ({
  WeeklyVolumeTrend: () => <div>Weekly Trend</div>,
}));

vi.mock("@/components/analytics/SplitDistribution", () => ({
  SplitDistribution: () => <div>Split Distribution</div>,
}));

vi.mock("@/components/analytics/TemplateStatsSection", () => ({
  TemplateStatsSection: () => <div>Template Stats</div>,
}));

describe("AnalyticsPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("frames the recovery tab as stimulus recency rather than readiness", () => {
    render(<AnalyticsPage />);

    expect(screen.getByRole("heading", { name: "Muscle Stimulus Recency" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /SRA-style recency view of when each muscle was last meaningfully stimulated, plus a 7-day weighted stimulus pattern/i
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This is analytics context, not dashboard opportunity or a go-train signal/i)
    ).toBeInTheDocument();
  });

  it("links from the templates tab to template management", async () => {
    render(<AnalyticsPage />);

    await userEvent.click(screen.getByRole("button", { name: "Templates" }));

    expect(screen.getByRole("link", { name: "Manage templates" })).toHaveAttribute(
      "href",
      "/templates"
    );
  });
});
