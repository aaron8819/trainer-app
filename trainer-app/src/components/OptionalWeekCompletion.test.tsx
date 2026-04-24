import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GapFillSupportData } from "@/lib/api/program";
import { OptionalWeekCompletion } from "./OptionalWeekCompletion";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const fetchMock = vi.fn();

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

function buildGapFill(overrides: Partial<GapFillSupportData> = {}): GapFillSupportData {
  return {
    eligible: true,
    visible: true,
    reason: null,
    weekCloseId: "wc-1",
    anchorWeek: 3,
    targetWeek: 3,
    targetPhase: "ACCUMULATION",
    resolution: null,
    workflowState: "PENDING_OPTIONAL_GAP_FILL",
    deficitState: "OPEN",
    remainingDeficitSets: 7,
    targetMuscles: ["chest", "lats"],
    deficitSummary: [
      { muscle: "Chest", target: 10, actual: 7, deficit: 3 },
      { muscle: "Lats", target: 12, actual: 8, deficit: 4 },
    ],
    alreadyUsedThisWeek: false,
    suppressedByStartedNextWeek: false,
    linkedWorkout: null,
    policy: {
      requiredSessionsPerWeek: 3,
      maxOptionalGapFillSessionsPerWeek: 1,
      maxGeneratedHardSets: 12,
      maxGeneratedExercises: 4,
    },
    detail: "Targets the remaining deficits from current week data.",
    actionLabel: "Generate recommended session",
    actionMethod: "post",
    actionHref: "/api/workouts/generate-from-intent",
    canDismiss: true,
    ...overrides,
  };
}

describe("OptionalWeekCompletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders recommended work before custom work and hides with UI-only dismissal", () => {
    render(
      <OptionalWeekCompletion
        activeWeek={3}
        gapFill={buildGapFill()}
        customSession={{
          workoutId: "custom-1",
          status: "planned",
          statusLabel: "Planned",
          detail: "Server custom detail.",
          actionHref: "/log/custom-1",
          actionLabel: "Open custom session",
          canDismiss: true,
        }}
      />
    );

    expect(screen.getByRole("heading", { name: "Optional week completion" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "You can add optional work for this week. The recommended session targets remaining deficits. You can also create your own custom session."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Chest 3 sets, Lats 4 sets")).toBeInTheDocument();
    expect(screen.getByText("Recommended session").compareDocumentPosition(screen.getByText("Custom session"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.getByRole("button", { name: "Generate recommended session" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open custom session" })).toHaveAttribute(
      "href",
      "/log/custom-1"
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse for now" }));

    expect(
      screen.getByText("Optional week completion hidden for this active week.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show options" })).toBeInTheDocument();
  });

  it("uses custom-session copy without workflow terminology", () => {
    render(
      <OptionalWeekCompletion
        activeWeek={3}
        customSession={{
          workoutId: null,
          status: "available",
          statusLabel: "Available",
          detail: "Server custom detail.",
          actionHref: "/api/mesocycles/week-close/wc-1/closeout",
          actionLabel: "Create optional session",
          canDismiss: true,
        }}
      />
    );

    expect(screen.getByRole("button", { name: "Create optional session" })).toBeInTheDocument();
    expect(screen.queryByText(/closeout/i)).not.toBeInTheDocument();
  });

  it("dismisses pending optional work through the week-close dismiss route", async () => {
    render(
      <OptionalWeekCompletion
        activeWeek={3}
        gapFill={buildGapFill({
          eligible: false,
          linkedWorkout: {
            id: "w-gap-fill",
            status: "SKIPPED",
          },
          actionLabel: "Review recommended session",
          actionMethod: "link",
          actionHref: "/workout/w-gap-fill",
        })}
      />
    );

    expect(screen.getByRole("link", { name: "Review recommended session" })).toHaveAttribute(
      "href",
      "/workout/w-gap-fill"
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss optional work and continue" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mesocycles/week-close/wc-1/dismiss", {
        method: "POST",
      });
    });
    expect(refreshMock).toHaveBeenCalled();
  });
});
