import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanManagementData, PlanSummary } from "@/lib/api/plan-management";
import { PlanManagementClient } from "./PlanManagementClient";

const router = {
  push: vi.fn(),
  refresh: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function plan(
  input: Partial<PlanSummary> & Pick<PlanSummary, "id" | "name" | "status">,
): PlanSummary {
  return {
    primaryGoal: "HYPERTROPHY",
    isActive: false,
    activeMesocycleId: input.status === "READY" ? `meso-${input.id}` : null,
    reviewMesocycleId: `meso-${input.id}`,
    startDate: "2026-08-01T00:00:00.000Z",
    endDate: "2027-01-16T00:00:00.000Z",
    durationWeeks: 24,
    mesocycleCount: 4,
    createdAt: "2026-07-27T01:00:00.000Z",
    updatedAt: "2026-07-27T01:00:00.000Z",
    ...input,
  };
}

describe("PlanManagementClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("clearly separates active, READY, and preparing plans", () => {
    const data: PlanManagementData = {
      activeMacroCycleId: "plan-a",
      plans: [
        plan({
          id: "plan-a",
          name: "Current Plan",
          status: "READY",
          isActive: true,
        }),
        plan({
          id: "plan-b",
          name: "Next Plan",
          status: "READY",
        }),
        plan({
          id: "plan-c",
          name: "Draft Plan",
          status: "PREPARING",
        }),
      ],
    };

    render(<PlanManagementClient initialData={data} />);

    expect(screen.getByText("Current Plan")).toBeInTheDocument();
    expect(screen.getByText("Draft Plan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review and finalize" })).toHaveAttribute(
      "href",
      "/plans/plan-c/review",
    );
    expect(screen.getByRole("button", { name: "Make active" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Archive" })).toHaveLength(2);
  });

  it("confirms the target and updates the active marker after switching", async () => {
    const user = userEvent.setup();
    const data: PlanManagementData = {
      activeMacroCycleId: "00000000-0000-4000-8000-000000000001",
      plans: [
        plan({
          id: "00000000-0000-4000-8000-000000000001",
          name: "Current Plan",
          status: "READY",
          isActive: true,
        }),
        plan({
          id: "00000000-0000-4000-8000-000000000002",
          name: "Next Plan",
          status: "READY",
        }),
      ],
    };
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          selection: {
            activeMacroCycleId: "00000000-0000-4000-8000-000000000002",
            activeMesocycleId: "meso-plan-b",
            replayed: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<PlanManagementClient initialData={data} />);

    await user.click(screen.getByRole("button", { name: "Make active" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Next Plan"));
    await waitFor(() => {
      expect(screen.getByText("Next Plan is now your active plan.")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/plans/00000000-0000-4000-8000-000000000002/activate",
      expect.objectContaining({
        body: JSON.stringify({
          expectedActiveMacroCycleId: "00000000-0000-4000-8000-000000000001",
        }),
      }),
    );
  });

  it("shows a structured conflict without changing the visible active plan", async () => {
    const data: PlanManagementData = {
      activeMacroCycleId: "plan-a",
      plans: [
        plan({
          id: "plan-a",
          name: "Current Plan",
          status: "READY",
          isActive: true,
        }),
        plan({ id: "plan-b", name: "Next Plan", status: "READY" }),
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "Finish or close the workout in progress before switching plans.",
            code: "ACTIVE_WORKOUT_IN_PROGRESS",
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(<PlanManagementClient initialData={data} />);

    fireEvent.click(screen.getByRole("button", { name: "Make active" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Finish or close the workout in progress",
      );
    });
    expect(screen.getByText("Current Plan").closest("article")).toHaveTextContent(
      "Active",
    );
  });
});
