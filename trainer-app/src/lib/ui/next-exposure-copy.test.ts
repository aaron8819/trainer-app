import { describe, expect, it } from "vitest";
import { getCanonicalNextExposureCopy } from "./next-exposure-copy";

describe("getCanonicalNextExposureCopy", () => {
  it("returns consistent copy for increase decisions", () => {
    expect(getCanonicalNextExposureCopy("increase")).toEqual({
      badge: "Increase next time",
      summary: "Next exposure: increase load.",
      resultClause: "points to an increase next time",
      actionPhrase: "Increase load",
      nextTimeImperative: "Increase load next time.",
    });
  });

  it("returns consistent copy for hold decisions", () => {
    expect(getCanonicalNextExposureCopy("hold")).toEqual({
      badge: "Hold next time",
      summary: "Next exposure: hold load.",
      resultClause: "points to a hold next time",
      actionPhrase: "Hold load",
      nextTimeImperative: "Hold load next time.",
    });
  });

  it("returns distinct copy for recalibrated-anchor increases", () => {
    expect(getCanonicalNextExposureCopy("recalibrated_increase")).toEqual({
      badge: "Increase from anchor",
      summary: "Next exposure: increase from today's performed anchor.",
      resultClause: "points to an increase from a recalibrated anchor",
      actionPhrase: "Increase from performed anchor",
      nextTimeImperative: "Increase from today's performed anchor, not the missed written target.",
    });
  });

  it("returns consistent copy for decrease decisions", () => {
    expect(getCanonicalNextExposureCopy("decrease")).toEqual({
      badge: "Reduce next time",
      summary: "Next exposure: reduce load.",
      resultClause: "points to a reduction next time",
      actionPhrase: "Reduce load",
      nextTimeImperative: "Reduce load next time.",
    });
  });

  it("returns caution copy for target-quality downgrades", () => {
    expect(getCanonicalNextExposureCopy("recalibrate")).toMatchObject({
      badge: "Recalibrate target",
      summary: "Next exposure: recalibrate target.",
    });
    expect(getCanonicalNextExposureCopy("target_too_high")).toMatchObject({
      badge: "Target too high",
      summary: "Next exposure: target likely too high.",
    });
    expect(getCanonicalNextExposureCopy("insufficient_evidence")).toMatchObject({
      badge: "Insufficient evidence",
      summary: "Next exposure: not enough clean evidence.",
    });
    expect(getCanonicalNextExposureCopy("caution_review_manually")).toMatchObject({
      badge: "Review manually",
      summary: "Next exposure: review manually.",
    });
  });
});

