import { describe, expect, it } from "vitest";

import {
  getLoadProvenanceNote,
  getPrescriptionBasisLabel,
  isPerformedWorkoutStatus,
} from "./session-overview";

describe("session-overview copy guards", () => {
  it("labels PLANNED workouts as planned-only", () => {
    expect(isPerformedWorkoutStatus("PLANNED")).toBe(false);
    expect(getPrescriptionBasisLabel("PLANNED")).toContain("planned session targets");
  });

  it("labels PARTIAL and COMPLETED workouts as performed basis", () => {
    expect(isPerformedWorkoutStatus("PARTIAL")).toBe(true);
    expect(isPerformedWorkoutStatus("COMPLETED")).toBe(true);
    expect(getPrescriptionBasisLabel("PARTIAL")).toContain("performed session");
  });

  it("only claims history-based load when performed history exists", () => {
    expect(
      getLoadProvenanceNote({
        targetLoad: 185,
        isBodyweightExercise: false,
        hasHistory: true,
      })
    ).toBe("Estimated load (from workout history).");

    expect(
      getLoadProvenanceNote({
        targetLoad: 185,
        isBodyweightExercise: false,
        hasHistory: false,
      })
    ).toBe("Planned load target. No performed history available.");
  });
});
