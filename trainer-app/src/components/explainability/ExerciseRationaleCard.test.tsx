/**
 * ExerciseRationaleCard - Component smoke tests
 *
 * Phase 4.6: Basic rendering tests for exercise rationale display
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExerciseRationaleCard } from "./ExerciseRationaleCard";
import type { ExerciseRationale, PrescriptionRationale } from "@/lib/engine/explainability";

describe("ExerciseRationaleCard", () => {
  afterEach(() => {
    cleanup();
  });
  const mockRationale: ExerciseRationale = {
    exerciseId: "ex1",
    exerciseName: "Bench Press",
    volumeContribution: "4 sets for Chest",
    primaryReasons: ["Main lift for horizontal push", "High SFR efficiency"],
    selectionFactors: {
      deficitFill: { score: 0.8, explanation: "Chest volume deficit" },
      sfrEfficiency: { score: 0.9, explanation: "High stimulus-to-fatigue ratio" },
    },
    citations: [
      {
        id: "maeo2023",
        authors: "Maeo et al.",
        year: 2023,
        finding: "Lengthened partials show superior hypertrophy",
        relevance: "Supports exercise selection for stretch position",
        url: "https://example.com/maeo2023",
      },
    ],
    alternatives: [
      {
        exerciseName: "Incline Bench Press",
        reason: "Similar movement pattern, different emphasis",
        similarity: 0.85,
      },
    ],
  };

  const mockPrescription: PrescriptionRationale = {
    overallNarrative: "Moderate volume, moderate intensity for hypertrophy",
    sets: {
      count: 4,
      reason: "Optimal for chest in accumulation phase",
      blockContext: "Week 2 of 3 in accumulation",
    },
    reps: {
      target: 8,
      reason: "Hypertrophy-focused rep range",
      exerciseConstraints: "Exercise rep range: 6-12",
    },
    load: {
      load: 80,
      reason: "Progressive overload from last session",
      progressionContext: "+2.5kg from previous workout",
    },
    rir: {
      target: 2,
      reason: "Leave room for progression",
      trainingAge: "Intermediate: 1-3 RIR recommended",
    },
    rest: {
      seconds: 180,
      reason: "Sufficient recovery for compound movement",
    },
  };

  it("renders collapsed state by default", () => {
    render(
      <ExerciseRationaleCard
        exerciseId="ex1"
        rationale={mockRationale}
        isExpanded={false}
        onToggle={() => {}}
      />
    );

    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("4 sets for Chest")).toBeInTheDocument();
    expect(screen.getByText("Show details")).toBeInTheDocument();
    expect(screen.queryByText("Why This Exercise?")).not.toBeInTheDocument();
  });

  it("renders expanded state with all details", () => {
    render(
      <ExerciseRationaleCard
        exerciseId="ex1"
        rationale={mockRationale}
        prescription={mockPrescription}
        isExpanded={true}
        onToggle={() => {}}
      />
    );

    expect(screen.getByText("Hide details")).toBeInTheDocument();
    expect(screen.getByText("Why This Exercise?")).toBeInTheDocument();
    expect(screen.getByText("Main lift for horizontal push")).toBeInTheDocument();
    expect(screen.getByText("High SFR efficiency")).toBeInTheDocument();
  });

  it("renders selection factors with scores", () => {
    render(
      <ExerciseRationaleCard
        exerciseId="ex1"
        rationale={mockRationale}
        isExpanded={true}
        onToggle={() => {}}
      />
    );

    expect(screen.getByText("Selection Factors")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument(); // deficitFill score
    expect(screen.getByText("90%")).toBeInTheDocument(); // sfrEfficiency score
    expect(screen.getByText("Chest volume deficit")).toBeInTheDocument();
  });

  it("renders knowledge base citations", () => {
    render(
      <ExerciseRationaleCard
        exerciseId="ex1"
        rationale={mockRationale}
        isExpanded={true}
        onToggle={() => {}}
      />
    );

    expect(screen.getByText("Research Support")).toBeInTheDocument();
    expect(screen.getByText("Maeo et al. (2023)")).toBeInTheDocument();
    expect(screen.getByText("Lengthened partials show superior hypertrophy")).toBeInTheDocument();
    expect(screen.getByText(/Supports exercise selection/)).toBeInTheDocument();
    expect(screen.getByText("View study →")).toBeInTheDocument();
  });

  it("renders prescription details when provided", () => {
    render(
      <ExerciseRationaleCard
        exerciseId="ex1"
        rationale={mockRationale}
        prescription={mockPrescription}
        isExpanded={true}
        onToggle={() => {}}
      />
    );

    expect(screen.getByText("Prescription Rationale")).toBeInTheDocument();
    expect(screen.getByText("Moderate volume, moderate intensity for hypertrophy")).toBeInTheDocument();
  });

  it("renders alternatives section", () => {
    render(
      <ExerciseRationaleCard
        exerciseId="ex1"
        rationale={mockRationale}
        isExpanded={true}
        onToggle={() => {}}
      />
    );

    expect(screen.getByText("Alternative Exercises")).toBeInTheDocument();
    expect(screen.getByText("Incline Bench Press")).toBeInTheDocument();
    expect(screen.getByText("Similar movement pattern, different emphasis")).toBeInTheDocument();
    expect(screen.getByText("85% similar")).toBeInTheDocument();
  });

  it("calls onToggle when header is clicked", async () => {
    const user = userEvent.setup();
    let toggled = false;
    const handleToggle = () => {
      toggled = true;
    };

    render(
      <ExerciseRationaleCard
        exerciseId="ex1"
        rationale={mockRationale}
        isExpanded={false}
        onToggle={handleToggle}
      />
    );

    const button = screen.getByRole("button");
    await user.click(button);

    expect(toggled).toBe(true);
  });

  it("skips rendering selection factors with zero score", () => {
    const rationaleWithZeroScore: ExerciseRationale = {
      ...mockRationale,
      selectionFactors: {
        deficitFill: { score: 0, explanation: "No deficit" },
        sfrEfficiency: { score: 0.9, explanation: "High SFR" },
      },
    };

    render(
      <ExerciseRationaleCard
        exerciseId="ex1"
        rationale={rationaleWithZeroScore}
        isExpanded={true}
        onToggle={() => {}}
      />
    );

    expect(screen.queryByText("No deficit")).not.toBeInTheDocument();
    expect(screen.getByText("High SFR")).toBeInTheDocument();
  });
});
