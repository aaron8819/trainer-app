import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuscleRecoveryPanel } from "./MuscleRecoveryPanel";

function makeFetchResponse() {
  return {
    ok: true,
    json: async () => ({
      muscles: [
        {
          name: "Chest",
          recoveryPercent: 38,
          isRecovered: false,
          lastTrainedHoursAgo: 18,
          sraWindowHours: 48,
          timeline: [
            { date: "2026-03-02", effectiveSets: 0, intensityBand: 0 },
            { date: "2026-03-03", effectiveSets: 1.2, intensityBand: 2 },
            { date: "2026-03-04", effectiveSets: 0, intensityBand: 0 },
            { date: "2026-03-05", effectiveSets: 0, intensityBand: 0 },
            { date: "2026-03-06", effectiveSets: 0.6, intensityBand: 1 },
            { date: "2026-03-07", effectiveSets: 0, intensityBand: 0 },
            { date: "2026-03-08", effectiveSets: 0, intensityBand: 0 },
          ],
        },
        {
          name: "Lats",
          recoveryPercent: 82,
          isRecovered: false,
          lastTrainedHoursAgo: 40,
          sraWindowHours: 48,
          timeline: [
            { date: "2026-03-02", effectiveSets: 0, intensityBand: 0 },
            { date: "2026-03-03", effectiveSets: 0, intensityBand: 0 },
            { date: "2026-03-04", effectiveSets: 0, intensityBand: 0 },
            { date: "2026-03-05", effectiveSets: 2.8, intensityBand: 3 },
            { date: "2026-03-06", effectiveSets: 0, intensityBand: 0 },
            { date: "2026-03-07", effectiveSets: 0, intensityBand: 0 },
            { date: "2026-03-08", effectiveSets: 0, intensityBand: 0 },
          ],
        },
      ],
    }),
  } as Response;
}

describe("MuscleRecoveryPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFetchResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("renders clarified analytics copy without ready wording", async () => {
    render(<MuscleRecoveryPanel />);

    await screen.findByText(/Percent shows how much of a muscle's SRA window has elapsed/i);

    expect(
      screen.getByText(/It is not a training prescription, a safety signal, or the same thing as dashboard opportunity/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/ready/i)).not.toBeInTheDocument();
  });

  it("renders grouped muscle rows and timeline buckets in oldest-to-newest order", async () => {
    render(<MuscleRecoveryPanel />);

    await waitFor(() => {
      expect(screen.getByText("Push")).toBeInTheDocument();
      expect(screen.getByText("Pull")).toBeInTheDocument();
      expect(screen.getByText("38%")).toBeInTheDocument();
    });

    const chestCells = [
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ].map((date) => screen.getByTestId(`timeline-cell-Chest-${date}`));

    expect(chestCells).toHaveLength(7);
    expect(chestCells[0]).toHaveAttribute(
      "aria-label",
      "Chest stimulus on 2026-03-02: 0 effective sets"
    );
    expect(chestCells[1]).toHaveAttribute(
      "aria-label",
      "Chest stimulus on 2026-03-03: 1.2 effective sets"
    );
    expect(chestCells[4]).toHaveAttribute(
      "aria-label",
      "Chest stimulus on 2026-03-06: 0.6 effective sets"
    );
  });
});
