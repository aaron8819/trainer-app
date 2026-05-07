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

  it("returns distinct copy for recalibrated-anchor holds", () => {
    expect(getCanonicalNextExposureCopy("hold_at_recalibrated_anchor")).toEqual({
      badge: "Recalibrated hold",
      summary: "Next exposure: hold at recalibrated anchor.",
      resultClause: "points to a hold at the recalibrated performed anchor",
      actionPhrase: "Hold the recalibrated anchor",
      nextTimeImperative: "Hold the performed anchor next time because the written target was too low.",
    });
  });

  it("returns distinct copy for recalibrated-anchor increases", () => {
    expect(getCanonicalNextExposureCopy("recalibrated_increase")).toEqual({
      badge: "Recalibrated increase",
      summary: "Next exposure: recalibrated increase.",
      resultClause: "points to a recalibrated increase from the performed anchor",
      actionPhrase: "Use a recalibrated increase",
      nextTimeImperative: "Increase from today's performed anchor while recalibrating the written target.",
    });
    expect(JSON.stringify(getCanonicalNextExposureCopy("recalibrated_increase"))).not.toMatch(
      /missed/i
    );
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

