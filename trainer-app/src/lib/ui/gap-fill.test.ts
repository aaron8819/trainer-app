import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isGapFillWorkout, resolveGapFillTargetMuscles } from "./gap-fill";

type GapFillFixture = {
  selectionMetadata: unknown;
  selectionMode: string;
  sessionIntent: string;
};

function loadFixture(): GapFillFixture {
  const fixturePath = path.join(
    process.cwd(),
    "src/lib/audit/workout-audit/fixtures/optional-gap-fill-body-part.future-week-explicit-intent.json"
  );
  return JSON.parse(readFileSync(fixturePath, "utf8")) as GapFillFixture;
}

describe("gap-fill strict classifier", () => {
  it("returns true for canonical marker + INTENT + BODY_PART", () => {
    const fixture = loadFixture();
    expect(
      isGapFillWorkout({
        selectionMetadata: fixture.selectionMetadata,
        selectionMode: fixture.selectionMode,
        sessionIntent: fixture.sessionIntent,
      })
    ).toBe(true);
  });

  it("returns false when any strict triplet leg is missing", () => {
    const fixture = loadFixture();
    expect(
      isGapFillWorkout({
        selectionMetadata: fixture.selectionMetadata,
        selectionMode: "AUTO",
        sessionIntent: "BODY_PART",
      })
    ).toBe(false);
    expect(
      isGapFillWorkout({
        selectionMetadata: fixture.selectionMetadata,
        selectionMode: "INTENT",
        sessionIntent: "PULL",
      })
    ).toBe(false);
    expect(
      isGapFillWorkout({
        selectionMetadata: {},
        selectionMode: "INTENT",
        sessionIntent: "BODY_PART",
      })
    ).toBe(false);
  });
});

describe("resolveGapFillTargetMuscles", () => {
  it("reads target muscles from canonical receipt in the fixture payload", () => {
    const fixture = loadFixture();
    expect(
      resolveGapFillTargetMuscles({
        selectionMetadata: fixture.selectionMetadata,
      })
    ).toEqual(["front delts", "rear delts", "biceps"]);
  });
});
