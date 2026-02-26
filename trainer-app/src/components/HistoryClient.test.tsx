import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HistoryClient, { type HistoryWorkoutItem, type MesocycleOption } from "./HistoryClient";

// ---------------------------------------------------------------------------
// Static mocks
// ---------------------------------------------------------------------------
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("./DeleteWorkoutButton", () => ({
  default: ({ workoutId, onDeleted }: { workoutId: string; onDeleted: () => void }) => (
    <button type="button" data-testid={`delete-${workoutId}`} onClick={onDeleted}>
      Delete
    </button>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeWorkout(overrides: Partial<HistoryWorkoutItem> = {}): HistoryWorkoutItem {
  return {
    id: "w1",
    scheduledDate: "2026-02-20T10:00:00.000Z",
    completedAt: null,
    status: "COMPLETED",
    selectionMode: "INTENT",
    sessionIntent: "PUSH",
    mesocycleId: null,
    mesocycleWeekSnapshot: null,
    mesocyclePhaseSnapshot: null,
    exerciseCount: 5,
    totalSetsLogged: 15,
    ...overrides,
  };
}

const NO_MESOCYCLES: MesocycleOption[] = [];

function makeFetchResponse(
  workouts: HistoryWorkoutItem[],
  nextCursor: string | null = null,
  totalCount = workouts.length
) {
  return {
    ok: true,
    json: async () => ({ workouts, nextCursor, totalCount }),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(makeFetchResponse([]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("HistoryClient", () => {
  // ── H1: initial render ────────────────────────────────────────────────────

  it("renders initial workouts without fetching on mount", () => {
    // Use a unique exercise count to distinguish the workout row from filter buttons
    const workouts = [makeWorkout({ id: "w1", sessionIntent: "PUSH", exerciseCount: 7 })];
    render(
      <HistoryClient
        initialWorkouts={workouts}
        initialNextCursor={null}
        initialTotalCount={1}
        mesocycles={NO_MESOCYCLES}
      />
    );
    // "7 exercises" only appears in a workout row, never in filter buttons
    expect(screen.getByText(/7 exercises/)).toBeInTheDocument();
    // Did NOT call fetch on mount
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── H2: filter resets list and re-fetches ─────────────────────────────────

  it("filter change resets workout list and re-fetches from API", async () => {
    const user = userEvent.setup();
    // Initial workout has 5 exercises; after filter the response has 8 exercises
    const initial = [makeWorkout({ id: "w-old", sessionIntent: "PUSH", exerciseCount: 5 })];
    const afterFilter = [makeWorkout({ id: "w-new", sessionIntent: "PULL", exerciseCount: 8 })];
    fetchMock.mockResolvedValue(makeFetchResponse(afterFilter, null, 1));

    render(
      <HistoryClient
        initialWorkouts={initial}
        initialNextCursor={null}
        initialTotalCount={1}
        mesocycles={NO_MESOCYCLES}
      />
    );

    // Verify initial workout is rendered
    expect(screen.getByText(/5 exercises/)).toBeInTheDocument();

    // Click "Pull" intent button
    await user.click(screen.getByRole("button", { name: "Pull" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain("intent=PULL");
    });

    await waitFor(() => {
      // Old workout (5 exercises) replaced by new workout (8 exercises)
      expect(screen.queryByText(/5 exercises/)).not.toBeInTheDocument();
      expect(screen.getByText(/8 exercises/)).toBeInTheDocument();
    });
  });

  // ── H3: load more appends ─────────────────────────────────────────────────

  it("Load more appends results to existing list", async () => {
    const user = userEvent.setup();
    // Distinguish workouts by unique exercise counts
    const page1 = [makeWorkout({ id: "w1", exerciseCount: 4 })];
    const page2 = [makeWorkout({ id: "w2", sessionIntent: "LEGS", exerciseCount: 6 })];
    fetchMock.mockResolvedValue(makeFetchResponse(page2, null, 2));

    render(
      <HistoryClient
        initialWorkouts={page1}
        initialNextCursor="2026-02-19T10:00:00.000Z"
        initialTotalCount={2}
        mesocycles={NO_MESOCYCLES}
      />
    );

    // "Load more" button visible
    const btn = screen.getByRole("button", { name: "Load more" });
    expect(btn).toBeInTheDocument();

    await user.click(btn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledOnce();
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain("cursor=");
    });

    await waitFor(() => {
      // Both page1 (4 exercises) and page2 (6 exercises) workouts are visible
      expect(screen.getByText(/4 exercises/)).toBeInTheDocument();
      expect(screen.getByText(/6 exercises/)).toBeInTheDocument();
    });
  });

  // ── H4: load more hidden when no more results ─────────────────────────────

  it("Load more button is hidden when nextCursor is null", () => {
    render(
      <HistoryClient
        initialWorkouts={[makeWorkout()]}
        initialNextCursor={null}
        initialTotalCount={1}
        mesocycles={NO_MESOCYCLES}
      />
    );
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  // ── H5: empty state ───────────────────────────────────────────────────────

  it("shows empty state when workouts list is empty and not loading", () => {
    render(
      <HistoryClient
        initialWorkouts={[]}
        initialNextCursor={null}
        initialTotalCount={0}
        mesocycles={NO_MESOCYCLES}
      />
    );
    expect(
      screen.getByText("No workouts match your filters.")
    ).toBeInTheDocument();
  });

  it("empty state provides a Reset filters button that re-fetches", async () => {
    const user = userEvent.setup();
    const afterReset = [makeWorkout({ exerciseCount: 9 })];
    fetchMock.mockResolvedValueOnce(makeFetchResponse([], null, 0)); // after Pull filter → empty
    fetchMock.mockResolvedValueOnce(makeFetchResponse(afterReset, null, 1)); // after reset

    render(
      <HistoryClient
        initialWorkouts={[makeWorkout({ exerciseCount: 5 })]}
        initialNextCursor={null}
        initialTotalCount={1}
        mesocycles={NO_MESOCYCLES}
      />
    );

    // Apply a filter to get into empty state
    await user.click(screen.getByRole("button", { name: "Pull" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    // After filter, empty state is shown — click reset
    await waitFor(() =>
      expect(screen.getByText("No workouts match your filters.")).toBeInTheDocument()
    );
    const resetBtn = screen.getAllByRole("button", { name: "Reset filters" })[0];
    await user.click(resetBtn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // After reset, the new workout data appears
    await waitFor(() => expect(screen.getByText(/9 exercises/)).toBeInTheDocument());
  });

  // ── H6: WorkoutRowActions per status ─────────────────────────────────────

  describe("WorkoutRowActions status variants", () => {
    it("COMPLETED row renders View link", () => {
      render(
        <HistoryClient
          initialWorkouts={[makeWorkout({ id: "w1", status: "COMPLETED" })]}
          initialNextCursor={null}
          initialTotalCount={1}
          mesocycles={NO_MESOCYCLES}
        />
      );
      expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", "/workout/w1");
    });

    it("SKIPPED row renders View link", () => {
      render(
        <HistoryClient
          initialWorkouts={[makeWorkout({ id: "w2", status: "SKIPPED" })]}
          initialNextCursor={null}
          initialTotalCount={1}
          mesocycles={NO_MESOCYCLES}
        />
      );
      expect(screen.getByRole("link", { name: "View" })).toHaveAttribute("href", "/workout/w2");
    });

    it("PLANNED row renders Log link", () => {
      render(
        <HistoryClient
          initialWorkouts={[makeWorkout({ id: "w3", status: "PLANNED" })]}
          initialNextCursor={null}
          initialTotalCount={1}
          mesocycles={NO_MESOCYCLES}
        />
      );
      expect(screen.getByRole("link", { name: "Log" })).toHaveAttribute("href", "/log/w3");
    });

    it("IN_PROGRESS row renders Continue link", () => {
      render(
        <HistoryClient
          initialWorkouts={[makeWorkout({ id: "w4", status: "IN_PROGRESS" })]}
          initialNextCursor={null}
          initialTotalCount={1}
          mesocycles={NO_MESOCYCLES}
        />
      );
      expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/log/w4");
    });

    it("PARTIAL row renders Review and Log links", () => {
      render(
        <HistoryClient
          initialWorkouts={[makeWorkout({ id: "w5", status: "PARTIAL" })]}
          initialNextCursor={null}
          initialTotalCount={1}
          mesocycles={NO_MESOCYCLES}
        />
      );
      expect(screen.getByRole("link", { name: "Review" })).toHaveAttribute("href", "/workout/w5");
      expect(screen.getByRole("link", { name: "Log" })).toHaveAttribute("href", "/log/w5");
    });
  });
});
