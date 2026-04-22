import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GapFillSupportData } from "@/lib/api/program";
import { OptionalWeekCompletion } from "./OptionalWeekCompletion";

const pushMock = vi.fn();
const refreshMock = vi.fn();

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
    ...overrides,
  };
}

describe("OptionalWeekCompletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          actionHref: "/log/custom-1",
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

    fireEvent.click(screen.getByRole("button", { name: "Hide options" }));

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
          actionHref: "/api/mesocycles/week-close/wc-1/closeout",
        }}
      />
    );

    expect(screen.getByRole("link", { name: "Create custom session" })).toBeInTheDocument();
    expect(screen.queryByText(/closeout/i)).not.toBeInTheDocument();
  });
});
