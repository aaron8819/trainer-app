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
    isGapFill: false,
    isSupplementalDeficitSession: false,
    gapFillTargetMuscles: [],
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
    expect(screen.getByText(/Wk4/)).toBeInTheDocument();
  });
});

describe("gap-fill labels", () => {
  it("renders Gap Fill title, muscles subtext, and keeps supplemental badge absent", () => {
    renderRecent([
      makeWorkout({
        sessionIntent: "BODY_PART",
        isGapFill: true,
        gapFillTargetMuscles: ["front delts", "rear delts", "biceps"],
        sessionSnapshot: buildWorkoutSessionSnapshotSummary({
          week: 3,
          session: 4,
          phase: "ACCUMULATION",
        }),
      }),
    ]);

    expect(screen.getByText("Gap Fill")).toBeInTheDocument();
    expect(screen.getByText("Front Delts, Rear Delts, Biceps")).toBeInTheDocument();
    expect(screen.getByText(/Wk3/)).toBeInTheDocument();
    expect(screen.queryByText("Supplemental")).not.toBeInTheDocument();
  });
});

describe("supplemental labels", () => {
  it("renders a Supplemental badge for strict supplemental sessions", () => {
    renderRecent([
      makeWorkout({
        sessionIntent: "BODY_PART",
        isSupplementalDeficitSession: true,
      }),
    ]);

    expect(screen.getByText("Body Part")).toBeInTheDocument();
    expect(screen.getByText("Supplemental")).toBeInTheDocument();
  });

  it("does not render a Supplemental badge for normal body-part sessions", () => {
    renderRecent([
      makeWorkout({
        sessionIntent: "BODY_PART",
      }),
    ]);

    expect(screen.getByText("Body Part")).toBeInTheDocument();
    expect(screen.queryByText("Supplemental")).not.toBeInTheDocument();
  });
});

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

describe("sort order", () => {
  it("renders performed workouts before future-dated PLANNED workouts", () => {
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
