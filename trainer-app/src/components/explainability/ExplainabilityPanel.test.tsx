/**
 * ExplainabilityPanel - Component smoke tests
 *
 * Phase 4.6: Basic rendering tests for workout explanation panel
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ExplainabilityPanel } from "./ExplainabilityPanel";
import type { WorkoutExplanation } from "@/lib/engine/explainability";

describe("ExplainabilityPanel", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders session context", () => {
    const explanation: WorkoutExplanation = {
      sessionContext: {
        blockPhase: {
          blockType: "accumulation",
          weekInBlock: 1,
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
          weekInMesocycle: 1,
          volumeProgression: "Moderate",
          intensityProgression: "Low",
          nextMilestone: "Week 3: Peak volume",
        },
        narrative: "Starting accumulation phase",
      },
      coachMessages: [],
      exerciseRationales: new Map(),
      prescriptionRationales: new Map(),
    };

    render(<ExplainabilityPanel explanation={explanation} />);

    expect(screen.getByText("Session Context")).toBeInTheDocument();
    expect(screen.getByText("Starting accumulation phase")).toBeInTheDocument();
  });

  it("renders coach messages when present", () => {
    const explanation: WorkoutExplanation = {
      sessionContext: {
        blockPhase: {
          blockType: "deload",
          weekInBlock: 1,
          totalWeeksInBlock: 1,
          primaryGoal: "Recovery",
        },
        volumeStatus: {
          overallSummary: "Volume reduced",
          muscleStatuses: new Map(),
        },
        readinessStatus: {
          overall: "fatigued",
          signalAge: 0,
          adaptations: ["Reduced volume by 40%"],
        },
        progressionContext: {
          weekInMesocycle: 4,
          volumeProgression: "Deload",
          intensityProgression: "Low",
          nextMilestone: "Next week: New block",
        },
        narrative: "Recovery week",
      },
      coachMessages: [
        {
          type: "warning",
          priority: "high",
          message: "High fatigue detected",
        },
      ],
      exerciseRationales: new Map(),
      prescriptionRationales: new Map(),
    };

    render(<ExplainabilityPanel explanation={explanation} />);

    expect(screen.getByText("High fatigue detected")).toBeInTheDocument();
  });

  it("renders exercise rationales section when exercises present", () => {
    const explanation: WorkoutExplanation = {
      sessionContext: {
        blockPhase: {
          blockType: "accumulation",
          weekInBlock: 1,
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
          weekInMesocycle: 1,
          volumeProgression: "Moderate",
          intensityProgression: "Low",
          nextMilestone: "Week 3: Peak volume",
        },
        narrative: "Starting accumulation phase",
      },
      coachMessages: [],
      exerciseRationales: new Map([
        [
          "ex1",
          {
            exerciseId: "ex1",
            exerciseName: "Bench Press",
            volumeContribution: "4 sets for Chest",
            primaryReasons: ["Main lift for horizontal push"],
            selectionFactors: {},
            citations: [],
            alternatives: [],
          },
        ],
      ]),
      prescriptionRationales: new Map(),
    };

    render(<ExplainabilityPanel explanation={explanation} />);

    expect(screen.getByText("Exercise Selection Details")).toBeInTheDocument();
    expect(screen.getByText("Bench Press")).toBeInTheDocument();
  });

  it("renders empty state with no exercises", () => {
    const explanation: WorkoutExplanation = {
      sessionContext: {
        blockPhase: {
          blockType: "accumulation",
          weekInBlock: 1,
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
          weekInMesocycle: 1,
          volumeProgression: "Moderate",
          intensityProgression: "Low",
          nextMilestone: "Week 3: Peak volume",
        },
        narrative: "Starting accumulation phase",
      },
      coachMessages: [],
      exerciseRationales: new Map(),
      prescriptionRationales: new Map(),
    };

    render(<ExplainabilityPanel explanation={explanation} />);

    expect(screen.getByText("Session Context")).toBeInTheDocument();
    expect(screen.queryByText("Exercise Selection Details")).not.toBeInTheDocument();
  });
});
