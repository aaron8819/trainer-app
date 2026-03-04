import { describe, expect, it } from "vitest";
import { readPersistedWorkoutMesocycleSnapshot } from "./workout-mesocycle-snapshot";

describe("readPersistedWorkoutMesocycleSnapshot", () => {
  it("returns a normalized persisted snapshot when mesocycle id and week exist", () => {
    expect(
      readPersistedWorkoutMesocycleSnapshot({
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: 4,
        mesoSessionSnapshot: 2,
        mesocyclePhaseSnapshot: "ACCUMULATION",
      })
    ).toEqual({
      mesocycleId: "meso-1",
      week: 4,
      session: 2,
      phase: "ACCUMULATION",
    });
  });

  it("returns undefined when the persisted week context is incomplete", () => {
    expect(
      readPersistedWorkoutMesocycleSnapshot({
        mesocycleId: "meso-1",
        mesocycleWeekSnapshot: null,
      })
    ).toBeUndefined();
  });
});
