import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AnalyticsPage from "./page";

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
});
