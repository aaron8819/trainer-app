import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RecentWorkouts from "./RecentWorkouts";
import type { WorkoutListSurfaceSummary } from "@/lib/ui/workout-list-items";
import { buildWorkoutSessionSnapshotSummary } from "@/lib/ui/workout-session-snapshot";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./DeleteWorkoutButton", () => ({
  default: () => <button type="button">Delete</button>,
}));

function makeWorkout(
  overrides: Partial<WorkoutListSurfaceSummary> = {}
): WorkoutListSurfaceSummary {
  return {
    id: "w1",
    scheduledDate: "2026-02-25T00:00:00.000Z",
    completedAt: null,
    status: "COMPLETED",
    selectionMode: "INTENT",
    sessionIntent: "PUSH",
    mesocycleId: null,
    sessionSnapshot: null,
    exerciseCount: 5,
    totalSetsLogged: 0,
    ...overrides,
  };
}

function renderRecent(workouts: WorkoutListSurfaceSummary[]) {
  return render(<RecentWorkouts recentWorkouts={workouts} />);
}

afterEach(() => {
  cleanup();
});

// ── R1: Dynamic count label ──────────────────────────────────────────────────

describe("dynamic count label", () => {
  it("shows '1 workout' for a single workout", () => {
    renderRecent([makeWorkout()]);
    expect(screen.getByText("1 workout")).toBeInTheDocument();
  });

  it("shows '3 workouts' for three workouts", () => {
    renderRecent([
      makeWorkout({ id: "a" }),
      makeWorkout({ id: "b" }),
      makeWorkout({ id: "c" }),
    ]);
    expect(screen.getByText("3 workouts")).toBeInTheDocument();
  });
});

describe("session snapshot badge", () => {
  it("renders the derived week-session label when a snapshot exists", () => {
    renderRecent([
      makeWorkout({
        sessionSnapshot: buildWorkoutSessionSnapshotSummary({
          week: 4,
          session: 1,
          phase: "ACCUMULATION",
        }),
      }),
    ]);
    expect(screen.getByText("Wk4·S1")).toBeInTheDocument();
  });
});

// ── R4: Status-aware action buttons ─────────────────────────────────────────

describe("COMPLETED row", () => {
  it("renders View and no Log", () => {
    renderRecent([makeWorkout({ status: "COMPLETED" })]);
    expect(screen.getByRole("link", { name: "View" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Log" })).not.toBeInTheDocument();
  });
});

describe("SKIPPED row", () => {
  it("renders View and no Log", () => {
    renderRecent([makeWorkout({ status: "SKIPPED" })]);
    expect(screen.getByRole("link", { name: "View" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Log" })).not.toBeInTheDocument();
  });
});

describe("PLANNED row", () => {
  it("renders Log", () => {
    renderRecent([makeWorkout({ status: "PLANNED" })]);
    expect(screen.getByRole("link", { name: "Log" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View" })).not.toBeInTheDocument();
  });
});

describe("IN_PROGRESS row", () => {
  it("renders Continue", () => {
    renderRecent([makeWorkout({ status: "IN_PROGRESS" })]);
    expect(screen.getByRole("link", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Log" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View" })).not.toBeInTheDocument();
  });
});

describe("PARTIAL row", () => {
  it("renders both Review and Log", () => {
    renderRecent([makeWorkout({ status: "PARTIAL" })]);
    expect(screen.getByRole("link", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log" })).toBeInTheDocument();
  });
});

// ── R5: Sort order (performed before future-dated PLANNED) ───────────────────

describe("sort order", () => {
  it("renders performed workouts before future-dated PLANNED workouts", () => {
    // The page.tsx merge concatenates performedWorkouts first, then unperformedWorkouts.
    // Pass them pre-merged in the correct order and verify DOM order matches.
    renderRecent([
      makeWorkout({ id: "c1", status: "COMPLETED", sessionIntent: "push" }),
      makeWorkout({ id: "pl1", status: "PLANNED", sessionIntent: "pull" }),
    ]);

    const allLinks = screen.getAllByRole("link");
    const viewLink = screen.getByRole("link", { name: "View" });
    const logLink = screen.getByRole("link", { name: "Log" });

    expect(allLinks.indexOf(viewLink)).toBeLessThan(allLinks.indexOf(logLink));
  });
});
