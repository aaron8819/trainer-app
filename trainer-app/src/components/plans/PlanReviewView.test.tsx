import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanReview } from "@/lib/ui/plan-management";
import { PlanReviewView } from "./PlanReviewView";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

describe("PlanReviewView", () => {
  it("presents a selected completed plan without active or activation language", () => {
    const plan: PlanReview = {
      id: "plan-complete",
      name: "Five Week Builder",
      primaryGoal: "HYPERTROPHY",
      status: "COMPLETED",
      isActive: true,
      activeMesocycleId: null,
      reviewMesocycleId: "meso-1",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-08-05T00:00:00.000Z",
      durationWeeks: 5,
      mesocycleCount: 1,
      sessionsPerWeek: 4,
      editableCopyAvailable: true,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
      strengthConfiguration: null,
      weeklyStructure: [],
      mesocycles: [
        {
          id: "meso-1",
          mesoNumber: 1,
          startWeek: 0,
          durationWeeks: 5,
          focus: "Hypertrophy",
          volumeTarget: "MODERATE",
          intensityBias: "BALANCED",
          blockCount: 1,
        },
      ],
    };

    render(<PlanReviewView plan={plan} />);

    expect(screen.getByText("Completed plan")).toBeInTheDocument();
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText(/remains selected for completed-plan history/i)).toBeInTheDocument();
    expect(screen.queryByText(/active/i)).toBeNull();
    expect(screen.queryByText(/activate/i)).toBeNull();
  });
});
