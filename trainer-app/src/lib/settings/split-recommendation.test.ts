import { describe, expect, it } from "vitest";
import { getSplitMismatchWarning } from "./split-recommendation";

describe("getSplitMismatchWarning", () => {
  it("warns when PPL is selected for 3 days/week", () => {
    const warning = getSplitMismatchWarning(3, "PPL");
    expect(warning).toBe(
      "PPL with 3 days/week trains each muscle once per week. Consider Full Body or Upper/Lower for better weekly frequency."
    );
  });

  it("does not warn for recommended split/day combinations", () => {
    expect(getSplitMismatchWarning(4, "UPPER_LOWER")).toBeNull();
    expect(getSplitMismatchWarning(2, "FULL_BODY")).toBeNull();
  });

  it("does not warn for custom split", () => {
    expect(getSplitMismatchWarning(3, "CUSTOM")).toBeNull();
  });

  it("warns when upper/lower is selected for 2 days/week", () => {
    const warning = getSplitMismatchWarning(2, "UPPER_LOWER");
    expect(warning).toBe(
      "Upper/Lower with 2 days/week trains each muscle about 1.0x per week. Consider Full Body for better weekly frequency."
    );
  });
});
