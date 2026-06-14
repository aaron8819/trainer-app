import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const mocks = vi.hoisted(() => ({
  resolveOwner: vi.fn(),
  workoutFindFirst: vi.fn(),
  preSessionReadinessSnapshotFindFirst: vi.fn(),
  getUiAuditFixtureForServer: vi.fn(),
}));

vi.mock("@/lib/api/workout-context", () => ({
  resolveOwner: (...args: unknown[]) => mocks.resolveOwner(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workout: {
      findFirst: (...args: unknown[]) => mocks.workoutFindFirst(...args),
    },
    preSessionReadinessSnapshot: {
      findFirst: (...args: unknown[]) =>
        mocks.preSessionReadinessSnapshotFindFirst(...args),
    },
  },
}));

vi.mock("@/lib/ui-audit-fixtures/server", () => ({
  getUiAuditFixtureForServer: (...args: unknown[]) =>
    mocks.getUiAuditFixtureForServer(...args),
}));

vi.mock("@/components/LogWorkoutClient", () => ({
  default: () => <div>LogWorkoutClient mounted</div>,
}));

describe("LogWorkoutPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOwner.mockResolvedValue({ id: "user-1" });
    mocks.preSessionReadinessSnapshotFindFirst.mockResolvedValue(null);
    mocks.getUiAuditFixtureForServer.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it("does not mount the log editor for completed workouts", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "COMPLETED",
      mesocycleId: "meso-1",
      mesocycle: {
        state: "ACTIVE_ACCUMULATION",
        isActive: true,
      },
    });

    const { default: LogWorkoutPage } = await import("./page");
    const ui = await LogWorkoutPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("Session review only")).toBeInTheDocument();
    expect(screen.getByText("This session is completed and is now read-only.")).toBeInTheDocument();
    expect(screen.queryByText("LogWorkoutClient mounted")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View workout" })).toHaveAttribute(
      "href",
      "/workout/workout-1"
    );
  });

  it("does not mount the log editor for skipped workouts", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "SKIPPED",
      mesocycleId: "meso-1",
      mesocycle: {
        state: "ACTIVE_ACCUMULATION",
        isActive: true,
      },
    });

    const { default: LogWorkoutPage } = await import("./page");
    const ui = await LogWorkoutPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("Session review only")).toBeInTheDocument();
    expect(screen.getByText("This session was skipped and is now read-only.")).toBeInTheDocument();
    expect(screen.queryByText("LogWorkoutClient mounted")).not.toBeInTheDocument();
  });

  it("mounts the log editor for active resumable workouts", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "IN_PROGRESS",
      mesocycleId: "meso-1",
      mesocycle: {
        state: "ACTIVE_ACCUMULATION",
        isActive: true,
      },
      exercises: [],
      selectionMetadata: null,
      selectionMode: "INTENT",
      sessionIntent: "UPPER",
    });

    const { default: LogWorkoutPage } = await import("./page");
    const ui = await LogWorkoutPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("LogWorkoutClient mounted")).toBeInTheDocument();
  });

  it("shows blocker navigation for closed-mesocycle workouts", async () => {
    mocks.workoutFindFirst.mockResolvedValue({
      id: "workout-1",
      userId: "user-1",
      status: "PARTIAL",
      mesocycleId: "meso-1",
      mesocycle: {
        state: "AWAITING_HANDOFF",
        isActive: false,
      },
    });

    const { default: LogWorkoutPage } = await import("./page");
    const ui = await LogWorkoutPage({ params: Promise.resolve({ id: "workout-1" }) });

    render(ui);

    expect(screen.getByText("Workout unavailable")).toBeInTheDocument();
    expect(screen.getByText(/handoff pending/)).toBeInTheDocument();
    expect(screen.queryByText("LogWorkoutClient mounted")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View workout" })).toHaveAttribute(
      "href",
      "/workout/workout-1"
    );
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/");
  });
});
