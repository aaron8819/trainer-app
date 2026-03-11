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

  it("returns consistent copy for decrease decisions", () => {
    expect(getCanonicalNextExposureCopy("decrease")).toEqual({
      badge: "Reduce next time",
      summary: "Next exposure: reduce load.",
      resultClause: "points to a reduction next time",
      actionPhrase: "Reduce load",
      nextTimeImperative: "Reduce load next time.",
    });
  });
});

