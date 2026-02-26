import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExplainabilityPanel } from "./ExplainabilityPanel";
import type { WorkoutExplanation } from "@/lib/engine/explainability";

function makeExplanation(withDecisionLog: boolean): WorkoutExplanation {
  return {
    confidence: {
      level: "high",
      summary: "ok",
      missingSignals: [],
    },
    sessionContext: {
      blockPhase: {
        blockType: "accumulation",
        weekInBlock: 2,
        totalWeeksInBlock: 4,
        primaryGoal: "hypertrophy",
      },
      volumeStatus: {
        muscleStatuses: new Map(),
        overallSummary: "none",
      },
      readinessStatus: {
        overall: "fresh",
        signalAge: 0,
        availability: "recent",
        label: "Fresh",
        perMuscleFatigue: new Map(),
        adaptations: [],
      },
      progressionContext: {
        weekInMesocycle: 2,
        volumeProgression: "building",
        intensityProgression: "ramping",
        nextMilestone: "W3",
      },
      cycleSource: "computed",
      narrative: "n/a",
    },
    coachMessages: [],
    exerciseRationales: new Map([
      [
        "ex1",
        {
          exerciseName: "Bench Press",
          primaryReasons: ["reason"],
          selectionFactors: {
            deficitFill: { score: 1, explanation: "x" },
            rotationNovelty: { score: 0, explanation: "x" },
            sfrEfficiency: { score: 0, explanation: "x" },
            lengthenedPosition: { score: 0, explanation: "x" },
            sraAlignment: { score: 0, explanation: "x" },
            userPreference: { score: 0, explanation: "x" },
            movementNovelty: { score: 0, explanation: "x" },
          },
          citations: [],
          alternatives: [],
          volumeContribution: "3 sets",
        },
      ],
    ]),
    prescriptionRationales: new Map(),
    progressionReceipts: new Map([
      [
        "ex1",
        {
          lastPerformed: null,
          todayPrescription: null,
          delta: { load: null, loadPercent: null, reps: null, rpe: null },
          trigger: "insufficient_data",
          decisionLog: withDecisionLog ? ["Path 2 fired", "Confidence scale=0.70"] : [],
        },
      ],
    ]),
    filteredExercises: [],
    volumeCompliance: [],
  };
}

describe("ExplainabilityPanel progression logic rendering", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders progression decisionLog lines in the Evidence tab", () => {
    render(<ExplainabilityPanel explanation={makeExplanation(true)} />);
    expect(screen.getByText("Progression Logic")).toBeInTheDocument();
    expect(screen.getByText("Path 2 fired")).toBeInTheDocument();
    expect(screen.getByText("Confidence scale=0.70")).toBeInTheDocument();
  });

  it("hides progression logic section when decisionLog is absent", () => {
    render(<ExplainabilityPanel explanation={makeExplanation(false)} />);
    expect(screen.queryByText("Path 2 fired")).not.toBeInTheDocument();
  });
});
