import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ExplainabilityPanel } from "./ExplainabilityPanel";
import type { WorkoutExplanation } from "@/lib/engine/explainability";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";
import type { SessionSummaryModel } from "@/lib/ui/session-summary";

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
        sorenessSuppressedMuscles: [],
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
    nextExposureDecisions: new Map([
      [
        "ex1",
        {
          action: "hold",
          summary: "Next exposure: hold load for now.",
          reason: "Median reps stayed below the top of the band, so keep building reps before adding load.",
          anchorLoad: 200,
          repRange: { min: 8, max: 10 },
          modalRpe: 8,
          medianReps: 8,
        },
      ],
    ]),
    filteredExercises: [],
    volumeCompliance: [],
  };
}

const summary: SessionSummaryModel = {
  title: "Why today looks like this",
  summary: "This pull session is set up to build workload without pushing to failure.",
  tags: ["Pull", "Accumulation week 2"],
  items: [
    { label: "Today's goal", value: "Build pull work this week." },
    { label: "Target effort", value: "Leave 2-3 reps in reserve on work sets." },
    { label: "Readiness", value: "Readiness looked normal enough to keep the planned targets in place." },
  ],
};

const receipt: SessionDecisionReceipt = {
  version: 1,
  cycleContext: {
    weekInMeso: 2,
    weekInBlock: 2,
    phase: "accumulation",
    blockType: "accumulation",
    isDeload: false,
    source: "computed",
  },
  lifecycleVolume: {
    targets: { Chest: 12 },
    source: "lifecycle",
  },
  sorenessSuppressedMuscles: [],
  deloadDecision: {
    mode: "none",
    reason: [],
    reductionPercent: 0,
    appliedTo: "none",
  },
  readiness: {
    wasAutoregulated: false,
    signalAgeHours: null,
    fatigueScoreOverall: null,
    intensityScaling: {
      applied: false,
      exerciseIds: [],
      scaledUpCount: 0,
      scaledDownCount: 0,
    },
  },
  plannerDiagnostics: {
    muscles: {
      Chest: {
        weeklyTarget: 12,
        performedEffectiveVolumeBeforeSession: 4,
        plannedEffectiveVolumeAfterRoleBudgeting: 3,
        projectedEffectiveVolumeAfterRoleBudgeting: 7,
        deficitAfterRoleBudgeting: 5,
        plannedEffectiveVolumeAfterClosure: 5,
        projectedEffectiveVolumeAfterClosure: 9,
        finalRemainingDeficit: 3,
      },
    },
    exercises: {
      ex1: {
        exerciseId: "ex1",
        exerciseName: "Bench Press",
        assignedSetCount: 5,
        stimulusVector: { Chest: 1, Triceps: 0.35 },
        anchorUsed: { kind: "muscle", muscle: "chest" },
        anchorBudgetDecision: {
          weeklyTarget: 12,
          performedEffectiveVolumeBeforeSession: 4,
          plannedEffectiveVolumeBeforeAssignment: 3,
          reservedEffectiveVolumeForRemainingRoleFixtures: 1,
          anchorRemainingBeforeAssignment: 4,
          anchorContributionPerSet: 1,
          desiredSetTarget: 5,
          anchorConstrainedContinuousSetTarget: 4,
        },
        overshootAdjustmentsApplied: {
          initialSetTarget: 5,
          finalSetTarget: 5,
          reductionsApplied: 0,
          limitingMuscles: ["Triceps"],
        },
        isRoleFixture: true,
        isClosureAddition: false,
        isSetExpandedCarryover: true,
        closureSetDelta: 1,
      },
    },
    closure: {
      actions: [
        {
          exerciseId: "ex1",
          exerciseName: "Bench Press",
          kind: "expand",
          setDelta: 1,
          deficitReduction: 1,
          collateralOvershoot: 0,
          fatigueCost: 4,
          score: 95,
        },
      ],
      firstIterationCandidates: [
        {
          exerciseId: "ex1",
          exerciseName: "Bench Press",
          kind: "expand",
          setDelta: 1,
          dominantDeficitMuscleId: "chest",
          dominantDeficitRemaining: 5,
          dominantDeficitContribution: 1,
          decision: "selected",
          score: 95,
        },
        {
          exerciseId: "ex2",
          exerciseName: "Machine Lateral Raise",
          kind: "add",
          setDelta: 4,
          dominantDeficitMuscleId: "chest",
          dominantDeficitRemaining: 5,
          dominantDeficitContribution: 0,
          decision: "rejected",
          score: null,
          rejectionReason: "movement_pattern_cap",
        },
      ],
    },
  },
  exceptions: [],
};

