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
        ok: true,
        json: async () => ({
          exercise: { id: "bench", name: "Bench Press", equipment: ["barbell"] },
          comparison: {
            scope: "exact_exercise",
            loadConvention: "recorded_external_load",
            note: "Compared only with this exact exercise.",
          },
          lastExposure: {
            workoutId: "workout-1",
            date: "2026-03-08T00:00:00.000Z",
            workoutStatus: "PARTIAL",
            completedSetCount: 2,
            skippedSetCount: 1,
            unloggedSetCount: 0,
            hasSessionLocalChanges: false,
            representativeSet: {
              setIndex: 1,
              reps: 8,
              load: 185,
              rpe: 8,
              completedAt: "2026-03-08T00:00:00.000Z",
              isRuntimeAdded: false,
              basis: "best_estimated_strength",
            },
            sets: [
              { setIndex: 1, reps: 8, load: 185, rpe: 8, completedAt: "2026-03-08T00:00:00.000Z", isRuntimeAdded: false },
              { setIndex: 2, reps: 7, load: 185, rpe: 8.5, completedAt: "2026-03-08T00:05:00.000Z", isRuntimeAdded: false },
            ],
          },
          recentExposures: [
            {
              workoutId: "workout-1",
              date: "2026-03-08T00:00:00.000Z",
              representativeSet: { reps: 8, load: 185, rpe: 8 },
            },
            {
              workoutId: "workout-0",
              date: "2026-03-01T00:00:00.000Z",
              representativeSet: { reps: 8, load: 180, rpe: 8 },
            },
          ],
          records: {
            bestEstimatedStrength: {
              date: "2026-03-08T00:00:00.000Z",
              load: 185,
              reps: 8,
              rpe: 8,
              estimatedOneRepMax: 234.3,
            },
            heaviestCompletedLoad: {
              date: "2026-03-08T00:00:00.000Z",
              load: 195,
              reps: 5,
              rpe: 9,
            },
            highestSessionVolume: {
              date: "2026-03-08T00:00:00.000Z",
              volume: 2867,
              completedSetCount: 2,
            },
          },
        }),
      })
    );
  });

  it("shows exact-exercise performed history, distinct records, and a transparent trend basis", async () => {
    render(<PersonalHistorySection exerciseId="bench" />);

    await waitFor(() => {
      expect(screen.getByText("Last exposure")).toBeInTheDocument();
    });

    expect(screen.getByText("Compared only with this exact exercise.")).toBeInTheDocument();
    expect(screen.getByText("Equipment: barbell")).toBeInTheDocument();
    expect(screen.getByText("Best estimated strength")).toBeInTheDocument();
    expect(screen.getByText("Heaviest completed load")).toBeInTheDocument();
    expect(screen.getByText("Highest completed session volume")).toBeInTheDocument();
    expect(screen.getByText(/Workout finished partial · 1 skipped set/)).toBeInTheDocument();
    expect(screen.getByText("185 lb × 8 · RPE 8 → 180 lb × 8 · RPE 8")).toBeInTheDocument();
    expect(screen.getByText(/not a progression decision/)).toBeInTheDocument();
  });

  it("keeps workout logging usable when history loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<PersonalHistorySection exerciseId="bench" />);

    expect(
      await screen.findByText(
        "Exercise history could not be loaded. Your workout is still safe to continue."
      )
    ).toBeInTheDocument();
  });
});
