import { describe, expect, it } from "vitest";
import { buildSessionSummaryModel } from "./session-summary";
import type { SessionContext } from "@/lib/engine/explainability";
import type { SessionDecisionReceipt } from "@/lib/evidence/types";

function makeContext(overrides?: Partial<SessionContext>): SessionContext {
  return {
    blockPhase: {
      blockType: "accumulation",
      weekInBlock: 2,
      totalWeeksInBlock: 4,
      primaryGoal: "hypertrophy",
    },
    volumeStatus: {
      muscleStatuses: new Map(),
      overallSummary: "on target",
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
      nextMilestone: "Deload in week 4",
    },
    cycleSource: "computed",
    narrative: "n/a",
    ...overrides,
  };
}

function makeReceipt(overrides?: Partial<SessionDecisionReceipt>): SessionDecisionReceipt {
  return {
    version: 1,
    cycleContext: {
      weekInMeso: 2,
      weekInBlock: 2,
      blockDurationWeeks: 4,
      mesocycleLength: 4,
      phase: "accumulation",
      blockType: "accumulation",
      isDeload: false,
      source: "computed",
    },
    lifecycleRirTarget: {
      min: 2,
      max: 3,
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
      signalAgeHours: 8,
      fatigueScoreOverall: 4,
      intensityScaling: {
        applied: false,
        exerciseIds: [],
        scaledUpCount: 0,
        scaledDownCount: 0,
      },
      rationale: undefined,
    },
    exceptions: [],
    ...overrides,
  };
}

