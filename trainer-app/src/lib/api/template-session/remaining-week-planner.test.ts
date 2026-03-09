import { describe, expect, it } from "vitest";
import { buildRemainingScheduleAfterPerformed } from "./remaining-week-planner";

describe("buildRemainingScheduleAfterPerformed", () => {
  it("preserves unresolved earlier slots for off-order sessions", () => {
    expect(
      buildRemainingScheduleAfterPerformed(["pull", "push", "legs"], ["pull", "legs"])
    ).toEqual(["push"]);
  });

  it("falls back to consuming the oldest unresolved slot when the performed intent is unexpected", () => {
    expect(
      buildRemainingScheduleAfterPerformed(["pull", "push", "legs"], ["full_body" as never])
    ).toEqual(["push", "legs"]);
  });
});