describe("ExplainabilityPanel progression logic rendering", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders progression decisionLog lines in the Evidence tab", () => {
    render(<ExplainabilityPanel explanation={makeExplanation(true)} summary={summary} />);
    expect(screen.getByText("Today's prescription trace")).toBeInTheDocument();
    expect(screen.getByText("Path 2 fired")).toBeInTheDocument();
    expect(screen.getByText("Confidence scale=0.70")).toBeInTheDocument();
  });

  it("hides progression logic section when decisionLog is absent", () => {
    render(<ExplainabilityPanel explanation={makeExplanation(false)} summary={summary} />);
    expect(screen.queryByText("Path 2 fired")).not.toBeInTheDocument();
  });

  it("shows simplified exercise detail labels instead of engine jargon", async () => {
    const user = userEvent.setup();
    render(<ExplainabilityPanel explanation={makeExplanation(true)} summary={summary} />);

    await user.click(screen.getByRole("button", { name: "Exercise drill-down" }));
    await user.click(screen.getByRole("button", { name: /open drill-down/i }));

    expect(screen.getByText("Next exposure")).toBeInTheDocument();
    expect(screen.getByText("Next exposure: hold load for now.")).toBeInTheDocument();
    expect(screen.getByText("Today's target context")).toBeInTheDocument();
    expect(screen.getByText("Why this lift stayed in")).toBeInTheDocument();
    expect(screen.getByText("Top factors")).toBeInTheDocument();
    expect(screen.queryByText("Selection Factors")).not.toBeInTheDocument();
    expect(screen.queryByText("Deficit Fill")).not.toBeInTheDocument();
    expect(screen.getByText("Volume need")).toBeInTheDocument();
  });

  it("surfaces missing signals as a scan-friendly list", () => {
    render(
      <ExplainabilityPanel
        explanation={{
          ...makeExplanation(true),
          confidence: {
            level: "low",
            summary: "Several inputs are missing, so this audit can only explain part of the session with confidence.",
            missingSignals: ["same-day readiness check-in", "stored exercise selection reasons"],
          },
        }}
        summary={summary}
      />
    );

    expect(screen.getByText("Missing or weak signals")).toBeInTheDocument();
    expect(screen.getByText(/same-day readiness check-in/)).toBeInTheDocument();
    expect(screen.getByText(/stored exercise selection reasons/)).toBeInTheDocument();
  });

  it("renders planner diagnostics from the canonical receipt", () => {
    render(
      <ExplainabilityPanel
        explanation={makeExplanation(true)}
        summary={summary}
        sessionDecisionReceipt={receipt}
      />
    );

    expect(screen.getByText("Planner diagnostics")).toBeInTheDocument();
    expect(screen.getByText(/post-role planned 3.0/)).toBeInTheDocument();
    expect(screen.getByText(/set-expanded carryover \(\+1\)/)).toBeInTheDocument();
    expect(screen.getByText(/stimulus vector: Chest 1.00 \| Triceps 0.35/)).toBeInTheDocument();
    expect(screen.getByText(/anchor budget:/)).toBeInTheDocument();
    expect(screen.getByText(/overshoot adjustments:/)).toBeInTheDocument();
    expect(screen.getByText(/limiting muscles Triceps/)).toBeInTheDocument();
    expect(screen.getByText("Closure candidate trace")).toBeInTheDocument();
    expect(screen.getAllByText("Bench Press").length).toBeGreaterThan(0);
    expect(screen.getByText(/filtered movement_pattern_cap/)).toBeInTheDocument();
  });
});
