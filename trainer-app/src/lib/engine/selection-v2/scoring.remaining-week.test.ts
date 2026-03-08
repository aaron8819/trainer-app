import { describe, expect, it } from "vitest";

import type { SelectionVolumeContext, VolumeContribution } from "./types";
import { scoreDeficitFill } from "./scoring";

describe("remaining-week deficit scoring", () => {
  it("favors a harder-to-close muscle even when its raw deficit is smaller", () => {
    const volumeContext: SelectionVolumeContext = {
      weeklyTarget: new Map([
        ["Chest", 16],
        ["Triceps", 8],
      ]),
      weeklyActual: new Map(),
      effectiveActual: new Map([
        ["Chest", 6],
        ["Triceps", 1],
      ]),
      remainingWeek: {
        futureSlots: ["legs", "push"],
        futureSlotCounts: new Map([
          ["legs", 1],
          ["push", 1],
        ]),
        futureCapacityFactor: 1,
        futureCapacity: new Map([
          ["Chest", 8],
          ["Triceps", 4],
        ]),
        requiredNow: new Map([
          ["Chest", 2],
          ["Triceps", 3],
        ]),
        urgency: new Map([
          ["Chest", 1.3],
          ["Triceps", 1.65],
        ]),
      },
    };

    const chestContribution: VolumeContribution = new Map([["Chest", 3]]);
    const tricepsContribution: VolumeContribution = new Map([["Triceps", 3]]);

    expect(scoreDeficitFill(tricepsContribution, volumeContext)).toBeGreaterThan(
      scoreDeficitFill(chestContribution, volumeContext)
    );
  });
});
