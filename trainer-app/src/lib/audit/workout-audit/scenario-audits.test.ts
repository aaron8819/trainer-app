import { describe, expect, it } from "vitest";
import {
  analyzeAccountingClassification,
  analyzeSequencingScenario,
} from "./scenario-audits";

describe("analyzeSequencingScenario", () => {
  it("keeps the unresolved earlier slot when sessions are performed off-order", () => {
    const result = analyzeSequencingScenario({
      name: "off-order",
      weeklySchedule: ["pull", "push", "legs"],
      performed: [
        { intent: "pull", status: "COMPLETED", advancesSplit: true },
        { intent: "legs", status: "COMPLETED", advancesSplit: true },
      ],
    });

    expect(result.nextUnresolvedIntent).toBe("push");
    expect(result.remainingAdvancingSchedule).toEqual(["push"]);
  });

  it("excludes advancesSplit=false sessions from split sequencing while keeping them performed", () => {
    const result = analyzeSequencingScenario({
      name: "supplemental",
      weeklySchedule: ["pull", "push", "legs"],
      performed: [
        { intent: "pull", status: "COMPLETED", advancesSplit: true },
        { intent: "legs", status: "COMPLETED", advancesSplit: false },
      ],
    });

    expect(result.nextUnresolvedIntent).toBe("push");
    expect(result.remainingAdvancingSchedule).toEqual(["push", "legs"]);
    expect(result.performed[1]?.countsTowardWeeklyAccounting).toBe(true);
    expect(result.performed[1]?.countsTowardSplitAdvancement).toBe(false);
  });
});

describe("analyzeAccountingClassification", () => {
  it("treats non-advancing optional gap fill as weekly accounting but not split advancement", () => {
    const result = analyzeAccountingClassification({
      status: "COMPLETED",
      selectionMode: "MANUAL",
      advancesSplit: false,
      optionalGapFill: true,
    });

    expect(result.countsTowardWeeklyVolume).toBe(true);
    expect(result.countsTowardRecoveryRecentStimulus).toBe(true);
    expect(result.countsTowardProgressionHistory).toBe(true);
    expect(result.countsTowardWeekCloseClosure).toBe(true);
    expect(result.canResolvePendingWeekClose).toBe(true);
    expect(result.countsTowardSplitAdvancement).toBe(false);
  });
});
