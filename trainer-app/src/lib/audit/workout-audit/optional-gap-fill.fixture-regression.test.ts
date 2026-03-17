import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readSessionDecisionReceipt } from "@/lib/evidence/session-decision-receipt";
import { isGapFillWorkout } from "@/lib/ui/gap-fill";

type OptionalGapFillFixture = {
  anchorWeek: number;
  selectionMode: string;
  sessionIntent: string;
  mesocycleWeekSnapshot: number;
  selectionMetadata: unknown;
};

function loadFixture(): OptionalGapFillFixture {
  const fixturePath = path.join(
    process.cwd(),
    "src/lib/audit/workout-audit/fixtures/optional-gap-fill-body-part.future-week-explicit-intent.json"
  );
  return JSON.parse(readFileSync(fixturePath, "utf8")) as OptionalGapFillFixture;
}

describe("optional gap-fill fixture regression", () => {
  it("preserves canonical gap-fill marker, target muscles, and anchor-pinned week fields through receipt normalization", () => {
    const fixture = loadFixture();
    const receipt = readSessionDecisionReceipt(fixture.selectionMetadata);

    expect(receipt).toBeDefined();
    expect(receipt?.exceptions.map((entry) => entry.code)).toEqual(["optional_gap_fill"]);
    expect(receipt?.targetMuscles).toEqual(["front delts", "rear delts", "biceps"]);
    expect(receipt?.cycleContext.weekInMeso).toBe(fixture.anchorWeek);
    expect(receipt?.cycleContext.weekInBlock).toBe(fixture.anchorWeek);
  });

  it("keeps mesocycleWeekSnapshot pinned to anchor week and passes strict triplet gap-fill classification", () => {
    const fixture = loadFixture();

    expect(fixture.mesocycleWeekSnapshot).toBe(fixture.anchorWeek);
    expect(
      isGapFillWorkout({
        selectionMetadata: fixture.selectionMetadata,
        selectionMode: fixture.selectionMode,
        sessionIntent: fixture.sessionIntent,
      })
    ).toBe(true);
  });
});
