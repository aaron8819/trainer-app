import { describe, expect, it } from "vitest";
import { computeMuscleOpportunity } from "./opportunity";
import type { RecentMuscleStimulus } from "./recent-muscle-stimulus";
import type { ReadinessSignal } from "@/lib/engine/readiness/types";

function makeRecentStimulus(overrides: Partial<RecentMuscleStimulus> = {}): RecentMuscleStimulus {
  return {
    muscle: "Chest",
    lastStimulatedAt: null,
    hoursSinceStimulus: null,
    recentEffectiveSets: 0,
    recentStimulusRatio: 0,
    sraHours: 60,
    ...overrides,
  };
}

function makeReadinessSignal(
  overrides: Partial<ReadinessSignal> = {}
): ReadinessSignal {
  return {
    timestamp: new Date("2026-03-08T08:00:00.000Z"),
    userId: "user-1",
    subjective: {
      readiness: 3,
      motivation: 3,
      soreness: {},
      stress: undefined,
    },
    performance: {
      rpeDeviation: 0,
      stallCount: 0,
      volumeComplianceRate: 1,
    },
    ...overrides,
  };
}

describe("computeMuscleOpportunity", () => {
  it("respects weekly pressure when recent suppression is low", () => {
    const result = computeMuscleOpportunity({
      muscle: "Chest",
      targetEffectiveSets: 10,
      weeklyEffectiveSets: 2,
      recentStimulus: makeRecentStimulus(),
      readinessSignal: null,
    });

    expect(result.score).toBe(0.8);
    expect(result.state).toBe("high_opportunity");
  });

  it("returns covered when target is already met and never deprioritizes covered muscles", () => {
    const result = computeMuscleOpportunity({
      muscle: "Chest",
      targetEffectiveSets: 10,
      weeklyEffectiveSets: 10,
      recentStimulus: makeRecentStimulus({
        hoursSinceStimulus: 2,
        recentEffectiveSets: 5,
      }),
      readinessSignal: makeReadinessSignal({
        subjective: {
          readiness: 1,
          motivation: 1,
          soreness: { chest: 3 },
        },
      }),
    });

    expect(result.state).toBe("covered");
    expect(result.rationale).toContain("already covered");
  });

  it("can deprioritize below-target muscles after a strong recent weighted dose", () => {
    const result = computeMuscleOpportunity({
      muscle: "Chest",
      targetEffectiveSets: 10,
      weeklyEffectiveSets: 3,
      recentStimulus: makeRecentStimulus({
        hoursSinceStimulus: 8,
        recentEffectiveSets: 5,
      }),
      readinessSignal: null,
    });

    expect(result.state).toBe("deprioritize_today");
    expect(result.rationale).toContain("recent weighted stimulus");
  });

  it("uses readiness only as a downward modulation", () => {
    const baseline = computeMuscleOpportunity({
      muscle: "Chest",
      targetEffectiveSets: 10,
      weeklyEffectiveSets: 2,
      recentStimulus: makeRecentStimulus(),
      readinessSignal: null,
    });
    const modulated = computeMuscleOpportunity({
      muscle: "Chest",
      targetEffectiveSets: 10,
      weeklyEffectiveSets: 2,
      recentStimulus: makeRecentStimulus(),
      readinessSignal: makeReadinessSignal({
        subjective: {
          readiness: 2,
          motivation: 2,
          soreness: {},
        },
        performance: {
          rpeDeviation: 2,
          stallCount: 2,
          volumeComplianceRate: 0.7,
        },
      }),
    });

    expect(modulated.score).toBeLessThanOrEqual(baseline.score);
    expect(modulated.state).not.toBe("high_opportunity");
  });

  it("generates rationale text that matches severe soreness deprioritization", () => {
    const result = computeMuscleOpportunity({
      muscle: "Chest",
      targetEffectiveSets: 10,
      weeklyEffectiveSets: 4,
      recentStimulus: makeRecentStimulus(),
      readinessSignal: makeReadinessSignal({
        subjective: {
          readiness: 3,
          motivation: 3,
          soreness: { chest: 3 },
        },
      }),
    });

    expect(result.state).toBe("deprioritize_today");
    expect(result.rationale).toContain("fresh soreness");
  });
});
