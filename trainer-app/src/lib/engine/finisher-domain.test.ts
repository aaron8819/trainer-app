import { describe, expect, it } from "vitest";
import {
  deriveTimedFinisherDurationSeconds,
  projectFinisherTimer,
  recommendFinisher,
  resolveFinisherOutcome,
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

describe("finisher terminal outcomes", () => {
  it("distinguishes completed, mixed, all-skipped, retained-work, and dismissed outcomes", () => {
    expect(
      resolveFinisherOutcome({
        stepStatuses: ["COMPLETED", "COMPLETED"],
        activeWorkMs: 80_000,
        endedEarly: false,
      })
    ).toBe("COMPLETED");
    expect(
      resolveFinisherOutcome({
        stepStatuses: ["COMPLETED", "SKIPPED"],
        activeWorkMs: 40_000,
        endedEarly: false,
      })
    ).toBe("PARTIAL");
    expect(
      resolveFinisherOutcome({
        stepStatuses: ["SKIPPED", "SKIPPED"],
        activeWorkMs: 0,
        endedEarly: false,
      })
    ).toBe("SKIPPED");
    expect(
      resolveFinisherOutcome({
        stepStatuses: ["PARTIAL", "SKIPPED"],
        activeWorkMs: 1,
        endedEarly: false,
      })
    ).toBe("PARTIAL");
    expect(
      resolveFinisherOutcome({
        stepStatuses: ["PENDING", "PENDING"],
        activeWorkMs: 0,
        endedEarly: true,
      })
    ).toBe("DISMISSED");
  });
});

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
    expect(projection.activeSlices).toEqual([
      { segment: "PREPARATION", stepIndex: 0, activeMs: 10_000 },
      { segment: "WORK", stepIndex: 0, activeMs: 40_000 },
      { segment: "RECOVERY", stepIndex: 0, activeMs: 20_000 },
    ]);
    expect(projection.syncRequired).toBe(true);
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

  it("uses exact inclusive segment boundaries", () => {
    const timer = {
      state: "IN_PROGRESS" as const,
      timerSegment: "WORK" as const,
      currentStepIndex: 0,
      segmentStartedAt: at(0),
      segmentEndsAt: at(40),
      pausedAt: null,
      pausedRemainingMs: null,
      startedAt: at(0),
    };
    const before = projectFinisherTimer({
      timer,
      steps: [steps[0]!],
      includesFinalRecovery: true,
      now: new Date(at(40).getTime() - 1),
    });
    expect(before.syncRequired).toBe(false);
    expect(before.timerSegment).toBe("WORK");

    const exact = projectFinisherTimer({
      timer,
      steps: [steps[0]!],
      includesFinalRecovery: true,
      now: at(40),
    });
    expect(exact.syncRequired).toBe(true);
    expect(exact.timerSegment).toBe("RECOVERY");
    expect(exact.activeSlices).toEqual([
      { segment: "WORK", stepIndex: 0, activeMs: 40_000 },
    ]);

    const after = projectFinisherTimer({
      timer,
      steps: [steps[0]!],
      includesFinalRecovery: true,
      now: new Date(at(40).getTime() + 1),
    });
    expect(after.timerSegment).toBe("RECOVERY");
    expect(after.segmentEndsAt).toEqual(at(60));
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

  it("excludes demanding leg work after lower body and keeps the reason truthful", () => {
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
    expect(result.recommendation?.reason).toMatch(
      /low impact.*low fatigue.*lower-body/i,
    );
  });

  it("returns no recommendation when only an unsafe lower-body candidate remains", () => {
    const result = recommendFinisher({
      routines: [
        routine("unsafe", {
          category: "CONDITIONING",
          fatigueCost: "HIGH",
          impactLevel: "HIGH",
          bodyRegions: ["legs"],
        }),
      ],
      activeLimitations: [],
      lowerBodyDemandingWorkout: true,
      recentlyPerformedRoutineVersionIds: [],
      availableEquipment: null,
    });
    expect(result.recommendation).toBeNull();
    expect(result.blockedReason).toMatch(/no routine matched/i);
  });

  it("keeps low-impact low-fatigue leg movement eligible after lower body", () => {
    const result = recommendFinisher({
      routines: [
        routine("unsafe", {
          category: "CONDITIONING",
          fatigueCost: "MODERATE",
          impactLevel: "LOW",
          bodyRegions: ["legs"],
        }),
        routine("safe", {
          category: "CONDITIONING",
          fatigueCost: "LOW",
          impactLevel: "LOW",
          bodyRegions: ["legs"],
        }),
      ],
      activeLimitations: [],
      lowerBodyDemandingWorkout: true,
      recentlyPerformedRoutineVersionIds: [],
      availableEquipment: null,
    });
    expect(result.recommendation?.routineVersionId).toBe("safe");
    expect(result.recommendation?.reason).toContain("Low impact");
    expect(result.recommendation?.reason).toContain("Low fatigue");
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
