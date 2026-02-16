/**
 * PrescriptionDetails - Component smoke tests
 *
 * Phase 4.6: Basic rendering tests for prescription rationale display
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PrescriptionDetails } from "./PrescriptionDetails";
import type { PrescriptionRationale } from "@/lib/engine/explainability";

describe("PrescriptionDetails", () => {
  afterEach(() => {
    cleanup();
  });
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

  it("renders overall narrative", () => {
    render(<PrescriptionDetails prescription={mockPrescription} />);

    expect(screen.getByText("Prescription Rationale")).toBeInTheDocument();
    expect(screen.getByText("Moderate volume, moderate intensity for hypertrophy")).toBeInTheDocument();
  });

  it("renders sets section with all details", () => {
    render(<PrescriptionDetails prescription={mockPrescription} />);

    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Sets")).toBeInTheDocument();
    expect(screen.getByText("Optimal for chest in accumulation phase")).toBeInTheDocument();
    expect(screen.getByText("Week 2 of 3 in accumulation")).toBeInTheDocument();
  });

  it("renders reps section with all details", () => {
    render(<PrescriptionDetails prescription={mockPrescription} />);

    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("Reps")).toBeInTheDocument();
    expect(screen.getByText("Hypertrophy-focused rep range")).toBeInTheDocument();
    expect(screen.getByText("Exercise rep range: 6-12")).toBeInTheDocument();
  });

  it("renders load section with all details", () => {
    render(<PrescriptionDetails prescription={mockPrescription} />);

    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("Load")).toBeInTheDocument();
    expect(screen.getByText("Progressive overload from last session")).toBeInTheDocument();
    expect(screen.getByText("+2.5kg from previous workout")).toBeInTheDocument();
  });

  it("renders RIR section with all details", () => {
    render(<PrescriptionDetails prescription={mockPrescription} />);

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("RIR")).toBeInTheDocument();
    expect(screen.getByText("Leave room for progression")).toBeInTheDocument();
    expect(screen.getByText("Intermediate: 1-3 RIR recommended")).toBeInTheDocument();
  });

  it("renders rest period formatted as minutes:seconds", () => {
    render(<PrescriptionDetails prescription={mockPrescription} />);

    expect(screen.getByText("3:00")).toBeInTheDocument(); // 180 seconds = 3:00
    expect(screen.getByText("Rest")).toBeInTheDocument();
    expect(screen.getByText("Sufficient recovery for compound movement")).toBeInTheDocument();
  });

  it("formats rest period seconds correctly with padding", () => {
    const prescriptionWith90SecRest: PrescriptionRationale = {
      ...mockPrescription,
      rest: {
        seconds: 90,
        reason: "Short rest for accessories",
      },
    };

    render(<PrescriptionDetails prescription={prescriptionWith90SecRest} />);

    expect(screen.getByText("1:30")).toBeInTheDocument(); // 90 seconds = 1:30
  });

  it("handles optional fields gracefully when missing", () => {
    const minimalPrescription: PrescriptionRationale = {
      overallNarrative: "Basic prescription",
      sets: {
        count: 3,
        reason: "Standard volume",
      },
      reps: {
        target: 10,
        reason: "Standard rep range",
      },
      load: {
        load: 60,
        reason: "Moderate load",
      },
      rir: {
        target: 3,
        reason: "Conservative effort",
      },
      rest: {
        seconds: 120,
        reason: "Standard rest",
      },
    };

    render(<PrescriptionDetails prescription={minimalPrescription} />);

    expect(screen.getByText("Basic prescription")).toBeInTheDocument();
    expect(screen.getAllByText("3")).toHaveLength(2); // Sets and RIR both have count 3
    expect(screen.getByText("Standard volume")).toBeInTheDocument();
    // Optional fields should not be rendered
    expect(screen.queryByText(/Week.*accumulation/)).not.toBeInTheDocument();
  });
});
