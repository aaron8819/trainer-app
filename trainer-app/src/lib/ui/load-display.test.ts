import { describe, expect, it } from "vitest";

import { formatLoad, isDumbbellEquipment } from "./load-display";

describe("load-display", () => {
  it("uses dumbbell display for dumbbell-only equipment", () => {
    expect(isDumbbellEquipment(["DUMBBELL", "BENCH"])).toBe(true);
    expect(formatLoad(52.5, true, false)).toBe("52.5 lbs each");
  });

  it("does not force dumbbell display for mixed barbell+dumbbell metadata", () => {
    const isDumbbell = isDumbbellEquipment(["BARBELL", "DUMBBELL"]);

    expect(isDumbbell).toBe(false);
    expect(formatLoad(185, isDumbbell, false)).toBe("185 lbs");
  });
});
