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

  it("surfaces soreness-based volume suppression from generation metadata", () => {
    const result = describeReadinessStatus({
      fatigueScore: undefined,
      sorenessSuppressedMuscles: ["Chest", "Front Delts"],
      hasRecentReadinessSignal: false,
    });

    expect(result.sorenessSuppressedMuscles).toEqual(["Chest", "Front Delts"]);
    expect(result.adaptations).toContain(
      "Held back weekly volume progression for Chest, Front Delts due to high soreness"
    );
  });

  it("surfaces fallback cycle context source and week", () => {
    const context = explainSessionContext({
      blockContext: null,
      cycleContext: {
        weekInMeso: 2,
        weekInBlock: 3,
        blockDurationWeeks: 4,
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

  it("uses receipt block duration for block horizons when canonical context exists", () => {
    const context = explainSessionContext({
      blockContext: null,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 1,
        blockDurationWeeks: 2,
        phase: "intensification",
        blockType: "intensification",
        isDeload: false,
        source: "computed",
      },
      volumeByMuscle: new Map(),
      hasRecentReadinessSignal: false,
    });

    expect(context.blockPhase.totalWeeksInBlock).toBe(2);
    expect(context.progressionContext.nextMilestone).toBe(
      "Final intensification week next, then transition to next block"
    );
  });

  it("keeps milestone copy cautious when receipt block duration is absent", () => {
    const context = explainSessionContext({
      blockContext: null,
      cycleContext: {
        weekInMeso: 4,
        weekInBlock: 1,
        phase: "intensification",
        blockType: "intensification",
        isDeload: false,
        source: "computed",
      },
      volumeByMuscle: new Map(),
      hasRecentReadinessSignal: false,
    });

    expect(context.progressionContext.nextMilestone).toBe(
      "Continue progressing through the intensification block."
    );
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
