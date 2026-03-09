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
      message: "Hold load and target cleaner reps before increasing.",
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
      message: "Heavier load overshot the target. Drop back toward the prescribed load.",
    });
  });

  it("treats a top-set to backoff transition as planned instead of a false overshoot", () => {
    const recommendation = getLoadRecommendation({
      reps: 6,
      rir: 0.5,
      actualLoad: 115,
      targetLoad: 105,
      plannedBackoffTransition: true,
      repRange: { min: 7, max: 7 },
      targetRir: 1.5,
    });

    expect(recommendation).toEqual({
      action: "decrease",
      message: "That top set ran hard. Next set is a planned back-off, so reduce load as written.",
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
      message: "Set felt easier than target. Consider +2.5 lbs for next set.",
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
      message: "Set was harder than target. Consider -2.5 lbs or -1 rep.",
    });
  });
});
