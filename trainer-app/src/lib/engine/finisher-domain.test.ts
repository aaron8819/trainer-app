import { describe, expect, it } from "vitest";
import {
  deriveTimedFinisherDurationSeconds,
  projectFinisherTimer,
  recommendFinisher,
  resolveTimerAfterSkippedStep,
  type FinisherRecommendationCandidate,
  type TimedFinisherStep,
} from "./finisher-domain";

const base = new Date("2026-07-28T12:00:00.000Z");
const at = (seconds: number) => new Date(base.getTime() + seconds * 1000);
const steps: TimedFinisherStep[] = [
  { id: "step-1", orderIndex: 0, workSeconds: 40, recoverySeconds: 20 },
  { id: "step-2", orderIndex: 1, workSeconds: 40, recoverySeconds: 20 },
];

describe("timed finisher duration", () => {
  it("derives Core Stability 10 as exactly ten minutes with final recovery", () => {
    expect(
      deriveTimedFinisherDurationSeconds({
        steps: Array.from({ length: 10 }, (_, orderIndex) => ({
          id: `step-${orderIndex}`,
          orderIndex,
          workSeconds: 40,
          recoverySeconds: 20,
        })),
        includesFinalRecovery: true,
      })
    ).toBe(600);
  });

  it("excludes only the final recovery when configured", () => {
    expect(
      deriveTimedFinisherDurationSeconds({
        steps,
        includesFinalRecovery: false,
      })
    ).toBe(100);
  });
});

describe("timestamp-derived timer projection", () => {
  it("advances across every elapsed segment without replaying backgrounded intervals", () => {
    const projection = projectFinisherTimer({
      timer: {
        state: "SELECTED",
        timerSegment: "PREPARATION",
        currentStepIndex: 0,
        segmentStartedAt: at(0),
        segmentEndsAt: at(10),
        pausedAt: null,
        pausedRemainingMs: null,
        startedAt: null,
      },
      steps,
      includesFinalRecovery: false,
      now: at(75),
    });

    expect(projection.state).toBe("IN_PROGRESS");
    expect(projection.timerSegment).toBe("WORK");
    expect(projection.currentStepIndex).toBe(1);
    expect(projection.segmentStartedAt).toEqual(at(70));
    expect(projection.segmentEndsAt).toEqual(at(110));
    expect(projection.startedAt).toEqual(at(10));
    expect(projection.completedSteps).toEqual([
      { stepIndex: 0, resolvedAt: at(50) },
    ]);
    expect(projection.startedSteps).toEqual([
      { stepIndex: 0, startedAt: at(10) },
      { stepIndex: 1, startedAt: at(70) },
    ]);
  });

  it("completes only after an explicitly included final recovery", () => {
    const duringRecovery = projectFinisherTimer({
      timer: {
        state: "IN_PROGRESS",
        timerSegment: "WORK",
        currentStepIndex: 0,
        segmentStartedAt: at(0),
        segmentEndsAt: at(40),
        pausedAt: null,
        pausedRemainingMs: null,
        startedAt: at(0),
      },
      steps: [steps[0]!],
      includesFinalRecovery: true,
      now: at(50),
    });
    expect(duringRecovery.timerSegment).toBe("RECOVERY");
    expect(duringRecovery.state).toBe("IN_PROGRESS");
    expect(duringRecovery.segmentEndsAt).toEqual(at(60));

    const completed = projectFinisherTimer({
      timer: duringRecovery,
      steps: [steps[0]!],
      includesFinalRecovery: true,
      now: at(61),
    });
    expect(completed.state).toBe("COMPLETED");
    expect(completed.timerSegment).toBe("FINISHED");
    expect(completed.completedAt).toEqual(at(60));
  });

  it("freezes a paused segment regardless of wall-clock time", () => {
    const projection = projectFinisherTimer({
      timer: {
        state: "IN_PROGRESS",
        timerSegment: "WORK",
        currentStepIndex: 0,
        segmentStartedAt: at(0),
        segmentEndsAt: null,
        pausedAt: at(15),
        pausedRemainingMs: 25_000,
        startedAt: at(0),
      },
      steps,
      includesFinalRecovery: true,
      now: at(500),
    });
    expect(projection.currentStepIndex).toBe(0);
    expect(projection.completedSteps).toEqual([]);
    expect(projection.pausedRemainingMs).toBe(25_000);
  });

  it("skips directly to the next work interval with no recovery", () => {
    expect(
      resolveTimerAfterSkippedStep({
        steps,
        currentStepIndex: 0,
        now: at(12),
      })
    ).toEqual({
      completed: false,
      currentStepIndex: 1,
      timerSegment: "WORK",
      segmentEndsAt: at(52),
    });
  });
});

const routine = (
  id: string,
  overrides: Partial<FinisherRecommendationCandidate> = {}
): FinisherRecommendationCandidate => ({
  id,
  name: id,
  category: "CORE",
  fatigueCost: "LOW",
  impactLevel: "LOW",
  bodyRegions: ["core"],
  limitationTags: [],
  equipmentRequirements: ["BODYWEIGHT"],
  ...overrides,
});

describe("deterministic finisher recommendation", () => {
  it("fails closed when an active limitation is unrecognized", () => {
    const result = recommendFinisher({
      routines: [routine("safe")],
      activeLimitations: ["unmapped area"],
      lowerBodyDemandingWorkout: false,
      recentlyPerformedRoutineVersionIds: [],
      availableEquipment: null,
    });
    expect(result.recommendation).toBeNull();
    expect(result.blockedReason).toMatch(/could not be matched safely/i);
  });

  it("excludes known conflicts and unavailable equipment", () => {
    const result = recommendFinisher({
      routines: [
        routine("shoulder-conflict", { limitationTags: ["shoulder"] }),
        routine("cable-only", { equipmentRequirements: ["CABLE"] }),
        routine("eligible"),
      ],
      activeLimitations: ["Shoulders"],
      lowerBodyDemandingWorkout: false,
      recentlyPerformedRoutineVersionIds: [],
      availableEquipment: ["BODYWEIGHT"],
    });
    expect(result.recommendation?.routineVersionId).toBe("eligible");
  });

  it("down-ranks demanding leg work after lower body and recent routines", () => {
    const result = recommendFinisher({
      routines: [
        routine("recent"),
        routine("leg-intensive", {
          category: "CONDITIONING",
          fatigueCost: "HIGH",
          impactLevel: "HIGH",
          bodyRegions: ["legs"],
        }),
        routine("fresh"),
      ],
      activeLimitations: [],
      lowerBodyDemandingWorkout: true,
      recentlyPerformedRoutineVersionIds: ["recent"],
      availableEquipment: null,
    });
    expect(result.recommendation?.routineVersionId).toBe("fresh");
    expect(result.recommendation?.reason).toMatch(/avoids.*lower-body/i);
  });

  it("uses stable name and id ordering for tied candidates", () => {
    const result = recommendFinisher({
      routines: [routine("b"), routine("a")],
      activeLimitations: [],
      lowerBodyDemandingWorkout: false,
      recentlyPerformedRoutineVersionIds: [],
      availableEquipment: null,
    });
    expect(result.recommendation?.routineVersionId).toBe("a");
  });
});
