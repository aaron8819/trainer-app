import { describe, expect, it } from "vitest";

import {
  CANONICAL_DELOAD_DECISION_REDUCTION_PERCENT,
  CANONICAL_DELOAD_HISTORY_POLICY,
  CANONICAL_DELOAD_RIR_TARGET,
  CANONICAL_DELOAD_SET_MULTIPLIER,
  buildCanonicalDeloadDecision,
  buildNoDeloadDecision,
  getCanonicalDeloadTargetRpe,
  isCanonicalDeloadPhase,
  isCanonicalDeloadReceipt,
  resolveCanonicalDeloadSetCount,
} from "./semantics";

describe("deload semantics", () => {
  it("exposes the canonical deload effort target from the shared rir band", () => {
    expect(CANONICAL_DELOAD_RIR_TARGET).toEqual({ min: 5, max: 6 });
    expect(getCanonicalDeloadTargetRpe()).toBe(4.5);
  });

  it("preserves the current deload hard-set reduction behavior, including edge cases", () => {
    expect(CANONICAL_DELOAD_SET_MULTIPLIER).toBe(0.5);
    expect(resolveCanonicalDeloadSetCount(1)).toBe(1);
    expect(resolveCanonicalDeloadSetCount(2)).toBe(1);
    expect(resolveCanonicalDeloadSetCount(4)).toBe(2);
    expect(resolveCanonicalDeloadSetCount(5)).toBe(3);
  });

  it("keeps canonical progression semantics explicit for deload sessions", () => {
    expect(CANONICAL_DELOAD_HISTORY_POLICY.countsTowardProgressionHistory).toBe(false);
    expect(CANONICAL_DELOAD_HISTORY_POLICY.countsTowardPerformanceHistory).toBe(false);
    expect(CANONICAL_DELOAD_HISTORY_POLICY.updatesProgressionAnchor).toBe(false);
    expect(CANONICAL_DELOAD_HISTORY_POLICY.reanchorNextBlockFromAccumulation).toBe(true);
  });

  it("normalizes deload detection across receipt and phase inputs", () => {
    expect(isCanonicalDeloadPhase("deload")).toBe(true);
    expect(isCanonicalDeloadPhase("active_deload")).toBe(true);
    expect(isCanonicalDeloadPhase("accumulation")).toBe(false);
    expect(
      isCanonicalDeloadReceipt({
        cycleContext: {
          weekInMeso: 5,
          weekInBlock: 1,
          phase: "deload",
          blockType: "deload",
          isDeload: true,
          source: "computed",
        },
        deloadDecision: buildCanonicalDeloadDecision("scheduled", ["Scheduled deload week."]),
      })
    ).toBe(true);
  });

  it("builds canonical deload decisions and explicit non-deload decisions", () => {
    expect(buildCanonicalDeloadDecision("scheduled", ["Scheduled deload week."])).toEqual({
      mode: "scheduled",
      reason: ["Scheduled deload week."],
      reductionPercent: CANONICAL_DELOAD_DECISION_REDUCTION_PERCENT,
      appliedTo: "both",
    });
    expect(buildNoDeloadDecision()).toEqual({
      mode: "none",
      reason: [],
      reductionPercent: 0,
      appliedTo: "none",
    });
  });
});
