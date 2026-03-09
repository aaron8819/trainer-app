import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkoutExplanation } from "./WorkoutExplanation";

vi.mock("./explainability", () => ({
  ExplainabilityPanel: () => <div>Explainability panel</div>,
}));

vi.mock("@/lib/ui/session-summary", () => ({
  buildSessionSummaryModel: vi.fn(() => ({
    title: "Summary",
    summary: "Summary",
    tags: [],
    items: [],
  })),
}));

vi.mock("@/lib/ui/workout-explanation-response", () => ({
  hydrateWorkoutExplanation: vi.fn((data) => data),
}));

describe("WorkoutExplanation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows user-facing loading copy while explanation is loading", () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => undefined) as Promise<Response>);

    render(<WorkoutExplanation workoutId="workout-1" />);

    expect(screen.getByText("Loading workout explanation...")).toBeInTheDocument();
  });

  it("shows user-facing error copy when explanation loading fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Service unavailable" }),
    } as Response);

    render(<WorkoutExplanation workoutId="workout-1" />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load workout explanation")).toBeInTheDocument();
      expect(screen.getByText("Service unavailable")).toBeInTheDocument();
    });
  });
});
