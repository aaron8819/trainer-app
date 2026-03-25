import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompletedWorkoutReview } from "./CompletedWorkoutReview";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("CompletedWorkoutReview", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("colors in-range ranged-rep results as on target", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        totalSets={1}
        loggedCount={1}
        rpeAdherence={null}
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Lat Pulldown",
            equipment: ["cable"],
            isMainLift: false,
            section: "main",
            sets: [
              {
                setIndex: 1,
                targetReps: 10,
                targetRepRange: { min: 8, max: 12 },
                targetLoad: 40,
                targetRpe: 8,
                actualReps: 8,
                actualLoad: 40,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("8 reps | 40 lbs | RPE 8")).toHaveClass("text-emerald-700");
  });

  it("renders skipped sets distinctly from performed sets", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        totalSets={1}
        loggedCount={1}
        rpeAdherence={null}
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Lat Pulldown",
            equipment: ["cable"],
            isMainLift: false,
            section: "main",
            sets: [
              {
                setIndex: 1,
                targetReps: 10,
                targetRepRange: { min: 8, max: 12 },
                targetLoad: 40,
                targetRpe: 8,
                actualReps: null,
                actualLoad: null,
                actualRpe: null,
                wasLogged: true,
                wasSkipped: true,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Skipped")).toHaveClass("text-slate-500");
  });

  it("labels runtime-added sets explicitly from persisted provenance", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        totalSets={1}
        loggedCount={1}
        rpeAdherence={null}
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Lat Pulldown",
            equipment: ["cable"],
            isMainLift: false,
            section: "main",
            sets: [
              {
                setIndex: 3,
                isRuntimeAdded: true,
                targetReps: 12,
                targetLoad: 40,
                targetRpe: 8,
                actualReps: 12,
                actualLoad: 40,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Extra set")).toBeInTheDocument();
  });
});
