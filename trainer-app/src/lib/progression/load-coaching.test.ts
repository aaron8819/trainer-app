import { describe, expect, it } from "vitest";
import { getLoadRecommendation } from "./load-coaching";

describe("load coaching", () => {
  it("keeps the standard hold copy at the prescribed load", () => {
    const recommendation = getLoadRecommendation({
      reps: 7,
      rir: 1.5,
      actualLoad: 105,
      targetLoad: 105,
      repRange: { min: 7, max: 7 },
      targetRir: 1.5,
    });

    expect(recommendation).toEqual({
      action: "hold",
      suggestedLoad: 105,
      message: "Hold at 105 lbs and target cleaner reps before increasing.",
    });
  });

  it("acknowledges when the user is above the prescribed load but still in a formal hold state", () => {
    const recommendation = getLoadRecommendation({
      reps: 7,
      rir: 1.5,
      actualLoad: 115,
      targetLoad: 105,
      repRange: { min: 7, max: 7 },
      targetRir: 1.5,
    });

    expect(recommendation).toEqual({
      action: "hold",
      suggestedLoad: 115,
      message:
        "You're above the prescribed load. Keep it if technique stays stable; formal progression is evaluated across the full session.",
    });
  });

  it("uses the rising-effort hold copy when the user is above the prescribed load and effort climbs", () => {
    const recommendation = getLoadRecommendation({
      reps: 7,
      rir: 1,
      actualLoad: 115,
      targetLoad: 105,
      repRange: { min: 7, max: 7 },
      targetRir: 1.5,
    });

    expect(recommendation).toEqual({
      action: "hold",
      suggestedLoad: 115,
      message: "You're above the prescribed load, but effort is climbing. Keep it only if technique stays stable.",
    });
  });

  it("tells the user to back off when a heavier-than-prescribed load overshoots badly", () => {
    const recommendation = getLoadRecommendation({
      reps: 6,
      rir: 0.5,
      actualLoad: 115,
      targetLoad: 105,
      repRange: { min: 7, max: 7 },
      targetRir: 1.5,
    });

    expect(recommendation).toEqual({
      action: "decrease",
      suggestedLoad: 112.5,
      message: "The set overshot the target. Consider 112.5 lbs for the next set (-2.5).",
    });
  });

  it("does not preserve legacy heavier-then-lighter coaching once working sets are uniform", () => {
    const recommendation = getLoadRecommendation({
      reps: 6,
      rir: 0.5,
      actualLoad: 115,
      targetLoad: 105,
      repRange: { min: 7, max: 7 },
      targetRir: 1.5,
    });

    expect(recommendation).toEqual({
      action: "decrease",
      suggestedLoad: 112.5,
      message: "The set overshot the target. Consider 112.5 lbs for the next set (-2.5).",
    });
  });

  it("keeps the increase case unchanged", () => {
    const recommendation = getLoadRecommendation({
      reps: 10,
      rir: 3,
      actualLoad: 100,
      targetLoad: 100,
      repRange: { min: 8, max: 10 },
      targetRir: 1.5,
    });

    expect(recommendation).toEqual({
      action: "increase",
      suggestedLoad: 102.5,
      message: "Set clearly beat the target. Consider 102.5 lbs for the next set (+2.5).",
    });
  });

  it("keeps the standard decrease case unchanged at the prescribed load", () => {
    const recommendation = getLoadRecommendation({
      reps: 6,
      rir: 0.5,
      actualLoad: 105,
      targetLoad: 105,
      repRange: { min: 7, max: 7 },
      targetRir: 1.5,
    });

    expect(recommendation).toEqual({
      action: "decrease",
      suggestedLoad: 102.5,
      message: "Set was harder than target. Consider 102.5 lbs for the next set (-2.5).",
    });
  });

  it.each([
    { action: "increase" as const, reps: 12, rir: 3, expected: 105 },
    { action: "decrease" as const, reps: 7, rir: 0, expected: 95 },
  ])("uses exactly one supplied valid increment for $action coaching", ({ action, reps, rir, expected }) => {
    const recommendation = getLoadRecommendation({
      reps,
      rir,
      actualLoad: 100,
      targetLoad: 100,
      repRange: { min: 8, max: 10 },
      targetRir: 2,
      loadIncrement: 5,
    });

    expect(recommendation).toMatchObject({ action, suggestedLoad: expected });
  });

  it("supports a supplied 10 lb increment without producing an intermediate load", () => {
    expect(
      getLoadRecommendation({
        reps: 12,
        rir: 3,
        actualLoad: 100,
        targetLoad: 100,
        repRange: { min: 8, max: 10 },
        targetRir: 2,
        loadIncrement: 10,
      })
    ).toMatchObject({ action: "increase", suggestedLoad: 110 });
  });
});
