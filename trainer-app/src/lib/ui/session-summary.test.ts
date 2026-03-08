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

    expect(summary.summary).toContain("lighter on purpose");
    expect(summary.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Deload", value: expect.stringContaining("30% less load and volume") }),
        expect.objectContaining({ label: "Volume held", value: expect.stringContaining("chest, front delts") }),
        expect.objectContaining({ label: "Readiness", value: expect.stringContaining("2 scaled down") }),
      ])
    );
  });
});
