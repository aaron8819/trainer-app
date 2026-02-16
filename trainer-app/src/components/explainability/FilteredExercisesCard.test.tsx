/**
 * FilteredExercisesCard - Component tests
 *
 * Phase 2: Tests for filtered exercises explainability component
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FilteredExercisesCard } from "./FilteredExercisesCard";
import type { FilteredExerciseSummary } from "@/lib/engine/explainability";

describe("FilteredExercisesCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when filtered exercises array is empty", () => {
    const { container } = render(<FilteredExercisesCard filteredExercises={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("renders user avoided exercises with correct icon and message", () => {
    const filteredExercises: FilteredExerciseSummary[] = [
      {
        exerciseId: "ex1",
        exerciseName: "Incline Dumbbell Curl",
        reason: "user_avoided",
        userFriendlyMessage: "Avoided per your preferences",
      },
    ];

    render(<FilteredExercisesCard filteredExercises={filteredExercises} />);

    expect(screen.getByText("Filtered Exercises")).toBeInTheDocument();
    expect(screen.getByText("Your Preferences Honored")).toBeInTheDocument();
    expect(screen.getByText("Incline Dumbbell Curl")).toBeInTheDocument();
    expect(screen.getByText("(Avoided per your preferences)")).toBeInTheDocument();
  });

  it("renders pain conflict exercises with correct icon and message", () => {
    const filteredExercises: FilteredExerciseSummary[] = [
      {
        exerciseId: "ex1",
        exerciseName: "Bench Press",
        reason: "pain_conflict",
        userFriendlyMessage: "Excluded due to recent pain signals",
      },
    ];

    render(<FilteredExercisesCard filteredExercises={filteredExercises} />);

    expect(screen.getByText("Pain Conflicts")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("(Excluded due to recent pain signals)")).toBeInTheDocument();
  });

  it("renders equipment unavailable exercises with correct icon and message", () => {
    const filteredExercises: FilteredExerciseSummary[] = [
      {
        exerciseId: "ex1",
        exerciseName: "Cable Fly",
        reason: "equipment_unavailable",
        userFriendlyMessage: "Equipment not available",
      },
    ];

    render(<FilteredExercisesCard filteredExercises={filteredExercises} />);

    expect(screen.getByText("Equipment Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Cable Fly")).toBeInTheDocument();
    expect(screen.getByText("(Equipment not available)")).toBeInTheDocument();
  });

  it("groups exercises by rejection reason", () => {
    const filteredExercises: FilteredExerciseSummary[] = [
      {
        exerciseId: "ex1",
        exerciseName: "Bench Press",
        reason: "pain_conflict",
        userFriendlyMessage: "Excluded due to recent pain signals",
      },
      {
        exerciseId: "ex2",
        exerciseName: "Incline Curl",
        reason: "user_avoided",
        userFriendlyMessage: "Avoided per your preferences",
      },
      {
        exerciseId: "ex3",
        exerciseName: "Cable Fly",
        reason: "equipment_unavailable",
        userFriendlyMessage: "Equipment not available",
      },
    ];

    render(<FilteredExercisesCard filteredExercises={filteredExercises} />);

    // All three sections should be present
    expect(screen.getByText("Your Preferences Honored")).toBeInTheDocument();
    expect(screen.getByText("Pain Conflicts")).toBeInTheDocument();
    expect(screen.getByText("Equipment Unavailable")).toBeInTheDocument();

    // Each exercise should be shown in its respective section
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
    expect(screen.getByText("Incline Curl")).toBeInTheDocument();
    expect(screen.getByText("Cable Fly")).toBeInTheDocument();
  });

  it("handles multiple exercises in the same category", () => {
    const filteredExercises: FilteredExerciseSummary[] = [
      {
        exerciseId: "ex1",
        exerciseName: "Incline Curl",
        reason: "user_avoided",
        userFriendlyMessage: "Avoided per your preferences",
      },
      {
        exerciseId: "ex2",
        exerciseName: "Hammer Curl",
        reason: "user_avoided",
        userFriendlyMessage: "Avoided per your preferences",
      },
    ];

    render(<FilteredExercisesCard filteredExercises={filteredExercises} />);

    expect(screen.getByText("Your Preferences Honored")).toBeInTheDocument();
    expect(screen.getByText("Incline Curl")).toBeInTheDocument();
    expect(screen.getByText("Hammer Curl")).toBeInTheDocument();
  });

  it("handles other rejection reasons in 'Other Filters' section", () => {
    const filteredExercises: FilteredExerciseSummary[] = [
      {
        exerciseId: "ex1",
        exerciseName: "Some Exercise",
        reason: "contraindicated",
        userFriendlyMessage: "Contraindicated",
      },
    ];

    render(<FilteredExercisesCard filteredExercises={filteredExercises} />);

    expect(screen.getByText("Other Filters")).toBeInTheDocument();
    expect(screen.getByText("Some Exercise")).toBeInTheDocument();
    expect(screen.getByText("(Contraindicated)")).toBeInTheDocument();
  });

  it("renders introduction text", () => {
    const filteredExercises: FilteredExerciseSummary[] = [
      {
        exerciseId: "ex1",
        exerciseName: "Bench Press",
        reason: "pain_conflict",
        userFriendlyMessage: "Excluded due to recent pain signals",
      },
    ];

    render(<FilteredExercisesCard filteredExercises={filteredExercises} />);

    expect(
      screen.getByText(
        /The following exercises were excluded from this workout based on your constraints and preferences/
      )
    ).toBeInTheDocument();
  });
});
