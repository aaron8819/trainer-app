/**
 * Tests for computeCurrentMesoWeek — a pure function, no DB access needed.
 */

import { describe, it, expect } from "vitest";
import { computeCurrentMesoWeek } from "./periodization";
import type { ActiveMesoContext } from "./periodization";

function makeCtx(
  completedSessions: number,
  durationWeeks: number,
  daysAgoStart: number
): ActiveMesoContext {
  const startDate = new Date(Date.now() - daysAgoStart * 24 * 60 * 60 * 1000);
  return { completedSessions, durationWeeks, startDate };
}

describe("computeCurrentMesoWeek", () => {
  it("returns 1 when no sessions completed and meso just started", () => {
    const ctx = makeCtx(0, 5, 0);
    expect(computeCurrentMesoWeek(ctx, 3)).toBe(1);
  });

  it("advances by session count: 3 sessions at 3/week → week 2", () => {
    // 3 sessions completed, 7 days elapsed → sessionWeek=floor(3/3)+1=2, calendarWeek=floor(7/7)+1=2
    // min(2, 2) = 2
    const ctx = makeCtx(3, 5, 7);
    expect(computeCurrentMesoWeek(ctx, 3)).toBe(2);
  });

  it("does NOT auto-advance on missed sessions (calendar conservative)", () => {
    // 14 days passed (calendar week 3), but only 2 sessions completed → session week = 1
    // min(1, 3) = 1 — session-count wins
    const ctx = makeCtx(2, 5, 14);
    expect(computeCurrentMesoWeek(ctx, 3)).toBe(1);
  });

  it("calendar week governs when sessions are done faster than real time", () => {
    // 6 sessions at 3/week = session week 3, but only 7 days passed = calendar week 2
    // min(3, 2) = 2 — calendar wins (prevents within-week over-count)
    const ctx = makeCtx(6, 5, 7);
    expect(computeCurrentMesoWeek(ctx, 3)).toBe(2);
  });

  it("clamps to durationWeeks", () => {
    // 20 sessions at 3/week = week 7+, but duration is 5 weeks
    const ctx = makeCtx(20, 5, 50);
    expect(computeCurrentMesoWeek(ctx, 3)).toBe(5);
  });

  it("handles daysPerWeek=1 without division by zero", () => {
    // 3 sessions at 1/week = session week 4; 28 days passed = calendar week 5
    const ctx = makeCtx(3, 6, 28);
    expect(computeCurrentMesoWeek(ctx, 1)).toBe(4);
  });

  it("handles daysPerWeek=0 gracefully (coerced to 1)", () => {
    const ctx = makeCtx(3, 6, 28);
    expect(() => computeCurrentMesoWeek(ctx, 0)).not.toThrow();
  });
});
