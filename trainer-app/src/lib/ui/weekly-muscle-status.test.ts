import { describe, expect, it } from "vitest";
import {
  formatWeeklyMuscleStatusLabel,
  getWeeklyMuscleStatus,
} from "./weekly-muscle-status";

describe("weekly muscle status", () => {
  it("matches the dashboard ladder boundaries", () => {
    expect(
      getWeeklyMuscleStatus({
        effectiveSets: 0,
        target: 7,
        mev: 2,
        mrv: 14,
      })
    ).toBe("below_mev");

    expect(
      getWeeklyMuscleStatus({
        effectiveSets: 5,
        target: 7,
        mev: 2,
        mrv: 14,
      })
    ).toBe("in_range");

    expect(
      getWeeklyMuscleStatus({
        effectiveSets: 6,
        target: 7,
        mev: 2,
        mrv: 14,
      })
    ).toBe("near_target");

    expect(
      getWeeklyMuscleStatus({
        effectiveSets: 7,
        target: 7,
        mev: 2,
        mrv: 14,
      })
    ).toBe("on_target");

    expect(
      getWeeklyMuscleStatus({
        effectiveSets: 11.9,
        target: 7,
        mev: 2,
        mrv: 14,
      })
    ).toBe("near_mrv");

    expect(
      getWeeklyMuscleStatus({
        effectiveSets: 14,
        target: 7,
        mev: 2,
        mrv: 14,
      })
    ).toBe("at_mrv");
  });

  it("formats the canonical labels used by dashboard and review surfaces", () => {
    expect(formatWeeklyMuscleStatusLabel("below_mev")).toBe("Below MEV");
    expect(formatWeeklyMuscleStatusLabel("in_range")).toBe("In range");
    expect(formatWeeklyMuscleStatusLabel("near_target")).toBe("Near target");
    expect(formatWeeklyMuscleStatusLabel("on_target")).toBe("On target");
    expect(formatWeeklyMuscleStatusLabel("near_mrv")).toBe("Near MRV");
    expect(formatWeeklyMuscleStatusLabel("at_mrv")).toBe("At MRV");
  });
});
