/**
 * SessionContextCard - Component smoke tests
 *
 * Phase 4.6: Basic rendering tests for session context display
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SessionContextCard } from "./SessionContextCard";
import type { SessionContext } from "@/lib/engine/explainability";

describe("SessionContextCard", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders block phase information", () => {
    const context: SessionContext = {
      blockPhase: {
        blockType: "accumulation",
        weekInBlock: 2,
        totalWeeksInBlock: 3,
        primaryGoal: "Build work capacity",
      },
      volumeStatus: {
        overallSummary: "Volume is optimal",
        muscleStatuses: new Map(),
      },
      readinessStatus: {
        overall: "fresh",
        signalAge: 0,
        adaptations: [],
      },
      progressionContext: {
        weekInMesocycle: 2,
        volumeProgression: "Moderate",
        intensityProgression: "Low",
        nextMilestone: "Week 3: Peak volume",
      },
      narrative: "Mid-accumulation phase",
    };

    render(<SessionContextCard context={context} />);

    expect(screen.getByText("Session Context")).toBeInTheDocument();
    expect(screen.getByText("Mid-accumulation phase")).toBeInTheDocument();
    expect(screen.getByText(/Accumulation/)).toBeInTheDocument();
    expect(screen.getByText(/Week 2 of 3/)).toBeInTheDocument();
  });

  it("renders readiness status with color coding", () => {
    const context: SessionContext = {
      blockPhase: {
        blockType: "deload",
        weekInBlock: 1,
        totalWeeksInBlock: 1,
        primaryGoal: "Recovery",
      },
      volumeStatus: {
        overallSummary: "Volume reduced for recovery",
        muscleStatuses: new Map(),
      },
      readinessStatus: {
        overall: "fatigued",
        signalAge: 2,
        adaptations: ["Reduced volume by 40%", "Extended rest periods"],
      },
      progressionContext: {
        weekInMesocycle: 4,
        volumeProgression: "Deload",
        intensityProgression: "Low",
        nextMilestone: "Next week: New block",
      },
      narrative: "Recovery week",
    };

    render(<SessionContextCard context={context} />);

    expect(screen.getByText(/Fatigued/)).toBeInTheDocument();
    expect(screen.getByText(/last check-in 2d ago/)).toBeInTheDocument();
    expect(screen.getByText(/Reduced volume by 40%/)).toBeInTheDocument();
    expect(screen.getByText(/Extended rest periods/)).toBeInTheDocument();
  });

  it("renders volume status for muscles", () => {
    const context: SessionContext = {
      blockPhase: {
        blockType: "accumulation",
        weekInBlock: 1,
        totalWeeksInBlock: 3,
        primaryGoal: "Build work capacity",
      },
      volumeStatus: {
        overallSummary: "Most muscles at optimal volume",
        muscleStatuses: new Map([
          [
            "Chest",
            {
              muscle: "Chest",
              status: "optimal",
              currentSets: 12,
              targetRange: { min: 10, max: 18 },
            },
          ],
          [
            "Quads",
            {
              muscle: "Quads",
              status: "below_mev",
              currentSets: 8,
              targetRange: { min: 10, max: 20 },
            },
          ],
        ]),
      },
      readinessStatus: {
        overall: "fresh",
        signalAge: 0,
        adaptations: [],
      },
      progressionContext: {
        weekInMesocycle: 1,
        volumeProgression: "Moderate",
        intensityProgression: "Low",
        nextMilestone: "Week 3: Peak volume",
      },
      narrative: "Starting new block",
    };

    render(<SessionContextCard context={context} />);

    expect(screen.getByText("Volume Status")).toBeInTheDocument();
    expect(screen.getByText("Most muscles at optimal volume")).toBeInTheDocument();
    expect(screen.getByText("Chest")).toBeInTheDocument();
    expect(screen.getByText("12 / 10-18 sets")).toBeInTheDocument();
    expect(screen.getByText("Quads")).toBeInTheDocument();
    expect(screen.getByText("8 / 10-20 sets")).toBeInTheDocument();
  });

  it("renders progression context", () => {
    const context: SessionContext = {
      blockPhase: {
        blockType: "intensification",
        weekInBlock: 1,
        totalWeeksInBlock: 2,
        primaryGoal: "Increase intensity",
      },
      volumeStatus: {
        overallSummary: "Volume slightly reduced",
        muscleStatuses: new Map(),
      },
      readinessStatus: {
        overall: "moderate",
        signalAge: 1,
        adaptations: [],
      },
      progressionContext: {
        weekInMesocycle: 5,
        volumeProgression: "Moderate decrease",
        intensityProgression: "Ramping up",
        nextMilestone: "Week 6: Realization phase",
      },
      narrative: "Transitioning to higher intensity",
    };

    render(<SessionContextCard context={context} />);

    expect(screen.getByText("Progression")).toBeInTheDocument();
    expect(screen.getByText(/Week 5/)).toBeInTheDocument();
    expect(screen.getByText(/Moderate decrease/)).toBeInTheDocument();
    expect(screen.getByText(/Ramping up/)).toBeInTheDocument();
    expect(screen.getByText("Week 6: Realization phase")).toBeInTheDocument();
  });
});
