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

  it("frames history as descriptive logs rather than next-session progression guidance", async () => {
    render(<PersonalHistorySection exerciseId="bench" />);

    await waitFor(() => {
      expect(screen.getByText("Recent logged trend")).toBeInTheDocument();
    });

    expect(screen.getByText("Trending above earlier recent logs")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Descriptive history only. Use the workout review for next-session progression guidance."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Recent logged best load: 225lb")).toBeInTheDocument();
    expect(screen.getByText("Recent logged best reps: 10")).toBeInTheDocument();
    expect(screen.queryByText("Improving")).not.toBeInTheDocument();
    expect(screen.queryByText("Declining")).not.toBeInTheDocument();
    expect(screen.queryByText("Stable")).not.toBeInTheDocument();
    expect(screen.queryByText(/next exposure/i)).not.toBeInTheDocument();
  });
});
