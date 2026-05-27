import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MuscleOutcomeReviewPanel } from "./MuscleOutcomeReviewPanel";

describe("MuscleOutcomeReviewPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders MEV, preferred-target, and cap statuses without failure wording", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          review: {
            mesocycleId: "meso-1",
            week: 3,
            weekStart: "2026-03-16",
            rows: [
              {
                muscle: "Chest",
                targetSets: 12,
                actualEffectiveSets: 6,
                delta: -6,
                percentDelta: -0.5,
                status: "meaningfully_low",
                contributingExerciseCount: 0,
                topContributors: [],
              },
              {
                muscle: "Biceps",
                targetSets: 10,
                actualEffectiveSets: 8,
                delta: -2,
                percentDelta: -0.2,
                status: "slightly_low",
                contributingExerciseCount: 0,
                topContributors: [],
              },
              {
                muscle: "Lats",
                targetSets: 12,
                actualEffectiveSets: 15,
                delta: 3,
                percentDelta: 0.25,
                status: "slightly_high",
                contributingExerciseCount: 0,
                topContributors: [],
              },
            ],
          },
        }),
      })
    );

    render(<MuscleOutcomeReviewPanel />);

    expect(await screen.findByText("Below MEV")).toBeInTheDocument();
    expect(screen.getByText("Below preferred")).toBeInTheDocument();
    expect(screen.getByText("Near cap")).toBeInTheDocument();
    expect(screen.queryByText(/missed target|needs attention|under target/i)).toBeNull();
  });
});
