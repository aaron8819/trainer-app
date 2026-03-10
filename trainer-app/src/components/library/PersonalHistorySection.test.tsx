import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalHistorySection } from "./PersonalHistorySection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PersonalHistorySection", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          sessions: [
            {
              date: "2026-03-08T00:00:00.000Z",
              sets: [{ setIndex: 0, reps: 8, load: 185, rpe: 8 }],
            },
          ],
          personalBests: {
            maxLoad: 225,
            maxReps: 10,
            maxVolume: 1800,
          },
          trend: "improving",
        }),
      })
    );
  });

  it("shows a weaker recent-trend label instead of strong improvement language", async () => {
    render(<PersonalHistorySection exerciseId="bench" />);

    await waitFor(() => {
      expect(screen.getByText("Recent top-set trend")).toBeInTheDocument();
    });

    expect(screen.getByText("Higher than earlier recent logs")).toBeInTheDocument();
    expect(screen.getByText("Best load: 225lb")).toBeInTheDocument();
    expect(screen.queryByText("Improving")).not.toBeInTheDocument();
    expect(screen.queryByText("Declining")).not.toBeInTheDocument();
    expect(screen.queryByText("Stable")).not.toBeInTheDocument();
  });
});
