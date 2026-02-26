import { describe, expect, it } from "vitest";

import { describeReadinessStatus, explainSessionContext } from "./session-context";

describe("session-context correctness", () => {
  it("labels missing readiness explicitly", () => {
    const result = describeReadinessStatus({
      fatigueScore: undefined,
      signalAge: undefined,
      hasRecentReadinessSignal: false,
    });

    expect(result.availability).toBe("missing");
    expect(result.label).toBe("No recent readiness");
  });

  it("labels stale readiness explicitly with age", () => {
    const result = describeReadinessStatus({
      fatigueScore: undefined,
      signalAge: 5,
      hasRecentReadinessSignal: false,
    });

    expect(result.availability).toBe("stale");
    expect(result.label).toContain("Stale readiness (5d old)");
  });

  it("surfaces fallback cycle context source and week", () => {
    const context = explainSessionContext({
      blockContext: null,
      cycleContext: {
        weekInMeso: 2,
        weekInBlock: 3,
        phase: "intensification",
        blockType: "intensification",
        isDeload: false,
        source: "fallback",
      },
      volumeByMuscle: new Map(),
      hasRecentReadinessSignal: false,
    });

    expect(context.cycleSource).toBe("fallback");
    expect(context.progressionContext.weekInMesocycle).toBe(2);
    expect(context.blockPhase.weekInBlock).toBe(3);
  });

  it("shows separate pull-muscle volume rows for Lats and Upper Back", () => {
    const context = explainSessionContext({
      blockContext: null,
      volumeByMuscle: new Map(),
      sessionIntent: "pull",
      hasRecentReadinessSignal: false,
    });

    expect(context.volumeStatus.muscleStatuses.has("Lats")).toBe(true);
    expect(context.volumeStatus.muscleStatuses.has("Upper Back")).toBe(true);
  });
});