describe("buildSessionSummaryModel", () => {
  it("builds a simple default summary from receipt-first data", () => {
    const summary = buildSessionSummaryModel({
      context: makeContext(),
      receipt: makeReceipt(),
      sessionIntent: "PULL",
      estimatedMinutes: 55,
    });

    expect(summary.title).toBe("Why today looks like this");
    expect(summary.summary).toContain("pull session");
    expect(summary.tags).toEqual(["Pull", "Accumulation week 2", "55 min"]);
    expect(summary.items.map((item) => item.label)).toEqual([
      "Today's goal",
      "Target effort",
      "Readiness",
    ]);
    expect(summary.items[1]?.value).toContain("2-3 reps in reserve");
    expect(summary.items[2]?.value).toContain("recent readiness signal");
  });

  it("renders gap-fill labels and snapshot week tag when canonical marker + INTENT + BODY_PART are present", () => {
    const summary = buildSessionSummaryModel({
      context: makeContext({
        blockPhase: {
          blockType: "accumulation",
          weekInBlock: 4,
          totalWeeksInBlock: 4,
          primaryGoal: "hypertrophy",
        },
        progressionContext: {
          weekInMesocycle: 4,
          volumeProgression: "building",
          intensityProgression: "ramping",
          nextMilestone: "Deload in week 5",
        },
      }),
      receipt: makeReceipt({
        cycleContext: {
          weekInMeso: 3,
          weekInBlock: 3,
          blockDurationWeeks: 5,
          mesocycleLength: 5,
          phase: "accumulation",
          blockType: "accumulation",
          isDeload: false,
          source: "computed",
        },
        targetMuscles: ["front delts", "rear delts", "biceps"],
        exceptions: [{ code: "optional_gap_fill", message: "Marked as optional gap-fill session." }],
      }),
      selectionMode: "INTENT",
      sessionIntent: "BODY_PART",
      displayWeek: 3,
      targetMuscles: ["front delts", "rear delts", "biceps"],
      estimatedMinutes: 42,
    });

    expect(summary.tags).toEqual(["Gap Fill", "Accumulation week 3", "42 min"]);
    expect(summary.summary).toContain("gap-fill session targets front delts, rear delts, biceps");
    expect(summary.items[0]?.value).toContain("Close gaps for front delts, rear delts, biceps");
  });

  it("prefers receipt block-week tags over mesocycle week displays when canonical context exists", () => {
    const summary = buildSessionSummaryModel({
      context: makeContext({
        blockPhase: {
          blockType: "intensification",
          weekInBlock: 1,
          totalWeeksInBlock: 2,
          primaryGoal: "hypertrophy",
        },
        progressionContext: {
          weekInMesocycle: 4,
          volumeProgression: "maintaining",
          intensityProgression: "ramping",
          nextMilestone: "Final intensification week next, then transition to next block",
        },
      }),
      receipt: makeReceipt({
        cycleContext: {
          weekInMeso: 4,
          weekInBlock: 1,
          blockDurationWeeks: 2,
          mesocycleLength: 5,
          phase: "intensification",
          blockType: "intensification",
          isDeload: false,
          source: "computed",
        },
      }),
      displayWeek: 4,
      sessionIntent: "PUSH",
    });

    expect(summary.tags).toContain("Intensification week 1");
    expect(summary.tags).not.toContain("Intensification week 4");
  });

  it("surfaces slot-aware identity in tags and detail items when a session slot is saved", () => {
    const summary = buildSessionSummaryModel({
      context: makeContext(),
      receipt: makeReceipt({
        sessionSlot: {
          slotId: "upper_b",
          intent: "upper",
          sequenceIndex: 2,
          sequenceLength: 4,
          source: "mesocycle_slot_sequence",
        },
      }),
      sessionIntent: "UPPER",
    });

    expect(summary.summary).toContain("upper 2 session");
    expect(summary.tags).toContain("Upper 2");
    expect(summary.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Session identity",
          value: "Second upper session in your current weekly order.",
        }),
      ])
    );
  });

  it("surfaces deload, soreness hold, and readiness scaling through the same summary", () => {
    const summary = buildSessionSummaryModel({
      context: makeContext(),
      receipt: makeReceipt({
        sorenessSuppressedMuscles: ["Chest", "Front Delts"],
        deloadDecision: {
          mode: "reactive",
          reason: ["Recovery markers stayed poor."],
          reductionPercent: 30,
          appliedTo: "both",
        },
        readiness: {
          wasAutoregulated: true,
          signalAgeHours: 2,
          fatigueScoreOverall: 7,
          intensityScaling: {
            applied: true,
            exerciseIds: ["a", "b"],
            scaledUpCount: 0,
            scaledDownCount: 2,
          },
          rationale: "Fatigue high",
        },
      }),
      sessionIntent: "PUSH",
    });

    expect(summary.summary).toContain("redundant accessory overlap is trimmed");
    expect(summary.tags).toContain("Deload");
    expect(summary.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "Today's goal",
        value: expect.stringContaining("stay far from failure"),
      }),
      expect.objectContaining({
        label: "Target effort",
        value: expect.stringContaining("leave 2-3 reps in reserve"),
      }),
      expect.objectContaining({
        label: "Target effort",
        value: expect.stringContaining("reduce the weight"),
      }),
      expect.objectContaining({
        label: "Structure",
        value: expect.stringContaining("overlapping accessory variants are trimmed first"),
      }),
      expect.objectContaining({
        label: "Deload",
        value: expect.stringContaining("Main lifts stay in"),
      }),
      expect.objectContaining({ label: "Volume held", value: expect.stringContaining("chest, front delts") }),
      expect.objectContaining({ label: "Readiness", value: expect.stringContaining("2 scaled down") }),
      expect.objectContaining({
        label: "Progression history",
        value: expect.stringContaining("Does not count toward progression history"),
      }),
    ]));
  });

  it("labels original-plan summaries when current saved structure drifted after generation", () => {
    const summary = buildSessionSummaryModel({
      context: makeContext(),
      receipt: makeReceipt(),
      sessionIntent: "PUSH",
      workoutStructureState: {
        version: 1,
        lastReconciledAt: "2026-03-05T10:00:00.000Z",
        currentExercises: [
          {
            exerciseId: "bench",
            orderIndex: 0,
            section: "MAIN",
            setCount: 3,
          },
          {
            exerciseId: "fly",
            orderIndex: 1,
            section: "ACCESSORY",
            setCount: 3,
          },
        ],
        reconciliation: {
          version: 1,
          comparisonState: "comparable",
          hasDrift: true,
          changedFields: ["exercise_added"],
          addedExerciseIds: ["fly"],
          removedExerciseIds: [],
          exercisesWithSetCountChanges: [],
          exercisesWithPrescriptionChanges: [],
          generatedSelectionMode: "INTENT",
          savedSelectionMode: "INTENT",
          generatedSessionIntent: "push",
          savedSessionIntent: "PUSH",
          generatedSemanticsKind: "advancing",
          savedSemanticsKind: "advancing",
        },
      },
    });

    expect(summary.title).toBe("Original plan context");
    expect(summary.tags).toContain("Modified");
    expect(summary.truthNote).toEqual(
      expect.objectContaining({
        label: "Current structure",
        tone: "caution",
      })
    );
    expect(summary.truthNote?.value).toContain("canonical saved workout");
  });
});
