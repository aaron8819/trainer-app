import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RecentWorkouts from "./RecentWorkouts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./DeleteWorkoutButton", () => ({
  default: () => <button type="button">Delete</button>,
}));

const STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  PARTIAL: "Partial",
  COMPLETED: "Completed",
  SKIPPED: "Skipped",
};
const STATUS_CLASSES: Record<string, string> = {
  COMPLETED: "",
  IN_PROGRESS: "",
  PARTIAL: "",
  SKIPPED: "",
  PLANNED: "",
};

type WorkoutListItem = {
  id: string;
  scheduledDate: string;
  status: string;
  sessionIntent: string | null;
  exercisesCount: number;
};

function makeWorkout(overrides: Partial<WorkoutListItem> = {}): WorkoutListItem {
  return {
    id: "w1",
    scheduledDate: "2026-02-25T00:00:00.000Z",
    status: "COMPLETED",
    sessionIntent: "push",
    exercisesCount: 5,
    ...overrides,
  };
}

function renderRecent(workouts: WorkoutListItem[]) {
  return render(
    <RecentWorkouts
      recentWorkouts={workouts}
      statusLabels={STATUS_LABELS}
      statusClasses={STATUS_CLASSES}
    />
  );
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
