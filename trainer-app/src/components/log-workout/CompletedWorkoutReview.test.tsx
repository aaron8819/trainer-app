import { cleanup, render, screen, within } from "@testing-library/react";
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
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
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
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
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
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
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

  it("labels runtime-added exercises explicitly in the completed review", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "Pec Deck",
            equipment: ["machine"],
            isRuntimeAdded: true,
            isMainLift: false,
            section: "accessory",
            sets: [
              {
                setIndex: 1,
                targetReps: 12,
                targetLoad: 80,
                targetRpe: 6.5,
                actualReps: 12,
                actualLoad: 80,
                actualRpe: 7,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Added exercise")).toBeInTheDocument();
  });

  it("renders the canonical session identity and slot id when provided", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 2"
        sessionTechnicalLabel="Slot ID: upper_b"
        performanceSummary={[]}
      />
    );

    expect(screen.getByText("Upper 2 | Slot ID: upper_b")).toBeInTheDocument();
  });

  it("separates planned, completed, skipped, and extra set counts in the summary header", () => {
    render(
      <CompletedWorkoutReview
        workoutId="workout-1"
        rpeAdherence={null}
        sessionIdentityLabel="Upper 1"
        sessionTechnicalLabel="Slot ID: upper_a"
        performanceSummary={[
          {
            exerciseId: "ex-1",
            name: "T-Bar Row",
            equipment: ["machine"],
            isMainLift: true,
            section: "main",
            sets: [
              {
                setIndex: 1,
                targetReps: 10,
                targetLoad: 100,
                targetRpe: 8,
                actualReps: 10,
                actualLoad: 100,
                actualRpe: 8,
                wasLogged: true,
                wasSkipped: false,
              },
              {
                setIndex: 2,
                targetReps: 10,
                targetLoad: 100,
                targetRpe: 8,
                actualReps: null,
                actualLoad: null,
                actualRpe: null,
                wasLogged: true,
                wasSkipped: true,
              },
            ],
          },
          {
            exerciseId: "ex-2",
            name: "Pec Deck",
            equipment: ["machine"],
            isRuntimeAdded: true,
            isMainLift: false,
            section: "accessory",
            sets: [
              {
                setIndex: 1,
                targetReps: 12,
                targetLoad: 80,
                targetRpe: 7,
                actualReps: 12,
                actualLoad: 80,
                actualRpe: 7,
                wasLogged: true,
                wasSkipped: false,
              },
              {
                setIndex: 2,
                targetReps: 12,
                targetLoad: 80,
                targetRpe: 7,
                actualReps: 12,
                actualLoad: 80,
                actualRpe: 7,
                wasLogged: true,
                wasSkipped: false,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Planned sets")).toBeInTheDocument();
    expect(screen.getByText("Completed sets")).toBeInTheDocument();
    expect(screen.getByText("Skipped sets")).toBeInTheDocument();
    expect(screen.getByText("Extra sets")).toBeInTheDocument();

    const plannedCard = screen.getByText("Planned sets").closest("div");
    const completedCard = screen.getByText("Completed sets").closest("div");
    const skippedCard = screen.getByText("Skipped sets").closest("div");
    const extraCard = screen.getByText("Extra sets").closest("div");

    expect(plannedCard).not.toBeNull();
    expect(completedCard).not.toBeNull();
    expect(skippedCard).not.toBeNull();
    expect(extraCard).not.toBeNull();

    expect(within(plannedCard as HTMLElement).getByText("2")).toBeInTheDocument();
    expect(within(completedCard as HTMLElement).getByText("3")).toBeInTheDocument();
    expect(within(skippedCard as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(within(extraCard as HTMLElement).getByText("2")).toBeInTheDocument();
  });
});
